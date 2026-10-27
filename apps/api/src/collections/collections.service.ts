import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { D } from '../common/money';
import { RequestContext } from '../common/request-context';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { MockPosAdapter } from './mockpos.adapter';
import { PosAdapter, PosPaymentResult } from './pos-adapter';

@Injectable()
export class CollectionsService {
  private readonly logger = new Logger(CollectionsService.name);
  private readonly adapters: Map<string, PosAdapter>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    mockpos: MockPosAdapter,
  ) {
    this.adapters = new Map([[mockpos.provider, mockpos]]);
  }

  providers() {
    return [...this.adapters.values()].map((a) => ({ key: a.provider, name: a.displayName }));
  }

  adapter(provider: string) {
    const a = this.adapters.get(provider);
    if (!a) throw new BadRequestException(`Desteklenmeyen sağlayıcı: ${provider}`);
    return a;
  }

  // ───────────── Herkese açık ödeme sayfası ─────────────

  async publicRequest(token: string) {
    const req = await this.prisma.raw.paymentRequest.findUnique({
      where: { token },
      include: { invoice: { select: { number: true } }, counterparty: { select: { name: true } } },
    });
    if (!req) throw new NotFoundException('Ödeme linki bulunamadı');
    const tenant = await this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: req.tenantId }, select: { name: true } });
    const expired = req.status === 'PENDING' && req.expiresAt < new Date();
    return {
      merchant: tenant.name,
      amount: req.amount.toFixed(2),
      currency: req.currency,
      description: req.description,
      invoiceNumber: req.invoice?.number ?? null,
      customerName: req.counterparty?.name ?? null,
      status: expired ? 'EXPIRED' : req.status,
      expiresAt: req.expiresAt,
    };
  }

  async startCheckout(token: string) {
    const req = await this.prisma.raw.paymentRequest.findUnique({ where: { token }, include: { terminal: true } });
    if (!req) throw new NotFoundException('Ödeme linki bulunamadı');
    if (req.status !== 'PENDING') throw new BadRequestException('Bu ödeme linki artık kullanılamaz');
    if (req.expiresAt < new Date()) throw new BadRequestException('Ödeme linkinin süresi dolmuş');
    if (!req.terminal.isActive) throw new BadRequestException('Ödeme altyapısı şu an kullanılamıyor');

    return RequestContext.runAsTenant(req.tenantId, async () => {
      const adapter = this.adapter(req.terminal.provider);
      const attemptId = `att_${CryptoService.token(12)}`;
      const web = process.env.WEB_URL ?? 'http://localhost:3000';
      // Webhook'lar sağlayıcıdan sunucuya gelir. Gerçek sağlayıcıda public adres (API_URL) kullanılır;
      // aynı konteynerde çalışan sandbox sağlayıcı için WEBHOOK_BASE_URL ile iç adres verilebilir.
      const api = process.env.WEBHOOK_BASE_URL ?? process.env.API_URL ?? 'http://localhost:4000';
      const checkout = await adapter.createCheckout({
        config: this.crypto.decryptJson(req.terminal.configEnc),
        orderId: attemptId,
        amount: req.amount.toFixed(2),
        currency: req.currency,
        description: req.description,
        callbackUrl: `${web}/pay/${token}/result?attempt=${attemptId}`,
        webhookUrl: `${api}/api/v1/webhooks/${adapter.provider}`,
      });
      await this.prisma.db.paymentAttempt.create({
        data: {
          id: attemptId,
          tenantId: req.tenantId,
          paymentRequestId: req.id,
          terminalId: req.terminalId,
          providerSessionId: checkout.sessionId,
          amount: req.amount,
          currency: req.currency,
        },
      });
      return { redirectUrl: checkout.redirectUrl };
    });
  }

  /** Müşteri sağlayıcıdan döndüğünde sonucu sağlayıcıdan doğrular. */
  async publicResult(token: string, attemptId: string) {
    const attempt = await this.prisma.raw.paymentAttempt.findUnique({ where: { id: attemptId }, include: { paymentRequest: true } });
    if (!attempt || attempt.paymentRequest.token !== token) throw new NotFoundException('Ödeme denemesi bulunamadı');
    const final = await this.verifyAndFinalize(attempt.id);
    return {
      status: final.status,
      errorMessage: final.errorMessage,
      amount: final.amount.toFixed(2),
      currency: final.currency,
      cardLast4: final.cardLast4,
    };
  }

  // ───────────── Webhook ─────────────

  async handleWebhook(provider: string, headers: Record<string, any>, rawBody: Buffer | undefined, body: any) {
    const adapter = this.adapter(provider);
    const valid = !!rawBody && adapter.verifyWebhook(headers, rawBody);
    const evt = adapter.parseWebhook(body);
    if (!evt.eventId) throw new BadRequestException('Geçersiz olay');

    const attempt = evt.sessionId
      ? await this.prisma.raw.paymentAttempt.findUnique({ where: { providerSessionId: evt.sessionId } })
      : null;

    // Olay kimliği benzersizdir: aynı webhook ikinci kez gelirse işlenmez.
    try {
      await this.prisma.raw.webhookEvent.create({
        data: {
          provider,
          eventId: evt.eventId,
          type: evt.type,
          payload: body ?? {},
          signatureValid: valid,
          tenantId: attempt?.tenantId ?? null,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { received: true, duplicate: true };
      }
      throw e;
    }

    if (!valid) {
      await this.prisma.raw.webhookEvent.update({
        where: { provider_eventId: { provider, eventId: evt.eventId } },
        data: { error: 'İmza doğrulanamadı' },
      });
      throw new BadRequestException('İmza doğrulanamadı');
    }

    try {
      if (attempt) await this.verifyAndFinalize(attempt.id);
      await this.prisma.raw.webhookEvent.update({
        where: { provider_eventId: { provider, eventId: evt.eventId } },
        data: { processedAt: new Date(), error: attempt ? null : 'Eşleşen ödeme denemesi yok' },
      });
    } catch (e) {
      await this.prisma.raw.webhookEvent.update({
        where: { provider_eventId: { provider, eventId: evt.eventId } },
        data: { error: (e as Error).message.slice(0, 500) },
      });
      throw e;
    }
    return { received: true };
  }

  // ───────────── Sonuç işleme (idempotent) ─────────────

  async verifyAndFinalize(attemptId: string) {
    const attempt = await this.prisma.raw.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { terminal: true } });
    if (attempt.status !== 'INITIATED') return attempt;
    const adapter = this.adapter(attempt.terminal.provider);
    const result = await adapter.getPayment(this.crypto.decryptJson(attempt.terminal.configEnc), attempt.providerSessionId);
    if (result.status === 'PENDING') return attempt;
    return RequestContext.runAsTenant(attempt.tenantId, () => this.finalize(attemptId, result), { system: false });
  }

  private async finalize(attemptId: string, result: PosPaymentResult) {
    const outcome = await this.prisma.db.$transaction(async (tx) => {
      // Eşzamanlı webhook ve dönüş isteği aynı denemeyi iki kez işleyemesin diye satır kilitlenir.
      await tx.$queryRaw`SELECT id FROM "PaymentAttempt" WHERE id = ${attemptId} FOR UPDATE`;
      const attempt = await tx.paymentAttempt.findFirstOrThrow({
        where: { id: attemptId },
        include: { paymentRequest: true, terminal: true },
      });
      if (attempt.status !== 'INITIATED') return { attempt, changed: false };

      if (result.status === 'FAILED') {
        const failed = await tx.paymentAttempt.update({
          where: { id: attemptId },
          data: {
            status: 'FAILED',
            providerPaymentId: result.paymentId,
            cardLast4: result.cardLast4,
            cardBrand: result.cardBrand,
            threeDSecure: result.threeDSecure,
            errorCode: result.errorCode,
            errorMessage: result.errorMessage,
            completedAt: new Date(),
          },
        });
        return { attempt: failed, changed: true };
      }

      // Sağlayıcının bildirdiği tutar talep tutarıyla eşleşmeli
      if (!D(result.amount).eq(attempt.amount) || result.currency !== attempt.currency) {
        throw new Error(`Tutar uyuşmazlığı: beklenen ${attempt.amount} ${attempt.currency}, gelen ${result.amount} ${result.currency}`);
      }
      const commission = attempt.amount.mul(attempt.terminal.commissionRate).toDecimalPlaces(2);
      const succeeded = await tx.paymentAttempt.update({
        where: { id: attemptId },
        data: {
          status: 'SUCCEEDED',
          providerPaymentId: result.paymentId,
          cardLast4: result.cardLast4,
          cardBrand: result.cardBrand,
          threeDSecure: result.threeDSecure,
          commission,
          completedAt: new Date(),
        },
      });
      const req = attempt.paymentRequest;
      await tx.paymentRequest.update({ where: { id: req.id }, data: { status: 'PAID', paidAt: new Date() } });

      // Tahsilat kaydı ortak hareket görünümüne POS kaynağıyla eklenir; benzersiz anahtar çift kaydı önler.
      await tx.financialTransaction.create({
        data: {
          tenantId: attempt.tenantId,
          sourceType: 'POS',
          dataSource: 'CONNECTED',
          sourceRef: result.paymentId,
          dedupeKey: `pos:${attempt.terminal.provider}:${result.paymentId}`,
          date: new Date(new Date().toISOString().slice(0, 10)),
          description: `Sanal POS tahsilatı: ${req.description}`,
          amount: attempt.amount,
          currency: attempt.currency,
          status: 'POSTED',
          reconStatus: 'UNMATCHED',
        },
      });

      if (req.invoiceId) {
        await this.ledger.applyToInvoice(tx, req.invoiceId, attempt.amount);
        await tx.reconciliationMatch.create({
          data: {
            tenantId: attempt.tenantId,
            type: 'POS_INVOICE',
            status: 'CONFIRMED',
            attemptId: attempt.id,
            invoiceId: req.invoiceId,
            score: 100,
            reason: 'Ödeme linki faturaya bağlı',
            decidedAt: new Date(),
          },
        });
      }
      return { attempt: succeeded, changed: true };
    });

    if (outcome.changed) {
      await this.audit.log(
        outcome.attempt.status === 'SUCCEEDED' ? 'payment.succeeded' : 'payment.failed',
        'PaymentAttempt',
        outcome.attempt.id,
        { after: { status: outcome.attempt.status, providerPaymentId: outcome.attempt.providerPaymentId, error: outcome.attempt.errorMessage } },
      );
      if (outcome.attempt.status === 'SUCCEEDED') {
        const req = await this.prisma.db.paymentRequest.findFirstOrThrow({ where: { id: outcome.attempt.paymentRequestId } });
        await this.notifications.notify([req.createdById], {
          type: 'payment.succeeded',
          title: `Tahsilat alındı: ${req.amount.toFixed(2)} ${req.currency}`,
          body: req.description,
          link: `/collections/${req.id}`,
          dedupeKey: `payment:${outcome.attempt.id}:succeeded`,
        });
      }
    }
    return outcome.attempt;
  }

  // ───────────── İade ─────────────

  async refund(attemptId: string, amount: number, reason?: string) {
    const attempt = await this.prisma.db.paymentAttempt.findFirst({
      where: { id: attemptId },
      include: { terminal: true, refunds: true, paymentRequest: true },
    });
    if (!attempt) throw new NotFoundException('Ödeme bulunamadı');
    if (attempt.status !== 'SUCCEEDED' || !attempt.providerPaymentId) throw new BadRequestException('Yalnızca başarılı ödemeler iade edilebilir');
    const refunded = attempt.refunds.filter((r) => r.status === 'SUCCEEDED').reduce((s, r) => s.plus(r.amount), D(0));
    const refundable = attempt.amount.minus(refunded);
    if (D(amount).gt(refundable)) throw new BadRequestException(`İade edilebilir tutar: ${refundable.toFixed(2)}`);

    const adapter = this.adapter(attempt.terminal.provider);
    const res = await adapter.refund(this.crypto.decryptJson(attempt.terminal.configEnc), attempt.providerPaymentId, D(amount).toFixed(2));
    const userId = RequestContext.userId();

    if (!res.ok) {
      const failed = await this.prisma.db.refund.create({
        data: { tenantId: attempt.tenantId, attemptId, amount, reason, status: 'FAILED', createdById: userId },
      });
      await this.audit.log('refund.failed', 'Refund', failed.id, { after: { amount, error: res.error } });
      throw new BadRequestException(res.error ?? 'İade sağlayıcı tarafından reddedildi');
    }

    const refund = await this.prisma.db.$transaction(async (tx) => {
      const r = await tx.refund.create({
        data: {
          tenantId: attempt.tenantId,
          attemptId,
          amount,
          reason,
          status: 'SUCCEEDED',
          providerRefundId: res.refundId,
          createdById: userId,
        },
      });
      const fully = refunded.plus(amount).gte(attempt.amount);
      await tx.paymentRequest.update({
        where: { id: attempt.paymentRequestId },
        data: { status: fully ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
      });
      await tx.financialTransaction.create({
        data: {
          tenantId: attempt.tenantId,
          sourceType: 'POS',
          dataSource: 'CONNECTED',
          sourceRef: res.refundId,
          dedupeKey: `pos-refund:${attempt.terminal.provider}:${res.refundId}`,
          date: new Date(new Date().toISOString().slice(0, 10)),
          description: `Sanal POS iadesi: ${attempt.paymentRequest.description}`,
          amount: -amount,
          currency: attempt.currency,
          createdById: userId,
        },
      });
      if (attempt.paymentRequest.invoiceId) await this.ledger.applyToInvoice(tx, attempt.paymentRequest.invoiceId, -amount);
      return r;
    });
    await this.audit.log('refund.create', 'Refund', refund.id, { after: { attemptId, amount, reason } });
    return refund;
  }

  /** Süresi dolmuş linkleri kapatır (worker tarafından çağrılır). */
  async expireOld() {
    const res = await this.prisma.raw.paymentRequest.updateMany({
      where: { status: 'PENDING', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
    if (res.count) this.logger.log(`${res.count} ödeme linkinin süresi doldu`);
  }

  /** Dönüş sayfasına gelmeyen ve webhook'u kaçan denemeleri sağlayıcıdan sorgular. */
  async pollStale() {
    const stale = await this.prisma.raw.paymentAttempt.findMany({
      where: { status: 'INITIATED', createdAt: { lt: new Date(Date.now() - 2 * 60_000), gt: new Date(Date.now() - 24 * 3600_000) } },
      take: 50,
    });
    for (const a of stale) {
      try {
        await this.verifyAndFinalize(a.id);
      } catch (e) {
        this.logger.warn(`Deneme sorgulanamadı ${a.id}: ${(e as Error).message}`);
      }
    }
  }
}

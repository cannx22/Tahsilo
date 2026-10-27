import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SyncJob } from '@prisma/client';
import { maskIban } from '../accounts/accounts.controller';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { D, parseDateOnly, toDateOnly } from '../common/money';
import { RequestContext } from '../common/request-context';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { BankAdapter, BankApiError } from './bank-adapter';
import { MockBankAdapter } from './mockbank.adapter';

const DAY = 86400000;
/** Aktif bağlantılar bu aralıkla otomatik senkronize edilir */
const SYNC_INTERVAL_MS = Number(process.env.BANK_SYNC_INTERVAL_MINUTES ?? 60) * 60_000;

@Injectable()
export class BankingService {
  private readonly logger = new Logger('Banking');
  private readonly adapters: Map<string, BankAdapter>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly recon: ReconciliationService,
    private readonly notifications: NotificationsService,
    mockbank: MockBankAdapter,
  ) {
    this.adapters = new Map([[mockbank.provider, mockbank]]);
  }

  providers() {
    return [...this.adapters.values()].map((a) => ({ key: a.provider, name: a.displayName, bankName: a.bankName }));
  }

  adapter(provider: string) {
    const a = this.adapters.get(provider);
    if (!a) throw new BadRequestException(`Desteklenmeyen banka sağlayıcısı: ${provider}`);
    return a;
  }

  private redirectUri() {
    return `${process.env.WEB_URL ?? 'http://localhost:3000'}/banks/connect/callback`;
  }

  // ───────────── İzin akışı ─────────────

  async start(provider: string, name: string) {
    const adapter = this.adapter(provider);
    const consentState = CryptoService.token(24);
    const conn = await this.prisma.db.bankConnection.create({
      data: { tenantId: RequestContext.tenantId(), provider, name, consentState, createdById: RequestContext.userId() },
    });
    await this.audit.log('bank.connection.start', 'BankConnection', conn.id, { after: { provider, name } });
    return { id: conn.id, authorizeUrl: adapter.authorizeUrl({ state: consentState, redirectUri: this.redirectUri() }) };
  }

  async reauthorize(id: string) {
    const conn = await this.prisma.db.bankConnection.findFirst({ where: { id } });
    if (!conn) throw new NotFoundException('Bağlantı bulunamadı');
    const consentState = CryptoService.token(24);
    await this.prisma.db.bankConnection.update({ where: { id }, data: { consentState } });
    await this.audit.log('bank.connection.reauthorize', 'BankConnection', id);
    return { id, authorizeUrl: this.adapter(conn.provider).authorizeUrl({ state: consentState, redirectUri: this.redirectUri() }) };
  }

  /** Bankadan dönüşte çağrılır: yetki kodunu belirtece çevirir, hesapları bağlar ve ilk senkronizasyonu kuyruğa alır. */
  async callback(state: string, code?: string, error?: string) {
    // Durum anahtarı bu firmaya ait değilse bulunamadı sayılır
    const conn = await this.prisma.db.bankConnection.findFirst({ where: { consentState: state } });
    if (!conn) throw new NotFoundException('İzin isteği bulunamadı veya süresi doldu');

    if (error || !code) {
      await this.prisma.db.bankConnection.update({
        where: { id: conn.id },
        data: { consentState: null, status: conn.tokenEnc ? conn.status : 'ERROR', lastError: 'Bankada izin verilmedi' },
      });
      await this.audit.log('bank.connection.denied', 'BankConnection', conn.id);
      throw new BadRequestException('Bankada izin verilmedi');
    }

    const adapter = this.adapter(conn.provider);
    const { accessToken, expiresAt } = await adapter.exchangeCode(code);
    const accounts = await adapter.listAccounts(accessToken);

    await this.prisma.db.$transaction(async (tx) => {
      await tx.bankConnection.update({
        where: { id: conn.id },
        data: { consentState: null, tokenEnc: this.crypto.encryptJson(accessToken), consentExpiresAt: expiresAt, status: 'ACTIVE', lastError: null },
      });
      for (const a of accounts) {
        // Daha önce bağlanmış veya bağlantısı kesilmiş aynı banka hesabı yeniden kullanılır
        const existing = await tx.bankAccount.findFirst({ where: { externalAccountId: a.externalId, bankName: adapter.bankName } });
        if (existing) {
          await tx.bankAccount.update({ where: { id: existing.id }, data: { connectionId: conn.id, isActive: true } });
        } else {
          await tx.bankAccount.create({
            data: {
              tenantId: conn.tenantId,
              connectionId: conn.id,
              externalAccountId: a.externalId,
              bankName: adapter.bankName,
              name: a.name,
              ibanMasked: maskIban(a.iban),
              currency: a.currency,
            },
          });
        }
      }
    });
    await this.audit.log('bank.connection.authorized', 'BankConnection', conn.id, {
      after: { accounts: accounts.map((a) => a.externalId), consentExpiresAt: expiresAt },
    });
    await this.enqueue(conn.id);
    return { id: conn.id, accounts: accounts.length };
  }

  async enqueue(connectionId: string) {
    const pending = await this.prisma.db.syncJob.findFirst({ where: { bankConnectionId: connectionId, status: { in: ['QUEUED', 'RUNNING'] } } });
    if (pending) return pending;
    return this.prisma.db.syncJob.create({
      data: { tenantId: RequestContext.tenantId(), bankConnectionId: connectionId, type: 'BANK_SYNC', createdById: RequestContext.current()?.userId },
    });
  }

  async disconnect(id: string) {
    const conn = await this.prisma.db.bankConnection.findFirst({ where: { id } });
    if (!conn) throw new NotFoundException('Bağlantı bulunamadı');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.bankConnection.update({ where: { id }, data: { status: 'DISCONNECTED', tokenEnc: null, consentState: null } });
      // Hesaplar ve geçmiş hareketler korunur; bağlantısız hesaplara ekstre aktarılabilir
      await tx.bankAccount.updateMany({ where: { connectionId: id }, data: { connectionId: null } });
    });
    await this.audit.log('bank.connection.disconnect', 'BankConnection', id);
    return { ok: true };
  }

  // ───────────── Senkronizasyon (worker, tenant bağlamında) ─────────────

  async sync(job: SyncJob) {
    if (!job.bankConnectionId) throw new BankApiError('İş bir banka bağlantısına ait değil', 'PERMANENT');
    const conn = await this.prisma.db.bankConnection.findFirstOrThrow({ where: { id: job.bankConnectionId }, include: { accounts: true } });
    if (conn.status !== 'ACTIVE' || !conn.tokenEnc) throw new BankApiError('Bağlantı aktif değil', 'PERMANENT');
    if (conn.consentExpiresAt && conn.consentExpiresAt < new Date()) {
      await this.markExpired(conn.id, conn.name);
      throw new BankApiError('Banka izninin süresi dolmuş; yeniden izin verilmeli', 'CONSENT_EXPIRED');
    }
    const adapter = this.adapter(conn.provider);
    const token = this.crypto.decryptJson<string>(conn.tokenEnc);
    const from = toDateOnly(new Date((conn.lastSyncAt?.getTime() ?? Date.now() - 90 * DAY) - 5 * DAY));

    try {
      let created = 0;
      let booked = 0;
      const newIds: string[] = [];
      for (const acc of conn.accounts.filter((a) => a.isActive && a.externalAccountId)) {
        const balance = await adapter.getBalance(token, acc.externalAccountId!);
        await this.prisma.db.bankAccount.update({
          where: { id: acc.id },
          data: { balance: balance.balance, balanceAsOf: balance.asOf, balanceSource: 'CONNECTED' },
        });

        const txns = await adapter.listTransactions(token, acc.externalAccountId!, from);
        const keyed = txns.map((t) => ({ t, key: `bankapi:${conn.provider}:${t.externalId}` }));
        const existing = await this.prisma.db.financialTransaction.findMany({
          where: { dedupeKey: { in: keyed.map((k) => k.key) } },
          select: { id: true, dedupeKey: true, status: true },
        });
        const byKey = new Map(existing.map((e) => [e.dedupeKey, e]));

        const fresh = keyed.filter((k) => !byKey.has(k.key));
        if (fresh.length) {
          const inserted = await this.prisma.db.financialTransaction.createManyAndReturn({
            data: fresh.map(({ t, key }) => ({
              tenantId: conn.tenantId,
              sourceType: 'BANK' as const,
              dataSource: 'CONNECTED' as const,
              sourceRef: t.externalId,
              dedupeKey: key,
              bankAccountId: acc.id,
              branchId: acc.branchId,
              date: parseDateOnly(t.date),
              description: t.description,
              counterpartyName: t.counterparty,
              amount: D(t.amount),
              currency: t.currency,
              status: t.status === 'PENDING' ? ('PENDING' as const) : ('POSTED' as const),
            })),
            skipDuplicates: true,
            select: { id: true },
          });
          created += inserted.length;
          newIds.push(...inserted.map((i) => i.id));
        }
        // Bekleyen hareket bankada kesinleşmişse güncellenir
        const nowBooked = keyed.filter((k) => k.t.status === 'BOOKED' && byKey.get(k.key)?.status === 'PENDING').map((k) => byKey.get(k.key)!.id);
        if (nowBooked.length) {
          const r = await this.prisma.db.financialTransaction.updateMany({ where: { id: { in: nowBooked } }, data: { status: 'POSTED' } });
          booked += r.count;
        }
      }
      await this.prisma.db.bankConnection.update({ where: { id: conn.id }, data: { lastSyncAt: new Date(), lastError: null } });
      if (newIds.length) await this.recon.suggestForTransactions(newIds);
      return { accounts: conn.accounts.length, created, booked, from };
    } catch (e) {
      const err = e instanceof BankApiError ? e : new BankApiError((e as Error).message, 'TRANSIENT');
      if (err.code === 'CONSENT_EXPIRED') await this.markExpired(conn.id, conn.name);
      else await this.prisma.db.bankConnection.update({ where: { id: conn.id }, data: { lastError: err.message.slice(0, 500), ...(err.code === 'PERMANENT' ? { status: 'ERROR' as const } : {}) } });
      throw err;
    }
  }

  private async markExpired(id: string, name: string) {
    await this.prisma.db.bankConnection.update({ where: { id }, data: { status: 'EXPIRED', lastError: 'İzin süresi doldu' } });
    await this.notifications.notifyRoles(['OWNER'], {
      type: 'bank.expired',
      title: `Banka izni sona erdi: ${name}`,
      body: 'Hareketlerin alınmaya devam etmesi için bankada yeniden izin verin.',
      link: '/banks',
      dedupeKey: `bank:${id}:expired`,
    });
  }

  /** Worker bakım döngüsü: süresi dolanları işaretler, yaklaşanları bildirir, otomatik senkronizasyonu kuyruğa alır. */
  async housekeeping() {
    const now = new Date();
    const conns = await this.prisma.raw.bankConnection.findMany({ where: { status: 'ACTIVE' } });
    for (const c of conns) {
      await RequestContext.runAsTenant(c.tenantId, async () => {
        if (c.consentExpiresAt && c.consentExpiresAt < now) return this.markExpired(c.id, c.name);
        if (c.consentExpiresAt && c.consentExpiresAt.getTime() - now.getTime() < 7 * DAY) {
          await this.notifications.notifyRoles(['OWNER'], {
            type: 'bank.expiring',
            title: `Banka izni yakında sona eriyor: ${c.name}`,
            body: `İzin ${toDateOnly(c.consentExpiresAt)} tarihinde sona erecek. Kesinti olmaması için yenileyin.`,
            link: '/banks',
            dedupeKey: `bank:${c.id}:expiring:${toDateOnly(c.consentExpiresAt)}`,
          });
        }
        if (!c.lastSyncAt || now.getTime() - c.lastSyncAt.getTime() > SYNC_INTERVAL_MS) await this.enqueue(c.id);
      });
    }
  }
}

import { BadRequestException, Injectable } from '@nestjs/common';
import { SyncJob, SyncJobType } from '@prisma/client';
import { CryptoService } from '../common/crypto.service';
import { D, parseDateOnly, toDateOnly } from '../common/money';
import { RequestContext } from '../common/request-context';
import { invoiceStatusFor } from '../ledger/ledger.service';
import { MockErpAdapter } from '../mock-providers/mockerp.adapter';
import { PrismaService } from '../prisma/prisma.service';
import { ErpAdapter, ErpError } from './erp-adapter';

export const FULL_SYNC: SyncJobType[] = ['PULL_COUNTERPARTIES', 'PULL_INVOICES', 'PUSH_PAYMENTS', 'PUSH_EXPENSES'];

@Injectable()
export class ErpService {
  private readonly adapters: Map<string, ErpAdapter>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    mockerp: MockErpAdapter,
  ) {
    this.adapters = new Map([[mockerp.provider, mockerp]]);
  }

  providers() {
    return [...this.adapters.values()].map((a) => ({ key: a.provider, name: a.displayName }));
  }

  adapter(provider: string) {
    const a = this.adapters.get(provider);
    if (!a) throw new BadRequestException(`Desteklenmeyen ERP: ${provider}`);
    return a;
  }

  async enqueue(connectionId: string, types: SyncJobType[]) {
    const conn = await this.prisma.db.erpConnection.findFirst({ where: { id: connectionId } });
    if (!conn) throw new BadRequestException('ERP bağlantısı bulunamadı');
    const jobs = [];
    // createdAt sırası işleme sırasıdır: cariler faturalardan önce çekilir.
    for (const type of types) {
      jobs.push(
        await this.prisma.db.syncJob.create({
          data: { tenantId: conn.tenantId, connectionId, type, createdById: RequestContext.current()?.userId },
        }),
      );
    }
    return jobs;
  }

  /** Worker tarafından tenant bağlamında çağrılır. Döndürülen nesne job.stats olarak saklanır. */
  async run(job: SyncJob): Promise<Record<string, unknown>> {
    if (!job.connectionId) throw new ErpError('İş bir ERP bağlantısına ait değil', true);
    const conn = await this.prisma.db.erpConnection.findFirstOrThrow({ where: { id: job.connectionId } });
    if (conn.status === 'DISCONNECTED') throw new ErpError('Bağlantı devre dışı', true);
    const adapter = this.adapter(conn.provider);
    const config = this.crypto.decryptJson(conn.configEnc);
    try {
      let stats: Record<string, unknown>;
      switch (job.type) {
        case 'PULL_COUNTERPARTIES':
          stats = await this.pullCounterparties(adapter, config);
          break;
        case 'PULL_INVOICES':
          stats = await this.pullInvoices(adapter, config);
          break;
        case 'PUSH_PAYMENTS':
          stats = await this.pushPayments(adapter, config);
          break;
        case 'PUSH_EXPENSES':
          stats = await this.pushExpenses(adapter, config);
          break;
        default:
          throw new ErpError(`ERP için geçersiz iş türü: ${job.type}`, true);
      }
      await this.prisma.db.erpConnection.update({
        where: { id: conn.id },
        data: { lastSyncAt: new Date(), lastError: null, status: 'ACTIVE' },
      });
      return stats;
    } catch (e) {
      const permanent = e instanceof ErpError && e.permanent;
      await this.prisma.db.erpConnection.update({
        where: { id: conn.id },
        data: { lastError: (e as Error).message.slice(0, 500), ...(permanent ? { status: 'ERROR' as const } : {}) },
      });
      throw e;
    }
  }

  private async pullCounterparties(adapter: ErpAdapter, config: Record<string, string>) {
    const remote = await adapter.listCounterparties(config);
    let created = 0;
    let updated = 0;
    for (const c of remote) {
      const existing = await this.prisma.db.counterparty.findFirst({ where: { OR: [{ erpRef: c.erpRef }, { code: c.code }] } });
      const data = { type: c.type, code: c.code, name: c.name, taxNumber: c.taxNumber, email: c.email, phone: c.phone, origin: 'ERP' as const, erpRef: c.erpRef };
      if (existing) {
        await this.prisma.db.counterparty.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await this.prisma.db.counterparty.create({ data: { tenantId: RequestContext.tenantId(), ...data } });
        created++;
      }
    }
    return { received: remote.length, created, updated };
  }

  private async pullInvoices(adapter: ErpAdapter, config: Record<string, string>) {
    const remote = await adapter.listInvoices(config);
    const cps = await this.prisma.db.counterparty.findMany({ where: { erpRef: { not: null } }, select: { id: true, erpRef: true } });
    const cpByRef = new Map(cps.map((c) => [c.erpRef!, c.id]));
    let created = 0;
    let updated = 0;
    const skipped: string[] = [];
    for (const r of remote) {
      const counterpartyId = cpByRef.get(r.counterpartyErpRef);
      if (!counterpartyId) {
        skipped.push(`${r.number}: cari bulunamadı (${r.counterpartyErpRef})`);
        continue;
      }
      const existing = await this.prisma.db.invoice.findFirst({ where: { type: r.type, number: r.number } });
      const total = D(r.total);
      // Tahsilo'da kaydedilmiş ama ERP'ye henüz yansımamış ödemeler kaybolmasın diye büyük olan esas alınır.
      const paid = D(r.paidAmount).gt(existing?.paidAmount ?? 0) ? D(r.paidAmount) : (existing?.paidAmount ?? D(0));
      const data = {
        counterpartyId,
        issueDate: parseDateOnly(r.issueDate),
        dueDate: parseDateOnly(r.dueDate),
        total,
        paidAmount: paid,
        currency: r.currency,
        status: r.cancelled ? ('CANCELLED' as const) : invoiceStatusFor(total, paid),
        origin: 'ERP' as const,
        erpRef: r.erpRef,
      };
      if (existing) {
        await this.prisma.db.invoice.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await this.prisma.db.invoice.create({ data: { tenantId: RequestContext.tenantId(), type: r.type, number: r.number, ...data } });
        created++;
      }
    }
    return { received: remote.length, created, updated, skipped };
  }

  private async pushPayments(adapter: ErpAdapter, config: Record<string, string>) {
    const pending = await this.prisma.db.paymentRequest.findMany({
      where: { status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] }, erpSyncedAt: null },
      include: {
        attempts: { where: { status: 'SUCCEEDED' } },
        invoice: { select: { erpRef: true } },
        counterparty: { select: { erpRef: true } },
      },
      take: 200,
    });
    return this.pushEach(pending, async (p) => {
      const attempt = p.attempts[0];
      if (!attempt) return;
      const { erpRef } = await adapter.pushPayment(config, {
        externalId: attempt.id,
        invoiceErpRef: p.invoice?.erpRef ?? undefined,
        counterpartyErpRef: p.counterparty?.erpRef ?? undefined,
        amount: attempt.amount.toFixed(2),
        currency: attempt.currency,
        date: toDateOnly(attempt.completedAt ?? attempt.createdAt),
        reference: attempt.providerPaymentId ?? attempt.id,
      });
      await this.prisma.db.paymentRequest.update({ where: { id: p.id }, data: { erpRef, erpSyncedAt: new Date() } });
    });
  }

  private async pushExpenses(adapter: ErpAdapter, config: Record<string, string>) {
    const pending = await this.prisma.db.expense.findMany({
      where: { status: 'APPROVED', erpSyncedAt: null },
      include: { category: true, costCenter: true },
      take: 200,
    });
    return this.pushEach(pending, async (e) => {
      const { erpRef } = await adapter.pushExpense(config, {
        externalId: e.id,
        date: toDateOnly(e.date),
        amount: e.amount.toFixed(2),
        currency: e.currency,
        accountCode: e.category.code ?? undefined,
        costCenterCode: e.costCenter?.code,
        description: e.description,
      });
      await this.prisma.db.expense.update({ where: { id: e.id }, data: { erpRef, erpSyncedAt: new Date() } });
    });
  }

  /** Her kaydı ayrı aktarır; kalıcı hata tüm işi durdurur, geçici hatalar toplanıp yeniden denemeye bırakılır. */
  private async pushEach<T extends { id: string }>(items: T[], fn: (item: T) => Promise<void>) {
    let pushed = 0;
    const failures: string[] = [];
    for (const item of items) {
      try {
        await fn(item);
        pushed++;
      } catch (e) {
        if (e instanceof ErpError && e.permanent) throw e;
        failures.push(`${item.id}: ${(e as Error).message}`);
      }
    }
    if (failures.length) {
      throw new ErpError(`${pushed} kayıt aktarıldı, ${failures.length} kayıt aktarılamadı: ${failures.slice(0, 3).join('; ')}`);
    }
    return { pending: items.length, pushed };
  }
}

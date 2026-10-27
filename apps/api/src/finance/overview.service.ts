import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { D, toDateOnly } from '../common/money';
import { Period } from '../common/period';
import { branchFilter, RequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { CashflowService } from './cashflow.service';

type CurrencyMap = Record<string, string>;

function add(map: CurrencyMap, currency: string, value: Prisma.Decimal | null | undefined) {
  if (!value) return;
  map[currency] = D(map[currency] ?? 0).plus(value).toFixed(2);
}

@Injectable()
export class OverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cashflow: CashflowService,
  ) {}

  async overview(period: Period) {
    const db = this.prisma.db;
    const today = new Date(new Date().toISOString().slice(0, 10));
    const in30 = new Date(today.getTime() + 30 * 86400000);
    const dateWhere = { gte: period.from, lte: period.to };

    const [accounts, flows, cardFlows, attempts, refunds, sales, purchases, planned, statements, recent, recon, lastImport, erp, cards] =
      await Promise.all([
        db.bankAccount.findMany({ where: { isActive: true }, include: { connection: { select: { status: true, lastSyncAt: true } } }, orderBy: { bankName: 'asc' } }),
        // Banka ve manuel hareketler: gerçek para girişi/çıkışı
        db.financialTransaction.groupBy({
          by: ['currency', 'sourceType'],
          where: { sourceType: { in: ['BANK', 'MANUAL'] }, cardAccountId: null, status: { not: 'REVERSED' }, date: dateWhere, amount: { gt: 0 } },
          _sum: { amount: true },
          _count: true,
        }),
        db.financialTransaction.groupBy({
          by: ['currency', 'sourceType', 'status'],
          where: {
            OR: [{ sourceType: { in: ['BANK', 'MANUAL'] }, cardAccountId: null }, { sourceType: 'CARD' }],
            status: { not: 'REVERSED' },
            date: dateWhere,
            amount: { lt: 0 },
          },
          _sum: { amount: true },
          _count: true,
        }),
        db.paymentAttempt.groupBy({
          by: ['currency', 'status'],
          where: { createdAt: { gte: period.from, lt: new Date(period.to.getTime() + 86400000) }, status: { not: 'INITIATED' } },
          _sum: { amount: true, commission: true },
          _count: true,
        }),
        db.refund.aggregate({
          where: { status: 'SUCCEEDED', createdAt: { gte: period.from, lt: new Date(period.to.getTime() + 86400000) } },
          _sum: { amount: true },
        }),
        db.invoice.findMany({ where: { type: 'SALES', status: { in: ['OPEN', 'PARTIAL'] } }, select: { total: true, paidAmount: true, currency: true, dueDate: true } }),
        db.invoice.findMany({ where: { type: 'PURCHASE', status: { in: ['OPEN', 'PARTIAL'] } }, select: { total: true, paidAmount: true, currency: true, dueDate: true } }),
        db.plannedPayment.findMany({ where: { status: 'PLANNED', dueDate: { lte: in30 }, invoiceId: null }, select: { amount: true, currency: true, dueDate: true } }),
        db.cardStatement.findMany({ where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] } }, select: { totalAmount: true, paidAmount: true, currency: true, dueDate: true } }),
        db.financialTransaction.findMany({
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          take: 8,
          include: {
            bankAccount: { select: { name: true } },
            cardAccount: { select: { name: true, last4: true } },
            category: { select: { name: true } },
          },
        }),
        db.financialTransaction.groupBy({ by: ['reconStatus'], where: { sourceType: 'BANK', status: { not: 'REVERSED' } }, _count: true }),
        db.importBatch.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true, fileName: true } }),
        db.erpConnection.findFirst({ orderBy: { lastSyncAt: 'desc' }, select: { name: true, lastSyncAt: true, status: true, lastError: true } }),
        db.cardAccount.findMany({ where: { isActive: true }, select: { id: true, currency: true } }),
      ]);

    // Banka bakiyeleri (yalnızca bankadan/dosyadan/manuel bilinen değerler; tahmin içermez)
    const balanceTotals: CurrencyMap = {};
    const staleLimit = new Date(today.getTime() - 3 * 86400000);
    const bankAccounts = accounts.map((a) => {
      if (a.balance) add(balanceTotals, a.currency, a.balance);
      return {
        id: a.id,
        name: a.name,
        bankName: a.bankName,
        currency: a.currency,
        balance: a.balance?.toFixed(2) ?? null,
        balanceAsOf: a.balanceAsOf,
        balanceSource: a.balanceSource,
        stale: !a.balanceAsOf || a.balanceAsOf < staleLimit,
      };
    });

    const inflow: CurrencyMap = {};
    for (const f of flows) add(inflow, f.currency, f._sum.amount);
    const outflow: CurrencyMap = {};
    const cardSpend = { posted: {} as CurrencyMap, pending: {} as CurrencyMap };
    for (const f of cardFlows) {
      const abs = f._sum.amount?.abs();
      if (f.sourceType === 'CARD') add(f.status === 'PENDING' ? cardSpend.pending : cardSpend.posted, f.currency, abs);
      else add(outflow, f.currency, abs);
    }

    const collections = { succeeded: {} as CurrencyMap, commission: {} as CurrencyMap, successCount: 0, failedCount: 0, refunded: refunds._sum.amount?.toFixed(2) ?? '0.00' };
    for (const a of attempts) {
      if (a.status === 'SUCCEEDED') {
        add(collections.succeeded, a.currency, a._sum.amount);
        add(collections.commission, a.currency, a._sum.commission);
        collections.successCount += a._count;
      } else collections.failedCount += a._count;
    }

    const receivables = { open: {} as CurrencyMap, overdue: {} as CurrencyMap, dueIn30: {} as CurrencyMap };
    for (const i of sales) {
      const r = i.total.minus(i.paidAmount);
      add(receivables.open, i.currency, r);
      if (i.dueDate < today) add(receivables.overdue, i.currency, r);
      else if (i.dueDate <= in30) add(receivables.dueIn30, i.currency, r);
    }
    const payables = { open: {} as CurrencyMap, overdue: {} as CurrencyMap, dueIn30: {} as CurrencyMap };
    for (const i of purchases) {
      const r = i.total.minus(i.paidAmount);
      add(payables.open, i.currency, r);
      if (i.dueDate < today) add(payables.overdue, i.currency, r);
      else if (i.dueDate <= in30) add(payables.dueIn30, i.currency, r);
    }
    for (const p of planned) {
      add(payables.dueIn30, p.currency, p.amount);
      if (p.dueDate < today) add(payables.overdue, p.currency, p.amount);
    }

    const cardDebt = { statements: {} as CurrencyMap, unbilled: {} as CurrencyMap, nextDueDate: null as string | null };
    for (const s of statements) {
      add(cardDebt.statements, s.currency, s.totalAmount.minus(s.paidAmount));
      const d = toDateOnly(s.dueDate);
      if (!cardDebt.nextDueDate || d < cardDebt.nextDueDate) cardDebt.nextDueDate = d;
    }
    const unbilled = await db.financialTransaction.groupBy({
      by: ['currency'],
      where: { cardAccountId: { in: cards.map((c) => c.id) }, statementId: null, status: { not: 'REVERSED' }, amount: { lt: 0 } },
      _sum: { amount: true },
    });
    for (const u of unbilled) add(cardDebt.unbilled, u.currency, u._sum.amount?.abs());

    const forecast = await this.cashflow.forecast(8);

    return {
      period: { from: toDateOnly(period.from), to: toDateOnly(period.to) },
      bankAccounts,
      balanceTotals,
      flows: { inflow, outflow, note: 'Banka ve manuel hareketlerden; sanal POS kayıtları banka girişiyle çift sayılmasın diye hariçtir.' },
      cardSpend,
      collections,
      receivables,
      payables,
      cardDebt,
      forecast: {
        label: forecast.label,
        currency: forecast.currency,
        startBalance: forecast.startBalance,
        lowestProjected: forecast.lowestProjected,
        buckets: forecast.buckets.map(({ items: _items, ...b }) => b),
      },
      recent,
      reconciliation: Object.fromEntries(recon.map((r) => [r.reconStatus, r._count])),
      freshness: { lastImport, erp },
      trend: await this.trend(),
    };
  }

  /** Son 6 ayın aylık giriş/çıkışı (banka + manuel + kart). */
  private async trend() {
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
    const rows = await this.prisma.db.$queryRaw<{ month: string; currency: string; inflow: Prisma.Decimal; outflow: Prisma.Decimal }[]>`
      SELECT to_char(date, 'YYYY-MM') AS month, currency,
             COALESCE(SUM(amount) FILTER (WHERE amount > 0 AND "sourceType" <> 'CARD' AND "sourceType" <> 'POS'), 0) AS inflow,
             COALESCE(-SUM(amount) FILTER (WHERE amount < 0 AND "sourceType" <> 'POS'), 0) AS outflow
      FROM "FinancialTransaction"
      WHERE "tenantId" = ${RequestContext.tenantId()} AND date >= ${from} AND status <> 'REVERSED' ${branchFilter()}
      GROUP BY 1, 2 ORDER BY 1`;
    // Not: $queryRaw tenant uzantısından geçmez; tenant filtresi yukarıda elle eklenmiştir.
    return rows.map((r) => ({ month: r.month, currency: r.currency, inflow: D(r.inflow).toFixed(2), outflow: D(r.outflow).toFixed(2) }));
  }
}

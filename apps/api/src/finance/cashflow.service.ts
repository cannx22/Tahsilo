import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { D, toDateOnly } from '../common/money';
import { nextDueDate } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';

interface FlowItem {
  date: string;
  label: string;
  kind: 'RECEIVABLE' | 'PAYABLE' | 'PLANNED' | 'CARD_STATEMENT' | 'CARD_UNBILLED';
  amount: string; // işaretli
  overdue: boolean;
}

const DAY = 86400000;

function startOfWeek(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // Pazartesi = 0
  return new Date(x.getTime() - dow * DAY);
}

@Injectable()
export class CashflowService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Haftalık nakit akışı tahmini. Sonuç kesin bakiye değildir; başlangıç bakiyesi, varsayımlar ve
   * veri güncelliği yanıtta açıkça belirtilir. Yalnızca tek para birimi için hesaplanır.
   */
  async forecast(weeks = 12, currency = 'TRY') {
    const db = this.prisma.db;
    const today = new Date(new Date().toISOString().slice(0, 10));
    const horizon = new Date(startOfWeek(today).getTime() + weeks * 7 * DAY);

    const accounts = await db.bankAccount.findMany({ where: { isActive: true, currency } });
    const withBalance = accounts.filter((a) => a.balance !== null);
    const startBalance = withBalance.reduce((s, a) => s.plus(a.balance!), D(0));
    const oldestAsOf = withBalance.reduce<Date | null>((m, a) => (!m || (a.balanceAsOf && a.balanceAsOf < m) ? a.balanceAsOf : m), null);

    const [sales, purchases, planned, statements, cards] = await Promise.all([
      db.invoice.findMany({ where: { type: 'SALES', status: { in: ['OPEN', 'PARTIAL'] }, currency, dueDate: { lt: horizon } }, include: { counterparty: { select: { name: true } } } }),
      db.invoice.findMany({ where: { type: 'PURCHASE', status: { in: ['OPEN', 'PARTIAL'] }, currency, dueDate: { lt: horizon } }, include: { counterparty: { select: { name: true } } } }),
      db.plannedPayment.findMany({ where: { status: 'PLANNED', currency, invoiceId: null } }),
      db.cardStatement.findMany({ where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, currency, dueDate: { lt: horizon } }, include: { cardAccount: { select: { name: true, last4: true } } } }),
      db.cardAccount.findMany({ where: { isActive: true, currency } }),
    ]);

    const items: FlowItem[] = [];
    const push = (date: Date, label: string, kind: FlowItem['kind'], amount: Prisma.Decimal) => {
      const overdue = date < today;
      items.push({ date: toDateOnly(overdue ? today : date), label, kind, amount: amount.toFixed(2), overdue });
    };

    for (const i of sales) push(i.dueDate, `${i.counterparty.name} • ${i.number}`, 'RECEIVABLE', i.total.minus(i.paidAmount));
    for (const i of purchases) push(i.dueDate, `${i.counterparty.name} • ${i.number}`, 'PAYABLE', i.total.minus(i.paidAmount).neg());
    for (const s of statements) push(s.dueDate, `${s.cardAccount.name} •••• ${s.cardAccount.last4} ekstresi`, 'CARD_STATEMENT', s.totalAmount.minus(s.paidAmount).neg());

    // Tekrarlı planlı ödemeler ufuk sonuna kadar çoğaltılır
    for (const p of planned) {
      let due: Date | null = p.dueDate;
      let guard = 0;
      while (due && due < horizon && guard++ < 60) {
        push(due, p.title, 'PLANNED', p.amount.neg());
        due = nextDueDate(due, p.recurrence);
      }
    }

    // Ekstreye girmemiş kart harcamaları bir sonraki son ödeme gününde ödenecek varsayılır
    const unbilled = await db.financialTransaction.groupBy({
      by: ['cardAccountId'],
      where: { cardAccountId: { in: cards.map((c) => c.id) }, statementId: null, status: { not: 'REVERSED' } },
      _sum: { amount: true },
    });
    for (const u of unbilled) {
      const card = cards.find((c) => c.id === u.cardAccountId)!;
      const sum = u._sum.amount ?? D(0);
      if (sum.gte(0)) continue;
      const dueDay = card.dueDay ?? 15;
      let due = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), dueDay));
      if (due <= today) due = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, dueDay));
      if (card.statementDay && card.statementDay > dueDay) due = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, dueDay));
      push(due, `${card.name} •••• ${card.last4} ekstreye girmemiş harcamalar`, 'CARD_UNBILLED', sum);
    }

    const weekStart = startOfWeek(today);
    let running = startBalance;
    const buckets = Array.from({ length: weeks }, (_, w) => {
      const from = new Date(weekStart.getTime() + w * 7 * DAY);
      const to = new Date(from.getTime() + 7 * DAY);
      const inWeek = items.filter((i) => {
        const d = new Date(i.date);
        return d >= from && d < to;
      });
      const inflow = inWeek.filter((i) => Number(i.amount) > 0).reduce((s, i) => s.plus(i.amount), D(0));
      const outflow = inWeek.filter((i) => Number(i.amount) < 0).reduce((s, i) => s.plus(i.amount), D(0));
      running = running.plus(inflow).plus(outflow);
      return {
        weekStart: toDateOnly(from),
        inflow: inflow.toFixed(2),
        outflow: outflow.abs().toFixed(2),
        net: inflow.plus(outflow).toFixed(2),
        projectedBalance: running.toFixed(2),
        items: inWeek.sort((a, b) => a.date.localeCompare(b.date)),
      };
    });

    const otherCurrencies = await db.bankAccount.groupBy({ by: ['currency'], where: { isActive: true, currency: { not: currency } }, _sum: { balance: true } });

    return {
      label: 'TAHMİN',
      currency,
      weeks,
      startBalance: startBalance.toFixed(2),
      startBalanceAsOf: oldestAsOf,
      accountsIncluded: withBalance.length,
      accountsWithoutBalance: accounts.filter((a) => a.balance === null).map((a) => a.name),
      lowestProjected: buckets.reduce((m, b) => (D(b.projectedBalance).lt(m) ? D(b.projectedBalance) : m), startBalance).toFixed(2),
      buckets,
      otherCurrencies: otherCurrencies.map((o) => ({ currency: o.currency, balance: o._sum.balance?.toFixed(2) ?? null })),
      assumptions: [
        'Başlangıç bakiyesi, bakiyesi bilinen banka hesaplarının son bilinen bakiyelerinin toplamıdır.',
        'Açık satış faturalarının vade tarihinde eksiksiz tahsil edileceği varsayılır; vadesi geçmişler bu haftaya yazılır.',
        'Alış faturaları, planlı ödemeler ve kart ekstreleri vade tarihinde ödenir varsayılır.',
        'Ekstreye girmemiş kart harcamaları kartın bir sonraki son ödeme gününde ödenir varsayılır.',
        `Yalnızca ${currency} cinsinden kalemler dahildir; döviz çevrimi yapılmaz.`,
      ],
    };
  }
}

import { BadRequestException, Injectable } from '@nestjs/common';
import { FinancialTransaction, MatchType, Prisma } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { D } from '../common/money';
import { RequestContext } from '../common/request-context';
import { normalizeText } from '../imports/parse';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';

interface Suggestion {
  type: MatchType;
  invoiceId?: string;
  attemptId?: string;
  plannedPaymentId?: string;
  statementId?: string;
  difference: Prisma.Decimal;
  score: number;
  reason: string;
}

const DAY = 86400000;
// Banka aktarımlarındaki kuruş yuvarlama farkları için tolerans; fark eşleşmede ayrıca saklanır.
const ROUNDING_TOLERANCE = 0.05;
const near = (a: Prisma.Decimal, b: Prisma.Decimal) => a.minus(b).abs().lte(ROUNDING_TOLERANCE);

function nameScore(description: string, name: string) {
  const text = normalizeText(description);
  const tokens = normalizeText(name)
    .split(' ')
    .filter((t) => t.length >= 4 && !['ltd', 'sti', 'san', 'tic', 'a.s.', 'anonim', 'sirketi'].includes(t));
  if (!tokens.length) return 0;
  const hits = tokens.filter((t) => text.includes(t)).length;
  return Math.round((hits / tokens.length) * 30);
}

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  /** Verilen hareketler için eşleşme önerileri üretir. Öneriler onaylanana kadar finansal etki yaratmaz. */
  async suggestForTransactions(ids: string[]) {
    const txns = await this.prisma.db.financialTransaction.findMany({
      where: { id: { in: ids }, sourceType: 'BANK', reconStatus: 'UNMATCHED', status: { not: 'REVERSED' } },
    });
    let created = 0;
    for (const t of txns) {
      const suggestions = Number(t.amount) > 0 ? await this.forInflow(t) : await this.forOutflow(t);
      const best = suggestions.sort((a, b) => b.score - a.score).slice(0, 3);
      for (const s of best) {
        const exists = await this.prisma.db.reconciliationMatch.findFirst({
          where: {
            transactionId: t.id,
            type: s.type,
            invoiceId: s.invoiceId ?? null,
            attemptId: s.attemptId ?? null,
            plannedPaymentId: s.plannedPaymentId ?? null,
            statementId: s.statementId ?? null,
          },
        });
        if (exists) continue;
        await this.prisma.db.reconciliationMatch.create({
          data: { tenantId: t.tenantId, transactionId: t.id, status: 'SUGGESTED', ...s },
        });
        created++;
      }
      if (best.length) await this.prisma.db.financialTransaction.update({ where: { id: t.id }, data: { reconStatus: 'SUGGESTED' } });
    }
    return { scanned: txns.length, suggestions: created };
  }

  async runAll() {
    const since = new Date(Date.now() - 120 * DAY);
    const ids = await this.prisma.db.financialTransaction.findMany({
      where: { sourceType: 'BANK', reconStatus: 'UNMATCHED', date: { gte: since } },
      select: { id: true },
      take: 2000,
    });
    return this.suggestForTransactions(ids.map((i) => i.id));
  }

  private async forInflow(t: FinancialTransaction): Promise<Suggestion[]> {
    const out: Suggestion[] = [];
    const amount = t.amount;

    // 1) Sanal POS gün sonu aktarımı: tekil veya aynı günün toplu net tutarı
    const attempts = await this.prisma.db.paymentAttempt.findMany({
      where: {
        status: 'SUCCEEDED',
        currency: t.currency,
        completedAt: { gte: new Date(t.date.getTime() - 7 * DAY), lt: new Date(t.date.getTime() + DAY) },
        matches: { none: { type: 'TXN_POS', status: { in: ['SUGGESTED', 'CONFIRMED'] } } },
      },
    });
    for (const a of attempts) {
      const net = a.amount.minus(a.commission);
      if (near(net, amount)) {
        out.push({ type: 'TXN_POS', attemptId: a.id, difference: amount.minus(net), score: 90, reason: 'Net POS tutarı (komisyon düşülmüş) banka girişine eşit' });
      } else if (a.amount.eq(amount)) {
        out.push({ type: 'TXN_POS', attemptId: a.id, difference: D(0), score: 80, reason: 'Brüt POS tutarı banka girişine eşit' });
      }
    }
    if (!out.length && attempts.length > 1) {
      const byDay = new Map<string, typeof attempts>();
      for (const a of attempts) {
        const k = a.completedAt!.toISOString().slice(0, 10);
        byDay.set(k, [...(byDay.get(k) ?? []), a]);
      }
      for (const [dayKey, group] of byDay) {
        const net = group.reduce((s, a) => s.plus(a.amount.minus(a.commission)), D(0));
        if (group.length > 1 && near(net, amount)) {
          // Toplu aktarımdaki fark yalnızca ilk eşleşmeye yazılır; onaylandığında toplam fark doğru görünür.
          group.forEach((a, i) =>
            out.push({ type: 'TXN_POS', attemptId: a.id, difference: i === 0 ? amount.minus(net) : D(0), score: 85, reason: `${dayKey} günü ${group.length} POS işleminin toplu aktarımı` }),
          );
        }
      }
    }

    // 2) Açık satış faturası (havale/EFT ile tahsilat)
    const invoices = await this.prisma.db.invoice.findMany({
      where: { type: 'SALES', status: { in: ['OPEN', 'PARTIAL'] }, currency: t.currency },
      include: { counterparty: { select: { name: true } } },
    });
    for (const inv of invoices) {
      const remaining = inv.total.minus(inv.paidAmount);
      const desc = `${t.description} ${t.counterpartyName ?? ''}`;
      const numberHit = normalizeText(desc).includes(normalizeText(inv.number)) ? 25 : 0;
      const nameHit = nameScore(desc, inv.counterparty.name);
      // Tutar farklıysa yalnızca kısmi ödeme mümkünse (giriş < kalan) ve cari/fatura no açıklamada geçiyorsa önerilir.
      let score = 0;
      if (remaining.eq(amount)) score = 50 + numberHit + nameHit;
      else if (amount.lt(remaining) && (numberHit || nameHit >= 20)) score = 25 + numberHit + nameHit;
      if (score >= 50) {
        out.push({
          type: 'TXN_INVOICE',
          invoiceId: inv.id,
          difference: amount.minus(remaining),
          score: Math.min(score, 99),
          reason: [remaining.eq(amount) ? 'Tutar fatura bakiyesine eşit' : 'Kısmi ödeme olabilir', numberHit ? 'açıklamada fatura no var' : '', nameHit ? 'açıklamada cari adı var' : '']
            .filter(Boolean)
            .join(', '),
        });
      }
    }
    return out;
  }

  private async forOutflow(t: FinancialTransaction): Promise<Suggestion[]> {
    const out: Suggestion[] = [];
    const amount = t.amount.abs();
    const desc = `${t.description} ${t.counterpartyName ?? ''}`;

    const planned = await this.prisma.db.plannedPayment.findMany({
      where: {
        status: 'PLANNED',
        currency: t.currency,
        dueDate: { gte: new Date(t.date.getTime() - 10 * DAY), lte: new Date(t.date.getTime() + 10 * DAY) },
      },
      include: { counterparty: { select: { name: true } } },
    });
    for (const p of planned) {
      if (!p.amount.eq(amount)) continue;
      const closeness = 20 - Math.min(20, Math.round(Math.abs(p.dueDate.getTime() - t.date.getTime()) / DAY) * 2);
      const nameHit = Math.max(nameScore(desc, p.title), p.counterparty ? nameScore(desc, p.counterparty.name) : 0);
      out.push({ type: 'TXN_PLANNED', plannedPaymentId: p.id, difference: D(0), score: 55 + closeness + nameHit, reason: 'Tutar planlı ödemeye eşit, vade yakın' });
    }

    const invoices = await this.prisma.db.invoice.findMany({
      where: { type: 'PURCHASE', status: { in: ['OPEN', 'PARTIAL'] }, currency: t.currency },
      include: { counterparty: { select: { name: true } } },
    });
    for (const inv of invoices) {
      const remaining = inv.total.minus(inv.paidAmount);
      if (!remaining.eq(amount)) continue;
      const numberHit = normalizeText(desc).includes(normalizeText(inv.number)) ? 25 : 0;
      out.push({
        type: 'TXN_INVOICE',
        invoiceId: inv.id,
        difference: D(0),
        score: Math.min(99, 50 + numberHit + nameScore(desc, inv.counterparty.name)),
        reason: 'Tutar alış faturası bakiyesine eşit',
      });
    }

    const statements = await this.prisma.db.cardStatement.findMany({
      where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, currency: t.currency },
      include: { cardAccount: { select: { last4: true, name: true } } },
    });
    const looksLikeCard = /kart|kredi|card|ekstre/.test(normalizeText(desc));
    for (const s of statements) {
      const remaining = s.totalAmount.minus(s.paidAmount);
      const minimum = s.minimumPayment;
      const last4Hit = desc.includes(s.cardAccount.last4) ? 20 : 0;
      if (remaining.eq(amount) || minimum?.eq(amount)) {
        out.push({
          type: 'TXN_STATEMENT',
          statementId: s.id,
          difference: amount.minus(remaining),
          score: 50 + (looksLikeCard ? 20 : 0) + last4Hit,
          reason: remaining.eq(amount) ? 'Tutar ekstre borcuna eşit' : 'Tutar asgari ödeme tutarına eşit',
        });
      }
    }
    return out;
  }

  /** Öneriyi onaylar ve finansal etkisini uygular (fatura/ödeme/ekstre kapanışı). */
  async confirm(matchId: string) {
    const userId = RequestContext.userId();
    const result = await this.prisma.db.$transaction(async (tx) => {
      const m = await tx.reconciliationMatch.findFirst({ where: { id: matchId }, include: { transaction: true } });
      if (!m) throw new BadRequestException('Eşleşme bulunamadı');
      if (m.status !== 'SUGGESTED') throw new BadRequestException('Bu eşleşme zaten karara bağlanmış');
      const t = m.transaction!;
      const amount = t.amount.abs();

      if (m.type === 'TXN_INVOICE' && m.invoiceId) {
        const inv = await tx.invoice.findFirstOrThrow({ where: { id: m.invoiceId } });
        const remaining = inv.total.minus(inv.paidAmount);
        await this.ledger.applyToInvoice(tx, inv.id, amount.gt(remaining) ? remaining : amount);
      } else if (m.type === 'TXN_PLANNED' && m.plannedPaymentId) {
        await this.ledger.markPlannedPaid(tx, m.plannedPaymentId, t.date);
      } else if (m.type === 'TXN_STATEMENT' && m.statementId) {
        await this.ledger.applyToStatement(tx, m.statementId, amount);
      }

      const confirmed = await tx.reconciliationMatch.update({
        where: { id: m.id },
        data: { status: 'CONFIRMED', decidedById: userId, decidedAt: new Date() },
      });
      // Toplu POS aktarımında aynı hareketin birden fazla POS önerisi birlikte doğrudur; diğer türler reddedilir.
      await tx.reconciliationMatch.updateMany({
        where: {
          transactionId: t.id,
          status: 'SUGGESTED',
          id: { not: m.id },
          ...(m.type === 'TXN_POS' ? { type: { not: 'TXN_POS' } } : {}),
        },
        data: { status: 'REJECTED', decidedById: userId, decidedAt: new Date() },
      });
      if (m.type === 'TXN_POS') {
        await tx.reconciliationMatch.updateMany({
          where: { transactionId: t.id, status: 'SUGGESTED', type: 'TXN_POS' },
          data: { status: 'CONFIRMED', decidedById: userId, decidedAt: new Date() },
        });
      }
      await tx.financialTransaction.update({ where: { id: t.id }, data: { reconStatus: 'MATCHED' } });
      return confirmed;
    });
    await this.audit.log('recon.confirm', 'ReconciliationMatch', matchId, { after: result });
    return result;
  }

  async reject(matchId: string) {
    const userId = RequestContext.userId();
    const m = await this.prisma.db.reconciliationMatch.findFirst({ where: { id: matchId } });
    if (!m) throw new BadRequestException('Eşleşme bulunamadı');
    if (m.status !== 'SUGGESTED') throw new BadRequestException('Bu eşleşme zaten karara bağlanmış');
    await this.prisma.db.reconciliationMatch.update({
      where: { id: matchId },
      data: { status: 'REJECTED', decidedById: userId, decidedAt: new Date() },
    });
    if (m.transactionId) {
      const left = await this.prisma.db.reconciliationMatch.count({ where: { transactionId: m.transactionId, status: 'SUGGESTED' } });
      if (!left) await this.prisma.db.financialTransaction.update({ where: { id: m.transactionId }, data: { reconStatus: 'UNMATCHED' } });
    }
    await this.audit.log('recon.reject', 'ReconciliationMatch', matchId);
    return { ok: true };
  }

  async setIgnored(transactionId: string, ignored: boolean, note?: string) {
    const t = await this.prisma.db.financialTransaction.findFirstOrThrow({ where: { id: transactionId } });
    if (t.reconStatus === 'MATCHED') throw new BadRequestException('Eşleşmiş hareket kapsam dışı bırakılamaz');
    const after = await this.prisma.db.financialTransaction.update({
      where: { id: transactionId },
      data: { reconStatus: ignored ? 'IGNORED' : 'UNMATCHED', ...(note ? { note } : {}) },
    });
    await this.audit.log(ignored ? 'recon.ignore' : 'recon.unignore', 'FinancialTransaction', transactionId, {
      before: { reconStatus: t.reconStatus },
      after: { reconStatus: after.reconStatus, note },
    });
    return after;
  }
}

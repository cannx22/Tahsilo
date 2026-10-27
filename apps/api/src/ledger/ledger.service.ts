import { BadRequestException, Injectable } from '@nestjs/common';
import { InvoiceStatus, Prisma, Recurrence } from '@prisma/client';
import { D } from '../common/money';
import { ScopedTx } from '../prisma/prisma.service';

export function invoiceStatusFor(total: Prisma.Decimal, paid: Prisma.Decimal): InvoiceStatus {
  if (paid.gte(total)) return 'PAID';
  if (paid.gt(0)) return 'PARTIAL';
  return 'OPEN';
}

export function isOverdue(inv: { dueDate: Date; status: InvoiceStatus }) {
  const today = new Date(new Date().toISOString().slice(0, 10));
  return (inv.status === 'OPEN' || inv.status === 'PARTIAL') && inv.dueDate < today;
}

export function nextDueDate(date: Date, recurrence: Recurrence): Date | null {
  const months = { NONE: 0, MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 }[recurrence];
  if (!months) return null;
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

@Injectable()
export class LedgerService {
  /** Faturaya ödeme/tahsilat uygular (negatif tutar iade/geri alma içindir). */
  async applyToInvoice(tx: ScopedTx, invoiceId: string, amount: Prisma.Decimal.Value) {
    const inv = await tx.invoice.findFirst({ where: { id: invoiceId } });
    if (!inv) throw new BadRequestException('Fatura bulunamadı');
    if (inv.status === 'CANCELLED') throw new BadRequestException('İptal edilmiş faturaya ödeme uygulanamaz');
    const paid = inv.paidAmount.plus(amount);
    if (paid.lt(0)) throw new BadRequestException('Ödenen tutar sıfırın altına düşemez');
    if (paid.gt(inv.total)) throw new BadRequestException(`Fatura bakiyesi aşılıyor (kalan: ${inv.total.minus(inv.paidAmount).toFixed(2)})`);
    return tx.invoice.update({
      where: { id: invoiceId },
      data: { paidAmount: paid, status: invoiceStatusFor(inv.total, paid) },
    });
  }

  /** Planlı ödemeyi ödendi işaretler; tekrarlıysa bir sonraki dönemi oluşturur. */
  async markPlannedPaid(tx: ScopedTx, plannedId: string, paidAt = new Date()) {
    const p = await tx.plannedPayment.findFirst({ where: { id: plannedId } });
    if (!p) throw new BadRequestException('Planlı ödeme bulunamadı');
    if (p.status !== 'PLANNED') throw new BadRequestException('Bu ödeme zaten kapatılmış');
    const updated = await tx.plannedPayment.update({ where: { id: p.id }, data: { status: 'PAID', paidAt } });
    const next = nextDueDate(p.dueDate, p.recurrence);
    let nextPayment = null;
    if (next) {
      nextPayment = await tx.plannedPayment.create({
        data: {
          tenantId: p.tenantId,
          title: p.title,
          category: p.category,
          counterpartyId: p.counterpartyId,
          amount: p.amount,
          currency: p.currency,
          dueDate: next,
          recurrence: p.recurrence,
          note: p.note,
        },
      });
    }
    return { updated, nextPayment };
  }

  /** Kart ekstresine ödeme uygular. */
  async applyToStatement(tx: ScopedTx, statementId: string, amount: Prisma.Decimal.Value) {
    const st = await tx.cardStatement.findFirst({ where: { id: statementId } });
    if (!st) throw new BadRequestException('Ekstre bulunamadı');
    const paid = st.paidAmount.plus(amount);
    const status = paid.gte(st.totalAmount) ? 'PAID' : paid.gt(0) ? 'PARTIALLY_PAID' : 'ISSUED';
    return tx.cardStatement.update({ where: { id: st.id }, data: { paidAmount: D(paid), status } });
  }
}

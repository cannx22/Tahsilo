import { Injectable } from '@nestjs/common';
import { BudgetsService } from '../budgets/budgets.service';
import { toDateOnly } from '../common/money';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const DAY = 86400000;

/** Tenant bağlamında çalışır: yaklaşan/geciken ödemeler ve bütçe eşikleri için bildirim üretir. */
@Injectable()
export class RemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly budgets: BudgetsService,
  ) {}

  async run() {
    const db = this.prisma.db;
    const today = new Date(new Date().toISOString().slice(0, 10));
    const soon = new Date(today.getTime() + 3 * DAY);
    const [planned, invoices, statements] = await Promise.all([
      db.plannedPayment.findMany({ where: { status: 'PLANNED', dueDate: { lte: soon }, invoiceId: null } }),
      db.invoice.findMany({ where: { type: 'PURCHASE', status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lte: soon } }, include: { counterparty: { select: { name: true } } } }),
      db.cardStatement.findMany({ where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, dueDate: { lte: soon } }, include: { cardAccount: { select: { name: true, last4: true } } } }),
    ]);
    const items = [
      ...planned.map((p) => ({ key: `planned:${p.id}`, title: p.title, due: p.dueDate, amount: p.amount.toFixed(2), currency: p.currency })),
      ...invoices.map((i) => ({ key: `invoice:${i.id}`, title: `${i.counterparty.name} • ${i.number}`, due: i.dueDate, amount: i.total.minus(i.paidAmount).toFixed(2), currency: i.currency })),
      ...statements.map((s) => ({ key: `statement:${s.id}`, title: `${s.cardAccount.name} •••• ${s.cardAccount.last4} ekstresi`, due: s.dueDate, amount: s.totalAmount.minus(s.paidAmount).toFixed(2), currency: s.currency })),
    ];
    for (const it of items) {
      const overdue = it.due < today;
      await this.notifications.notifyRoles(['OWNER', 'ACCOUNTANT'], {
        type: overdue ? 'payable.overdue' : 'payable.due',
        title: overdue ? `Vadesi geçti: ${it.title}` : `Vadesi yaklaşıyor: ${it.title}`,
        body: `${it.amount} ${it.currency} • vade ${toDateOnly(it.due)}`,
        link: '/payments',
        // Her kalem için "yaklaşıyor" ve "geçti" bildirimi birer kez gönderilir
        dedupeKey: `${it.key}:${overdue ? 'overdue' : 'due'}:${toDateOnly(it.due)}`,
      });
    }
    await this.budgets.checkAlerts();
  }
}

import { BadRequestException, Injectable } from '@nestjs/common';
import { Budget, Prisma } from '@prisma/client';
import { D } from '../common/money';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

export type BudgetState = 'OK' | 'WARNING' | 'EXCEEDED';

export function monthBounds(period: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new BadRequestException('Dönem YYYY-AA biçiminde olmalı');
  const [y, m] = period.split('-').map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 0)) };
}

export function currentPeriod(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Gerçekleşen tutar:
   * - yalnız kategori: o kategoriye atanmış para çıkışları + hareketsiz (nakit) giderler
   * - yalnız departman: departmanın reddedilmemiş giderleri
   * - kategori + departman: ikisini birden taşıyan reddedilmemiş giderler
   * Sanal POS kayıtları ve iptal edilmiş hareketler sayılmaz; yalnızca bütçenin para birimi toplanır.
   */
  async actual(b: Pick<Budget, 'period' | 'categoryId' | 'departmentId' | 'currency'>): Promise<Prisma.Decimal> {
    const { from, to } = monthBounds(b.period);
    const db = this.prisma.db;
    const expenseWhere: Prisma.ExpenseWhereInput = { date: { gte: from, lte: to }, currency: b.currency, status: { not: 'REJECTED' } };

    if (b.categoryId && !b.departmentId) {
      const [txns, cash] = await Promise.all([
        db.financialTransaction.aggregate({
          where: { categoryId: b.categoryId, amount: { lt: 0 }, currency: b.currency, status: { not: 'REVERSED' }, sourceType: { not: 'POS' }, date: { gte: from, lte: to } },
          _sum: { amount: true },
        }),
        db.expense.aggregate({ where: { ...expenseWhere, categoryId: b.categoryId, transactionId: null }, _sum: { amount: true } }),
      ]);
      return (txns._sum.amount?.abs() ?? D(0)).plus(cash._sum.amount ?? 0);
    }
    const res = await db.expense.aggregate({
      where: { ...expenseWhere, ...(b.categoryId ? { categoryId: b.categoryId } : {}), ...(b.departmentId ? { departmentId: b.departmentId } : {}) },
      _sum: { amount: true },
    });
    return res._sum.amount ?? D(0);
  }

  async withActuals(budgets: (Budget & { category?: { name: string } | null; department?: { name: string } | null })[]) {
    return Promise.all(
      budgets.map(async (b) => {
        const actual = await this.actual(b);
        const ratio = b.amount.isZero() ? 0 : Number(actual.div(b.amount).toFixed(4));
        const state: BudgetState = ratio >= 1 ? 'EXCEEDED' : ratio >= Number(b.alertThreshold) ? 'WARNING' : 'OK';
        return { ...b, actual: actual.toFixed(2), remaining: b.amount.minus(actual).toFixed(2), ratio, state };
      }),
    );
  }

  /** Eşik/limit aşımlarını yönetici ve muhasebeye bildirir (her seviye için tek bildirim). */
  async checkAlerts(period = currentPeriod()) {
    const budgets = await this.prisma.db.budget.findMany({ where: { period }, include: { category: true, department: true } });
    let sent = 0;
    for (const b of await this.withActuals(budgets)) {
      if (b.state === 'OK') continue;
      const label = [b.category?.name, b.department?.name].filter(Boolean).join(' • ') || 'Genel';
      const pct = Math.round(b.ratio * 100);
      sent += await this.notifications.notifyRoles(['OWNER', 'ACCOUNTANT'], {
        type: b.state === 'EXCEEDED' ? 'budget.exceeded' : 'budget.warning',
        title: b.state === 'EXCEEDED' ? `Bütçe aşıldı: ${label}` : `Bütçe eşiğine yaklaşıldı: ${label}`,
        body: `${b.period} döneminde bütçenin %${pct}'i kullanıldı (${b.actual} / ${b.amount.toFixed(2)} ${b.currency}).`,
        link: `/budget?period=${b.period}`,
        dedupeKey: `budget:${b.id}:${b.state}`,
      });
    }
    return sent;
  }
}

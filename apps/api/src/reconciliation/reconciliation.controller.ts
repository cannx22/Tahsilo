import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { RequirePerms } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { ReconciliationService } from './reconciliation.service';

class IgnoreDto {
  @IsBoolean() ignored: boolean;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

const TXN_SELECT = {
  id: true,
  date: true,
  description: true,
  counterpartyName: true,
  amount: true,
  currency: true,
  reconStatus: true,
  bankAccount: { select: { id: true, name: true, bankName: true } },
} as const;

@Controller('reconciliation')
export class ReconciliationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recon: ReconciliationService,
  ) {}

  @RequirePerms('recon.view')
  @Get()
  async overview(@Query('days') daysRaw?: string) {
    const days = Math.min(365, Math.max(7, Number(daysRaw) || 90));
    const since = new Date(Date.now() - days * 86400000);
    const db = this.prisma.db;
    const [suggestions, unmatched, posUnsettled, differences, counts] = await Promise.all([
      db.reconciliationMatch.findMany({
        where: { status: 'SUGGESTED' },
        include: {
          transaction: { select: TXN_SELECT },
          invoice: { select: { id: true, number: true, type: true, total: true, paidAmount: true, currency: true, counterparty: { select: { name: true } } } },
          attempt: { select: { id: true, amount: true, commission: true, completedAt: true, providerPaymentId: true, paymentRequest: { select: { description: true } } } },
          plannedPayment: { select: { id: true, title: true, amount: true, dueDate: true } },
          statement: { select: { id: true, periodEnd: true, totalAmount: true, paidAmount: true, cardAccount: { select: { name: true, last4: true } } } },
        },
        orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
        take: 200,
      }),
      db.financialTransaction.findMany({
        where: { sourceType: 'BANK', reconStatus: 'UNMATCHED', categoryId: null, status: { not: 'REVERSED' }, date: { gte: since } },
        select: TXN_SELECT,
        orderBy: { date: 'desc' },
        take: 200,
      }),
      // 3 günden eski olup banka hesabına geçişi eşleşmemiş POS tahsilatları
      db.paymentAttempt.findMany({
        where: {
          status: 'SUCCEEDED',
          completedAt: { gte: since, lt: new Date(Date.now() - 3 * 86400000) },
          matches: { none: { type: 'TXN_POS', status: 'CONFIRMED' } },
        },
        select: { id: true, amount: true, commission: true, currency: true, completedAt: true, providerPaymentId: true, paymentRequest: { select: { id: true, description: true } } },
        orderBy: { completedAt: 'desc' },
        take: 200,
      }),
      db.reconciliationMatch.findMany({
        where: { status: 'CONFIRMED', NOT: { difference: 0 }, createdAt: { gte: since } },
        include: {
          transaction: { select: TXN_SELECT },
          invoice: { select: { id: true, number: true } },
          statement: { select: { id: true, periodEnd: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      db.financialTransaction.groupBy({
        by: ['reconStatus'],
        where: { sourceType: 'BANK', date: { gte: since }, status: { not: 'REVERSED' } },
        _count: true,
      }),
    ]);
    return {
      days,
      counts: Object.fromEntries(counts.map((c) => [c.reconStatus, c._count])),
      suggestions,
      unmatched,
      posUnsettled,
      differences,
    };
  }

  @RequirePerms('recon.manage')
  @Post('run')
  run() {
    return this.recon.runAll();
  }

  @RequirePerms('recon.manage')
  @Post('matches/:id/confirm')
  confirm(@Param('id') id: string) {
    return this.recon.confirm(id);
  }

  @RequirePerms('recon.manage')
  @Post('matches/:id/reject')
  reject(@Param('id') id: string) {
    return this.recon.reject(id);
  }

  /** Mutabakat dışı bırakma (ör. hesaplar arası virman). */
  @RequirePerms('recon.manage')
  @Post('transactions/:id/ignore')
  ignore(@Param('id') id: string, @Body() dto: IgnoreDto) {
    return this.recon.setIgnored(id, dto.ignored, dto.note);
  }
}

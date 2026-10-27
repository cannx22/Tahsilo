import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { RequirePerms } from '../common/decorators';
import { D, parseDateOnly } from '../common/money';
import { assertOwned } from '../common/owned';
import { pageArgs } from '../common/period';
import { RequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import {
  CounterpartyDto,
  InvoiceDto,
  InvoicePaymentDto,
  MarkPaidDto,
  PlannedPaymentDto,
  UpdateCounterpartyDto,
  UpdateInvoiceDto,
  UpdatePlannedPaymentDto,
} from './ledger.dto';
import { isOverdue, LedgerService } from './ledger.service';

function today() {
  return new Date(new Date().toISOString().slice(0, 10));
}

@Controller()
export class LedgerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
  ) {}

  // ───────────── Cari hesaplar ─────────────

  @RequirePerms('counterparty.view')
  @Get('counterparties')
  async counterparties(@Query('type') type?: string, @Query('q') q?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const { skip, take, ...meta } = pageArgs(page, pageSize ?? 50);
    const where: Prisma.CounterpartyWhereInput = {
      ...(type === 'CUSTOMER' ? { type: { in: ['CUSTOMER', 'BOTH'] } } : {}),
      ...(type === 'SUPPLIER' ? { type: { in: ['SUPPLIER', 'BOTH'] } } : {}),
      ...(q
        ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }, { taxNumber: { contains: q } }] }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.db.counterparty.findMany({ where, orderBy: { name: 'asc' }, skip, take }),
      this.prisma.db.counterparty.count({ where }),
    ]);
    const balances = await this.balances(items.map((i) => i.id));
    return { items: items.map((c) => ({ ...c, ...balances(c.id) })), total, ...meta };
  }

  /** Açık faturalardan cari bazında alacak/borç ve vadesi geçmiş bakiyeler (para birimi bazında). */
  private async balances(ids: string[]) {
    const open = await this.prisma.db.invoice.findMany({
      where: { counterpartyId: { in: ids }, status: { in: ['OPEN', 'PARTIAL'] } },
      select: { counterpartyId: true, type: true, total: true, paidAmount: true, currency: true, dueDate: true, status: true },
    });
    return (id: string) => {
      const acc = { receivable: {} as Record<string, string>, payable: {} as Record<string, string>, overdue: {} as Record<string, string> };
      for (const inv of open.filter((o) => o.counterpartyId === id)) {
        const rest = inv.total.minus(inv.paidAmount);
        const bucket = inv.type === 'SALES' ? acc.receivable : acc.payable;
        bucket[inv.currency] = D(bucket[inv.currency] ?? 0).plus(rest).toFixed(2);
        if (isOverdue(inv)) acc.overdue[inv.currency] = D(acc.overdue[inv.currency] ?? 0).plus(rest).toFixed(2);
      }
      return acc;
    };
  }

  @RequirePerms('counterparty.view')
  @Get('counterparties/:id')
  async counterparty(@Param('id') id: string) {
    const c = await this.prisma.db.counterparty.findFirstOrThrow({
      where: { id },
      include: {
        invoices: { orderBy: { dueDate: 'desc' }, take: 200 },
        paymentRequests: { orderBy: { createdAt: 'desc' }, take: 50 },
        plannedPayments: { orderBy: { dueDate: 'desc' }, take: 50 },
      },
    });
    const bal = (await this.balances([id]))(id);
    return { ...c, ...bal, invoices: c.invoices.map((i) => ({ ...i, overdue: isOverdue(i) })) };
  }

  @RequirePerms('counterparty.manage')
  @Post('counterparties')
  async createCounterparty(@Body() dto: CounterpartyDto) {
    const row = await this.prisma.db.counterparty.create({ data: { tenantId: RequestContext.tenantId(), ...dto } });
    await this.audit.log('counterparty.create', 'Counterparty', row.id, { after: row });
    return row;
  }

  @RequirePerms('counterparty.manage')
  @Patch('counterparties/:id')
  async updateCounterparty(@Param('id') id: string, @Body() dto: UpdateCounterpartyDto) {
    const before = await this.prisma.db.counterparty.findFirstOrThrow({ where: { id } });
    // ERP ana kaynak olduğunda kimlik alanları Tahsilo'dan değiştirilmez
    if (before.origin === 'ERP' && (dto.name || dto.taxNumber || dto.type)) {
      throw new BadRequestException("Bu cari ERP'den geliyor; unvan, vergi no ve tür ERP'de güncellenmeli");
    }
    const after = await this.prisma.db.counterparty.update({ where: { id }, data: dto });
    await this.audit.log('counterparty.update', 'Counterparty', id, { before, after });
    return after;
  }

  // ───────────── Faturalar ─────────────

  @RequirePerms('invoice.view')
  @Get('invoices')
  async invoices(
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('overdue') overdue?: string,
    @Query('counterpartyId') counterpartyId?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const { skip, take, ...meta } = pageArgs(page, pageSize ?? 50);
    const where: Prisma.InvoiceWhereInput = {
      ...(type ? { type: type as any } : {}),
      ...(status ? { status: status as any } : {}),
      ...(counterpartyId ? { counterpartyId } : {}),
      ...(overdue === 'true' ? { status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: today() } } : {}),
      ...(q ? { OR: [{ number: { contains: q, mode: 'insensitive' } }, { counterparty: { name: { contains: q, mode: 'insensitive' } } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.db.invoice.findMany({
        where,
        include: { counterparty: { select: { id: true, name: true, code: true } } },
        orderBy: [{ dueDate: 'asc' }],
        skip,
        take,
      }),
      this.prisma.db.invoice.count({ where }),
    ]);
    return { items: items.map((i) => ({ ...i, remaining: i.total.minus(i.paidAmount).toFixed(2), overdue: isOverdue(i) })), total, ...meta };
  }

  @RequirePerms('invoice.view')
  @Get('invoices/:id')
  async invoice(@Param('id') id: string) {
    const inv = await this.prisma.db.invoice.findFirstOrThrow({
      where: { id },
      include: {
        counterparty: true,
        documents: { select: { id: true, fileName: true, kind: true, size: true, createdAt: true } },
        paymentRequests: { include: { attempts: { orderBy: { createdAt: 'desc' } } }, orderBy: { createdAt: 'desc' } },
        matches: {
          include: {
            transaction: { select: { id: true, date: true, description: true, amount: true, currency: true } },
            attempt: { select: { id: true, amount: true, completedAt: true, providerPaymentId: true } },
          },
        },
      },
    });
    const history = await this.prisma.db.auditLog.findMany({ where: { entityType: 'Invoice', entityId: id }, orderBy: { createdAt: 'desc' } });
    return { ...inv, remaining: inv.total.minus(inv.paidAmount).toFixed(2), overdue: isOverdue(inv), history };
  }

  @RequirePerms('invoice.manage')
  @Post('invoices')
  async createInvoice(@Body() dto: InvoiceDto) {
    await assertOwned(this.prisma.db, 'counterparty', dto.counterpartyId, 'Cari');
    await assertOwned(this.prisma.db, 'branch', dto.branchId, 'Şube');
    const issueDate = parseDateOnly(dto.issueDate);
    const dueDate = parseDateOnly(dto.dueDate);
    if (dueDate < issueDate) throw new BadRequestException('Vade tarihi fatura tarihinden önce olamaz');
    const row = await this.prisma.db.invoice.create({
      data: {
        tenantId: RequestContext.tenantId(),
        type: dto.type,
        number: dto.number,
        counterpartyId: dto.counterpartyId,
        issueDate,
        branchId: dto.branchId || null,
        dueDate,
        total: dto.total,
        currency: (dto.currency ?? 'TRY').toUpperCase(),
        description: dto.description,
      },
    });
    await this.audit.log('invoice.create', 'Invoice', row.id, { after: row });
    return row;
  }

  @RequirePerms('invoice.manage')
  @Patch('invoices/:id')
  async updateInvoice(@Param('id') id: string, @Body() dto: UpdateInvoiceDto) {
    const before = await this.prisma.db.invoice.findFirstOrThrow({ where: { id } });
    if (before.origin === 'ERP') throw new BadRequestException("ERP'den gelen fatura ERP'de güncellenmeli");
    const after = await this.prisma.db.invoice.update({
      where: { id },
      data: { description: dto.description, ...(dto.dueDate ? { dueDate: parseDateOnly(dto.dueDate) } : {}) },
    });
    await this.audit.log('invoice.update', 'Invoice', id, { before, after });
    return after;
  }

  @RequirePerms('invoice.manage')
  @Post('invoices/:id/cancel')
  async cancelInvoice(@Param('id') id: string) {
    const before = await this.prisma.db.invoice.findFirstOrThrow({ where: { id } });
    if (before.origin === 'ERP') throw new BadRequestException("ERP'den gelen fatura ERP'de iptal edilmeli");
    if (before.paidAmount.gt(0)) throw new BadRequestException('Ödemesi olan fatura iptal edilemez');
    const after = await this.prisma.db.invoice.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.log('invoice.cancel', 'Invoice', id, { before: { status: before.status }, after: { status: 'CANCELLED' } });
    return after;
  }

  /** Faturaya ödeme/tahsilat kaydeder; banka hareketi verilirse eşleştirme de onaylı olarak oluşturulur. */
  @RequirePerms('invoice.manage')
  @Post('invoices/:id/payments')
  async recordPayment(@Param('id') id: string, @Body() dto: InvoicePaymentDto) {
    const inv = await this.prisma.db.invoice.findFirstOrThrow({ where: { id } });
    const result = await this.prisma.db.$transaction(async (tx) => {
      if (dto.transactionId) {
        const txn = await tx.financialTransaction.findFirst({ where: { id: dto.transactionId } });
        if (!txn) throw new BadRequestException('Hareket bulunamadı');
        const expectedSign = inv.type === 'SALES' ? 1 : -1;
        if (Math.sign(Number(txn.amount)) !== expectedSign) {
          throw new BadRequestException(inv.type === 'SALES' ? 'Satış faturasına yalnızca para girişi bağlanabilir' : 'Alış faturasına yalnızca para çıkışı bağlanabilir');
        }
        if (txn.currency !== inv.currency) throw new BadRequestException('Para birimleri farklı');
        await tx.reconciliationMatch.create({
          data: {
            tenantId: RequestContext.tenantId(),
            type: 'TXN_INVOICE',
            status: 'CONFIRMED',
            transactionId: txn.id,
            invoiceId: inv.id,
            difference: txn.amount.abs().minus(dto.amount),
            score: 100,
            reason: dto.note ?? 'Manuel ödeme kaydı',
            decidedById: RequestContext.userId(),
            decidedAt: new Date(),
          },
        });
        await tx.financialTransaction.update({ where: { id: txn.id }, data: { reconStatus: 'MATCHED' } });
      }
      return this.ledger.applyToInvoice(tx, id, dto.amount);
    });
    await this.audit.log('invoice.payment', 'Invoice', id, {
      before: { paidAmount: inv.paidAmount, status: inv.status },
      after: { paidAmount: result.paidAmount, status: result.status, amount: dto.amount, transactionId: dto.transactionId, note: dto.note },
    });
    return result;
  }

  // ───────────── Ödeme takvimi ─────────────

  @RequirePerms('planned.view')
  @Get('planned-payments')
  async planned(@Query('status') status?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.prisma.db.plannedPayment.findMany({
      where: {
        ...(status ? { status: status as any } : {}),
        ...(from || to ? { dueDate: { ...(from ? { gte: parseDateOnly(from) } : {}), ...(to ? { lte: parseDateOnly(to) } : {}) } } : {}),
      },
      include: {
        counterparty: { select: { id: true, name: true } },
        invoice: { select: { id: true, number: true } },
      },
      orderBy: { dueDate: 'asc' },
      take: 500,
    });
  }

  /** Yaklaşan tüm yükümlülükler: planlı ödemeler, açık alış faturaları ve kart ekstreleri. */
  @RequirePerms('planned.view')
  @Get('payables/upcoming')
  async upcoming(@Query('days') daysRaw?: string) {
    const days = Math.min(365, Math.max(1, Number(daysRaw) || 30));
    const until = new Date(today().getTime() + days * 86400000);
    const [planned, invoices, statements] = await Promise.all([
      this.prisma.db.plannedPayment.findMany({
        where: { status: 'PLANNED', dueDate: { lte: until }, invoiceId: null },
        include: { counterparty: { select: { id: true, name: true } } },
      }),
      this.prisma.db.invoice.findMany({
        where: { type: 'PURCHASE', status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lte: until } },
        include: { counterparty: { select: { id: true, name: true } } },
      }),
      this.prisma.db.cardStatement.findMany({
        where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, dueDate: { lte: until } },
        include: { cardAccount: { select: { id: true, name: true, last4: true } } },
      }),
    ]);
    const now = today();
    const items = [
      ...planned.map((p) => ({
        kind: 'PLANNED' as const,
        id: p.id,
        title: p.title,
        category: p.category,
        counterparty: p.counterparty,
        dueDate: p.dueDate,
        amount: p.amount.toFixed(2),
        currency: p.currency,
        overdue: p.dueDate < now,
      })),
      ...invoices.map((i) => ({
        kind: 'INVOICE' as const,
        id: i.id,
        title: `Fatura ${i.number}`,
        category: 'Tedarikçi faturası',
        counterparty: i.counterparty,
        dueDate: i.dueDate,
        amount: i.total.minus(i.paidAmount).toFixed(2),
        currency: i.currency,
        overdue: i.dueDate < now,
      })),
      ...statements.map((s) => ({
        kind: 'CARD_STATEMENT' as const,
        id: s.id,
        title: `${s.cardAccount.name} •••• ${s.cardAccount.last4} ekstresi`,
        category: 'Kredi kartı borcu',
        counterparty: null,
        dueDate: s.dueDate,
        amount: s.totalAmount.minus(s.paidAmount).toFixed(2),
        currency: s.currency,
        overdue: s.dueDate < now,
      })),
    ].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    return { days, items };
  }

  @RequirePerms('planned.manage')
  @Post('planned-payments')
  async createPlanned(@Body() dto: PlannedPaymentDto) {
    await assertOwned(this.prisma.db, 'counterparty', dto.counterpartyId, 'Cari');
    await assertOwned(this.prisma.db, 'invoice', dto.invoiceId, 'Fatura');
    const row = await this.prisma.db.plannedPayment.create({
      data: {
        tenantId: RequestContext.tenantId(),
        ...dto,
        counterpartyId: dto.counterpartyId || null,
        invoiceId: dto.invoiceId || null,
        currency: (dto.currency ?? 'TRY').toUpperCase(),
        dueDate: parseDateOnly(dto.dueDate),
      },
    });
    await this.audit.log('planned.create', 'PlannedPayment', row.id, { after: row });
    return row;
  }

  @RequirePerms('planned.manage')
  @Patch('planned-payments/:id')
  async updatePlanned(@Param('id') id: string, @Body() dto: UpdatePlannedPaymentDto) {
    const before = await this.prisma.db.plannedPayment.findFirstOrThrow({ where: { id } });
    if (before.status !== 'PLANNED') throw new BadRequestException('Kapatılmış ödeme düzenlenemez');
    const after = await this.prisma.db.plannedPayment.update({
      where: { id },
      data: { ...dto, ...(dto.dueDate ? { dueDate: parseDateOnly(dto.dueDate) } : {}) },
    });
    await this.audit.log('planned.update', 'PlannedPayment', id, { before, after });
    return after;
  }

  @RequirePerms('planned.manage')
  @Post('planned-payments/:id/cancel')
  async cancelPlanned(@Param('id') id: string) {
    const before = await this.prisma.db.plannedPayment.findFirstOrThrow({ where: { id } });
    if (before.status !== 'PLANNED') throw new BadRequestException('Bu ödeme zaten kapatılmış');
    const after = await this.prisma.db.plannedPayment.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.log('planned.cancel', 'PlannedPayment', id, { before: { status: before.status }, after: { status: after.status } });
    return after;
  }

  @RequirePerms('planned.manage')
  @Post('planned-payments/:id/mark-paid')
  async markPaid(@Param('id') id: string, @Body() dto: MarkPaidDto) {
    const result = await this.prisma.db.$transaction(async (tx) => {
      const p = await tx.plannedPayment.findFirst({ where: { id } });
      if (!p) throw new BadRequestException('Planlı ödeme bulunamadı');
      let paidAt = new Date();
      if (dto.transactionId) {
        const txn = await tx.financialTransaction.findFirst({ where: { id: dto.transactionId } });
        if (!txn) throw new BadRequestException('Hareket bulunamadı');
        if (txn.amount.gte(0)) throw new BadRequestException('Ödeme yalnızca para çıkışıyla eşleştirilebilir');
        paidAt = txn.date;
        await tx.reconciliationMatch.create({
          data: {
            tenantId: RequestContext.tenantId(),
            type: 'TXN_PLANNED',
            status: 'CONFIRMED',
            transactionId: txn.id,
            plannedPaymentId: p.id,
            difference: txn.amount.abs().minus(p.amount),
            score: 100,
            reason: 'Manuel eşleştirme',
            decidedById: RequestContext.userId(),
            decidedAt: new Date(),
          },
        });
        await tx.financialTransaction.update({ where: { id: txn.id }, data: { reconStatus: 'MATCHED' } });
      }
      return this.ledger.markPlannedPaid(tx, id, paidAt);
    });
    await this.audit.log('planned.paid', 'PlannedPayment', id, { after: { transactionId: dto.transactionId, next: result.nextPayment?.id } });
    return result;
  }
}

import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { AuthUser, CurrentUser, RequirePerms } from '../common/decorators';
import { parseDateOnly } from '../common/money';
import { assertOwned } from '../common/owned';
import { pageArgs } from '../common/period';
import { hasPermission } from '../common/permissions';
import { RequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { CategorizerService } from './categorizer.service';
import { BulkCategorizeDto, ManualTransactionDto, UpdateTransactionDto } from './transactions.dto';

export interface TxnFilters {
  from?: string;
  to?: string;
  sourceType?: string;
  dataSource?: string;
  bankAccountId?: string;
  cardAccountId?: string;
  categoryId?: string;
  reconStatus?: string;
  direction?: 'IN' | 'OUT';
  status?: string;
  uncategorized?: string;
  q?: string;
}

export function buildTxnWhere(f: TxnFilters): Prisma.FinancialTransactionWhereInput {
  const where: Prisma.FinancialTransactionWhereInput = {};
  if (f.from || f.to) {
    where.date = {
      ...(f.from ? { gte: parseDateOnly(f.from) } : {}),
      ...(f.to ? { lte: parseDateOnly(f.to) } : {}),
    };
  }
  if (f.sourceType) where.sourceType = f.sourceType as any;
  if (f.dataSource) where.dataSource = f.dataSource as any;
  if (f.bankAccountId) where.bankAccountId = f.bankAccountId;
  if (f.cardAccountId) where.cardAccountId = f.cardAccountId;
  if (f.categoryId) where.categoryId = f.categoryId;
  if (f.uncategorized === 'true') where.categoryId = null;
  if (f.reconStatus) where.reconStatus = f.reconStatus as any;
  if (f.status) where.status = f.status as any;
  if (f.direction === 'IN') where.amount = { gt: 0 };
  if (f.direction === 'OUT') where.amount = { lt: 0 };
  if (f.q) {
    where.OR = [
      { description: { contains: f.q, mode: 'insensitive' } },
      { counterpartyName: { contains: f.q, mode: 'insensitive' } },
      { sourceRef: { contains: f.q, mode: 'insensitive' } },
    ];
  }
  return where;
}

const LIST_INCLUDE = {
  bankAccount: { select: { id: true, name: true, bankName: true } },
  cardAccount: { select: { id: true, name: true, last4: true } },
  category: { select: { id: true, name: true } },
  expense: { select: { id: true, status: true } },
  _count: { select: { documents: true } },
} satisfies Prisma.FinancialTransactionInclude;

@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly categorizer: CategorizerService,
  ) {}

  /** Kartı sadece kendisine ait olan kullanıcılar yalnızca kendi kart hareketlerini görür. */
  private async visibility(user: AuthUser): Promise<Prisma.FinancialTransactionWhereInput> {
    if (hasPermission(user.role, 'txn.view')) return {};
    if (hasPermission(user.role, 'card.view_own')) {
      const cards = await this.prisma.db.cardAccount.findMany({ where: { holderUserId: user.id }, select: { id: true } });
      return { cardAccountId: { in: cards.map((c) => c.id) } };
    }
    return { id: '__none__' };
  }

  @RequirePerms('txn.view', 'card.view_own')
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() q: TxnFilters & { page?: string; pageSize?: string }) {
    const { skip, take, ...meta } = pageArgs(q.page, q.pageSize);
    const where = { AND: [buildTxnWhere(q), await this.visibility(user)] };
    const [items, total, totals] = await Promise.all([
      this.prisma.db.financialTransaction.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      this.prisma.db.financialTransaction.count({ where }),
      this.prisma.db.financialTransaction.groupBy({
        by: ['currency'],
        where: { AND: [where, { status: { not: 'REVERSED' } }] },
        _sum: { amount: true },
      }),
    ]);
    const suggest = await this.categorizer.loader();
    return {
      items: items.map((t) => ({
        ...t,
        suggestedCategory: !t.categoryId && Number(t.amount) < 0 ? suggest(t.description) : null,
      })),
      total,
      totals: totals.map((t) => ({ currency: t.currency, net: t._sum.amount?.toFixed(2) ?? '0.00' })),
      ...meta,
    };
  }

  @RequirePerms('txn.view', 'card.view_own')
  @Get(':id')
  async detail(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const txn = await this.prisma.db.financialTransaction.findFirst({
      where: { AND: [{ id }, await this.visibility(user)] },
      include: {
        ...LIST_INCLUDE,
        statement: true,
        importBatch: { select: { id: true, fileName: true, createdAt: true, createdById: true } },
        expense: {
          include: {
            category: { select: { id: true, name: true } },
            department: { select: { id: true, name: true } },
            costCenter: { select: { id: true, code: true, name: true } },
          },
        },
        documents: { select: { id: true, fileName: true, kind: true, size: true, createdAt: true } },
        matches: {
          include: {
            invoice: { select: { id: true, number: true, total: true, currency: true } },
            attempt: { select: { id: true, amount: true, providerPaymentId: true } },
            plannedPayment: { select: { id: true, title: true, amount: true } },
            statement: { select: { id: true, periodEnd: true, totalAmount: true } },
          },
        },
      },
    });
    if (!txn) throw new NotFoundException('Hareket bulunamadı');
    const suggest = await this.categorizer.loader();
    const auditTrail = hasPermission(user.role, 'audit.view') || hasPermission(user.role, 'txn.edit')
      ? await this.prisma.db.auditLog.findMany({
          where: { entityType: 'FinancialTransaction', entityId: id },
          orderBy: { createdAt: 'desc' },
          take: 50,
        })
      : [];
    const createdBy = txn.createdById
      ? await this.prisma.db.user.findFirst({ where: { id: txn.createdById }, select: { id: true, name: true } })
      : null;
    return { ...txn, createdBy, suggestedCategory: txn.categoryId ? null : suggest(txn.description), auditTrail };
  }

  @RequirePerms('txn.edit')
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateTransactionDto) {
    await assertOwned(this.prisma.db, 'expenseCategory', dto.categoryId, 'Kategori');
    const before = await this.prisma.db.financialTransaction.findFirstOrThrow({ where: { id } });
    const after = await this.prisma.db.financialTransaction.update({ where: { id }, data: dto });
    await this.audit.log('transaction.update', 'FinancialTransaction', id, {
      before: { categoryId: before.categoryId, note: before.note, counterpartyName: before.counterpartyName },
      after: { categoryId: after.categoryId, note: after.note, counterpartyName: after.counterpartyName },
    });
    return after;
  }

  @RequirePerms('txn.edit')
  @Post('bulk-categorize')
  async bulkCategorize(@Body() dto: BulkCategorizeDto) {
    await assertOwned(this.prisma.db, 'expenseCategory', dto.categoryId, 'Kategori');
    const res = await this.prisma.db.financialTransaction.updateMany({
      where: { id: { in: dto.ids } },
      data: { categoryId: dto.categoryId },
    });
    await Promise.all(
      dto.ids.map((id) =>
        this.audit.log('transaction.categorize', 'FinancialTransaction', id, { after: { categoryId: dto.categoryId } }),
      ),
    );
    return { updated: res.count };
  }

  /** Nakit gider, eksik hareket veya düzeltme kaydı. Kaynağı her zaman MANUAL olarak etiketlenir. */
  @RequirePerms('txn.edit')
  @Post()
  async createManual(@Body() dto: ManualTransactionDto) {
    if (dto.bankAccountId && dto.cardAccountId) throw new BadRequestException('Hareket tek bir hesaba bağlanabilir');
    await assertOwned(this.prisma.db, 'bankAccount', dto.bankAccountId, 'Banka hesabı');
    await assertOwned(this.prisma.db, 'cardAccount', dto.cardAccountId, 'Kart');
    await assertOwned(this.prisma.db, 'expenseCategory', dto.categoryId, 'Kategori');
    const amount = dto.direction === 'OUT' ? -dto.amount : dto.amount;
    const account = dto.bankAccountId
      ? await this.prisma.db.bankAccount.findFirst({ where: { id: dto.bankAccountId }, select: { branchId: true } })
      : dto.cardAccountId
        ? await this.prisma.db.cardAccount.findFirst({ where: { id: dto.cardAccountId }, select: { branchId: true } })
        : null;
    const txn = await this.prisma.db.financialTransaction.create({
      data: {
        tenantId: RequestContext.tenantId(),
        sourceType: 'MANUAL',
        dataSource: 'MANUAL',
        dedupeKey: `manual:${CryptoService.token(16)}`,
        date: parseDateOnly(dto.date),
        description: dto.description,
        amount,
        currency: (dto.currency ?? 'TRY').toUpperCase(),
        bankAccountId: dto.bankAccountId || null,
        cardAccountId: dto.cardAccountId || null,
        categoryId: dto.categoryId || null,
        branchId: account?.branchId ?? RequestContext.current()?.branchId ?? null,
        counterpartyName: dto.counterpartyName,
        note: dto.note,
        createdById: RequestContext.userId(),
      },
    });
    await this.audit.log('transaction.create_manual', 'FinancialTransaction', txn.id, { after: txn });
    return txn;
  }
}

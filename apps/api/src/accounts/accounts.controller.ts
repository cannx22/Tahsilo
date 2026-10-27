import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePerms } from '../common/decorators';
import { parseDateOnly } from '../common/money';
import { assertOwned } from '../common/owned';
import { hasPermission } from '../common/permissions';
import { RequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import {
  BankAccountDto,
  CardAccountDto,
  ManualBalanceDto,
  StatementDto,
  UpdateBankAccountDto,
  UpdateCardAccountDto,
} from './accounts.dto';

export function maskIban(iban?: string) {
  if (!iban) return null;
  const clean = iban.replace(/\s+/g, '').toUpperCase();
  if (clean.length < 8) return null;
  return `${clean.slice(0, 4)} **** **** ${clean.slice(-4)}`;
}

@Controller()
export class AccountsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────── Banka hesapları ─────────────

  @RequirePerms('bank.view')
  @Get('bank-accounts')
  async bankAccounts() {
    const accounts = await this.prisma.db.bankAccount.findMany({
      orderBy: [{ isActive: 'desc' }, { bankName: 'asc' }],
      include: {
        connection: { select: { provider: true, status: true, lastSyncAt: true, lastError: true, consentExpiresAt: true } },
        branch: { select: { id: true, name: true } },
        imports: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true, fileName: true } },
        _count: { select: { transactions: true } },
      },
    });
    return accounts.map(({ imports, _count, ...a }) => ({
      ...a,
      transactionCount: _count.transactions,
      lastImport: imports[0] ?? null,
    }));
  }

  @RequirePerms('bank.view')
  @Get('bank-accounts/:id')
  bankAccount(@Param('id') id: string) {
    return this.prisma.db.bankAccount.findFirstOrThrow({
      where: { id },
      include: {
        connection: { select: { id: true, provider: true, status: true, lastSyncAt: true, lastError: true, consentExpiresAt: true } },
        imports: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
  }

  @RequirePerms('bank.manage')
  @Post('bank-accounts')
  async createBankAccount(@Body() dto: BankAccountDto) {
    await assertOwned(this.prisma.db, 'branch', dto.branchId, 'Şube');
    const row = await this.prisma.db.bankAccount.create({
      data: {
        tenantId: RequestContext.tenantId(),
        bankName: dto.bankName,
        name: dto.name,
        ibanMasked: maskIban(dto.iban),
        currency: (dto.currency ?? 'TRY').toUpperCase(),
        branchId: dto.branchId || null,
      },
    });
    await this.audit.log('bankAccount.create', 'BankAccount', row.id, { after: row });
    return row;
  }

  @RequirePerms('bank.manage')
  @Patch('bank-accounts/:id')
  async updateBankAccount(@Param('id') id: string, @Body() dto: UpdateBankAccountDto) {
    await assertOwned(this.prisma.db, 'branch', dto.branchId, 'Şube');
    const before = await this.prisma.db.bankAccount.findFirstOrThrow({ where: { id } });
    const after = await this.prisma.db.bankAccount.update({ where: { id }, data: dto });
    // Şube değişirse hesabın hareketleri de yeni şubeye taşınır
    if (dto.branchId !== undefined && dto.branchId !== before.branchId) {
      await this.prisma.db.financialTransaction.updateMany({ where: { bankAccountId: id }, data: { branchId: dto.branchId } });
    }
    await this.audit.log('bankAccount.update', 'BankAccount', id, { before, after });
    return after;
  }

  /** Banka bağlantısı olmayan hesaplar için kontrollü manuel bakiye girişi (kaynağı MANUAL olarak etiketlenir). */
  @RequirePerms('bank.manage')
  @Post('bank-accounts/:id/balance')
  async setBalance(@Param('id') id: string, @Body() dto: ManualBalanceDto) {
    const before = await this.prisma.db.bankAccount.findFirstOrThrow({ where: { id } });
    if (before.connectionId) throw new BadRequestException('Bağlı hesapların bakiyesi bankadan alınır');
    const after = await this.prisma.db.bankAccount.update({
      where: { id },
      data: { balance: dto.balance, balanceAsOf: parseDateOnly(dto.asOf), balanceSource: 'MANUAL' },
    });
    await this.audit.log('bankAccount.balance', 'BankAccount', id, {
      before: { balance: before.balance, asOf: before.balanceAsOf, source: before.balanceSource },
      after: { balance: after.balance, asOf: after.balanceAsOf, source: 'MANUAL' },
    });
    return after;
  }

  // ───────────── Şirket kartları ─────────────

  @RequirePerms('card.view_all', 'card.view_own')
  @Get('card-accounts')
  async cardAccounts(@CurrentUser() user: AuthUser) {
    const where = hasPermission(user.role, 'card.view_all') ? {} : { holderUserId: user.id };
    const cards = await this.prisma.db.cardAccount.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: {
        branch: { select: { id: true, name: true } },
        holder: { select: { id: true, name: true } },
        statements: { orderBy: { periodEnd: 'desc' }, take: 1 },
        imports: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true, fileName: true } },
      },
    });
    const unbilled = await this.prisma.db.financialTransaction.groupBy({
      by: ['cardAccountId', 'status'],
      where: { cardAccountId: { in: cards.map((c) => c.id) }, statementId: null, status: { not: 'REVERSED' } },
      _sum: { amount: true },
    });
    return cards.map(({ statements, imports, ...c }) => {
      const rows = unbilled.filter((u) => u.cardAccountId === c.id);
      const pick = (s: string) => rows.find((r) => r.status === s)?._sum.amount?.neg().toFixed(2) ?? '0.00';
      return {
        ...c,
        lastStatement: statements[0] ?? null,
        lastImport: imports[0] ?? null,
        // Ekstreye girmemiş harcamalar: provizyon ve kesinleşmiş ayrı gösterilir
        unbilledPosted: pick('POSTED'),
        unbilledPending: pick('PENDING'),
      };
    });
  }

  @RequirePerms('card.view_all', 'card.view_own')
  @Get('card-accounts/:id')
  async cardAccount(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const card = await this.prisma.db.cardAccount.findFirst({
      where: { id, ...(hasPermission(user.role, 'card.view_all') ? {} : { holderUserId: user.id }) },
      include: {
        branch: { select: { id: true, name: true, isActive: true } },
        holder: { select: { id: true, name: true } },
        statements: { orderBy: { periodEnd: 'desc' } },
        imports: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!card) throw new NotFoundException('Kart bulunamadı');
    return card;
  }

  @RequirePerms('card.manage')
  @Post('card-accounts')
  async createCard(@Body() dto: CardAccountDto) {
    await assertOwned(this.prisma.db, 'branch', dto.branchId, 'Şube');
    await assertOwned(this.prisma.db, 'user', dto.holderUserId, 'Kart sahibi');
    const row = await this.prisma.db.cardAccount.create({
      data: {
        tenantId: RequestContext.tenantId(),
        ...dto,
        holderUserId: dto.holderUserId || null,
        branchId: dto.branchId || null,
        currency: (dto.currency ?? 'TRY').toUpperCase(),
      },
    });
    await this.audit.log('cardAccount.create', 'CardAccount', row.id, { after: row });
    return row;
  }

  @RequirePerms('card.manage')
  @Patch('card-accounts/:id')
  async updateCard(@Param('id') id: string, @Body() dto: UpdateCardAccountDto) {
    await assertOwned(this.prisma.db, 'branch', dto.branchId, 'Şube');
    await assertOwned(this.prisma.db, 'user', dto.holderUserId, 'Kart sahibi');
    const before = await this.prisma.db.cardAccount.findFirstOrThrow({ where: { id } });
    const after = await this.prisma.db.cardAccount.update({ where: { id }, data: dto });
    if (dto.branchId !== undefined && dto.branchId !== before.branchId) {
      await this.prisma.db.financialTransaction.updateMany({ where: { cardAccountId: id }, data: { branchId: dto.branchId } });
    }
    await this.audit.log('cardAccount.update', 'CardAccount', id, { before, after });
    return after;
  }

  /** Ekstre dönemi oluşturur ve dönem içindeki ekstresiz kart hareketlerini bu ekstreye bağlar. */
  @RequirePerms('card.manage')
  @Post('card-accounts/:id/statements')
  async createStatement(@Param('id') id: string, @Body() dto: StatementDto) {
    const card = await this.prisma.db.cardAccount.findFirstOrThrow({ where: { id } });
    const periodStart = parseDateOnly(dto.periodStart);
    const periodEnd = parseDateOnly(dto.periodEnd);
    const dueDate = parseDateOnly(dto.dueDate);
    if (periodStart > periodEnd) throw new BadRequestException('Dönem başlangıcı bitişten sonra olamaz');
    if (dueDate < periodEnd) throw new BadRequestException('Son ödeme tarihi dönem sonundan önce olamaz');

    const statement = await this.prisma.db.$transaction(async (tx) => {
      const st = await tx.cardStatement.create({
        data: {
          tenantId: RequestContext.tenantId(),
          cardAccountId: card.id,
          periodStart,
          periodEnd,
          dueDate,
          totalAmount: dto.totalAmount,
          minimumPayment: dto.minimumPayment,
          currency: card.currency,
          source: 'MANUAL',
        },
      });
      const linked = await tx.financialTransaction.updateMany({
        where: { cardAccountId: card.id, statementId: null, date: { gte: periodStart, lte: periodEnd } },
        data: { statementId: st.id },
      });
      return { ...st, linkedTransactions: linked.count };
    });
    await this.audit.log('statement.create', 'CardStatement', statement.id, { after: statement });
    return statement;
  }
}

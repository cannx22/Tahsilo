import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePerms } from '../common/decorators';
import { parseDateOnly } from '../common/money';
import { assertOwned } from '../common/owned';
import { pageArgs } from '../common/period';
import { hasPermission } from '../common/permissions';
import { RequestContext } from '../common/request-context';
import { DocumentsService } from '../documents/documents.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalPolicy } from './approval-policy';
import { CreateExpenseDto, DecisionDto, UpdateExpenseDto } from './expenses.dto';

const INCLUDE = {
  category: { select: { id: true, name: true, code: true } },
  department: { select: { id: true, name: true } },
  costCenter: { select: { id: true, code: true, name: true } },
  transaction: {
    select: {
      id: true,
      date: true,
      description: true,
      amount: true,
      currency: true,
      status: true,
      sourceType: true,
      dataSource: true,
      cardAccount: { select: { id: true, name: true, last4: true } },
      bankAccount: { select: { id: true, name: true } },
    },
  },
  documents: { select: { id: true, fileName: true, kind: true, size: true, createdAt: true } },
} satisfies Prisma.ExpenseInclude;

@Controller('expenses')
export class ExpensesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
    private readonly policy: ApprovalPolicy,
    private readonly notifications: NotificationsService,
  ) {}

  /** Rol bazlı görünürlük: tümü / kendi departmanı / yalnızca kendi giderleri. */
  async visibility(user: AuthUser): Promise<Prisma.ExpenseWhereInput> {
    if (hasPermission(user.role, 'expense.view_all')) return {};
    if (hasPermission(user.role, 'expense.view_team') && user.departmentId) {
      return { OR: [{ submittedById: user.id }, { departmentId: user.departmentId }] };
    }
    return { submittedById: user.id };
  }

  private async findVisible(id: string, user: AuthUser) {
    const exp = await this.prisma.db.expense.findFirst({ where: { AND: [{ id }, await this.visibility(user)] }, include: INCLUDE });
    if (!exp) throw new NotFoundException('Gider bulunamadı');
    return exp;
  }

  @RequirePerms('expense.view_all', 'expense.view_team', 'expense.view_own')
  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('categoryId') categoryId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('mine') mine?: string,
    @Query('page') page?: string,
  ) {
    const { skip, take, ...meta } = pageArgs(page, 50);
    const where: Prisma.ExpenseWhereInput = {
      AND: [
        await this.visibility(user),
        status ? { status: status as any } : {},
        categoryId ? { categoryId } : {},
        departmentId ? { departmentId } : {},
        mine === 'true' ? { submittedById: user.id } : {},
        from || to
          ? { date: { ...(from ? { gte: parseDateOnly(from) } : {}), ...(to ? { lte: parseDateOnly(to) } : {}) } }
          : {},
      ],
    };
    const [items, total] = await Promise.all([
      this.prisma.db.expense.findMany({ where, include: INCLUDE, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip, take }),
      this.prisma.db.expense.count({ where }),
    ]);
    const users = await this.userNames(items.map((i) => i.submittedById));
    return { items: items.map((i) => ({ ...i, submittedBy: users.get(i.submittedById) ?? null })), total, ...meta };
  }

  @RequirePerms('expense.view_all', 'expense.view_team', 'expense.view_own')
  @Get(':id')
  async detail(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const exp = await this.findVisible(id, user);
    const history = await this.prisma.db.auditLog.findMany({
      where: { entityType: 'Expense', entityId: id },
      orderBy: { createdAt: 'asc' },
    });
    const users = await this.userNames([exp.submittedById]);
    const decision = exp.status === 'SUBMITTED' ? await this.policy.canApprove(user, exp) : null;
    return {
      ...exp,
      submittedBy: users.get(exp.submittedById) ?? null,
      history,
      requiredApproverRoles: await this.policy.requiredRoles(exp.amount),
      canDecide: decision?.ok ?? false,
      cannotDecideReason: decision && !decision.ok ? decision.reason : null,
    };
  }

  @RequirePerms('expense.create')
  @Post()
  async create(@Body() dto: CreateExpenseDto, @CurrentUser() user: AuthUser) {
    const db = this.prisma.db;
    await assertOwned(db, 'expenseCategory', dto.categoryId, 'Kategori');
    await assertOwned(db, 'department', dto.departmentId, 'Departman');
    await assertOwned(db, 'costCenter', dto.costCenterId, 'Maliyet merkezi');

    let date: Date;
    let amount: Prisma.Decimal | number;
    let currency: string;
    let branchId: string | null = null;
    if (dto.transactionId) {
      const txn = await db.financialTransaction.findFirst({ where: { id: dto.transactionId }, include: { cardAccount: true, expense: true } });
      if (!txn) throw new BadRequestException('Hareket bulunamadı');
      // Kart sahibi sadece kendi kart hareketinden gider oluşturabilir
      if (!hasPermission(user.role, 'txn.view') && txn.cardAccount?.holderUserId !== user.id) {
        throw new ForbiddenException('Bu hareket için gider oluşturamazsınız');
      }
      if (txn.expense) throw new BadRequestException('Bu hareket zaten gider olarak kaydedilmiş');
      if (txn.amount.gte(0)) throw new BadRequestException('Yalnızca para çıkışı gider olarak kaydedilebilir');
      if (txn.status === 'REVERSED') throw new BadRequestException('İptal edilmiş hareket gider yazılamaz');
      date = txn.date;
      amount = txn.amount.abs();
      currency = txn.currency;
      branchId = txn.branchId;
    } else {
      if (!dto.amount || !dto.date) throw new BadRequestException('Hareketsiz giderde tutar ve tarih zorunlu');
      date = parseDateOnly(dto.date);
      amount = dto.amount;
      currency = (dto.currency ?? 'TRY').toUpperCase();
    }

    // Firma sahibinin gideri ve otomatik onay limitinin altındaki giderler doğrudan onaylanır
    const tenant = await this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: RequestContext.tenantId() }, select: { expenseAutoApproveLimit: true } });
    const underLimit = !!tenant.expenseAutoApproveLimit && tenant.expenseAutoApproveLimit.gte(amount);
    const autoApprove = user.role === 'OWNER' || underLimit;
    branchId ??= (await this.prisma.raw.user.findUnique({ where: { id: user.id }, select: { branchId: true } }))?.branchId ?? null;
    const expense = await db.$transaction(async (tx) => {
      const exp = await tx.expense.create({
        data: {
          tenantId: RequestContext.tenantId(),
          transactionId: dto.transactionId || null,
          submittedById: user.id,
          categoryId: dto.categoryId,
          departmentId: dto.departmentId || user.departmentId || null,
          costCenterId: dto.costCenterId || null,
          branchId,
          project: dto.project,
          merchant: dto.merchant,
          description: dto.description,
          date,
          amount,
          currency,
          status: autoApprove ? 'APPROVED' : 'SUBMITTED',
        },
        include: INCLUDE,
      });
      if (dto.transactionId) {
        await tx.financialTransaction.update({ where: { id: dto.transactionId }, data: { categoryId: dto.categoryId } });
      }
      return exp;
    });
    await this.audit.log('expense.create', 'Expense', expense.id, {
      after: { ...expense, documents: undefined, autoApproved: autoApprove ? (underLimit ? 'limit' : 'owner') : false },
    });
    if (expense.status === 'SUBMITTED') await this.notifyApprovers(expense, user);
    return expense;
  }

  private async notifyApprovers(exp: { id: string; amount: Prisma.Decimal; currency: string; departmentId: string | null; submittedById: string; description: string }, user: AuthUser) {
    await this.notifications.notify(await this.policy.approvers(exp), {
      type: 'expense.submitted',
      title: `Onay bekleyen gider: ${exp.amount.toFixed(2)} ${exp.currency}`,
      body: `${user.name} — ${exp.description}`,
      link: `/expenses/${exp.id}`,
      dedupeKey: `expense:${exp.id}:submitted:${Date.now()}`,
    });
  }

  @RequirePerms('expense.create')
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateExpenseDto, @CurrentUser() user: AuthUser) {
    const before = await this.findVisible(id, user);
    const canApprove = hasPermission(user.role, 'expense.approve');
    if (before.submittedById !== user.id && !canApprove) throw new ForbiddenException('Bu gideri düzenleyemezsiniz');
    if (before.status === 'APPROVED' && !canApprove) throw new BadRequestException('Onaylanmış gider düzenlenemez');
    if (before.erpSyncedAt) throw new BadRequestException("ERP'ye aktarılmış gider düzenlenemez");
    await assertOwned(this.prisma.db, 'expenseCategory', dto.categoryId, 'Kategori');
    await assertOwned(this.prisma.db, 'department', dto.departmentId, 'Departman');
    await assertOwned(this.prisma.db, 'costCenter', dto.costCenterId, 'Maliyet merkezi');
    const after = await this.prisma.db.expense.update({
      where: { id },
      // Reddedilen gider düzenlenince yeniden onaya gönderilir
      data: { ...dto, ...(before.status === 'REJECTED' ? { status: 'SUBMITTED' as const } : {}) },
      include: INCLUDE,
    });
    if (dto.categoryId && before.transactionId) {
      await this.prisma.db.financialTransaction.update({ where: { id: before.transactionId }, data: { categoryId: dto.categoryId } });
    }
    await this.audit.log('expense.update', 'Expense', id, { before, after });
    if (before.status === 'REJECTED') await this.notifyApprovers(after, user);
    return after;
  }

  @RequirePerms('expense.approve')
  @Post(':id/approve')
  approve(@Param('id') id: string, @Body() dto: DecisionDto, @CurrentUser() user: AuthUser) {
    return this.decide(id, 'APPROVED', dto.comment, user);
  }

  @RequirePerms('expense.approve')
  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: DecisionDto, @CurrentUser() user: AuthUser) {
    if (!dto.comment?.trim()) throw new BadRequestException('Red gerekçesi yazılmalı');
    return this.decide(id, 'REJECTED', dto.comment, user);
  }

  private async decide(id: string, status: 'APPROVED' | 'REJECTED', comment: string | undefined, user: AuthUser) {
    const exp = await this.findVisible(id, user);
    if (exp.status !== 'SUBMITTED') throw new BadRequestException('Yalnızca onay bekleyen giderler karara bağlanabilir');
    const check = await this.policy.canApprove(user, exp);
    if (!check.ok) throw new ForbiddenException(check.reason);
    const after = await this.prisma.db.expense.update({ where: { id }, data: { status }, include: INCLUDE });
    await this.audit.log(status === 'APPROVED' ? 'expense.approve' : 'expense.reject', 'Expense', id, {
      before: { status: exp.status },
      after: { status, comment },
    });
    await this.notifications.notify([exp.submittedById], {
      type: status === 'APPROVED' ? 'expense.approved' : 'expense.rejected',
      title: status === 'APPROVED' ? 'Gideriniz onaylandı' : 'Gideriniz reddedildi',
      body: `${exp.description} — ${exp.amount.toFixed(2)} ${exp.currency}${comment ? `\nNot: ${comment}` : ''}`,
      link: `/expenses/${exp.id}`,
      dedupeKey: `expense:${exp.id}:${status}:${Date.now()}`,
    });
    return after;
  }

  @RequirePerms('expense.create')
  @Post(':id/receipts')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async addReceipt(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @CurrentUser() user: AuthUser) {
    const exp = await this.findVisible(id, user);
    const doc = await this.documents.store(file, { kind: 'RECEIPT', expenseId: exp.id, transactionId: exp.transactionId ?? undefined });
    return doc;
  }

  private async userNames(ids: string[]) {
    const users = await this.prisma.db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u]));
  }
}

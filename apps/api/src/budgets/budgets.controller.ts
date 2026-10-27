import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { RequirePerms } from '../common/decorators';
import { D } from '../common/money';
import { assertOwned } from '../common/owned';
import { RequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { BudgetsService, currentPeriod, monthBounds } from './budgets.service';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

class BudgetDto {
  @Matches(PERIOD, { message: 'Dönem YYYY-AA biçiminde olmalı' }) period: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() departmentId?: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) amount: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.1) @Max(1) alertThreshold?: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

class UpdateBudgetDto {
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) amount?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.1) @Max(1) alertThreshold?: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

class CopyDto {
  @Matches(PERIOD) from: string;
  @Matches(PERIOD) to: string;
}

class ApprovalRuleDto {
  @IsString() @IsNotEmpty() @MaxLength(80) name: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) minAmount: number;
  @IsArray() @ArrayMinSize(1) @IsEnum(Role, { each: true }) approverRoles: Role[];
}

class AutoApproveDto {
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) limit?: number | null;
}

@Controller()
export class BudgetsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budgets: BudgetsService,
    private readonly audit: AuditService,
  ) {}

  @RequirePerms('budget.view')
  @Get('budgets')
  async list(@Query('period') period = currentPeriod()) {
    monthBounds(period);
    const rows = await this.prisma.db.budget.findMany({
      where: { period },
      include: { category: { select: { id: true, name: true } }, department: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'asc' }],
    });
    const items = await this.budgets.withActuals(rows);
    const totals: Record<string, { budget: string; actual: string }> = {};
    // Genel toplam yalnızca kategori bütçelerinden (departman bütçeleri aynı gideri ikinci kez sayabilir)
    for (const b of items.filter((x) => x.categoryId && !x.departmentId)) {
      const t = (totals[b.currency] ??= { budget: '0', actual: '0' });
      t.budget = D(t.budget).plus(b.amount).toFixed(2);
      t.actual = D(t.actual).plus(b.actual).toFixed(2);
    }
    return { period, items, totals };
  }

  @RequirePerms('budget.manage')
  @Post('budgets')
  async create(@Body() dto: BudgetDto) {
    if (!dto.categoryId && !dto.departmentId) throw new BadRequestException('Kategori veya departman seçilmeli');
    await assertOwned(this.prisma.db, 'expenseCategory', dto.categoryId, 'Kategori');
    await assertOwned(this.prisma.db, 'department', dto.departmentId, 'Departman');
    const dup = await this.prisma.db.budget.findFirst({
      where: { period: dto.period, categoryId: dto.categoryId ?? null, departmentId: dto.departmentId ?? null },
    });
    if (dup) throw new BadRequestException('Bu dönem için aynı kapsamda bütçe zaten var');
    const row = await this.prisma.db.budget.create({
      data: {
        tenantId: RequestContext.tenantId(),
        period: dto.period,
        categoryId: dto.categoryId || null,
        departmentId: dto.departmentId || null,
        amount: dto.amount,
        currency: (dto.currency ?? 'TRY').toUpperCase(),
        alertThreshold: dto.alertThreshold ?? 0.8,
        note: dto.note,
      },
    });
    await this.audit.log('budget.create', 'Budget', row.id, { after: row });
    return row;
  }

  @RequirePerms('budget.manage')
  @Patch('budgets/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateBudgetDto) {
    const before = await this.prisma.db.budget.findFirstOrThrow({ where: { id } });
    const after = await this.prisma.db.budget.update({ where: { id }, data: dto });
    await this.audit.log('budget.update', 'Budget', id, { before, after });
    return after;
  }

  @RequirePerms('budget.manage')
  @HttpCode(204)
  @Delete('budgets/:id')
  async remove(@Param('id') id: string) {
    const before = await this.prisma.db.budget.findFirstOrThrow({ where: { id } });
    await this.prisma.db.budget.delete({ where: { id } });
    await this.audit.log('budget.delete', 'Budget', id, { before });
  }

  /** Önceki dönemin bütçelerini yeni döneme kopyalar; hedefte aynı kapsam varsa atlanır. */
  @RequirePerms('budget.manage')
  @Post('budgets/copy')
  async copy(@Body() dto: CopyDto) {
    const source = await this.prisma.db.budget.findMany({ where: { period: dto.from } });
    const existing = await this.prisma.db.budget.findMany({ where: { period: dto.to } });
    const key = (b: { categoryId: string | null; departmentId: string | null }) => `${b.categoryId}|${b.departmentId}`;
    const taken = new Set(existing.map(key));
    const toCreate = source.filter((b) => !taken.has(key(b)));
    await this.prisma.db.budget.createMany({
      data: toCreate.map((b) => ({
        tenantId: b.tenantId,
        period: dto.to,
        categoryId: b.categoryId,
        departmentId: b.departmentId,
        amount: b.amount,
        currency: b.currency,
        alertThreshold: b.alertThreshold,
        note: b.note,
      })),
    });
    await this.audit.log('budget.copy', 'Budget', null, { after: { from: dto.from, to: dto.to, created: toCreate.length } });
    return { created: toCreate.length, skipped: source.length - toCreate.length };
  }

  // ───────────── Onay kuralları ─────────────

  @Get('approval-rules')
  async rules() {
    const [items, tenant] = await Promise.all([
      this.prisma.db.approvalRule.findMany({ orderBy: { minAmount: 'asc' } }),
      this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: RequestContext.tenantId() }, select: { expenseAutoApproveLimit: true } }),
    ]);
    return { items, autoApproveLimit: tenant.expenseAutoApproveLimit };
  }

  @RequirePerms('settings.manage')
  @Post('approval-rules')
  async createRule(@Body() dto: ApprovalRuleDto) {
    const row = await this.prisma.db.approvalRule.create({ data: { tenantId: RequestContext.tenantId(), ...dto } });
    await this.audit.log('approvalRule.create', 'ApprovalRule', row.id, { after: row });
    return row;
  }

  @RequirePerms('settings.manage')
  @HttpCode(204)
  @Delete('approval-rules/:id')
  async deleteRule(@Param('id') id: string) {
    const before = await this.prisma.db.approvalRule.findFirstOrThrow({ where: { id } });
    await this.prisma.db.approvalRule.delete({ where: { id } });
    await this.audit.log('approvalRule.delete', 'ApprovalRule', id, { before });
  }

  @RequirePerms('settings.manage')
  @Patch('approval-rules/auto-approve')
  async autoApprove(@Body() dto: AutoApproveDto) {
    const id = RequestContext.tenantId();
    const before = await this.prisma.raw.tenant.findUniqueOrThrow({ where: { id }, select: { expenseAutoApproveLimit: true } });
    const after = await this.prisma.raw.tenant.update({ where: { id }, data: { expenseAutoApproveLimit: dto.limit ?? null }, select: { expenseAutoApproveLimit: true } });
    await this.audit.log('approvalRule.autoApprove', 'Tenant', id, { before, after });
    return after;
  }
}

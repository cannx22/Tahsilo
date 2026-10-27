import { BadRequestException, Body, ConflictException, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePerms } from '../common/decorators';
import { assertOwned } from '../common/owned';
import { pageArgs } from '../common/period';
import { ROLE_LABELS, ROLE_PERMISSIONS } from '../common/permissions';
import { RequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { BranchDto, CategoryDto, CostCenterDto, CreateUserDto, NameDto, TenantDto, UpdateBranchDto, UpdateCategoryDto, UpdateUserDto } from './settings.dto';

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  department: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
} as const;

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───── Referans verileri (tüm oturum açmış kullanıcılar okuyabilir) ─────

  @Get('reference')
  async reference() {
    const db = this.prisma.db;
    const [categories, departments, costCenters, branches] = await Promise.all([
      db.expenseCategory.findMany({ orderBy: { name: 'asc' } }),
      db.department.findMany({ orderBy: { name: 'asc' } }),
      db.costCenter.findMany({ orderBy: { code: 'asc' } }),
      db.branch.findMany({ orderBy: { name: 'asc' } }),
    ]);
    return {
      categories,
      departments,
      costCenters,
      branches,
      roles: Object.entries(ROLE_LABELS).map(([key, label]) => ({
        key,
        label,
        permissions: ROLE_PERMISSIONS[key as keyof typeof ROLE_PERMISSIONS],
      })),
    };
  }

  // ───── Firma ─────

  @Get('tenant')
  tenant() {
    return this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: RequestContext.tenantId() } });
  }

  @RequirePerms('settings.manage')
  @Patch('tenant')
  async updateTenant(@Body() dto: TenantDto) {
    const id = RequestContext.tenantId();
    const before = await this.prisma.raw.tenant.findUniqueOrThrow({ where: { id } });
    const after = await this.prisma.raw.tenant.update({ where: { id }, data: dto });
    await this.audit.log('tenant.update', 'Tenant', id, { before, after });
    return after;
  }

  // ───── Kullanıcılar ─────

  @RequirePerms('settings.users')
  @Get('users')
  users() {
    return this.prisma.db.user.findMany({ select: USER_SELECT, orderBy: { createdAt: 'asc' } });
  }

  @RequirePerms('settings.users')
  @Post('users')
  async createUser(@Body() dto: CreateUserDto) {
    const email = dto.email.toLowerCase();
    if (await this.prisma.raw.user.findUnique({ where: { email } })) {
      throw new ConflictException('Bu e-posta ile kayıtlı bir kullanıcı var');
    }
    await assertOwned(this.prisma.db, 'department', dto.departmentId, 'Departman');
    await assertOwned(this.prisma.db, 'branch', dto.branchId, 'Şube');
    const user = await this.prisma.db.user.create({
      data: {
        tenantId: RequestContext.tenantId(),
        name: dto.name,
        email,
        role: dto.role,
        departmentId: dto.departmentId || null,
        branchId: dto.branchId || null,
        passwordHash: await bcrypt.hash(dto.password, 12),
      },
      select: USER_SELECT,
    });
    await this.audit.log('user.create', 'User', user.id, { after: { email, role: dto.role } });
    return user;
  }

  @RequirePerms('settings.users')
  @Patch('users/:id')
  async updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() me: AuthUser) {
    const before = await this.prisma.db.user.findFirstOrThrow({ where: { id }, select: USER_SELECT });
    if (id === me.id && (dto.isActive === false || (dto.role && dto.role !== 'OWNER'))) {
      throw new BadRequestException('Kendi yetkinizi düşüremez veya hesabınızı pasifleştiremezsiniz');
    }
    if (before.role === 'OWNER' && (dto.isActive === false || (dto.role && dto.role !== 'OWNER'))) {
      const owners = await this.prisma.db.user.count({ where: { role: 'OWNER', isActive: true } });
      if (owners <= 1) throw new BadRequestException('Firmada en az bir aktif yönetici kalmalı');
    }
    await assertOwned(this.prisma.db, 'department', dto.departmentId, 'Departman');
    await assertOwned(this.prisma.db, 'branch', dto.branchId, 'Şube');
    const after = await this.prisma.db.user.update({ where: { id }, data: dto, select: USER_SELECT });
    await this.audit.log('user.update', 'User', id, { before, after });
    return after;
  }

  // ───── Şubeler ─────

  @RequirePerms('settings.manage')
  @Post('branches')
  async createBranch(@Body() dto: BranchDto) {
    const row = await this.prisma.db.branch.create({ data: { tenantId: RequestContext.tenantId(), code: dto.code.toUpperCase(), name: dto.name } });
    await this.audit.log('branch.create', 'Branch', row.id, { after: row });
    return row;
  }

  @RequirePerms('settings.manage')
  @Patch('branches/:id')
  async updateBranch(@Param('id') id: string, @Body() dto: UpdateBranchDto) {
    const before = await this.prisma.db.branch.findFirstOrThrow({ where: { id } });
    const after = await this.prisma.db.branch.update({ where: { id }, data: dto });
    await this.audit.log('branch.update', 'Branch', id, { before, after });
    return after;
  }

  // ───── Departman, maliyet merkezi, kategori ─────

  @RequirePerms('settings.manage')
  @Post('departments')
  async createDepartment(@Body() dto: NameDto) {
    const row = await this.prisma.db.department.create({ data: { tenantId: RequestContext.tenantId(), name: dto.name } });
    await this.audit.log('department.create', 'Department', row.id, { after: row });
    return row;
  }

  @RequirePerms('settings.manage')
  @Post('cost-centers')
  async createCostCenter(@Body() dto: CostCenterDto) {
    const row = await this.prisma.db.costCenter.create({ data: { tenantId: RequestContext.tenantId(), ...dto } });
    await this.audit.log('costCenter.create', 'CostCenter', row.id, { after: row });
    return row;
  }

  @RequirePerms('settings.manage')
  @Post('categories')
  async createCategory(@Body() dto: CategoryDto) {
    const row = await this.prisma.db.expenseCategory.create({
      data: { tenantId: RequestContext.tenantId(), name: dto.name, code: dto.code, keywords: normalizeKeywords(dto.keywords) },
    });
    await this.audit.log('category.create', 'ExpenseCategory', row.id, { after: row });
    return row;
  }

  @RequirePerms('settings.manage')
  @Patch('categories/:id')
  async updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    const before = await this.prisma.db.expenseCategory.findFirstOrThrow({ where: { id } });
    const after = await this.prisma.db.expenseCategory.update({
      where: { id },
      data: { ...dto, keywords: dto.keywords ? normalizeKeywords(dto.keywords) : undefined },
    });
    await this.audit.log('category.update', 'ExpenseCategory', id, { before, after });
    return after;
  }

  // ───── Denetim izi ─────

  @RequirePerms('audit.view')
  @Get('audit-logs')
  async auditLogs(
    @Query('page') page?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('action') action?: string,
  ) {
    const { skip, take, ...meta } = pageArgs(page, 50);
    const where = {
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(action ? { action: { contains: action } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.db.auditLog.count({ where }),
    ]);
    return { items, total, ...meta };
  }
}

function normalizeKeywords(list?: string[]) {
  return [...new Set((list ?? []).map((k) => k.trim().toLocaleLowerCase('tr')).filter(Boolean))];
}

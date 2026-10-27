import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { SyncJobType } from '@prisma/client';
import { IsEnum, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { RequirePerms } from '../common/decorators';
import { pageArgs } from '../common/period';
import { RequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { FULL_SYNC, ErpService } from './erp.service';

class ErpConnectionDto {
  @IsString() @IsNotEmpty() provider: string;
  @IsString() @IsNotEmpty() @MaxLength(80) name: string;
  @IsObject() config: Record<string, string>;
}

class UpdateErpConnectionDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsObject() config?: Record<string, string>;
  @IsOptional() @IsIn(['ACTIVE', 'DISCONNECTED']) status?: 'ACTIVE' | 'DISCONNECTED';
}

class SyncDto {
  @IsString() @IsNotEmpty() connectionId: string;
  @IsOptional() @IsEnum({ ...SyncJobType, FULL: 'FULL' }) type?: SyncJobType | 'FULL';
}

function safe<T extends { configEnc: string }>(c: T) {
  const { configEnc: _omit, ...rest } = c;
  return rest;
}

@Controller('erp')
export class ErpController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly erp: ErpService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  @RequirePerms('erp.view')
  @Get('connections')
  async connections() {
    const rows = await this.prisma.db.erpConnection.findMany({ orderBy: { createdAt: 'asc' } });
    return { providers: this.erp.providers(), items: rows.map(safe) };
  }

  @RequirePerms('settings.manage')
  @Post('connections')
  async create(@Body() dto: ErpConnectionDto) {
    const adapter = this.erp.adapter(dto.provider);
    try {
      await adapter.testConnection(dto.config);
    } catch (e) {
      throw new BadRequestException(`Bağlantı doğrulanamadı: ${(e as Error).message}`);
    }
    const row = await this.prisma.db.erpConnection.create({
      data: { tenantId: RequestContext.tenantId(), provider: dto.provider, name: dto.name, configEnc: this.crypto.encryptJson(dto.config) },
    });
    await this.audit.log('erp.connection.create', 'ErpConnection', row.id, { after: safe(row) });
    return safe(row);
  }

  @RequirePerms('settings.manage')
  @Patch('connections/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateErpConnectionDto) {
    const before = await this.prisma.db.erpConnection.findFirstOrThrow({ where: { id } });
    if (dto.config) {
      try {
        await this.erp.adapter(before.provider).testConnection(dto.config);
      } catch (e) {
        throw new BadRequestException(`Bağlantı doğrulanamadı: ${(e as Error).message}`);
      }
    }
    const after = await this.prisma.db.erpConnection.update({
      where: { id },
      data: {
        name: dto.name,
        status: dto.status ?? (dto.config ? 'ACTIVE' : undefined),
        ...(dto.config ? { configEnc: this.crypto.encryptJson(dto.config), lastError: null } : {}),
      },
    });
    await this.audit.log('erp.connection.update', 'ErpConnection', id, {
      before: safe(before),
      after: { ...safe(after), configChanged: !!dto.config },
    });
    return safe(after);
  }

  @RequirePerms('erp.manage')
  @Post('connections/:id/test')
  async test(@Param('id') id: string) {
    const conn = await this.prisma.db.erpConnection.findFirstOrThrow({ where: { id } });
    try {
      await this.erp.adapter(conn.provider).testConnection(this.crypto.decryptJson(conn.configEnc));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  @RequirePerms('erp.view')
  @Get('sync-jobs')
  async jobs(@Query('connectionId') connectionId?: string, @Query('status') status?: string, @Query('page') page?: string) {
    const { skip, take, ...meta } = pageArgs(page, 50);
    // Banka senkronizasyon işleri banka sayfasında gösterilir
    const where = { connectionId: connectionId || { not: null }, ...(status ? { status: status as any } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.db.syncJob.findMany({
        where,
        include: { connection: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.db.syncJob.count({ where }),
    ]);
    const pending = {
      payments: await this.prisma.db.paymentRequest.count({ where: { status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] }, erpSyncedAt: null } }),
      expenses: await this.prisma.db.expense.count({ where: { status: 'APPROVED', erpSyncedAt: null } }),
    };
    return { items, total, pending, ...meta };
  }

  @RequirePerms('erp.manage')
  @Post('sync-jobs')
  async sync(@Body() dto: SyncDto) {
    const types = !dto.type || dto.type === 'FULL' ? FULL_SYNC : [dto.type];
    const jobs = await this.erp.enqueue(dto.connectionId, types);
    await this.audit.log('erp.sync.enqueue', 'ErpConnection', dto.connectionId, { after: { types, jobs: jobs.map((j) => j.id) } });
    return jobs;
  }

  @RequirePerms('erp.manage')
  @Post('sync-jobs/:id/retry')
  async retry(@Param('id') id: string) {
    const job = await this.prisma.db.syncJob.findFirstOrThrow({ where: { id } });
    if (job.status !== 'FAILED') throw new BadRequestException('Yalnızca başarısız işler yeniden denenebilir');
    const after = await this.prisma.db.syncJob.update({
      where: { id },
      data: { status: 'QUEUED', attempts: 0, permanent: false, runAfter: new Date(), lastError: null, finishedAt: null },
    });
    await this.audit.log('erp.sync.retry', 'SyncJob', id, { before: { status: job.status, error: job.lastError } });
    return after;
  }
}

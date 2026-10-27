import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { Public, RequirePerms } from '../common/decorators';
import { D, parseDateOnly } from '../common/money';
import { assertOwned } from '../common/owned';
import { pageArgs } from '../common/period';
import { RequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionsService } from './collections.service';

class TerminalDto {
  @IsString() @IsNotEmpty() provider: string;
  @IsString() @IsNotEmpty() @MaxLength(80) name: string;
  @IsObject() config: Record<string, string>;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(0.2) commissionRate: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

class UpdateTerminalDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsObject() config?: Record<string, string>;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(0.2) commissionRate?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class PaymentRequestDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) amount: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsString() @IsNotEmpty() @MaxLength(300) description: string;
  @IsOptional() @IsString() invoiceId?: string;
  @IsOptional() @IsString() counterpartyId?: string;
  @IsOptional() @IsEmail() customerEmail?: string;
  @IsOptional() @IsString() terminalId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) expiresInDays?: number;
}

class RefundDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount: number;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

/** Sırlar yanıtlarda asla döndürülmez. */
function publicTerminal<T extends { configEnc: string }>(t: T) {
  const { configEnc: _omit, ...rest } = t;
  return rest;
}

@Controller()
export class CollectionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly collections: CollectionsService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  // ───────────── Terminaller ─────────────

  @RequirePerms('collection.view')
  @Get('terminals')
  async terminals() {
    const rows = await this.prisma.db.terminal.findMany({ orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
    return { providers: this.collections.providers(), items: rows.map(publicTerminal) };
  }

  @RequirePerms('terminal.manage')
  @Post('terminals')
  async createTerminal(@Body() dto: TerminalDto) {
    this.collections.adapter(dto.provider);
    const row = await this.prisma.db.$transaction(async (tx) => {
      const count = await tx.terminal.count();
      const isDefault = dto.isDefault || count === 0;
      if (isDefault) await tx.terminal.updateMany({ data: { isDefault: false } });
      return tx.terminal.create({
        data: {
          tenantId: RequestContext.tenantId(),
          provider: dto.provider,
          name: dto.name,
          configEnc: this.crypto.encryptJson(dto.config),
          commissionRate: dto.commissionRate,
          isDefault,
        },
      });
    });
    await this.audit.log('terminal.create', 'Terminal', row.id, { after: publicTerminal(row) });
    return publicTerminal(row);
  }

  @RequirePerms('terminal.manage')
  @Patch('terminals/:id')
  async updateTerminal(@Param('id') id: string, @Body() dto: UpdateTerminalDto) {
    const before = await this.prisma.db.terminal.findFirstOrThrow({ where: { id } });
    const after = await this.prisma.db.$transaction(async (tx) => {
      if (dto.isDefault) await tx.terminal.updateMany({ data: { isDefault: false } });
      return tx.terminal.update({
        where: { id },
        data: {
          name: dto.name,
          commissionRate: dto.commissionRate,
          isDefault: dto.isDefault,
          isActive: dto.isActive,
          ...(dto.config ? { configEnc: this.crypto.encryptJson(dto.config) } : {}),
        },
      });
    });
    await this.audit.log('terminal.update', 'Terminal', id, {
      before: publicTerminal(before),
      after: { ...publicTerminal(after), configChanged: !!dto.config },
    });
    return publicTerminal(after);
  }

  // ───────────── Ödeme talepleri ─────────────

  @RequirePerms('collection.view')
  @Get('payment-requests')
  async list(
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
  ) {
    const { skip, take, ...meta } = pageArgs(page, 50);
    const where: Prisma.PaymentRequestWhereInput = {
      ...(status ? { status: status as any } : {}),
      ...(q ? { OR: [{ description: { contains: q, mode: 'insensitive' } }, { counterparty: { name: { contains: q, mode: 'insensitive' } } }] } : {}),
      ...(from || to
        ? { createdAt: { ...(from ? { gte: parseDateOnly(from) } : {}), ...(to ? { lt: new Date(parseDateOnly(to).getTime() + 86400000) } : {}) } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.db.paymentRequest.findMany({
        where,
        include: {
          counterparty: { select: { id: true, name: true } },
          invoice: { select: { id: true, number: true } },
          terminal: { select: { id: true, name: true } },
          _count: { select: { attempts: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.db.paymentRequest.count({ where }),
    ]);
    const web = process.env.WEB_URL ?? 'http://localhost:3000';
    return { items: items.map((i) => ({ ...i, link: `${web}/pay/${i.token}` })), total, ...meta };
  }

  @RequirePerms('collection.view')
  @Get('payment-requests/:id')
  async detail(@Param('id') id: string) {
    const req = await this.prisma.db.paymentRequest.findFirstOrThrow({
      where: { id },
      include: {
        counterparty: { select: { id: true, name: true, email: true } },
        invoice: { select: { id: true, number: true, total: true, paidAmount: true, status: true } },
        terminal: { select: { id: true, name: true, provider: true } },
        attempts: { include: { refunds: true }, orderBy: { createdAt: 'desc' } },
      },
    });
    const history = await this.prisma.db.auditLog.findMany({
      where: { OR: [{ entityType: 'PaymentRequest', entityId: id }, { entityType: 'PaymentAttempt', entityId: { in: req.attempts.map((a) => a.id) } }] },
      orderBy: { createdAt: 'desc' },
    });
    const web = process.env.WEB_URL ?? 'http://localhost:3000';
    return { ...req, link: `${web}/pay/${req.token}`, history };
  }

  @RequirePerms('collection.manage')
  @Post('payment-requests')
  async create(@Body() dto: PaymentRequestDto) {
    const db = this.prisma.db;
    await assertOwned(db, 'counterparty', dto.counterpartyId, 'Cari');
    let counterpartyId = dto.counterpartyId || null;
    let currency = (dto.currency ?? 'TRY').toUpperCase();
    if (dto.invoiceId) {
      const inv = await db.invoice.findFirst({ where: { id: dto.invoiceId } });
      if (!inv) throw new BadRequestException('Fatura bulunamadı');
      if (inv.type !== 'SALES') throw new BadRequestException('Ödeme linki yalnızca satış faturası için oluşturulabilir');
      if (inv.status === 'PAID' || inv.status === 'CANCELLED') throw new BadRequestException('Fatura açık değil');
      const remaining = inv.total.minus(inv.paidAmount);
      if (D(dto.amount).gt(remaining)) throw new BadRequestException(`Tutar fatura bakiyesini aşıyor (kalan: ${remaining.toFixed(2)})`);
      counterpartyId = inv.counterpartyId;
      currency = inv.currency;
    }
    const terminal = dto.terminalId
      ? await db.terminal.findFirst({ where: { id: dto.terminalId, isActive: true } })
      : await db.terminal.findFirst({ where: { isActive: true }, orderBy: { isDefault: 'desc' } });
    if (!terminal) throw new BadRequestException('Aktif bir sanal POS terminali tanımlanmalı');

    const row = await db.paymentRequest.create({
      data: {
        tenantId: RequestContext.tenantId(),
        token: CryptoService.token(24),
        terminalId: terminal.id,
        counterpartyId,
        invoiceId: dto.invoiceId || null,
        amount: dto.amount,
        currency,
        description: dto.description,
        customerEmail: dto.customerEmail,
        expiresAt: new Date(Date.now() + (dto.expiresInDays ?? 7) * 86400000),
        createdById: RequestContext.userId(),
      },
    });
    await this.audit.log('paymentRequest.create', 'PaymentRequest', row.id, { after: { ...row, token: undefined } });
    const web = process.env.WEB_URL ?? 'http://localhost:3000';
    return { ...row, link: `${web}/pay/${row.token}` };
  }

  @RequirePerms('collection.manage')
  @Post('payment-requests/:id/cancel')
  async cancel(@Param('id') id: string) {
    const before = await this.prisma.db.paymentRequest.findFirstOrThrow({ where: { id } });
    if (before.status !== 'PENDING') throw new BadRequestException('Yalnızca bekleyen linkler iptal edilebilir');
    const after = await this.prisma.db.paymentRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.log('paymentRequest.cancel', 'PaymentRequest', id, { before: { status: before.status }, after: { status: after.status } });
    return after;
  }

  @RequirePerms('refund.create')
  @Post('payment-attempts/:id/refunds')
  refund(@Param('id') id: string, @Body() dto: RefundDto) {
    return this.collections.refund(id, dto.amount, dto.reason);
  }

  // ───────────── Herkese açık uçlar ─────────────

  @Public()
  @Get('public/pay/:token')
  publicRequest(@Param('token') token: string) {
    return this.collections.publicRequest(token);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('public/pay/:token/checkout')
  checkout(@Param('token') token: string) {
    return this.collections.startCheckout(token);
  }

  @Public()
  @Get('public/pay/:token/result')
  result(@Param('token') token: string, @Query('attempt') attempt: string) {
    return this.collections.publicResult(token, attempt);
  }

  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @Post('webhooks/:provider')
  webhook(@Param('provider') provider: string, @Req() req: Request & { rawBody?: Buffer }, @Body() body: any) {
    return this.collections.handleWebhook(provider, req.headers, req.rawBody, body);
  }
}

import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import * as bcrypt from 'bcryptjs';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators';
import { RequestContext, secureCookies } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

export const PLATFORM_COOKIE = 'tahsilo_platform';
const DUMMY_HASH = bcrypt.hashSync('tahsilo-platform-dummy', 12);

class PlatformLoginDto {
  @IsEmail() email: string;
  @IsString() @IsNotEmpty() password: string;
}

class SuspendDto {
  @IsString() @IsNotEmpty() @MaxLength(300) reason: string;
}

/** Platform yöneticisi oturumu; firma oturumlarından tamamen ayrıdır. */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request & { platformUser?: { id: string; email: string } }>();
    const token = (req as any).cookies?.[PLATFORM_COOKIE];
    if (!token) throw new UnauthorizedException('Platform oturumu yok');
    let payload: { sub: string; scope?: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Oturum süresi doldu');
    }
    if (payload.scope !== 'platform') throw new UnauthorizedException('Geçersiz oturum');
    const user = await this.prisma.raw.platformUser.findUnique({ where: { id: payload.sub } });
    if (!user?.isActive) throw new UnauthorizedException('Kullanıcı aktif değil');
    req.platformUser = { id: user.id, email: user.email };
    const store = RequestContext.current();
    if (store) {
      store.system = true;
      store.userEmail = `platform:${user.email}`;
    }
    return true;
  }
}

/**
 * Tahsilo platform yönetimi. Bilinçli olarak yalnızca firma meta verisi ve sistem sağlığı sunar;
 * hareket, tutar, cari veya belge gibi müşteri finansal verisi döndüren uç yoktur.
 */
@Public()
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('auth/login')
  async login(@Body() dto: PlatformLoginDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.prisma.raw.platformUser.findUnique({ where: { email: dto.email.toLowerCase() } });
    const ok = await bcrypt.compare(dto.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.isActive) throw new UnauthorizedException('E-posta veya parola hatalı');
    await this.prisma.raw.platformUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.log('platform.login', 'PlatformUser', user.id, null, user.email);
    const token = await this.jwt.signAsync({ sub: user.id, scope: 'platform' }, { expiresIn: '4h' });
    res.cookie(PLATFORM_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: secureCookies(), maxAge: 4 * 3600_000, path: '/' });
    return { id: user.id, email: user.email, name: user.name };
  }

  @HttpCode(204)
  @Post('auth/logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(PLATFORM_COOKIE, { path: '/' });
  }

  @UseGuards(PlatformGuard)
  @Get('auth/me')
  me(@Req() req: Request & { platformUser: { id: string } }) {
    return this.prisma.raw.platformUser.findUniqueOrThrow({ where: { id: req.platformUser.id }, select: { id: true, email: true, name: true } });
  }

  @UseGuards(PlatformGuard)
  @Get('tenants')
  async tenants() {
    const tenants = await this.prisma.raw.tenant.findMany({ orderBy: { createdAt: 'desc' } });
    const ids = tenants.map((t) => t.id);
    const [users, lastLogins, txns, conns, erps] = await Promise.all([
      this.prisma.raw.user.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, isActive: true }, _count: true }),
      this.prisma.raw.user.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _max: { lastLoginAt: true } }),
      this.prisma.raw.financialTransaction.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _count: true }),
      this.prisma.raw.bankConnection.groupBy({ by: ['tenantId', 'status'], where: { tenantId: { in: ids } }, _count: true }),
      this.prisma.raw.erpConnection.groupBy({ by: ['tenantId', 'status'], where: { tenantId: { in: ids } }, _count: true }),
    ]);
    return tenants.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      createdAt: t.createdAt,
      suspendedAt: t.suspendedAt,
      activeUsers: users.find((u) => u.tenantId === t.id)?._count ?? 0,
      lastLoginAt: lastLogins.find((u) => u.tenantId === t.id)?._max.lastLoginAt ?? null,
      // Yalnızca sayılar: tutar veya içerik yok
      transactionCount: txns.find((x) => x.tenantId === t.id)?._count ?? 0,
      bankConnections: conns.filter((c) => c.tenantId === t.id).map((c) => ({ status: c.status, count: c._count })),
      erpConnections: erps.filter((c) => c.tenantId === t.id).map((c) => ({ status: c.status, count: c._count })),
    }));
  }

  @UseGuards(PlatformGuard)
  @HttpCode(200)
  @Post('tenants/:id/suspend')
  async suspend(@Param('id') id: string, @Body() dto: SuspendDto) {
    const t = await this.prisma.raw.tenant.update({ where: { id }, data: { suspendedAt: new Date() } });
    await this.log('platform.tenant.suspend', 'Tenant', id, id, undefined, { reason: dto.reason });
    return { id: t.id, suspendedAt: t.suspendedAt };
  }

  @UseGuards(PlatformGuard)
  @HttpCode(200)
  @Post('tenants/:id/unsuspend')
  async unsuspend(@Param('id') id: string) {
    const t = await this.prisma.raw.tenant.update({ where: { id }, data: { suspendedAt: null } });
    await this.log('platform.tenant.unsuspend', 'Tenant', id, id);
    return { id: t.id, suspendedAt: t.suspendedAt };
  }

  @UseGuards(PlatformGuard)
  @Get('health')
  async health() {
    const since = new Date(Date.now() - 24 * 3600_000);
    const started = Date.now();
    await this.prisma.raw.$queryRaw`SELECT 1`;
    const dbLatencyMs = Date.now() - started;
    const [jobs, failedJobs, webhookErrors, webhooksTotal, tenantNames] = await Promise.all([
      this.prisma.raw.syncJob.groupBy({ by: ['status'], _count: true }),
      this.prisma.raw.syncJob.findMany({
        where: { status: 'FAILED', finishedAt: { gte: since } },
        select: { id: true, tenantId: true, type: true, attempts: true, permanent: true, lastError: true, finishedAt: true },
        orderBy: { finishedAt: 'desc' },
        take: 50,
      }),
      this.prisma.raw.webhookEvent.count({ where: { receivedAt: { gte: since }, error: { not: null } } }),
      this.prisma.raw.webhookEvent.count({ where: { receivedAt: { gte: since } } }),
      this.prisma.raw.tenant.findMany({ select: { id: true, name: true } }),
    ]);
    const nameOf = new Map(tenantNames.map((t) => [t.id, t.name]));
    const oldestQueued = await this.prisma.raw.syncJob.findFirst({ where: { status: 'QUEUED' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
    return {
      time: new Date(),
      database: { ok: true, latencyMs: dbLatencyMs },
      queue: {
        byStatus: Object.fromEntries(jobs.map((j) => [j.status, j._count])),
        oldestQueuedAt: oldestQueued?.createdAt ?? null,
      },
      webhooks24h: { total: webhooksTotal, errors: webhookErrors },
      failedJobs24h: failedJobs.map((j) => ({ ...j, tenantName: nameOf.get(j.tenantId) ?? j.tenantId })),
      process: { uptimeSec: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024), node: process.version },
    };
  }

  private async log(action: string, entityType: string, entityId: string, tenantId: string | null, email?: string, after?: object) {
    await this.prisma.raw.auditLog.create({
      data: {
        tenantId,
        action,
        entityType,
        entityId,
        userEmail: email ? `platform:${email}` : RequestContext.current()?.userEmail,
        after: after as any,
        ip: RequestContext.current()?.ip,
      },
    });
  }
}

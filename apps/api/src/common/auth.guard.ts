import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC, PERMS_KEY } from './decorators';
import { hasPermission, Permission } from './permissions';
import { RequestContext } from './request-context';

export const SESSION_COOKIE = 'tahsilo_session';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: any }>();
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('Oturum bulunamadı');

    let payload: { sub: string; purpose?: string; scope?: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Oturum süresi doldu');
    }
    // MFA bileti veya platform yöneticisi oturumu gibi tokenlar firma oturumu yerine kullanılamaz
    if (payload.purpose || payload.scope) throw new UnauthorizedException('Geçersiz oturum');

    // Rol veya aktiflik değişiklikleri anında geçerli olsun diye kullanıcı her istekte okunur.
    const user = await this.prisma.raw.user.findUnique({ where: { id: payload.sub }, include: { tenant: { select: { suspendedAt: true } } } });
    if (!user || !user.isActive) throw new UnauthorizedException('Kullanıcı aktif değil');
    if (user.tenant.suspendedAt) throw new ForbiddenException('Firma hesabı askıya alınmış; Tahsilo destek ekibiyle iletişime geçin');

    // Seçili şube yalnızca bu firmaya aitse uygulanır
    const branchHeader = req.headers['x-branch-id'];
    const branchId = typeof branchHeader === 'string' && branchHeader ? branchHeader : undefined;
    const branch = branchId ? await this.prisma.raw.branch.findFirst({ where: { id: branchId, tenantId: user.tenantId }, select: { id: true } }) : null;

    req.user = {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      role: user.role,
      departmentId: user.departmentId,
    };

    const store = RequestContext.current();
    if (store) {
      store.tenantId = user.tenantId;
      store.userId = user.id;
      store.userEmail = user.email;
      store.role = user.role;
      store.branchId = branch?.id;
    }

    const perms = this.reflector.getAllAndOverride<Permission[]>(PERMS_KEY, targets);
    if (perms?.length && !perms.some((p) => hasPermission(user.role, p))) {
      throw new ForbiddenException('Bu işlem için yetkiniz yok');
    }
    return true;
  }

  private extractToken(req: Request): string | undefined {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    return (req as any).cookies?.[SESSION_COOKIE];
  }
}

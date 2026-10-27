import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { ROLE_PERMISSIONS } from '../common/permissions';
import { RequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto } from './auth.dto';
import { seedTenantDefaults } from './tenant-defaults';
import { generateSecret, otpauthUrl, verifyTotp } from './totp';

const TR_MAP: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };

function slugify(s: string) {
  return s
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşü]/g, (c) => TR_MAP[c])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

// Kullanıcı bulunmadığında da hash karşılaştırması yapılır; yanıt süresinden e-posta keşfi zorlaşır.
const DUMMY_HASH = bcrypt.hashSync('tahsilo-dummy-password', 12);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    if (await this.prisma.raw.user.findUnique({ where: { email } })) {
      throw new ConflictException('Bu e-posta ile kayıtlı bir kullanıcı var');
    }
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const slug = `${slugify(dto.companyName) || 'firma'}-${CryptoService.token(4).toLowerCase()}`;

    const user = await this.prisma.raw.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { name: dto.companyName, slug, taxNumber: dto.taxNumber } });
      await seedTenantDefaults(tx, tenant.id);
      return tx.user.create({
        data: { tenantId: tenant.id, email, name: dto.name, passwordHash, role: 'OWNER' },
      });
    });

    await this.withUserContext(user, () =>
      this.audit.log('tenant.register', 'Tenant', user.tenantId, { after: { company: dto.companyName, owner: email } }),
    );
    return this.issue(user.id);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.raw.user.findUnique({ where: { email: dto.email.toLowerCase() }, include: { tenant: { select: { suspendedAt: true } } } });
    const ok = await bcrypt.compare(dto.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.isActive) throw new UnauthorizedException('E-posta veya parola hatalı');
    if (user.tenant.suspendedAt) throw new ForbiddenException('Firma hesabı askıya alınmış; Tahsilo destek ekibiyle iletişime geçin');

    if (user.mfaEnabled) {
      // Parola doğru; oturum ancak doğrulama kodundan sonra açılır.
      const ticket = await this.jwt.signAsync({ sub: user.id, purpose: 'mfa' }, { expiresIn: '5m' });
      return { mfaRequired: true as const, ticket };
    }
    return this.completeLogin(user);
  }

  async verifyMfaLogin(ticket: string, code: string) {
    let payload: { sub: string; purpose?: string };
    try {
      payload = await this.jwt.verifyAsync(ticket);
    } catch {
      throw new UnauthorizedException('Doğrulama süresi doldu, tekrar giriş yapın');
    }
    if (payload.purpose !== 'mfa') throw new UnauthorizedException('Geçersiz doğrulama isteği');
    const user = await this.prisma.raw.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive || !user.mfaEnabled || !user.mfaSecretEnc) throw new UnauthorizedException('Geçersiz doğrulama isteği');
    if (!verifyTotp(this.crypto.decryptJson<string>(user.mfaSecretEnc), code)) {
      await this.withUserContext(user, () => this.audit.log('auth.mfa_failed', 'User', user.id));
      throw new UnauthorizedException('Doğrulama kodu hatalı');
    }
    return this.completeLogin(user);
  }

  async mfaSetup(userId: string) {
    const user = await this.prisma.raw.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.mfaEnabled) throw new BadRequestException('İki adımlı doğrulama zaten açık');
    const secret = generateSecret();
    await this.prisma.raw.user.update({ where: { id: userId }, data: { mfaSecretEnc: this.crypto.encryptJson(secret) } });
    return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
  }

  async mfaEnable(userId: string, code: string) {
    const user = await this.prisma.raw.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaSecretEnc) throw new BadRequestException('Önce kurulum başlatılmalı');
    if (!verifyTotp(this.crypto.decryptJson<string>(user.mfaSecretEnc), code)) throw new BadRequestException('Doğrulama kodu hatalı');
    await this.prisma.raw.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
    await this.audit.log('auth.mfa_enabled', 'User', userId);
    return { mfaEnabled: true };
  }

  async mfaDisable(userId: string, password: string, code: string) {
    const user = await this.prisma.raw.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaEnabled || !user.mfaSecretEnc) throw new BadRequestException('İki adımlı doğrulama kapalı');
    const ok = (await bcrypt.compare(password, user.passwordHash)) && verifyTotp(this.crypto.decryptJson<string>(user.mfaSecretEnc), code);
    if (!ok) throw new BadRequestException('Parola veya doğrulama kodu hatalı');
    await this.prisma.raw.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecretEnc: null } });
    await this.audit.log('auth.mfa_disabled', 'User', userId);
    return { mfaEnabled: false };
  }

  async changePassword(userId: string, current: string, next: string) {
    const user = await this.prisma.raw.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(current, user.passwordHash))) throw new BadRequestException('Mevcut parola hatalı');
    await this.prisma.raw.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(next, 12) } });
    await this.audit.log('auth.password_changed', 'User', userId);
    return { ok: true };
  }

  private async completeLogin(user: { id: string; tenantId: string; email: string }) {
    await this.prisma.raw.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.withUserContext(user, () => this.audit.log('auth.login', 'User', user.id));
    return this.issue(user.id);
  }

  async me(userId: string) {
    const user = await this.prisma.raw.user.findUniqueOrThrow({
      where: { id: userId },
      include: { tenant: true, department: true, branch: true },
    });
    const branches = await this.prisma.raw.branch.findMany({
      where: { tenantId: user.tenantId, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      permissions: ROLE_PERMISSIONS[user.role],
      mfaEnabled: user.mfaEnabled,
      emailNotifications: user.emailNotifications,
      department: user.department ? { id: user.department.id, name: user.department.name } : null,
      branch: user.branch ? { id: user.branch.id, name: user.branch.name } : null,
      branches,
      tenant: { id: user.tenant.id, name: user.tenant.name, baseCurrency: user.tenant.baseCurrency },
    };
  }

  async updatePreferences(userId: string, prefs: { emailNotifications?: boolean }) {
    await this.prisma.raw.user.update({ where: { id: userId }, data: prefs });
    await this.audit.log('user.preferences', 'User', userId, { after: prefs });
    return this.me(userId);
  }

  private withUserContext<T>(user: { id: string; tenantId: string; email: string }, fn: () => T): T {
    const outer = RequestContext.current();
    return RequestContext.runAsTenant(user.tenantId, fn, {
      userId: user.id,
      userEmail: user.email,
      ip: outer?.ip,
      userAgent: outer?.userAgent,
    });
  }

  private async issue(userId: string) {
    const token = await this.jwt.signAsync({ sub: userId });
    return { token, user: await this.me(userId) };
  }
}

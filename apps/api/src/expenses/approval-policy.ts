import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuthUser } from '../common/decorators';
import { hasPermission, ROLE_PERMISSIONS } from '../common/permissions';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Gider onay politikası: tutara göre en yüksek eşleşen kural onaylayabilecek rolleri belirler.
 * Kural yoksa gider onay yetkisi olan herkes onaylayabilir. Firma sahibi her zaman onaylayabilir;
 * ekip yöneticisi yalnızca kendi departmanının giderini onaylar; kimse kendi giderini onaylayamaz (sahip hariç).
 */
@Injectable()
export class ApprovalPolicy {
  constructor(private readonly prisma: PrismaService) {}

  async requiredRoles(amount: Prisma.Decimal.Value): Promise<Role[] | null> {
    const rule = await this.prisma.db.approvalRule.findFirst({ where: { minAmount: { lte: amount } }, orderBy: { minAmount: 'desc' } });
    return rule ? rule.approverRoles : null;
  }

  async canApprove(user: AuthUser, exp: { amount: Prisma.Decimal; departmentId: string | null; submittedById: string }) {
    if (user.role === 'OWNER') return { ok: true as const };
    if (!hasPermission(user.role, 'expense.approve')) return { ok: false as const, reason: 'Gider onay yetkiniz yok' };
    if (exp.submittedById === user.id) return { ok: false as const, reason: 'Kendi giderinizi onaylayamazsınız' };
    if (user.role === 'MANAGER' && (!user.departmentId || exp.departmentId !== user.departmentId)) {
      return { ok: false as const, reason: 'Yalnızca kendi departmanınızın giderlerini onaylayabilirsiniz' };
    }
    const roles = await this.requiredRoles(exp.amount);
    if (roles && !roles.includes(user.role)) {
      return { ok: false as const, reason: 'Bu tutardaki gider için onay yetkiniz yok (onay kuralı)' };
    }
    return { ok: true as const };
  }

  /** Bu gideri onaylayabilecek kullanıcılar (bildirim için). */
  async approvers(exp: { amount: Prisma.Decimal; departmentId: string | null; submittedById: string }) {
    const roles = await this.requiredRoles(exp.amount);
    const approverRoles = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter(
      (r) => r === 'OWNER' || (ROLE_PERMISSIONS[r].includes('expense.approve') && (!roles || roles.includes(r))),
    );
    const users = await this.prisma.db.user.findMany({
      where: { isActive: true, role: { in: approverRoles }, id: { not: exp.submittedById } },
      select: { id: true, role: true, departmentId: true },
    });
    return users.filter((u) => u.role !== 'MANAGER' || (exp.departmentId && u.departmentId === exp.departmentId)).map((u) => u.id);
  }
}

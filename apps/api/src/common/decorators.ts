import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@prisma/client';
import type { Permission } from './permissions';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMS_KEY = 'perms';
/** Listelenen izinlerden en az biri gerekir. */
export const RequirePerms = (...perms: Permission[]) => SetMetadata(PERMS_KEY, perms);

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: Role;
  departmentId: string | null;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma, type Role } from '@prisma/client';

export interface RequestStore {
  tenantId?: string;
  userId?: string;
  userEmail?: string;
  role?: Role;
  /** Üst bardan seçilen şube; listeler bu şubeyle sınırlanır. */
  branchId?: string;
  ip?: string;
  userAgent?: string;
  /** Tenant kapsamını bilinçli olarak devre dışı bırakır (yalnızca sistem işleri). */
  system?: boolean;
}

const als = new AsyncLocalStorage<RequestStore>();

export const RequestContext = {
  run<T>(store: RequestStore, fn: () => T): T {
    return als.run(store, fn);
  },
  current(): RequestStore | undefined {
    return als.getStore();
  },
  /** Verilen tenant adına çalıştırır (worker, webhook gibi oturumsuz işler için). */
  runAsTenant<T>(tenantId: string, fn: () => T, extra: Partial<RequestStore> = {}): T {
    return als.run({ tenantId, ...extra }, fn);
  },
  tenantId(): string {
    const id = als.getStore()?.tenantId;
    if (!id) throw new Error('Tenant bağlamı yok');
    return id;
  },
  userId(): string {
    const id = als.getStore()?.userId;
    if (!id) throw new Error('Kullanıcı bağlamı yok');
    return id;
  },
};

/** Ham SQL sorguları tenant uzantısından geçmez; seçili şube filtresi bununla eklenir. */
export function branchFilter() {
  const branchId = als.getStore()?.branchId;
  return branchId ? Prisma.sql`AND "branchId" = ${branchId}` : Prisma.empty;
}

/**
 * Oturum çerezlerinin "Secure" olup olmayacağı: kullanıcıların açtığı adres HTTPS ise evet.
 * Coolify'ın ürettiği http://...sslip.io gibi geçici adreslerde Secure çerez tarayıcıda saklanmaz.
 */
export function secureCookies() {
  return (process.env.WEB_URL ?? '').startsWith('https://');
}

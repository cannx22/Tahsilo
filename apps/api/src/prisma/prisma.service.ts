import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { RequestContext } from '../common/request-context';

/** tenantId alanı taşımayan ya da kapsam dışı tutulan modeller */
const UNSCOPED_MODELS = new Set(['Tenant', 'WebhookEvent', 'PlatformUser']);

/**
 * Şube seçiliyken yalnızca liste/özet sorguları şubeye sınırlanır. Tekil okuma ve yazmalar
 * etkilenmez; böylece şube değiştirmek kayıt detayını veya güncellemeyi kırmaz.
 */
const BRANCH_MODELS = new Set(['FinancialTransaction', 'BankAccount', 'CardAccount', 'Expense', 'Invoice']);
const BRANCH_OPS = new Set(['findMany', 'count', 'aggregate', 'groupBy']);

const WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

function scopedTenantId(): string | null {
  const store = RequestContext.current();
  if (store?.tenantId) return store.tenantId;
  if (store?.system) return null;
  // Bağlam yoksa sorgu çalışmaz: tenant izolasyonu "fail closed" ilkesiyle korunur.
  throw new Error('Tenant bağlamı olmadan veri erişimi engellendi');
}

function buildScopedClient(base: PrismaClient) {
  return base.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (UNSCOPED_MODELS.has(model)) return query(args);
          const tenantId = scopedTenantId();
          if (tenantId === null) return query(args);
          const a: any = args ?? {};

          if (WHERE_OPS.has(operation)) {
            a.where = { ...(a.where ?? {}), tenantId };
          }
          const branchId = RequestContext.current()?.branchId;
          if (branchId && BRANCH_MODELS.has(model) && BRANCH_OPS.has(operation)) {
            a.where = { ...a.where, branchId };
          }
          if (operation === 'create') {
            a.data = { ...a.data, tenantId };
          }
          if (operation === 'createMany' || operation === 'createManyAndReturn') {
            a.data = (Array.isArray(a.data) ? a.data : [a.data]).map((d: any) => ({ ...d, tenantId }));
          }
          if (operation === 'upsert') {
            a.create = { ...a.create, tenantId };
          }
          if ((operation === 'update' || operation === 'updateMany' || operation === 'upsert') && a.data?.tenantId) {
            throw new Error('tenantId değiştirilemez');
          }
          return query(a);
        },
      },
    },
  });
}

export type ScopedPrisma = ReturnType<typeof buildScopedClient>;
export type ScopedTx = Omit<ScopedPrisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  /** Tenant kapsamı uygulanmamış istemci: yalnızca kimlik doğrulama ve sistem işleri için. */
  readonly raw: PrismaClient;
  /** Varsayılan istemci: her sorgu aktif tenant'a otomatik sınırlanır. */
  readonly db: ScopedPrisma;

  constructor() {
    this.raw = new PrismaClient();
    this.db = buildScopedClient(this.raw);
  }

  async onModuleInit() {
    await this.raw.$connect();
  }

  async onModuleDestroy() {
    await this.raw.$disconnect();
  }
}

export { Prisma };

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequestContext } from './request-context';

function toJson(value: unknown): any {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Kritik değişikliği kim, ne zaman, hangi kayıt bilgisiyle denetim izine yazar. */
  async log(action: string, entityType: string, entityId: string | null, data: { before?: unknown; after?: unknown } = {}) {
    const ctx = RequestContext.current();
    try {
      await this.prisma.raw.auditLog.create({
        data: {
          tenantId: ctx?.tenantId ?? null,
          userId: ctx?.userId ?? null,
          userEmail: ctx?.userEmail ?? null,
          action,
          entityType,
          entityId,
          before: toJson(data.before),
          after: toJson(data.after),
          ip: ctx?.ip,
          userAgent: ctx?.userAgent?.slice(0, 300),
        },
      });
    } catch (err) {
      // Denetim kaydı yazılamaması sessizce yutulmaz; loglanır.
      this.logger.error(`Audit log yazılamadı: ${action} ${entityType} ${entityId}`, err as Error);
      throw err;
    }
  }
}

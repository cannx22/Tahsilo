import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Prisma, SyncJob } from '@prisma/client';
import { BankingService } from '../banking/banking.service';
import { AuditService } from '../common/audit.service';
import { RequestContext } from '../common/request-context';
import { CollectionsService } from '../collections/collections.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ErpService } from './erp.service';
import { RemindersService } from './reminders.service';

const JOB_LABEL: Record<string, string> = {
  PULL_COUNTERPARTIES: 'ERP cari aktarımı',
  PULL_INVOICES: 'ERP fatura aktarımı',
  PUSH_PAYMENTS: "Tahsilatların ERP'ye aktarımı",
  PUSH_EXPENSES: "Giderlerin ERP'ye aktarımı",
  BANK_SYNC: 'Banka senkronizasyonu',
};

/**
 * Veritabanı tabanlı iş kuyruğu. Birden fazla API örneği çalışsa bile FOR UPDATE SKIP LOCKED
 * sayesinde aynı iş iki kez alınmaz. Redis'e geçildiğinde yalnızca bu sınıf değişir.
 */
@Injectable()
export class JobWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('JobWorker');
  private timer?: NodeJS.Timeout;
  private housekeepingTimer?: NodeJS.Timeout;
  private busy = false;
  private lastReminderRun = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly erp: ErpService,
    private readonly banking: BankingService,
    private readonly collections: CollectionsService,
    private readonly reminders: RemindersService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.WORKER_DISABLED === '1') return;
    this.timer = setInterval(() => void this.tick(), 3000);
    this.housekeepingTimer = setInterval(() => void this.housekeeping(), 60_000);
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
    clearInterval(this.housekeepingTimer);
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      let job: SyncJob | null;
      while ((job = await this.claim())) await this.process(job);
    } catch (e) {
      this.logger.error('Kuyruk işlenemedi', e as Error);
    } finally {
      this.busy = false;
    }
  }

  private async claim(): Promise<SyncJob | null> {
    const rows = await this.prisma.raw.$queryRaw<SyncJob[]>`
      UPDATE "SyncJob" SET status = 'RUNNING', "startedAt" = now(), attempts = attempts + 1
      WHERE id = (
        SELECT id FROM "SyncJob"
        WHERE status = 'QUEUED' AND "runAfter" <= now()
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *`;
    return rows[0] ?? null;
  }

  private async process(job: SyncJob) {
    await RequestContext.runAsTenant(job.tenantId, async () => {
      try {
        const stats = job.type === 'BANK_SYNC' ? await this.banking.sync(job) : await this.erp.run(job);
        await this.prisma.db.syncJob.update({
          where: { id: job.id },
          data: { status: 'SUCCEEDED', finishedAt: new Date(), stats: stats as Prisma.InputJsonValue, lastError: null },
        });
        await this.audit.log('sync.succeeded', 'SyncJob', job.id, { after: { type: job.type, stats } });
      } catch (e) {
        // ErpError ve BankApiError "permanent" alanını taşır: yetki/izin hataları tekrar denenmez
        const permanent = (e as { permanent?: boolean }).permanent === true;
        const exhausted = job.attempts >= job.maxAttempts;
        const message = (e as Error).message.slice(0, 1000);
        if (permanent || exhausted) {
          await this.prisma.db.syncJob.update({
            where: { id: job.id },
            data: { status: 'FAILED', finishedAt: new Date(), lastError: message, permanent },
          });
          await this.audit.log('sync.failed', 'SyncJob', job.id, { after: { type: job.type, error: message, permanent } });
          await this.notifications.notify([...(await this.notifications.usersWithRoles(['OWNER'])), ...(job.createdById ? [job.createdById] : [])], {
            type: 'sync.failed',
            title: `${JOB_LABEL[job.type] ?? job.type} başarısız`,
            body: message,
            link: job.type === 'BANK_SYNC' ? '/banks' : '/erp',
            dedupeKey: `job:${job.id}:failed`,
          });
        } else {
          // Üstel geri çekilme: 10 sn, 20 sn, 40 sn...
          const delay = 10_000 * 2 ** (job.attempts - 1);
          await this.prisma.db.syncJob.update({
            where: { id: job.id },
            data: { status: 'QUEUED', runAfter: new Date(Date.now() + delay), lastError: message },
          });
          this.logger.warn(`İş ${job.id} (${job.type}) ${delay / 1000} sn sonra tekrar denenecek: ${message}`);
        }
      }
    });
  }

  async housekeeping() {
    try {
      // Çöken süreçte RUNNING kalmış işler kuyruğa geri alınır
      await this.prisma.raw.syncJob.updateMany({
        where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
        data: { status: 'QUEUED', runAfter: new Date() },
      });
      await this.collections.expireOld();
      await this.collections.pollStale();
      await this.banking.housekeeping();
      if (Date.now() - this.lastReminderRun > 15 * 60_000) {
        this.lastReminderRun = Date.now();
        await this.runReminders();
      }
    } catch (e) {
      this.logger.error('Bakım işi başarısız', e as Error);
    }
  }

  async runReminders() {
    const tenants = await this.prisma.raw.tenant.findMany({ where: { suspendedAt: null }, select: { id: true } });
    for (const t of tenants) {
      try {
        await RequestContext.runAsTenant(t.id, () => this.reminders.run());
      } catch (e) {
        this.logger.warn(`Hatırlatmalar üretilemedi (${t.id}): ${(e as Error).message}`);
      }
    }
  }
}

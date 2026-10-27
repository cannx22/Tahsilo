import { Injectable, Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import nodemailer, { Transporter } from 'nodemailer';
import { RequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

export interface NotificationInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
  /** Aynı kullanıcıya aynı olay için tek bildirim */
  dedupeKey: string;
}

/**
 * Uygulama içi bildirim + e-posta. SMTP_URL tanımlı değilse e-postalar gönderilmez,
 * STORAGE_DIR/_outbox altına .eml olarak yazılır (geliştirme ortamında incelemek için).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');
  private readonly transport: Transporter | null = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;
  private readonly outbox = path.resolve(process.env.STORAGE_DIR ?? './storage', '_outbox');

  constructor(private readonly prisma: PrismaService) {}

  /** Aktif tenant'ta verilen rollerdeki aktif kullanıcılar */
  async usersWithRoles(roles: Role[]) {
    const users = await this.prisma.db.user.findMany({ where: { role: { in: roles }, isActive: true }, select: { id: true } });
    return users.map((u) => u.id);
  }

  async notify(userIds: string[], input: NotificationInput) {
    const tenantId = RequestContext.tenantId();
    const unique = [...new Set(userIds)];
    if (!unique.length) return 0;
    const created = await this.prisma.db.notification.createManyAndReturn({
      data: unique.map((userId) => ({ tenantId, userId, ...input })),
      skipDuplicates: true,
      select: { id: true, userId: true },
    });
    if (created.length) void this.email(created, input).catch((e) => this.logger.warn(`E-posta gönderilemedi: ${(e as Error).message}`));
    return created.length;
  }

  async notifyRoles(roles: Role[], input: NotificationInput) {
    return this.notify(await this.usersWithRoles(roles), input);
  }

  private async email(created: { id: string; userId: string }[], input: NotificationInput) {
    const users = await this.prisma.raw.user.findMany({
      where: { id: { in: created.map((c) => c.userId) }, emailNotifications: true, isActive: true },
      select: { id: true, email: true, name: true },
    });
    const web = process.env.WEB_URL ?? 'http://localhost:3000';
    for (const u of users) {
      const text = `${input.title}\n\n${input.body ?? ''}${input.link ? `\n\nGörüntüle: ${web}${input.link}` : ''}\n\n— Tahsilo\nBildirim tercihlerinizi Hesabım sayfasından değiştirebilirsiniz.`;
      const message = { from: process.env.MAIL_FROM ?? 'Tahsilo <bildirim@tahsilo.local>', to: u.email, subject: `Tahsilo: ${input.title}`, text };
      if (this.transport) {
        await this.transport.sendMail(message);
      } else {
        await fs.mkdir(this.outbox, { recursive: true });
        const file = path.join(this.outbox, `${Date.now()}-${u.id}.eml`);
        await fs.writeFile(file, `From: ${message.from}\nTo: ${message.to}\nSubject: ${message.subject}\nContent-Type: text/plain; charset=utf-8\n\n${text}\n`);
      }
      await this.prisma.raw.notification.updateMany({
        where: { id: { in: created.filter((c) => c.userId === u.id).map((c) => c.id) } },
        data: { emailedAt: new Date() },
      });
    }
  }
}

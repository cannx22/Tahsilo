import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

/** Her kullanıcı yalnızca kendi bildirimlerini görür. */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('unread') unread?: string) {
    const where = { userId: user.id, ...(unread === 'true' ? { readAt: null } : {}) };
    const [items, unreadCount] = await Promise.all([
      this.prisma.db.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.db.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return { items, unreadCount };
  }

  @HttpCode(200)
  @Post(':id/read')
  async read(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.prisma.db.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }

  @HttpCode(200)
  @Post('read-all')
  async readAll(@CurrentUser() user: AuthUser) {
    const res = await this.prisma.db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: res.count };
  }
}

'use client';

import clsx from 'clsx';
import { CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/badges';
import type { NotificationItem } from '@/components/shell';
import { Button, Card, EmptyState, ErrorBox, Loading, PageHeader, useAction } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { dateTime } from '@/lib/format';

export default function NotificationsPage() {
  const { data, error, reload } = useApi<{ items: NotificationItem[]; unreadCount: number }>('/notifications');
  const { run, busy } = useAction();

  async function markRead(id: string) {
    await api(`/notifications/${id}/read`, { method: 'POST' }).catch(() => undefined);
    void reload();
  }

  return (
    <>
      <PageHeader
        title="Bildirimler"
        description="Son 50 bildirim. E-posta bildirimlerini Hesabım sayfasından açıp kapatabilirsiniz."
        actions={
          !!data?.unreadCount && (
            <Button variant="secondary" loading={busy} onClick={() => run(() => api('/notifications/read-all', { method: 'POST' })).then(() => reload())}>
              <CheckCheck className="h-4 w-4" /> Tümünü okundu say
            </Button>
          )
        }
      />
      <ErrorBox error={error} onRetry={reload} />
      <Card padded={false}>
        {!data ? (
          <Loading />
        ) : data.items.length === 0 ? (
          <EmptyState title="Bildirim yok" description="Onay bekleyen giderler, yaklaşan ödemeler, bütçe ve bağlantı uyarıları burada görünür." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.items.map((n) => (
              <li key={n.id} className={clsx('flex items-start gap-3 px-5 py-3', !n.readAt && 'bg-brand-50/40')}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={clsx('text-sm text-navy', !n.readAt && 'font-semibold')}>{n.title}</span>
                    {n.readAt ? <Badge>Okundu</Badge> : <Badge tone="info">Yeni</Badge>}
                  </div>
                  {n.body && <p className="mt-0.5 whitespace-pre-line text-sm text-muted">{n.body}</p>}
                  <div className="mt-1 text-xs text-muted">{dateTime(n.createdAt)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {n.link && (
                    <Link href={n.link} onClick={() => !n.readAt && markRead(n.id)} className="text-sm font-medium text-brand">
                      Aç
                    </Link>
                  )}
                  {!n.readAt && (
                    <Button variant="ghost" size="sm" onClick={() => markRead(n.id)}>
                      Okundu
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

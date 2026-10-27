'use client';

import { Lock, PauseCircle, PlayCircle, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/badges';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, Stat, Table, Td, Th, formValues, useAction } from '@/components/ui';
import { dateTime, relative } from '@/lib/format';
import { platformApi } from './platform-api';

const JOB_TYPE: Record<string, string> = {
  PULL_COUNTERPARTIES: 'ERP cari aktarımı',
  PULL_INVOICES: 'ERP fatura aktarımı',
  PUSH_PAYMENTS: 'ERP tahsilat aktarımı',
  PUSH_EXPENSES: 'ERP gider aktarımı',
  BANK_SYNC: 'Banka senkronizasyonu',
};

const QUEUE_LABEL: Record<string, string> = { QUEUED: 'Kuyrukta', RUNNING: 'Çalışıyor', SUCCEEDED: 'Başarılı', FAILED: 'Başarısız' };

function counts(list: { status: string; count: number }[]) {
  if (!list.length) return <span className="text-xs text-muted">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((c) => (
        <Badge key={c.status} tone={c.status === 'ACTIVE' ? 'success' : c.status === 'ERROR' || c.status === 'EXPIRED' ? 'danger' : 'neutral'}>
          {c.status} × {c.count}
        </Badge>
      ))}
    </div>
  );
}

function uptime(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d} g ${h} sa` : h ? `${h} sa ${m} dk` : `${m} dk`;
}

export default function PlatformPage() {
  const [tenants, setTenants] = useState<any[] | null>(null);
  const [health, setHealth] = useState<any>(null);
  const [error, setError] = useState<Error | null>(null);
  const [suspending, setSuspending] = useState<any>(null);
  const { run, busy } = useAction();

  const load = useCallback(async () => {
    try {
      const [t, h] = await Promise.all([platformApi('/tenants'), platformApi('/health')]);
      setTenants(t);
      setHealth(h);
      setError(null);
    } catch (e) {
      setError(e as Error);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function suspend(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await run(() => platformApi(`/tenants/${suspending.id}/suspend`, formValues(e.currentTarget)), `${suspending.name} askıya alındı`);
    if (ok) {
      setSuspending(null);
      void load();
    }
  }

  async function unsuspend(t: any) {
    const ok = await run(() => platformApi(`/tenants/${t.id}/unsuspend`, {}), `${t.name} yeniden etkin`);
    if (ok) void load();
  }

  const failed = health?.failedJobs24h ?? [];
  const queue = health?.queue.byStatus ?? {};

  return (
    <>
      <PageHeader
        title="Platform yönetimi"
        description="Firma hesapları ve sistem sağlığı. Liste 30 saniyede bir yenilenir."
        actions={
          <Button variant="secondary" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" /> Yenile
          </Button>
        }
      />
      <Notice>
        <span className="inline-flex items-start gap-2">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          Platform yöneticileri müşterilerin finansal verilerini (hareketler, tutarlar, cariler, belgeler) göremez. Burada yalnızca firma meta verisi,
          kayıt sayıları ve sistem durumu gösterilir. Tüm işlemler denetim kaydına yazılır.
        </span>
      </Notice>
      {error && (
        <div className="mt-4">
          <ErrorBox error={error} onRetry={() => void load()} />
        </div>
      )}

      {!health ? (
        <Loading />
      ) : (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Veritabanı" value={health.database.ok ? `${health.database.latencyMs} ms` : 'Hata'} tone={health.database.ok ? 'success' : 'danger'} hint="Sorgu gecikmesi" />
            <Stat
              label="İş kuyruğu"
              value={`${queue.QUEUED ?? 0} kuyrukta • ${queue.RUNNING ?? 0} çalışıyor`}
              hint={health.queue.oldestQueuedAt ? `En eski bekleyen: ${relative(health.queue.oldestQueuedAt)}` : 'Bekleyen iş yok'}
              tone={(queue.QUEUED ?? 0) > 50 ? 'warning' : 'default'}
            />
            <Stat
              label="Webhook (24 sa)"
              value={`${health.webhooks24h.total} olay`}
              hint={`${health.webhooks24h.errors} hatalı`}
              tone={health.webhooks24h.errors > 0 ? 'warning' : 'default'}
            />
            <Stat label="Süreç" value={uptime(health.process.uptimeSec)} hint={`${health.process.memoryMb} MB bellek • Node ${health.process.node}`} />
          </div>

          <Card title={`Başarısız işler (24 sa) • ${failed.length}`} padded={false} className="mt-6">
            {!failed.length ? (
              <EmptyState title="Son 24 saatte başarısız iş yok" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Zaman</Th>
                    <Th>Firma</Th>
                    <Th>İş</Th>
                    <Th align="right">Deneme</Th>
                    <Th>Hata</Th>
                  </tr>
                </thead>
                <tbody>
                  {failed.map((j: any) => (
                    <tr key={j.id}>
                      <Td className="whitespace-nowrap text-xs text-muted">{dateTime(j.finishedAt)}</Td>
                      <Td>{j.tenantName}</Td>
                      <Td>
                        {JOB_TYPE[j.type] ?? j.type}
                        {j.permanent && (
                          <span className="ml-2">
                            <Badge tone="danger">Kalıcı</Badge>
                          </span>
                        )}
                      </Td>
                      <Td align="right">{j.attempts}</Td>
                      <Td className="max-w-md text-xs text-danger">{j.lastError}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            <div className="border-t border-slate-100 px-4 py-2 text-xs text-muted">
              Kuyruk durumları: {Object.entries(queue).map(([k, v]) => `${QUEUE_LABEL[k] ?? k} ${v}`).join(' • ') || '—'}
            </div>
          </Card>
        </>
      )}

      <Card title={`Firmalar${tenants ? ` • ${tenants.length}` : ''}`} padded={false} className="mt-6">
        {!tenants ? (
          <Loading />
        ) : !tenants.length ? (
          <EmptyState title="Henüz firma yok" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Firma</Th>
                <Th>Kayıt</Th>
                <Th align="right">Aktif kullanıcı</Th>
                <Th>Son giriş</Th>
                <Th align="right">Hareket sayısı</Th>
                <Th>Banka bağlantıları</Th>
                <Th>ERP bağlantıları</Th>
                <Th>Durum</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <Td>
                    <div className="font-medium text-navy">{t.name}</div>
                    <div className="text-xs text-muted">{t.slug}</div>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{dateTime(t.createdAt)}</Td>
                  <Td align="right">{t.activeUsers}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{relative(t.lastLoginAt)}</Td>
                  <Td align="right">{t.transactionCount.toLocaleString('tr-TR')}</Td>
                  <Td>{counts(t.bankConnections)}</Td>
                  <Td>{counts(t.erpConnections)}</Td>
                  <Td>
                    {t.suspendedAt ? (
                      <Badge tone="danger" icon={PauseCircle} title={dateTime(t.suspendedAt)}>
                        Askıda
                      </Badge>
                    ) : (
                      <Badge tone="success" icon={PlayCircle}>
                        Etkin
                      </Badge>
                    )}
                  </Td>
                  <Td align="right">
                    {t.suspendedAt ? (
                      <Button size="sm" variant="secondary" loading={busy} onClick={() => unsuspend(t)}>
                        Askıyı kaldır
                      </Button>
                    ) : (
                      <Button size="sm" variant="danger" onClick={() => setSuspending(t)}>
                        Askıya al
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={!!suspending}
        onClose={() => setSuspending(null)}
        title={`Askıya al • ${suspending?.name ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSuspending(null)}>
              Vazgeç
            </Button>
            <Button type="submit" form="suspend-form" variant="danger" loading={busy}>
              Askıya al
            </Button>
          </>
        }
      >
        <form id="suspend-form" onSubmit={suspend} className="space-y-3">
          <Notice tone="warning">
            Firmanın tüm kullanıcılarının oturumları anında geçersiz olur ve giriş yapamazlar. Veriler silinmez; askı kaldırıldığında erişim geri gelir.
          </Notice>
          <Field label="Gerekçe" hint="Denetim kaydına yazılır">
            <Input name="reason" required maxLength={300} />
          </Field>
        </form>
      </Modal>
    </>
  );
}

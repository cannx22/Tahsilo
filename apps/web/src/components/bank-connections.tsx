'use client';

import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Link2, Plug, RefreshCw, Unplug, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/badges';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Modal, Notice, Select, formValues, useAction } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { date, money, relative } from '@/lib/format';
import { useSession } from '@/lib/session';

const CONNECTION_STATUS: Record<string, { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' | 'info'; icon: typeof CheckCircle2 }> = {
  ACTIVE: { label: 'Bağlı ve güncel', tone: 'success', icon: CheckCircle2 },
  ERROR: { label: 'Bağlantı hatası', tone: 'danger', icon: XCircle },
  EXPIRED: { label: 'İzin süresi doldu', tone: 'warning', icon: AlertTriangle },
  DISCONNECTED: { label: 'Bağlantı kesildi', tone: 'neutral', icon: CircleDashed },
  PENDING_CONSENT: { label: 'İzin bekleniyor', tone: 'info', icon: Clock },
};

const JOB_STATUS: Record<string, { label: string; tone: 'success' | 'danger' | 'neutral' | 'info' }> = {
  QUEUED: { label: 'Kuyrukta', tone: 'neutral' },
  RUNNING: { label: 'Çalışıyor', tone: 'info' },
  SUCCEEDED: { label: 'Başarılı', tone: 'success' },
  FAILED: { label: 'Başarısız', tone: 'danger' },
};

export function ConnectionStatusBadge({ status }: { status: string }) {
  const s = CONNECTION_STATUS[status] ?? { label: status, tone: 'neutral' as const, icon: CircleDashed };
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {s.label}
    </Badge>
  );
}

function daysLeft(iso: string | null) {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

/** Açık bankacılık bağlantıları: izin, senkronizasyon ve bağlantı kesme. */
export function BankConnections({ onChange }: { onChange?: () => void }) {
  const { can } = useSession();
  const { data, error, loading, reload } = useApi<{ providers: { key: string; name: string; bankName: string }[]; items: any[] }>('/bank-connections');
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState<any>(null);
  const { run, busy } = useAction();
  const manage = can('bank.manage');

  // Kuyrukta veya çalışan iş varken liste 3 saniyede bir yenilenir
  const syncing = data?.items.some((c) => c.jobs.some((j: any) => j.status === 'QUEUED' || j.status === 'RUNNING')) ?? false;
  useEffect(() => {
    if (!syncing) return;
    const t = setInterval(() => {
      reload();
      onChange?.();
    }, 3000);
    return () => clearInterval(t);
  }, [syncing, reload, onChange]);

  async function connect(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = await run(() => api<{ authorizeUrl: string }>('/bank-connections', { body: formValues(e.currentTarget) }));
    if (r) window.location.href = r.authorizeUrl;
  }

  async function reauthorize(id: string) {
    const r = await run(() => api<{ authorizeUrl: string }>(`/bank-connections/${id}/reauthorize`, { method: 'POST' }));
    if (r) window.location.href = r.authorizeUrl;
  }

  async function sync(id: string) {
    const ok = await run(() => api(`/bank-connections/${id}/sync`, { method: 'POST' }), 'Senkronizasyon kuyruğa alındı');
    if (ok) reload();
  }

  async function disconnect() {
    const ok = await run(() => api(`/bank-connections/${disconnecting.id}/disconnect`, { method: 'POST' }), 'Bağlantı kesildi');
    if (ok) {
      setDisconnecting(null);
      reload();
      onChange?.();
    }
  }

  const items = data?.items ?? [];

  return (
    <Card
      title="Banka bağlantıları"
      padded={false}
      actions={
        manage && (
          <Button size="sm" onClick={() => setConnecting(true)}>
            <Plug className="h-3.5 w-3.5" /> Banka bağla
          </Button>
        )
      }
    >
      {error ? (
        <div className="p-5">
          <ErrorBox error={error} onRetry={reload} />
        </div>
      ) : !data && loading ? (
        <Loading />
      ) : !items.length ? (
        <EmptyState
          title="Henüz banka bağlantısı yok"
          description="Bankanızda salt okunur izin vererek bakiye ve hareketlerin otomatik alınmasını sağlayabilirsiniz. Bağlantı olmayan hesaplara ekstre dosyası aktarılabilir."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((c) => {
            const left = daysLeft(c.consentExpiresAt);
            const lastJob = c.jobs[0];
            return (
              <li key={c.id} className="space-y-3 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Link2 className="h-4 w-4 text-muted" />
                      <span className="font-medium text-navy">{c.name}</span>
                      <ConnectionStatusBadge status={c.status} />
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                      <span>{data?.providers.find((p) => p.key === c.provider)?.name ?? c.provider}</span>
                      <span>Son senkronizasyon: {relative(c.lastSyncAt)}</span>
                      {c.consentExpiresAt && c.status !== 'DISCONNECTED' && (
                        <span className={left !== null && left < 14 ? 'font-medium text-warning-700' : ''}>
                          İzin bitişi: {date(c.consentExpiresAt)}
                          {left !== null && left >= 0 && left < 14 && ` (${left} gün kaldı)`}
                        </span>
                      )}
                    </div>
                    {c.lastError && c.status !== 'DISCONNECTED' && <div className="mt-1 text-xs text-danger">{c.lastError}</div>}
                  </div>
                  {manage && c.status !== 'DISCONNECTED' && (
                    <div className="flex flex-wrap gap-1">
                      {c.status === 'ACTIVE' && (
                        <Button size="sm" variant="secondary" loading={busy} onClick={() => sync(c.id)}>
                          <RefreshCw className="h-3.5 w-3.5" /> Şimdi senkronize et
                        </Button>
                      )}
                      {(c.status === 'EXPIRED' || c.status === 'ERROR' || (left !== null && left < 14)) && (
                        <Button size="sm" variant={c.status === 'ACTIVE' ? 'secondary' : 'primary'} loading={busy} onClick={() => reauthorize(c.id)}>
                          İzni yenile
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setDisconnecting(c)}>
                        <Unplug className="h-3.5 w-3.5" /> Bağlantıyı kes
                      </Button>
                    </div>
                  )}
                </div>

                {c.accounts.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {c.accounts.map((a: any) => (
                      <div key={a.id} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                        <div className="text-sm font-medium text-navy">{a.name}</div>
                        <div className="text-xs text-muted">{a.ibanMasked ?? a.currency}</div>
                        <div className="mt-1 text-sm font-semibold tabular-nums text-navy">{money(a.balance, a.currency)}</div>
                        <div className="text-xs text-muted">{a.balanceAsOf ? relative(a.balanceAsOf) : 'Henüz alınmadı'}</div>
                      </div>
                    ))}
                  </div>
                )}

                {c.jobs.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted">Son senkronizasyonlar</div>
                    {c.jobs.map((j: any) => {
                      const s = JOB_STATUS[j.status] ?? { label: j.status, tone: 'neutral' as const };
                      return (
                        <div key={j.id} className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge tone={s.tone}>{s.label}</Badge>
                          <span className="text-muted">{relative(j.finishedAt ?? j.createdAt)}</span>
                          {j.stats && (
                            <span className="text-navy">
                              {j.stats.created ?? 0} yeni hareket • {j.stats.booked ?? 0} kesinleşen
                            </span>
                          )}
                          {j.status !== 'SUCCEEDED' && j.attempts > 0 && <span className="text-muted">deneme {j.attempts}</span>}
                          {j.lastError && <span className="text-danger">{j.lastError}</span>}
                        </div>
                      );
                    })}
                    {lastJob && (lastJob.status === 'QUEUED' || lastJob.status === 'RUNNING') && (
                      <div className="text-xs text-muted">Hareketler arka planda alınıyor…</div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={connecting}
        onClose={() => setConnecting(false)}
        title="Banka bağla"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConnecting(false)}>
              Vazgeç
            </Button>
            <Button type="submit" form="bank-connect-form" loading={busy}>
              Bankaya git
            </Button>
          </>
        }
      >
        <form id="bank-connect-form" onSubmit={connect} className="space-y-3">
          <Notice>
            Bankanızın güvenli sayfasına yönlendirileceksiniz. Tahsilo yalnızca okuma izni ister: hesap listesi, bakiye ve hareketler. Para transferi
            yapılamaz. İzin 90 gün geçerlidir.
          </Notice>
          <Field label="Banka / sağlayıcı">
            <Select name="provider" required defaultValue={data?.providers[0]?.key}>
              {data?.providers.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Bağlantı adı" hint="Listede görünecek ad">
            <Input name="name" required maxLength={80} defaultValue={data?.providers[0]?.bankName ?? ''} />
          </Field>
        </form>
      </Modal>

      <Modal
        open={!!disconnecting}
        onClose={() => setDisconnecting(null)}
        title={`Bağlantıyı kes • ${disconnecting?.name ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDisconnecting(null)}>
              Vazgeç
            </Button>
            <Button variant="danger" loading={busy} onClick={disconnect}>
              Bağlantıyı kes
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-navy">
          <p>Bankadan otomatik veri alımı durur ve erişim belirteci silinir.</p>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li>Hesaplar ve bugüne kadar alınan hareketler korunur.</li>
            <li>Bu hesaplara bundan sonra ekstre dosyası aktarılabilir ve manuel bakiye girilebilir.</li>
            <li>İsterseniz daha sonra yeniden bağlayabilirsiniz; aynı hesaplar tekrar eşleştirilir.</li>
          </ul>
        </div>
      </Modal>
    </Card>
  );
}

'use client';

import { Plus, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, StatusBadge } from '@/components/badges';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Modal, PageHeader, Pagination, Select, Stat, Table, Td, Th, formValues, useAction, useToast } from '@/components/ui';
import { api, qs, useApi } from '@/lib/api';
import { dateTime, relative } from '@/lib/format';
import { useSession } from '@/lib/session';

const JOB_LABEL: Record<string, string> = {
  PULL_COUNTERPARTIES: 'Cari kartları al',
  PULL_INVOICES: 'Faturaları al',
  PUSH_PAYMENTS: 'Tahsilatları gönder',
  PUSH_EXPENSES: 'Giderleri gönder',
};

const STAT_LABEL: Record<string, string> = { received: 'alındı', created: 'yeni', updated: 'güncellendi', pending: 'bekleyen', pushed: 'gönderildi' };

function statsSummary(stats: any) {
  if (!stats) return '—';
  const parts = Object.entries(stats)
    .filter(([k, v]) => typeof v === 'number' && STAT_LABEL[k])
    .map(([k, v]) => `${v} ${STAT_LABEL[k]}`);
  const skipped = Array.isArray(stats.skipped) && stats.skipped.length ? `, ${stats.skipped.length} atlandı` : '';
  return parts.join(', ') + skipped;
}

function ConnectionModal({ open, onClose, providers, onSaved }: { open: boolean; onClose: () => void; providers: any[]; onSaved: () => void }) {
  const { run, busy } = useAction();
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const config: Record<string, string> = { companyCode: v.companyCode, apiKey: v.apiKey };
    if (v.failRate) config.failRate = v.failRate;
    const ok = await run(() => api('/erp/connections', { body: { provider: v.provider, name: v.name, config } }), 'ERP bağlantısı kuruldu');
    if (ok) {
      onSaved();
      onClose();
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="ERP bağlantısı ekle">
      <form onSubmit={submit} className="space-y-4">
        <Field label="ERP">
          <Select name="provider">
            {providers.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Bağlantı adı">
          <Input name="name" required maxLength={80} placeholder="Ör. Muhasebe ERP" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Şirket kodu">
            <Input name="companyCode" required pattern="[A-Za-z0-9_-]+" />
          </Field>
          <Field label="API anahtarı">
            <Input name="apiKey" required type="password" autoComplete="new-password" />
          </Field>
        </div>
        <Field label="Hata oranı (sandbox)" hint="0–1 arası. Yeniden deneme davranışını görmek için ör. 0.5 girin. 'invalid' anahtar kalıcı yetki hatası üretir.">
          <Input name="failRate" type="number" step="0.1" min="0" max="1" />
        </Field>
        <p className="text-xs text-muted">Bağlantı kaydedilmeden önce test edilir. Kimlik bilgileri şifreli saklanır ve tekrar gösterilmez.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" loading={busy}>
            Test et ve kaydet
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function ErpPage() {
  const { can } = useSession();
  const toast = useToast();
  const manage = can('erp.manage');
  const conns = useApi<any>('/erp/connections');
  const [page, setPage] = useState(1);
  const jobs = useApi<any>(`/erp/sync-jobs${qs({ page })}`);
  const [creating, setCreating] = useState(false);
  const { run, busy } = useAction();

  const active = jobs.data?.items.some((j: any) => j.status === 'QUEUED' || j.status === 'RUNNING');
  const reloadJobs = jobs.reload;
  const reloadConns = conns.reload;
  // Kuyrukta iş varken liste kendiliğinden yenilenir
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      void reloadJobs();
      void reloadConns();
    }, 3000);
    return () => clearInterval(t);
  }, [active, reloadJobs, reloadConns]);

  const sync = (connectionId: string, type: string) =>
    run(() => api('/erp/sync-jobs', { body: { connectionId, type } }), type === 'FULL' ? 'Tam senkronizasyon kuyruğa alındı' : 'İş kuyruğa alındı').then(reloadJobs);

  if (conns.error) return <ErrorBox error={conns.error} onRetry={reloadConns} />;
  if (!conns.data) return <Loading />;

  return (
    <>
      <PageHeader
        title="ERP"
        description="Cari ve faturalar ERP'den alınır; tahsilat sonuçları ve onaylı giderler ERP'ye gönderilir. Aynı kayıt tekrar gönderilse de ERP'de mükerrer kayıt oluşmaz."
        actions={
          can('settings.manage') && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Bağlantı ekle
            </Button>
          )
        }
      />

      {jobs.data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <Stat label="ERP'ye gönderilmeyi bekleyen tahsilat" value={jobs.data.pending.payments} />
          <Stat label="ERP'ye gönderilmeyi bekleyen onaylı gider" value={jobs.data.pending.expenses} />
        </div>
      )}

      <Card title="Bağlantılar" padded={false}>
        {!conns.data.items.length ? (
          <EmptyState title="ERP bağlantısı yok" description="Bağlantı kurarak cari ve faturaları otomatik alın." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {conns.data.items.map((c: any) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-navy">{c.name}</span>
                    <StatusBadge status={c.status} />
                  </div>
                  <div className="text-xs text-muted">
                    {conns.data.providers.find((p: any) => p.key === c.provider)?.name ?? c.provider} • son senkronizasyon {relative(c.lastSyncAt)}
                  </div>
                  {c.lastError && <div className="mt-1 text-xs text-danger">{c.lastError}</div>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {manage && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={async () => {
                          const r = await run(() => api<{ ok: boolean; error?: string }>(`/erp/connections/${c.id}/test`, { method: 'POST' }));
                          if (r) toast(r.ok ? 'Bağlantı başarılı' : `Bağlantı başarısız: ${r.error}`, r.ok ? 'success' : 'error');
                        }}
                      >
                        Test et
                      </Button>
                      {c.status !== 'DISCONNECTED' && (
                        <>
                          <Select className="w-44 py-1.5 text-xs" value="" onChange={(e) => e.target.value && sync(c.id, e.target.value)} aria-label="Tek iş başlat">
                            <option value="">Tek iş başlat…</option>
                            {Object.entries(JOB_LABEL).map(([k, l]) => (
                              <option key={k} value={k}>
                                {l}
                              </option>
                            ))}
                          </Select>
                          <Button size="sm" disabled={busy} onClick={() => sync(c.id, 'FULL')}>
                            <RefreshCw className="h-3.5 w-3.5" /> Senkronize et
                          </Button>
                        </>
                      )}
                    </>
                  )}
                  {can('settings.manage') && (
                    <Button
                      size="sm"
                      variant={c.status === 'DISCONNECTED' ? 'secondary' : 'danger'}
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => api(`/erp/connections/${c.id}`, { method: 'PATCH', body: { status: c.status === 'DISCONNECTED' ? 'ACTIVE' : 'DISCONNECTED' } }),
                          c.status === 'DISCONNECTED' ? 'Bağlantı etkinleştirildi' : 'Bağlantı devre dışı',
                        ).then(reloadConns)
                      }
                    >
                      {c.status === 'DISCONNECTED' ? 'Etkinleştir' : 'Devre dışı bırak'}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Senkronizasyon işleri"
        padded={false}
        className="mt-6"
        actions={
          <button onClick={() => reloadJobs()} className="inline-flex items-center gap-1 text-xs text-muted hover:text-navy">
            <RefreshCw className={active ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /> {active ? 'Otomatik yenileniyor' : 'Yenile'}
          </button>
        }
      >
        <ErrorBox error={jobs.error} />
        {!jobs.data ? (
          <Loading />
        ) : !jobs.data.items.length ? (
          <EmptyState title="Henüz iş yok" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Oluşturma</Th>
                  <Th>İş</Th>
                  <Th>Durum</Th>
                  <Th>Deneme</Th>
                  <Th>Sonuç</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {jobs.data.items.map((j: any) => (
                  <tr key={j.id} className="align-top">
                    <Td className="text-xs text-muted">
                      {dateTime(j.createdAt)}
                      {j.finishedAt && <div>Bitiş: {dateTime(j.finishedAt)}</div>}
                    </Td>
                    <Td>
                      <span className="font-medium text-navy">{JOB_LABEL[j.type] ?? j.type}</span>
                      <div className="text-xs text-muted">{j.connection?.name}</div>
                    </Td>
                    <Td>
                      <StatusBadge status={j.status} />
                      {j.status === 'QUEUED' && j.attempts > 0 && <div className="mt-1 text-xs text-muted">Tekrar: {dateTime(j.runAfter)}</div>}
                    </Td>
                    <Td className="text-xs">
                      {j.attempts}/{j.maxAttempts}
                    </Td>
                    <Td className="max-w-md text-xs">
                      {j.status === 'SUCCEEDED' && <span className="text-navy">{statsSummary(j.stats)}</span>}
                      {j.lastError && (
                        <div className="text-danger">
                          {j.permanent && (
                            <Badge tone="danger" title="Tekrar denemek anlamsız; yapılandırmayı düzeltin">
                              Kalıcı hata
                            </Badge>
                          )}{' '}
                          {j.lastError}
                        </div>
                      )}
                      {Array.isArray(j.stats?.skipped) && j.stats.skipped.length > 0 && <div className="text-warning-700">{j.stats.skipped.slice(0, 3).join('; ')}</div>}
                    </Td>
                    <Td align="right">
                      {j.status === 'FAILED' && manage && (
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => api(`/erp/sync-jobs/${j.id}/retry`, { method: 'POST' }), 'İş yeniden kuyruğa alındı').then(reloadJobs)}>
                          Yeniden dene
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={jobs.data.page} pageSize={jobs.data.pageSize} total={jobs.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <ConnectionModal open={creating} onClose={() => setCreating(false)} providers={conns.data.providers} onSaved={reloadConns} />
    </>
  );
}

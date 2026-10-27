'use client';

import clsx from 'clsx';
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Badge } from '@/components/badges';
import { BUDGET_STATE, BudgetRow, BudgetState, scopeLabel } from '@/components/budget-labels';
import { useReference } from '@/components/expense-form';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, Select, Stat, Table, Td, Th, formValues, useAction, useToast } from '@/components/ui';
import { api, qs, useApi } from '@/lib/api';
import { money } from '@/lib/format';
import { useSession } from '@/lib/session';

function shiftMonth(period: string, delta: number) {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function Progress({ ratio, state }: { ratio: number; state: BudgetState }) {
  const s = BUDGET_STATE[state];
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className={clsx('h-full rounded-full', s.bar)} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
      <span className="w-12 text-right text-xs tabular-nums text-navy">%{Math.round(ratio * 100)}</span>
    </div>
  );
}

function BudgetPage() {
  const { can } = useSession();
  const initial = useSearchParams().get('period');
  const [period, setPeriod] = useState(initial && /^\d{4}-\d{2}$/.test(initial) ? initial : new Date().toISOString().slice(0, 7));
  const { data, error, reload } = useApi<{ period: string; items: BudgetRow[]; totals: Record<string, { budget: string; actual: string }> }>(`/budgets${qs({ period })}`);
  const ref = useReference();
  const { run, busy } = useAction();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BudgetRow | null>(null);
  const manage = can('budget.manage');

  const counts = { WARNING: 0, EXCEEDED: 0 };
  data?.items.forEach((b) => b.state !== 'OK' && counts[b.state]++);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const ok = await run(
      () =>
        api('/budgets', {
          body: {
            period,
            categoryId: v.categoryId,
            departmentId: v.departmentId,
            amount: Number(v.amount),
            alertThreshold: v.threshold ? Number(v.threshold) / 100 : undefined,
            note: v.note,
          },
        }),
      'Bütçe eklendi',
    );
    if (ok) {
      setCreating(false);
      reload();
    }
  }

  async function update(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const v = formValues(e.currentTarget);
    const ok = await run(
      () => api(`/budgets/${editing.id}`, { method: 'PATCH', body: { amount: Number(v.amount), alertThreshold: Number(v.threshold) / 100, note: v.note ?? '' } }),
      'Bütçe güncellendi',
    );
    if (ok) {
      setEditing(null);
      reload();
    }
  }

  return (
    <>
      <PageHeader
        title="Bütçe"
        description="Aylık kategori ve departman bütçeleri; gerçekleşen giderlerle karşılaştırılır. Eşik aşılınca yöneticiye bildirim gider."
        actions={
          manage && (
            <>
              <Button
                variant="secondary"
                loading={busy}
                onClick={() =>
                  run(() => api<{ created: number; skipped: number }>('/budgets/copy', { body: { from: shiftMonth(period, -1), to: period } })).then((r) => {
                    if (!r) return;
                    toast(`${r.created} bütçe kopyalandı${r.skipped ? `, ${r.skipped} tanesi bu dönemde zaten vardı` : ''}`);
                    reload();
                  })
                }
              >
                <Copy className="h-4 w-4" /> Önceki aydan kopyala
              </Button>
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> Bütçe ekle
              </Button>
            </>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setPeriod(shiftMonth(period, -1))} aria-label="Önceki ay">
          ‹
        </Button>
        <Input type="month" className="w-44" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} aria-label="Dönem" />
        <Button variant="secondary" size="sm" onClick={() => setPeriod(shiftMonth(period, 1))} aria-label="Sonraki ay">
          ›
        </Button>
      </div>

      <ErrorBox error={error} onRetry={reload} />
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <Stat
              label="Gerçekleşen / toplam bütçe"
              value={
                Object.keys(data.totals).length
                  ? Object.entries(data.totals).map(([c, t]) => `${money(t.actual, c)} / ${money(t.budget, c)}`).join(' · ')
                  : '—'
              }
              hint="Yalnızca kategori bütçeleri toplanır; departman bütçeleri aynı gideri ikinci kez sayabileceği için toplama katılmaz."
            />
            <Stat label="Eşiğe yaklaşan" value={counts.WARNING} tone={counts.WARNING ? 'warning' : 'default'} />
            <Stat label="Aşılan" value={counts.EXCEEDED} tone={counts.EXCEEDED ? 'danger' : 'default'} />
          </div>

          <Card padded={false}>
            {data.items.length === 0 ? (
              <EmptyState
                title="Bu dönem için bütçe yok"
                description={manage ? 'Bütçe ekleyin veya önceki ayın bütçelerini kopyalayın.' : 'Bütçeleri firma yöneticisi tanımlar.'}
              />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Kapsam</Th>
                    <Th align="right">Bütçe</Th>
                    <Th align="right">Gerçekleşen</Th>
                    <Th align="right">Kalan</Th>
                    <Th>Kullanım</Th>
                    <Th>Durum</Th>
                    <Th align="right">Eşik</Th>
                    {manage && <Th />}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((b) => {
                    const s = BUDGET_STATE[b.state];
                    return (
                      <tr key={b.id} className="hover:bg-slate-50">
                        <Td>
                          <div className="font-medium text-navy">{scopeLabel(b)}</div>
                          <div className="text-xs text-muted">
                            {b.category && b.department ? 'Kategori + departman' : b.category ? 'Kategori' : 'Departman'}
                            {b.note ? ` • ${b.note}` : ''}
                          </div>
                        </Td>
                        <Td align="right">{money(b.amount, b.currency)}</Td>
                        <Td align="right">{money(b.actual, b.currency)}</Td>
                        <Td align="right" className={Number(b.remaining) < 0 ? 'text-danger' : ''}>
                          {money(b.remaining, b.currency)}
                        </Td>
                        <Td>
                          <Progress ratio={b.ratio} state={b.state} />
                        </Td>
                        <Td>
                          <Badge tone={s.tone} icon={s.icon}>
                            {s.label}
                          </Badge>
                        </Td>
                        <Td align="right">%{Math.round(Number(b.alertThreshold) * 100)}</Td>
                        {manage && (
                          <Td align="right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="sm" onClick={() => setEditing(b)} aria-label="Düzenle">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label="Sil"
                                onClick={() => {
                                  if (!confirm(`"${scopeLabel(b)}" bütçesi silinsin mi?`)) return;
                                  void run(() => api(`/budgets/${b.id}`, { method: 'DELETE' }), 'Bütçe silindi').then(() => reload());
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-danger" />
                              </Button>
                            </div>
                          </Td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
          <p className="mt-3 text-xs text-muted">
            Gerçekleşen: kategori bütçelerinde o kategoriye atanmış para çıkışları ve hareketsiz (nakit) giderler; departman bütçelerinde departmanın reddedilmemiş giderleri. Sanal POS kayıtları ve iptal edilen hareketler sayılmaz.
          </p>
        </>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={`Bütçe ekle — ${period}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Vazgeç
            </Button>
            <Button type="submit" form="budget-create" loading={busy}>
              Kaydet
            </Button>
          </>
        }
      >
        <form id="budget-create" onSubmit={create} className="space-y-4">
          <Notice>Kategori, departman veya ikisini birlikte seçin. Aynı dönemde aynı kapsam için tek bütçe tanımlanabilir.</Notice>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Kategori">
              <Select name="categoryId" defaultValue="">
                <option value="">—</option>
                {ref.data?.categories.filter((c) => c.isActive).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Departman">
              <Select name="departmentId" defaultValue="">
                <option value="">—</option>
                {ref.data?.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tutar (TRY)">
              <Input name="amount" type="number" step="0.01" min="1" required />
            </Field>
            <Field label="Uyarı eşiği (%)" hint="Gerçekleşen bu orana gelince uyarı üretilir">
              <Input name="threshold" type="number" min="10" max="100" defaultValue="80" />
            </Field>
          </div>
          <Field label="Not">
            <Input name="note" maxLength={300} />
          </Field>
        </form>
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Bütçeyi düzenle — ${scopeLabel(editing)}` : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Vazgeç
            </Button>
            <Button type="submit" form="budget-edit" loading={busy}>
              Kaydet
            </Button>
          </>
        }
      >
        {editing && (
          <form id="budget-edit" onSubmit={update} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`Tutar (${editing.currency})`}>
                <Input name="amount" type="number" step="0.01" min="1" required defaultValue={editing.amount} />
              </Field>
              <Field label="Uyarı eşiği (%)">
                <Input name="threshold" type="number" min="10" max="100" required defaultValue={Math.round(Number(editing.alertThreshold) * 100)} />
              </Field>
            </div>
            <Field label="Not">
              <Input name="note" maxLength={300} defaultValue={editing.note ?? ''} />
            </Field>
          </form>
        )}
      </Modal>
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <BudgetPage />
    </Suspense>
  );
}

'use client';

import { Check, Plus, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { SourceBadge, SourceTypeLabel, StatusBadge } from '@/components/badges';
import { useReference } from '@/components/expense-form';
import { Amount } from '@/components/money';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Modal, PageHeader, Pagination, Select, Table, Td, Textarea, Th, formValues, useAction } from '@/components/ui';
import { api, qs, useApi } from '@/lib/api';
import { date, isoDate, money } from '@/lib/format';
import { useSession } from '@/lib/session';

interface Filters {
  q: string;
  sourceType: string;
  dataSource: string;
  direction: string;
  status: string;
  reconStatus: string;
  uncategorized: string;
  account: string;
  from: string;
  to: string;
}

function TransactionsInner() {
  const { can, period } = useSession();
  const params = useSearchParams();
  const ref = useReference();
  const banks = useApi<any[]>(can('bank.view') ? '/bank-accounts' : null);
  const cards = useApi<any[]>('/card-accounts');
  const [filters, setFilters] = useState<Filters>({
    q: '',
    sourceType: params.get('sourceType') ?? '',
    dataSource: '',
    direction: params.get('direction') ?? '',
    status: '',
    reconStatus: params.get('reconStatus') ?? '',
    uncategorized: '',
    account: '',
    from: params.get('from') ?? period.from,
    to: params.get('to') ?? period.to,
  });
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState('');
  const [manual, setManual] = useState(false);
  const { run, busy } = useAction();

  // Arama alanı yazarken her tuşta istek atılmasın
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === q ? f : { ...f, q })), 350);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [filters]);

  const [accKind, accId] = filters.account.split(':');
  const path = `/transactions${qs({
    q: filters.q,
    sourceType: filters.sourceType,
    dataSource: filters.dataSource,
    direction: filters.direction,
    status: filters.status,
    reconStatus: filters.reconStatus,
    uncategorized: filters.uncategorized,
    bankAccountId: accKind === 'bank' ? accId : undefined,
    cardAccountId: accKind === 'card' ? accId : undefined,
    from: filters.from,
    to: filters.to,
    page,
    pageSize: 50,
  })}`;
  const { data, error, loading, reload } = useApi<any>(path);

  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const editable = can('txn.edit');

  async function categorize(ids: string[], categoryId: string) {
    const ok = await run(() => api('/transactions/bulk-categorize', { body: { ids, categoryId } }), `${ids.length} hareket kategorilendi`);
    if (ok) {
      setSelected(new Set());
      setBulkCategory('');
      reload();
    }
  }

  async function createManual(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const [kind, id] = (v.account ?? '').split(':');
    const body: Record<string, unknown> = { ...v, amount: Number(v.amount) };
    delete body.account;
    if (kind === 'bank') body.bankAccountId = id;
    if (kind === 'card') body.cardAccountId = id;
    const ok = await run(() => api('/transactions', { body }), 'Manuel kayıt oluşturuldu');
    if (ok) {
      setManual(false);
      reload();
    }
  }

  const items: any[] = data?.items ?? [];
  const allSelected = items.length > 0 && items.every((t) => selected.has(t.id));

  return (
    <>
      <PageHeader
        title="Hareketler"
        description="Banka, kart, sanal POS ve manuel kayıtların ortak görünümü. Her satırda kaynak ve veri kalitesi gösterilir."
        actions={
          editable && (
            <Button onClick={() => setManual(true)}>
              <Plus className="h-4 w-4" /> Manuel kayıt
            </Button>
          )
        }
      />

      <Card className="mb-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <Field label="Ara" className="col-span-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Açıklama, karşı taraf, referans" />
          </Field>
          <Field label="Başlangıç">
            <Input type="date" value={filters.from} onChange={set('from')} />
          </Field>
          <Field label="Bitiş">
            <Input type="date" value={filters.to} onChange={set('to')} />
          </Field>
          <Field label="Kaynak">
            <Select value={filters.sourceType} onChange={set('sourceType')}>
              <option value="">Tümü</option>
              <option value="BANK">Banka</option>
              <option value="CARD">Kart</option>
              <option value="POS">Sanal POS</option>
              <option value="MANUAL">Manuel</option>
            </Select>
          </Field>
          <Field label="Veri kalitesi">
            <Select value={filters.dataSource} onChange={set('dataSource')}>
              <option value="">Tümü</option>
              <option value="CONNECTED">Bağlı (API)</option>
              <option value="IMPORTED">Dosyadan</option>
              <option value="MANUAL">Manuel</option>
            </Select>
          </Field>
          <Field label="Yön">
            <Select value={filters.direction} onChange={set('direction')}>
              <option value="">Tümü</option>
              <option value="IN">Giriş</option>
              <option value="OUT">Çıkış</option>
            </Select>
          </Field>
          <Field label="Durum">
            <Select value={filters.status} onChange={set('status')}>
              <option value="">Tümü</option>
              <option value="PENDING">Bekliyor / provizyon</option>
              <option value="POSTED">Kesinleşti</option>
              <option value="REVERSED">İptal</option>
            </Select>
          </Field>
          <Field label="Mutabakat">
            <Select value={filters.reconStatus} onChange={set('reconStatus')}>
              <option value="">Tümü</option>
              <option value="UNMATCHED">Eşleşmedi</option>
              <option value="SUGGESTED">Öneri var</option>
              <option value="MATCHED">Eşleşti</option>
              <option value="IGNORED">Kapsam dışı</option>
            </Select>
          </Field>
          <Field label="Hesap / kart">
            <Select value={filters.account} onChange={set('account')}>
              <option value="">Tümü</option>
              {banks.data?.map((b) => (
                <option key={b.id} value={`bank:${b.id}`}>
                  {b.bankName} • {b.name}
                </option>
              ))}
              {cards.data?.map((c) => (
                <option key={c.id} value={`card:${c.id}`}>
                  {c.name} •••• {c.last4}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Kategori">
            <Select value={filters.uncategorized} onChange={set('uncategorized')}>
              <option value="">Tümü</option>
              <option value="true">Kategorisiz</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button
              variant="ghost"
              onClick={() => {
                setQ('');
                setFilters({ q: '', sourceType: '', dataSource: '', direction: '', status: '', reconStatus: '', uncategorized: '', account: '', from: '', to: '' });
              }}
            >
              <X className="h-4 w-4" /> Filtreleri temizle
            </Button>
          </div>
        </div>
      </Card>

      {selected.size > 0 && editable && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand-50 px-4 py-2 text-sm">
          <span className="font-medium text-navy">{selected.size} hareket seçildi</span>
          <Select value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} className="w-56">
            <option value="">Kategori seçin</option>
            {ref.data?.categories
              .filter((c) => c.isActive)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </Select>
          <Button size="sm" disabled={!bulkCategory} loading={busy} onClick={() => categorize([...selected], bulkCategory)}>
            Kategori ata
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Seçimi kaldır
          </Button>
        </div>
      )}

      <Card padded={false}>
        {error ? (
          <div className="p-5">
            <ErrorBox error={error} onRetry={reload} />
          </div>
        ) : !data ? (
          <Loading />
        ) : !items.length ? (
          <EmptyState title="Bu filtrelerle hareket bulunamadı" description="Tarih aralığını genişletmeyi veya filtreleri temizlemeyi deneyin." />
        ) : (
          <>
            {data.totals.length > 0 && (
              <div className="flex flex-wrap gap-4 border-b border-slate-100 px-4 py-2 text-xs text-muted">
                <span>Net toplam (iptaller hariç):</span>
                {data.totals.map((t: any) => (
                  <span key={t.currency} className="font-medium text-navy">
                    {money(t.net, t.currency, { sign: true })}
                  </span>
                ))}
              </div>
            )}
            <div className={loading ? 'opacity-60' : ''}>
              <Table>
                <thead>
                  <tr>
                    {editable && (
                      <Th className="w-8">
                        <input
                          type="checkbox"
                          aria-label="Tümünü seç"
                          checked={allSelected}
                          onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((t) => t.id)))}
                        />
                      </Th>
                    )}
                    <Th>Tarih</Th>
                    <Th>Açıklama</Th>
                    <Th>Hesap</Th>
                    <Th>Kategori</Th>
                    <Th>Durum</Th>
                    <Th>Mutabakat</Th>
                    <Th>Kaynak</Th>
                    <Th align="right">Tutar</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((t) => (
                    <tr key={t.id} className={selected.has(t.id) ? 'bg-brand-50' : 'hover:bg-slate-50'}>
                      {editable && (
                        <Td>
                          <input
                            type="checkbox"
                            aria-label="Seç"
                            checked={selected.has(t.id)}
                            onChange={() =>
                              setSelected((s) => {
                                const n = new Set(s);
                                if (n.has(t.id)) n.delete(t.id);
                                else n.add(t.id);
                                return n;
                              })
                            }
                          />
                        </Td>
                      )}
                      <Td className="whitespace-nowrap text-xs text-muted">{date(t.date)}</Td>
                      <Td>
                        <Link href={`/transactions/${t.id}`} className="font-medium text-navy hover:text-brand">
                          {t.description}
                        </Link>
                        {t.counterpartyName && <div className="text-xs text-muted">{t.counterpartyName}</div>}
                      </Td>
                      <Td className="text-xs">
                        <SourceTypeLabel type={t.sourceType} />
                        <div className="text-muted">{t.bankAccount?.name ?? (t.cardAccount ? `${t.cardAccount.name} •••• ${t.cardAccount.last4}` : '')}</div>
                      </Td>
                      <Td>
                        {t.category ? (
                          t.category.name
                        ) : t.suggestedCategory && editable ? (
                          <button
                            onClick={() => categorize([t.id], t.suggestedCategory.id)}
                            className="inline-flex items-center gap-1 rounded-full border border-dashed border-brand/50 px-2 py-0.5 text-xs text-brand hover:bg-brand-50"
                            title="Öneriyi kabul et"
                          >
                            <Sparkles className="h-3 w-3" /> {t.suggestedCategory.name} <Check className="h-3 w-3" />
                          </button>
                        ) : (
                          <span className="text-xs text-muted">Kategorisiz</span>
                        )}
                      </Td>
                      <Td>
                        <StatusBadge status={t.status} />
                      </Td>
                      <Td>{t.sourceType === 'BANK' ? <StatusBadge status={t.reconStatus} /> : <span className="text-xs text-muted">—</span>}</Td>
                      <Td>
                        <SourceBadge source={t.dataSource} />
                      </Td>
                      <Td align="right" className="whitespace-nowrap">
                        <Amount value={t.amount} currency={t.currency} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal
        open={manual}
        onClose={() => setManual(false)}
        title="Manuel kayıt"
        footer={
          <>
            <Button variant="secondary" onClick={() => setManual(false)}>
              Vazgeç
            </Button>
            <Button type="submit" form="manual-form" loading={busy}>
              Kaydet
            </Button>
          </>
        }
      >
        <form id="manual-form" onSubmit={createManual} className="grid grid-cols-2 gap-3">
          <p className="col-span-2 text-xs text-muted">Nakit gider, eksik hareket veya düzeltme için. Kayıt “Manuel” etiketiyle gösterilir ve banka verisi gibi sunulmaz.</p>
          <Field label="Tarih">
            <Input name="date" type="date" defaultValue={isoDate(new Date())} required />
          </Field>
          <Field label="Yön">
            <Select name="direction" defaultValue="OUT">
              <option value="OUT">Çıkış</option>
              <option value="IN">Giriş</option>
            </Select>
          </Field>
          <Field label="Tutar">
            <Input name="amount" type="number" step="0.01" min="0.01" required />
          </Field>
          <Field label="Para birimi">
            <Input name="currency" defaultValue="TRY" maxLength={3} minLength={3} />
          </Field>
          <Field label="Açıklama" className="col-span-2">
            <Input name="description" required maxLength={500} />
          </Field>
          <Field label="Hesap (isteğe bağlı)">
            <Select name="account" defaultValue="">
              <option value="">Nakit / hesapsız</option>
              {banks.data?.map((b) => (
                <option key={b.id} value={`bank:${b.id}`}>
                  {b.name}
                </option>
              ))}
              {cards.data?.map((c) => (
                <option key={c.id} value={`card:${c.id}`}>
                  {c.name} •••• {c.last4}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Kategori">
            <Select name="categoryId" defaultValue="">
              <option value="">—</option>
              {ref.data?.categories
                .filter((c) => c.isActive)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Karşı taraf" className="col-span-2">
            <Input name="counterpartyName" maxLength={200} />
          </Field>
          <Field label="Not" className="col-span-2">
            <Textarea name="note" maxLength={1000} />
          </Field>
        </form>
      </Modal>
    </>
  );
}

export default function TransactionsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <TransactionsInner />
    </Suspense>
  );
}

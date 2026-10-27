'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, StatusBadge } from '@/components/badges';
import { TxnPicker } from '@/components/txn-picker';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs, Td, Th, formValues, useAction } from '@/components/ui';
import { api, qs, useApi } from '@/lib/api';
import { date, isoDate, money } from '@/lib/format';
import { useSession } from '@/lib/session';

const KIND_LABEL: Record<string, string> = { PLANNED: 'Planlı ödeme', INVOICE: 'Alış faturası', CARD_STATEMENT: 'Kart ekstresi' };
const RECURRENCE: Record<string, string> = { NONE: 'Tek sefer', MONTHLY: 'Aylık', QUARTERLY: '3 aylık', YEARLY: 'Yıllık' };
const CATEGORIES = ['Kira', 'Abonelik', 'Vergi', 'SGK', 'Maaş', 'Tedarikçi', 'Kredi', 'Sigorta', 'Diğer'];

function hrefFor(item: any) {
  if (item.kind === 'INVOICE') return `/invoices/${item.id}`;
  if (item.kind === 'CARD_STATEMENT') return '/cards';
  return null;
}

function UpcomingTab() {
  const [days, setDays] = useState(30);
  const { data, error, loading, reload } = useApi<any>(`/payables/upcoming${qs({ days })}`);
  const totals: Record<string, number> = {};
  for (const i of data?.items ?? []) totals[i.currency] = (totals[i.currency] ?? 0) + Number(i.amount);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select className="w-40" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={30}>30 gün</option>
          <option value={60}>60 gün</option>
          <option value={90}>90 gün</option>
        </Select>
        {data && (
          <span className="text-sm text-muted">
            Toplam: <b className="text-navy">{Object.entries(totals).map(([c, v]) => money(v, c)).join(' · ') || money(0)}</b> • vadesi geçenler dahil
          </span>
        )}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <Card padded={false}>
        {!data && loading ? (
          <Loading />
        ) : !data?.items.length ? (
          <EmptyState title="Yaklaşan ödeme yok" description={`Önümüzdeki ${days} gün için planlı ödeme, açık alış faturası veya kart ekstresi bulunmuyor.`} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Vade</Th>
                <Th>Tür</Th>
                <Th>Kalem</Th>
                <Th>Taraf</Th>
                <Th align="right">Tutar</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i: any) => {
                const href = hrefFor(i);
                return (
                  <tr key={`${i.kind}-${i.id}`}>
                    <Td className={i.overdue ? 'font-medium text-danger' : ''}>
                      {date(i.dueDate)} {i.overdue && <StatusBadge status="OPEN" overdue />}
                    </Td>
                    <Td>
                      <Badge tone={i.kind === 'CARD_STATEMENT' ? 'info' : i.kind === 'INVOICE' ? 'teal' : 'neutral'}>{KIND_LABEL[i.kind]}</Badge>
                    </Td>
                    <Td>
                      {href ? (
                        <Link href={href} className="font-medium text-navy hover:text-brand">
                          {i.title}
                        </Link>
                      ) : (
                        <span className="font-medium text-navy">{i.title}</span>
                      )}
                      <div className="text-xs text-muted">{i.category}</div>
                    </Td>
                    <Td>{i.counterparty ? <Link href={`/counterparties/${i.counterparty.id}`} className="text-brand">{i.counterparty.name}</Link> : '—'}</Td>
                    <Td align="right" className="font-medium">
                      {money(i.amount, i.currency)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

function PlannedModal({ item, open, onClose, onSaved }: { item?: any; open: boolean; onClose: () => void; onSaved: () => void }) {
  const { run, busy } = useAction();
  const cps = useApi<{ items: any[] }>(open && !item ? '/counterparties?type=SUPPLIER' : null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const body: any = { title: v.title, amount: Number(v.amount), dueDate: v.dueDate, recurrence: v.recurrence, note: v.note };
    const ok = item
      ? await run(() => api(`/planned-payments/${item.id}`, { method: 'PATCH', body }), 'Ödeme güncellendi')
      : await run(() => api('/planned-payments', { body: { ...body, category: v.category, counterpartyId: v.counterpartyId, currency: v.currency } }), 'Ödeme planlandı');
    if (ok) {
      onSaved();
      onClose();
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={item ? 'Planlı ödemeyi düzenle' : 'Ödeme planla'}>
      <form onSubmit={submit} className="space-y-4" key={item?.id ?? 'new'}>
        <Field label="Başlık">
          <Input name="title" required maxLength={200} defaultValue={item?.title} placeholder="Ör. Ofis kirası" />
        </Field>
        {!item && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kategori">
              <Select name="category" defaultValue="Kira">
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Tedarikçi">
              <Select name="counterpartyId" defaultValue="">
                <option value="">Seçilmedi</option>
                {(cps.data?.items ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        <div className="grid grid-cols-3 gap-3">
          <Field label="Tutar" className={item ? 'col-span-3' : 'col-span-2'}>
            <Input name="amount" type="number" step="0.01" min="0.01" required defaultValue={item?.amount} />
          </Field>
          {!item && (
            <Field label="Para birimi">
              <Select name="currency" defaultValue="TRY">
                <option>TRY</option>
                <option>USD</option>
                <option>EUR</option>
              </Select>
            </Field>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vade">
            <Input name="dueDate" type="date" required defaultValue={item ? isoDate(new Date(item.dueDate)) : isoDate(new Date())} />
          </Field>
          <Field label="Tekrar" hint="Ödendi işaretlenince sonraki dönem otomatik oluşur">
            <Select name="recurrence" defaultValue={item?.recurrence ?? 'NONE'}>
              {Object.entries(RECURRENCE).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Not">
          <Input name="note" maxLength={500} defaultValue={item?.note ?? ''} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" loading={busy}>
            Kaydet
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function MarkPaidModal({ item, onClose, onDone }: { item: any; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction();
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const ok = await run(() => api(`/planned-payments/${item.id}/mark-paid`, { body: { transactionId: v.transactionId } }), 'Ödeme kapatıldı');
    if (ok) {
      onDone();
      onClose();
    }
  }
  return (
    <Modal open={!!item} onClose={onClose} title="Ödendi olarak işaretle">
      {item && (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-navy">
            <b>{item.title}</b> • {money(item.amount, item.currency)} • vade {date(item.dueDate)}
          </p>
          <TxnPicker direction="OUT" currency={item.currency} />
          {item.recurrence !== 'NONE' && <p className="text-xs text-muted">Tekrarlı ödeme: bir sonraki dönem otomatik planlanacak.</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Vazgeç
            </Button>
            <Button type="submit" loading={busy}>
              Ödendi
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function PlannedTab() {
  const { can } = useSession();
  const [status, setStatus] = useState('PLANNED');
  const { data, error, loading, reload } = useApi<any[]>(`/planned-payments${qs({ status })}`);
  const [editing, setEditing] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<any>(null);
  const { run } = useAction();
  const manage = can('planned.manage');
  const today = isoDate(new Date());

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="PLANNED">Bekleyenler</option>
          <option value="PAID">Ödenenler</option>
          <option value="CANCELLED">İptal edilenler</option>
          <option value="">Tümü</option>
        </Select>
        {manage && (
          <Button className="ml-auto" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Ödeme planla
          </Button>
        )}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <Card padded={false}>
        {!data && loading ? (
          <Loading />
        ) : !data?.length ? (
          <EmptyState title="Planlı ödeme yok" description="Kira, abonelik, vergi gibi düzenli yükümlülükleri planlayarak vade takibi yapın." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Vade</Th>
                <Th>Başlık</Th>
                <Th>Taraf</Th>
                <Th>Tekrar</Th>
                <Th>Durum</Th>
                <Th align="right">Tutar</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.map((p) => {
                const overdue = p.status === 'PLANNED' && p.dueDate.slice(0, 10) < today;
                return (
                  <tr key={p.id}>
                    <Td className={overdue ? 'font-medium text-danger' : ''}>{date(p.dueDate)}</Td>
                    <Td>
                      <span className="font-medium text-navy">{p.title}</span>
                      <div className="text-xs text-muted">{p.category}</div>
                    </Td>
                    <Td>{p.counterparty?.name ?? '—'}</Td>
                    <Td>{RECURRENCE[p.recurrence]}</Td>
                    <Td>
                      <StatusBadge status={p.status} overdue={overdue} />
                    </Td>
                    <Td align="right" className="font-medium">
                      {money(p.amount, p.currency)}
                    </Td>
                    <Td align="right">
                      {manage && p.status === 'PLANNED' && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="secondary" onClick={() => setPaying(p)}>
                            Ödendi
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                            Düzenle
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => confirm('Planlı ödeme iptal edilsin mi?') && run(() => api(`/planned-payments/${p.id}/cancel`, { method: 'POST' }), 'İptal edildi').then(reload)}>
                            İptal
                          </Button>
                        </div>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <PlannedModal open={creating} onClose={() => setCreating(false)} onSaved={reload} />
      <PlannedModal item={editing} open={!!editing} onClose={() => setEditing(null)} onSaved={reload} />
      <MarkPaidModal item={paying} onClose={() => setPaying(null)} onDone={reload} />
    </>
  );
}

export default function PaymentsPage() {
  const [tab, setTab] = useState<'upcoming' | 'planned'>('upcoming');
  return (
    <>
      <PageHeader title="Ödemeler" description="Tedarikçi ödemeleri, kira, abonelik, vergi ve kart borçlarının vade takibi. Banka üzerinden ödeme başlatma bu sürümde kapsam dışıdır." />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: 'upcoming', label: 'Yaklaşan' },
          { key: 'planned', label: 'Planlı ödemeler' },
        ]}
      />
      {tab === 'upcoming' ? <UpcomingTab /> : <PlannedTab />}
    </>
  );
}

'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, StatusBadge } from '@/components/badges';
import { Amount } from '@/components/money';
import { CopyButton, PaymentLinkModal } from '@/components/payment-link-modal';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Modal, PageHeader, Pagination, Select, Table, Tabs, Td, Th, formValues, useAction } from '@/components/ui';
import { api, qs, useApi } from '@/lib/api';
import { date, dateTime } from '@/lib/format';
import { useSession } from '@/lib/session';

const STATUSES = [
  ['', 'Tüm durumlar'],
  ['PENDING', 'Bekliyor'],
  ['PAID', 'Ödendi'],
  ['FAILED', 'Başarısız'],
  ['EXPIRED', 'Süresi doldu'],
  ['CANCELLED', 'İptal'],
  ['PARTIALLY_REFUNDED', 'Kısmi iade'],
  ['REFUNDED', 'İade edildi'],
];

function RequestsTab() {
  const { can } = useSession();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const { data, error, loading, reload } = useApi<any>(`/payment-requests${qs({ status, q, page })}`);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select className="w-44" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
          {STATUSES.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
        <Input className="w-64" placeholder="Açıklama veya müşteri ara" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
        {can('collection.manage') && (
          <Button className="ml-auto" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Ödeme linki oluştur
          </Button>
        )}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <Card padded={false}>
        {!data && loading ? (
          <Loading />
        ) : !data?.items.length ? (
          <EmptyState title="Ödeme linki yok" description="Müşterilerinize ödeme linki göndererek kartla tahsilat alabilirsiniz." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Oluşturma</Th>
                  <Th>Açıklama</Th>
                  <Th>Müşteri / fatura</Th>
                  <Th>Durum</Th>
                  <Th>Ödeme</Th>
                  <Th align="right">Tutar</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((r: any) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <Td className="text-xs text-muted">{dateTime(r.createdAt)}</Td>
                    <Td>
                      <Link href={`/collections/${r.id}`} className="font-medium text-navy hover:text-brand">
                        {r.description}
                      </Link>
                      <div className="text-xs text-muted">{r.terminal?.name} • {r._count.attempts} deneme</div>
                    </Td>
                    <Td>
                      <div>{r.counterparty?.name ?? '—'}</div>
                      {r.invoice && (
                        <Link href={`/invoices/${r.invoice.id}`} className="text-xs text-brand">
                          {r.invoice.number}
                        </Link>
                      )}
                    </Td>
                    <Td>
                      <StatusBadge status={r.status} />
                    </Td>
                    <Td className="text-xs text-muted">{r.paidAt ? dateTime(r.paidAt) : r.status === 'PENDING' ? `Son: ${date(r.expiresAt)}` : '—'}</Td>
                    <Td align="right">
                      <Amount value={r.amount} currency={r.currency} signed={false} />
                    </Td>
                    <Td align="right">{r.status === 'PENDING' && <CopyButton text={r.link} label="Link" />}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <PaymentLinkModal open={creating} onClose={() => setCreating(false)} onCreated={() => reload()} />
    </>
  );
}

function TerminalModal({ open, onClose, providers, onSaved }: { open: boolean; onClose: () => void; providers: { key: string; name: string }[]; onSaved: () => void }) {
  const { run, busy } = useAction();
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const config: Record<string, string> = {};
    for (const k of ['merchantId', 'apiKey', 'secretKey']) if (v[k]) config[k] = v[k];
    const ok = await run(
      () =>
        api('/terminals', {
          body: { provider: v.provider, name: v.name, config, commissionRate: Number(v.commission ?? 0) / 100, isDefault: v.isDefault === 'on' },
        }),
      'Terminal eklendi',
    );
    if (ok) {
      onSaved();
      onClose();
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Sanal POS terminali ekle">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Sağlayıcı">
          <Select name="provider" required>
            {providers.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Terminal adı">
          <Input name="name" required maxLength={80} placeholder="Ör. Ana sanal POS" />
        </Field>
        <Field label="Komisyon oranı (%)" hint="Ör. 2,49 için 2.49 yazın">
          <Input name="commission" type="number" step="0.01" min="0" max="20" defaultValue="0" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Üye işyeri no">
            <Input name="merchantId" autoComplete="off" />
          </Field>
          <Field label="API anahtarı">
            <Input name="apiKey" autoComplete="off" />
          </Field>
          <Field label="Gizli anahtar">
            <Input name="secretKey" type="password" autoComplete="new-password" />
          </Field>
        </div>
        <p className="text-xs text-muted">Kimlik bilgileri şifrelenerek saklanır ve bir daha görüntülenmez. Değiştirmek için yeniden girmeniz gerekir.</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isDefault" /> Varsayılan terminal yap
        </label>
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

function TerminalsTab() {
  const { can } = useSession();
  const { data, error, reload } = useApi<any>('/terminals');
  const [creating, setCreating] = useState(false);
  const { run } = useAction();
  const manage = can('terminal.manage');

  const patch = (id: string, body: object, msg: string) => run(() => api(`/terminals/${id}`, { method: 'PATCH', body }), msg).then(reload);

  return (
    <>
      <ErrorBox error={error} onRetry={reload} />
      <Card
        padded={false}
        title="Terminaller"
        actions={
          manage && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" /> Terminal ekle
            </Button>
          )
        }
      >
        {!data ? (
          <Loading />
        ) : !data.items.length ? (
          <EmptyState title="Terminal yok" description="Ödeme linki oluşturmak için en az bir aktif sanal POS terminali gerekir." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Ad</Th>
                <Th>Sağlayıcı</Th>
                <Th align="right">Komisyon</Th>
                <Th>Durum</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((t: any) => (
                <tr key={t.id}>
                  <Td>
                    <span className="font-medium text-navy">{t.name}</span> {t.isDefault && <Badge tone="info">Varsayılan</Badge>}
                  </Td>
                  <Td>{data.providers.find((p: any) => p.key === t.provider)?.name ?? t.provider}</Td>
                  <Td align="right">%{(Number(t.commissionRate) * 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</Td>
                  <Td>{t.isActive ? <StatusBadge status="ACTIVE" /> : <StatusBadge status="DISCONNECTED" />}</Td>
                  <Td align="right">
                    {manage && (
                      <div className="flex justify-end gap-2">
                        {!t.isDefault && t.isActive && (
                          <Button size="sm" variant="ghost" onClick={() => patch(t.id, { isDefault: true }, 'Varsayılan terminal güncellendi')}>
                            Varsayılan yap
                          </Button>
                        )}
                        <Button size="sm" variant={t.isActive ? 'danger' : 'secondary'} onClick={() => patch(t.id, { isActive: !t.isActive }, t.isActive ? 'Terminal devre dışı' : 'Terminal etkin')}>
                          {t.isActive ? 'Devre dışı bırak' : 'Etkinleştir'}
                        </Button>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {data && <TerminalModal open={creating} onClose={() => setCreating(false)} providers={data.providers} onSaved={reload} />}
    </>
  );
}

export default function CollectionsPage() {
  const [tab, setTab] = useState<'requests' | 'terminals'>('requests');
  return (
    <>
      <PageHeader title="Tahsilatlar" description="Ödeme linkleri ve sanal POS ile müşterilerden tahsilat. Ödeme sonucu her zaman sağlayıcıdan doğrulanır." />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: 'requests', label: 'Ödeme linkleri' },
          { key: 'terminals', label: 'Terminaller' },
        ]}
      />
      {tab === 'requests' ? <RequestsTab /> : <TerminalsTab />}
    </>
  );
}

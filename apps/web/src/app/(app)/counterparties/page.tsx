'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SourceBadge } from '@/components/badges';
import { CP_TYPE_LABEL } from '@/components/counterparty-labels';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Modal, PageHeader, Pagination, Select, Table, Tabs, Td, Th, formValues, useAction } from '@/components/ui';
import { api, qs, useApi } from '@/lib/api';
import { moneyMap } from '@/lib/format';
import { useSession } from '@/lib/session';


function CreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { run, busy } = useAction();
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const cp = await run(() => api('/counterparties', { body: formValues(e.currentTarget) }), 'Cari oluşturuldu');
    if (cp) router.push(`/counterparties/${cp.id}`);
  }
  return (
    <Modal open={open} onClose={onClose} title="Cari ekle">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tür">
            <Select name="type" defaultValue="CUSTOMER">
              {Object.entries(CP_TYPE_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Cari kodu">
            <Input name="code" required maxLength={40} placeholder="120.01.001" />
          </Field>
        </div>
        <Field label="Unvan">
          <Input name="name" required maxLength={200} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Vergi no">
            <Input name="taxNumber" maxLength={20} />
          </Field>
          <Field label="E-posta">
            <Input name="email" type="email" />
          </Field>
          <Field label="Telefon">
            <Input name="phone" maxLength={30} />
          </Field>
        </div>
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

export default function CounterpartiesPage() {
  const { can } = useSession();
  const [type, setType] = useState<'' | 'CUSTOMER' | 'SUPPLIER'>('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const { data, error, loading, reload } = useApi<any>(`/counterparties${qs({ type, q, page })}`);

  return (
    <>
      <PageHeader
        title="Cari Hesaplar"
        description="Müşteri ve tedarikçi bazında açık faturalardan hesaplanan alacak ve borçlar."
        actions={
          can('counterparty.manage') && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Cari ekle
            </Button>
          )
        }
      />
      <Tabs
        value={type}
        onChange={(t) => (setType(t), setPage(1))}
        items={[
          { key: '', label: 'Tümü' },
          { key: 'CUSTOMER', label: 'Müşteriler' },
          { key: 'SUPPLIER', label: 'Tedarikçiler' },
        ]}
      />
      <div className="mb-4">
        <Input className="w-72" placeholder="Unvan, kod veya vergi no ara" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <Card padded={false}>
        {!data && loading ? (
          <Loading />
        ) : !data?.items.length ? (
          <EmptyState title="Cari bulunamadı" description="ERP senkronizasyonu ile cari kartlar otomatik gelir." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Kod</Th>
                  <Th>Unvan</Th>
                  <Th>Tür</Th>
                  <Th>Kaynak</Th>
                  <Th align="right">Alacak</Th>
                  <Th align="right">Borç</Th>
                  <Th align="right">Vadesi geçen</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((c: any) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <Td className="font-mono text-xs text-muted">{c.code}</Td>
                    <Td>
                      <Link href={`/counterparties/${c.id}`} className="font-medium text-navy hover:text-brand">
                        {c.name}
                      </Link>
                      {c.taxNumber && <div className="text-xs text-muted">VKN {c.taxNumber}</div>}
                    </Td>
                    <Td>{CP_TYPE_LABEL[c.type]}</Td>
                    <Td>
                      <SourceBadge source={c.origin} />
                    </Td>
                    <Td align="right">{Object.keys(c.receivable).length ? moneyMap(c.receivable) : '—'}</Td>
                    <Td align="right">{Object.keys(c.payable).length ? moneyMap(c.payable) : '—'}</Td>
                    <Td align="right" className={Object.keys(c.overdue).length ? 'font-medium text-danger' : ''}>
                      {Object.keys(c.overdue).length ? moneyMap(c.overdue) : '—'}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <CreateModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

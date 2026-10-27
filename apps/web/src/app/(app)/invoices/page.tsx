'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { SourceBadge, StatusBadge } from '@/components/badges';
import { InvoiceFormModal } from '@/components/invoice-form-modal';
import { Button, Card, EmptyState, ErrorBox, Input, Loading, PageHeader, Pagination, Select, Table, Tabs, Td, Th } from '@/components/ui';
import { qs, useApi } from '@/lib/api';
import { date, money } from '@/lib/format';
import { useSession } from '@/lib/session';

type InvoiceType = 'SALES' | 'PURCHASE';

function InvoiceList() {
  const { can } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const [type, setType] = useState<InvoiceType>(params.get('type') === 'PURCHASE' ? 'PURCHASE' : 'SALES');
  const [overdue, setOverdue] = useState(params.get('overdue') === 'true');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const { data, error, loading, reload } = useApi<any>(`/invoices${qs({ type, status: overdue ? undefined : status, overdue: overdue || undefined, q, page })}`);

  return (
    <>
      <PageHeader
        title="Faturalar"
        description="Satış faturaları alacakları, alış faturaları borçları gösterir. ERP ana kaynaksa faturalar ERP'den gelir."
        actions={
          can('invoice.manage') && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Fatura ekle
            </Button>
          )
        }
      />
      <Tabs
        value={type}
        onChange={(t) => (setType(t), setPage(1))}
        items={[
          { key: 'SALES', label: 'Satış (alacak)' },
          { key: 'PURCHASE', label: 'Alış (borç)' },
        ]}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select className="w-44" value={status} disabled={overdue} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
          <option value="">Tüm durumlar</option>
          <option value="OPEN">Açık</option>
          <option value="PARTIAL">Kısmi ödendi</option>
          <option value="PAID">Ödendi</option>
          <option value="CANCELLED">İptal</option>
        </Select>
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          <input type="checkbox" checked={overdue} onChange={(e) => (setOverdue(e.target.checked), setPage(1))} /> Yalnızca vadesi geçenler
        </label>
        <Input className="w-64" placeholder="Fatura no veya cari ara" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <Card padded={false}>
        {!data && loading ? (
          <Loading />
        ) : !data?.items.length ? (
          <EmptyState title="Fatura bulunamadı" description="ERP bağlantısı kurarak faturaları otomatik alabilir ya da manuel ekleyebilirsiniz." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Fatura no</Th>
                  <Th>Cari</Th>
                  <Th>Tarih</Th>
                  <Th>Vade</Th>
                  <Th>Durum</Th>
                  <Th>Kaynak</Th>
                  <Th align="right">Toplam</Th>
                  <Th align="right">Kalan</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((i: any) => (
                  <tr key={i.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/invoices/${i.id}`)}>
                    <Td>
                      <Link href={`/invoices/${i.id}`} className="font-medium text-navy hover:text-brand" onClick={(e) => e.stopPropagation()}>
                        {i.number}
                      </Link>
                    </Td>
                    <Td>{i.counterparty.name}</Td>
                    <Td className="text-xs text-muted">{date(i.issueDate)}</Td>
                    <Td className={i.overdue ? 'text-danger' : ''}>{date(i.dueDate)}</Td>
                    <Td>
                      <StatusBadge status={i.status} overdue={i.overdue} />
                    </Td>
                    <Td>
                      <SourceBadge source={i.origin} />
                    </Td>
                    <Td align="right">{money(i.total, i.currency)}</Td>
                    <Td align="right" className="font-medium">
                      {money(i.remaining, i.currency)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <InvoiceFormModal open={creating} onClose={() => setCreating(false)} defaultType={type} onSaved={(inv) => router.push(`/invoices/${inv.id}`)} />
    </>
  );
}

export default function InvoicesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <InvoiceList />
    </Suspense>
  );
}

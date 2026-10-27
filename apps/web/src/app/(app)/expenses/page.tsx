'use client';

import { Paperclip, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { SourceTypeLabel, StatusBadge } from '@/components/badges';
import { ExpenseModal, useReference } from '@/components/expense-form';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Loading, PageHeader, Pagination, Select, Table, Tabs, Td, Th } from '@/components/ui';
import { qs, useApi } from '@/lib/api';
import { date, money } from '@/lib/format';
import { useSession } from '@/lib/session';

type Tab = 'all' | 'pending' | 'mine';

function ExpensesInner() {
  const { can, period } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const ref = useReference();
  const [tab, setTab] = useState<Tab>(params.get('status') === 'SUBMITTED' ? 'pending' : 'all');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [categoryId, setCategoryId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  useEffect(() => setPage(1), [tab, status, categoryId, departmentId, from, to]);

  const path = `/expenses${qs({
    status: tab === 'pending' ? 'SUBMITTED' : status,
    mine: tab === 'mine' ? 'true' : undefined,
    categoryId,
    departmentId,
    // Onay kuyruğu dönemden bağımsız gösterilir
    from: tab === 'pending' ? undefined : from,
    to: tab === 'pending' ? undefined : to,
    page,
  })}`;
  const { data, error, loading, reload } = useApi<any>(path);

  const tabs: { key: Tab; label: string }[] = [{ key: 'all', label: 'Tümü' }];
  if (can('expense.approve')) tabs.push({ key: 'pending', label: 'Onay bekleyen' });
  tabs.push({ key: 'mine', label: 'Benim' });

  return (
    <>
      <PageHeader
        title="Harcamalar"
        description="Gider kayıtları, fişler ve onaylar. Kart veya banka çıkışından gider oluşturmak için hareket detayını kullanın."
        actions={
          can('expense.create') && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Nakit gider ekle
            </Button>
          )
        }
      />
      <Tabs value={tab} onChange={setTab} items={tabs} />

      <Card className="mb-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {tab !== 'pending' && (
            <>
              <Field label="Başlangıç">
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="Bitiş">
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
              <Field label="Durum">
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">Tümü</option>
                  <option value="SUBMITTED">Onay bekliyor</option>
                  <option value="APPROVED">Onaylandı</option>
                  <option value="REJECTED">Reddedildi</option>
                </Select>
              </Field>
            </>
          )}
          <Field label="Kategori">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Tümü</option>
              {ref.data?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Departman">
            <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">Tümü</option>
              {ref.data?.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card padded={false}>
        {error ? (
          <div className="p-5">
            <ErrorBox error={error} onRetry={reload} />
          </div>
        ) : !data ? (
          <Loading />
        ) : !data.items.length ? (
          <EmptyState title={tab === 'pending' ? 'Onay bekleyen gider yok' : 'Gider kaydı bulunamadı'} />
        ) : (
          <div className={loading ? 'opacity-60' : ''}>
            <Table>
              <thead>
                <tr>
                  <Th>Tarih</Th>
                  <Th>Açıklama</Th>
                  <Th>Gönderen</Th>
                  <Th>Kategori</Th>
                  <Th>Departman / MM</Th>
                  <Th>Kaynak</Th>
                  <Th>Durum</Th>
                  <Th align="right">Tutar</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((e: any) => (
                  <tr key={e.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/expenses/${e.id}`)}>
                    <Td className="whitespace-nowrap text-xs text-muted">{date(e.date)}</Td>
                    <Td>
                      <Link href={`/expenses/${e.id}`} className="font-medium text-navy hover:text-brand" onClick={(ev) => ev.stopPropagation()}>
                        {e.description}
                      </Link>
                      <div className="flex items-center gap-2 text-xs text-muted">
                        {e.merchant}
                        {e.documents.length > 0 ? (
                          <span className="inline-flex items-center gap-0.5">
                            <Paperclip className="h-3 w-3" /> {e.documents.length}
                          </span>
                        ) : (
                          <span className="text-warning-700">Fiş yok</span>
                        )}
                      </div>
                    </Td>
                    <Td>{e.submittedBy?.name}</Td>
                    <Td>{e.category.name}</Td>
                    <Td className="text-xs">
                      {e.department?.name ?? '—'}
                      {e.costCenter && <div className="text-muted">{e.costCenter.code}</div>}
                    </Td>
                    <Td>{e.transaction ? <SourceTypeLabel type={e.transaction.sourceType} /> : <span className="text-xs text-muted">Nakit</span>}</Td>
                    <Td>
                      <StatusBadge status={e.status} />
                    </Td>
                    <Td align="right">{money(e.amount, e.currency)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </div>
        )}
      </Card>

      {creating && (
        <ExpenseModal
          open
          onClose={() => setCreating(false)}
          onSaved={(e) => {
            setCreating(false);
            router.push(`/expenses/${e.id}`);
          }}
        />
      )}
    </>
  );
}

export default function ExpensesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ExpensesInner />
    </Suspense>
  );
}

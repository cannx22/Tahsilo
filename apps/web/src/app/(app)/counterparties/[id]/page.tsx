'use client';

import { ArrowLeft, Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { SourceBadge, StatusBadge } from '@/components/badges';
import { CP_TYPE_LABEL } from '@/components/counterparty-labels';
import { InvoiceFormModal } from '@/components/invoice-form-modal';
import { Button, Card, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, Select, Stat, Table, Td, Th, formValues, useAction } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { date, dateTime, money, moneyMap } from '@/lib/format';
import { useSession } from '@/lib/session';

function EditModal({ cp, open, onClose, onSaved }: { cp: any; open: boolean; onClose: () => void; onSaved: () => void }) {
  const { run, busy } = useAction();
  const fromErp = cp.origin === 'ERP';
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    // ERP kaynaklı carilerde kimlik alanları gönderilmez
    const body = fromErp ? { email: v.email, phone: v.phone } : v;
    const ok = await run(() => api(`/counterparties/${cp.id}`, { method: 'PATCH', body }), 'Cari güncellendi');
    if (ok) {
      onSaved();
      onClose();
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Cariyi düzenle">
      <form onSubmit={submit} className="space-y-4">
        {fromErp && <Notice>Bu cari ERP'den geliyor. Unvan, tür ve vergi no ERP'de güncellenmeli; burada yalnızca iletişim bilgileri değişir.</Notice>}
        {!fromErp && (
          <>
            <Field label="Tür">
              <Select name="type" defaultValue={cp.type}>
                {Object.entries(CP_TYPE_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Unvan">
              <Input name="name" required maxLength={200} defaultValue={cp.name} />
            </Field>
            <Field label="Vergi no">
              <Input name="taxNumber" maxLength={20} defaultValue={cp.taxNumber ?? ''} />
            </Field>
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="E-posta">
            <Input name="email" type="email" defaultValue={cp.email ?? ''} />
          </Field>
          <Field label="Telefon">
            <Input name="phone" maxLength={30} defaultValue={cp.phone ?? ''} />
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

export default function CounterpartyDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const { data: cp, error, reload } = useApi<any>(`/counterparties/${id}`);
  const [editing, setEditing] = useState(false);
  const [addingInvoice, setAddingInvoice] = useState(false);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!cp) return <Loading />;

  return (
    <>
      <Link href="/counterparties" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-navy">
        <ArrowLeft className="h-4 w-4" /> Cari hesaplar
      </Link>
      <PageHeader
        title={cp.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{cp.code}</span> • {CP_TYPE_LABEL[cp.type]}
            {cp.taxNumber && <> • VKN {cp.taxNumber}</>}
            {cp.email && <> • {cp.email}</>}
            <SourceBadge source={cp.origin} />
          </span>
        }
        actions={
          can('counterparty.manage') && (
            <>
              {can('invoice.manage') && (
                <Button variant="secondary" onClick={() => setAddingInvoice(true)}>
                  <Plus className="h-4 w-4" /> Fatura
                </Button>
              )}
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" /> Düzenle
              </Button>
            </>
          )
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Açık alacak" value={Object.keys(cp.receivable).length ? moneyMap(cp.receivable) : '—'} />
        <Stat label="Açık borç" value={Object.keys(cp.payable).length ? moneyMap(cp.payable) : '—'} />
        <Stat label="Vadesi geçen" value={Object.keys(cp.overdue).length ? moneyMap(cp.overdue) : '—'} tone={Object.keys(cp.overdue).length ? 'danger' : 'default'} />
      </div>

      <Card title="Faturalar" padded={false} className="mt-6">
        {!cp.invoices.length ? (
          <p className="p-5 text-sm text-muted">Fatura yok.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Fatura no</Th>
                <Th>Tür</Th>
                <Th>Vade</Th>
                <Th>Durum</Th>
                <Th align="right">Toplam</Th>
                <Th align="right">Kalan</Th>
              </tr>
            </thead>
            <tbody>
              {cp.invoices.map((i: any) => (
                <tr key={i.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/invoices/${i.id}`)}>
                  <Td className="font-medium text-navy">{i.number}</Td>
                  <Td>{i.type === 'SALES' ? 'Satış' : 'Alış'}</Td>
                  <Td className={i.overdue ? 'text-danger' : ''}>{date(i.dueDate)}</Td>
                  <Td>
                    <StatusBadge status={i.status} overdue={i.overdue} />
                  </Td>
                  <Td align="right">{money(i.total, i.currency)}</Td>
                  <Td align="right">{money(Number(i.total) - Number(i.paidAmount), i.currency)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title="Ödeme linkleri" padded={false}>
          {!cp.paymentRequests.length ? (
            <p className="p-5 text-sm text-muted">Ödeme linki yok.</p>
          ) : (
            <Table>
              <tbody>
                {cp.paymentRequests.map((r: any) => (
                  <tr key={r.id}>
                    <Td className="text-xs text-muted">{dateTime(r.createdAt)}</Td>
                    <Td>
                      <Link href={`/collections/${r.id}`} className="text-brand">
                        {r.description}
                      </Link>
                    </Td>
                    <Td>
                      <StatusBadge status={r.status} />
                    </Td>
                    <Td align="right">{money(r.amount, r.currency)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title="Planlı ödemeler" padded={false}>
          {!cp.plannedPayments.length ? (
            <p className="p-5 text-sm text-muted">Planlı ödeme yok.</p>
          ) : (
            <Table>
              <tbody>
                {cp.plannedPayments.map((p: any) => (
                  <tr key={p.id}>
                    <Td className="text-xs text-muted">{date(p.dueDate)}</Td>
                    <Td>{p.title}</Td>
                    <Td>
                      <StatusBadge status={p.status} />
                    </Td>
                    <Td align="right">{money(p.amount, p.currency)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
      <EditModal cp={cp} open={editing} onClose={() => setEditing(false)} onSaved={reload} />
      <InvoiceFormModal
        open={addingInvoice}
        onClose={() => setAddingInvoice(false)}
        counterpartyId={cp.id}
        defaultType={cp.type === 'SUPPLIER' ? 'PURCHASE' : 'SALES'}
        onSaved={(inv) => router.push(`/invoices/${inv.id}`)}
      />
    </>
  );
}

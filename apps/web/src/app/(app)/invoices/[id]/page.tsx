'use client';

import { ArrowLeft, Download, Link2, Upload } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { SourceBadge, StatusBadge } from '@/components/badges';
import { HistoryList } from '@/components/history-list';
import { Amount } from '@/components/money';
import { PaymentLinkModal } from '@/components/payment-link-modal';
import { TxnPicker } from '@/components/txn-picker';
import { Button, Card, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, Table, Td, Th, formValues, useAction } from '@/components/ui';
import { api, download, useApi } from '@/lib/api';
import { date, dateTime, fileSize, money } from '@/lib/format';
import { useSession } from '@/lib/session';

const MATCH_LABEL: Record<string, string> = {
  TXN_INVOICE: 'Banka hareketi',
  POS_INVOICE: 'Sanal POS tahsilatı',
};

function PaymentModal({ inv, open, onClose, onDone }: { inv: any; open: boolean; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction();
  const [amount, setAmount] = useState(inv.remaining);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const ok = await run(
      () => api(`/invoices/${inv.id}/payments`, { body: { amount: Number(v.amount), transactionId: v.transactionId, note: v.note } }),
      inv.type === 'SALES' ? 'Tahsilat kaydedildi' : 'Ödeme kaydedildi',
    );
    if (ok) {
      onDone();
      onClose();
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={inv.type === 'SALES' ? 'Tahsilat kaydet' : 'Ödeme kaydet'}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted">Kalan bakiye: {money(inv.remaining, inv.currency)}</p>
        <TxnPicker
          direction={inv.type === 'SALES' ? 'IN' : 'OUT'}
          currency={inv.currency}
          onPick={(t) => t && setAmount(Math.min(Math.abs(Number(t.amount)), Number(inv.remaining)).toFixed(2))}
        />
        <Field label="Tutar">
          <Input name="amount" type="number" step="0.01" min="0.01" max={inv.remaining} required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Not">
          <Input name="note" maxLength={500} />
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

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const { data: inv, error, reload } = useApi<any>(`/invoices/${id}`);
  const [paying, setPaying] = useState(false);
  const [linking, setLinking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { run, busy } = useAction();

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!inv) return <Loading />;

  const isOpen = inv.status === 'OPEN' || inv.status === 'PARTIAL';
  const manual = inv.origin === 'MANUAL';

  async function upload(file: File) {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', 'INVOICE');
    form.append('invoiceId', inv.id);
    await run(() => api('/documents', { form }), 'Belge yüklendi');
    reload();
  }

  return (
    <>
      <Link href={`/invoices?type=${inv.type}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-navy">
        <ArrowLeft className="h-4 w-4" /> Faturalar
      </Link>
      <PageHeader
        title={`${inv.type === 'SALES' ? 'Satış' : 'Alış'} faturası ${inv.number}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/counterparties/${inv.counterparty.id}`} className="text-brand">
              {inv.counterparty.name}
            </Link>
            <StatusBadge status={inv.status} overdue={inv.overdue} />
            <SourceBadge source={inv.origin} />
          </span>
        }
        actions={
          <>
            {isOpen && inv.type === 'SALES' && can('collection.manage') && (
              <Button variant="secondary" onClick={() => setLinking(true)}>
                <Link2 className="h-4 w-4" /> Ödeme linki
              </Button>
            )}
            {isOpen && can('invoice.manage') && <Button onClick={() => setPaying(true)}>{inv.type === 'SALES' ? 'Tahsilat kaydet' : 'Ödeme kaydet'}</Button>}
            {manual && inv.status === 'OPEN' && Number(inv.paidAmount) === 0 && can('invoice.manage') && (
              <Button variant="danger" loading={busy} onClick={() => confirm('Fatura iptal edilsin mi?') && run(() => api(`/invoices/${id}/cancel`, { method: 'POST' }), 'Fatura iptal edildi').then(reload)}>
                İptal et
              </Button>
            )}
          </>
        }
      />
      {!manual && (
        <div className="mb-6">
          <Notice>Bu fatura ERP'den geliyor ({inv.erpRef}). Tutar, vade ve iptal işlemleri ERP'de yapılmalı; Tahsilo yalnızca tahsilat/ödeme eşleştirmesi ekler.</Notice>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Fatura bilgileri">
            <dl className="grid gap-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted">Toplam</dt>
                <dd className="text-lg font-semibold text-navy">{money(inv.total, inv.currency)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Ödenen</dt>
                <dd className="text-lg font-semibold text-success">{money(inv.paidAmount, inv.currency)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Kalan</dt>
                <dd className="text-lg font-semibold text-navy">{money(inv.remaining, inv.currency)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Fatura / vade</dt>
                <dd className={inv.overdue ? 'text-danger' : 'text-navy'}>
                  {date(inv.issueDate)} / {date(inv.dueDate)}
                </dd>
              </div>
            </dl>
            {inv.description && <p className="mt-4 text-sm text-muted">{inv.description}</p>}
          </Card>

          <Card title="Eşleşen ödemeler" padded={false}>
            {!inv.matches.length ? (
              <p className="p-5 text-sm text-muted">Henüz eşleşen ödeme yok.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Tür</Th>
                    <Th>Kayıt</Th>
                    <Th>Durum</Th>
                    <Th align="right">Tutar</Th>
                  </tr>
                </thead>
                <tbody>
                  {inv.matches.map((m: any) => (
                    <tr key={m.id}>
                      <Td>{MATCH_LABEL[m.type] ?? m.type}</Td>
                      <Td>
                        {m.transaction ? (
                          <Link href={`/transactions/${m.transaction.id}`} className="text-brand">
                            {date(m.transaction.date)} • {m.transaction.description}
                          </Link>
                        ) : m.attempt ? (
                          <span className="font-mono text-xs">{m.attempt.providerPaymentId} • {dateTime(m.attempt.completedAt)}</span>
                        ) : (
                          '—'
                        )}
                        {m.reason && <div className="text-xs text-muted">{m.reason}</div>}
                      </Td>
                      <Td>
                        <StatusBadge status={m.status} />
                      </Td>
                      <Td align="right">
                        <Amount value={m.transaction?.amount ?? m.attempt?.amount} currency={inv.currency} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {inv.paymentRequests.length > 0 && (
            <Card title="Ödeme linkleri" padded={false}>
              <Table>
                <tbody>
                  {inv.paymentRequests.map((r: any) => (
                    <tr key={r.id}>
                      <Td className="text-xs text-muted">{dateTime(r.createdAt)}</Td>
                      <Td>
                        <Link href={`/collections/${r.id}`} className="text-brand">
                          {r.description}
                        </Link>
                        <div className="text-xs text-muted">{r.attempts.length} deneme</div>
                      </Td>
                      <Td>
                        <StatusBadge status={r.status} />
                      </Td>
                      <Td align="right">{money(r.amount, r.currency)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}

          <Card
            title="Belgeler"
            actions={
              can('invoice.manage') && (
                <>
                  <input ref={fileRef} type="file" className="hidden" accept=".pdf,.xml,.jpg,.jpeg,.png" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                  <Button size="sm" variant="secondary" loading={busy} onClick={() => fileRef.current?.click()}>
                    <Upload className="h-3.5 w-3.5" /> Yükle
                  </Button>
                </>
              )
            }
          >
            {!inv.documents.length ? (
              <p className="text-sm text-muted">Fatura PDF'i veya e-fatura XML'i ekleyebilirsiniz.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {inv.documents.map((d: any) => (
                  <li key={d.id} className="flex items-center justify-between py-2 text-sm">
                    <span>
                      {d.fileName} <span className="text-xs text-muted">• {fileSize(d.size)} • {dateTime(d.createdAt)}</span>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => download(`/documents/${d.id}/download`)}>
                      <Download className="h-3.5 w-3.5" /> İndir
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card title="Geçmiş">
          <HistoryList items={inv.history} />
        </Card>
      </div>
      {paying && <PaymentModal inv={inv} open={paying} onClose={() => setPaying(false)} onDone={reload} />}
      <PaymentLinkModal
        open={linking}
        onClose={() => setLinking(false)}
        onCreated={reload}
        invoice={{ id: inv.id, number: inv.number, remaining: inv.remaining, currency: inv.currency }}
      />
    </>
  );
}

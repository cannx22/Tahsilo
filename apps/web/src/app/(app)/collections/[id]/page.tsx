'use client';

import { ArrowLeft, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { StatusBadge } from '@/components/badges';
import { HistoryList } from '@/components/history-list';
import { Amount } from '@/components/money';
import { CopyButton } from '@/components/payment-link-modal';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Modal, PageHeader, Table, Td, Th, formValues, useAction } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { date, dateTime, money } from '@/lib/format';
import { useSession } from '@/lib/session';

function RefundModal({ attempt, onClose, onDone }: { attempt: any; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction();
  const refunded = (attempt?.refunds ?? []).filter((r: any) => r.status === 'SUCCEEDED').reduce((s: number, r: any) => s + Number(r.amount), 0);
  const refundable = attempt ? Number(attempt.amount) - refunded : 0;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const ok = await run(() => api(`/payment-attempts/${attempt.id}/refunds`, { body: { amount: Number(v.amount), reason: v.reason } }), 'İade yapıldı');
    if (ok) {
      onDone();
      onClose();
    }
  }
  return (
    <Modal open={!!attempt} onClose={onClose} title="İade yap">
      {attempt && (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-muted">İade edilebilir tutar: {money(refundable, attempt.currency)}. İade sağlayıcı üzerinden kartın sahibine yapılır.</p>
          <Field label="Tutar">
            <Input name="amount" type="number" step="0.01" min="0.01" max={refundable} defaultValue={refundable.toFixed(2)} required />
          </Field>
          <Field label="Gerekçe">
            <Input name="reason" maxLength={300} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Vazgeç
            </Button>
            <Button type="submit" variant="danger" loading={busy}>
              İade et
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default function PaymentRequestDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const { data: r, error, reload } = useApi<any>(`/payment-requests/${id}`);
  const [refundFor, setRefundFor] = useState<any>(null);
  const { run, busy } = useAction();

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!r) return <Loading />;

  return (
    <>
      <Link href="/collections" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-navy">
        <ArrowLeft className="h-4 w-4" /> Tahsilatlar
      </Link>
      <PageHeader
        title={r.description}
        description={`Oluşturma ${dateTime(r.createdAt)} • ${r.terminal.name}`}
        actions={
          r.status === 'PENDING' &&
          can('collection.manage') && (
            <Button variant="danger" loading={busy} onClick={() => confirm('Ödeme linki iptal edilsin mi?') && run(() => api(`/payment-requests/${id}/cancel`, { method: 'POST' }), 'Link iptal edildi').then(reload)}>
              Linki iptal et
            </Button>
          )
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Ödeme talebi">
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted">Tutar</dt>
                <dd className="text-lg font-semibold text-navy">{money(r.amount, r.currency)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Durum</dt>
                <dd>
                  <StatusBadge status={r.status} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{r.paidAt ? 'Ödeme tarihi' : 'Son geçerlilik'}</dt>
                <dd className="text-navy">{r.paidAt ? dateTime(r.paidAt) : date(r.expiresAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Müşteri</dt>
                <dd className="text-navy">{r.counterparty ? <Link href={`/counterparties/${r.counterparty.id}`} className="text-brand">{r.counterparty.name}</Link> : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Fatura</dt>
                <dd>{r.invoice ? <Link href={`/invoices/${r.invoice.id}`} className="text-brand">{r.invoice.number}</Link> : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">ERP</dt>
                <dd className="text-navy">{r.erpRef ? `${r.erpRef} • ${dateTime(r.erpSyncedAt)}` : 'Aktarılmadı'}</dd>
              </div>
            </dl>
            {r.status === 'PENDING' && (
              <div className="mt-4 flex items-center gap-2">
                <Input readOnly value={r.link} onFocus={(e) => e.currentTarget.select()} />
                <CopyButton text={r.link} />
              </div>
            )}
          </Card>

          <Card title="Ödeme denemeleri" padded={false}>
            {!r.attempts.length ? (
              <EmptyState title="Henüz deneme yok" description="Müşteri ödeme sayfasına geçtiğinde denemeler burada görünür." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Tarih</Th>
                    <Th>Durum</Th>
                    <Th>Kart</Th>
                    <Th>Sağlayıcı ref.</Th>
                    <Th align="right">Tutar</Th>
                    <Th align="right">Komisyon</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {r.attempts.map((a: any) => (
                    <tr key={a.id} className="align-top">
                      <Td className="text-xs text-muted">
                        {dateTime(a.createdAt)}
                        {a.completedAt && <div>Sonuç: {dateTime(a.completedAt)}</div>}
                      </Td>
                      <Td>
                        <StatusBadge status={a.status} />
                        {a.errorMessage && <div className="mt-1 text-xs text-danger">{a.errorCode}: {a.errorMessage}</div>}
                      </Td>
                      <Td>
                        {a.cardLast4 ? `${a.cardBrand ?? ''} •••• ${a.cardLast4}` : '—'}
                        {a.threeDSecure && (
                          <div className="flex items-center gap-1 text-xs text-success">
                            <ShieldCheck className="h-3 w-3" /> 3D Secure
                          </div>
                        )}
                      </Td>
                      <Td className="font-mono text-xs text-muted">
                        <div>{a.providerPaymentId ?? '—'}</div>
                        <div>{a.providerSessionId}</div>
                      </Td>
                      <Td align="right">{money(a.amount, a.currency)}</Td>
                      <Td align="right">{money(a.commission, a.currency)}</Td>
                      <Td align="right">
                        {a.status === 'SUCCEEDED' && can('refund.create') && (
                          <Button size="sm" variant="secondary" onClick={() => setRefundFor(a)}>
                            İade
                          </Button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {r.attempts.some((a: any) => a.refunds.length) && (
              <div className="border-t border-slate-100 p-5">
                <h3 className="mb-2 text-xs font-semibold text-navy">İadeler</h3>
                <ul className="space-y-1 text-sm">
                  {r.attempts.flatMap((a: any) =>
                    a.refunds.map((f: any) => (
                      <li key={f.id} className="flex items-center justify-between gap-3">
                        <span>
                          {dateTime(f.createdAt)} • {f.reason ?? 'Gerekçe yok'} <StatusBadge status={f.status} />
                        </span>
                        <Amount value={-Number(f.amount)} currency={a.currency} />
                      </li>
                    )),
                  )}
                </ul>
              </div>
            )}
          </Card>
        </div>
        <Card title="Geçmiş">
          <HistoryList items={r.history} />
        </Card>
      </div>
      <RefundModal attempt={refundFor} onClose={() => setRefundFor(null)} onDone={reload} />
    </>
  );
}

'use client';

import { ArrowLeftRight, Play } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, StatusBadge } from '@/components/badges';
import { Amount } from '@/components/money';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Modal, PageHeader, Stat, Table, Tabs, Td, Th, formValues, useAction, useToast } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { date, dateTime, money } from '@/lib/format';
import { useSession } from '@/lib/session';

const TYPE_LABEL: Record<string, string> = {
  TXN_INVOICE: 'Fatura',
  TXN_POS: 'Sanal POS tahsilatı',
  TXN_PLANNED: 'Planlı ödeme',
  TXN_STATEMENT: 'Kart ekstresi',
  POS_INVOICE: 'POS ↔ fatura',
};

function TxnSide({ t }: { t: any }) {
  if (!t) return <span className="text-muted">—</span>;
  return (
    <div>
      <div className="text-xs text-muted">
        Banka hareketi • {date(t.date)} • {t.bankAccount?.name}
      </div>
      <Link href={`/transactions/${t.id}`} className="font-medium text-navy hover:text-brand">
        {t.description}
      </Link>
      <div>
        <Amount value={t.amount} currency={t.currency} className="font-semibold" />
      </div>
    </div>
  );
}

function RecordSide({ m }: { m: any }) {
  let title: React.ReactNode = '—';
  let sub = '';
  let amount: React.ReactNode = null;
  if (m.invoice) {
    title = (
      <Link href={`/invoices/${m.invoice.id}`} className="font-medium text-navy hover:text-brand">
        {m.invoice.number} • {m.invoice.counterparty?.name}
      </Link>
    );
    sub = m.invoice.type === 'SALES' ? 'Satış faturası' : 'Alış faturası';
    amount = `Kalan ${money(Number(m.invoice.total) - Number(m.invoice.paidAmount), m.invoice.currency)}`;
  } else if (m.attempt) {
    title = <span className="font-medium text-navy">{m.attempt.paymentRequest?.description}</span>;
    sub = `POS • ${dateTime(m.attempt.completedAt)} • ${m.attempt.providerPaymentId}`;
    amount = `Brüt ${money(m.attempt.amount)} • net ${money(Number(m.attempt.amount) - Number(m.attempt.commission))}`;
  } else if (m.plannedPayment) {
    title = <span className="font-medium text-navy">{m.plannedPayment.title}</span>;
    sub = `Planlı ödeme • vade ${date(m.plannedPayment.dueDate)}`;
    amount = money(m.plannedPayment.amount);
  } else if (m.statement) {
    title = (
      <span className="font-medium text-navy">
        {m.statement.cardAccount?.name} •••• {m.statement.cardAccount?.last4}
      </span>
    );
    sub = `Kart ekstresi • dönem sonu ${date(m.statement.periodEnd)}`;
    amount = `Kalan ${money(Number(m.statement.totalAmount) - Number(m.statement.paidAmount))}`;
  }
  return (
    <div>
      <div className="text-xs text-muted">{sub}</div>
      {title}
      <div className="text-sm">{amount}</div>
    </div>
  );
}

function Suggestions({ items, manage, onChange }: { items: any[]; manage: boolean; onChange: () => void }) {
  const { run, busy } = useAction();
  if (!items.length) return <EmptyState title="Bekleyen öneri yok" description="Ekstre içe aktarıldığında veya 'Eşleştirmeyi çalıştır' ile yeni öneriler üretilir." />;
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((m) => (
        <li key={m.id} className="grid gap-4 p-5 lg:grid-cols-[1fr_auto_1fr_auto] lg:items-center">
          <TxnSide t={m.transaction} />
          <ArrowLeftRight className="hidden h-4 w-4 text-muted lg:block" />
          <RecordSide m={m} />
          <div className="flex flex-col items-start gap-2 lg:items-end">
            <div className="flex items-center gap-2">
              <Badge tone="info">{TYPE_LABEL[m.type]}</Badge>
              <Badge tone={m.score >= 80 ? 'success' : m.score >= 60 ? 'warning' : 'neutral'}>Puan {m.score}</Badge>
            </div>
            <div className="text-xs text-muted">{m.reason}</div>
            {Number(m.difference) !== 0 && <div className="text-xs font-medium text-warning-700">Fark: {money(m.difference)}</div>}
            {manage && (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => api(`/reconciliation/matches/${m.id}/reject`, { method: 'POST' }), 'Öneri reddedildi').then(onChange)}>
                  Reddet
                </Button>
                <Button size="sm" disabled={busy} onClick={() => run(() => api(`/reconciliation/matches/${m.id}/confirm`, { method: 'POST' }), 'Eşleşme onaylandı').then(onChange)}>
                  Onayla
                </Button>
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function IgnoreModal({ txn, onClose, onDone }: { txn: any; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction();
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const ok = await run(() => api(`/reconciliation/transactions/${txn.id}/ignore`, { body: { ignored: true, note: v.note } }), 'Hareket mutabakat dışı bırakıldı');
    if (ok) {
      onDone();
      onClose();
    }
  }
  return (
    <Modal open={!!txn} onClose={onClose} title="Mutabakat dışı bırak">
      {txn && (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-navy">
            {date(txn.date)} • {txn.description} • {money(txn.amount, txn.currency)}
          </p>
          <Field label="Gerekçe" hint="Ör. hesaplar arası virman, maaş ödemesi">
            <Input name="note" required maxLength={500} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Vazgeç
            </Button>
            <Button type="submit" loading={busy}>
              Kapsam dışı bırak
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

type Tab = 'suggestions' | 'unmatched' | 'pos' | 'diff';

export default function ReconciliationPage() {
  const { can } = useSession();
  const manage = can('recon.manage');
  const { data, error, reload } = useApi<any>('/reconciliation');
  const [tab, setTab] = useState<Tab>('suggestions');
  const [ignoring, setIgnoring] = useState<any>(null);
  const { run, busy } = useAction();
  const toast = useToast();

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const c = data.counts;

  return (
    <>
      <PageHeader
        title="Mutabakat"
        description={`Son ${data.days} gündeki banka hareketleri; POS tahsilatları, faturalar, planlı ödemeler ve kart ekstreleriyle karşılaştırılır. Öneriler onaylanana kadar kayıtları değiştirmez.`}
        actions={
          manage && (
            <Button
              loading={busy}
              onClick={() =>
                run(() => api<{ scanned: number; suggestions: number }>('/reconciliation/run', { method: 'POST' })).then((r) => {
                  if (r) toast(`${r.scanned} hareket tarandı, ${r.suggestions} yeni öneri üretildi.`);
                  reload();
                })
              }
            >
              <Play className="h-4 w-4" /> Eşleştirmeyi çalıştır
            </Button>
          )
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Eşleşti" value={c.MATCHED ?? 0} tone="success" />
        <Stat label="Öneri var" value={c.SUGGESTED ?? 0} />
        <Stat label="Eşleşmedi" value={c.UNMATCHED ?? 0} tone={(c.UNMATCHED ?? 0) > 0 ? 'warning' : 'default'} />
        <Stat label="Kapsam dışı" value={c.IGNORED ?? 0} />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: 'suggestions', label: `Öneriler (${data.suggestions.length})` },
          { key: 'unmatched', label: `Eşleşmeyen hareketler (${data.unmatched.length})` },
          { key: 'pos', label: `Bankaya geçmemiş POS (${data.posUnsettled.length})` },
          { key: 'diff', label: `Tutar farkları (${data.differences.length})` },
        ]}
      />
      <Card padded={false}>
        {tab === 'suggestions' && <Suggestions items={data.suggestions} manage={manage} onChange={reload} />}

        {tab === 'unmatched' &&
          (!data.unmatched.length ? (
            <EmptyState title="Eşleşmeyen hareket yok" description="Kategorize edilmemiş ve eşleşmemiş banka hareketleri burada listelenir." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Tarih</Th>
                  <Th>Hesap</Th>
                  <Th>Açıklama</Th>
                  <Th>Durum</Th>
                  <Th align="right">Tutar</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {data.unmatched.map((t: any) => (
                  <tr key={t.id}>
                    <Td className="text-xs text-muted">{date(t.date)}</Td>
                    <Td>{t.bankAccount?.name}</Td>
                    <Td>
                      <Link href={`/transactions/${t.id}`} className="text-navy hover:text-brand">
                        {t.description}
                      </Link>
                      {t.counterpartyName && <div className="text-xs text-muted">{t.counterpartyName}</div>}
                    </Td>
                    <Td>
                      <StatusBadge status={t.reconStatus} />
                    </Td>
                    <Td align="right">
                      <Amount value={t.amount} currency={t.currency} />
                    </Td>
                    <Td align="right">
                      {manage && (
                        <Button size="sm" variant="ghost" onClick={() => setIgnoring(t)}>
                          Kapsam dışı bırak
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ))}

        {tab === 'pos' &&
          (!data.posUnsettled.length ? (
            <EmptyState title="Bekleyen POS tahsilatı yok" description="3 günden eski olup banka hesabına geçişi eşleşmemiş sanal POS tahsilatları burada görünür." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Tahsilat tarihi</Th>
                  <Th>Açıklama</Th>
                  <Th>Sağlayıcı ref.</Th>
                  <Th align="right">Brüt</Th>
                  <Th align="right">Komisyon</Th>
                  <Th align="right">Beklenen net</Th>
                </tr>
              </thead>
              <tbody>
                {data.posUnsettled.map((a: any) => (
                  <tr key={a.id}>
                    <Td className="text-xs text-muted">{dateTime(a.completedAt)}</Td>
                    <Td>
                      <Link href={`/collections/${a.paymentRequest.id}`} className="text-navy hover:text-brand">
                        {a.paymentRequest.description}
                      </Link>
                    </Td>
                    <Td className="font-mono text-xs text-muted">{a.providerPaymentId}</Td>
                    <Td align="right">{money(a.amount, a.currency)}</Td>
                    <Td align="right">{money(a.commission, a.currency)}</Td>
                    <Td align="right" className="font-medium">
                      {money(Number(a.amount) - Number(a.commission), a.currency)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ))}

        {tab === 'diff' &&
          (!data.differences.length ? (
            <EmptyState title="Tutar farkı yok" description="Onaylanmış ama tutarları tam tutmayan eşleşmeler burada listelenir." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Tarih</Th>
                  <Th>Banka hareketi</Th>
                  <Th>Eşleşen kayıt</Th>
                  <Th align="right">Hareket tutarı</Th>
                  <Th align="right">Fark</Th>
                </tr>
              </thead>
              <tbody>
                {data.differences.map((m: any) => (
                  <tr key={m.id}>
                    <Td className="text-xs text-muted">{date(m.transaction?.date)}</Td>
                    <Td>{m.transaction?.description}</Td>
                    <Td>
                      {m.invoice ? (
                        <Link href={`/invoices/${m.invoice.id}`} className="text-brand">
                          {m.invoice.number}
                        </Link>
                      ) : m.statement ? (
                        `Ekstre ${date(m.statement.periodEnd)}`
                      ) : (
                        TYPE_LABEL[m.type]
                      )}
                    </Td>
                    <Td align="right">
                      <Amount value={m.transaction?.amount} currency={m.transaction?.currency} />
                    </Td>
                    <Td align="right" className="font-medium text-warning-700">
                      {money(m.difference, m.transaction?.currency)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ))}
      </Card>
      <IgnoreModal txn={ignoring} onClose={() => setIgnoring(null)} onDone={reload} />
    </>
  );
}

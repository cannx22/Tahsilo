'use client';

import { ArrowLeft, Download, Paperclip, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuditTrail } from '@/components/audit-trail';
import { SourceBadge, SourceTypeLabel, StatusBadge } from '@/components/badges';
import { ExpenseModal, useReference } from '@/components/expense-form';
import { Amount } from '@/components/money';
import { Button, Card, EmptyState, ErrorBox, Field, Loading, PageHeader, Select, Table, Td, Textarea, Th, useAction } from '@/components/ui';
import { api, download, useApi } from '@/lib/api';
import { date, dateTime, fileSize, money } from '@/lib/format';
import { useSession } from '@/lib/session';

const SOURCE_TYPE: Record<string, string> = { BANK: 'Banka hareketi', CARD: 'Kart hareketi', POS: 'Sanal POS kaydı', MANUAL: 'Manuel kayıt' };
const MATCH_TYPE: Record<string, string> = {
  TXN_INVOICE: 'Fatura',
  TXN_POS: 'Sanal POS tahsilatı',
  TXN_PLANNED: 'Planlı ödeme',
  TXN_STATEMENT: 'Kart ekstresi',
  POS_INVOICE: 'Fatura',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-right text-navy">{children}</span>
    </div>
  );
}

export default function TransactionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const { data: t, error, reload } = useApi<any>(`/transactions/${id}`);
  const ref = useReference();
  const [categoryId, setCategoryId] = useState('');
  const [note, setNote] = useState('');
  const [expenseOpen, setExpenseOpen] = useState(false);
  const { run, busy } = useAction();

  useEffect(() => {
    if (t) {
      setCategoryId(t.categoryId ?? '');
      setNote(t.note ?? '');
    }
  }, [t]);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!t) return <Loading />;

  const editable = can('txn.edit');
  const isOutflow = Number(t.amount) < 0;

  async function save() {
    const ok = await run(() => api(`/transactions/${id}`, { method: 'PATCH', body: { categoryId: categoryId || null, note: note || null } }), 'Kaydedildi');
    if (ok) reload();
  }

  async function upload(file: File) {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', 'BANK_RECEIPT');
    form.append('transactionId', id);
    const ok = await run(() => api('/documents', { form }), 'Belge eklendi');
    if (ok) reload();
  }

  return (
    <>
      <Link href="/transactions" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-navy">
        <ArrowLeft className="h-4 w-4" /> Hareketler
      </Link>
      <PageHeader
        title={t.description}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {date(t.date)} • {SOURCE_TYPE[t.sourceType]} <StatusBadge status={t.status} /> <SourceBadge source={t.dataSource} />
          </span>
        }
        actions={<Amount value={t.amount} currency={t.currency} className="text-2xl font-semibold" />}
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Sınıflandırma">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Kategori" hint={t.suggestedCategory ? undefined : 'Gider kategorisi raporlarda kullanılır'}>
                <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!editable}>
                  <option value="">Kategorisiz</option>
                  {ref.data?.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                {t.suggestedCategory && editable && !categoryId && (
                  <button onClick={() => setCategoryId(t.suggestedCategory.id)} className="mt-1 inline-flex items-center gap-1 text-xs text-brand">
                    <Sparkles className="h-3 w-3" /> Öneri: {t.suggestedCategory.name}
                  </button>
                )}
              </Field>
              <Field label="Not">
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} disabled={!editable} maxLength={1000} className="min-h-[42px]" />
              </Field>
            </div>
            {editable && (
              <div className="mt-3 flex justify-end">
                <Button onClick={save} loading={busy}>
                  Kaydet
                </Button>
              </div>
            )}
          </Card>

          <Card title="Gider kaydı">
            {t.expense ? (
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <div>
                  <div className="font-medium text-navy">{t.expense.category?.name}</div>
                  <div className="text-xs text-muted">
                    {t.expense.description}
                    {t.expense.department && ` • ${t.expense.department.name}`}
                    {t.expense.costCenter && ` • ${t.expense.costCenter.code}`}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={t.expense.status} />
                  <Link href={`/expenses/${t.expense.id}`} className="font-medium text-brand">
                    Gidere git →
                  </Link>
                </div>
              </div>
            ) : isOutflow && t.status !== 'REVERSED' && can('expense.create') ? (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted">Bu çıkış henüz gider olarak kaydedilmedi.</span>
                <Button variant="secondary" onClick={() => setExpenseOpen(true)}>
                  Gider oluştur
                </Button>
              </div>
            ) : (
              <span className="text-sm text-muted">{isOutflow ? 'Gider kaydı yok.' : 'Para girişleri gider olarak kaydedilmez.'}</span>
            )}
          </Card>

          <Card
            title="Belgeler"
            padded={false}
            actions={
              editable && (
                <label className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-brand">
                  <Paperclip className="h-3.5 w-3.5" /> Belge ekle
                  <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.xml" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                </label>
              )
            }
          >
            {!t.documents.length ? (
              <EmptyState title="Belge yok" description="Dekont, fatura veya fiş ekleyebilirsiniz." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {t.documents.map((d: any) => (
                  <li key={d.id} className="flex items-center justify-between px-5 py-2 text-sm">
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

          <Card title="Mutabakat eşleşmeleri" padded={false}>
            {!t.matches.length ? (
              <EmptyState title="Eşleşme yok" description={t.sourceType === 'BANK' ? 'Mutabakat ekranından öneri çalıştırabilirsiniz.' : undefined} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Tür</Th>
                    <Th>Kayıt</Th>
                    <Th>Durum</Th>
                    <Th align="right">Fark</Th>
                    <Th>Gerekçe</Th>
                  </tr>
                </thead>
                <tbody>
                  {t.matches.map((m: any) => (
                    <tr key={m.id}>
                      <Td>{MATCH_TYPE[m.type] ?? m.type}</Td>
                      <Td>
                        {m.invoice ? (
                          <Link href={`/invoices/${m.invoice.id}`} className="text-brand">
                            {m.invoice.number}
                          </Link>
                        ) : m.plannedPayment ? (
                          m.plannedPayment.title
                        ) : m.attempt ? (
                          `POS ${money(m.attempt.amount, t.currency)}`
                        ) : m.statement ? (
                          `Ekstre ${date(m.statement.periodEnd)}`
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td>
                        <StatusBadge status={m.status} />
                      </Td>
                      <Td align="right">{money(m.difference, t.currency)}</Td>
                      <Td className="text-xs text-muted">{m.reason}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {t.auditTrail.length > 0 && (
            <Card title="Denetim izi" padded={false}>
              <AuditTrail logs={t.auditTrail} />
            </Card>
          )}
        </div>

        <Card title="Kaynak">
          <Row label="Kaynak türü">
            <SourceTypeLabel type={t.sourceType} />
          </Row>
          <Row label="Veri kalitesi">
            <SourceBadge source={t.dataSource} />
          </Row>
          <Row label="Hesap / kart">
            {t.bankAccount ? `${t.bankAccount.bankName} • ${t.bankAccount.name}` : t.cardAccount ? `${t.cardAccount.name} •••• ${t.cardAccount.last4}` : 'Nakit / hesapsız'}
          </Row>
          {t.statement && <Row label="Ekstre dönemi">{`${date(t.statement.periodStart)} – ${date(t.statement.periodEnd)}`}</Row>}
          <Row label="Kaynak referansı">{t.sourceRef ?? '—'}</Row>
          {t.counterpartyName && <Row label="Karşı taraf">{t.counterpartyName}</Row>}
          {t.importBatch && (
            <Row label="İçe aktarma">
              {t.importBatch.fileName}
              <div className="text-xs text-muted">{dateTime(t.importBatch.createdAt)}</div>
            </Row>
          )}
          <Row label="Oluşturan">{t.createdBy?.name ?? 'Sistem'}</Row>
          <Row label="Kayıt zamanı">{dateTime(t.createdAt)}</Row>
          <Row label="Mutabakat">
            {t.sourceType === 'BANK' ? <StatusBadge status={t.reconStatus} /> : '—'}
          </Row>
        </Card>
      </div>

      {expenseOpen && (
        <ExpenseModal
          open
          onClose={() => setExpenseOpen(false)}
          transaction={t}
          defaultCategoryId={t.categoryId ?? t.suggestedCategory?.id}
          onSaved={() => {
            setExpenseOpen(false);
            reload();
          }}
        />
      )}
    </>
  );
}

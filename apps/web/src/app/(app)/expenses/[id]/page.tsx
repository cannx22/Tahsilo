'use client';

import { ArrowLeft, Check, Download, Paperclip, X } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AuditTrail } from '@/components/audit-trail';
import { SourceBadge, StatusBadge } from '@/components/badges';
import { useReference } from '@/components/expense-form';
import { Amount } from '@/components/money';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, Select, Textarea, formValues, useAction } from '@/components/ui';
import { api, download, useApi } from '@/lib/api';
import { date, dateTime, fileSize, money } from '@/lib/format';
import { ROLE_LABEL, useSession } from '@/lib/session';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-right text-navy">{children}</span>
    </div>
  );
}

export default function ExpenseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { me, can } = useSession();
  const { data: e, error, reload } = useApi<any>(`/expenses/${id}`);
  const ref = useReference();
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const { run, busy } = useAction();

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!e) return <Loading />;

  // Onay yetkisi sunucuda onay kurallarına göre hesaplanır
  const canApprove = e.status === 'SUBMITTED' && !!e.canDecide;
  const approverRoles: string[] | null = e.requiredApproverRoles ?? null;
  const canEdit = !e.erpSyncedAt && (can('expense.approve') || (e.submittedById === me.id && e.status !== 'APPROVED'));
  const canUpload = can('expense.create') && (e.submittedById === me.id || can('expense.approve'));

  async function approve() {
    const ok = await run(() => api(`/expenses/${id}/approve`, { body: {} }), 'Gider onaylandı');
    if (ok) reload();
  }

  async function reject(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const ok = await run(() => api(`/expenses/${id}/reject`, { body: formValues(ev.currentTarget) }), 'Gider reddedildi');
    if (ok) {
      setRejecting(false);
      reload();
    }
  }

  async function save(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const v = formValues(ev.currentTarget);
    const body = {
      categoryId: v.categoryId,
      departmentId: v.departmentId ?? null,
      costCenterId: v.costCenterId ?? null,
      project: v.project ?? null,
      merchant: v.merchant ?? null,
      description: v.description,
    };
    const ok = await run(() => api(`/expenses/${id}`, { method: 'PATCH', body }), 'Gider güncellendi');
    if (ok) {
      setEditing(false);
      reload();
    }
  }

  async function upload(file: File) {
    const form = new FormData();
    form.append('file', file);
    const ok = await run(() => api(`/expenses/${id}/receipts`, { form }), 'Fiş eklendi');
    if (ok) reload();
  }

  return (
    <>
      <Link href="/expenses" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-navy">
        <ArrowLeft className="h-4 w-4" /> Harcamalar
      </Link>
      <PageHeader
        title={e.description}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {date(e.date)} • {e.submittedBy?.name} <StatusBadge status={e.status} />
          </span>
        }
        actions={
          <>
            {canEdit && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Düzenle
              </Button>
            )}
            {canApprove && (
              <>
                <Button variant="danger" onClick={() => setRejecting(true)}>
                  <X className="h-4 w-4" /> Reddet
                </Button>
                <Button onClick={approve} loading={busy}>
                  <Check className="h-4 w-4" /> Onayla
                </Button>
              </>
            )}
          </>
        }
      />

      {e.status === 'SUBMITTED' && (
        <div className="mb-4">
          <Notice>
            <span className="font-medium">Onaylayabilecek roller:</span>{' '}
            {approverRoles?.length
              ? ['OWNER', ...approverRoles.filter((r) => r !== 'OWNER')].map((r) => ROLE_LABEL[r as keyof typeof ROLE_LABEL] ?? r).join(', ')
              : 'Gider onay yetkisi olan tüm roller (bu tutar için özel kural yok)'}
            {!canApprove && can('expense.approve') && e.cannotDecideReason && <span className="mt-1 block text-warning-700">{e.cannotDecideReason}</span>}
          </Notice>
        </div>
      )}

      {e.status === 'REJECTED' && e.submittedById === me.id && (
        <div className="mb-4">
          <Notice tone="warning">Gider reddedildi. Düzenlediğinizde yeniden onaya gönderilir.</Notice>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card
            title="Fiş ve belgeler"
            padded={false}
            actions={
              canUpload && (
                <label className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-brand">
                  <Paperclip className="h-3.5 w-3.5" /> Fiş ekle
                  <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.xml" onChange={(ev) => ev.target.files?.[0] && upload(ev.target.files[0])} />
                </label>
              )
            }
          >
            {!e.documents.length ? (
              <EmptyState title="Fiş eklenmemiş" description="Fiş veya fatura görüntüsü (PDF, JPG, PNG) ekleyin." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {e.documents.map((d: any) => (
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

          <Card title="Onay geçmişi" padded={false}>
            {e.history.length ? <AuditTrail logs={e.history} /> : <EmptyState title="Kayıt yok" />}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Gider">
            <Row label="Tutar">{money(e.amount, e.currency)}</Row>
            <Row label="Kategori">{e.category.name}</Row>
            <Row label="Departman">{e.department?.name ?? '—'}</Row>
            <Row label="Maliyet merkezi">{e.costCenter ? `${e.costCenter.code} ${e.costCenter.name}` : '—'}</Row>
            <Row label="Proje">{e.project ?? '—'}</Row>
            <Row label="İş yeri">{e.merchant ?? '—'}</Row>
            <Row label="ERP">{e.erpRef ? `${e.erpRef} • ${dateTime(e.erpSyncedAt)}` : 'Aktarılmadı'}</Row>
          </Card>
          <Card title="Kaynak hareket">
            {e.transaction ? (
              <>
                <Link href={`/transactions/${e.transaction.id}`} className="font-medium text-brand">
                  {e.transaction.description}
                </Link>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <Amount value={e.transaction.amount} currency={e.transaction.currency} />
                  <StatusBadge status={e.transaction.status} />
                  <SourceBadge source={e.transaction.dataSource} />
                </div>
                <div className="mt-1 text-xs text-muted">
                  {date(e.transaction.date)} •{' '}
                  {e.transaction.cardAccount ? `${e.transaction.cardAccount.name} •••• ${e.transaction.cardAccount.last4}` : e.transaction.bankAccount?.name}
                </div>
              </>
            ) : (
              <span className="text-sm text-muted">Hareketsiz (nakit) gider</span>
            )}
          </Card>
        </div>
      </div>

      <Modal
        open={rejecting}
        onClose={() => setRejecting(false)}
        title="Gideri reddet"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(false)}>
              Vazgeç
            </Button>
            <Button variant="danger" type="submit" form="reject-form" loading={busy}>
              Reddet
            </Button>
          </>
        }
      >
        <form id="reject-form" onSubmit={reject}>
          <Field label="Red gerekçesi">
            <Textarea name="comment" required maxLength={1000} />
          </Field>
        </form>
      </Modal>

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Gideri düzenle"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Vazgeç
            </Button>
            <Button type="submit" form="edit-form" loading={busy}>
              Kaydet
            </Button>
          </>
        }
      >
        <form id="edit-form" onSubmit={save} className="grid grid-cols-2 gap-3">
          <Field label="Kategori" className="col-span-2">
            <Select name="categoryId" defaultValue={e.categoryId} required>
              {ref.data?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Departman">
            <Select name="departmentId" defaultValue={e.departmentId ?? ''}>
              <option value="">—</option>
              {ref.data?.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Maliyet merkezi">
            <Select name="costCenterId" defaultValue={e.costCenterId ?? ''}>
              <option value="">—</option>
              {ref.data?.costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Proje">
            <Input name="project" defaultValue={e.project ?? ''} maxLength={120} />
          </Field>
          <Field label="İş yeri">
            <Input name="merchant" defaultValue={e.merchant ?? ''} maxLength={200} />
          </Field>
          <Field label="Açıklama" className="col-span-2">
            <Textarea name="description" defaultValue={e.description} required maxLength={1000} />
          </Field>
        </form>
      </Modal>
    </>
  );
}

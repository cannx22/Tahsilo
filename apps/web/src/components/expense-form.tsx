'use client';

import { api, useApi } from '@/lib/api';
import { isoDate, money } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Button, Field, Input, Modal, Select, Textarea, formValues, useAction } from './ui';

export interface Reference {
  categories: { id: string; name: string; code: string | null; keywords: string[]; isActive: boolean }[];
  departments: { id: string; name: string }[];
  costCenters: { id: string; code: string; name: string }[];
  branches: { id: string; code: string; name: string; isActive: boolean }[];
  roles: { key: string; label: string; permissions: string[] }[];
}

export function useReference() {
  return useApi<Reference>('/settings/reference');
}

/**
 * Gider oluşturma formu. transaction verilirse tutar/tarih hareketten alınır;
 * verilmezse nakit (hareketsiz) gider oluşturulur.
 */
export function ExpenseModal({
  open,
  onClose,
  onSaved,
  transaction,
  defaultCategoryId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (expense: any) => void;
  transaction?: { id: string; description: string; amount: string; currency: string; date: string };
  defaultCategoryId?: string | null;
}) {
  const { me } = useSession();
  const ref = useReference();
  const { run, busy } = useAction();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const body: Record<string, unknown> = { ...v };
    if (transaction) body.transactionId = transaction.id;
    if (v.amount) body.amount = Number(v.amount);
    const r = await run(() => api('/expenses', { body }), 'Gider kaydedildi');
    if (r) onSaved(r);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={transaction ? 'Hareketten gider oluştur' : 'Gider ekle'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form="expense-form" loading={busy}>
            Kaydet
          </Button>
        </>
      }
    >
      <form id="expense-form" onSubmit={submit} className="grid grid-cols-2 gap-3">
        {transaction ? (
          <div className="col-span-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <div className="font-medium text-navy">{transaction.description}</div>
            <div className="text-xs text-muted">
              {transaction.date.slice(0, 10)} • {money(transaction.amount, transaction.currency)} — tutar ve tarih hareketten alınır
            </div>
          </div>
        ) : (
          <>
            <Field label="Tarih">
              <Input name="date" type="date" defaultValue={isoDate(new Date())} required />
            </Field>
            <Field label="Tutar">
              <Input name="amount" type="number" step="0.01" min="0.01" required />
            </Field>
            <Field label="Para birimi">
              <Input name="currency" defaultValue="TRY" maxLength={3} minLength={3} />
            </Field>
          </>
        )}
        <Field label="Kategori" className={transaction ? 'col-span-2' : ''}>
          <Select name="categoryId" required defaultValue={defaultCategoryId ?? ''}>
            <option value="" disabled>
              Seçin
            </option>
            {ref.data?.categories
              .filter((c) => c.isActive)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Departman">
          <Select name="departmentId" defaultValue={me.department?.id ?? ''}>
            <option value="">—</option>
            {ref.data?.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Maliyet merkezi">
          <Select name="costCenterId" defaultValue="">
            <option value="">—</option>
            {ref.data?.costCenters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Proje">
          <Input name="project" maxLength={120} />
        </Field>
        <Field label="İş yeri">
          <Input name="merchant" maxLength={200} />
        </Field>
        <Field label="Açıklama / iş gerekçesi" className="col-span-2">
          <Textarea name="description" required maxLength={1000} />
        </Field>
      </form>
    </Modal>
  );
}

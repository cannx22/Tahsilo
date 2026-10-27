'use client';

import { api, useApi } from '@/lib/api';
import { isoDate } from '@/lib/format';
import { BranchField } from './branch-select';
import { Button, Field, Input, Modal, Select, formValues, useAction } from './ui';

export function InvoiceFormModal({ open, onClose, onSaved, defaultType = 'SALES', counterpartyId }: { open: boolean; onClose: () => void; onSaved: (inv: any) => void; defaultType?: 'SALES' | 'PURCHASE'; counterpartyId?: string }) {
  const { run, busy } = useAction();
  const cps = useApi<{ items: any[] }>(open && !counterpartyId ? '/counterparties' : null);
  const today = isoDate(new Date());
  const in30 = isoDate(new Date(Date.now() + 30 * 86400000));

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const inv = await run(
      () =>
        api('/invoices', {
          body: {
            type: v.type,
            number: v.number,
            counterpartyId: counterpartyId ?? v.counterpartyId,
            issueDate: v.issueDate,
            dueDate: v.dueDate,
            total: Number(v.total),
            currency: v.currency,
            description: v.description,
            branchId: v.branchId,
          },
        }),
      'Fatura oluşturuldu',
    );
    if (inv) {
      onSaved(inv);
      onClose();
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Manuel fatura ekle">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-xs text-muted">ERP bağlıysa faturalar ERP senkronizasyonuyla gelir. Manuel faturalar "Manuel" kaynaklı olarak işaretlenir.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tür">
            <Select name="type" defaultValue={defaultType}>
              <option value="SALES">Satış (alacak)</option>
              <option value="PURCHASE">Alış (borç)</option>
            </Select>
          </Field>
          <Field label="Fatura no">
            <Input name="number" required maxLength={40} />
          </Field>
        </div>
        {!counterpartyId && (
          <Field label="Cari">
            <Select name="counterpartyId" required defaultValue="">
              <option value="" disabled>
                Seçin
              </option>
              {(cps.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fatura tarihi">
            <Input name="issueDate" type="date" required defaultValue={today} />
          </Field>
          <Field label="Vade">
            <Input name="dueDate" type="date" required defaultValue={in30} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Toplam" className="col-span-2">
            <Input name="total" type="number" step="0.01" min="0.01" required />
          </Field>
          <Field label="Para birimi">
            <Select name="currency" defaultValue="TRY">
              <option>TRY</option>
              <option>USD</option>
              <option>EUR</option>
            </Select>
          </Field>
        </div>
        <Field label="Açıklama">
          <Input name="description" maxLength={500} />
        </Field>
        <BranchField />
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

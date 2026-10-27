'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, useApi } from '@/lib/api';
import { money } from '@/lib/format';
import { Button, ErrorBox, Field, Input, Modal, Select, formValues } from './ui';

export function CopyButton({ text, label = 'Kopyala' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? 'Kopyalandı' : label}
    </Button>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (req: any) => void;
  /** Fatura detayından açıldığında fatura sabitlenir. */
  invoice?: { id: string; number: string; remaining: string; currency: string; counterpartyId?: string };
}

export function PaymentLinkModal({ open, onClose, onCreated, invoice }: Props) {
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<any>(null);
  const [invoiceId, setInvoiceId] = useState(invoice?.id ?? '');
  const [amount, setAmount] = useState(invoice?.remaining ?? '');

  const openInv = useApi<{ items: any[] }>(open && !invoice ? '/invoices?type=SALES&status=OPEN' : null);
  const partialInv = useApi<{ items: any[] }>(open && !invoice ? '/invoices?type=SALES&status=PARTIAL' : null);
  const counterparties = useApi<{ items: any[] }>(open ? '/counterparties?type=CUSTOMER' : null);
  const terminals = useApi<{ items: any[] }>(open ? '/terminals' : null);
  const openInvoices = [...(openInv.data?.items ?? []), ...(partialInv.data?.items ?? [])];
  const selected = invoice ?? openInvoices.find((i) => i.id === invoiceId);

  useEffect(() => {
    if (!open) {
      setCreated(null);
      setError(null);
      setInvoiceId(invoice?.id ?? '');
      setAmount(invoice?.remaining ?? '');
    }
  }, [open, invoice]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const v = formValues(e.currentTarget);
    try {
      const req = await api('/payment-requests', {
        body: {
          amount: Number(v.amount),
          description: v.description,
          invoiceId: invoiceId || undefined,
          counterpartyId: invoiceId ? undefined : v.counterpartyId,
          customerEmail: v.customerEmail,
          terminalId: v.terminalId,
          expiresInDays: v.expiresInDays ? Number(v.expiresInDays) : undefined,
          currency: invoiceId ? undefined : v.currency,
        },
      });
      setCreated(req);
      onCreated?.(req);
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  const activeTerminals = (terminals.data?.items ?? []).filter((t) => t.isActive);

  return (
    <Modal open={open} onClose={onClose} title="Ödeme linki oluştur">
      {created ? (
        <div className="space-y-4">
          <p className="text-sm text-navy">
            {money(created.amount, created.currency)} tutarlı ödeme linki oluşturuldu. Linki müşterinize iletin; kart bilgileri ödeme sağlayıcısının güvenli sayfasında alınır.
          </p>
          <div className="flex items-center gap-2">
            <Input readOnly value={created.link} onFocus={(e) => e.currentTarget.select()} />
            <CopyButton text={created.link} />
          </div>
          <div className="flex justify-end">
            <Button onClick={onClose}>Tamam</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <ErrorBox error={error} />
          {terminals.data && activeTerminals.length === 0 && (
            <ErrorBox error={{ message: 'Aktif sanal POS terminali yok. Önce Tahsilatlar › Terminaller bölümünden terminal ekleyin.' }} />
          )}
          {invoice ? (
            <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-navy">
              Fatura <b>{invoice.number}</b> • kalan {money(invoice.remaining, invoice.currency)}
            </div>
          ) : (
            <Field label="Fatura" hint="İsteğe bağlı. Seçilirse tahsilat faturaya otomatik bağlanır.">
              <Select
                value={invoiceId}
                onChange={(e) => {
                  setInvoiceId(e.target.value);
                  const inv = openInvoices.find((i) => i.id === e.target.value);
                  if (inv) setAmount(inv.remaining);
                }}
              >
                <option value="">Faturasız tahsilat</option>
                {openInvoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.number} • {i.counterparty.name} • kalan {money(i.remaining, i.currency)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {!selected && (
            <Field label="Müşteri">
              <Select name="counterpartyId" defaultValue="">
                <option value="">Seçilmedi</option>
                {(counterparties.data?.items ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Tutar" className="col-span-2">
              <Input name="amount" type="number" step="0.01" min="1" required value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Para birimi">
              {selected ? (
                <Input value={selected.currency} disabled />
              ) : (
                <Select name="currency" defaultValue="TRY">
                  <option>TRY</option>
                  <option>USD</option>
                  <option>EUR</option>
                </Select>
              )}
            </Field>
          </div>
          <Field label="Açıklama">
            <Input name="description" required maxLength={300} defaultValue={selected ? `${selected.number} nolu fatura ödemesi` : ''} key={selected?.id ?? 'none'} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Müşteri e-postası" hint="İsteğe bağlı">
              <Input name="customerEmail" type="email" />
            </Field>
            <Field label="Geçerlilik (gün)">
              <Input name="expiresInDays" type="number" min="1" max="90" defaultValue="7" />
            </Field>
          </div>
          {activeTerminals.length > 1 && (
            <Field label="Terminal">
              <Select name="terminalId" defaultValue={activeTerminals.find((t) => t.isDefault)?.id}>
                {activeTerminals.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Vazgeç
            </Button>
            <Button type="submit" loading={busy}>
              Linki oluştur
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

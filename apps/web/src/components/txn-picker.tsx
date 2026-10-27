'use client';

import { qs, useApi } from '@/lib/api';
import { date, money } from '@/lib/format';
import { Field, Select } from './ui';

/** Mutabakatı yapılmamış banka/manuel hareketlerden birini seçtirir (isteğe bağlı). */
export function TxnPicker({ direction, currency, name = 'transactionId', onPick }: { direction: 'IN' | 'OUT'; currency?: string; name?: string; onPick?: (t: any | null) => void }) {
  const { data } = useApi<{ items: any[] }>(`/transactions${qs({ reconStatus: 'UNMATCHED', direction, pageSize: 100 })}`);
  const items = (data?.items ?? []).filter((t) => t.sourceType !== 'POS' && (!currency || t.currency === currency));
  return (
    <Field label={direction === 'IN' ? 'Banka girişi (isteğe bağlı)' : 'Banka çıkışı (isteğe bağlı)'} hint="Seçilirse hareket bu kayıtla eşleştirilmiş olarak işaretlenir.">
      <Select name={name} defaultValue="" onChange={(e) => onPick?.(items.find((t) => t.id === e.target.value) ?? null)}>
        <option value="">Hareket bağlama</option>
        {items.map((t) => (
          <option key={t.id} value={t.id}>
            {date(t.date)} • {money(t.amount, t.currency)} • {t.description.slice(0, 50)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

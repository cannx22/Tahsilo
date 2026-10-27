'use client';

import { useSession } from '@/lib/session';
import { Field, Select } from './ui';

/** Form içinde şube seçimi; firmada aktif şube yoksa hiç gösterilmez. Boş değer "şubesiz" demektir. */
export function BranchField({ defaultValue, hint, currentName }: { defaultValue?: string | null; hint?: string; currentName?: string }) {
  const { me, branchId } = useSession();
  // Kayıt pasif bir şubeye bağlıysa o şube de seçenek olarak kalır; aksi halde kaydetmek şubeyi sessizce silerdi
  const inactiveCurrent = !!defaultValue && !me.branches.some((b) => b.id === defaultValue);
  if (!me.branches.length && !inactiveCurrent) return null;
  return (
    <Field label="Şube" hint={hint}>
      <Select name="branchId" defaultValue={defaultValue === undefined ? (branchId ?? '') : (defaultValue ?? '')}>
        <option value="">Şubesiz / merkez</option>
        {inactiveCurrent && <option value={defaultValue!}>{currentName ?? 'Mevcut şube'} (pasif)</option>}
        {me.branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

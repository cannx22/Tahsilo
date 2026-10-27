import clsx from 'clsx';
import { money } from '@/lib/format';

/** İşaretli tutar: girişler yeşil, çıkışlar lacivert; işaret her zaman metinle de gösterilir. */
export function Amount({ value, currency = 'TRY', signed = true, className }: { value: string | number | null | undefined; currency?: string; signed?: boolean; className?: string }) {
  const n = Number(value ?? 0);
  return (
    <span className={clsx('whitespace-nowrap tabular-nums', signed && n > 0 && 'text-success', className)}>
      {money(value, currency, { sign: signed })}
    </span>
  );
}

import { Prisma } from '@prisma/client';

export const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** Para birimine göre gruplanmış toplamlar; farklı para birimleri asla toplanmaz. */
export function sumByCurrency(rows: { currency: string; amount: Prisma.Decimal | number | string }[]) {
  const map = new Map<string, Prisma.Decimal>();
  for (const r of rows) map.set(r.currency, (map.get(r.currency) ?? D(0)).plus(r.amount));
  return Object.fromEntries([...map].map(([k, v]) => [k, v.toFixed(2)]));
}

export function parseDateOnly(value: string): Date {
  const d = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Geçersiz tarih: ${value}`);
  return d;
}

export function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

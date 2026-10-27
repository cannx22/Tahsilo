export type Money = string | number | null | undefined;

const CURRENCY_SYMBOL: Record<string, string> = { TRY: '₺', USD: '$', EUR: '€', GBP: '£' };

export function money(value: Money, currency = 'TRY', opts: { sign?: boolean } = {}) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  const formatted = Math.abs(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sym = CURRENCY_SYMBOL[currency] ?? currency + ' ';
  const sign = n < 0 ? '−' : opts.sign && n > 0 ? '+' : '';
  return `${sign}${sym}${formatted}`;
}

/** Para birimine göre gruplanmış tutarları "₺1.000,00 · $50,00" şeklinde gösterir. */
export function moneyMap(map: Record<string, string> | undefined | null, fallbackCurrency = 'TRY') {
  const entries = Object.entries(map ?? {});
  if (!entries.length) return money(0, fallbackCurrency);
  return entries.map(([c, v]) => money(v, c)).join(' · ');
}

export function date(value: string | Date | null | undefined) {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleDateString('tr-TR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function dateTime(value: string | Date | null | undefined) {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function relative(value: string | Date | null | undefined) {
  if (!value) return 'hiç';
  const d = typeof value === 'string' ? new Date(value) : value;
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'az önce';
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} sa önce`;
  return `${Math.floor(diff / 86400)} gün önce`;
}

export function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function monthRange(offset = 0) {
  const now = new Date();
  const from = new Date(Date.UTC(now.getFullYear(), now.getMonth() + offset, 1));
  const to = new Date(Date.UTC(now.getFullYear(), now.getMonth() + offset + 1, 0));
  return { from: isoDate(from), to: isoDate(to) };
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

export type DateFormat = 'DD.MM.YYYY' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';

export interface ColumnMapping {
  hasHeader: boolean;
  date: number;
  description: number;
  amount?: number | null;
  debit?: number | null;
  credit?: number | null;
  balance?: number | null;
  reference?: number | null;
  counterparty?: number | null;
  status?: number | null;
  dateFormat: DateFormat;
  decimal: ',' | '.';
  /** Kart ekstrelerinde harcamalar çoğu zaman pozitif yazılır; true ise işaret ters çevrilir. */
  invertAmount?: boolean;
}

export interface ParsedTable {
  headers: string[];
  rows: string[][];
}

export interface ParsedRow {
  line: number;
  date: string; // YYYY-MM-DD
  description: string;
  amount: string; // işaretli, nokta ondalıklı
  balance?: string;
  reference?: string;
  counterparty?: string;
  pending: boolean;
}

export interface RowError {
  line: number;
  message: string;
}

export function normalizeText(s: string) {
  return s
    .toLocaleLowerCase('tr')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/\s+/g, ' ')
    .trim();
}

// ───────────────────────── Dosya okuma ─────────────────────────

function decodeText(buf: Buffer): string {
  let text = buf.toString('utf8');
  // Geçersiz UTF-8 varsa Türk bankalarının sık kullandığı Windows-1254 kodlaması denenir.
  if (text.includes('�')) text = new TextDecoder('windows-1254').decode(buf);
  return text.replace(/^﻿/, '');
}

function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
  const candidates = [';', ',', '\t', '|'];
  let best = ',';
  let bestScore = -1;
  for (const d of candidates) {
    const counts = sample.split('\n').filter(Boolean).map((l) => l.split(d).length - 1);
    if (!counts.length) continue;
    const min = Math.min(...counts);
    if (min > bestScore) {
      bestScore = min;
      best = d;
    }
  }
  return best;
}

function cellToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    if ('result' in v) return cellToString((v as any).result);
    if ('richText' in v) return (v as any).richText.map((r: any) => r.text).join('');
    if ('text' in v) return String((v as any).text);
  }
  return String(v).trim();
}

export async function readTable(fileName: string, buf: Buffer): Promise<ParsedTable & { kind: 'csv' | 'xlsx' }> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xlsx')) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('Excel dosyasında sayfa bulunamadı');
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = (row.values as ExcelJS.CellValue[]).slice(1).map(cellToString);
      if (values.some((v) => v !== '')) rows.push(values);
    });
    return { kind: 'xlsx', headers: rows[0] ?? [], rows };
  }
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const text = decodeText(buf);
    const rows: string[][] = parseCsv(text, {
      delimiter: detectDelimiter(text),
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
    return { kind: 'csv', headers: rows[0] ?? [], rows };
  }
  throw new Error('Desteklenen biçimler: CSV, TXT, XLSX. PDF ekstreler için bankanızın CSV/Excel çıktısını kullanın.');
}

// ───────────────────────── Değer ayrıştırma ─────────────────────────

export function parseAmount(raw: string, decimal: ',' | '.'): string | null {
  let s = (raw ?? '').trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/[^\d.,\-+]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (decimal === ',') s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return (negative ? -n : n).toFixed(2);
}

export function parseDate(raw: string, fmt: DateFormat): string | null {
  const s = (raw ?? '').trim().split(/[ T]/)[0];
  if (!s) return null;
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else {
    const parts = s.split(/[./-]/).map(Number);
    if (parts.length !== 3 || parts.some((p) => !Number.isInteger(p))) return null;
    if (fmt === 'MM/DD/YYYY') [m, d, y] = parts;
    else if (fmt === 'YYYY-MM-DD') [y, m, d] = parts;
    else [d, m, y] = parts;
    if (y < 100) y += 2000;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

// ───────────────────────── Sütun tahmini ─────────────────────────

const HEADER_RULES: [keyof ColumnMapping, RegExp][] = [
  ['date', /^(islem )?tarih|^date|valor/],
  ['reference', /referans|dekont|ref|islem no|fis no|transaction id/],
  ['debit', /borc|debit|cikis|cekilen/],
  ['credit', /alacak|credit|giris|yatan/],
  ['balance', /bakiye|balance/],
  ['amount', /tutar|amount|miktar/],
  ['counterparty', /karsi taraf|gonderen|alici|counterparty|isyeri|merchant/],
  ['status', /durum|status|provizyon/],
  ['description', /aciklama|description|islem|detay|narrative/],
];

export function guessMapping(table: ParsedTable): ColumnMapping {
  const mapping: any = { hasHeader: true, dateFormat: 'DD.MM.YYYY', decimal: ',' };
  table.headers.forEach((h, i) => {
    const n = normalizeText(h);
    for (const [key, re] of HEADER_RULES) {
      if (mapping[key] === undefined && re.test(n)) {
        mapping[key] = i;
        break;
      }
    }
  });
  mapping.date ??= 0;
  mapping.description ??= 1;
  if (mapping.amount === undefined && mapping.debit === undefined) mapping.amount = 2;

  const samples = table.rows.slice(1, 15);
  const dateSamples = samples.map((r) => r[mapping.date] ?? '');
  if (dateSamples.some((v) => /^\d{4}-\d{2}-\d{2}/.test(v))) mapping.dateFormat = 'YYYY-MM-DD';
  else if (dateSamples.some((v) => /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(v))) {
    mapping.dateFormat = dateSamples.some((v) => Number(v.split('/')[1]) > 12) ? 'MM/DD/YYYY' : 'DD/MM/YYYY';
  }

  const amountCol = mapping.amount ?? mapping.debit;
  const amountSamples = samples.map((r) => r[amountCol] ?? '').filter(Boolean);
  // "1,234.56" veya "12.50" gibi değerler noktalı ondalık kullanır
  if (amountSamples.some((v) => /\d\.\d{2}$/.test(v) || /,\d{3}\./.test(v)) && !amountSamples.some((v) => /,\d{2}$/.test(v))) {
    mapping.decimal = '.';
  }
  return mapping as ColumnMapping;
}

// ───────────────────────── Satır dönüştürme ─────────────────────────

const PENDING_RE = /provizyon|bekl|pending|onay bekl/;

export function mapRows(table: ParsedTable, m: ColumnMapping): { rows: ParsedRow[]; errors: RowError[] } {
  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  const data = m.hasHeader ? table.rows.slice(1) : table.rows;
  const offset = m.hasHeader ? 2 : 1;
  const col = (r: string[], i?: number | null) => (i === undefined || i === null || i < 0 ? '' : (r[i] ?? '').trim());

  data.forEach((r, idx) => {
    const line = idx + offset;
    const date = parseDate(col(r, m.date), m.dateFormat);
    if (!date) return errors.push({ line, message: `Tarih okunamadı: "${col(r, m.date)}"` });

    let amount: string | null = null;
    if (m.amount !== undefined && m.amount !== null && m.amount >= 0) {
      amount = parseAmount(col(r, m.amount), m.decimal);
    } else {
      const debit = parseAmount(col(r, m.debit), m.decimal);
      const credit = parseAmount(col(r, m.credit), m.decimal);
      if (debit !== null && Number(debit) !== 0) amount = (-Math.abs(Number(debit))).toFixed(2);
      else if (credit !== null) amount = Math.abs(Number(credit)).toFixed(2);
    }
    if (amount === null) return errors.push({ line, message: 'Tutar okunamadı' });
    if (Number(amount) === 0) return errors.push({ line, message: 'Sıfır tutarlı satır atlandı' });
    if (m.invertAmount) amount = (-Number(amount)).toFixed(2);

    const description = col(r, m.description).slice(0, 500);
    if (!description) return errors.push({ line, message: 'Açıklama boş' });

    const balance = m.balance !== undefined && m.balance !== null ? parseAmount(col(r, m.balance), m.decimal) ?? undefined : undefined;
    rows.push({
      line,
      date,
      description,
      amount,
      balance,
      reference: col(r, m.reference) || undefined,
      counterparty: col(r, m.counterparty) || undefined,
      pending: PENDING_RE.test(normalizeText(col(r, m.status))),
    });
  });
  return { rows, errors };
}

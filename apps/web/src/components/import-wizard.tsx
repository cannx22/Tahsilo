'use client';

import { AlertTriangle, CheckCircle2, FileUp } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';
import { date, dateTime, money } from '@/lib/format';
import { Button, ErrorBox, Field, Modal, Notice, Select, Table, Td, Th } from './ui';

interface Mapping {
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
  dateFormat: 'DD.MM.YYYY' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
  decimal: ',' | '.';
  invertAmount?: boolean;
}

interface Preview {
  fileName: string;
  headers: string[];
  rows: string[][];
  totalRows: number;
  suggestedMapping: Mapping;
  sample: { line: number; date: string; description: string; amount: string; pending: boolean }[];
  sampleErrors: { line: number; message: string }[];
  previouslyImported: { id: string; createdAt: string; fileName: string; importedCount: number }[];
}

interface Result {
  rowCount: number;
  imported: number;
  duplicates: number;
  errorCount: number;
  errors: { line: number; message: string }[];
  supersededPending: number;
}

const FIELDS: { key: keyof Mapping; label: string; required?: boolean }[] = [
  { key: 'date', label: 'Tarih', required: true },
  { key: 'description', label: 'Açıklama', required: true },
  { key: 'amount', label: 'Tutar (işaretli)' },
  { key: 'debit', label: 'Borç / çıkış' },
  { key: 'credit', label: 'Alacak / giriş' },
  { key: 'balance', label: 'Bakiye' },
  { key: 'reference', label: 'Referans / dekont no' },
  { key: 'counterparty', label: 'Karşı taraf / iş yeri' },
  { key: 'status', label: 'Durum (provizyon)' },
];

/** Ekstre içe aktarma sihirbazı: dosya → önizleme ve sütun eşleme → sonuç. */
export function ImportWizard({
  open,
  onClose,
  onDone,
  target,
  currency = 'TRY',
}: {
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
  target: { bankAccountId?: string; cardAccountId?: string; label: string };
  currency?: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const isCard = !!target.cardAccountId;

  function reset() {
    setFile(null);
    setPreview(null);
    setMapping(null);
    setResult(null);
    setError(null);
  }

  function close() {
    if (result) onDone?.();
    reset();
    onClose();
  }

  async function loadPreview(f: File) {
    setFile(f);
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', f);
      const p = await api<Preview>('/statements/import/preview', { form });
      setPreview(p);
      setMapping({ ...p.suggestedMapping, invertAmount: false });
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!file || !mapping) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('mapping', JSON.stringify(mapping));
      if (target.bankAccountId) form.append('bankAccountId', target.bankAccountId);
      if (target.cardAccountId) form.append('cardAccountId', target.cardAccountId);
      setResult(await api<Result>('/statements/import', { form }));
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }

  const setCol = (key: keyof Mapping, v: string) => setMapping((m) => (m ? { ...m, [key]: v === '' ? null : Number(v) } : m));
  const hasAmount = mapping && ((mapping.amount ?? -1) >= 0 || (mapping.debit ?? -1) >= 0 || (mapping.credit ?? -1) >= 0);

  const footer = result ? (
    <Button onClick={close}>Kapat</Button>
  ) : preview ? (
    <>
      <Button variant="secondary" onClick={reset} disabled={busy}>
        Başka dosya
      </Button>
      <Button onClick={commit} loading={busy} disabled={!hasAmount}>
        İçe aktar
      </Button>
    </>
  ) : (
    <Button variant="secondary" onClick={close}>
      Vazgeç
    </Button>
  );

  return (
    <Modal open={open} onClose={close} title={`Ekstre içe aktar • ${target.label}`} footer={footer} wide>
      <div className="space-y-4">
        <ErrorBox error={error} />

        {!preview && !result && (
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 px-6 py-10 text-center hover:border-brand/40">
            <FileUp className="h-8 w-8 text-muted" />
            <span className="mt-2 text-sm font-medium text-navy">{busy ? 'Dosya okunuyor…' : 'CSV, TXT veya XLSX dosyası seçin'}</span>
            <span className="mt-1 text-xs text-muted">En fazla 10 MB. PDF ekstreler için bankanızın Excel/CSV çıktısını kullanın.</span>
            <input
              type="file"
              accept=".csv,.txt,.xlsx"
              className="hidden"
              disabled={busy}
              onChange={(e) => e.target.files?.[0] && loadPreview(e.target.files[0])}
            />
          </label>
        )}

        {preview && mapping && !result && (
          <>
            {preview.previouslyImported.length > 0 && (
              <Notice tone="warning">
                Bu dosya daha önce içe aktarıldı ({preview.previouslyImported.map((p) => dateTime(p.createdAt)).join(', ')}). Tekrar aktarırsanız
                mevcut hareketler mükerrer kontrolüyle atlanır.
              </Notice>
            )}
            <div className="text-xs text-muted">
              {preview.fileName} • {preview.totalRows} satır. Sütun eşlemesini kontrol edin; tutar için ya işaretli tutar ya da borç/alacak sütunlarını seçin.
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {FIELDS.map((f) => (
                <Field key={f.key} label={f.label + (f.required ? ' *' : '')}>
                  <Select value={(mapping[f.key] as number | null | undefined) ?? ''} onChange={(e) => setCol(f.key, e.target.value)}>
                    {!f.required && <option value="">— Yok —</option>}
                    {preview.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {i + 1}. {mapping.hasHeader ? h || '(boş)' : `Sütun ${i + 1}`}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
              <Field label="Tarih biçimi">
                <Select value={mapping.dateFormat} onChange={(e) => setMapping({ ...mapping, dateFormat: e.target.value as Mapping['dateFormat'] })}>
                  <option value="DD.MM.YYYY">GG.AA.YYYY</option>
                  <option value="DD/MM/YYYY">GG/AA/YYYY</option>
                  <option value="MM/DD/YYYY">AA/GG/YYYY</option>
                  <option value="YYYY-MM-DD">YYYY-AA-GG</option>
                </Select>
              </Field>
              <Field label="Ondalık ayracı">
                <Select value={mapping.decimal} onChange={(e) => setMapping({ ...mapping, decimal: e.target.value as ',' | '.' })}>
                  <option value=",">Virgül (1.234,56)</option>
                  <option value=".">Nokta (1,234.56)</option>
                </Select>
              </Field>
            </div>
            <div className="flex flex-wrap gap-6 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={mapping.hasHeader} onChange={(e) => setMapping({ ...mapping, hasHeader: e.target.checked })} />
                İlk satır başlık
              </label>
              {isCard && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={!!mapping.invertAmount} onChange={(e) => setMapping({ ...mapping, invertAmount: e.target.checked })} />
                  Harcamalar dosyada pozitif yazılı (işareti ters çevir)
                </label>
              )}
            </div>

            <div>
              <div className="mb-1 text-xs font-medium text-navy">Dosyadaki ilk satırlar</div>
              <div className="max-h-56 overflow-auto rounded-lg border border-slate-200">
                <Table>
                  <thead>
                    <tr>
                      <Th>#</Th>
                      {preview.headers.map((_, i) => (
                        <Th key={i}>{i + 1}</Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 8).map((r, i) => (
                      <tr key={i} className={i === 0 && mapping.hasHeader ? 'bg-slate-50 font-medium' : ''}>
                        <Td className="text-xs text-muted">{i + 1}</Td>
                        {preview.headers.map((_, j) => (
                          <Td key={j} className="whitespace-nowrap text-xs">
                            {r[j]}
                          </Td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </div>

            <div>
              <div className="mb-1 text-xs font-medium text-navy">Önerilen eşlemeyle okunan örnek (sunucu tahmini)</div>
              <div className="rounded-lg border border-slate-200">
                <Table>
                  <tbody>
                    {preview.sample.map((s) => (
                      <tr key={s.line}>
                        <Td className="text-xs text-muted">{s.line}</Td>
                        <Td className="text-xs">{date(s.date)}</Td>
                        <Td className="text-xs">{s.description}</Td>
                        <Td align="right" className="text-xs">
                          {money(s.amount, currency, { sign: true })}
                        </Td>
                        <Td className="text-xs">{s.pending ? 'Provizyon' : ''}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              {preview.sampleErrors.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-warning-700">
                  {preview.sampleErrors.map((e) => (
                    <li key={e.line}>
                      Satır {e.line}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {result && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-success">
              <CheckCircle2 className="h-5 w-5" /> İçe aktarma tamamlandı
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ResultBox label="Okunan satır" value={result.rowCount} />
              <ResultBox label="Yeni hareket" value={result.imported} />
              <ResultBox label="Mükerrer (atlandı)" value={result.duplicates} />
              <ResultBox label="Hatalı satır" value={result.errorCount} />
            </div>
            {result.supersededPending > 0 && (
              <Notice>{result.supersededPending} provizyon kaydı kesinleşen işlemle değiştirildi ve ters kayda alındı.</Notice>
            )}
            {result.errors.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-warning-50 p-3 text-xs text-warning-700">
                <div className="mb-1 flex items-center gap-1 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5" /> Aktarılamayan satırlar
                </div>
                <ul className="space-y-0.5">
                  {result.errors.map((e) => (
                    <li key={e.line}>
                      Satır {e.line}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ResultBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-navy">{value}</div>
    </div>
  );
}

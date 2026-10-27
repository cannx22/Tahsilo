'use client';

import clsx from 'clsx';
import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Loading, PageHeader, Table, Td, Th } from '@/components/ui';
import { download, qs, useApi } from '@/lib/api';
import { date } from '@/lib/format';
import { useSession } from '@/lib/session';

interface Column {
  key: string;
  label: string;
  type?: 'text' | 'money' | 'date' | 'number' | 'percent';
}

function cell(c: Column, v: unknown) {
  if (v === null || v === undefined || v === '') return '—';
  switch (c.type) {
    case 'money':
      return Number(v).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'percent':
      return `%${Number(v).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`;
    case 'number':
      return Number(v).toLocaleString('tr-TR');
    case 'date':
      return date(String(v));
    default:
      return String(v);
  }
}

export default function ReportsPage() {
  const { can, period } = useSession();
  const list = useApi<{ key: string; title: string }[]>('/reports');
  const [key, setKey] = useState<string>('income-expense');
  const [range, setRange] = useState(period);
  // Üst bardaki dönem değişince rapor dönemi de güncellenir
  useEffect(() => setRange(period), [period]);
  const report = useApi<any>(`/reports/${key}${qs(range)}`);

  const numeric = (c: Column) => c.type === 'money' || c.type === 'number' || c.type === 'percent';

  return (
    <>
      <PageHeader
        title="Raporlar"
        description="Raporlarda dönem, para birimi ve veri kaynağı açıkça belirtilir."
        actions={
          can('report.export') && (
            <>
              <Button variant="secondary" onClick={() => download(`/reports/${key}${qs({ ...range, format: 'csv' })}`)}>
                <Download className="h-4 w-4" /> CSV
              </Button>
              <Button variant="secondary" onClick={() => download(`/reports/${key}${qs({ ...range, format: 'xlsx' })}`)}>
                <Download className="h-4 w-4" /> Excel
              </Button>
            </>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <Card padded={false} className="h-fit">
          {!list.data ? (
            <Loading />
          ) : (
            <nav className="p-2">
              {list.data.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setKey(r.key)}
                  className={clsx('block w-full rounded-lg px-3 py-2 text-left text-sm', key === r.key ? 'bg-brand-50 font-medium text-brand' : 'text-navy hover:bg-slate-50')}
                >
                  {r.title}
                </button>
              ))}
            </nav>
          )}
        </Card>
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Başlangıç">
              <Input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} />
            </Field>
            <Field label="Bitiş">
              <Input type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} />
            </Field>
          </div>
          <ErrorBox error={report.error} onRetry={report.reload} />
          {!report.data ? (
            <Loading />
          ) : (
            <Card title={report.data.title} padded={false}>
              <div className="space-y-1 border-b border-slate-100 px-5 py-3 text-xs text-muted">
                <div>
                  Dönem: <b className="text-navy">{date(report.data.period.from)} – {date(report.data.period.to)}</b> • Veri kaynakları: <b className="text-navy">{report.data.sources.join(', ') || '—'}</b> • Para birimleri ayrı satırlarda, çevrimsiz
                </div>
                {report.data.notes.map((n: string) => (
                  <div key={n}>Not: {n}</div>
                ))}
              </div>
              {report.loading && <div className="h-0.5 animate-pulse bg-brand/40" />}
              {!report.data.rows.length ? (
                <EmptyState title="Bu dönem için veri yok" />
              ) : (
                <>
                  <Table>
                    <thead>
                      <tr>
                        {report.data.columns.map((c: Column) => (
                          <Th key={c.key} align={numeric(c) ? 'right' : undefined}>
                            {c.label}
                          </Th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.data.rows.slice(0, 500).map((row: any, i: number) => (
                        <tr key={i} className="hover:bg-slate-50">
                          {report.data.columns.map((c: Column) => (
                            <Td key={c.key} align={numeric(c) ? 'right' : undefined} className={clsx(c.type === 'money' && Number(row[c.key]) < 0 && 'text-danger')}>
                              {cell(c, row[c.key])}
                            </Td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  <div className="px-4 py-3 text-xs text-muted">
                    {report.data.rows.length} satır{report.data.rows.length > 500 ? ' • ekranda ilk 500 satır gösteriliyor; tamamı için dışa aktarın' : ''}
                  </div>
                </>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

'use client';

import clsx from 'clsx';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Badge, SourceBadge } from '@/components/badges';
import { ForecastChart } from '@/components/charts';
import { Amount } from '@/components/money';
import { Card, ErrorBox, Loading, Notice, PageHeader, Select, Stat, Table, Td, Th } from '@/components/ui';
import { qs, useApi } from '@/lib/api';
import { date, money } from '@/lib/format';

const KIND_LABEL: Record<string, string> = {
  RECEIVABLE: 'Alacak',
  PAYABLE: 'Alış faturası',
  PLANNED: 'Planlı ödeme',
  CARD_STATEMENT: 'Kart ekstresi',
  CARD_UNBILLED: 'Ekstresiz kart harcaması',
};

export default function CashflowPage() {
  const [weeks, setWeeks] = useState(12);
  const { data, error, reload } = useApi<any>(`/cashflow/forecast${qs({ weeks })}`);
  const [open, setOpen] = useState<string | null>(null);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;

  const cur = data.currency;
  const chart = data.buckets.map((b: any) => ({ label: date(b.weekStart).slice(0, 5), balance: Number(b.projectedBalance) }));
  const negative = Number(data.lowestProjected) < 0;

  return (
    <>
      <PageHeader
        title="Nakit Akışı"
        description="Mevcut bakiye, beklenen tahsilatlar ve vadesi gelen ödemelerden haftalık projeksiyon."
        actions={
          <Select className="w-36" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
            <option value={8}>8 hafta</option>
            <option value={12}>12 hafta</option>
            <option value={26}>26 hafta</option>
          </Select>
        }
      />
      <div className="mb-6 flex items-center gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3">
        <SourceBadge source="FORECAST" />
        <span className="text-sm font-semibold text-navy">TAHMİN — kesin bakiye değildir.</span>
        <span className="text-sm text-muted">Aşağıdaki varsayımlara dayanır; gerçek banka bakiyesi için Bankalar sayfasına bakın.</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Başlangıç bakiyesi (gerçek)"
          value={money(data.startBalance, cur)}
          hint={data.startBalanceAsOf ? `${data.accountsIncluded} hesap • en eski bakiye ${date(data.startBalanceAsOf)}` : 'Bakiyesi bilinen hesap yok'}
        />
        <Stat label={`${weeks} hafta sonu (tahmin)`} value={money(data.buckets.at(-1)?.projectedBalance, cur)} badge={<SourceBadge source="FORECAST" />} />
        <Stat label="En düşük tahmini bakiye" value={money(data.lowestProjected, cur)} tone={negative ? 'danger' : 'default'} hint={negative ? 'Dönem içinde nakit açığı öngörülüyor' : undefined} badge={<SourceBadge source="FORECAST" />} />
      </div>

      {data.accountsWithoutBalance.length > 0 && (
        <div className="mt-4">
          <Notice tone="warning">
            <AlertTriangle className="mr-1 inline h-4 w-4" /> Bakiyesi bilinmeyen hesaplar başlangıç bakiyesine dahil edilmedi: {data.accountsWithoutBalance.join(', ')}
          </Notice>
        </div>
      )}

      <Card title={`Tahmini bakiye (${cur})`} className="mt-6" actions={<SourceBadge source="FORECAST" />}>
        <ForecastChart data={chart} currency={cur} height={260} />
      </Card>

      <Card title="Haftalık döküm" padded={false} className="mt-6">
        <Table>
          <thead>
            <tr>
              <Th />
              <Th>Hafta</Th>
              <Th align="right">Beklenen giriş</Th>
              <Th align="right">Beklenen çıkış</Th>
              <Th align="right">Net</Th>
              <Th align="right">Tahmini bakiye</Th>
            </tr>
          </thead>
          <tbody>
            {data.buckets.map((b: any) => {
              const isOpen = open === b.weekStart;
              return (
                <Fragment key={b.weekStart}>
                  <tr className={clsx(b.items.length && 'cursor-pointer hover:bg-slate-50')} onClick={() => b.items.length && setOpen(isOpen ? null : b.weekStart)}>
                    <Td className="w-8 text-muted">{b.items.length > 0 && (isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />)}</Td>
                    <Td>
                      {date(b.weekStart)} haftası <span className="text-xs text-muted">({b.items.length} kalem)</span>
                    </Td>
                    <Td align="right" className="text-success">
                      {money(b.inflow, cur)}
                    </Td>
                    <Td align="right">{money(b.outflow, cur)}</Td>
                    <Td align="right">
                      <Amount value={b.net} currency={cur} />
                    </Td>
                    <Td align="right" className={clsx('font-semibold', Number(b.projectedBalance) < 0 && 'text-danger')}>
                      {money(b.projectedBalance, cur)}
                    </Td>
                  </tr>
                  {isOpen &&
                    b.items.map((i: any, idx: number) => (
                      <tr key={idx} className="bg-slate-50/60 text-xs">
                        <Td />
                        <Td colSpan={3}>
                          <span className="text-muted">{date(i.date)}</span> • <Badge tone="neutral">{KIND_LABEL[i.kind] ?? i.kind}</Badge> {i.label}
                          {i.overdue && (
                            <span className="ml-2">
                              <Badge tone="danger" icon={AlertTriangle}>
                                Vadesi geçmiş, bu haftaya alındı
                              </Badge>
                            </span>
                          )}
                        </Td>
                        <Td align="right">
                          <Amount value={i.amount} currency={cur} />
                        </Td>
                        <Td />
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Varsayımlar">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
            {data.assumptions.map((a: string) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Card>
        <Card title="Diğer para birimleri">
          {data.otherCurrencies.length === 0 ? (
            <p className="text-sm text-muted">{cur} dışında para birimli hesap yok.</p>
          ) : (
            <>
              <p className="mb-2 text-sm text-muted">Bu hesaplar tahmine dahil değildir; döviz çevrimi yapılmaz.</p>
              <ul className="text-sm">
                {data.otherCurrencies.map((o: any) => (
                  <li key={o.currency} className="flex justify-between py-1">
                    <span>{o.currency}</span>
                    <span className="font-medium">{o.balance ? money(o.balance, o.currency) : 'Bakiye yok'}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
    </>
  );
}

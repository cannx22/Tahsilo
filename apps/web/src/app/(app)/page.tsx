'use client';

import { AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { SourceBadge, SourceTypeLabel, StatusBadge } from '@/components/badges';
import { BudgetAlerts } from '@/components/budget-alerts';
import { ForecastChart, InOutChart } from '@/components/charts';
import { Amount } from '@/components/money';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, Stat, Table, Td, Th } from '@/components/ui';
import { qs, useApi } from '@/lib/api';
import { date, money, moneyMap, relative } from '@/lib/format';
import { useSession } from '@/lib/session';

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

export default function OverviewPage() {
  const { me, period, can } = useSession();
  const { data, error, loading, reload } = useApi<any>(can('overview.view') ? `/finance/overview${qs(period)}` : null);

  if (!can('overview.view')) {
    return (
      <>
        <PageHeader title={`Hoş geldiniz, ${me.name}`} />
        <Card>
          <EmptyState
            title="Genel bakış rolünüz için kapalı"
            description="Soldaki menüden size açık modüllere ulaşabilirsiniz."
            action={can('expense.create') ? <Link className="text-sm font-medium text-brand" href="/expenses">Harcamalarım →</Link> : undefined}
          />
        </Card>
      </>
    );
  }
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;

  const base = me.tenant.baseCurrency;
  const trend = data.trend
    .filter((t: any) => t.currency === base)
    .map((t: any) => ({ label: MONTHS[Number(t.month.slice(5)) - 1], inflow: Number(t.inflow), outflow: Number(t.outflow) }));
  const forecast = data.forecast.buckets.map((b: any) => ({ label: date(b.weekStart).slice(0, 5), balance: Number(b.projectedBalance) }));
  const staleAccounts = data.bankAccounts.filter((a: any) => a.stale);
  const recon = data.reconciliation;

  return (
    <>
      <PageHeader
        title="Genel Bakış"
        description={`${date(data.period.from)} – ${date(data.period.to)} dönemi • Tutarlar para birimine göre ayrı gösterilir`}
        actions={
          <button onClick={reload} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-navy" disabled={loading}>
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> Yenile
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat
          label="Banka bakiyesi"
          value={moneyMap(data.balanceTotals, base)}
          hint={staleAccounts.length ? `${staleAccounts.length} hesabın bakiyesi 3 günden eski` : `${data.bankAccounts.length} hesap • gerçek bakiye`}
          tone={staleAccounts.length ? 'warning' : 'default'}
          href="/banks"
        />
        <Stat label="Dönem para girişi" value={moneyMap(data.flows.inflow, base)} hint="Banka + manuel hareketler" href={`/transactions${qs({ direction: 'IN', ...period })}`} />
        <Stat
          label="Dönem para çıkışı"
          value={moneyMap(data.flows.outflow, base)}
          hint={`Kart harcaması: ${moneyMap(data.cardSpend.posted, base)}${Object.keys(data.cardSpend.pending).length ? ` (+${moneyMap(data.cardSpend.pending)} provizyon)` : ''}`}
          href={`/transactions${qs({ direction: 'OUT', ...period })}`}
        />
        <Stat
          label="Yaklaşan kart borcu"
          value={moneyMap(data.cardDebt.statements, base)}
          hint={data.cardDebt.nextDueDate ? `Son ödeme: ${date(data.cardDebt.nextDueDate)} • ekstresiz: ${moneyMap(data.cardDebt.unbilled, base)}` : `Ekstreye girmemiş: ${moneyMap(data.cardDebt.unbilled, base)}`}
          href="/cards"
        />
        <Stat
          label="Vadesi geçmiş alacak"
          value={moneyMap(data.receivables.overdue, base)}
          hint={`30 gün içinde: ${moneyMap(data.receivables.dueIn30, base)}`}
          tone={Object.keys(data.receivables.overdue).length ? 'danger' : 'default'}
          href="/invoices?type=SALES&overdue=true"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Dönem tahsilatı (sanal POS)" value={moneyMap(data.collections.succeeded, base)} hint={`${data.collections.successCount} başarılı • ${data.collections.failedCount} başarısız • komisyon ${moneyMap(data.collections.commission, base)}`} href="/collections" />
        <Stat label="30 gün içinde ödenecek" value={moneyMap(data.payables.dueIn30, base)} hint="Alış faturaları + planlı ödemeler" href="/payments" />
        <Stat label="Vadesi geçmiş borç" value={moneyMap(data.payables.overdue, base)} tone={Object.keys(data.payables.overdue).length ? 'danger' : 'default'} href="/payments" />
        <Stat
          label="Mutabakat bekleyen"
          value={`${(recon.UNMATCHED ?? 0) + (recon.SUGGESTED ?? 0)} hareket`}
          hint={`${recon.SUGGESTED ?? 0} eşleşme önerisi hazır`}
          tone={(recon.UNMATCHED ?? 0) > 0 ? 'warning' : 'default'}
          href="/reconciliation"
        />
      </div>

      {can('budget.view') && <BudgetAlerts />}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title={`Aylık giriş / çıkış (${base})`} className="xl:col-span-2">
          {trend.length ? <InOutChart data={trend} currency={base} /> : <EmptyState title="Henüz hareket yok" description="Banka ekstresi içe aktararak başlayın." />}
          <p className="mt-2 text-xs text-muted">{data.flows.note}</p>
        </Card>
        <Card title="Nakit akışı (8 hafta)" actions={<SourceBadge source="FORECAST" />}>
          <ForecastChart data={forecast} currency={base} height={190} />
          <div className="mt-2 flex justify-between text-xs text-muted">
            <span>Başlangıç: {money(data.forecast.startBalance, base)}</span>
            <span>En düşük: {money(data.forecast.lowestProjected, base)}</span>
          </div>
          <Link href="/cashflow" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand">
            Varsayımlar ve detay <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="Banka hesapları" padded={false} actions={<Link href="/banks" className="text-xs font-medium text-brand">Tümü</Link>}>
          {data.bankAccounts.length === 0 ? (
            <EmptyState title="Banka hesabı yok" action={can('bank.manage') ? <Link href="/banks" className="text-sm font-medium text-brand">Hesap ekle</Link> : undefined} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.bankAccounts.map((a: any) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-navy">{a.name}</div>
                    <div className="flex items-center gap-2 text-xs text-muted">
                      {a.bankName} • {a.balanceAsOf ? date(a.balanceAsOf) : 'bakiye yok'}
                      {a.stale && <AlertTriangle className="h-3 w-3 text-warning" aria-label="Güncel değil" />}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold tabular-nums text-navy">{money(a.balance, a.currency)}</div>
                    <SourceBadge source={a.balanceSource} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Son hareketler" padded={false} className="xl:col-span-2" actions={<Link href="/transactions" className="text-xs font-medium text-brand">Tümü</Link>}>
          {data.recent.length === 0 ? (
            <EmptyState title="Henüz hareket yok" />
          ) : (
            <Table>
              <tbody>
                {data.recent.map((t: any) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <Td className="w-24 text-xs text-muted">{date(t.date)}</Td>
                    <Td>
                      <Link href={`/transactions/${t.id}`} className="font-medium text-navy hover:text-brand">
                        {t.description}
                      </Link>
                      <div className="flex items-center gap-2">
                        <SourceTypeLabel type={t.sourceType} />
                        <span className="text-xs text-muted">{t.bankAccount?.name ?? (t.cardAccount ? `${t.cardAccount.name} •••• ${t.cardAccount.last4}` : '')}</span>
                      </div>
                    </Td>
                    <Td className="hidden md:table-cell">{t.category?.name ?? <span className="text-xs text-muted">Kategorisiz</span>}</Td>
                    <Td className="hidden lg:table-cell">
                      <StatusBadge status={t.status} />
                    </Td>
                    <Td align="right">
                      <Amount value={t.amount} currency={t.currency} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card title="Veri güncelliği" className="mt-6">
        <div className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <div className="text-xs text-muted">Son ekstre aktarımı</div>
            <div className="font-medium text-navy">{data.freshness.lastImport ? `${relative(data.freshness.lastImport.createdAt)} • ${data.freshness.lastImport.fileName}` : 'Henüz yok'}</div>
          </div>
          <div>
            <div className="text-xs text-muted">ERP senkronizasyonu</div>
            <div className="flex items-center gap-2 font-medium text-navy">
              {data.freshness.erp ? (
                <>
                  {data.freshness.erp.name} • {relative(data.freshness.erp.lastSyncAt)} <StatusBadge status={data.freshness.erp.status} />
                </>
              ) : (
                'Bağlantı yok'
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">Banka API bağlantısı</div>
            <div className="font-medium text-navy">Faz 2 — şimdilik ekstre içe aktarma</div>
          </div>
        </div>
      </Card>
    </>
  );
}

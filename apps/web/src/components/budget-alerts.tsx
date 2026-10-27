'use client';

import Link from 'next/link';
import { useApi } from '@/lib/api';
import { money } from '@/lib/format';
import { Badge } from './badges';
import { BUDGET_STATE, BudgetRow, scopeLabel } from './budget-labels';
import { Card } from './ui';

/** Bu ayın eşiğe yaklaşan veya aşılan bütçeleri; uyarı yoksa hiç gösterilmez. */
export function BudgetAlerts() {
  const { data } = useApi<{ period: string; items: BudgetRow[] }>('/budgets');
  const alerts = (data?.items ?? []).filter((b) => b.state !== 'OK').sort((a, b) => b.ratio - a.ratio);
  if (!alerts.length) return null;
  return (
    <Card title="Bütçe uyarıları" padded={false} className="mt-6" actions={<Link href={`/budget?period=${data!.period}`} className="text-xs font-medium text-brand">Bütçeye git</Link>}>
      <ul className="divide-y divide-slate-100">
        {alerts.map((b) => {
          const s = BUDGET_STATE[b.state];
          return (
            <li key={b.id}>
              <Link href={`/budget?period=${b.period}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-navy">{scopeLabel(b)}</span>
                  <span className="text-xs text-muted">
                    {money(b.actual, b.currency)} / {money(b.amount, b.currency)} • %{Math.round(b.ratio * 100)}
                  </span>
                </span>
                <Badge tone={s.tone} icon={s.icon}>
                  {s.label}
                </Badge>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

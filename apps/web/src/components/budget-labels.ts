import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

export type BudgetState = 'OK' | 'WARNING' | 'EXCEEDED';

export interface BudgetRow {
  id: string;
  period: string;
  category: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  amount: string;
  actual: string;
  remaining: string;
  ratio: number;
  state: BudgetState;
  currency: string;
  alertThreshold: string;
  note: string | null;
}

export const BUDGET_STATE: Record<BudgetState, { label: string; tone: 'success' | 'warning' | 'danger'; icon: typeof CheckCircle2; bar: string }> = {
  OK: { label: 'Bütçe içinde', tone: 'success', icon: CheckCircle2, bar: 'bg-success' },
  WARNING: { label: 'Eşiğe yaklaştı', tone: 'warning', icon: AlertTriangle, bar: 'bg-warning' },
  EXCEEDED: { label: 'Aşıldı', tone: 'danger', icon: XCircle, bar: 'bg-danger' },
};

export function scopeLabel(b: Pick<BudgetRow, 'category' | 'department'>) {
  if (b.category && b.department) return `${b.category.name} • ${b.department.name}`;
  return b.category?.name ?? b.department?.name ?? '—';
}

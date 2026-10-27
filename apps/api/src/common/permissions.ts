import { Role } from '@prisma/client';

export const ALL_PERMISSIONS = [
  'overview.view',
  'bank.view',
  'bank.manage',
  'card.view_all',
  'card.view_own',
  'card.manage',
  'txn.view',
  'txn.edit',
  'import.create',
  'expense.view_all',
  'expense.view_team',
  'expense.view_own',
  'expense.create',
  'expense.approve',
  'collection.view',
  'collection.manage',
  'refund.create',
  'terminal.manage',
  'invoice.view',
  'invoice.manage',
  'counterparty.view',
  'counterparty.manage',
  'planned.view',
  'planned.manage',
  'cashflow.view',
  'erp.view',
  'erp.manage',
  'recon.view',
  'recon.manage',
  'report.view',
  'report.export',
  'settings.users',
  'settings.manage',
  'audit.view',
  'budget.view',
  'budget.manage',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

const VIEW_ONLY: Permission[] = ALL_PERMISSIONS.filter((p) => p.endsWith('.view') || p.endsWith('.view_all'));

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: [...ALL_PERMISSIONS],
  ACCOUNTANT: [
    'overview.view',
    'budget.view',
    'bank.view',
    'card.view_all',
    'txn.view',
    'txn.edit',
    'import.create',
    'expense.view_all',
    'expense.view_own',
    'expense.create',
    'expense.approve',
    'collection.view',
    'collection.manage',
    'invoice.view',
    'invoice.manage',
    'counterparty.view',
    'counterparty.manage',
    'planned.view',
    'planned.manage',
    'cashflow.view',
    'erp.view',
    'erp.manage',
    'recon.view',
    'recon.manage',
    'report.view',
    'report.export',
  ],
  MANAGER: ['card.view_own', 'expense.view_team', 'expense.view_own', 'expense.create', 'expense.approve', 'budget.view'],
  EMPLOYEE: ['card.view_own', 'expense.view_own', 'expense.create'],
  OPERATIONS: ['collection.view', 'collection.manage', 'counterparty.view', 'invoice.view'],
  AUDITOR: [...VIEW_ONLY, 'report.export', 'audit.view'],
};

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Firma sahibi / finans yöneticisi',
  ACCOUNTANT: 'Muhasebe / finans uzmanı',
  MANAGER: 'Ekip yöneticisi',
  EMPLOYEE: 'Çalışan / kart sahibi',
  OPERATIONS: 'Operasyon / tahsilat',
  AUDITOR: 'Denetçi',
};

export function hasPermission(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(perm);
}

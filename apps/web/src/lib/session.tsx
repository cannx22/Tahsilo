'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { setApiBranch } from './api';
import { monthRange } from './format';

export interface Me {
  id: string;
  email: string;
  name: string;
  role: 'OWNER' | 'ACCOUNTANT' | 'MANAGER' | 'EMPLOYEE' | 'OPERATIONS' | 'AUDITOR';
  permissions: string[];
  mfaEnabled: boolean;
  emailNotifications: boolean;
  department: { id: string; name: string } | null;
  branch: { id: string; name: string } | null;
  branches: { id: string; code: string; name: string }[];
  tenant: { id: string; name: string; baseCurrency: string };
}

export type PeriodState = {
  from: string;
  to: string;
};

interface SessionValue {
  me: Me;
  can: (...perms: string[]) => boolean;
  period: PeriodState;
  setPeriod: (p: PeriodState) => void;
  /** Seçili şube (null: tüm şubeler) */
  branchId: string | null;
  setBranchId: (id: string | null) => void;
}

const SessionContext = createContext<SessionValue | null>(null);
const BRANCH_KEY = 'tahsilo.branch';

function readStoredBranch(me: Me) {
  try {
    const stored = localStorage.getItem(`${BRANCH_KEY}.${me.tenant.id}`);
    return stored && me.branches.some((b) => b.id === stored) ? stored : null;
  } catch {
    return null;
  }
}

export function SessionProvider({ me, children }: { me: Me; children: React.ReactNode }) {
  const [period, setPeriod] = useState<PeriodState>(() => monthRange(0));
  const [branchId, setBranchState] = useState<string | null>(() => {
    const b = readStoredBranch(me);
    setApiBranch(b);
    return b;
  });

  useEffect(() => {
    setApiBranch(branchId);
    try {
      if (branchId) localStorage.setItem(`${BRANCH_KEY}.${me.tenant.id}`, branchId);
      else localStorage.removeItem(`${BRANCH_KEY}.${me.tenant.id}`);
    } catch {
      /* depolama kapalı olabilir */
    }
  }, [branchId, me.tenant.id]);

  const value = useMemo<SessionValue>(
    () => ({
      me,
      can: (...perms) => perms.some((p) => me.permissions.includes(p)),
      period,
      setPeriod,
      branchId,
      setBranchId: setBranchState,
    }),
    [me, period, branchId],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession SessionProvider dışında kullanıldı');
  return v;
}

export const ROLE_LABEL: Record<Me['role'], string> = {
  OWNER: 'Firma sahibi / finans yöneticisi',
  ACCOUNTANT: 'Muhasebe / finans uzmanı',
  MANAGER: 'Ekip yöneticisi',
  EMPLOYEE: 'Çalışan / kart sahibi',
  OPERATIONS: 'Operasyon / tahsilat',
  AUDITOR: 'Denetçi',
};

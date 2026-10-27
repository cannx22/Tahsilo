'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AppShell } from '@/components/shell';
import { Loading } from '@/components/ui';
import { useApi } from '@/lib/api';
import { Me, SessionProvider } from '@/lib/session';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: me, error } = useApi<Me>('/auth/me');

  useEffect(() => {
    if (error?.status === 401) router.replace('/login');
  }, [error, router]);

  if (!me) return <Loading label="Oturum doğrulanıyor…" />;
  return (
    <SessionProvider me={me}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}

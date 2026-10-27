'use client';

import { LogOut, ShieldCheck } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/logo';
import { Loading } from '@/components/ui';
import { platformApi } from './platform-api';

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const isLogin = path === '/platform/login';
  const [me, setMe] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    if (isLogin) return;
    platformApi('/auth/me')
      .then(setMe)
      .catch(() => router.replace('/platform/login'));
  }, [isLogin, router]);

  if (isLogin) return <div className="min-h-screen bg-page">{children}</div>;
  if (!me) return <Loading label="Platform oturumu doğrulanıyor…" />;

  return (
    <div className="min-h-screen bg-page">
      <header className="flex h-14 items-center gap-3 bg-navy px-4 text-white lg:px-6">
        <Logo light />
        <span className="flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 text-xs font-medium">
          <ShieldCheck className="h-3.5 w-3.5" /> Platform
        </span>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="hidden text-slate-300 sm:inline">{me.email}</span>
          <button
            onClick={async () => {
              await platformApi('/auth/logout', {});
              router.replace('/platform/login');
            }}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-4 w-4" /> Çıkış
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] p-4 lg:p-6">{children}</main>
    </div>
  );
}

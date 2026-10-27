'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Logo } from '@/components/logo';
import { Button, ErrorBox, Field, Input, formValues } from '@/components/ui';
import { platformApi } from '../platform-api';

export default function PlatformLoginPage() {
  const router = useRouter();
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await platformApi('/auth/login', formValues(e.currentTarget));
      router.replace('/platform');
    } catch (err) {
      setError(err as Error);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-card">
        <Logo />
        <div>
          <h1 className="text-lg font-semibold text-navy">Platform yönetimi</h1>
          <p className="mt-1 text-sm text-muted">Yalnızca Tahsilo platform yöneticileri içindir. Firma kullanıcıları buradan giriş yapamaz.</p>
        </div>
        <ErrorBox error={error} />
        <Field label="E-posta">
          <Input name="email" type="email" autoComplete="username" required autoFocus />
        </Field>
        <Field label="Parola">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          Giriş yap
        </Button>
      </form>
    </div>
  );
}

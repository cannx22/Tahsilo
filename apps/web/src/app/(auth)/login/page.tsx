'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button, ErrorBox, Field, Input, formValues } from '@/components/ui';
import { api } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null);

  const done = () => router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const values = formValues(e.currentTarget);
      if (ticket) {
        await api('/auth/mfa/verify', { body: { ticket, code: values.code } });
        return done();
      }
      const res = await api<{ mfaRequired?: boolean; ticket?: string }>('/auth/login', { body: values });
      if (res.mfaRequired && res.ticket) {
        setTicket(res.ticket);
        setBusy(false);
        return;
      }
      done();
    } catch (err) {
      setError(err as Error);
      setBusy(false);
    }
  }

  if (ticket) {
    return (
      <form onSubmit={submit} className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-navy">İki adımlı doğrulama</h1>
          <p className="mt-1 text-sm text-muted">Doğrulama uygulamanızdaki 6 haneli kodu girin.</p>
        </div>
        <ErrorBox error={error} />
        <Field label="Doğrulama kodu">
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus />
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          Doğrula
        </Button>
        <button type="button" onClick={() => setTicket(null)} className="w-full text-center text-sm text-muted hover:text-navy">
          Geri dön
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-navy">Giriş yap</h1>
        <p className="mt-1 text-sm text-muted">Firma hesabınızla oturum açın.</p>
      </div>
      <ErrorBox error={error} />
      <Field label="E-posta">
        <Input name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <Field label="Parola">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" loading={busy} className="w-full">
        Giriş yap
      </Button>
      {process.env.NODE_ENV !== 'production' && (
        // Yalnızca geliştirme ortamında: demo verisindeki giriş bilgileri
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-muted">
          <div className="font-medium text-navy">Demo hesabı (yalnızca geliştirme)</div>
          E-posta: <code>demo@tahsilo.local</code> • Parola: <code>Tahsilo2026!</code> (sonunda ünlem var)
        </div>
      )}
      <p className="text-center text-sm text-muted">
        Hesabınız yok mu?{' '}
        <Link href="/register" className="font-medium text-brand">
          Firma kaydı oluşturun
        </Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

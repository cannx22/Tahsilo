'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, ErrorBox, Field, Input, formValues } from '@/components/ui';
import { api } from '@/lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/register', { body: formValues(e.currentTarget) });
      router.replace('/');
    } catch (err) {
      setError(err as Error);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-navy">Firma kaydı</h1>
        <p className="mt-1 text-sm text-muted">Firmanız için ayrı ve yalıtılmış bir Tahsilo alanı oluşturulur.</p>
      </div>
      <ErrorBox error={error} />
      <Field label="Firma unvanı">
        <Input name="companyName" required maxLength={120} autoFocus />
      </Field>
      <Field label="Vergi numarası" hint="İsteğe bağlı">
        <Input name="taxNumber" maxLength={20} inputMode="numeric" />
      </Field>
      <Field label="Adınız soyadınız">
        <Input name="name" required maxLength={120} autoComplete="name" />
      </Field>
      <Field label="E-posta">
        <Input name="email" type="email" required autoComplete="email" />
      </Field>
      <Field label="Parola" hint="En az 10 karakter">
        <Input name="password" type="password" required minLength={10} autoComplete="new-password" />
      </Field>
      <Button type="submit" loading={busy} className="w-full">
        Kaydı oluştur
      </Button>
      <p className="text-center text-sm text-muted">
        Zaten hesabınız var mı?{' '}
        <Link href="/login" className="font-medium text-brand">
          Giriş yapın
        </Link>
      </p>
    </form>
  );
}

'use client';

import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Card, LinkButton, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';

type State = { kind: 'working' } | { kind: 'done'; accounts: number } | { kind: 'failed'; message: string };

function Callback() {
  const params = useSearchParams();
  const [state, setState] = useState<State>({ kind: 'working' });
  // React strict mode efekti iki kez çalıştırabilir; yetki kodu tek kullanımlıktır
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const consentState = params.get('state');
    const code = params.get('code') ?? undefined;
    const error = params.get('error') ?? undefined;
    if (!consentState) {
      setState({ kind: 'failed', message: 'Bankadan dönüş bilgisi eksik. Bağlantıyı yeniden başlatın.' });
      return;
    }
    api<{ id: string; accounts: number }>('/bank-connections/callback', { body: { state: consentState, code, error } })
      .then((r) => setState({ kind: 'done', accounts: r.accounts }))
      .catch((e: Error) => setState({ kind: 'failed', message: e.message }));
  }, [params]);

  return (
    <Card>
      {state.kind === 'working' && (
        <div className="flex items-center gap-3 py-6 text-sm text-navy">
          <Loader2 className="h-5 w-5 animate-spin text-brand" /> Banka izni doğrulanıyor ve hesaplar bağlanıyor…
        </div>
      )}
      {state.kind === 'done' && (
        <div className="space-y-4 py-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 text-success" />
            <div>
              <div className="font-semibold text-navy">{state.accounts} hesap bağlandı</div>
              <p className="mt-1 text-sm text-muted">
                Bakiye ve hareketler arka planda alınıyor; birkaç saniye içinde Bankalar sayfasında görünecek. Bağlantı her saat otomatik senkronize
                edilir.
              </p>
            </div>
          </div>
          <LinkButton href="/banks" variant="primary">
            Bankalara dön
          </LinkButton>
        </div>
      )}
      {state.kind === 'failed' && (
        <div className="space-y-4 py-4">
          <div className="flex items-start gap-3">
            <XCircle className="mt-0.5 h-6 w-6 text-danger" />
            <div>
              <div className="font-semibold text-navy">Banka bağlantısı tamamlanamadı</div>
              <p className="mt-1 text-sm text-muted">{state.message}</p>
            </div>
          </div>
          <Link href="/banks" className="text-sm font-medium text-brand">
            Bankalar sayfasına dön ve yeniden dene →
          </Link>
        </div>
      )}
    </Card>
  );
}

export default function BankCallbackPage() {
  return (
    <>
      <PageHeader title="Banka bağlantısı" />
      <Suspense>
        <Callback />
      </Suspense>
    </>
  );
}

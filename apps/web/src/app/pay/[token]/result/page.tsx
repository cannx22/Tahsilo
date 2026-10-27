'use client';

import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ErrorBox } from '@/components/ui';
import { api } from '@/lib/api';
import { money } from '@/lib/format';

function Result() {
  const { token } = useParams<{ token: string }>();
  const attempt = useSearchParams().get('attempt');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!attempt) return setError(new Error('Ödeme denemesi bulunamadı.'));
    let cancelled = false;
    let tries = 0;
    // Sonuç sağlayıcıdan doğrulanır; henüz kesinleşmediyse birkaç kez yeniden sorulur.
    const poll = async () => {
      try {
        const r = await api(`/public/pay/${token}/result?attempt=${encodeURIComponent(attempt)}`);
        if (cancelled) return;
        setData(r);
        if (r.status === 'INITIATED' && ++tries < 10) setTimeout(poll, 2000);
      } catch (e) {
        if (!cancelled) setError(e as Error);
      }
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  if (error) return <ErrorBox error={error} />;
  const pending = !data || data.status === 'INITIATED';
  const ok = data?.status === 'SUCCEEDED';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-card">
      {pending ? (
        <>
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-brand" />
          <h1 className="mt-4 text-lg font-semibold text-navy">Ödeme sonucu doğrulanıyor</h1>
          <p className="mt-1 text-sm text-muted">Sonuç ödeme sağlayıcısından teyit ediliyor. Lütfen sayfayı kapatmayın.</p>
          {data && <p className="mt-3 text-xs text-muted">Sonuç gecikiyor. İşlem tamamlandığında işletmeye bildirilir; tekrar ödeme yapmayın.</p>}
        </>
      ) : ok ? (
        <>
          <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
          <h1 className="mt-4 text-lg font-semibold text-navy">Ödemeniz alındı</h1>
          <p className="mt-1 text-sm text-muted">
            {money(data.amount, data.currency)} {data.cardLast4 && <>•••• {data.cardLast4} kartından</>} başarıyla tahsil edildi.
          </p>
        </>
      ) : (
        <>
          <XCircle className="mx-auto h-12 w-12 text-danger" />
          <h1 className="mt-4 text-lg font-semibold text-navy">Ödeme tamamlanamadı</h1>
          <p className="mt-1 text-sm text-muted">{data.errorMessage ?? 'İşlem banka tarafından onaylanmadı.'}</p>
          <Link href={`/pay/${token}`} className="mt-4 inline-block text-sm font-medium text-brand">
            Tekrar dene
          </Link>
        </>
      )}
    </div>
  );
}

export default function PayResultPage() {
  return (
    <Suspense>
      <Result />
    </Suspense>
  );
}

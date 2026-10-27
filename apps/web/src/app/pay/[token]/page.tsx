'use client';

import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button, ErrorBox, Loading } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { date, money } from '@/lib/format';

const CLOSED: Record<string, { icon: typeof Clock; title: string; text: string; tone: string }> = {
  PAID: { icon: CheckCircle2, title: 'Bu ödeme tamamlandı', text: 'Bu link ile ödeme alınmış. Tekrar ödeme yapmanıza gerek yok.', tone: 'text-success' },
  EXPIRED: { icon: Clock, title: 'Linkin süresi doldu', text: 'Yeni bir ödeme linki için işletmeyle iletişime geçin.', tone: 'text-muted' },
  CANCELLED: { icon: XCircle, title: 'Link iptal edildi', text: 'Bu ödeme linki işletme tarafından iptal edilmiş.', tone: 'text-muted' },
  REFUNDED: { icon: CheckCircle2, title: 'Ödeme iade edildi', text: 'Bu ödeme işletme tarafından iade edilmiş.', tone: 'text-muted' },
  PARTIALLY_REFUNDED: { icon: CheckCircle2, title: 'Bu ödeme tamamlandı', text: 'Ödemenin bir kısmı iade edilmiş.', tone: 'text-success' },
};

export default function PayPage() {
  const { token } = useParams<{ token: string }>();
  const { data, error } = useApi<any>(`/public/pay/${token}`);
  const [busy, setBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<Error | null>(null);

  async function checkout() {
    setBusy(true);
    setCheckoutError(null);
    try {
      const { redirectUrl } = await api<{ redirectUrl: string }>(`/public/pay/${token}/checkout`, { method: 'POST' });
      window.location.href = redirectUrl;
    } catch (e) {
      setCheckoutError(e as Error);
      setBusy(false);
    }
  }

  if (error) return <ErrorBox error={error.status === 404 ? { message: 'Ödeme linki bulunamadı.' } : error} />;
  if (!data) return <Loading />;

  const closed = CLOSED[data.status];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
      <div className="text-sm text-muted">{data.merchant}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums text-navy">{money(data.amount, data.currency)}</div>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Açıklama</dt>
          <dd className="text-right text-navy">{data.description}</dd>
        </div>
        {data.invoiceNumber && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Fatura no</dt>
            <dd className="text-navy">{data.invoiceNumber}</dd>
          </div>
        )}
        {data.customerName && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Müşteri</dt>
            <dd className="text-navy">{data.customerName}</dd>
          </div>
        )}
        {data.status === 'PENDING' && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Son geçerlilik</dt>
            <dd className="text-navy">{date(data.expiresAt)}</dd>
          </div>
        )}
      </dl>

      {closed ? (
        <div className="mt-6 flex items-start gap-3 rounded-lg bg-slate-50 p-4">
          <closed.icon className={`h-5 w-5 shrink-0 ${closed.tone}`} />
          <div>
            <div className="font-medium text-navy">{closed.title}</div>
            <p className="text-sm text-muted">{closed.text}</p>
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          <ErrorBox error={checkoutError} />
          <Button className="w-full py-3" onClick={checkout} loading={busy}>
            Ödemeye geç
          </Button>
          <p className="text-center text-xs text-muted">Ödeme sağlayıcısının güvenli sayfasına yönlendirileceksiniz. Gerekirse bankanız 3D Secure doğrulaması ister.</p>
        </div>
      )}
    </div>
  );
}

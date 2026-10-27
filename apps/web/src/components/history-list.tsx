import { dateTime } from '@/lib/format';

const ACTION_LABEL: Record<string, string> = {
  'paymentRequest.create': 'Ödeme linki oluşturuldu',
  'paymentRequest.cancel': 'Ödeme linki iptal edildi',
  'payment.succeeded': 'Ödeme başarılı',
  'payment.failed': 'Ödeme başarısız',
  'refund.create': 'İade yapıldı',
  'refund.failed': 'İade başarısız',
  'invoice.create': 'Fatura oluşturuldu',
  'invoice.update': 'Fatura güncellendi',
  'invoice.cancel': 'Fatura iptal edildi',
  'invoice.payment': 'Ödeme kaydedildi',
  'counterparty.create': 'Cari oluşturuldu',
  'counterparty.update': 'Cari güncellendi',
};

/** Denetim izi kayıtlarının sade listesi. */
export function HistoryList({ items }: { items: any[] }) {
  if (!items?.length) return <p className="text-sm text-muted">Kayıt yok.</p>;
  return (
    <ol className="space-y-3">
      {items.map((h) => (
        <li key={h.id} className="flex gap-3 text-sm">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand/60" />
          <div>
            <div className="font-medium text-navy">{ACTION_LABEL[h.action] ?? h.action}</div>
            <div className="text-xs text-muted">
              {dateTime(h.createdAt)} • {h.userEmail ?? 'Sistem'}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

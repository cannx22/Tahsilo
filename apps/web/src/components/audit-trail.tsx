'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { dateTime } from '@/lib/format';

export const ACTION_LABEL: Record<string, string> = {
  'auth.login': 'Oturum açıldı',
  'tenant.register': 'Firma kaydı oluşturuldu',
  'tenant.update': 'Firma bilgileri güncellendi',
  'user.create': 'Kullanıcı oluşturuldu',
  'user.update': 'Kullanıcı güncellendi',
  'transaction.update': 'Hareket güncellendi',
  'transaction.categorize': 'Kategori atandı',
  'transaction.create_manual': 'Manuel kayıt oluşturuldu',
  'import.commit': 'Ekstre içe aktarıldı',
  'expense.create': 'Gider oluşturuldu',
  'expense.update': 'Gider güncellendi',
  'expense.approve': 'Gider onaylandı',
  'expense.reject': 'Gider reddedildi',
  'document.upload': 'Belge yüklendi',
  'document.download': 'Belge indirildi',
  'recon.confirm': 'Eşleşme onaylandı',
  'recon.reject': 'Eşleşme reddedildi',
  'recon.ignore': 'Mutabakat dışı bırakıldı',
  'payment.succeeded': 'Ödeme başarılı',
  'payment.failed': 'Ödeme başarısız',
  'refund.create': 'İade yapıldı',
  'report.export': 'Rapor dışa aktarıldı',
};

/** Denetim kayıtlarını kim/ne zaman/ne değişti biçiminde listeler. */
export function AuditTrail({ logs }: { logs: any[] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {logs.map((l) => (
        <AuditRow key={l.id} log={l} />
      ))}
    </ul>
  );
}

export function AuditRow({ log }: { log: any }) {
  const [open, setOpen] = useState(false);
  const hasDetail = log.before || log.after;
  return (
    <li className="px-5 py-2 text-sm">
      <button className="flex w-full items-start gap-2 text-left" onClick={() => hasDetail && setOpen(!open)} disabled={!hasDetail}>
        {hasDetail ? open ? <ChevronDown className="mt-0.5 h-4 w-4 text-muted" /> : <ChevronRight className="mt-0.5 h-4 w-4 text-muted" /> : <span className="w-4" />}
        <span className="flex-1">
          <span className="font-medium text-navy">{ACTION_LABEL[log.action] ?? log.action}</span>
          <span className="block text-xs text-muted">
            {dateTime(log.createdAt)} • {log.userEmail ?? 'Sistem'}
            {log.ip ? ` • ${log.ip}` : ''}
          </span>
        </span>
      </button>
      {open && (
        <div className="mt-2 grid gap-2 pl-6 md:grid-cols-2">
          {log.before && (
            <pre className="max-h-64 overflow-auto rounded bg-slate-50 p-2 text-[11px] text-navy">
              <span className="font-semibold text-muted">Önce</span>
              {'\n'}
              {JSON.stringify(log.before, null, 2)}
            </pre>
          )}
          {log.after && (
            <pre className="max-h-64 overflow-auto rounded bg-slate-50 p-2 text-[11px] text-navy">
              <span className="font-semibold text-muted">Sonra</span>
              {'\n'}
              {JSON.stringify(log.after, null, 2)}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}

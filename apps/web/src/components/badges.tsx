import clsx from 'clsx';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  FileUp,
  Link2,
  LucideIcon,
  PencilLine,
  Sparkles,
  Undo2,
  XCircle,
} from 'lucide-react';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'teal';

const TONE: Record<Tone, string> = {
  success: 'bg-success-50 text-success border-green-200',
  warning: 'bg-warning-50 text-warning-700 border-amber-200',
  danger: 'bg-danger-50 text-danger border-red-200',
  info: 'bg-brand-50 text-brand-600 border-blue-200',
  neutral: 'bg-slate-50 text-muted border-slate-200',
  teal: 'bg-teal-50 text-teal-700 border-teal-200',
};

/** Durumlar renk + ikon + metin ile gösterilir (yalnızca renge dayanmaz). */
export function Badge({ tone = 'neutral', icon: Icon, children, title }: { tone?: Tone; icon?: LucideIcon; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', TONE[tone])}>
      {Icon && <Icon className="h-3 w-3" aria-hidden />}
      {children}
    </span>
  );
}

const STATUS: Record<string, { label: string; tone: Tone; icon: LucideIcon }> = {
  // İşlem
  PENDING: { label: 'Bekliyor', tone: 'warning', icon: Clock },
  POSTED: { label: 'Kesinleşti', tone: 'success', icon: CheckCircle2 },
  REVERSED: { label: 'İptal / ters kayıt', tone: 'neutral', icon: Undo2 },
  // Gider
  DRAFT: { label: 'Taslak', tone: 'neutral', icon: CircleDashed },
  SUBMITTED: { label: 'Onay bekliyor', tone: 'warning', icon: Clock },
  APPROVED: { label: 'Onaylandı', tone: 'success', icon: CheckCircle2 },
  REJECTED: { label: 'Reddedildi', tone: 'danger', icon: XCircle },
  // Fatura
  OPEN: { label: 'Açık', tone: 'info', icon: CircleDashed },
  PARTIAL: { label: 'Kısmi ödendi', tone: 'warning', icon: Clock },
  PAID: { label: 'Ödendi', tone: 'success', icon: CheckCircle2 },
  CANCELLED: { label: 'İptal', tone: 'neutral', icon: XCircle },
  OVERDUE: { label: 'Vadesi geçti', tone: 'danger', icon: AlertTriangle },
  // Ödeme talebi / deneme
  FAILED: { label: 'Başarısız', tone: 'danger', icon: XCircle },
  EXPIRED: { label: 'Süresi doldu', tone: 'neutral', icon: Clock },
  REFUNDED: { label: 'İade edildi', tone: 'neutral', icon: Undo2 },
  PARTIALLY_REFUNDED: { label: 'Kısmi iade', tone: 'warning', icon: Undo2 },
  INITIATED: { label: 'Başlatıldı', tone: 'warning', icon: Clock },
  SUCCEEDED: { label: 'Başarılı', tone: 'success', icon: CheckCircle2 },
  // Planlı ödeme
  PLANNED: { label: 'Planlandı', tone: 'info', icon: Clock },
  // Ekstre
  ISSUED: { label: 'Kesildi', tone: 'info', icon: CircleDashed },
  PARTIALLY_PAID: { label: 'Kısmi ödendi', tone: 'warning', icon: Clock },
  // Mutabakat
  UNMATCHED: { label: 'Eşleşmedi', tone: 'warning', icon: AlertTriangle },
  SUGGESTED: { label: 'Öneri var', tone: 'info', icon: Sparkles },
  MATCHED: { label: 'Eşleşti', tone: 'success', icon: Link2 },
  CONFIRMED: { label: 'Onaylandı', tone: 'success', icon: CheckCircle2 },
  IGNORED: { label: 'Kapsam dışı', tone: 'neutral', icon: CircleDashed },
  // Bağlantı / iş
  ACTIVE: { label: 'Sağlıklı', tone: 'success', icon: CheckCircle2 },
  ERROR: { label: 'Hata', tone: 'danger', icon: XCircle },
  DISCONNECTED: { label: 'Devre dışı', tone: 'neutral', icon: CircleDashed },
  QUEUED: { label: 'Kuyrukta', tone: 'neutral', icon: Clock },
  RUNNING: { label: 'Çalışıyor', tone: 'info', icon: Clock },
  COMPLETED: { label: 'Tamamlandı', tone: 'success', icon: CheckCircle2 },
};

export function StatusBadge({ status, overdue }: { status: string; overdue?: boolean }) {
  const s = overdue ? STATUS.OVERDUE : STATUS[status] ?? { label: status, tone: 'neutral' as Tone, icon: CircleDashed };
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {s.label}
    </Badge>
  );
}

/** Veri kalitesi etiketi (doküman 6.1): kaynağın ne olduğu her zaman görünür. */
export function SourceBadge({ source, at }: { source?: string | null; at?: string | null }) {
  if (!source) return <Badge tone="neutral">Bilinmiyor</Badge>;
  const map: Record<string, { label: string; tone: Tone; icon: LucideIcon; title: string }> = {
    CONNECTED: { label: 'Bağlı', tone: 'success', icon: Link2, title: "API'den alındı" },
    IMPORTED: { label: 'Dosyadan', tone: 'info', icon: FileUp, title: 'Ekstre dosyasından içe aktarıldı' },
    MANUAL: { label: 'Manuel', tone: 'neutral', icon: PencilLine, title: 'Kullanıcı tarafından girildi' },
    FORECAST: { label: 'Tahmin', tone: 'teal', icon: Sparkles, title: 'Hesaplanan değer; kesin bakiye değildir' },
    ERP: { label: 'ERP', tone: 'teal', icon: Link2, title: "ERP'den alındı" },
  };
  const s = map[source] ?? { label: source, tone: 'neutral' as Tone, icon: CircleDashed, title: source };
  return (
    <Badge tone={s.tone} icon={s.icon} title={at ? `${s.title} • ${at}` : s.title}>
      {s.label}
    </Badge>
  );
}

export function SourceTypeLabel({ type }: { type: string }) {
  const map: Record<string, string> = { BANK: 'Banka', CARD: 'Kart', POS: 'Sanal POS', MANUAL: 'Manuel' };
  return <span className="text-xs text-muted">{map[type] ?? type}</span>;
}

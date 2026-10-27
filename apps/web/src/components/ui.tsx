'use client';

import clsx from 'clsx';
import { AlertCircle, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import Link from 'next/link';
import { createContext, forwardRef, useCallback, useContext, useEffect, useState } from 'react';

// ───────────────────────── Düğmeler ─────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-600 disabled:bg-brand/50',
  secondary: 'bg-white text-navy border border-slate-200 hover:bg-slate-50 disabled:text-muted',
  ghost: 'text-navy hover:bg-slate-100 disabled:text-muted',
  danger: 'bg-white text-danger border border-red-200 hover:bg-danger-50 disabled:opacity-50',
};

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean; size?: 'sm' | 'md' }
>(function Button({ variant = 'primary', loading, size = 'md', className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
        BUTTON[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
});

export function LinkButton({ href, variant = 'secondary', children, className }: { href: string; variant?: ButtonVariant; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={clsx('inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium', BUTTON[variant], className)}>
      {children}
    </Link>
  );
}

// ───────────────────────── Yerleşim ─────────────────────────

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-navy">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, padded = true }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={clsx('rounded-xl border border-slate-200/80 bg-white shadow-card', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-navy">{title}</h2>
          {actions}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone, href, badge }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'default' | 'warning' | 'danger' | 'success'; href?: string; badge?: React.ReactNode }) {
  const body = (
    <div className={clsx('h-full rounded-xl border bg-white p-4 shadow-card transition-colors', href && 'hover:border-brand/40', tone === 'danger' ? 'border-red-200' : tone === 'warning' ? 'border-amber-200' : 'border-slate-200/80')}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        {badge}
      </div>
      <div className={clsx('mt-2 text-xl font-semibold tabular-nums', tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-navy')}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="text-sm font-medium text-navy">{title}</div>
      {description && <p className="mt-1 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Loading({ label = 'Yükleniyor…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error?: { message: string } | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-danger-50 px-4 py-3 text-sm text-danger" role="alert">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">{error.message}</div>
      {onRetry && (
        <button onClick={onRetry} className="font-medium underline">
          Tekrar dene
        </button>
      )}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warning'; children: React.ReactNode }) {
  return (
    <div className={clsx('rounded-lg border px-4 py-3 text-sm', tone === 'warning' ? 'border-amber-200 bg-warning-50 text-warning-700' : 'border-brand/20 bg-brand-50 text-navy')}>{children}</div>
  );
}

// ───────────────────────── Tablo ─────────────────────────

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={clsx('w-full text-left text-sm', className)}>{children}</table>
    </div>
  );
}

export function Th({ children, className, align }: { children?: React.ReactNode; className?: string; align?: 'right' | 'center' }) {
  return (
    <th className={clsx('whitespace-nowrap border-b border-slate-100 bg-slate-50/60 px-4 py-2.5 text-xs font-medium text-muted', align === 'right' && 'text-right', align === 'center' && 'text-center', className)}>
      {children}
    </th>
  );
}

export function Td({ children, className, align, colSpan }: { children?: React.ReactNode; className?: string; align?: 'right' | 'center'; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={clsx('border-b border-slate-100 px-4 py-2.5 align-middle', align === 'right' && 'text-right tabular-nums', align === 'center' && 'text-center', className)}>
      {children}
    </td>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <div className="px-4 py-3 text-xs text-muted">{total} kayıt</div>;
  return (
    <div className="flex items-center justify-between px-4 py-3 text-xs text-muted">
      <span>
        {total} kayıttan {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Önceki sayfa">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="px-2">
          {page} / {pages}
        </span>
        <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Sonraki sayfa">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ───────────────────────── Form ─────────────────────────

export function Field({ label, hint, error, children, className }: { label: string; hint?: React.ReactNode; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1 block text-xs font-medium text-navy">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  );
}

// Genişlik ayrı tutulur: çağıran w-* verirse varsayılan w-full uygulanmaz.
const INPUT = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-navy placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-slate-50';
const inputClass = (className?: string, extra?: string) =>
  clsx(INPUT, !/(^|\s)(w-|min-w-|flex-1)/.test(className ?? '') && 'w-full', extra, className);

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={inputClass(className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={inputClass(className, 'pr-8')} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={inputClass(className, 'min-h-[80px]')} {...rest} />;
});

/** FormData'yı düz nesneye çevirir; boş metinler atılır. */
export function formValues(form: HTMLFormElement): Record<string, string> {
  const out: Record<string, string> = {};
  new FormData(form).forEach((v, k) => {
    if (typeof v === 'string' && v.trim() !== '') out[k] = v.trim();
  });
  return out;
}

// ───────────────────────── Modal ─────────────────────────

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy/40 p-4 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={clsx('w-full rounded-xl bg-white shadow-xl', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-navy">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-slate-100" aria-label="Kapat">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ───────────────────────── Sekmeler ─────────────────────────

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { key: T; label: React.ReactNode }[] }) {
  return (
    <div className="mb-4 flex gap-1 border-b border-slate-200">
      {items.map((it) => (
        <button
          key={it.key}
          onClick={() => onChange(it.key)}
          className={clsx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', value === it.key ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-navy')}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────── Bildirim ─────────────────────────

type Toast = { id: number; text: string; tone: 'success' | 'error' };
const ToastContext = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={clsx('pointer-events-auto max-w-sm rounded-lg px-4 py-3 text-sm text-white shadow-lg', t.tone === 'success' ? 'bg-navy' : 'bg-danger')}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

/** Bir işlemi çalıştırır; hatayı bildirim olarak gösterir. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (success) toast(success);
        return r;
      } catch (e) {
        toast((e as Error).message, 'error');
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { run, busy };
}

'use client';

import clsx from 'clsx';
import {
  ArrowLeftRight,
  Banknote,
  Bell,
  Building2,
  CalendarClock,
  ChevronDown,
  CircleHelp,
  CreditCard,
  FileText,
  GitCompareArrows,
  LayoutDashboard,
  LineChart,
  LogOut,
  MapPin,
  Menu,
  PieChart,
  Receipt,
  Settings,
  UserRound,
  Users,
  Wallet,
  Workflow,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, useApi } from '@/lib/api';
import { date, monthRange, relative } from '@/lib/format';
import { ROLE_LABEL, useSession } from '@/lib/session';
import { Logo } from './logo';

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  perms: string[];
}

const NAV: NavItem[] = [
  { href: '/', label: 'Genel Bakış', icon: LayoutDashboard, perms: ['overview.view'] },
  { href: '/banks', label: 'Bankalar', icon: Building2, perms: ['bank.view'] },
  { href: '/cards', label: 'Şirket Kartları', icon: CreditCard, perms: ['card.view_all', 'card.view_own'] },
  { href: '/transactions', label: 'Hareketler', icon: ArrowLeftRight, perms: ['txn.view', 'card.view_own'] },
  { href: '/expenses', label: 'Harcamalar', icon: Receipt, perms: ['expense.view_all', 'expense.view_team', 'expense.view_own'] },
  { href: '/collections', label: 'Tahsilatlar', icon: Banknote, perms: ['collection.view'] },
  { href: '/payments', label: 'Ödemeler', icon: CalendarClock, perms: ['planned.view'] },
  { href: '/invoices', label: 'Faturalar', icon: FileText, perms: ['invoice.view'] },
  { href: '/counterparties', label: 'Cari Hesaplar', icon: Users, perms: ['counterparty.view'] },
  { href: '/cashflow', label: 'Nakit Akışı', icon: LineChart, perms: ['cashflow.view'] },
  { href: '/reconciliation', label: 'Mutabakat', icon: GitCompareArrows, perms: ['recon.view'] },
  { href: '/budget', label: 'Bütçe', icon: Wallet, perms: ['budget.view'] },
  { href: '/erp', label: 'ERP', icon: Workflow, perms: ['erp.view'] },
  { href: '/reports', label: 'Raporlar', icon: PieChart, perms: ['report.view'] },
  { href: '/settings', label: 'Ayarlar', icon: Settings, perms: ['settings.users', 'settings.manage', 'audit.view'] },
];

function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { can } = useSession();
  const path = usePathname();
  return (
    <aside className={clsx('fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-navy text-slate-300 transition-transform lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
      <div className="flex h-14 items-center px-5">
        <Link href="/" onClick={onNavigate}>
          <Logo light />
        </Link>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {NAV.filter((n) => can(...n.perms)).map((n) => {
          const active = n.href === '/' ? path === '/' : path.startsWith(n.href);
          const Icon = n.icon;
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={onNavigate}
              className={clsx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors', active ? 'bg-brand text-white' : 'hover:bg-white/5 hover:text-white')}
            >
              <Icon className="h-4 w-4" />
              {n.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

const PRESETS = [
  { key: 'this', label: 'Bu ay', get: () => monthRange(0) },
  { key: 'last', label: 'Geçen ay', get: () => monthRange(-1) },
  { key: 'q', label: 'Son 3 ay', get: () => ({ from: monthRange(-2).from, to: monthRange(0).to }) },
  {
    key: 'year',
    label: 'Bu yıl',
    get: () => {
      const y = new Date().getFullYear();
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    },
  },
];

function PeriodPicker() {
  const { period, setPeriod } = useSession();
  const [open, setOpen] = useState(false);
  const preset = PRESETS.find((p) => {
    const r = p.get();
    return r.from === period.from && r.to === period.to;
  });
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-navy hover:bg-slate-50">
        <CalendarClock className="h-4 w-4 text-muted" />
        <span>{preset?.label ?? `${date(period.from)} – ${date(period.to)}`}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted" />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => {
                setPeriod(p.get());
                setOpen(false);
              }}
              className={clsx('block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-slate-50', preset?.key === p.key && 'bg-brand-50 text-brand')}
            >
              {p.label}
            </button>
          ))}
          <div className="mt-2 border-t border-slate-100 px-1 pt-2">
            <div className="mb-1 text-xs text-muted">Özel aralık</div>
            <div className="flex gap-2">
              <input type="date" value={period.from} max={period.to} onChange={(e) => e.target.value && setPeriod({ ...period, from: e.target.value })} className="w-full rounded border border-slate-200 px-2 py-1 text-xs" aria-label="Başlangıç" />
              <input type="date" value={period.to} min={period.from} onChange={(e) => e.target.value && setPeriod({ ...period, to: e.target.value })} className="w-full rounded border border-slate-200 px-2 py-1 text-xs" aria-label="Bitiş" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BranchPicker() {
  const { me, branchId, setBranchId } = useSession();
  if (!me.branches.length) return null;
  return (
    <label className="hidden items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-navy md:flex">
      <MapPin className="h-4 w-4 text-muted" aria-hidden />
      <span className="sr-only">Şube</span>
      <select value={branchId ?? ''} onChange={(e) => setBranchId(e.target.value || null)} className="bg-transparent py-0.5 pr-1 text-sm focus:outline-none">
        <option value="">Tüm şubeler</option>
        {me.branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

function Notifications() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data, reload } = useApi<{ items: NotificationItem[]; unreadCount: number }>('/notifications');
  useEffect(() => {
    const t = setInterval(() => void reload(), 60_000);
    return () => clearInterval(t);
  }, [reload]);
  const count = data?.unreadCount ?? 0;

  async function openItem(n: NotificationItem) {
    setOpen(false);
    if (!n.readAt) await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined);
    void reload();
    if (n.link) router.push(n.link);
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="relative rounded-lg p-2 text-muted hover:bg-slate-100" aria-label={`Bildirimler (${count} okunmamış)`}>
        <Bell className="h-5 w-5" />
        {count > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-semibold text-white">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-80 rounded-lg border border-slate-200 bg-white text-sm shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="font-medium text-navy">Bildirimler</span>
            {count > 0 && (
              <button
                className="text-xs font-medium text-brand"
                onClick={async () => {
                  await api('/notifications/read-all', { method: 'POST' }).catch(() => undefined);
                  void reload();
                }}
              >
                Tümünü okundu say
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!data?.items.length && <div className="px-3 py-6 text-center text-muted">Bildirim yok</div>}
            {data?.items.slice(0, 15).map((n) => (
              <button key={n.id} onClick={() => openItem(n)} className={clsx('block w-full border-b border-slate-50 px-3 py-2 text-left hover:bg-slate-50', !n.readAt && 'bg-brand-50/50')}>
                <span className="flex items-start gap-2">
                  {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-label="Okunmadı" />}
                  <span className="min-w-0">
                    <span className={clsx('block text-navy', !n.readAt && 'font-medium')}>{n.title}</span>
                    {n.body && <span className="line-clamp-2 block text-xs text-muted">{n.body}</span>}
                    <span className="block text-[11px] text-muted">{relative(n.createdAt)}</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block px-3 py-2 text-center text-xs font-medium text-brand hover:bg-slate-50">
            Tüm bildirimler
          </Link>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { me } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-100">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand">{me.name.slice(0, 1).toLocaleUpperCase('tr')}</span>
        <span className="hidden text-left md:block">
          <span className="block text-sm font-medium leading-tight text-navy">{me.name}</span>
          <span className="block text-xs leading-tight text-muted">{ROLE_LABEL[me.role]}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted" />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg">
          <div className="border-b border-slate-100 px-3 py-2 text-xs text-muted">{me.email}</div>
          <Link href="/account" onClick={() => setOpen(false)} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-slate-50">
            <UserRound className="h-4 w-4" /> Hesabım ve güvenlik
          </Link>
          <button
            onClick={async () => {
              await api('/auth/logout', { method: 'POST' });
              router.replace('/login');
            }}
            className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-slate-50"
          >
            <LogOut className="h-4 w-4" /> Çıkış yap
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me } = useSession();
  const [navOpen, setNavOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setNavOpen(false), [path]);
  return (
    <div className="min-h-screen">
      <Sidebar open={navOpen} onNavigate={() => setNavOpen(false)} />
      {navOpen && <div className="fixed inset-0 z-30 bg-navy/40 lg:hidden" onClick={() => setNavOpen(false)} />}
      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:px-6">
          <button className="rounded p-1.5 text-muted hover:bg-slate-100 lg:hidden" onClick={() => setNavOpen(true)} aria-label="Menü">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <Building2 className="h-4 w-4 shrink-0 text-muted" />
            <span className="truncate text-sm font-medium text-navy" title="Aktif firma">
              {me.tenant.name}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <BranchPicker />
            <PeriodPicker />
            <Notifications />
            <Link href="/help" className="hidden rounded-lg p-2 text-muted hover:bg-slate-100 sm:block" aria-label="Yardım">
              <CircleHelp className="h-5 w-5" />
            </Link>
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}


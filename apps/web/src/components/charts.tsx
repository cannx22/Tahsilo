'use client';

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money } from '@/lib/format';

const compact = (v: number) => (Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)} Mn` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)} B` : String(v));

export function InOutChart({ data, currency = 'TRY' }: { data: { label: string; inflow: number; outflow: number }[]; currency?: string }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid vertical={false} stroke="#EEF2F7" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} stroke="#64748B" />
        <YAxis tickFormatter={compact} tickLine={false} axisLine={false} fontSize={12} stroke="#64748B" width={48} />
        <Tooltip formatter={(v: number) => money(v, currency)} cursor={{ fill: '#F5F7FB' }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="inflow" name="Giriş" fill="#14B8A6" radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="outflow" name="Çıkış" fill="#14233B" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Tahmini bakiye eğrisi: kesik çizgi + "Tahmin" etiketiyle gerçek bakiyeden ayrışır. */
export function ForecastChart({ data, currency = 'TRY', height = 220 }: { data: { label: string; balance: number }[]; currency?: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="fc" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3578F6" stopOpacity={0.18} />
            <stop offset="100%" stopColor="#3578F6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="#EEF2F7" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} stroke="#64748B" />
        <YAxis tickFormatter={compact} tickLine={false} axisLine={false} fontSize={12} stroke="#64748B" width={48} />
        <Tooltip formatter={(v: number) => [money(v, currency), 'Tahmini bakiye']} />
        <Area type="monotone" dataKey="balance" stroke="#3578F6" strokeWidth={2} strokeDasharray="6 4" fill="url(#fc)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

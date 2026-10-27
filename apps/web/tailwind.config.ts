import type { Config } from 'tailwindcss';

// Tahsilo tasarım sistemi (ürün dokümanı, bölüm 3)
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#14233B', 700: '#1C3050', 600: '#26406A' },
        brand: { DEFAULT: '#3578F6', 600: '#2563EB', 50: '#EAF1FF' },
        teal: { DEFAULT: '#14B8A6' },
        page: '#F5F7FB',
        muted: '#64748B',
        success: { DEFAULT: '#16A34A', 50: '#F0FDF4' },
        warning: { DEFAULT: '#F59E0B', 50: '#FFFBEB', 700: '#B45309' },
        danger: { DEFAULT: '#DC2626', 50: '#FEF2F2' },
      },
      fontFamily: { sans: ['var(--font-sans)', 'system-ui', 'sans-serif'] },
      boxShadow: { card: '0 1px 2px rgba(20,35,59,.06), 0 1px 3px rgba(20,35,59,.04)' },
    },
  },
  plugins: [],
} satisfies Config;

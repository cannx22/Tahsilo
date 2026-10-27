export function Logo({ light }: { light?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#3578F6" />
        <path d="M9 11h14M16 11v12" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        <circle cx="23" cy="22" r="3" fill="#14B8A6" />
      </svg>
      <span className={`text-lg font-semibold tracking-tight ${light ? 'text-white' : 'text-navy'}`}>tahsilo</span>
    </span>
  );
}

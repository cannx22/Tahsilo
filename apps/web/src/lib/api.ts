'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: any,
  ) {
    super(message);
  }
}

function messageOf(body: any, status: number) {
  const m = body?.message;
  if (Array.isArray(m)) return m.join(', ');
  if (typeof m === 'string') return m;
  if (typeof m === 'object' && m?.message) return m.message;
  return status === 403 ? 'Bu işlem için yetkiniz yok' : 'Bir hata oluştu';
}

// Seçili şube: her isteğe X-Branch-Id başlığı olarak eklenir; değişince açık sorgular yeniden yüklenir.
let currentBranch: string | null = null;
let branchVersion = 0;
const branchListeners = new Set<() => void>();

export function setApiBranch(id: string | null) {
  if (id === currentBranch) return;
  currentBranch = id;
  branchVersion++;
  branchListeners.forEach((l) => l());
}

function useBranchVersion() {
  const [v, setV] = useState(branchVersion);
  useEffect(() => {
    const l = () => setV(branchVersion);
    branchListeners.add(l);
    return () => {
      branchListeners.delete(l);
    };
  }, []);
  return v;
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (currentBranch) headers['X-Branch-Id'] = currentBranch;
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const res = await fetch(`/api/v1${path}`, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body, credentials: 'same-origin' });
  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/') && !location.pathname.startsWith('/pay')) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: any = text;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    /* metin yanıt */
  }
  if (!res.ok) throw new ApiError(res.status, messageOf(data, res.status), data);
  return data as T;
}

/** Basit veri yükleme kancası: yükleniyor/hata durumu ve yeniden yükleme sağlar. */
export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<ApiError | undefined>();
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const branch = useBranchVersion();

  const load = useCallback(async () => {
    if (!path) return;
    const id = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (id === seq.current) {
        setData(d);
        setError(undefined);
      }
    } catch (e) {
      if (id === seq.current) setError(e as ApiError);
    } finally {
      if (id === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, branch]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

export function qs(params: { [key: string]: string | number | boolean | undefined | null }) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
}

export function download(path: string) {
  const a = document.createElement('a');
  a.href = `/api/v1${path}`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

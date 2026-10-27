/** Platform yönetimi için ayrı istek yardımcısı: firma oturumunun 401 yönlendirmesini kullanmaz. */
export class PlatformError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function platformApi<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1/platform${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => undefined);
  if (!res.ok) {
    const m = data?.message;
    throw new PlatformError(res.status, Array.isArray(m) ? m.join(', ') : typeof m === 'string' ? m : 'Bir hata oluştu');
  }
  return data as T;
}

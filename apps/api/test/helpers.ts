import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

export type Client = ReturnType<typeof client>;

/** Oturum çerezini taşıyan küçük HTTP istemcisi. */
export function client(base: string, extraHeaders: Record<string, string> = {}) {
  const cookies = new Map<string, string>();
  const fn = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const h: Record<string, string> = { ...extraHeaders, ...headers, cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    let payload: any;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      h['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${base}${path}`, { method, headers: h, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, ...v] = pair.split('=');
      cookies.set(k, v.join('='));
    }
    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* metin */
    }
    return { status: res.status, data, headers: res.headers };
  };
  fn.setHeader = (k: string, v: string) => (extraHeaders[k] = v);
  return fn;
}

export async function startApp() {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication = mod.createNestApplication({ rawBody: true });
  configureApp(app);
  await app.listen(0);
  const port = (app.getHttpServer().address() as AddressInfo).port;
  process.env.API_URL = `http://127.0.0.1:${port}`;
  return { app, base: `http://127.0.0.1:${port}/api/v1` };
}

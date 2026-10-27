import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { AppModule } from '../src/app.module';
import { totp } from '../src/auth/totp';
import { RequestContext } from '../src/common/request-context';
import { JobWorkerService } from '../src/erp/job-worker.service';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';

/** Oturum çerezini taşıyan küçük HTTP istemcisi. */
function client(base: string) {
  let cookie = '';
  return async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { cookie };
    let payload: any;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${base}${path}`, { method, headers, body: payload, redirect: 'manual' });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* metin */
    }
    return { status: res.status, data, headers: res.headers };
  };
}

const CSV = [
  'Tarih;Açıklama;Tutar;Bakiye',
  '01.10.2026;Açılış;10.000,00;10.000,00',
  '02.10.2026;TURKCELL;-250,00;9.750,00',
  '03.10.2026;BSMV;-1,00;9.749,00',
  '03.10.2026;BSMV;-1,00;9.748,00',
].join('\n');

function csvForm(target: Record<string, string>, mapping: object) {
  const f = new FormData();
  f.append('file', new Blob([CSV], { type: 'text/csv' }), 'ekstre.csv');
  for (const [k, v] of Object.entries(target)) f.append(k, v);
  f.append('mapping', JSON.stringify(mapping));
  return f;
}

const MAPPING = { hasHeader: true, date: 0, description: 1, amount: 2, balance: 3, dateFormat: 'DD.MM.YYYY', decimal: ',' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Tahsilo API (uçtan uca)', () => {
  let app: INestApplication;
  let base: string;
  let prisma: PrismaService;
  const stamp = Date.now();
  const a = () => clients.a;
  const b = () => clients.b;
  const clients: Record<string, ReturnType<typeof client>> = {};

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.listen(0);
    const port = (app.getHttpServer().address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}/api/v1`;
    process.env.API_URL = `http://127.0.0.1:${port}`;
    prisma = app.get(PrismaService);
    clients.a = client(base);
    clients.b = client(base);
    expect((await a()('POST', '/auth/register', { companyName: 'Firma A', name: 'A', email: `a${stamp}@t.local`, password: 'GucluParola123' })).status).toBe(201);
    expect((await b()('POST', '/auth/register', { companyName: 'Firma B', name: 'B', email: `b${stamp}@t.local`, password: 'GucluParola123' })).status).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('tenant izolasyonu', () => {
    it('tenant bağlamı olmadan kapsamlı istemci sorgu çalıştırmaz', async () => {
      await expect(RequestContext.run({}, () => prisma.db.financialTransaction.count())).rejects.toThrow(/Tenant bağlamı/);
    });

    it('bir firma diğerinin kayıtlarını okuyamaz, değiştiremez, dosyasına erişemez', async () => {
      const acc = await a()('POST', '/bank-accounts', { bankName: 'Banka', name: 'Hesap A' });
      expect(acc.status).toBe(201);
      const imp = await a()('POST', '/statements/import', csvForm({ bankAccountId: acc.data.id }, MAPPING));
      expect(imp.status).toBe(201);
      const list = await a()('GET', '/transactions');
      const txn = list.data.items[0];

      expect((await b()('GET', '/transactions')).data.total).toBe(0);
      expect((await b()('GET', `/transactions/${txn.id}`)).status).toBe(404);
      expect((await b()('PATCH', `/transactions/${txn.id}`, { note: 'x' })).status).toBe(404);
      expect((await b()('GET', `/bank-accounts/${acc.data.id}`)).status).toBe(404);
      expect((await b()('POST', '/statements/import', csvForm({ bankAccountId: acc.data.id }, MAPPING))).status).toBe(400);

      // Başka firmanın kategorisiyle kayıt oluşturulamaz
      const bCats = (await b()('GET', '/settings/reference')).data.categories;
      expect((await a()('PATCH', `/transactions/${txn.id}`, { categoryId: bCats[0].id })).status).toBe(400);

      // Belge indirme
      const out = list.data.items.find((t: any) => Number(t.amount) < 0);
      const aCats = (await a()('GET', '/settings/reference')).data.categories;
      const exp = await a()('POST', '/expenses', { transactionId: out.id, categoryId: aCats[0].id, description: 'test' });
      const f = new FormData();
      f.append('file', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'fis.pdf');
      const doc = await a()('POST', `/expenses/${exp.data.id}/receipts`, f);
      expect(doc.status).toBe(201);
      expect((await a()('GET', `/documents/${doc.data.id}/download`)).status).toBe(200);
      expect((await b()('GET', `/documents/${doc.data.id}/download`)).status).toBe(404);

      // Denetim kaydı da firmaya özeldir
      const logs = await b()('GET', '/settings/audit-logs');
      expect(logs.data.items.every((l: any) => !l.entityId || l.entityId !== acc.data.id)).toBe(true);
    });
  });

  describe('iki adımlı doğrulama', () => {
    it('MFA açıkken oturum ancak doğru kodla açılır; bilet oturum yerine geçmez', async () => {
      const email = `mfa${stamp}@t.local`;
      const c = client(base);
      await c('POST', '/auth/register', { companyName: 'MFA', name: 'M', email, password: 'GucluParola123' });
      const setup = await c('POST', '/auth/mfa/setup');
      const code = () => totp(setup.data.secret, Math.floor(Date.now() / 30_000));
      expect((await c('POST', '/auth/mfa/enable', { code: code() })).status).toBe(200);

      const fresh = client(base);
      const login = await fresh('POST', '/auth/login', { email, password: 'GucluParola123' });
      expect(login.data.mfaRequired).toBe(true);
      expect(login.headers.get('set-cookie')).toBeNull();
      const asBearer = await fetch(`${base}/auth/me`, { headers: { authorization: `Bearer ${login.data.ticket}` } });
      expect(asBearer.status).toBe(401);
      expect((await fresh('POST', '/auth/mfa/verify', { ticket: login.data.ticket, code: '000000' })).status).toBe(401);
      expect((await fresh('POST', '/auth/mfa/verify', { ticket: login.data.ticket, code: code() })).status).toBe(200);
      expect((await fresh('GET', '/auth/me')).data.mfaEnabled).toBe(true);
    });
  });

  describe('ekstre içe aktarma', () => {
    it('aynı dosyanın tekrar yüklenmesi mükerrer kayıt üretmez; kaynak ve zaman görünür', async () => {
      const acc = await a()('POST', '/bank-accounts', { bankName: 'Banka', name: 'Hesap 2' });
      const first = await a()('POST', '/statements/import', csvForm({ bankAccountId: acc.data.id }, MAPPING));
      expect(first.data).toMatchObject({ imported: 4, duplicates: 0 });
      const second = await a()('POST', '/statements/import', csvForm({ bankAccountId: acc.data.id }, MAPPING));
      expect(second.data).toMatchObject({ imported: 0, duplicates: 4 });

      const txns = await a()('GET', `/transactions?bankAccountId=${acc.data.id}`);
      expect(txns.data.total).toBe(4);
      expect(txns.data.items.every((t: any) => t.dataSource === 'IMPORTED' && t.importBatchId)).toBe(true);
      const account = await a()('GET', `/bank-accounts/${acc.data.id}`);
      expect(account.data).toMatchObject({ balance: '9748', balanceSource: 'IMPORTED' });
      expect(account.data.imports).toHaveLength(2);
    });
  });

  describe('yetkiler', () => {
    it('çalışan genel bakışı göremez, denetçi kayıt oluşturamaz', async () => {
      await a()('POST', '/settings/users', { name: 'Çalışan', email: `e${stamp}@t.local`, role: 'EMPLOYEE', password: 'GucluParola123' });
      await a()('POST', '/settings/users', { name: 'Denetçi', email: `d${stamp}@t.local`, role: 'AUDITOR', password: 'GucluParola123' });
      const emp = client(base);
      await emp('POST', '/auth/login', { email: `e${stamp}@t.local`, password: 'GucluParola123' });
      expect((await emp('GET', '/finance/overview')).status).toBe(403);
      expect((await emp('GET', '/transactions')).data.total).toBe(0);

      const aud = client(base);
      await aud('POST', '/auth/login', { email: `d${stamp}@t.local`, password: 'GucluParola123' });
      expect((await aud('GET', '/finance/overview')).status).toBe(200);
      expect((await aud('POST', '/bank-accounts', { bankName: 'X', name: 'Y' })).status).toBe(403);
      expect((await aud('GET', '/reports/bank-transactions?format=csv')).status).toBe(200);
    });
  });

  describe('sanal POS', () => {
    it('ödeme sağlayıcıdan doğrulanır; yinelenen webhook çift tahsilat oluşturmaz', async () => {
      await a()('POST', '/terminals', { provider: 'mockpos', name: 'POS', config: { merchantId: 'm' }, commissionRate: 0.02 });
      const req = await a()('POST', '/payment-requests', { amount: 500, description: 'Test tahsilat' });
      expect(req.status).toBe(201);

      const pub = client(base);
      const checkout = await pub('POST', `/public/pay/${req.data.token}/checkout`);
      const sessionPath = new URL(checkout.data.redirectUrl).pathname;
      const form = await fetch(`${process.env.API_URL}${sessionPath}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'holder=T&cardNumber=4111111111111111&expiry=12/29&cvc=123',
        redirect: 'manual',
      });
      expect(form.status).toBe(303);
      const attemptId = new URL(form.headers.get('location')!).searchParams.get('attempt');

      await sleep(2500); // sağlayıcı aynı olayı iki kez gönderir
      const result = await pub('GET', `/public/pay/${req.data.token}/result?attempt=${attemptId}`);
      expect(result.data.status).toBe('SUCCEEDED');
      expect((await a()('GET', '/transactions?sourceType=POS')).data.total).toBe(1);
      expect(await prisma.raw.webhookEvent.count({ where: { tenantId: req.data.tenantId, processedAt: { not: null } } })).toBe(1);

      const detail = await a()('GET', `/payment-requests/${req.data.id}`);
      expect(detail.data.status).toBe('PAID');
      expect(detail.data.attempts[0].commission).toBe('10');

      // İmzası geçersiz webhook reddedilir
      const forged = await fetch(`${base}/webhooks/mockpos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-mockpos-signature': 'deadbeef' },
        body: JSON.stringify({ id: `evt_forged_${stamp}`, type: 'payment.succeeded', sessionId: 'x' }),
      });
      expect(forged.status).toBe(400);

      // Ödenmiş link tekrar kullanılamaz
      expect((await pub('POST', `/public/pay/${req.data.token}/checkout`)).status).toBe(400);

      // Net POS aktarımı (500 − %2 komisyon) bankaya gelince öneri üretilir; fazla tutarlı giriş faturaya önerilmez
      const acc = await a()('POST', '/bank-accounts', { bankName: 'Banka', name: 'POS hesabı' });
      const f = new FormData();
      const today = new Date().toISOString().slice(0, 10);
      f.append('file', new Blob([`Tarih;Açıklama;Tutar
${today};POS GUN SONU;490,00`], { type: 'text/csv' }), 'pos.csv');
      f.append('bankAccountId', acc.data.id);
      f.append('mapping', JSON.stringify({ ...MAPPING, balance: undefined, dateFormat: 'YYYY-MM-DD' }));
      expect((await a()('POST', '/statements/import', f)).data.imported).toBe(1);
      const recon = await a()('GET', '/reconciliation');
      const posSuggestion = recon.data.suggestions.find((s: any) => s.type === 'TXN_POS' && s.transaction.description === 'POS GUN SONU');
      expect(posSuggestion).toBeDefined();
      expect((await a()('POST', `/reconciliation/matches/${posSuggestion.id}/confirm`)).data.status).toBe('CONFIRMED');
    });
  });

  describe('ERP senkronizasyonu', () => {
    it('kalıcı hata görünür ve düzeltildikten sonra yeniden denenebilir', async () => {
      const conn = await a()('POST', '/erp/connections', { provider: 'mockerp', name: 'ERP', config: { companyCode: `c${stamp}`, apiKey: 'ok' } });
      expect(conn.status).toBe(201);
      const worker = app.get(JobWorkerService);

      await a()('PATCH', `/erp/connections/${conn.data.id}`, { status: 'DISCONNECTED' });
      const [job] = (await a()('POST', '/erp/sync-jobs', { connectionId: conn.data.id, type: 'PULL_COUNTERPARTIES' })).data;
      await worker.tick();
      let jobs = (await a()('GET', '/erp/sync-jobs')).data.items;
      expect(jobs.find((j: any) => j.id === job.id)).toMatchObject({ status: 'FAILED', permanent: true });

      await a()('PATCH', `/erp/connections/${conn.data.id}`, { status: 'ACTIVE' });
      expect((await a()('POST', `/erp/sync-jobs/${job.id}/retry`)).status).toBe(201);
      await worker.tick();
      jobs = (await a()('GET', '/erp/sync-jobs')).data.items;
      expect(jobs.find((j: any) => j.id === job.id).status).toBe('SUCCEEDED');

      // Aynı veri tekrar çekilince mükerrer cari oluşmaz
      await a()('POST', '/erp/sync-jobs', { connectionId: conn.data.id, type: 'PULL_COUNTERPARTIES' });
      await worker.tick();
      const cps = await a()('GET', '/counterparties');
      expect(cps.data.total).toBe(7);
      expect((await b()('GET', '/counterparties')).data.total).toBe(0);
    });
  });
});

import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { JobWorkerService } from '../src/erp/job-worker.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { Client, client, startApp } from './helpers';

const PW = 'GucluParola123';

describe('Bütçe, onay kuralları, şube, banka bağlantısı, bildirim ve platform', () => {
  let app: INestApplication;
  let base: string;
  let prisma: PrismaService;
  let worker: JobWorkerService;
  let owner: Client;
  const stamp = Date.now();
  const period = new Date().toISOString().slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    ({ app, base } = await startApp());
    prisma = app.get(PrismaService);
    worker = app.get(JobWorkerService);
    owner = client(base);
    expect((await owner('POST', '/auth/register', { companyName: 'Özellik A.Ş.', name: 'Sahip', email: `f${stamp}@t.local`, password: PW })).status).toBe(201);
  });

  afterAll(() => app.close());

  async function loginAs(role: string, extra: object = {}) {
    const email = `${role.toLowerCase()}${stamp}@t.local`;
    await owner('POST', '/settings/users', { name: role, email, role, password: PW, ...extra });
    const c = client(base);
    expect((await c('POST', '/auth/login', { email, password: PW })).status).toBe(200);
    return c;
  }

  it('bütçe gerçekleşeni hesaplar, onay kuralı ve otomatik onay limitini uygular, bildirim üretir', async () => {
    const ref = (await owner('GET', '/settings/reference')).data;
    const cat = ref.categories.find((c: any) => c.name === 'Yemek ve ikram');
    const sales = ref.departments.find((d: any) => d.name === 'Satış');

    const budget = await owner('POST', '/budgets', { period, categoryId: cat.id, amount: 1000, alertThreshold: 0.8 });
    expect(budget.status).toBe(201);
    expect((await owner('POST', '/budgets', { period, categoryId: cat.id, amount: 5 })).status).toBe(400);

    // 5.000 TL üzeri giderleri yalnızca firma sahibi onaylayabilir; 100 TL'ye kadar otomatik onay
    await owner('POST', '/approval-rules', { name: 'Büyük harcama', minAmount: 5000, approverRoles: ['OWNER'] });
    await owner('PATCH', '/approval-rules/auto-approve', { limit: 100 });

    const employee = await loginAs('EMPLOYEE', { departmentId: sales.id });
    const accountant = await loginAs('ACCOUNTANT');

    const small = await employee('POST', '/expenses', { categoryId: cat.id, description: 'Çay', amount: 80, date: today });
    expect(small.data.status).toBe('APPROVED');
    const big = await employee('POST', '/expenses', { categoryId: cat.id, description: 'Müşteri yemeği', amount: 6000, date: today });
    expect(big.data.status).toBe('SUBMITTED');

    // Onay bekleyen gider sahibine ve muhasebeye bildirildi
    const ownerNotes = (await owner('GET', '/notifications')).data;
    expect(ownerNotes.items.some((n: any) => n.type === 'expense.submitted' && n.link === `/expenses/${big.data.id}`)).toBe(true);

    // Muhasebe 5.000 TL üstünü onaylayamaz; sahip onaylar ve çalışana bildirim gider
    const denied = await accountant('POST', `/expenses/${big.data.id}/approve`, {});
    expect(denied.status).toBe(403);
    expect((await accountant('GET', `/expenses/${big.data.id}`)).data).toMatchObject({ canDecide: false, requiredApproverRoles: ['OWNER'] });
    expect((await owner('POST', `/expenses/${big.data.id}/approve`, {})).data.status).toBe('APPROVED');
    expect((await employee('GET', '/notifications?unread=true')).data.items.some((n: any) => n.type === 'expense.approved')).toBe(true);

    const list = (await owner('GET', `/budgets?period=${period}`)).data;
    const b = list.items.find((x: any) => x.id === budget.data.id);
    expect(b).toMatchObject({ actual: '6080.00', state: 'EXCEEDED' });

    // Bütçe aşımı bildirimi tek sefer üretilir
    await worker.runReminders();
    await worker.runReminders();
    const exceeded = (await owner('GET', '/notifications')).data.items.filter((n: any) => n.type === 'budget.exceeded');
    expect(exceeded).toHaveLength(1);
    expect((await employee('GET', '/budgets')).status).toBe(403);
  });

  it('şube seçiliyken listeler şubeye daralır, tekil kayıt erişimi bozulmaz', async () => {
    const ist = (await owner('POST', '/settings/branches', { code: 'ist', name: 'İstanbul' })).data;
    const ank = (await owner('POST', '/settings/branches', { code: 'ank', name: 'Ankara' })).data;
    const a1 = (await owner('POST', '/bank-accounts', { bankName: 'B', name: 'İst hesabı', branchId: ist.id })).data;
    const a2 = (await owner('POST', '/bank-accounts', { bankName: 'B', name: 'Ank hesabı', branchId: ank.id })).data;
    await owner('POST', '/transactions', { date: today, description: 'İst giriş', amount: 100, direction: 'IN', bankAccountId: a1.id });
    await owner('POST', '/transactions', { date: today, description: 'Ank giriş', amount: 200, direction: 'IN', bankAccountId: a2.id });

    const all = (await owner('GET', '/transactions?q=giriş')).data;
    expect(all.total).toBe(2);
    const onlyIst = (await owner('GET', '/transactions?q=giriş', undefined, { 'x-branch-id': ist.id })).data;
    expect(onlyIst.items.map((t: any) => t.description)).toEqual(['İst giriş']);
    const ankTxn = all.items.find((t: any) => t.description === 'Ank giriş');
    expect((await owner('GET', `/transactions/${ankTxn.id}`, undefined, { 'x-branch-id': ist.id })).status).toBe(200);
    expect((await owner('GET', '/bank-accounts', undefined, { 'x-branch-id': ank.id })).data.map((x: any) => x.name)).toEqual(['Ank hesabı']);

    // Başka firmanın şube kimliği yok sayılır
    const other = client(base);
    await other('POST', '/auth/register', { companyName: 'Diğer', name: 'D', email: `o${stamp}@t.local`, password: PW });
    expect((await other('GET', '/transactions', undefined, { 'x-branch-id': ist.id })).data.total).toBe(0);
  });

  it('banka bağlantısı: izin → senkronizasyon → mükerrersiz tekrar → izin süresi dolunca durur', async () => {
    const start = await owner('POST', '/bank-connections', { provider: 'mockbank', name: 'Örnek Bankası' });
    expect(start.status).toBe(201);
    const authUrl = new URL(start.data.authorizeUrl);
    const state = authUrl.searchParams.get('state')!;

    // Kullanıcı bankada iki hesap için izin verir
    const decision = await fetch(`${process.env.API_URL}/api/v1/mock-provider/bank/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams([
        ['state', state],
        ['redirect_uri', authUrl.searchParams.get('redirect_uri')!],
        ['decision', 'allow'],
        ['accounts', 'ob-try-001'],
        ['accounts', 'ob-try-pos'],
      ]),
      redirect: 'manual',
    });
    expect(decision.status).toBe(303);
    const back = new URL(decision.headers.get('location')!);
    const code = back.searchParams.get('code')!;

    // Başka firma bu izin durumunu kullanamaz
    const other = client(base);
    await other('POST', '/auth/register', { companyName: 'Saldırgan', name: 'S', email: `x${stamp}@t.local`, password: PW });
    expect((await other('POST', '/bank-connections/callback', { state, code })).status).toBe(404);

    const cb = await owner('POST', '/bank-connections/callback', { state, code });
    expect(cb.data.accounts).toBe(2);
    await worker.tick();

    const conns = (await owner('GET', '/bank-connections')).data.items;
    const conn = conns.find((c: any) => c.id === start.data.id);
    expect(conn.status).toBe('ACTIVE');
    expect(conn.jobs[0].status).toBe('SUCCEEDED');
    expect(JSON.stringify(conns)).not.toContain('tokenEnc');
    const firstCount = (await owner('GET', '/transactions?dataSource=CONNECTED&pageSize=1')).data.total;
    expect(firstCount).toBeGreaterThan(10);
    const acc = (await owner('GET', '/bank-accounts')).data.find((a: any) => a.name === 'Ticari Vadesiz TL');
    expect(acc.balanceSource).toBe('CONNECTED');

    // Bağlı hesaba dosya aktarılamaz, manuel bakiye girilemez
    expect((await owner('POST', `/bank-accounts/${acc.id}/balance`, { balance: 1, asOf: today })).status).toBe(400);

    // Tekrar senkronizasyon yeni kayıt üretmez
    await owner('POST', `/bank-connections/${start.data.id}/sync`);
    await worker.tick();
    expect((await owner('GET', '/transactions?dataSource=CONNECTED&pageSize=1')).data.total).toBe(firstCount);

    // İzin süresi dolunca kalıcı hata, EXPIRED durumu ve bildirim
    await prisma.raw.bankConnection.update({ where: { id: start.data.id }, data: { consentExpiresAt: new Date(Date.now() - 1000) } });
    await owner('POST', `/bank-connections/${start.data.id}/sync`);
    await worker.tick();
    const after = (await owner('GET', '/bank-connections')).data.items.find((c: any) => c.id === start.data.id);
    expect(after.status).toBe('EXPIRED');
    expect(after.jobs[0]).toMatchObject({ status: 'FAILED' });
    expect((await owner('GET', '/notifications')).data.items.some((n: any) => n.type === 'bank.expired')).toBe(true);

    // Bağlantı kesilince hesaplar kalır, ekstre aktarımına açılır
    await owner('POST', `/bank-connections/${start.data.id}/disconnect`);
    expect((await owner('POST', `/bank-accounts/${acc.id}/balance`, { balance: 1, asOf: today })).status).toBe(201);
  });

  it('platform yöneticisi firma verisine erişemez; askıya alınan firma giriş yapamaz', async () => {
    await prisma.raw.platformUser.upsert({
      where: { email: `p${stamp}@platform.local` },
      create: { email: `p${stamp}@platform.local`, name: 'Platform', passwordHash: await bcrypt.hash(PW, 12) },
      update: {},
    });
    const platform = client(base);
    expect((await platform('POST', '/platform/auth/login', { email: `p${stamp}@platform.local`, password: PW })).status).toBe(200);

    // Platform oturumu firma API'sinde geçersiz; firma oturumu platform API'sinde geçersiz
    expect((await platform('GET', '/transactions')).status).toBe(401);
    expect((await owner('GET', '/platform/tenants')).status).toBe(401);

    const tenants = (await platform('GET', '/platform/tenants')).data;
    const mine = tenants.find((t: any) => t.name === 'Özellik A.Ş.');
    expect(mine.activeUsers).toBeGreaterThan(0);
    // Yalnızca sayılar döner, tutar yok
    expect(JSON.stringify(mine)).not.toMatch(/amount|balance/i);
    expect((await platform('GET', '/platform/health')).data.database.ok).toBe(true);

    expect((await platform('POST', `/platform/tenants/${mine.id}/suspend`, { reason: 'Ödeme yapılmadı' })).status).toBe(200);
    expect((await owner('GET', '/auth/me')).status).toBe(403);
    expect((await client(base)('POST', '/auth/login', { email: `f${stamp}@t.local`, password: PW })).status).toBe(403);
    await platform('POST', `/platform/tenants/${mine.id}/unsuspend`);
    expect((await owner('GET', '/auth/me')).status).toBe(200);
  });
});

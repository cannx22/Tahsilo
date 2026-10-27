/* Demo verisi: npm run db:seed (apps/api). Tekrar çalıştırıldığında demo firması varsa atlanır. */
import 'dotenv/config';
import { DataSource, Prisma, PrismaClient, Role, TxnSourceType, TxnStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { seedTenantDefaults } from '../src/auth/tenant-defaults';

const prisma = new PrismaClient();
const PASSWORD = 'Tahsilo2026!';
const DAY = 86400000;

const today = new Date(new Date().toISOString().slice(0, 10));
const d = (offset: number) => new Date(today.getTime() + offset * DAY);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function encryptJson(value: unknown) {
  const key = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY .env içinde tanımlı olmalı');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

async function main() {
  const existing = await prisma.tenant.findUnique({ where: { slug: 'demo' } });
  if (existing) {
    console.log('Demo firması zaten var; yalnızca eksik ek veriler tamamlanıyor.');
  } else {
    await createDemo();
  }
  const tenant = existing ?? (await prisma.tenant.findUniqueOrThrow({ where: { slug: 'demo' } }));
  await ensureExtras(tenant.id);
  await ensurePlatformAdmin();
}

/** Şubeler, bütçeler ve onay kuralları. Tekrar çalıştırılabilir; mevcut kayıtlar korunur. */
async function ensureExtras(tenantId: string) {
  const branch = (code: string, name: string) =>
    prisma.branch.upsert({ where: { tenantId_code: { tenantId, code } }, create: { tenantId, code, name }, update: {} });
  const ist = await branch('IST', 'İstanbul Merkez');
  const ank = await branch('ANK', 'Ankara Şube');

  // Mevcut kayıtları şubelere dağıt (yalnızca şubesi boş olanlar)
  const main = await prisma.bankAccount.findFirst({ where: { tenantId, name: 'Ana TL Hesap' } });
  if (main && !main.branchId) {
    await prisma.bankAccount.update({ where: { id: main.id }, data: { branchId: ist.id } });
    await prisma.financialTransaction.updateMany({ where: { bankAccountId: main.id }, data: { branchId: ist.id } });
  }
  const salesCard = await prisma.cardAccount.findFirst({ where: { tenantId, last4: '1234' } });
  if (salesCard && !salesCard.branchId) {
    await prisma.cardAccount.update({ where: { id: salesCard.id }, data: { branchId: ank.id } });
    await prisma.financialTransaction.updateMany({ where: { cardAccountId: salesCard.id }, data: { branchId: ank.id } });
    await prisma.expense.updateMany({ where: { tenantId, transaction: { cardAccountId: salesCard.id } }, data: { branchId: ank.id } });
  }
  await prisma.user.updateMany({ where: { tenantId, email: { in: ['calisan@tahsilo.local', 'yonetici@tahsilo.local'] }, branchId: null }, data: { branchId: ank.id } });
  await prisma.user.updateMany({ where: { tenantId, branchId: null }, data: { branchId: ist.id } });

  const period = new Date().toISOString().slice(0, 7);
  if (!(await prisma.budget.count({ where: { tenantId, period } }))) {
    const cats = await prisma.expenseCategory.findMany({ where: { tenantId } });
    const deps = await prisma.department.findMany({ where: { tenantId } });
    const cat = (n: string) => cats.find((c) => c.name === n)?.id;
    await prisma.budget.createMany({
      data: [
        { tenantId, period, categoryId: cat('Ulaşım ve seyahat'), amount: 12_000 },
        { tenantId, period, categoryId: cat('Yemek ve ikram'), amount: 3_000 },
        { tenantId, period, categoryId: cat('Yazılım ve abonelik'), amount: 15_000 },
        { tenantId, period, categoryId: cat('Pazarlama ve reklam'), amount: 10_000, alertThreshold: 0.9 },
        { tenantId, period, categoryId: cat('Akaryakıt'), amount: 4_000 },
        { tenantId, period, departmentId: deps.find((d) => d.name === 'Satış')?.id, amount: 20_000, note: 'Satış ekibi kart ve nakit giderleri' },
      ],
    });
  }
  if (!(await prisma.approvalRule.count({ where: { tenantId } }))) {
    await prisma.approvalRule.createMany({
      data: [
        { tenantId, name: 'Standart', minAmount: 0, approverRoles: ['MANAGER', 'ACCOUNTANT'] },
        { tenantId, name: 'Yüksek tutar', minAmount: 10_000, approverRoles: ['OWNER'] },
      ],
    });
    await prisma.tenant.update({ where: { id: tenantId }, data: { expenseAutoApproveLimit: 250 } });
  }
}

async function ensurePlatformAdmin() {
  const email = 'platform@tahsilo.local';
  if (await prisma.platformUser.findUnique({ where: { email } })) return;
  await prisma.platformUser.create({ data: { email, name: 'Platform Yöneticisi', passwordHash: await bcrypt.hash(PASSWORD, 12) } });
  console.log(`Platform yöneticisi (yalnızca geliştirme): ${email} / ${PASSWORD} → /platform`);
}

async function createDemo() {

  const tenant = await prisma.tenant.create({ data: { name: 'Demo Ticaret A.Ş.', slug: 'demo', taxNumber: '1112223334' } });
  const tenantId = tenant.id;
  await prisma.$transaction((tx) => seedTenantDefaults(tx, tenantId));

  const deps = await prisma.department.findMany({ where: { tenantId } });
  const dep = (name: string) => deps.find((x) => x.name === name)!.id;
  const cats = await prisma.expenseCategory.findMany({ where: { tenantId } });
  const cat = (name: string) => cats.find((c) => c.name === name)!.id;
  const costCenters = await prisma.costCenter.findMany({ where: { tenantId } });

  const hash = await bcrypt.hash(PASSWORD, 12);
  const mk = (email: string, name: string, role: Role, departmentId?: string) =>
    prisma.user.create({ data: { tenantId, email, name, role, passwordHash: hash, departmentId } });
  const owner = await mk('demo@tahsilo.local', 'Deniz Kaya', 'OWNER', dep('Yönetim'));
  const accountant = await mk('muhasebe@tahsilo.local', 'Elif Aydın', 'ACCOUNTANT', dep('Finans'));
  const manager = await mk('yonetici@tahsilo.local', 'Murat Demir', 'MANAGER', dep('Satış'));
  const employee = await mk('calisan@tahsilo.local', 'Selin Öztürk', 'EMPLOYEE', dep('Satış'));
  await mk('operasyon@tahsilo.local', 'Can Arslan', 'OPERATIONS', dep('Operasyon'));
  await mk('denetci@tahsilo.local', 'Zeynep Çelik', 'AUDITOR');

  // ───── Banka hesapları ve ekstre aktarımı ─────
  const main = await prisma.bankAccount.create({
    data: { tenantId, bankName: 'Örnek Bankası', name: 'Ana TL Hesap', ibanMasked: 'TR12 **** **** 6789', currency: 'TRY' },
  });
  const usd = await prisma.bankAccount.create({
    data: { tenantId, bankName: 'Örnek Bankası', name: 'USD Hesap', ibanMasked: 'TR98 **** **** 4321', currency: 'USD', balance: 12_450, balanceAsOf: d(-1), balanceSource: 'MANUAL' },
  });
  await prisma.bankAccount.create({ data: { tenantId, bankName: 'Diğer Banka', name: 'Kredi Kartı Ödeme Hesabı', currency: 'TRY' } });

  const batch = await prisma.importBatch.create({
    data: {
      tenantId,
      fileName: 'ornek-banka-ekstre.csv',
      fileHash: sha('demo-batch'),
      bankAccountId: main.id,
      rowCount: 0,
      importedCount: 0,
      duplicateCount: 0,
      errorCount: 0,
      mapping: { hasHeader: true, date: 0, description: 1, amount: 2, balance: 3, dateFormat: 'DD.MM.YYYY', decimal: ',' },
      status: 'COMPLETED',
      createdById: accountant.id,
    },
  });

  const bankRows: [number, string, number, string?][] = [];
  for (const m of [2, 1, 0]) {
    const base = -30 * m;
    bankRows.push(
      [base - 28, 'MAAS ODEMELERI EKIM', -184_500, 'Personel'],
      [base - 27, 'SGK PRIM ODEMESI', -61_250, 'Vergi ve SGK'],
      [base - 25, 'MERKEZ PLAZA GAYRIMENKUL KIRA', -45_000, 'Kira'],
      [base - 24, 'ENERJISA ELEKTRIK FATURA', -6_840.35, 'Elektrik, su, doğalgaz'],
      [base - 23, 'TURK TELEKOM INTERNET', -1_899.9, 'Telefon ve internet'],
      [base - 22, 'EFT GELEN ANADOLU YAPI MARKET', 52_000],
      [base - 18, 'HAVALE GELEN EGE TEKSTIL', 38_750],
      [base - 15, 'EFT MASRAFI', -8.5, 'Banka masrafı ve komisyon'],
      [base - 14, 'HIZLI KARGO A.S. ODEME', -3_120],
      [base - 12, 'EFT GELEN MARMARA LOJISTIK', 15_000],
      [base - 10, 'KDV ODEMESI GIB', -27_480, 'Vergi ve SGK'],
      [base - 8, 'KREDI KARTI BORC ODEMESI 1234', -21_640.6],
      [base - 5, 'HAVALE GELEN KARADENIZ GIDA', 24_300],
    );
  }
  bankRows.push([-2, 'EFT GELEN', 9_870], [-1, 'BSMV', -0.43, 'Banka masrafı ve komisyon']);
  bankRows.sort((a, b) => a[0] - b[0]);

  let balance = 1_640_000;
  let n = 0;
  for (const [offset, description, amount, category] of bankRows) {
    if (offset > 0) continue;
    balance += amount;
    await prisma.financialTransaction.create({
      data: {
        tenantId,
        sourceType: 'BANK',
        dataSource: 'IMPORTED',
        dedupeKey: sha(`demo-bank-${n++}`),
        bankAccountId: main.id,
        importBatchId: batch.id,
        date: d(offset),
        description,
        amount,
        currency: 'TRY',
        categoryId: category ? cat(category) : null,
        reconStatus: category ? 'IGNORED' : 'UNMATCHED',
        createdById: accountant.id,
      },
    });
  }
  await prisma.importBatch.update({ where: { id: batch.id }, data: { rowCount: n, importedCount: n } });
  await prisma.bankAccount.update({ where: { id: main.id }, data: { balance, balanceAsOf: d(-1), balanceSource: 'IMPORTED' } });
  await prisma.financialTransaction.create({
    data: { tenantId, sourceType: 'BANK', dataSource: 'MANUAL', dedupeKey: sha('demo-usd-1'), bankAccountId: usd.id, date: d(-6), description: 'İHRACAT TAHSİLATI', amount: 4_200, currency: 'USD', createdById: owner.id },
  });

  // ───── Şirket kartları ─────
  const salesCard = await prisma.cardAccount.create({
    data: { tenantId, name: 'Satış Kartı', bankName: 'Örnek Bankası', last4: '1234', holderUserId: employee.id, holderName: employee.name, creditLimit: 75_000, statementDay: 20, dueDay: 30 },
  });
  const execCard = await prisma.cardAccount.create({
    data: { tenantId, name: 'Yönetim Kartı', bankName: 'Örnek Bankası', last4: '9876', holderUserId: owner.id, holderName: owner.name, creditLimit: 150_000, statementDay: 20, dueDay: 30 },
  });

  const lastStmtEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (today.getUTCDate() > 20 ? 0 : 1), 20));
  const lastStmtStart = new Date(Date.UTC(lastStmtEnd.getUTCFullYear(), lastStmtEnd.getUTCMonth() - 1, 21));
  const statement = await prisma.cardStatement.create({
    data: {
      tenantId,
      cardAccountId: salesCard.id,
      periodStart: lastStmtStart,
      periodEnd: lastStmtEnd,
      dueDate: new Date(lastStmtEnd.getTime() + 10 * DAY),
      totalAmount: 0,
      minimumPayment: 0,
      source: 'MANUAL',
    },
  });

  const cardRows: [string, number, string, string, TxnStatus][] = [
    [salesCard.id, -35, 'PEGASUS HAVA YOLLARI', 'Ulaşım ve seyahat', 'POSTED'],
    [salesCard.id, -33, 'HILTON OTEL ANKARA', 'Ulaşım ve seyahat', 'POSTED'],
    [salesCard.id, -31, 'OPET AKARYAKIT', 'Akaryakıt', 'POSTED'],
    [salesCard.id, -26, 'KOFTECI YUSUF RESTORAN', 'Yemek ve ikram', 'POSTED'],
    [salesCard.id, -12, 'SHELL ISTASYON', 'Akaryakıt', 'POSTED'],
    [salesCard.id, -6, 'STARBUCKS KADIKOY', 'Yemek ve ikram', 'POSTED'],
    [salesCard.id, -1, 'BITAKSI', 'Ulaşım ve seyahat', 'PENDING'],
    [execCard.id, -20, 'GOOGLE WORKSPACE', 'Yazılım ve abonelik', 'POSTED'],
    [execCard.id, -18, 'AMAZON WEB SERVICES', 'Yazılım ve abonelik', 'POSTED'],
    [execCard.id, -9, 'LINKEDIN ADS', 'Pazarlama ve reklam', 'POSTED'],
    [execCard.id, -2, 'MIGROS', 'Ofis ve kırtasiye', 'PENDING'],
  ];
  const amounts = [4_890, 6_200, 2_150.4, 1_340, 2_480.75, 285, 410, 3_240, 8_912.33, 12_500, 1_126.9];
  let stmtTotal = new Prisma.Decimal(0);
  const cardTxns: Awaited<ReturnType<typeof prisma.financialTransaction.create>>[] = [];
  for (const [i, [cardId, offset, description, category, status]] of cardRows.entries()) {
    const date = d(offset);
    const inStatement = cardId === salesCard.id && date >= lastStmtStart && date <= lastStmtEnd;
    if (inStatement) stmtTotal = stmtTotal.plus(amounts[i]);
    cardTxns.push(
      await prisma.financialTransaction.create({
        data: {
          tenantId,
          sourceType: 'CARD' as TxnSourceType,
          dataSource: 'IMPORTED' as DataSource,
          dedupeKey: sha(`demo-card-${i}`),
          cardAccountId: cardId,
          statementId: inStatement ? statement.id : null,
          date,
          description,
          amount: -amounts[i],
          currency: 'TRY',
          status,
          // Çalışan kategoriyi kendisi doğrulasın diye bazı hareketler kategorisiz bırakılır
          categoryId: i % 3 === 0 ? null : cat(category),
          createdById: accountant.id,
        },
      }),
    );
  }
  await prisma.cardStatement.update({ where: { id: statement.id }, data: { totalAmount: stmtTotal, minimumPayment: stmtTotal.mul(0.4).toDecimalPlaces(2) } });

  // ───── Giderler ─────
  const expenseFrom = async (idx: number, status: 'SUBMITTED' | 'APPROVED', description: string, project?: string) => {
    const t = cardTxns[idx];
    await prisma.financialTransaction.update({ where: { id: t.id }, data: { categoryId: cat(cardRows[idx][3]) } });
    return prisma.expense.create({
      data: {
        tenantId,
        transactionId: t.id,
        submittedById: employee.id,
        categoryId: cat(cardRows[idx][3]),
        departmentId: dep('Satış'),
        costCenterId: costCenters.find((c) => c.code === 'MM-200')!.id,
        project,
        merchant: t.description,
        description,
        date: t.date,
        amount: t.amount.abs(),
        status,
      },
    });
  };
  await expenseFrom(0, 'APPROVED', 'Ankara müşteri ziyareti uçuş', 'Ankara bayi projesi');
  await expenseFrom(1, 'APPROVED', 'Ankara müşteri ziyareti konaklama', 'Ankara bayi projesi');
  await expenseFrom(3, 'SUBMITTED', 'Müşteri yemeği — Anadolu Yapı');
  await expenseFrom(4, 'SUBMITTED', 'Saha ziyareti yakıt');
  await prisma.expense.create({
    data: { tenantId, submittedById: manager.id, categoryId: cat('Ofis ve kırtasiye'), departmentId: dep('Satış'), description: 'Nakit kırtasiye alımı', merchant: 'Kırtasiye', date: d(-4), amount: 640, status: 'SUBMITTED' },
  });

  // ───── Planlı ödemeler ─────
  const nextMonthDay = (day: number) => {
    const x = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), day));
    return x < today ? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, day)) : x;
  };
  await prisma.plannedPayment.createMany({
    data: [
      { tenantId, title: 'Ofis kirası', category: 'Kira', amount: 45_000, dueDate: nextMonthDay(5), recurrence: 'MONTHLY' },
      { tenantId, title: 'SGK primleri', category: 'Vergi', amount: 61_250, dueDate: nextMonthDay(23), recurrence: 'MONTHLY' },
      { tenantId, title: 'Maaş ödemeleri', category: 'Personel', amount: 184_500, dueDate: nextMonthDay(1), recurrence: 'MONTHLY' },
      { tenantId, title: 'KDV beyannamesi', category: 'Vergi', amount: 29_900, dueDate: nextMonthDay(26), recurrence: 'MONTHLY' },
      { tenantId, title: 'Muhasebe yazılımı yıllık lisans', category: 'Abonelik', amount: 18_000, dueDate: d(45), recurrence: 'YEARLY' },
      { tenantId, title: 'Eski kargo borcu', category: 'Tedarikçi', amount: 3_120, dueDate: d(-3), recurrence: 'NONE' },
    ],
  });

  // ───── Sanal POS ─────
  const terminal = await prisma.terminal.create({
    data: { tenantId, provider: 'mockpos', name: 'MockPOS sandbox terminali', configEnc: encryptJson({ merchantId: 'demo-merchant', apiKey: 'sandbox' }), commissionRate: 0.0249, isDefault: true },
  });
  const paid = [
    { amount: 4_250, desc: 'Online sipariş #1042', offset: -9 },
    { amount: 2_980, desc: 'Online sipariş #1043', offset: -9 },
    { amount: 12_400, desc: 'Servis bedeli — Ekim', offset: -4 },
  ];
  for (const [i, p] of paid.entries()) {
    const req = await prisma.paymentRequest.create({
      data: {
        tenantId,
        token: randomBytes(24).toString('base64url'),
        terminalId: terminal.id,
        amount: p.amount,
        description: p.desc,
        status: 'PAID',
        expiresAt: d(p.offset + 7),
        paidAt: d(p.offset),
        createdById: accountant.id,
        createdAt: d(p.offset),
      },
    });
    const commission = new Prisma.Decimal(p.amount).mul(0.0249).toDecimalPlaces(2);
    await prisma.paymentAttempt.create({
      data: {
        tenantId,
        paymentRequestId: req.id,
        terminalId: terminal.id,
        providerSessionId: `seed_session_${i}`,
        providerPaymentId: `seed_payment_${i}`,
        status: 'SUCCEEDED',
        amount: p.amount,
        commission,
        cardLast4: ['4242', '1111', '5454'][i],
        cardBrand: i === 2 ? 'MASTERCARD' : 'VISA',
        threeDSecure: i === 2,
        completedAt: d(p.offset),
        createdAt: d(p.offset),
      },
    });
    await prisma.financialTransaction.create({
      data: { tenantId, sourceType: 'POS', dataSource: 'CONNECTED', sourceRef: `seed_payment_${i}`, dedupeKey: `pos:mockpos:seed_payment_${i}`, date: d(p.offset), description: `Sanal POS tahsilatı: ${p.desc}`, amount: p.amount, currency: 'TRY' },
    });
  }
  // İlk iki POS tahsilatının gün sonu toplu aktarımı (komisyon düşülmüş) — mutabakat önerisi üretir
  const netOf = (v: number) => new Prisma.Decimal(v).minus(new Prisma.Decimal(v).mul(0.0249).toDecimalPlaces(2));
  const net = netOf(4_250).plus(netOf(2_980));
  await prisma.financialTransaction.create({
    data: { tenantId, sourceType: 'BANK', dataSource: 'IMPORTED', dedupeKey: sha('demo-pos-settlement'), bankAccountId: main.id, importBatchId: batch.id, date: d(-8), description: 'POS GUN SONU ALACAK AKTARIMI', amount: net, currency: 'TRY' },
  });
  await prisma.paymentRequest.create({
    data: { tenantId, token: randomBytes(24).toString('base64url'), terminalId: terminal.id, amount: 1_750, description: 'Danışmanlık hizmeti ön ödeme', status: 'PENDING', expiresAt: d(7), createdById: accountant.id, customerEmail: 'musteri@example.com' },
  });

  // ───── ERP: API başladığında kuyruktaki işler cari ve faturaları çeker ─────
  const erp = await prisma.erpConnection.create({
    data: { tenantId, provider: 'mockerp', name: 'MockERP — Muhasebe', configEnc: encryptJson({ companyCode: `demo-${tenantId.slice(-6)}`, apiKey: 'sandbox' }) },
  });
  await prisma.syncJob.create({ data: { tenantId, connectionId: erp.id, type: 'PULL_COUNTERPARTIES', createdById: owner.id } });
  await prisma.syncJob.create({ data: { tenantId, connectionId: erp.id, type: 'PULL_INVOICES', createdById: owner.id, createdAt: new Date(Date.now() + 1000) } });

  await prisma.auditLog.create({ data: { tenantId, userId: owner.id, userEmail: owner.email, action: 'seed.demo', entityType: 'Tenant', entityId: tenantId } });

  console.log('\nDemo firması hazır: Demo Ticaret A.Ş.');
  console.log(`Tüm kullanıcıların parolası: ${PASSWORD}`);
  for (const [email, role] of [
    ['demo@tahsilo.local', 'Firma sahibi'],
    ['muhasebe@tahsilo.local', 'Muhasebe'],
    ['yonetici@tahsilo.local', 'Ekip yöneticisi'],
    ['calisan@tahsilo.local', 'Çalışan / kart sahibi'],
    ['operasyon@tahsilo.local', 'Operasyon'],
    ['denetci@tahsilo.local', 'Denetçi'],
  ])
    console.log(`  ${email.padEnd(26)} ${role}`);
  console.log('\nNot: ERP cari/fatura çekme işleri API çalıştığında otomatik işlenir.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

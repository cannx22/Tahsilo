import { Prisma } from '@prisma/client';

export const DEFAULT_CATEGORIES: { name: string; code: string; keywords: string[] }[] = [
  { name: 'Yemek ve ikram', code: '770.01', keywords: ['restoran', 'cafe', 'kafe', 'yemek', 'getir', 'yemeksepeti', 'starbucks', 'burger', 'lokanta'] },
  { name: 'Ulaşım ve seyahat', code: '770.02', keywords: ['thy', 'pegasus', 'uber', 'taksi', 'otel', 'hotel', 'bitaksi', 'otopark', 'havalimani', 'hgs', 'ogs'] },
  { name: 'Akaryakıt', code: '770.03', keywords: ['opet', 'shell', 'petrol ofisi', 'akaryakit', 'aytemiz', 'total enerji'] },
  { name: 'Yazılım ve abonelik', code: '770.04', keywords: ['google', 'microsoft', 'aws', 'amazon web', 'github', 'slack', 'adobe', 'zoom', 'notion', 'atlassian'] },
  { name: 'Ofis ve kırtasiye', code: '770.05', keywords: ['kirtasiye', 'ofis', 'migros', 'a101', 'carrefour'] },
  { name: 'Kira', code: '770.06', keywords: ['kira'] },
  { name: 'Elektrik, su, doğalgaz', code: '770.07', keywords: ['enerjisa', 'elektrik', 'igdas', 'iski', 'dogalgaz'] },
  { name: 'Telefon ve internet', code: '770.08', keywords: ['turkcell', 'vodafone', 'turk telekom', 'superonline', 'turknet'] },
  { name: 'Banka masrafı ve komisyon', code: '780.01', keywords: ['masraf', 'komisyon', 'eft ucret', 'havale ucret', 'bsmv', 'kart aidat'] },
  { name: 'Vergi ve SGK', code: '360.01', keywords: ['vergi', 'gib', 'sgk', 'kdv', 'muhtasar', 'stopaj'] },
  { name: 'Personel', code: '335.01', keywords: ['maas', 'ucret odemesi', 'avans'] },
  { name: 'Pazarlama ve reklam', code: '760.01', keywords: ['facebook', 'meta', 'google ads', 'linkedin', 'reklam', 'instagram'] },
  { name: 'Diğer', code: '770.99', keywords: [] },
];

export async function seedTenantDefaults(tx: Prisma.TransactionClient, tenantId: string) {
  await tx.expenseCategory.createMany({ data: DEFAULT_CATEGORIES.map((c) => ({ ...c, tenantId })) });
  await tx.department.createMany({
    data: ['Yönetim', 'Finans', 'Satış', 'Operasyon'].map((name) => ({ tenantId, name })),
  });
  await tx.costCenter.createMany({
    data: [
      { tenantId, code: 'MM-100', name: 'Genel yönetim' },
      { tenantId, code: 'MM-200', name: 'Satış ve pazarlama' },
      { tenantId, code: 'MM-300', name: 'Operasyon' },
    ],
  });
}

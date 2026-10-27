import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { BankApiAccount, BankApiError, BankApiTransaction } from '../banking/bank-adapter';

/**
 * Açık bankacılık sağlayıcısını taklit eden sandbox ("Örnek Bankası"). Tahsilo'nun parçası değildir.
 * Hareketler her gün için deterministik üretilir: aynı gün tekrar sorgulanınca aynı kimliklerle döner,
 * bugünkü işlemler PENDING, geçmiş günler BOOKED olur. Böylece senkronizasyon ve mükerrerlik gerçekçi sınanır.
 */
export const MOCKBANK_ACCOUNTS: (BankApiAccount & { opening: number })[] = [
  { externalId: 'ob-try-001', name: 'Ticari Vadesiz TL', iban: 'TR330006100519786457841326', currency: 'TRY', opening: 850_000 },
  { externalId: 'ob-try-pos', name: 'POS Tahsilat Hesabı', iban: 'TR680006100519786457841399', currency: 'TRY', opening: 25_000 },
  { externalId: 'ob-eur-001', name: 'EUR Döviz Hesabı', iban: 'TR120006100519786457841444', currency: 'EUR', opening: 18_000 },
];

const START = Date.UTC(2026, 0, 1);
const DAY = 86400000;
const CONSENT_DAYS = 90;

interface State {
  codes: Record<string, { accounts: string[]; expiresAt: number }>;
  tokens: Record<string, { accounts: string[]; expiresAt: number }>;
}

function rng(seed: string) {
  let h = createHash('sha256').update(seed).digest().readUInt32BE(0);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CUSTOMERS = ['ANADOLU YAPI MARKET', 'EGE TEKSTIL', 'MARMARA LOJISTIK', 'KARADENIZ GIDA', 'AKDENIZ TURIZM', 'TRAKYA OTOMOTIV'];
const BILLS: [string, number, number][] = [
  ['TURKCELL FATURA', 900, 2_400],
  ['ENERJISA ELEKTRIK', 3_000, 9_000],
  ['IGDAS DOGALGAZ', 1_500, 6_000],
  ['HIZLI KARGO A.S.', 800, 4_000],
  ['OFIS MALZEMESI', 500, 3_000],
];

function generateDay(acc: string, dayIndex: number): Omit<BankApiTransaction, 'status'>[] {
  const date = new Date(START + dayIndex * DAY);
  const iso = date.toISOString().slice(0, 10);
  const r = rng(`${acc}:${iso}`);
  const out: Omit<BankApiTransaction, 'status'>[] = [];
  const weekday = date.getUTCDay() !== 0 && date.getUTCDay() !== 6;
  const push = (description: string, amount: number, currency: string, counterparty?: string) =>
    out.push({ externalId: `${acc}-${iso}-${out.length}`, date: iso, description, amount: amount.toFixed(2), currency, counterparty });

  if (acc === 'ob-try-001') {
    if (date.getUTCDate() === 1) push('MAAS ODEMELERI', -(150_000 + Math.round(r() * 30_000)), 'TRY');
    if (date.getUTCDate() === 23) push('SGK PRIM ODEMESI', -(52_000 + Math.round(r() * 8_000)), 'TRY', 'SGK');
    // Aylık giriş ≈ 220 bin, çıkış ≈ 230 bin: bakiye yıl içinde gerçekçi bir bantta kalır
    if (weekday) {
      if (r() < 0.5) {
        const c = CUSTOMERS[Math.floor(r() * CUSTOMERS.length)];
        push(`EFT GELEN ${c}`, Math.round((5_000 + r() * 30_000) * 100) / 100, 'TRY', c);
      }
      if (r() < 0.5) {
        const [label, min, max] = BILLS[Math.floor(r() * BILLS.length)];
        push(label, -Math.round((min + r() * (max - min)) * 100) / 100, 'TRY');
      }
      if (r() < 0.3) push('EFT MASRAFI', -8.5, 'TRY');
    }
  } else if (acc === 'ob-try-pos') {
    // POS tahsilatları her cuma ana hesaba aktarılır; hesapta yalnızca küçük bir bakiye kalır
    if (weekday) push('POS GUN SONU ALACAK AKTARIMI', Math.round((2_000 + r() * 13_000) * 100) / 100, 'TRY');
    if (date.getUTCDay() === 5) push('HESAP ARASI VIRMAN ANA HESABA', -40_000, 'TRY');
  } else if (acc === 'ob-eur-001') {
    if (date.getUTCDay() === 3 && r() < 0.3) push('SWIFT INCOMING EXPORT PAYMENT', Math.round((500 + r() * 2_500) * 100) / 100, 'EUR', 'EU CUSTOMER GMBH');
    if (date.getUTCDate() === 15) push('SWIFT CHARGES', -25, 'EUR');
  }
  return out;
}

@Injectable()
export class MockBankProvider {
  private readonly file = path.resolve(process.env.STORAGE_DIR ?? './storage', '_mockbank', 'state.json');

  private async load(): Promise<State> {
    try {
      return JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch {
      return { codes: {}, tokens: {} };
    }
  }

  private async save(s: State) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(s, null, 2));
  }

  async issueCode(accounts: string[]) {
    const s = await this.load();
    const code = `obc_${randomBytes(16).toString('hex')}`;
    s.codes[code] = { accounts: accounts.filter((a) => MOCKBANK_ACCOUNTS.some((x) => x.externalId === a)), expiresAt: Date.now() + 5 * 60_000 };
    await this.save(s);
    return code;
  }

  async exchange(code: string) {
    const s = await this.load();
    const c = s.codes[code];
    if (!c || c.expiresAt < Date.now()) throw new BankApiError('Yetki kodu geçersiz veya süresi dolmuş', 'PERMANENT');
    delete s.codes[code];
    const token = `obt_${randomBytes(24).toString('hex')}`;
    const expiresAt = Date.now() + CONSENT_DAYS * DAY;
    s.tokens[token] = { accounts: c.accounts, expiresAt };
    await this.save(s);
    return { accessToken: token, expiresAt: new Date(expiresAt) };
  }

  private async grant(token: string) {
    const t = (await this.load()).tokens[token];
    if (!t) throw new BankApiError('Erişim belirteci tanınmıyor', 'CONSENT_EXPIRED');
    if (t.expiresAt < Date.now()) throw new BankApiError('Banka izninin süresi dolmuş', 'CONSENT_EXPIRED');
    return t;
  }

  async accounts(token: string) {
    const g = await this.grant(token);
    return MOCKBANK_ACCOUNTS.filter((a) => g.accounts.includes(a.externalId)).map(({ opening: _o, ...a }) => a);
  }

  private async account(token: string, externalId: string) {
    const g = await this.grant(token);
    const acc = MOCKBANK_ACCOUNTS.find((a) => a.externalId === externalId);
    if (!acc || !g.accounts.includes(externalId)) throw new BankApiError('Bu hesap için izin yok', 'PERMANENT');
    return acc;
  }

  async transactions(token: string, externalId: string, from: string): Promise<BankApiTransaction[]> {
    await this.account(token, externalId);
    const today = Math.floor((Date.now() - START) / DAY);
    const fromIdx = Math.max(0, Math.floor((Date.parse(`${from}T00:00:00Z`) - START) / DAY));
    const out: BankApiTransaction[] = [];
    for (let d = fromIdx; d <= today; d++) {
      for (const t of generateDay(externalId, d)) out.push({ ...t, status: d === today ? 'PENDING' : 'BOOKED' });
    }
    return out;
  }

  async balance(token: string, externalId: string) {
    const acc = await this.account(token, externalId);
    const today = Math.floor((Date.now() - START) / DAY);
    let sum = acc.opening;
    // Bakiye yalnızca kesinleşmiş (geçmiş günlerin) hareketlerini içerir
    for (let d = 0; d < today; d++) for (const t of generateDay(externalId, d)) sum += Number(t.amount);
    return { balance: sum.toFixed(2), asOf: new Date() };
  }
}

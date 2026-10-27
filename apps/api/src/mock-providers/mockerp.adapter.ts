import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ErpAdapter, ErpCounterparty, ErpError, ErpExpensePush, ErpInvoice, ErpPaymentPush } from '../erp/erp-adapter';

/**
 * Harici bir ERP'yi taklit eden sandbox. Her şirket kodu için ayrı bir "uzak" veri dosyası tutar.
 * Yapılandırma: { companyCode, apiKey, failRate? }. apiKey "invalid" ise kalıcı yetki hatası,
 * failRate (0–1) verilirse rastgele geçici hata üretir (yeniden deneme davranışını göstermek için).
 */
interface RemoteState {
  counterparties: ErpCounterparty[];
  invoices: ErpInvoice[];
  payments: Record<string, { erpRef: string; payload: ErpPaymentPush }>;
  expenses: Record<string, { erpRef: string; payload: ErpExpensePush }>;
  seq: number;
}

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

function seed(): RemoteState {
  const counterparties: ErpCounterparty[] = [
    { erpRef: 'C-1001', code: '120.01.001', name: 'Anadolu Yapı Market A.Ş.', type: 'CUSTOMER', taxNumber: '1234567890', email: 'muhasebe@anadoluyapi.example' },
    { erpRef: 'C-1002', code: '120.01.002', name: 'Ege Tekstil Ltd. Şti.', type: 'CUSTOMER', taxNumber: '2345678901', email: 'finans@egetekstil.example' },
    { erpRef: 'C-1003', code: '120.01.003', name: 'Marmara Lojistik A.Ş.', type: 'CUSTOMER', taxNumber: '3456789012' },
    { erpRef: 'C-1004', code: '120.01.004', name: 'Karadeniz Gıda San. Tic.', type: 'BOTH', taxNumber: '4567890123' },
    { erpRef: 'S-2001', code: '320.01.001', name: 'Bulut Yazılım Hizmetleri A.Ş.', type: 'SUPPLIER', taxNumber: '5678901234' },
    { erpRef: 'S-2002', code: '320.01.002', name: 'Merkez Plaza Gayrimenkul', type: 'SUPPLIER', taxNumber: '6789012345' },
    { erpRef: 'S-2003', code: '320.01.003', name: 'Hızlı Kargo A.Ş.', type: 'SUPPLIER', taxNumber: '7890123456' },
  ];
  const inv = (n: number, type: 'SALES' | 'PURCHASE', cp: string, issue: number, due: number, total: number, paid = 0): ErpInvoice => ({
    erpRef: `INV-${n}`,
    number: `${type === 'SALES' ? 'STS' : 'ALS'}2026${String(n).padStart(6, '0')}`,
    type,
    counterpartyErpRef: cp,
    issueDate: day(issue),
    dueDate: day(due),
    total: total.toFixed(2),
    paidAmount: paid.toFixed(2),
    currency: 'TRY',
    cancelled: false,
  });
  return {
    counterparties,
    invoices: [
      inv(101, 'SALES', 'C-1001', -40, -10, 48_500),
      inv(102, 'SALES', 'C-1001', -15, 15, 22_750.5),
      inv(103, 'SALES', 'C-1002', -25, 5, 61_200),
      inv(104, 'SALES', 'C-1003', -60, -30, 15_000, 15_000),
      inv(105, 'SALES', 'C-1003', -5, 25, 9_870),
      inv(106, 'SALES', 'C-1004', -20, 10, 33_400, 10_000),
      inv(107, 'SALES', 'C-1002', -2, 28, 12_600),
      inv(201, 'PURCHASE', 'S-2001', -10, 20, 7_080),
      inv(202, 'PURCHASE', 'S-2002', -3, 7, 45_000),
      inv(203, 'PURCHASE', 'S-2003', -35, -5, 3_240),
      inv(204, 'PURCHASE', 'C-1004', -12, 18, 18_900),
    ],
    payments: {},
    expenses: {},
    seq: 5000,
  };
}

@Injectable()
export class MockErpAdapter implements ErpAdapter {
  readonly provider = 'mockerp';
  readonly displayName = 'MockERP (sandbox)';
  private readonly dir = path.resolve(process.env.STORAGE_DIR ?? './storage', '_mockerp');

  private file(config: Record<string, string>) {
    const code = (config.companyCode ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!code) throw new ErpError('Şirket kodu tanımlı değil', true);
    return path.join(this.dir, `${code}.json`);
  }

  private async load(config: Record<string, string>): Promise<RemoteState> {
    this.guard(config);
    const f = this.file(config);
    try {
      return JSON.parse(await fs.readFile(f, 'utf8'));
    } catch {
      const s = seed();
      await this.save(config, s);
      return s;
    }
  }

  private async save(config: Record<string, string>, s: RemoteState) {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.file(config), JSON.stringify(s, null, 2));
  }

  private guard(config: Record<string, string>) {
    if (!config.apiKey || config.apiKey === 'invalid') throw new ErpError('ERP yetkilendirmesi başarısız (API anahtarı geçersiz)', true);
    const rate = Number(config.failRate ?? 0);
    if (rate > 0 && Math.random() < rate) throw new ErpError('ERP geçici olarak yanıt vermiyor (zaman aşımı)');
  }

  async testConnection(config: Record<string, string>) {
    await this.load(config);
  }

  async listCounterparties(config: Record<string, string>) {
    return (await this.load(config)).counterparties;
  }

  async listInvoices(config: Record<string, string>) {
    return (await this.load(config)).invoices;
  }

  async pushPayment(config: Record<string, string>, p: ErpPaymentPush) {
    const s = await this.load(config);
    // Aynı externalId ikinci kez gelirse yeni kayıt açılmaz
    const existing = s.payments[p.externalId];
    if (existing) return { erpRef: existing.erpRef };
    const erpRef = `TAH-${++s.seq}`;
    s.payments[p.externalId] = { erpRef, payload: p };
    const inv = s.invoices.find((i) => i.erpRef === p.invoiceErpRef);
    if (inv) inv.paidAmount = Math.min(Number(inv.total), Number(inv.paidAmount) + Number(p.amount)).toFixed(2);
    await this.save(config, s);
    return { erpRef };
  }

  async pushExpense(config: Record<string, string>, e: ErpExpensePush) {
    const s = await this.load(config);
    const existing = s.expenses[e.externalId];
    if (existing) return { erpRef: existing.erpRef };
    const erpRef = `GDR-${++s.seq}`;
    s.expenses[e.externalId] = { erpRef, payload: e };
    await this.save(config, s);
    return { erpRef };
  }
}

import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { D, toDateOnly } from '../common/money';
import { Period } from '../common/period';
import { branchFilter, RequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

export interface ReportColumn {
  key: string;
  label: string;
  type?: 'text' | 'money' | 'date' | 'number' | 'percent';
}

export interface Report {
  key: string;
  title: string;
  period: { from: string; to: string };
  sources: string[];
  notes: string[];
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
}

export const REPORT_TYPES = [
  { key: 'income-expense', title: 'Gelir–gider (aylık)' },
  { key: 'categories', title: 'Kategori dağılımı' },
  { key: 'bank-transactions', title: 'Banka hareketleri' },
  { key: 'card-spending', title: 'Kart harcamaları' },
  { key: 'expenses', title: 'Gider kayıtları' },
  { key: 'upcoming-payments', title: 'Yaklaşan ödemeler' },
  { key: 'collections', title: 'Tahsilat ve iade' },
  { key: 'reconciliation', title: 'Mutabakat durumu' },
] as const;

const SOURCE_LABEL: Record<string, string> = { CONNECTED: 'API', IMPORTED: 'Dosya', MANUAL: 'Manuel' };

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async build(key: string, p: Period): Promise<Report> {
    const period = { from: toDateOnly(p.from), to: toDateOnly(p.to) };
    const dateWhere = { gte: p.from, lte: p.to };
    const createdWhere = { gte: p.from, lt: new Date(p.to.getTime() + 86400000) };
    const db = this.prisma.db;
    const title = REPORT_TYPES.find((r) => r.key === key)?.title;
    if (!title) throw new BadRequestException('Bilinmeyen rapor');
    const base = { key, title, period };

    switch (key) {
      case 'income-expense': {
        const rows = await db.$queryRaw<any[]>`
          SELECT to_char(date, 'YYYY-MM') AS month, currency, "sourceType" AS source,
                 COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0) AS inflow,
                 COALESCE(-SUM(amount) FILTER (WHERE amount < 0), 0) AS outflow,
                 COUNT(*)::int AS count
          FROM "FinancialTransaction"
          WHERE "tenantId" = ${RequestContext.tenantId()} AND date >= ${p.from} AND date <= ${p.to} AND status <> 'REVERSED' ${branchFilter()}
          GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`;
        const label: Record<string, string> = { BANK: 'Banka', CARD: 'Kart', MANUAL: 'Manuel', POS: 'Sanal POS' };
        return {
          ...base,
          sources: ['Banka', 'Kart', 'Manuel', 'Sanal POS'],
          notes: ['Sanal POS tahsilatları banka hesabına geçtiğinde banka satırında da görünür; kaynaklar toplanırken çift sayım yapılmamalıdır.', 'Para birimleri ayrı satırlarda gösterilir, çevrim yapılmaz.'],
          columns: [
            { key: 'month', label: 'Ay' },
            { key: 'source', label: 'Kaynak' },
            { key: 'currency', label: 'Para birimi' },
            { key: 'inflow', label: 'Giriş', type: 'money' },
            { key: 'outflow', label: 'Çıkış', type: 'money' },
            { key: 'net', label: 'Net', type: 'money' },
            { key: 'count', label: 'Hareket sayısı', type: 'number' },
          ],
          rows: rows.map((r) => ({
            month: r.month,
            source: label[r.source] ?? r.source,
            currency: r.currency,
            inflow: D(r.inflow).toFixed(2),
            outflow: D(r.outflow).toFixed(2),
            net: D(r.inflow).minus(r.outflow).toFixed(2),
            count: r.count,
          })),
        };
      }

      case 'categories': {
        const groups = await db.financialTransaction.groupBy({
          by: ['categoryId', 'currency'],
          where: { amount: { lt: 0 }, status: { not: 'REVERSED' }, sourceType: { not: 'POS' }, date: dateWhere },
          _sum: { amount: true },
          _count: true,
        });
        const cats = await db.expenseCategory.findMany({ select: { id: true, name: true, code: true } });
        const totals = new Map<string, Prisma.Decimal>();
        for (const g of groups) totals.set(g.currency, (totals.get(g.currency) ?? D(0)).plus(g._sum.amount!.abs()));
        return {
          ...base,
          sources: ['Banka', 'Kart', 'Manuel'],
          notes: ['Kategorisi atanmamış çıkışlar "Kategorisiz" satırında gösterilir.'],
          columns: [
            { key: 'category', label: 'Kategori' },
            { key: 'code', label: 'Hesap kodu' },
            { key: 'currency', label: 'Para birimi' },
            { key: 'amount', label: 'Tutar', type: 'money' },
            { key: 'share', label: 'Pay', type: 'percent' },
            { key: 'count', label: 'Hareket sayısı', type: 'number' },
          ],
          rows: groups
            .map((g) => {
              const c = cats.find((x) => x.id === g.categoryId);
              const amount = g._sum.amount!.abs();
              return {
                category: c?.name ?? 'Kategorisiz',
                code: c?.code ?? '',
                currency: g.currency,
                amount: amount.toFixed(2),
                share: totals.get(g.currency)!.isZero() ? '0' : amount.div(totals.get(g.currency)!).times(100).toFixed(1),
                count: g._count,
              };
            })
            .sort((a, b) => Number(b.amount) - Number(a.amount)),
        };
      }

      case 'bank-transactions': {
        const rows = await db.financialTransaction.findMany({
          where: { sourceType: { in: ['BANK', 'MANUAL'] }, cardAccountId: null, date: dateWhere },
          include: { bankAccount: { select: { name: true, bankName: true } }, category: { select: { name: true } } },
          orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
          take: 20000,
        });
        return {
          ...base,
          sources: [...new Set(rows.map((r) => SOURCE_LABEL[r.dataSource]))],
          notes: ['"Kaynak" sütunu verinin API, dosya veya manuel girişten geldiğini gösterir.'],
          columns: [
            { key: 'date', label: 'Tarih', type: 'date' },
            { key: 'account', label: 'Hesap' },
            { key: 'description', label: 'Açıklama' },
            { key: 'category', label: 'Kategori' },
            { key: 'currency', label: 'Para birimi' },
            { key: 'amount', label: 'Tutar', type: 'money' },
            { key: 'status', label: 'Durum' },
            { key: 'reconStatus', label: 'Mutabakat' },
            { key: 'source', label: 'Kaynak' },
          ],
          rows: rows.map((r) => ({
            date: toDateOnly(r.date),
            account: r.bankAccount ? `${r.bankAccount.bankName} • ${r.bankAccount.name}` : 'Nakit / hesapsız',
            description: r.description,
            category: r.category?.name ?? '',
            currency: r.currency,
            amount: r.amount.toFixed(2),
            status: r.status === 'REVERSED' ? 'İptal' : 'Kesin',
            reconStatus: { UNMATCHED: 'Eşleşmedi', SUGGESTED: 'Öneri var', MATCHED: 'Eşleşti', IGNORED: 'Kapsam dışı' }[r.reconStatus],
            source: SOURCE_LABEL[r.dataSource],
          })),
        };
      }

      case 'card-spending': {
        const rows = await db.financialTransaction.findMany({
          where: { sourceType: 'CARD', date: dateWhere },
          include: {
            cardAccount: { select: { name: true, last4: true, holderName: true } },
            category: { select: { name: true } },
            statement: { select: { periodEnd: true } },
            expense: { select: { status: true } },
          },
          orderBy: [{ date: 'asc' }],
          take: 20000,
        });
        return {
          ...base,
          sources: [...new Set(rows.map((r) => SOURCE_LABEL[r.dataSource]))],
          notes: ['Provizyon (bekleyen), kesinleşmiş ve iptal edilen işlemler ayrı durumlarla gösterilir.'],
          columns: [
            { key: 'date', label: 'İşlem tarihi', type: 'date' },
            { key: 'card', label: 'Kart' },
            { key: 'holder', label: 'Kart sahibi' },
            { key: 'description', label: 'İş yeri / açıklama' },
            { key: 'category', label: 'Kategori' },
            { key: 'currency', label: 'Para birimi' },
            { key: 'amount', label: 'Tutar', type: 'money' },
            { key: 'status', label: 'Durum' },
            { key: 'statement', label: 'Ekstre dönemi' },
            { key: 'expense', label: 'Gider kaydı' },
          ],
          rows: rows.map((r) => ({
            date: toDateOnly(r.date),
            card: `${r.cardAccount?.name} •••• ${r.cardAccount?.last4}`,
            holder: r.cardAccount?.holderName,
            description: r.description,
            category: r.category?.name ?? '',
            currency: r.currency,
            amount: r.amount.abs().toFixed(2),
            status: { PENDING: 'Provizyon', POSTED: 'Kesinleşti', REVERSED: 'İptal' }[r.status],
            statement: r.statement ? toDateOnly(r.statement.periodEnd) : 'Ekstreye girmedi',
            expense: r.expense ? { DRAFT: 'Taslak', SUBMITTED: 'Onay bekliyor', APPROVED: 'Onaylandı', REJECTED: 'Reddedildi' }[r.expense.status] : 'Yok',
          })),
        };
      }

      case 'expenses': {
        const rows = await db.expense.findMany({
          where: { date: dateWhere },
          include: { category: true, department: true, costCenter: true, documents: { select: { id: true } } },
          orderBy: { date: 'asc' },
          take: 20000,
        });
        const users = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.submittedById))] } }, select: { id: true, name: true } });
        return {
          ...base,
          sources: ['Tahsilo gider kayıtları'],
          notes: [],
          columns: [
            { key: 'date', label: 'Tarih', type: 'date' },
            { key: 'submittedBy', label: 'Gönderen' },
            { key: 'category', label: 'Kategori' },
            { key: 'department', label: 'Departman' },
            { key: 'costCenter', label: 'Maliyet merkezi' },
            { key: 'project', label: 'Proje' },
            { key: 'description', label: 'Açıklama' },
            { key: 'currency', label: 'Para birimi' },
            { key: 'amount', label: 'Tutar', type: 'money' },
            { key: 'status', label: 'Durum' },
            { key: 'receipt', label: 'Fiş' },
            { key: 'erp', label: 'ERP' },
          ],
          rows: rows.map((r) => ({
            date: toDateOnly(r.date),
            submittedBy: users.find((u) => u.id === r.submittedById)?.name ?? '',
            category: r.category.name,
            department: r.department?.name ?? '',
            costCenter: r.costCenter ? `${r.costCenter.code} ${r.costCenter.name}` : '',
            project: r.project ?? '',
            description: r.description,
            currency: r.currency,
            amount: r.amount.toFixed(2),
            status: { DRAFT: 'Taslak', SUBMITTED: 'Onay bekliyor', APPROVED: 'Onaylandı', REJECTED: 'Reddedildi' }[r.status],
            receipt: r.documents.length ? 'Var' : 'Yok',
            erp: r.erpRef ?? 'Aktarılmadı',
          })),
        };
      }

      case 'upcoming-payments': {
        const [planned, invoices, statements] = await Promise.all([
          db.plannedPayment.findMany({ where: { status: 'PLANNED', dueDate: dateWhere, invoiceId: null }, include: { counterparty: true } }),
          db.invoice.findMany({ where: { type: 'PURCHASE', status: { in: ['OPEN', 'PARTIAL'] }, dueDate: dateWhere }, include: { counterparty: true } }),
          db.cardStatement.findMany({ where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, dueDate: dateWhere }, include: { cardAccount: true } }),
        ]);
        const rows = [
          ...planned.map((x) => ({ dueDate: toDateOnly(x.dueDate), type: 'Planlı ödeme', title: x.title, counterparty: x.counterparty?.name ?? '', currency: x.currency, amount: x.amount.toFixed(2) })),
          ...invoices.map((x) => ({ dueDate: toDateOnly(x.dueDate), type: 'Alış faturası', title: x.number, counterparty: x.counterparty.name, currency: x.currency, amount: x.total.minus(x.paidAmount).toFixed(2) })),
          ...statements.map((x) => ({ dueDate: toDateOnly(x.dueDate), type: 'Kart ekstresi', title: `${x.cardAccount.name} •••• ${x.cardAccount.last4}`, counterparty: x.cardAccount.bankName, currency: x.currency, amount: x.totalAmount.minus(x.paidAmount).toFixed(2) })),
        ].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
        return {
          ...base,
          sources: ['Planlı ödemeler', 'ERP / manuel faturalar', 'Kart ekstreleri'],
          notes: ['Dönem, vade tarihine göre filtrelenir.'],
          columns: [
            { key: 'dueDate', label: 'Vade', type: 'date' },
            { key: 'type', label: 'Tür' },
            { key: 'title', label: 'Kalem' },
            { key: 'counterparty', label: 'Taraf' },
            { key: 'currency', label: 'Para birimi' },
            { key: 'amount', label: 'Kalan tutar', type: 'money' },
          ],
          rows,
        };
      }

      case 'collections': {
        const reqs = await db.paymentRequest.findMany({
          where: { createdAt: createdWhere },
          include: { counterparty: true, invoice: true, attempts: { include: { refunds: true } } },
          orderBy: { createdAt: 'asc' },
          take: 20000,
        });
        return {
          ...base,
          sources: ['Sanal POS sağlayıcısı'],
          notes: ['Brüt tahsilat, sağlayıcı komisyonu, iade ve net tutar ayrı sütunlardadır. Net tutarın banka hesabına geçişi Mutabakat raporunda izlenir.'],
          columns: [
            { key: 'createdAt', label: 'Oluşturma', type: 'date' },
            { key: 'description', label: 'Açıklama' },
            { key: 'customer', label: 'Müşteri' },
            { key: 'invoice', label: 'Fatura' },
            { key: 'status', label: 'Durum' },
            { key: 'attempts', label: 'Deneme', type: 'number' },
            { key: 'currency', label: 'Para birimi' },
            { key: 'gross', label: 'Brüt tahsilat', type: 'money' },
            { key: 'commission', label: 'Komisyon', type: 'money' },
            { key: 'refunded', label: 'İade', type: 'money' },
            { key: 'net', label: 'Net', type: 'money' },
            { key: 'erp', label: 'ERP' },
          ],
          rows: reqs.map((r) => {
            const ok = r.attempts.find((a) => a.status === 'SUCCEEDED');
            const gross = ok?.amount ?? D(0);
            const commission = ok?.commission ?? D(0);
            const refunded = (ok?.refunds ?? []).filter((x) => x.status === 'SUCCEEDED').reduce((s, x) => s.plus(x.amount), D(0));
            return {
              createdAt: toDateOnly(r.createdAt),
              description: r.description,
              customer: r.counterparty?.name ?? '',
              invoice: r.invoice?.number ?? '',
              status: { PENDING: 'Bekliyor', PAID: 'Ödendi', FAILED: 'Başarısız', EXPIRED: 'Süresi doldu', CANCELLED: 'İptal', REFUNDED: 'İade edildi', PARTIALLY_REFUNDED: 'Kısmi iade' }[r.status],
              attempts: r.attempts.length,
              currency: r.currency,
              gross: gross.toFixed(2),
              commission: commission.toFixed(2),
              refunded: refunded.toFixed(2),
              net: gross.minus(commission).minus(refunded).toFixed(2),
              erp: r.erpRef ?? '',
            };
          }),
        };
      }

      case 'reconciliation': {
        const rows = await db.financialTransaction.findMany({
          where: { sourceType: 'BANK', date: dateWhere, status: { not: 'REVERSED' } },
          include: {
            bankAccount: { select: { name: true } },
            matches: { where: { status: 'CONFIRMED' }, include: { invoice: { select: { number: true } }, plannedPayment: { select: { title: true } }, attempt: { select: { providerPaymentId: true } } } },
          },
          orderBy: { date: 'asc' },
          take: 20000,
        });
        return {
          ...base,
          sources: ['Banka hareketleri', 'Sanal POS', 'Faturalar', 'Planlı ödemeler'],
          notes: [],
          columns: [
            { key: 'date', label: 'Tarih', type: 'date' },
            { key: 'account', label: 'Hesap' },
            { key: 'description', label: 'Açıklama' },
            { key: 'currency', label: 'Para birimi' },
            { key: 'amount', label: 'Tutar', type: 'money' },
            { key: 'status', label: 'Mutabakat' },
            { key: 'matchedWith', label: 'Eşleşen kayıt' },
            { key: 'difference', label: 'Fark', type: 'money' },
          ],
          rows: rows.map((r) => ({
            date: toDateOnly(r.date),
            account: r.bankAccount?.name ?? '',
            description: r.description,
            currency: r.currency,
            amount: r.amount.toFixed(2),
            status: { UNMATCHED: 'Eşleşmedi', SUGGESTED: 'Öneri var', MATCHED: 'Eşleşti', IGNORED: 'Kapsam dışı' }[r.reconStatus],
            matchedWith: r.matches
              .map((m) => m.invoice?.number ?? m.plannedPayment?.title ?? (m.attempt ? `POS ${m.attempt.providerPaymentId}` : m.type))
              .join(', '),
            difference: r.matches.reduce((s, m) => s.plus(m.difference), D(0)).toFixed(2),
          })),
        };
      }
    }
    throw new BadRequestException('Bilinmeyen rapor');
  }

  toCsv(r: Report, tenantName: string): Buffer {
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const fmt = (c: ReportColumn, v: unknown) => (c.type === 'money' || c.type === 'percent' ? String(v ?? '').replace('.', ',') : v);
    const lines = [
      [`${tenantName} — ${r.title}`],
      [`Dönem: ${r.period.from} – ${r.period.to}`],
      [`Veri kaynakları: ${r.sources.join(', ')}`],
      ...r.notes.map((n) => [`Not: ${n}`]),
      [],
      r.columns.map((c) => c.label),
      ...r.rows.map((row) => r.columns.map((c) => fmt(c, row[c.key]))),
    ];
    // Türkçe Excel için noktalı virgül ayraç ve UTF-8 BOM
    return Buffer.from('﻿' + lines.map((l) => l.map(esc).join(';')).join('\r\n'), 'utf8');
  }

  async toXlsx(r: Report, tenantName: string): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Tahsilo';
    const ws = wb.addWorksheet(r.title.slice(0, 31));
    ws.addRow([`${tenantName} — ${r.title}`]).font = { bold: true, size: 13 };
    ws.addRow([`Dönem: ${r.period.from} – ${r.period.to}`]);
    ws.addRow([`Veri kaynakları: ${r.sources.join(', ')}`]);
    for (const n of r.notes) ws.addRow([`Not: ${n}`]).font = { italic: true, color: { argb: 'FF64748B' } };
    ws.addRow([]);
    const header = ws.addRow(r.columns.map((c) => c.label));
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.eachCell((cell) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14233B' } }));
    for (const row of r.rows) {
      ws.addRow(
        r.columns.map((c) => {
          const v = row[c.key];
          if (c.type === 'money' || c.type === 'percent' || c.type === 'number') return v === '' || v === null || v === undefined ? null : Number(v);
          if (c.type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00Z`);
          return v as any;
        }),
      );
    }
    r.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.type === 'money' ? 16 : c.key === 'description' ? 48 : 18;
      if (c.type === 'money') col.numFmt = '#,##0.00';
      if (c.type === 'date') col.numFmt = 'dd.mm.yyyy';
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}

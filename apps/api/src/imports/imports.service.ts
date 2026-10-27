import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { parseDateOnly } from '../common/money';
import { RequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { StorageService } from '../storage/storage.service';
import { ColumnMapping, guessMapping, mapRows, normalizeText, ParsedRow, readTable } from './parse';

export interface ImportTarget {
  bankAccountId?: string;
  cardAccountId?: string;
}

const MAX_ROWS = 20_000;

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly recon: ReconciliationService,
  ) {}

  async preview(file: Express.Multer.File) {
    const table = await this.read(file);
    const fileHash = CryptoService.sha256(file.buffer);
    const previous = await this.prisma.db.importBatch.findMany({
      where: { fileHash },
      select: { id: true, createdAt: true, fileName: true, importedCount: true },
      orderBy: { createdAt: 'desc' },
    });
    const mapping = guessMapping(table);
    const sample = mapRows({ headers: table.headers, rows: table.rows.slice(0, 51) }, mapping);
    return {
      fileName: file.originalname,
      fileHash,
      kind: table.kind,
      headers: table.headers,
      rows: table.rows.slice(0, 21),
      totalRows: table.rows.length,
      suggestedMapping: mapping,
      sample: sample.rows.slice(0, 10),
      sampleErrors: sample.errors.slice(0, 10),
      previouslyImported: previous,
    };
  }

  async commit(file: Express.Multer.File, target: ImportTarget, mapping: ColumnMapping) {
    const tenantId = RequestContext.tenantId();
    const userId = RequestContext.userId();
    if (!!target.bankAccountId === !!target.cardAccountId) {
      throw new BadRequestException('Bir banka hesabı veya bir kart seçilmeli');
    }
    const account = target.bankAccountId
      ? await this.prisma.db.bankAccount.findFirst({ where: { id: target.bankAccountId } })
      : await this.prisma.db.cardAccount.findFirst({ where: { id: target.cardAccountId } });
    if (!account) throw new BadRequestException('Hesap bulunamadı');
    if ('connectionId' in account && account.connectionId) {
      throw new BadRequestException('Bu hesap bankaya bağlı; hareketler bağlantıdan alınır');
    }

    const table = await this.read(file);
    const { rows, errors } = mapRows(table, mapping);
    if (!rows.length) throw new BadRequestException({ message: 'Aktarılabilecek geçerli satır bulunamadı', errors: errors.slice(0, 20) });

    const fileHash = CryptoService.sha256(file.buffer);
    const accountKey = target.bankAccountId ? `bank:${target.bankAccountId}` : `card:${target.cardAccountId}`;
    const keyed = withDedupeKeys(accountKey, rows);

    const storageKey = await this.storage.put(tenantId, file.buffer);
    const isCard = !!target.cardAccountId;

    const result = await this.prisma.db.$transaction(
      async (tx) => {
        const existing = await tx.financialTransaction.findMany({
          where: { dedupeKey: { in: keyed.map((k) => k.key) } },
          select: { dedupeKey: true },
        });
        const existingKeys = new Set(existing.map((e) => e.dedupeKey));
        const fresh = keyed.filter((k) => !existingKeys.has(k.key));

        const document = await tx.document.create({
          data: {
            tenantId,
            kind: 'STATEMENT',
            fileName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            sha256: fileHash,
            storageKey,
            uploadedById: userId,
          },
        });

        const batch = await tx.importBatch.create({
          data: {
            tenantId,
            fileName: file.originalname,
            fileHash,
            documentId: document.id,
            bankAccountId: target.bankAccountId,
            cardAccountId: target.cardAccountId,
            rowCount: rows.length + errors.length,
            importedCount: 0,
            duplicateCount: 0,
            errorCount: errors.length,
            errors: errors.slice(0, 200) as unknown as Prisma.InputJsonValue,
            mapping: mapping as unknown as Prisma.InputJsonValue,
            status: 'COMPLETED',
            createdById: userId,
          },
        });

        const inserted = await tx.financialTransaction.createManyAndReturn({
          data: fresh.map(({ row, key }) => ({
            tenantId,
            sourceType: isCard ? 'CARD' : 'BANK',
            dataSource: 'IMPORTED',
            sourceRef: row.reference,
            dedupeKey: key,
            bankAccountId: target.bankAccountId,
            cardAccountId: target.cardAccountId,
            importBatchId: batch.id,
            branchId: account.branchId,
            date: parseDateOnly(row.date),
            description: row.description,
            counterpartyName: row.counterparty,
            amount: row.amount,
            currency: account.currency,
            status: row.pending ? 'PENDING' : 'POSTED',
            createdById: userId,
          })),
          skipDuplicates: true,
          select: { id: true, amount: true, date: true, status: true },
        });

        await tx.importBatch.update({
          where: { id: batch.id },
          data: { importedCount: inserted.length, duplicateCount: rows.length - inserted.length },
        });

        // Kesinleşen kart işlemi gelince aynı tutarlı eski provizyon kaydı ters kayda alınır;
        // böylece provizyon ve kesinleşmiş hal iki ayrı harcama gibi görünmez.
        let supersededPending = 0;
        if (isCard) {
          for (const t of inserted.filter((i) => i.status === 'POSTED')) {
            const from = new Date(t.date.getTime() - 7 * 86400000);
            const pending = await tx.financialTransaction.findFirst({
              where: {
                cardAccountId: target.cardAccountId,
                status: 'PENDING',
                amount: t.amount,
                date: { gte: from, lte: t.date },
                id: { notIn: inserted.map((i) => i.id) },
              },
              orderBy: { date: 'asc' },
            });
            if (pending) {
              await tx.financialTransaction.update({
                where: { id: pending.id },
                data: { status: 'REVERSED', note: `Kesinleşen işlemle değiştirildi (${t.id})` },
              });
              supersededPending++;
            }
          }
        }

        // Dosyadaki bakiye sütunu varsa hesabın bakiyesi en güncel satırdan güncellenir.
        if (target.bankAccountId) {
          const withBalance = rows.filter((r) => r.balance !== undefined);
          if (withBalance.length) {
            const latest = withBalance.reduce((a, b) => (b.date >= a.date ? b : a));
            const asOf = parseDateOnly(latest.date);
            const acc = account as { balanceAsOf: Date | null };
            if (!acc.balanceAsOf || acc.balanceAsOf <= asOf) {
              await tx.bankAccount.update({
                where: { id: target.bankAccountId },
                data: { balance: latest.balance, balanceAsOf: asOf, balanceSource: 'IMPORTED' },
              });
            }
          }
        }

        return {
          batch: { ...batch, importedCount: inserted.length, duplicateCount: rows.length - inserted.length },
          insertedIds: inserted.map((i) => i.id),
          supersededPending,
        };
      },
      { timeout: 60_000 },
    );

    await this.audit.log('import.commit', 'ImportBatch', result.batch.id, {
      after: {
        fileName: file.originalname,
        target,
        imported: result.batch.importedCount,
        duplicates: result.batch.duplicateCount,
        errors: errors.length,
      },
    });

    if (result.insertedIds.length) await this.recon.suggestForTransactions(result.insertedIds);

    return {
      batchId: result.batch.id,
      rowCount: result.batch.rowCount,
      imported: result.batch.importedCount,
      duplicates: result.batch.duplicateCount,
      errors: errors.slice(0, 50),
      errorCount: errors.length,
      supersededPending: result.supersededPending,
    };
  }

  list(params: ImportTarget) {
    return this.prisma.db.importBatch.findMany({
      where: { ...params },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        bankAccount: { select: { id: true, name: true, bankName: true } },
        cardAccount: { select: { id: true, name: true, last4: true } },
      },
    });
  }

  private async read(file?: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('Dosya yüklenmedi');
    try {
      const table = await readTable(file.originalname, file.buffer);
      if (table.rows.length > MAX_ROWS) throw new Error(`Bir dosyada en fazla ${MAX_ROWS} satır aktarılabilir`);
      if (!table.rows.length) throw new Error('Dosya boş');
      return table;
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }
}

/**
 * Mükerrerlik anahtarı. Kaynak referansı varsa doğrudan o kullanılır. Yoksa tarih + tutar +
 * açıklama ve dosya içindeki tekrar sırası kullanılır: aynı gün aynı tutarlı iki gerçek işlem
 * ayrı kalır, aynı dosyanın tekrar yüklenmesi ise aynı anahtarları üretir.
 */
export function withDedupeKeys(accountKey: string, rows: ParsedRow[]) {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    if (row.reference) {
      return { row, key: CryptoService.sha256(`${accountKey}|ref|${row.reference}`) };
    }
    const base = `${accountKey}|${row.date}|${row.amount}|${normalizeText(row.description)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { row, key: CryptoService.sha256(`${base}|#${n}`) };
  });
}

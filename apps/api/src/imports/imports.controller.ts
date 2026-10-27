import { BadRequestException, Body, Controller, Get, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequirePerms } from '../common/decorators';
import { ImportsService } from './imports.service';
import { ColumnMapping } from './parse';

const upload = FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } });

@Controller('statements')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  /** Dosyayı okur, sütun eşlemesini tahmin eder ve önizleme döndürür; kayıt oluşturmaz. */
  @RequirePerms('import.create')
  @Post('import/preview')
  @UseInterceptors(upload)
  preview(@UploadedFile() file: Express.Multer.File) {
    return this.imports.preview(file);
  }

  @RequirePerms('import.create')
  @Post('import')
  @UseInterceptors(upload)
  commit(
    @UploadedFile() file: Express.Multer.File,
    @Body('mapping') mappingRaw: string,
    @Body('bankAccountId') bankAccountId?: string,
    @Body('cardAccountId') cardAccountId?: string,
  ) {
    let mapping: ColumnMapping;
    try {
      mapping = JSON.parse(mappingRaw);
    } catch {
      throw new BadRequestException('Sütun eşlemesi geçersiz');
    }
    if (typeof mapping?.date !== 'number' || typeof mapping?.description !== 'number') {
      throw new BadRequestException('Tarih ve açıklama sütunları seçilmeli');
    }
    const hasAmount = typeof mapping.amount === 'number' && mapping.amount >= 0;
    const hasDebitCredit = typeof mapping.debit === 'number' || typeof mapping.credit === 'number';
    if (!hasAmount && !hasDebitCredit) throw new BadRequestException('Tutar veya borç/alacak sütunu seçilmeli');
    return this.imports.commit(file, { bankAccountId: bankAccountId || undefined, cardAccountId: cardAccountId || undefined }, mapping);
  }

  @RequirePerms('bank.view', 'card.view_all')
  @Get('imports')
  list(@Query('bankAccountId') bankAccountId?: string, @Query('cardAccountId') cardAccountId?: string) {
    return this.imports.list({ bankAccountId: bankAccountId || undefined, cardAccountId: cardAccountId || undefined });
  }
}

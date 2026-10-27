import { BadRequestException, Body, Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentKind } from '@prisma/client';
import type { Response } from 'express';
import { AuthUser, CurrentUser, RequirePerms } from '../common/decorators';
import { assertOwned } from '../common/owned';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentsService } from './documents.service';

@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Fatura veya hareket kaydına belge (fatura PDF'i, dekont vb.) ekler. */
  @RequirePerms('invoice.manage', 'txn.edit')
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('kind') kind: DocumentKind,
    @Body('invoiceId') invoiceId?: string,
    @Body('transactionId') transactionId?: string,
  ) {
    if (!invoiceId && !transactionId) throw new BadRequestException('Belge bir faturaya veya harekete bağlanmalı');
    if (!Object.values(DocumentKind).includes(kind)) throw new BadRequestException('Geçersiz belge türü');
    await assertOwned(this.prisma.db, 'invoice', invoiceId, 'Fatura');
    await assertOwned(this.prisma.db, 'financialTransaction', transactionId, 'Hareket');
    return this.documents.store(file, { kind, invoiceId: invoiceId || undefined, transactionId: transactionId || undefined });
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const { doc, content } = await this.documents.open(id, user);
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(content);
  }
}

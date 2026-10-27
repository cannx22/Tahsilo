import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentKind } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { AuthUser } from '../common/decorators';
import { hasPermission } from '../common/permissions';
import { RequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/xml',
  'text/xml',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async store(
    file: Express.Multer.File | undefined,
    link: { kind: DocumentKind; expenseId?: string; invoiceId?: string; transactionId?: string },
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Dosya yüklenmedi');
    if (!ALLOWED_MIME.has(file.mimetype)) throw new BadRequestException('Desteklenen biçimler: PDF, JPG, PNG, WEBP, HEIC, XML, CSV, XLSX');
    const tenantId = RequestContext.tenantId();
    const storageKey = await this.storage.put(tenantId, file.buffer);
    const doc = await this.prisma.db.document.create({
      data: {
        tenantId,
        kind: link.kind,
        fileName: file.originalname.slice(0, 200),
        mimeType: file.mimetype,
        size: file.size,
        sha256: CryptoService.sha256(file.buffer),
        storageKey,
        uploadedById: RequestContext.userId(),
        expenseId: link.expenseId,
        invoiceId: link.invoiceId,
        transactionId: link.transactionId,
      },
      select: { id: true, fileName: true, kind: true, size: true, mimeType: true, createdAt: true },
    });
    await this.audit.log('document.upload', 'Document', doc.id, { after: { ...doc, ...link } });
    return doc;
  }

  /** Belgeye bağlı kayda erişimi olmayan kullanıcı belgeyi indiremez. */
  async open(id: string, user: AuthUser) {
    const doc = await this.prisma.db.document.findFirst({ where: { id }, include: { expense: true } });
    if (!doc) throw new NotFoundException('Belge bulunamadı');

    let allowed = false;
    if (doc.expense) {
      allowed =
        hasPermission(user.role, 'expense.view_all') ||
        doc.expense.submittedById === user.id ||
        (hasPermission(user.role, 'expense.view_team') && !!user.departmentId && doc.expense.departmentId === user.departmentId);
    } else if (doc.invoiceId) {
      allowed = hasPermission(user.role, 'invoice.view');
    } else if (doc.transactionId) {
      allowed = hasPermission(user.role, 'txn.view');
    } else {
      allowed = hasPermission(user.role, 'import.create') || hasPermission(user.role, 'audit.view');
    }
    if (!allowed) throw new ForbiddenException('Bu belgeye erişim yetkiniz yok');

    const content = await this.storage.get(RequestContext.tenantId(), doc.storageKey);
    await this.audit.log('document.download', 'Document', doc.id);
    return { doc, content };
  }
}

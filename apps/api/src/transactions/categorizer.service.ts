import { Injectable } from '@nestjs/common';
import type { ExpenseCategory } from '@prisma/client';
import { normalizeText } from '../imports/parse';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Açıklamaya göre kategori önerisi üretir. Öneri otomatik olarak kaydedilmez;
 * kullanıcı doğrulayana kadar hareket kategorisiz kalır.
 */
@Injectable()
export class CategorizerService {
  constructor(private readonly prisma: PrismaService) {}

  async loader() {
    const categories = await this.prisma.db.expenseCategory.findMany({ where: { isActive: true } });
    return (description: string) => suggest(categories, description);
  }
}

export function suggest(categories: ExpenseCategory[], description: string) {
  const text = ` ${normalizeText(description)} `;
  let best: { category: ExpenseCategory; len: number } | null = null;
  for (const c of categories) {
    for (const kw of c.keywords) {
      const k = normalizeText(kw);
      if (k && text.includes(k) && (!best || k.length > best.len)) best = { category: c, len: k.length };
    }
  }
  return best ? { id: best.category.id, name: best.category.name } : null;
}

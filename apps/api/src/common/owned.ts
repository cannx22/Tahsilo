import { BadRequestException } from '@nestjs/common';

/**
 * İstemciden gelen yabancı anahtarın aktif tenant'a ait olduğunu doğrular.
 * Kapsamlı istemci (prisma.db) ile çağrıldığında sorgu otomatik olarak tenant'a sınırlıdır.
 */
export async function assertOwned(db: any, model: string, id: string | null | undefined, label = 'Kayıt') {
  if (!id) return;
  const found = await db[model].findFirst({ where: { id }, select: { id: true } });
  if (!found) throw new BadRequestException(`${label} bulunamadı`);
}

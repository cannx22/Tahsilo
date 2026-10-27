import { BadRequestException } from '@nestjs/common';
import { parseDateOnly } from './money';

export interface Period {
  from: Date;
  to: Date;
}

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD; verilmezse içinde bulunulan ay. */
export function resolvePeriod(from?: string, to?: string): Period {
  const now = new Date();
  try {
    const f = from ? parseDateOnly(from) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const t = to ? parseDateOnly(to) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    if (f > t) throw new Error('Başlangıç bitişten sonra olamaz');
    return { from: f, to: t };
  } catch (e) {
    throw new BadRequestException((e as Error).message);
  }
}

export function pageArgs(page?: string | number, pageSize?: string | number) {
  const p = Math.max(1, Number(page) || 1);
  const s = Math.min(200, Math.max(1, Number(pageSize) || 50));
  return { skip: (p - 1) * s, take: s, page: p, pageSize: s };
}

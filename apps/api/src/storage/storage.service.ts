import { Injectable, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { CryptoService } from '../common/crypto.service';

/**
 * Şifreli dosya deposu. Dosyalar tenant klasörlerinde AES-256-GCM ile şifreli tutulur.
 * Üretimde aynı arayüzle S3 uyumlu obje depolamaya geçilebilir.
 */
@Injectable()
export class StorageService {
  private readonly root = path.resolve(process.env.STORAGE_DIR ?? './storage');

  constructor(private readonly crypto: CryptoService) {}

  async put(tenantId: string, content: Buffer): Promise<string> {
    const key = `${tenantId}/${new Date().toISOString().slice(0, 7)}/${CryptoService.token(18)}.bin`;
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, this.crypto.encrypt(content));
    return key;
  }

  async get(tenantId: string, key: string): Promise<Buffer> {
    // Anahtar başka bir tenant'ın klasörünü gösteriyorsa erişim reddedilir.
    if (!key.startsWith(`${tenantId}/`)) throw new NotFoundException('Dosya bulunamadı');
    try {
      return this.crypto.decrypt(await fs.readFile(this.resolve(key)));
    } catch {
      throw new NotFoundException('Dosya bulunamadı');
    }
  }

  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new NotFoundException('Geçersiz dosya yolu');
    return full;
  }
}

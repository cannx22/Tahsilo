import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** AES-256-GCM ile sır ve dosya şifreleme. Biçim: [12B iv][16B tag][şifreli veri] */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor() {
    this.key = CryptoService.deriveKey(process.env.ENCRYPTION_KEY);
  }

  /**
   * 32 baytlık base64 anahtar doğrudan kullanılır. Coolify gibi platformların ürettiği
   * en az 32 karakterlik rastgele parolalar SHA-256 ile 32 bayta indirgenir.
   */
  static deriveKey(raw: string | undefined): Buffer {
    if (!raw) throw new Error('ENCRYPTION_KEY tanımlı değil');
    if (/^[A-Za-z0-9+/]{43}=$/.test(raw)) return Buffer.from(raw, 'base64');
    if (raw.length < 32) throw new Error('ENCRYPTION_KEY en az 32 karakter (veya 32 bayt base64) olmalı');
    return createHash('sha256').update(raw, 'utf8').digest();
  }

  encrypt(data: Buffer): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), enc]);
  }

  decrypt(blob: Buffer): Buffer {
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
  }

  encryptJson(value: unknown): string {
    return this.encrypt(Buffer.from(JSON.stringify(value), 'utf8')).toString('base64');
  }

  decryptJson<T = any>(value: string): T {
    return JSON.parse(this.decrypt(Buffer.from(value, 'base64')).toString('utf8'));
  }

  static sha256(data: Buffer | string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  static token(bytes = 24): string {
    return randomBytes(bytes).toString('base64url');
  }
}

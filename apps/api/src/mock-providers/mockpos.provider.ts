import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * Harici bir sanal POS sağlayıcısını taklit eden sandbox. Tahsilo'nun parçası değildir;
 * gerçek sağlayıcı geldiğinde yalnızca adaptör değişir. Durum dosyada tutulur (yeniden başlatmaya dayanıklı).
 */
export interface MockSession {
  id: string;
  merchantId: string;
  orderId: string;
  amount: string;
  currency: string;
  description: string;
  callbackUrl: string;
  webhookUrl: string;
  status: 'PENDING' | 'AWAITING_3DS' | 'SUCCEEDED' | 'FAILED';
  paymentId?: string;
  cardLast4?: string;
  cardBrand?: string;
  threeDSecure: boolean;
  errorCode?: string;
  errorMessage?: string;
  refunded: string;
  createdAt: string;
}

export const MOCKPOS_TEST_CARDS = [
  { number: '4111 1111 1111 1111', result: 'Başarılı ödeme' },
  { number: '4000 0000 0000 3220', result: '3D Secure doğrulaması ister (kod: 123456)' },
  { number: '4000 0000 0000 0002', result: 'Reddedilir: yetersiz bakiye' },
];

function luhn(num: string) {
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = Number(num[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

@Injectable()
export class MockPosProvider {
  private readonly logger = new Logger('MockPOS');
  private readonly dir = path.resolve(process.env.STORAGE_DIR ?? './storage', '_mockpos');

  get secret() {
    return process.env.MOCKPOS_WEBHOOK_SECRET ?? 'mockpos-dev-secret';
  }

  sign(body: string) {
    return createHmac('sha256', this.secret).update(body).digest('hex');
  }

  verify(signature: string | undefined, rawBody: Buffer) {
    if (!signature) return false;
    const expected = Buffer.from(createHmac('sha256', this.secret).update(rawBody).digest('hex'));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  async createSession(input: Omit<MockSession, 'id' | 'status' | 'threeDSecure' | 'refunded' | 'createdAt'>) {
    const session: MockSession = {
      ...input,
      id: `mps_${randomBytes(12).toString('hex')}`,
      status: 'PENDING',
      threeDSecure: false,
      refunded: '0.00',
      createdAt: new Date().toISOString(),
    };
    await this.save(session);
    return session;
  }

  async get(id: string): Promise<MockSession> {
    if (!/^mps_[a-f0-9]{24}$/.test(id)) throw new NotFoundException('Oturum bulunamadı');
    try {
      return JSON.parse(await fs.readFile(path.join(this.dir, `${id}.json`), 'utf8'));
    } catch {
      throw new NotFoundException('Oturum bulunamadı');
    }
  }

  async save(s: MockSession) {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(path.join(this.dir, `${s.id}.json`), JSON.stringify(s, null, 2));
  }

  /** Kart formunu işler. Dönüş: '3ds' (doğrulama gerekli) veya 'done'. */
  async submitCard(id: string, form: { cardNumber?: string; expiry?: string; cvc?: string; holder?: string }) {
    const s = await this.get(id);
    if (s.status !== 'PENDING') return 'done' as const;
    const number = (form.cardNumber ?? '').replace(/\D/g, '');
    const expiryOk = /^(0[1-9]|1[0-2])\/?\d{2}$/.test((form.expiry ?? '').trim());
    if (number.length < 13 || !luhn(number) || !expiryOk || !/^\d{3,4}$/.test(form.cvc ?? '')) {
      return { error: 'Kart bilgileri geçersiz' };
    }
    s.cardLast4 = number.slice(-4);
    s.cardBrand = number.startsWith('4') ? 'VISA' : number.startsWith('5') ? 'MASTERCARD' : 'KART';
    if (number === '4000000000003220') {
      s.status = 'AWAITING_3DS';
      s.threeDSecure = true;
      await this.save(s);
      return '3ds' as const;
    }
    if (number === '4000000000000002') {
      await this.finish(s, false, 'INSUFFICIENT_FUNDS', 'Yetersiz bakiye');
    } else {
      await this.finish(s, true);
    }
    return 'done' as const;
  }

  async submit3ds(id: string, code: string) {
    const s = await this.get(id);
    if (s.status !== 'AWAITING_3DS') return;
    if (code.trim() === '123456') await this.finish(s, true);
    else await this.finish(s, false, '3DS_FAILED', '3D Secure doğrulaması başarısız');
  }

  async refund(paymentId: string, amount: string) {
    const files = await fs.readdir(this.dir).catch(() => []);
    for (const f of files) {
      const s: MockSession = JSON.parse(await fs.readFile(path.join(this.dir, f), 'utf8'));
      if (s.paymentId !== paymentId) continue;
      const refundable = Number(s.amount) - Number(s.refunded);
      if (s.status !== 'SUCCEEDED' || Number(amount) > refundable + 1e-9) {
        return { ok: false, refundId: '', error: `İade edilebilir tutar: ${refundable.toFixed(2)}` };
      }
      s.refunded = (Number(s.refunded) + Number(amount)).toFixed(2);
      await this.save(s);
      return { ok: true, refundId: `mpr_${randomBytes(10).toString('hex')}` };
    }
    return { ok: false, refundId: '', error: 'Ödeme bulunamadı' };
  }

  private async finish(s: MockSession, ok: boolean, errorCode?: string, errorMessage?: string) {
    s.status = ok ? 'SUCCEEDED' : 'FAILED';
    s.paymentId = `mpp_${randomBytes(10).toString('hex')}`;
    s.errorCode = errorCode;
    s.errorMessage = errorMessage;
    await this.save(s);
    // Gerçek sağlayıcılar gibi "en az bir kez" teslim: aynı olay bilerek iki kez gönderilir.
    const event = { id: `evt_${randomBytes(10).toString('hex')}`, type: ok ? 'payment.succeeded' : 'payment.failed', sessionId: s.id };
    setTimeout(() => this.deliver(s.webhookUrl, event), 300);
    setTimeout(() => this.deliver(s.webhookUrl, event), 1500);
  }

  private async deliver(url: string, event: object) {
    const body = JSON.stringify(event);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-MockPos-Signature': this.sign(body) },
        body,
      });
      this.logger.log(`Webhook teslim edildi (${res.status}): ${url}`);
    } catch (e) {
      this.logger.warn(`Webhook teslim edilemedi: ${(e as Error).message}`);
    }
  }
}

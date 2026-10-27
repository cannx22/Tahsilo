import { Injectable } from '@nestjs/common';
import { MockPosProvider } from '../mock-providers/mockpos.provider';
import { PosAdapter, PosCheckoutInput, PosPaymentResult, PosWebhook } from './pos-adapter';

@Injectable()
export class MockPosAdapter implements PosAdapter {
  readonly provider = 'mockpos';
  readonly displayName = 'MockPOS (sandbox)';

  constructor(private readonly mock: MockPosProvider) {}

  async createCheckout(input: PosCheckoutInput) {
    const session = await this.mock.createSession({
      merchantId: input.config.merchantId ?? 'sandbox',
      orderId: input.orderId,
      amount: input.amount,
      currency: input.currency,
      description: input.description,
      callbackUrl: input.callbackUrl,
      webhookUrl: input.webhookUrl,
    });
    const base = process.env.API_URL ?? 'http://localhost:4000';
    return { sessionId: session.id, redirectUrl: `${base}/api/v1/mock-provider/pos/checkout/${session.id}` };
  }

  async getPayment(_config: Record<string, string>, sessionId: string): Promise<PosPaymentResult> {
    const s = await this.mock.get(sessionId);
    return {
      status: s.status === 'SUCCEEDED' ? 'SUCCEEDED' : s.status === 'FAILED' ? 'FAILED' : 'PENDING',
      paymentId: s.paymentId,
      amount: s.amount,
      currency: s.currency,
      cardLast4: s.cardLast4,
      cardBrand: s.cardBrand,
      threeDSecure: s.threeDSecure,
      errorCode: s.errorCode,
      errorMessage: s.errorMessage,
    };
  }

  refund(_config: Record<string, string>, paymentId: string, amount: string) {
    return this.mock.refund(paymentId, amount);
  }

  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer) {
    const sig = headers['x-mockpos-signature'];
    return this.mock.verify(Array.isArray(sig) ? sig[0] : sig, rawBody);
  }

  parseWebhook(body: any): PosWebhook {
    return { eventId: String(body?.id ?? ''), type: String(body?.type ?? ''), sessionId: String(body?.sessionId ?? '') };
  }
}

/**
 * Sanal POS / ödeme sağlayıcısı adaptör arayüzü. Her gerçek sağlayıcı (iyzico, PayTR, banka sanal POS'ları vb.)
 * bu arayüzü uygular. Kart verisi Tahsilo'ya hiç gelmez: ödeme sağlayıcının barındırdığı sayfada alınır.
 */
export interface PosCheckoutInput {
  config: Record<string, string>;
  orderId: string;
  amount: string;
  currency: string;
  description: string;
  callbackUrl: string;
  webhookUrl: string;
}

export interface PosPaymentResult {
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  paymentId?: string;
  amount: string;
  currency: string;
  cardLast4?: string;
  cardBrand?: string;
  threeDSecure: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface PosWebhook {
  eventId: string;
  type: string;
  sessionId: string;
}

export interface PosAdapter {
  readonly provider: string;
  readonly displayName: string;
  createCheckout(input: PosCheckoutInput): Promise<{ sessionId: string; redirectUrl: string }>;
  /** Ödeme sonucunu sağlayıcıdan sorgular; webhook içeriğine tek başına güvenilmez. */
  getPayment(config: Record<string, string>, sessionId: string): Promise<PosPaymentResult>;
  refund(config: Record<string, string>, paymentId: string, amount: string): Promise<{ refundId: string; ok: boolean; error?: string }>;
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): boolean;
  parseWebhook(body: any): PosWebhook;
}

export const POS_ADAPTERS = Symbol('POS_ADAPTERS');

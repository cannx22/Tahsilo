/**
 * Banka / açık bankacılık adaptör arayüzü. Her banka veya açık bankacılık sağlayıcısı bunu uygular.
 * Tahsilo yalnızca okuma izni ister: hesap, bakiye ve hareket. Para transferi bu arayüzde yoktur.
 */
export interface BankApiAccount {
  externalId: string;
  name: string;
  iban?: string;
  currency: string;
}

export interface BankApiTransaction {
  externalId: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: string; // işaretli
  currency: string;
  counterparty?: string;
  status: 'BOOKED' | 'PENDING';
}

export type BankErrorCode = 'CONSENT_EXPIRED' | 'PERMANENT' | 'TRANSIENT';

export class BankApiError extends Error {
  constructor(
    message: string,
    readonly code: BankErrorCode,
  ) {
    super(message);
  }

  /** İş kuyruğu bu alanla kalıcı/geçici hatayı ayırt eder */
  get permanent() {
    return this.code !== 'TRANSIENT';
  }
}

export interface BankAdapter {
  readonly provider: string;
  readonly displayName: string;
  readonly bankName: string;
  authorizeUrl(input: { state: string; redirectUri: string }): string;
  exchangeCode(code: string): Promise<{ accessToken: string; expiresAt: Date }>;
  listAccounts(token: string): Promise<BankApiAccount[]>;
  getBalance(token: string, externalId: string): Promise<{ balance: string; asOf: Date }>;
  listTransactions(token: string, externalId: string, from: string): Promise<BankApiTransaction[]>;
}

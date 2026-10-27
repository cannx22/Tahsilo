/**
 * ERP adaptör arayüzü. Logo, Mikro, Netsis, SAP vb. her ERP bu arayüzü uygular.
 * Veri yönü: cari ve fatura ERP → Tahsilo; tahsilat sonucu ve gider Tahsilo → ERP.
 */
export interface ErpCounterparty {
  erpRef: string;
  code: string;
  name: string;
  type: 'CUSTOMER' | 'SUPPLIER' | 'BOTH';
  taxNumber?: string;
  email?: string;
  phone?: string;
}

export interface ErpInvoice {
  erpRef: string;
  number: string;
  type: 'SALES' | 'PURCHASE';
  counterpartyErpRef: string;
  issueDate: string;
  dueDate: string;
  total: string;
  paidAmount: string;
  currency: string;
  cancelled: boolean;
}

export interface ErpPaymentPush {
  /** Tahsilo tarafındaki benzersiz kimlik; ERP bunu idempotency anahtarı olarak kullanır. */
  externalId: string;
  invoiceErpRef?: string;
  counterpartyErpRef?: string;
  amount: string;
  currency: string;
  date: string;
  reference: string;
}

export interface ErpExpensePush {
  externalId: string;
  date: string;
  amount: string;
  currency: string;
  accountCode?: string;
  costCenterCode?: string;
  description: string;
}

export class ErpError extends Error {
  /** true: tekrar denemek anlamsız (yetki, yapılandırma hatası); false: geçici (ağ, zaman aşımı). */
  constructor(
    message: string,
    readonly permanent = false,
  ) {
    super(message);
  }
}

export interface ErpAdapter {
  readonly provider: string;
  readonly displayName: string;
  testConnection(config: Record<string, string>): Promise<void>;
  listCounterparties(config: Record<string, string>): Promise<ErpCounterparty[]>;
  listInvoices(config: Record<string, string>): Promise<ErpInvoice[]>;
  pushPayment(config: Record<string, string>, payment: ErpPaymentPush): Promise<{ erpRef: string }>;
  pushExpense(config: Record<string, string>, expense: ErpExpensePush): Promise<{ erpRef: string }>;
}

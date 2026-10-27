import { Injectable } from '@nestjs/common';
import { MockBankProvider } from '../mock-providers/mockbank.provider';
import { BankAdapter } from './bank-adapter';

@Injectable()
export class MockBankAdapter implements BankAdapter {
  readonly provider = 'mockbank';
  readonly displayName = 'Örnek Bankası (sandbox açık bankacılık)';
  readonly bankName = 'Örnek Bankası';

  constructor(private readonly bank: MockBankProvider) {}

  authorizeUrl(input: { state: string; redirectUri: string }) {
    const base = process.env.API_URL ?? 'http://localhost:4000';
    const u = new URL(`${base}/api/v1/mock-provider/bank/authorize`);
    u.searchParams.set('state', input.state);
    u.searchParams.set('redirect_uri', input.redirectUri);
    return u.toString();
  }

  exchangeCode(code: string) {
    return this.bank.exchange(code);
  }

  listAccounts(token: string) {
    return this.bank.accounts(token);
  }

  getBalance(token: string, externalId: string) {
    return this.bank.balance(token, externalId);
  }

  listTransactions(token: string, externalId: string, from: string) {
    return this.bank.transactions(token, externalId, from);
  }
}

import { Global, Module } from '@nestjs/common';
import { MockBankController } from '../mock-providers/mockbank.controller';
import { MockBankProvider } from '../mock-providers/mockbank.provider';
import { BankingController } from './banking.controller';
import { BankingService } from './banking.service';
import { MockBankAdapter } from './mockbank.adapter';

@Global()
@Module({
  controllers: [BankingController, MockBankController],
  providers: [BankingService, MockBankAdapter, MockBankProvider],
  exports: [BankingService],
})
export class BankingModule {}

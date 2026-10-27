import { Global, Module } from '@nestjs/common';
import { ImportsController } from '../imports/imports.controller';
import { ImportsService } from '../imports/imports.service';
import { CategorizerService } from './categorizer.service';
import { TransactionsController } from './transactions.controller';

@Global()
@Module({
  controllers: [TransactionsController, ImportsController],
  providers: [CategorizerService, ImportsService],
  exports: [CategorizerService],
})
export class TransactionsModule {}

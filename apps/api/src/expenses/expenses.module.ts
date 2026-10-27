import { Module } from '@nestjs/common';
import { DocumentsController } from '../documents/documents.controller';
import { DocumentsService } from '../documents/documents.service';
import { ApprovalPolicy } from './approval-policy';
import { ExpensesController } from './expenses.controller';

@Module({
  controllers: [ExpensesController, DocumentsController],
  providers: [DocumentsService, ApprovalPolicy],
})
export class ExpensesModule {}

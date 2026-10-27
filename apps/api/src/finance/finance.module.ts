import { Module } from '@nestjs/common';
import { CashflowService } from './cashflow.service';
import { FinanceController } from './finance.controller';
import { OverviewService } from './overview.service';
import { ReportsService } from './reports.service';

@Module({ controllers: [FinanceController], providers: [OverviewService, CashflowService, ReportsService] })
export class FinanceModule {}

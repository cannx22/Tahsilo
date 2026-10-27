import { Global, Module } from '@nestjs/common';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';

@Global()
@Module({ controllers: [ReconciliationController], providers: [ReconciliationService], exports: [ReconciliationService] })
export class ReconciliationModule {}

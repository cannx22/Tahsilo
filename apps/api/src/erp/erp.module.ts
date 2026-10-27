import { Module } from '@nestjs/common';
import { MockErpAdapter } from '../mock-providers/mockerp.adapter';
import { ErpController } from './erp.controller';
import { ErpService } from './erp.service';
import { JobWorkerService } from './job-worker.service';
import { RemindersService } from './reminders.service';

@Module({
  controllers: [ErpController],
  providers: [ErpService, JobWorkerService, RemindersService, MockErpAdapter],
  exports: [JobWorkerService],
})
export class ErpModule {}

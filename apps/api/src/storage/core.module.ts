import { Global, Module } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [CryptoService, StorageService, AuditService],
  exports: [CryptoService, StorageService, AuditService],
})
export class CoreModule {}

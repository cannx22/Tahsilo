import { Global, Module } from '@nestjs/common';
import { MockPosController } from '../mock-providers/mockpos.controller';
import { MockPosProvider } from '../mock-providers/mockpos.provider';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';
import { MockPosAdapter } from './mockpos.adapter';

@Global()
@Module({
  controllers: [CollectionsController, MockPosController],
  providers: [CollectionsService, MockPosAdapter, MockPosProvider],
  exports: [CollectionsService],
})
export class CollectionsModule {}

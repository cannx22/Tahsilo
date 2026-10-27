import { Module } from '@nestjs/common';
import { PlatformController, PlatformGuard } from './platform.controller';

@Module({ controllers: [PlatformController], providers: [PlatformGuard] })
export class PlatformModule {}

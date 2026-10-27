import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { RequirePerms } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { BankingService } from './banking.service';

class StartDto {
  @IsString() @IsNotEmpty() provider: string;
  @IsString() @IsNotEmpty() @MaxLength(80) name: string;
}

class CallbackDto {
  @IsString() @IsNotEmpty() state: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() error?: string;
}

@Controller('bank-connections')
export class BankingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly banking: BankingService,
  ) {}

  @RequirePerms('bank.view')
  @Get()
  async list() {
    const items = await this.prisma.db.bankConnection.findMany({
      where: { status: { not: 'PENDING_CONSENT' } },
      // Erişim belirteci ve izin durumu anahtarı asla dönmez
      select: {
        id: true,
        provider: true,
        name: true,
        status: true,
        consentExpiresAt: true,
        lastSyncAt: true,
        lastError: true,
        createdAt: true,
        accounts: { select: { id: true, name: true, currency: true, ibanMasked: true, balance: true, balanceAsOf: true } },
        jobs: { orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, status: true, attempts: true, stats: true, lastError: true, createdAt: true, finishedAt: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return { providers: this.banking.providers(), items };
  }

  @RequirePerms('bank.manage')
  @Post()
  start(@Body() dto: StartDto) {
    return this.banking.start(dto.provider, dto.name);
  }

  @RequirePerms('bank.manage')
  @Post('callback')
  callback(@Body() dto: CallbackDto) {
    return this.banking.callback(dto.state, dto.code, dto.error);
  }

  @RequirePerms('bank.manage')
  @Post(':id/reauthorize')
  reauthorize(@Param('id') id: string) {
    return this.banking.reauthorize(id);
  }

  @RequirePerms('bank.manage')
  @Post(':id/sync')
  async sync(@Param('id') id: string) {
    const conn = await this.prisma.db.bankConnection.findFirstOrThrow({ where: { id } });
    return this.banking.enqueue(conn.id);
  }

  @RequirePerms('bank.manage')
  @Post(':id/disconnect')
  disconnect(@Param('id') id: string) {
    return this.banking.disconnect(id);
  }
}

import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccountsModule } from './accounts/accounts.module';
import { AuthModule } from './auth/auth.module';
import { BankingModule } from './banking/banking.module';
import { BudgetsModule } from './budgets/budgets.module';
import { CollectionsModule } from './collections/collections.module';
import { AuthGuard } from './common/auth.guard';
import { Public } from './common/decorators';
import { ErpModule } from './erp/erp.module';
import { ExpensesModule } from './expenses/expenses.module';
import { FinanceModule } from './finance/finance.module';
import { LedgerModule } from './ledger/ledger.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PlatformModule } from './platform/platform.module';
import { PrismaModule } from './prisma/prisma.module';
import { PrismaService } from './prisma/prisma.service';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { SettingsModule } from './settings/settings.module';
import { CoreModule } from './storage/core.module';
import { TransactionsModule } from './transactions/transactions.module';

@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health() {
    await this.prisma.raw.$queryRaw`SELECT 1`;
    return { status: 'ok', time: new Date().toISOString() };
  }
}

function requireSecret(name: string, minLength: number) {
  const v = process.env[name];
  if (!v || v.length < minLength) throw new Error(`${name} en az ${minLength} karakter olmalı (.env dosyasını kontrol edin)`);
  return v;
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({ secret: requireSecret('JWT_SECRET', 32), signOptions: { expiresIn: '8h' } }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    CoreModule,
    AuthModule,
    SettingsModule,
    AccountsModule,
    LedgerModule,
    ReconciliationModule,
    TransactionsModule,
    ExpensesModule,
    CollectionsModule,
    ErpModule,
    FinanceModule,
    NotificationsModule,
    BudgetsModule,
    BankingModule,
    PlatformModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}

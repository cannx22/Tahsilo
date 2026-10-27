import { Controller, ForbiddenException, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePerms } from '../common/decorators';
import { resolvePeriod } from '../common/period';
import { hasPermission } from '../common/permissions';
import { RequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { CashflowService } from './cashflow.service';
import { OverviewService } from './overview.service';
import { REPORT_TYPES, ReportsService } from './reports.service';

@Controller()
export class FinanceController {
  constructor(
    private readonly overviewService: OverviewService,
    private readonly cashflow: CashflowService,
    private readonly reports: ReportsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @RequirePerms('overview.view')
  @Get('finance/overview')
  overview(@Query('from') from?: string, @Query('to') to?: string) {
    return this.overviewService.overview(resolvePeriod(from, to));
  }

  @RequirePerms('cashflow.view')
  @Get('cashflow/forecast')
  forecast(@Query('weeks') weeks?: string, @Query('currency') currency?: string) {
    return this.cashflow.forecast(Math.min(26, Math.max(4, Number(weeks) || 12)), (currency ?? 'TRY').toUpperCase().slice(0, 3));
  }

  @RequirePerms('report.view')
  @Get('reports')
  list() {
    return REPORT_TYPES;
  }

  @RequirePerms('report.view')
  @Get('reports/:key')
  async report(
    @Param('key') key: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('format') format = 'json',
  ) {
    const report = await this.reports.build(key, resolvePeriod(from, to));
    if (format === 'json') return res.json(report);

    if (!hasPermission(user.role, 'report.export')) throw new ForbiddenException('Dışa aktarma yetkiniz yok');
    const tenant = await this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: RequestContext.tenantId() } });
    const fileBase = `tahsilo-${key}-${report.period.from}_${report.period.to}`;
    await this.audit.log('report.export', 'Report', key, { after: { format, period: report.period, rows: report.rows.length } });

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.csv"`);
      return res.send(this.reports.toCsv(report, tenant.name));
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.xlsx"`);
    return res.send(await this.reports.toXlsx(report, tenant.name));
  }
}

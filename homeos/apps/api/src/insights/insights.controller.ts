import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { addDays, addMonths, parseDate, startOfDay, startOfMonth } from '@homeos/shared';
import { CurrentCtx, Tenant, type Ctx } from '../common/context';
import { badRequest } from '../common/errors';
import { InsightsService } from './insights.service';

/** Parse an inclusive from/to pair into a half-open [from, to) range. */
function range(from: string | undefined, to: string | undefined, defaultMonths = 1): { from: Date; to: Date } {
  const today = startOfDay(new Date());
  const f = from ? parseDate(from) : addMonths(startOfMonth(today), -(defaultMonths - 1));
  const t = to ? parseDate(to) : today;
  if (!f || !t) throw badRequest('from and to must be dates (YYYY-MM-DD)');
  if (t < f) throw badRequest('to must not be earlier than from');
  if ((t.getTime() - f.getTime()) / 86_400_000 > 366 * 5) throw badRequest('The date range is too large (maximum five years)');
  return { from: f, to: addDays(t, 1) };
}

@ApiTags('Dashboard & reports')
@Controller()
@Tenant()
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  /** Consolidated home dashboard. Sections the caller's role cannot read are omitted. */
  @Get('dashboard')
  dashboard(@CurrentCtx() ctx: Ctx) {
    return this.insights.dashboard(ctx);
  }

  /** Dated obligations (bills, renewals, services, salaries, expiries) between two dates. */
  @Get('calendar')
  async calendar(@CurrentCtx() ctx: Ctx, @Query('from') from?: string, @Query('to') to?: string) {
    const today = startOfDay(new Date());
    const f = from ? parseDate(from) : startOfMonth(today);
    const t = to ? parseDate(to) : addDays(addMonths(startOfMonth(today), 1), -1);
    if (!f || !t) throw badRequest('from and to must be dates (YYYY-MM-DD)');
    if (t < f || (t.getTime() - f.getTime()) / 86_400_000 > 400) throw badRequest('The date range must be between 1 and 400 days');
    return { from: from ?? f.toISOString().slice(0, 10), to: to ?? t.toISOString().slice(0, 10), events: await this.insights.events(ctx, f, t) };
  }

  @Get('search')
  search(@CurrentCtx() ctx: Ctx, @Query('q') q: string) {
    return this.insights.search(ctx, q);
  }

  @Get('reports/spending')
  spending(@CurrentCtx() ctx: Ctx, @Query('from') from?: string, @Query('to') to?: string) {
    const r = range(from, to, 12);
    return this.insights.spendingReport(ctx, r.from, r.to);
  }

  @Get('reports/annual')
  annual(@CurrentCtx() ctx: Ctx, @Query('year') year?: string) {
    return this.insights.annualComparison(ctx, year ? Number(year) : new Date().getUTCFullYear());
  }

  /** Expense statement as CSV. */
  @Get('reports/statement.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="homeos-statement.csv"')
  statement(@CurrentCtx() ctx: Ctx, @Query('from') from?: string, @Query('to') to?: string) {
    const r = range(from, to, 1);
    return this.insights.statementCsv(ctx, r.from, r.to);
  }

  @Get('reports/net-worth')
  netWorth(@CurrentCtx() ctx: Ctx) {
    return this.insights.netWorth(ctx);
  }

  @Get('reports/subscriptions')
  subscriptions(@CurrentCtx() ctx: Ctx) {
    return this.insights.subscriptionsSummary(ctx);
  }

  @Get('reports/staff')
  staff(@CurrentCtx() ctx: Ctx) {
    return this.insights.staffSalarySummary(ctx);
  }

  @Get('reports/maintenance')
  maintenance(@CurrentCtx() ctx: Ctx, @Query('period') period?: string) {
    return this.insights.maintenanceCost(ctx, period ?? 'THIS_YEAR');
  }

  /** Total cost of ownership, fuel efficiency and service spend for one vehicle. */
  @Get('reports/vehicles/:id')
  vehicle(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.insights.vehicleReport(ctx, id);
  }

  /** Service history, repair spend and replacement recommendation for one appliance. */
  @Get('reports/appliances/:id')
  appliance(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.insights.applianceReport(ctx, id);
  }

  @Get('finance/budget-status')
  budgets(@CurrentCtx() ctx: Ctx) {
    return this.insights.budgetStatus(ctx);
  }
}

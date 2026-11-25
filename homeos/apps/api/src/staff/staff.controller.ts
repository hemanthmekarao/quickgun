import { Body, Controller, Get, HttpCode, Injectable, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { addMonths, getResource, isUuid, monthKey, parseDate, startOfDay, validateRecord } from '@homeos/shared';
import { AuditService } from '../common/audit.service';
import { CurrentCtx, Tenant, need, type Ctx } from '../common/context';
import { validationFailed } from '../common/errors';
import { PrismaService, type Db } from '../prisma.service';
import { ResourceService } from '../resources/resource.service';

const STAFF = getResource('staff');
const SALARIES = getResource('salaries');
const ATTENDANCE = getResource('attendance');
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: ResourceService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Create the month's salary records for every active staff member who does not have one.
   * Safe to run repeatedly; also run by the daily scheduler so salary reminders have a record to point at.
   */
  async generateSalaries(ctx: Ctx, month: string) {
    need(ctx, 'staff', 'write');
    if (!MONTH_RE.test(month)) throw validationFailed([{ field: 'month', message: 'must be in YYYY-MM format' }]);
    const monthStart = parseDate(`${month}-01`)!;
    const monthEnd = addMonths(monthStart, 1);
    const staff: any[] = await this.prisma.staff.findMany({ where: { ...this.resources.scope(STAFF, ctx), status: { in: ['ACTIVE', 'ON_LEAVE'] } } });
    const existing: any[] = await this.prisma.salary.findMany({ where: { householdId: ctx.householdId, deletedAt: null, month }, select: { staffId: true } });
    const have = new Set(existing.map((s) => s.staffId));
    const created: any[] = [];
    await this.prisma.$transaction(async (tx: Db) => {
      for (const s of staff) {
        if (have.has(s.id)) continue;
        if (s.joiningDate && s.joiningDate >= monthEnd) continue;
        if (s.exitDate && s.exitDate < monthStart) continue;
        const v = validateRecord(SALARIES, { staffId: s.id, month, baseAmount: num(s.monthlySalary), ...(s.paymentMethod ? { paymentMethod: s.paymentMethod } : {}) });
        if (!v.ok) continue;
        created.push(await this.resources.createInTx(SALARIES, ctx, v.data, tx));
      }
    });
    return { month, created: created.length, alreadyPresent: have.size, items: created.map((r) => this.resources.present(SALARIES, r, false)) };
  }

  /** Record attendance for several staff members on one date; existing entries for that date are updated. */
  async markAttendance(ctx: Ctx, body: any) {
    need(ctx, 'staff', 'write');
    const date = parseDate(body?.date);
    const entries: any[] = Array.isArray(body?.entries) ? body.entries : [];
    if (!date) throw validationFailed([{ field: 'date', message: 'must be a valid date' }]);
    if (date > startOfDay(new Date())) throw validationFailed([{ field: 'date', message: 'cannot be in the future' }]);
    if (entries.length === 0 || entries.length > 200) throw validationFailed([{ field: 'entries', message: 'must contain between 1 and 200 entries' }]);
    let saved = 0;
    await this.prisma.$transaction(async (tx: Db) => {
      for (const e of entries) {
        const v = validateRecord(ATTENDANCE, { staffId: e?.staffId, date: body.date, status: e?.status, ...(e?.notes ? { notes: e.notes } : {}) });
        if (!v.ok) throw validationFailed(v.issues);
        const current = await tx.attendance.findFirst({ where: { householdId: ctx.householdId, deletedAt: null, staffId: v.data.staffId, date } });
        if (current) await this.resources.updateInTx(ATTENDANCE, ctx, current.id, { status: v.data.status, notes: v.data.notes ?? null }, tx);
        else await this.resources.createInTx(ATTENDANCE, ctx, v.data, tx);
        saved++;
      }
    });
    return { date: body.date, saved };
  }

  /** Attendance counts, advances and salary history for one staff member. */
  async overview(ctx: Ctx, id: string, month?: string) {
    need(ctx, 'staff', 'read');
    const staff = await this.resources.findRow(STAFF, ctx, id);
    const m = month && MONTH_RE.test(month) ? month : monthKey(new Date());
    const start = parseDate(`${m}-01`)!;
    const end = addMonths(start, 1);
    const [attendance, advances, salaries] = await Promise.all([
      this.prisma.attendance.findMany({ where: { householdId: ctx.householdId, deletedAt: null, staffId: staff.id, date: { gte: start, lt: end } } }),
      this.prisma.staffAdvance.findMany({ where: { householdId: ctx.householdId, deletedAt: null, staffId: staff.id } }),
      this.prisma.salary.findMany({ where: { householdId: ctx.householdId, deletedAt: null, staffId: staff.id }, orderBy: { month: 'desc' }, take: 24 }),
    ]);
    const counts: Record<string, number> = {};
    for (const a of attendance as any[]) counts[a.status] = (counts[a.status] ?? 0) + 1;
    const outstanding = (advances as any[]).filter((a) => a.status === 'OUTSTANDING').reduce((s, a) => s + num(a.amount) - num(a.recoveredAmount), 0);
    const paid = (salaries as any[]).filter((s) => s.status === 'PAID' || s.status === 'PARTIALLY_PAID');
    return {
      staffId: staff.id,
      month: m,
      attendance: counts,
      daysRecorded: (attendance as any[]).length,
      advanceOutstanding: Math.round(outstanding * 100) / 100,
      totalPaid: Math.round(paid.reduce((s, x) => s + (num(x.paidAmount) || num(x.netAmount)), 0) * 100) / 100,
      pendingSalaries: (salaries as any[]).filter((s) => s.status === 'PENDING').length,
      currency: ctx.currency,
    };
  }
}

@ApiTags('Household staff')
@Controller()
@Tenant()
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  /** Body: { month: "YYYY-MM" }. Creates missing salary records for the month. */
  @Post('salaries/generate')
  @HttpCode(200)
  generate(@CurrentCtx() ctx: Ctx, @Body() body: any) {
    return this.staff.generateSalaries(ctx, String(body?.month ?? monthKey(new Date())));
  }

  /** Body: { date, entries: [{ staffId, status, notes? }] }. */
  @Post('attendance/mark')
  @HttpCode(200)
  mark(@CurrentCtx() ctx: Ctx, @Body() body: any) {
    return this.staff.markAttendance(ctx, body);
  }

  @Get('reports/staff/:id')
  overview(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query('month') month?: string) {
    if (!isUuid(id)) return this.staff.overview(ctx, '00000000-0000-0000-0000-000000000000', month);
    return this.staff.overview(ctx, id, month);
  }
}

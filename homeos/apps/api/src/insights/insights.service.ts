import { Injectable } from '@nestjs/common';
import {
  DATED_SOURCES,
  RESOURCES,
  addDays,
  addMonths,
  buildMonthlySummary,
  can,
  computeMileage,
  cyclesPerYear,
  dayInMonth,
  daysBetween,
  detectAnomalies,
  getResource,
  isoDate,
  monthKey,
  parseDate,
  replacementAdvice,
  startOfDay,
  startOfMonth,
  startOfYear,
  toDatedEvent,
  visibleSensitivities,
  type DatedEvent,
  type SpendPeriod,
} from '@homeos/shared';
import { allowed, need, type Ctx } from '../common/context';
import { badRequest } from '../common/errors';
import { PrismaService } from '../prisma.service';
import { ResourceService } from '../resources/resource.service';

const EXPENSES = getResource('expenses');
const round = (n: number): number => Math.round(n * 100) / 100;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

interface SpendRow {
  date: Date;
  amount: number;
  kind: string;
  category: string | null;
  memberId: string | null;
  propertyId: string | null;
  paymentMethod: string | null;
}

export function periodRange(period: SpendPeriod | string, today = new Date()): { from: Date; to: Date; label: string } {
  const t = startOfDay(today);
  const monthStart = startOfMonth(t);
  const yearStart = startOfYear(t);
  switch (period) {
    case 'LAST_MONTH':
      return { from: addMonths(monthStart, -1), to: monthStart, label: 'last month' };
    case 'THIS_YEAR':
      return { from: yearStart, to: addDays(t, 1), label: 'this year' };
    case 'LAST_YEAR':
      return { from: new Date(Date.UTC(t.getUTCFullYear() - 1, 0, 1)), to: yearStart, label: 'last year' };
    case 'LAST_12_MONTHS':
      return { from: addMonths(t, -12), to: addDays(t, 1), label: 'the last 12 months' };
    case 'THIS_MONTH':
    default:
      return { from: monthStart, to: addDays(t, 1), label: 'this month' };
  }
}

function sumBy<T>(rows: T[], key: (r: T) => string | null, value: (r: T) => number): { key: string; amount: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) ?? 'UNSPECIFIED';
    map.set(k, (map.get(k) ?? 0) + value(r));
  }
  return [...map.entries()].map(([k, amount]) => ({ key: k, amount: round(amount) })).sort((a, b) => b.amount - a.amount);
}

/** Refunds reduce spending; income is reported separately. */
const signed = (r: SpendRow): number => (r.kind === 'REFUND' ? -r.amount : r.kind === 'EXPENSE' ? r.amount : 0);

/**
 * Read-only aggregation over household data. Every method takes the caller's context and
 * only includes sections the caller's role may read, so the dashboard, reports, calendar
 * and AI assistant can never reveal more than the REST endpoints do.
 */
@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: ResourceService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Spending                                                            */
  /* ------------------------------------------------------------------ */

  /** Ledger rows in [from, to), excluding expenses that are waiting for or were refused approval. */
  private async spendRows(ctx: Ctx, from: Date, to: Date): Promise<SpendRow[]> {
    const scope = this.resources.scope(EXPENSES, ctx);
    const rows: any[] = await this.prisma.expense.findMany({
      where: { ...scope, date: { gte: from, lt: to }, approvalStatus: { in: ['NOT_REQUIRED', 'APPROVED'] } },
      select: { date: true, amount: true, kind: true, category: true, memberId: true, propertyId: true, paymentMethod: true },
    });
    return rows.map((r) => ({ ...r, amount: num(r.amount), kind: r.kind ?? 'EXPENSE' }));
  }

  private totals(rows: SpendRow[]) {
    const spent = rows.reduce((s, r) => s + signed(r), 0);
    const income = rows.filter((r) => r.kind === 'INCOME').reduce((s, r) => s + r.amount, 0);
    const refunds = rows.filter((r) => r.kind === 'REFUND').reduce((s, r) => s + r.amount, 0);
    return { spent: round(spent), income: round(income), refunds: round(refunds) };
  }

  async spendingReport(ctx: Ctx, from: Date, to: Date) {
    need(ctx, 'finance', 'read');
    const rows = await this.spendRows(ctx, from, to);
    const spendRows = rows.filter((r) => r.kind !== 'INCOME');
    const members: any[] = await this.prisma.householdMember.findMany({ where: { householdId: ctx.householdId }, select: { id: true, name: true } });
    const memberName = new Map(members.map((m) => [m.id, m.name]));
    const properties: any[] = allowed(ctx, 'properties', 'read')
      ? await this.prisma.property.findMany({ where: this.resources.scope(getResource('properties'), ctx), select: { id: true, name: true } })
      : [];
    const propertyName = new Map(properties.map((p) => [p.id, p.name]));
    return {
      from: isoDate(from),
      to: isoDate(addDays(to, -1)),
      currency: ctx.currency,
      ...this.totals(rows),
      count: spendRows.length,
      byCategory: sumBy(spendRows, (r) => r.category, signed).map((x) => ({ category: x.key, amount: x.amount })),
      byMonth: sumBy(spendRows, (r) => monthKey(r.date), signed)
        .map((x) => ({ month: x.key, amount: x.amount }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      byMember: sumBy(spendRows, (r) => r.memberId, signed).map((x) => ({ memberId: x.key === 'UNSPECIFIED' ? null : x.key, name: memberName.get(x.key) ?? 'Unassigned', amount: x.amount })),
      byProperty: sumBy(spendRows, (r) => r.propertyId, signed).map((x) => ({ propertyId: x.key === 'UNSPECIFIED' ? null : x.key, name: propertyName.get(x.key) ?? 'Not linked to a property', amount: x.amount })),
      byPaymentMethod: sumBy(spendRows, (r) => r.paymentMethod, signed).map((x) => ({ paymentMethod: x.key, amount: x.amount })),
    };
  }

  async spendingSummary(ctx: Ctx, period: SpendPeriod | string) {
    const range = periodRange(period);
    const report = await this.spendingReport(ctx, range.from, range.to);
    return { period, label: range.label, ...report };
  }

  /** This year against last year, month by month. */
  async annualComparison(ctx: Ctx, year: number) {
    need(ctx, 'finance', 'read');
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw badRequest('year must be a four-digit year');
    const from = new Date(Date.UTC(year - 1, 0, 1));
    const to = new Date(Date.UTC(year + 1, 0, 1));
    const rows = (await this.spendRows(ctx, from, to)).filter((r) => r.kind !== 'INCOME');
    const months = Array.from({ length: 12 }, (_, i) => {
      const cur = rows.filter((r) => r.date.getUTCFullYear() === year && r.date.getUTCMonth() === i).reduce((s, r) => s + signed(r), 0);
      const prev = rows.filter((r) => r.date.getUTCFullYear() === year - 1 && r.date.getUTCMonth() === i).reduce((s, r) => s + signed(r), 0);
      return { month: i + 1, current: round(cur), previous: round(prev) };
    });
    return {
      year,
      currency: ctx.currency,
      months,
      currentTotal: round(months.reduce((s, m) => s + m.current, 0)),
      previousTotal: round(months.reduce((s, m) => s + m.previous, 0)),
    };
  }

  async statementCsv(ctx: Ctx, from: Date, to: Date): Promise<string> {
    need(ctx, 'finance', 'read');
    const scope = this.resources.scope(EXPENSES, ctx);
    const rows: any[] = await this.prisma.expense.findMany({ where: { ...scope, date: { gte: from, lt: to } }, orderBy: { date: 'asc' } });
    const esc = (v: unknown) => {
      let s = v === null || v === undefined ? '' : String(v);
      // Neutralise spreadsheet formula injection.
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['Date', 'Description', 'Merchant', 'Category', 'Kind', 'Amount', 'Payment method', 'Approval', 'Source'];
    const lines = rows.map((r) =>
      [isoDate(r.date), r.description, r.merchant, r.category, r.kind, num(r.amount).toFixed(2), r.paymentMethod, r.approvalStatus, r.sourceType ?? 'manual'].map(esc).join(','),
    );
    return [header.join(','), ...lines].join('\r\n') + '\r\n';
  }

  async budgetStatus(ctx: Ctx) {
    need(ctx, 'finance', 'read');
    const today = startOfDay(new Date());
    const budgets: any[] = await this.prisma.budget.findMany({ where: { ...this.resources.scope(getResource('budgets'), ctx), status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
    const yearRows = (await this.spendRows(ctx, startOfYear(today), addDays(today, 1))).filter((r) => r.kind !== 'INCOME');
    return budgets.map((b) => {
      const start =
        b.period === 'YEARLY'
          ? startOfYear(today)
          : b.period === 'QUARTERLY'
            ? new Date(Date.UTC(today.getUTCFullYear(), Math.floor(today.getUTCMonth() / 3) * 3, 1))
            : startOfMonth(today);
      const used = yearRows
        .filter((r) => r.date >= start)
        .filter((r) => b.category === 'ALL' || r.category === b.category)
        .filter((r) => !b.propertyId || r.propertyId === b.propertyId)
        .filter((r) => !b.memberId || r.memberId === b.memberId)
        .reduce((s, r) => s + signed(r), 0);
      const amount = num(b.amount);
      const percent = amount > 0 ? Math.round((used / amount) * 100) : 0;
      return {
        id: b.id,
        name: b.name,
        category: b.category,
        period: b.period,
        amount,
        used: round(used),
        remaining: round(amount - used),
        percentUsed: percent,
        periodStart: isoDate(start),
        state: percent >= 100 ? 'OVER' : percent >= (b.alertThresholdPercent ?? 80) ? 'WARNING' : 'OK',
      };
    });
  }

  /* ------------------------------------------------------------------ */
  /* Dated events (calendar, reminders, dashboard)                       */
  /* ------------------------------------------------------------------ */

  /**
   * Every dated obligation between `from` and `to` (inclusive) that the caller may see.
   * Pass `overdueSince` to also include still-open items that fell due earlier.
   */
  async events(ctx: Ctx, from: Date, to: Date): Promise<DatedEvent[]> {
    const out: DatedEvent[] = [];
    for (const src of DATED_SOURCES) {
      const def = getResource(src.resource);
      if (!can(ctx.perms, def.module, 'read') || !can(ctx.perms, src.module, 'read')) continue;
      const rows: any[] = await this.resources.delegate(def).findMany({
        where: { ...this.resources.scope(def, ctx), [src.dateField]: { gte: from, lt: addDays(to, 1) } },
        take: 500,
      });
      if (rows.length === 0) continue;
      const presented = rows.map((r) => this.resources.present(def, r, false));
      await this.resources.attachRefs(def, ctx, presented);
      for (const r of presented) {
        const refs = Object.fromEntries(Object.entries(r._refs ?? {}).map(([k, v]: [string, any]) => [k, v.label]));
        const ev = toDatedEvent(src, r, refs);
        if (ev) out.push(ev);
      }
    }
    // Salary days for staff who do not have a salary record for that month yet.
    if (can(ctx.perms, 'staff', 'read')) {
      const staff: any[] = await this.prisma.staff.findMany({ where: { ...this.resources.scope(getResource('staff'), ctx), status: { in: ['ACTIVE', 'ON_LEAVE'] } } });
      if (staff.length) {
        const months: Date[] = [];
        for (let m = startOfMonth(from); m <= to; m = addMonths(m, 1)) months.push(m);
        const existing: any[] = await this.prisma.salary.findMany({
          where: { householdId: ctx.householdId, deletedAt: null, month: { in: months.map(monthKey) } },
          select: { staffId: true, month: true },
        });
        const have = new Set(existing.map((s) => `${s.staffId}:${s.month}`));
        for (const s of staff) {
          for (const m of months) {
            const due = dayInMonth(m, s.salaryDay ?? 1);
            if (due < from || due > to || have.has(`${s.id}:${monthKey(m)}`)) continue;
            if (s.joiningDate && due < s.joiningDate) continue;
            out.push({
              key: `staff:${s.id}:${monthKey(m)}`,
              resource: 'staff',
              entityId: s.id,
              eventType: 'STAFF_SALARY',
              module: 'staff',
              label: 'Salary',
              title: `Salary due — ${s.name}`,
              date: isoDate(due),
              amount: num(s.monthlySalary),
              href: `/staff/${s.id}`,
            });
          }
        }
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  }

  /* ------------------------------------------------------------------ */
  /* Dashboard                                                           */
  /* ------------------------------------------------------------------ */

  async dashboard(ctx: Ctx) {
    const today = startOfDay(new Date());
    const todayIso = isoDate(today);
    const result: Record<string, any> = { generatedAt: new Date().toISOString(), today: todayIso, currency: ctx.currency };

    const events = await this.events(ctx, addDays(today, -90), addDays(today, 60));
    const upcoming = (types: string[], days: number) => events.filter((e) => types.includes(e.eventType) && e.date >= todayIso && e.date <= isoDate(addDays(today, days)));
    const overdue = (types: string[]) => events.filter((e) => types.includes(e.eventType) && e.date < todayIso);

    result.calendar = events.filter((e) => e.date >= todayIso && e.date <= isoDate(addDays(today, 30))).slice(0, 40);

    let summaryInput: Parameters<typeof buildMonthlySummary>[0] | null = null;

    if (allowed(ctx, 'finance', 'read')) {
      const yearStart = startOfYear(today);
      const trendStart = addMonths(startOfMonth(today), -11);
      const from = trendStart < yearStart ? trendStart : yearStart;
      const rows = await this.spendRows(ctx, from, addDays(today, 1));
      const spend = rows.filter((r) => r.kind !== 'INCOME');
      const monthStart = startOfMonth(today);
      const lastMonthStart = addMonths(monthStart, -1);
      const inRange = (a: Date, b: Date) => spend.filter((r) => r.date >= a && r.date < b);
      const total = (list: SpendRow[]) => round(list.reduce((s, r) => s + signed(r), 0));
      const thisMonthRows = inRange(monthStart, addDays(today, 1));
      const byCategory = sumBy(thisMonthRows, (r) => r.category, signed).map((x) => ({ category: x.key, amount: x.amount }));
      const trend = Array.from({ length: 12 }, (_, i) => {
        const m = addMonths(trendStart, i);
        return { month: monthKey(m), amount: total(inRange(m, addMonths(m, 1))) };
      });
      // Anomalies: this month by category against the previous six full months.
      const history: Record<string, number[]> = {};
      for (let i = 1; i <= 6; i++) {
        const m = addMonths(monthStart, -i);
        const monthRows = inRange(m, addMonths(m, 1));
        if (monthRows.length === 0 && m < from) continue;
        const cats = new Set([...byCategory.map((c) => c.category), ...monthRows.map((r) => r.category ?? 'UNSPECIFIED')]);
        for (const c of cats) (history[c] ??= []).push(total(monthRows.filter((r) => (r.category ?? 'UNSPECIFIED') === c)));
      }
      const anomalies = detectAnomalies(Object.fromEntries(byCategory.map((c) => [c.category, c.amount])), history);
      const recent: any[] = await this.prisma.expense.findMany({
        where: this.resources.scope(EXPENSES, ctx),
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 8,
      });
      result.spending = {
        thisMonth: total(thisMonthRows),
        lastMonth: total(inRange(lastMonthStart, monthStart)),
        thisYear: total(inRange(yearStart, addDays(today, 1))),
        incomeThisMonth: round(rows.filter((r) => r.kind === 'INCOME' && r.date >= monthStart).reduce((s, r) => s + r.amount, 0)),
        byCategory,
        trend,
        anomalies,
      };
      result.recentExpenses = recent.map((r) => this.resources.present(EXPENSES, r, false));
      if (allowed(ctx, 'finance', 'approve')) {
        result.pendingApprovals = await this.prisma.expense.count({ where: { ...this.resources.scope(EXPENSES, ctx), approvalStatus: 'PENDING' } });
      }
      summaryInput = {
        monthLabel: today.toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
        currency: ctx.currency,
        totalThisMonth: result.spending.thisMonth,
        totalLastMonth: result.spending.lastMonth,
        topCategories: byCategory.filter((c) => c.amount > 0),
        overdueBills: 0,
        upcomingBills: 0,
        upcomingBillsAmount: 0,
        renewalsNext30Days: 0,
        openMaintenanceTasks: 0,
        anomalies,
        unusedSubscriptions: [],
      };
    }

    if (allowed(ctx, 'bills', 'read')) {
      const up = upcoming(['BILL_DUE'], 30);
      const od = overdue(['BILL_DUE']);
      result.bills = {
        upcoming: up.slice(0, 10),
        overdue: od.slice(0, 10),
        upcomingCount: up.length,
        overdueCount: od.length,
        upcomingTotal: round(up.reduce((s, e) => s + (e.amount ?? 0), 0)),
        overdueTotal: round(od.reduce((s, e) => s + (e.amount ?? 0), 0)),
      };
      if (summaryInput) {
        summaryInput.overdueBills = od.length;
        summaryInput.upcomingBills = up.length;
        summaryInput.upcomingBillsAmount = result.bills.upcomingTotal;
      }
    }

    if (allowed(ctx, 'insurance', 'read')) result.insuranceRenewals = upcoming(['INSURANCE_RENEWAL', 'INSURANCE_PREMIUM'], 60).slice(0, 8);

    if (allowed(ctx, 'properties', 'read')) {
      const props: any[] = await this.prisma.property.findMany({ where: { ...this.resources.scope(getResource('properties'), ctx), status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
      result.properties = {
        count: props.length,
        totalValue: round(props.reduce((s, p) => s + num(p.currentValue ?? p.purchaseValue), 0)),
        monthlyRent: round(props.reduce((s, p) => s + num(p.monthlyRent), 0)),
        items: props.slice(0, 6).map((p) => ({ id: p.id, name: p.name, city: p.city, propertyType: p.propertyType, usage: p.usage, currentValue: p.currentValue === null ? null : num(p.currentValue) })),
      };
    }

    if (allowed(ctx, 'vehicles', 'read')) {
      const vehicles: any[] = await this.prisma.vehicle.findMany({ where: { ...this.resources.scope(getResource('vehicles'), ctx), status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
      result.vehicles = {
        count: vehicles.length,
        items: vehicles.slice(0, 6).map((v) => ({
          id: v.id,
          name: v.name,
          registrationNumber: v.registrationNumber,
          currentOdometer: v.currentOdometer,
          nextServiceDate: v.nextServiceDate ? isoDate(v.nextServiceDate) : null,
          insuranceExpiry: v.insuranceExpiry ? isoDate(v.insuranceExpiry) : null,
        })),
        alerts: [...overdue(['VEHICLE_SERVICE', 'VEHICLE_COMPLIANCE']), ...upcoming(['VEHICLE_SERVICE', 'VEHICLE_COMPLIANCE'], 30)].slice(0, 8),
      };
    }

    if (allowed(ctx, 'appliances', 'read')) {
      result.applianceAlerts = [...overdue(['APPLIANCE_SERVICE']), ...upcoming(['WARRANTY_EXPIRY', 'APPLIANCE_SERVICE'], 60)].slice(0, 8);
      result.applianceCount = await this.prisma.appliance.count({ where: { ...this.resources.scope(getResource('appliances'), ctx), status: 'ACTIVE' } });
    }

    if (allowed(ctx, 'staff', 'read')) {
      const staff: any[] = await this.prisma.staff.findMany({ where: { ...this.resources.scope(getResource('staff'), ctx), status: { in: ['ACTIVE', 'ON_LEAVE'] } } });
      result.staff = {
        activeCount: staff.length,
        monthlyCommitment: round(staff.reduce((s, x) => s + num(x.monthlySalary), 0)),
        salaryCalendar: [...overdue(['STAFF_SALARY']), ...upcoming(['STAFF_SALARY'], 30)].slice(0, 10),
      };
    }

    if (allowed(ctx, 'documents', 'read')) {
      const visible = visibleSensitivities(ctx.perms) as string[];
      result.documentExpiries = [...overdue(['DOCUMENT_EXPIRY', 'TRAVEL_DOCUMENT_EXPIRY']), ...upcoming(['DOCUMENT_EXPIRY', 'TRAVEL_DOCUMENT_EXPIRY'], 60)]
        .filter((e) => !e.sensitivity || visible.includes(e.sensitivity))
        .slice(0, 8);
      result.inboxPending = await this.prisma.inboxItem.count({ where: { householdId: ctx.householdId, deletedAt: null, status: 'PENDING_REVIEW' } });
    }

    if (allowed(ctx, 'maintenance', 'read')) {
      const def = getResource('maintenance-tasks');
      const where = { ...this.resources.scope(def, ctx), status: { in: ['OPEN', 'SCHEDULED', 'IN_PROGRESS'] } };
      const [open, items] = await Promise.all([
        this.prisma.maintenanceTask.count({ where }),
        this.prisma.maintenanceTask.findMany({ where, orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }], take: 6 }),
      ]);
      result.maintenance = { open, items: (items as any[]).map((t) => this.resources.present(def, t, false)) };
      if (summaryInput) summaryInput.openMaintenanceTasks = open;
    }

    if (allowed(ctx, 'subscriptions', 'read')) {
      const subs = await this.subscriptionsSummary(ctx);
      result.subscriptions = { activeCount: subs.activeCount, monthlyCost: subs.monthlyCost, annualCost: subs.annualCost, renewals: upcoming(['SUBSCRIPTION_RENEWAL'], 30).slice(0, 6) };
      if (summaryInput) summaryInput.unusedSubscriptions = subs.possiblyUnused.map((s) => s.name);
    }

    if (summaryInput) {
      summaryInput.renewalsNext30Days = events.filter(
        (e) => !['BILL_DUE', 'STAFF_SALARY', 'MAINTENANCE_DUE'].includes(e.eventType) && e.date >= todayIso && e.date <= isoDate(addDays(today, 30)),
      ).length;
      // Built only from the figures above; nothing in it is generated freely.
      result.summary = { ...buildMonthlySummary(summaryInput), basis: 'calculated' };
    }
    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Domain summaries (also used as assistant tools)                     */
  /* ------------------------------------------------------------------ */

  async billsDue(ctx: Ctx, days: number) {
    need(ctx, 'bills', 'read');
    const today = startOfDay(new Date());
    const window = Math.min(Math.max(Math.floor(days) || 0, 0), 365);
    const events = (await this.events(ctx, addDays(today, -180), addDays(today, window))).filter((e) => e.eventType === 'BILL_DUE');
    const todayIso = isoDate(today);
    const due = events.filter((e) => e.date >= todayIso);
    const overdue = events.filter((e) => e.date < todayIso);
    return {
      days: window,
      due,
      overdue,
      dueTotal: round(due.reduce((s, e) => s + (e.amount ?? 0), 0)),
      overdueTotal: round(overdue.reduce((s, e) => s + (e.amount ?? 0), 0)),
      currency: ctx.currency,
    };
  }

  async vehicleServiceStatus(ctx: Ctx) {
    need(ctx, 'vehicles', 'read');
    const today = startOfDay(new Date());
    const vehicles: any[] = await this.prisma.vehicle.findMany({ where: { ...this.resources.scope(getResource('vehicles'), ctx), status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
    const d = (v: Date | null) => (v ? { date: isoDate(v), daysUntil: daysBetween(today, v) } : null);
    return vehicles.map((v) => ({
      id: v.id,
      name: v.name,
      registrationNumber: v.registrationNumber,
      currentOdometer: v.currentOdometer,
      nextService: d(v.nextServiceDate),
      nextServiceOdometer: v.nextServiceOdometer,
      kmToNextService: v.nextServiceOdometer && v.currentOdometer ? v.nextServiceOdometer - v.currentOdometer : null,
      insuranceExpiry: d(v.insuranceExpiry),
      pucExpiry: d(v.pucExpiry),
    }));
  }

  async appliancesUnderWarranty(ctx: Ctx) {
    need(ctx, 'appliances', 'read');
    const today = startOfDay(new Date());
    const appliances: any[] = await this.prisma.appliance.findMany({ where: { ...this.resources.scope(getResource('appliances'), ctx), status: 'ACTIVE' }, orderBy: { name: 'asc' } });
    const rows = appliances.map((a) => {
      const ends = [a.warrantyEnd, a.extendedWarrantyEnd].filter(Boolean) as Date[];
      const latest = ends.length ? new Date(Math.max(...ends.map((x) => x.getTime()))) : null;
      return {
        id: a.id,
        name: a.name,
        applianceType: a.applianceType,
        warrantyEnd: latest ? isoDate(latest) : null,
        daysLeft: latest ? daysBetween(today, latest) : null,
        amcEnd: a.amcEnd ? isoDate(a.amcEnd) : null,
      };
    });
    return {
      underWarranty: rows.filter((r) => r.daysLeft !== null && r.daysLeft >= 0),
      expired: rows.filter((r) => r.daysLeft !== null && r.daysLeft < 0),
      unknown: rows.filter((r) => r.daysLeft === null),
    };
  }

  async insuranceExpiring(ctx: Ctx, days: number) {
    need(ctx, 'insurance', 'read');
    const today = startOfDay(new Date());
    const window = Math.min(Math.max(Math.floor(days) || 0, 0), 730);
    const def = getResource('insurance-policies');
    const rows: any[] = await this.prisma.insurancePolicy.findMany({
      where: { ...this.resources.scope(def, ctx), status: 'ACTIVE', expiryDate: { lt: addDays(today, window + 1) } },
      orderBy: { expiryDate: 'asc' },
    });
    return {
      days: window,
      policies: rows.map((p) => ({
        id: p.id,
        name: p.name,
        policyType: p.policyType,
        insurer: p.insurer,
        expiryDate: isoDate(p.expiryDate),
        daysUntil: daysBetween(today, p.expiryDate),
        premiumAmount: num(p.premiumAmount),
        sumInsured: p.sumInsured === null ? null : num(p.sumInsured),
      })),
      currency: ctx.currency,
    };
  }

  async staffSalarySummary(ctx: Ctx) {
    need(ctx, 'staff', 'read');
    const today = startOfDay(new Date());
    const staff: any[] = await this.prisma.staff.findMany({ where: { ...this.resources.scope(getResource('staff'), ctx), status: { in: ['ACTIVE', 'ON_LEAVE'] } }, orderBy: { name: 'asc' } });
    const salaries: any[] = await this.prisma.salary.findMany({
      where: { householdId: ctx.householdId, deletedAt: null, month: { gte: `${today.getUTCFullYear()}-01`, lte: `${today.getUTCFullYear()}-12` } },
    });
    const paid = salaries.filter((s) => s.status === 'PAID' || s.status === 'PARTIALLY_PAID').reduce((sum, s) => sum + (num(s.paidAmount) || num(s.netAmount)), 0);
    const pending = salaries.filter((s) => s.status === 'PENDING' || s.status === 'PARTIALLY_PAID');
    const monthly = staff.reduce((s, x) => s + num(x.monthlySalary), 0);
    return {
      staffCount: staff.length,
      monthlyCommitment: round(monthly),
      annualCommitment: round(monthly * 12),
      paidThisYear: round(paid),
      pendingCount: pending.length,
      pendingAmount: round(pending.reduce((s, x) => s + num(x.netAmount) - (x.status === 'PARTIALLY_PAID' ? num(x.paidAmount) : 0), 0)),
      staff: staff.map((s) => ({ id: s.id, name: s.name, role: s.role, monthlySalary: num(s.monthlySalary), salaryDay: s.salaryDay })),
      currency: ctx.currency,
    };
  }

  async subscriptionsSummary(ctx: Ctx) {
    need(ctx, 'subscriptions', 'read');
    const today = startOfDay(new Date());
    const subs: any[] = await this.prisma.subscription.findMany({ where: { ...this.resources.scope(getResource('subscriptions'), ctx), status: { in: ['ACTIVE', 'TRIAL'] } }, orderBy: { name: 'asc' } });
    const items = subs.map((s) => {
      const annual = num(s.amount) * cyclesPerYear(s.billingCycle);
      return {
        id: s.id,
        name: s.name,
        category: s.category,
        amount: num(s.amount),
        billingCycle: s.billingCycle,
        annualCost: round(annual),
        monthlyCost: round(annual / 12),
        nextRenewalDate: s.nextRenewalDate ? isoDate(s.nextRenewalDate) : null,
        autoRenew: s.autoRenew,
        lastUsedDate: s.lastUsedDate ? isoDate(s.lastUsedDate) : null,
      };
    });
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const groups = new Map<string, typeof items>();
    for (const it of items) groups.set(norm(it.name), [...(groups.get(norm(it.name)) ?? []), it]);
    const annualCost = items.reduce((s, x) => s + x.annualCost, 0);
    return {
      activeCount: items.length,
      monthlyCost: round(annualCost / 12),
      annualCost: round(annualCost),
      items,
      // "Possibly unused" is based only on the last-used date the household recorded.
      possiblyUnused: items.filter((x) => x.lastUsedDate && daysBetween(parseDate(x.lastUsedDate)!, today) > 60),
      possibleDuplicates: [...groups.values()].filter((g) => g.length > 1).map((g) => g.map((x) => ({ id: x.id, name: x.name, amount: x.amount }))),
      currency: ctx.currency,
    };
  }

  async maintenanceCost(ctx: Ctx, period: SpendPeriod | string) {
    need(ctx, 'maintenance', 'read');
    const range = periodRange(period);
    const def = getResource('maintenance-tasks');
    const scope = this.resources.scope(def, ctx);
    const tasks: any[] = await this.prisma.maintenanceTask.findMany({ where: { ...scope, status: 'COMPLETED', completedDate: { gte: range.from, lt: range.to } } });
    const orders: any[] = await this.prisma.workOrder.findMany({
      where: { householdId: ctx.householdId, deletedAt: null, status: 'PAID', paidDate: { gte: range.from, lt: range.to }, taskRef: scope },
    });
    const orderTaskIds = new Set(orders.map((o) => o.taskId));
    // A task with a paid work order is counted through the work order, not twice.
    const taskCost = tasks.filter((t) => !orderTaskIds.has(t.id)).reduce((s, t) => s + num(t.actualCost), 0);
    const orderCost = orders.reduce((s, o) => s + (num(o.paidAmount) || num(o.invoiceAmount)), 0);
    const open = await this.prisma.maintenanceTask.count({ where: { ...scope, status: { in: ['OPEN', 'SCHEDULED', 'IN_PROGRESS'] } } });
    const byCategory = sumBy(tasks, (t) => t.category, (t) => num(t.actualCost)).map((x) => ({ category: x.key, amount: x.amount }));
    return { period, label: range.label, total: round(taskCost + orderCost), completedTasks: tasks.length, paidWorkOrders: orders.length, openTasks: open, byCategory, currency: ctx.currency };
  }

  /* ------------------------------------------------------------------ */
  /* Reports                                                             */
  /* ------------------------------------------------------------------ */

  async vehicleReport(ctx: Ctx, id: string) {
    need(ctx, 'vehicles', 'read');
    const vehicle = await this.resources.findRow(getResource('vehicles'), ctx, id);
    const [fuel, services] = await Promise.all([
      this.prisma.fuelLog.findMany({ where: { householdId: ctx.householdId, deletedAt: null, vehicleId: vehicle.id }, orderBy: { date: 'asc' } }),
      this.prisma.vehicleService.findMany({ where: { householdId: ctx.householdId, deletedAt: null, vehicleId: vehicle.id }, orderBy: { date: 'asc' } }),
    ]);
    const fuelRows = (fuel as any[]).map((f) => ({ date: f.date as Date, odometer: f.odometer, quantity: f.quantity, totalCost: num(f.totalCost), fullTank: f.fullTank }));
    const mileage = computeMileage(fuelRows);
    const fuelTotal = fuelRows.reduce((s, f) => s + f.totalCost, 0);
    const serviceTotal = (services as any[]).reduce((s, x) => s + num(x.totalCost), 0);
    const odos = [...fuelRows.map((f) => f.odometer), ...(services as any[]).map((s) => s.odometer).filter(Boolean)] as number[];
    const distance = odos.length >= 2 ? Math.max(...odos) - Math.min(...odos) : 0;
    const running = fuelTotal + serviceTotal + num(vehicle.roadTaxAmount);
    return {
      vehicle: { id: vehicle.id, name: vehicle.name, registrationNumber: vehicle.registrationNumber, purchasePrice: vehicle.purchasePrice === null ? null : num(vehicle.purchasePrice) },
      currency: ctx.currency,
      fuel: {
        entries: fuelRows.length,
        totalCost: round(fuelTotal),
        totalQuantity: round(fuelRows.reduce((s, f) => s + f.quantity, 0)),
        averageKmPerUnit: mileage.averageKmPerUnit,
        costPerKm: mileage.costPerKm,
        efficiencyTrend: mileage.points,
        byMonth: sumBy(fuelRows, (f) => monthKey(f.date), (f) => f.totalCost)
          .map((x) => ({ month: x.key, amount: x.amount }))
          .sort((a, b) => a.month.localeCompare(b.month)),
      },
      service: {
        entries: (services as any[]).length,
        totalCost: round(serviceTotal),
        byType: sumBy(services as any[], (s) => s.serviceType, (s) => num(s.totalCost)).map((x) => ({ serviceType: x.key, amount: x.amount })),
      },
      ownership: {
        purchasePrice: vehicle.purchasePrice === null ? null : num(vehicle.purchasePrice),
        roadTax: num(vehicle.roadTaxAmount),
        runningCost: round(running),
        totalCost: round(running + num(vehicle.purchasePrice)),
        distanceTrackedKm: distance,
        runningCostPerKm: distance > 0 ? round((fuelTotal + serviceTotal) / distance) : null,
        // Insurance premiums are not included unless they were recorded as vehicle service entries.
        excludes: ['insurance premiums', 'loan interest', 'depreciation'],
      },
    };
  }

  async applianceReport(ctx: Ctx, id: string) {
    need(ctx, 'appliances', 'read');
    const a = await this.resources.findRow(getResource('appliances'), ctx, id);
    let repairTotal = 0;
    let history: any[] = [];
    if (allowed(ctx, 'maintenance', 'read')) {
      const def = getResource('maintenance-tasks');
      const tasks: any[] = await this.prisma.maintenanceTask.findMany({ where: { ...this.resources.scope(def, ctx), applianceId: a.id }, orderBy: { createdAt: 'desc' } });
      const orders: any[] = tasks.length
        ? await this.prisma.workOrder.findMany({ where: { householdId: ctx.householdId, deletedAt: null, taskId: { in: tasks.map((t) => t.id) }, status: 'PAID' } })
        : [];
      const paidByTask = new Map<string, number>();
      for (const o of orders) paidByTask.set(o.taskId, (paidByTask.get(o.taskId) ?? 0) + (num(o.paidAmount) || num(o.invoiceAmount)));
      history = tasks.map((t) => {
        const cost = paidByTask.get(t.id) ?? num(t.actualCost);
        repairTotal += cost;
        return { ...this.resources.present(def, t, false), cost: round(cost) };
      });
    }
    return {
      applianceId: a.id,
      serviceHistory: history,
      repairCostTotal: round(repairTotal),
      replacement: replacementAdvice(
        { purchaseDate: a.purchaseDate, purchasePrice: a.purchasePrice === null ? null : num(a.purchasePrice), expectedLifeYears: a.expectedLifeYears, condition: a.condition },
        repairTotal,
      ),
    };
  }

  /** Assets and liabilities the caller is allowed to see. Values are the ones the household entered. */
  async netWorth(ctx: Ctx) {
    need(ctx, 'reports', 'read');
    const out: Record<string, any> = { currency: ctx.currency, sections: [] as any[] };
    let assets = 0;
    let liabilities = 0;
    if (allowed(ctx, 'properties', 'read')) {
      const props: any[] = await this.prisma.property.findMany({ where: { ...this.resources.scope(getResource('properties'), ctx), status: 'ACTIVE' } });
      const value = props.reduce((s, p) => s + num(p.currentValue ?? p.purchaseValue), 0);
      const loans = props.reduce((s, p) => s + num(p.loanOutstanding), 0);
      assets += value;
      liabilities += loans;
      out.sections.push({ key: 'properties', label: 'Properties', count: props.length, value: round(value), liabilities: round(loans) });
    }
    if (allowed(ctx, 'vehicles', 'read')) {
      const vehicles: any[] = await this.prisma.vehicle.findMany({ where: { ...this.resources.scope(getResource('vehicles'), ctx), status: 'ACTIVE' } });
      const value = vehicles.reduce((s, v) => s + num(v.purchasePrice), 0);
      const loans = vehicles.reduce((s, v) => s + num(v.loanOutstanding), 0);
      assets += value;
      liabilities += loans;
      out.sections.push({ key: 'vehicles', label: 'Vehicles (at purchase price)', count: vehicles.length, value: round(value), liabilities: round(loans) });
    }
    if (allowed(ctx, 'assets', 'read')) {
      const rows: any[] = await this.prisma.asset.findMany({ where: { ...this.resources.scope(getResource('assets'), ctx), status: 'OWNED' } });
      const value = rows.reduce((s, a) => s + num(a.currentValue ?? a.purchasePrice), 0);
      assets += value;
      out.sections.push({ key: 'assets', label: 'Personal assets', count: rows.length, value: round(value), liabilities: 0 });
    }
    if (allowed(ctx, 'finance', 'read')) {
      const accounts: any[] = await this.prisma.bankAccount.findMany({ where: { ...this.resources.scope(getResource('bank-accounts'), ctx), status: 'ACTIVE' } });
      const cash = accounts.filter((a) => !['CREDIT_CARD', 'LOAN'].includes(a.accountType)).reduce((s, a) => s + num(a.currentBalance), 0);
      const owed = accounts.filter((a) => ['CREDIT_CARD', 'LOAN'].includes(a.accountType)).reduce((s, a) => s + Math.abs(num(a.currentBalance)), 0);
      assets += cash;
      liabilities += owed;
      out.sections.push({ key: 'accounts', label: 'Bank accounts & cards', count: accounts.length, value: round(cash), liabilities: round(owed) });
    }
    out.totalAssets = round(assets);
    out.totalLiabilities = round(liabilities);
    out.netWorth = round(assets - liabilities);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Global search                                                       */
  /* ------------------------------------------------------------------ */

  async search(ctx: Ctx, query: string) {
    const q = String(query ?? '').trim().slice(0, 100);
    if (q.length < 2) return { query: q, results: [] };
    const routes: Record<string, (id: string) => string> = {
      properties: (id) => `/properties/${id}`,
      vehicles: (id) => `/vehicles/${id}`,
      appliances: (id) => `/appliances/${id}`,
      staff: (id) => `/staff/${id}`,
      documents: (id) => `/documents/${id}`,
      expenses: () => '/finance',
      'bill-providers': () => '/bills',
      subscriptions: () => '/subscriptions',
      'insurance-policies': () => '/insurance',
      'maintenance-tasks': () => '/maintenance',
      vendors: () => '/maintenance',
      assets: () => '/assets',
      purchases: () => '/shopping',
      'travel-bookings': () => '/travel',
    };
    const results: any[] = [];
    for (const def of RESOURCES) {
      const route = routes[def.key];
      if (!route || !def.search.length || !can(ctx.perms, def.module, 'read')) continue;
      const rows: any[] = await this.resources.delegate(def).findMany({
        where: { ...this.resources.scope(def, ctx), OR: def.search.map((k) => ({ [k]: { contains: q, mode: 'insensitive' } })) },
        take: 5,
        orderBy: { updatedAt: 'desc' },
      });
      for (const r of rows) results.push({ resource: def.key, type: def.singular, id: r.id, title: this.resources.title(def, r), href: route(r.id) });
    }
    return { query: q, results };
  }
}

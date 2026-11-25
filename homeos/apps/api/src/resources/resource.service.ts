import { Injectable } from '@nestjs/common';
import {
  LEDGER_SOURCES,
  RESOURCE_MAP,
  can,
  categoriseExpense,
  dayInMonth,
  delegateName,
  findDuplicates,
  addDays,
  isUuid,
  ledgerEntryFor,
  nextOccurrence,
  parseDate,
  refTarget,
  startOfDay,
  systemDefaults,
  transactionFingerprint,
  validateRecord,
  visibleSensitivities,
  type FieldDef,
  type ModuleKey,
  type ResourceDef,
} from '@homeos/shared';
import { AuditService, diff } from '../common/audit.service';
import { need, type Ctx } from '../common/context';
import { badRequest, conflict, forbidden, notFound, validationFailed } from '../common/errors';
import { PrismaService, type Db } from '../prisma.service';

export interface ListResult {
  items: Record<string, any>[];
  total: number;
  page: number;
  pageSize: number;
}

type Row = Record<string, any>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/** Module that guards a ref target; core `members` are readable by anyone in the household. */
function refModule(ref: string): ModuleKey | null {
  return RESOURCE_MAP[ref]?.module ?? null;
}

/**
 * Generic, tenant-safe data access for every registry resource.
 *
 * Every query built here is constrained to `ctx.householdId`; callers cannot widen it.
 * Role permissions, property scoping and document sensitivity are applied in one place
 * (`scope`), so the REST controllers, the dashboard and the AI assistant share the same rules.
 */
@Injectable()
export class ResourceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  delegate(def: ResourceDef, db: Db = this.prisma): any {
    return db[delegateName(def.model)];
  }

  /* ------------------------------------------------------------------ */
  /* Access scope                                                        */
  /* ------------------------------------------------------------------ */

  /** WHERE clause every read and write of this resource must include. */
  scope(def: ResourceDef, ctx: Ctx): Row {
    const and: Row[] = [];
    if (ctx.propertyScope.length > 0) {
      if (def.key === 'properties') and.push({ id: { in: ctx.propertyScope } });
      else if (def.fields.some((x) => x.key === 'propertyId')) and.push({ propertyId: { in: ctx.propertyScope } });
      else {
        // Child records (a bill of a utility account, a fuel entry of a vehicle, …) follow their parent's property.
        const parent = def.fields.find((x) => x.type === 'ref' && x.required && RESOURCE_MAP[x.ref!]?.fields.some((y) => y.key === 'propertyId'));
        if (parent) and.push({ [`${parent.key.replace(/Id$/, '')}Ref`]: { propertyId: { in: ctx.propertyScope } } });
      }
    }
    if (def.key === 'documents') {
      and.push({ sensitivity: { in: visibleSensitivities(ctx.perms) } });
      if (ctx.roleKey !== 'OWNER') {
        and.push({ OR: [{ restrictedToMemberIds: { isEmpty: true } }, { restrictedToMemberIds: { has: ctx.memberId } }] });
      }
    }
    if (def.key === 'notifications') and.push({ recipientMemberId: ctx.memberId });
    return { householdId: ctx.householdId, deletedAt: null, ...(and.length ? { AND: and } : {}) };
  }

  /* ------------------------------------------------------------------ */
  /* Presentation                                                        */
  /* ------------------------------------------------------------------ */

  present(def: ResourceDef, row: Row, detail: boolean): Row {
    const out: Row = {
      id: row.id,
      householdId: row.householdId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdById: row.createdById ?? null,
    };
    for (const field of def.fields) {
      if (field.hidden || (field.detailOnly && !detail)) continue;
      const v = row[field.key];
      if (v === null || v === undefined) out[field.key] = field.type === 'tags' ? [] : null;
      else if (field.type === 'money') out[field.key] = Number(v);
      else if (field.type === 'date') out[field.key] = (v as Date).toISOString().slice(0, 10);
      else out[field.key] = v;
    }
    return out;
  }

  /** Attach `_refs` (id + label) for referenced records the caller is allowed to read. */
  async attachRefs(def: ResourceDef, ctx: Ctx, rows: Row[], db: Db = this.prisma): Promise<void> {
    const refFields = def.fields.filter((x) => x.type === 'ref' && !x.hidden);
    for (const row of rows) row._refs = {};
    for (const field of refFields) {
      const ids = [...new Set(rows.map((r) => r[field.key]).filter(Boolean))] as string[];
      if (ids.length === 0) continue;
      const module = refModule(field.ref!);
      if (module && !can(ctx.perms, module, 'read')) continue;
      const target = refTarget(field.ref!);
      const where: Row = { id: { in: ids }, householdId: ctx.householdId };
      if (field.ref === 'documents') where.sensitivity = { in: visibleSensitivities(ctx.perms) };
      const found: Row[] = await db[delegateName(target.model)].findMany({ where, select: { id: true, [target.titleField]: true } });
      const labels = new Map(found.map((x) => [x.id, String(x[target.titleField] ?? '').trim()]));
      const fallback = RESOURCE_MAP[field.ref!]?.singular ?? 'Record';
      for (const row of rows) {
        const id = row[field.key];
        if (id && labels.has(id)) row._refs[field.key] = { id, label: labels.get(id) || fallback };
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Reads                                                               */
  /* ------------------------------------------------------------------ */

  buildFilters(def: ResourceDef, query: Record<string, any>): Row[] {
    const and: Row[] = [];
    for (const field of def.fields) {
      if (field.hidden) continue;
      const raw = query[field.key];
      if (raw === undefined || raw === '' || Array.isArray(raw) || typeof raw === 'object') continue;
      const value = String(raw);
      if (field.type === 'enum' || (field.type === 'string' && field.system)) {
        const values = value.split(',').map((s) => s.trim()).filter(Boolean);
        and.push({ [field.key]: values.length > 1 ? { in: values } : values[0] });
      } else if (field.type === 'ref') {
        if (value === 'null') and.push({ [field.key]: null });
        else if (isUuid(value)) and.push({ [field.key]: value });
        else throw badRequest(`${field.key} must be a record id`);
      } else if (field.type === 'boolean') {
        if (value !== 'true' && value !== 'false') throw badRequest(`${field.key} must be true or false`);
        and.push({ [field.key]: value === 'true' });
      } else if (field.type === 'tags' && field.key === 'tags') {
        and.push({ tags: { has: value } });
      }
    }
    const q = typeof query.q === 'string' ? query.q.trim() : '';
    if (q && def.search.length) {
      and.push({ OR: def.search.map((key) => ({ [key]: { contains: q, mode: 'insensitive' } })) });
    }
    if (def.dateField) {
      const range: Row = {};
      if (query.from) {
        const d = parseDate(String(query.from));
        if (!d) throw badRequest('from must be a date (YYYY-MM-DD)');
        range.gte = d;
      }
      if (query.to) {
        const d = parseDate(String(query.to));
        if (!d) throw badRequest('to must be a date (YYYY-MM-DD)');
        // Inclusive of the whole "to" day for datetime fields.
        range.lt = addDays(d, 1);
      }
      if (Object.keys(range).length) and.push({ [def.dateField]: range });
    }
    return and;
  }

  async list(def: ResourceDef, ctx: Ctx, query: Record<string, any> = {}): Promise<ListResult> {
    need(ctx, def.module, 'read');
    const page = Math.max(1, Math.floor(Number(query.page ?? 1)) || 1);
    const pageSize = Math.min(200, Math.max(1, Math.floor(Number(query.pageSize ?? 50)) || 50));
    const base = this.scope(def, ctx);
    const filters = this.buildFilters(def, query);
    const where: Row = { ...base, AND: [...(base.AND ?? []), ...filters] };

    const sortable = new Set([...def.fields.filter((x) => !x.hidden && x.type !== 'json' && x.type !== 'tags').map((x) => x.key), 'createdAt', 'updatedAt']);
    const sortField = typeof query.sort === 'string' && sortable.has(query.sort) ? query.sort : (def.dateField ?? 'createdAt');
    const order = query.order === 'asc' ? 'asc' : query.order === 'desc' ? 'desc' : 'desc';
    const orderBy: Row[] = [{ [sortField]: order }];
    if (sortField !== 'createdAt') orderBy.push({ createdAt: 'desc' });

    const delegate = this.delegate(def);
    const [rows, total] = await Promise.all([
      delegate.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
      delegate.count({ where }),
    ]);
    const items = (rows as Row[]).map((r) => this.present(def, r, false));
    await this.attachRefs(def, ctx, items);
    return { items, total, page, pageSize };
  }

  /** Raw row (not presented), or 404. Always scoped to the caller's household and visibility. */
  async findRow(def: ResourceDef, ctx: Ctx, id: string, db: Db = this.prisma): Promise<Row> {
    if (!isUuid(id)) throw notFound(def.singular);
    const row = await this.delegate(def, db).findFirst({ where: { ...this.scope(def, ctx), id } });
    if (!row) throw notFound(def.singular);
    return row;
  }

  async get(def: ResourceDef, ctx: Ctx, id: string): Promise<Row> {
    need(ctx, def.module, 'read');
    const row = await this.findRow(def, ctx, id);
    const out = this.present(def, row, true);
    await this.attachRefs(def, ctx, [out]);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Writes                                                              */
  /* ------------------------------------------------------------------ */

  /** Every referenced record must exist in the same household (and inside the caller's property scope). */
  private async checkRefs(def: ResourceDef, ctx: Ctx, data: Row, db: Db): Promise<void> {
    const issues: { field: string; message: string }[] = [];
    for (const field of def.fields) {
      if (field.type !== 'ref') continue;
      const id = data[field.key];
      if (!id) continue;
      const target = refTarget(field.ref!);
      const where: Row = { id, householdId: ctx.householdId, deletedAt: null };
      const found = await db[delegateName(target.model)].findFirst({ where, select: { id: true } });
      if (!found) issues.push({ field: field.key, message: 'does not exist in this household' });
    }
    if (ctx.propertyScope.length > 0 && def.fields.some((x) => x.key === 'propertyId') && 'propertyId' in data) {
      if (!data.propertyId || !ctx.propertyScope.includes(data.propertyId)) {
        issues.push({ field: 'propertyId', message: 'must be one of the properties you are allowed to manage' });
      }
    }
    if (issues.length) throw validationFailed(issues);
  }

  async create(def: ResourceDef, ctx: Ctx, body: unknown): Promise<Row> {
    need(ctx, def.module, 'write');
    if (def.readOnly || def.noCreate) throw forbidden(`${def.plural} cannot be created through this endpoint`);
    if (ctx.propertyScope.length > 0 && def.key === 'properties') throw forbidden('Your access is limited to specific properties');
    const result = validateRecord(def, body);
    if (!result.ok) throw validationFailed(result.issues);
    if (ctx.propertyScope.length > 0 && def.fields.some((x) => x.key === 'propertyId') && !('propertyId' in result.data)) {
      result.data.propertyId = null; // forces the scope check below to reject it
    }
    const row = await this.prisma.$transaction(async (tx: Db) => {
      return this.createInTx(def, ctx, result.data, tx);
    });
    const out = this.present(def, row, true);
    await this.attachRefs(def, ctx, [out]);
    return out;
  }

  /**
   * Insert a record inside an existing transaction. `data` must already be validated
   * (client input) or be trusted server-side data; system fields may be included.
   */
  async createInTx(def: ResourceDef, ctx: Ctx, data: Row, tx: Db, opts: { skipHooks?: boolean } = {}): Promise<Row> {
    await this.checkRefs(def, ctx, data, tx);
    const full: Row = { ...systemDefaults(def), ...data };
    if (!opts.skipHooks) await this.beforeWrite(def, ctx, full, null, tx);
    const row: Row = await this.delegate(def, tx).create({
      data: { ...full, householdId: ctx.householdId, createdById: ctx.userId },
    });
    await this.audit.log(
      ctx,
      { action: 'create', entityType: def.key, entityId: row.id, summary: `Created ${def.singular.toLowerCase()} "${this.title(def, row)}"`, changes: diff(null, full) },
      tx,
    );
    if (!opts.skipHooks) await this.afterWrite(def, ctx, row, null, tx);
    return row;
  }

  async update(def: ResourceDef, ctx: Ctx, id: string, body: unknown): Promise<Row> {
    need(ctx, def.module, 'write');
    if (def.readOnly) throw forbidden(`${def.plural} are read-only`);
    const result = validateRecord(def, body, { partial: true });
    if (!result.ok) throw validationFailed(result.issues);
    if (Object.keys(result.data).length === 0) throw badRequest('No fields to update');
    const row = await this.prisma.$transaction(async (tx: Db) => this.updateInTx(def, ctx, id, result.data, tx));
    const out = this.present(def, row, true);
    await this.attachRefs(def, ctx, [out]);
    return out;
  }

  async updateInTx(def: ResourceDef, ctx: Ctx, id: string, data: Row, tx: Db, opts: { skipHooks?: boolean; summary?: string } = {}): Promise<Row> {
    const existing = await this.findRow(def, ctx, id, tx);
    await this.checkRefs(def, ctx, data, tx);
    const patch: Row = { ...data };
    if (!opts.skipHooks) await this.beforeWrite(def, ctx, patch, existing, tx);
    const row: Row = await this.delegate(def, tx).update({ where: { id: existing.id }, data: patch });
    const changes = diff(existing, patch);
    if (Object.keys(changes).length > 0) {
      await this.audit.log(
        ctx,
        { action: 'update', entityType: def.key, entityId: row.id, summary: opts.summary ?? `Updated ${def.singular.toLowerCase()} "${this.title(def, row)}"`, changes },
        tx,
      );
    }
    if (!opts.skipHooks) await this.afterWrite(def, ctx, row, existing, tx);
    return row;
  }

  async remove(def: ResourceDef, ctx: Ctx, id: string): Promise<void> {
    need(ctx, def.module, 'delete');
    if (def.readOnly) throw forbidden(`${def.plural} are read-only`);
    await this.prisma.$transaction(async (tx: Db) => {
      const existing = await this.findRow(def, ctx, id, tx);
      if (def.key === 'expenses' && existing.sourceType) {
        throw conflict('This expense was posted automatically. Change or delete the record it came from instead.', 'SOURCED_EXPENSE');
      }
      await this.delegate(def, tx).update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
      await this.audit.log(
        ctx,
        { action: 'delete', entityType: def.key, entityId: existing.id, summary: `Deleted ${def.singular.toLowerCase()} "${this.title(def, existing)}"` },
        tx,
      );
      if ((LEDGER_SOURCES as readonly string[]).includes(def.key)) await this.syncLedger(def, ctx, existing, tx, true);
    });
  }

  title(def: ResourceDef, row: Row): string {
    const v = row[def.titleField];
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v ?? def.singular).slice(0, 120);
  }

  /* ------------------------------------------------------------------ */
  /* Business rules applied on every write                               */
  /* ------------------------------------------------------------------ */

  private async beforeWrite(def: ResourceDef, ctx: Ctx, data: Row, existing: Row | null, tx: Db): Promise<void> {
    const merged: Row = { ...(existing ?? {}), ...data };
    switch (def.key) {
      case 'expenses': {
        if (existing?.sourceType) {
          throw conflict('This expense was posted automatically. Change the record it came from instead.', 'SOURCED_EXPENSE');
        }
        if (!merged.category) {
          data.category = categoriseExpense(String(merged.description ?? ''), merged.merchant);
          data.autoCategorised = true;
        } else if ('category' in data && existing) {
          data.autoCategorised = false;
        }
        // Approval workflow: large expenses entered by members without approve rights wait for an approver.
        const amountChanged = !existing || ('amount' in data && num(data.amount) !== num(existing.amount));
        if (amountChanged && merged.kind !== 'INCOME') {
          const threshold = ctx.approvalThreshold;
          const needsApproval = threshold !== null && num(merged.amount) >= threshold && !can(ctx.perms, 'finance', 'approve');
          data.approvalStatus = needsApproval ? 'PENDING' : 'NOT_REQUIRED';
          if (!needsApproval) {
            data.approvedById = null;
            data.approvedAt = null;
          }
        }
        if (!existing || 'amount' in data || 'date' in data) {
          const date = merged.date as Date;
          const near: Row[] = await tx.expense.findMany({
            where: {
              householdId: ctx.householdId,
              deletedAt: null,
              amount: merged.amount,
              date: { gte: addDays(date, -1), lte: addDays(date, 1) },
              ...(existing ? { id: { not: existing.id } } : {}),
            },
            take: 20,
          });
          const candidate = { date, amount: num(merged.amount), description: merged.description, merchant: merged.merchant };
          data.duplicateSuspect = findDuplicates(candidate, near.map((e) => ({ ...e, amount: num(e.amount) })) as any).length > 0;
        }
        break;
      }
      case 'transactions': {
        const fp = transactionFingerprint({
          date: merged.date,
          amount: num(merged.amount),
          direction: merged.direction,
          description: merged.description,
          reference: merged.reference,
        });
        data.fingerprint = fp;
        const same = await tx.transaction.count({
          where: { householdId: ctx.householdId, deletedAt: null, bankAccountId: merged.bankAccountId, fingerprint: fp, ...(existing ? { id: { not: existing.id } } : {}) },
        });
        data.duplicateSuspect = same > 0;
        if ('matchedExpenseId' in data && !('reconciled' in data)) data.reconciled = Boolean(data.matchedExpenseId);
        break;
      }
      case 'bills': {
        if (merged.status === 'PAID') {
          if (!merged.paidDate) data.paidDate = startOfDay(new Date());
          if (merged.paidAmount === null || merged.paidAmount === undefined) data.paidAmount = num(merged.amount) + num(merged.lateFee);
        }
        if (
          (merged.unitsConsumed === null || merged.unitsConsumed === undefined) &&
          merged.currentReading !== null && merged.currentReading !== undefined &&
          merged.previousReading !== null && merged.previousReading !== undefined
        ) {
          const units = num(merged.currentReading) - num(merged.previousReading);
          if (units < 0) throw validationFailed([{ field: 'currentReading', message: 'must not be lower than the previous reading' }]);
          data.unitsConsumed = units;
        }
        break;
      }
      case 'salaries': {
        const componentsChanged = !existing || ['baseAmount', 'bonus', 'deductions', 'advanceRecovered'].some((k) => k in data);
        if (componentsChanged && !('netAmount' in data && data.netAmount !== null && data.netAmount !== undefined)) {
          const net = num(merged.baseAmount) + num(merged.bonus) - num(merged.deductions) - num(merged.advanceRecovered);
          if (net < 0) throw validationFailed([{ field: 'deductions', message: 'deductions and recoveries exceed the salary' }]);
          data.netAmount = Math.round(net * 100) / 100;
        }
        if (!merged.dueDate) {
          const staff = await tx.staff.findFirst({ where: { id: merged.staffId, householdId: ctx.householdId } });
          const first = parseDate(`${merged.month}-01`);
          if (first) data.dueDate = dayInMonth(first, staff?.salaryDay ?? 1);
        }
        if (merged.status === 'PAID' && !merged.paidDate) data.paidDate = startOfDay(new Date());
        if (!existing) {
          const dup = await tx.salary.count({ where: { householdId: ctx.householdId, deletedAt: null, staffId: merged.staffId, month: merged.month } });
          if (dup > 0) throw conflict(`A salary record for ${merged.month} already exists for this staff member`, 'DUPLICATE');
        }
        break;
      }
      case 'attendance': {
        if (!existing) {
          const dup = await tx.attendance.count({ where: { householdId: ctx.householdId, deletedAt: null, staffId: merged.staffId, date: merged.date } });
          if (dup > 0) throw conflict('Attendance is already recorded for this staff member on this date', 'DUPLICATE');
        }
        break;
      }
      case 'maintenance-tasks': {
        if (merged.status === 'COMPLETED' && !merged.completedDate) data.completedDate = startOfDay(new Date());
        break;
      }
      case 'work-orders': {
        if (merged.status === 'PAID' && !merged.paidDate) data.paidDate = startOfDay(new Date());
        if (merged.status === 'COMPLETED' && !merged.completedAt) data.completedAt = new Date();
        break;
      }
      case 'documents': {
        if (Array.isArray(data.restrictedToMemberIds) && data.restrictedToMemberIds.length) {
          const ids = data.restrictedToMemberIds as string[];
          if (!ids.every(isUuid)) throw validationFailed([{ field: 'restrictedToMemberIds', message: 'must be member ids' }]);
          const count = await tx.householdMember.count({ where: { id: { in: ids }, householdId: ctx.householdId, deletedAt: null } });
          if (count !== ids.length) throw validationFailed([{ field: 'restrictedToMemberIds', message: 'contains members outside this household' }]);
        }
        if ('sensitivity' in data && !visibleSensitivities(ctx.perms).includes(data.sensitivity)) {
          throw forbidden('You cannot classify a document at a sensitivity level you are not allowed to view');
        }
        break;
      }
      default:
        break;
    }
  }

  private async afterWrite(def: ResourceDef, ctx: Ctx, row: Row, existing: Row | null, tx: Db): Promise<void> {
    if ((LEDGER_SOURCES as readonly string[]).includes(def.key)) await this.syncLedger(def, ctx, row, tx, false);

    switch (def.key) {
      case 'fuel-logs':
      case 'vehicle-services': {
        const vehicle = await tx.vehicle.findFirst({ where: { id: row.vehicleId, householdId: ctx.householdId } });
        if (!vehicle) break;
        const patch: Row = {};
        if (row.odometer && row.odometer > (vehicle.currentOdometer ?? 0)) patch.currentOdometer = row.odometer;
        if (def.key === 'vehicle-services' && ['PERIODIC_SERVICE', 'OIL_CHANGE'].includes(row.serviceType)) {
          const isLatest = !vehicle.lastServiceDate || row.date >= vehicle.lastServiceDate;
          if (isLatest) {
            patch.lastServiceDate = row.date;
            if (row.odometer) patch.lastServiceOdometer = row.odometer;
            if (row.nextServiceDate) patch.nextServiceDate = row.nextServiceDate;
            else if (vehicle.serviceIntervalMonths) {
              const d = new Date(row.date);
              d.setUTCMonth(d.getUTCMonth() + vehicle.serviceIntervalMonths);
              patch.nextServiceDate = d;
            }
            if (row.nextServiceOdometer) patch.nextServiceOdometer = row.nextServiceOdometer;
            else if (vehicle.serviceIntervalKm && row.odometer) patch.nextServiceOdometer = row.odometer + vehicle.serviceIntervalKm;
          }
        }
        if (Object.keys(patch).length) await tx.vehicle.update({ where: { id: vehicle.id }, data: patch });
        break;
      }
      case 'maintenance-tasks': {
        const justCompleted = row.status === 'COMPLETED' && existing?.status !== 'COMPLETED';
        if (justCompleted && row.isRecurring && row.recurrence && row.recurrence !== 'NONE') {
          const from = (row.dueDate as Date | null) ?? (row.completedDate as Date | null) ?? new Date();
          const next = nextOccurrence(from, row.recurrence);
          if (next) {
            await tx.maintenanceTask.create({
              data: {
                householdId: ctx.householdId,
                createdById: ctx.userId,
                title: row.title,
                category: row.category,
                description: row.description,
                priority: row.priority,
                status: 'OPEN',
                dueDate: next,
                propertyId: row.propertyId,
                roomId: row.roomId,
                applianceId: row.applianceId,
                assignedMemberId: row.assignedMemberId,
                vendorId: row.vendorId,
                isRecurring: true,
                recurrence: row.recurrence,
                estimatedCost: row.estimatedCost,
              },
            });
          }
        }
        if (justCompleted && row.applianceId) {
          await tx.appliance.updateMany({
            where: { id: row.applianceId, householdId: ctx.householdId },
            data: { lastServiceDate: row.completedDate ?? new Date() },
          });
        }
        break;
      }
      case 'work-orders': {
        // Keep the vendor's rating as the average of rated work orders.
        if (row.vendorId && row.rating && row.rating !== existing?.rating) {
          const agg = await tx.workOrder.aggregate({
            where: { householdId: ctx.householdId, deletedAt: null, vendorId: row.vendorId, rating: { not: null } },
            _avg: { rating: true },
          });
          if (agg._avg.rating) {
            await tx.vendor.updateMany({ where: { id: row.vendorId, householdId: ctx.householdId }, data: { rating: Math.round(agg._avg.rating * 10) / 10 } });
          }
        }
        break;
      }
      case 'asset-valuations': {
        const asset = await tx.asset.findFirst({ where: { id: row.assetId, householdId: ctx.householdId } });
        if (asset && (!asset.valuationDate || row.date >= asset.valuationDate)) {
          await tx.asset.update({ where: { id: asset.id }, data: { currentValue: row.value, valuationDate: row.date, valuer: row.valuer ?? asset.valuer } });
        }
        break;
      }
      case 'staff-advances':
      default:
        break;
    }
  }

  /**
   * Mirror a source record (paid bill, salary, fuel entry, …) into the expense ledger so that
   * spending totals come from one place. Creates, updates or retires the linked expense.
   */
  async syncLedger(def: ResourceDef, ctx: Ctx, row: Row, tx: Db, deleted: boolean): Promise<void> {
    const related: Parameters<typeof ledgerEntryFor>[2] = {};
    if (!deleted) {
      if (def.key === 'bills') {
        const provider = await tx.billProvider.findFirst({ where: { id: row.providerId, householdId: ctx.householdId } });
        related.providerName = provider?.providerName;
        related.utilityType = provider?.utilityType;
        related.propertyId = provider?.propertyId ?? null;
      } else if (def.key === 'salaries') {
        const staff = await tx.staff.findFirst({ where: { id: row.staffId, householdId: ctx.householdId } });
        related.staffName = staff?.name;
      } else if (def.key === 'fuel-logs' || def.key === 'vehicle-services') {
        const vehicle = await tx.vehicle.findFirst({ where: { id: row.vehicleId, householdId: ctx.householdId } });
        related.vehicleName = vehicle?.name;
      } else if (def.key === 'work-orders') {
        const task = await tx.maintenanceTask.findFirst({ where: { id: row.taskId, householdId: ctx.householdId } });
        related.propertyId = task?.propertyId ?? null;
      }
    }
    const entry = deleted ? null : ledgerEntryFor(def.key, row, related);
    const existing = await tx.expense.findFirst({ where: { householdId: ctx.householdId, sourceType: def.key, sourceId: row.id } });
    if (!entry) {
      if (existing && !existing.deletedAt) await tx.expense.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
      return;
    }
    const data: Row = {
      date: entry.date,
      amount: entry.amount,
      kind: entry.kind,
      category: entry.category,
      description: entry.description,
      merchant: entry.merchant ?? null,
      paymentMethod: entry.paymentMethod ?? null,
      bankAccountId: entry.bankAccountId ?? null,
      propertyId: entry.propertyId ?? null,
      memberId: entry.memberId ?? null,
      vendorId: entry.vendorId ?? null,
      deletedAt: null,
    };
    if (existing) await tx.expense.update({ where: { id: existing.id }, data });
    else {
      await tx.expense.create({
        data: { ...data, householdId: ctx.householdId, createdById: ctx.userId, sourceType: def.key, sourceId: row.id, approvalStatus: 'NOT_REQUIRED', status: 'ACTIVE' },
      });
    }
  }
}

export function fieldByKey(def: ResourceDef, key: string): FieldDef | undefined {
  return def.fields.find((x) => x.key === key);
}

import { Body, Controller, HttpCode, Injectable, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { getResource, isUuid, parseBankCsv, transactionFingerprint, validateRecord } from '@homeos/shared';
import { AuditService } from '../common/audit.service';
import { CurrentCtx, Tenant, need, type Ctx } from '../common/context';
import { badRequest, conflict, forbidden, notFound, validationFailed } from '../common/errors';
import { PrismaService, type Db } from '../prisma.service';
import { ResourceService } from '../resources/resource.service';

const EXPENSES = getResource('expenses');
const TRANSACTIONS = getResource('transactions');
const ACCOUNTS = getResource('bank-accounts');
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: ResourceService,
    private readonly audit: AuditService,
  ) {}

  /** Approve or reject an expense that is waiting for approval. The submitter cannot approve their own. */
  async decide(ctx: Ctx, id: string, approve: boolean, note?: string) {
    need(ctx, 'finance', 'approve');
    const expense = await this.resources.findRow(EXPENSES, ctx, id);
    if (expense.approvalStatus !== 'PENDING') throw conflict('This expense is not waiting for approval');
    if (expense.createdById === ctx.userId) throw forbidden('You cannot approve an expense you entered yourself', 'SELF_APPROVAL');
    const updated = await this.prisma.$transaction(async (tx: Db) => {
      const row = await tx.expense.update({
        where: { id: expense.id },
        data: { approvalStatus: approve ? 'APPROVED' : 'REJECTED', approvedById: ctx.memberId, approvedAt: new Date() },
      });
      await this.audit.log(
        ctx,
        {
          action: approve ? 'approve' : 'reject',
          entityType: 'expenses',
          entityId: expense.id,
          summary: `${approve ? 'Approved' : 'Rejected'} expense "${expense.description}" (${num(expense.amount)})${note ? ` — ${String(note).slice(0, 200)}` : ''}`,
        },
        tx,
      );
      return row;
    });
    return this.resources.present(EXPENSES, updated, true);
  }

  /**
   * Import a bank statement CSV into an account. Rows already imported (same date, amount,
   * direction, description and reference) are skipped; unreadable rows are reported back.
   */
  async importCsv(ctx: Ctx, body: any) {
    need(ctx, 'finance', 'write');
    const bankAccountId = String(body?.bankAccountId ?? '');
    const csv = String(body?.csv ?? '');
    if (!isUuid(bankAccountId)) throw validationFailed([{ field: 'bankAccountId', message: 'is required' }]);
    if (!csv.trim()) throw validationFailed([{ field: 'csv', message: 'is required' }]);
    if (csv.length > 5_000_000) throw badRequest('The statement is too large (maximum 5 MB)');
    const account = await this.resources.findRow(ACCOUNTS, ctx, bankAccountId);
    const parsed = parseBankCsv(csv);
    if (parsed.rows.length === 0) {
      throw badRequest(parsed.errors[0]?.message ?? 'No transactions were found in the file', parsed.errors.map((e) => ({ field: `line ${e.line}`, message: e.message })), 'CSV_UNREADABLE');
    }
    const batch = `csv-${Date.now()}`;
    const fingerprints = parsed.rows.map((r) => transactionFingerprint(r));
    const existing: any[] = await this.prisma.transaction.findMany({
      where: { householdId: ctx.householdId, deletedAt: null, bankAccountId: account.id, fingerprint: { in: fingerprints } },
      select: { fingerprint: true },
    });
    const seen = new Set(existing.map((e) => e.fingerprint));
    let imported = 0;
    let skipped = 0;
    await this.prisma.$transaction(async (tx: Db) => {
      for (let i = 0; i < parsed.rows.length; i++) {
        const r = parsed.rows[i];
        if (seen.has(fingerprints[i])) {
          skipped++;
          continue;
        }
        seen.add(fingerprints[i]);
        const v = validateRecord(TRANSACTIONS, {
          bankAccountId: account.id,
          date: r.date,
          description: r.description.slice(0, 500),
          amount: r.amount,
          direction: r.direction,
          ...(r.reference ? { reference: r.reference.slice(0, 200) } : {}),
          ...(r.balanceAfter !== undefined ? { balanceAfter: r.balanceAfter } : {}),
        });
        if (!v.ok) {
          parsed.errors.push({ line: i + 2, message: v.issues.map((x) => `${x.field} ${x.message}`).join('; ') });
          continue;
        }
        await tx.transaction.create({
          data: { ...v.data, householdId: ctx.householdId, createdById: ctx.userId, source: 'CSV_IMPORT', importBatch: batch, fingerprint: fingerprints[i], duplicateSuspect: false, reconciled: false, status: 'ACTIVE' },
        });
        imported++;
      }
      await this.audit.log(ctx, { action: 'import', entityType: 'transactions', entityId: account.id, summary: `Imported ${imported} bank transactions into ${account.name} (${skipped} already present)` }, tx);
    }, { timeout: 60_000 });
    return { batch, imported, skippedAsDuplicates: skipped, errors: parsed.errors };
  }

  /** Suggest expenses that may correspond to a bank transaction (same amount, within three days). */
  async suggestions(ctx: Ctx, id: string) {
    need(ctx, 'finance', 'read');
    const t = await this.resources.findRow(TRANSACTIONS, ctx, id);
    const from = new Date(t.date.getTime() - 3 * 86_400_000);
    const to = new Date(t.date.getTime() + 4 * 86_400_000);
    const rows: any[] = await this.prisma.expense.findMany({
      where: { ...this.resources.scope(EXPENSES, ctx), amount: t.amount, date: { gte: from, lt: to }, kind: t.direction === 'DEBIT' ? 'EXPENSE' : { in: ['REFUND', 'INCOME'] } },
      take: 10,
      orderBy: { date: 'desc' },
    });
    return rows.map((r) => this.resources.present(EXPENSES, r, false));
  }

  /** Reconcile: link a bank transaction to an existing expense. */
  async match(ctx: Ctx, id: string, body: any) {
    need(ctx, 'finance', 'write');
    const expenseId = body?.expenseId;
    if (expenseId !== null && !isUuid(expenseId)) throw validationFailed([{ field: 'expenseId', message: 'must be an expense id, or null to unlink' }]);
    const row = await this.prisma.$transaction(async (tx: Db) => {
      if (expenseId) await this.resources.findRow(EXPENSES, ctx, expenseId, tx);
      return this.resources.updateInTx(TRANSACTIONS, ctx, id, { matchedExpenseId: expenseId, reconciled: Boolean(expenseId) }, tx, {
        summary: expenseId ? 'Matched a bank transaction to an expense' : 'Unlinked a bank transaction from its expense',
      });
    });
    return this.resources.present(TRANSACTIONS, row, true);
  }

  /** Reconcile: create the expense (or income/refund) for an unmatched bank transaction. */
  async createExpenseFrom(ctx: Ctx, id: string, body: any) {
    need(ctx, 'finance', 'write');
    const result = await this.prisma.$transaction(async (tx: Db) => {
      const t = await this.resources.findRow(TRANSACTIONS, ctx, id, tx);
      if (t.matchedExpenseId) throw conflict('This transaction is already matched to an expense');
      const v = validateRecord(EXPENSES, {
        date: t.date.toISOString().slice(0, 10),
        description: body?.description ? String(body.description) : t.description,
        amount: num(t.amount),
        kind: t.direction === 'DEBIT' ? 'EXPENSE' : body?.kind === 'REFUND' ? 'REFUND' : 'INCOME',
        bankAccountId: t.bankAccountId,
        ...(body?.category ? { category: body.category } : t.category ? { category: t.category } : {}),
        ...(body?.merchant ? { merchant: body.merchant } : {}),
      });
      if (!v.ok) throw validationFailed(v.issues);
      const expense = await this.resources.createInTx(EXPENSES, ctx, v.data, tx);
      const updated = await this.resources.updateInTx(TRANSACTIONS, ctx, t.id, { matchedExpenseId: expense.id, reconciled: true }, tx, {
        summary: 'Created an expense from a bank transaction',
      });
      return { expense, transaction: updated };
    });
    return { expense: this.resources.present(EXPENSES, result.expense, true), transaction: this.resources.present(TRANSACTIONS, result.transaction, true) };
  }
}

@ApiTags('Finance & expenses')
@Controller()
@Tenant()
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Post('expenses/:id/approve')
  @HttpCode(200)
  approve(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: any) {
    return this.finance.decide(ctx, id, true, body?.note);
  }

  @Post('expenses/:id/reject')
  @HttpCode(200)
  reject(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: any) {
    return this.finance.decide(ctx, id, false, body?.note);
  }

  /** Body: { bankAccountId, csv } where csv is the statement file's text. */
  @Post('transactions/import')
  @HttpCode(200)
  importCsv(@CurrentCtx() ctx: Ctx, @Body() body: any) {
    return this.finance.importCsv(ctx, body);
  }

  @Post('transactions/:id/suggestions')
  @HttpCode(200)
  suggestions(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.finance.suggestions(ctx, id);
  }

  @Post('transactions/:id/match')
  @HttpCode(200)
  match(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: any) {
    return this.finance.match(ctx, id, body);
  }

  @Post('transactions/:id/create-expense')
  @HttpCode(200)
  createExpense(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: any) {
    return this.finance.createExpenseFrom(ctx, id, body);
  }
}

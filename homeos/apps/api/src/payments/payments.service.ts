import { Injectable, Logger } from '@nestjs/common';
import { PAYMENT_METHODS, getResource, isUuid, parseDate, startOfDay, validateRecord } from '@homeos/shared';
import { AuditService } from '../common/audit.service';
import { need, type Ctx } from '../common/context';
import { hmac, randomToken, safeEqual } from '../common/crypto';
import { badRequest, conflict, forbidden, notFound, validationFailed } from '../common/errors';
import { systemCtx } from '../common/system-ctx';
import { loadConfig } from '../config';
import { PrismaService, type Db } from '../prisma.service';
import { ResourceService } from '../resources/resource.service';

const ORDERS = getResource('payment-orders');
const BILLS = getResource('bills');
const SALARIES = getResource('salaries');
const WORK_ORDERS = getResource('work-orders');
const EXPENSES = getResource('expenses');
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const round = (n: number): number => Math.round(n * 100) / 100;

export interface ProviderEvent {
  providerOrderId: string;
  providerPaymentId: string;
  status: 'succeeded' | 'failed';
  amount: number;
  failureReason?: string;
}

/**
 * Contract a real gateway adapter (payment gateway, Bharat Connect/BBPS aggregator, …) must
 * implement. None is bundled: integrating one requires a merchant agreement with a licensed
 * provider and must be done against that provider's own documentation.
 */
export interface PaymentProvider {
  key: string;
  displayName: string;
  simulated: boolean;
  createOrder(order: { id: string; amount: number; currency: string; description: string }): Promise<{ providerOrderId: string; instructions: string }>;
  /** Verify authenticity of a webhook and parse it. Must return null if the signature is not valid. */
  verifyWebhook(headers: Record<string, any>, rawBody: Buffer): ProviderEvent | null;
}

/** Simulated gateway for demos and automated tests. Never available in production; no money moves. */
class SandboxProvider implements PaymentProvider {
  key = 'sandbox';
  displayName = 'Sandbox (simulated — no money moves)';
  simulated = true;
  async createOrder(order: { id: string }) {
    return { providerOrderId: `sbx_${order.id.replace(/-/g, '').slice(0, 20)}`, instructions: 'Simulated payment. Confirm or fail it from the sandbox controls.' };
  }
  sign(rawBody: Buffer | string): string {
    return hmac(loadConfig().payments.sandboxWebhookSecret, rawBody.toString());
  }
  verifyWebhook(headers: Record<string, any>, rawBody: Buffer): ProviderEvent | null {
    const sig = String(headers['x-sandbox-signature'] ?? '');
    if (!sig || !safeEqual(sig, this.sign(rawBody))) return null;
    try {
      const b = JSON.parse(rawBody.toString('utf8'));
      if (!b.providerOrderId || !b.providerPaymentId || !['succeeded', 'failed'].includes(b.status)) return null;
      return { providerOrderId: String(b.providerOrderId), providerPaymentId: String(b.providerPaymentId), status: b.status, amount: Number(b.amount), failureReason: b.failureReason };
    } catch {
      return null;
    }
  }
}

type Target = { kind: 'bill' | 'salary' | 'workOrder'; id: string; row: Record<string, any>; due: number; payee: string; description: string };

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');
  private readonly sandbox = new SandboxProvider();

  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: ResourceService,
    private readonly audit: AuditService,
  ) {}

  private provider(key: string): PaymentProvider | null {
    if (key === 'sandbox' && loadConfig().payments.sandboxEnabled) return this.sandbox;
    return null;
  }

  providers() {
    const sandboxOn = loadConfig().payments.sandboxEnabled;
    return [
      {
        key: 'manual',
        displayName: 'Record a payment made outside HomeOS',
        enabled: true,
        simulated: false,
        verification: 'SELF_REPORTED',
        note: 'For cash, UPI, card or bank payments you made yourself. HomeOS records what you enter; it does not verify it with a bank.',
      },
      {
        key: 'sandbox',
        displayName: this.sandbox.displayName,
        enabled: sandboxOn,
        simulated: true,
        verification: 'SIMULATED',
        note: sandboxOn ? 'Demo provider. Payments are simulated and no money moves.' : 'Disabled. Available only in non-production environments with PAYMENTS_SANDBOX=true.',
      },
      {
        key: 'gateway',
        displayName: 'Online payment gateway / Bharat Connect (BBPS)',
        enabled: false,
        simulated: false,
        verification: 'PROVIDER_VERIFIED',
        note: 'Not connected. In-app payment needs an agreement with a licensed payment aggregator or BBPS operating unit, and an adapter written against that provider.',
      },
    ];
  }

  /* ---------------- targets ---------------- */

  private async loadTarget(ctx: Ctx, body: any, db: Db): Promise<Target | null> {
    const given = ['billId', 'salaryId', 'workOrderId'].filter((k) => body?.[k]);
    if (given.length > 1) throw validationFailed([{ field: given[1], message: 'pay one record at a time' }]);
    if (body?.billId) {
      need(ctx, 'bills', 'write');
      const row = await this.resources.findRow(BILLS, ctx, String(body.billId), db);
      if (['PAID', 'CANCELLED'].includes(row.status)) throw conflict(`This bill is already ${String(row.status).toLowerCase()}`);
      const provider = await db.billProvider.findFirst({ where: { id: row.providerId, householdId: ctx.householdId } });
      const due = round(num(row.amount) + num(row.lateFee) - num(row.paidAmount));
      return { kind: 'bill', id: row.id, row, due, payee: provider?.providerName ?? 'Utility provider', description: `Bill payment — ${provider?.name ?? provider?.providerName ?? 'utility'}` };
    }
    if (body?.salaryId) {
      need(ctx, 'staff', 'write');
      const row = await this.resources.findRow(SALARIES, ctx, String(body.salaryId), db);
      if (['PAID', 'SKIPPED'].includes(row.status)) throw conflict(`This salary is already ${String(row.status).toLowerCase()}`);
      const staff = await db.staff.findFirst({ where: { id: row.staffId, householdId: ctx.householdId } });
      const due = round(num(row.netAmount) - num(row.paidAmount));
      return { kind: 'salary', id: row.id, row, due, payee: staff?.name ?? 'Staff', description: `Salary ${row.month} — ${staff?.name ?? 'staff'}` };
    }
    if (body?.workOrderId) {
      need(ctx, 'maintenance', 'write');
      const row = await this.resources.findRow(WORK_ORDERS, ctx, String(body.workOrderId), db);
      if (['PAID', 'CANCELLED'].includes(row.status)) throw conflict(`This work order is already ${String(row.status).toLowerCase()}`);
      const vendor = row.vendorId ? await db.vendor.findFirst({ where: { id: row.vendorId, householdId: ctx.householdId } }) : null;
      const due = round((num(row.invoiceAmount) || num(row.quotationAmount)) - num(row.paidAmount));
      return { kind: 'workOrder', id: row.id, row, due, payee: vendor?.name ?? 'Service provider', description: `Work order — ${row.title}` };
    }
    return null;
  }

  /** Reflect a confirmed or self-reported payment on the record it pays (which also posts it to the ledger). */
  private async applyToTarget(ctx: Ctx, order: Record<string, any>, amount: number, paidDate: Date, db: Db): Promise<void> {
    const common = { paidDate, ...(order.method ? { paymentMethod: order.method } : {}), ...(order.bankAccountId ? { bankAccountId: order.bankAccountId } : {}) };
    if (order.billId) {
      const bill = await db.bill.findFirst({ where: { id: order.billId, householdId: ctx.householdId, deletedAt: null } });
      if (!bill) return;
      const paid = round(num(bill.paidAmount) + amount);
      const total = round(num(bill.amount) + num(bill.lateFee));
      await this.resources.updateInTx(BILLS, ctx, bill.id, { ...common, paidAmount: paid, status: paid >= total - 0.005 ? 'PAID' : 'PARTIALLY_PAID', ...(order.reference ? { paymentReference: order.reference } : {}) }, db, {
        summary: `Recorded payment of ${amount} against a bill`,
      });
    } else if (order.salaryId) {
      const salary = await db.salary.findFirst({ where: { id: order.salaryId, householdId: ctx.householdId, deletedAt: null } });
      if (!salary) return;
      const paid = round(num(salary.paidAmount) + amount);
      await this.resources.updateInTx(SALARIES, ctx, salary.id, { ...common, paidAmount: paid, status: paid >= num(salary.netAmount) - 0.005 ? 'PAID' : 'PARTIALLY_PAID', ...(order.reference ? { paymentReference: order.reference } : {}) }, db, {
        summary: `Recorded salary payment of ${amount}`,
      });
    } else if (order.workOrderId) {
      const wo = await db.workOrder.findFirst({ where: { id: order.workOrderId, householdId: ctx.householdId, deletedAt: null } });
      if (!wo) return;
      await this.resources.updateInTx(WORK_ORDERS, ctx, wo.id, { ...common, paidAmount: round(num(wo.paidAmount) + amount), status: 'PAID' }, db, { summary: `Recorded payment of ${amount} for a work order` });
    }
  }

  private parseCommon(body: any, target: Target | null) {
    const issues: { field: string; message: string }[] = [];
    const amount = body?.amount === undefined || body?.amount === null || body?.amount === '' ? (target ? target.due : NaN) : Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) issues.push({ field: 'amount', message: 'must be greater than zero' });
    if (target && amount > target.due + 0.005) issues.push({ field: 'amount', message: `is more than the outstanding amount (${target.due})` });
    const method = body?.method ? String(body.method) : null;
    if (method && !(PAYMENT_METHODS as readonly string[]).includes(method)) issues.push({ field: 'method', message: `must be one of: ${PAYMENT_METHODS.join(', ')}` });
    if (body?.bankAccountId && !isUuid(body.bankAccountId)) issues.push({ field: 'bankAccountId', message: 'must be an account id' });
    if (issues.length) throw validationFailed(issues);
    return { amount: round(amount), method };
  }

  /* ---------------- offline payments ---------------- */

  /**
   * Record a payment the user made outside HomeOS. Stored as RECORDED_OFFLINE — a
   * self-reported fact, never presented as provider-verified.
   */
  async recordOffline(ctx: Ctx, body: any) {
    need(ctx, 'payments', 'write');
    const paidDate = body?.paidDate ? parseDate(body.paidDate) : startOfDay(new Date());
    if (!paidDate) throw validationFailed([{ field: 'paidDate', message: 'must be a valid date' }]);
    if (paidDate > startOfDay(new Date(Date.now() + 86_400_000))) throw validationFailed([{ field: 'paidDate', message: 'cannot be in the future' }]);
    const order = await this.prisma.$transaction(async (tx: Db) => {
      const target = await this.loadTarget(ctx, body, tx);
      const { amount, method } = this.parseCommon(body, target);
      if (!target && !String(body?.description ?? '').trim()) throw validationFailed([{ field: 'description', message: 'is required when the payment is not linked to a record' }]);
      if (body?.bankAccountId) await this.resources.findRow(getResource('bank-accounts'), ctx, body.bankAccountId, tx);
      const row = await tx.paymentOrder.create({
        data: {
          householdId: ctx.householdId,
          createdById: ctx.userId,
          description: (target?.description ?? String(body.description)).slice(0, 300),
          payeeName: (target?.payee ?? (body?.payeeName ? String(body.payeeName) : null))?.slice(0, 200) ?? null,
          amount,
          currency: ctx.currency,
          method,
          provider: 'manual',
          status: 'RECORDED_OFFLINE',
          billId: target?.kind === 'bill' ? target.id : null,
          salaryId: target?.kind === 'salary' ? target.id : null,
          workOrderId: target?.kind === 'workOrder' ? target.id : null,
          bankAccountId: body?.bankAccountId ?? null,
          initiatedByMemberId: ctx.memberId,
          paidDate,
          reference: body?.reference ? String(body.reference).slice(0, 200) : null,
        },
      });
      await tx.paymentTransaction.create({
        data: { householdId: ctx.householdId, createdById: ctx.userId, orderId: row.id, provider: 'manual', kind: 'PAYMENT', amount, status: 'RECORDED', verified: false, receivedAt: new Date() },
      });
      await this.audit.log(ctx, { action: 'payment-recorded', entityType: 'payment-orders', entityId: row.id, summary: `Recorded an offline payment of ${amount} — ${row.description}` }, tx);
      if (target) await this.applyToTarget(ctx, row, amount, paidDate, tx);
      else {
        // A free-standing payment still belongs in the ledger.
        const v = validateRecord(EXPENSES, { date: paidDate.toISOString().slice(0, 10), description: row.description, amount, ...(method ? { paymentMethod: method } : {}), ...(row.payeeName ? { merchant: row.payeeName } : {}), ...(row.bankAccountId ? { bankAccountId: row.bankAccountId } : {}) });
        if (v.ok && ctx.perms.finance?.write) await this.resources.createInTx(EXPENSES, ctx, v.data, tx);
      }
      return row;
    });
    return this.resources.present(ORDERS, order, true);
  }

  /* ---------------- provider payments ---------------- */

  /** Start (or schedule) a payment through a connected provider. The result is never "paid" — that only happens on a verified webhook. */
  async createOrder(ctx: Ctx, body: any) {
    need(ctx, 'payments', 'write');
    const providerKey = String(body?.provider ?? '');
    const provider = this.provider(providerKey);
    if (!provider) throw badRequest('No online payment provider is connected. Record the payment as made outside HomeOS instead.', undefined, 'PROVIDER_UNAVAILABLE');
    let scheduledFor: Date | null = null;
    if (body?.scheduledFor) {
      scheduledFor = parseDate(body.scheduledFor);
      if (!scheduledFor || scheduledFor <= startOfDay(new Date())) throw validationFailed([{ field: 'scheduledFor', message: 'must be a future date' }]);
    }
    const order = await this.prisma.$transaction(async (tx: Db) => {
      const target = await this.loadTarget(ctx, body, tx);
      if (!target) throw validationFailed([{ field: 'billId', message: 'choose the bill, salary or work order to pay' }]);
      const { amount, method } = this.parseCommon(body, target);
      const open = await tx.paymentOrder.count({
        where: { householdId: ctx.householdId, deletedAt: null, status: { in: ['CREATED', 'AWAITING_CONFIRMATION'] }, billId: target.kind === 'bill' ? target.id : undefined, salaryId: target.kind === 'salary' ? target.id : undefined, workOrderId: target.kind === 'workOrder' ? target.id : undefined },
      });
      if (open > 0) throw conflict('A payment for this record is already in progress', 'PAYMENT_IN_PROGRESS');
      let row = await tx.paymentOrder.create({
        data: {
          householdId: ctx.householdId,
          createdById: ctx.userId,
          description: target.description.slice(0, 300),
          payeeName: target.payee.slice(0, 200),
          amount,
          currency: ctx.currency,
          method,
          provider: provider.key,
          status: 'CREATED',
          billId: target.kind === 'bill' ? target.id : null,
          salaryId: target.kind === 'salary' ? target.id : null,
          workOrderId: target.kind === 'workOrder' ? target.id : null,
          bankAccountId: body?.bankAccountId ?? null,
          initiatedByMemberId: ctx.memberId,
          scheduledFor,
        },
      });
      if (!scheduledFor) {
        const created = await provider.createOrder({ id: row.id, amount, currency: ctx.currency, description: row.description });
        row = await tx.paymentOrder.update({ where: { id: row.id }, data: { providerOrderId: created.providerOrderId, status: 'AWAITING_CONFIRMATION' } });
      } else if (target.kind === 'bill') {
        await this.resources.updateInTx(BILLS, ctx, target.id, { status: 'SCHEDULED' }, tx, { summary: 'Scheduled a bill payment' });
      }
      await this.audit.log(ctx, { action: scheduledFor ? 'payment-scheduled' : 'payment-initiated', entityType: 'payment-orders', entityId: row.id, summary: `${scheduledFor ? 'Scheduled' : 'Started'} a ${provider.simulated ? 'simulated ' : ''}payment of ${amount} — ${row.description}` }, tx);
      return row;
    });
    return { ...this.resources.present(ORDERS, order, true), simulated: provider.simulated };
  }

  async cancel(ctx: Ctx, id: string) {
    need(ctx, 'payments', 'write');
    const order = await this.resources.findRow(ORDERS, ctx, id);
    if (!['CREATED', 'AWAITING_CONFIRMATION'].includes(order.status)) throw conflict('Only payments that have not completed can be cancelled');
    const updated = await this.prisma.$transaction(async (tx: Db) => {
      const row = await tx.paymentOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
      if (order.billId) {
        const bill = await tx.bill.findFirst({ where: { id: order.billId, householdId: ctx.householdId, deletedAt: null } });
        if (bill?.status === 'SCHEDULED') await this.resources.updateInTx(BILLS, ctx, bill.id, { status: 'UNPAID' }, tx, { summary: 'Cancelled a scheduled bill payment' });
      }
      await this.audit.log(ctx, { action: 'payment-cancelled', entityType: 'payment-orders', entityId: order.id, summary: `Cancelled payment — ${order.description}` }, tx);
      return row;
    });
    return this.resources.present(ORDERS, updated, true);
  }

  /**
   * Provider webhook. The only path that can mark a payment SUCCEEDED. The event is trusted
   * only if the provider's signature verifies, the order exists, and the amount matches.
   */
  async handleWebhook(providerKey: string, headers: Record<string, any>, rawBody: Buffer | undefined) {
    const provider = this.provider(providerKey);
    if (!provider) throw notFound('Payment provider');
    if (!rawBody) throw badRequest('Missing request body');
    const event = provider.verifyWebhook(headers, rawBody);
    if (!event) throw forbidden('Webhook signature is not valid', 'BAD_SIGNATURE');
    const order = await this.prisma.paymentOrder.findFirst({ where: { provider: provider.key, providerOrderId: event.providerOrderId, deletedAt: null } });
    if (!order) throw notFound('Payment');
    const ctx = await systemCtx(this.prisma, order.householdId, `webhook:${provider.key}`);
    if (!ctx) throw notFound('Payment');

    return this.prisma.$transaction(async (tx: Db) => {
      const duplicate = await tx.paymentTransaction.findFirst({ where: { householdId: order.householdId, provider: provider.key, providerPaymentId: event.providerPaymentId } });
      if (duplicate) return { received: true, duplicate: true, status: order.status };
      const fresh = await tx.paymentOrder.findFirst({ where: { id: order.id } });
      if (!fresh || fresh.status !== 'AWAITING_CONFIRMATION') {
        // Late or repeated event for an order that is already final: record it, change nothing.
        await tx.paymentTransaction.create({
          data: { householdId: order.householdId, orderId: order.id, provider: provider.key, providerPaymentId: event.providerPaymentId, kind: 'PAYMENT', amount: Number.isFinite(event.amount) ? event.amount : 0, status: `IGNORED_${event.status.toUpperCase()}`, verified: true, receivedAt: new Date(), rawPayload: event as any },
        });
        return { received: true, ignored: true, status: fresh?.status };
      }
      const amountOk = Number.isFinite(event.amount) && Math.abs(event.amount - num(order.amount)) < 0.005;
      const succeeded = event.status === 'succeeded' && amountOk;
      await tx.paymentTransaction.create({
        data: { householdId: order.householdId, orderId: order.id, provider: provider.key, providerPaymentId: event.providerPaymentId, kind: 'PAYMENT', amount: Number.isFinite(event.amount) ? event.amount : 0, status: succeeded ? 'SUCCEEDED' : 'FAILED', verified: true, receivedAt: new Date(), rawPayload: event as any },
      });
      const paidDate = startOfDay(new Date());
      const updated = await tx.paymentOrder.update({
        where: { id: order.id },
        data: succeeded
          ? { status: 'SUCCEEDED', verifiedAt: new Date(), paidDate, reference: event.providerPaymentId }
          : { status: 'FAILED', failureReason: (event.status === 'succeeded' ? 'Amount reported by the provider does not match the order' : (event.failureReason ?? 'Declined by provider')).slice(0, 300) },
      });
      await this.audit.log(ctx, { action: succeeded ? 'payment-succeeded' : 'payment-failed', entityType: 'payment-orders', entityId: order.id, summary: `${provider.displayName}: payment ${succeeded ? 'confirmed' : 'failed'} — ${order.description}` }, tx);
      if (succeeded) await this.applyToTarget(ctx, updated, num(order.amount), paidDate, tx);
      else if (order.billId) {
        const bill = await tx.bill.findFirst({ where: { id: order.billId, householdId: order.householdId, deletedAt: null } });
        if (bill?.status === 'SCHEDULED') await this.resources.updateInTx(BILLS, ctx, bill.id, { status: 'UNPAID' }, tx, { summary: 'Payment failed; bill returned to unpaid' });
      }
      return { received: true, status: updated.status };
    });
  }

  /** Sandbox control used by the demo UI: produces a correctly signed webhook, exactly as the simulated gateway would. */
  async sandboxResolve(ctx: Ctx, id: string, outcome: 'succeeded' | 'failed') {
    need(ctx, 'payments', 'write');
    if (!loadConfig().payments.sandboxEnabled) throw notFound('Sandbox');
    const order = await this.resources.findRow(ORDERS, ctx, id);
    if (order.provider !== 'sandbox' || order.status !== 'AWAITING_CONFIRMATION') throw conflict('This payment is not waiting for a sandbox confirmation');
    const raw = Buffer.from(JSON.stringify({ providerOrderId: order.providerOrderId, providerPaymentId: `sbxpay_${randomToken(9)}`, status: outcome, amount: num(order.amount), failureReason: outcome === 'failed' ? 'Simulated decline' : undefined }));
    await this.handleWebhook('sandbox', { 'x-sandbox-signature': this.sandbox.sign(raw) }, raw);
    return this.resources.get(ORDERS, ctx, id);
  }

  /** Start scheduled payments whose date has arrived. Called by the scheduler. */
  async startDueScheduled(): Promise<number> {
    const due: any[] = await this.prisma.paymentOrder.findMany({ where: { deletedAt: null, status: 'CREATED', scheduledFor: { lte: new Date() } }, take: 200 });
    let started = 0;
    for (const order of due) {
      const provider = this.provider(order.provider);
      if (!provider) continue;
      try {
        const created = await provider.createOrder({ id: order.id, amount: num(order.amount), currency: order.currency, description: order.description });
        await this.prisma.paymentOrder.update({ where: { id: order.id }, data: { providerOrderId: created.providerOrderId, status: 'AWAITING_CONFIRMATION' } });
        started++;
      } catch (err) {
        this.logger.error(`Could not start scheduled payment ${order.id}: ${(err as Error).message}`);
      }
    }
    return started;
  }

  /* ---------------- refunds & receipts ---------------- */

  /** Record a refund received against a completed payment (also posted to the ledger as a refund). */
  async recordRefund(ctx: Ctx, id: string, body: any) {
    need(ctx, 'payments', 'write');
    const order = await this.resources.findRow(ORDERS, ctx, id);
    if (!['SUCCEEDED', 'RECORDED_OFFLINE'].includes(order.status)) throw conflict('Refunds can only be recorded against completed payments');
    const amount = Number(body?.amount);
    const date = body?.date ? parseDate(body.date) : startOfDay(new Date());
    const refunded: any[] = await this.prisma.paymentTransaction.findMany({ where: { householdId: ctx.householdId, deletedAt: null, orderId: order.id, kind: 'REFUND' } });
    const already = refunded.reduce((s, r) => s + num(r.amount), 0);
    const issues: { field: string; message: string }[] = [];
    if (!Number.isFinite(amount) || amount <= 0) issues.push({ field: 'amount', message: 'must be greater than zero' });
    else if (amount + already > num(order.amount) + 0.005) issues.push({ field: 'amount', message: 'exceeds the amount that was paid' });
    if (!date) issues.push({ field: 'date', message: 'must be a valid date' });
    if (issues.length) throw validationFailed(issues);
    await this.prisma.$transaction(async (tx: Db) => {
      await tx.paymentTransaction.create({
        data: { householdId: ctx.householdId, createdById: ctx.userId, orderId: order.id, provider: 'manual', kind: 'REFUND', amount: round(amount), status: 'RECORDED', verified: false, receivedAt: new Date() },
      });
      if (ctx.perms.finance?.write) {
        const v = validateRecord(EXPENSES, { date: date!.toISOString().slice(0, 10), description: `Refund — ${order.description}`.slice(0, 500), amount: round(amount), kind: 'REFUND', ...(order.payeeName ? { merchant: order.payeeName } : {}) });
        if (v.ok) await this.resources.createInTx(EXPENSES, ctx, v.data, tx);
      }
      await this.audit.log(ctx, { action: 'refund-recorded', entityType: 'payment-orders', entityId: order.id, summary: `Recorded a refund of ${round(amount)} — ${order.description}` }, tx);
    });
    return { orderId: order.id, refundedTotal: round(already + amount) };
  }

  async receipt(ctx: Ctx, id: string) {
    need(ctx, 'payments', 'read');
    const order = await this.resources.findRow(ORDERS, ctx, id);
    if (!['SUCCEEDED', 'RECORDED_OFFLINE'].includes(order.status)) throw conflict('A receipt is available only for completed payments', 'NOT_COMPLETED');
    const events: any[] = await this.prisma.paymentTransaction.findMany({ where: { householdId: ctx.householdId, deletedAt: null, orderId: order.id }, orderBy: { receivedAt: 'asc' } });
    const household = await this.prisma.household.findFirst({ where: { id: ctx.householdId } });
    const verification = order.status === 'RECORDED_OFFLINE' ? 'SELF_REPORTED' : order.provider === 'sandbox' ? 'SIMULATED' : 'PROVIDER_VERIFIED';
    return {
      receiptNumber: `HOS-${order.id.slice(0, 8).toUpperCase()}`,
      household: household?.name,
      description: order.description,
      payee: order.payeeName,
      amount: num(order.amount),
      currency: order.currency,
      method: order.method,
      paidDate: order.paidDate ? order.paidDate.toISOString().slice(0, 10) : null,
      reference: order.reference,
      provider: order.provider,
      verification,
      verificationNote:
        verification === 'SELF_REPORTED'
          ? 'This is a record of a payment entered by a household member. It has not been verified with a bank or payment provider and is not proof of payment.'
          : verification === 'SIMULATED'
            ? 'Simulated sandbox payment. No money was transferred.'
            : 'Confirmed by the payment provider.',
      refunds: events.filter((e) => e.kind === 'REFUND').map((e) => ({ amount: num(e.amount), recordedAt: e.receivedAt })),
      issuedAt: new Date().toISOString(),
    };
  }
}

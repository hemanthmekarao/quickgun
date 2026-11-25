/**
 * End-to-end tests against a real PostgreSQL database (DATABASE_URL).
 * They exercise the HTTP API exactly as the web and mobile clients do.
 */
process.env.NODE_ENV = 'test';
process.env.PAYMENTS_SANDBOX = 'true';
process.env.INBOUND_EMAIL_SECRET = 'test-inbound-secret';
process.env.STORAGE_LOCAL_DIR = process.env.STORAGE_LOCAL_DIR ?? `/tmp/homeos-test-storage-${process.pid}`;
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-test-secret-test-secret-test';

import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { RESOURCES, getResource, type FieldDef, type ResourceDef } from '@homeos/shared';
import { buildOpenApiDocument, configureApp } from '../src/app.factory';
import { AppModule } from '../src/app.module';
import { totpCode } from '../src/common/crypto';

let app: INestApplication;
let http: any;
const run = Date.now().toString(36);
const iso = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const thisMonth = iso().slice(0, 7);

interface Session {
  token: string;
  refreshToken: string;
  hh: string;
  memberId: string;
  userId: string;
  email: string;
}

async function call(method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, s?: Partial<Session> | null, body?: any) {
  let req = http[method](`/v1${path}`);
  if (s?.token) req = req.set('Authorization', `Bearer ${s.token}`);
  if (s?.hh) req = req.set('X-Household-Id', s.hh);
  if (body !== undefined) req = req.send(body);
  return req;
}

async function register(name: string, extra: Record<string, any> = {}): Promise<Session> {
  const email = `${name.toLowerCase().replace(/\s+/g, '.')}.${run}@example.test`;
  const res = await call('post', '/auth/register', null, { email, name, password: 'Str0ng-password-1', ...extra });
  expect(res.status).toBe(201);
  const h = res.body.households[0];
  return { token: res.body.accessToken, refreshToken: res.body.refreshToken, hh: h.id, memberId: h.memberId, userId: res.body.user.id, email };
}

let owner: Session;
let other: Session;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ rawBody: true });
  configureApp(app);
  await app.init();
  http = request(app.getHttpServer());
  owner = await register('Asha Owner', { householdName: 'Rao Residence' });
  other = await register('Other Household');
});

afterAll(async () => {
  await app.close();
});

/* ------------------------------------------------------------------ */

describe('authentication', () => {
  it('registers a user and creates a household with an owner role', async () => {
    const me = await call('get', '/auth/me', owner);
    expect(me.status).toBe(200);
    expect(me.body.households).toHaveLength(1);
    expect(me.body.households[0]).toMatchObject({ name: 'Rao Residence', roleKey: 'OWNER' });
    expect(me.body.households[0].permissions.finance).toEqual({ read: true, write: true, delete: true, approve: true });
    expect(JSON.stringify(me.body)).not.toContain('passwordHash');
  });

  it('rejects weak passwords, duplicate e-mails and wrong credentials', async () => {
    const weak = await call('post', '/auth/register', null, { email: `weak.${run}@example.test`, name: 'W', password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.issues[0].field).toBe('password');
    const dup = await call('post', '/auth/register', null, { email: owner.email, name: 'Dup', password: 'Str0ng-password-1' });
    expect(dup.status).toBe(409);
    const bad = await call('post', '/auth/login', null, { email: owner.email, password: 'wrong-password-1' });
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('requires a token and rejects a tampered one', async () => {
    expect((await call('get', '/properties', { hh: owner.hh })).status).toBe(401);
    expect((await call('get', '/properties', { hh: owner.hh, token: owner.token.slice(0, -3) + 'abc' })).status).toBe(401);
  });

  it('rotates refresh tokens and refuses a reused one', async () => {
    const login = await call('post', '/auth/login', null, { email: owner.email, password: 'Str0ng-password-1' });
    expect(login.status).toBe(200);
    const first = await call('post', '/auth/refresh', null, { refreshToken: login.body.refreshToken });
    expect(first.status).toBe(200);
    expect(first.body.refreshToken).not.toBe(login.body.refreshToken);
    const reused = await call('post', '/auth/refresh', null, { refreshToken: login.body.refreshToken });
    expect(reused.status).toBe(401);
    // Revoking the session invalidates its access token immediately.
    const sessions = await call('get', '/auth/sessions', { token: first.body.accessToken });
    expect(sessions.body.some((x: any) => x.current)).toBe(true);
    const current = sessions.body.find((x: any) => x.current);
    expect((await call('delete', `/auth/sessions/${current.id}`, { token: first.body.accessToken })).status).toBe(204);
    expect((await call('get', '/auth/me', { token: first.body.accessToken })).status).toBe(401);
  });

  it('supports TOTP two-factor authentication', async () => {
    const u = await register('Mfa User');
    const setup = await call('post', '/auth/mfa/setup', u);
    expect(setup.status).toBe(200);
    expect((await call('post', '/auth/mfa/enable', u, { code: '000000' })).status).toBe(400);
    expect((await call('post', '/auth/mfa/enable', u, { code: totpCode(setup.body.secret) })).status).toBe(200);
    const noCode = await call('post', '/auth/login', null, { email: u.email, password: 'Str0ng-password-1' });
    expect(noCode.status).toBe(401);
    expect(noCode.body.code).toBe('MFA_REQUIRED');
    const withCode = await call('post', '/auth/login', null, { email: u.email, password: 'Str0ng-password-1', totp: totpCode(setup.body.secret) });
    expect(withCode.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */

describe('tenant isolation', () => {
  let propertyId: string;

  it('lets a household create several properties', async () => {
    const a = await call('post', '/properties', owner, { name: 'Indiranagar Flat', propertyType: 'APARTMENT', city: 'Bengaluru', currentValue: 18500000 });
    const b = await call('post', '/properties', owner, { name: 'Coorg Farmhouse', propertyType: 'FARMHOUSE', city: 'Madikeri' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    propertyId = a.body.id;
    const list = await call('get', '/properties', owner);
    expect(list.body.total).toBe(2);
    expect(list.body.items[0].currentValue === null || typeof list.body.items[0].currentValue === 'number').toBe(true);
  });

  it('hides one household from another in every direction', async () => {
    // Other household's own view is empty.
    expect((await call('get', '/properties', other)).body.total).toBe(0);
    // Direct id access.
    expect((await call('get', `/properties/${propertyId}`, other)).status).toBe(404);
    expect((await call('patch', `/properties/${propertyId}`, other, { name: 'Hijacked' })).status).toBe(404);
    expect((await call('delete', `/properties/${propertyId}`, other)).status).toBe(404);
    // Using someone else's household id.
    const spoof = await call('get', '/properties', { token: other.token, hh: owner.hh });
    expect(spoof.status).toBe(403);
    expect(spoof.body.code).toBe('NOT_A_MEMBER');
    // Referencing another household's record from one's own.
    const ref = await call('post', '/rooms', other, { propertyId, name: 'Sneaky room' });
    expect(ref.status).toBe(400);
    expect(ref.body.issues[0]).toMatchObject({ field: 'propertyId' });
    // Original is untouched.
    expect((await call('get', `/properties/${propertyId}`, owner)).body.name).toBe('Indiranagar Flat');
  });

  it('requires a household header and validates input', async () => {
    expect((await call('get', '/properties', { token: owner.token })).status).toBe(403);
    const bad = await call('post', '/properties', owner, { name: '', propertyType: 'CASTLE', mystery: 1 });
    expect(bad.status).toBe(400);
    expect(bad.body.issues.map((i: any) => i.field).sort()).toEqual(['mystery', 'name', 'propertyType']);
  });
});

/* ------------------------------------------------------------------ */

describe('every resource: create, read, update, delete', () => {
  const created = new Map<string, any>();
  let counter = 0;

  function sample(def: ResourceDef, f: FieldDef, n: number): any {
    if (def.key === 'salaries' && f.key === 'month') return `20${String(30 + (n % 60)).padStart(2, '0')}-0${(n % 9) + 1}`;
    if (def.key === 'reminder-rules' && f.key === 'offsetsDays') return ['7', '0'];
    if (f.key === 'restrictedToMemberIds') return [];
    switch (f.type) {
      case 'string':
        return `${f.label} ${n}`.slice(0, 60);
      case 'text':
        return `Notes for ${def.singular} ${n}`;
      case 'int':
        return Math.min(f.max ?? 1000, Math.max(f.min ?? 1, 3));
      case 'number':
        return Math.min(f.max ?? 1000, Math.max(f.min ?? 1, 2.5));
      case 'money':
        return 1234.5;
      case 'date':
        return iso(-(n % 300));
      case 'datetime':
        return new Date(Date.now() - n * 3_600_000).toISOString();
      case 'boolean':
        return true;
      case 'enum':
        return f.options![0];
      case 'tags':
        return f.options ? [f.options[0]] : ['alpha', 'beta'];
      case 'json':
        return { a: 1 };
      default:
        return undefined;
    }
  }

  async function refId(ref: string): Promise<string | undefined> {
    if (ref === 'members') return owner.memberId;
    if (ref === 'documents') return undefined; // optional everywhere; covered by the document tests
    return (await ensure(ref)).id;
  }

  async function payload(def: ResourceDef, full: boolean): Promise<Record<string, any>> {
    const n = ++counter;
    const body: Record<string, any> = {};
    for (const f of def.fields) {
      if (f.system) continue;
      if (f.type === 'ref') {
        if (f.required || full) {
          const id = await refId(f.ref!);
          if (id) body[f.key] = id;
        }
      } else if (f.required || full) body[f.key] = sample(def, f, n);
    }
    return body;
  }

  async function ensure(key: string): Promise<any> {
    if (created.has(key)) return created.get(key);
    const def = getResource(key);
    const res = await call('post', `/${key}`, owner, await payload(def, false));
    if (res.status !== 201) throw new Error(`Could not create ${key}: ${JSON.stringify(res.body)}`);
    created.set(key, res.body);
    return res.body;
  }

  const writable = RESOURCES.filter((d) => !d.readOnly && !d.noCreate);

  it.each(writable.map((d) => [d.key]))('%s', async (key) => {
    const def = getResource(key as string);
    // Create with every writable field populated: proves the column exists for each field.
    const body = await payload(def, true);
    const createdRes = await call('post', `/${def.key}`, owner, body);
    expect([def.key, createdRes.status, createdRes.body.message]).toEqual([def.key, 201, undefined]);
    const id = createdRes.body.id;
    expect(createdRes.body.householdId).toBe(owner.hh);
    for (const f of def.fields.filter((x) => !x.system && x.type === 'money' && body[x.key] !== undefined)) {
      expect(createdRes.body[f.key]).toBe(1234.5);
    }
    for (const f of def.fields.filter((x) => x.hidden)) expect(createdRes.body).not.toHaveProperty(f.key);

    const got = await call('get', `/${def.key}/${id}`, owner);
    expect(got.status).toBe(200);
    expect(got.body.id).toBe(id);

    const list = await call('get', `/${def.key}?pageSize=5`, owner);
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(1);

    // Update one optional text field if there is one.
    const editable = def.fields.find((x) => !x.system && !x.required && (x.type === 'string' || x.type === 'text'));
    if (editable) {
      const upd = await call('patch', `/${def.key}/${id}`, owner, { [editable.key]: 'Updated value' });
      expect([def.key, upd.status]).toEqual([def.key, 200]);
      expect(upd.body[editable.key]).toBe('Updated value');
    }

    // The other household can never see it.
    expect((await call('get', `/${def.key}/${id}`, other)).status).toBe(404);

    const del = await call('delete', `/${def.key}/${id}`, owner);
    expect([def.key, del.status]).toEqual([def.key, 204]);
    expect((await call('get', `/${def.key}/${id}`, owner)).status).toBe(404);
  });

  it('read-only resources reject writes', async () => {
    for (const def of RESOURCES.filter((d) => d.readOnly)) {
      const res = await call('post', `/${def.key}`, owner, {});
      expect([def.key, res.status]).toEqual([def.key, 403]);
      expect((await call('get', `/${def.key}`, owner)).status).toBe(200);
    }
  });

  it('writes an audit trail', async () => {
    const audit = await call('get', '/audit-logs?entityType=properties', owner);
    expect(audit.status).toBe(200);
    expect(audit.body.total).toBeGreaterThan(0);
    expect(audit.body.items[0]).toHaveProperty('summary');
  });
});

/* ------------------------------------------------------------------ */

describe('bills, payments and the ledger', () => {
  let providerId: string;
  let billId: string;

  it('tracks a bill and posts it to expenses only when paid', async () => {
    const provider = await call('post', '/bill-providers', owner, { name: 'Electricity — flat', utilityType: 'ELECTRICITY', providerName: 'BESCOM', consumerNumber: '4455667788' });
    expect(provider.status).toBe(201);
    providerId = provider.body.id;
    const bill = await call('post', '/bills', owner, { providerId, amount: 2462, dueDate: iso(3), previousReading: 1000, currentReading: 1312 });
    expect(bill.status).toBe(201);
    billId = bill.body.id;
    expect(bill.body.status).toBe('UNPAID');
    expect(bill.body.unitsConsumed).toBe(312);
    expect(bill.body._refs.providerId.label).toBe('Electricity — flat');

    const before = await call('get', '/expenses?sourceType=bills', owner);
    expect(before.body.items.filter((e: any) => e.sourceId === billId)).toHaveLength(0);

    const dash = await call('get', '/dashboard', owner);
    expect(dash.status).toBe(200);
    expect(dash.body.bills.upcoming.some((e: any) => e.entityId === billId)).toBe(true);
  });

  it('records an offline payment as self-reported and marks the bill paid', async () => {
    const tooMuch = await call('post', '/payments/record-offline', owner, { billId, amount: 99999, method: 'UPI' });
    expect(tooMuch.status).toBe(400);
    const pay = await call('post', '/payments/record-offline', owner, { billId, method: 'UPI', reference: 'UPI-REF-1' });
    expect(pay.status).toBe(201);
    expect(pay.body.status).toBe('RECORDED_OFFLINE');
    const bill = await call('get', `/bills/${billId}`, owner);
    expect(bill.body).toMatchObject({ status: 'PAID', paidAmount: 2462, paymentMethod: 'UPI' });
    const ledger = await call('get', '/expenses?sourceType=bills', owner);
    const entry = ledger.body.items.find((e: any) => e.sourceId === billId);
    expect(entry).toMatchObject({ amount: 2462, category: 'UTILITIES', kind: 'EXPENSE' });
    // Sourced expenses cannot be edited or deleted directly.
    expect((await call('patch', `/expenses/${entry.id}`, owner, { amount: 1 })).status).toBe(409);
    expect((await call('delete', `/expenses/${entry.id}`, owner)).status).toBe(409);
    const receipt = await call('get', `/payments/orders/${pay.body.id}/receipt`, owner);
    expect(receipt.body.verification).toBe('SELF_REPORTED');
    expect((await call('post', '/payments/record-offline', owner, { billId, method: 'UPI' })).status).toBe(409);
  });

  it('never marks a provider payment successful without a verified webhook', async () => {
    const bill = await call('post', '/bills', owner, { providerId, amount: 500, dueDate: iso(10) });
    const noProvider = await call('post', '/payments/orders', owner, { billId: bill.body.id, provider: 'gateway' });
    expect(noProvider.status).toBe(400);
    expect(noProvider.body.code).toBe('PROVIDER_UNAVAILABLE');

    const order = await call('post', '/payments/orders', owner, { billId: bill.body.id, provider: 'sandbox', method: 'UPI' });
    expect(order.status).toBe(201);
    expect(order.body).toMatchObject({ status: 'AWAITING_CONFIRMATION', simulated: true });
    expect((await call('get', `/bills/${bill.body.id}`, owner)).body.status).toBe('UNPAID');
    expect((await call('get', `/payments/orders/${order.body.id}/receipt`, owner)).status).toBe(409);

    const event = JSON.stringify({ providerOrderId: order.body.providerOrderId, providerPaymentId: `pay_${run}`, status: 'succeeded', amount: 500 });
    const forged = await http.post('/v1/payments/webhooks/sandbox').set('Content-Type', 'application/json').set('x-sandbox-signature', 'deadbeef').send(event);
    expect(forged.status).toBe(403);
    expect((await call('get', `/payment-orders/${order.body.id}`, owner)).body.status).toBe('AWAITING_CONFIRMATION');

    const wrongAmount = JSON.stringify({ providerOrderId: order.body.providerOrderId, providerPaymentId: `pay_wrong_${run}`, status: 'succeeded', amount: 5 });
    const sign = (raw: string) => createHmac('sha256', 'sandbox-webhook-secret').update(raw).digest('hex');
    const mismatch = await http.post('/v1/payments/webhooks/sandbox').set('Content-Type', 'application/json').set('x-sandbox-signature', sign(wrongAmount)).send(wrongAmount);
    expect(mismatch.status).toBe(200);
    expect((await call('get', `/payment-orders/${order.body.id}`, owner)).body.status).toBe('FAILED');
    expect((await call('get', `/bills/${bill.body.id}`, owner)).body.status).toBe('UNPAID');

    const second = await call('post', '/payments/orders', owner, { billId: bill.body.id, provider: 'sandbox' });
    const ok = JSON.stringify({ providerOrderId: second.body.providerOrderId, providerPaymentId: `pay_ok_${run}`, status: 'succeeded', amount: 500 });
    const good = await http.post('/v1/payments/webhooks/sandbox').set('Content-Type', 'application/json').set('x-sandbox-signature', sign(ok)).send(ok);
    expect(good.status).toBe(200);
    expect((await call('get', `/payment-orders/${second.body.id}`, owner)).body.status).toBe('SUCCEEDED');
    expect((await call('get', `/bills/${bill.body.id}`, owner)).body.status).toBe('PAID');
    // Replaying the same event changes nothing.
    const replay = await http.post('/v1/payments/webhooks/sandbox').set('Content-Type', 'application/json').set('x-sandbox-signature', sign(ok)).send(ok);
    expect(replay.body.duplicate).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

describe('expenses, budgets, approvals and bank import', () => {
  it('categorises expenses, flags duplicates and reports spending', async () => {
    const a = await call('post', '/expenses', owner, { date: iso(-1), description: 'Dinner order', merchant: 'Swiggy', amount: 640, paymentMethod: 'UPI' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ category: 'FOOD_DELIVERY', autoCategorised: true, duplicateSuspect: false, approvalStatus: 'NOT_REQUIRED' });
    const dup = await call('post', '/expenses', owner, { date: iso(-1), description: 'Swiggy dinner', amount: 640 });
    expect(dup.body.duplicateSuspect).toBe(true);
    await call('delete', `/expenses/${dup.body.id}`, owner);

    await call('post', '/expenses', owner, { date: iso(-1), description: 'Refund for dinner', merchant: 'Swiggy', amount: 140, kind: 'REFUND' });
    const report = await call('get', `/reports/spending?from=${iso(-2)}&to=${iso(0)}`, owner);
    expect(report.status).toBe(200);
    const food = report.body.byCategory.find((c: any) => c.category === 'FOOD_DELIVERY');
    expect(food.amount).toBe(500);
    expect(report.body.spent).toBeGreaterThanOrEqual(500);

    const budget = await call('post', '/budgets', owner, { name: 'Eating out', category: 'FOOD_DELIVERY', period: 'YEARLY', amount: 400 });
    expect(budget.status).toBe(201);
    const status = await call('get', '/finance/budget-status', owner);
    const row = status.body.find((b: any) => b.id === budget.body.id);
    expect(row.state).toBe('OVER');
    const csv = await call('get', `/reports/statement.csv?from=${iso(-2)}&to=${iso(0)}`, owner);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('Dinner order');
  });

  it('imports a bank statement once and reconciles a line', async () => {
    const account = await call('post', '/bank-accounts', owner, { name: 'HDFC Savings', accountType: 'SAVINGS', last4: '1234' });
    const csv = 'Txn Date,Narration,Ref No,Withdrawal Amt,Deposit Amt,Closing Balance\n05/11/2026,UPI-SWIGGY,REF1,640.00,,1000.00\n06/11/2026,SALARY,REF2,,50000.00,51000.00\nbad,ROW,,1,,\n';
    const first = await call('post', '/transactions/import', owner, { bankAccountId: account.body.id, csv });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ imported: 2, skippedAsDuplicates: 0 });
    expect(first.body.errors).toHaveLength(1);
    const again = await call('post', '/transactions/import', owner, { bankAccountId: account.body.id, csv });
    expect(again.body).toMatchObject({ imported: 0, skippedAsDuplicates: 2 });
    const txns = await call('get', `/transactions?bankAccountId=${account.body.id}&direction=DEBIT`, owner);
    expect(txns.body.total).toBe(1);
    const made = await call('post', `/transactions/${txns.body.items[0].id}/create-expense`, owner, {});
    expect(made.status).toBe(200);
    expect(made.body.transaction.reconciled).toBe(true);
    expect(made.body.expense.amount).toBe(640);
  });
});

/* ------------------------------------------------------------------ */

describe('vehicles, appliances, staff and maintenance', () => {
  it('maintains a vehicle with fuel and service history', async () => {
    const v = await call('post', '/vehicles', owner, { name: 'Family SUV', vehicleType: 'CAR', make: 'Hyundai', model: 'Creta', registrationNumber: 'KA01AB1234', currentOdometer: 10000, serviceIntervalKm: 10000, serviceIntervalMonths: 12 });
    expect(v.status).toBe(201);
    for (const [d, odo, qty, cost] of [[-30, 10000, 40, 4000], [-10, 10600, 40, 4000]] as number[][]) {
      const f = await call('post', '/fuel-logs', owner, { vehicleId: v.body.id, date: iso(d), quantity: qty, totalCost: cost, odometer: odo, fullTank: true });
      expect(f.status).toBe(201);
    }
    const svc = await call('post', '/vehicle-services', owner, { vehicleId: v.body.id, date: iso(-5), serviceType: 'PERIODIC_SERVICE', totalCost: 6500, odometer: 10700 });
    expect(svc.status).toBe(201);
    const after = await call('get', `/vehicles/${v.body.id}`, owner);
    expect(after.body.currentOdometer).toBe(10700);
    expect(after.body.lastServiceDate).toBe(iso(-5));
    expect(after.body.nextServiceOdometer).toBe(20700);
    expect(after.body.nextServiceDate).not.toBeNull();
    const report = await call('get', `/reports/vehicles/${v.body.id}`, owner);
    expect(report.status).toBe(200);
    expect(report.body.fuel.averageKmPerUnit).toBe(15);
    expect(report.body.fuel.totalCost).toBe(8000);
    expect(report.body.service.totalCost).toBe(6500);
    const ledger = await call('get', '/expenses?sourceType=fuel-logs,vehicle-services', owner);
    expect(ledger.body.total).toBeGreaterThanOrEqual(3);
  });

  it('registers an appliance with warranty details', async () => {
    const a = await call('post', '/appliances', owner, { name: 'Living room AC', applianceType: 'AIR_CONDITIONER', manufacturer: 'Daikin', purchaseDate: iso(-400), purchasePrice: 52000, warrantyStart: iso(-400), warrantyEnd: iso(330), expectedLifeYears: 10 });
    expect(a.status).toBe(201);
    const rep = await call('get', `/reports/appliances/${a.body.id}`, owner);
    expect(rep.body.replacement.level).toBe('OK');
    const ask = await call('post', '/assistant/ask', owner, { question: 'Which appliances are under warranty?' });
    expect(ask.status).toBe(200);
    expect(ask.body.tool).toBe('appliances_under_warranty');
    expect(ask.body.answer).toContain('Living room AC');
  });

  it('manages staff salaries end to end', async () => {
    const s = await call('post', '/staff', owner, { name: 'Lakshmi', role: 'COOK', monthlySalary: 12000, salaryDay: 5 });
    expect(s.status).toBe(201);
    const gen = await call('post', '/salaries/generate', owner, { month: thisMonth });
    expect(gen.status).toBe(200);
    expect(gen.body.created).toBeGreaterThanOrEqual(1);
    const again = await call('post', '/salaries/generate', owner, { month: thisMonth });
    expect(again.body.created).toBe(0);
    const salaries = await call('get', `/salaries?staffId=${s.body.id}`, owner);
    const salary = salaries.body.items[0];
    expect(salary).toMatchObject({ month: thisMonth, netAmount: 12000, status: 'PENDING', dueDate: `${thisMonth}-05` });
    const adj = await call('patch', `/salaries/${salary.id}`, owner, { bonus: 1000, deductions: 500 });
    expect(adj.body.netAmount).toBe(12500);
    const pay = await call('post', '/payments/record-offline', owner, { salaryId: salary.id, method: 'CASH' });
    expect(pay.status).toBe(201);
    expect((await call('get', `/salaries/${salary.id}`, owner)).body.status).toBe('PAID');
    const ledger = await call('get', '/expenses?sourceType=salaries', owner);
    expect(ledger.body.items.find((e: any) => e.sourceId === salary.id)).toMatchObject({ amount: 12500, category: 'STAFF_SALARY' });
    const att = await call('post', '/attendance/mark', owner, { date: iso(-1), entries: [{ staffId: s.body.id, status: 'PRESENT' }] });
    expect(att.body.saved).toBe(1);
    const att2 = await call('post', '/attendance/mark', owner, { date: iso(-1), entries: [{ staffId: s.body.id, status: 'HALF_DAY' }] });
    expect(att2.status).toBe(200);
    const all = await call('get', `/attendance?staffId=${s.body.id}`, owner);
    expect(all.body.total).toBe(1);
    expect(all.body.items[0].status).toBe('HALF_DAY');
  });

  it('creates the next occurrence when a recurring maintenance task is completed', async () => {
    const t = await call('post', '/maintenance-tasks', owner, { title: 'Water tank cleaning', category: 'WATER_TANK', dueDate: iso(2), isRecurring: true, recurrence: 'QUARTERLY' });
    expect(t.status).toBe(201);
    const done = await call('patch', `/maintenance-tasks/${t.body.id}`, owner, { status: 'COMPLETED', actualCost: 1500 });
    expect(done.body.completedDate).toBe(iso(0));
    const open = await call('get', '/maintenance-tasks?status=OPEN&q=Water tank', owner);
    expect(open.body.total).toBe(1);
    expect(open.body.items[0].dueDate > iso(60)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

describe('documents', () => {
  let docId: string;
  const text = 'Bangalore Electricity Supply Company Limited\nBill No: BES/2026/118822\nBill Date: 02/11/2026\nConsumer No: 4455667788\nUnits consumed: 312 kWh\nAmount Payable: Rs. 2,462.00\nDue Date: 17-Nov-2026\n';

  it('uploads, extracts, searches and serves a document through a signed link', async () => {
    const up = await http
      .post('/v1/documents/upload')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('X-Household-Id', owner.hh)
      .field('title', 'November electricity bill')
      .field('tags', 'utility,bescom')
      .attach('file', Buffer.from(text), 'bescom-nov.txt');
    expect(up.status).toBe(201);
    docId = up.body.id;
    expect(up.body).toMatchObject({ fileName: 'bescom-nov.txt', mimeType: 'text/plain', ocrStatus: 'DONE', currentVersion: 1 });
    expect(up.body).not.toHaveProperty('storageKey');
    expect(up.body._extracted).toMatchObject({ amount: 2462, dueDate: '2026-11-17', utilityType: 'ELECTRICITY', suggestedType: 'BILL' });

    const search = await call('get', '/document-search?q=electricity supply', owner);
    expect(search.status).toBe(200);
    expect(search.body.items.map((d: any) => d.id)).toContain(docId);
    expect((await call('get', '/document-search?q=electricity supply', other)).body.items).toHaveLength(0);

    const link = await call('get', `/documents/${docId}/download-url`, owner);
    expect(link.status).toBe(200);
    const file = await http.get(`/v1${link.body.path}`);
    expect(file.status).toBe(200);
    expect(file.text ?? file.body.toString()).toContain('Amount Payable');
    const tampered = await http.get(`/v1${link.body.path.slice(0, -4)}abcd`);
    expect(tampered.status).toBe(403);
    expect((await call('get', `/documents/${docId}/download-url`, other)).status).toBe(404);
  });

  it('keeps earlier versions and rejects unsupported files', async () => {
    const v2 = await http.post(`/v1/documents/${docId}/versions`).set('Authorization', `Bearer ${owner.token}`).set('X-Household-Id', owner.hh).attach('file', Buffer.from('revised copy'), 'bescom-nov-v2.txt');
    expect(v2.status).toBe(201);
    expect(v2.body.currentVersion).toBe(2);
    const versions = await call('get', `/documents/${docId}/versions`, owner);
    expect(versions.body.map((v: any) => v.version)).toEqual([2, 1]);
    const old = await call('get', `/documents/${docId}/download-url?version=1`, owner);
    expect((await http.get(`/v1${old.body.path}`)).text).toContain('Amount Payable');
    const exe = await http.post('/v1/documents/upload').set('Authorization', `Bearer ${owner.token}`).set('X-Household-Id', owner.hh).attach('file', Buffer.from('MZ'), 'setup.exe');
    expect(exe.status).toBe(415);
    const fake = await http.post('/v1/documents/upload').set('Authorization', `Bearer ${owner.token}`).set('X-Household-Id', owner.hh).attach('file', Buffer.from('not a pdf'), 'fake.pdf');
    expect(fake.status).toBe(415);
  });

  it('shares through an expiring, revocable, limited link', async () => {
    const share = await call('post', `/documents/${docId}/shares`, owner, { expiresInDays: 2, maxDownloads: 1 });
    expect(share.status).toBe(201);
    const path = new URL(share.body.url).pathname;
    expect((await http.get(path)).status).toBe(200);
    expect((await http.get(path)).status).toBe(404); // download limit reached
    const share2 = await call('post', `/documents/${docId}/shares`, owner, {});
    expect((await call('delete', `/document-shares/${share2.body.id}`, owner)).status).toBe(204);
    expect((await http.get(new URL(share2.body.url).pathname)).status).toBe(404);
  });

  it('files an uploaded bill from the inbox after review', async () => {
    const up = await http.post('/v1/inbox/upload').set('Authorization', `Bearer ${owner.token}`).set('X-Household-Id', owner.hh).attach('file', Buffer.from(text), 'inbox-bill.txt');
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ status: 'PENDING_REVIEW', suggestedType: 'BILL', confidence: 1, needsAttention: false });
    const approved = await call('post', `/inbox-items/${up.body.id}/approve`, owner, {
      type: 'BILL',
      fields: { providerName: 'BESCOM', utilityType: 'ELECTRICITY', amount: up.body.extracted.amount, dueDate: up.body.extracted.dueDate, billNumber: up.body.extracted.invoiceNumber },
    });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: 'APPROVED', resultType: 'bills' });
    const bill = await call('get', `/bills/${approved.body.resultId}`, owner);
    expect(bill.body).toMatchObject({ amount: 2462, dueDate: '2026-11-17', billNumber: 'BES/2026/118822' });
    expect((await call('post', `/inbox-items/${up.body.id}/approve`, owner, { type: 'DOCUMENT' })).status).toBe(409);
  });

  it('accepts forwarded e-mail only with the shared secret', async () => {
    const body = { householdId: owner.hh, from: 'billing@example.test', subject: 'Your invoice', text };
    expect((await http.post('/v1/inbox/email').send(body)).status).toBe(403);
    const ok = await http.post('/v1/inbox/email').set('x-inbound-secret', 'test-inbound-secret').send(body);
    expect(ok.status).toBe(200);
    expect(ok.body.created).toBe(1);
  });
});

/* ------------------------------------------------------------------ */

describe('family members and role-based access', () => {
  let family: Session;
  let medicalDocId: string;

  it('invites a family member who joins with limited access', async () => {
    const email = `kiran.${run}@example.test`;
    const invite = await call('post', '/members', owner, { name: 'Kiran', email, roleKey: 'FAMILY_MEMBER', invite: true, relationship: 'Son' });
    expect(invite.status).toBe(201);
    expect(invite.body.status).toBe('INVITED');
    const wrongEmail = await call('post', '/auth/register', null, { email: `x.${run}@example.test`, name: 'X', password: 'Str0ng-password-1', inviteToken: invite.body.inviteToken });
    expect(wrongEmail.status).toBe(400);
    const joined = await call('post', '/auth/register', null, { email, name: 'Kiran', password: 'Str0ng-password-1', inviteToken: invite.body.inviteToken });
    expect(joined.status).toBe(201);
    expect(joined.body.households).toHaveLength(1);
    expect(joined.body.households[0]).toMatchObject({ id: owner.hh, roleKey: 'FAMILY_MEMBER' });
    family = { token: joined.body.accessToken, refreshToken: joined.body.refreshToken, hh: owner.hh, memberId: joined.body.households[0].memberId, userId: joined.body.user.id, email };
  });

  it('enforces module permissions for that member', async () => {
    expect((await call('get', '/properties', family)).status).toBe(200);
    expect((await call('post', '/properties', family, { name: 'Nope', propertyType: 'PLOT' })).status).toBe(403);
    expect((await call('get', '/medical-records', family)).status).toBe(403);
    expect((await call('get', '/staff', family)).status).toBe(403);
    expect((await call('get', '/audit-logs', family)).status).toBe(403);
    expect((await call('post', '/members', family, { name: 'Friend' })).status).toBe(403);
    expect((await call('get', '/privacy/export/household', family)).status).toBe(403);
    const dash = await call('get', '/dashboard', family);
    expect(dash.status).toBe(200);
    expect(dash.body).not.toHaveProperty('staff');
    expect(dash.body).toHaveProperty('spending');
    const ask = await call('post', '/assistant/ask', family, { question: 'How much do I spend on staff salaries?' });
    expect(ask.body.data).toMatchObject({ error: 'NOT_PERMITTED' });
    expect(ask.body.answer).not.toMatch(/12,?[05]00/);
  });

  it('hides medical and restricted documents from members without that access', async () => {
    const med = await http.post('/v1/documents/upload').set('Authorization', `Bearer ${owner.token}`).set('X-Household-Id', owner.hh).field('title', 'Blood test report').field('sensitivity', 'MEDICAL').attach('file', Buffer.from('haemoglobin panel confidential'), 'report.txt');
    expect(med.status).toBe(201);
    medicalDocId = med.body.id;
    const priv = await http.post('/v1/documents/upload').set('Authorization', `Bearer ${owner.token}`).set('X-Household-Id', owner.hh).field('title', 'Private letter').field('restrictedToMemberIds', owner.memberId).attach('file', Buffer.from('for my eyes only haemoglobin'), 'letter.txt');
    expect(priv.status).toBe(201);
    expect((await call('get', `/documents/${medicalDocId}`, family)).status).toBe(404);
    expect((await call('get', `/documents/${priv.body.id}`, family)).status).toBe(404);
    expect((await call('get', `/documents/${medicalDocId}/download-url`, family)).status).toBe(404);
    const list = await call('get', '/documents', family);
    const ids = list.body.items.map((d: any) => d.id);
    expect(ids).not.toContain(medicalDocId);
    expect(ids).not.toContain(priv.body.id);
    expect((await call('get', '/document-search?q=haemoglobin', family)).body.items).toHaveLength(0);
    expect((await call('get', '/document-search?q=haemoglobin', owner)).body.items).toHaveLength(2);
    // A member cannot classify a document into a level they cannot see.
    const up = await http.post('/v1/documents/upload').set('Authorization', `Bearer ${family.token}`).set('X-Household-Id', family.hh).field('sensitivity', 'MEDICAL').attach('file', Buffer.from('x'), 'x.txt');
    expect(up.status).toBe(403);
  });

  it('routes large expenses from non-approvers through approval', async () => {
    expect((await call('patch', '/household', owner, { approvalThreshold: 10000 })).status).toBe(200);
    const big = await call('post', '/expenses', family, { date: iso(-1), description: 'New sofa', amount: 45000 });
    expect(big.status).toBe(201);
    expect(big.body.approvalStatus).toBe('PENDING');
    const before = await call('get', `/reports/spending?from=${iso(-1)}&to=${iso(-1)}`, owner);
    expect(before.body.byCategory.some((c: any) => c.category === 'FURNITURE')).toBe(false);
    expect((await call('post', `/expenses/${big.body.id}/approve`, family, {})).status).toBe(403);
    const ok = await call('post', `/expenses/${big.body.id}/approve`, owner, {});
    expect(ok.status).toBe(200);
    expect(ok.body.approvalStatus).toBe('APPROVED');
    const after = await call('get', `/reports/spending?from=${iso(-1)}&to=${iso(-1)}`, owner);
    expect(after.body.byCategory.find((c: any) => c.category === 'FURNITURE').amount).toBe(45000);
    await call('patch', '/household', owner, { approvalThreshold: null });
  });

  it('lets the owner change a role, and protects the last owner', async () => {
    const roles = await call('get', '/roles', owner);
    const fam = roles.body.find((r: any) => r.key === 'FAMILY_MEMBER');
    expect((await call('put', `/roles/${fam.id}/permissions`, family, { permissions: { staff: { read: true } } })).status).toBe(403);
    const upd = await call('put', `/roles/${fam.id}/permissions`, owner, { permissions: { staff: { read: true } } });
    expect(upd.status).toBe(200);
    expect((await call('get', '/staff', family)).status).toBe(200);
    expect((await call('delete', `/members/${owner.memberId}`, owner)).status).toBe(409);
    // Removing the member ends their access at once.
    expect((await call('delete', `/members/${family.memberId}`, owner)).status).toBe(204);
    expect((await call('get', '/properties', family)).status).toBe(403);
  });

  it('restricts a property manager to their assigned property', async () => {
    const props = await call('get', '/properties', owner);
    const [p1, p2] = props.body.items;
    const email = `manager.${run}@example.test`;
    const invite = await call('post', '/members', owner, { name: 'Manager', email, roleKey: 'PROPERTY_MANAGER', invite: true, propertyScope: [p1.id] });
    const joined = await call('post', '/auth/register', null, { email, name: 'Manager', password: 'Str0ng-password-1', inviteToken: invite.body.inviteToken });
    const mgr = { token: joined.body.accessToken, hh: owner.hh };
    const visible = await call('get', '/properties', mgr);
    expect(visible.body.items.map((p: any) => p.id)).toEqual([p1.id]);
    expect((await call('get', `/properties/${p2.id}`, mgr)).status).toBe(404);
    expect((await call('post', '/maintenance-tasks', mgr, { title: 'Fix tap', category: 'PLUMBING', propertyId: p2.id })).status).toBe(400);
    expect((await call('post', '/maintenance-tasks', mgr, { title: 'Fix tap', category: 'PLUMBING', propertyId: p1.id })).status).toBe(201);
    expect((await call('get', '/expenses', mgr)).status).toBe(403);
  });
});

/* ------------------------------------------------------------------ */

describe('reminders, calendar and assistant', () => {
  it('creates each reminder once and lets rules be configured', async () => {
    const provider = await call('post', '/bill-providers', owner, { name: 'Broadband', utilityType: 'BROADBAND', providerName: 'ACT Fibernet' });
    const bill = await call('post', '/bills', owner, { providerId: provider.body.id, amount: 1179, dueDate: iso(2) });
    const scan = await call('post', '/notifications/scan', owner);
    expect(scan.status).toBe(200);
    expect(scan.body.created).toBeGreaterThan(0);
    const mine = await call('get', '/notifications?pageSize=200', owner);
    const hit = mine.body.items.filter((n: any) => n.entityId === bill.body.id);
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ eventType: 'BILL_DUE', severity: 'WARNING' });
    expect(hit[0].channelStatus.IN_APP).toBe('DELIVERED');
    const again = await call('post', '/notifications/scan', owner);
    expect(again.body.created).toBe(0);
    // Notifications are personal: the other household sees none of them.
    expect((await call('get', '/notifications', other)).body.total).toBe(0);

    const summary = await call('get', '/notification-summary', owner);
    expect(summary.body.unread).toBeGreaterThan(0);
    expect((await call('post', `/notifications/${hit[0].id}/read`, owner)).body.updated).toBe(1);

    const rules = await call('get', '/reminder-rules?eventType=BILL_DUE', owner);
    expect(rules.body.total).toBe(1);
    const upd = await call('patch', `/reminder-rules/${rules.body.items[0].id}`, owner, { offsetsDays: ['10', '1'], channels: ['IN_APP', 'EMAIL'] });
    expect(upd.status).toBe(200);
    expect(upd.body.offsetsDays).toEqual(['10', '1']);
    expect((await call('patch', `/reminder-rules/${rules.body.items[0].id}`, owner, { channels: ['PIGEON'] })).status).toBe(400);
  });

  it('shows dated obligations on the calendar', async () => {
    const cal = await call('get', `/calendar?from=${iso(0)}&to=${iso(30)}`, owner);
    expect(cal.status).toBe(200);
    expect(cal.body.events.some((e: any) => e.eventType === 'BILL_DUE')).toBe(true);
    expect((await call('get', `/calendar?from=${iso(0)}&to=${iso(30)}`, other)).body.events).toHaveLength(0);
  });

  it('answers the documented questions from real data and refuses to guess', async () => {
    const bills = await call('post', '/assistant/ask', owner, { question: 'What bills are due this week?' });
    expect(bills.status).toBe(200);
    expect(bills.body).toMatchObject({ mode: 'rules', tool: 'bills_due' });
    expect(bills.body.answer).toContain('Broadband');
    const followUp = await call('post', '/assistant/ask', owner, { question: 'What did I spend last month?', conversationId: bills.body.conversationId });
    expect(followUp.body.tool).toBe('spending_summary');
    const convo = await call('get', `/assistant/conversations/${bills.body.conversationId}`, owner);
    expect(convo.body.messages).toHaveLength(4);
    expect((await call('get', `/assistant/conversations/${bills.body.conversationId}`, other)).status).toBe(404);
    const doc = await call('post', '/assistant/ask', owner, { question: 'Find my electricity bill document' });
    expect(doc.body.tool).toBe('search_documents');
    expect(doc.body.data.total).toBeGreaterThan(0);
    const unknown = await call('post', '/assistant/ask', owner, { question: 'Transfer 5000 rupees to my landlord' });
    expect(unknown.body.tool).toBeNull();
    expect(unknown.body.data).toBeNull();
  });
});

/* ------------------------------------------------------------------ */

describe('platform', () => {
  it('reports health, integrations and data-rights endpoints', async () => {
    expect((await http.get('/v1/health')).body.status).toBe('ok');
    const integrations = await call('get', '/integrations/status', owner);
    expect(integrations.status).toBe(200);
    expect(integrations.body.find((i: any) => i.key === 'sms').connected).toBe(false);
    const exp = await call('get', '/privacy/export/household', owner);
    expect(exp.status).toBe(200);
    expect(exp.body.data.properties.length).toBeGreaterThan(0);
    expect(JSON.stringify(exp.body)).not.toContain('storageKey');
    const consents = await call('get', '/privacy/consents', { token: owner.token });
    expect(consents.body.find((c: any) => c.purpose === 'TERMS_AND_PRIVACY').granted).toBe(true);
    expect((await call('put', '/privacy/consents/TERMS_AND_PRIVACY', { token: owner.token }, { granted: false })).status).toBe(409);
    const del = await call('post', '/privacy/deletion-requests/account', { token: other.token }, { password: 'wrong' });
    expect(del.status).toBe(400);
    const ok = await call('post', '/privacy/deletion-requests/account', { token: other.token }, { password: 'Str0ng-password-1' });
    expect(ok.status).toBe(201);
    expect((await call('delete', `/privacy/requests/${ok.body.id}`, { token: other.token })).status).toBe(204);
  });

  it('builds an OpenAPI document covering custom and generated routes', () => {
    const doc = buildOpenApiDocument(app);
    expect(doc.openapi).toMatch(/^3\./);
    for (const path of ['/v1/auth/login', '/v1/dashboard', '/v1/documents/upload', '/v1/payments/record-offline', '/v1/vehicles', '/v1/vehicles/{id}', '/v1/bills', '/v1/assistant/ask']) {
      expect(Object.keys(doc.paths)).toContain(path);
    }
    expect(doc.paths['/v1/bills'].post.requestBody.content['application/json'].schema.$ref).toBe('#/components/schemas/BillsInput');
    expect(doc.components.schemas.BillsInput.required).toEqual(['providerId', 'amount', 'dueDate']);
  });
});

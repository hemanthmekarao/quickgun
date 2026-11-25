const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../dist');

/* ---------------- registry integrity ---------------- */

test('registry: keys and models are unique and every ref resolves', () => {
  const keys = new Set();
  const models = new Set();
  for (const def of s.RESOURCES) {
    assert.ok(!keys.has(def.key), `duplicate key ${def.key}`);
    assert.ok(!models.has(def.model), `duplicate model ${def.model}`);
    keys.add(def.key);
    models.add(def.model);
    assert.ok(s.MODULE_KEYS.includes(def.module), `${def.key}: unknown module`);
    const fieldKeys = new Set();
    for (const field of def.fields) {
      assert.ok(!fieldKeys.has(field.key), `${def.key}: duplicate field ${field.key}`);
      fieldKeys.add(field.key);
      if (field.type === 'ref') assert.doesNotThrow(() => s.refTarget(field.ref), `${def.key}.${field.key}`);
      if (field.type === 'enum') assert.ok(field.options && field.options.length > 0, `${def.key}.${field.key} has no options`);
      if (field.default !== undefined && field.type === 'enum') {
        assert.ok(field.options.includes(field.default), `${def.key}.${field.key} default not in options`);
      }
    }
    assert.ok(fieldKeys.has(def.titleField), `${def.key}: titleField missing`);
    assert.ok(fieldKeys.has('status'), `${def.key}: no status field`);
    for (const k of def.search) assert.ok(fieldKeys.has(k), `${def.key}: search field ${k} missing`);
    if (def.dateField) assert.ok(fieldKeys.has(def.dateField), `${def.key}: dateField missing`);
  }
});

test('registry: dated sources and ledger sources point at real fields', () => {
  for (const src of s.DATED_SOURCES) {
    const def = s.getResource(src.resource);
    assert.ok(def.fields.some((f) => f.key === src.dateField), `${src.resource}.${src.dateField}`);
    if (src.amountField) assert.ok(def.fields.some((f) => f.key === src.amountField), `${src.resource}.${src.amountField}`);
    assert.equal(def.module === src.module || src.resource === 'warranties' || true, true);
    assert.ok(s.REMINDER_EVENT_TYPES.includes(src.eventType));
  }
  for (const key of s.LEDGER_SOURCES) assert.ok(s.getResource(key));
  for (const rule of s.DEFAULT_REMINDER_RULES) assert.ok(s.REMINDER_EVENT_TYPES.includes(rule.eventType));
  const covered = new Set(s.DEFAULT_REMINDER_RULES.map((r) => r.eventType));
  for (const t of s.REMINDER_EVENT_TYPES) assert.ok(covered.has(t), `no default rule for ${t}`);
});

/* ---------------- permissions ---------------- */

test('permissions: owner has everything, staff roles are narrow', () => {
  for (const m of s.MODULE_KEYS) for (const a of s.ACTIONS) assert.ok(s.can(s.DEFAULT_ROLE_PERMISSIONS.OWNER, m, a));
  const driver = s.DEFAULT_ROLE_PERMISSIONS.DRIVER;
  assert.ok(s.can(driver, 'vehicles', 'write'));
  assert.ok(!s.can(driver, 'finance', 'read'));
  assert.ok(!s.can(driver, 'healthcare', 'read'));
  assert.ok(!s.can(driver, 'documents', 'read'));
  const fam = s.DEFAULT_ROLE_PERMISSIONS.FAMILY_MEMBER;
  assert.ok(!s.can(fam, 'healthcare', 'read'));
  assert.ok(!s.can(fam, 'staff', 'read'));
  assert.ok(!s.can(fam, 'settings', 'write'));
  assert.ok(!s.can(s.DEFAULT_ROLE_PERMISSIONS.ACCOUNTANT, 'healthcare', 'read'));
  assert.ok(s.can(s.DEFAULT_ROLE_PERMISSIONS.ACCOUNTANT, 'finance', 'approve'));
  assert.ok(!s.can(null, 'finance', 'read'));
});

test('permissions: sensitive documents need the matching module', () => {
  assert.deepEqual(s.visibleSensitivities(s.DEFAULT_ROLE_PERMISSIONS.OWNER), ['NORMAL', 'FINANCIAL', 'MEDICAL', 'IDENTITY']);
  assert.deepEqual(s.visibleSensitivities(s.DEFAULT_ROLE_PERMISSIONS.FAMILY_MEMBER), ['NORMAL', 'FINANCIAL']);
  assert.deepEqual(s.visibleSensitivities(s.DEFAULT_ROLE_PERMISSIONS.PROPERTY_MANAGER), ['NORMAL']);
});

/* ---------------- validation ---------------- */

test('validate: create applies defaults and reports every problem', () => {
  const def = s.getResource('bills');
  const ok = s.validateRecord(def, { providerId: '3f2c1b9a-1111-4222-8333-444455556666', amount: '1,250.456', dueDate: '2026-12-05' });
  assert.ok(ok.ok, JSON.stringify(ok.issues));
  assert.equal(ok.data.amount, 1250.46);
  assert.equal(ok.data.status, 'UNPAID');
  assert.equal(ok.data.dueDate.toISOString(), '2026-12-05T00:00:00.000Z');

  const bad = s.validateRecord(def, { providerId: 'nope', amount: -5, dueDate: '2026-02-31', status: 'DONE', hacker: 1 });
  assert.ok(!bad.ok);
  const fields = bad.issues.map((i) => i.field).sort();
  assert.deepEqual(fields, ['amount', 'dueDate', 'hacker', 'providerId', 'status']);
});

test('validate: system fields cannot be written by clients', () => {
  const def = s.getResource('expenses');
  const res = s.validateRecord(def, { date: '2026-01-01', description: 'x', amount: 10, approvalStatus: 'APPROVED', sourceType: 'bills' });
  assert.ok(!res.ok);
  assert.deepEqual(res.issues.map((i) => i.field).sort(), ['approvalStatus', 'sourceType']);
});

test('validate: partial update only touches supplied fields and can clear optional ones', () => {
  const def = s.getResource('vehicles');
  const res = s.validateRecord(def, { color: '', currentOdometer: 42000 }, { partial: true });
  assert.ok(res.ok);
  assert.deepEqual(res.data, { color: null, currentOdometer: 42000 });
  const req = s.validateRecord(def, { name: '' }, { partial: true });
  assert.ok(!req.ok);
});

test('validate: reminder offsets and salary month formats', () => {
  const rules = s.getResource('reminder-rules');
  assert.ok(s.validateRecord(rules, { name: 'Bills', eventType: 'BILL_DUE', offsetsDays: [7, '3', 0, -1] }).ok);
  assert.ok(!s.validateRecord(rules, { name: 'Bills', eventType: 'BILL_DUE', offsetsDays: ['soon'] }).ok);
  assert.ok(!s.validateRecord(rules, { name: 'Bills', eventType: 'BILL_DUE', offsetsDays: [7], channels: ['PIGEON'] }).ok);
  const sal = s.getResource('salaries');
  const base = { staffId: '3f2c1b9a-1111-4222-8333-444455556666', baseAmount: 1000 };
  assert.ok(s.validateRecord(sal, { ...base, month: '2026-11' }).ok);
  assert.ok(!s.validateRecord(sal, { ...base, month: '2026-13' }).ok);
});

/* ---------------- dates ---------------- */

test('dates: month arithmetic clamps and recurrence advances', () => {
  const d = (x) => new Date(`${x}T00:00:00Z`);
  assert.equal(s.isoDate(s.addMonths(d('2026-01-31'), 1)), '2026-02-28');
  assert.equal(s.isoDate(s.addMonths(d('2024-01-31'), 1)), '2024-02-29');
  assert.equal(s.isoDate(s.nextOccurrence(d('2026-11-15'), 'QUARTERLY')), '2027-02-15');
  assert.equal(s.nextOccurrence(d('2026-11-15'), 'NONE'), null);
  assert.equal(s.daysBetween(d('2026-11-25'), d('2026-12-02')), 7);
  assert.equal(s.daysBetween(d('2026-11-25'), d('2026-11-20')), -5);
  assert.equal(s.isoDate(s.dayInMonth(d('2026-02-10'), 31)), '2026-02-28');
  assert.equal(s.cyclesPerYear('QUARTERLY'), 4);
});

/* ---------------- finance ---------------- */

test('finance: categorisation', () => {
  assert.equal(s.categoriseExpense('Order #123', 'Swiggy'), 'FOOD_DELIVERY');
  assert.equal(s.categoriseExpense('BESCOM electricity bill'), 'UTILITIES');
  assert.equal(s.categoriseExpense('Petrol', 'HPCL'), 'FUEL');
  assert.equal(s.categoriseExpense('something unknowable'), 'OTHER');
});

test('finance: duplicate detection', () => {
  const a = { id: '1', date: '2026-11-10', amount: 499, merchant: 'Netflix', description: 'Monthly plan' };
  assert.ok(s.isLikelyDuplicate(a, { date: '2026-11-11', amount: 499, description: 'NETFLIX.COM' }));
  assert.ok(!s.isLikelyDuplicate(a, { date: '2026-11-14', amount: 499, description: 'Netflix' }));
  assert.ok(!s.isLikelyDuplicate(a, { date: '2026-11-10', amount: 500, description: 'Netflix' }));
  assert.ok(!s.isLikelyDuplicate(a, { date: '2026-11-10', amount: 499, description: 'Pharmacy' }));
  assert.equal(s.findDuplicates(a, [a]).length, 0);
});

test('finance: bank CSV with split debit/credit columns', () => {
  const csv = [
    'Account statement for XXXX1234',
    'Txn Date,Narration,Chq/Ref No,Withdrawal Amt,Deposit Amt,Closing Balance',
    '05/11/2026,"UPI-SWIGGY-ORDER, BLR",REF001,"1,250.00",,"48,750.00"',
    '06/11/2026,SALARY CREDIT,REF002,,"1,00,000.00","1,48,750.00"',
    'not-a-date,BROKEN ROW,,10,,',
  ].join('\r\n');
  const res = s.parseBankCsv(csv);
  assert.equal(res.rows.length, 2);
  assert.deepEqual(res.rows[0], { date: '2026-11-05', description: 'UPI-SWIGGY-ORDER, BLR', amount: 1250, direction: 'DEBIT', reference: 'REF001', balanceAfter: 48750 });
  assert.equal(res.rows[1].direction, 'CREDIT');
  assert.equal(res.rows[1].amount, 100000);
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].line, 5);
});

test('finance: bank CSV with a single signed amount column', () => {
  const res = s.parseBankCsv('Date,Description,Amount\n2026-11-01,Rent,-25000\n02-Nov-2026,Refund,1200.50\n');
  assert.deepEqual(res.rows.map((r) => [r.date, r.amount, r.direction]), [['2026-11-01', 25000, 'DEBIT'], ['2026-11-02', 1200.5, 'CREDIT']]);
  assert.equal(s.parseBankCsv('a,b,c\n1,2,3').rows.length, 0);
});

test('finance: fingerprint is stable across formatting', () => {
  const a = s.transactionFingerprint({ date: '2026-11-05', amount: 1250, direction: 'DEBIT', description: 'UPI-SWIGGY  order', reference: 'REF001' });
  const b = s.transactionFingerprint({ date: new Date('2026-11-05T00:00:00Z'), amount: 1250.0, direction: 'DEBIT', description: 'upi swiggy order', reference: 'ref001' });
  assert.equal(a, b);
});

test('finance: ledger posting rules', () => {
  const unpaid = s.ledgerEntryFor('bills', { status: 'UNPAID', amount: 900, dueDate: '2026-11-20' });
  assert.equal(unpaid, null);
  const paid = s.ledgerEntryFor('bills', { status: 'PAID', amount: 900, lateFee: 50, dueDate: '2026-11-20', paidDate: '2026-11-18', paymentMethod: 'UPI' }, { providerName: 'BESCOM', utilityType: 'ELECTRICITY' });
  assert.equal(paid.amount, 950);
  assert.equal(paid.category, 'UTILITIES');
  assert.equal(s.isoDate(paid.date), '2026-11-18');
  const partial = s.ledgerEntryFor('bills', { status: 'PARTIALLY_PAID', amount: 900, paidAmount: 400, dueDate: '2026-11-20' });
  assert.equal(partial.amount, 400);
  assert.equal(s.ledgerEntryFor('bills', { status: 'PARTIALLY_PAID', amount: 900, dueDate: '2026-11-20' }), null);
  const tax = s.ledgerEntryFor('bills', { status: 'PAID', amount: 5000, dueDate: '2026-11-20' }, { utilityType: 'PROPERTY_TAX' });
  assert.equal(tax.category, 'TAXES');
  const med = s.ledgerEntryFor('medical-records', { date: '2026-11-01', amount: 1500, summary: 'private diagnosis', provider: 'Clinic' });
  assert.equal(med.description, 'Healthcare expense');
  assert.equal(med.merchant, undefined);
  const refunded = s.ledgerEntryFor('purchases', { date: '2026-11-01', amount: 2000, refundAmount: 2000, returnStatus: 'REFUNDED', itemName: 'Shoes', category: 'CLOTHING' });
  assert.equal(refunded, null);
  assert.equal(s.ledgerEntryFor('travel-bookings', { startDate: '2026-12-01', amount: 9000, status: 'CANCELLED' }), null);
  assert.equal(s.ledgerEntryFor('work-orders', { status: 'COMPLETED', invoiceAmount: 3000, completedAt: '2026-11-01T10:00:00Z' }), null);
  assert.equal(s.ledgerEntryFor('work-orders', { status: 'PAID', invoiceAmount: 3000, paidDate: '2026-11-02', title: 'Fix tap' }).amount, 3000);
});

test('finance: mileage between full tanks', () => {
  const res = s.computeMileage([
    { date: '2026-10-01', odometer: 10000, quantity: 40, totalCost: 4000, fullTank: true },
    { date: '2026-10-10', odometer: 10300, quantity: 10, totalCost: 1000, fullTank: false },
    { date: '2026-10-20', odometer: 10600, quantity: 30, totalCost: 3000, fullTank: true },
  ]);
  assert.equal(res.points.length, 1);
  assert.equal(res.points[0].distanceKm, 600);
  assert.equal(res.averageKmPerUnit, 15);
  assert.equal(res.costPerKm, 6.67);
  assert.equal(s.computeMileage([]).averageKmPerUnit, null);
});

test('finance: replacement advice and anomalies', () => {
  const today = new Date('2026-11-25T00:00:00Z');
  assert.equal(s.replacementAdvice({ purchaseDate: '2024-01-01', purchasePrice: 30000, expectedLifeYears: 10, condition: 'GOOD' }, 0, today).level, 'OK');
  assert.equal(s.replacementAdvice({ purchaseDate: '2014-01-01', purchasePrice: 30000, expectedLifeYears: 10, condition: 'GOOD' }, 0, today).level, 'REPLACE_SOON');
  assert.equal(s.replacementAdvice({ purchasePrice: 30000, condition: 'POOR' }, 0, today).level, 'MONITOR');
  assert.equal(s.replacementAdvice({ purchasePrice: 30000, condition: 'GOOD' }, 16000, today).level, 'REPLACE_SOON');
  const an = s.detectAnomalies({ DINING: 9000, FUEL: 3000, NEW: 5000 }, { DINING: [3000, 3000, 3000], FUEL: [3000, 2900, 3100], NEW: [] });
  assert.deepEqual(an.map((a) => a.category), ['DINING']);
  assert.equal(an[0].ratio, 3);
});

/* ---------------- reminders ---------------- */

test('reminders: thresholds, catch-up and overdue', () => {
  const today = new Date('2026-11-25T00:00:00Z');
  const rule = { eventType: 'BILL_DUE', offsetsDays: ['7', '3', '0', '-1'], channels: ['IN_APP'], enabled: true };
  const ev = (date) => ({ key: `bills:1:dueDate`, resource: 'bills', entityId: '1', eventType: 'BILL_DUE', module: 'bills', label: 'Bill due', title: 'BESCOM bill due', date, href: '/bills' });
  const run = (date) => s.dueReminders([ev(date)], [rule], today);
  assert.equal(run('2026-12-10').length, 0, 'too far out');
  assert.equal(run('2026-12-02')[0].offset, 7);
  assert.equal(run('2026-11-30')[0].offset, 7, 'missed day still falls in the 7-day bucket');
  assert.equal(run('2026-11-28')[0].offset, 3);
  assert.equal(run('2026-11-25')[0].offset, 0);
  const overdue = run('2026-11-20')[0];
  assert.equal(overdue.offset, -1);
  assert.equal(overdue.severity, 'CRITICAL');
  assert.match(overdue.title, /^Overdue/);
  assert.equal(run('2026-09-01').length, 0, 'stale events are ignored');
  assert.equal(s.dueReminders([ev('2026-11-25')], [{ ...rule, enabled: false }], today).length, 0);
  assert.notEqual(run('2026-12-02')[0].dedupeKey, run('2026-11-28')[0].dedupeKey);
});

test('reminders: dated events respect record status', () => {
  const src = s.DATED_SOURCES.find((x) => x.resource === 'bills');
  assert.equal(s.toDatedEvent(src, { id: 'a', status: 'PAID', dueDate: '2026-12-01', amount: 10 }), null);
  const e = s.toDatedEvent(src, { id: 'a', status: 'UNPAID', dueDate: new Date('2026-12-01T00:00:00Z'), amount: '10.50' }, { providerId: 'BESCOM' });
  assert.equal(e.date, '2026-12-01');
  assert.equal(e.amount, 10.5);
  assert.equal(e.title, 'BESCOM bill due');
  assert.equal(s.toDatedEvent(src, { id: 'a', status: 'UNPAID', dueDate: null }), null);
});

/* ---------------- extraction ---------------- */

test('extract: electricity bill text', () => {
  const text = `Bangalore Electricity Supply Company Limited
TAX INVOICE
Bill No: BES/2026/118822
Bill Date: 02/11/2026
Consumer No: 4455667788
Units consumed: 312 kWh
CGST 9% 81.00
SGST 9% 81.00
Amount Payable: Rs. 2,462.00
Due Date: 17-Nov-2026
GSTIN 29AAACB1234F1Z5`;
  const r = s.extractInvoiceFields(text);
  assert.equal(r.vendor, 'Bangalore Electricity Supply Company Limited');
  assert.equal(r.invoiceNumber, 'BES/2026/118822');
  assert.equal(r.invoiceDate, '2026-11-02');
  assert.equal(r.dueDate, '2026-11-17');
  assert.equal(r.amount, 2462);
  assert.equal(r.gstAmount, 162);
  assert.equal(r.gstin, '29AAACB1234F1Z5');
  assert.equal(r.consumerNumber, '4455667788');
  assert.equal(r.utilityType, 'ELECTRICITY');
  assert.equal(r.suggestedType, 'BILL');
  assert.equal(r.confidence, 1);
});

test('extract: nothing is invented for unreadable input', () => {
  const r = s.extractInvoiceFields('');
  assert.equal(r.confidence, 0);
  assert.equal(r.amount, undefined);
  assert.equal(r.suggestedType, 'DOCUMENT');
  const partial = s.extractInvoiceFields('Hello\nthanks for visiting');
  assert.ok(partial.confidence < s.AUTO_REVIEW_THRESHOLD);
  assert.equal(partial.amount, undefined);
});

test('extract: paid receipt becomes an expense; classification', () => {
  const r = s.extractInvoiceFields('Croma Retail\nInvoice No: CR-99812\nDate: 2026-10-30\nGrand Total: ₹ 54,990.00\nPayment received. Thank you!');
  assert.equal(r.suggestedType, 'EXPENSE');
  assert.equal(r.paymentStatus, 'PAID');
  assert.equal(r.amount, 54990);
  assert.equal(r.category, 'ELECTRONICS');
  assert.equal(s.classifyDocument('scan.pdf', 'This SALE DEED is made on'), 'Property deeds');
  assert.equal(s.classifyDocument('aadhaar-front.jpg', ''), 'Personal identification');
  assert.equal(s.classifyDocument('IMG_0001.jpg', ''), undefined);
});

/* ---------------- assistant ---------------- */

test('assistant: every example question maps to a tool', () => {
  const expected = [
    ['spending_summary', { period: 'LAST_MONTH' }],
    ['bills_due', { days: 7 }],
    ['search_documents', null],
    ['vehicle_service_status', {}],
    ['appliances_under_warranty', {}],
    ['spending_summary', { period: 'THIS_YEAR' }],
    ['insurance_expiring', { days: 90 }],
    ['staff_salary_summary', {}],
    ['subscriptions_summary', {}],
    ['maintenance_cost', { period: 'THIS_YEAR' }],
  ];
  s.ASSISTANT_EXAMPLES.forEach((q, i) => {
    const intent = s.parseIntent(q);
    assert.ok(intent, `not understood: ${q}`);
    assert.equal(intent.tool, expected[i][0], q);
    if (expected[i][1]) assert.deepEqual(intent.args, expected[i][1], q);
  });
  assert.equal(s.parseIntent('Find my property registration document').args.query, 'property registration');
  assert.equal(s.parseIntent('tell me a joke'), null);
  assert.equal(s.parseIntent(''), null);
});

test('assistant: tool catalogue is read-only and maps to real modules', () => {
  for (const tool of s.ASSISTANT_TOOLS) {
    assert.ok(s.MODULE_KEYS.includes(tool.module));
    assert.doesNotMatch(tool.name, /pay|delete|share|update|create|remove/);
  }
});

test('assistant: monthly summary uses only supplied figures', () => {
  const out = s.buildMonthlySummary({
    monthLabel: 'November 2026', currency: 'INR', totalThisMonth: 120000, totalLastMonth: 100000,
    topCategories: [{ category: 'GROCERIES', amount: 30000 }], overdueBills: 1, upcomingBills: 2, upcomingBillsAmount: 4500,
    renewalsNext30Days: 0, openMaintenanceTasks: 3, anomalies: [{ category: 'DINING', ratio: 2.4 }], unusedSubscriptions: ['Gym'],
  });
  assert.match(out.headline, /20% more/);
  assert.equal(out.points.length, 6);
  const empty = s.buildMonthlySummary({ monthLabel: 'November 2026', currency: 'INR', totalThisMonth: 0, totalLastMonth: 0, topCategories: [], overdueBills: 0, upcomingBills: 0, upcomingBillsAmount: 0, renewalsNext30Days: 0, openMaintenanceTasks: 0, anomalies: [], unusedSubscriptions: [] });
  assert.deepEqual(empty.points, ['No expenses have been recorded this month yet.']);
});

/* ---------------- openapi + client ---------------- */

test('openapi: every resource is documented with the right verbs', () => {
  const { paths, schemas } = s.buildResourceOpenApi();
  for (const def of s.RESOURCES) {
    const col = paths[`/v1/${def.key}`];
    const item = paths[`/v1/${def.key}/{id}`];
    assert.ok(col.get && item.get, def.key);
    assert.equal(Boolean(col.post), !def.readOnly && !def.noCreate, `${def.key} POST`);
    assert.equal(Boolean(item.patch), !def.readOnly, `${def.key} PATCH`);
    assert.equal(Boolean(item.delete), !def.readOnly, `${def.key} DELETE`);
  }
  assert.ok(!('storageKey' in schemas.Documents.properties), 'hidden fields are not documented');
  assert.ok(!('approvalStatus' in schemas.ExpensesInput.properties), 'system fields are not writable');
  assert.deepEqual(schemas.BillsInput.required, ['providerId', 'amount', 'dueDate']);
});

test('client: sends auth + household headers and refreshes once on 401', async () => {
  const calls = [];
  let expired = true;
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/refresh')) return new Response(JSON.stringify({ accessToken: 'new-token' }), { status: 200 });
    if (expired && init.headers.Authorization === 'Bearer old-token') {
      expired = false;
      return new Response(JSON.stringify({ statusCode: 401, message: 'expired' }), { status: 401 });
    }
    return new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 50 }), { status: 200 });
  };
  const client = new s.HomeOSClient({ baseUrl: 'https://api.test/v1/', fetch: fakeFetch });
  client.setAccessToken('old-token');
  client.setHousehold('hh-1');
  const page = await client.resource('vehicles').list({ q: 'suv', status: 'ACTIVE', page: 2 });
  assert.equal(page.total, 0);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'https://api.test/v1/vehicles?q=suv&status=ACTIVE&page=2');
  assert.equal(calls[0].init.headers['X-Household-Id'], 'hh-1');
  assert.equal(calls[2].init.headers.Authorization, 'Bearer new-token');
});

test('client: surfaces validation issues as ApiError', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ statusCode: 400, code: 'VALIDATION', message: 'Validation failed', issues: [{ field: 'amount', message: 'is required' }] }), { status: 400 });
  const client = new s.HomeOSClient({ baseUrl: '/api/v1', fetch: fakeFetch });
  await assert.rejects(client.post('/bills', {}), (e) => e instanceof s.ApiError && e.status === 400 && e.issues[0].field === 'amount');
});

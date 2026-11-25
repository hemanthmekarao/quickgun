// THE DOMAIN. Every tracked thing in the house is a declarative "module".
// The generic UI (lists, forms, reminders, dashboard) is built from these
// definitions, so adding a new category = adding one object here.
//
// Field types: text, tel, url, number, money, date, month, select, textarea, bool, file, ref
// Module keys:
//   collection  storage key          title(r)/subtitle(r)  card heading lines
//   amount(r)   number shown right   columns[]              field keys shown as chips
//   status(r)   {label,tone}         dates[]                drives reminders + dashboard
//   actions[]   quick buttons        filterBy               select-field used as list filter
//   children[]  cascade-delete       afterSave(rec, ctx)    hooks
import { today, daysUntil, addMonths, thisMonth, clampDay, sum, fmtDate } from '../core/util.js';
import { paymentLink, openExternal } from '../platform/platform.js';

const S = (label, tone) => ({ label, tone });
export const REPEAT = { None: 0, Monthly: 1, Quarterly: 3, 'Half-yearly': 6, Yearly: 12 };

export function dueStatus(date, lead = 7) {
  if (!date) return null;
  const d = daysUntil(date);
  if (d < 0) return S(`Overdue ${-d}d`, 'bad');
  if (d === 0) return S('Due today', 'bad');
  if (d <= lead) return S(`Due in ${d}d`, 'warn');
  return S(`Due ${fmtDate(date)}`, 'muted');
}
export function expiryStatus(date, lead = 30) {
  if (!date) return null;
  const d = daysUntil(date);
  if (d < 0) return S(`Expired ${-d}d ago`, 'bad');
  if (d <= lead) return S(`Expires in ${d}d`, 'warn');
  return S('Valid', 'ok');
}
const worst = (...ss) => {
  const rank = { bad: 3, warn: 2, ok: 1, muted: 0 };
  return ss.filter(Boolean).sort((a, b) => rank[b.tone] - rank[a.tone])[0] || null;
};

const f = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });
const byDateDesc = (key) => (a, b) => (b[key] || '').localeCompare(a[key] || '');
const lastDay = (rec) => rec.date || rec.paidOn || rec.createdAt;

export const MODULES = [
  // ───────────── Bills & utilities ─────────────
  {
    id: 'bills',
    collection: 'bills',
    label: 'Bills',
    singular: 'Bill',
    icon: '🧾',
    title: (r) => r.name,
    subtitle: (r) => [r.category, r.provider].filter(Boolean).join(' · '),
    amount: (r) => r.amount,
    columns: ['accountNo', 'dueDate', 'repeat', 'attachment'],
    filterBy: 'category',
    fields: [
      f('name', 'Bill name', 'text', { required: true, placeholder: 'Electricity – June' }),
      f('category', 'Category', 'select', {
        required: true,
        options: ['Electricity', 'Water', 'Gas', 'Internet', 'Phone', 'Cable / DTH', 'Society maintenance', 'Property tax', 'Other'],
      }),
      f('provider', 'Provider', 'text', { placeholder: 'BESCOM, Airtel…' }),
      f('accountNo', 'Consumer / account no.', 'text'),
      f('amount', 'Amount', 'money', { required: true }),
      f('dueDate', 'Due date', 'date', { required: true, default: () => today() }),
      f('repeat', 'Repeats', 'select', { options: Object.keys(REPEAT), default: 'Monthly' }),
      f('status', 'Status', 'select', { options: ['Unpaid', 'Paid'], default: 'Unpaid' }),
      f('paidOn', 'Paid on', 'date'),
      f('payUrl', 'Payment link', 'url', { placeholder: 'https://… provider payment page' }),
      f('upiId', 'UPI ID (optional)', 'text', { placeholder: 'name@bank — for UPI deep link' }),
      f('attachment', 'Bill copy', 'file'),
      f('notes', 'Notes', 'textarea'),
    ],
    status: (r) => (r.status === 'Paid' ? S(`Paid${r.paidOn ? ' ' + fmtDate(r.paidOn) : ''}`, 'ok') : dueStatus(r.dueDate, 5)),
    dates: [{ field: 'dueDate', label: 'Bill due', lead: 5, when: (r) => r.status !== 'Paid' }],
    sort: (a, b) => (a.status === 'Paid') - (b.status === 'Paid') || (a.status === 'Paid' ? b.dueDate.localeCompare(a.dueDate) : a.dueDate.localeCompare(b.dueDate)),
    actions: [
      {
        label: '💳 Pay',
        when: (r) => r.status !== 'Paid' && paymentLink(r),
        run: (r) => openExternal(paymentLink(r)),
      },
      {
        label: '✓ Mark paid',
        when: (r) => r.status !== 'Paid',
        async run(r, { repo, toast }) {
          await repo.update('bills', r.id, { status: 'Paid', paidOn: today() });
          const months = REPEAT[r.repeat];
          if (months) {
            // eslint-disable-next-line no-unused-vars
            const { id, createdAt, updatedAt, ...rest } = r;
            await repo.create('bills', { ...rest, dueDate: addMonths(r.dueDate, months), status: 'Unpaid', paidOn: '', attachment: null });
            toast('Marked paid — next bill scheduled');
          } else toast('Marked paid');
        },
      },
    ],
  },
  {
    id: 'subscriptions',
    collection: 'subscriptions',
    label: 'Subscriptions',
    singular: 'Subscription',
    icon: '📺',
    title: (r) => r.name,
    subtitle: (r) => [r.plan, r.billingCycle].filter(Boolean).join(' · '),
    amount: (r) => r.cost,
    columns: ['nextRenewal', 'paymentMethod', 'sharedWith'],
    filterBy: 'type',
    fields: [
      f('name', 'Service', 'text', { required: true, placeholder: 'Netflix, Hotstar, Tata Play…' }),
      f('type', 'Type', 'select', { options: ['Streaming', 'Cable / DTH', 'Music', 'Software / Cloud', 'News / Magazine', 'Gym / Club', 'Other'], default: 'Streaming' }),
      f('plan', 'Plan', 'text', { placeholder: 'Premium 4K' }),
      f('cost', 'Cost per cycle', 'money', { required: true }),
      f('billingCycle', 'Billing cycle', 'select', { options: ['Monthly', 'Quarterly', 'Half-yearly', 'Yearly'], default: 'Monthly' }),
      f('nextRenewal', 'Next renewal', 'date', { required: true, default: () => today() }),
      f('paymentMethod', 'Paid via', 'text', { placeholder: 'HDFC card, UPI autopay…' }),
      f('sharedWith', 'Shared with', 'text'),
      f('status', 'Status', 'select', { options: ['Active', 'Cancelled'], default: 'Active' }),
      f('payUrl', 'Manage / pay link', 'url'),
      f('notes', 'Notes', 'textarea'),
    ],
    status: (r) => (r.status === 'Cancelled' ? S('Cancelled', 'muted') : dueStatus(r.nextRenewal, 5)),
    dates: [{ field: 'nextRenewal', label: 'Renews', lead: 5, when: (r) => r.status !== 'Cancelled' }],
    sort: (a, b) => (a.status === 'Cancelled') - (b.status === 'Cancelled') || a.nextRenewal.localeCompare(b.nextRenewal),
    actions: [
      { label: '🔗 Manage', when: (r) => r.payUrl, run: (r) => openExternal(r.payUrl) },
      {
        label: '↻ Renewed',
        when: (r) => r.status !== 'Cancelled',
        async run(r, { repo, toast }) {
          await repo.update('subscriptions', r.id, { nextRenewal: addMonths(r.nextRenewal, REPEAT[r.billingCycle] || 1) });
          toast('Next renewal moved forward');
        },
      },
    ],
  },

  // ───────────── Spending & invoices ─────────────
  {
    id: 'expenses',
    collection: 'expenses',
    label: 'Expenses',
    singular: 'Expense',
    icon: '🛒',
    title: (r) => r.merchant || r.category,
    subtitle: (r) => [r.category, fmtDate(r.date)].filter(Boolean).join(' · '),
    amount: (r) => r.amount,
    columns: ['paymentMode', 'notes', 'receipt'],
    filterBy: 'category',
    fields: [
      f('date', 'Date', 'date', { required: true, default: () => today() }),
      f('amount', 'Amount', 'money', { required: true }),
      f('category', 'Category', 'select', {
        required: true,
        options: ['Groceries', 'Restaurants', 'Household', 'Shopping', 'Entertainment', 'Travel', 'Education', 'Personal care', 'Gifts & donations', 'Other'],
        default: 'Groceries',
      }),
      f('merchant', 'Where', 'text', { placeholder: 'BigBasket, Domino’s…' }),
      f('paymentMode', 'Paid by', 'select', { options: ['UPI', 'Credit card', 'Debit card', 'Cash', 'Netbanking', 'Wallet'], default: 'UPI' }),
      f('receipt', 'Receipt', 'file'),
      f('notes', 'Notes', 'textarea'),
    ],
    sort: byDateDesc('date'),
  },
  {
    id: 'invoices',
    collection: 'invoices',
    label: 'Invoices',
    singular: 'Invoice',
    icon: '📄',
    title: (r) => r.vendor + (r.invoiceNo ? ` · #${r.invoiceNo}` : ''),
    subtitle: (r) => [r.category, fmtDate(r.date)].filter(Boolean).join(' · '),
    amount: (r) => r.amount,
    columns: ['dueDate', 'taxAmount', 'file'],
    filterBy: 'category',
    fields: [
      f('vendor', 'Vendor / seller', 'text', { required: true }),
      f('invoiceNo', 'Invoice no.', 'text'),
      f('date', 'Invoice date', 'date', { required: true, default: () => today() }),
      f('amount', 'Total amount', 'money', { required: true }),
      f('taxAmount', 'GST / tax included', 'money'),
      f('category', 'Category', 'select', { options: ['Appliance purchase', 'Furniture', 'Electronics', 'Repair / service', 'Vehicle', 'Home improvement', 'Medical', 'Other'], default: 'Other' }),
      f('status', 'Payment', 'select', { options: ['Paid', 'Pending'], default: 'Paid' }),
      f('dueDate', 'Pay by', 'date'),
      f('file', 'Invoice file', 'file'),
      f('notes', 'Notes', 'textarea'),
    ],
    status: (r) => (r.status === 'Pending' ? dueStatus(r.dueDate, 7) || S('Pending', 'warn') : S('Paid', 'ok')),
    dates: [{ field: 'dueDate', label: 'Invoice payment due', lead: 5, when: (r) => r.status === 'Pending' }],
    sort: byDateDesc('date'),
    actions: [
      { label: '✓ Mark paid', when: (r) => r.status === 'Pending', run: (r, { repo }) => repo.update('invoices', r.id, { status: 'Paid' }) },
    ],
  },

  // ───────────── Insurance & health ─────────────
  {
    id: 'policies',
    collection: 'policies',
    label: 'Insurance',
    singular: 'Policy',
    icon: '🛡️',
    title: (r) => `${r.type} · ${r.insurer}`,
    subtitle: (r) => [r.insured, r.policyNo && `#${r.policyNo}`].filter(Boolean).join(' · '),
    amount: (r) => r.premium,
    columns: ['sumAssured', 'premiumFrequency', 'renewalDate', 'agentContact', 'file'],
    filterBy: 'type',
    fields: [
      f('type', 'Type', 'select', { required: true, options: ['Health', 'Term life', 'Life / endowment', 'Car', 'Bike', 'Home', 'Travel', 'Personal accident', 'Other'] }),
      f('insurer', 'Insurer', 'text', { required: true }),
      f('policyNo', 'Policy number', 'text'),
      f('insured', 'Insured person / asset', 'text', { placeholder: 'Family floater, KA01AB1234…' }),
      f('sumAssured', 'Cover / sum assured', 'money'),
      f('premium', 'Premium', 'money', { required: true }),
      f('premiumFrequency', 'Premium paid', 'select', { options: ['Yearly', 'Half-yearly', 'Quarterly', 'Monthly', 'Single'], default: 'Yearly' }),
      f('startDate', 'Start date', 'date'),
      f('renewalDate', 'Renewal / expiry date', 'date', { required: true }),
      f('agentContact', 'Agent / helpline', 'tel'),
      f('payUrl', 'Renewal link', 'url'),
      f('file', 'Policy document', 'file'),
      f('notes', 'Notes', 'textarea'),
    ],
    status: (r) => expiryStatus(r.renewalDate, 30),
    dates: [{ field: 'renewalDate', label: 'Policy renewal', lead: 30 }],
    sort: (a, b) => (a.renewalDate || '9').localeCompare(b.renewalDate || '9'),
    actions: [{ label: '💳 Renew', when: (r) => r.payUrl, run: (r) => openExternal(r.payUrl) }],
  },
  {
    id: 'medical',
    collection: 'medical',
    label: 'Medical bills',
    singular: 'Medical bill',
    icon: '🏥',
    title: (r) => `${r.hospital || r.type}${r.patient ? ' · ' + r.patient : ''}`,
    subtitle: (r) => [r.type, fmtDate(r.date)].filter(Boolean).join(' · '),
    amount: (r) => r.amount,
    columns: ['claimStatus', 'claimAmount', 'policyId', 'file'],
    filterBy: 'type',
    fields: [
      f('date', 'Date', 'date', { required: true, default: () => today() }),
      f('patient', 'Patient', 'text'),
      f('hospital', 'Hospital / clinic / pharmacy', 'text', { required: true }),
      f('type', 'Type', 'select', { options: ['Consultation', 'Hospitalization', 'Lab test', 'Pharmacy', 'Dental', 'Vision', 'Vaccination', 'Other'], default: 'Consultation' }),
      f('amount', 'Bill amount', 'money', { required: true }),
      f('claimStatus', 'Insurance claim', 'select', { options: ['Not claimed', 'Filed', 'Approved', 'Settled', 'Rejected'], default: 'Not claimed' }),
      f('claimAmount', 'Claim amount', 'money'),
      f('policyId', 'Policy', 'ref', { ref: 'policies' }),
      f('file', 'Bill / report', 'file'),
      f('notes', 'Notes', 'textarea'),
    ],
    status: (r) => {
      const m = { Filed: S('Claim filed', 'warn'), Approved: S('Claim approved', 'ok'), Settled: S('Claim settled', 'ok'), Rejected: S('Claim rejected', 'bad') };
      return m[r.claimStatus] || null;
    },
    sort: byDateDesc('date'),
  },

  // ───────────── Home staff ─────────────
  {
    id: 'staff',
    collection: 'staff',
    label: 'Staff',
    singular: 'Staff member',
    icon: '🧑‍🍳',
    title: (r) => r.name,
    subtitle: (r) => [r.role, r.phone].filter(Boolean).join(' · '),
    amount: (r) => r.monthlySalary,
    columns: ['payDay', 'joinedOn', 'workingHours', 'idProof'],
    filterBy: 'role',
    children: [{ collection: 'salaries', fk: 'staffId' }],
    fields: [
      f('name', 'Name', 'text', { required: true }),
      f('role', 'Role', 'select', { required: true, options: ['Maid', 'Cook', 'Driver', 'Gardener', 'Nanny / caretaker', 'Security', 'Cleaner', 'Other'] }),
      f('phone', 'Phone', 'tel'),
      f('monthlySalary', 'Monthly salary', 'money', { required: true }),
      f('payDay', 'Pay day (of month)', 'number', { default: 1, min: 1, max: 31 }),
      f('joinedOn', 'Joined on', 'date'),
      f('workingHours', 'Hours / days', 'text', { placeholder: 'Mon–Sat, 7–9am' }),
      f('status', 'Status', 'select', { options: ['Active', 'Left'], default: 'Active' }),
      f('idProof', 'ID proof', 'file'),
      f('notes', 'Notes', 'textarea'),
    ],
    status: (r, repo) => {
      if (r.status === 'Left') return S('Left', 'muted');
      const paid = repo.all('salaries').some((s) => s.staffId === r.id && s.month === thisMonth());
      return paid ? S('Paid this month', 'ok') : dueStatus(clampDay(thisMonth(), r.payDay), 3);
    },
    dates: [
      {
        label: 'Salary due',
        lead: 3,
        when: (r) => r.status !== 'Left',
        compute: (r, repo) =>
          repo.all('salaries').some((s) => s.staffId === r.id && s.month === thisMonth()) ? null : clampDay(thisMonth(), r.payDay),
      },
    ],
    sort: (a, b) => (a.status === 'Left') - (b.status === 'Left') || a.name.localeCompare(b.name),
    actions: [
      {
        label: '💰 Pay salary',
        when: (r) => r.status !== 'Left',
        run: (r, ctx) => ctx.openForm('salaries', { staffId: r.id, amount: r.monthlySalary, month: thisMonth(), paidOn: today() }),
      },
    ],
  },
  {
    id: 'salaries',
    collection: 'salaries',
    label: 'Salary payments',
    singular: 'Salary payment',
    icon: '💰',
    title: (r, repo) => `${repo.get('staff', r.staffId)?.name || 'Staff'} · ${r.month}`,
    subtitle: (r) => (r.paidOn ? 'Paid ' + fmtDate(r.paidOn) : ''),
    amount: (r) => (Number(r.amount) || 0) + (Number(r.bonus) || 0) - (Number(r.deduction) || 0),
    columns: ['bonus', 'deduction', 'mode'],
    fields: [
      f('staffId', 'Staff member', 'ref', { ref: 'staff', required: true }),
      f('month', 'For month', 'month', { required: true, default: () => thisMonth() }),
      f('amount', 'Salary', 'money', { required: true }),
      f('bonus', 'Bonus / overtime', 'money'),
      f('deduction', 'Advance / deduction', 'money'),
      f('paidOn', 'Paid on', 'date', { default: () => today() }),
      f('mode', 'Paid by', 'select', { options: ['Cash', 'UPI', 'Bank transfer'], default: 'UPI' }),
      f('notes', 'Notes', 'textarea'),
    ],
    sort: (a, b) => b.month.localeCompare(a.month) || (b.paidOn || '').localeCompare(a.paidOn || ''),
  },

  // ───────────── Property & documents ─────────────
  {
    id: 'documents',
    collection: 'documents',
    label: 'Documents',
    singular: 'Document',
    icon: '🏠',
    title: (r) => r.title,
    subtitle: (r) => [r.type, r.property].filter(Boolean).join(' · '),
    columns: ['docNo', 'issueDate', 'expiryDate', 'location', 'file'],
    filterBy: 'type',
    fields: [
      f('title', 'Title', 'text', { required: true, placeholder: 'Sale deed – Flat 402' }),
      f('type', 'Type', 'select', {
        required: true,
        options: ['Sale deed', 'Rental agreement', 'Khata / Patta', 'Property tax receipt', 'Home loan', 'Encumbrance certificate', 'Occupancy / Completion cert.', 'Society share certificate', 'Will', 'Power of attorney', 'Identity / Address proof', 'Other'],
      }),
      f('property', 'Property', 'text', { placeholder: 'Flat 402, Green Heights' }),
      f('docNo', 'Document / registration no.', 'text'),
      f('issueDate', 'Issued on', 'date'),
      f('expiryDate', 'Expires / renew by', 'date'),
      f('location', 'Where is the original?', 'text', { placeholder: 'Bank locker, home safe…' }),
      f('file', 'Scan / photo', 'file'),
      f('notes', 'Notes', 'textarea'),
    ],
    status: (r) => (r.expiryDate ? expiryStatus(r.expiryDate, 60) : null),
    dates: [{ field: 'expiryDate', label: 'Document expires', lead: 60 }],
    sort: (a, b) => a.title.localeCompare(b.title),
  },

  // ───────────── Vehicles ─────────────
  {
    id: 'vehicles',
    collection: 'vehicles',
    label: 'Vehicles',
    singular: 'Vehicle',
    icon: '🚗',
    title: (r) => `${r.name}${r.regNo ? ' (' + r.regNo + ')' : ''}`,
    subtitle: (r) => [r.type, [r.make, r.model].filter(Boolean).join(' '), r.fuelType].filter(Boolean).join(' · '),
    columns: ['insuranceExpiry', 'pucExpiry', 'fitnessExpiry', 'nextServiceDate', 'nextServiceKm', 'rcCopy'],
    children: [
      { collection: 'vehicleServices', fk: 'vehicleId' },
      { collection: 'fuelLogs', fk: 'vehicleId' },
    ],
    fields: [
      f('name', 'Nickname', 'text', { required: true, placeholder: 'Swift, Activa…' }),
      f('type', 'Type', 'select', { options: ['Car', 'Bike', 'Scooter', 'Other'], default: 'Car' }),
      f('make', 'Make', 'text'),
      f('model', 'Model', 'text'),
      f('regNo', 'Registration no.', 'text'),
      f('fuelType', 'Fuel', 'select', { options: ['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid'], default: 'Petrol' }),
      f('purchaseDate', 'Purchased on', 'date'),
      f('insuranceExpiry', 'Insurance expires', 'date'),
      f('pucExpiry', 'PUC expires', 'date'),
      f('fitnessExpiry', 'Fitness / road tax due', 'date'),
      f('nextServiceDate', 'Next service date', 'date'),
      f('nextServiceKm', 'Next service at (km)', 'number'),
      f('rcCopy', 'RC / documents', 'file'),
      f('notes', 'Notes', 'textarea'),
    ],
    status: (r) => worst(expiryStatus(r.insuranceExpiry, 30), expiryStatus(r.pucExpiry, 15), expiryStatus(r.fitnessExpiry, 30), r.nextServiceDate ? dueStatus(r.nextServiceDate, 10) : null),
    dates: [
      { field: 'insuranceExpiry', label: 'Vehicle insurance', lead: 30 },
      { field: 'pucExpiry', label: 'PUC certificate', lead: 15 },
      { field: 'fitnessExpiry', label: 'Fitness / road tax', lead: 30 },
      { field: 'nextServiceDate', label: 'Service due', lead: 10 },
    ],
    sort: (a, b) => a.name.localeCompare(b.name),
    actions: [
      { label: '🔧 Log service', run: (r, ctx) => ctx.openForm('vehicleServices', { vehicleId: r.id, date: today() }) },
      { label: '⛽ Add fuel', run: (r, ctx) => ctx.openForm('fuelLogs', { vehicleId: r.id, date: today() }) },
    ],
  },
  {
    id: 'vehicleServices',
    collection: 'vehicleServices',
    label: 'Service & repairs',
    singular: 'Service record',
    icon: '🔧',
    title: (r, repo) => `${repo.get('vehicles', r.vehicleId)?.name || 'Vehicle'} · ${r.type}`,
    subtitle: (r) => [fmtDate(r.date), r.garage].filter(Boolean).join(' · '),
    amount: (r) => r.cost,
    columns: ['odometer', 'nextDueDate', 'nextDueKm', 'file'],
    filterBy: 'type',
    fields: [
      f('vehicleId', 'Vehicle', 'ref', { ref: 'vehicles', required: true }),
      f('date', 'Date', 'date', { required: true, default: () => today() }),
      f('type', 'Type', 'select', { options: ['Regular service', 'Repair', 'Tyres', 'Battery', 'Insurance renewal', 'PUC', 'Accessories', 'Accident / body work', 'Other'], default: 'Regular service' }),
      f('odometer', 'Odometer (km)', 'number'),
      f('cost', 'Cost', 'money', { required: true }),
      f('garage', 'Garage / workshop', 'text'),
      f('description', 'Work done', 'textarea'),
      f('nextDueDate', 'Next due (date)', 'date'),
      f('nextDueKm', 'Next due (km)', 'number'),
      f('file', 'Job card / invoice', 'file'),
    ],
    afterSave: async (rec, { repo }) => {
      const patch = {};
      if (rec.nextDueDate) patch.nextServiceDate = rec.nextDueDate;
      if (rec.nextDueKm) patch.nextServiceKm = rec.nextDueKm;
      if (Object.keys(patch).length && repo.get('vehicles', rec.vehicleId)) await repo.update('vehicles', rec.vehicleId, patch);
    },
    sort: byDateDesc('date'),
  },
  {
    id: 'fuelLogs',
    collection: 'fuelLogs',
    label: 'Fuel log',
    singular: 'Fuel fill-up',
    icon: '⛽',
    title: (r, repo) => `${repo.get('vehicles', r.vehicleId)?.name || 'Vehicle'} · ${r.liters || '?'} L`,
    subtitle: (r) => fmtDate(r.date),
    amount: (r) => r.amount,
    columns: ['odometer', 'pricePerLiter', 'fullTank', 'station'],
    fields: [
      f('vehicleId', 'Vehicle', 'ref', { ref: 'vehicles', required: true }),
      f('date', 'Date', 'date', { required: true, default: () => today() }),
      f('liters', 'Litres / kWh', 'number', { required: true, step: '0.01' }),
      f('amount', 'Total paid', 'money', { required: true }),
      f('odometer', 'Odometer (km)', 'number', { required: true }),
      f('fullTank', 'Filled to full tank', 'bool', { default: true }),
      f('station', 'Fuel station', 'text'),
    ],
    sort: (a, b) => b.date.localeCompare(a.date) || (b.odometer || 0) - (a.odometer || 0),
    // mileage is derived, never stored — see fuelStats() below
    prepare: (repo) => fuelStats(repo),
    extra: (r, stats) => {
      const m = stats.byId.get(r.id);
      const out = [];
      if (m?.mileage) out.push({ label: 'Mileage', value: `${m.mileage.toFixed(1)} km/L` });
      if (m?.costPerKm) out.push({ label: 'Cost/km', value: m.costPerKm.toFixed(2) });
      return out;
    },
  },

  // ───────────── Appliances ─────────────
  {
    id: 'appliances',
    collection: 'appliances',
    label: 'Appliances',
    singular: 'Appliance',
    icon: '🧺',
    title: (r) => r.name,
    subtitle: (r) => [r.category, [r.brand, r.model].filter(Boolean).join(' '), r.location].filter(Boolean).join(' · '),
    amount: (r) => r.price,
    columns: ['purchaseDate', 'warrantyEnd', 'amcEnd', 'nextServiceDate', 'supportPhone', 'file'],
    filterBy: 'category',
    children: [{ collection: 'applianceServices', fk: 'applianceId' }],
    fields: [
      f('name', 'Name', 'text', { required: true, placeholder: 'Kitchen fridge' }),
      f('category', 'Category', 'select', {
        required: true,
        options: ['Refrigerator', 'Washing machine', 'Dishwasher', 'Stove / hob', 'Water purifier / RO', 'Air conditioner', 'Microwave / oven', 'Chimney', 'Geyser', 'TV', 'Mixer / grinder', 'Other'],
      }),
      f('brand', 'Brand', 'text'),
      f('model', 'Model', 'text'),
      f('serialNo', 'Serial no.', 'text'),
      f('location', 'Room', 'text', { placeholder: 'Kitchen' }),
      f('purchaseDate', 'Purchased on', 'date'),
      f('price', 'Price paid', 'money'),
      f('store', 'Bought from', 'text'),
      f('warrantyEnd', 'Warranty ends', 'date'),
      f('amcEnd', 'AMC / extended warranty ends', 'date'),
      f('serviceEveryMonths', 'Service every (months)', 'number', { placeholder: '6' }),
      f('nextServiceDate', 'Next service due', 'date'),
      f('supportPhone', 'Service centre phone', 'tel'),
      f('file', 'Invoice / manual', 'file'),
      f('notes', 'Notes', 'textarea'),
    ],
    status: (r) =>
      worst(
        r.nextServiceDate ? dueStatus(r.nextServiceDate, 14) : null,
        r.warrantyEnd ? (daysUntil(r.warrantyEnd) < 0 ? S('Out of warranty', 'muted') : expiryStatus(r.warrantyEnd, 30)) : null,
      ),
    dates: [
      { field: 'nextServiceDate', label: 'Service due', lead: 14 },
      { field: 'warrantyEnd', label: 'Warranty ends', lead: 30, when: (r) => r.warrantyEnd && daysUntil(r.warrantyEnd) >= 0 }, // expired warranty isn't actionable
      { field: 'amcEnd', label: 'AMC ends', lead: 30, when: (r) => r.amcEnd && daysUntil(r.amcEnd) >= 0 },
    ],
    sort: (a, b) => a.name.localeCompare(b.name),
    actions: [
      { label: '🔧 Log service', run: (r, ctx) => ctx.openForm('applianceServices', { applianceId: r.id, date: today() }) },
      { label: '📞 Call', when: (r) => r.supportPhone, run: (r) => openExternal('tel:' + r.supportPhone) },
    ],
  },
  {
    id: 'applianceServices',
    collection: 'applianceServices',
    label: 'Service & repairs',
    singular: 'Service record',
    icon: '🔧',
    title: (r, repo) => `${repo.get('appliances', r.applianceId)?.name || 'Appliance'} · ${r.type}`,
    subtitle: (r) => [fmtDate(r.date), r.technician].filter(Boolean).join(' · '),
    amount: (r) => r.cost,
    columns: ['nextDueDate', 'file'],
    filterBy: 'type',
    fields: [
      f('applianceId', 'Appliance', 'ref', { ref: 'appliances', required: true }),
      f('date', 'Date', 'date', { required: true, default: () => today() }),
      f('type', 'Type', 'select', { options: ['Routine service', 'Repair', 'Filter / cartridge change', 'Installation', 'Gas refill', 'Other'], default: 'Routine service' }),
      f('cost', 'Cost', 'money'),
      f('technician', 'Technician / company', 'text'),
      f('description', 'Work done', 'textarea'),
      f('nextDueDate', 'Next due', 'date'),
      f('file', 'Bill / job sheet', 'file'),
    ],
    afterSave: async (rec, { repo }) => {
      const ap = repo.get('appliances', rec.applianceId);
      if (!ap) return;
      let next = rec.nextDueDate;
      if (!next && Number(ap.serviceEveryMonths)) next = addMonths(rec.date, Number(ap.serviceEveryMonths));
      if (next) await repo.update('appliances', ap.id, { nextServiceDate: next });
    },
    sort: byDateDesc('date'),
  },
];

export const MODULE = Object.fromEntries(MODULES.map((m) => [m.id, m]));
export const BY_COLLECTION = Object.fromEntries(MODULES.map((m) => [m.collection, m]));

/** Navigation: which modules share a screen. */
export const PAGES = [
  { id: 'bills', label: 'Bills & Utilities', short: 'Bills', icon: '🧾', modules: ['bills', 'subscriptions'] },
  { id: 'spending', label: 'Spending & Invoices', short: 'Spending', icon: '🛒', modules: ['expenses', 'invoices'] },
  { id: 'insurance', label: 'Insurance & Health', short: 'Health', icon: '🛡️', modules: ['policies', 'medical'] },
  { id: 'staff', label: 'Home Staff', short: 'Staff', icon: '🧑‍🍳', modules: ['staff', 'salaries'] },
  { id: 'property', label: 'Property & Documents', short: 'Property', icon: '🏠', modules: ['documents'] },
  { id: 'vehicles', label: 'Vehicles', short: 'Vehicles', icon: '🚗', modules: ['vehicles', 'vehicleServices', 'fuelLogs'] },
  { id: 'appliances', label: 'Appliances', short: 'Appliances', icon: '🧺', modules: ['appliances', 'applianceServices'] },
];
export const pageOfModule = (id) => PAGES.find((p) => p.modules.includes(id));

export const titleOf = (modId, rec, repo) => (rec ? MODULE[modId].title(rec, repo) : '—');

// ───────── derived data ─────────
/** Mileage via the full-tank method: distance between full fills ÷ litres added since. */
export function fuelStats(repo) {
  const byId = new Map();
  const perVehicle = {};
  const logs = repo.all('fuelLogs');
  for (const vid of new Set(logs.map((l) => l.vehicleId))) {
    const rows = logs.filter((l) => l.vehicleId === vid && Number(l.odometer) > 0).sort((a, b) => a.odometer - b.odometer);
    let lastFull = null;
    let litres = 0;
    let cost = 0;
    const mileages = [];
    for (const r of rows) {
      litres += Number(r.liters) || 0;
      cost += Number(r.amount) || 0;
      if (r.fullTank) {
        if (lastFull != null && litres > 0 && r.odometer > lastFull) {
          const dist = r.odometer - lastFull;
          const mileage = dist / litres;
          byId.set(r.id, { mileage, costPerKm: cost / dist });
          mileages.push(mileage);
        }
        lastFull = r.odometer;
        litres = 0;
        cost = 0;
      }
    }
    perVehicle[vid] = { mileages, avg: mileages.length ? sum(mileages) / mileages.length : null, last: mileages[mileages.length - 1] ?? null };
  }
  return { byId, perVehicle };
}

// Optional per-module summary block shown above the list. Pure functions of the repo.
import { h, money, num, sum, thisMonth, fmtDate, daysUntil } from '../core/util.js';
import { settings } from '../core/settings.js';
import { stats, barList, columns, card } from '../ui/components.js';
import { outflows, inMonth, monthlyTrend, byCategory } from '../domain/spending.js';
import { fuelStats, REPEAT } from '../domain/modules.js';

const monthlyEquivalent = (cost, cycle) => (Number(cost) || 0) / (REPEAT[cycle] || 1);
const ym = thisMonth();

export const INSIGHTS = {
  bills: (repo) => {
    const rows = repo.all('bills');
    const unpaid = rows.filter((r) => r.status !== 'Paid');
    const overdue = unpaid.filter((r) => daysUntil(r.dueDate) < 0);
    const paidNow = rows.filter((r) => r.status === 'Paid' && (r.paidOn || '').slice(0, 7) === ym);
    return stats([
      { label: 'Unpaid', value: money(sum(unpaid, (r) => r.amount)), hint: `${unpaid.length} bill${unpaid.length === 1 ? '' : 's'}`, tone: unpaid.length ? 'warn' : '' },
      { label: 'Overdue', value: overdue.length, tone: overdue.length ? 'bad' : 'ok' },
      { label: 'Paid this month', value: money(sum(paidNow, (r) => r.amount)) },
    ]);
  },
  subscriptions: (repo) => {
    const active = repo.all('subscriptions').filter((r) => r.status !== 'Cancelled');
    const monthly = sum(active, (r) => monthlyEquivalent(r.cost, r.billingCycle));
    return stats([
      { label: 'Per month (avg)', value: money(monthly) },
      { label: 'Per year', value: money(monthly * 12) },
      { label: 'Active', value: active.length },
    ]);
  },
  expenses: (repo) => {
    const rows = outflows(repo);
    const now = inMonth(rows, ym);
    const total = sum(now, (r) => r.amount);
    const budget = Number(settings.get().monthlyBudget) || 0;
    const mine = inMonth(rows, ym).filter((r) => r.area === 'Expenses');
    return h(
      'div',
      null,
      stats([
        { label: 'Spent this month (all areas)', value: money(total), hint: budget ? `${Math.round((total / budget) * 100)}% of ${money(budget)} budget` : 'Set a monthly budget in Settings', tone: budget && total > budget ? 'bad' : '' },
        { label: 'Day-to-day expenses', value: money(sum(mine, (r) => r.amount)) },
      ]),
      h('div', { class: 'two' }, card('Last 6 months', columns(monthlyTrend(rows))), card('This month by category', barList(byCategory(now).slice(0, 7)))),
    );
  },
  invoices: (repo) => {
    const rows = repo.all('invoices');
    const pending = rows.filter((r) => r.status === 'Pending');
    return stats([
      { label: 'Pending to pay', value: money(sum(pending, (r) => r.amount)), tone: pending.length ? 'warn' : '', hint: `${pending.length} invoice${pending.length === 1 ? '' : 's'}` },
      { label: 'Invoices stored', value: rows.length },
      { label: 'Tax (GST) on file', value: money(sum(rows, (r) => r.taxAmount)) },
    ]);
  },
  policies: (repo) => {
    const rows = repo.all('policies');
    const yearly = sum(rows, (r) => ({ Yearly: 1, 'Half-yearly': 2, Quarterly: 4, Monthly: 12, Single: 0 }[r.premiumFrequency] ?? 1) * (Number(r.premium) || 0));
    const next = [...rows].filter((r) => r.renewalDate).sort((a, b) => a.renewalDate.localeCompare(b.renewalDate))[0];
    return stats([
      { label: 'Policies', value: rows.length },
      { label: 'Premiums per year (approx.)', value: money(yearly) },
      next && { label: 'Next renewal', value: fmtDate(next.renewalDate), hint: `${next.type} · ${next.insurer}` },
    ]);
  },
  medical: (repo) => {
    const rows = repo.all('medical');
    const year = rows.filter((r) => r.date.slice(0, 4) === ym.slice(0, 4));
    const open = rows.filter((r) => r.claimStatus === 'Filed' || r.claimStatus === 'Approved');
    return stats([
      { label: 'Spent this year', value: money(sum(year, (r) => r.amount)) },
      { label: 'Claims in progress', value: open.length, hint: money(sum(open, (r) => r.claimAmount)), tone: open.length ? 'warn' : '' },
      { label: 'Recovered (settled)', value: money(sum(rows.filter((r) => r.claimStatus === 'Settled'), (r) => r.claimAmount)), tone: 'ok' },
    ]);
  },
  staff: (repo) => {
    const active = repo.all('staff').filter((r) => r.status !== 'Left');
    const unpaid = active.filter((s) => !repo.all('salaries').some((p) => p.staffId === s.id && p.month === ym));
    return stats([
      { label: 'Monthly payroll', value: money(sum(active, (r) => r.monthlySalary)), hint: `${active.length} active` },
      { label: 'Yet to pay this month', value: unpaid.length, hint: unpaid.map((s) => s.name).join(', '), tone: unpaid.length ? 'warn' : 'ok' },
    ]);
  },
  salaries: (repo) => {
    const rows = repo.all('salaries');
    const total = (r) => (Number(r.amount) || 0) + (Number(r.bonus) || 0) - (Number(r.deduction) || 0);
    return stats([
      { label: 'Paid this month', value: money(sum(rows.filter((r) => r.month === ym), total)) },
      { label: 'Paid this year', value: money(sum(rows.filter((r) => r.month.slice(0, 4) === ym.slice(0, 4)), total)) },
    ]);
  },
  documents: (repo) => {
    const rows = repo.all('documents');
    const soon = rows.filter((r) => r.expiryDate && daysUntil(r.expiryDate) <= 60);
    return stats([
      { label: 'Documents', value: rows.length },
      { label: 'With a file attached', value: rows.filter((r) => r.file).length },
      { label: 'Expiring / expired', value: soon.length, tone: soon.length ? 'warn' : 'ok' },
    ]);
  },
  vehicles: (repo) => {
    const fs = fuelStats(repo);
    const rows = repo.all('vehicles');
    return stats(
      rows.slice(0, 4).map((v) => {
        const spend = sum(repo.all('vehicleServices').filter((s) => s.vehicleId === v.id), (s) => s.cost) + sum(repo.all('fuelLogs').filter((s) => s.vehicleId === v.id), (s) => s.amount);
        const avg = fs.perVehicle[v.id]?.avg;
        return { label: v.name, value: avg ? `${num(avg)} km/L` : '—', hint: `Total spent ${money(spend)}` };
      }),
    );
  },
  vehicleServices: (repo) => {
    const rows = repo.all('vehicleServices');
    return stats([
      { label: 'Service & repair spend', value: money(sum(rows, (r) => r.cost)) },
      { label: 'This year', value: money(sum(rows.filter((r) => r.date.slice(0, 4) === ym.slice(0, 4)), (r) => r.cost)) },
    ]);
  },
  fuelLogs: (repo) => {
    const fs = fuelStats(repo);
    const rows = repo.all('fuelLogs');
    const month = rows.filter((r) => r.date.slice(0, 7) === ym);
    const perV = repo.all('vehicles').map((v) => ({ v, st: fs.perVehicle[v.id] })).filter((x) => x.st?.avg);
    return h(
      'div',
      null,
      stats([
        { label: 'Fuel spend this month', value: money(sum(month, (r) => r.amount)) },
        ...perV.map(({ v, st }) => ({ label: `${v.name} avg mileage`, value: `${num(st.avg)} km/L`, hint: st.last ? `last fill ${num(st.last)} km/L` : '' })),
      ]),
      rows.length < 2 ? h('p', { class: 'muted small' }, 'Tip: log full-tank fill-ups with the odometer reading — mileage is calculated between them.') : null,
    );
  },
  appliances: (repo) => {
    const rows = repo.all('appliances');
    const warranty = rows.filter((r) => r.warrantyEnd && daysUntil(r.warrantyEnd) >= 0);
    const due = rows.filter((r) => r.nextServiceDate && daysUntil(r.nextServiceDate) <= 14);
    return stats([
      { label: 'Appliances', value: rows.length, hint: `Worth ${money(sum(rows, (r) => r.price))}` },
      { label: 'Under warranty', value: warranty.length, tone: 'ok' },
      { label: 'Service due soon', value: due.length, tone: due.length ? 'warn' : '' },
    ]);
  },
  applianceServices: (repo) => {
    const rows = repo.all('applianceServices');
    return stats([{ label: 'Service & repair spend', value: money(sum(rows, (r) => r.cost)) }, { label: 'Records', value: rows.length }]);
  },
};

// One normalised "money went out" feed built from every module that records payments.
// Caveat (shown in the UI): if you log the same payment twice (e.g. as a Bill AND an Expense) it counts twice.
import { MODULE } from './modules.js';
import { shiftMonth, thisMonth, groupSum, sum } from '../core/util.js';

export function outflows(repo) {
  const out = [];
  const push = (date, amount, area, category) => {
    if (date && Number(amount) > 0) out.push({ date, amount: Number(amount), area, category: category || area });
  };
  repo.all('expenses').forEach((r) => push(r.date, r.amount, 'Expenses', r.category));
  repo.all('bills').filter((r) => r.status === 'Paid').forEach((r) => push(r.paidOn || r.dueDate, r.amount, 'Bills', r.category));
  repo.all('salaries').forEach((r) => push(r.paidOn || r.month + '-01', MODULE.salaries.amount(r), 'Home staff', 'Salaries'));
  repo.all('medical').forEach((r) => push(r.date, r.amount, 'Medical', r.type));
  repo.all('vehicleServices').forEach((r) => push(r.date, r.cost, 'Vehicles', 'Service & repairs'));
  repo.all('fuelLogs').forEach((r) => push(r.date, r.amount, 'Vehicles', 'Fuel'));
  repo.all('applianceServices').forEach((r) => push(r.date, r.cost, 'Appliances', r.type));
  repo.all('invoices').filter((r) => r.status === 'Paid').forEach((r) => push(r.date, r.amount, 'Invoices', r.category));
  return out;
}

export const inMonth = (rows, ym) => rows.filter((r) => r.date.slice(0, 7) === ym);

export function monthlyTrend(rows, n = 6) {
  const cur = thisMonth();
  return Array.from({ length: n }, (_, i) => {
    const ym = shiftMonth(cur, i - (n - 1));
    return { label: ym, value: sum(inMonth(rows, ym), (r) => r.amount) };
  });
}

export const byArea = (rows) => groupSum(rows, (r) => r.area, (r) => r.amount);
export const byCategory = (rows) => groupSum(rows, (r) => r.category, (r) => r.amount);

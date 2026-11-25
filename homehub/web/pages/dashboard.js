import { h, money, fmtDate, sum, thisMonth } from '../core/util.js';
import { settings } from '../core/settings.js';
import { repo } from '../data/index.js';
import { PAGES, MODULES } from '../domain/modules.js';
import { upcoming } from '../domain/alerts.js';
import { outflows, inMonth, monthlyTrend, byArea } from '../domain/spending.js';
import { stats, card, barList, columns } from '../ui/components.js';
import { openForm } from '../ui/form.js';
import { seedDemo } from '../domain/seed.js';

const dueText = (d) => (d < 0 ? `${-d}d overdue` : d === 0 ? 'today' : `in ${d}d`);

export function renderDashboard(ctx) {
  const root = h('div', { class: 'page' });
  const name = settings.get().name;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  root.append(h('div', { class: 'page-h' }, h('h1', null, `${greet}${name ? ', ' + name : ''} 👋`), h('p', { class: 'muted' }, 'Everything about your home, in one place.')));

  const total = MODULES.reduce((n, m) => n + repo.all(m.collection).length, 0);
  if (!total) {
    root.append(
      h(
        'div',
        { class: 'hero' },
        h('h2', null, 'Start tracking your home'),
        h('p', null, 'Add your first bill, policy or vehicle below — or load sample data to explore how it all fits together.'),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: async () => { await seedDemo(repo); ctx.toast('Sample data loaded'); } }, '✨ Load sample data')),
      ),
    );
  }

  const items = upcoming(repo);
  const overdue = items.filter((i) => i.days < 0);
  const week = items.filter((i) => i.days >= 0 && i.days <= 7);
  const rows = outflows(repo);
  const now = inMonth(rows, thisMonth());
  const budget = Number(settings.get().monthlyBudget) || 0;
  const spent = sum(now, (r) => r.amount);
  root.append(
    stats([
      { label: 'Overdue', value: overdue.length, tone: overdue.length ? 'bad' : 'ok', hint: overdue.length ? 'needs action' : 'all clear' },
      { label: 'Due in 7 days', value: week.length, tone: week.length ? 'warn' : '' },
      { label: 'Spent this month', value: money(spent), hint: budget ? `${Math.round((spent / budget) * 100)}% of budget` : 'across all areas', tone: budget && spent > budget ? 'bad' : '' },
    ]),
  );

  // quick add
  root.append(
    h(
      'div',
      { class: 'quick' },
      [
        ['bills', '🧾 Bill'], ['expenses', '🛒 Expense'], ['fuelLogs', '⛽ Fuel'], ['medical', '🏥 Medical'], ['invoices', '📄 Invoice'], ['salaries', '💰 Salary'], ['documents', '🏠 Document'],
      ].map(([id, label]) => h('button', { class: 'btn', type: 'button', onclick: () => openForm(id, { ctx }) }, '＋ ' + label)),
    ),
  );

  const upList = items.length
    ? h(
        'ul',
        { class: 'alerts' },
        items.slice(0, 12).map((i) => {
          const page = PAGES.find((p) => p.modules.includes(i.mod.id));
          return h(
            'li',
            { class: i.days < 0 ? 'bad' : i.days <= 3 ? 'warn' : '' },
            h('a', { href: `#/${page.id}/${i.mod.id}?open=${i.rec.id}` }, h('span', { class: 'a-ic' }, i.mod.icon), h('span', { class: 'a-main' }, h('b', null, i.title), h('small', null, `${i.label} · ${fmtDate(i.date)}`)), h('span', { class: 'a-side' }, i.amount ? h('b', null, money(i.amount)) : null, h('small', null, dueText(i.days)))),
          );
        }),
      )
    : h('p', { class: 'muted' }, total ? '🎉 Nothing needs your attention right now.' : 'Reminders for bills, renewals, services and expiries will appear here.');
  root.append(card('Needs attention', upList));

  root.append(
    h(
      'div',
      { class: 'two' },
      card('Spending — last 6 months', columns(monthlyTrend(rows))),
      card('This month by area', barList(byArea(now)), null),
    ),
    h('p', { class: 'muted small' }, 'Spending combines expenses, paid bills, salaries, medical, vehicle, appliance and paid-invoice records. Logging the same payment in two places counts it twice.'),
  );
  return root;
}

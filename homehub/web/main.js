// Composition root: boots data, builds the shell, wires the hash router + reminders.
import { h, today } from './core/util.js';
import { settings } from './core/settings.js';
import { repo } from './data/index.js';
import { PAGES } from './domain/modules.js';
import { upcoming } from './domain/alerts.js';
import { notify } from './platform/platform.js';
import { toast } from './ui/components.js';
import { openForm } from './ui/form.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderModulePage } from './pages/modulePage.js';
import { renderSettings } from './pages/settingsPage.js';

const app = document.getElementById('app');

// Context handed to actions/hooks so domain code never imports UI directly.
const ctx = {
  repo,
  toast,
  openForm: (modId, prefill) => openForm(modId, { prefill, ctx }),
  rerender: () => render(),
};

const NAV = [
  { id: 'dashboard', label: 'Home', icon: '🏡', href: '#/dashboard' },
  ...PAGES.map((p) => ({ id: p.id, label: p.label, short: p.short, icon: p.icon, href: `#/${p.id}` })),
  { id: 'settings', label: 'Settings', short: 'Settings', icon: '⚙️', href: '#/settings' },
];

function parseRoute() {
  const [path, qs] = location.hash.slice(1).split('?');
  const [, page = 'dashboard', tab] = path.split('/');
  return { page, tab, query: new URLSearchParams(qs || '') };
}

const main = h('main', { id: 'main', tabIndex: -1 });
const side = h('nav', { class: 'side', 'aria-label': 'Primary' });
const bottom = h('nav', { class: 'bottom', 'aria-label': 'Primary' });
app.append(h('aside', { class: 'sidebar' }, h('div', { class: 'brand' }, '🏡 HomeHub'), side), main, bottom);

function drawNav(active) {
  const link = (n, short) => h('a', { href: n.href, class: n.id === active ? 'active' : '', 'aria-current': n.id === active ? 'page' : null }, h('span', { class: 'ni' }, n.icon), h('span', { class: 'nl' }, short ? n.short || n.label : n.label));
  side.replaceChildren(...NAV.map((n) => link(n, false)));
  bottom.replaceChildren(...NAV.filter((n) => ['dashboard', 'bills', 'vehicles', 'insurance', 'settings'].includes(n.id)).map((n) => link(n, true)), h('a', { href: '#/more', class: 'more', onclick: (e) => { e.preventDefault(); document.body.classList.toggle('menu-open'); } }, h('span', { class: 'ni' }, '☰'), h('span', { class: 'nl' }, 'More')));
}

function render() {
  const { page, tab, query } = parseRoute();
  document.body.classList.remove('menu-open');
  const known = page === 'dashboard' || page === 'settings' || PAGES.some((p) => p.id === page);
  const id = known ? page : 'dashboard';
  drawNav(id);
  const view = id === 'dashboard' ? renderDashboard(ctx) : id === 'settings' ? renderSettings(ctx) : renderModulePage(id, tab, ctx, query);
  main.replaceChildren(view);
}

// re-render on any data/settings change, but don't clobber an open dialog's DOM (dialogs live outside #main)
let scheduled = false;
const schedule = () => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const keep = document.activeElement?.closest?.('.toolbar');
    const scroll = window.scrollY;
    const { page } = parseRoute();
    if (keep && page !== 'dashboard') return; // typing in search — the list redraws itself
    render();
    window.scrollTo(0, scroll);
  });
};

// ---- reminders (best effort, once per day per item) ----
async function runReminders() {
  if (!settings.get().reminders) return;
  const key = 'homehub:notified:' + today();
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(key) || '[]'); } catch { /* ignore */ }
  const urgent = upcoming(repo).filter((i) => i.days <= 3 && !seen.includes(i.rec.id + i.label));
  for (const i of urgent.slice(0, 5)) {
    await notify(`${i.mod.icon} ${i.title}`, `${i.label} ${i.days < 0 ? `was due ${-i.days} day(s) ago` : i.days === 0 ? 'is due today' : `in ${i.days} day(s)`}`);
    seen.push(i.rec.id + i.label);
  }
  try { localStorage.setItem(key, JSON.stringify(seen)); } catch { /* ignore */ }
}

async function boot() {
  await repo.init();
  render();
  window.addEventListener('hashchange', render);
  repo.onChange(schedule);
  settings.subscribe(schedule);
  runReminders();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e));
  }
}
boot().catch((e) => {
  console.error(e);
  app.replaceChildren(h('pre', { class: 'fatal' }, 'HomeHub failed to start:\n' + e.message));
});


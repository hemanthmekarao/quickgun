import { h, today, uid } from '../core/util.js';
import { settings } from '../core/settings.js';
import { repo } from '../data/index.js';
import { fileStore } from '../data/fileStore.js';
import { downloadFile, notificationsSupported, requestNotifyPermission, isNative } from '../platform/platform.js';
import { seedDemo } from '../domain/seed.js';
import { card } from '../ui/components.js';
import { confirmBox } from '../ui/components.js';

const blobToDataURL = (blob) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });

async function exportAll() {
  const files = {};
  for (const id of await fileStore.ids()) {
    const blob = await fileStore.get(id);
    if (blob) files[id] = { type: blob.type, name: blob.name || 'file', data: await blobToDataURL(blob) };
  }
  const payload = { app: 'homehub', version: 1, exportedAt: new Date().toISOString(), data: repo.dump(), files };
  await downloadFile(`homehub-backup-${today()}.json`, new Blob([JSON.stringify(payload)], { type: 'application/json' }));
}

async function importAll(file) {
  const payload = JSON.parse(await file.text());
  if (payload.app !== 'homehub' || !payload.data) throw new Error('Not a HomeHub backup file');
  await fileStore.clear();
  for (const [id, f] of Object.entries(payload.files || {})) {
    const blob = await (await fetch(f.data)).blob();
    await fileStore.putAt(id, new File([blob], f.name, { type: f.type })); // keep ids so records still resolve
  }
  await repo.replaceAll(payload.data);
}

export function renderSettings(ctx) {
  const s = settings.get();
  const root = h('div', { class: 'page' }, h('div', { class: 'page-h' }, h('h1', null, '⚙️ Settings')));

  const input = (label, key, props = {}) =>
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), h('input', { value: s[key] ?? '', ...props, onchange: (e) => settings.set({ [key]: props.type === 'number' ? Number(e.target.value) : e.target.value }) }));

  root.append(
    card(
      'Profile & currency',
      h(
        'div',
        { class: 'grid' },
        input('Your name', 'name'),
        input('Monthly budget', 'monthlyBudget', { type: 'number', min: 0 }),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Currency'), (() => {
          const sel = h('select', { onchange: (e) => settings.set({ currency: e.target.value }) }, ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD'].map((c) => h('option', { value: c }, c)));
          sel.value = s.currency;
          return sel;
        })()),
        input('Locale (number/date format)', 'locale', { placeholder: 'en-IN' }),
      ),
    ),
    card(
      'Reminders',
      h(
        'div',
        null,
        h('p', { class: 'muted' }, isNative() ? 'Native notifications are used in the installed app.' : 'Get a notification when something is due, expiring or overdue. In a browser, reminders fire when HomeHub is opened; the native app can schedule them in the background.'),
        notificationsSupported()
          ? h('button', { class: 'btn primary', onclick: async () => { const ok = await requestNotifyPermission(); settings.set({ reminders: ok }); ctx.toast(ok ? 'Reminders on' : 'Permission not granted'); ctx.rerender(); } }, s.reminders ? '✓ Reminders enabled' : 'Enable reminders')
          : h('p', { class: 'muted' }, 'Notifications are not supported in this browser.'),
      ),
    ),
    card(
      'Your data',
      h(
        'div',
        null,
        h('p', { class: 'muted' }, 'Everything is stored on this device only (browser storage). Export a backup regularly — clearing browser data deletes it.'),
        h(
          'div',
          { class: 'row wrap' },
          h('button', { class: 'btn', onclick: async () => { await exportAll(); ctx.toast('Backup downloaded'); } }, '⬇️ Export backup'),
          h('label', { class: 'btn' }, '⬆️ Import backup', h('input', { type: 'file', accept: 'application/json', hidden: true, onchange: async (e) => { try { if (e.target.files[0] && (await confirmBox('Importing replaces ALL current data. Continue?'))) { await importAll(e.target.files[0]); ctx.toast('Backup restored'); } } catch (err) { ctx.toast('Import failed: ' + err.message); } } })),
          h('button', { class: 'btn', onclick: async () => { await seedDemo(repo); ctx.toast('Sample data added'); } }, '✨ Add sample data'),
          h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Delete ALL HomeHub data on this device? This cannot be undone.')) { await repo.replaceAll({}); await fileStore.clear(); ctx.toast('All data deleted'); } } }, '🗑 Delete everything'),
        ),
      ),
    ),
    h('p', { class: 'muted small' }, `HomeHub 0.1 · storage: local · ${isNative() ? 'native app' : 'web'} · device id ${(localStorage.getItem('homehub:device') || (localStorage.setItem('homehub:device', uid().slice(0, 8)), localStorage.getItem('homehub:device')))}`),
  );
  return root;
}

// Generic screen for a group of modules: tabs → insights → search/filter → card list.
import { h, money, fmtDate, fmtMonth } from '../core/util.js';
import { MODULE, PAGES, titleOf } from '../domain/modules.js';
import { repo } from '../data/index.js';
import { fileStore } from '../data/fileStore.js';
import { pill } from '../ui/components.js';
import { openForm } from '../ui/form.js';
import { INSIGHTS } from './insights.js';

function chipValue(mod, key, rec) {
  const fd = mod.fields.find((x) => x.key === key);
  const v = rec[key];
  if (v === undefined || v === null || v === '' || v === false) return null;
  if (!fd) return String(v);
  switch (fd.type) {
    case 'date': return fmtDate(v);
    case 'month': return fmtMonth(v);
    case 'money': return money(v);
    case 'bool': return 'Yes';
    case 'ref': return titleOf(Object.values(MODULE).find((m) => m.collection === fd.ref).id, repo.get(fd.ref, v), repo);
    case 'file': return h('button', { class: 'chip-btn', type: 'button', onclick: (e) => { e.stopPropagation(); fileStore.open(v); } }, '📎 ' + v.name);
    default: return String(v);
  }
}

function renderItem(mod, rec, ctx, state) {
  const status = mod.status?.(rec, repo);
  const chips = (mod.columns || [])
    .map((k) => {
      const fd = mod.fields.find((x) => x.key === k);
      const val = chipValue(mod, k, rec);
      return val == null ? null : h('span', { class: 'chip' }, fd?.type === 'file' ? '' : h('em', null, (fd?.label || k) + ': '), val);
    })
    .concat((mod.extra?.(rec, state, repo) || []).map((c) => h('span', { class: 'chip hi' }, h('em', null, c.label + ': '), c.value)));
  const actions = (mod.actions || []).filter((a) => !a.when || a.when(rec, repo));
  return h(
    'article',
    { class: 'item', tabIndex: 0, 'data-id': rec.id, onclick: () => openForm(mod.id, { rec, ctx }), onkeydown: (e) => e.key === 'Enter' && openForm(mod.id, { rec, ctx }) },
    h(
      'div',
      { class: 'item-top' },
      h('div', { class: 'item-main' }, h('div', { class: 'item-title' }, mod.title(rec, repo)), h('div', { class: 'item-sub' }, mod.subtitle?.(rec, repo) || '')),
      h('div', { class: 'item-side' }, mod.amount && rec && mod.amount(rec, repo) !== undefined && mod.amount(rec, repo) !== '' ? h('div', { class: 'amount' }, money(mod.amount(rec, repo))) : null, pill(status)),
    ),
    chips.length ? h('div', { class: 'chips' }, chips) : null,
    actions.length
      ? h(
          'div',
          { class: 'item-actions' },
          actions.map((a) =>
            h('button', { class: 'btn small', type: 'button', onclick: async (e) => { e.stopPropagation(); await a.run(rec, ctx); } }, a.label),
          ),
        )
      : null,
  );
}

export function renderModulePage(pageId, tabId, ctx, query) {
  const page = PAGES.find((p) => p.id === pageId);
  const mod = MODULE[tabId || page.modules[0]];
  const root = h('div', { class: 'page' });

  root.append(h('div', { class: 'page-h' }, h('h1', null, `${page.icon} ${page.label}`)));
  if (page.modules.length > 1) {
    root.append(
      h(
        'nav',
        { class: 'tabs', role: 'tablist' },
        page.modules.map((id) =>
          h('a', { href: `#/${page.id}/${id}`, role: 'tab', class: id === mod.id ? 'active' : '' }, `${MODULE[id].icon} ${MODULE[id].label}`, h('span', { class: 'count' }, repo.all(MODULE[id].collection).length)),
        ),
      ),
    );
  }

  const insight = INSIGHTS[mod.id]?.(repo);
  if (insight) root.append(insight);

  // toolbar
  const search = h('input', { type: 'search', class: 'search', placeholder: `Search ${mod.label.toLowerCase()}…`, 'aria-label': 'Search' });
  const filterField = mod.filterBy && mod.fields.find((f) => f.key === mod.filterBy);
  const filter = filterField
    ? h('select', { class: 'filter', 'aria-label': 'Filter' }, h('option', { value: '' }, `All ${filterField.label.toLowerCase()}s`), filterField.options.map((o) => h('option', { value: o }, o)))
    : null;
  const addBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => openForm(mod.id, { ctx }) }, `＋ Add ${mod.singular.toLowerCase()}`);
  root.append(h('div', { class: 'toolbar' }, search, filter, addBtn));

  const list = h('div', { class: 'list' });
  root.append(list);

  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const state = mod.prepare?.(repo);
    let rows = [...repo.all(mod.collection)];
    if (filter?.value) rows = rows.filter((r) => r[mod.filterBy] === filter.value);
    if (q) rows = rows.filter((r) => (mod.title(r, repo) + ' ' + JSON.stringify(Object.values(r))).toLowerCase().includes(q));
    rows.sort(mod.sort || ((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')));
    list.replaceChildren(
      ...(rows.length
        ? rows.map((r) => renderItem(mod, r, ctx, state))
        : [
            h(
              'div',
              { class: 'empty' },
              h('div', { class: 'empty-i' }, mod.icon),
              h('p', null, repo.all(mod.collection).length ? 'No matches.' : `No ${mod.label.toLowerCase()} yet.`),
              repo.all(mod.collection).length ? null : h('button', { class: 'btn primary', type: 'button', onclick: () => openForm(mod.id, { ctx }) }, `Add your first ${mod.singular.toLowerCase()}`),
            ),
          ]),
    );
  };
  search.addEventListener('input', draw);
  filter?.addEventListener('change', draw);
  draw();

  // deep link from dashboard alerts: #/bills/bills?open=<id>
  if (query?.get('open')) {
    const rec = repo.get(mod.collection, query.get('open'));
    if (rec) queueMicrotask(() => openForm(mod.id, { rec, ctx }));
  }
  return root;
}

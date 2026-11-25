// Shared presentational pieces: toast, pills, stat tiles, charts (pure CSS, no libs).
import { h, money, fmtMonth } from '../core/util.js';

export function toast(msg, ms = 2400) {
  const el = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, ms);
}

export const pill = (s) => (s ? h('span', { class: `pill ${s.tone}` }, s.label) : null);

export const stats = (items) =>
  h(
    'div',
    { class: 'stats' },
    items
      .filter(Boolean)
      .map((s) => h('div', { class: `stat ${s.tone || ''}` }, h('div', { class: 'stat-v' }, s.value), h('div', { class: 'stat-l' }, s.label), s.hint && h('div', { class: 'stat-h' }, s.hint))),
  );

/** Horizontal bars: [{label, value}] */
export function barList(items, { fmt = money, max } = {}) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return h('div', { class: 'muted small' }, 'Nothing yet.');
  return h(
    'div',
    { class: 'bars' },
    items.map((i) =>
      h(
        'div',
        { class: 'bar-row' },
        h('div', { class: 'bar-label' }, i.label),
        h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: `${Math.max(2, (i.value / top) * 100)}%` } })),
        h('div', { class: 'bar-val' }, fmt(i.value)),
      ),
    ),
  );
}

/** Vertical columns for a time series: [{label:'2026-05', value}] */
export function columns(items, { fmt = money, monthLabels = true } = {}) {
  const top = Math.max(1, ...items.map((i) => i.value));
  return h(
    'div',
    { class: 'cols' },
    items.map((i) =>
      h(
        'div',
        { class: 'col', title: `${i.label}: ${fmt(i.value)}` },
        h('div', { class: 'col-val' }, i.value ? fmt(i.value, { decimals: 0 }) : ''),
        h('div', { class: 'col-bar', style: { height: `${Math.max(3, (i.value / top) * 100)}%` } }),
        h('div', { class: 'col-label' }, monthLabels ? fmtMonth(i.label).split(' ')[0] : i.label),
      ),
    ),
  );
}

export const card = (title, body, right) =>
  h('section', { class: 'panel' }, h('header', { class: 'panel-h' }, h('h3', null, title), right), body);

export function confirmBox(message) {
  return Promise.resolve(window.confirm(message));
}

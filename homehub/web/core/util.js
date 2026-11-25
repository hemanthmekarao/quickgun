// Small dependency-free helpers: DOM builder, dates, ids, formatting.
import { settings } from './settings.js';

export const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Tiny hyperscript helper: h('div', {class:'x', onclick}, child, ...) */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// ---- dates (all stored as local-time ISO strings: YYYY-MM-DD / YYYY-MM) ----
const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => toISO(new Date());
export const thisMonth = () => today().slice(0, 7);
export const parseISO = (s) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
export const daysUntil = (s) => Math.round((parseISO(s) - parseISO(today())) / 864e5);
export function addMonths(s, n) {
  const d = parseISO(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISO(d);
}
export const addDays = (s, n) => {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
export const clampDay = (ym, day) => {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${ym}-${pad(Math.min(Math.max(1, Number(day) || 1), last))}`;
};
export const shiftMonth = (ym, n) => addMonths(ym + '-01', n).slice(0, 7);

// ---- formatting (driven by user settings) ----
export const fmtDate = (s) =>
  s ? parseISO(s).toLocaleDateString(settings.get().locale, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
export const fmtMonth = (ym) =>
  ym ? parseISO(ym + '-01').toLocaleDateString(settings.get().locale, { month: 'short', year: 'numeric' }) : '';
export const money = (n, opts = {}) => {
  const { locale, currency } = settings.get();
  const v = Number(n) || 0;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: opts.decimals ?? (Math.abs(v) >= 1000 ? 0 : 2),
  }).format(v);
};
export const num = (n, d = 1) => (Number.isFinite(n) ? n.toLocaleString(settings.get().locale, { maximumFractionDigits: d }) : '–');

export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
export const groupSum = (arr, keyFn, valFn) => {
  const m = new Map();
  for (const x of arr) m.set(keyFn(x), (m.get(keyFn(x)) || 0) + (Number(valFn(x)) || 0));
  return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
};

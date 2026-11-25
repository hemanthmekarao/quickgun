// Schema-driven create/edit dialog: renders any module's `fields`.
import { h } from '../core/util.js';
import { MODULE, BY_COLLECTION, titleOf } from '../domain/modules.js';
import { repo } from '../data/index.js';
import { fileStore } from '../data/fileStore.js';
import { toast, confirmBox } from './components.js';

const resolveDefault = (fd) => (typeof fd.default === 'function' ? fd.default() : fd.default);

function control(fd, value, state) {
  const common = { name: fd.key, id: 'f-' + fd.key, required: !!fd.required, placeholder: fd.placeholder || '' };
  switch (fd.type) {
    case 'textarea':
      return h('textarea', { ...common, rows: 2, value: value ?? '' });
    case 'select': {
      const sel = h('select', common, h('option', { value: '' }, fd.required ? 'Select…' : '—'), fd.options.map((o) => h('option', { value: o }, o)));
      sel.value = value ?? '';
      return sel;
    }
    case 'ref': {
      const target = BY_COLLECTION[fd.ref];
      const rows = repo.all(fd.ref);
      const sel = h(
        'select',
        common,
        h('option', { value: '' }, rows.length ? 'Select…' : `Add a ${target.singular.toLowerCase()} first`),
        rows.map((r) => h('option', { value: r.id }, titleOf(target.id, r, repo))),
      );
      sel.value = value ?? '';
      return sel;
    }
    case 'bool':
      return h('input', { ...common, type: 'checkbox', checked: !!value, class: 'chk' });
    case 'file': {
      const wrap = h('div', { class: 'filebox' });
      const draw = () => {
        wrap.replaceChildren();
        const current = state.files[fd.key] !== undefined ? state.files[fd.key] : value;
        if (current) {
          wrap.append(
            h('span', { class: 'file-name' }, '📎 ' + current.name),
            current.id && !(current instanceof File) ? h('button', { type: 'button', class: 'btn tiny', onclick: () => fileStore.open(current) }, 'View') : null,
            h('button', { type: 'button', class: 'btn tiny danger', onclick: () => { state.files[fd.key] = null; draw(); } }, 'Remove'),
          );
        }
        wrap.append(
          h('input', {
            type: 'file',
            accept: 'image/*,application/pdf,.doc,.docx,.xls,.xlsx',
            onchange: (e) => {
              if (e.target.files[0]) {
                state.files[fd.key] = e.target.files[0];
                draw();
              }
            },
          }),
        );
      };
      draw();
      return wrap;
    }
    default: {
      const type = { money: 'number', number: 'number', month: 'month', url: 'url', tel: 'tel', date: 'date', text: 'text' }[fd.type] || 'text';
      const el = h('input', { ...common, type, value: value ?? '' });
      if (fd.type === 'money') Object.assign(el, { step: '0.01', min: '0', inputMode: 'decimal' });
      if (fd.type === 'number') Object.assign(el, { step: fd.step || 'any', inputMode: 'decimal' });
      if (fd.min != null) el.min = fd.min;
      if (fd.max != null) el.max = fd.max;
      return el;
    }
  }
}

/**
 * Open the dialog.
 * @param {string} modId  module id
 * @param {{rec?:object, prefill?:object, ctx:object}} opts
 */
export function openForm(modId, { rec = null, prefill = {}, ctx } = {}) {
  const mod = MODULE[modId];
  const state = { files: {} };
  const values = rec ? { ...rec } : {};
  if (!rec) {
    for (const fd of mod.fields) {
      const d = resolveDefault(fd);
      if (d !== undefined) values[fd.key] = d;
    }
    Object.assign(values, prefill);
  }

  const form = h('form', { class: 'form', novalidate: false });
  const grid = h('div', { class: 'grid' });
  for (const fd of mod.fields) {
    const full = fd.type === 'textarea' || fd.type === 'file';
    grid.append(
      h(
        'label',
        { class: `field ${full ? 'full' : ''} ${fd.type === 'bool' ? 'inline' : ''}`, for: 'f-' + fd.key },
        h('span', { class: 'lbl' }, fd.label, fd.required ? h('b', null, ' *') : null),
        control(fd, values[fd.key], state),
      ),
    );
  }
  form.append(grid);

  const close = () => overlay.remove();
  const saveBtn = h('button', { class: 'btn primary', type: 'submit' }, rec ? 'Save changes' : `Add ${mod.singular.toLowerCase()}`);
  const footer = h(
    'div',
    { class: 'modal-f' },
    rec
      ? h(
          'button',
          {
            type: 'button',
            class: 'btn danger',
            onclick: async () => {
              if (!(await confirmBox(`Delete this ${mod.singular.toLowerCase()}${mod.children ? ' and everything logged under it' : ''}?`))) return;
              await deleteRecord(mod, rec);
              close();
              toast('Deleted');
            },
          },
          'Delete',
        )
      : h('span'),
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'), saveBtn),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    saveBtn.disabled = true;
    try {
      const data = {};
      for (const fd of mod.fields) {
        const el = form.elements[fd.key];
        if (fd.type === 'file') {
          const chosen = state.files[fd.key];
          const old = values[fd.key];
          if (chosen instanceof File) {
            data[fd.key] = await fileStore.put(chosen);
            if (old?.id) await fileStore.delete(old.id);
          } else if (chosen === null) {
            if (old?.id) await fileStore.delete(old.id);
            data[fd.key] = null;
          } else data[fd.key] = old ?? null;
        } else if (fd.type === 'bool') data[fd.key] = el.checked;
        else if (fd.type === 'money' || fd.type === 'number') data[fd.key] = el.value === '' ? '' : Number(el.value);
        else data[fd.key] = el.value;
      }
      const saved = rec ? await repo.update(mod.collection, rec.id, data) : await repo.create(mod.collection, data);
      if (mod.afterSave) await mod.afterSave(saved, ctx);
      toast(rec ? 'Saved' : `${mod.singular} added`);
      close();
    } catch (err) {
      console.error(err);
      toast('Could not save: ' + err.message);
      saveBtn.disabled = false;
    }
  });
  form.append(footer);

  const overlay = h(
    'div',
    { class: 'overlay', onmousedown: (e) => e.target === overlay && close() },
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, h('header', { class: 'modal-h' }, h('h2', null, `${mod.icon} ${rec ? 'Edit' : 'New'} ${mod.singular.toLowerCase()}`), h('button', { class: 'icon-btn', type: 'button', onclick: close, 'aria-label': 'Close' }, '✕')), form),
  );
  document.body.append(overlay);
  overlay.querySelector('input:not([type=file]):not([type=checkbox]), select, textarea')?.focus();
}

export async function deleteRecord(mod, rec) {
  for (const fd of mod.fields) if (fd.type === 'file' && rec[fd.key]?.id) await fileStore.delete(rec[fd.key].id);
  for (const ch of mod.children || []) {
    const childMod = Object.values(MODULE).find((m) => m.collection === ch.collection);
    for (const c of [...repo.all(ch.collection)].filter((x) => x[ch.fk] === rec.id)) await deleteRecord(childMod, c);
  }
  await repo.remove(mod.collection, rec.id);
}

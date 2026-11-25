'use client';

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { CORE_REF_TARGETS, getResource, humanize, type FieldDef, type ResourceDef } from '@homeos/shared';
import { api, errorMessage } from '@/lib/api';
import { cx, date, dateTime, money } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Badge, Button, EmptyState, ErrorNote, Field, Modal, Spinner, statusTone } from './ui';

export type Row = Record<string, any>;

/* ------------------------------------------------------------------ */
/* Displaying a field value                                            */
/* ------------------------------------------------------------------ */

export function FieldValue({ field, row, currency }: { field: FieldDef; row: Row; currency: string }): ReactNode {
  const v = row[field.key];
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return <span className="text-muted">—</span>;
  switch (field.type) {
    case 'money':
      return <span className="tabular">{money(v, currency)}</span>;
    case 'date':
      return date(v);
    case 'datetime':
      return dateTime(v);
    case 'boolean':
      return v ? 'Yes' : 'No';
    case 'enum':
      return field.key === 'status' || /status$/i.test(field.key) || field.key === 'priority' || field.key === 'condition' ? <Badge tone={statusTone(v)}>{humanize(v)}</Badge> : humanize(v);
    case 'ref':
      return row._refs?.[field.key]?.label ?? <span className="text-muted">Linked record</span>;
    case 'tags':
      return (
        <span className="flex flex-wrap gap-1">
          {(v as string[]).map((t) => (
            <Badge key={t}>{field.options ? humanize(t) : t}</Badge>
          ))}
        </span>
      );
    case 'json':
      return <code className="text-xs">{JSON.stringify(v)}</code>;
    case 'number':
    case 'int':
      return <span className="tabular">{String(v)}</span>;
    default:
      return String(v);
  }
}

/* ------------------------------------------------------------------ */
/* Options for reference fields                                        */
/* ------------------------------------------------------------------ */

export function useRefOptions(ref: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['ref-options', ref],
    enabled: Boolean(ref) && enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<{ id: string; label: string }[]> => {
      if (!ref) return [];
      if (CORE_REF_TARGETS[ref]) {
        const members = await api.get<any[]>('/members');
        return members.filter((m) => m.status !== 'REMOVED').map((m) => ({ id: m.id, label: m.name }));
      }
      const def = getResource(ref);
      const page = await api.resource(ref).list({ pageSize: 200, sort: def.titleField, order: 'asc' });
      return page.items.map((r) => ({ id: r.id, label: String(r[def.titleField] ?? '').trim() || `${def.singular} (${date(r.createdAt)})` }));
    },
  });
}

function RefSelect({ field, value, onChange }: { field: FieldDef; value: string; onChange: (v: string) => void }) {
  const { data, isLoading, error } = useRefOptions(field.ref, true);
  return (
    <select className="field" value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={isLoading}>
      <option value="">{isLoading ? 'Loading…' : error ? 'Not available' : field.required ? 'Select…' : 'None'}</option>
      {(data ?? []).map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/* ------------------------------------------------------------------ */
/* Form                                                                */
/* ------------------------------------------------------------------ */

function toInput(field: FieldDef, v: any): any {
  if (v === null || v === undefined) return field.type === 'boolean' ? false : field.type === 'tags' ? '' : '';
  if (field.type === 'tags') return (v as string[]).join(', ');
  if (field.type === 'date') return String(v).slice(0, 10);
  if (field.type === 'datetime') {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }
  return v;
}

function fromInput(field: FieldDef, v: any): any {
  if (field.type === 'boolean') return Boolean(v);
  if (field.type === 'tags') {
    if (Array.isArray(v)) return v;
    return String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (v === '' || v === undefined) return null;
  if (field.type === 'datetime') return new Date(v).toISOString();
  if (field.type === 'int' || field.type === 'number' || field.type === 'money') return Number(v);
  return v;
}

function Input({ field, value, onChange }: { field: FieldDef; value: any; onChange: (v: any) => void }) {
  switch (field.type) {
    case 'text':
      return <textarea className="field min-h-[84px]" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'int':
    case 'number':
    case 'money':
      return <input className="field tabular" type="number" inputMode="decimal" step={field.type === 'int' ? 1 : 'any'} min={field.min} max={field.max} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'date':
      return <input className="field" type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'datetime':
      return <input className="field" type="datetime-local" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'boolean':
      return (
        <span className="flex h-9 items-center gap-2">
          <input type="checkbox" className="h-4 w-4 rounded border-line accent-[rgb(var(--accent))]" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          <span className="text-sm text-muted">Yes</span>
        </span>
      );
    case 'enum':
      return (
        <select className="field" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          {!field.required || !value ? <option value="">{field.required ? 'Select…' : '—'}</option> : null}
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {humanize(o)}
            </option>
          ))}
        </select>
      );
    case 'ref':
      return <RefSelect field={field} value={value} onChange={onChange} />;
    case 'tags':
      if (field.options) {
        const selected: string[] = Array.isArray(value) ? value : String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        return (
          <span className="flex flex-wrap gap-x-4 gap-y-2 py-1.5">
            {field.options.map((o) => (
              <label key={o} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" checked={selected.includes(o)} onChange={(e) => onChange(e.target.checked ? [...selected, o] : selected.filter((x) => x !== o))} />
                {humanize(o)}
              </label>
            ))}
          </span>
        );
      }
      return <input className="field" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="Comma separated" />;
    default:
      return <input className="field" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
}

export interface RecordFormProps {
  resource: string;
  record?: Row | null;
  /** Values fixed by the page (e.g. the parent vehicle); hidden from the form. */
  fixed?: Row;
  /** Initial values for a new record. */
  defaults?: Row;
  /** Restrict the form to these fields. */
  only?: string[];
  onSaved: (row: Row) => void;
  onCancel: () => void;
}

export function RecordForm({ resource, record, fixed = {}, defaults = {}, only, onSaved, onCancel }: RecordFormProps) {
  const def = getResource(resource);
  const qc = useQueryClient();
  const fields = useMemo(() => def.fields.filter((f) => !f.system && !(f.key in fixed) && (!only || only.includes(f.key))), [def, fixed, only]);
  const [values, setValues] = useState<Row>(() => {
    const init: Row = {};
    for (const f of fields) {
      const source = record ? record[f.key] : (defaults[f.key] ?? f.default);
      init[f.key] = toInput(f, source);
    }
    return init;
  });
  const [issues, setIssues] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: async () => {
      const body: Row = {};
      for (const f of fields) {
        const v = fromInput(f, values[f.key]);
        if (record) {
          const before = fromInput(f, toInput(f, record[f.key]));
          if (JSON.stringify(v) !== JSON.stringify(before)) body[f.key] = v;
        } else if (v !== null && !(Array.isArray(v) && v.length === 0)) body[f.key] = v;
      }
      if (record) {
        if (Object.keys(body).length === 0) return record;
        return api.resource(resource).update(record.id, body);
      }
      return api.resource(resource).create({ ...body, ...fixed });
    },
    onSuccess: (row) => {
      qc.invalidateQueries();
      onSaved(row as Row);
    },
    onError: (err: any) => {
      const map: Record<string, string> = {};
      for (const i of err?.issues ?? []) map[i.field] = i.message;
      setIssues(map);
    },
  });

  const groups = useMemo(() => {
    const out: { name: string; fields: FieldDef[] }[] = [];
    for (const f of fields) {
      const name = f.group ?? '';
      const g = out.find((x) => x.name === name);
      if (g) g.fields.push(f);
      else out.push({ name, fields: [f] });
    }
    return out;
  }, [fields]);

  function submit(e: FormEvent) {
    e.preventDefault();
    setIssues({});
    save.mutate();
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="space-y-6">
        {groups.map((g) => (
          <fieldset key={g.name || 'main'}>
            {g.name ? <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{g.name}</legend> : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {g.fields.map((f) => (
                <div key={f.key} className={cx(f.type === 'text' || (f.type === 'tags' && f.options) ? 'sm:col-span-2' : '')}>
                  <Field label={f.label} required={f.required} error={issues[f.key]} help={f.help}>
                    <Input field={f} value={values[f.key]} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
                  </Field>
                </div>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      {save.error && Object.keys(issues).filter((k) => fields.some((f) => f.key === k)).length === 0 ? (
        <div className="mt-4">
          <ErrorNote error={save.error} />
        </div>
      ) : null}
      <div className="mt-6 flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {record ? 'Save changes' : `Add ${def.singular.toLowerCase()}`}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* List view                                                           */
/* ------------------------------------------------------------------ */

export interface ResourceViewProps {
  resource: string;
  /** Server-side filters always applied (e.g. { vehicleId }). Also used as fixed values for new records. */
  filter?: Row;
  /** Extra fixed values for new records. */
  fixed?: Row;
  defaults?: Row;
  /** Columns to show; defaults to fields marked for tables. */
  columns?: string[];
  /** Link target for a row. */
  href?: (row: Row) => string;
  /** Extra per-row buttons. */
  rowActions?: (row: Row, refresh: () => void) => ReactNode;
  /** Extra toolbar buttons. */
  actions?: ReactNode;
  readOnly?: boolean;
  canCreate?: boolean;
  title?: string;
  emptyHint?: string;
  pageSize?: number;
  hideSearch?: boolean;
}

export function ResourceView({ resource, filter = {}, fixed = {}, defaults, columns, href, rowActions, actions, readOnly, canCreate = true, title, emptyHint, pageSize = 25, hideSearch }: ResourceViewProps) {
  const def: ResourceDef = getResource(resource);
  const session = useSession();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [enumFilter, setEnumFilter] = useState('');
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Row | null>(null);

  const fixedKeys = Object.keys({ ...filter, ...fixed });
  const cols = useMemo(() => {
    const keys = columns ?? def.fields.filter((f) => f.table && !fixedKeys.includes(f.key)).map((f) => f.key);
    return keys.map((k) => def.fields.find((f) => f.key === k)).filter(Boolean) as FieldDef[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, columns, fixedKeys.join(',')]);
  const filterField = useMemo(() => def.fields.find((f) => f.type === 'enum' && f.table && !fixedKeys.includes(f.key) && (f.key === 'status' || /Type$|category|role/.test(f.key))), [def, fixedKeys]);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const query = { ...filter, q: search || undefined, page, pageSize, ...(filterField && enumFilter ? { [filterField.key]: enumFilter } : {}) };
  const list = useQuery({ queryKey: ['resource', resource, session.household?.id, query], queryFn: () => api.resource(resource).list(query) });

  const remove = useMutation({
    mutationFn: (id: string) => api.resource(resource).remove(id),
    onSuccess: () => {
      setDeleting(null);
      qc.invalidateQueries();
    },
  });

  const writable = !readOnly && !def.readOnly && session.can(def.module, 'write');
  const deletable = !readOnly && !def.readOnly && session.can(def.module, 'delete');
  const showCreate = writable && canCreate && !def.noCreate;
  const refresh = () => qc.invalidateQueries();
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const hasActions = writable || deletable || Boolean(rowActions);

  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {title ? <h2 className="mr-2 text-sm font-semibold">{title}</h2> : null}
          {!hideSearch && def.search.length > 0 ? (
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden />
              <input className="field pl-8" placeholder={`Search ${def.plural.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${def.plural}`} />
            </div>
          ) : null}
          {filterField ? (
            <select
              className="field w-auto"
              value={enumFilter}
              onChange={(e) => {
                setEnumFilter(e.target.value);
                setPage(1);
              }}
              aria-label={`Filter by ${filterField.label}`}
            >
              <option value="">All {filterField.label.toLowerCase()}</option>
              {(filterField.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {humanize(o)}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {showCreate ? (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              Add {def.singular.toLowerCase()}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <div className="p-4">
            <ErrorNote error={list.error} />
          </div>
        ) : total === 0 ? (
          <EmptyState
            title={search || enumFilter ? 'Nothing matches your search' : `No ${def.plural.toLowerCase()} yet`}
            description={search || enumFilter ? 'Try a different search or clear the filter.' : (emptyHint ?? def.description)}
            action={showCreate && !search && !enumFilter ? <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Add {def.singular.toLowerCase()}</Button> : undefined}
          />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  {cols.map((c) => (
                    <th key={c.key} scope="col" className={cx('whitespace-nowrap px-4 py-2.5 font-medium', (c.type === 'money' || c.type === 'number' || c.type === 'int') && 'text-right')}>
                      {c.label}
                    </th>
                  ))}
                  {hasActions ? <th scope="col" className="px-4 py-2.5 text-right font-medium" aria-label="Actions" /> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.data!.items.map((row) => (
                  <tr key={row.id} className="hover:bg-subtle/60">
                    {cols.map((c, i) => (
                      <td key={c.key} className={cx('max-w-[280px] truncate px-4 py-2.5 align-middle', (c.type === 'money' || c.type === 'number' || c.type === 'int') && 'text-right', i === 0 && 'font-medium')}>
                        {i === 0 && href ? (
                          <Link href={href(row)} className="text-ink underline-offset-2 hover:underline">
                            <FieldValue field={c} row={row} currency={session.currency} />
                          </Link>
                        ) : (
                          <FieldValue field={c} row={row} currency={session.currency} />
                        )}
                      </td>
                    ))}
                    {hasActions ? (
                      <td className="whitespace-nowrap px-4 py-1.5 text-right align-middle">
                        <span className="inline-flex items-center gap-1">
                          {rowActions?.(row, refresh)}
                          {writable ? (
                            <button type="button" className="rounded-md p-1.5 text-muted hover:bg-subtle hover:text-ink" onClick={() => setEditing(row)} aria-label={`Edit ${def.singular.toLowerCase()}`}>
                              <Pencil className="h-4 w-4" />
                            </button>
                          ) : null}
                          {deletable ? (
                            <button type="button" className="rounded-md p-1.5 text-muted hover:bg-danger/10 hover:text-danger" onClick={() => setDeleting(row)} aria-label={`Delete ${def.singular.toLowerCase()}`}>
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ) : null}
                        </span>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > pageSize ? (
          <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-muted">
            <span>
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
            </span>
            <span className="flex items-center gap-1">
              <button type="button" className="rounded p-1 hover:bg-subtle disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span>
                Page {page} of {pages}
              </span>
              <button type="button" className="rounded p-1 hover:bg-subtle disabled:opacity-40" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                <ChevronRight className="h-4 w-4" />
              </button>
            </span>
          </div>
        ) : null}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title={`Add ${def.singular.toLowerCase()}`} wide={def.fields.filter((f) => !f.system).length > 8}>
        {creating ? <RecordForm resource={resource} fixed={{ ...filter, ...fixed }} defaults={defaults} onSaved={() => setCreating(false)} onCancel={() => setCreating(false)} /> : null}
      </Modal>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={`Edit ${def.singular.toLowerCase()}`} wide={def.fields.filter((f) => !f.system).length > 8}>
        {editing ? <RecordForm resource={resource} record={editing} fixed={fixed} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} /> : null}
      </Modal>
      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Delete ${def.singular.toLowerCase()}?`}
        description="The record is removed from all lists. It is kept in the audit history."
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>
              Delete
            </Button>
          </>
        }
      >
        {remove.error ? <ErrorNote error={remove.error} /> : <p className="text-sm text-muted">This cannot be undone from the app.</p>}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Single record: details + edit                                       */
/* ------------------------------------------------------------------ */

export function useRecord(resource: string, id: string | undefined) {
  const session = useSession();
  return useQuery({ queryKey: ['record', resource, session.household?.id, id], enabled: Boolean(id), queryFn: () => api.resource(resource).get(id as string) });
}

/** All populated fields of a record, grouped as in the form. */
export function RecordFields({ resource, row, exclude = [] }: { resource: string; row: Row; exclude?: string[] }) {
  const def = getResource(resource);
  const session = useSession();
  const groups: { name: string; fields: FieldDef[] }[] = [];
  for (const f of def.fields) {
    if (f.hidden || exclude.includes(f.key) || f.detailOnly) continue;
    const v = row[f.key];
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    if (f.system && f.key === 'status') continue;
    const name = f.group ?? 'Details';
    const g = groups.find((x) => x.name === name);
    if (g) g.fields.push(f);
    else groups.push({ name, fields: [f] });
  }
  if (groups.length === 0) return <p className="text-sm text-muted">No details recorded yet.</p>;
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.name}>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{g.name}</h3>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.fields.map((f) => (
              <div key={f.key} className="min-w-0">
                <dt className="text-xs text-muted">{f.label}</dt>
                <dd className="mt-0.5 break-words text-sm">
                  <FieldValue field={f} row={row} currency={session.currency} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

export function EditRecordButton({ resource, row, label = 'Edit' }: { resource: string; row: Row; label?: string }) {
  const def = getResource(resource);
  const session = useSession();
  const [open, setOpen] = useState(false);
  if (def.readOnly || !session.can(def.module, 'write')) return null;
  return (
    <>
      <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Edit ${def.singular.toLowerCase()}`} wide>
        {open ? <RecordForm resource={resource} record={row} onSaved={() => setOpen(false)} onCancel={() => setOpen(false)} /> : null}
      </Modal>
    </>
  );
}

export { errorMessage };

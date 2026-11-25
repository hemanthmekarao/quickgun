'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Search, Upload, X } from 'lucide-react';
import { EXPENSE_CATEGORIES, SENSITIVITIES, UTILITY_TYPES, humanize } from '@homeos/shared';
import { api } from '@/lib/api';
import { date, fileSize, label, money, todayIso } from '@/lib/format';
import { useQueryParams, useTab } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { ResourceView, useRefOptions, type Row } from '@/components/resource';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, Notice, PageHeader, Spinner, Tabs, statusTone } from '@/components/ui';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.heic,.txt,.csv,.md,.eml,.doc,.docx,.xls,.xlsx';

function UploadDialog({ open, onClose, links, toInbox }: { open: boolean; onClose: () => void; links: Record<string, string>; toInbox: boolean }) {
  const session = useSession();
  const qc = useQueryClient();
  const categories = useRefOptions('document-categories', open && !toInbox);
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ title: '', categoryId: '', sensitivity: '', tags: '', expiryDate: '' });
  const [file, setFile] = useState<File | null>(null);
  const allowed = SENSITIVITIES.filter((s) => s === 'NORMAL' || (s === 'FINANCIAL' && session.can('finance')) || (s === 'MEDICAL' && session.can('healthcare')) || (s === 'IDENTITY' && session.can('identity')));
  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('file', file as File);
      if (!toInbox) {
        for (const [k, v] of Object.entries(form)) if (v) fd.append(k, v);
        for (const [k, v] of Object.entries(links)) if (v) fd.append(k, v);
      }
      return api.upload(toInbox ? '/inbox/upload' : '/documents/upload', fd);
    },
    onSuccess: () => {
      qc.invalidateQueries();
      setFile(null);
      setForm({ title: '', categoryId: '', sensitivity: '', tags: '', expiryDate: '' });
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (file) upload.mutate();
  };
  return (
    <Modal open={open} onClose={onClose} title={toInbox ? 'Add to inbox' : 'Upload a document'} description={toInbox ? 'Upload a bill, invoice or receipt. HomeOS reads what it can and asks you to confirm before filing it.' : 'The original file is kept unchanged and encrypted.'}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="File" required help="PDF, image, text or office document, up to 25 MB.">
          <input ref={fileRef} className="field" type="file" accept={ACCEPT} required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        {!toInbox ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Title" help="Defaults to the file name.">
              <input className="field" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="Category" help="Left empty, a category is suggested from the content.">
              <select className="field" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">Suggest for me</option>
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Who can see it" help="Financial, medical and identity documents are limited to members with that access.">
              <select className="field" value={form.sensitivity} onChange={(e) => setForm({ ...form, sensitivity: e.target.value })}>
                <option value="">Use the category default</option>
                {allowed.map((s) => (
                  <option key={s} value={s}>
                    {s === 'NORMAL' ? 'Everyone with document access' : `${humanize(s)} — restricted`}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Expiry date" help="You will be reminded before it expires.">
              <input className="field" type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Tags">
                <input className="field" placeholder="Comma separated" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
              </Field>
            </div>
          </div>
        ) : null}
        {Object.keys(links).length && !toInbox ? <Notice>This document will be linked to the record you came from.</Notice> : null}
        <ErrorNote error={upload.error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={upload.isPending} disabled={!file} icon={<Upload className="h-4 w-4" />}>
            Upload
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ReviewDialog({ item, onClose }: { item: Row | null; onClose: () => void }) {
  const session = useSession();
  const qc = useQueryClient();
  const x = item?.extracted ?? {};
  const providers = useRefOptions('bill-providers', Boolean(item) && session.can('bills'));
  const [type, setType] = useState<'BILL' | 'EXPENSE' | 'DOCUMENT'>('DOCUMENT');
  const [f, setF] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!item) return;
    setType(item.suggestedType ?? 'DOCUMENT');
    setF({
      providerId: '',
      providerName: x.vendor ?? '',
      utilityType: x.utilityType ?? 'OTHER',
      amount: x.amount !== undefined ? String(x.amount) : '',
      dueDate: x.dueDate ?? '',
      billNumber: x.invoiceNumber ?? '',
      billDate: x.invoiceDate ?? '',
      date: x.invoiceDate ?? todayIso(),
      description: x.vendor ? `Purchase — ${x.vendor}` : (item.subject ?? ''),
      merchant: x.vendor ?? '',
      category: x.category ?? '',
      gstAmount: x.gstAmount !== undefined ? String(x.gstAmount) : '',
      invoiceNumber: x.invoiceNumber ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);
  const done = () => {
    qc.invalidateQueries();
    onClose();
  };
  const approve = useMutation({
    mutationFn: () => {
      const fields: Record<string, any> = {};
      const keys = type === 'BILL' ? ['providerId', 'providerName', 'utilityType', 'amount', 'dueDate', 'billNumber', 'billDate'] : type === 'EXPENSE' ? ['date', 'description', 'amount', 'merchant', 'category', 'gstAmount', 'invoiceNumber'] : [];
      for (const k of keys) if (f[k]) fields[k] = ['amount', 'gstAmount'].includes(k) ? Number(f[k]) : f[k];
      return api.post(`/inbox-items/${item!.id}/approve`, { type, fields });
    },
    onSuccess: done,
  });
  const reject = useMutation({ mutationFn: () => api.post(`/inbox-items/${item!.id}/reject`, {}), onSuccess: done });
  if (!item) return null;
  const set = (k: string) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));
  const low = (item.confidence ?? 0) < 0.75;
  const options = [
    ...(session.can('bills', 'write') ? [{ key: 'BILL' as const, label: 'A bill to pay' }] : []),
    ...(session.can('finance', 'write') ? [{ key: 'EXPENSE' as const, label: 'An expense already paid' }] : []),
    { key: 'DOCUMENT' as const, label: 'Just keep the document' },
  ];
  return (
    <Modal open onClose={onClose} title="Review and file" description={item.subject} wide>
      <div className="space-y-4">
        <Notice tone={low ? 'warn' : 'neutral'} title={low ? 'Please check these details carefully' : 'Details read from the file'}>
          {x.found?.length ? `Found: ${x.found.map((k: string) => humanize(k.replace(/([A-Z])/g, '_$1'))).join(', ')}.` : 'Nothing could be read from this file automatically.'} Values below are suggestions — correct anything that is wrong before filing.
          {item.documentId ? (
            <>
              {' '}
              <Link href={`/documents/${item.documentId}`} className="underline" target="_blank">
                Open the file
              </Link>
            </>
          ) : null}
        </Notice>
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <button key={o.key} type="button" onClick={() => setType(o.key)} className={`rounded-lg border px-3 py-1.5 text-sm ${type === o.key ? 'border-ink bg-ink text-bg' : 'border-line hover:bg-subtle'}`}>
              {o.label}
            </button>
          ))}
        </div>
        {type === 'BILL' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Utility account" help="Choose an existing account, or leave empty to create one from the provider name.">
              <select className="field" value={f.providerId ?? ''} onChange={set('providerId')}>
                <option value="">Create a new account</option>
                {(providers.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            {!f.providerId ? (
              <>
                <Field label="Provider name" required>
                  <input className="field" value={f.providerName ?? ''} onChange={set('providerName')} />
                </Field>
                <Field label="Utility">
                  <select className="field" value={f.utilityType ?? 'OTHER'} onChange={set('utilityType')}>
                    {UTILITY_TYPES.map((u) => (
                      <option key={u} value={u}>
                        {humanize(u)}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            ) : null}
            <Field label="Amount" required>
              <input className="field tabular" type="number" step="any" value={f.amount ?? ''} onChange={set('amount')} />
            </Field>
            <Field label="Due date" required>
              <input className="field" type="date" value={f.dueDate ?? ''} onChange={set('dueDate')} />
            </Field>
            <Field label="Bill number">
              <input className="field" value={f.billNumber ?? ''} onChange={set('billNumber')} />
            </Field>
            <Field label="Bill date">
              <input className="field" type="date" value={f.billDate ?? ''} onChange={set('billDate')} />
            </Field>
          </div>
        ) : null}
        {type === 'EXPENSE' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Description" required>
              <input className="field" value={f.description ?? ''} onChange={set('description')} />
            </Field>
            <Field label="Merchant">
              <input className="field" value={f.merchant ?? ''} onChange={set('merchant')} />
            </Field>
            <Field label="Amount" required>
              <input className="field tabular" type="number" step="any" value={f.amount ?? ''} onChange={set('amount')} />
            </Field>
            <Field label="Date" required>
              <input className="field" type="date" value={f.date ?? ''} onChange={set('date')} />
            </Field>
            <Field label="Category" help="Left empty, it is categorised automatically.">
              <select className="field" value={f.category ?? ''} onChange={set('category')}>
                <option value="">Automatic</option>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {humanize(c)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="GST amount">
              <input className="field tabular" type="number" step="any" value={f.gstAmount ?? ''} onChange={set('gstAmount')} />
            </Field>
          </div>
        ) : null}
        {type === 'DOCUMENT' ? <p className="text-sm text-muted">The file stays in the document vault and nothing else is created.</p> : null}
        <ErrorNote error={approve.error ?? reject.error} />
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="ghost" icon={<X className="h-4 w-4" />} loading={reject.isPending} onClick={() => reject.mutate()}>
            Dismiss
          </Button>
          <span className="flex gap-2">
            <Button onClick={onClose}>Later</Button>
            <Button variant="primary" icon={<Check className="h-4 w-4" />} loading={approve.isPending} onClick={() => approve.mutate()}>
              File it
            </Button>
          </span>
        </div>
      </div>
    </Modal>
  );
}

function SearchResults({ query }: { query: string }) {
  const session = useSession();
  const results = useQuery({ queryKey: ['doc-search', session.household?.id, query], queryFn: () => api.get('/document-search', { q: query }) });
  if (results.isLoading) return <Spinner label="Searching" />;
  if (results.error) return <ErrorNote error={results.error} />;
  const items: Row[] = results.data.items;
  if (items.length === 0) return <Card><EmptyState title="No documents match" description="Search looks at titles, tags, file names and the text inside documents." /></Card>;
  return (
    <Card padded={false}>
      <ul className="divide-y divide-line">
        {items.map((d) => (
          <li key={d.id}>
            <Link href={`/documents/${d.id}`} className="block px-5 py-3 hover:bg-subtle/60">
              <span className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{d.title}</span>
                {d._refs?.categoryId ? <Badge>{d._refs.categoryId.label}</Badge> : null}
                {d.sensitivity !== 'NORMAL' ? <Badge tone="warn">{label(d.sensitivity)}</Badge> : null}
              </span>
              {d._snippet ? <span className="mt-1 block text-xs text-muted">{String(d._snippet).replace(/[«»]/g, '')}</span> : null}
              <span className="mt-1 block text-xs text-muted">
                {d.fileName} · {fileSize(d.sizeBytes)} · added {date(d.createdAt)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function DocumentsPage() {
  const session = useSession();
  const params = useQueryParams();
  const [tab, setTab] = useTab('documents', ['documents', 'inbox', 'categories'] as const);
  const [uploading, setUploading] = useState(false);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [reviewing, setReviewing] = useState<Row | null>(null);
  const canWrite = session.can('documents', 'write');

  useEffect(() => {
    if (!params) return;
    const l: Record<string, string> = {};
    for (const k of ['propertyId', 'vehicleId', 'applianceId', 'memberId']) {
      const v = params.get(k);
      if (v) l[k] = v;
    }
    setLinks(l);
    if (params.get('upload') === '1') setUploading(true);
  }, [params]);

  return (
    <div>
      <PageHeader
        title="Documents"
        description="A searchable vault for deeds, agreements, policies, invoices, warranties, IDs and medical records. Files are encrypted and every access is logged."
        actions={
          canWrite ? (
            <Button variant="primary" icon={<Upload className="h-4 w-4" />} onClick={() => setUploading(true)}>
              {tab === 'inbox' ? 'Add to inbox' : 'Upload'}
            </Button>
          ) : null
        }
      />
      <Tabs
        tabs={[
          { key: 'documents', label: 'Vault' },
          { key: 'inbox', label: 'Inbox' },
          { key: 'categories', label: 'Categories' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'documents' ? (
        <>
          <form
            className="mb-4 flex gap-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              setTerm(q.trim());
            }}
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden />
              <input className="field pl-9" placeholder="Search inside documents — e.g. “registration deed”, “policy number”" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" />
            </div>
            <Button type="submit">Search</Button>
            {term ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setTerm('');
                  setQ('');
                }}
              >
                Clear
              </Button>
            ) : null}
          </form>
          {term ? (
            <SearchResults query={term} />
          ) : (
            <ResourceView
              resource="documents"
              href={(row) => `/documents/${row.id}`}
              columns={['title', 'categoryId', 'sensitivity', 'expiryDate', 'fileName']}
              hideSearch
              rowActions={(row) => (row.ocrStatus === 'NOT_SUPPORTED' ? <Badge>Not searchable inside</Badge> : row.ocrStatus === 'FAILED' ? <Badge tone="warn">Text not read</Badge> : null)}
              emptyHint="Upload your first document. Text inside PDFs and text files becomes searchable."
            />
          )}
        </>
      ) : null}
      {tab === 'inbox' ? (
        <>
          <div className="mb-4">
            <Notice>
              Drop bills, invoices and receipts here. HomeOS reads the vendor, amount, dates and invoice number where it can, and nothing is filed until you confirm it. Text in PDFs is read directly; photos and scans need an AI model to be connected.
            </Notice>
          </div>
          <ResourceView
            resource="inbox-items"
            columns={['subject', 'source', 'suggestedType', 'confidence', 'status']}
            hideSearch
            rowActions={(row) =>
              row.status === 'PENDING_REVIEW' && canWrite ? (
                <Button size="sm" variant="primary" onClick={() => setReviewing(row)}>
                  Review
                </Button>
              ) : row.extracted?.amount !== undefined ? (
                <span className="text-xs text-muted">{money(row.extracted.amount, session.currency)}</span>
              ) : (
                <Badge tone={statusTone(row.status)}>{label(row.status)}</Badge>
              )
            }
            emptyHint="Nothing waiting. Upload a bill or receipt to have its details read for you."
          />
        </>
      ) : null}
      {tab === 'categories' ? <ResourceView resource="document-categories" /> : null}
      <UploadDialog open={uploading} onClose={() => setUploading(false)} links={links} toInbox={tab === 'inbox'} />
      <ReviewDialog item={reviewing} onClose={() => setReviewing(null)} />
    </div>
  );
}

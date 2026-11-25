'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check } from 'lucide-react';
import { PAYMENT_METHODS, humanize } from '@homeos/shared';
import { api } from '@/lib/api';
import { cx, date, daysUntil, money, relativeDay, todayIso } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useRefOptions } from './resource';
import { Badge, Button, ErrorNote, Field, Modal, Notice } from './ui';

export interface DatedEvent {
  key: string;
  title: string;
  label: string;
  date: string;
  amount?: number;
  href: string;
  eventType: string;
}

/** Compact list of dated obligations, with overdue items highlighted. */
export function EventList({ events, empty = 'Nothing coming up.', limit }: { events: DatedEvent[] | undefined; empty?: string; limit?: number }) {
  const session = useSession();
  const list = (events ?? []).slice(0, limit ?? 100);
  if (list.length === 0) return <p className="py-4 text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {list.map((e) => {
        const d = daysUntil(e.date) ?? 0;
        return (
          <li key={e.key}>
            <Link href={e.href} className="flex items-center gap-3 py-2.5 text-sm hover:opacity-80">
              <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-lg text-center text-[10px] font-semibold leading-tight', d < 0 ? 'bg-danger/10 text-danger' : d <= 3 ? 'bg-warn/10 text-warn' : 'bg-subtle text-muted')}>
                {new Date(`${e.date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'UTC' })}
                <br />
                {new Date(`${e.date}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{e.title}</span>
                <span className={cx('block text-xs', d < 0 ? 'text-danger' : 'text-muted')}>
                  {d < 0 ? `Overdue — ${relativeDay(e.date)}` : relativeDay(e.date)}
                </span>
              </span>
              {e.amount !== undefined ? <span className="tabular shrink-0 font-medium">{money(e.amount, session.currency)}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Record a payment made outside HomeOS against a bill, salary or work order.
 * The wording makes clear this is the user's own record, not a verified transaction.
 */
export function RecordPaymentButton({ target, amount, label = 'Record payment', size = 'sm' }: { target: { billId?: string; salaryId?: string; workOrderId?: string }; amount?: number; label?: string; size?: 'sm' | 'md' }) {
  const session = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: amount !== undefined ? String(amount) : '', method: 'UPI', paidDate: todayIso(), reference: '', bankAccountId: '' });
  const accounts = useRefOptions('bank-accounts', open && session.can('finance'));
  const save = useMutation({
    mutationFn: () =>
      api.post('/payments/record-offline', {
        ...target,
        ...(form.amount ? { amount: Number(form.amount) } : {}),
        method: form.method,
        paidDate: form.paidDate,
        ...(form.reference ? { reference: form.reference } : {}),
        ...(form.bankAccountId ? { bankAccountId: form.bankAccountId } : {}),
      }),
    onSuccess: () => {
      setOpen(false);
      qc.invalidateQueries();
    },
  });
  if (!session.can('payments', 'write')) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <>
      <Button size={size} icon={<Check className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Record a payment" description="Use this for a payment you have already made by cash, UPI, card or bank transfer.">
        <form onSubmit={submit} className="space-y-4">
          <Notice>HomeOS records what you enter here. It does not move money and does not verify the payment with your bank.</Notice>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Amount paid" help="Leave as is to pay the full outstanding amount.">
              <input className="field tabular" type="number" step="any" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="Paid on">
              <input className="field" type="date" max={todayIso()} value={form.paidDate} onChange={(e) => setForm({ ...form, paidDate: e.target.value })} />
            </Field>
            <Field label="Method">
              <select className="field" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {humanize(m)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reference" help="UPI or bank reference, if you have one.">
              <input className="field" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </Field>
            {accounts.data?.length ? (
              <Field label="Paid from">
                <select className="field" value={form.bankAccountId} onChange={(e) => setForm({ ...form, bankAccountId: e.target.value })}>
                  <option value="">Not specified</option>
                  {accounts.data.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </div>
          <ErrorNote error={save.error} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={save.isPending}>
              Record payment
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {children}
    </Link>
  );
}

/** Documents linked to a record (by a ref field such as vehicleId), with an upload shortcut. */
export function LinkedDocuments({ filter }: { filter: Record<string, string> }) {
  const session = useSession();
  const docs = useQuery({
    queryKey: ['linked-docs', session.household?.id, filter],
    enabled: session.can('documents'),
    queryFn: () => api.resource('documents').list({ ...filter, pageSize: 50 }),
  });
  if (!session.can('documents')) return <p className="text-sm text-muted">Your role does not include access to documents.</p>;
  const params = new URLSearchParams(filter).toString();
  return (
    <div>
      {docs.isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (docs.data?.items ?? []).length === 0 ? (
        <p className="text-sm text-muted">No documents linked yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {docs.data!.items.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <Link href={`/documents/${d.id}`} className="min-w-0 truncate font-medium hover:underline">
                {d.title}
              </Link>
              <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                {d.expiryDate ? <Badge tone={(daysUntil(d.expiryDate) ?? 1) < 0 ? 'danger' : 'neutral'}>Expires {date(d.expiryDate)}</Badge> : null}
                {d._refs?.categoryId?.label}
              </span>
            </li>
          ))}
        </ul>
      )}
      {session.can('documents', 'write') ? (
        <Link href={`/documents?upload=1&${params}`} className="mt-3 inline-block text-sm font-medium underline underline-offset-2">
          Upload a document
        </Link>
      ) : null}
    </div>
  );
}

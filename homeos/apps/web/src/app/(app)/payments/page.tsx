'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus } from 'lucide-react';
import { PAYMENT_METHODS, humanize } from '@homeos/shared';
import { api } from '@/lib/api';
import { date, money, todayIso } from '@/lib/format';
import { useTab } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { ResourceView, type Row } from '@/components/resource';
import { Badge, Button, Card, DefinitionList, ErrorNote, Field, Modal, Notice, PageHeader, Spinner, Tabs } from '@/components/ui';

function ReceiptDialog({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const session = useSession();
  const receipt = useQuery({ queryKey: ['receipt', row?.id], enabled: Boolean(row), queryFn: () => api.get(`/payments/orders/${row!.id}/receipt`) });
  if (!row) return null;
  const r = receipt.data;
  function download() {
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${r.receiptNumber}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Payment record"
      footer={
        r ? (
          <>
            <Button onClick={() => window.print()}>Print</Button>
            <Button onClick={download}>Download</Button>
          </>
        ) : undefined
      }
    >
      {receipt.isLoading ? <Spinner /> : receipt.error ? <ErrorNote error={receipt.error} /> : (
        <div className="space-y-4">
          <Notice tone={r.verification === 'PROVIDER_VERIFIED' ? 'ok' : 'warn'} title={r.verification === 'PROVIDER_VERIFIED' ? 'Confirmed by the payment provider' : r.verification === 'SIMULATED' ? 'Simulated payment' : 'Self-reported payment'}>
            {r.verificationNote}
          </Notice>
          <DefinitionList
            items={[
              { label: 'Reference number', value: r.receiptNumber },
              { label: 'Amount', value: money(r.amount, r.currency) },
              { label: 'Paid on', value: date(r.paidDate) },
              { label: 'Paid to', value: r.payee ?? '—' },
              { label: 'For', value: r.description },
              { label: 'Method', value: r.method ? humanize(r.method) : '—' },
              { label: 'Payment reference', value: r.reference ?? '—' },
              { label: 'Household', value: r.household ?? session.household?.name },
            ]}
          />
          {r.refunds.length ? <p className="text-sm text-muted">Refunds recorded: {r.refunds.map((x: any) => money(x.amount, r.currency)).join(', ')}</p> : null}
        </div>
      )}
    </Modal>
  );
}

function OfflinePaymentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ description: '', payeeName: '', amount: '', method: 'UPI', paidDate: todayIso(), reference: '' });
  const save = useMutation({
    mutationFn: () => api.post('/payments/record-offline', { ...form, amount: Number(form.amount), ...(form.reference ? {} : { reference: undefined }), ...(form.payeeName ? {} : { payeeName: undefined }) }),
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <Modal open={open} onClose={onClose} title="Record a payment" description="For a payment that is not tied to a bill, salary or work order. To pay one of those, use “Mark paid” on that record.">
      <form onSubmit={submit} className="space-y-4">
        <Notice>This is your own record of a payment made outside HomeOS. It is also added to your expenses.</Notice>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="What was it for" required>
            <input className="field" required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Paid to">
            <input className="field" value={form.payeeName} onChange={(e) => setForm({ ...form, payeeName: e.target.value })} />
          </Field>
          <Field label="Amount" required>
            <input className="field tabular" type="number" step="any" min="0" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
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
          <Field label="Reference">
            <input className="field" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </Field>
        </div>
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            Record payment
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SandboxControls({ row }: { row: Row }) {
  const qc = useQueryClient();
  const resolve = useMutation({ mutationFn: (outcome: string) => api.post(`/payments/orders/${row.id}/sandbox-resolve`, { outcome }), onSuccess: () => qc.invalidateQueries() });
  return (
    <>
      <Button size="sm" loading={resolve.isPending} onClick={() => resolve.mutate('succeeded')}>
        Simulate success
      </Button>
      <Button size="sm" variant="ghost" onClick={() => resolve.mutate('failed')}>
        Simulate failure
      </Button>
    </>
  );
}

export default function PaymentsPage() {
  const session = useSession();
  const qc = useQueryClient();
  const [tab, setTab] = useTab('payments', ['payments', 'events', 'providers'] as const);
  const [receipt, setReceipt] = useState<Row | null>(null);
  const [recording, setRecording] = useState(false);
  const providers = useQuery({ queryKey: ['payment-providers', session.household?.id], queryFn: () => api.get('/payments/providers') });
  const cancel = useMutation({ mutationFn: (id: string) => api.post(`/payments/orders/${id}/cancel`, {}), onSuccess: () => qc.invalidateQueries() });
  const online = (providers.data ?? []).some((p: any) => p.key !== 'manual' && p.enabled);

  return (
    <div>
      <PageHeader
        title="Payments"
        description="A single history of every payment, matched to the bill, salary or work order it paid."
        actions={
          session.can('payments', 'write') ? (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setRecording(true)}>
              Record payment
            </Button>
          ) : null
        }
      />
      {providers.data && !online ? (
        <div className="mb-5">
          <Notice title="Paying from inside HomeOS is not connected">
            HomeOS currently records payments you make yourself; it does not move money. In-app payment needs a licensed payment provider to be connected by whoever operates this installation.
          </Notice>
        </div>
      ) : null}
      <Tabs
        tabs={[
          { key: 'payments', label: 'Payments' },
          { key: 'events', label: 'Provider events' },
          { key: 'providers', label: 'Providers' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'payments' ? (
        <ResourceView
          resource="payment-orders"
          columns={['paidDate', 'description', 'payeeName', 'provider', 'amount', 'status']}
          rowActions={(row) => (
            <>
              {row.status === 'RECORDED_OFFLINE' ? <Badge>Self-reported</Badge> : null}
              {row.provider === 'sandbox' ? <Badge tone="warn">Simulated</Badge> : null}
              {row.provider === 'sandbox' && row.status === 'AWAITING_CONFIRMATION' ? <SandboxControls row={row} /> : null}
              {['CREATED', 'AWAITING_CONFIRMATION'].includes(row.status) && session.can('payments', 'write') ? (
                <Button size="sm" variant="ghost" onClick={() => cancel.mutate(row.id)}>
                  Cancel
                </Button>
              ) : null}
              {['SUCCEEDED', 'RECORDED_OFFLINE'].includes(row.status) ? (
                <Button size="sm" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => setReceipt(row)}>
                  Record
                </Button>
              ) : null}
            </>
          )}
          emptyHint="Payments appear here when you mark a bill, salary or work order as paid."
        />
      ) : null}
      {tab === 'events' ? <ResourceView resource="payment-transactions" emptyHint="Confirmations and refunds received for each payment." hideSearch /> : null}
      {tab === 'providers' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {(providers.data ?? []).map((p: any) => (
            <Card key={p.key}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">{p.displayName}</p>
                <Badge tone={p.enabled ? 'ok' : 'neutral'}>{p.enabled ? 'Available' : 'Not connected'}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted">{p.note}</p>
            </Card>
          ))}
        </div>
      ) : null}
      <ReceiptDialog row={receipt} onClose={() => setReceipt(null)} />
      <OfflinePaymentDialog open={recording} onClose={() => setRecording(false)} />
    </div>
  );
}

'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { date } from '@/lib/format';
import { useSession } from '@/lib/session';
import { SettingsNav } from '@/components/settings-nav';
import { Badge, Button, Card, CardHeader, ErrorNote, Field, Modal, Notice, PageHeader } from '@/components/ui';

function saveJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function SettingsPage() {
  const session = useSession();
  const qc = useQueryClient();
  const canEdit = session.can('settings', 'write');
  const isOwner = session.household?.roleKey === 'OWNER';
  const household = useQuery({ queryKey: ['household', session.household?.id], queryFn: () => api.get('/household') });
  const consents = useQuery({ queryKey: ['consents'], queryFn: () => api.get<any[]>('/privacy/consents') });
  const requests = useQuery({ queryKey: ['privacy-requests'], queryFn: () => api.get<any[]>('/privacy/requests') });
  const [form, setForm] = useState({ name: '', currency: 'INR', timezone: '', approvalThreshold: '' });
  const [deleting, setDeleting] = useState<'ACCOUNT' | 'HOUSEHOLD' | null>(null);
  const [password, setPassword] = useState('');

  useEffect(() => {
    const h = household.data;
    if (h) setForm({ name: h.name, currency: h.currency, timezone: h.timezone, approvalThreshold: h.approvalThreshold === null ? '' : String(h.approvalThreshold) });
  }, [household.data]);

  const save = useMutation({
    mutationFn: () => api.patch('/household', { name: form.name, currency: form.currency, timezone: form.timezone, approvalThreshold: form.approvalThreshold === '' ? null : Number(form.approvalThreshold) }),
    onSuccess: async () => {
      await session.reload();
      qc.invalidateQueries();
    },
  });
  const setConsent = useMutation({ mutationFn: (v: { purpose: string; granted: boolean }) => api.put(`/privacy/consents/${v.purpose}`, { granted: v.granted }), onSuccess: () => qc.invalidateQueries({ queryKey: ['consents'] }) });
  const exportHousehold = useMutation({ mutationFn: () => api.get('/privacy/export/household'), onSuccess: (d) => saveJson(`homeos-household-${new Date().toISOString().slice(0, 10)}.json`, d) });
  const exportAccount = useMutation({ mutationFn: () => api.get('/privacy/export/account'), onSuccess: (d) => saveJson('homeos-my-account.json', d) });
  const requestDeletion = useMutation({
    mutationFn: () => api.post(`/privacy/deletion-requests/${deleting === 'HOUSEHOLD' ? 'household' : 'account'}`, { password }),
    onSuccess: () => {
      setDeleting(null);
      setPassword('');
      qc.invalidateQueries({ queryKey: ['privacy-requests'] });
    },
  });
  const cancel = useMutation({ mutationFn: (id: string) => api.del(`/privacy/requests/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['privacy-requests'] }) });
  const pending = (requests.data ?? []).filter((r) => r.type === 'DELETION' && r.status === 'REQUESTED');

  return (
    <div>
      <PageHeader title="Settings" description="Household preferences, your privacy choices and your data." />
      <SettingsNav />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Household" description={canEdit ? 'Applies to everyone in this household.' : 'Only members with settings access can change these.'} />
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              save.mutate();
            }}
            className="space-y-4"
          >
            <Field label="Household name">
              <input className="field" disabled={!canEdit} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Currency" help="Three-letter code, e.g. INR.">
                <input className="field uppercase" disabled={!canEdit} maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="Time zone">
                <input className="field" disabled={!canEdit} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
              </Field>
            </div>
            <Field label="Expense approval limit" help="Expenses at or above this amount, entered by members who cannot approve, wait for an approver. Leave empty to turn approvals off.">
              <input className="field tabular" type="number" min={0} step="any" disabled={!canEdit} value={form.approvalThreshold} onChange={(e) => setForm({ ...form, approvalThreshold: e.target.value })} />
            </Field>
            <ErrorNote error={save.error} />
            {save.isSuccess ? <Notice tone="ok">Saved.</Notice> : null}
            {canEdit ? (
              <Button type="submit" variant="primary" loading={save.isPending}>
                Save changes
              </Button>
            ) : null}
          </form>
        </Card>

        <Card>
          <CardHeader title="Privacy choices" description="What you have agreed to. You can change optional choices at any time." />
          <ul className="divide-y divide-line">
            {(consents.data ?? []).map((c) => (
              <li key={c.purpose} className="flex items-start justify-between gap-3 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block">{c.label}</span>
                  <span className="block text-xs text-muted">{c.required ? 'Required to use HomeOS' : c.granted ? `Agreed ${date(c.grantedAt)}` : 'Not agreed'}</span>
                </span>
                {c.required ? (
                  <Badge tone="ok">Agreed</Badge>
                ) : (
                  <input type="checkbox" className="mt-1 h-4 w-4" checked={c.granted} onChange={(e) => setConsent.mutate({ purpose: c.purpose, granted: e.target.checked })} aria-label={c.label} />
                )}
              </li>
            ))}
          </ul>
          <ErrorNote error={setConsent.error} />
        </Card>

        <Card>
          <CardHeader title="Download your data" description="Machine-readable JSON. Files are downloaded separately from the document vault." />
          <div className="flex flex-wrap gap-2">
            <Button icon={<Download className="h-4 w-4" />} loading={exportAccount.isPending} onClick={() => exportAccount.mutate()}>
              My account data
            </Button>
            {isOwner ? (
              <Button icon={<Download className="h-4 w-4" />} loading={exportHousehold.isPending} onClick={() => exportHousehold.mutate()}>
                All household records
              </Button>
            ) : null}
          </div>
          <ErrorNote error={exportHousehold.error ?? exportAccount.error} />
          {!isOwner ? <p className="mt-3 text-xs text-muted">Only an owner can export the whole household.</p> : null}
        </Card>

        <Card>
          <CardHeader title="Delete data" description="Deletion is scheduled 30 days ahead so it can be cancelled. After that it cannot be undone." />
          {pending.length ? (
            <ul className="mb-3 space-y-2">
              {pending.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm">
                  <span>
                    {r.scope === 'HOUSEHOLD' ? 'Household' : 'Account'} deletion scheduled for {date(r.scheduledFor)}
                  </span>
                  <Button size="sm" loading={cancel.isPending} onClick={() => cancel.mutate(r.id)}>
                    Cancel
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setDeleting('ACCOUNT')}>
              Delete my account
            </Button>
            {isOwner ? (
              <Button variant="ghost" onClick={() => setDeleting('HOUSEHOLD')}>
                Delete this household
              </Button>
            ) : null}
          </div>
        </Card>
      </div>

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={deleting === 'HOUSEHOLD' ? `Delete ${session.household?.name}?` : 'Delete your account?'}
        description={deleting === 'HOUSEHOLD' ? 'Every record and document of this household will be erased for all members.' : 'Your sign-in and personal details will be erased. Households you solely own with no other members are erased too.'}
      >
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            requestDeletion.mutate();
          }}
          className="space-y-4"
        >
          <Notice tone="warn">The request is scheduled 30 days from today and can be cancelled here until then.</Notice>
          <Field label="Confirm with your password" required>
            <input className="field" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorNote error={requestDeletion.error} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDeleting(null)}>Keep my data</Button>
            <Button type="submit" variant="danger" loading={requestDeletion.isPending}>
              Schedule deletion
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

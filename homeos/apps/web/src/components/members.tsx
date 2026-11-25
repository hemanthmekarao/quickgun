'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { date } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useRefOptions } from './resource';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, Notice, Spinner, statusTone } from './ui';

interface MemberFormState {
  name: string;
  email: string;
  phone: string;
  relationship: string;
  dateOfBirth: string;
  bloodGroup: string;
  roleKey: string;
  invite: boolean;
  propertyScope: string[];
}

const EMPTY: MemberFormState = { name: '', email: '', phone: '', relationship: '', dateOfBirth: '', bloodGroup: '', roleKey: 'FAMILY_MEMBER', invite: false, propertyScope: [] };

function MemberDialog({ member, onClose }: { member: any | null | 'new'; onClose: () => void }) {
  const session = useSession();
  const qc = useQueryClient();
  const isNew = member === 'new';
  const roles = useQuery({ queryKey: ['roles', session.household?.id], queryFn: () => api.get<any[]>('/roles') });
  const properties = useRefOptions('properties', session.can('properties'));
  const [form, setForm] = useState<MemberFormState>(() =>
    isNew || !member
      ? EMPTY
      : { name: member.name ?? '', email: member.email ?? '', phone: member.phone ?? '', relationship: member.relationship ?? '', dateOfBirth: member.dateOfBirth ?? '', bloodGroup: member.bloodGroup ?? '', roleKey: member.roleKey ?? 'FAMILY_MEMBER', invite: false, propertyScope: member.propertyScope ?? [] },
  );
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [invite, setInvite] = useState<{ url: string } | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body: any = { name: form.name, phone: form.phone || null, relationship: form.relationship || null, dateOfBirth: form.dateOfBirth || null, bloodGroup: form.bloodGroup || null, roleKey: form.roleKey, propertyScope: form.propertyScope };
      if (isNew) return api.post('/members', { ...body, email: form.email || undefined, invite: form.invite });
      return api.patch(`/members/${member.id}`, body);
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries();
      if (res?.inviteUrl) setInvite({ url: res.inviteUrl });
      else onClose();
    },
    onError: (err: any) => {
      const map: Record<string, string> = {};
      for (const i of err?.issues ?? []) map[i.field] = i.message;
      setIssues(map);
    },
  });
  const set = (k: keyof MemberFormState) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setIssues({});
    save.mutate();
  };

  if (invite) {
    return (
      <Modal open onClose={onClose} title="Invitation created">
        <div className="space-y-3">
          <Notice tone="ok" title="Send this link to the person you invited">
            It works once, for seven days, and only for the e-mail address you entered. It is shown only now.
          </Notice>
          <div className="flex gap-2">
            <input className="field" readOnly value={invite.url} onFocus={(e) => e.target.select()} aria-label="Invitation link" />
            <Button icon={<Copy className="h-4 w-4" />} onClick={() => navigator.clipboard?.writeText(invite.url)}>
              Copy
            </Button>
          </div>
          <p className="text-xs text-muted">HomeOS does not e-mail invitations unless outgoing mail is configured, so share the link yourself.</p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={isNew ? 'Add a person' : `Edit ${member.name}`} wide>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name" required error={issues.name}>
            <input className="field" value={form.name} onChange={set('name')} />
          </Field>
          <Field label="Relationship">
            <input className="field" placeholder="e.g. Spouse, Daughter, Accountant" value={form.relationship} onChange={set('relationship')} />
          </Field>
          <Field label="Role" help="Decides what this person can see and change." error={issues.role}>
            <select className="field" value={form.roleKey} onChange={set('roleKey')}>
              {(roles.data ?? []).map((r) => (
                <option key={r.id} value={r.key}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Phone">
            <input className="field" value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="Date of birth" error={issues.dateOfBirth}>
            <input className="field" type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} />
          </Field>
          <Field label="Blood group">
            <input className="field" value={form.bloodGroup} onChange={set('bloodGroup')} />
          </Field>
          {isNew ? (
            <Field label="E-mail" error={issues.email} help="Needed only if they will sign in.">
              <input className="field" type="email" value={form.email} onChange={set('email')} />
            </Field>
          ) : null}
        </div>
        {(properties.data ?? []).length > 1 ? (
          <Field label="Limit access to these properties" help="Leave all unticked for access to every property. When ticked, the person only sees records linked to those properties." error={issues.propertyScope}>
            <span className="flex flex-wrap gap-x-4 gap-y-2 py-1">
              {properties.data!.map((p) => (
                <label key={p.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={form.propertyScope.includes(p.id)}
                    onChange={(e) => setForm((f) => ({ ...f, propertyScope: e.target.checked ? [...f.propertyScope, p.id] : f.propertyScope.filter((x) => x !== p.id) }))}
                  />
                  {p.label}
                </label>
              ))}
            </span>
          </Field>
        ) : null}
        {isNew ? (
          <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.invite} onChange={(e) => setForm((f) => ({ ...f, invite: e.target.checked }))} />
            <span>
              <span className="font-medium">Invite them to sign in</span>
              <span className="block text-muted">Leave unticked to add a profile only — for example a child or a parent whose records you keep.</span>
            </span>
          </label>
        ) : null}
        {save.error && !Object.keys(issues).length ? <ErrorNote error={save.error} /> : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {isNew ? (form.invite ? 'Create invitation' : 'Add person') : 'Save changes'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Household members and family profiles, with invite / edit / remove for those allowed. */
export function MembersPanel() {
  const session = useSession();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const [removing, setRemoving] = useState<any | null>(null);
  const members = useQuery({ queryKey: ['members', session.household?.id], queryFn: () => api.get<any[]>('/members') });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/members/${id}`),
    onSuccess: () => {
      setRemoving(null);
      qc.invalidateQueries();
    },
  });
  const canWrite = session.can('household', 'write');
  const canDelete = session.can('household', 'delete');

  return (
    <Card padded={false}>
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold">People</h2>
          <p className="mt-0.5 text-xs text-muted">Family members, and others you give access to such as an accountant or property manager.</p>
        </div>
        {canWrite ? (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            Add person
          </Button>
        ) : null}
      </div>
      {members.isLoading ? (
        <Spinner />
      ) : members.error ? (
        <div className="p-4">
          <ErrorNote error={members.error} />
        </div>
      ) : (members.data ?? []).length === 0 ? (
        <EmptyState title="No members" />
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {members.data!.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-subtle text-xs font-semibold text-muted">
                {String(m.name ?? '?')
                  .split(' ')
                  .map((x: string) => x[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {m.name}
                  {m.id === session.household?.memberId ? <span className="ml-2 text-xs font-normal text-muted">you</span> : null}
                </span>
                <span className="block truncate text-xs text-muted">{[m.relationship, m.email, m.dateOfBirth ? `b. ${date(m.dateOfBirth)}` : '', m.propertyScope?.length ? `limited to ${m.propertyScope.length} propert${m.propertyScope.length === 1 ? 'y' : 'ies'}` : ''].filter(Boolean).join(' · ')}</span>
              </span>
              <Badge>{m.roleName}</Badge>
              <Badge tone={statusTone(m.status)}>{m.status === 'PROFILE_ONLY' ? 'Profile only' : m.status === 'INVITED' ? 'Invited' : m.hasAccount ? 'Can sign in' : m.status}</Badge>
              {canWrite && m.email !== undefined ? (
                <button type="button" className="rounded-md p-1.5 text-muted hover:bg-subtle hover:text-ink" onClick={() => setEditing(m)} aria-label={`Edit ${m.name}`}>
                  <Pencil className="h-4 w-4" />
                </button>
              ) : null}
              {canDelete && m.id !== session.household?.memberId ? (
                <button type="button" className="rounded-md p-1.5 text-muted hover:bg-danger/10 hover:text-danger" onClick={() => setRemoving(m)} aria-label={`Remove ${m.name}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editing ? <MemberDialog member={editing} onClose={() => setEditing(null)} /> : null}
      <Modal
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.name ?? ''}?`}
        description="They lose access to this household immediately. Records linked to them are kept."
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>Cancel</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => removing && remove.mutate(removing.id)}>
              Remove
            </Button>
          </>
        }
      >
        {remove.error ? <ErrorNote error={remove.error} /> : <p className="text-sm text-muted">You can invite them again later.</p>}
      </Modal>
    </Card>
  );
}

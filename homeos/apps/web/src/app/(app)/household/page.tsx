'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { date } from '@/lib/format';
import { useSession } from '@/lib/session';
import { MembersPanel } from '@/components/members';
import { Badge, Button, Card, CardHeader, DefinitionList, ErrorNote, Field, LinkButton, Modal, PageHeader } from '@/components/ui';

export default function HouseholdPage() {
  const session = useSession();
  const household = useQuery({ queryKey: ['household', session.household?.id], queryFn: () => api.get('/household') });
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const create = useMutation({
    mutationFn: () => api.post('/households', { name }),
    onSuccess: async (h: any) => {
      await session.reload();
      session.switchHousehold(h.id);
      setCreating(false);
      setName('');
    },
  });
  const join = useMutation({
    mutationFn: () => api.post('/auth/accept-invite', { token: token.trim().replace(/^.*invite=/, '') }),
    onSuccess: async () => {
      await session.reload();
      setJoining(false);
      setToken('');
    },
  });
  const h = household.data;

  return (
    <div>
      <PageHeader
        title="Household"
        description="Who is part of this household and what each person can access."
        actions={
          <>
            <Button onClick={() => setJoining(true)}>Join with an invitation</Button>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              New household
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={h?.name ?? session.household?.name} description="Current household" action={session.can('settings', 'write') ? <LinkButton href="/settings" size="sm">Settings</LinkButton> : null} />
          {h ? (
            <DefinitionList
              items={[
                { label: 'Currency', value: h.currency },
                { label: 'Country', value: h.country },
                { label: 'Time zone', value: h.timezone },
                { label: 'Created', value: date(h.createdAt) },
                { label: 'Your role', value: session.household?.roleName },
                { label: 'Expense approval limit', value: h.approvalThreshold === null ? 'Not set' : h.approvalThreshold.toLocaleString('en-IN') },
              ]}
            />
          ) : null}
        </Card>
        <Card>
          <CardHeader title="Your households" description="Each household keeps its data completely separate." />
          <ul className="space-y-2">
            {session.households.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{x.name}</span>
                {x.id === session.household?.id ? (
                  <Badge tone="ok">Current</Badge>
                ) : (
                  <Button size="sm" onClick={() => session.switchHousehold(x.id)}>
                    Switch
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="mt-6">
        <MembersPanel />
      </div>
      {session.can('settings', 'write') ? (
        <p className="mt-4 text-sm text-muted">
          To change what each role can do, go to <a className="underline" href="/settings/users">Settings → Users & roles</a>.
        </p>
      ) : null}

      <Modal open={creating} onClose={() => setCreating(false)} title="Create another household" description="For example a second family home or a household you manage for a relative. You will be its owner.">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-4"
        >
          <Field label="Household name" required>
            <input className="field" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <ErrorNote error={create.error} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={create.isPending}>
              Create household
            </Button>
          </div>
        </form>
      </Modal>
      <Modal open={joining} onClose={() => setJoining(false)} title="Join a household" description="Paste the invitation link or code you were given. It must have been sent to the e-mail address you sign in with.">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            join.mutate();
          }}
          className="space-y-4"
        >
          <Field label="Invitation link or code" required>
            <input className="field" required value={token} onChange={(e) => setToken(e.target.value)} />
          </Field>
          <ErrorNote error={join.error} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setJoining(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={join.isPending}>
              Join
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

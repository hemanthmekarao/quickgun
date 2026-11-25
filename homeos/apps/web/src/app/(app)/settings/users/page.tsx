'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACTIONS, MODULE_KEYS, MODULE_LABELS, type Action, type ModuleKey, type PermissionMap } from '@homeos/shared';
import { api } from '@/lib/api';
import { cx } from '@/lib/format';
import { useSession } from '@/lib/session';
import { MembersPanel } from '@/components/members';
import { SettingsNav } from '@/components/settings-nav';
import { Badge, Button, Card, CardHeader, ErrorNote, Notice, PageHeader, Spinner } from '@/components/ui';

const ACTION_LABEL: Record<Action, string> = { read: 'View', write: 'Add & edit', delete: 'Delete', approve: 'Approve' };

export default function UsersPage() {
  const session = useSession();
  const qc = useQueryClient();
  const isOwner = session.household?.roleKey === 'OWNER';
  const roles = useQuery({ queryKey: ['roles', session.household?.id], queryFn: () => api.get<any[]>('/roles') });
  const [roleId, setRoleId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PermissionMap | null>(null);
  const role = (roles.data ?? []).find((r) => r.id === roleId) ?? (roles.data ?? []).find((r) => r.key === 'FAMILY_MEMBER') ?? roles.data?.[0];
  const perms: PermissionMap = draft ?? role?.permissions ?? {};
  const editable = isOwner && role && role.key !== 'OWNER';

  const save = useMutation({
    mutationFn: () => api.put(`/roles/${role.id}/permissions`, { permissions: draft }),
    onSuccess: async () => {
      setDraft(null);
      await session.reload();
      qc.invalidateQueries();
    },
  });

  function toggle(module: ModuleKey, action: Action) {
    const current = perms[module] ?? { read: false, write: false, delete: false, approve: false };
    const next = { ...current, [action]: !current[action] };
    // Nothing else makes sense without view access.
    if (action === 'read' && !next.read) Object.assign(next, { write: false, delete: false, approve: false });
    if (action !== 'read' && next[action]) next.read = true;
    setDraft({ ...perms, [module]: next });
  }

  return (
    <div>
      <PageHeader title="Users & roles" description="Add people to the household and decide what each role can see and do." />
      <SettingsNav />
      <MembersPanel />

      <Card className="mt-6" padded={false}>
        <div className="px-5 pt-5">
          <CardHeader
            title="What each role can do"
            description={isOwner ? 'Changes apply immediately to everyone with that role.' : 'Only an owner can change role permissions.'}
            action={
              draft ? (
                <span className="flex gap-2">
                  <Button size="sm" onClick={() => setDraft(null)}>
                    Discard
                  </Button>
                  <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
                    Save
                  </Button>
                </span>
              ) : undefined
            }
          />
          <div className="mb-4 flex flex-wrap gap-2">
            {(roles.data ?? []).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  setRoleId(r.id);
                  setDraft(null);
                }}
                className={cx('rounded-lg border px-3 py-1.5 text-sm', role?.id === r.id ? 'border-ink bg-ink text-bg' : 'border-line hover:bg-subtle')}
              >
                {r.name}
              </button>
            ))}
          </div>
          <ErrorNote error={save.error} />
          {role?.key === 'OWNER' ? (
            <div className="mb-4">
              <Notice>Owners always have full access, so that a household can never be locked out of its own data.</Notice>
            </div>
          ) : null}
        </div>
        {roles.isLoading ? (
          <Spinner />
        ) : (
          <div className="relative overflow-x-auto border-t border-line">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th className="px-5 py-2.5 text-left font-medium">Area</th>
                  {ACTIONS.map((a) => (
                    <th key={a} className="px-3 py-2.5 text-center font-medium">
                      {ACTION_LABEL[a]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {MODULE_KEYS.map((m) => (
                  <tr key={m}>
                    <td className="px-5 py-2">
                      {MODULE_LABELS[m]}
                      {m === 'healthcare' || m === 'identity' ? <span className="ml-2"><Badge tone="warn">Sensitive</Badge></span> : null}
                    </td>
                    {ACTIONS.map((a) => (
                      <td key={a} className="px-3 py-2 text-center">
                        <input type="checkbox" className="h-4 w-4" checked={Boolean(perms[m]?.[a])} disabled={!editable} onChange={() => toggle(m, a)} aria-label={`${MODULE_LABELS[m]}: ${ACTION_LABEL[a]}`} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { ResourceView } from '@/components/resource';
import { SettingsNav } from '@/components/settings-nav';
import { Badge, Button, Card, CardHeader, ErrorNote, Field, Notice, PageHeader } from '@/components/ui';

export default function SecurityPage() {
  const session = useSession();
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<any[]>('/auth/sessions') });
  const [profile, setProfile] = useState({ name: session.user?.name ?? '', phone: session.user?.phone ?? '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [pwIssues, setPwIssues] = useState<Record<string, string>>({});
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [disable, setDisable] = useState({ password: '', code: '' });

  const saveProfile = useMutation({ mutationFn: () => api.patch('/auth/me', { name: profile.name, phone: profile.phone || null }), onSuccess: () => session.reload() });
  const changePassword = useMutation({
    mutationFn: () => api.post('/auth/change-password', pw),
    onSuccess: () => {
      setPw({ currentPassword: '', newPassword: '' });
      setPwIssues({});
      qc.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err: any) => {
      const map: Record<string, string> = {};
      for (const i of err?.issues ?? []) map[i.field] = i.message;
      setPwIssues(map);
    },
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.del(`/auth/sessions/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }) });
  const startMfa = useMutation({ mutationFn: () => api.post('/auth/mfa/setup', {}), onSuccess: (d: any) => setSetup(d) });
  const enableMfa = useMutation({
    mutationFn: () => api.post('/auth/mfa/enable', { code }),
    onSuccess: async () => {
      setSetup(null);
      setCode('');
      await session.reload();
    },
  });
  const disableMfa = useMutation({
    mutationFn: () => api.post('/auth/mfa/disable', disable),
    onSuccess: async () => {
      setDisable({ password: '', code: '' });
      await session.reload();
    },
  });
  const mfaOn = Boolean(session.user?.mfaEnabled);

  return (
    <div>
      <PageHeader title="Security" description="Your sign-in details, two-step verification and the devices signed in to your account." />
      <SettingsNav />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Your details" description={session.user?.email} />
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              saveProfile.mutate();
            }}
            className="space-y-4"
          >
            <Field label="Name">
              <input className="field" required value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input className="field" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
            </Field>
            <ErrorNote error={saveProfile.error} />
            {saveProfile.isSuccess ? <Notice tone="ok">Saved.</Notice> : null}
            <Button type="submit" variant="primary" loading={saveProfile.isPending}>
              Save
            </Button>
          </form>
        </Card>

        <Card>
          <CardHeader title="Change password" description="Changing it signs you out on every other device." />
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              changePassword.mutate();
            }}
            className="space-y-4"
          >
            <Field label="Current password" error={pwIssues.currentPassword}>
              <input className="field" type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
            </Field>
            <Field label="New password" error={pwIssues.newPassword} help="At least 10 characters, with letters and numbers.">
              <input className="field" type="password" autoComplete="new-password" required value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            </Field>
            {changePassword.error && !Object.keys(pwIssues).length ? <ErrorNote error={changePassword.error} /> : null}
            {changePassword.isSuccess ? <Notice tone="ok">Password changed.</Notice> : null}
            <Button type="submit" variant="primary" loading={changePassword.isPending}>
              Change password
            </Button>
          </form>
        </Card>

        <Card>
          <CardHeader title="Two-step verification" description="Requires a code from an authenticator app each time you sign in." action={<Badge tone={mfaOn ? 'ok' : 'neutral'}>{mfaOn ? 'On' : 'Off'}</Badge>} />
          {mfaOn ? (
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                disableMfa.mutate();
              }}
              className="space-y-4"
            >
              <p className="text-sm text-muted">To turn it off, confirm your password and a current code.</p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Password">
                  <input className="field" type="password" required value={disable.password} onChange={(e) => setDisable({ ...disable, password: e.target.value })} />
                </Field>
                <Field label="Authenticator code">
                  <input className="field tabular" inputMode="numeric" maxLength={6} required value={disable.code} onChange={(e) => setDisable({ ...disable, code: e.target.value.replace(/\D/g, '') })} />
                </Field>
              </div>
              <ErrorNote error={disableMfa.error} />
              <Button type="submit" loading={disableMfa.isPending}>
                Turn off
              </Button>
            </form>
          ) : setup ? (
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                enableMfa.mutate();
              }}
              className="space-y-4"
            >
              <Notice title="Add this key to your authenticator app">
                Choose “enter a setup key” in the app, account name {session.user?.email}, type “time based”.
              </Notice>
              <Field label="Setup key">
                <input className="field font-mono" readOnly value={setup.secret.replace(/(.{4})/g, '$1 ').trim()} onFocus={(e) => e.target.select()} />
              </Field>
              <p className="text-xs text-muted">
                On this device you can also <a className="underline" href={setup.otpauthUrl}>open it in your authenticator app</a>.
              </p>
              <Field label="Enter the 6-digit code the app shows">
                <input className="field tabular" inputMode="numeric" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              </Field>
              <ErrorNote error={enableMfa.error} />
              <div className="flex gap-2">
                <Button type="submit" variant="primary" loading={enableMfa.isPending}>
                  Turn on
                </Button>
                <Button onClick={() => setSetup(null)}>Cancel</Button>
              </div>
            </form>
          ) : (
            <>
              <ErrorNote error={startMfa.error} />
              <Button variant="primary" loading={startMfa.isPending} onClick={() => startMfa.mutate()}>
                Set up
              </Button>
            </>
          )}
        </Card>

        <Card>
          <CardHeader title="Signed-in devices" description="Sign out any device you do not recognise." />
          <ul className="divide-y divide-line">
            {(sessions.data ?? []).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">{s.userAgent ?? 'Unknown device'}</span>
                  <span className="block text-xs text-muted">
                    {s.ip ?? 'Unknown address'} · last active {dateTime(s.lastUsedAt)}
                  </span>
                </span>
                {s.current ? (
                  <Badge tone="ok">This device</Badge>
                ) : (
                  <Button size="sm" loading={revoke.isPending} onClick={() => revoke.mutate(s.id)}>
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <ErrorNote error={revoke.error} />
        </Card>
      </div>

      {session.can('audit') ? (
        <div className="mt-8">
          <ResourceView resource="audit-logs" title="Household activity log" columns={['summary', 'action', 'entityType', 'actorMemberId']} pageSize={20} emptyHint="Every change to household records is listed here." />
        </div>
      ) : null}
    </div>
  );
}

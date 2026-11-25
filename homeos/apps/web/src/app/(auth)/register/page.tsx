'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Button, Card, Field, Notice } from '@/components/ui';

function RegisterForm() {
  const session = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const invite = params.get('invite') ?? '';
  const [form, setForm] = useState({ name: '', email: '', password: '', householdName: '' });
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session.status === 'signed-in') router.replace('/dashboard');
  }, [session.status, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setIssues({});
    setBusy(true);
    try {
      const data = await api.register({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        ...(invite ? { inviteToken: invite } : form.householdName.trim() ? { householdName: form.householdName.trim() } : {}),
      } as any);
      session.signIn(data);
      router.replace('/dashboard');
    } catch (err: any) {
      const map: Record<string, string> = {};
      for (const i of err?.issues ?? []) map[i.field] = i.message;
      setIssues(map);
      if (!err?.issues?.length) setError(err?.message ?? 'Could not create the account');
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Card>
      <h1 className="text-lg font-semibold">{invite ? 'Join your household' : 'Create your household'}</h1>
      <p className="mt-1 text-sm text-muted">{invite ? 'Use the e-mail address your invitation was sent to.' : 'Set up HomeOS for your home in a minute.'}</p>
      <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
        <Field label="Your name" error={issues.name}>
          <input className="field" autoComplete="name" required value={form.name} onChange={set('name')} />
        </Field>
        <Field label="E-mail" error={issues.email}>
          <input className="field" type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Password" error={issues.password} help="At least 10 characters, with letters and numbers.">
          <input className="field" type="password" autoComplete="new-password" required value={form.password} onChange={set('password')} />
        </Field>
        {!invite ? (
          <Field label="Household name" help="Optional. You can change it later.">
            <input className="field" placeholder="e.g. Rao Residence" value={form.householdName} onChange={set('householdName')} />
          </Field>
        ) : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <p className="text-xs text-muted">By creating an account you agree to HomeOS storing and processing the household information you enter, in order to provide the service.</p>
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          {invite ? 'Join household' : 'Create account'}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-muted">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-ink underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </Card>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}

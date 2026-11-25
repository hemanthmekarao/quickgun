'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Button, Card, Field, Notice } from '@/components/ui';

export default function LoginPage() {
  const session = useSession();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session.status === 'signed-in') router.replace('/dashboard');
  }, [session.status, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await api.login(email.trim(), password, needsMfa ? totp : undefined);
      session.signIn(data);
      router.replace('/dashboard');
    } catch (err: any) {
      if (err?.code === 'MFA_REQUIRED') {
        setNeedsMfa(true);
        setError('');
      } else setError(err?.message ?? 'Could not sign in');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h1 className="text-lg font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-muted">Welcome back to your household.</p>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <Field label="E-mail">
          <input className="field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <input className="field" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {needsMfa ? (
          <Field label="Authenticator code" help="Enter the 6-digit code from your authenticator app.">
            <input className="field tabular" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus required value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} />
          </Field>
        ) : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          {needsMfa ? 'Verify and sign in' : 'Sign in'}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-muted">
        New to HomeOS?{' '}
        <Link href="/register" className="font-medium text-ink underline underline-offset-2">
          Create an account
        </Link>
      </p>
    </Card>
  );
}

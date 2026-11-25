'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { date, money } from '@/lib/format';
import { useSession } from '@/lib/session';
import { ResourceView } from '@/components/resource';
import { Card, Notice, PageHeader, Stat } from '@/components/ui';

export default function HealthcarePage() {
  const session = useSession();
  const fmt = (n: number) => money(n, session.currency);
  const [member, setMember] = useState('');
  const members = useQuery({ queryKey: ['members', session.household?.id], queryFn: () => api.get<any[]>('/members') });
  const year = new Date().getUTCFullYear();
  const records = useQuery({ queryKey: ['medical-year', session.household?.id, year], queryFn: () => api.resource('medical-records').list({ from: `${year}-01-01`, pageSize: 200 }) });
  const items = records.data?.items ?? [];
  const spent = items.reduce((s, r) => s + (r.amount ?? 0), 0);
  const toClaim = items.filter((r) => r.reimbursementStatus === 'TO_BE_CLAIMED' || r.reimbursementStatus === 'CLAIMED');
  const reimbursed = items.reduce((s, r) => s + (r.reimbursedAmount ?? 0), 0);
  const people = (members.data ?? []).filter((m) => m.status !== 'REMOVED');

  return (
    <div>
      <PageHeader title="Healthcare" description="Consultations, hospital bills, diagnostic reports and pharmacy spend for each family member, with insurance claim and reimbursement status." />
      <div className="mb-4">
        <Notice>
          Medical records are visible only to members whose role includes healthcare access. In the expense ledger they appear as “Healthcare expense” with no medical detail.
        </Notice>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={`Medical spend ${year}`} value={fmt(spent)} hint={`${items.length} records`} />
        <Stat label="Reimbursed" value={fmt(reimbursed)} />
        <Stat label="Awaiting reimbursement" value={toClaim.length} tone={toClaim.length ? 'warn' : undefined} hint={fmt(toClaim.reduce((s, r) => s + (r.amount ?? 0), 0))} />
        <Stat label="Family profiles" value={people.length} />
      </div>
      {people.length ? (
        <Card className="mb-6">
          <p className="mb-3 text-sm font-semibold">Family members</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setMember('')} className={`rounded-lg border px-3 py-1.5 text-sm ${member === '' ? 'border-ink bg-ink text-bg' : 'border-line hover:bg-subtle'}`}>
              Everyone
            </button>
            {people.map((m) => (
              <button key={m.id} type="button" onClick={() => setMember(m.id)} className={`rounded-lg border px-3 py-1.5 text-left text-sm ${member === m.id ? 'border-ink bg-ink text-bg' : 'border-line hover:bg-subtle'}`}>
                {m.name}
                {m.bloodGroup || m.dateOfBirth ? <span className="ml-2 text-xs opacity-70">{[m.bloodGroup, m.dateOfBirth ? `b. ${date(m.dateOfBirth)}` : ''].filter(Boolean).join(' · ')}</span> : null}
              </button>
            ))}
          </div>
        </Card>
      ) : null}
      <ResourceView key={member} resource="medical-records" filter={member ? { memberId: member } : {}} emptyHint="Add a record for each consultation, test, hospital stay or pharmacy bill. Attach the report from the document vault." />
    </div>
  );
}

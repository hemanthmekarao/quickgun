'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { date, money } from '@/lib/format';
import { useTab } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { ResourceView } from '@/components/resource';
import { Badge, Notice, PageHeader, Tabs } from '@/components/ui';

export default function InsurancePage() {
  const session = useSession();
  const [tab, setTab] = useTab('policies', ['policies', 'claims'] as const);
  const expiring = useQuery({ queryKey: ['insurance-expiring', session.household?.id], queryFn: () => api.resource('insurance-policies').list({ status: 'ACTIVE', to: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10), sort: 'expiryDate', order: 'asc' }) });
  const soon = expiring.data?.items ?? [];
  return (
    <div>
      <PageHeader title="Insurance" description="Life, health, home, vehicle, accident and travel policies with coverage, premiums, nominees, renewal reminders and claims." />
      {soon.length ? (
        <div className="mb-5">
          <Notice tone="warn" title={`${soon.length} polic${soon.length === 1 ? 'y expires' : 'ies expire'} within 90 days`}>
            {soon.map((p) => `${p.name} on ${date(p.expiryDate)} (premium ${money(p.premiumAmount, session.currency)})`).join('; ')}
          </Notice>
        </div>
      ) : null}
      <Tabs
        tabs={[
          { key: 'policies', label: 'Policies' },
          { key: 'claims', label: 'Claims & reimbursements' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'policies' ? (
        <ResourceView resource="insurance-policies" rowActions={(row) => (row.status === 'ACTIVE' && row.expiryDate < new Date().toISOString().slice(0, 10) ? <Badge tone="danger">Past expiry date</Badge> : null)} />
      ) : (
        <ResourceView resource="insurance-claims" emptyHint="Record each claim with the amount claimed, approved and settled." />
      )}
    </div>
  );
}

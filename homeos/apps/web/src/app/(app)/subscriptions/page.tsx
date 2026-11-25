'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { useSession } from '@/lib/session';
import { ResourceView } from '@/components/resource';
import { Notice, PageHeader, Stat } from '@/components/ui';

export default function SubscriptionsPage() {
  const session = useSession();
  const fmt = (n: number) => money(n, session.currency);
  const summary = useQuery({ queryKey: ['subscriptions-summary', session.household?.id], queryFn: () => api.get('/reports/subscriptions') });
  const s = summary.data;
  return (
    <div>
      <PageHeader title="Subscriptions & memberships" description="Streaming, music, cloud storage, software, gym and club memberships — with renewal reminders and what they cost you a year." />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active" value={s ? s.activeCount : '—'} />
        <Stat label="Per month" value={s ? fmt(s.monthlyCost) : '—'} />
        <Stat label="Per year" value={s ? fmt(s.annualCost) : '—'} />
        <Stat label="Possibly unused" value={s ? s.possiblyUnused.length : '—'} tone={s?.possiblyUnused.length ? 'warn' : undefined} hint="Not used for 60+ days" />
      </div>
      {s?.possiblyUnused.length ? (
        <div className="mb-4">
          <Notice tone="warn" title="You may not be using these">
            {s.possiblyUnused.map((x: any) => `${x.name} (${fmt(x.annualCost)} a year)`).join(', ')}. This is based on the “last used” date you recorded.
          </Notice>
        </div>
      ) : null}
      {s?.possibleDuplicates.length ? (
        <div className="mb-4">
          <Notice tone="warn" title="Possible duplicate subscriptions">
            {s.possibleDuplicates.map((g: any[]) => g.map((x) => x.name).join(' and ')).join('; ')}.
          </Notice>
        </div>
      ) : null}
      <ResourceView resource="subscriptions" columns={['name', 'category', 'amount', 'billingCycle', 'nextRenewalDate', 'status']} emptyHint="Add each subscription with its renewal date to get a reminder before it renews." />
    </div>
  );
}

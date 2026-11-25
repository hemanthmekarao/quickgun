'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { date, label, money } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Progress } from '@/components/charts';
import { ResourceView } from '@/components/resource';
import { Badge, Card, PageHeader } from '@/components/ui';
import { BackLink } from '@/components/widgets';

export default function BudgetsPage() {
  const session = useSession();
  const status = useQuery({ queryKey: ['budget-status', session.household?.id], queryFn: () => api.get('/finance/budget-status') });
  const fmt = (n: number) => money(n, session.currency);
  return (
    <div>
      <BackLink href="/finance">Finance</BackLink>
      <PageHeader title="Budgets" description="Set a monthly, quarterly or yearly limit for all spending or one category. You are notified when a budget passes its alert level." />
      {(status.data ?? []).length ? (
        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {status.data.map((b: any) => (
            <Card key={b.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{b.name}</p>
                  <p className="text-xs text-muted">
                    {b.category === 'ALL' ? 'All spending' : label(b.category)} · {label(b.period)} since {date(b.periodStart)}
                  </p>
                </div>
                <Badge tone={b.state === 'OVER' ? 'danger' : b.state === 'WARNING' ? 'warn' : 'ok'}>{b.state === 'OVER' ? 'Over budget' : b.state === 'WARNING' ? 'Near limit' : 'On track'}</Badge>
              </div>
              <p className="tabular mt-4 text-xl font-semibold">
                {fmt(b.used)} <span className="text-sm font-normal text-muted">of {fmt(b.amount)}</span>
              </p>
              <div className="mt-2">
                <Progress percent={b.percentUsed} tone={b.state === 'OVER' ? 'danger' : b.state === 'WARNING' ? 'warn' : 'ok'} />
              </div>
              <p className="mt-2 text-xs text-muted">{b.remaining >= 0 ? `${fmt(b.remaining)} left` : `${fmt(-b.remaining)} over`} · {b.percentUsed}% used</p>
            </Card>
          ))}
        </div>
      ) : null}
      <ResourceView resource="budgets" title="All budgets" hideSearch />
    </div>
  );
}

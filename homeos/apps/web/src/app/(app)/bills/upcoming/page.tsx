'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { date, daysUntil, money, relativeDay, todayIso } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Badge, Card, CardHeader, EmptyState, ErrorNote, PageHeader, Spinner, Stat } from '@/components/ui';
import { BackLink, RecordPaymentButton } from '@/components/widgets';

export default function UpcomingBillsPage() {
  const session = useSession();
  const fmt = (n: number) => money(n, session.currency);
  const today = todayIso();
  const horizon = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  // Every bill that is still open, due at any time up to 60 days from now.
  const bills = useQuery({
    queryKey: ['bills-open', session.household?.id],
    queryFn: () => api.resource('bills').list({ status: 'UNPAID,SCHEDULED,PARTIALLY_PAID,DISPUTED', to: horizon, sort: 'dueDate', order: 'asc', pageSize: 200 }),
  });
  if (bills.isLoading) return <Spinner />;
  if (bills.error) return <ErrorNote error={bills.error} />;
  const items = bills.data!.items;
  const due = (b: any) => Math.round((b.amount + (b.lateFee ?? 0) - (b.paidAmount ?? 0)) * 100) / 100;
  const overdue = items.filter((b) => b.dueDate < today);
  const week = items.filter((b) => b.dueDate >= today && (daysUntil(b.dueDate) ?? 99) <= 7);
  const later = items.filter((b) => (daysUntil(b.dueDate) ?? 0) > 7);
  const sum = (list: any[]) => list.reduce((s, b) => s + due(b), 0);

  const Section = ({ title, list, tone }: { title: string; list: any[]; tone?: 'danger' }) =>
    list.length === 0 ? null : (
      <Card className="mb-4" padded={false}>
        <div className="px-5 pt-5">
          <CardHeader title={title} description={`${list.length} bill${list.length === 1 ? '' : 's'} · ${fmt(sum(list))}`} />
        </div>
        <ul className="divide-y divide-line border-t border-line">
          {list.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{b._refs?.providerId?.label ?? 'Bill'}</span>
                <span className={`block text-xs ${tone === 'danger' ? 'text-danger' : 'text-muted'}`}>
                  Due {date(b.dueDate)} · {relativeDay(b.dueDate)}
                  {b.billNumber ? ` · ${b.billNumber}` : ''}
                </span>
              </span>
              {b.status !== 'UNPAID' ? <Badge tone="warn">{b.status === 'PARTIALLY_PAID' ? 'Part paid' : b.status === 'SCHEDULED' ? 'Scheduled' : 'Disputed'}</Badge> : null}
              <span className="tabular font-semibold">{fmt(due(b))}</span>
              <RecordPaymentButton target={{ billId: b.id }} amount={due(b)} label="Mark paid" />
            </li>
          ))}
        </ul>
      </Card>
    );

  return (
    <div>
      <BackLink href="/bills">Bills & utilities</BackLink>
      <PageHeader title="Upcoming & overdue bills" description="Everything that still needs paying, up to 60 days ahead." />
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Overdue" value={fmt(sum(overdue))} tone={overdue.length ? 'danger' : 'ok'} hint={`${overdue.length} bill${overdue.length === 1 ? '' : 's'}`} />
        <Stat label="Due within 7 days" value={fmt(sum(week))} tone={week.length ? 'warn' : undefined} hint={`${week.length} bill${week.length === 1 ? '' : 's'}`} />
        <Stat label="Due later" value={fmt(sum(later))} hint={`${later.length} bill${later.length === 1 ? '' : 's'}`} />
      </div>
      {items.length === 0 ? (
        <Card>
          <EmptyState title="No unpaid bills" description="Bills you add will appear here until they are paid." />
        </Card>
      ) : (
        <>
          <Section title="Overdue" list={overdue} tone="danger" />
          <Section title="Due this week" list={week} />
          <Section title="Later" list={later} />
        </>
      )}
    </div>
  );
}

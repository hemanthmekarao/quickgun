'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Bot, FileText, Plus, Receipt, Upload, Wrench } from 'lucide-react';
import { api } from '@/lib/api';
import { date, label, money, monthLabel } from '@/lib/format';
import { useSession } from '@/lib/session';
import { BarChart, Donut } from '@/components/charts';
import { Badge, Card, CardHeader, ErrorNote, LinkButton, Notice, PageHeader, Spinner, Stat, statusTone } from '@/components/ui';
import { EventList } from '@/components/widgets';

export default function DashboardPage() {
  const session = useSession();
  const { data, isLoading, error } = useQuery({ queryKey: ['dashboard', session.household?.id], queryFn: () => api.get('/dashboard') });
  const fmt = (n: number) => money(n, session.currency);

  if (isLoading) return <Spinner label="Loading dashboard" />;
  if (error) return <ErrorNote error={error} />;
  const d = data;
  const s = d.spending;
  const change = s && s.lastMonth > 0 ? ((s.thisMonth - s.lastMonth) / s.lastMonth) * 100 : null;

  return (
    <div>
      <PageHeader
        title={`Hello, ${session.user?.name.split(' ')[0]}`}
        description={`${session.household?.name} · ${date(d.today)}`}
        actions={
          <>
            {session.can('finance', 'write') ? <LinkButton href="/finance?add=1" icon={<Plus className="h-4 w-4" />}>Expense</LinkButton> : null}
            {session.can('bills', 'write') ? <LinkButton href="/bills" icon={<Receipt className="h-4 w-4" />}>Bill</LinkButton> : null}
            {session.can('documents', 'write') ? <LinkButton href="/documents?upload=1" icon={<Upload className="h-4 w-4" />}>Upload</LinkButton> : null}
            {session.can('maintenance', 'write') ? <LinkButton href="/maintenance" icon={<Wrench className="h-4 w-4" />}>Task</LinkButton> : null}
            {session.can('assistant') ? <LinkButton href="/assistant" variant="primary" icon={<Bot className="h-4 w-4" />}>Ask</LinkButton> : null}
          </>
        }
      />

      {d.pendingApprovals ? (
        <div className="mb-5">
          <Notice tone="warn" title={`${d.pendingApprovals} expense${d.pendingApprovals === 1 ? '' : 's'} waiting for your approval`}>
            <Link href="/finance" className="underline">Review in Finance</Link>
          </Notice>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {s ? (
          <>
            <Stat
              label="Spent this month"
              value={fmt(s.thisMonth)}
              hint={
                change === null ? 'No spending last month to compare' : (
                  <span className="inline-flex items-center gap-1">
                    {change > 0 ? <ArrowUpRight className="h-3 w-3 text-danger" /> : <ArrowDownRight className="h-3 w-3 text-ok" />}
                    {Math.abs(change).toFixed(0)}% vs last month ({fmt(s.lastMonth)})
                  </span>
                )
              }
            />
            <Stat label="Spent this year" value={fmt(s.thisYear)} hint="Refunds deducted" />
          </>
        ) : null}
        {d.bills ? (
          <>
            <Stat label="Bills due in 30 days" value={fmt(d.bills.upcomingTotal)} hint={`${d.bills.upcomingCount} bill${d.bills.upcomingCount === 1 ? '' : 's'}`} />
            <Stat label="Overdue bills" value={d.bills.overdueCount} tone={d.bills.overdueCount ? 'danger' : 'ok'} hint={d.bills.overdueCount ? fmt(d.bills.overdueTotal) : 'All clear'} />
          </>
        ) : null}
      </div>

      {d.summary ? (
        <Card className="mt-4">
          <CardHeader title="This month at a glance" description="Calculated from your records." />
          <p className="text-sm">{d.summary.headline}</p>
          {d.summary.points.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
              {d.summary.points.map((p: string) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {s ? (
          <Card className="lg:col-span-2">
            <CardHeader title="Spending, last 12 months" action={<Link href="/reports" className="text-xs text-muted underline">Reports</Link>} />
            <BarChart data={s.trend.map((t: any) => ({ label: monthLabel(t.month), value: t.amount }))} format={fmt} highlightLast />
          </Card>
        ) : null}
        {s ? (
          <Card>
            <CardHeader title="This month by category" />
            <Donut data={s.byCategory.map((c: any) => ({ label: label(c.category), value: c.amount }))} format={fmt} />
          </Card>
        ) : null}

        {d.bills ? (
          <Card>
            <CardHeader title="Upcoming bills" action={<Link href="/bills/upcoming" className="text-xs text-muted underline">All</Link>} />
            <EventList events={[...d.bills.overdue, ...d.bills.upcoming]} empty="No unpaid bills in the next 30 days." limit={6} />
          </Card>
        ) : null}

        <Card>
          <CardHeader title="Next 30 days" description="Bills, renewals, services and salaries" action={<Link href="/calendar" className="text-xs text-muted underline">Calendar</Link>} />
          <EventList events={d.calendar} empty="Nothing scheduled in the next 30 days." limit={6} />
        </Card>

        {d.recentExpenses ? (
          <Card>
            <CardHeader title="Recent transactions" action={<Link href="/finance" className="text-xs text-muted underline">All</Link>} />
            {d.recentExpenses.length === 0 ? (
              <p className="py-4 text-sm text-muted">No expenses recorded yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.recentExpenses.slice(0, 6).map((e: any) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{e.description}</span>
                      <span className="block text-xs text-muted">
                        {date(e.date)} · {label(e.category)}
                      </span>
                    </span>
                    <span className={`tabular shrink-0 font-medium ${e.kind === 'EXPENSE' ? '' : 'text-ok'}`}>
                      {e.kind === 'EXPENSE' ? '' : '+'}
                      {fmt(e.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {d.insuranceRenewals ? (
          <Card>
            <CardHeader title="Insurance renewals" description="Next 60 days" />
            <EventList events={d.insuranceRenewals} empty="No renewals in the next 60 days." limit={5} />
          </Card>
        ) : null}

        {d.properties ? (
          <Card>
            <CardHeader title="Properties" description={`${d.properties.count} · ${fmt(d.properties.totalValue)} estimated value`} action={<Link href="/properties" className="text-xs text-muted underline">All</Link>} />
            {d.properties.items.length === 0 ? (
              <p className="py-4 text-sm text-muted">No properties added yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.properties.items.map((p: any) => (
                  <li key={p.id}>
                    <Link href={`/properties/${p.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:opacity-80">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{p.name}</span>
                        <span className="block text-xs text-muted">{[label(p.propertyType), p.city].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="tabular shrink-0 text-muted">{p.currentValue !== null ? money(p.currentValue, session.currency, { compact: true }) : ''}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {d.vehicles ? (
          <Card>
            <CardHeader title="Vehicles" description={`${d.vehicles.count} registered`} action={<Link href="/vehicles" className="text-xs text-muted underline">All</Link>} />
            {d.vehicles.alerts.length ? <EventList events={d.vehicles.alerts} limit={4} /> : null}
            {d.vehicles.items.length === 0 ? (
              <p className="py-4 text-sm text-muted">No vehicles registered yet.</p>
            ) : d.vehicles.alerts.length === 0 ? (
              <ul className="divide-y divide-line">
                {d.vehicles.items.map((v: any) => (
                  <li key={v.id}>
                    <Link href={`/vehicles/${v.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:opacity-80">
                      <span className="min-w-0 truncate font-medium">{v.name}</span>
                      <span className="shrink-0 text-xs text-muted">{v.nextServiceDate ? `Service ${date(v.nextServiceDate)}` : v.registrationNumber}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ) : null}

        {d.applianceAlerts ? (
          <Card>
            <CardHeader title="Appliance alerts" description={`${d.applianceCount} appliances · warranty and service`} />
            <EventList events={d.applianceAlerts} empty="No warranty or service dates in the next 60 days." limit={5} />
          </Card>
        ) : null}

        {d.staff ? (
          <Card>
            <CardHeader title="Staff salaries" description={`${d.staff.activeCount} staff · ${fmt(d.staff.monthlyCommitment)} a month`} action={<Link href="/staff" className="text-xs text-muted underline">All</Link>} />
            <EventList events={d.staff.salaryCalendar} empty="No salaries due in the next 30 days." limit={5} />
          </Card>
        ) : null}

        {d.documentExpiries ? (
          <Card>
            <CardHeader
              title="Document expiry"
              description="Next 60 days"
              action={d.inboxPending ? <Link href="/documents?tab=inbox"><Badge tone="warn">{d.inboxPending} in inbox</Badge></Link> : <FileText className="h-4 w-4 text-muted" aria-hidden />}
            />
            <EventList events={d.documentExpiries} empty="No documents expiring soon." limit={5} />
          </Card>
        ) : null}

        {d.maintenance ? (
          <Card>
            <CardHeader title="Pending repairs" description={`${d.maintenance.open} open task${d.maintenance.open === 1 ? '' : 's'}`} action={<Link href="/maintenance" className="text-xs text-muted underline">All</Link>} />
            {d.maintenance.items.length === 0 ? (
              <p className="py-4 text-sm text-muted">Nothing needs attention.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.maintenance.items.map((t: any) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{t.title}</span>
                      <span className="block text-xs text-muted">{t.dueDate ? `Due ${date(t.dueDate)}` : label(t.category)}</span>
                    </span>
                    <Badge tone={statusTone(t.priority)}>{label(t.priority)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {d.subscriptions ? (
          <Card>
            <CardHeader title="Subscriptions" description={`${d.subscriptions.activeCount} active · ${fmt(d.subscriptions.annualCost)} a year`} action={<Link href="/subscriptions" className="text-xs text-muted underline">All</Link>} />
            <EventList events={d.subscriptions.renewals} empty="No renewals in the next 30 days." limit={5} />
          </Card>
        ) : null}
      </div>
    </div>
  );
}

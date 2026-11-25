'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { cx, money, todayIso } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Badge, Button, Card, CardHeader, ErrorNote, PageHeader } from '@/components/ui';
import { EventList, type DatedEvent } from '@/components/widgets';

const TYPE_LABEL: Record<string, string> = {
  BILL_DUE: 'Bills',
  INSURANCE_RENEWAL: 'Insurance',
  INSURANCE_PREMIUM: 'Insurance',
  VEHICLE_SERVICE: 'Vehicles',
  VEHICLE_COMPLIANCE: 'Vehicles',
  WARRANTY_EXPIRY: 'Warranties',
  APPLIANCE_SERVICE: 'Appliances',
  SUBSCRIPTION_RENEWAL: 'Subscriptions',
  PROPERTY_TAX: 'Property tax',
  STAFF_SALARY: 'Salaries',
  DOCUMENT_EXPIRY: 'Documents',
  MAINTENANCE_DUE: 'Maintenance',
  TRAVEL_DOCUMENT_EXPIRY: 'Passports & visas',
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function CalendarPage() {
  const session = useSession();
  const today = todayIso();
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { year: n.getUTCFullYear(), month: n.getUTCMonth() };
  });
  const [selected, setSelected] = useState<string>(today);
  const [filter, setFilter] = useState('');

  const first = new Date(Date.UTC(cursor.year, cursor.month, 1));
  const last = new Date(Date.UTC(cursor.year, cursor.month + 1, 0));
  // Monday-first grid covering the whole month.
  const gridStart = new Date(first.getTime() - ((first.getUTCDay() + 6) % 7) * 86_400_000);
  const days = useMemo(() => {
    const out: string[] = [];
    for (let t = gridStart.getTime(); out.length < 42; t += 86_400_000) out.push(iso(new Date(t)));
    return out.slice(0, out[35] > iso(last) ? 35 : 42);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor.year, cursor.month]);

  const events = useQuery({
    queryKey: ['calendar', session.household?.id, days[0], days[days.length - 1]],
    queryFn: () => api.get('/calendar', { from: days[0], to: days[days.length - 1] }),
  });
  const all: DatedEvent[] = events.data?.events ?? [];
  const types = [...new Set(all.map((e) => TYPE_LABEL[e.eventType] ?? 'Other'))].sort();
  const visible = filter ? all.filter((e) => (TYPE_LABEL[e.eventType] ?? 'Other') === filter) : all;
  const byDay = new Map<string, DatedEvent[]>();
  for (const e of visible) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const inMonth = visible.filter((e) => e.date >= iso(first) && e.date <= iso(last));
  const total = inMonth.reduce((s, e) => s + (e.amount ?? 0), 0);
  const move = (delta: number) => setCursor((c) => {
    const d = new Date(Date.UTC(c.year, c.month + delta, 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
  });

  return (
    <div>
      <PageHeader
        title="Family financial calendar"
        description="Bills, renewals, services, salaries and expiry dates in one place."
        actions={
          <>
            <select className="field w-auto" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by type">
              <option value="">Everything</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <Button onClick={() => { const n = new Date(); setCursor({ year: n.getUTCFullYear(), month: n.getUTCMonth() }); setSelected(today); }}>Today</Button>
          </>
        }
      />
      <ErrorNote error={events.error} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" padded={false}>
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="text-base font-semibold">{first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h2>
            <div className="flex items-center gap-1">
              <button type="button" className="rounded-md p-1.5 text-muted hover:bg-subtle" onClick={() => move(-1)} aria-label="Previous month">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button type="button" className="rounded-md p-1.5 text-muted hover:bg-subtle" onClick={() => move(1)} aria-label="Next month">
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-7 border-t border-line text-center text-[11px] font-medium text-muted">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 border-t border-line">
            {days.map((day) => {
              const list = byDay.get(day) ?? [];
              const outside = day < iso(first) || day > iso(last);
              const overdue = day < today && list.length > 0;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setSelected(day)}
                  className={cx('min-h-[64px] border-b border-r border-line p-1.5 text-left align-top transition-colors hover:bg-subtle/70 sm:min-h-[84px]', outside && 'bg-subtle/40 text-muted', selected === day && 'bg-accent/10')}
                  aria-label={`${day}: ${list.length} item${list.length === 1 ? '' : 's'}`}
                >
                  <span className={cx('inline-grid h-6 w-6 place-items-center rounded-full text-xs', day === today && 'bg-ink font-semibold text-bg')}>{Number(day.slice(8))}</span>
                  <span className="mt-1 hidden space-y-0.5 sm:block">
                    {list.slice(0, 2).map((e) => (
                      <span key={e.key} className={cx('block truncate rounded px-1 text-[10px]', overdue ? 'bg-danger/10 text-danger' : 'bg-subtle text-ink')}>
                        {e.title}
                      </span>
                    ))}
                    {list.length > 2 ? <span className="block px-1 text-[10px] text-muted">+{list.length - 2} more</span> : null}
                  </span>
                  {list.length ? <span className={cx('mt-1 block h-1.5 w-1.5 rounded-full sm:hidden', overdue ? 'bg-danger' : 'bg-accent')} /> : null}
                </button>
              );
            })}
          </div>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title={new Date(`${selected}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })} action={selected === today ? <Badge tone="accent">Today</Badge> : undefined} />
            <EventList events={byDay.get(selected) ?? []} empty="Nothing on this day." />
          </Card>
          <Card>
            <CardHeader title="This month" description={`${inMonth.length} item${inMonth.length === 1 ? '' : 's'}${total ? ` · ${money(total, session.currency)} in amounts due` : ''}`} />
            <EventList events={inMonth} empty="Nothing this month." limit={12} />
            {inMonth.length > 12 ? <p className="mt-2 text-xs text-muted">Showing the first 12. Select a day to see everything on it.</p> : null}
          </Card>
          <p className="text-xs text-muted">
            Reminders for these dates are set in <Link href="/notifications?tab=rules" className="underline">Notifications → Reminder rules</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}

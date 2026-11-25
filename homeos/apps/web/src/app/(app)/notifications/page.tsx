'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, RefreshCw } from 'lucide-react';
import { humanize } from '@homeos/shared';
import { api } from '@/lib/api';
import { cx, date, dateTime } from '@/lib/format';
import { useTab } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { ResourceView } from '@/components/resource';
import { Badge, Button, Card, EmptyState, ErrorNote, Notice, PageHeader, Spinner, Tabs } from '@/components/ui';

const HREF: Record<string, (id: string) => string> = {
  bills: () => '/bills/upcoming',
  'insurance-policies': () => '/insurance',
  vehicles: (id) => `/vehicles/${id}`,
  appliances: (id) => `/appliances/${id}`,
  warranties: () => '/appliances?tab=warranties',
  subscriptions: () => '/subscriptions',
  properties: (id) => `/properties/${id}`,
  salaries: () => '/staff?tab=salaries',
  staff: (id) => `/staff/${id}`,
  documents: (id) => `/documents/${id}`,
  'maintenance-tasks': () => '/maintenance',
  'travel-documents': () => '/travel?tab=documents',
  budgets: () => '/finance/budgets',
};

export default function NotificationsPage() {
  const session = useSession();
  const qc = useQueryClient();
  const [tab, setTab] = useTab('inbox', ['inbox', 'rules', 'channels'] as const);
  const list = useQuery({ queryKey: ['notifications', session.household?.id], queryFn: () => api.resource('notifications').list({ pageSize: 100, sort: 'createdAt', order: 'desc' }) });
  const channels = useQuery({ queryKey: ['notification-channels', session.household?.id], queryFn: () => api.get('/notification-channels') });
  const refresh = () => qc.invalidateQueries();
  const read = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`, {}), onSuccess: refresh });
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all', {}), onSuccess: refresh });
  const scan = useMutation({ mutationFn: () => api.post('/notifications/scan', {}), onSuccess: refresh });
  const items = list.data?.items ?? [];
  const unread = items.filter((n) => !n.readAt).length;

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Reminders for bills, renewals, services, warranties, salaries and expiring documents. You only receive reminders about records your role can see."
        actions={
          tab === 'inbox' ? (
            <>
              {session.can('notifications', 'write') ? (
                <Button icon={<RefreshCw className="h-4 w-4" />} loading={scan.isPending} onClick={() => scan.mutate()}>
                  Check now
                </Button>
              ) : null}
              <Button icon={<CheckCheck className="h-4 w-4" />} disabled={!unread} loading={readAll.isPending} onClick={() => readAll.mutate()}>
                Mark all read
              </Button>
            </>
          ) : null
        }
      />
      <Tabs
        tabs={[
          { key: 'inbox', label: 'Notifications', count: unread || undefined },
          { key: 'rules', label: 'Reminder rules' },
          { key: 'channels', label: 'Channels' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'inbox' ? (
        <>
          {scan.data ? (
            <div className="mb-3">
              <Notice tone="ok">{scan.data.created ? `${scan.data.created} new reminder${scan.data.created === 1 ? '' : 's'} created.` : 'Everything is up to date — no new reminders.'}</Notice>
            </div>
          ) : null}
          <ErrorNote error={list.error ?? scan.error} />
          <Card padded={false}>
            {list.isLoading ? (
              <Spinner />
            ) : items.length === 0 ? (
              <EmptyState icon={<Bell className="h-5 w-5" />} title="No notifications" description="Reminders are checked every morning. Add bills, renewal dates and service dates to start receiving them." />
            ) : (
              <ul className="divide-y divide-line">
                {items.map((n) => {
                  const href = HREF[n.entityType]?.(n.entityId);
                  return (
                    <li key={n.id} className={cx('flex items-start gap-3 px-5 py-3.5', !n.readAt && 'bg-accent/5')}>
                      <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-line' : n.severity === 'CRITICAL' ? 'bg-danger' : n.severity === 'WARNING' ? 'bg-warn' : 'bg-accent')} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {href ? (
                            <Link href={href} className="hover:underline" onClick={() => !n.readAt && read.mutate(n.id)}>
                              {n.title}
                            </Link>
                          ) : (
                            n.title
                          )}
                        </p>
                        <p className="mt-0.5 text-sm text-muted">{n.body}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                          {dateTime(n.createdAt)}
                          {n.dueDate ? <span>· due {date(n.dueDate)}</span> : null}
                          {Object.entries(n.channelStatus ?? {})
                            .filter(([k]) => k !== 'IN_APP')
                            .map(([k, v]) => (
                              <Badge key={k} tone={v === 'SENT' ? 'ok' : 'neutral'}>
                                {humanize(k)}: {v === 'SENT' ? 'sent' : v === 'NOT_CONFIGURED' ? 'not connected' : v === 'NO_ADDRESS' ? 'no address' : 'failed'}
                              </Badge>
                            ))}
                        </p>
                      </div>
                      {!n.readAt ? (
                        <Button size="sm" variant="ghost" onClick={() => read.mutate(n.id)}>
                          Mark read
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      ) : null}
      {tab === 'rules' ? (
        <>
          <div className="mb-4">
            <Notice>
              Each rule says how many days before the due date you are reminded. Use 0 for the due date itself and a negative number for after it is overdue — for example “7, 3, 0, -1”.
            </Notice>
          </div>
          <ResourceView resource="reminder-rules" hideSearch pageSize={50} />
        </>
      ) : null}
      {tab === 'channels' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(channels.data ?? {}).map(([key, c]: [string, any]) => (
            <Card key={key}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">{key === 'IN_APP' ? 'In the app' : humanize(key)}</p>
                <Badge tone={c.available ? 'ok' : 'neutral'}>{c.available ? 'Available' : 'Not connected'}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted">{c.note}</p>
            </Card>
          ))}
          <div className="sm:col-span-2 lg:col-span-3">
            <Notice>A rule can list any channel. If a channel is not connected, the reminder still arrives in the app and the notification shows that the other channel was not used.</Notice>
          </div>
        </div>
      ) : null}
    </div>
  );
}

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { money, todayIso } from '@/lib/format';
import { useTab } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { ResourceView } from '@/components/resource';
import { Button, ErrorNote, Notice, PageHeader, Stat, Tabs } from '@/components/ui';
import { RecordPaymentButton } from '@/components/widgets';

export default function StaffPage() {
  const session = useSession();
  const qc = useQueryClient();
  const fmt = (n: number) => money(n, session.currency);
  const [tab, setTab] = useTab('staff', ['staff', 'salaries', 'attendance', 'advances'] as const);
  const summary = useQuery({ queryKey: ['staff-summary', session.household?.id], queryFn: () => api.get('/reports/staff') });
  const month = todayIso().slice(0, 7);
  const generate = useMutation({ mutationFn: () => api.post('/salaries/generate', { month }), onSuccess: () => qc.invalidateQueries() });
  const s = summary.data;

  return (
    <div>
      <PageHeader title="Household staff" description="Housekeepers, cooks, drivers, gardeners and security — contact and ID details, salary, attendance, leave, advances and payment history." />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Staff" value={s ? s.staffCount : '—'} />
        <Stat label="Monthly salaries" value={s ? fmt(s.monthlyCommitment) : '—'} hint={s ? `${fmt(s.annualCommitment)} a year` : undefined} />
        <Stat label="Paid this year" value={s ? fmt(s.paidThisYear) : '—'} />
        <Stat label="Pending payments" value={s ? s.pendingCount : '—'} tone={s?.pendingCount ? 'warn' : undefined} hint={s ? fmt(s.pendingAmount) : undefined} />
      </div>
      <Tabs
        tabs={[
          { key: 'staff', label: 'Staff' },
          { key: 'salaries', label: 'Salaries' },
          { key: 'attendance', label: 'Attendance & leave' },
          { key: 'advances', label: 'Advances' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'staff' ? <ResourceView resource="staff" href={(row) => `/staff/${row.id}`} emptyHint="Add each staff member with their monthly salary and salary day to get payment reminders." /> : null}
      {tab === 'salaries' ? (
        <>
          {generate.data ? (
            <div className="mb-3">
              <Notice tone="ok">
                {generate.data.created} salary record{generate.data.created === 1 ? '' : 's'} created for {month}; {generate.data.alreadyPresent} already existed.
              </Notice>
            </div>
          ) : null}
          <ErrorNote error={generate.error} />
          <ResourceView
            resource="salaries"
            columns={['staffId', 'month', 'baseAmount', 'netAmount', 'dueDate', 'status']}
            actions={
              session.can('staff', 'write') ? (
                <Button icon={<CalendarPlus className="h-4 w-4" />} loading={generate.isPending} onClick={() => generate.mutate()}>
                  Create this month's salaries
                </Button>
              ) : null
            }
            rowActions={(row) => (['PENDING', 'PARTIALLY_PAID'].includes(row.status) ? <RecordPaymentButton target={{ salaryId: row.id }} amount={Math.round((row.netAmount - (row.paidAmount ?? 0)) * 100) / 100} label="Mark paid" /> : null)}
            emptyHint="Salary records are created at the start of each month. Add bonuses, deductions or advance recoveries before paying."
          />
        </>
      ) : null}
      {tab === 'attendance' ? <ResourceView resource="attendance" defaults={{ date: todayIso(), status: 'PRESENT' }} hideSearch emptyHint="Record presence, half days and leave for each staff member." /> : null}
      {tab === 'advances' ? <ResourceView resource="staff-advances" defaults={{ date: todayIso() }} emptyHint="Record salary advances and how much has been recovered." /> : null}
    </div>
  );
}

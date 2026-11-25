'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { label, money, todayIso } from '@/lib/format';
import { useTab } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { EditRecordButton, RecordFields, ResourceView, useRecord } from '@/components/resource';
import { Card, ErrorNote, PageHeader, Spinner, Stat, Tabs } from '@/components/ui';
import { BackLink, RecordPaymentButton } from '@/components/widgets';

export default function StaffDetailPage() {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const fmt = (n: number | null | undefined) => money(n, session.currency);
  const [tab, setTab] = useTab('salaries', ['salaries', 'attendance', 'advances', 'details'] as const);
  const record = useRecord('staff', id);
  const overview = useQuery({ queryKey: ['staff-overview', session.household?.id, id], queryFn: () => api.get(`/reports/staff/${id}`) });

  if (record.isLoading) return <Spinner />;
  if (record.error) return <ErrorNote error={record.error} />;
  const s = record.data!;
  const o = overview.data;
  const att = o?.attendance ?? {};

  return (
    <div>
      <BackLink href="/staff">Household staff</BackLink>
      <PageHeader title={s.name} description={[label(s.role), s.phone, s.workSchedule].filter(Boolean).join(' · ')} actions={<EditRecordButton resource="staff" row={s} />} />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Monthly salary" value={fmt(s.monthlySalary)} hint={`Paid on day ${s.salaryDay ?? 1}`} />
        <Stat label="Total paid" value={o ? fmt(o.totalPaid) : '—'} hint={o?.pendingSalaries ? `${o.pendingSalaries} pending` : 'Nothing pending'} />
        <Stat label="Advance outstanding" value={o ? fmt(o.advanceOutstanding) : '—'} tone={o?.advanceOutstanding ? 'warn' : undefined} />
        <Stat label={`Attendance, ${o?.month ?? ''}`} value={o ? `${(att.PRESENT ?? 0) + (att.HALF_DAY ?? 0) * 0.5} days` : '—'} hint={o ? `${(att.ABSENT ?? 0) + (att.UNPAID_LEAVE ?? 0)} absent · ${att.PAID_LEAVE ?? 0} paid leave` : undefined} />
      </div>
      <Tabs
        tabs={[
          { key: 'salaries', label: 'Salary & payments' },
          { key: 'attendance', label: 'Attendance & leave' },
          { key: 'advances', label: 'Advances' },
          { key: 'details', label: 'Details' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'salaries' ? (
        <ResourceView
          resource="salaries"
          filter={{ staffId: id }}
          defaults={{ month: todayIso().slice(0, 7), baseAmount: s.monthlySalary }}
          columns={['month', 'baseAmount', 'bonus', 'deductions', 'advanceRecovered', 'netAmount', 'status', 'paidDate']}
          hideSearch
          rowActions={(row) => (['PENDING', 'PARTIALLY_PAID'].includes(row.status) ? <RecordPaymentButton target={{ salaryId: row.id }} amount={Math.round((row.netAmount - (row.paidAmount ?? 0)) * 100) / 100} label="Mark paid" /> : null)}
        />
      ) : null}
      {tab === 'attendance' ? <ResourceView resource="attendance" filter={{ staffId: id }} defaults={{ date: todayIso(), status: 'PRESENT' }} hideSearch /> : null}
      {tab === 'advances' ? <ResourceView resource="staff-advances" filter={{ staffId: id }} defaults={{ date: todayIso() }} hideSearch /> : null}
      {tab === 'details' ? (
        <Card>
          <RecordFields resource="staff" row={s} exclude={['name']} />
        </Card>
      ) : null}
    </div>
  );
}

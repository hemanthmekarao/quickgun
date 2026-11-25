'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { useTab } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { ResourceView } from '@/components/resource';
import { PageHeader, Stat, Tabs } from '@/components/ui';
import { RecordPaymentButton } from '@/components/widgets';

export default function MaintenancePage() {
  const session = useSession();
  const [tab, setTab] = useTab('tasks', ['tasks', 'orders', 'vendors'] as const);
  const cost = useQuery({ queryKey: ['maintenance-cost', session.household?.id], queryFn: () => api.get('/reports/maintenance', { period: 'THIS_YEAR' }) });
  const c = cost.data;
  return (
    <div>
      <PageHeader title="Home maintenance" description="Tasks and work orders for electrical, plumbing, carpentry, painting, air-conditioning, pest control, cleaning, water tanks and repairs — with quotations, appointments, invoices, payments and ratings." />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open tasks" value={c ? c.openTasks : '—'} tone={c?.openTasks ? 'warn' : undefined} />
        <Stat label="Completed this year" value={c ? c.completedTasks : '—'} />
        <Stat label="Paid work orders" value={c ? c.paidWorkOrders : '—'} />
        <Stat label="Maintenance cost this year" value={c ? money(c.total, session.currency) : '—'} />
      </div>
      <Tabs
        tabs={[
          { key: 'tasks', label: 'Tasks' },
          { key: 'orders', label: 'Work orders' },
          { key: 'vendors', label: 'Service providers' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'tasks' ? <ResourceView resource="maintenance-tasks" columns={['title', 'category', 'priority', 'status', 'dueDate', 'propertyId']} emptyHint="Add a task for anything that needs fixing or servicing. Mark it recurring to have the next one created when you complete it." /> : null}
      {tab === 'orders' ? (
        <ResourceView
          resource="work-orders"
          rowActions={(row) => (['COMPLETED', 'IN_PROGRESS', 'SCHEDULED', 'APPROVED'].includes(row.status) && (row.invoiceAmount || row.quotationAmount) ? <RecordPaymentButton target={{ workOrderId: row.id }} label="Mark paid" /> : null)}
          emptyHint="Create a work order from a task to track the quotation, appointment, invoice and payment for a service provider."
        />
      ) : null}
      {tab === 'vendors' ? <ResourceView resource="vendors" emptyHint="Your directory of electricians, plumbers, carpenters and other service providers." /> : null}
    </div>
  );
}

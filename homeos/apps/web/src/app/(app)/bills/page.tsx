'use client';

import { useTab } from '@/lib/hooks';
import { daysUntil } from '@/lib/format';
import { ResourceView } from '@/components/resource';
import { Badge, LinkButton, PageHeader, Tabs } from '@/components/ui';
import { RecordPaymentButton } from '@/components/widgets';

const OPEN = ['UNPAID', 'SCHEDULED', 'PARTIALLY_PAID', 'DISPUTED'];

export default function BillsPage() {
  const [tab, setTab] = useTab('bills', ['bills', 'accounts'] as const);
  return (
    <div>
      <PageHeader
        title="Bills & utilities"
        description="One account per connection — electricity, water, gas, broadband, DTH and more — with the full history of bills, readings and payments."
        actions={<LinkButton href="/bills/upcoming">Upcoming & overdue</LinkButton>}
      />
      <Tabs
        tabs={[
          { key: 'bills', label: 'Bills' },
          { key: 'accounts', label: 'Utility accounts' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'bills' ? (
        <ResourceView
          resource="bills"
          columns={['providerId', 'dueDate', 'amount', 'status', 'paidDate', 'unitsConsumed']}
          rowActions={(row) => (
            <>
              {OPEN.includes(row.status) && (daysUntil(row.dueDate) ?? 0) < 0 ? <Badge tone="danger">Overdue</Badge> : null}
              {OPEN.includes(row.status) ? <RecordPaymentButton target={{ billId: row.id }} amount={Math.round((row.amount + (row.lateFee ?? 0) - (row.paidAmount ?? 0)) * 100) / 100} label="Mark paid" /> : null}
            </>
          )}
          emptyHint="Add a utility account first, then record each bill as it arrives — or upload the bill in Documents → Inbox to have the details read for you."
        />
      ) : (
        <ResourceView resource="bill-providers" emptyHint="Add an account for each utility connection, with its consumer number and billing cycle." />
      )}
    </div>
  );
}

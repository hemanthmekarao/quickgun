'use client';

import { useTab } from '@/lib/hooks';
import { ResourceView } from '@/components/resource';
import { PageHeader, Tabs } from '@/components/ui';

export default function ShoppingPage() {
  const [tab, setTab] = useTab('purchases', ['purchases', 'returns', 'warranties'] as const);
  return (
    <div>
      <PageHeader title="Shopping & purchases" description="Groceries, online orders, restaurants, electronics, furniture and household supplies — with returns, refunds and product warranties. Each purchase is added to your expenses." />
      <Tabs
        tabs={[
          { key: 'purchases', label: 'Purchases' },
          { key: 'returns', label: 'Returns & refunds' },
          { key: 'warranties', label: 'Product warranties' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'purchases' ? <ResourceView resource="purchases" /> : null}
      {tab === 'returns' ? (
        <ResourceView resource="purchases" filter={{ returnStatus: 'RETURN_REQUESTED,RETURNED,REFUND_PENDING,REFUNDED,REPLACED' }} canCreate={false} columns={['date', 'itemName', 'merchant', 'amount', 'returnStatus', 'refundAmount']} emptyHint="Purchases you mark as returned or refunded appear here." />
      ) : null}
      {tab === 'warranties' ? <ResourceView resource="warranties" columns={['itemName', 'warrantyType', 'provider', 'endDate', 'purchaseId']} /> : null}
    </div>
  );
}

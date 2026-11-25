'use client';

import { daysUntil } from '@/lib/format';
import { useTab } from '@/lib/hooks';
import { ResourceView } from '@/components/resource';
import { Badge, PageHeader, Tabs } from '@/components/ui';

export default function AppliancesPage() {
  const [tab, setTab] = useTab('appliances', ['appliances', 'warranties'] as const);
  return (
    <div>
      <PageHeader title="Appliances & equipment" description="An inventory of every appliance with its invoice, warranty, AMC, service history and condition." />
      <Tabs
        tabs={[
          { key: 'appliances', label: 'Appliances' },
          { key: 'warranties', label: 'Warranties & AMCs' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'appliances' ? (
        <ResourceView
          resource="appliances"
          href={(row) => `/appliances/${row.id}`}
          columns={['name', 'applianceType', 'manufacturer', 'propertyId', 'condition', 'warrantyEnd']}
          rowActions={(row) => {
            const d = daysUntil(row.extendedWarrantyEnd ?? row.warrantyEnd);
            if (d === null) return null;
            return <Badge tone={d < 0 ? 'neutral' : d <= 60 ? 'warn' : 'ok'}>{d < 0 ? 'Out of warranty' : d <= 60 ? `Warranty ends in ${d}d` : 'Under warranty'}</Badge>;
          }}
          emptyHint="Add an appliance with its purchase and warranty dates to be reminded before the warranty ends."
        />
      ) : (
        <ResourceView resource="warranties" emptyHint="Extra warranties, extended cover and AMC contracts." />
      )}
    </div>
  );
}

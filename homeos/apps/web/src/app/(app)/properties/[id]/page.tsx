'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { label, money } from '@/lib/format';
import { useTab } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { EditRecordButton, RecordFields, ResourceView, useRecord } from '@/components/resource';
import { Card, ErrorNote, Notice, PageHeader, Spinner, Stat, Tabs } from '@/components/ui';
import { BackLink, LinkedDocuments } from '@/components/widgets';

export default function PropertyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const fmt = (n: number | null | undefined) => money(n, session.currency);
  const [tab, setTab] = useTab('details', ['details', 'rooms', 'owners', 'utilities', 'maintenance', 'appliances', 'documents'] as const);
  const record = useRecord('properties', id);
  const year = new Date().getUTCFullYear();
  const spend = useQuery({
    queryKey: ['property-spend', session.household?.id, id, year],
    enabled: session.can('finance'),
    queryFn: () => api.get('/reports/spending', { from: `${year}-01-01`, to: new Date().toISOString().slice(0, 10) }),
  });

  if (record.isLoading) return <Spinner />;
  if (record.error) return <ErrorNote error={record.error} />;
  const p = record.data!;
  const spent = spend.data?.byProperty.find((x: any) => x.propertyId === id)?.amount;
  const equity = p.currentValue !== null && p.loanOutstanding !== null ? p.currentValue - p.loanOutstanding : null;

  return (
    <div>
      <BackLink href="/properties">Properties</BackLink>
      <PageHeader title={p.name} description={[label(p.propertyType), p.usage ? label(p.usage) : '', [p.addressLine1, p.city, p.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')} actions={<EditRecordButton resource="properties" row={p} />} />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Estimated value" value={fmt(p.currentValue)} hint={p.purchaseValue !== null ? `Bought for ${fmt(p.purchaseValue)}` : undefined} />
        <Stat label="Loan outstanding" value={fmt(p.loanOutstanding)} hint={equity !== null ? `Equity ${fmt(equity)}` : p.loanEmi ? `EMI ${fmt(p.loanEmi)}` : undefined} />
        <Stat label="Monthly rent" value={fmt(p.monthlyRent)} hint={p.tenantName ?? undefined} />
        <Stat label={`Spent on this property, ${year}`} value={spent !== undefined ? fmt(spent) : '—'} hint={session.can('finance') ? 'Expenses linked to this property' : 'Needs finance access'} />
      </div>
      <Tabs
        tabs={[
          { key: 'details', label: 'Details' },
          { key: 'rooms', label: 'Rooms' },
          { key: 'owners', label: 'Ownership' },
          { key: 'utilities', label: 'Utilities' },
          { key: 'maintenance', label: 'Maintenance' },
          { key: 'appliances', label: 'Appliances' },
          { key: 'documents', label: 'Documents' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'details' ? (
        <Card>
          <RecordFields resource="properties" row={p} exclude={['name']} />
        </Card>
      ) : null}
      {tab === 'rooms' ? <ResourceView resource="rooms" filter={{ propertyId: id }} hideSearch /> : null}
      {tab === 'owners' ? <ResourceView resource="property-ownerships" filter={{ propertyId: id }} hideSearch emptyHint="Record each owner and their share." /> : null}
      {tab === 'utilities' ? (
        session.can('bills') ? <ResourceView resource="bill-providers" filter={{ propertyId: id }} hideSearch emptyHint="Utility connections at this property." /> : <Notice>Your role does not include access to bills.</Notice>
      ) : null}
      {tab === 'maintenance' ? (
        session.can('maintenance') ? <ResourceView resource="maintenance-tasks" filter={{ propertyId: id }} columns={['title', 'category', 'priority', 'status', 'dueDate']} /> : <Notice>Your role does not include access to maintenance.</Notice>
      ) : null}
      {tab === 'appliances' ? (
        session.can('appliances') ? <ResourceView resource="appliances" filter={{ propertyId: id }} href={(row) => `/appliances/${row.id}`} /> : <Notice>Your role does not include access to appliances.</Notice>
      ) : null}
      {tab === 'documents' ? (
        <Card>
          <LinkedDocuments filter={{ propertyId: id }} />
        </Card>
      ) : null}
    </div>
  );
}

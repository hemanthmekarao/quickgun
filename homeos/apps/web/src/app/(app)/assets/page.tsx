'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { useTab } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { ResourceView } from '@/components/resource';
import { PageHeader, Stat, Tabs } from '@/components/ui';

export default function AssetsPage() {
  const session = useSession();
  const [tab, setTab] = useTab('assets', ['assets', 'valuations', 'categories'] as const);
  const assets = useQuery({ queryKey: ['assets-all', session.household?.id], queryFn: () => api.resource('assets').list({ status: 'OWNED', pageSize: 200 }) });
  const items = assets.data?.items ?? [];
  const value = items.reduce((s, a) => s + (a.currentValue ?? a.purchasePrice ?? 0), 0);
  const cost = items.reduce((s, a) => s + (a.purchasePrice ?? 0), 0);
  const uninsured = items.filter((a) => !a.insurancePolicyId).length;
  return (
    <div>
      <PageHeader title="Personal assets" description="Jewellery, watches, art, electronics, furniture and collectibles — ownership, valuations, invoices, photographs and insurance." />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Assets owned" value={items.length} />
        <Stat label="Current value" value={money(value, session.currency)} hint="Latest valuation, else purchase price" />
        <Stat label="Purchase cost" value={money(cost, session.currency)} />
        <Stat label="Not linked to insurance" value={uninsured} tone={uninsured ? 'warn' : undefined} />
      </div>
      <Tabs
        tabs={[
          { key: 'assets', label: 'Assets' },
          { key: 'valuations', label: 'Valuation history' },
          { key: 'categories', label: 'Categories' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'assets' ? <ResourceView resource="assets" emptyHint="Add each valuable with its purchase details. Upload the invoice and a photograph to the vault and link them here." /> : null}
      {tab === 'valuations' ? <ResourceView resource="asset-valuations" emptyHint="Adding a valuation updates the asset's current value." /> : null}
      {tab === 'categories' ? <ResourceView resource="asset-categories" /> : null}
    </div>
  );
}

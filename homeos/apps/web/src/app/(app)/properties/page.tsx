'use client';

import { ResourceView } from '@/components/resource';
import { PageHeader } from '@/components/ui';

export default function PropertiesPage() {
  return (
    <div>
      <PageHeader title="Properties" description="Every home you own or manage — ownership, value, registration, tax, society, parking, home loan and tenancy details." />
      <ResourceView resource="properties" href={(row) => `/properties/${row.id}`} columns={['name', 'propertyType', 'usage', 'city', 'currentValue']} emptyHint="Add your first property. You can add as many as you need." />
    </div>
  );
}

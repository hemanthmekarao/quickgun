'use client';

import { ResourceView } from '@/components/resource';
import { PageHeader } from '@/components/ui';

export default function VehiclesPage() {
  return (
    <div>
      <PageHeader title="Vehicles" description="Cars, motorcycles and scooters with registration, insurance, PUC, road tax, servicing, fuel and running costs." />
      <ResourceView resource="vehicles" href={(row) => `/vehicles/${row.id}`} columns={['name', 'vehicleType', 'make', 'model', 'registrationNumber', 'currentOdometer', 'nextServiceDate', 'insuranceExpiry']} emptyHint="Register a vehicle to track its servicing, fuel and compliance dates." />
    </div>
  );
}

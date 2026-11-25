'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { date, daysUntil, label, money, monthLabel, relativeDay, todayIso } from '@/lib/format';
import { useTab } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { BarChart } from '@/components/charts';
import { EditRecordButton, RecordFields, ResourceView, useRecord } from '@/components/resource';
import { Badge, Card, CardHeader, DefinitionList, ErrorNote, PageHeader, Spinner, Stat, Tabs } from '@/components/ui';
import { BackLink, LinkedDocuments } from '@/components/widgets';

function Due({ title, value }: { title: string; value: string | null }) {
  const d = daysUntil(value);
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="text-muted">{title}</span>
      {value ? (
        <span className="flex items-center gap-2">
          {date(value)}
          <Badge tone={d !== null && d < 0 ? 'danger' : d !== null && d <= 30 ? 'warn' : 'ok'}>{d !== null && d < 0 ? `Expired ${relativeDay(value)}` : relativeDay(value)}</Badge>
        </span>
      ) : (
        <span className="text-muted">Not recorded</span>
      )}
    </div>
  );
}

export default function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const fmt = (n: number | null | undefined) => money(n, session.currency);
  const [tab, setTab] = useTab('overview', ['overview', 'fuel', 'service', 'details', 'documents'] as const);
  const record = useRecord('vehicles', id);
  const report = useQuery({ queryKey: ['vehicle-report', session.household?.id, id], queryFn: () => api.get(`/reports/vehicles/${id}`) });

  if (record.isLoading) return <Spinner />;
  if (record.error) return <ErrorNote error={record.error} />;
  const v = record.data!;
  const r = report.data;

  return (
    <div>
      <BackLink href="/vehicles">Vehicles</BackLink>
      <PageHeader title={v.name} description={[v.make, v.model, v.variant, v.registrationNumber, v.fuelType ? label(v.fuelType) : ''].filter(Boolean).join(' · ')} actions={<EditRecordButton resource="vehicles" row={v} />} />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Odometer" value={v.currentOdometer !== null ? `${Number(v.currentOdometer).toLocaleString('en-IN')} km` : '—'} />
        <Stat label="Fuel efficiency" value={r?.fuel.averageKmPerUnit ? `${r.fuel.averageKmPerUnit} km/unit` : '—'} hint={r?.fuel.costPerKm ? `${fmt(r.fuel.costPerKm)} fuel cost per km` : 'Needs two full-tank entries'} />
        <Stat label="Running cost recorded" value={r ? fmt(r.ownership.runningCost) : '—'} hint="Fuel, servicing and road tax" />
        <Stat label="Total cost of ownership" value={r ? fmt(r.ownership.totalCost) : '—'} hint="Purchase price + running cost" />
      </div>
      <Tabs
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'fuel', label: 'Fuel log' },
          { key: 'service', label: 'Service & repairs' },
          { key: 'details', label: 'Details' },
          { key: 'documents', label: 'Documents' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'overview' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Due dates" />
            <div className="divide-y divide-line">
              <Due title="Next service" value={v.nextServiceDate} />
              <Due title="Insurance" value={v.insuranceExpiry} />
              <Due title="PUC certificate" value={v.pucExpiry} />
              <Due title="Registration / fitness" value={v.registrationExpiry} />
              <Due title="Road tax" value={v.roadTaxValidTill} />
            </div>
            {v.nextServiceOdometer ? <p className="mt-3 text-xs text-muted">Next service at {Number(v.nextServiceOdometer).toLocaleString('en-IN')} km{v.currentOdometer ? ` (${(v.nextServiceOdometer - v.currentOdometer).toLocaleString('en-IN')} km to go)` : ''}.</p> : null}
          </Card>
          <Card>
            <CardHeader title="Ownership cost" description="From the fuel and service records entered" />
            {r ? (
              <>
                <DefinitionList
                  items={[
                    { label: 'Purchase price', value: fmt(r.ownership.purchasePrice) },
                    { label: 'Fuel', value: `${fmt(r.fuel.totalCost)} · ${r.fuel.entries} fills` },
                    { label: 'Service & repairs', value: `${fmt(r.service.totalCost)} · ${r.service.entries} visits` },
                    { label: 'Road tax', value: fmt(r.ownership.roadTax) },
                    { label: 'Distance tracked', value: `${r.ownership.distanceTrackedKm.toLocaleString('en-IN')} km` },
                    { label: 'Running cost per km', value: r.ownership.runningCostPerKm !== null ? fmt(r.ownership.runningCostPerKm) : '—' },
                  ]}
                />
                <p className="mt-3 text-xs text-muted">Not included: {r.ownership.excludes.join(', ')}.</p>
              </>
            ) : (
              <Spinner />
            )}
          </Card>
          <Card>
            <CardHeader title="Monthly fuel spend" />
            <BarChart data={(r?.fuel.byMonth ?? []).slice(-12).map((m: any) => ({ label: monthLabel(m.month), value: m.amount }))} format={(n) => fmt(n)} />
          </Card>
          <Card>
            <CardHeader title="Fuel efficiency trend" description="Kilometres per unit of fuel, between full tanks" />
            <BarChart data={(r?.fuel.efficiencyTrend ?? []).slice(-12).map((m: any) => ({ label: date(m.date).slice(0, 6), value: m.kmPerUnit }))} format={(n) => `${n} km/unit`} />
          </Card>
        </div>
      ) : null}
      {tab === 'fuel' ? <ResourceView resource="fuel-logs" filter={{ vehicleId: id }} defaults={{ date: todayIso(), fuelType: v.fuelType ?? undefined, fullTank: true }} hideSearch emptyHint="Log each fill with the odometer reading to calculate mileage." /> : null}
      {tab === 'service' ? <ResourceView resource="vehicle-services" filter={{ vehicleId: id }} defaults={{ date: todayIso() }} emptyHint="Record services, oil changes, tyres, battery, brakes and repairs. A periodic service updates the next service date." /> : null}
      {tab === 'details' ? (
        <Card>
          <RecordFields resource="vehicles" row={v} exclude={['name']} />
        </Card>
      ) : null}
      {tab === 'documents' ? (
        <Card>
          <LinkedDocuments filter={{ vehicleId: id }} />
        </Card>
      ) : null}
    </div>
  );
}

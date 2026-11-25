'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { date, daysUntil, label, money, relativeDay } from '@/lib/format';
import { useTab } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { EditRecordButton, RecordFields, ResourceView, useRecord } from '@/components/resource';
import { Badge, Card, ErrorNote, Notice, PageHeader, Spinner, Stat, Tabs, statusTone } from '@/components/ui';
import { BackLink, LinkedDocuments } from '@/components/widgets';

export default function ApplianceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const fmt = (n: number | null | undefined) => money(n, session.currency);
  const [tab, setTab] = useTab('details', ['details', 'service', 'warranties', 'documents'] as const);
  const record = useRecord('appliances', id);
  const report = useQuery({ queryKey: ['appliance-report', session.household?.id, id], queryFn: () => api.get(`/reports/appliances/${id}`) });

  if (record.isLoading) return <Spinner />;
  if (record.error) return <ErrorNote error={record.error} />;
  const a = record.data!;
  const r = report.data;
  const warrantyEnd = a.extendedWarrantyEnd ?? a.warrantyEnd;
  const wd = daysUntil(warrantyEnd);
  const advice = r?.replacement;

  return (
    <div>
      <BackLink href="/appliances">Appliances</BackLink>
      <PageHeader title={a.name} description={[label(a.applianceType), a.manufacturer, a.model, a._refs?.propertyId?.label].filter(Boolean).join(' · ')} actions={<EditRecordButton resource="appliances" row={a} />} />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Warranty" value={warrantyEnd ? (wd !== null && wd < 0 ? 'Expired' : 'Active') : 'Not recorded'} tone={wd === null ? undefined : wd < 0 ? 'danger' : wd <= 60 ? 'warn' : 'ok'} hint={warrantyEnd ? `${date(warrantyEnd)} · ${relativeDay(warrantyEnd)}` : undefined} />
        <Stat label="AMC" value={a.amcEnd ? ((daysUntil(a.amcEnd) ?? 0) < 0 ? 'Expired' : 'Active') : 'None'} hint={a.amcEnd ? `${a.amcProvider ?? ''} until ${date(a.amcEnd)}`.trim() : undefined} />
        <Stat label="Next service" value={a.nextServiceDate ? date(a.nextServiceDate) : '—'} hint={a.nextServiceDate ? relativeDay(a.nextServiceDate) : undefined} />
        <Stat label="Repair spend" value={r ? fmt(r.repairCostTotal) : '—'} hint={a.purchasePrice !== null ? `Bought for ${fmt(a.purchasePrice)}` : undefined} />
      </div>
      {advice && advice.level !== 'OK' ? (
        <div className="mb-5">
          <Notice tone={advice.level === 'REPLACE_SOON' ? 'danger' : 'warn'} title={advice.level === 'REPLACE_SOON' ? 'Consider replacing this appliance' : 'Keep an eye on this appliance'}>
            <ul className="list-disc pl-5">
              {advice.reasons.map((x: string) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <p className="mt-1">This suggestion is based on the age, condition and repair costs you have recorded.</p>
          </Notice>
        </div>
      ) : null}
      <Tabs
        tabs={[
          { key: 'details', label: 'Details' },
          { key: 'service', label: 'Service & repair history' },
          { key: 'warranties', label: 'Warranties' },
          { key: 'documents', label: 'Documents' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'details' ? (
        <Card>
          <RecordFields resource="appliances" row={a} exclude={['name']} />
        </Card>
      ) : null}
      {tab === 'service' ? (
        session.can('maintenance') ? (
          <ResourceView
            resource="maintenance-tasks"
            filter={{ applianceId: id }}
            defaults={{ category: 'APPLIANCE', propertyId: a.propertyId ?? undefined }}
            columns={['title', 'status', 'dueDate', 'completedDate', 'actualCost', 'vendorId']}
            rowActions={(row) => <Badge tone={statusTone(row.priority)}>{label(row.priority)}</Badge>}
            emptyHint="Each service or repair is a maintenance task linked to this appliance."
          />
        ) : (
          <Notice>Your role does not include access to maintenance records.</Notice>
        )
      ) : null}
      {tab === 'warranties' ? <ResourceView resource="warranties" filter={{ applianceId: id }} defaults={{ itemName: a.name }} hideSearch /> : null}
      {tab === 'documents' ? (
        <Card>
          <LinkedDocuments filter={{ applianceId: id }} />
        </Card>
      ) : null}
    </div>
  );
}

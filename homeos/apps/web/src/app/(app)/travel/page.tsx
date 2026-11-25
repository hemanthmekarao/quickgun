'use client';

import { useTab } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { ResourceView } from '@/components/resource';
import { Notice, PageHeader, Tabs } from '@/components/ui';

export default function TravelPage() {
  const session = useSession();
  const [tab, setTab] = useTab('bookings', ['bookings', 'documents'] as const);
  return (
    <div>
      <PageHeader title="Travel" description="Flights, trains, hotels, holiday packages, visas and travel insurance, plus passport and visa expiry reminders. Booking amounts are added to your expenses." />
      <Tabs
        tabs={[
          { key: 'bookings', label: 'Bookings' },
          { key: 'documents', label: 'Passports & visas' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'bookings' ? <ResourceView resource="travel-bookings" emptyHint="Add each booking under a trip name to see the full cost of a trip." /> : null}
      {tab === 'documents' ? (
        session.can('identity') ? (
          <ResourceView resource="travel-documents" emptyHint="Record each passport and visa with its expiry date. Only the last four characters of the number are stored here; keep the scan in the document vault." />
        ) : (
          <Notice>Your role does not include access to identity documents.</Notice>
        )
      ) : null}
    </div>
  );
}

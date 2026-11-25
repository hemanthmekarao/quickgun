'use client';

import { dateTime } from '@/lib/format';
import { ResourceView } from '@/components/resource';
import { Notice, PageHeader } from '@/components/ui';

export default function SmartHomePage() {
  return (
    <div>
      <PageHeader title="Smart home" description="A registry of your cameras, locks, lights, sensors, alarms, energy monitors and controllers." />
      <div className="mb-5">
        <Notice title="No smart-home platform is connected">
          You can keep an inventory of devices here. Live status and control need an adapter for your platform (Home Assistant, Google Home, Alexa, HomeKit, Tuya or Matter); the API already has an endpoint for adapters to report device state, but no adapter is included yet.
        </Notice>
      </div>
      <ResourceView
        resource="smart-devices"
        rowActions={(row) => (row.lastSeenAt ? <span className="text-xs text-muted">Seen {dateTime(row.lastSeenAt)}</span> : null)}
        emptyHint="Add your devices with the room and platform they belong to."
      />
    </div>
  );
}

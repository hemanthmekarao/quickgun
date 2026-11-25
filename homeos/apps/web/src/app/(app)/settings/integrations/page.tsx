'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { SettingsNav } from '@/components/settings-nav';
import { Badge, Card, ErrorNote, Notice, PageHeader, Spinner } from '@/components/ui';

export default function IntegrationsPage() {
  const session = useSession();
  const status = useQuery({ queryKey: ['integrations', session.household?.id], queryFn: () => api.get<any[]>('/integrations/status') });
  return (
    <div>
      <PageHeader title="Integrations" description="Which outside services this HomeOS installation is connected to." />
      <SettingsNav />
      <div className="mb-5">
        <Notice title="Integrations are connected by whoever runs this installation">
          They are set through server configuration, not from this page, so that keys and credentials never pass through the browser. Anything marked “Not connected” below is simply unavailable — HomeOS does not pretend otherwise.
        </Notice>
      </div>
      {status.isLoading ? <Spinner /> : null}
      <ErrorNote error={status.error} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(status.data ?? []).map((i) => (
          <Card key={i.key}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold">{i.name}</p>
              <Badge tone={i.connected ? 'ok' : 'neutral'}>{i.connected ? 'Connected' : 'Not connected'}</Badge>
            </div>
            <p className="mt-2 text-sm text-muted">{i.detail}</p>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-sm text-muted">
        Developers: the full API is documented at <code className="rounded bg-subtle px-1">/docs</code> on the API server, with the OpenAPI file at <code className="rounded bg-subtle px-1">/openapi.json</code>.
      </p>
    </div>
  );
}

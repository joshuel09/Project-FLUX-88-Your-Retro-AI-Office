'use client';

import { useEffect, useState } from 'react';

import { api } from '../../../../lib/api';

interface Integration {
  id: string;
  provider: string;
  mode: 'read_only' | 'write_enabled';
  adapterMode: 'read_only' | 'unavailable';
  health: { status: 'mock' | 'unknown'; message: string; checkedAt: string; simulated: boolean };
  lastSyncAt: string | null;
  mock: boolean;
}

function timestamp(value: string) {
  return new Date(value).toLocaleString();
}

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get<{ items: Integration[] }>('/api/v1/integrations')
      .then(({ items }) => setIntegrations(items))
      .catch(() => setError(true));
  }, []);

  return (
    <section aria-labelledby="integrations-title">
      <h1 id="integrations-title" className="neon-glow text-2xl font-bold text-amber-warm">
        Integrations Health
      </h1>
      <p className="mb-6 mt-1 text-sm text-cyan-soft">
        Read-only mock adapters. Health checks use local fixtures and do not contact external services.
      </p>

      {error && <p role="alert" className="border border-magenta-neon p-3 text-sm text-magenta-soft">Could not load integrations.</p>}
      {!error && !integrations && <p role="status" className="text-sm text-amber-warm">Loading integrations…</p>}
      {integrations && integrations.length === 0 && (
        <p className="border border-dashed border-navy-700 p-4 text-sm text-cyan-soft/70">No connector accounts are configured.</p>
      )}
      {integrations && integrations.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {integrations.map((integration) => (
            <li key={integration.id} className="border border-navy-700 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-bold uppercase tracking-wider text-cyan-neon">{integration.provider}</h2>
                <span className={integration.health.status === 'mock' ? 'text-xs text-cyan-neon' : 'text-xs text-amber-warm'}>
                  {integration.health.status === 'mock' ? 'Mock ready' : 'Adapter unavailable'}
                </span>
              </div>
              <p className="mt-2 text-sm text-cyan-soft">{integration.health.message}</p>
              <dl className="mt-3 grid gap-y-1 text-xs text-cyan-soft/80 sm:grid-cols-2">
                <div><dt className="inline text-amber-warm">Account mode: </dt><dd className="inline">{integration.mode.replace('_', ' ')}</dd></div>
                <div><dt className="inline text-amber-warm">Adapter mode: </dt><dd className="inline">{integration.adapterMode.replace('_', ' ')}</dd></div>
                <div><dt className="inline text-amber-warm">Mock: </dt><dd className="inline">{integration.mock ? 'Yes' : 'No'}</dd></div>
                <div><dt className="inline text-amber-warm">Last check: </dt><dd className="inline"><time dateTime={integration.health.checkedAt}>{timestamp(integration.health.checkedAt)}</time></dd></div>
                <div><dt className="inline text-amber-warm">Last sync: </dt><dd className="inline">{integration.lastSyncAt ? <time dateTime={integration.lastSyncAt}>{timestamp(integration.lastSyncAt)}</time> : 'Never'}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

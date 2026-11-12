'use client';

import { useEffect, useState } from 'react';

import { api } from '../../../../lib/api';

interface AuditEvent {
  id: string;
  actorType: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface Notification {
  id: string;
  channel: string;
  taskId: string | null;
  approvalRequestId: string | null;
  body: string;
  dedupeKey: string;
  quietHoursDeferred: boolean;
  createdAt: string;
}

interface AuditPageData {
  audit: AuditEvent[];
  notifications: Notification[];
}

function timestamp(value: string) {
  return new Date(value).toLocaleString();
}

export default function AuditPage() {
  const [data, setData] = useState<AuditPageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<{ items: AuditEvent[] }>('/api/v1/audit?limit=100'),
      api.get<{ items: Notification[] }>('/api/v1/notifications?limit=100'),
    ])
      .then(([audit, notifications]) => setData({ audit: audit.items, notifications: notifications.items }))
      .catch(() => setError('Could not load the Clock Tower history.'));
  }, []);

  return (
    <section aria-labelledby="history-title" className="flex flex-col gap-6">
      <header>
        <h1 id="history-title" className="neon-glow text-2xl font-bold text-amber-warm">
          Notifications &amp; Audit History
        </h1>
        <p className="mt-1 text-sm text-cyan-soft">
          Stored AI Office records. A notification record does not confirm external delivery.
        </p>
      </header>

      {error && <p role="alert" className="border border-magenta-neon p-3 text-sm text-magenta-soft">{error}</p>}
      {!data && !error && <p role="status" className="text-sm text-amber-warm">Loading history…</p>}

      {data && (
        <>
          <section aria-labelledby="notifications-title">
            <h2 id="notifications-title" className="mb-3 text-sm uppercase tracking-widest text-amber-warm">
              Notifications ({data.notifications.length})
            </h2>
            {data.notifications.length === 0 ? (
              <p className="border border-dashed border-navy-700 p-4 text-sm text-cyan-soft/70">No stored notifications.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {data.notifications.map((notification) => (
                  <li key={notification.id} className="border border-navy-700 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="font-medium text-cyan-neon">{notification.body}</h3>
                      <time className="text-xs text-cyan-soft/70" dateTime={notification.createdAt}>{timestamp(notification.createdAt)}</time>
                    </div>
                    <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-cyan-soft sm:grid-cols-2">
                      <div><dt className="inline text-amber-warm">Channel: </dt><dd className="inline">{notification.channel}</dd></div>
                      <div><dt className="inline text-amber-warm">Dedupe key: </dt><dd className="inline break-all font-mono">{notification.dedupeKey}</dd></div>
                      {notification.taskId && <div><dt className="inline text-amber-warm">Task: </dt><dd className="inline font-mono">{notification.taskId}</dd></div>}
                      {notification.approvalRequestId && <div><dt className="inline text-amber-warm">Approval: </dt><dd className="inline font-mono">{notification.approvalRequestId}</dd></div>}
                      {notification.quietHoursDeferred && <div className="text-amber-warm">Deferred during quiet hours</div>}
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="audit-title">
            <h2 id="audit-title" className="mb-3 text-sm uppercase tracking-widest text-amber-warm">
              Audit events ({data.audit.length})
            </h2>
            {data.audit.length === 0 ? (
              <p className="border border-dashed border-navy-700 p-4 text-sm text-cyan-soft/70">No audit events.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {data.audit.map((event) => (
                  <li key={event.id} className="border border-navy-700 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="font-medium text-cyan-neon">{event.action}</h3>
                      <time className="text-xs text-cyan-soft/70" dateTime={event.createdAt}>{timestamp(event.createdAt)}</time>
                    </div>
                    <p className="mt-1 text-xs text-cyan-soft">
                      {event.actorType} <span className="font-mono">{event.actorId}</span>
                      <span className="px-2 text-amber-warm">→</span>
                      {event.targetType} <span className="font-mono">{event.targetId}</span>
                    </p>
                    {Object.keys(event.payload).length > 0 && (
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-cyan-soft/70">{JSON.stringify(event.payload, null, 2)}</pre>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </section>
  );
}

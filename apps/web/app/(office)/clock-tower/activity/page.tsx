'use client';

/**
 * Live activity feed (T029): SSE-driven view of task, agent and audit events
 * as they happen across the office.
 */
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '../../../../components/empty-states/empty-state';

interface FeedEntry {
  at: string;
  channel: string;
  data: Record<string, unknown>;
}

const CHANNELS = ['task', 'approval', 'audit', 'agent_status'] as const;

const CHANNEL_STYLES: Record<string, string> = {
  task: 'border-cyan-neon text-cyan-neon',
  approval: 'border-amber-deep text-amber-warm',
  audit: 'border-amber-deep text-amber-warm',
  agent_status: 'border-magenta-neon text-magenta-soft',
};

function describe(entry: FeedEntry): string {
  const { data } = entry;
  const parts: string[] = [];
  if (typeof data.taskId === 'string') parts.push(`task ${data.taskId.slice(0, 8)}`);
  if (typeof data.agentId === 'string') parts.push(String(data.agentId));
  if (typeof data.status === 'string') parts.push(`→ ${data.status}`);
  if (typeof data.kind === 'string') parts.push(`(${data.kind})`);
  if (typeof data.reason === 'string') parts.push(`— ${data.reason}`);
  return parts.join(' ') || JSON.stringify(data);
}

export default function ActivityPage() {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const source = new EventSource('/api/v1/events');
    sourceRef.current = source;
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    const listeners = CHANNELS.map((channel) => {
      const listener = (event: MessageEvent) => {
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(event.data as string) as Record<string, unknown>;
        } catch {
          // ignore malformed payloads
        }
        setEntries((prev) => [{ at: new Date().toISOString(), channel, data }, ...prev].slice(0, 100));
      };
      source.addEventListener(channel, listener);
      return { channel, listener };
    });
    return () => {
      for (const { channel, listener } of listeners) source.removeEventListener(channel, listener);
      source.close();
    };
  }, []);

  return (
    <section aria-labelledby="activity-title">
      <div className="flex items-center gap-3">
        <h1 id="activity-title" className="neon-glow text-2xl font-bold text-amber-warm">
          Activity Feed
        </h1>
        <span
          role="status"
          className={`border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
            connected ? 'border-cyan-neon text-cyan-neon' : 'border-amber-deep text-amber-warm'
          }`}
        >
          {connected ? 'live' : 'reconnecting…'}
        </span>
      </div>
      <p className="mb-6 mt-1 text-sm text-cyan-soft">
        Delegations, handoffs, status changes and escalations, as they happen.
      </p>

      {entries.length === 0 ? (
        <EmptyState title="Waiting for activity" description="Delegate a goal from the Task Board to see the office at work." />
      ) : (
        <ol className="flex flex-col gap-2" aria-label="Live events, newest first">
          {entries.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="flex items-baseline gap-2 text-sm">
              <time dateTime={entry.at} className="shrink-0 font-mono text-xs text-cyan-soft/60">
                {new Date(entry.at).toLocaleTimeString()}
              </time>
              <span
                className={`shrink-0 border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
                  CHANNEL_STYLES[entry.channel] ?? 'border-navy-700 text-cyan-soft'
                }`}
              >
                {entry.channel.replace('_', ' ')}
              </span>
              <span className="text-cyan-soft">{describe(entry)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

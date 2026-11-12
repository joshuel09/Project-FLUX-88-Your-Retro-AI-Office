import type { TimelineEntry } from '../../lib/types';
import { EmptyState } from '../empty-states/empty-state';

const KIND_STYLES: Record<TimelineEntry['kind'], string> = {
  handoff: 'border-magenta-neon text-magenta-soft',
  run: 'border-cyan-neon text-cyan-neon',
  audit: 'border-amber-deep text-amber-warm',
};

/** Delegation timeline (T029): handoffs, runs and audited transitions in order. */
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return <EmptyState title="No activity yet" description="Task updates and handoffs will appear here." />;
  }
  return (
    <ol className="flex flex-col gap-2" aria-label="Delegation timeline">
      {entries.map((entry, index) => (
        <li key={`${entry.at}-${index}`} className="flex items-baseline gap-2 text-sm">
          <time dateTime={entry.at} className="shrink-0 font-mono text-xs text-cyan-soft/60">
            {new Date(entry.at).toLocaleTimeString()}
          </time>
          <span
            className={`shrink-0 border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${KIND_STYLES[entry.kind]}`}
          >
            {entry.kind}
          </span>
          <span className="text-cyan-soft">
            {entry.summary}
            {typeof entry.detail.taskTitle === 'string' && entry.detail.taskTitle !== '' && (
              <span className="text-cyan-soft/60"> — {entry.detail.taskTitle}</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

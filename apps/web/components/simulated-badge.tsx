/**
 * Simulated-vs-real distinction, visual AND assistive (FR-053, CHK035).
 * Every feed/board/card that can show simulated activity uses this.
 */
export function SimulatedBadge({ simulated }: { simulated: boolean }) {
  if (!simulated) return null;
  return (
    <span
      className="border border-magenta-neon px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-magenta-soft"
      role="note"
      aria-label="Simulated activity, not real agent execution"
    >
      simulated
    </span>
  );
}

export function StatusBadge({ status }: { status: 'idle' | 'running' | 'blocked' }) {
  const styles = {
    idle: 'border-navy-700 text-cyan-soft',
    running: 'border-cyan-neon text-cyan-neon',
    blocked: 'border-amber-deep text-amber-warm',
  } as const;
  return (
    <span className={`border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${styles[status]}`}>
      {status}
    </span>
  );
}

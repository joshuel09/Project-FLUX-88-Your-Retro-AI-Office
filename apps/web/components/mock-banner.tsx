/** Simulated vs real must always be distinguishable (FR-053). */
export function MockBanner() {
  return (
    <p
      role="status"
      className="border border-magenta-neon px-3 py-1 text-sm text-magenta-soft"
    >
      MOCK MODE — simulated activity only
    </p>
  );
}

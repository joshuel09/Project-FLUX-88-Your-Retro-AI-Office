/** Shared, accessible empty state for dashboard lists and panels. */
export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div role="status" className="border border-dashed border-navy-700 p-4 text-sm">
      <p className="font-medium text-cyan-soft">{title}</p>
      <p className="mt-1 text-cyan-soft/70">{description}</p>
    </div>
  );
}

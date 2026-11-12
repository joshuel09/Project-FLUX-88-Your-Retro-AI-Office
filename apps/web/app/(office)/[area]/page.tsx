import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AgentDirectory } from '../../../components/agents/agent-directory';
import { OFFICE_AREAS_META } from '../../../lib/areas';

export function generateStaticParams() {
  // memory-vault has a dedicated static page (T037).
  return OFFICE_AREAS_META.filter((area) => area.slug !== 'memory-vault').map((area) => ({ area: area.slug }));
}

const ACCENT_CLASS = {
  cyan: 'text-cyan-neon',
  magenta: 'text-magenta-soft',
  amber: 'text-amber-warm',
} as const;

/** Nine themed office areas, each listing its stationed agents (T017, FR-050). */
export default async function OfficeAreaPage({ params }: { params: Promise<{ area: string }> }) {
  const { area } = await params;
  const meta = OFFICE_AREAS_META.find((a) => a.slug === area);
  if (!meta) notFound();

  return (
    <section aria-labelledby="area-title" className="flex flex-col gap-6">
      <header>
        <h1 id="area-title" className={`neon-glow text-2xl font-bold ${ACCENT_CLASS[meta.accent]}`}>
          {meta.name}
        </h1>
        <p className="mt-1 text-sm text-cyan-soft">{meta.purpose}</p>
      </header>

      {meta.slug === 'clock-tower' && (
        <nav aria-label="Clock Tower sections" className="flex flex-wrap gap-2">
          <Link
            href="/clock-tower/tasks"
            className="border border-amber-deep px-3 py-2 text-sm text-amber-warm hover:border-amber-warm"
          >
            Task Board →
          </Link>
          <Link
            href="/clock-tower/activity"
            className="border border-amber-deep px-3 py-2 text-sm text-amber-warm hover:border-amber-warm"
          >
            Activity Feed →
          </Link>
          <Link
            href="/clock-tower/agents"
            className="border border-amber-deep px-3 py-2 text-sm text-amber-warm hover:border-amber-warm"
          >
            Agent Directory →
          </Link>
          <Link
            href="/clock-tower/approvals"
            className="border border-amber-deep px-3 py-2 text-sm text-amber-warm hover:border-amber-warm"
          >
            Approval Inbox →
          </Link>
          <Link
            href="/clock-tower/audit"
            className="border border-amber-deep px-3 py-2 text-sm text-amber-warm hover:border-amber-warm"
          >
            Notifications &amp; Audit →
          </Link>
        </nav>
      )}

      {meta.slug === 'front-desk' && (
        <nav aria-label="Front Desk sections">
          <Link
            href="/front-desk/budgets"
            className="border border-amber-deep px-3 py-2 text-sm text-amber-warm hover:border-amber-warm"
          >
            Agent Budgets →
          </Link>
        </nav>
      )}

      <section aria-labelledby="area-agents">
        <h2 id="area-agents" className="mb-2 text-sm uppercase tracking-widest text-amber-warm">
          Stationed agents
        </h2>
        <AgentDirectory areaFilter={meta.slug} />
      </section>

      {meta.slug !== 'clock-tower' && (
        <p className="border border-dashed border-navy-700 p-4 text-sm text-cyan-soft/80">
          This area is a themed shell for the Phase 1 mock office.
        </p>
      )}
    </section>
  );
}

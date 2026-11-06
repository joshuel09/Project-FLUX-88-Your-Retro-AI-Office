import { notFound } from 'next/navigation';

import { OFFICE_AREAS_META } from '../../../lib/areas';

export function generateStaticParams() {
  return OFFICE_AREAS_META.map((area) => ({ area: area.slug }));
}

const ACCENT_CLASS = {
  cyan: 'text-cyan-neon',
  magenta: 'text-magenta-soft',
  amber: 'text-amber-warm',
} as const;

export default async function OfficeAreaPage({ params }: { params: Promise<{ area: string }> }) {
  const { area } = await params;
  const meta = OFFICE_AREAS_META.find((a) => a.slug === area);
  if (!meta) notFound();

  return (
    <section aria-labelledby="area-title">
      <h1 id="area-title" className={`neon-glow text-2xl font-bold ${ACCENT_CLASS[meta.accent]}`}>
        {meta.name}
      </h1>
      <p className="mt-1 text-sm text-cyan-soft">{meta.purpose}</p>
      <div className="mt-6 border border-dashed border-navy-700 p-6 text-sm text-amber-warm">
        This area comes online with the next slices (US5 agent directory, US1 task board, US3
        memory search, US2 approval inbox). Shell navigation is live.
      </div>
    </section>
  );
}

import Link from 'next/link';
import type { ReactNode } from 'react';

import { AuthGate } from '../../components/auth-gate';
import { MockBanner } from '../../components/mock-banner';
import { ReducedMotionToggle } from '../../components/reduced-motion-toggle';
import { OFFICE_AREAS_META } from '../../lib/areas';

export default function OfficeLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-4 px-4 py-4">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-navy-700 pb-3">
          <Link href="/clock-tower" className="neon-glow text-xl font-bold text-cyan-neon">
            FLUX-88
          </Link>
          <div className="flex items-center gap-3">
            <MockBanner />
            <ReducedMotionToggle />
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-6 md:flex-row">
          <nav aria-label="Office areas" className="md:w-56">
            <ul className="flex flex-wrap gap-2 md:flex-col">
              {OFFICE_AREAS_META.map((area) => (
                <li key={area.slug}>
                  <Link
                    href={`/${area.slug}`}
                    className="block border border-navy-700 px-3 py-2 text-sm text-cyan-soft hover:border-cyan-neon hover:text-cyan-neon"
                  >
                    {area.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <main className="flex-1">{children}</main>
        </div>
      </div>
    </AuthGate>
  );
}

'use client';

import { useEffect, useState } from 'react';

const KEY = 'flux88-reduced-motion';

/** Manual reduced-motion switch on top of prefers-reduced-motion (FR-052). */
export function ReducedMotionToggle() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch {
      /* storage unavailable — default applies */
    }
    const value = stored === 'true';
    setReduced(value);
    document.documentElement.dataset.reducedMotion = String(value);
  }, []);

  const toggle = () => {
    const next = !reduced;
    setReduced(next);
    document.documentElement.dataset.reducedMotion = String(next);
    try {
      localStorage.setItem(KEY, String(next));
    } catch {
      /* per-viewer convenience only */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={reduced}
      className="border border-navy-700 px-2 py-1 text-xs text-cyan-soft hover:border-cyan-neon"
    >
      {reduced ? 'Motion: off' : 'Motion: on'}
    </button>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { api } from '../lib/api';

/** Client-side owner-session gate for office pages (FR-072). */
export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api
      .get('/api/v1/auth/me')
      .then(() => setReady(true))
      .catch(() => router.replace('/login'));
  }, [router]);

  if (!ready) {
    return (
      <p className="p-8 text-sm text-amber-warm" role="status">
        Checking clearance…
      </p>
    );
  }
  return <>{children}</>;
}

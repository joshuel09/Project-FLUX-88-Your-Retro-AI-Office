'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { api, ApiRequestError } from '../../lib/api';
import { MockBanner } from '../../components/mock-banner';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/v1/auth/login', { email, password });
      router.replace('/clock-tower');
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        // Maybe first run: try one-time owner setup.
        try {
          await api.post('/api/v1/auth/setup', { email, password });
          router.replace('/clock-tower');
          return;
        } catch {
          setError('ID or password is incorrect');
        }
      } else {
        setError('Something went wrong — is the API running?');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="neon-glow text-3xl font-bold text-cyan-neon">FLUX-88</h1>
        <p className="mt-1 text-sm text-cyan-soft">
          18 Agents. One Command Center. You&apos;re in Control.
        </p>
      </div>
      <MockBanner />
      <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Owner sign in">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border border-navy-700 bg-navy-950 px-3 py-2 text-cyan-soft focus:border-cyan-neon focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password <span className="text-xs text-amber-warm">(12+ characters)</span>
          <input
            type="password"
            required
            minLength={12}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border border-navy-700 bg-navy-950 px-3 py-2 text-cyan-soft focus:border-cyan-neon focus:outline-none"
          />
        </label>
        {error && (
          <p role="alert" className="border border-magenta-neon px-3 py-2 text-sm text-magenta-soft">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="border border-cyan-neon px-3 py-2 font-bold text-cyan-neon hover:bg-navy-800 disabled:opacity-50"
        >
          {busy ? 'Engaging…' : 'Enter the office'}
        </button>
        <p className="text-xs text-cyan-soft/70">
          First run? The same form creates the owner account.
        </p>
      </form>
    </main>
  );
}

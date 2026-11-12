'use client';

/**
 * Memory Vault UI (T037): keyword/semantic search with attribution and
 * verification labels, entry detail with versions and conflicts, owner
 * knowledge entry and revocation (FR-020..FR-025).
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { api, ApiRequestError } from '../../lib/api';
import { EmptyState } from '../empty-states/empty-state';
import {
  MEMORY_CATEGORIES,
  type MemoryEntryDetail,
  type MemoryHit,
  type VerificationStatus,
} from '../../lib/types';

const STATUS_STYLES: Record<VerificationStatus, string> = {
  verified: 'border-cyan-neon text-cyan-neon',
  proposed: 'border-amber-deep text-amber-warm',
  untrusted: 'border-magenta-neon text-magenta-soft',
};

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  return (
    <span
      role="note"
      aria-label={`Verification status: ${status}`}
      className={`border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

export function MemoryVault() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'keyword' | 'semantic'>('keyword');
  const [hits, setHits] = useState<MemoryHit[] | null>(null);
  const [detail, setDetail] = useState<MemoryEntryDetail | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ category: 'shared', title: '', body: '' });

  const search = useCallback(
    async (q: string, m: 'keyword' | 'semantic') => {
      if (!q.trim()) {
        setHits(null);
        return;
      }
      try {
        const res = await api.get<{ items: MemoryHit[] }>(
          `/api/v1/memory/search?q=${encodeURIComponent(q)}&mode=${m}`,
        );
        setHits(res.items);
        setNotice(null);
      } catch (err) {
        setNotice(err instanceof ApiRequestError ? err.message : 'Search failed.');
      }
    },
    [],
  );

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    await search(query, mode);
  }

  async function openDetail(id: string) {
    try {
      setDetail(await api.get<MemoryEntryDetail>(`/api/v1/memory/${id}`));
    } catch {
      setNotice('Failed to load entry.');
    }
  }

  async function revoke(id: string) {
    try {
      await api.post(`/api/v1/memory/${id}/revoke`);
      setDetail(null);
      if (query.trim()) await search(query, mode);
      setNotice('Entry revoked — hidden from search, history preserved.');
    } catch (err) {
      setNotice(err instanceof ApiRequestError ? err.message : 'Revoke failed.');
    }
  }

  async function addKnowledge(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post('/api/v1/memory', {
        category: draft.category,
        title: draft.title.trim(),
        body: draft.body.trim(),
        verificationStatus: 'verified',
      });
      setDraft({ category: 'shared', title: '', body: '' });
      setShowAdd(false);
      setNotice('Knowledge saved (verified).');
      if (query.trim()) await search(query, mode);
    } catch (err) {
      setNotice(err instanceof ApiRequestError ? err.message : 'Save failed.');
    }
  }

  useEffect(() => {
    if (query.trim()) void search(query, mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-search on mode flip only
  }, [mode]);

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={onSearch} className="flex flex-col gap-2 border border-navy-700 p-4" aria-label="Search the Memory Vault">
        <label htmlFor="memory-query" className="text-sm uppercase tracking-widest text-amber-warm">
          Search the vault
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="memory-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. reduced motion, release-age rule…"
            className="min-w-0 flex-1 border border-navy-700 bg-navy-950 p-2 text-sm text-cyan-soft focus:border-cyan-neon focus:outline-none"
          />
          <button type="submit" className="border border-cyan-neon px-3 py-1 text-sm text-cyan-neon hover:bg-navy-800">
            Search
          </button>
        </div>
        <fieldset className="flex items-center gap-3">
          <legend className="sr-only">Search mode</legend>
          {(['keyword', 'semantic'] as const).map((m) => (
            <label key={m} className="flex items-center gap-1 text-xs uppercase tracking-wider text-cyan-soft">
              <input
                type="radio"
                name="mode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                className="accent-cyan-400"
              />
              {m}
            </label>
          ))}
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="ml-auto border border-amber-deep px-2 py-1 text-xs uppercase tracking-wider text-amber-warm hover:border-amber-warm"
          >
            {showAdd ? 'Close' : '+ Add knowledge'}
          </button>
        </fieldset>
      </form>

      {showAdd && (
        <form onSubmit={addKnowledge} className="flex flex-col gap-2 border border-amber-deep p-4" aria-label="Add knowledge">
          <div className="flex flex-wrap gap-2">
            <label htmlFor="mem-category" className="sr-only">
              Category
            </label>
            <select
              id="mem-category"
              value={draft.category}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
              className="border border-navy-700 bg-navy-950 p-2 text-sm text-cyan-soft focus:border-cyan-neon focus:outline-none"
            >
              {MEMORY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <label htmlFor="mem-title" className="sr-only">
              Title
            </label>
            <input
              id="mem-title"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="Title"
              maxLength={200}
              className="min-w-0 flex-1 border border-navy-700 bg-navy-950 p-2 text-sm text-cyan-soft focus:border-cyan-neon focus:outline-none"
            />
          </div>
          <label htmlFor="mem-body" className="sr-only">
            Body
          </label>
          <textarea
            id="mem-body"
            value={draft.body}
            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
            rows={3}
            maxLength={8000}
            placeholder="The lesson or fact to remember (secrets are rejected)"
            className="border border-navy-700 bg-navy-950 p-2 text-sm text-cyan-soft focus:border-cyan-neon focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.title.trim() || !draft.body.trim()}
            className="w-fit border border-cyan-neon px-3 py-1 text-sm text-cyan-neon hover:bg-navy-800 disabled:opacity-50"
          >
            Save as verified
          </button>
        </form>
      )}

      {notice && (
        <p role="status" className="border border-amber-deep p-2 text-sm text-amber-warm">
          {notice}
        </p>
      )}

      {hits !== null && (
        <section aria-labelledby="results-title">
          <h2 id="results-title" className="mb-2 text-sm uppercase tracking-widest text-amber-warm">
            Results ({hits.length}, {mode})
          </h2>
          {hits.length === 0 ? (
            <EmptyState title="No memories found" description="Try a different search or filter." />
          ) : (
            <ul className="flex flex-col gap-2">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    data-testid="memory-hit"
                    onClick={() => void openDetail(hit.id)}
                    className="w-full border border-navy-700 bg-navy-950 p-3 text-left hover:border-cyan-neon focus:border-cyan-neon focus:outline-none"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-cyan-neon">{hit.title}</span>
                      <VerificationBadge status={hit.verificationStatus} />
                      <span className="border border-navy-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-cyan-soft/70">
                        {hit.category}
                      </span>
                      {hit.conflictsWith.length > 0 && (
                        <span className="border border-magenta-neon px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-magenta-soft">
                          {hit.conflictsWith.length} conflict{hit.conflictsWith.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-sm text-cyan-soft">{hit.body.slice(0, 180)}</span>
                    <span className="mt-1 block text-xs text-cyan-soft/60">
                      by {hit.author} · {hit.sourceAttribution} · confidence {hit.confidence.toFixed(2)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {detail && (
        <aside
          role="dialog"
          aria-modal="false"
          aria-label="Memory entry detail"
          className="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col gap-4 overflow-y-auto border-l border-cyan-neon bg-navy-950 p-4 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-2">
            <h2 className="neon-glow text-lg font-bold text-cyan-neon">{detail.entry.title}</h2>
            <button
              type="button"
              onClick={() => setDetail(null)}
              aria-label="Close memory detail"
              className="border border-navy-700 px-2 py-1 text-sm text-cyan-soft hover:border-cyan-neon"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wider text-cyan-soft/70">
            <VerificationBadge status={detail.entry.verificationStatus} />
            <span className="border border-navy-700 px-1.5 py-0.5">{detail.entry.category}</span>
            <span className="border border-navy-700 px-1.5 py-0.5">by {detail.entry.author}</span>
            {detail.entry.revokedAt && (
              <span className="border border-magenta-neon px-1.5 py-0.5 text-magenta-soft">revoked</span>
            )}
          </div>
          <p className="text-sm text-cyan-soft">{detail.entry.body}</p>
          <p className="text-xs text-cyan-soft/60">Source: {detail.entry.sourceAttribution}</p>

          {!detail.entry.revokedAt && (
            <button
              type="button"
              onClick={() => void revoke(detail.entry.id)}
              className="w-fit border border-magenta-neon px-3 py-1 text-sm text-magenta-soft hover:bg-navy-800"
            >
              Revoke (hide from search, keep history)
            </button>
          )}

          {detail.conflicts.length > 0 && (
            <section aria-labelledby="conflicts-title" className="border border-magenta-neon p-3">
              <h3 id="conflicts-title" className="text-sm uppercase tracking-widest text-magenta-soft">
                Conflicting claims
              </h3>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-cyan-soft">
                {detail.conflicts.map((conflict) => (
                  <li key={conflict.id} className="flex items-center gap-2">
                    <VerificationBadge status={conflict.verificationStatus} />
                    <span>
                      {conflict.title} <span className="text-cyan-soft/60">(by {conflict.author})</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="versions-title" className="border border-navy-700 p-3">
            <h3 id="versions-title" className="text-sm uppercase tracking-widest text-amber-warm">
              Versions
            </h3>
            <ol className="mt-2 flex flex-col gap-2 text-sm text-cyan-soft">
              {detail.versions.map((version) => (
                <li key={version.id} className="border border-navy-700 p-2">
                  <p className="text-xs uppercase tracking-wider text-cyan-soft/70">
                    v{version.version} · {version.editedBy}
                    {version.changeNote && <span> — {version.changeNote}</span>}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{version.body}</p>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      )}
    </div>
  );
}

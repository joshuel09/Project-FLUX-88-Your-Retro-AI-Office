'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { api, ApiRequestError } from '../../lib/api';

type Approval = {
  id: string;
  requestingActorType: 'owner' | 'agent';
  requestingAgentId: string | null;
  taskId: string | null;
  actionType: string;
  actionPayload: unknown;
  targetResource: string;
  expectedImpact: string;
  risks: string;
  expiresAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  decisionReason: string;
  createdAt: string;
};

type Decision = 'approve' | 'reject';

function remainingLabel(expiresAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  if (seconds <= 0) return 'Expired';
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s remaining` : `${seconds}s remaining`;
}

export function ApprovalInbox() {
  const [items, setItems] = useState<Approval[]>([]);
  const [selected, setSelected] = useState<Approval | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await api.get<{ items: Approval[] }>('/api/v1/approvals?status=pending');
      setItems(result.items);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load approval requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(refresh);
  }, [load]);

  const openDetail = async (id: string) => {
    setError('');
    try {
      setSelected(await api.get<Approval>(`/api/v1/approvals/${id}`));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load request details.');
    }
  };

  const closeDecision = () => {
    setDecision(null);
    setPassword('');
    setReason('');
  };

  const submitDecision = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !decision || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/v1/approvals/${selected.id}/${decision}`, {
        password,
        ...(decision === 'reject' ? { reason: reason.trim() } : {}),
      });
      setNotice(decision === 'approve' ? 'Approval recorded.' : 'Rejection recorded.');
      setSelected(null);
      closeDecision();
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not record this decision.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Pending approvals" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-cyan-soft">Review each action and its target before deciding. Decisions require your password.</p>
        <button type="button" onClick={() => void load()} className="border border-navy-700 px-3 py-1.5 text-sm text-cyan-soft hover:border-cyan-neon">Refresh</button>
      </div>
      {notice && <p role="status" className="border border-cyan-neon p-2 text-sm text-cyan-neon">{notice}</p>}
      {error && <p role="alert" className="border border-magenta-neon p-2 text-sm text-magenta-soft">{error}</p>}
      {loading ? <p role="status" className="text-sm text-amber-warm">Loading approval requests…</p> : items.length === 0 ? (
        <p className="border border-dashed border-navy-700 p-5 text-sm text-cyan-soft">No pending approval requests.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id}>
              <article aria-label={`${item.actionType} approval request`} className="border border-amber-deep bg-navy-950 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-amber-warm">{item.actionType.replaceAll('_', ' ')}</h2>
                    <p className="mt-1 text-sm text-cyan-soft">{item.expectedImpact}</p>
                    <p className="mt-1 text-xs text-cyan-soft/70">Requested by {item.requestingAgentId ?? 'owner'} · Target: {item.targetResource}</p>
                  </div>
                  <time dateTime={item.expiresAt} className="text-sm text-amber-warm" aria-label={`Expires ${new Date(item.expiresAt).toLocaleString()}`}>
                    {remainingLabel(item.expiresAt, now)}
                  </time>
                </div>
                <button type="button" onClick={() => void openDetail(item.id)} className="mt-3 border border-cyan-neon px-3 py-1.5 text-sm text-cyan-neon hover:bg-navy-800">
                  Review {typeof item.actionPayload === 'object' && item.actionPayload && 'title' in item.actionPayload ? String(item.actionPayload.title) : 'request'}
                </button>
              </article>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div role="dialog" aria-modal="true" aria-labelledby="approval-detail-title" className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4">
          <section className="my-auto flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto border border-cyan-neon bg-navy-950 p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 id="approval-detail-title" className="text-lg font-bold text-cyan-neon">Approval request details</h2>
              <button type="button" aria-label="Close approval details" onClick={() => setSelected(null)} className="border border-navy-700 px-2 py-1 text-cyan-soft">Close</button>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs uppercase text-cyan-soft/60">Action</dt><dd className="text-amber-warm">{selected.actionType}</dd></div>
              <div><dt className="text-xs uppercase text-cyan-soft/60">Target</dt><dd className="break-words text-cyan-soft">{selected.targetResource}</dd></div>
              <div><dt className="text-xs uppercase text-cyan-soft/60">Requester</dt><dd className="text-cyan-soft">{selected.requestingAgentId ?? 'Owner'}</dd></div>
              <div><dt className="text-xs uppercase text-cyan-soft/60">Expires</dt><dd className="text-cyan-soft">{new Date(selected.expiresAt).toLocaleString()}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs uppercase text-cyan-soft/60">Expected impact</dt><dd className="text-cyan-soft">{selected.expectedImpact}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs uppercase text-cyan-soft/60">Risks</dt><dd className="text-cyan-soft">{selected.risks}</dd></div>
              {selected.taskId && <div className="sm:col-span-2"><dt className="text-xs uppercase text-cyan-soft/60">Task</dt><dd className="break-all text-cyan-soft">{selected.taskId}</dd></div>}
            </dl>
            <section aria-labelledby="payload-title" className="border border-navy-700 p-3">
              <h3 id="payload-title" className="mb-2 text-xs uppercase text-cyan-soft/60">Proposed action details</h3>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-cyan-soft">{JSON.stringify(selected.actionPayload, null, 2)}</pre>
            </section>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={selected.status !== 'pending' || new Date(selected.expiresAt).getTime() <= now} onClick={() => setDecision('approve')} className="border border-cyan-neon px-3 py-2 text-sm text-cyan-neon disabled:opacity-50">Approve</button>
              <button type="button" disabled={selected.status !== 'pending' || new Date(selected.expiresAt).getTime() <= now} onClick={() => setDecision('reject')} className="border border-magenta-neon px-3 py-2 text-sm text-magenta-soft disabled:opacity-50">Reject</button>
              {new Date(selected.expiresAt).getTime() <= now && <p role="status" className="w-full text-sm text-amber-warm">This request has expired and can no longer be decided.</p>}
            </div>
          </section>
        </div>
      )}

      {decision && selected && (
        <div role="dialog" aria-modal="true" aria-labelledby="decision-title" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
          <form onSubmit={(event) => void submitDecision(event)} className="flex w-full max-w-md flex-col gap-4 border border-amber-deep bg-navy-950 p-5">
            <h2 id="decision-title" className="text-lg font-bold text-amber-warm">{decision === 'approve' ? 'Confirm approval decision' : 'Confirm rejection'}</h2>
            <p className="text-sm text-cyan-soft">Re-enter your owner password to record this decision.</p>
            {decision === 'reject' && <label className="flex flex-col gap-1 text-sm text-cyan-soft">Rejection reason<textarea required maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-20 border border-navy-700 bg-navy-900 p-2" /></label>}
            <label className="flex flex-col gap-1 text-sm text-cyan-soft">Owner password<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="border border-navy-700 bg-navy-900 p-2" /></label>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={closeDecision} className="border border-navy-700 px-3 py-2 text-sm text-cyan-soft">Cancel</button>
              <button type="submit" disabled={busy || !password || (decision === 'reject' && !reason.trim())} className="border border-cyan-neon px-3 py-2 text-sm text-cyan-neon disabled:opacity-50">{busy ? 'Saving…' : decision === 'approve' ? 'Confirm approval' : 'Confirm rejection'}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

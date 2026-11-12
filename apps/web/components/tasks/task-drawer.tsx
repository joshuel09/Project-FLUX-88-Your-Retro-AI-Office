'use client';

/**
 * Task detail drawer (T028): subtasks, handoffs, artifacts, runs and costs,
 * plus owner controls — pause/resume/cancel and, for blocked tasks,
 * reassign / provide input (T030, FR-018).
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { api, ApiRequestError } from '../../lib/api';
import type { AgentSummary, TaskDeep, TimelineEntry } from '../../lib/types';
import { SimulatedBadge } from '../simulated-badge';
import { EmptyState } from '../empty-states/empty-state';
import { Timeline } from '../timeline/timeline';

export function TaskDrawer({
  taskId,
  onClose,
  onChanged,
}: {
  taskId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [deep, setDeep] = useState<TaskDeep | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [ownerInput, setOwnerInput] = useState('');
  const [reassignTo, setReassignTo] = useState('');

  const load = useCallback(async () => {
    try {
      const [d, t] = await Promise.all([
        api.get<TaskDeep>(`/api/v1/tasks/${taskId}`),
        api.get<{ items: TimelineEntry[] }>(`/api/v1/tasks/${taskId}/timeline`),
      ]);
      setDeep(d);
      setTimeline(t.items);
    } catch (err) {
      setNotice(err instanceof ApiRequestError ? err.message : 'Failed to load task.');
    }
  }, [taskId]);

  useEffect(() => {
    void load();
    api
      .get<{ items: AgentSummary[] }>('/api/v1/agents')
      .then((res) => setAgents(res.items))
      .catch(() => {});
  }, [load]);

  async function act(action: () => Promise<unknown>, successNote: string) {
    setNotice(null);
    try {
      await action();
      setNotice(successNote);
      await load();
      onChanged();
    } catch (err) {
      setNotice(err instanceof ApiRequestError ? err.message : 'Action failed.');
    }
  }

  async function submitInput(e: FormEvent) {
    e.preventDefault();
    if (!ownerInput.trim()) return;
    await act(() => api.post(`/api/v1/tasks/${taskId}/input`, { message: ownerInput.trim() }), 'Input sent.');
    setOwnerInput('');
  }

  const task = deep?.task;

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label="Task detail"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col gap-4 overflow-y-auto border-l border-cyan-neon bg-navy-950 p-4 shadow-2xl"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="neon-glow text-lg font-bold text-cyan-neon">{task?.title ?? 'Loading…'}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close task detail"
          className="border border-navy-700 px-2 py-1 text-sm text-cyan-soft hover:border-cyan-neon"
        >
          ✕
        </button>
      </div>

      {notice && (
        <p role="status" className="border border-amber-deep p-2 text-xs text-amber-warm">
          {notice}
        </p>
      )}

      {task && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wider text-cyan-soft/70">
            <span className="border border-navy-700 px-1.5 py-0.5">{task.status.replace('_', ' ')}</span>
            {task.assigneeAgentId && <span className="border border-navy-700 px-1.5 py-0.5">{task.assigneeAgentId}</span>}
            <span className="border border-navy-700 px-1.5 py-0.5">priority {task.priority}</span>
            <SimulatedBadge simulated={task.simulated} />
          </div>

          {task.description && <p className="text-sm text-cyan-soft">{task.description}</p>}

          {task.status === 'blocked' && (
            <section aria-labelledby="blocked-title" className="flex flex-col gap-3 border border-amber-deep p-3">
              <h3 id="blocked-title" className="text-sm uppercase tracking-widest text-amber-warm">
                Blocked: {task.blockedReason ?? 'no reason recorded'}
              </h3>
              <form onSubmit={submitInput} className="flex flex-col gap-2">
                <label htmlFor="owner-input" className="text-xs uppercase tracking-widest text-cyan-soft/70">
                  Provide input to unblock
                </label>
                <textarea
                  id="owner-input"
                  value={ownerInput}
                  onChange={(e) => setOwnerInput(e.target.value)}
                  rows={2}
                  maxLength={4000}
                  className="border border-navy-700 bg-navy-950 p-2 text-sm text-cyan-soft focus:border-cyan-neon focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!ownerInput.trim()}
                  className="w-fit border border-cyan-neon px-3 py-1 text-sm text-cyan-neon hover:bg-navy-800 disabled:opacity-50"
                >
                  Send input & resume
                </button>
              </form>
              <div className="flex items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor="reassign" className="text-xs uppercase tracking-widest text-cyan-soft/70">
                    Reassign to
                  </label>
                  <select
                    id="reassign"
                    value={reassignTo}
                    onChange={(e) => setReassignTo(e.target.value)}
                    className="border border-navy-700 bg-navy-950 p-2 text-sm text-cyan-soft focus:border-cyan-neon focus:outline-none"
                  >
                    <option value="">Select agent…</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.displayName}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  disabled={!reassignTo}
                  onClick={() =>
                    void act(
                      () => api.patch(`/api/v1/tasks/${taskId}`, { assigneeAgentId: reassignTo }),
                      'Reassigned.',
                    )
                  }
                  className="border border-magenta-neon px-3 py-2 text-sm text-magenta-soft hover:bg-navy-800 disabled:opacity-50"
                >
                  Reassign
                </button>
              </div>
            </section>
          )}

          <div className="flex flex-wrap gap-2">
            {(task.status === 'ready' || task.status === 'running') && (
              <button
                type="button"
                onClick={() => void act(() => api.post(`/api/v1/tasks/${taskId}/pause`), 'Paused.')}
                className="border border-amber-deep px-3 py-1 text-sm text-amber-warm hover:bg-navy-800"
              >
                Pause
              </button>
            )}
            {task.status === 'blocked' && (
              <button
                type="button"
                onClick={() => void act(() => api.post(`/api/v1/tasks/${taskId}/resume`), 'Resumed.')}
                className="border border-cyan-neon px-3 py-1 text-sm text-cyan-neon hover:bg-navy-800"
              >
                Resume
              </button>
            )}
            {!['completed', 'failed', 'canceled'].includes(task.status) && (
              <button
                type="button"
                onClick={() => void act(() => api.post(`/api/v1/tasks/${taskId}/cancel`), 'Canceled.')}
                className="border border-magenta-neon px-3 py-1 text-sm text-magenta-soft hover:bg-navy-800"
              >
                Cancel
              </button>
            )}
          </div>

          <section aria-labelledby="costs-title" className="border border-navy-700 p-3">
            <h3 id="costs-title" className="text-sm uppercase tracking-widest text-amber-warm">
              Costs (task + subtasks)
            </h3>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
              <div>
                <dt className="text-xs text-cyan-soft/70">Tokens</dt>
                <dd className="text-cyan-neon">{deep.totals.tokensUsed.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-xs text-cyan-soft/70">Cost</dt>
                <dd className="text-cyan-neon">¢{deep.totals.costCents}</dd>
              </div>
              <div>
                <dt className="text-xs text-cyan-soft/70">Exec time</dt>
                <dd className="text-cyan-neon">{(deep.totals.execMs / 1000).toFixed(1)}s</dd>
              </div>
            </dl>
          </section>

          {deep.subtasks.length > 0 && (
            <section aria-labelledby="subtasks-title" className="border border-navy-700 p-3">
              <h3 id="subtasks-title" className="text-sm uppercase tracking-widest text-amber-warm">
                Subtasks
              </h3>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-cyan-soft">
                {deep.subtasks.map((sub) => (
                  <li key={sub.id} className="flex items-center gap-2">
                    <span className="border border-navy-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                      {sub.status.replace('_', ' ')}
                    </span>
                    <span>{sub.title}</span>
                    {sub.assigneeAgentId && <span className="text-cyan-soft/60">→ {sub.assigneeAgentId}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {deep.subtasks.length === 0 && <EmptyState title="No subtasks" description="This task has no delegated subtasks." />}

          {deep.artifacts.length > 0 && (
            <section aria-labelledby="artifacts-title" className="border border-navy-700 p-3">
              <h3 id="artifacts-title" className="text-sm uppercase tracking-widest text-amber-warm">
                Artifacts
              </h3>
              <ul className="mt-2 flex flex-col gap-2 text-sm text-cyan-soft">
                {deep.artifacts.map((artifact) => (
                  <li key={artifact.id} className="border border-navy-700 p-2">
                    <p className="flex items-center gap-2 text-xs uppercase tracking-wider text-cyan-soft/70">
                      {artifact.title}
                      {artifact.agentId && <span>· {artifact.agentId}</span>}
                      <SimulatedBadge simulated={artifact.simulated} />
                    </p>
                    <p className="mt-1 whitespace-pre-wrap font-mono text-xs">{artifact.content}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {deep.artifacts.length === 0 && <EmptyState title="No artifacts" description="Completed work artifacts will appear here." />}

          <section aria-labelledby="timeline-title" className="border border-navy-700 p-3">
            <h3 id="timeline-title" className="mb-2 text-sm uppercase tracking-widest text-amber-warm">
              Timeline
            </h3>
            <Timeline entries={timeline} />
          </section>
        </>
      )}
    </aside>
  );
}

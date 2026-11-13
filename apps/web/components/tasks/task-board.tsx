'use client';

/**
 * Task board (T028) + blocked-task escalation controls (T030, FR-018).
 * Columns per status, no drag in Phase 1 — every move is an explicit,
 * audited action. SSE keeps the board live without polling.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { api, ApiRequestError } from '../../lib/api';
import {
  TASK_STATUS_ORDER,
  type TaskStatus,
  type TaskSummary,
} from '../../lib/types';
import { SimulatedBadge } from '../simulated-badge';
import { EmptyState } from '../empty-states/empty-state';
import { TaskDrawer } from './task-drawer';

const STATUS_ACCENT: Record<TaskStatus, string> = {
  backlog: 'border-navy-700 text-cyan-soft',
  ready: 'border-cyan-neon text-cyan-neon',
  running: 'border-cyan-neon text-cyan-neon',
  blocked: 'border-amber-deep text-amber-warm',
  review: 'border-magenta-neon text-magenta-soft',
  awaiting_approval: 'border-amber-deep text-amber-warm',
  completed: 'border-navy-700 text-cyan-soft/70',
  failed: 'border-magenta-neon text-magenta-soft',
  canceled: 'border-navy-700 text-cyan-soft/60',
};

export function TaskBoard() {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ items: TaskSummary[] }>('/api/v1/tasks');
      setTasks(res.items);
      setError(null);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to load tasks.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const source = new EventSource('/api/v1/events');
    const onTask = () => {
      // Debounce bursts of events into one refetch.
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void refresh(), 300);
    };
    source.addEventListener('task', onTask);
    return () => {
      source.close();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [refresh]);

  async function createTask(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    try {
      await api.post('/api/v1/tasks', { title: title.trim(), description: description.trim() || undefined });
      setTitle('');
      setDescription('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to create task.');
    } finally {
      setCreating(false);
    }
  }

  const topLevel = tasks.filter((t) => !t.parentTaskId);
  const subtaskCount = new Map<string, number>();
  for (const t of tasks) {
    if (t.parentTaskId) subtaskCount.set(t.parentTaskId, (subtaskCount.get(t.parentTaskId) ?? 0) + 1);
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={createTask} className="flex flex-col gap-2 border border-navy-700 p-4" aria-label="Delegate a goal">
        <label htmlFor="task-title" className="text-sm uppercase tracking-widest text-amber-warm">
          Delegate a goal to DOC
        </label>
        <input
          id="task-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Research retro fonts, design a logo, then write the announcement"
          maxLength={200}
          className="border border-navy-700 bg-navy-950 p-2 text-sm text-cyan-soft focus:border-cyan-neon focus:outline-none"
        />
        <label htmlFor="task-description" className="text-xs uppercase tracking-widest text-cyan-soft/70">
          Details (optional)
        </label>
        <textarea
          id="task-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={4000}
          className="border border-navy-700 bg-navy-950 p-2 text-sm text-cyan-soft focus:border-cyan-neon focus:outline-none"
        />
        <button
          type="submit"
          disabled={creating || !title.trim()}
          className="w-fit border border-cyan-neon px-3 py-1 text-sm text-cyan-neon hover:bg-navy-800 disabled:opacity-50"
        >
          {creating ? 'Delegating…' : 'Delegate'}
        </button>
      </form>

      {error && (
        <p role="alert" className="border border-magenta-neon p-2 text-sm text-magenta-soft">
          {error}
        </p>
      )}

      {loaded && !error && topLevel.length === 0 && (
        <EmptyState title="No tasks yet" description="Delegate a goal above to start work on the board." />
      )}

      <div className="flex gap-3 overflow-x-auto pb-2" role="list" aria-label="Task board columns">
        {TASK_STATUS_ORDER.map((status) => {
          const column = topLevel.filter((t) => t.status === status);
          return (
            <section
              key={status}
              role="listitem"
              aria-label={`${status} column`}
              className="w-56 shrink-0 border border-navy-700 p-2"
            >
              <h3 className={`mb-2 border-b border-navy-700 pb-1 text-xs uppercase tracking-widest ${STATUS_ACCENT[status]}`}>
                {status.replace('_', ' ')} <span aria-hidden="true">({column.length})</span>
              </h3>
              <ul className="flex flex-col gap-2">
                {column.map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      data-testid="task-card"
                      onClick={() => setSelectedId(task.id)}
                      className="w-full border border-navy-700 bg-navy-950 p-2 text-left text-sm text-cyan-soft hover:border-cyan-neon focus:border-cyan-neon focus:outline-none"
                    >
                      <span className="block">{task.title}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1 text-[10px] uppercase tracking-wider text-cyan-soft/60">
                        {task.assigneeAgentId && <span>{task.assigneeAgentId}</span>}
                        {(subtaskCount.get(task.id) ?? 0) > 0 && <span>{subtaskCount.get(task.id)} subtasks</span>}
                        <SimulatedBadge simulated={task.simulated} />
                      </span>
                      {task.status === 'blocked' && task.blockedReason && (
                        <span className="mt-1 block text-xs text-amber-warm">⚠ {task.blockedReason}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {selectedId && (
        <TaskDrawer
          taskId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => void refresh()}
        />
      )}
    </div>
  );
}

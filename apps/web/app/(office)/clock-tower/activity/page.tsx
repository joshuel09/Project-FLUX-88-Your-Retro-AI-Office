'use client';

/**
 * Live activity feed (T029): SSE-driven view of task, agent and audit events
 * as they happen across the office.
 */
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '../../../../components/empty-states/empty-state';
import { api } from '../../../../lib/api';

interface FeedEntry {
  at: string;
  channel: string;
  data: Record<string, unknown>;
}

interface FeedbackItem {
  id: string;
  authorLogin: string;
  bodyExcerpt: string;
  sourceUrl: string;
  state: 'pending' | 'linked';
  taskId: string | null;
  taskTitle: string | null;
  assigneeAgentId: string | null;
  provenance: 'untrusted';
  receivedAt: string;
}

interface TaskOption { id: string; title: string }

function isPullRequestUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    return url.origin === 'https://github.com' && /^\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/pull\/[1-9]\d*\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

const CHANNELS = ['task', 'approval', 'audit', 'agent_status'] as const;

const CHANNEL_STYLES: Record<string, string> = {
  task: 'border-cyan-neon text-cyan-neon',
  approval: 'border-amber-deep text-amber-warm',
  audit: 'border-amber-deep text-amber-warm',
  agent_status: 'border-magenta-neon text-magenta-soft',
};

function describe(entry: FeedEntry): string {
  const { data } = entry;
  const parts: string[] = [];
  if (typeof data.taskId === 'string') parts.push(`task ${data.taskId.slice(0, 8)}`);
  if (typeof data.agentId === 'string') parts.push(String(data.agentId));
  if (typeof data.status === 'string') parts.push(`→ ${data.status}`);
  if (typeof data.kind === 'string') parts.push(`(${data.kind})`);
  if (typeof data.reason === 'string') parts.push(`— ${data.reason}`);
  return parts.join(' ') || JSON.stringify(data);
}

export default function ActivityPage() {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [feedbackError, setFeedbackError] = useState('');
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  async function loadFeedback() {
    try {
      const [result, taskResult] = await Promise.all([
        api.get<{ items: FeedbackItem[] }>('/api/v1/feedback'),
        api.get<{ items: TaskOption[] }>('/api/v1/tasks?limit=200'),
      ]);
      setFeedback(result.items);
      setTasks(taskResult.items);
      setFeedbackError('');
    } catch {
      setFeedbackError('Feedback could not be loaded. Try refreshing the page.');
    }
  }

  async function linkFeedback(id: string, taskId: string) {
    setLinkingId(id);
    setFeedbackError('');
    try {
      await api.post(`/api/v1/feedback/${id}/link`, { taskId });
      await loadFeedback();
    } catch {
      setFeedbackError('Feedback could not be linked. It may already be linked to another task. Refresh and try again.');
    } finally {
      setLinkingId(null);
    }
  }

  useEffect(() => {
    void loadFeedback();
    const source = new EventSource('/api/v1/events');
    sourceRef.current = source;
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    const listeners = CHANNELS.map((channel) => {
      const listener = (event: MessageEvent) => {
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(event.data as string) as Record<string, unknown>;
        } catch {
          // ignore malformed payloads
        }
        setEntries((prev) => [{ at: new Date().toISOString(), channel, data }, ...prev].slice(0, 100));
        if ((channel === 'task' && ['github.feedback', 'github.feedback_linked'].includes(String(data.kind))) ||
            (channel === 'audit' && data.kind === 'github.feedback.unmatched')) void loadFeedback();
      };
      source.addEventListener(channel, listener);
      return { channel, listener };
    });
    return () => {
      for (const { channel, listener } of listeners) source.removeEventListener(channel, listener);
      source.close();
    };
  }, []);

  return (
    <section aria-labelledby="activity-title">
      <div className="flex items-center gap-3">
        <h1 id="activity-title" className="neon-glow text-2xl font-bold text-amber-warm">
          Activity Feed
        </h1>
        <span
          role="status"
          className={`border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
            connected ? 'border-cyan-neon text-cyan-neon' : 'border-amber-deep text-amber-warm'
          }`}
        >
          {connected ? 'live' : 'reconnecting…'}
        </span>
      </div>
      <p className="mb-6 mt-1 text-sm text-cyan-soft">
        Delegations, handoffs, status changes and escalations, as they happen.
      </p>

      <section aria-labelledby="github-feedback-title" className="mb-8 border border-navy-700 p-4">
        <h2 id="github-feedback-title" className="mb-3 text-lg font-bold text-amber-warm">GitHub review feedback</h2>
        {feedbackError && <p role="alert" className="mb-3 text-sm text-amber-warm">{feedbackError}</p>}
        {feedback.length === 0 ? <p className="text-sm text-cyan-soft">No linked or unmatched feedback.</p> : (
          <ul aria-label="GitHub review feedback" className="flex flex-col gap-4">
            {feedback.map((item) => (
              <li key={item.id} className="border-t border-navy-700 pt-3 text-sm">
                <p className="text-cyan-soft">
                  <span className="font-semibold">{item.authorLogin}</span> · {item.state === 'pending' ? 'Unmatched' : `Linked to ${item.taskTitle ?? 'task'}`}
                  {item.assigneeAgentId && ` · assignee at receipt: ${item.assigneeAgentId}`}
                </p>
                <p className="my-2 whitespace-pre-wrap text-cyan-soft/80">{item.bodyExcerpt}</p>
                <a className="text-cyan-neon underline" href={item.sourceUrl} target="_blank" rel="noreferrer">Open GitHub feedback</a>
                {item.state === 'pending' && isPullRequestUrl(item.sourceUrl) && (
                  <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => {
                    event.preventDefault();
                    const taskId = new FormData(event.currentTarget).get('taskId');
                    if (typeof taskId === 'string' && taskId) void linkFeedback(item.id, taskId);
                  }}>
                    <label className="flex flex-col gap-1 text-xs text-cyan-soft" htmlFor={`feedback-task-${item.id}`}>
                      Link to existing task
                      <select id={`feedback-task-${item.id}`} name="taskId" required defaultValue="" className="bg-navy-950 px-2 py-1 text-sm">
                        <option value="" disabled>Select a task</option>
                        {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                      </select>
                    </label>
                    <button type="submit" disabled={linkingId === item.id} className="border border-cyan-neon px-3 py-1 text-cyan-neon disabled:opacity-50">
                      {linkingId === item.id ? 'Linking…' : 'Link feedback'}
                    </button>
                  </form>
                )}
                {item.state === 'pending' && !isPullRequestUrl(item.sourceUrl) && (
                  <p className="mt-3 text-xs text-cyan-soft">Linking requires a GitHub pull request URL.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {entries.length === 0 ? (
        <EmptyState title="Waiting for activity" description="Delegate a goal from the Task Board to see the office at work." />
      ) : (
        <ol className="flex flex-col gap-2" aria-label="Live events, newest first">
          {entries.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="flex items-baseline gap-2 text-sm">
              <time dateTime={entry.at} className="shrink-0 font-mono text-xs text-cyan-soft/60">
                {new Date(entry.at).toLocaleTimeString()}
              </time>
              <span
                className={`shrink-0 border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
                  CHANNEL_STYLES[entry.channel] ?? 'border-navy-700 text-cyan-soft'
                }`}
              >
                {entry.channel.replace('_', ' ')}
              </span>
              <span className="text-cyan-soft">{describe(entry)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

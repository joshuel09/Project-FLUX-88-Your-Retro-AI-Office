/**
 * T031 — acceptance scenario 1 end-to-end in mock mode: owner delegates a
 * goal, DOC decomposes it to the correct specialists, runners execute within
 * budgets, the parent completes, and the timeline is complete — all in under
 * 30 seconds (SC-001). Requires the dockerized Postgres + Redis
 * (`pnpm db:up && pnpm db:migrate && pnpm db:seed`); CI provides both.
 */
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EVENTS_CHANNEL, QUEUE_AGENT_RUN, QUEUE_ORCHESTRATE } from '@flux88/core';
import { MAX_DELEGATION_DEPTH } from '@flux88/core/task-machine';
import {
  createTask,
  getTask,
  listRuns,
  listSubtasks,
  listTasks,
  taskTimeline,
  transitionTask,
  type Db,
} from '@flux88/db';
import { connectTestDb, truncateMutableTables } from '@flux88/db/testing';
import { MockProvider } from '@flux88/llm';
import { Queue } from 'bullmq';

import type { WorkerDeps } from '../deps.js';
import { createQueueBundle, type QueueBundle } from '../queues/index.js';
import { runAgentTask } from '../runner/index.js';
import { orchestrateTask } from './doc.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6388';

let db: Db;
let endClient: () => Promise<void>;
let bundle: QueueBundle;
let deps: WorkerDeps;
let subscriber: Redis;
const publishedEvents: Array<{ channel: string; data: Record<string, unknown> }> = [];

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number, label: string) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`timed out waiting for ${label}`);
}

beforeAll(async () => {
  const conn = connectTestDb();
  db = conn.db;
  endClient = () => conn.client.end();
  await truncateMutableTables(db);

  // Start from empty queues so a dev worker's leftovers can't interfere.
  const cleaner = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  for (const name of [QUEUE_ORCHESTRATE, QUEUE_AGENT_RUN]) {
    const q = new Queue(name, { connection: cleaner });
    await q.obliterate({ force: true }).catch(() => {});
    await q.close();
  }
  await cleaner.quit();

  subscriber = new Redis(REDIS_URL);
  await subscriber.subscribe(EVENTS_CHANNEL);
  subscriber.on('message', (_channel, message) => {
    publishedEvents.push(JSON.parse(message) as { channel: string; data: Record<string, unknown> });
  });

  bundle = createQueueBundle(REDIS_URL);
  deps = {
    db,
    provider: new MockProvider(),
    publish: bundle.publish,
    enqueueOrchestrate: bundle.enqueueOrchestrate,
    enqueueRun: bundle.enqueueRun,
  };
  bundle.startWorkers(deps, 3);
}, 30_000);

afterAll(async () => {
  await bundle?.close();
  await subscriber?.quit();
  await endClient?.();
});

describe('US1 — delegated task execution (scenario 1, mock mode)', () => {
  it(
    'decomposes an owner goal to the correct specialists and completes it end-to-end',
    async () => {
      const startedAt = Date.now();
      const goal = await createTask(db, {
        title: 'Research 80s competitor dashboards, implement the comparison view, and test it',
        creator: 'owner',
      });
      await transitionTask(db, goal.id, 'ready', { actorType: 'owner', actorId: 'session' });
      await deps.enqueueOrchestrate(goal.id);

      await waitFor(
        async () => (await getTask(db, goal.id))?.status === 'completed',
        25_000,
        'parent task completion',
      );
      expect(Date.now() - startedAt).toBeLessThan(30_000); // SC-001

      const subtasks = await listSubtasks(db, goal.id);
      // Same-transaction inserts share a created_at; compare as a set.
      expect(subtasks.map((t) => t.assigneeAgentId).sort()).toEqual(['egon', 'eleven', 'marty']);
      expect(subtasks.every((t) => t.status === 'completed')).toBe(true);
      expect(subtasks.every((t) => t.delegationDepth === 1)).toBe(true);

      // Timeline is complete: handoffs for every assignment, a run per subtask,
      // and the audited transitions (SC-002).
      const timeline = await taskTimeline(db, goal.id);
      expect(timeline.filter((e) => e.kind === 'handoff')).toHaveLength(3);
      expect(timeline.filter((e) => e.kind === 'run')).toHaveLength(3);
      expect(timeline.some((e) => e.summary.includes('orchestrator.decomposed'))).toBe(true);

      // Cost awareness: usage accounted on the parent + subtasks.
      const parent = await getTask(db, goal.id);
      expect(parent?.tokensUsed ?? 0).toBeGreaterThan(0);
      const totalSubtaskTokens = subtasks.reduce((n, t) => n + t.tokensUsed, 0);
      expect(totalSubtaskTokens).toBeGreaterThan(0);

      // Worker -> API event bridge: events crossed Redis pub/sub.
      expect(publishedEvents.some((e) => e.channel === 'task' && e.data.status === 'completed')).toBe(true);
    },
    30_000,
  );

  it(
    'pause then resume re-dispatches through the real queue (finished jobs do not block the id)',
    async () => {
      const task = await createTask(db, {
        title: 'Implement the pause-resume probe',
        creator: 'owner',
        assigneeAgentId: 'marty',
        status: 'ready',
      });
      // Pause before the queue delivers: the runner must no-op without
      // consuming the idempotency key or leaving a stale completed job.
      await transitionTask(db, task.id, 'blocked', {
        actorType: 'owner',
        actorId: 'session',
        reason: 'paused_by_owner',
      });
      await deps.enqueueRun(task.id, 0);
      await new Promise((resolve) => setTimeout(resolve, 1_000)); // job drains as a no-op

      await transitionTask(db, task.id, 'ready', { actorType: 'owner', actorId: 'session' });
      await deps.enqueueRun(task.id, 0); // same deterministic job id as before
      await waitFor(
        async () => (await getTask(db, task.id))?.status === 'completed',
        20_000,
        'resumed task completion through the queue',
      );
      const runs = await listRuns(db, task.id);
      expect(runs.filter((r) => r.status === 'succeeded')).toHaveLength(1);
    },
    30_000,
  );

  it('re-delivery of a finished run is a no-op (Postgres idempotency gate)', async () => {
    const completedGoals = await listTasks(db, { status: 'completed' });
    const parent = completedGoals.find(
      (t) => t.creator === 'owner' && !t.parentTaskId && t.title.startsWith('Research 80s'),
    );
    expect(parent).toBeDefined();
    if (!parent) return;
    const [subtask] = await listSubtasks(db, parent.id);
    expect(subtask).toBeDefined();
    if (!subtask) return;

    const before = await listRuns(db, subtask.id);
    expect(before.length).toBeGreaterThan(0);
    await runAgentTask(deps, subtask.id); // simulate duplicate queue delivery
    const after = await listRuns(db, subtask.id);
    expect(after).toHaveLength(before.length);
  });

  it('refuses and escalates when the delegation depth limit is exceeded (FR-015)', async () => {
    const deep = await createTask(db, {
      title: 'Implement a sub-sub-sub task',
      creator: 'doc',
      delegationDepth: MAX_DELEGATION_DEPTH,
      status: 'ready',
    });
    await orchestrateTask(deps, deep.id);
    const after = await getTask(db, deep.id);
    expect(after?.status).toBe('blocked');
    expect(after?.blockedReason).toContain('depth');
  });

  it(
    'enforces per-run budgets: over-budget runs fail, retry, then escalate to the owner (FR-018)',
    async () => {
      const goal = await createTask(db, {
        title: 'Implement the overdrive module [mock:over-budget]',
        creator: 'owner',
      });
      await transitionTask(db, goal.id, 'ready', { actorType: 'owner', actorId: 'session' });
      await deps.enqueueOrchestrate(goal.id);

      await waitFor(
        async () => (await getTask(db, goal.id))?.status === 'blocked',
        25_000,
        'parent escalation after budget failures',
      );

      const parent = await getTask(db, goal.id);
      expect(parent?.blockedReason).toContain('subtask failed');

      const [subtask] = await listSubtasks(db, goal.id);
      expect(subtask?.status).toBe('failed');
      expect(subtask?.blockedReason).toBe('budget_exceeded');
      if (!subtask) return;

      // One run per attempt (initial + retries), every one failed on budget.
      const runs = await listRuns(db, subtask.id);
      expect(runs.length).toBe(subtask.retryCount + 1);
      expect(runs.every((r) => r.status === 'failed' && r.error === 'budget_exceeded')).toBe(true);

      // Owner resumes the escalated parent: it closes cleanly as failed
      // instead of hanging in running (resume path, T030).
      await transitionTask(db, goal.id, 'ready', { actorType: 'owner', actorId: 'session' });
      await orchestrateTask(deps, goal.id);
      const closed = await getTask(db, goal.id);
      expect(closed?.status).toBe('failed');
      expect(closed?.blockedReason).toBe('subtask failures');
    },
    30_000,
  );

  it('refuses circular delegation back into the chain (FR-015)', async () => {
    // A task already held by marty whose decomposition would route to marty again.
    const circular = await createTask(db, {
      title: 'Implement the flux capacitor module',
      creator: 'doc',
      assigneeAgentId: 'marty',
      delegationDepth: 1,
      status: 'ready',
    });
    await orchestrateTask(deps, circular.id);
    const after = await getTask(db, circular.id);
    expect(after?.status).toBe('blocked');
    expect(after?.blockedReason).toContain('circular');
  });
});

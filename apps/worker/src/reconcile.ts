/**
 * Startup reconciliation (T025, scenario 2): Postgres is the system of record,
 * Redis never is. On boot the worker fails runs interrupted by the crash,
 * resets in-flight subtasks, and re-enqueues every piece of non-terminal work
 * with deterministic job ids so nothing is lost or duplicated.
 */
import {
  failInterruptedRuns,
  getTask,
  incrementTaskRetry,
  listSubtasks,
  listTasks,
  transitionTask,
} from '@flux88/db';

import type { WorkerDeps } from './deps.js';
import { afterSubtaskSettled } from './runner/index.js';

export async function reconcile(deps: WorkerDeps): Promise<{ resumed: number }> {
  let resumed = 0;

  const interrupted = await failInterruptedRuns(deps.db);
  for (const run of interrupted) {
    const task = await getTask(deps.db, run.taskId);
    if (!task || task.status !== 'running') continue;
    // running -> ready isn't a legal direct move; go through blocked with an
    // audit trail that says why (constitution IV).
    await transitionTask(deps.db, task.id, 'blocked', {
      actorType: 'system',
      actorId: 'worker',
      reason: 'interrupted_by_restart',
    });
    const ready = await transitionTask(deps.db, task.id, 'ready', { actorType: 'system', actorId: 'worker' });
    if (ready.ok) {
      // The interrupted run consumed its idempotency key; count it as a
      // retry so the re-dispatch claims a fresh one.
      const attempt = await incrementTaskRetry(deps.db, task.id);
      await deps.enqueueRun(task.id, attempt);
      resumed += 1;
    }
  }

  // Ready work that never got picked up (enqueue lost with Redis state).
  for (const task of await listTasks(deps.db, { status: 'ready' })) {
    if (task.assigneeAgentId) {
      await deps.enqueueRun(task.id, task.retryCount);
    } else {
      await deps.enqueueOrchestrate(task.id);
    }
    resumed += 1;
  }

  // Running parents: decomposition may be missing (crashed mid-orchestration),
  // or children may all be settled with the promotion/completion signal lost.
  for (const task of await listTasks(deps.db, { status: 'running' })) {
    if (task.assigneeAgentId) continue; // handled via interrupted runs above
    const children = await listSubtasks(deps.db, task.id);
    if (children.length === 0) {
      await deps.enqueueOrchestrate(task.id);
      resumed += 1;
    } else {
      await afterSubtaskSettled(deps, task.id);
    }
  }

  return { resumed };
}

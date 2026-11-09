/**
 * Agent runner (T027): executes one subtask with the assigned agent's config
 * and the LLM provider, enforcing per-run token/runtime/retry budgets
 * (constitution VIII) and recording agent_runs. Postgres idempotency keys make
 * duplicate queue deliveries no-ops (scenario 9).
 */
import { toPolicyConfig, type AgentConfig } from '@flux88/agents';

import {
  addTaskUsage,
  createArtifact,
  finishRun,
  getAgent,
  getTask,
  incrementTaskRetry,
  insertRunIfAbsent,
  listSubtasks,
  transitionTask,
  unmetDependencyIds,
  writeAudit,
  type TaskRow,
} from '@flux88/db';
import type { CompletionResult } from '@flux88/llm';

import type { WorkerDeps } from '../deps.js';
import { stageProposedAction } from './proposals.js';

class RunFailure extends Error {
  constructor(public readonly code: 'budget_exceeded' | 'runtime_exceeded' | 'provider_error' | 'proposal_rejected') {
    super(code);
  }
}

async function completeWithinBudget(
  deps: WorkerDeps,
  task: TaskRow,
  agentId: string,
  budgets: { maxTokensPerRun: number; maxRuntimeMs: number },
): Promise<CompletionResult> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RunFailure('runtime_exceeded')), budgets.maxRuntimeMs);
  });
  try {
    const result = await Promise.race([
      deps.provider.complete({
        agentId,
        prompt: `${task.title}${task.description ? `\n${task.description}` : ''}`,
        maxTokens: budgets.maxTokensPerRun,
      }),
      timeout,
    ]);
    if (result.usage.inputTokens + result.usage.outputTokens > budgets.maxTokensPerRun) {
      throw new RunFailure('budget_exceeded');
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

/** Escalate a terminally failed subtask to the owner by blocking the parent (FR-018). */
async function escalateToParent(deps: WorkerDeps, task: TaskRow, reason: string) {
  if (!task.parentTaskId) return;
  const result = await transitionTask(deps.db, task.parentTaskId, 'blocked', {
    actorType: 'agent',
    actorId: 'doc',
    reason,
  });
  if (result.ok) {
    await deps.publish({
      channel: 'task',
      data: { taskId: task.parentTaskId, status: 'blocked', reason },
    });
  }
}

/** Promote dependents whose dependencies are now all met; finish the parent when done. */
export async function afterSubtaskSettled(deps: WorkerDeps, parentTaskId: string): Promise<void> {
  const parent = await getTask(deps.db, parentTaskId);
  if (!parent || parent.status !== 'running') return;

  const siblings = await listSubtasks(deps.db, parentTaskId);
  for (const sibling of siblings) {
    if (sibling.status !== 'backlog') continue;
    const unmet = await unmetDependencyIds(deps.db, sibling.id);
    if (unmet.length > 0) continue;
    const moved = await transitionTask(deps.db, sibling.id, 'ready', { actorType: 'system', actorId: 'worker' });
    if (moved.ok) {
      await deps.publish({ channel: 'task', data: { taskId: sibling.id, status: 'ready' } });
      await deps.enqueueRun(sibling.id, moved.task.retryCount);
    }
  }

  const fresh = await listSubtasks(deps.db, parentTaskId);
  if (fresh.length === 0) return;

  if (fresh.every((t) => t.status === 'completed')) {
    const review = await transitionTask(deps.db, parentTaskId, 'review', { actorType: 'agent', actorId: 'doc' });
    if (!review.ok) return;
    // Mock mode auto-review; a real QA (EGON) review pass arrives in later phases.
    await transitionTask(deps.db, parentTaskId, 'completed', {
      actorType: 'system',
      actorId: 'worker',
      reason: 'mock auto-review',
    });
    await deps.publish({ channel: 'task', data: { taskId: parentTaskId, status: 'completed' } });
    return;
  }

  // Resumed-after-failure closure: when every child is terminal but some
  // failed/canceled, the parent fails cleanly instead of hanging in running,
  // and children stranded in backlog behind a failed dependency are canceled.
  const TERMINAL = new Set(['completed', 'failed', 'canceled']);
  const canceledIds = new Set<string>();
  for (const t of fresh) {
    if (t.status !== 'backlog') continue;
    const unmet = await unmetDependencyIds(deps.db, t.id);
    const blockers = await Promise.all(unmet.map((depId) => getTask(deps.db, depId)));
    if (blockers.some((b) => b && (b.status === 'failed' || b.status === 'canceled'))) {
      const canceled = await transitionTask(deps.db, t.id, 'canceled', {
        actorType: 'system',
        actorId: 'worker',
        reason: 'dependency failed',
      });
      if (canceled.ok) canceledIds.add(t.id);
    }
  }
  const remaining = fresh.filter((t) => !TERMINAL.has(t.status) && !canceledIds.has(t.id));
  if (remaining.length === 0 && fresh.some((t) => t.status === 'failed' || t.status === 'canceled' || canceledIds.has(t.id))) {
    const failed = await transitionTask(deps.db, parentTaskId, 'failed', {
      actorType: 'system',
      actorId: 'worker',
      reason: 'subtask failures',
    });
    if (failed.ok) {
      await deps.publish({ channel: 'task', data: { taskId: parentTaskId, status: 'failed' } });
    }
  }
}

export async function runAgentTask(deps: WorkerDeps, taskId: string): Promise<void> {
  const task = await getTask(deps.db, taskId);
  // Status gate makes pause/cancel race-safe: only 'ready' work may start.
  if (!task || task.status !== 'ready' || !task.assigneeAgentId) return;
  const agentId = task.assigneeAgentId;

  // Win the status transition FIRST (its WHERE-status guard makes duplicate
  // deliveries lose here without consuming an idempotency key), then claim
  // the run in Postgres (unique index on idempotency_key).
  const moved = await transitionTask(deps.db, taskId, 'running', { actorType: 'agent', actorId: agentId });
  if (!moved.ok) return; // duplicate delivery or paused/canceled meanwhile

  let attempt = moved.task.retryCount;
  let run = await insertRunIfAbsent(deps.db, {
    taskId,
    agentId,
    idempotencyKey: `${taskId}:${attempt}`,
    simulated: task.simulated,
  });
  if (!run) {
    // A leftover row (e.g. failed before a reconcile bump) holds this key:
    // take the next attempt number instead of silently stalling the task.
    attempt = await incrementTaskRetry(deps.db, taskId);
    run = await insertRunIfAbsent(deps.db, {
      taskId,
      agentId,
      idempotencyKey: `${taskId}:${attempt}`,
      simulated: task.simulated,
    });
  }
  if (!run) {
    await transitionTask(deps.db, taskId, 'blocked', {
      actorType: 'system',
      actorId: 'worker',
      reason: 'run claim conflict',
    });
    return;
  }
  await deps.publish({ channel: 'task', data: { taskId, status: 'running', agentId } });

  const agent = await getAgent(deps.db, agentId);
  if (!agent) {
    await finishRun(deps.db, run.id, { status: 'failed', error: 'agent_missing' });
    return;
  }
  const budgets = toPolicyConfig(agent.config as AgentConfig).budgets;

  const started = Date.now();
  try {
    const result = await completeWithinBudget(deps, task, agentId, budgets);
    const durationMs = Date.now() - started;

    if (result.proposedAction !== undefined) {
      const staged = await stageProposedAction(deps.db, { taskId, runId: run.id, agentId, durationMs }, result);
      if (!staged) throw new RunFailure('proposal_rejected');
      // Redis is best-effort transport; the committed wait/inbox survives it.
      await deps.publish({ channel: 'task', data: { taskId, status: 'awaiting_approval', agentId } }).catch(() => {});
      return;
    }

    await createArtifact(deps.db, {
      taskId,
      agentId,
      kind: 'text',
      title: `Result: ${task.title}`.slice(0, 200),
      content: result.content,
      simulated: task.simulated,
    });
    await finishRun(deps.db, run.id, {
      status: 'succeeded',
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costCents: result.usage.costCents,
      durationMs,
    });
    await addTaskUsage(deps.db, taskId, {
      tokens: result.usage.inputTokens + result.usage.outputTokens,
      costCents: result.usage.costCents,
      execMs: durationMs,
    });

    await transitionTask(deps.db, taskId, 'review', { actorType: 'agent', actorId: agentId });
    // Mock mode auto-review (constitution V: acceptance tests run fully mocked).
    await transitionTask(deps.db, taskId, 'completed', {
      actorType: 'system',
      actorId: 'worker',
      reason: 'mock auto-review',
    });
    await deps.publish({ channel: 'task', data: { taskId, status: 'completed', agentId } });

    if (task.parentTaskId) await afterSubtaskSettled(deps, task.parentTaskId);
  } catch (error) {
    const durationMs = Date.now() - started;
    const code = error instanceof RunFailure ? error.code : 'provider_error';
    await finishRun(deps.db, run.id, { status: 'failed', error: code, durationMs });
    await writeAudit(deps.db, {
      actorType: 'agent',
      actorId: agentId,
      action: 'run.failed',
      targetType: 'task',
      targetId: taskId,
      payload: { code, attempt },
    });

    if (code === 'proposal_rejected') {
      const current = await getTask(deps.db, taskId);
      if (!current || current.status !== 'running' || current.assigneeAgentId !== agentId) return;
    }
    const retryBudget = code === 'proposal_rejected' ? 0 : Math.min(task.retryLimit, budgets.maxRetries);
    if (attempt < retryBudget) {
      const nextAttempt = await incrementTaskRetry(deps.db, taskId);
      await transitionTask(deps.db, taskId, 'blocked', {
        actorType: 'system',
        actorId: 'worker',
        reason: `retry ${nextAttempt}/${retryBudget} after ${code}`,
      });
      await transitionTask(deps.db, taskId, 'ready', { actorType: 'system', actorId: 'worker' });
      await deps.publish({ channel: 'task', data: { taskId, status: 'ready', retry: nextAttempt } });
      await deps.enqueueRun(taskId, nextAttempt);
      return;
    }

    await transitionTask(deps.db, taskId, 'failed', { actorType: 'system', actorId: 'worker', reason: code });
    await deps.publish({ channel: 'task', data: { taskId, status: 'failed', agentId, reason: code } });
    await escalateToParent(deps, task, `subtask failed: ${task.title} (${code})`);
  }
}

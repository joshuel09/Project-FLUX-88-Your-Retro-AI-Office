/**
 * DOC orchestrator (T026): decomposes an owner goal into dependency-ordered
 * subtasks, assigns specialists allowed by DOC's own policy, records handoffs,
 * and refuses + escalates loops (FR-015) instead of executing them.
 */
import { z } from 'zod';

import { toPolicyConfig, type AgentConfig } from '@flux88/agents';
import { AGENT_IDS, type AgentId } from '@flux88/core';
import {
  addTaskUsage,
  createDecomposition,
  getAgent,
  getTask,
  listSubtasks,
  transitionTask,
  writeAudit,
  type SubtaskSpec,
  type TaskRow,
} from '@flux88/db';
import { DECOMPOSE_PREFIX } from '@flux88/llm';

import type { WorkerDeps } from '../deps.js';
import { afterSubtaskSettled } from '../runner/index.js';
import { detectDelegationLoop, exceedsDepthLimit, hasCycle } from './loop-guards.js';

const planSchema = z.object({
  subtasks: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        assignee: z.enum(AGENT_IDS),
        dependsOn: z.array(z.number().int().min(0)),
      }),
    )
    .min(1)
    .max(12),
});

/** Walk up the parent chain collecting the agents already holding this work. */
async function delegationChain(deps: WorkerDeps, task: TaskRow): Promise<string[]> {
  const chain: string[] = [];
  let current: TaskRow | null = task;
  let hops = 0;
  while (current && hops < 10) {
    if (current.assigneeAgentId) chain.push(current.assigneeAgentId);
    if (current.creator !== 'owner') chain.push(current.creator);
    current = current.parentTaskId ? await getTask(deps.db, current.parentTaskId) : null;
    hops += 1;
  }
  return chain;
}

/** Refuse the decomposition: block the task, audit the escalation, notify. */
async function refuse(deps: WorkerDeps, task: TaskRow, reason: string) {
  await transitionTask(deps.db, task.id, 'blocked', { actorType: 'agent', actorId: 'doc', reason });
  await writeAudit(deps.db, {
    actorType: 'agent',
    actorId: 'doc',
    action: 'orchestrator.loop_refused',
    targetType: 'task',
    targetId: task.id,
    payload: { reason },
  });
  await deps.publish({ channel: 'task', data: { taskId: task.id, status: 'blocked', reason } });
}

export async function orchestrateTask(deps: WorkerDeps, taskId: string): Promise<void> {
  const task = await getTask(deps.db, taskId);
  if (!task) return;

  // Idempotent re-delivery: if a decomposition already exists, never repeat it.
  // A resumed parent (owner unblocked it) goes back to running and re-checks
  // its children instead of re-decomposing.
  const existing = await listSubtasks(deps.db, taskId);
  if (existing.length > 0) {
    if (task.status === 'ready') {
      const moved = await transitionTask(deps.db, taskId, 'running', { actorType: 'agent', actorId: 'doc' });
      if (moved.ok) await afterSubtaskSettled(deps, taskId);
    }
    return;
  }

  if (task.status === 'blocked' || task.status === 'canceled' || task.status === 'completed') return;

  if (exceedsDepthLimit(task.delegationDepth)) {
    await refuse(deps, task, 'delegation depth limit reached (FR-015)');
    return;
  }

  if (task.status === 'ready') {
    const moved = await transitionTask(deps.db, taskId, 'running', { actorType: 'agent', actorId: 'doc' });
    if (!moved.ok) return; // paused/canceled in the meantime — leave it alone
  } else if (task.status !== 'running') {
    return;
  }

  const docAgent = await getAgent(deps.db, 'doc');
  if (!docAgent) throw new Error('DOC agent missing from registry');
  const policy = toPolicyConfig(docAgent.config as AgentConfig);
  const allowedTargets = new Set<AgentId>(policy.handoffTargets);

  const completion = await deps.provider.complete({
    agentId: 'doc',
    prompt: `${DECOMPOSE_PREFIX} ${task.title}${task.description ? ` — ${task.description}` : ''}`,
    maxTokens: policy.budgets.maxTokensPerRun,
  });
  await addTaskUsage(deps.db, taskId, {
    tokens: completion.usage.inputTokens + completion.usage.outputTokens,
    costCents: completion.usage.costCents,
    execMs: 0,
  });

  let plan: z.infer<typeof planSchema>;
  try {
    plan = planSchema.parse(JSON.parse(completion.content));
  } catch {
    await refuse(deps, task, 'decomposition produced an invalid plan');
    return;
  }

  // Policy gate: DOC may only hand off to agents in its own handoffTargets.
  const disallowed = plan.subtasks.find((s) => !allowedTargets.has(s.assignee));
  if (disallowed) {
    await refuse(deps, task, `assignment to '${disallowed.assignee}' is outside DOC's handoff targets`);
    return;
  }

  // Loop guards: circular delegation and dependency cycles are refused + escalated.
  const chain = await delegationChain(deps, task);
  const circular = plan.subtasks.find((s) => detectDelegationLoop(chain, s.assignee));
  if (circular) {
    await refuse(deps, task, `circular delegation refused: '${circular.assignee}' already holds this work`);
    return;
  }
  const edges: Array<readonly [number, number]> = plan.subtasks.flatMap((s, i) =>
    s.dependsOn.map((d) => [i, d] as const),
  );
  if (hasCycle(edges, plan.subtasks.length)) {
    await refuse(deps, task, 'dependency cycle refused in decomposition plan');
    return;
  }

  const specs: SubtaskSpec[] = plan.subtasks;
  const created = await createDecomposition(deps.db, task, specs, {
    fromAgentId: 'doc',
    reason: 'DOC delegation',
  });

  await deps.publish({
    channel: 'task',
    data: {
      taskId: task.id,
      status: 'running',
      kind: 'decomposed',
      subtasks: created.map((t) => ({ id: t.id, title: t.title, assignee: t.assigneeAgentId })),
    },
  });

  for (const subtask of created) {
    if (subtask.status === 'ready') {
      await deps.enqueueRun(subtask.id, subtask.retryCount);
    }
  }
}

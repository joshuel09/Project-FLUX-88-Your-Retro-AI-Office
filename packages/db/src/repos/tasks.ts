import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import type { AgentId, TaskStatus } from '@flux88/core';
import {
  planTransition,
  type TransitionContext,
  type TransitionRejection,
} from '@flux88/core/task-machine';
import type { Db } from '../client.js';
import {
  agentRuns,
  artifacts,
  auditEvents,
  handoffs,
  taskDependencies,
  tasks,
} from '../schema/index.js';

export type TaskRow = typeof tasks.$inferSelect;
export type AgentRunRow = typeof agentRuns.$inferSelect;

export async function listTasks(db: Db, opts: { status?: TaskStatus; limit?: number } = {}) {
  return db
    .select()
    .from(tasks)
    .where(opts.status ? eq(tasks.status, opts.status) : undefined)
    .orderBy(desc(tasks.createdAt))
    .limit(opts.limit ?? 200);
}

export async function getTask(db: Db, id: string): Promise<TaskRow | null> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
  return row ?? null;
}

export async function createTask(
  db: Db,
  values: {
    title: string;
    description?: string | undefined;
    creator: string;
    priority?: number | undefined;
    simulated?: boolean | undefined;
    assigneeAgentId?: AgentId | undefined;
    parentTaskId?: string | undefined;
    delegationDepth?: number | undefined;
    retryLimit?: number | undefined;
    status?: TaskStatus | undefined;
  },
) {
  const [row] = await db.insert(tasks).values(values).returning();
  if (!row) throw new Error('task insert returned no row');
  return row;
}

/**
 * Guarded, audited transition (FR-011, constitution IV). Status + audit are
 * written atomically; the WHERE clause re-checks the from-status so two racing
 * workers cannot double-apply the same move.
 */
export async function transitionTask(
  db: Db,
  id: string,
  to: TaskStatus,
  ctx: TransitionContext,
): Promise<{ ok: true; task: TaskRow } | TransitionRejection | { ok: false; code: 'not_found' | 'conflict'; message: string }> {
  const current = await getTask(db, id);
  if (!current) return { ok: false, code: 'not_found', message: 'task not found' };

  const plan = planTransition(current, to, ctx);
  if (!plan.ok) return plan;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(tasks)
      .set({ status: plan.patch.status, blockedReason: plan.patch.blockedReason, updatedAt: new Date() })
      .where(and(eq(tasks.id, id), eq(tasks.status, plan.from)))
      .returning();
    if (!row) {
      return { ok: false as const, code: 'conflict' as const, message: 'task changed concurrently' };
    }
    await tx.insert(auditEvents).values({
      actorType: plan.audit.actorType,
      actorId: plan.audit.actorId,
      action: plan.audit.action,
      targetType: 'task',
      targetId: id,
      payload: plan.audit.payload,
    });
    return { ok: true as const, task: row };
  });
}

/** Owner edits (PATCH /tasks/:id): priority, deadline, reassignment. */
export async function updateTaskFields(
  db: Db,
  id: string,
  patch: { priority?: number | undefined; deadline?: Date | null | undefined; assigneeAgentId?: AgentId | undefined },
) {
  const [row] = await db
    .update(tasks)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning();
  return row ?? null;
}

export async function listSubtasks(db: Db, parentTaskId: string) {
  return db.select().from(tasks).where(eq(tasks.parentTaskId, parentTaskId)).orderBy(asc(tasks.createdAt));
}

export interface SubtaskSpec {
  title: string;
  assignee: AgentId;
  /** Indices into the spec array this subtask depends on. */
  dependsOn: number[];
}

/**
 * Create a decomposition atomically (T026): subtasks, dependency edges, and
 * one handoff record per assignment. Subtasks with unmet dependencies start in
 * `backlog`; roots start `ready`.
 */
export async function createDecomposition(
  db: Db,
  parent: TaskRow,
  specs: SubtaskSpec[],
  opts: { fromAgentId: AgentId; reason: string },
) {
  return db.transaction(async (tx) => {
    const created: TaskRow[] = [];
    for (const spec of specs) {
      const [row] = await tx
        .insert(tasks)
        .values({
          title: spec.title,
          description: `Subtask of: ${parent.title}`,
          creator: opts.fromAgentId,
          assigneeAgentId: spec.assignee,
          parentTaskId: parent.id,
          priority: parent.priority,
          delegationDepth: parent.delegationDepth + 1,
          simulated: parent.simulated,
          status: spec.dependsOn.length === 0 ? 'ready' : 'backlog',
        })
        .returning();
      if (!row) throw new Error('subtask insert returned no row');
      created.push(row);
    }
    for (const [i, spec] of specs.entries()) {
      const child = created[i];
      if (!child) continue;
      for (const depIndex of spec.dependsOn) {
        const dep = created[depIndex];
        if (!dep) throw new Error(`dependency index ${depIndex} out of range`);
        await tx.insert(taskDependencies).values({ taskId: child.id, dependsOnTaskId: dep.id });
      }
      await tx.insert(handoffs).values({
        taskId: child.id,
        fromAgentId: opts.fromAgentId,
        toAgentId: spec.assignee,
        reason: opts.reason,
      });
    }
    await tx.insert(auditEvents).values({
      actorType: 'agent',
      actorId: opts.fromAgentId,
      action: 'orchestrator.decomposed',
      targetType: 'task',
      targetId: parent.id,
      payload: { subtasks: created.map((t) => ({ id: t.id, assignee: t.assigneeAgentId })) },
    });
    return created;
  });
}

export async function createHandoff(
  db: Db,
  values: { taskId: string; fromAgentId?: AgentId; toAgentId: AgentId; reason: string; payloadRef?: string },
) {
  const [row] = await db.insert(handoffs).values(values).returning();
  return row;
}

export async function listHandoffs(db: Db, taskId: string) {
  return db.select().from(handoffs).where(eq(handoffs.taskId, taskId)).orderBy(asc(handoffs.createdAt));
}

/**
 * Idempotency gate (T025/T027): Postgres is the system of record, not BullMQ.
 * Returns the inserted run, or null when the key already exists (duplicate
 * delivery — caller must no-op).
 */
export async function insertRunIfAbsent(
  db: Db,
  values: { taskId: string; agentId: AgentId; idempotencyKey: string; simulated?: boolean },
): Promise<AgentRunRow | null> {
  const [row] = await db
    .insert(agentRuns)
    .values({ ...values, status: 'running' })
    .onConflictDoNothing({ target: agentRuns.idempotencyKey })
    .returning();
  return row ?? null;
}

export async function finishRun(
  db: Db,
  id: string,
  patch: {
    status: 'succeeded' | 'failed' | 'halted_budget';
    inputTokens?: number;
    outputTokens?: number;
    costCents?: number;
    durationMs?: number;
    error?: string;
  },
) {
  const [row] = await db.update(agentRuns).set(patch).where(eq(agentRuns.id, id)).returning();
  return row ?? null;
}

export async function listRuns(db: Db, taskId: string) {
  return db.select().from(agentRuns).where(eq(agentRuns.taskId, taskId)).orderBy(asc(agentRuns.createdAt));
}

/** Startup reconciliation (T025): runs left 'running' by a crash are failed. */
export async function failInterruptedRuns(db: Db) {
  return db
    .update(agentRuns)
    .set({ status: 'failed', error: 'interrupted_by_restart' })
    .where(eq(agentRuns.status, 'running'))
    .returning({ id: agentRuns.id, taskId: agentRuns.taskId });
}

export async function createArtifact(
  db: Db,
  values: { taskId: string; agentId?: AgentId; kind: string; title: string; content: string; simulated?: boolean },
) {
  const [row] = await db.insert(artifacts).values(values).returning();
  return row;
}

export async function listArtifacts(db: Db, taskId: string) {
  return db.select().from(artifacts).where(eq(artifacts.taskId, taskId)).orderBy(asc(artifacts.createdAt));
}

/** Accumulate usage onto the task row (constitution VIII: cost awareness). */
export async function addTaskUsage(
  db: Db,
  id: string,
  usage: { tokens: number; costCents: number; execMs: number },
) {
  await db
    .update(tasks)
    .set({
      tokensUsed: sql`${tasks.tokensUsed} + ${usage.tokens}`,
      costCents: sql`${tasks.costCents} + ${usage.costCents}`,
      execMs: sql`${tasks.execMs} + ${usage.execMs}`,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, id));
}

/** Bump the retry counter before re-queueing a failed run (T027). */
export async function incrementTaskRetry(db: Db, id: string): Promise<number> {
  const [row] = await db
    .update(tasks)
    .set({ retryCount: sql`${tasks.retryCount} + 1`, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning({ retryCount: tasks.retryCount });
  return row?.retryCount ?? 0;
}

/** Dependency ids a task is still waiting on (anything not completed). */
export async function unmetDependencyIds(db: Db, taskId: string): Promise<string[]> {
  const deps = await db
    .select({ dependsOnTaskId: taskDependencies.dependsOnTaskId, status: tasks.status })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
    .where(eq(taskDependencies.taskId, taskId));
  return deps.filter((d) => d.status !== 'completed').map((d) => d.dependsOnTaskId);
}

export async function listDependencies(db: Db, taskIds: string[]) {
  if (taskIds.length === 0) return [];
  return db.select().from(taskDependencies).where(inArray(taskDependencies.taskId, taskIds));
}

export interface TimelineEntry {
  at: Date;
  kind: 'handoff' | 'run' | 'audit';
  summary: string;
  detail: Record<string, unknown>;
}

/** Delegation/handoff timeline (GET /tasks/:id/timeline, SC-002). */
export async function taskTimeline(db: Db, taskId: string): Promise<TimelineEntry[]> {
  const subtasks = await listSubtasks(db, taskId);
  const ids = [taskId, ...subtasks.map((t) => t.id)];

  const [handoffRows, runRows, auditRows] = await Promise.all([
    db.select().from(handoffs).where(inArray(handoffs.taskId, ids)),
    db.select().from(agentRuns).where(inArray(agentRuns.taskId, ids)),
    db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.targetType, 'task'), inArray(auditEvents.targetId, ids)))
      .orderBy(asc(auditEvents.createdAt))
      .limit(500),
  ]);

  const titleOf = new Map<string, string>(ids.map((id) => [id, '']));
  for (const t of subtasks) titleOf.set(t.id, t.title);

  const entries: TimelineEntry[] = [
    ...handoffRows.map((h) => ({
      at: h.createdAt,
      kind: 'handoff' as const,
      summary: `${h.fromAgentId ?? 'owner'} → ${h.toAgentId}: ${h.reason}`,
      detail: { taskId: h.taskId, taskTitle: titleOf.get(h.taskId) ?? '' },
    })),
    ...runRows.map((r) => ({
      at: r.createdAt,
      kind: 'run' as const,
      summary: `${r.agentId} run ${r.status}${r.error ? ` (${r.error})` : ''}`,
      detail: {
        taskId: r.taskId,
        taskTitle: titleOf.get(r.taskId) ?? '',
        tokens: r.inputTokens + r.outputTokens,
        costCents: r.costCents,
        durationMs: r.durationMs,
      },
    })),
    ...auditRows.map((a) => ({
      at: a.createdAt,
      kind: 'audit' as const,
      summary: `${a.actorId}: ${a.action}`,
      detail: { taskId: a.targetId, taskTitle: titleOf.get(a.targetId) ?? '', ...(a.payload as Record<string, unknown>) },
    })),
  ];
  return entries.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Full task view (GET /tasks/:id): subtasks, deps, handoffs, artifacts, runs, costs. */
export async function getTaskDeep(db: Db, id: string) {
  const task = await getTask(db, id);
  if (!task) return null;
  const subtasks = await listSubtasks(db, id);
  const ids = [id, ...subtasks.map((t) => t.id)];
  const [deps, handoffRows, artifactRows, runRows] = await Promise.all([
    listDependencies(db, ids),
    db.select().from(handoffs).where(inArray(handoffs.taskId, ids)).orderBy(asc(handoffs.createdAt)),
    db.select().from(artifacts).where(inArray(artifacts.taskId, ids)).orderBy(asc(artifacts.createdAt)),
    db.select().from(agentRuns).where(inArray(agentRuns.taskId, ids)).orderBy(asc(agentRuns.createdAt)),
  ]);
  const totals = {
    tokensUsed: task.tokensUsed + subtasks.reduce((n, t) => n + t.tokensUsed, 0),
    costCents: task.costCents + subtasks.reduce((n, t) => n + t.costCents, 0),
    execMs: task.execMs + subtasks.reduce((n, t) => n + t.execMs, 0),
  };
  return { task, subtasks, dependencies: deps, handoffs: handoffRows, artifacts: artifactRows, runs: runRows, totals };
}

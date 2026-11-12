/** T042: stage untrusted action data without writing approvals or executing tools. */
import { preparedActionSchema } from '@flux88/agents';
import type { AgentId } from '@flux88/core';
import { planTransition } from '@flux88/core/task-machine';
import { schema, type Db } from '@flux88/db';
import type { CompletionResult } from '@flux88/llm';
import { containsSecretMaterial } from '@flux88/memory';
import { and, eq, sql } from 'drizzle-orm';

export async function stageProposedAction(db: Db, context: {
  taskId: string; runId: string; agentId: AgentId; durationMs: number;
}, result: CompletionResult): Promise<boolean> {
  const parsed = preparedActionSchema.safeParse(result.proposedAction);
  if (!parsed.success || containsSecretMaterial(parsed.data)) return false;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE flux88_worker`);
    const [task] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, context.taskId)).for('update');
    const [run] = await tx.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, context.runId)).for('update');
    const [agent] = await tx.select().from(schema.agents).where(eq(schema.agents.id, context.agentId));
    if (!task || task.status !== 'running' || task.assigneeAgentId !== context.agentId ||
      !run || run.status !== 'running' || run.taskId !== task.id || run.agentId !== context.agentId || !agent?.enabled) return false;
    const plan = planTransition(task, 'awaiting_approval', { actorType: 'agent', actorId: context.agentId });
    if (!plan.ok) return false;
    await tx.insert(schema.agentActionProposals).values({ runId: run.id, proposal: parsed.data });
    await tx.update(schema.tasks).set({ ...plan.patch, updatedAt: new Date(),
      tokensUsed: sql`${schema.tasks.tokensUsed} + ${result.usage.inputTokens + result.usage.outputTokens}`,
      costCents: sql`${schema.tasks.costCents} + ${result.usage.costCents}`,
      execMs: sql`${schema.tasks.execMs} + ${context.durationMs}`,
    }).where(eq(schema.tasks.id, task.id));
    await tx.update(schema.agentRuns).set({ status: 'succeeded', ...result.usage, durationMs: context.durationMs })
      .where(and(eq(schema.agentRuns.id, run.id), eq(schema.agentRuns.status, 'running')));
    await tx.insert(schema.auditEvents).values([
      { actorType: 'agent', actorId: context.agentId, action: plan.audit.action, targetType: 'task', targetId: task.id, payload: plan.audit.payload },
      { actorType: 'agent', actorId: context.agentId, action: 'agent.proposal_staged', targetType: 'task', targetId: task.id,
        payload: { runId: run.id, actionType: parsed.data.actionType } },
    ]);
    return true;
  });
}

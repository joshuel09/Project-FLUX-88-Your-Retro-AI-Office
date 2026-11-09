/** Durable, idempotent intake from the restricted agent worker into API approvals. */
import { and, asc, eq } from 'drizzle-orm';
import { approvalRequestTtlMs, preparedActionSchema } from '@flux88/agents';
import { schema, type Db } from '@flux88/db';
import { planTransition } from '@flux88/core/task-machine';
import { createApprovalRequest } from './approvals.js';

const { agentActionProposals, agentRuns, tasks, agents, auditEvents } = schema;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

async function blockWaitingTask(tx: Tx, task: typeof tasks.$inferSelect, code: string) {
  const reason = `agent proposal refused: ${code}`;
  const transition = planTransition(task, 'blocked', { actorType: 'system', actorId: 'api', reason });
  if (!transition.ok) return false;
  const [updated] = await tx.update(tasks).set({ ...transition.patch, updatedAt: new Date() })
    .where(and(eq(tasks.id, task.id), eq(tasks.status, task.status))).returning({ id: tasks.id });
  if (!updated) return false;
  await tx.insert(auditEvents).values([
    { actorType: 'system', actorId: 'api', action: transition.audit.action, targetType: 'task', targetId: task.id, payload: transition.audit.payload },
    { actorType: 'system', actorId: 'api', action: 'task.proposal_rejected', targetType: 'task', targetId: task.id, payload: { taskId: task.id, code } },
  ]);
  return true;
}
export type ProposalIntakeResult = 'idle' | 'created' | 'rejected';

/** Create the immutable approval and mark its inbox row in one API transaction. */
export async function intakeNextAgentProposal(db: Db): Promise<ProposalIntakeResult> {
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(agentActionProposals).where(eq(agentActionProposals.status, 'pending'))
      .orderBy(asc(agentActionProposals.createdAt), asc(agentActionProposals.runId)).limit(1).for('update', { skipLocked: true });
    if (!item) return 'idle';
    const [run] = await tx.select().from(agentRuns).where(eq(agentRuns.id, item.runId));
    const [task] = run ? await tx.select().from(tasks).where(eq(tasks.id, run.taskId)).for('update') : [];
    const [agent] = run ? await tx.select().from(agents).where(eq(agents.id, run.agentId)) : [];
    const parsed = preparedActionSchema.safeParse(item.proposal);
    const proposal = parsed.success ? parsed.data : null;
    const expiresAt = new Date(item.createdAt.getTime() + approvalRequestTtlMs);
    const stale = expiresAt.getTime() - Date.now() < 60_000;
    const valid = !!proposal && run?.status === 'succeeded' && task?.status === 'awaiting_approval' &&
      task.assigneeAgentId === run.agentId && agent?.enabled && !stale &&
      typeof proposal.actionType === 'string' && typeof proposal.actionPayload === 'object' && proposal.actionPayload !== null &&
      typeof proposal.targetResource === 'string' && typeof proposal.expectedImpact === 'string' && typeof proposal.risks === 'string';
    if (!valid) {
      await tx.update(agentActionProposals).set({ status: 'rejected', rejectionCode: stale ? 'proposal_expired' : 'execution_context_changed', updatedAt: new Date() })
        .where(eq(agentActionProposals.runId, item.runId));
      if (task?.status === 'awaiting_approval') {
        await blockWaitingTask(tx, task, stale ? 'proposal_expired' : 'execution_context_changed');
      }
      return 'rejected';
    }
    const result = await createApprovalRequest(tx, { kind: 'agent', agentId: run.agentId }, {
      actionType: proposal.actionType!, actionPayload: proposal.actionPayload as Record<string, import('@flux88/agents').Json>,
      targetResource: proposal.targetResource!, expectedImpact: proposal.expectedImpact!, risks: proposal.risks!,
      taskId: run.taskId, expiresAt: expiresAt.toISOString(),
    });
    if (!result.ok) {
      await tx.update(agentActionProposals).set({ status: 'rejected', rejectionCode: result.code, updatedAt: new Date() })
        .where(eq(agentActionProposals.runId, item.runId));
      if (task.status === 'awaiting_approval') {
        await blockWaitingTask(tx, task, result.code);
      }
      return 'rejected';
    }
    await tx.update(agentActionProposals).set({ status: 'accepted', approvalRequestId: result.value.id, updatedAt: new Date() })
      .where(eq(agentActionProposals.runId, item.runId));
    return 'created';
  });
}

/** Poll on boot and then every second; PostgreSQL retains work across API restarts. */
export function startAgentProposalIntake(db: Db, publish: () => void, onError: () => void) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void>;
  const tick = async () => {
    try {
      for (let i = 0; i < 25 && !stopped; i++) {
        const result = await intakeNextAgentProposal(db);
        if (result === 'idle') break;
        if (result === 'created') publish();
      }
    } catch { onError(); }
    finally { if (!stopped) timer = setTimeout(() => { active = tick(); }, 1000); }
  };
  active = tick();
  return { async close() { stopped = true; if (timer) clearTimeout(timer); await active; } };
}

/** T041: durable, mock-only delivery. The worker never mints or consumes grants. */
import { createHash } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { policyConfigSchema } from '@flux88/agents';
import { mockTargetStateHash, schema, type Db } from '@flux88/db';

const { outbox, approvalRequests, approvalGrants, auditEvents, agents, notifications } = schema;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Delivery = typeof outbox.$inferSelect;
export const OUTBOX_MAX_ATTEMPTS = 3;
const BATCH_SIZE = 25;

/** Mock effects must be transactional database writes, never network/OS side effects. */
export type MockExecutor = (tx: Tx, delivery: Readonly<Delivery>) => Promise<void>;
export type DispatchResult = 'idle' | 'dispatched' | 'retry' | 'failed' | 'halted_revalidation';

async function record(tx: Tx, delivery: Delivery, action: string, payload: Record<string, unknown>) {
  await tx.insert(auditEvents).values({ actorType: 'system', actorId: 'outbox', action,
    targetType: 'outbox', targetId: delivery.id, payload });
}

/** A persisted, visibly simulated receipt is the entire Phase 1 mock effect. */
const executeMock: MockExecutor = async (tx, delivery) => {
  await record(tx, delivery, 'outbox.mock_executed', {
    simulated: true, operation: delivery.operation, idempotencyKey: delivery.idempotencyKey,
  });
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/**
 * SKIP LOCKED permits concurrent pollers. Receipt, delivery status and audit commit
 * together; crash/rollback leaves no effect to repeat. This guarantee is specific
 * to the transactional mock, not a promise of exactly-once external delivery.
 */
export async function dispatchNextOutbox(db: Db, execute: MockExecutor = executeMock): Promise<DispatchResult> {
  return db.transaction(async (tx) => {
    // Restrict every pooled transaction, without changing other worker sessions.
    await tx.execute(sql`SET LOCAL ROLE flux88_worker`);
    const [delivery] = await tx.select().from(outbox).where(and(
      eq(outbox.status, 'pending'),
      sql`${outbox.attempts} < ${OUTBOX_MAX_ATTEMPTS}`,
      // Persisted exponential backoff: 1s then 2s. Restarts do not reset retries.
      sql`(${outbox.attempts} = 0 OR ${outbox.updatedAt} <= clock_timestamp() - make_interval(secs => power(2, ${outbox.attempts} - 1)::integer))`,
    )).orderBy(asc(outbox.createdAt), asc(outbox.id)).limit(1).for('update', { skipLocked: true });
    if (!delivery) return 'idle';
    // Approved requests and consumed grants are immutable; plain reads retain
    // the worker role's SELECT-only approval privileges (FOR SHARE needs UPDATE).
    const [grant] = await tx.select().from(approvalGrants).where(eq(approvalGrants.id, delivery.grantId));
    const [request] = grant ? await tx.select().from(approvalRequests)
      .where(eq(approvalRequests.id, grant.approvalRequestId)) : [];
    let requesterPolicyHash: string | null = null;
    if (request?.requestingActorType === 'agent' && request.requestingAgentId) {
      const [agent] = await tx.select().from(agents).where(eq(agents.id, request.requestingAgentId));
      const policy = agent ? policyConfigSchema.safeParse(agent.config) : null;
      if (agent && policy?.success) requesterPolicyHash = createHash('sha256').update(canonical({ enabled: agent.enabled, policy: policy.data })).digest('hex');
    }
    const targetAccounts = await tx.select({ config: schema.connectorAccounts.config }).from(schema.connectorAccounts);
    const currentTargetStateHash = request ? mockTargetStateHash(targetAccounts, request.targetResource) : null;
    const expected = request ? {
      approvalRequestId: request.id, actionType: request.actionType, actionPayload: request.actionPayload,
      targetResource: request.targetResource, expiresAt: request.expiresAt.toISOString(),
      requester: request.requestingActorType === 'owner' ? { kind: 'owner' }
        : { kind: 'agent', agentId: request.requestingAgentId },
      requesterPolicyHash, targetStateHash: request.targetStateHash,
    } : null;
    const valid = delivery.connector === 'mock' && delivery.operation !== 'agent_config_change' &&
      grant?.consumedAt && request?.status === 'approved' && request.expiresAt.getTime() > Date.now() &&
      delivery.operation === request.actionType && delivery.idempotencyKey === `approval:${request.id}` &&
      request.targetStateHash !== null && currentTargetStateHash === request.targetStateHash &&
      canonical(delivery.payload) === canonical(expected);
    if (!valid) {
      await tx.update(outbox).set({ status: 'halted_revalidation', updatedAt: new Date() }).where(eq(outbox.id, delivery.id));
      const code = !request || !grant?.consumedAt || request.status !== 'approved' ? 'invalid_approval'
        : request.expiresAt.getTime() <= Date.now() ? 'approval_expired'
          : request.targetStateHash === null || currentTargetStateHash === null || currentTargetStateHash !== request.targetStateHash || canonical(delivery.payload) !== canonical(expected) ? 'target_or_permission_changed'
            : 'unsupported_mock_delivery';
      await record(tx, delivery, 'outbox.halted_revalidation', { code });
      await tx.insert(notifications).values({
        channel: 'dashboard', taskId: request?.taskId ?? null, approvalRequestId: request?.id ?? null,
        body: 'An approved action was stopped because its approval, target, or requester permission state could not be verified at dispatch. Review the approval request.',
        dedupeKey: `outbox.revalidation:${delivery.id}`,
      });
      return 'halted_revalidation';
    }
    const attempts = delivery.attempts + 1;
    // Executor exceptions roll back the mock effect to a savepoint, while the
    // outer transaction persists the failed attempt. DB/audit failures still
    // propagate: infrastructure failure never means successful delivery.
    let failed = false;
    try {
      await tx.transaction(async (attempt) => execute(attempt, Object.freeze({ ...delivery, attempts })));
    } catch {
      failed = true;
    }
    if (failed) {
      const status = attempts >= OUTBOX_MAX_ATTEMPTS ? 'failed' : 'pending';
      await tx.update(outbox).set({ attempts, status, updatedAt: new Date() }).where(eq(outbox.id, delivery.id));
      await record(tx, delivery, 'outbox.delivery_failed', { attempts, terminal: status === 'failed', code: 'mock_executor_failed' });
      return status === 'failed' ? 'failed' : 'retry';
    }
    await tx.update(outbox).set({ attempts, status: 'dispatched', updatedAt: new Date() }).where(eq(outbox.id, delivery.id));
    await record(tx, delivery, 'outbox.dispatched', { attempts, simulated: true });
    return 'dispatched';
  });
}

/** Poll PostgreSQL immediately and periodically; shutdown drains the in-flight batch. */
export function startOutboxDispatcher(db: Db, onError: () => void, intervalMs = 1000) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void>;
  const tick = async () => {
    try {
      for (let i = 0; i < BATCH_SIZE && !stopped; i++) {
        if (await dispatchNextOutbox(db) === 'idle') break;
      }
    } catch {
      onError(); // Deliberately omit payloads, credentials and raw database errors.
    } finally {
      if (!stopped) timer = setTimeout(() => { active = tick(); }, intervalMs);
    }
  };
  active = tick();
  return {
    async close() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await active;
    },
  };
}

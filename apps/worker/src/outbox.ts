/** T041: durable, mock-only delivery. The worker never mints or consumes grants. */
import { and, asc, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@flux88/db';

const { outbox, approvalRequests, approvalGrants, auditEvents } = schema;
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
    const expected = request ? {
      approvalRequestId: request.id, actionType: request.actionType, actionPayload: request.actionPayload,
      targetResource: request.targetResource, expiresAt: request.expiresAt.toISOString(),
      requester: request.requestingActorType === 'owner' ? { kind: 'owner' }
        : { kind: 'agent', agentId: request.requestingAgentId },
    } : null;
    const valid = delivery.connector === 'mock' && delivery.operation !== 'agent_config_change' &&
      grant?.consumedAt && request?.status === 'approved' && request.expiresAt.getTime() > Date.now() &&
      delivery.operation === request.actionType && delivery.idempotencyKey === `approval:${request.id}` &&
      canonical(delivery.payload) === canonical(expected);
    if (!valid) {
      await tx.update(outbox).set({ status: 'halted_revalidation', updatedAt: new Date() }).where(eq(outbox.id, delivery.id));
      await record(tx, delivery, 'outbox.halted_revalidation', { code: 'invalid_or_expired_mock_delivery' });
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

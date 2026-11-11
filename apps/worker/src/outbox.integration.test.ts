import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@flux88/db';
import { connectTestDb } from '@flux88/db/testing';
import { dispatchNextOutbox, startOutboxDispatcher, type MockExecutor } from './outbox.js';

const { db, client } = connectTestDb();
const { approvalRequests, approvalGrants, outbox, auditEvents } = schema;
const created: string[] = [];

async function enqueue(connector: 'mock' | 'github' = 'mock', status: 'pending' | 'dispatched' = 'pending', operation: 'github_write' | 'agent_config_change' = 'github_write') {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 600_000);
  const payload = { message: 'Simulated fixture action' };
  return db.transaction(async (tx) => {
    const [request] = await tx.insert(approvalRequests).values({
      requestingActorType: 'owner', actionType: operation, actionPayload: payload,
      targetResource: 'fixture:outbox', expectedImpact: 'Mock only', risks: 'No external delivery',
      expiresAt, dedupeKey: id, status: 'approved', decidedBy: 'owner', decidedAt: new Date(),
    }).returning();
    const [grant] = await tx.insert(approvalGrants).values({ approvalRequestId: request!.id }).returning();
    await tx.update(approvalGrants).set({ consumedAt: new Date() }).where(eq(approvalGrants.id, grant!.id));
    const [delivery] = await tx.insert(outbox).values({
      connector, operation, grantId: grant!.id, status, idempotencyKey: `approval:${request!.id}`,
      payload: { approvalRequestId: request!.id, requester: { kind: 'owner' }, actionType: operation,
        targetResource: request!.targetResource, actionPayload: payload, expiresAt: expiresAt.toISOString() },
    }).returning();
    created.push(delivery!.id);
    return delivery!;
  });
}
async function get(id: string) { return (await db.select().from(outbox).where(eq(outbox.id, id)))[0]!; }
async function receipts(id: string) {
  return db.select().from(auditEvents).where(and(eq(auditEvents.targetId, id), eq(auditEvents.action, 'outbox.mock_executed')));
}
async function makeRetryReady(id: string) {
  await db.update(outbox).set({ updatedAt: new Date(Date.now() - 10_000) }).where(eq(outbox.id, id));
}

beforeAll(async () => {
  // This suite is intentionally non-destructive: only its own fixture rows are
  // changed. CI and local runs still require a dedicated migrated test database.
  await db.execute(sql`SELECT 1`);
});
afterEach(async () => {
  vi.restoreAllMocks();
  // Prevent failed assertions from leaving a pending fixture for another case.
  for (const id of created.splice(0)) {
    await db.update(outbox).set({ status: 'failed' }).where(and(eq(outbox.id, id), eq(outbox.status, 'pending')));
  }
});
afterAll(async () => { await client.end(); });

describe('T041 transactional mock outbox', () => {
  it('concurrent pollers commit one mock effect; replay after restart is idle', async () => {
    const d = await enqueue();
    const results = await Promise.all(Array.from({ length: 5 }, () => dispatchNextOutbox(db)));
    expect(results.filter((r) => r === 'dispatched')).toHaveLength(1);
    expect(await receipts(d.id)).toHaveLength(1);
    expect(await get(d.id)).toMatchObject({ status: 'dispatched', attempts: 1 });
    const restarted = connectTestDb();
    try { expect(await dispatchNextOutbox(restarted.db)).toBe('idle'); }
    finally { await restarted.client.end(); }
    expect(await receipts(d.id)).toHaveLength(1);
  });

  it('rolls back a partial mock effect, persists backoff, then retries once', async () => {
    const d = await enqueue();
    const fail: MockExecutor = async (tx) => {
      await tx.insert(auditEvents).values({ actorType: 'system', actorId: 'fixture', action: 'outbox.mock_executed', targetType: 'outbox', targetId: d.id });
      throw new Error('fixture failure must never appear in the audit');
    };
    expect(await dispatchNextOutbox(db, fail)).toBe('retry');
    expect(await receipts(d.id)).toHaveLength(0);
    expect(await get(d.id)).toMatchObject({ status: 'pending', attempts: 1 });
    expect(await dispatchNextOutbox(db)).toBe('idle');
    await makeRetryReady(d.id);
    expect(await dispatchNextOutbox(db)).toBe('dispatched');
    expect(await receipts(d.id)).toHaveLength(1);
    expect(await get(d.id)).toMatchObject({ status: 'dispatched', attempts: 2 });
  });

  it('bounds retries across dispatcher restarts and records terminal failure', async () => {
    const d = await enqueue();
    const fail = async () => { throw new Error('do not log raw errors'); };
    for (const expected of ['retry', 'retry', 'failed']) {
      await makeRetryReady(d.id);
      const restarted = connectTestDb();
      try { expect(await dispatchNextOutbox(restarted.db, fail)).toBe(expected); }
      finally { await restarted.client.end(); }
    }
    expect(await get(d.id)).toMatchObject({ status: 'failed', attempts: 3 });
    expect(await dispatchNextOutbox(db)).toBe('idle');
    const events = await db.select().from(auditEvents).where(eq(auditEvents.targetId, d.id));
    expect(events.filter((e) => e.action === 'outbox.delivery_failed')).toHaveLength(3);
    expect(JSON.stringify(events)).not.toContain('do not log');
  });

  it('never replays local configuration records or calls a live connector', async () => {
    const local = await enqueue('mock', 'dispatched', 'agent_config_change');
    const live = await enqueue('github');
    const execute = vi.fn(async () => {});
    expect(await dispatchNextOutbox(db, execute)).toBe('halted_revalidation');
    expect(execute).not.toHaveBeenCalled();
    expect(await get(local.id)).toMatchObject({ status: 'dispatched', attempts: 0 });
    expect(await get(live.id)).toMatchObject({ status: 'halted_revalidation', attempts: 0 });
    const pendingConfig = await enqueue('mock', 'pending', 'agent_config_change');
    expect(await dispatchNextOutbox(db, execute)).toBe('halted_revalidation');
    expect(await get(pendingConfig.id)).toMatchObject({ status: 'halted_revalidation' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('halts expired approvals without executing or consuming a second grant', async () => {
    const d = await enqueue();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 700_000);
    const execute = vi.fn(async () => {});
    expect(await dispatchNextOutbox(db, execute)).toBe('halted_revalidation');
    expect(execute).not.toHaveBeenCalled();
    expect(await get(d.id)).toMatchObject({ status: 'halted_revalidation', attempts: 0 });
    expect(await receipts(d.id)).toHaveLength(0);
  });

  it('runs with worker privileges and cannot mint grants', async () => {
    const d = await enqueue();
    const forbidden: MockExecutor = async (tx) => {
      await tx.insert(approvalGrants).values({ approvalRequestId: randomUUID() });
    };
    expect(await dispatchNextOutbox(db, forbidden)).toBe('retry');
    expect(await get(d.id)).toMatchObject({ status: 'pending', attempts: 1 });
    expect(await receipts(d.id)).toHaveLength(0);
  });

  it('rolls back the receipt and status if final audit persistence fails', async () => {
    const d = await enqueue();
    await db.execute(sql`CREATE FUNCTION test_outbox_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action = 'outbox.dispatched' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$`);
    await db.execute(sql`CREATE TRIGGER test_outbox_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION test_outbox_audit_failure()`);
    try {
      await expect(dispatchNextOutbox(db)).rejects.toThrow();
      expect(await get(d.id)).toMatchObject({ status: 'pending', attempts: 0 });
      expect(await receipts(d.id)).toHaveLength(0);
    } finally {
      await db.execute(sql`DROP TRIGGER test_outbox_audit_failure ON audit_events`);
      await db.execute(sql`DROP FUNCTION test_outbox_audit_failure()`);
    }
    expect(await dispatchNextOutbox(db)).toBe('dispatched');
    expect(await receipts(d.id)).toHaveLength(1);
  });

  it('polls pending state on startup and drains cleanly on shutdown', async () => {
    const d = await enqueue();
    const onError = vi.fn();
    const poller = startOutboxDispatcher(db, onError, 20);
    try {
      await vi.waitFor(async () => { expect((await get(d.id)).status).toBe('dispatched'); });
    } finally { await poller.close(); }
    expect(onError).not.toHaveBeenCalled();
    const next = await enqueue();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await get(next.id)).status).toBe('pending');
  });
});

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { expect, test } from '@playwright/test';
import { AGENT_CONFIGS } from '../../packages/agents/src/configs.js';
import { createDbWithClient } from '../../packages/db/src/client.js';
import * as schema from '../../packages/db/src/schema/index.js';
import { createFailureHarness } from '../failure/harness.js';

test('Postgres, Redis, and worker restart preserve state and recover one interrupted run', async () => {
  test.setTimeout(120_000);
  const harness = await createFailureHarness();
  let dbClient: ReturnType<typeof createDbWithClient> | undefined;
  let worker: Awaited<ReturnType<typeof harness.spawnWorker>> | undefined;
  let phase = 'database migration';
  try {
    await harness.migrateDatabase();
    dbClient = createDbWithClient(harness.databaseUrl);
    let db = dbClient.db;
    const agent = AGENT_CONFIGS.find((config) => config.id === 'marty')!;
    await db.insert(schema.agents).values({
      id: agent.id,
      displayName: agent.displayName,
      department: agent.department,
      officeArea: agent.officeArea,
      roleSummary: agent.roleSummary,
      personality: agent.personality,
      config: agent,
    });

    const taskId = randomUUID();
    await db.insert(schema.tasks).values({
      id: taskId,
      title: 'Recover interrupted restart fixture',
      creator: 'owner',
      assigneeAgentId: 'marty',
      status: 'running',
    });
    await db.insert(schema.agentRuns).values({
      taskId,
      agentId: 'marty',
      status: 'running',
      idempotencyKey: `${taskId}:0`,
    });
    const expiresAt = new Date(Date.now() + 60_000);
    const actionPayload = { title: 'Persist approval fixture' };
    const targetResource = 'fixture:restart';
    const targetStateHash = 'stable-fixture-hash';
    const [approval] = await db.insert(schema.approvalRequests).values({
      requestingAgentId: 'marty',
      actionType: 'github_write',
      actionPayload,
      targetResource,
      targetStateHash,
      expectedImpact: 'No external effect',
      risks: 'Test fixture only',
      expiresAt,
      status: 'approved',
      decidedBy: 'owner',
      decidedAt: new Date(),
      dedupeKey: `restart:${taskId}`,
    }).returning();
    const [grant] = await db.insert(schema.approvalGrants).values({ approvalRequestId: approval!.id }).returning();
    await db.update(schema.approvalGrants).set({ consumedAt: new Date() }).where(eq(schema.approvalGrants.id, grant!.id));
    const [delivery] = await db.insert(schema.outbox).values({
      connector: 'mock',
      operation: 'github_write',
      payload: {
        approvalRequestId: approval!.id,
        requester: { kind: 'agent', agentId: 'marty' },
        actionType: 'github_write',
        targetResource,
        actionPayload,
        targetStateHash,
        expiresAt: expiresAt.toISOString(),
      },
      grantId: grant!.id,
      status: 'dispatched',
      attempts: 1,
      idempotencyKey: `restart:${taskId}`,
    }).returning();
    const [memory] = await db.insert(schema.memoryEntries).values({
      scope: 'project',
      projectId: 'restart-fixture',
      category: 'lesson',
      title: 'Restart memory fixture',
      body: 'Memory survives service restart.',
      sourceAttribution: 'T047 fixture',
      verificationStatus: 'verified',
      author: 'owner',
      dedupeHash: `restart:${taskId}`,
    }).returning();
    await db.insert(schema.auditEvents).values({
      actorType: 'system',
      actorId: 't047',
      action: 'restart.fixture_created',
      targetType: 'task',
      targetId: taskId,
      payload: { approvalId: approval!.id, outboxId: delivery!.id, memoryId: memory!.id },
    });
    await db.insert(schema.auditEvents).values({
      actorType: 'system',
      actorId: 'worker',
      action: 'outbox.mock_executed',
      targetType: 'outbox',
      targetId: delivery!.id,
      payload: { connector: 'mock', operation: 'github_write' },
    });

    const snapshot = async () => ({
      task: await db.select({ id: schema.tasks.id, title: schema.tasks.title, status: schema.tasks.status }).from(schema.tasks).where(eq(schema.tasks.id, taskId)),
      run: await db.select({ id: schema.agentRuns.id, status: schema.agentRuns.status, idempotencyKey: schema.agentRuns.idempotencyKey }).from(schema.agentRuns).where(eq(schema.agentRuns.taskId, taskId)),
      approval: await db.select({ id: schema.approvalRequests.id, status: schema.approvalRequests.status, dedupeKey: schema.approvalRequests.dedupeKey }).from(schema.approvalRequests).where(eq(schema.approvalRequests.id, approval!.id)),
      memory: await db.select({ id: schema.memoryEntries.id, body: schema.memoryEntries.body, dedupeHash: schema.memoryEntries.dedupeHash }).from(schema.memoryEntries).where(eq(schema.memoryEntries.id, memory!.id)),
      audit: {
        task: await db.select({ action: schema.auditEvents.action, targetId: schema.auditEvents.targetId, payload: schema.auditEvents.payload }).from(schema.auditEvents).where(eq(schema.auditEvents.targetId, taskId)),
        outbox: await db.select({ action: schema.auditEvents.action, targetId: schema.auditEvents.targetId, payload: schema.auditEvents.payload }).from(schema.auditEvents).where(eq(schema.auditEvents.targetId, delivery!.id)),
      },
      outbox: await db.select({ id: schema.outbox.id, status: schema.outbox.status, attempts: schema.outbox.attempts }).from(schema.outbox).where(eq(schema.outbox.id, delivery!.id)),
    });
    const beforeRestart = await snapshot();
    await dbClient.client.end();
    dbClient = undefined;

    phase = 'database and Redis restart';
    await harness.restartPostgres();
    await harness.killRedis();
    await harness.restartRedis();

    phase = 'post-restart persistence snapshot';
    dbClient = createDbWithClient(harness.databaseUrl);
    db = dbClient.db;
    expect(await snapshot()).toEqual(beforeRestart);

    phase = 'worker recovery';
    worker = harness.spawnWorker();
    await worker.waitForOutput('[flux88-worker] booted', 30_000);
    expect(worker.output()).toMatch(/reconciled: [1-9]\d*\)/);
    const deadline = Date.now() + 30_000;
    let task = (await dbClient.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)))[0];
    while (task?.status !== 'completed' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      task = (await dbClient.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)))[0];
    }
    expect(task).toMatchObject({ status: 'completed', retryCount: 1 });
    const runs = await dbClient.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.taskId, taskId));
    expect(runs).toHaveLength(2);
    expect(runs.map(({ status, error, idempotencyKey }) => ({ status, error, idempotencyKey })).sort((a, b) => a.idempotencyKey.localeCompare(b.idempotencyKey))).toEqual([
      { status: 'failed', error: 'interrupted_by_restart', idempotencyKey: `${taskId}:0` },
      { status: 'succeeded', error: null, idempotencyKey: `${taskId}:1` },
    ]);
    expect(await dbClient.db.select().from(schema.artifacts).where(eq(schema.artifacts.taskId, taskId))).toHaveLength(1);
    expect(await dbClient.db.select().from(schema.outbox).where(eq(schema.outbox.id, delivery!.id))).toMatchObject([{ status: 'dispatched', attempts: 1 }]);
    const outboxReceipts = await dbClient.db.select().from(schema.auditEvents).where(eq(schema.auditEvents.targetId, delivery!.id));
    expect(outboxReceipts).toHaveLength(1);
    expect(outboxReceipts[0]).toMatchObject({ action: 'outbox.mock_executed', targetId: delivery!.id });
  } catch (error) {
    throw new Error(`${phase} failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    try {
      if (worker) await harness.killWorker(worker, 'SIGTERM');
    } finally {
      try { await dbClient?.client.end(); }
      finally { await harness.close(); }
    }
  }
  expect(await harness.remainingContainers()).toEqual([]);
});

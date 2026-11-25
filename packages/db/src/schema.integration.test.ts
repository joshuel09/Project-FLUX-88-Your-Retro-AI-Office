import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { schema } from './index.js';
import { connectTestDb, TEST_DATABASE_URL, truncateMutableTables } from './testing/harness.js';

const connection = connectTestDb();
const db = connection.db;

beforeEach(async () => { await truncateMutableTables(db); });
afterAll(async () => { await connection.client.end(); });

describe('Phase 3 connector persistence', () => {
  it('persists GitHub feedback once per provider identity and enforces untrusted bounded content', async () => {
    const input = {
      provider: 'github' as const,
      externalId: `review-${randomUUID()}`,
      externalType: 'pull_request_review',
      authorLogin: 'reviewer',
      bodyExcerpt: 'Please handle this case.',
      sourceUrl: 'https://github.com/owner/repo/pull/42',
      state: 'pending' as const,
      provenance: 'untrusted',
    };
    const [feedback] = await db.insert(schema.externalFeedback).values(input).returning();

    expect(feedback).toMatchObject({ ...input, externalLinkId: null, taskId: null, assigneeAgentId: null });
    await expect(db.insert(schema.externalFeedback).values(input)).rejects.toThrow();
    await expect(db.insert(schema.externalFeedback).values({ ...input, provider: 'discord' })).rejects.toThrow();
    await expect(db.insert(schema.externalFeedback).values({ ...input, externalId: `bad-${randomUUID()}`, provenance: 'trusted' })).rejects.toThrow();
    await expect(db.insert(schema.externalFeedback).values({
      ...input,
      externalId: `oversized-${randomUUID()}`,
      bodyExcerpt: 'x'.repeat(1_001),
    })).rejects.toThrow();
  });

  it('records each Discord interaction identity once without storing request bodies or tokens', async () => {
    const input = {
      provider: 'discord' as const,
      interactionId: `interaction-${randomUUID()}`,
      state: 'received' as const,
    };
    const [interaction] = await db.insert(schema.discordInteractions).values(input).returning();

    expect(interaction).toMatchObject(input);
    expect(interaction?.receivedAt).toBeInstanceOf(Date);
    await expect(db.execute(sql`SELECT received_at FROM discord_interactions WHERE interaction_id = ${input.interactionId}`)).resolves.toHaveLength(1);
    expect(interaction).not.toHaveProperty('body');
    expect(interaction).not.toHaveProperty('token');
    await expect(db.insert(schema.discordInteractions).values(input)).rejects.toThrow();
    await expect(db.insert(schema.discordInteractions).values({ ...input, interactionId: `bad-${randomUUID()}`, provider: 'github' })).rejects.toThrow();
  });

  it('deduplicates Discord delivery intervals and stores their approval batch expiry', async () => {
    const approvalBatchId = randomUUID();
    const [request] = await db.insert(schema.approvalRequests).values({
      requestingActorType: 'owner',
      actionType: 'external_communication',
      actionPayload: { message: 'Review reminder' },
      targetResource: 'discord:configured-channel',
      expectedImpact: 'Send the exact approved reminder.',
      risks: 'External communication.',
      expiresAt: new Date('2026-12-01T01:00:00.000Z'),
      batchId: approvalBatchId,
      dedupeKey: `request:${randomUUID()}`,
    }).returning();
    const deliveryInterval = new Date('2026-11-25T00:00:00.000Z');
    const input = {
      channel: 'discord' as const,
      approvalRequestId: request!.id,
      body: 'Review reminder',
      dedupeKey: `task:${randomUUID()}:review_reminder`,
      deliveryInterval,
      approvalBatchId,
      approvalExpiresAt: new Date('2026-12-01T01:00:00.000Z'),
      deliveryStatus: 'pending' as const,
    };
    const [delivery] = await db.insert(schema.notifications).values(input).returning();

    expect(delivery).toMatchObject(input);
    await expect(db.insert(schema.notifications).values(input)).rejects.toThrow();
    await expect(db.insert(schema.notifications).values({
      ...input,
      deliveryInterval: new Date('2026-11-26T00:00:00.000Z'),
    }).returning()).resolves.toHaveLength(1);
    await expect(db.insert(schema.notifications).values({
      ...input,
      dedupeKey: `bad-batch:${randomUUID()}`,
      channel: 'dashboard',
    })).rejects.toThrow();
    await expect(db.insert(schema.notifications).values({
      ...input,
      dedupeKey: `bad-attempts:${randomUUID()}`,
      deliveryAttempts: -1,
    })).rejects.toThrow();
    await expect(db.insert(schema.notifications).values({
      ...input,
      dedupeKey: `wrong-batch:${randomUUID()}`,
      approvalBatchId: randomUUID(),
    })).rejects.toThrow();
    await expect(db.insert(schema.notifications).values({
      ...input,
      dedupeKey: `wrong-expiry:${randomUUID()}`,
      approvalExpiresAt: new Date('2026-12-01T02:00:00.000Z'),
    })).rejects.toThrow();
  });
});

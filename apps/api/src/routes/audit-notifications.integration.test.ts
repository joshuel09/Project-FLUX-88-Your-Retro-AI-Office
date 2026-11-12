import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '@flux88/config';
import { schema, writeAudit } from '@flux88/db';
import { connectTestDb, TEST_DATABASE_URL, truncateMutableTables } from '@flux88/db/testing';

import { createApp } from '../app.js';

const config = loadConfig({ ...process.env, DATABASE_URL: TEST_DATABASE_URL });
const connection = connectTestDb();
const app = createApp({ config, db: connection.db }).app;
const origin = new URL(config.WEB_URL).origin;
let cookie = '';

beforeEach(async () => {
  await truncateMutableTables(connection.db);
  const setup = await app.request('/api/v1/auth/setup', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.test', password: 't051-owner-test-password' }),
  });
  expect(setup.status).toBe(201);
  cookie = setup.headers.get('set-cookie')!.split(';')[0]!;
});
afterAll(async () => { await connection.client.end(); });

describe('T051 Clock Tower audit and notifications API', () => {
  it('requires the owner session and returns bounded records with dedupe keys', async () => {
    expect((await app.request('/api/v1/audit')).status).toBe(401);
    expect((await app.request('/api/v1/notifications')).status).toBe(401);

    await connection.db.insert(schema.notifications).values({
      channel: 'dashboard',
      body: 'Approval needs review',
      dedupeKey: 'approval-request:123',
    });
    await writeAudit(connection.db, {
      actorType: 'system', actorId: 'worker', action: 'task.transition',
      targetType: 'task', targetId: 'task-1', payload: { status: 'blocked' },
    });
    const actorId = `t051-${randomUUID()}`;
    await connection.db.insert(schema.auditEvents).values(Array.from({ length: 101 }, (_, index) => ({
      actorType: 'system' as const,
      actorId,
      action: `test.${index}`,
      targetType: 'test',
      targetId: `target-${index}`,
      payload: {},
      createdAt: new Date(Date.now() + index * 1_000),
    })));

    const headers = { Cookie: cookie };
    const notifications = await app.request('/api/v1/notifications', { headers });
    expect(notifications.status).toBe(200);
    expect(await notifications.json()).toMatchObject({ items: [{ body: 'Approval needs review', dedupeKey: 'approval-request:123' }] });
    expect((await app.request('/api/v1/notifications?limit=101', { headers })).status).toBe(400);

    const audit = await app.request(`/api/v1/audit?actorId=${actorId}&limit=100`, { headers });
    expect(audit.status).toBe(200);
    const auditBody = await audit.json() as { items: Array<{ action: string }> };
    expect(auditBody.items).toHaveLength(100);
    expect(auditBody.items[0]?.action).toBe('test.100');
    const filtered = await app.request(`/api/v1/audit?actorId=${actorId}&targetType=test&action=test.100`, { headers });
    expect(await filtered.json()).toMatchObject({ items: [{ action: 'test.100', targetId: 'target-100' }] });
    expect((await app.request('/api/v1/audit?limit=0', { headers })).status).toBe(400);
    expect((await app.request('/api/v1/audit?limit=101', { headers })).status).toBe(400);
  });
});

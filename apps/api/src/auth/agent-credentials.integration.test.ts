import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '@flux88/config';
import { createTask, listAudit, schema } from '@flux88/db';
import { connectTestDb, TEST_DATABASE_URL, truncateMutableTables } from '@flux88/db/testing';

import { createApp } from '../app.js';

const config = loadConfig({ ...process.env, DATABASE_URL: TEST_DATABASE_URL });
const connection = connectTestDb();
const app = createApp({ config, db: connection.db }).app;
const ORIGIN = { Origin: new URL(config.WEB_URL).origin, 'Content-Type': 'application/json' };
let cookie = '';

async function issueCredential(agentId = 'eleven') {
  const response = await app.request(`/api/v1/agents/${agentId}/service-credential`, {
    method: 'POST', headers: { ...ORIGIN, Cookie: cookie }, body: '{}',
  });
  expect(response.status).toBe(201);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return await response.json() as { id: string; token: string; expiresAt: string };
}

beforeEach(async () => {
  await truncateMutableTables(connection.db);
  const setup = await app.request('/api/v1/auth/setup', {
    method: 'POST', headers: ORIGIN,
    body: JSON.stringify({ email: 'owner@example.test', password: 't061-owner-test-password' }),
  });
  expect(setup.status).toBe(201);
  cookie = setup.headers.get('set-cookie')!.split(';')[0]!;
});
afterAll(async () => { await connection.client.end(); });

describe('T061 agent service credentials and API', () => {
  it('issues one-time high-entropy credentials and stores only a hash', async () => {
    expect((await app.request('/api/v1/agents/eleven/service-credential', { method: 'POST', headers: ORIGIN, body: '{}' })).status).toBe(401);
    const first = await issueCredential();
    expect(first.token).toMatch(/^flux88_agent_[A-Za-z0-9_-]{43}$/);
    expect(new Date(first.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const [storedFirst] = await connection.db.select().from(schema.agentServiceCredentials).where(eq(schema.agentServiceCredentials.id, first.id));
    expect(storedFirst?.tokenHash).not.toBe(first.token);
    expect(storedFirst?.tokenHash).toMatch(/^[a-f0-9]{64}$/);

    const second = await issueCredential();
    const [rotated] = await connection.db.select().from(schema.agentServiceCredentials).where(eq(schema.agentServiceCredentials.id, first.id));
    expect(rotated?.revokedAt).not.toBeNull();
    expect((await app.request('/api/v1/agent/me', { headers: { Authorization: `Bearer ${first.token}` } })).status).toBe(401);
    expect((await app.request('/api/v1/agent/me', { headers: { Authorization: `Bearer ${second.token}` } })).status).toBe(200);

    const audits = await listAudit(connection.db, { targetType: 'agent_credential', limit: 20 });
    expect(audits.map((audit) => audit.action)).toEqual(expect.arrayContaining([
      'agent.credential_issued', 'agent.credential_revoked',
    ]));
    expect(JSON.stringify(audits)).not.toContain(first.token);
    expect(JSON.stringify(audits)).not.toContain(second.token);
  });

  it('derives identity from the credential and isolates owner and other-agent APIs', async () => {
    const credential = await issueCredential();
    const authorization = { Authorization: `Bearer ${credential.token}` };
    expect((await app.request('/api/v1/agent/me', { headers: { Cookie: cookie } })).status).toBe(401);
    const me = await app.request('/api/v1/agent/me', { headers: authorization });
    expect(await me.json()).toMatchObject({ id: 'eleven' });
    expect((await app.request('/api/v1/agents', { headers: authorization })).status).toBe(401);
    expect((await app.request('/api/v1/agent/me', { headers: { Authorization: 'Bearer invalid' } })).status).toBe(401);
  });

  it('rejects expired credentials', async () => {
    const credential = await issueCredential();
    await connection.db.update(schema.agentServiceCredentials).set({ expiresAt: new Date(0) })
      .where(eq(schema.agentServiceCredentials.id, credential.id));
    expect((await app.request('/api/v1/agent/me', {
      headers: { Authorization: `Bearer ${credential.token}` },
    })).status).toBe(401);
  });

  it('serializes concurrent rotations so only one credential remains active', async () => {
    await Promise.all([issueCredential(), issueCredential()]);
    const active = await connection.db.select().from(schema.agentServiceCredentials).where(and(
      eq(schema.agentServiceCredentials.agentId, 'eleven'),
      isNull(schema.agentServiceCredentials.revokedAt),
    ));
    expect(active).toHaveLength(1);
  });

  it('allows only policy-authorized transitions on tasks assigned to the credential agent', async () => {
    const credential = await issueCredential();
    const ownTask = await createTask(connection.db, {
      title: 'Agent-owned task', creator: 'owner', assigneeAgentId: 'eleven', status: 'ready',
    });
    const otherTask = await createTask(connection.db, {
      title: 'Another agent task', creator: 'owner', assigneeAgentId: 'marty', status: 'ready',
    });
    const headers = { ...ORIGIN, Authorization: `Bearer ${credential.token}` };

    const own = await app.request(`/api/v1/agent/tasks/${ownTask.id}`, { headers });
    expect(await own.json()).toMatchObject({ id: ownTask.id, title: 'Agent-owned task', status: 'ready' });
    expect((await app.request(`/api/v1/agent/tasks/${otherTask.id}`, { headers })).status).toBe(404);
    const transitioned = await app.request(`/api/v1/agent/tasks/${ownTask.id}/transition`, {
      method: 'POST', headers, body: JSON.stringify({ to: 'running' }),
    });
    expect(transitioned.status).toBe(200);
    expect(await transitioned.json()).toMatchObject({ id: ownTask.id, status: 'running' });
    expect((await app.request(`/api/v1/agent/tasks/${ownTask.id}/transition`, {
      method: 'POST', headers, body: JSON.stringify({ to: 'canceled' }),
    })).status).toBe(400);
    expect((await app.request(`/api/v1/agent/tasks/${ownTask.id}/transition`, {
      method: 'POST', headers, body: JSON.stringify({ to: 'running', agentId: 'marty' }),
    })).status).toBe(400);

    const audit = await connection.db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.targetId, ownTask.id), eq(schema.auditEvents.action, 'task.transition'),
    ));
    expect(audit).toContainEqual(expect.objectContaining({ actorType: 'agent', actorId: 'eleven' }));
  });

  it('refuses task transitions absent the configured tasks.update_own permission', async () => {
    const credential = await issueCredential('doc');
    const task = await createTask(connection.db, {
      title: 'DOC policy task', creator: 'owner', assigneeAgentId: 'doc', status: 'ready',
    });
    const response = await app.request(`/api/v1/agent/tasks/${task.id}/transition`, {
      method: 'POST',
      headers: { ...ORIGIN, Authorization: `Bearer ${credential.token}` },
      body: JSON.stringify({ to: 'running' }),
    });
    expect(response.status).toBe(403);
  });

  it('owner revocation immediately denies the credential', async () => {
    const credential = await issueCredential();
    const revoked = await app.request(`/api/v1/agents/eleven/service-credential/${credential.id}`, {
      method: 'DELETE', headers: { ...ORIGIN, Cookie: cookie },
    });
    expect(revoked.status).toBe(200);
    expect((await app.request('/api/v1/agent/me', {
      headers: { Authorization: `Bearer ${credential.token}` },
    })).status).toBe(401);
    expect((await app.request(`/api/v1/agents/marty/service-credential/${credential.id}`, {
      method: 'DELETE', headers: { ...ORIGIN, Cookie: cookie },
    })).status).toBe(404);
  });
});

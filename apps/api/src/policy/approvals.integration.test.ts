/** T040 lifecycle, capability, atomicity, and owner HTTP acceptance tests. Isolated DB only. */
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AGENT_CONFIG_BY_ID, policyConfigSchema } from '@flux88/agents';
import { loadConfig } from '@flux88/config';
import { mockTargetStateHash, schema, type Db } from '@flux88/db';
import { connectTestDb, TEST_DATABASE_URL, truncateMutableTables } from '@flux88/db/testing';
import { createApp } from '../app.js';
import {
  approvalBinding, consumeApprovalGrant, createApprovalRequest, decideApproval, getApproval, stateHash,
  listApprovals, loadApprovalGrant, prepareAgentConfigChange, reauthenticateOwner,
  type ApprovalGrant, type ApprovalRequest, type ApprovalResult, type OwnerAuthorization,
} from './approvals.js';

let db: Db;
let close: () => Promise<void>;
let app: ReturnType<typeof createApp>['app'];
let cookie = '';
let sessionId = '';
const password = 't040-owner-test-password';
const config = loadConfig({ ...process.env, DATABASE_URL: TEST_DATABASE_URL });
const marty = AGENT_CONFIG_BY_ID.get('marty')!;
function value<T>(result: ApprovalResult<T>): T {
  if (!result.ok) throw new Error(`unexpected refusal: ${result.code}`);
  return result.value;
}
function proposal(extra: Record<string, unknown> = {}) {
  return { actionType: 'external_communication', actionPayload: { message: 'Prepared message only', recipients: ['recipient@example.test'] },
    targetResource: `message:${randomUUID()}`, expectedImpact: 'Send the exact prepared message.', risks: 'External communication.',
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), ...extra };
}
async function request(extra: Record<string, unknown> = {}) {
  return value(await createApprovalRequest(db, { kind: 'owner' }, proposal(extra)));
}
async function proof(): Promise<OwnerAuthorization> { return value(await reauthenticateOwner(db, sessionId, password)); }
async function approve(row: ApprovalRequest) {
  return value(await decideApproval(db, await proof(), row.id, 'approve')).grant!;
}
async function decoded(response: Response) {
  return await response.json() as { approvalRequestId?: string; grantId?: string; config?: { allowedTools: string[] } };
}
async function http(path: string, body: unknown, method = 'POST', authenticated = true, origin = new URL(config.WEB_URL).origin) {
  return app.request(path, { method, headers: { 'Content-Type': 'application/json', Origin: origin, ...(authenticated ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
}
async function grantRow(id: string) { return (await db.select().from(schema.approvalGrants).where(eq(schema.approvalGrants.id, id)))[0]!; }

beforeAll(async () => {
  const connection = connectTestDb(); db = connection.db; close = () => connection.client.end();
  await truncateMutableTables(db);
  app = createApp({ db, config }).app;
  const setup = await http('/api/v1/auth/setup', { email: 'owner@example.test', password }, 'POST', false);
  expect(setup.status).toBe(201);
  cookie = setup.headers.get('set-cookie')!.split(';')[0]!;
  sessionId = cookie.slice(cookie.indexOf('=') + 1);
});
afterEach(() => { vi.useRealTimers(); });
afterAll(async () => {
  if (db) await db.update(schema.agents).set({ config: marty, enabled: true,
    displayName: marty.displayName, personality: marty.personality, roleSummary: marty.roleSummary }).where(eq(schema.agents.id, 'marty'));
  await close?.();
});

describe('immutable approval lifecycle', () => {
  it('captures and protects the mock target state at request creation', async () => {
    const targetResource = `mock-target:${randomUUID()}`;
    const config = { mockTargets: { [targetResource]: { version: 1, enabled: true } } };
    const [connector] = await db.insert(schema.connectorAccounts).values({
      provider: 'mock', config, healthStatus: 'mock',
    }).returning();
    try {
      const row = await request({ targetResource });
      expect(row.targetStateHash).toBe(mockTargetStateHash([{ config }], targetResource));
      await expect(db.update(schema.approvalRequests).set({ targetStateHash: 'changed' }).where(eq(schema.approvalRequests.id, row.id))).rejects.toThrow(/immutable/i);
    } finally {
      await db.delete(schema.connectorAccounts).where(eq(schema.connectorAccounts.id, connector!.id));
    }
  });

  it('deduplicates identical concurrent requests and preserves exact metadata', async () => {
    const input = proposal();
    const rows = await Promise.all([1, 2, 3].map(() => createApprovalRequest(db, { kind: 'owner' }, input)));
    const ids = rows.map((r) => value(r).id);
    expect(new Set(ids).size).toBe(1);
    const row = (await getApproval(db, ids[0]!))!;
    expect(row.requestingActorType).toBe('owner'); expect(row.requestingAgentId).toBeNull();
    expect(row.actionPayload).toEqual(input.actionPayload);
    expect(row.expectedImpact).toBe(input.expectedImpact); expect(row.risks).toBe(input.risks);
    await expect(db.update(schema.approvalRequests).set({ targetResource: 'changed' }).where(eq(schema.approvalRequests.id, row.id))).rejects.toThrow();
    await expect(db.update(schema.approvalRequests).set({ expiresAt: new Date(Date.now() + 30 * 60_000) }).where(eq(schema.approvalRequests.id, row.id))).rejects.toThrow();
  });

  it('requires current owner password and session; forged/reused proofs cannot decide', async () => {
    const row = await request();
    expect(await reauthenticateOwner(db, sessionId, 'incorrect-test-password')).toMatchObject({ ok: false, code: 'auth_failed' });
    expect(await reauthenticateOwner(db, 'not-a-session', password)).toMatchObject({ ok: false, code: 'auth_failed' });
    expect(await decideApproval(db, {} as OwnerAuthorization, row.id, 'approve')).toMatchObject({ ok: false, code: 'auth_failed' });
    const authorization = await proof();
    expect((await decideApproval(db, authorization, row.id, 'approve')).ok).toBe(true);
    expect(await decideApproval(db, authorization, row.id, 'approve')).toMatchObject({ ok: false, code: 'auth_failed' });
  });

  it('mints one grant for concurrent approvals; conflicting decisions cannot rewrite history', async () => {
    const row = await request();
    const a = await proof(); const b = await proof();
    const decisions = await Promise.all([decideApproval(db, a, row.id, 'approve'), decideApproval(db, b, row.id, 'approve')]);
    expect(value(decisions[0]!).grant!.id).toBe(value(decisions[1]!).grant!.id);
    expect(await decideApproval(db, await proof(), row.id, 'reject', 'Declined')).toMatchObject({ ok: false, code: 'conflict' });
    await expect(db.update(schema.approvalRequests).set({ status: 'rejected' }).where(eq(schema.approvalRequests.id, row.id))).rejects.toThrow();
  });

  it('rejects permanently and never mints a grant', async () => {
    const row = await request();
    expect(value(await decideApproval(db, await proof(), row.id, 'reject', 'Owner declined')).request.status).toBe('rejected');
    expect(await decideApproval(db, await proof(), row.id, 'approve')).toMatchObject({ ok: false, code: 'conflict' });
    expect(await db.select().from(schema.approvalGrants).where(eq(schema.approvalGrants.approvalRequestId, row.id))).toHaveLength(0);
  });

  it('enforces expiry bounds and expires pending requests without minting grants', async () => {
    expect(await createApprovalRequest(db, { kind: 'owner' }, proposal({ expiresAt: new Date(Date.now() + 100).toISOString() }))).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(await createApprovalRequest(db, { kind: 'owner' }, proposal({ expiresAt: new Date(Date.now() + 48 * 3600_000).toISOString() }))).toMatchObject({ ok: false, code: 'invalid_input' });
    const row = await request();
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 3600_000);
    expect((await getApproval(db, row.id))?.status).toBe('expired');
    expect(await decideApproval(db, await proof(), row.id, 'approve')).toMatchObject({ ok: false, code: 'expired' });
    expect((await listApprovals(db, 'expired')).some((r) => r.id === row.id)).toBe(true);
  });

  it('rejects credential-bearing and forged proposal fields', async () => {
    expect(await createApprovalRequest(db, { kind: 'owner' }, proposal({ actionPayload: { password: 'dummy-test-value' } })))
      .toMatchObject({ ok: false, code: 'secret_rejected' });
    expect(await createApprovalRequest(db, { kind: 'owner' }, proposal({ approved: true })))
      .toMatchObject({ ok: false, code: 'invalid_input' });
  });

  it('invalidates stale reauthentication and revoked sessions', async () => {
    const row = await request(); const authorization = await proof();
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 61_000);
    expect(await decideApproval(db, authorization, row.id, 'approve')).toMatchObject({ ok: false, code: 'auth_failed' });
    vi.useRealTimers();
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId));
    const second = await proof();
    await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
    expect(await decideApproval(db, second, row.id, 'approve')).toMatchObject({ ok: false, code: 'auth_failed' });
    await db.insert(schema.sessions).values(session!);
  });
});

describe('single-use capability consumption', () => {
  it('binds actor, action, target, and payload; forged JSON grants are refused', async () => {
    const row = await request(); const grant = await approve(row); const binding = approvalBinding(row);
    expect(await consumeApprovalGrant(db, { id: grant.id, approvalRequestId: row.id } as ApprovalGrant, binding)).toMatchObject({ ok: false, code: 'invalid_grant' });
    for (const changed of [
      { ...binding, targetResource: 'other-target' }, { ...binding, actionPayload: { message: 'Different action' } },
      { ...binding, actionType: 'payment' as const }, { ...binding, requester: { kind: 'agent' as const, agentId: 'doc' as const } },
    ]) expect(await consumeApprovalGrant(db, grant, changed)).toMatchObject({ ok: false, code: 'binding_mismatch' });
    expect((await grantRow(grant.id)).consumedAt).toBeNull();
  });

  it('consumes exactly once with one outbox record across concurrent and rehydrated handles', async () => {
    const row = await request(); const grant = await approve(row);
    const recovered = value(await loadApprovalGrant(db, grant.id));
    const results = await Promise.all([consumeApprovalGrant(db, grant, approvalBinding(row)), consumeApprovalGrant(db, recovered, approvalBinding(row))]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ code: 'already_consumed' });
    const rows = await db.select().from(schema.outbox).where(eq(schema.outbox.grantId, grant.id));
    expect(rows).toHaveLength(1); expect(rows[0]?.payload).toMatchObject(approvalBinding(row));
    await expect(db.update(schema.approvalGrants).set({ consumedAt: null }).where(eq(schema.approvalGrants.id, grant.id))).rejects.toThrow();
    await expect(db.update(schema.outbox).set({ payload: { altered: true } }).where(eq(schema.outbox.grantId, grant.id))).rejects.toThrow();
  });

  it('refuses an expired approved grant', async () => {
    const row = await request(); const grant = await approve(row);
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 3600_000);
    expect(await consumeApprovalGrant(db, grant, approvalBinding(row))).toMatchObject({ ok: false, code: 'expired' });
    expect((await grantRow(grant.id)).consumedAt).toBeNull();
  });

  it('revalidates the actual requesting agent rather than owner or DOC permissions', async () => {
    const row = value(await createApprovalRequest(db, { kind: 'agent', agentId: 'marty' }, proposal()));
    const grant = await approve(row);
    expect(await consumeApprovalGrant(db, grant, approvalBinding(row))).toMatchObject({ ok: false, code: 'permission_denied' });
    expect((await grantRow(grant.id)).consumedAt).toBeNull();
  });

  it('queues an agent action only when both its current grants and owner approval match', async () => {
    try {
      const approvedPolicy = {
        ...marty, allowedTools: [...marty.allowedTools, 'communications.send'],
        dataScopes: [...marty.dataScopes, 'communications:write'],
      };
      await db.update(schema.agents).set({ config: approvedPolicy }).where(eq(schema.agents.id, 'marty'));
      const row = value(await createApprovalRequest(db, { kind: 'agent', agentId: 'marty' }, proposal()));
      const grant = await approve(row);
      const consumed = value(await consumeApprovalGrant(db, grant, approvalBinding(row)));
      const [delivery] = await db.select().from(schema.outbox).where(eq(schema.outbox.id, consumed.outboxId));
      expect(delivery?.status).toBe('pending');
      expect(delivery?.payload).toMatchObject({
        requester: { kind: 'agent', agentId: 'marty' },
        requesterPolicyHash: stateHash({ enabled: true, policy: policyConfigSchema.parse(approvedPolicy) }),
      });
    } finally {
      await db.update(schema.agents).set({ config: marty }).where(eq(schema.agents.id, 'marty'));
    }
  });

  it('enforces approval and consumption guards even on direct SQL inserts', async () => {
    const pending = await request();
    await expect(db.insert(schema.approvalGrants).values({ approvalRequestId: pending.id }))
      .rejects.toThrow(/live approved request/i);
    const grant = await approve(pending);
    await expect(db.insert(schema.outbox).values({
      connector: 'mock', operation: pending.actionType, grantId: grant.id,
      idempotencyKey: `unconsumed:${pending.id}`,
      payload: { approvalRequestId: pending.id, ...approvalBinding(pending), expiresAt: pending.expiresAt.toISOString() },
    })).rejects.toThrow(/exact consumed approval/i);
    expect((await grantRow(grant.id)).consumedAt).toBeNull();
  });

  it('keeps worker DB permissions read-only for approvals/grants and forbids outbox creation', async () => {
    const row = await request(); const grant = await approve(row);
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE flux88_worker`);
      expect(await tx.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, row.id))).toHaveLength(1);
    });
    await expect(db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE flux88_worker`);
      await tx.update(schema.approvalRequests).set({ status: 'approved', decidedBy: 'owner', decidedAt: new Date() }).where(eq(schema.approvalRequests.id, row.id));
    })).rejects.toThrow(/permission denied/i);
    await expect(db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE flux88_worker`);
      await tx.insert(schema.approvalGrants).values({ approvalRequestId: row.id });
    })).rejects.toThrow(/permission denied/i);
    await expect(db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE flux88_worker`);
      await tx.update(schema.approvalGrants).set({ consumedAt: new Date() }).where(eq(schema.approvalGrants.id, grant.id));
    })).rejects.toThrow(/permission denied/i);
    await expect(db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE flux88_worker`);
      await tx.insert(schema.outbox).values({ connector: 'mock', operation: row.actionType,
        payload: {}, grantId: grant.id, idempotencyKey: `forged:${row.id}` });
    })).rejects.toThrow(/permission denied/i);
  });

  it('rolls back consumption when outbox persistence fails, allowing a safe retry', async () => {
    const row = await request(); const grant = await approve(row);
    await db.execute(sql`CREATE FUNCTION t040_fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated outbox failure'; END; $$`);
    try {
      await db.execute(sql`CREATE TRIGGER t040_fail_outbox BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION t040_fail_outbox()`);
      await expect(consumeApprovalGrant(db, grant, approvalBinding(row))).rejects.toThrow();
      expect((await grantRow(grant.id)).consumedAt).toBeNull();
      expect(await db.select().from(schema.outbox).where(eq(schema.outbox.grantId, grant.id))).toHaveLength(0);
    } finally {
      await db.execute(sql`DROP TRIGGER IF EXISTS t040_fail_outbox ON outbox`);
      await db.execute(sql`DROP FUNCTION t040_fail_outbox()`);
    }
    expect((await consumeApprovalGrant(db, grant, approvalBinding(row))).ok).toBe(true);
  });
});

describe('owner HTTP and approved agent configuration changes', () => {
  it('requires owner authentication and CSRF; exposes no grant-consume endpoint', async () => {
    expect((await http('/api/v1/approvals', proposal(), 'POST', false)).status).toBe(401);
    expect((await http('/api/v1/approvals', proposal(), 'POST', true, 'https://untrusted.example')).status).toBe(403);
    expect((await http(`/api/v1/internal/grants/${randomUUID()}/consume`, {})).status).toBe(404);
  });

  it('proposes policy changes, dedupes retries, and only applies the approved exact patch once', async () => {
    const patch = { allowedTools: [...marty.allowedTools, 'policy.read_fixture'] };
    const pending = await http('/api/v1/agents/marty/config', patch, 'PATCH');
    expect(pending.status).toBe(403);
    const id = (await decoded(pending)).approvalRequestId as string;
    const duplicate = await http('/api/v1/agents/marty/config', patch, 'PATCH');
    expect((await decoded(duplicate)).approvalRequestId).toBe(id);
    expect((await http(`/api/v1/approvals/${id}/approve`, { password: 'wrong-test-password' })).status).toBe(401);
    const approved = await http(`/api/v1/approvals/${id}/approve`, { password }); expect(approved.status).toBe(200);
    const grantId = (await decoded(approved)).grantId as string;
    expect((await http('/api/v1/agents/marty/config', { enabled: false, approvalGrantId: grantId }, 'PATCH')).status).toBe(409);
    const applied = await http('/api/v1/agents/marty/config', { ...patch, approvalGrantId: grantId }, 'PATCH');
    expect(applied.status).toBe(200);
    expect((await decoded(applied)).config?.allowedTools).toContain('policy.read_fixture');
    expect((await http('/api/v1/agents/marty/config', { ...patch, approvalGrantId: grantId }, 'PATCH')).status).toBe(409);
    const [delivery] = await db.select().from(schema.outbox).where(eq(schema.outbox.grantId, grantId));
    expect(delivery?.status).toBe('dispatched'); // local config update committed atomically, never dispatched twice
    await db.update(schema.agents).set({ config: marty, updatedAt: new Date() }).where(eq(schema.agents.id, 'marty'));
  });

  it('halts if the target changed between proposal and consumption', async () => {
    const row = value(await prepareAgentConfigChange(db, 'marty', { enabled: false })); const grant = await approve(row);
    await db.update(schema.agents).set({ personality: `${marty.personality} Updated.`, updatedAt: new Date() }).where(eq(schema.agents.id, 'marty'));
    expect(await consumeApprovalGrant(db, grant, approvalBinding(row))).toMatchObject({ ok: false, code: 'target_changed' });
    expect((await grantRow(grant.id)).consumedAt).toBeNull();
    await db.update(schema.agents).set({ personality: marty.personality, updatedAt: new Date() }).where(eq(schema.agents.id, 'marty'));
  });

  it('rolls back configuration, budget, grant and outbox when audit persistence fails', async () => {
    const [before] = await db.select().from(schema.agents).where(eq(schema.agents.id, 'marty'));
    const row = value(await prepareAgentConfigChange(db, 'marty', { budgets: { ...marty.budgets, maxTokensPerRun: marty.budgets.maxTokensPerRun + 1 } }));
    const grant = await approve(row);
    await db.execute(sql`CREATE FUNCTION t040_fail_consumed_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'approval.consumed' THEN RAISE EXCEPTION 'simulated audit failure'; END IF; RETURN NEW; END; $$`);
    try {
      await db.execute(sql`CREATE TRIGGER t040_fail_consumed_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION t040_fail_consumed_audit()`);
      await expect(consumeApprovalGrant(db, grant, approvalBinding(row))).rejects.toThrow();
      expect((await grantRow(grant.id)).consumedAt).toBeNull();
      const [after] = await db.select().from(schema.agents).where(eq(schema.agents.id, 'marty'));
      expect(after?.config).toEqual(before?.config);
      const [budget] = await db.select().from(schema.budgets).where(eq(schema.budgets.agentId, 'marty'));
      expect(budget?.maxTokensPerRun).toBe(marty.budgets.maxTokensPerRun);
      expect(await db.select().from(schema.outbox).where(eq(schema.outbox.grantId, grant.id))).toHaveLength(0);
    } finally {
      await db.execute(sql`DROP TRIGGER IF EXISTS t040_fail_consumed_audit ON audit_events`);
      await db.execute(sql`DROP FUNCTION t040_fail_consumed_audit()`);
    }
  });

  it('locks reauthentication after five failures and rejects the correct password during lockout', async () => {
    try {
      for (let i = 0; i < 5; i++) expect(await reauthenticateOwner(db, sessionId, 'incorrect-fixture-password'))
        .toMatchObject({ ok: false, code: 'auth_failed' });
      expect(await reauthenticateOwner(db, sessionId, password)).toMatchObject({ ok: false, code: 'auth_failed' });
    } finally {
      await db.update(schema.owner).set({ failedAttempts: 0, lockedUntil: null }).where(eq(schema.owner.id, 1));
    }
  });

});

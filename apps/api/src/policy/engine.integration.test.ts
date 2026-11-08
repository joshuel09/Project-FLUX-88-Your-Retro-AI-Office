/** T039 acceptance: current acting-agent config and durable structured policy audits. */
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AGENT_CONFIG_BY_ID } from '@flux88/agents';
import { listAudit, schema, type Db } from '@flux88/db';
import { connectTestDb } from '@flux88/db/testing';

import { evaluateAndAuditPolicy } from './engine.js';

let db: Db;
let endClient: () => Promise<void>;
const doc = AGENT_CONFIG_BY_ID.get('doc')!;
const marty = AGENT_CONFIG_BY_ID.get('marty')!;

beforeAll(async () => {
  const connection = connectTestDb();
  db = connection.db;
  endClient = () => connection.client.end();
  for (const config of [doc, marty]) {
    await db.insert(schema.agents).values({
      id: config.id, displayName: config.displayName, department: config.department,
      officeArea: config.officeArea, roleSummary: config.roleSummary,
      personality: config.personality, enabled: true, config,
    }).onConflictDoUpdate({ target: schema.agents.id, set: { config, enabled: true } });
  }
});

afterAll(async () => {
  if (db) {
    for (const config of [doc, marty]) {
      await db.update(schema.agents).set({ config, enabled: true }).where(eq(schema.agents.id, config.id));
    }
  }
  await endClient?.();
});

describe('persisted policy enforcement', () => {
  it('audits denial under the specialist identity without inheriting DOC access', async () => {
    expect(await evaluateAndAuditPolicy(db, 'doc', { operation: 'agents.read' })).toMatchObject({ allowed: true });
    expect(await evaluateAndAuditPolicy(db, 'marty', { operation: 'agents.read' })).toMatchObject({
      allowed: false, actorId: 'marty', code: 'tool_not_allowed',
    });
    const [event] = await listAudit(db, { actorId: 'marty', targetType: 'policy' });
    expect(event).toMatchObject({
      action: 'policy.denied', actorType: 'agent', actorId: 'marty',
      payload: { operation: 'agents.read', code: 'tool_not_allowed' },
    });
  });

  it('reloads permission changes and disabled state instead of caching registry defaults', async () => {
    expect(await evaluateAndAuditPolicy(db, 'marty', { operation: 'repo.read' })).toMatchObject({ allowed: true });
    try {
      await db.update(schema.agents).set({ config: { ...marty, dataScopes: ['tasks:own'] } }).where(eq(schema.agents.id, 'marty'));
      expect(await evaluateAndAuditPolicy(db, 'marty', { operation: 'repo.read' })).toMatchObject({
        allowed: false, code: 'scope_not_allowed',
      });
      await db.update(schema.agents).set({ enabled: false }).where(eq(schema.agents.id, 'marty'));
      expect(await evaluateAndAuditPolicy(db, 'marty', { operation: 'repo.read' })).toMatchObject({
        allowed: false, code: 'agent_disabled',
      });
    } finally {
      await db.update(schema.agents).set({ config: marty, enabled: true }).where(eq(schema.agents.id, 'marty'));
    }
  });

  it('denies and audits an otherwise permitted critical operation without executing it', async () => {
    try {
      await db.update(schema.agents).set({ config: {
        ...doc, allowedTools: ['payments.execute'], dataScopes: ['payments:write'],
        escalation: { criteria: [], approvalRequired: [] },
      } }).where(eq(schema.agents.id, 'doc'));
      expect(await evaluateAndAuditPolicy(db, 'doc', { operation: 'payment' })).toMatchObject({
        allowed: false, actorId: 'doc', actionType: 'payment', code: 'approval_required',
      });
      const [event] = await listAudit(db, { actorId: 'doc', targetType: 'policy' });
      expect(event).toMatchObject({ action: 'policy.denied', payload: { actionType: 'payment', code: 'approval_required' } });
    } finally {
      await db.update(schema.agents).set({ config: doc }).where(eq(schema.agents.id, 'doc'));
    }
  });

  it('never persists raw rejected identities or payloads to the audit trail', async () => {
    const hostile = 'password = example-not-a-real-secret';
    expect(await evaluateAndAuditPolicy(db, hostile, { operation: hostile })).toMatchObject({
      allowed: false, code: 'unknown_agent',
    });
    const [unknownIdentity] = await listAudit(db, { actorId: 'policy-engine', targetType: 'policy' });
    expect(JSON.stringify(unknownIdentity)).not.toContain(hostile);
    expect(await evaluateAndAuditPolicy(db, 'doc', { operation: hostile })).toMatchObject({
      allowed: false, code: 'unknown_operation',
    });
    const [unknownOperation] = await listAudit(db, { actorId: 'doc', targetType: 'policy' });
    expect(unknownOperation).toMatchObject({ action: 'policy.denied', targetId: 'rejected' });
    expect(JSON.stringify(unknownOperation)).not.toContain(hostile);
  });

  it('propagates audit failure instead of returning an unaudited allow decision', async () => {
    await db.execute(sql`
      CREATE FUNCTION reject_policy_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.target_type = 'policy' THEN RAISE EXCEPTION 'simulated policy audit failure'; END IF;
        RETURN NEW;
      END;
      $$;
    `);
    try {
      await db.execute(sql`CREATE TRIGGER reject_policy_review_audit BEFORE INSERT ON audit_events
        FOR EACH ROW EXECUTE FUNCTION reject_policy_review_audit()`);
      await expect(evaluateAndAuditPolicy(db, 'marty', { operation: 'repo.read' })).rejects.toThrow();
    } finally {
      await db.execute(sql`DROP TRIGGER IF EXISTS reject_policy_review_audit ON audit_events`);
      await db.execute(sql`DROP FUNCTION reject_policy_review_audit()`);
    }
  });

});

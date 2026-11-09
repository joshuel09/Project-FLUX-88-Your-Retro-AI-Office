import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTask, schema } from '@flux88/db';
import { connectTestDb, truncateMutableTables } from '@flux88/db/testing';
import { intakeNextAgentProposal, startAgentProposalIntake } from './agent-proposals.js';

const { db, client } = connectTestDb();
const { tasks, agentRuns, agentActionProposals, approvalRequests, approvalGrants, outbox } = schema;
const draft = { actionType: 'publish_content', actionPayload: { text: 'Owner review draft' }, targetResource: 'mock:announcement', expectedImpact: 'Publish a draft', risks: 'Public visibility' };
async function stage(action: unknown = draft, agentId: 'robin' | 'doc' = 'robin', ageMs = 0) {
  const task = await createTask(db, { title: 'Stage agent proposal', creator: 'owner', assigneeAgentId: agentId, status: 'awaiting_approval' });
  const run = await db.insert(agentRuns).values({ taskId: task.id, agentId, status: 'succeeded', idempotencyKey: `proposal-test:${task.id}` }).returning();
  await db.insert(agentActionProposals).values({ runId: run[0]!.id, proposal: action,
    ...(ageMs ? { createdAt: new Date(Date.now() - ageMs) } : {}) });
  return { task, run: run[0]! };
}
beforeAll(async () => { await truncateMutableTables(db); });
afterAll(async () => { await client.end(); });

describe('T042 API proposal intake', () => {
  it('derives the requester and task from the persisted run, creates one pending approval, and never grants or executes', async () => {
    const { task, run } = await stage({ ...draft, requestingAgentId: 'doc', taskId: 'forged' });
    // Forged identity/task fields are rejected by strict shared validation.
    expect(await intakeNextAgentProposal(db)).toBe('rejected');
    expect((await db.select().from(tasks).where(eq(tasks.id, task.id)))[0]?.status).toBe('blocked');
    expect((await db.select().from(agentActionProposals).where(eq(agentActionProposals.runId, run.id)))[0]?.status).toBe('rejected');
    expect(await db.select().from(approvalRequests)).toHaveLength(0);
    expect(await db.select().from(approvalGrants)).toHaveLength(0);
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it('creates one agent-bound approval when concurrent and replayed intake races', async () => {
    const { task, run } = await stage();
    expect((await Promise.all([intakeNextAgentProposal(db), intakeNextAgentProposal(db)])).sort()).toEqual(['created', 'idle']);
    expect(await intakeNextAgentProposal(db)).toBe('idle');
    const requests = await db.select().from(approvalRequests).where(eq(approvalRequests.taskId, task.id));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ requestingActorType: 'agent', requestingAgentId: 'robin', taskId: task.id, status: 'pending', actionType: 'publish_content' });
    const inbox = (await db.select().from(agentActionProposals).where(eq(agentActionProposals.runId, run.id)))[0];
    expect(inbox).toMatchObject({ status: 'accepted', approvalRequestId: requests[0]!.id });
    expect(await db.select().from(approvalGrants).where(eq(approvalGrants.approvalRequestId, requests[0]!.id))).toHaveLength(0);
    expect(await db.select().from(outbox)).toHaveLength(0);
    expect((await db.select().from(tasks).where(eq(tasks.id, task.id)))[0]?.status).toBe('awaiting_approval');
  });

  it('refuses stale proposals and releases the waiting task to owner-visible blocked state', async () => {
    const { task, run } = await stage(draft, 'robin', 15 * 60_000);
    expect(await intakeNextAgentProposal(db)).toBe('rejected');
    expect((await db.select().from(tasks).where(eq(tasks.id, task.id)))[0]?.status).toBe('blocked');
    expect((await db.select().from(agentActionProposals).where(eq(agentActionProposals.runId, run.id)))[0]?.rejectionCode).toBe('proposal_expired');
    expect(await db.select().from(approvalRequests).where(eq(approvalRequests.taskId, task.id))).toHaveLength(0);
  });

  it('rejects a disabled acting specialist without making an approval request', async () => {
    const { task } = await stage();
    await db.update(schema.agents).set({ enabled: false }).where(eq(schema.agents.id, 'robin'));
    try {
      expect(await intakeNextAgentProposal(db)).toBe('rejected');
      expect((await db.select().from(tasks).where(eq(tasks.id, task.id)))[0]?.status).toBe('blocked');
      expect(await db.select().from(approvalRequests).where(eq(approvalRequests.taskId, task.id))).toHaveLength(0);
    } finally { await db.update(schema.agents).set({ enabled: true }).where(eq(schema.agents.id, 'robin')); }
  });

  it('recovers durable pending proposals when the API intake poller starts', async () => {
    const { task } = await stage();
    let notifications = 0;
    let failures = 0;
    const intake = startAgentProposalIntake(db, () => { notifications++; }, () => { failures++; });
    try {
      await vi.waitFor(async () => {
        expect((await db.select().from(approvalRequests).where(eq(approvalRequests.taskId, task.id)))).toHaveLength(1);
      });
    } finally { await intake.close(); }
    expect(notifications).toBe(1);
    expect(failures).toBe(0);
  });

  it('does not persist a proposal when approval/audit transaction fails', async () => {
    const { task, run } = await stage();
    await db.execute(sql`CREATE FUNCTION test_proposal_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'approval.requested' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$`);
    await db.execute(sql`CREATE TRIGGER test_proposal_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION test_proposal_audit_failure()`);
    try { await expect(intakeNextAgentProposal(db)).rejects.toThrow(); }
    finally {
      await db.execute(sql`DROP TRIGGER test_proposal_audit_failure ON audit_events`);
      await db.execute(sql`DROP FUNCTION test_proposal_audit_failure()`);
    }
    expect((await db.select().from(agentActionProposals).where(eq(agentActionProposals.runId, run.id)))[0]?.status).toBe('pending');
    expect((await db.select().from(tasks).where(eq(tasks.id, task.id)))[0]?.status).toBe('awaiting_approval');
    expect(await db.select().from(approvalRequests).where(eq(approvalRequests.taskId, task.id))).toHaveLength(0);
  });
});

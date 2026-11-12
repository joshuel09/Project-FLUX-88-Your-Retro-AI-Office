import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTask, getTask, listRuns, transitionTask, schema } from '@flux88/db';
import { connectTestDb, truncateMutableTables } from '@flux88/db/testing';
import { MockProvider, type CompletionRequest } from '@flux88/llm';
import type { WorkerDeps } from '../deps.js';
import { runAgentTask } from './index.js';

const { db, client } = connectTestDb();
const proposal = {
  actionType: 'publish_content', actionPayload: { text: 'Mock draft for owner review' },
  targetResource: 'mock:content:announcement', expectedImpact: 'Publish the draft', risks: 'Public visibility',
};
class ProposingProvider extends MockProvider {
  constructor(private readonly action: unknown = proposal) { super(); }
  override async complete(request: CompletionRequest) {
    return { ...await super.complete(request), proposedAction: this.action };
  }
}
const deps: WorkerDeps = { db, provider: new ProposingProvider(), publish: async () => {},
  enqueueOrchestrate: async () => {}, enqueueRun: async () => {} };
beforeAll(async () => { await truncateMutableTables(db); });
afterAll(async () => { await client.end(); });

describe('T042 proposed-action runner', () => {
  it('waits for owner approval instead of completing a critical-action task', async () => {
    const task = await createTask(db, { title: 'Prepare an announcement', creator: 'owner', assigneeAgentId: 'robin', status: 'ready' });
    await runAgentTask(deps, task.id);
    expect((await getTask(db, task.id))?.status).toBe('awaiting_approval');
    expect(await listRuns(db, task.id)).toMatchObject([{ agentId: 'robin', status: 'succeeded' }]);
    expect((await getTask(db, task.id))!.tokensUsed).toBeGreaterThan(0);
    expect(await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.taskId, task.id))).toHaveLength(0);
    expect(await db.select().from(schema.approvalGrants)).toHaveLength(0);
    expect(await db.select().from(schema.outbox)).toHaveLength(0);
  });
  it.each([
    { ...proposal, requestingAgentId: 'doc' },
    { ...proposal, approved: true },
    { ...proposal, actionType: 'unknown_operation' },
    { ...proposal, actionPayload: { password: 'not-a-real-credential' } },
    { ...proposal, actionPayload: { text: 'x'.repeat(65_537) } },
  ])('fails closed on malformed, forged or secret-shaped proposal %#', async (action) => {
    const task = await createTask(db, { title: 'Refused proposal', creator: 'owner', assigneeAgentId: 'robin', status: 'ready' });
    await runAgentTask({ ...deps, provider: new ProposingProvider(action) }, task.id);
    expect((await getTask(db, task.id))?.status).toBe('failed');
    expect((await getTask(db, task.id))?.retryCount).toBe(0);
    expect(await listRuns(db, task.id)).toMatchObject([{ status: 'failed', error: 'proposal_rejected' }]);
    expect(await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.taskId, task.id))).toHaveLength(0);
  });

  it('does not turn a cancellation during generation into an approval wait', async () => {
    const task = await createTask(db, { title: 'Canceled draft', creator: 'owner', assigneeAgentId: 'robin', status: 'ready' });
    class CancelingProvider extends ProposingProvider {
      override async complete(request: CompletionRequest) {
        await transitionTask(db, task.id, 'canceled', { actorType: 'owner', actorId: 'owner' });
        return super.complete(request);
      }
    }
    await runAgentTask({ ...deps, provider: new CancelingProvider() }, task.id);
    expect((await getTask(db, task.id))?.status).toBe('canceled');
    expect(await listRuns(db, task.id)).toMatchObject([{ status: 'failed', error: 'proposal_rejected' }]);
  });
});

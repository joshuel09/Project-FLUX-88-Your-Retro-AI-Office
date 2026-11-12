import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { createTask, getTask, listRuns, schema } from '@flux88/db';
import { connectTestDb, truncateMutableTables } from '@flux88/db/testing';
import { MockProvider, type CompletionRequest } from '@flux88/llm';

import type { WorkerDeps } from '../deps.js';
import { runAgentTask } from './index.js';

const { db, client } = connectTestDb();

class OverBudgetProvider extends MockProvider {
  override async complete(request: CompletionRequest) {
    const result = await super.complete(request);
    return {
      ...result,
      content: 'partial output must not become an artifact',
      usage: { inputTokens: request.maxTokens, outputTokens: 1, costCents: 3 },
    };
  }
}

const deps: WorkerDeps = {
  db,
  provider: new OverBudgetProvider(),
  publish: async () => {},
  enqueueOrchestrate: async () => {},
  enqueueRun: async () => {},
};

beforeAll(async () => { await truncateMutableTables(db); });
afterAll(async () => { await client.end(); });

describe('T050 budget enforcement', () => {
  it('halts an over-budget run without retrying or saving partial output', async () => {
    const task = await createTask(db, {
      title: 'Budget boundary task',
      creator: 'owner',
      assigneeAgentId: 'marty',
      status: 'ready',
    });

    await runAgentTask(deps, task.id);

    expect(await getTask(db, task.id)).toMatchObject({ status: 'blocked', blockedReason: 'budget_exceeded', retryCount: 0 });
    expect(await listRuns(db, task.id)).toMatchObject([{
      status: 'halted_budget',
      error: 'budget_exceeded',
      inputTokens: 40_000,
      outputTokens: 1,
      costCents: 3,
    }]);
    expect(await db.select().from(schema.artifacts).where(eq(schema.artifacts.taskId, task.id))).toHaveLength(0);
    const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.targetId, task.id));
    expect(audit.map((event) => event.action)).toEqual(expect.arrayContaining(['task.transition', 'run.budget_halted']));
  });
});

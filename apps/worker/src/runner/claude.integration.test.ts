import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { createTask, getTask, listArtifacts, listRuns, schema } from '@flux88/db';
import { connectTestDb, truncateMutableTables } from '@flux88/db/testing';
import { ClaudeProvider } from '@flux88/llm';
import type { WorkerDeps } from '../deps.js';
import { runAgentTask } from './index.js';

const { db, client } = connectTestDb();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeAll(async () => { await truncateMutableTables(db); });
afterAll(async () => { await client.end(); });

describe('Claude task runner integration', () => {
  it('retries a provider failure once, then records usage and one artifact', async () => {
    let providerAttempts = 0;
    const provider = new ClaudeProvider({
      apiKey: 'test-only-key',
      model: 'claude-test',
      inputCostCentsPerMillion: 300,
      outputCostCentsPerMillion: 1_500,
      timeoutMs: 500,
      fetch: async () => {
        providerAttempts += 1;
        if (providerAttempts === 1) {
          return jsonResponse({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }, 529);
        }
        return jsonResponse({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: 'claude-test',
          content: [{ type: 'text', text: 'Completed through Claude.' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        });
      },
    });

    const enqueued: Array<[string, number]> = [];
    const deps: WorkerDeps = {
      db,
      provider,
      publish: async () => {},
      enqueueOrchestrate: async () => {},
      enqueueRun: async (taskId, attempt) => { enqueued.push([taskId, attempt]); },
    };
    const task = await createTask(db, {
      title: 'Claude provider retry task',
      creator: 'owner',
      assigneeAgentId: 'marty',
      retryLimit: 1,
      status: 'ready',
    });

    await runAgentTask(deps, task.id);
    expect(await getTask(db, task.id)).toMatchObject({ status: 'ready', retryCount: 1 });
    expect(enqueued).toEqual([[task.id, 1]]);

    await runAgentTask(deps, task.id);

    expect(providerAttempts).toBe(2);
    expect(await getTask(db, task.id)).toMatchObject({ status: 'completed', tokensUsed: 150, costCents: 1 });
    expect((await listRuns(db, task.id)).map((run) => run.status)).toEqual(['failed', 'succeeded']);
    expect((await listRuns(db, task.id))[1]).toMatchObject({ inputTokens: 100, outputTokens: 50, costCents: 1 });
    expect(await listArtifacts(db, task.id)).toHaveLength(1);
    const auditActions = await db.select({ action: schema.auditEvents.action })
      .from(schema.auditEvents).where(eq(schema.auditEvents.targetId, task.id));
    expect(auditActions.map((event) => event.action)).toContain('run.failed');
  });
});

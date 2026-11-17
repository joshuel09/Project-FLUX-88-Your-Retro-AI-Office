import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createTask, listAudit, schema } from '@flux88/db';
import { connectTestDb, truncateMutableTables } from '@flux88/db/testing';
import { MockEmbedder, writeMemory } from '@flux88/memory';
import type { CompletionRequest, CompletionResult, LLMProvider } from '@flux88/llm';
import type { AgentId } from '@flux88/core';

import type { WorkerDeps } from '../deps.js';
import { runAgentTask } from './index.js';

const { db, client } = connectTestDb();
const embedder = new MockEmbedder();

class MemoryProvider implements LLMProvider {
  readonly name = 'mock' as const;
  request?: CompletionRequest;

  constructor(private readonly memoryWrites?: unknown) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.request = request;
    return {
      content: 'Completed with the available memory context.',
      usage: { inputTokens: 10, outputTokens: 8, costCents: 0 },
      ...(this.memoryWrites === undefined ? {} : { memoryWrites: this.memoryWrites }),
    } as CompletionResult;
  }
}

async function execute(
  provider: MemoryProvider,
  title = 'Research scanline cache rate limits',
  agentId: AgentId = 'eleven',
  origin: 'local' | 'github' | 'trello' = 'local',
) {
  const task = await createTask(db, {
    title,
    description: 'Review scanline cache behavior and report evidence.',
    creator: 'owner',
    assigneeAgentId: agentId,
    origin,
    status: 'ready',
  });
  const deps: WorkerDeps = {
    db,
    provider,
    publish: async () => {},
    enqueueOrchestrate: async () => {},
    enqueueRun: async () => {},
  };
  await runAgentTask(deps, task.id);
}

beforeAll(async () => { await db.execute(sql`SELECT 1`); });
beforeEach(async () => { await truncateMutableTables(db); });
afterAll(async () => { await client.end(); });

describe('T059 agent memory runtime', () => {
  it('adds scoped memory with source and trust metadata to the prompt as untrusted data', async () => {
    const shared = await writeMemory(db, embedder, { kind: 'owner' }, {
      category: 'shared',
      title: 'Scanline cache rate limits',
      body: 'Batch scanline cache requests at 50 per minute.',
      sourceAttribution: 'owner research note',
      verificationStatus: 'verified',
      confidence: 0.93,
    });
    const privateEntry = await writeMemory(db, embedder, { kind: 'owner' }, {
      category: 'shared',
      title: 'Scanline cache rate limits',
      body: 'Private owner note that agents must not read.',
      scope: 'private',
      sourceAttribution: 'owner private note',
      verificationStatus: 'verified',
    });
    expect(shared.ok && privateEntry.ok).toBe(true);

    const provider = new MemoryProvider();
    await execute(provider);

    expect(provider.request?.prompt).toContain('<untrusted-data>');
    expect(provider.request?.prompt).toContain('source=tool_output');
    expect(provider.request?.prompt).toContain('owner research note');
    expect(provider.request?.prompt).toContain('"confidence": 0.93');
    expect(provider.request?.prompt).toContain('"verificationStatus": "verified"');
    expect(provider.request?.prompt).toContain('Batch scanline cache requests at 50 per minute.');
    expect(provider.request?.prompt).not.toContain('Private owner note that agents must not read.');
  });

  it('writes memory as the acting agent and keeps agent verification at proposed', async () => {
    const provider = new MemoryProvider([{
      category: 'shared',
      title: 'Agent lesson on request batching',
      body: 'Batch repeat requests after rate-limit feedback.',
      sourceAttribution: 'task result',
      verificationStatus: 'verified',
      confidence: 0.8,
    }, {
      category: 'shared',
      title: 'External rate-limit note',
      body: 'An external page reports a possible rate limit.',
      sourceAttribution: 'web page crawl',
      verificationStatus: 'untrusted',
    }]);
    await execute(provider, 'Research how to batch repeated requests');

    const entries = await db.select().from(schema.memoryEntries);
    const entry = entries.find((row) => row.title === 'Agent lesson on request batching');
    const externalEntry = entries.find((row) => row.title === 'External rate-limit note');
    expect(entry).toMatchObject({ author: 'eleven', category: 'shared', verificationStatus: 'proposed' });
    expect(externalEntry).toMatchObject({ author: 'eleven', verificationStatus: 'untrusted' });
    const audit = await listAudit(db, { targetType: 'memory', action: 'memory.write', limit: 20 });
    expect(audit).toContainEqual(expect.objectContaining({ actorType: 'agent', actorId: 'eleven', targetId: entry!.id }));
  });

  it('forces external-origin memory proposals to untrusted even when the provider omits the label', async () => {
    const provider = new MemoryProvider([{
      category: 'shared',
      title: 'External issue finding',
      body: 'An imported issue contains a rate-limit claim.',
      sourceAttribution: 'GitHub issue 42',
    }]);
    await execute(provider, 'Summarize imported issue', 'eleven', 'github');

    const [entry] = await db.select().from(schema.memoryEntries);
    expect(entry).toMatchObject({ author: 'eleven', verificationStatus: 'untrusted' });
  });

  it('refuses unauthorized and secret-shaped agent memory writes without logging content', async () => {
    const secret = 'ghp_123456789012345678901234567890123456';
    const provider = new MemoryProvider([
      { category: 'ops', title: 'Unauthorized ops note', body: 'No ops write grant.', sourceAttribution: 'task result' },
      { category: 'shared', title: 'Credential leak', body: `token=${secret}`, sourceAttribution: 'task result' },
      { category: 'project', title: 'Unbound project note', body: 'No trusted project id.', sourceAttribution: 'task result', projectId: 'other-project' },
    ]);
    await execute(provider, 'Research agent memory refusal cases');

    const entries = await db.select().from(schema.memoryEntries);
    expect(entries).toHaveLength(0);
    const audit = await listAudit(db, { targetType: 'memory', limit: 100 });
    expect(audit.map((event) => event.action)).toEqual(expect.arrayContaining([
      'memory.write_refused',
      'memory.secret_rejected',
    ]));
    expect(audit).toContainEqual(expect.objectContaining({ payload: expect.objectContaining({ reason: 'project_context_unavailable' }) }));
    expect(JSON.stringify(audit)).not.toContain(secret);
  });

  it('does not search or write when the agent lacks those tools', async () => {
    const ownerMemory = await writeMemory(db, embedder, { kind: 'owner' }, {
      category: 'shared',
      title: 'Tool gate memory',
      body: 'This entry should not reach marty.',
      sourceAttribution: 'owner note',
    });
    expect(ownerMemory.ok).toBe(true);
    const provider = new MemoryProvider([{
      category: 'shared',
      title: 'Unauthorized tool write',
      body: 'No memory.write tool grant.',
      sourceAttribution: 'task result',
    }]);
    await execute(provider, 'Research tool gate memory', 'marty');

    expect(provider.request?.prompt).not.toContain('This entry should not reach marty.');
    expect(await db.select().from(schema.memoryEntries)).toHaveLength(1);
    const audit = await listAudit(db, { actorId: 'marty', targetType: 'memory', action: 'memory.write_refused', limit: 10 });
    expect(audit).toContainEqual(expect.objectContaining({ payload: expect.objectContaining({ reason: 'tool_not_granted' }) }));
  });
});

import { z } from 'zod';

import type { PolicyConfig } from '@flux88/agents';
import type { AgentId } from '@flux88/core';
import { writeAudit, type Db } from '@flux88/db';
import {
  MEMORY_CATEGORIES,
  MockEmbedder,
  readableCategories,
  searchSemantic,
  writeMemory,
  type MemoryWriteInput,
} from '@flux88/memory';
import { assemblePrompt, tagUntrustedContent } from '@flux88/llm';

const embedder = new MockEmbedder();
const memoryWriteSchema = z.object({
  category: z.enum(MEMORY_CATEGORIES),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
  scope: z.enum(['shared', 'project', 'private']).optional(),
  projectId: z.string().max(100).optional(),
  sourceAttribution: z.string().min(1).max(300),
  verificationStatus: z.enum(['verified', 'proposed', 'untrusted']).optional(),
  confidence: z.number().min(0).max(1).optional(),
}).strict();
const memoryWritesSchema = z.array(memoryWriteSchema).max(3);

export async function assembleAgentPrompt(
  db: Db,
  agentId: AgentId,
  policy: PolicyConfig,
  taskText: string,
): Promise<{ prompt: string; hasUntrustedMemory: boolean }> {
  if (!policy.allowedTools.includes('memory.search')) return { prompt: taskText, hasUntrustedMemory: false };
  const hits = await searchSemantic(db, embedder, taskText, {
    categories: readableCategories({ kind: 'agent', policy }),
    actor: { kind: 'agent', agentId },
    limit: 5,
  });
  const entries = hits.map((hit) => tagUntrustedContent('tool_output', JSON.stringify({
    id: hit.id,
    category: hit.category,
    scope: hit.scope,
    projectId: hit.projectId,
    sourceAttribution: hit.sourceAttribution,
    createdAt: hit.createdAt,
    confidence: hit.confidence,
    verificationStatus: hit.verificationStatus,
    title: hit.title,
    content: hit.body,
  }, null, 2)));
  return {
    prompt: assemblePrompt(taskText, entries),
    hasUntrustedMemory: hits.some((hit) => hit.verificationStatus === 'untrusted'),
  };
}

export async function persistAgentMemoryWrites(
  db: Db,
  agentId: AgentId,
  policy: PolicyConfig,
  output: unknown,
  forceUntrusted: boolean,
): Promise<void> {
  if (output === undefined) return;
  const audit = { actorType: 'agent' as const, actorId: agentId };
  if (!policy.allowedTools.includes('memory.write')) {
    await writeAudit(db, {
      ...audit,
      action: 'memory.write_refused',
      targetType: 'memory',
      targetId: 'tool',
      payload: { reason: 'tool_not_granted' },
    });
    return;
  }

  const parsed = memoryWritesSchema.safeParse(output);
  if (!parsed.success) {
    await writeAudit(db, {
      ...audit,
      action: 'memory.write_refused',
      targetType: 'memory',
      targetId: 'invalid',
      payload: { reason: 'invalid_tool_output' },
    });
    return;
  }

  for (const proposal of parsed.data) {
    if (proposal.projectId || proposal.scope === 'project' || proposal.category === 'project') {
      await writeAudit(db, {
        ...audit,
        action: 'memory.write_refused',
        targetType: 'memory',
        targetId: proposal.category,
        payload: { category: proposal.category, reason: 'project_context_unavailable' },
      });
      continue;
    }
    const verificationStatus = forceUntrusted || proposal.verificationStatus === 'untrusted'
      ? 'untrusted'
      : 'proposed';
    await writeMemory(db, embedder, { kind: 'agent', agentId, policy }, {
      ...proposal,
      verificationStatus,
    } as MemoryWriteInput);
  }
}

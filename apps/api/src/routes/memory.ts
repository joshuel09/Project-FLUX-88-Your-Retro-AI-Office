/**
 * Memory Vault API (T036) — contracts/api.md "Memory Vault". The dashboard
 * caller is always the authenticated owner; agent/system writes go through
 * the service in the worker. Secret-shaped content is rejected server-side
 * regardless of caller (FR-024).
 */
import { Hono } from 'hono';
import { z } from 'zod';

import type { Db } from '@flux88/db';
import {
  MEMORY_CATEGORIES,
  MockEmbedder,
  correctMemory,
  getMemory,
  readableCategories,
  revokeMemory,
  searchKeyword,
  searchSemantic,
  writeMemory,
} from '@flux88/memory';

import { emitEvent } from '../events.js';

const OWNER = { kind: 'owner' } as const;

const writeSchema = z
  .object({
    category: z.enum(MEMORY_CATEGORIES),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(8000),
    scope: z.enum(['shared', 'project', 'private']).optional(),
    projectId: z.string().max(100).optional(),
    sourceAttribution: z.string().max(300).optional(),
    verificationStatus: z.enum(['verified', 'proposed', 'untrusted']).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

const correctSchema = z
  .object({ body: z.string().min(1).max(8000), changeNote: z.string().max(300).optional() })
  .strict();

const idSchema = z.string().uuid();

export function memoryRoutes(db: Db) {
  const app = new Hono();
  const embedder = new MockEmbedder();

  app.get('/search', async (c) => {
    const q = c.req.query('q') ?? '';
    const mode = c.req.query('mode') === 'semantic' ? 'semantic' : 'keyword';
    const categories = readableCategories(OWNER);
    const items =
      mode === 'semantic'
        ? await searchSemantic(db, embedder, q, { categories })
        : await searchKeyword(db, q, { categories });
    return c.json({ mode, items });
  });

  app.post('/', async (c) => {
    const body = writeSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: { code: 'invalid_input', message: 'Invalid memory entry' } }, 400);

    const result = await writeMemory(db, embedder, OWNER, body.data);
    if (!result.ok) {
      return c.json({ error: { code: result.code, message: result.message } }, result.code === 'forbidden' ? 403 : 422);
    }
    emitEvent({ channel: 'audit', data: { kind: 'memory.write', memoryId: result.entry.id, deduped: result.deduped } });
    return c.json(result.entry, result.deduped ? 200 : 201);
  });

  app.get('/:id', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: { code: 'not_found', message: 'Unknown memory entry' } }, 404);
    const detail = await getMemory(db, id.data);
    return detail ? c.json(detail) : c.json({ error: { code: 'not_found', message: 'Unknown memory entry' } }, 404);
  });

  app.patch('/:id', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: { code: 'not_found', message: 'Unknown memory entry' } }, 404);
    const body = correctSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: { code: 'invalid_input', message: 'Invalid correction' } }, 400);

    const result = await correctMemory(db, embedder, OWNER, id.data, body.data);
    if (!result.ok) {
      return c.json({ error: { code: result.code, message: result.message } }, result.code === 'not_found' ? 404 : 403);
    }
    emitEvent({ channel: 'audit', data: { kind: 'memory.correct', memoryId: id.data } });
    return c.json(result.entry);
  });

  app.post('/:id/revoke', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: { code: 'not_found', message: 'Unknown memory entry' } }, 404);
    const result = await revokeMemory(db, OWNER, id.data);
    if (!result.ok) {
      return c.json({ error: { code: result.code, message: result.message } }, result.code === 'not_found' ? 404 : 403);
    }
    emitEvent({ channel: 'audit', data: { kind: 'memory.revoke', memoryId: id.data } });
    return c.json(result.entry);
  });

  return app;
}

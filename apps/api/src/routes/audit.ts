import { Hono } from 'hono';
import { z } from 'zod';

import type { Db } from '@flux88/db';
import { listAudit } from '@flux88/db';

const limitSchema = z.coerce.number().int().min(1).max(100);
const filterSchema = z.object({
  actorId: z.string().min(1).max(100).optional(),
  targetType: z.string().min(1).max(100).optional(),
  action: z.string().min(1).max(120).optional(),
});

function readLimit(value: string | undefined) {
  const parsed = limitSchema.safeParse(value ?? '50');
  return parsed.success ? parsed.data : null;
}

/** Mounted only under the authenticated-owner API. */
export function auditRoutes(db: Db) {
  const app = new Hono();
  app.get('/', async (c) => {
    const limit = readLimit(c.req.query('limit'));
    if (limit === null) return c.json({ error: { code: 'invalid_input', message: 'Invalid limit' } }, 400);
    const filters = filterSchema.safeParse({
      actorId: c.req.query('actorId'),
      targetType: c.req.query('targetType'),
      action: c.req.query('action'),
    });
    if (!filters.success) return c.json({ error: { code: 'invalid_input', message: 'Invalid audit filter' } }, 400);
    const { actorId, targetType, action } = filters.data;
    return c.json({ items: await listAudit(db, {
      limit,
      ...(actorId ? { actorId } : {}),
      ...(targetType ? { targetType } : {}),
      ...(action ? { action } : {}),
    }) });
  });
  return app;
}

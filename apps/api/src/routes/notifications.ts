import { Hono } from 'hono';
import { z } from 'zod';

import type { Db } from '@flux88/db';
import { listNotifications } from '@flux88/db';

const limitSchema = z.coerce.number().int().min(1).max(100);

/** Mounted only under the authenticated-owner API. */
export function notificationRoutes(db: Db) {
  const app = new Hono();
  app.get('/', async (c) => {
    const parsed = limitSchema.safeParse(c.req.query('limit') ?? '50');
    if (!parsed.success) return c.json({ error: { code: 'invalid_input', message: 'Invalid limit' } }, 400);
    return c.json({ items: await listNotifications(db, parsed.data) });
  });
  return app;
}

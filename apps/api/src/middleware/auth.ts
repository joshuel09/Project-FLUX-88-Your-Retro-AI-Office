import type { MiddlewareHandler } from 'hono';

import type { Db } from '@flux88/db';

import { sessionFromRequest } from '../auth/sessions.js';

/** Owner-session gate for everything under /api/v1 (FR-072). */
export function requireOwner(db: Db): MiddlewareHandler {
  return async (c, next) => {
    const session = await sessionFromRequest(c, db);
    if (!session) {
      return c.json({ error: { code: 'unauthenticated', message: 'Not signed in' } }, 401);
    }
    c.set('sessionId', session.id);
    await next();
  };
}

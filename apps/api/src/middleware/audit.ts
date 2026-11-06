import type { MiddlewareHandler } from 'hono';

import type { Db } from '@flux88/db';
import { writeAudit } from '@flux88/db';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Every successful mutation is audited (FR-070). Route handlers may write
 * richer domain events; this middleware guarantees the floor.
 * Bodies are NOT logged — payload carries only method/path (no personal data in logs).
 */
export function auditMutations(db: Db): MiddlewareHandler {
  return async (c, next) => {
    await next();
    if (!MUTATING.has(c.req.method)) return;
    if (c.res.status >= 400) return;
    if (c.req.path.startsWith('/api/v1/auth')) return; // auth routes write their own events
    await writeAudit(db, {
      actorType: 'owner',
      actorId: 'session',
      action: `http.${c.req.method.toLowerCase()}`,
      targetType: 'route',
      targetId: c.req.path,
      payload: { status: c.res.status },
    });
  };
}

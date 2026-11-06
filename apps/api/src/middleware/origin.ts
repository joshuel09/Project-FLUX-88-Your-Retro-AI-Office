import type { MiddlewareHandler } from 'hono';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * CSRF hardening beyond hono/csrf (which only covers form content-types):
 * any mutating request that carries a browser Origin header must match the
 * allowlist. Requests without an Origin (curl, server-to-server, tests) are
 * not browser CSRF vectors and pass through to cookie auth.
 */
export function strictOrigin(allowed: string[]): MiddlewareHandler {
  const allowlist = new Set(allowed);
  return async (c, next) => {
    if (MUTATING.has(c.req.method)) {
      const origin = c.req.header('origin');
      if (origin && !allowlist.has(origin)) {
        return c.json({ error: { code: 'forbidden_origin', message: 'Cross-origin request refused' } }, 403);
      }
    }
    await next();
  };
}

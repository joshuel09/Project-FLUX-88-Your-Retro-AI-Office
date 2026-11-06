import { Hono } from 'hono';
import { z } from 'zod';

import type { Db } from '@flux88/db';
import {
  createOwner,
  getOwner,
  recordFailedLogin,
  resetLoginFailures,
  writeAudit,
} from '@flux88/db';

import { DUMMY_HASH_PROMISE, hashPassword, verifyPassword } from './passwords.js';
import { destroySession, rotateSession, sessionFromRequest } from './sessions.js';

const LOCK_THRESHOLD = 5; // constitution: lock after 5 consecutive failures
const LOCK_MINUTES = 15;
/** Generic by design — must not reveal whether the email exists (constitution). */
const GENERIC_AUTH_ERROR = { error: { code: 'auth_failed', message: 'ID or password is incorrect' } };

const credentialsSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(12).max(256),
});

export function authRoutes(db: Db) {
  const app = new Hono();

  /** One-time owner setup — only while no owner exists (single-owner deployment). */
  app.post('/setup', async (c) => {
    const body = credentialsSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: { code: 'invalid_input', message: 'Email and a password of at least 12 characters are required' } }, 400);
    }
    const existing = await getOwner(db);
    if (existing) return c.json({ error: { code: 'already_configured', message: 'Owner already configured' } }, 409);

    const passwordHash = await hashPassword(body.data.password);
    await createOwner(db, body.data.email, passwordHash);
    await writeAudit(db, { actorType: 'owner', actorId: body.data.email, action: 'owner.setup', targetType: 'owner', targetId: '1' });
    await rotateSession(c, db);
    return c.json({ ok: true }, 201);
  });

  app.post('/login', async (c) => {
    const body = credentialsSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(GENERIC_AUTH_ERROR, 401);

    const owner = await getOwner(db);

    // Unknown email or no owner: verify against a dummy hash so timing matches.
    if (!owner || owner.email !== body.data.email) {
      await verifyPassword(await DUMMY_HASH_PROMISE, body.data.password);
      return c.json(GENERIC_AUTH_ERROR, 401);
    }

    if (owner.lockedUntil && owner.lockedUntil.getTime() > Date.now()) {
      // Same generic message: lockout must not be a user-existence oracle.
      await verifyPassword(await DUMMY_HASH_PROMISE, body.data.password);
      return c.json(GENERIC_AUTH_ERROR, 401);
    }

    const valid = await verifyPassword(owner.passwordHash, body.data.password);
    if (!valid) {
      await recordFailedLogin(db, LOCK_THRESHOLD, LOCK_MINUTES);
      await writeAudit(db, { actorType: 'system', actorId: 'auth', action: 'owner.login_failed', targetType: 'owner', targetId: '1' });
      return c.json(GENERIC_AUTH_ERROR, 401);
    }

    await resetLoginFailures(db);
    await rotateSession(c, db); // session ID re-issued on login (constitution)
    await writeAudit(db, { actorType: 'owner', actorId: owner.email, action: 'owner.login', targetType: 'owner', targetId: '1' });
    return c.json({ ok: true });
  });

  app.post('/logout', async (c) => {
    await destroySession(c, db);
    return c.json({ ok: true });
  });

  app.get('/me', async (c) => {
    const session = await sessionFromRequest(c, db);
    if (!session) return c.json({ error: { code: 'unauthenticated', message: 'Not signed in' } }, 401);
    const owner = await getOwner(db);
    return c.json({ ok: true, email: owner?.email ?? null, sessionExpiresAt: session.expiresAt });
  });

  return app;
}

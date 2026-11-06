import { eq, lt } from 'drizzle-orm';

import type { Db } from '../client.js';
import { owner, sessions } from '../schema/index.js';

export async function getOwner(db: Db) {
  const [row] = await db.select().from(owner).where(eq(owner.id, 1));
  return row ?? null;
}

export async function createOwner(db: Db, email: string, passwordHash: string) {
  const [row] = await db.insert(owner).values({ id: 1, email, passwordHash }).returning();
  return row;
}

export async function recordFailedLogin(db: Db, lockThreshold: number, lockMinutes: number) {
  const current = await getOwner(db);
  if (!current) return;
  const failed = current.failedAttempts + 1;
  await db
    .update(owner)
    .set({
      failedAttempts: failed,
      lockedUntil:
        failed >= lockThreshold ? new Date(Date.now() + lockMinutes * 60_000) : current.lockedUntil,
      updatedAt: new Date(),
    })
    .where(eq(owner.id, 1));
}

export async function resetLoginFailures(db: Db) {
  await db
    .update(owner)
    .set({ failedAttempts: 0, lockedUntil: null, updatedAt: new Date() })
    .where(eq(owner.id, 1));
}

export async function createSession(db: Db, id: string, ttlMs: number) {
  const [row] = await db
    .insert(sessions)
    .values({ id, expiresAt: new Date(Date.now() + ttlMs) })
    .returning();
  return row;
}

export async function getSession(db: Db, id: string) {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await deleteSession(db, id);
    return null;
  }
  return row;
}

export async function deleteSession(db: Db, id: string) {
  await db.delete(sessions).where(eq(sessions.id, id));
}

export async function purgeExpiredSessions(db: Db) {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

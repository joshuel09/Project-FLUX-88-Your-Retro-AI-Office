import { randomBytes } from 'node:crypto';

import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import type { Db } from '@flux88/db';
import { createSession, deleteSession, getSession } from '@flux88/db';

export const SESSION_COOKIE = 'flux88_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

/** Session IDs live in the cookie only — never in URLs (constitution). */
export async function issueSession(c: Context, db: Db): Promise<string> {
  const id = newSessionId();
  await createSession(db, id, SESSION_TTL_MS);
  setCookie(c, SESSION_COOKIE, id, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
  return id;
}

/** Re-issue on login: old session destroyed, new ID minted (constitution). */
export async function rotateSession(c: Context, db: Db): Promise<string> {
  const existing = getCookie(c, SESSION_COOKIE);
  if (existing) await deleteSession(db, existing);
  return issueSession(c, db);
}

export async function destroySession(c: Context, db: Db): Promise<void> {
  const existing = getCookie(c, SESSION_COOKIE);
  if (existing) await deleteSession(db, existing);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export async function sessionFromRequest(c: Context, db: Db) {
  const id = getCookie(c, SESSION_COOKIE);
  if (!id) return null;
  return getSession(db, id);
}

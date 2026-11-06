/**
 * Auth integration tests (T011): lockout after 5 failures, generic errors,
 * session re-issue on login, auth gate on /api/v1.
 * Requires dockerized Postgres: `pnpm db:up && pnpm --filter @flux88/db db:migrate`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '@flux88/config';
import { connectTestDb, TEST_DATABASE_URL, truncateMutableTables } from '@flux88/db/testing';

import { createApp } from '../app.js';

const config = loadConfig({ ...process.env, DATABASE_URL: TEST_DATABASE_URL });
const { db, client } = connectTestDb();
const { app } = createApp({ config, db });

const ORIGIN = { Origin: new URL(config.WEB_URL).origin, 'Content-Type': 'application/json' };
const OWNER = { email: 'owner@example.test', password: 'correct-horse-battery-88' };

async function post(path: string, body: unknown, extra: Record<string, string> = {}) {
  return app.request(path, { method: 'POST', headers: { ...ORIGIN, ...extra }, body: JSON.stringify(body) });
}

function cookieOf(res: Response): string {
  const raw = res.headers.get('set-cookie') ?? '';
  return raw.split(';')[0] ?? '';
}

beforeAll(async () => {
  await truncateMutableTables(db);
});
beforeEach(async () => {
  await truncateMutableTables(db);
});
afterAll(async () => {
  await client.end();
});

describe('owner auth (constitution Security Requirements)', () => {
  it('sets up the owner once, then refuses', async () => {
    expect((await post('/api/v1/auth/setup', OWNER)).status).toBe(201);
    expect((await post('/api/v1/auth/setup', OWNER)).status).toBe(409);
  });

  it('returns the same generic error for wrong password and unknown email', async () => {
    await post('/api/v1/auth/setup', OWNER);
    const wrongPassword = await post('/api/v1/auth/login', { ...OWNER, password: 'wrong-password-123456' });
    const unknownEmail = await post('/api/v1/auth/login', { email: 'ghost@example.test', password: 'whatever-password-1' });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownEmail.json());
  });

  it('locks the account after 5 consecutive failures — correct password then refused', async () => {
    await post('/api/v1/auth/setup', OWNER);
    for (let i = 0; i < 5; i++) {
      await post('/api/v1/auth/login', { ...OWNER, password: 'wrong-password-123456' });
    }
    const locked = await post('/api/v1/auth/login', OWNER);
    expect(locked.status).toBe(401); // same generic error while locked
  });

  it('re-issues the session ID on login', async () => {
    const setup = await post('/api/v1/auth/setup', OWNER);
    const first = cookieOf(setup);
    const login = await post('/api/v1/auth/login', OWNER, { Cookie: first });
    const second = cookieOf(login);
    expect(second).not.toEqual('');
    expect(second).not.toEqual(first);
    // old session is dead
    const meOld = await app.request('/api/v1/auth/me', { headers: { Cookie: first } });
    expect(meOld.status).toBe(401);
    const meNew = await app.request('/api/v1/auth/me', { headers: { Cookie: second } });
    expect(meNew.status).toBe(200);
  });

  it('gates /api/v1 resources behind the session', async () => {
    expect((await app.request('/api/v1/agents')).status).toBe(401);
    const setup = await post('/api/v1/auth/setup', OWNER);
    const res = await app.request('/api/v1/agents', { headers: { Cookie: cookieOf(setup) } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(18);
  });

  it('rejects cross-origin mutations (CSRF)', async () => {
    const res = await post('/api/v1/auth/setup', OWNER, { Origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });
});

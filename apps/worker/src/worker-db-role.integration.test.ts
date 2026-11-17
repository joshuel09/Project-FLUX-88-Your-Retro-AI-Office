import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbWithClient } from '@flux88/db';
import { connectTestDb, TEST_DATABASE_URL } from '@flux88/db/testing';

import { assertWorkerDatabaseRole } from './worker-db-role.js';

const login = 'flux88_worker_test_login';
const password = randomBytes(32).toString('hex');
const admin = connectTestDb();
const workerUrl = new URL(TEST_DATABASE_URL);
workerUrl.username = login;
workerUrl.password = password;
const worker = createDbWithClient(workerUrl.toString());

beforeAll(async () => {
  const [role] = await admin.db.execute(sql`
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flux88_worker') AS "exists"
  `);
  if (!(role as unknown as { exists: boolean }).exists) {
    throw new Error('Run migrations before worker database role integration tests.');
  }

  await admin.db.execute(sql.raw(`DROP ROLE IF EXISTS ${login}`));
  const [command] = await admin.db.execute(sql`
    SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', ${login}::text, ${password}::text) AS statement
  `);
  await admin.db.execute(sql.raw((command as unknown as { statement: string }).statement));
  await admin.db.execute(sql.raw(`GRANT flux88_worker TO ${login}`));
});

afterAll(async () => {
  await worker.client.end();
  await admin.db.execute(sql.raw(`DROP ROLE IF EXISTS ${login}`));
  await admin.client.end();
});

describe('worker database role', () => {
  it('accepts a separate non-superuser login with only the worker role', async () => {
    await expect(assertWorkerDatabaseRole(worker.db)).resolves.toBeUndefined();
    await expect(worker.db.execute(sql`UPDATE agents SET enabled = enabled`)).rejects.toBeDefined();
    await expect(worker.db.execute(sql`SET ROLE flux88`)).rejects.toBeDefined();
  });

  it('rejects a superuser database login', async () => {
    await expect(assertWorkerDatabaseRole(admin.db)).rejects.toThrow(
      'Worker database credentials must be a non-superuser member of flux88_worker.',
    );
  });
});

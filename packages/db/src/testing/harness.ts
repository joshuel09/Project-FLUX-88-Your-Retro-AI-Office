/**
 * Integration-test harness (T004): connects to the dockerized Postgres from
 * infra/docker-compose.yml and truncates mutable tables between tests.
 * Start services first: `pnpm db:up && pnpm db:migrate`.
 */
import { sql } from 'drizzle-orm';

import { createDbWithClient } from '../client.js';

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://flux88:flux88_local_dev@localhost:5488/flux88';

export function connectTestDb() {
  return createDbWithClient(TEST_DATABASE_URL);
}

/** Truncate everything except the seeded registry (agents, budgets, connectors). */
export async function truncateMutableTables(db: ReturnType<typeof connectTestDb>['db']) {
  await db.execute(sql`
    TRUNCATE TABLE
      outbox,
      approval_grants,
      approval_requests,
      notifications,
      external_links,
      artifacts,
      agent_runs,
      handoffs,
      task_dependencies,
      memory_versions,
      memory_entries,
      sessions,
      owner,
      tasks
    RESTART IDENTITY CASCADE
  `);
  // audit_events is append-only (trigger-protected): tests must tolerate rows
  // from earlier runs instead of truncating them.
}

export async function isDbReachable(): Promise<boolean> {
  try {
    const { db, client } = connectTestDb();
    await db.execute(sql`SELECT 1`);
    await client.end();
    return true;
  } catch {
    return false;
  }
}

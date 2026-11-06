/**
 * @flux88/db — Drizzle schema, migrations, repositories.
 * All queries are parameterized by construction (constitution Security Requirements).
 */
export { createDb, createDbWithClient, type Db } from './client.js';
export * as schema from './schema/index.js';
export * from './repos/index.js';

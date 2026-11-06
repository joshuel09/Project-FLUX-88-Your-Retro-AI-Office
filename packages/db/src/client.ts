import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.js';

export type Db = ReturnType<typeof createDb>;

export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10, onnotice: () => {} });
  return drizzle(client, { schema });
}

/** For scripts/tests that must close the socket when done. */
export function createDbWithClient(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 5, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return { db, client };
}

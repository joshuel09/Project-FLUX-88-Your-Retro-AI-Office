import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { loadConfig } from '@flux88/config';
import { createDbWithClient } from './client.js';

const { DATABASE_URL } = loadConfig();
const { db, client } = createDbWithClient(DATABASE_URL);

try {
  await migrate(db, { migrationsFolder: new URL('../migrations', import.meta.url).pathname });
  console.log('[flux88-db] migrations applied');
} finally {
  await client.end();
}

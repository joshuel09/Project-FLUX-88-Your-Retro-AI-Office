import { asc } from 'drizzle-orm';

import type { Db } from '../client.js';
import { connectorAccounts } from '../schema/index.js';

export async function listConnectorAccounts(db: Db) {
  return db.select().from(connectorAccounts).orderBy(asc(connectorAccounts.provider), asc(connectorAccounts.id));
}

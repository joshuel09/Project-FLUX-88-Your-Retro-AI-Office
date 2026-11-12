import { asc } from 'drizzle-orm';

import type { Db } from '../client.js';
import { connectorAccounts } from '../schema/index.js';

export async function listConnectorAccounts(db: Db) {
  return db
    .select({
      id: connectorAccounts.id,
      provider: connectorAccounts.provider,
      mode: connectorAccounts.mode,
      lastSyncAt: connectorAccounts.lastSyncAt,
    })
    .from(connectorAccounts)
    .orderBy(asc(connectorAccounts.provider), asc(connectorAccounts.id));
}

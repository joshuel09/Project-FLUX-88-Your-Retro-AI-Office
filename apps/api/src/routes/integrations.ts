import { Hono } from 'hono';

import { getMockConnectorAdapter } from '@flux88/connectors';
import type { Db } from '@flux88/db';
import { listConnectorAccounts } from '@flux88/db';

/** Mounted only under the authenticated-owner API. Account config is never returned. */
export function integrationRoutes(db: Db) {
  const app = new Hono();
  app.get('/', async (c) => {
    const accounts = await listConnectorAccounts(db);
    const items = accounts.map((account) => {
      const adapter = getMockConnectorAdapter(account.provider);
      return {
        id: account.id,
        provider: account.provider,
        mode: account.mode,
        adapterMode: adapter?.mode ?? 'unavailable',
        health: adapter?.health() ?? {
          status: 'unknown',
          message: 'No mock adapter is available.',
          checkedAt: new Date().toISOString(),
          simulated: true,
        },
        lastSyncAt: account.lastSyncAt,
        mock: Boolean(adapter),
      };
    });
    return c.json({ items });
  });
  return app;
}

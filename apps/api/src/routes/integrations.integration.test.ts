import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '@flux88/config';
import { MOCK_CONNECTOR_ADAPTERS } from '@flux88/connectors';
import { connectTestDb, TEST_DATABASE_URL, truncateMutableTables } from '@flux88/db/testing';

import { createApp } from '../app.js';

const config = loadConfig({ ...process.env, DATABASE_URL: TEST_DATABASE_URL });
const connection = connectTestDb();
const app = createApp({ db: connection.db, config }).app;
const origin = new URL(config.WEB_URL).origin;
let cookie = '';

beforeEach(async () => {
  await truncateMutableTables(connection.db);
  const setup = await app.request('/api/v1/auth/setup', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.test', password: 't052-owner-test-password' }),
  });
  expect(setup.status).toBe(201);
  cookie = setup.headers.get('set-cookie')!.split(';')[0]!;
});
afterAll(async () => { await connection.client.end(); });

describe('T052 connector health API', () => {
  it('protects account details and returns mock adapter health without config', async () => {
    expect((await app.request('/api/v1/integrations')).status).toBe(401);

    const response = await app.request('/api/v1/integrations', { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    const body = await response.json() as { items: Array<Record<string, unknown>> };
    const configuredProviders = body.items.filter((item) => ['discord', 'github', 'trello'].includes(String(item.provider)));
    expect(configuredProviders).toHaveLength(3);
    expect(configuredProviders.map((item) => item.provider).sort()).toEqual(['discord', 'github', 'trello']);
    expect(configuredProviders).toEqual(expect.arrayContaining([
      expect.objectContaining({ mode: 'read_only', adapterMode: 'read_only', mock: true, health: expect.objectContaining({ status: 'mock', simulated: true }) }),
    ]));
    expect(body.items.every((item) => !('config' in item))).toBe(true);
    expect(MOCK_CONNECTOR_ADAPTERS.map((adapter) => adapter.readOverview())).toEqual([
      { provider: 'github', label: 'Demo repository', itemCount: 1, simulated: true },
      { provider: 'discord', label: 'Demo channel', itemCount: 1, simulated: true },
      { provider: 'trello', label: 'Demo board', itemCount: 1, simulated: true },
    ]);
    expect(MOCK_CONNECTOR_ADAPTERS.every((adapter) => adapter.mode === 'read_only' && !('write' in adapter))).toBe(true);
  });
});

/**
 * @flux88/api — Hono HTTP API.
 * Phase 0b: boots with /health only. Phase 1 adds routes per
 * specs/001-flux-88-platform/contracts/api.md; the policy/approval engine
 * lives in this process and nowhere else.
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import { loadConfig } from '@flux88/config';
import { AGENT_IDS } from '@flux88/core';

const config = loadConfig();
const app = new Hono();

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'flux88-api',
    mockLlm: config.MOCK_LLM,
    agents: AGENT_IDS.length,
  }),
);

app.get('/api/v1', (c) =>
  c.json({
    name: 'FLUX-88 API',
    phase: '0b',
    docs: 'specs/001-flux-88-platform/contracts/api.md',
  }),
);

const server = serve({ fetch: app.fetch, port: config.API_PORT }, (info) => {
  console.log(`[flux88-api] listening on :${info.port} (mock LLM: ${config.MOCK_LLM})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[flux88-api] ${signal} received, shutting down`);
    server.close();
    process.exit(0);
  });
}

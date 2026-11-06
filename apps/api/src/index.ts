/**
 * @flux88/api — Hono HTTP API. The policy/approval engine lives in this
 * process and nowhere else (plan.md security boundaries).
 */
import { serve } from '@hono/node-server';

import { createApp } from './app.js';

const { app, config } = createApp();

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

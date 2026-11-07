/**
 * @flux88/api — Hono HTTP API. The policy/approval engine lives in this
 * process and nowhere else (plan.md security boundaries).
 * Production wiring: BullMQ enqueuer for the worker, plus a Redis subscriber
 * bridging worker events onto the in-process SSE bus (T025).
 */
import { serve } from '@hono/node-server';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { loadConfig } from '@flux88/config';
import { EVENTS_CHANNEL, QUEUE_AGENT_RUN, QUEUE_ORCHESTRATE } from '@flux88/core';

import { createApp } from './app.js';
import type { TaskEnqueuer } from './enqueue.js';
import { emitEvent, type SSEEvent } from './events.js';

const config = loadConfig();

const queueConnection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const orchestrateQueue = new Queue(QUEUE_ORCHESTRATE, { connection: queueConnection });
const runQueue = new Queue(QUEUE_AGENT_RUN, { connection: queueConnection });

const enqueue: TaskEnqueuer = {
  async orchestrate(taskId) {
    await orchestrateQueue.add('orchestrate', { taskId }, { jobId: `orchestrate-${taskId}` });
  },
  async run(taskId, attempt) {
    await runQueue.add('run', { taskId }, { jobId: `run-${taskId}-${attempt}` });
  },
};

// Worker -> API event bridge: republish worker events on the SSE bus.
const subscriber = new Redis(config.REDIS_URL);
await subscriber.subscribe(EVENTS_CHANNEL);
subscriber.on('message', (_channel, message) => {
  try {
    emitEvent(JSON.parse(message) as SSEEvent);
  } catch {
    // Malformed bus payloads are dropped, never crash the API.
  }
});

const { app } = createApp({ config, enqueue });

const server = serve({ fetch: app.fetch, port: config.API_PORT }, (info) => {
  console.log(`[flux88-api] listening on :${info.port} (mock LLM: ${config.MOCK_LLM})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[flux88-api] ${signal} received, shutting down`);
    server.close();
    void Promise.all([orchestrateQueue.close(), runQueue.close(), queueConnection.quit(), subscriber.quit()]).finally(
      () => process.exit(0),
    );
  });
}

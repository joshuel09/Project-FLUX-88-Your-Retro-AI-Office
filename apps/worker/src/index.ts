/**
 * @flux88/worker — persistent orchestration service.
 * Phase 0b: boots, loads config, idles. Phase 1 adds BullMQ queues, the DOC
 * delegation orchestrator, loop/budget guards, and startup reconciliation
 * (re-enqueue in-flight work from Postgres — Redis is never the system of record).
 */
import { loadConfig } from '@flux88/config';
import { MAX_PARALLEL_DEFAULT } from './constants.js';

const config = loadConfig();

console.log(
  `[flux88-worker] booted (mock LLM: ${config.MOCK_LLM}, concurrency: ${config.MAX_PARALLEL_AGENT_RUNS ?? MAX_PARALLEL_DEFAULT})`,
);

const heartbeat = setInterval(() => {
  // Phase 1 replaces this with queue processing.
}, 30_000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[flux88-worker] ${signal} received, shutting down`);
    clearInterval(heartbeat);
    process.exit(0);
  });
}

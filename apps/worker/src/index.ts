/**
 * @flux88/worker — persistent orchestration service (T025).
 * Boot order: config -> DB -> reconcile from Postgres -> start queue workers.
 * Redis is transport only; Postgres is always the system of record.
 */
import { loadConfig } from '@flux88/config';
import { createDb } from '@flux88/db';
import { MockProvider } from '@flux88/llm';

import { MAX_PARALLEL_DEFAULT } from './constants.js';
import type { WorkerDeps } from './deps.js';
import { createQueueBundle } from './queues/index.js';
import { reconcile } from './reconcile.js';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const bundle = createQueueBundle(config.REDIS_URL);

// Phase 1 is mock-only; Phase 2 selects ClaudeProvider when MOCK_LLM=false.
const provider = new MockProvider();

const deps: WorkerDeps = {
  db,
  provider,
  publish: bundle.publish,
  enqueueOrchestrate: bundle.enqueueOrchestrate,
  enqueueRun: bundle.enqueueRun,
};

const concurrency = config.MAX_PARALLEL_AGENT_RUNS ?? MAX_PARALLEL_DEFAULT;

const { resumed } = await reconcile(deps);
bundle.startWorkers(deps, concurrency);
console.log(
  `[flux88-worker] booted (mock LLM: ${config.MOCK_LLM}, concurrency: ${concurrency}, reconciled: ${resumed})`,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[flux88-worker] ${signal} received, shutting down`);
    void bundle.close().finally(() => process.exit(0));
  });
}

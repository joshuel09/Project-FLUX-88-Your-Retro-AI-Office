/**
 * @flux88/worker — persistent orchestration service (T025).
 * Boot order: config -> DB -> reconcile from Postgres -> start queue workers.
 * Redis is transport only; Postgres is always the system of record.
 */
import { loadConfig } from '@flux88/config';
import { createDb } from '@flux88/db';

import { MAX_PARALLEL_DEFAULT } from './constants.js';
import type { WorkerDeps } from './deps.js';
import { createLlmProvider } from './provider.js';
import { createQueueBundle } from './queues/index.js';
import { reconcile } from './reconcile.js';
import { startOutboxDispatcher } from './outbox.js';
import { startFeedbackReminderScheduler } from './connectors/reminders.js';
import { assertWorkerDatabaseRole } from './worker-db-role.js';

const config = loadConfig();
if (!config.WORKER_DATABASE_URL) {
  throw new Error('WORKER_DATABASE_URL must use a non-superuser member of flux88_worker.');
}
if (new URL(config.WORKER_DATABASE_URL).username === new URL(config.DATABASE_URL).username) {
  throw new Error('WORKER_DATABASE_URL must use a separate login from DATABASE_URL.');
}
const db = createDb(config.WORKER_DATABASE_URL);
await assertWorkerDatabaseRole(db);
const bundle = createQueueBundle(config.REDIS_URL);

const provider = createLlmProvider(config);

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
const dispatcher = startOutboxDispatcher(db, () => {
  console.error('[flux88-worker] outbox polling failed; retrying on next poll');
});
const reminderScheduler = config.DISCORD_NOTIFICATION_TEMPLATES.includes('review_reminder')
  ? startFeedbackReminderScheduler(db, {
      enabled: true,
      intervalHours: config.DISCORD_REMINDER_INTERVAL_HOURS,
      quietHours: config.QUIET_HOURS,
    }, () => console.error('[flux88-worker] reminder scheduling failed; retrying on next poll'))
  : null;
console.log(
  `[flux88-worker] booted (mock LLM: ${config.MOCK_LLM}, concurrency: ${concurrency}, reconciled: ${resumed})`,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[flux88-worker] ${signal} received, shutting down`);
    void Promise.all([dispatcher.close(), reminderScheduler?.close(), bundle.close()]).finally(() => process.exit(0));
  });
}

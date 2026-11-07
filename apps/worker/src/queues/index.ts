/**
 * BullMQ wiring (T025). Job ids are deterministic (`task id + attempt`) so a
 * reconciliation re-enqueue of work BullMQ already holds is deduped, while the
 * real idempotency gate stays in Postgres (agent_runs.idempotency_key).
 */
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { EVENTS_CHANNEL, QUEUE_AGENT_RUN, QUEUE_ORCHESTRATE } from '@flux88/core';

import type { WorkerDeps, WorkerEvent } from '../deps.js';
import { orchestrateTask } from '../orchestrator/doc.js';
import { runAgentTask } from '../runner/index.js';

export interface QueueBundle {
  enqueueOrchestrate: (taskId: string) => Promise<void>;
  enqueueRun: (taskId: string, attempt: number) => Promise<void>;
  publish: (event: WorkerEvent) => Promise<void>;
  startWorkers: (deps: WorkerDeps, concurrency: number) => void;
  close: () => Promise<void>;
}

export function createQueueBundle(redisUrl: string): QueueBundle {
  // BullMQ requires maxRetriesPerRequest: null on blocking connections.
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const publisher = new Redis(redisUrl);

  const orchestrateQueue = new Queue(QUEUE_ORCHESTRATE, { connection });
  const runQueue = new Queue(QUEUE_AGENT_RUN, { connection });
  const workers: Worker[] = [];

  return {
    async enqueueOrchestrate(taskId) {
      await orchestrateQueue.add('orchestrate', { taskId }, { jobId: `orchestrate-${taskId}` });
    },
    async enqueueRun(taskId, attempt) {
      await runQueue.add('run', { taskId }, { jobId: `run-${taskId}-${attempt}` });
    },
    async publish(event) {
      await publisher.publish(EVENTS_CHANNEL, JSON.stringify(event));
    },
    startWorkers(deps, concurrency) {
      workers.push(
        new Worker(
          QUEUE_ORCHESTRATE,
          async (job) => orchestrateTask(deps, (job.data as { taskId: string }).taskId),
          { connection, concurrency: 1 },
        ),
        new Worker(
          QUEUE_AGENT_RUN,
          async (job) => runAgentTask(deps, (job.data as { taskId: string }).taskId),
          { connection, concurrency },
        ),
      );
      for (const worker of workers) {
        worker.on('failed', (job, err) => {
          console.error(`[flux88-worker] job ${job?.id ?? '?'} failed: ${err.message}`);
        });
      }
    },
    async close() {
      await Promise.all(workers.map((w) => w.close()));
      await Promise.all([orchestrateQueue.close(), runQueue.close()]);
      await Promise.all([connection.quit(), publisher.quit()]);
    },
  };
}

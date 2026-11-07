/**
 * TaskEnqueuer — how the API hands work to the worker (T024/T025).
 * Injected via AppDeps so tests run without Redis; the real BullMQ-backed
 * implementation is wired in index.ts.
 */

export interface TaskEnqueuer {
  orchestrate(taskId: string): Promise<void>;
  run(taskId: string, attempt: number): Promise<void>;
}

/** Test/default fallback: accepted but not dispatched (no Redis available). */
export const noopEnqueuer: TaskEnqueuer = {
  async orchestrate() {},
  async run() {},
};

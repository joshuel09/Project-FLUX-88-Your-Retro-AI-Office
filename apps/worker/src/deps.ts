/**
 * WorkerDeps — everything the orchestrator and runner need, injected so the
 * integration tests can run the full scenario without BullMQ/Redis.
 */
import type { Db } from '@flux88/db';
import type { LLMProvider } from '@flux88/llm';

export interface WorkerEvent {
  channel: 'task' | 'approval' | 'audit' | 'agent_status';
  data: Record<string, unknown>;
}

export interface WorkerDeps {
  db: Db;
  provider: LLMProvider;
  /** Publish onto the API's SSE bus (Redis pub/sub in production). */
  publish: (event: WorkerEvent) => Promise<void>;
  /** Enqueue DOC decomposition for a task. Must be idempotent per task. */
  enqueueOrchestrate: (taskId: string) => Promise<void>;
  /** Enqueue an agent run. `attempt` keys the job id so retries re-deliver. */
  enqueueRun: (taskId: string, attempt: number) => Promise<void>;
}

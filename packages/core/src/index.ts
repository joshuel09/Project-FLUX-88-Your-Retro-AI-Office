/**
 * @flux88/core — domain types and state machines.
 * Zero-dependency package: no I/O of any kind (plan.md module boundaries).
 */

export const TASK_STATUSES = [
  'backlog',
  'ready',
  'running',
  'blocked',
  'review',
  'awaiting_approval',
  'completed',
  'failed',
  'canceled',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TERMINAL_STATUSES: readonly TaskStatus[] = ['completed', 'failed', 'canceled'];

/**
 * Allowed task state transitions (spec FR-011, data-model.md state machine).
 * Every transition must be validated through canTransition(); direct status
 * writes are a defect.
 */
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  backlog: ['ready', 'canceled'],
  ready: ['running', 'blocked', 'canceled'],
  running: ['review', 'blocked', 'awaiting_approval', 'failed', 'canceled'],
  blocked: ['ready', 'running', 'canceled'],
  review: ['completed', 'running', 'canceled'],
  awaiting_approval: ['running', 'blocked', 'failed', 'canceled'],
  completed: [],
  failed: [],
  canceled: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export const AGENT_IDS = [
  'doc',
  'eleven',
  'data',
  'egon',
  'claire',
  'tron',
  'andie',
  'mikey',
  'jem',
  'sloane',
  'marty',
  'ripley',
  'kitt',
  'johnny-five',
  'sarah',
  'robin',
  'max',
  'ferris',
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export const DEPARTMENTS = ['management', 'design', 'engineering', 'content_business'] as const;
export type Department = (typeof DEPARTMENTS)[number];

/**
 * Shared infrastructure names (worker <-> API). Plain constants live here so
 * both processes agree without a dependency between them.
 */
export const QUEUE_ORCHESTRATE = 'flux88-orchestrate';
export const QUEUE_AGENT_RUN = 'flux88-agent-run';
/** Redis pub/sub channel bridging worker events onto the API's SSE bus (T025). */
export const EVENTS_CHANNEL = 'flux88:events';

export const OFFICE_AREAS = [
  'clock-tower',
  'hawkins-lab',
  'arcade',
  'garage',
  'ghost-lab',
  'front-desk',
  'video-store',
  'mall',
  'memory-vault',
] as const;
export type OfficeArea = (typeof OFFICE_AREAS)[number];


/** Closed critical-action catalog shared by persisted approval and proposal contracts. */
export const CRITICAL_ACTION_CATEGORIES = [
  'payment', 'external_communication', 'publish_content', 'github_write',
  'protected_branch_change', 'deployment_or_infra', 'delete_resource',
  'share_private_externally', 'agent_config_change', 'policy_change', 'integration_write_enable',
] as const;

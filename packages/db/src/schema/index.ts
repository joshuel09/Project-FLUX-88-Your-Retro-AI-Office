import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { AGENT_IDS, DEPARTMENTS, OFFICE_AREAS, TASK_STATUSES } from '@flux88/core';

export const taskStatusEnum = pgEnum('task_status', TASK_STATUSES);
export const agentIdEnum = pgEnum('agent_id', AGENT_IDS);
export const departmentEnum = pgEnum('department', DEPARTMENTS);
export const officeAreaEnum = pgEnum('office_area', OFFICE_AREAS);

export const agentStatusEnum = pgEnum('agent_status', ['idle', 'running', 'blocked']);
export const taskOriginEnum = pgEnum('task_origin', ['local', 'github', 'trello']);
export const providerEnum = pgEnum('llm_provider', ['claude', 'mock']);
export const runStatusEnum = pgEnum('run_status', ['queued', 'running', 'succeeded', 'failed', 'halted_budget']);
export const approvalStatusEnum = pgEnum('approval_status', ['pending', 'approved', 'rejected', 'expired']);
export const approvalActionEnum = pgEnum('approval_action', [
  'payment',
  'external_communication',
  'publish_content',
  'github_write',
  'protected_branch_change',
  'deployment_or_infra',
  'delete_resource',
  'share_private_externally',
  'agent_config_change',
  'policy_change',
  'integration_write_enable',
]);
export const memoryScopeEnum = pgEnum('memory_scope', ['shared', 'project', 'private']);
export const verificationStatusEnum = pgEnum('verification_status', ['verified', 'proposed', 'untrusted']);
export const actorTypeEnum = pgEnum('actor_type', ['owner', 'agent', 'system', 'connector']);
export const connectorProviderEnum = pgEnum('connector_provider', ['github', 'discord', 'trello', 'mock']);
export const connectorModeEnum = pgEnum('connector_mode', ['read_only', 'write_enabled']);
export const notificationChannelEnum = pgEnum('notification_channel', ['dashboard', 'discord']);
export const outboxStatusEnum = pgEnum('outbox_status', ['pending', 'dispatched', 'failed', 'halted_revalidation']);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/** Fixed roster of 18 agents — seeded, never created/deleted at runtime (FR-001). */
export const agents = pgTable('agents', {
  id: agentIdEnum('id').primaryKey(),
  displayName: text('display_name').notNull(),
  department: departmentEnum('department').notNull(),
  officeArea: officeAreaEnum('office_area').notNull(),
  roleSummary: text('role_summary').notNull(),
  personality: text('personality').notNull(),
  /** Full AgentConfig (zod-validated in @flux88/agents). Personality never affects policy. */
  config: jsonb('config').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  status: agentStatusEnum('status').notNull().default('idle'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: taskStatusEnum('status').notNull().default('backlog'),
    creator: text('creator').notNull(), // 'owner' | agent id | connector name
    assigneeAgentId: agentIdEnum('assignee_agent_id'),
    parentTaskId: uuid('parent_task_id'),
    priority: integer('priority').notNull().default(3),
    deadline: timestamp('deadline', { withTimezone: true }),
    retryCount: integer('retry_count').notNull().default(0),
    retryLimit: integer('retry_limit').notNull().default(2),
    delegationDepth: integer('delegation_depth').notNull().default(0),
    origin: taskOriginEnum('origin').notNull().default('local'),
    originRef: text('origin_ref'),
    simulated: boolean('simulated').notNull().default(false),
    blockedReason: text('blocked_reason'),
    tokensUsed: integer('tokens_used').notNull().default(0),
    costCents: integer('cost_cents').notNull().default(0),
    execMs: integer('exec_ms').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('tasks_status_idx').on(t.status), index('tasks_assignee_idx').on(t.assigneeAgentId)],
);

export const taskDependencies = pgTable(
  'task_dependencies',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    dependsOnTaskId: uuid('depends_on_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.dependsOnTaskId] })],
);

/** Immutable record of work transfer between agents (FR-004). */
export const handoffs = pgTable('handoffs', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  fromAgentId: agentIdEnum('from_agent_id'),
  toAgentId: agentIdEnum('to_agent_id').notNull(),
  reason: text('reason').notNull(),
  payloadRef: text('payload_ref'),
  createdAt: createdAt(),
});

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    agentId: agentIdEnum('agent_id').notNull(),
    provider: providerEnum('provider').notNull().default('mock'),
    model: text('model'),
    status: runStatusEnum('status').notNull().default('queued'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costCents: integer('cost_cents').notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    idempotencyKey: text('idempotency_key').notNull(),
    error: text('error'),
    simulated: boolean('simulated').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('agent_runs_idempotency_idx').on(t.idempotencyKey)],
);

export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  agentId: agentIdEnum('agent_id'),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  simulated: boolean('simulated').notNull().default(false),
  createdAt: createdAt(),
});

/** Immutable after creation (FR-032); decision fields written once. */
export const approvalRequests = pgTable('approval_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestingAgentId: agentIdEnum('requesting_agent_id').notNull(),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  actionType: approvalActionEnum('action_type').notNull(),
  actionPayload: jsonb('action_payload').notNull(),
  targetResource: text('target_resource').notNull(),
  expectedImpact: text('expected_impact').notNull(),
  risks: text('risks').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  status: approvalStatusEnum('status').notNull().default('pending'),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  batchId: uuid('batch_id'),
  dedupeKey: text('dedupe_key').notNull(),
  createdAt: createdAt(),
});

/** Single-use capability minted on approval (FR-033). */
export const approvalGrants = pgTable(
  'approval_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    approvalRequestId: uuid('approval_request_id')
      .notNull()
      .references(() => approvalRequests.id),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    consumedByRunId: uuid('consumed_by_run_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('approval_grants_request_idx').on(t.approvalRequestId)],
);

export const memoryEntries = pgTable(
  'memory_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: memoryScopeEnum('scope').notNull().default('shared'),
    projectId: text('project_id'),
    category: text('category').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    sourceAttribution: text('source_attribution').notNull(),
    confidence: real('confidence').notNull().default(0.5),
    verificationStatus: verificationStatusEnum('verification_status').notNull().default('proposed'),
    author: text('author').notNull(), // 'owner' | agent id
    embedding: vector('embedding', { dimensions: 384 }),
    dedupeHash: text('dedupe_hash').notNull(),
    conflictsWith: jsonb('conflicts_with').notNull().default(sql`'[]'::jsonb`),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('memory_category_idx').on(t.category),
    index('memory_dedupe_idx').on(t.dedupeHash),
  ],
);

export const memoryVersions = pgTable('memory_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  memoryEntryId: uuid('memory_entry_id')
    .notNull()
    .references(() => memoryEntries.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  body: text('body').notNull(),
  editedBy: text('edited_by').notNull(),
  changeNote: text('change_note').notNull().default(''),
  createdAt: createdAt(),
});

/** Append-only: UPDATE/DELETE blocked by trigger + role grants (FR-070, CHK025). */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorType: actorTypeEnum('actor_type').notNull(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index('audit_created_idx').on(t.createdAt)],
);

export const connectorAccounts = pgTable('connector_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: connectorProviderEnum('provider').notNull(),
  mode: connectorModeEnum('mode').notNull().default('read_only'),
  /** Non-secret config only — secrets live in env (FR-044). */
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
  healthStatus: text('health_status').notNull().default('unknown'),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const externalLinks = pgTable(
  'external_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: connectorProviderEnum('provider').notNull(),
    externalType: text('external_type').notNull(),
    externalId: text('external_id').notNull(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    originMarker: text('origin_marker').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('external_links_unique_idx').on(t.provider, t.externalType, t.externalId)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channel: notificationChannelEnum('channel').notNull().default('dashboard'),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    approvalRequestId: uuid('approval_request_id').references(() => approvalRequests.id, {
      onDelete: 'set null',
    }),
    body: text('body').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    quietHoursDeferred: boolean('quiet_hours_deferred').notNull().default(false),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_dedupe_idx').on(t.dedupeKey)],
);

export const budgets = pgTable(
  'budgets',
  {
    agentId: agentIdEnum('agent_id').primaryKey(),
    maxTokensPerRun: integer('max_tokens_per_run').notNull(),
    maxRuntimeMs: integer('max_runtime_ms').notNull(),
    maxRetries: integer('max_retries').notNull(),
    maxDailyCostCents: integer('max_daily_cost_cents').notNull(),
    updatedAt: updatedAt(),
  },
);

/** Single-owner deployment (spec Assumptions). */
export const owner = pgTable('owner', {
  id: integer('id').primaryKey().default(1),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(), // random 256-bit token (hashed? plain id, HttpOnly cookie)
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_expires_idx').on(t.expiresAt)],
);

/** Transactional outbox — no duplicate external action on retry (scenario 9). */
export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connector: connectorProviderEnum('connector').notNull(),
    operation: text('operation').notNull(),
    payload: jsonb('payload').notNull(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => approvalGrants.id),
    status: outboxStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('outbox_idempotency_idx').on(t.idempotencyKey)],
);

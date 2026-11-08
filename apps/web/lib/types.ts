/** API response shapes used by the dashboard (contracts/api.md). */

export interface AgentSummary {
  id: string;
  displayName: string;
  department: 'management' | 'design' | 'engineering' | 'content_business';
  officeArea: string;
  roleSummary: string;
  personality: string;
  enabled: boolean;
  status: 'idle' | 'running' | 'blocked';
  config: {
    allowedTools: string[];
    dataScopes: string[];
    prohibitedOps: string[];
    handoffTargets: string[];
    escalation: { criteria: string[]; approvalRequired: string[] };
    memory: { read: string[]; write: string[] };
    budgets: {
      maxTokensPerRun: number;
      maxRuntimeMs: number;
      maxRetries: number;
      maxDailyCostCents: number;
    };
    objectives: string[];
  };
}

export type TaskStatus =
  | 'backlog'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'review'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'canceled';

export const TASK_STATUS_ORDER: TaskStatus[] = [
  'backlog',
  'ready',
  'running',
  'blocked',
  'review',
  'awaiting_approval',
  'completed',
  'failed',
  'canceled',
];

export interface TaskSummary {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  creator: string;
  assigneeAgentId: string | null;
  parentTaskId: string | null;
  priority: number;
  deadline: string | null;
  retryCount: number;
  delegationDepth: number;
  simulated: boolean;
  blockedReason: string | null;
  tokensUsed: number;
  costCents: number;
  execMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface HandoffEntry {
  id: string;
  taskId: string;
  fromAgentId: string | null;
  toAgentId: string;
  reason: string;
  createdAt: string;
}

export interface AgentRunEntry {
  id: string;
  taskId: string;
  agentId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  durationMs: number;
  error: string | null;
  createdAt: string;
}

export interface ArtifactEntry {
  id: string;
  taskId: string;
  agentId: string | null;
  kind: string;
  title: string;
  content: string;
  simulated: boolean;
  createdAt: string;
}

export interface TaskDeep {
  task: TaskSummary;
  subtasks: TaskSummary[];
  dependencies: Array<{ taskId: string; dependsOnTaskId: string }>;
  handoffs: HandoffEntry[];
  artifacts: ArtifactEntry[];
  runs: AgentRunEntry[];
  totals: { tokensUsed: number; costCents: number; execMs: number };
}

export interface TimelineEntry {
  at: string;
  kind: 'handoff' | 'run' | 'audit';
  summary: string;
  detail: Record<string, unknown>;
}

export type VerificationStatus = 'verified' | 'proposed' | 'untrusted';

export interface MemoryHit {
  id: string;
  category: string;
  title: string;
  body: string;
  author: string;
  sourceAttribution: string;
  verificationStatus: VerificationStatus;
  confidence: number;
  conflictsWith: string[];
  createdAt: string;
  score: number;
}

export interface MemoryEntryDetail {
  entry: MemoryHit & { revokedAt: string | null; scope: string };
  versions: Array<{ id: string; version: number; body: string; editedBy: string; changeNote: string; createdAt: string }>;
  conflicts: Array<{ id: string; title: string; author: string; verificationStatus: VerificationStatus; revokedAt: string | null }>;
}

export const MEMORY_CATEGORIES = ['shared', 'project', 'private', 'dept', 'ops'] as const;

export const DEPARTMENT_LABELS: Record<AgentSummary['department'], string> = {
  management: 'Management & Operations',
  design: 'Design — The Arcade',
  engineering: 'Engineering — The Garage',
  content_business: 'Content & Business',
};

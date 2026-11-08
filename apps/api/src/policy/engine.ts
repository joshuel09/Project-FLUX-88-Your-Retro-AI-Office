/** T039: closed operation catalog, acting-agent permissions, and default-deny policy. */
import { z } from 'zod';

import { policyConfigSchema } from '@flux88/agents';
import { AGENT_IDS, type AgentId } from '@flux88/core';
import { getAgent, schema, writeAudit, type Db } from '@flux88/db';

/** Reuse the persisted enum so the approval layer cannot silently disagree with policy. */
export const CRITICAL_ACTION_CATEGORIES = Object.freeze([...schema.approvalActionEnum.enumValues]);
export type CriticalActionCategory = (typeof CRITICAL_ACTION_CATEGORIES)[number];

interface Requirement {
  readonly tool: string;
  readonly scope: string;
}

// These are server-owned operation definitions. Callers cannot select their own
// tool, required scope, or critical classification through request fields.
const criticalRequirements: Readonly<Record<CriticalActionCategory, Requirement>> = {
  payment: { tool: 'payments.execute', scope: 'payments:write' },
  external_communication: { tool: 'communications.send', scope: 'communications:write' },
  publish_content: { tool: 'content.publish', scope: 'content:write' },
  github_write: { tool: 'github.write', scope: 'github:write' },
  protected_branch_change: { tool: 'github.protected_branch.write', scope: 'github:protected:write' },
  deployment_or_infra: { tool: 'infrastructure.write', scope: 'infrastructure:write' },
  delete_resource: { tool: 'resources.delete', scope: 'resources:delete' },
  share_private_externally: { tool: 'data.share_private', scope: 'data:private:share' },
  agent_config_change: { tool: 'agents.config.update', scope: 'agents:write' },
  policy_change: { tool: 'policy.update', scope: 'policy:write' },
  integration_write_enable: { tool: 'integrations.enable_writes', scope: 'integrations:write' },
};

// Only target-independent reads are enabled in this first slice. Operations
// needing ownership/project checks remain denied until their context is modeled.
const readRequirements = {
  'agents.read': { tool: 'agents.read', scope: 'agents:read' },
  'repo.read': { tool: 'repo.read', scope: 'repo:read' },
} as const satisfies Record<string, Requirement>;

type ReadOperation = keyof typeof readRequirements;
export type PolicyOperation = CriticalActionCategory | ReadOperation;

const requestSchema = z.object({ operation: z.string().min(1).max(80) }).strict();
const agentIdSchema = z.enum(AGENT_IDS);

/** Trusted server state, loaded independently of the action request. */
export interface PolicySubject {
  readonly agentId: AgentId;
  readonly enabled: boolean;
  readonly policy: unknown;
}

export type PolicyDenialCode =
  | 'unknown_agent'
  | 'agent_disabled'
  | 'invalid_policy'
  | 'invalid_request'
  | 'unknown_operation'
  | 'operation_prohibited'
  | 'tool_not_allowed'
  | 'scope_not_allowed'
  | 'approval_required';

export type PolicyDecision =
  | { allowed: true; actorId: AgentId; operation: ReadOperation }
  | {
      allowed: false;
      code: PolicyDenialCode;
      actorId?: AgentId;
      operation?: PolicyOperation;
      actionType?: CriticalActionCategory;
    };

/**
 * Evaluate only against this actor's trusted subject, never a delegator's config.
 * No approval boolean, token, request text, or role/personality can authorize a
 * critical action. T040 will implement transactional capability consumption.
 */
export function evaluatePolicy(
  actingAgentId: unknown,
  request: unknown,
  subject: PolicySubject | null,
): PolicyDecision {
  const identity = agentIdSchema.safeParse(actingAgentId);
  if (!identity.success) return { allowed: false, code: 'unknown_agent' };
  const actorId = identity.data;
  if (!subject || subject.agentId !== actorId) return { allowed: false, actorId, code: 'unknown_agent' };
  if (subject.enabled !== true) return { allowed: false, actorId, code: 'agent_disabled' };
  const parsedPolicy = policyConfigSchema.safeParse(subject.policy);
  if (!parsedPolicy.success) return { allowed: false, actorId, code: 'invalid_policy' };
  const parsedRequest = requestSchema.safeParse(request);
  if (!parsedRequest.success) return { allowed: false, actorId, code: 'invalid_request' };

  const name = parsedRequest.data.operation;
  const critical = Object.hasOwn(criticalRequirements, name);
  if (!critical && !Object.hasOwn(readRequirements, name)) {
    return { allowed: false, actorId, code: 'unknown_operation' };
  }
  const operation = name as PolicyOperation;
  const actionType = critical ? (operation as CriticalActionCategory) : undefined;
  const requirement = critical
    ? criticalRequirements[operation as CriticalActionCategory]
    : readRequirements[operation as ReadOperation];
  const context = { actorId, operation, ...(actionType ? { actionType } : {}) };
  const policy = parsedPolicy.data;
  if (policy.prohibitedOps.includes(operation) || policy.prohibitedOps.includes(requirement.tool)) {
    return { allowed: false, ...context, code: 'operation_prohibited' };
  }
  if (!policy.allowedTools.includes(requirement.tool)) {
    return { allowed: false, ...context, code: 'tool_not_allowed' };
  }
  if (!policy.dataScopes.includes(requirement.scope)) {
    return { allowed: false, ...context, code: 'scope_not_allowed' };
  }
  if (critical || policy.escalation.approvalRequired.includes(operation)) {
    return { allowed: false, ...context, code: 'approval_required' };
  }
  return { allowed: true, actorId, operation: operation as ReadOperation };
}

/**
 * Enforcement entry point for server callers. actingAgentId must come from the
 * authenticated execution context, not a model's request body or DOC's identity.
 * Load fresh persisted permissions on every evaluation; audit failures propagate
 * so callers cannot proceed on an unaudited decision. This never executes tools.
 */
export async function evaluateAndAuditPolicy(db: Db, actingAgentId: unknown, request: unknown): Promise<PolicyDecision> {
  const identity = agentIdSchema.safeParse(actingAgentId);
  const agent = identity.success ? await getAgent(db, identity.data) : null;
  const subject: PolicySubject | null = agent
    ? { agentId: agent.id as AgentId, enabled: agent.enabled, policy: agent.config }
    : null;
  const decision = evaluatePolicy(actingAgentId, request, subject);
  // Only validated catalog identifiers enter audit records; raw payloads can
  // contain credentials or prompt injection, even in operation/identity fields.
  await writeAudit(db, {
    actorType: decision.actorId ? 'agent' : 'system',
    actorId: decision.actorId ?? 'policy-engine',
    action: decision.allowed ? 'policy.allowed' : 'policy.denied',
    targetType: 'policy',
    targetId: decision.operation ?? 'rejected',
    payload: decision.allowed
      ? { operation: decision.operation }
      : {
          code: decision.code,
          ...(decision.operation ? { operation: decision.operation } : {}),
          ...(decision.actionType ? { actionType: decision.actionType } : {}),
        },
  });
  return decision;
}

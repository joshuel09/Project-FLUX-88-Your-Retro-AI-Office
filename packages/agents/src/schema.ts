import { z } from 'zod';

import { AGENT_IDS, DEPARTMENTS, OFFICE_AREAS } from '@flux88/core';

export const agentIdSchema = z.enum(AGENT_IDS);
export const memoryCategorySchema = z.enum(['shared', 'project', 'private', 'dept', 'ops', 'shared:proposed']);

/**
 * PolicyConfig — the ONLY fields policy evaluation may read.
 * Presentation fields (displayName, personality, roleSummary) are deliberately
 * excluded from this type so personality can never affect permissions (CHK018).
 */
export const policyConfigSchema = z.object({
  allowedTools: z.array(z.string().min(1)).min(1),
  dataScopes: z.array(z.string().min(1)).min(1),
  prohibitedOps: z.array(z.string().min(1)).min(1),
  handoffTargets: z.array(agentIdSchema),
  escalation: z.object({
    criteria: z.array(z.string()),
    approvalRequired: z.array(z.string()),
  }),
  memory: z.object({
    read: z.array(memoryCategorySchema).min(1),
    write: z.array(memoryCategorySchema),
  }),
  budgets: z.object({
    maxTokensPerRun: z.number().int().positive(),
    maxRuntimeMs: z.number().int().positive(),
    maxRetries: z.number().int().min(0),
    maxDailyCostCents: z.number().int().positive(),
  }),
});

export const presentationConfigSchema = z.object({
  displayName: z.string().min(1),
  personality: z.string().min(1),
  roleSummary: z.string().min(1),
});

export const agentConfigSchema = policyConfigSchema.merge(presentationConfigSchema).extend({
  id: agentIdSchema,
  department: z.enum(DEPARTMENTS),
  officeArea: z.enum(OFFICE_AREAS),
  objectives: z.array(z.string()).min(1),
  successCriteria: z.array(z.string()).min(1),
  io: z.object({ expectedInputs: z.string(), structuredOutputs: z.string() }),
  clarification: z.object({ askWhen: z.array(z.string()), delegateWhen: z.array(z.string()) }),
  errorPolicy: z.object({
    onFailure: z.enum(['retry', 'escalate', 'halt']),
    maxRetries: z.number().int().min(0),
  }),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type PolicyConfig = z.infer<typeof policyConfigSchema>;

/** Strip presentation before handing config to any policy decision. */
export function toPolicyConfig(config: AgentConfig): PolicyConfig {
  return policyConfigSchema.parse(config);
}

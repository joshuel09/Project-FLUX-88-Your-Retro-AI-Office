/**
 * @flux88/agents — typed agent registry (18 configs + zod schema).
 * Personality fields are presentation-only and MUST never affect permissions:
 * policy code consumes PolicyConfig, which structurally excludes them.
 */
export { AGENT_IDS, type AgentId } from '@flux88/core';
export {
  agentConfigSchema,
  policyConfigSchema,
  toPolicyConfig,
  type AgentConfig,
  type PolicyConfig,
} from './schema.js';
export { AGENT_CONFIGS, AGENT_CONFIG_BY_ID } from './configs.js';

/**
 * @flux88/llm — provider abstraction (MockProvider now, ClaudeProvider in
 * Phase 2). Consumers depend on the LLMProvider interface only.
 */
export type { CompletionRequest, CompletionResult, LLMProvider, LLMUsage } from './provider.js';
export { assemblePrompt, tagUntrustedContent, UNTRUSTED_SOURCES, type UntrustedContent, type UntrustedSource } from './prompt-assembly.js';
export {
  DECOMPOSE_PREFIX,
  MockProvider,
  OVER_BUDGET_MARKER,
  planForGoal,
  type MockPlanStep,
} from './mock.js';

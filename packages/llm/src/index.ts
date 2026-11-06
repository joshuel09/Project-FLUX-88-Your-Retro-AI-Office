/**
 * @flux88/llm — provider abstraction (ClaudeProvider, MockProvider).
 * Phase 1 ships MockProvider only; Phase 2 adds Claude via @anthropic-ai/sdk.
 */
export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  costCents: number;
}
export const LLM_PACKAGE_PLACEHOLDER = 'phase-1' as const;

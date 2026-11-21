import type { AppConfig } from '@flux88/config';
import { ClaudeProvider, MockProvider, type LLMProvider } from '@flux88/llm';

export function createLlmProvider(config: AppConfig): LLMProvider {
  if (config.MOCK_LLM) return new MockProvider();

  const { ANTHROPIC_API_KEY, ANTHROPIC_MODEL,
    ANTHROPIC_INPUT_COST_CENTS_PER_MILLION, ANTHROPIC_OUTPUT_COST_CENTS_PER_MILLION } = config;
  if (!ANTHROPIC_API_KEY || !ANTHROPIC_MODEL
    || ANTHROPIC_INPUT_COST_CENTS_PER_MILLION === undefined
    || ANTHROPIC_OUTPUT_COST_CENTS_PER_MILLION === undefined) {
    throw new Error('Live Claude configuration is incomplete.');
  }

  return new ClaudeProvider({
    apiKey: ANTHROPIC_API_KEY,
    model: ANTHROPIC_MODEL,
    inputCostCentsPerMillion: ANTHROPIC_INPUT_COST_CENTS_PER_MILLION,
    outputCostCentsPerMillion: ANTHROPIC_OUTPUT_COST_CENTS_PER_MILLION,
  });
}

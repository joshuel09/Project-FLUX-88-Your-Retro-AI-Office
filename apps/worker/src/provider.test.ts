import { describe, expect, it } from 'vitest';

import { loadConfig } from '@flux88/config';
import { createLlmProvider } from './provider.js';

describe('worker LLM provider selection', () => {
  it('uses mock mode by default without credentials', () => {
    expect(createLlmProvider(loadConfig({})).name).toBe('mock');
  });

  it('selects Claude only when live mode has explicit model and cost configuration', () => {
    const config = loadConfig({
      MOCK_LLM: 'false',
      ANTHROPIC_API_KEY: 'test-only-key',
      ANTHROPIC_MODEL: 'claude-test',
      ANTHROPIC_INPUT_COST_CENTS_PER_MILLION: '300',
      ANTHROPIC_OUTPUT_COST_CENTS_PER_MILLION: '1500',
    });

    expect(createLlmProvider(config).name).toBe('claude');
  });
});

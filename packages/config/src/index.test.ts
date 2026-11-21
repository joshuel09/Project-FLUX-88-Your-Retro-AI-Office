import { describe, expect, it } from 'vitest';

import { loadConfig } from './index.js';

describe('LLM provider configuration', () => {
  it('keeps mock mode as the no-credential default', () => {
    expect(loadConfig({}).MOCK_LLM).toBe(true);
  });

  it('requires a key, model, and explicit token rates for live mode without echoing values', () => {
    expect(() => loadConfig({ MOCK_LLM: 'false' })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => loadConfig({ MOCK_LLM: 'false', ANTHROPIC_API_KEY: '   ' })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => loadConfig({
      MOCK_LLM: 'false',
      ANTHROPIC_API_KEY: 'test-only-key',
      ANTHROPIC_MODEL: 'claude-test',
    })).toThrow(/ANTHROPIC_INPUT_COST_CENTS_PER_MILLION/);
    expect(() => loadConfig({
      MOCK_LLM: 'false',
      ANTHROPIC_API_KEY: 'test-only-key',
      ANTHROPIC_MODEL: 'claude-test',
      ANTHROPIC_INPUT_COST_CENTS_PER_MILLION: '-1',
      ANTHROPIC_OUTPUT_COST_CENTS_PER_MILLION: '1500',
    })).toThrow(/ANTHROPIC_INPUT_COST_CENTS_PER_MILLION/);
    expect(() => loadConfig({
      MOCK_LLM: 'false',
      ANTHROPIC_API_KEY: 'test-only-key',
      ANTHROPIC_MODEL: 'claude-test',
      ANTHROPIC_INPUT_COST_CENTS_PER_MILLION: '',
      ANTHROPIC_OUTPUT_COST_CENTS_PER_MILLION: '1500',
    })).toThrow(/ANTHROPIC_INPUT_COST_CENTS_PER_MILLION/);
  });

  it('parses live model and cost rates', () => {
    const config = loadConfig({
      MOCK_LLM: 'false',
      ANTHROPIC_API_KEY: 'test-only-key',
      ANTHROPIC_MODEL: 'claude-test',
      ANTHROPIC_INPUT_COST_CENTS_PER_MILLION: '300',
      ANTHROPIC_OUTPUT_COST_CENTS_PER_MILLION: '1500',
    });

    expect(config).toMatchObject({
      MOCK_LLM: false,
      ANTHROPIC_MODEL: 'claude-test',
      ANTHROPIC_INPUT_COST_CENTS_PER_MILLION: 300,
      ANTHROPIC_OUTPUT_COST_CENTS_PER_MILLION: 1500,
    });
  });
});

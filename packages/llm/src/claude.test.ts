import { describe, expect, it } from 'vitest';

import { ClaudeProvider } from './index.js';

const message = {
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-test',
  content: [{ type: 'text', text: 'Answer from Claude.' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: {
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const providerOptions = {
  apiKey: 'test-only-key',
  model: 'claude-test',
  inputCostCentsPerMillion: 300,
  outputCostCentsPerMillion: 1_500,
  timeoutMs: 100,
};

describe('ClaudeProvider', () => {
  it('sends the bounded request and maps text and usage with estimated cost', async () => {
    let sent: Record<string, unknown> | undefined;
    const provider = new ClaudeProvider({
      ...providerOptions,
      fetch: async (_input, init) => {
        sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return response(message);
      },
    });

    const result = await provider.complete({
      agentId: 'marty',
      system: 'Follow the project rules.',
      prompt: 'Implement the feature.',
      maxTokens: 256,
    });

    expect(provider.name).toBe('claude');
    expect(sent).toMatchObject({
      model: 'claude-test',
      max_tokens: 256,
      system: 'Follow the project rules.',
      messages: [{ role: 'user', content: 'Implement the feature.' }],
    });
    expect(result).toEqual({
      content: 'Answer from Claude.',
      usage: { inputTokens: 100, outputTokens: 50, costCents: 1 },
    });
  });

  it('rejects a response without text content', async () => {
    const provider = new ClaudeProvider({
      ...providerOptions,
      fetch: async () => response({ ...message, content: [] }),
    });

    await expect(provider.complete({ agentId: 'marty', prompt: 'Run.', maxTokens: 64 }))
      .rejects.toThrow('Claude response did not contain text');
  });

  it('does not retry provider failures inside the SDK', async () => {
    let attempts = 0;
    const provider = new ClaudeProvider({
      ...providerOptions,
      fetch: async () => {
        attempts += 1;
        return response({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }, 529);
      },
    });

    await expect(provider.complete({ agentId: 'marty', prompt: 'Run.', maxTokens: 64 })).rejects.toThrow();
    expect(attempts).toBe(1);
  });
});

import Anthropic from '@anthropic-ai/sdk';

import type { CompletionRequest, CompletionResult, LLMProvider } from './provider.js';

export const DEFAULT_CLAUDE_TIMEOUT_MS = 60_000;

export interface ClaudeProviderOptions {
  apiKey: string;
  model: string;
  inputCostCentsPerMillion: number;
  outputCostCentsPerMillion: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class ClaudeProvider implements LLMProvider {
  readonly name = 'claude' as const;
  private readonly client: Anthropic;

  constructor(private readonly options: ClaudeProviderOptions) {
    if (!options.apiKey.trim()) throw new Error('Claude API key is required.');
    if (!options.model.trim()) throw new Error('Claude model is required.');
    if (!Number.isFinite(options.inputCostCentsPerMillion) || options.inputCostCentsPerMillion < 0
      || !Number.isFinite(options.outputCostCentsPerMillion) || options.outputCostCentsPerMillion < 0) {
      throw new Error('Claude token cost rates must be finite non-negative numbers.');
    }
    this.client = new Anthropic({
      apiKey: options.apiKey,
      timeout: options.timeoutMs ?? DEFAULT_CLAUDE_TIMEOUT_MS,
      // The durable task runner owns retries so SDK retries cannot hide or multiply them.
      maxRetries: 0,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const message = await this.client.messages.create({
      model: this.options.model,
      max_tokens: request.maxTokens,
      ...(request.system ? { system: request.system } : {}),
      messages: [{ role: 'user', content: request.prompt }],
    });

    const content = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    if (!content) throw new Error('Claude response did not contain text');

    const inputTokens = message.usage.input_tokens;
    const outputTokens = message.usage.output_tokens;
    const estimatedCostCents = Math.ceil((
      inputTokens * this.options.inputCostCentsPerMillion
      + outputTokens * this.options.outputCostCentsPerMillion
    ) / 1_000_000);

    return {
      content,
      usage: { inputTokens, outputTokens, costCents: estimatedCostCents },
    };
  }
}

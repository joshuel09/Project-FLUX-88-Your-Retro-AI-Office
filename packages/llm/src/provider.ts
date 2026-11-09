/**
 * LLMProvider — the provider abstraction (plan.md module boundaries).
 * Phase 1 ships MockProvider; Phase 2 adds ClaudeProvider behind the same
 * interface. Callers never import a concrete provider directly.
 */

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  costCents: number;
}

export interface CompletionRequest {
  /** Caller identity for accounting/audit (agent id or 'system'). */
  agentId: string;
  system?: string;
  prompt: string;
  maxTokens: number;
}

export interface CompletionResult {
  content: string;
  /** Untrusted action data; never an executable tool call or authorization. */
  proposedAction?: unknown;
  usage: LLMUsage;
}

export interface LLMProvider {
  readonly name: 'mock' | 'claude';
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

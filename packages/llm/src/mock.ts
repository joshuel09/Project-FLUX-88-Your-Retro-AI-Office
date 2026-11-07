/**
 * MockProvider (T022) — deterministic scripted completions for local dev and
 * CI (CHK044, CHK045). Same input always yields the same output and the same
 * fake-but-consistent token/cost accounting, so acceptance scenarios are
 * reproducible without any paid credentials.
 */
import type { AgentId } from '@flux88/core';

import type { CompletionRequest, CompletionResult, LLMProvider, LLMUsage } from './provider.js';

/** Prompt prefix the DOC orchestrator uses to request a decomposition plan. */
export const DECOMPOSE_PREFIX = 'DECOMPOSE:';

/**
 * Scripted trigger: a prompt containing this marker returns a usage that
 * exceeds every per-run token budget, so budget enforcement is testable.
 */
export const OVER_BUDGET_MARKER = '[mock:over-budget]';

/** One planned subtask in a mock decomposition (parsed by the orchestrator). */
export interface MockPlanStep {
  title: string;
  assignee: AgentId;
  /** Indices into the plan array; always earlier steps, so the plan is a DAG. */
  dependsOn: number[];
}

/**
 * Keyword -> specialist routing, checked in order. Deterministic and aligned
 * with DOC's handoffTargets in @flux88/agents (scenario 1: "correct
 * specialists").
 */
const ROUTES: ReadonlyArray<{ pattern: RegExp; assignee: AgentId; step: string }> = [
  { pattern: /research|investigate|compare|evaluate/i, assignee: 'eleven', step: 'Research' },
  { pattern: /github|repo|issue|pull request|feedback/i, assignee: 'data', step: 'GitHub intelligence' },
  { pattern: /design|logo|brand|mockup|visual|ui concept/i, assignee: 'tron', step: 'Design' },
  { pattern: /frontend|component|page|dashboard ui/i, assignee: 'mikey', step: 'Frontend build' },
  { pattern: /implement|build|code|develop|api|feature/i, assignee: 'marty', step: 'Implementation' },
  { pattern: /test|qa|verify|validate/i, assignee: 'egon', step: 'QA pass' },
  { pattern: /write|document|content|announce|post|blog/i, assignee: 'robin', step: 'Write-up' },
  { pattern: /schedule|plan|calendar|admin/i, assignee: 'claire', step: 'Scheduling' },
];

/** Fallback pipeline when no keyword matches: research -> build -> QA. */
const DEFAULT_PLAN: ReadonlyArray<{ assignee: AgentId; step: string }> = [
  { assignee: 'eleven', step: 'Research' },
  { assignee: 'marty', step: 'Implementation' },
  { assignee: 'egon', step: 'QA pass' },
];

/** Deterministic token estimate: ~4 chars per token, minimum 1. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function usageFor(prompt: string, content: string): LLMUsage {
  const inputTokens = estimateTokens(prompt);
  const outputTokens = estimateTokens(content);
  // Flat mock rate: 1 cent per 1000 tokens, rounded up — fake but consistent.
  const costCents = Math.ceil((inputTokens + outputTokens) / 1000);
  return { inputTokens, outputTokens, costCents };
}

/** Build the scripted decomposition for a goal (exported for tests). */
export function planForGoal(goal: string): MockPlanStep[] {
  const matched = ROUTES.filter((route) => route.pattern.test(goal));
  const pipeline = matched.length > 0 ? matched : DEFAULT_PLAN.map((s) => ({ ...s }));
  // Sequential pipeline: each step depends on the previous one, giving
  // scenario 1 a visible dependency graph without ever creating a cycle.
  return pipeline.map((route, index) => ({
    title: `${route.step}: ${goal}`.slice(0, 200),
    assignee: route.assignee,
    dependsOn: index === 0 ? [] : [index - 1],
  }));
}

export class MockProvider implements LLMProvider {
  readonly name = 'mock' as const;

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    // Decomposition always plans; the over-budget marker only affects
    // execution runs, so budget enforcement is testable at the runner.
    if (request.prompt.startsWith(DECOMPOSE_PREFIX)) {
      const goal = request.prompt.slice(DECOMPOSE_PREFIX.length).trim();
      const content = JSON.stringify({ subtasks: planForGoal(goal) });
      return { content, usage: usageFor(request.prompt, content) };
    }

    if (request.prompt.includes(OVER_BUDGET_MARKER)) {
      const content = `MOCK(${request.agentId}): runaway generation`;
      return {
        content,
        usage: { inputTokens: estimateTokens(request.prompt), outputTokens: 10_000_000, costCents: 10_000 },
      };
    }

    const content = `MOCK(${request.agentId}): completed — ${request.prompt.slice(0, 160)}`;
    return { content, usage: usageFor(request.prompt, content) };
  }
}

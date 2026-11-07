import { describe, expect, it } from 'vitest';

import { DECOMPOSE_PREFIX, MockProvider, OVER_BUDGET_MARKER, planForGoal } from './mock.js';

const provider = new MockProvider();

describe('MockProvider', () => {
  it('is deterministic: same input, same output and usage', async () => {
    const req = { agentId: 'marty', prompt: 'Implement the login form', maxTokens: 1000 };
    const a = await provider.complete(req);
    const b = await provider.complete(req);
    expect(a).toEqual(b);
    expect(a.usage.inputTokens).toBeGreaterThan(0);
    expect(a.usage.outputTokens).toBeGreaterThan(0);
  });

  it('routes decomposition keywords to the right specialists', () => {
    const plan = planForGoal('Research retro fonts, design a logo, then write the announcement');
    expect(plan.map((s) => s.assignee)).toEqual(['eleven', 'tron', 'robin']);
    // Sequential pipeline: DAG by construction (each step depends on the previous).
    expect(plan.map((s) => s.dependsOn)).toEqual([[], [0], [1]]);
  });

  it('falls back to research -> implementation -> QA when nothing matches', () => {
    const plan = planForGoal('Zorp the blorf');
    expect(plan.map((s) => s.assignee)).toEqual(['eleven', 'marty', 'egon']);
  });

  it('returns a parseable JSON plan for DECOMPOSE prompts', async () => {
    const res = await provider.complete({
      agentId: 'doc',
      prompt: `${DECOMPOSE_PREFIX} research competitors and implement a comparison page`,
      maxTokens: 2000,
    });
    const parsed = JSON.parse(res.content) as { subtasks: unknown[] };
    expect(parsed.subtasks.length).toBeGreaterThan(0);
  });

  it('exceeds any per-run budget when the over-budget marker is present', async () => {
    const res = await provider.complete({
      agentId: 'marty',
      prompt: `Do the thing ${OVER_BUDGET_MARKER}`,
      maxTokens: 1000,
    });
    expect(res.usage.outputTokens).toBeGreaterThan(1_000_000);
  });
});

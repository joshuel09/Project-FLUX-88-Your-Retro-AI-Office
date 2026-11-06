import { describe, expect, it } from 'vitest';

import { AGENT_IDS, canTransition, isTerminal, TASK_STATUSES } from './index.js';

describe('task state machine', () => {
  it('allows the happy path backlog → ready → running → review → completed', () => {
    expect(canTransition('backlog', 'ready')).toBe(true);
    expect(canTransition('ready', 'running')).toBe(true);
    expect(canTransition('running', 'review')).toBe(true);
    expect(canTransition('review', 'completed')).toBe(true);
  });

  it('refuses transitions out of terminal states', () => {
    for (const terminal of ['completed', 'failed', 'canceled'] as const) {
      expect(isTerminal(terminal)).toBe(true);
      for (const to of TASK_STATUSES) {
        expect(canTransition(terminal, to)).toBe(false);
      }
    }
  });

  it('refuses skipping approval: awaiting_approval cannot go straight to completed', () => {
    expect(canTransition('awaiting_approval', 'completed')).toBe(false);
    expect(canTransition('awaiting_approval', 'running')).toBe(true);
  });
});

describe('agent roster', () => {
  it('has exactly 18 agents (FR-001)', () => {
    expect(AGENT_IDS).toHaveLength(18);
    expect(new Set(AGENT_IDS).size).toBe(18);
  });
});

import { describe, expect, it } from 'vitest';

import { MAX_DELEGATION_DEPTH, planTransition } from './task-machine.js';

const owner = { actorType: 'owner' as const, actorId: 'session' };

describe('planTransition', () => {
  it('plans a legal transition with an audit event', () => {
    const plan = planTransition({ status: 'ready' }, 'running', { ...owner });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.patch).toEqual({ status: 'running', blockedReason: null });
    expect(plan.audit.action).toBe('task.transition');
    expect(plan.audit.payload).toEqual({ from: 'ready', to: 'running' });
  });

  it('rejects an illegal transition', () => {
    const plan = planTransition({ status: 'backlog' }, 'running', { ...owner });
    expect(plan).toMatchObject({ ok: false, code: 'illegal_transition' });
  });

  it('rejects any move out of a terminal status', () => {
    for (const status of ['completed', 'failed', 'canceled'] as const) {
      expect(planTransition({ status }, 'ready', { ...owner })).toMatchObject({
        ok: false,
        code: 'terminal',
      });
    }
  });

  it('keeps the reason on blocked/failed/canceled and clears it otherwise', () => {
    const blocked = planTransition({ status: 'running' }, 'blocked', {
      ...owner,
      reason: 'paused_by_owner',
    });
    expect(blocked.ok && blocked.patch.blockedReason).toBe('paused_by_owner');

    const resumed = planTransition({ status: 'blocked' }, 'ready', { ...owner });
    expect(resumed.ok && resumed.patch.blockedReason).toBeNull();
  });

  it('exposes the delegation depth limit (FR-015)', () => {
    expect(MAX_DELEGATION_DEPTH).toBeGreaterThanOrEqual(2);
  });
});

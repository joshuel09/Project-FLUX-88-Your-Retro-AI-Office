import { describe, expect, it } from 'vitest';

import { MAX_DELEGATION_DEPTH } from '@flux88/core/task-machine';

import { detectDelegationLoop, exceedsDepthLimit, hasCycle } from './loop-guards.js';

describe('loop guards (FR-015, T032)', () => {
  it('enforces the delegation depth limit', () => {
    expect(exceedsDepthLimit(0)).toBe(false);
    expect(exceedsDepthLimit(MAX_DELEGATION_DEPTH - 1)).toBe(false);
    expect(exceedsDepthLimit(MAX_DELEGATION_DEPTH)).toBe(true);
    expect(exceedsDepthLimit(MAX_DELEGATION_DEPTH + 5)).toBe(true);
  });

  it('detects circular delegation back to an agent already in the chain', () => {
    expect(detectDelegationLoop(['doc', 'marty'], 'doc')).toBe(true);
    expect(detectDelegationLoop(['doc', 'marty'], 'marty')).toBe(true);
    expect(detectDelegationLoop(['doc', 'marty'], 'egon')).toBe(false);
    expect(detectDelegationLoop([], 'eleven')).toBe(false);
  });

  it('accepts a DAG and refuses a cycle in planned dependencies', () => {
    // 0 -> 1 -> 2 (pipeline): fine
    expect(
      hasCycle(
        [
          [1, 0],
          [2, 1],
        ],
        3,
      ),
    ).toBe(false);
    // 0 -> 1 -> 2 -> 0: cycle
    expect(
      hasCycle(
        [
          [1, 0],
          [2, 1],
          [0, 2],
        ],
        3,
      ),
    ).toBe(true);
    // self-dependency
    expect(hasCycle([[0, 0]], 1)).toBe(true);
    // out-of-range edge is malformed and refused
    expect(hasCycle([[0, 7]], 2)).toBe(true);
  });
});

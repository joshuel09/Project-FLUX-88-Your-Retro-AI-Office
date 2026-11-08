import { describe, expect, it } from 'vitest';
import { canonicalJson, proposalSchema, stateHash } from './approvals.js';

describe('approval payload boundaries', () => {
  it('hashes equivalent object key orders identically while preserving array order', () => {
    expect(stateHash({ z: { b: 2, a: 1 }, a: ['x', 'y'] })).toBe(stateHash({ a: ['x', 'y'], z: { a: 1, b: 2 } }));
    expect(stateHash(['x', 'y'])).not.toBe(stateHash(['y', 'x']));
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
  });
  const base = { actionType: 'payment', actionPayload: { amount: 5 }, targetResource: 'invoice:fixture',
    expectedImpact: 'Pay the invoice', risks: 'Financial commitment', expiresAt: '2099-01-01T00:00:00.000Z' };
  it('rejects unknown categories and additional privilege fields', () => {
    expect(proposalSchema.safeParse({ ...base, actionType: 'anything' }).success).toBe(false);
    expect(proposalSchema.safeParse({ ...base, grantId: 'forged' }).success).toBe(false);
    expect(proposalSchema.safeParse({ ...base, approved: true }).success).toBe(false);
  });
  it('bounds payload depth and size and rejects non-JSON numbers', () => {
    let deep: unknown = 'leaf'; for (let i = 0; i < 25; i++) deep = { nested: deep };
    expect(proposalSchema.safeParse({ ...base, actionPayload: { deep } }).success).toBe(false);
    expect(proposalSchema.safeParse({ ...base, actionPayload: { text: 'x'.repeat(70_000) } }).success).toBe(false);
    expect(proposalSchema.safeParse({ ...base, actionPayload: { amount: Infinity } }).success).toBe(false);
  });
});

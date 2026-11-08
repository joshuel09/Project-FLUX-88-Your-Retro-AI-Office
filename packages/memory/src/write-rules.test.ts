import { describe, expect, it } from 'vitest';

import type { PolicyConfig } from '@flux88/agents';

import { MockEmbedder, EMBEDDING_DIMENSIONS } from './embedder.js';
import { checkWritePermission, detectSecretShaped, readableCategories } from './write-rules.js';

function policyWith(memory: PolicyConfig['memory']): PolicyConfig {
  return {
    allowedTools: ['memory.search'],
    dataScopes: ['memory:shared:read'],
    prohibitedOps: ['none'],
    handoffTargets: [],
    escalation: { criteria: [], approvalRequired: [] },
    memory,
    budgets: { maxTokensPerRun: 1000, maxRuntimeMs: 1000, maxRetries: 0, maxDailyCostCents: 100 },
  };
}

describe('checkWritePermission (FR-023, CHK022)', () => {
  it('lets the owner write anywhere without a forced status', () => {
    expect(checkWritePermission({ kind: 'owner' }, 'private')).toEqual({ allowed: true });
  });

  it('allows a granted category but forces proposed status for agents', () => {
    const actor = { kind: 'agent' as const, policy: policyWith({ read: ['shared'], write: ['dept'] }) };
    expect(checkWritePermission(actor, 'dept')).toMatchObject({ allowed: true, forcedStatus: 'proposed' });
  });

  it("maps the 'shared:proposed' grant to shared writes with proposed status", () => {
    const actor = { kind: 'agent' as const, policy: policyWith({ read: ['shared'], write: ['shared:proposed'] }) };
    expect(checkWritePermission(actor, 'shared')).toMatchObject({ allowed: true, forcedStatus: 'proposed' });
    expect(checkWritePermission(actor, 'ops').allowed).toBe(false);
  });

  it('refuses ungranted categories with a reason', () => {
    const actor = { kind: 'agent' as const, policy: policyWith({ read: ['shared'], write: [] }) };
    const decision = checkWritePermission(actor, 'shared');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBeTruthy();
  });

  it('forces untrusted status for system/connector writers', () => {
    expect(checkWritePermission({ kind: 'connector' }, 'shared')).toMatchObject({
      allowed: true,
      forcedStatus: 'untrusted',
    });
  });
});

describe('readableCategories', () => {
  it('owner reads everything; agents read only their grants', () => {
    expect(readableCategories({ kind: 'owner' })).toHaveLength(5);
    const agent = { kind: 'agent' as const, policy: policyWith({ read: ['shared', 'ops'], write: [] }) };
    expect(readableCategories(agent)).toEqual(['shared', 'ops']);
  });
});

describe('detectSecretShaped (FR-024)', () => {
  // All test vectors are documented example/dummy values, never real credentials.
  const FAKE_AWS_EXAMPLE_KEY = 'AKIAIOSFODNN7EXAMPLE'; // canonical AWS docs example
  const FAKE_GITHUB_TOKEN = `ghp_${'x'.repeat(36)}`;
  const FAKE_JWT = `eyJ${'a'.repeat(20)}.eyJ${'b'.repeat(20)}.${'c'.repeat(10)}`;

  it('flags common credential shapes', () => {
    expect(detectSecretShaped(`key is ${FAKE_AWS_EXAMPLE_KEY}`)).toBe('aws_access_key');
    expect(detectSecretShaped(`token ${FAKE_GITHUB_TOKEN}`)).toBe('github_token');
    expect(detectSecretShaped(FAKE_JWT)).toBe('jwt');
    expect(detectSecretShaped('-----BEGIN RSA PRIVATE KEY-----')).toBe('private_key_block');
    expect(detectSecretShaped('password = hunter2hunter2')).toBe('credential_assignment');
    expect(detectSecretShaped('postgres://user:supersecretpw@db.example.com/x')).toBe(
      'connection_string_credentials',
    );
  });

  it('passes ordinary knowledge through', () => {
    expect(detectSecretShaped('The retro dashboard uses Tailwind v4 theme tokens.')).toBeNull();
    expect(detectSecretShaped('Rotate credentials via the secrets manager, never hardcode them.')).toBeNull();
  });
});

describe('MockEmbedder (T034)', () => {
  const embedder = new MockEmbedder();

  it('is deterministic and normalized', async () => {
    const a = await embedder.embed('retro neon dashboard');
    const b = await embedder.embed('retro neon dashboard');
    expect(a).toEqual(b);
    expect(a).toHaveLength(EMBEDDING_DIMENSIONS);
    const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('ranks shared-vocabulary text closer than unrelated text', async () => {
    const query = await embedder.embed('neon retro dashboard design');
    const related = await embedder.embed('design guidance for the retro neon dashboard');
    const unrelated = await embedder.embed('postgres connection pooling tuning parameters');
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * (y[i] ?? 0), 0);
    expect(dot(query, related)).toBeGreaterThan(dot(query, unrelated));
  });
});

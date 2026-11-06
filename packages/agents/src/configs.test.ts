import { describe, expect, it } from 'vitest';

import { AGENT_IDS } from '@flux88/core';
import { AGENT_CONFIGS } from './configs.js';
import { agentConfigSchema, toPolicyConfig } from './schema.js';

describe('agent registry (FR-001, FR-002, CHK014)', () => {
  it('contains exactly the 18 fixed agents with unique ids', () => {
    expect(AGENT_CONFIGS).toHaveLength(18);
    const ids = AGENT_CONFIGS.map((c) => c.id);
    expect(new Set(ids).size).toBe(18);
    expect([...ids].sort()).toEqual([...AGENT_IDS].sort());
  });

  it('keeps department rosters: 5 management, 5 design, 5 engineering, 3 content', () => {
    const count = (d: string) => AGENT_CONFIGS.filter((c) => c.department === d).length;
    expect(count('management')).toBe(5);
    expect(count('design')).toBe(5);
    expect(count('engineering')).toBe(5);
    expect(count('content_business')).toBe(3);
  });

  it('every agent has non-empty scopes, prohibited ops, memory rules and budgets', () => {
    for (const config of AGENT_CONFIGS) {
      expect(agentConfigSchema.safeParse(config).success).toBe(true);
      expect(config.allowedTools.length).toBeGreaterThan(0);
      expect(config.dataScopes.length).toBeGreaterThan(0);
      expect(config.prohibitedOps.length).toBeGreaterThan(0);
      expect(config.memory.read.length).toBeGreaterThan(0);
      expect(config.budgets.maxTokensPerRun).toBeGreaterThan(0);
    }
  });

  it('policy config structurally excludes personality (CHK018)', () => {
    const policy = toPolicyConfig(AGENT_CONFIGS[0]!);
    expect(policy).not.toHaveProperty('personality');
    expect(policy).not.toHaveProperty('displayName');
    expect(policy).not.toHaveProperty('roleSummary');
  });

  it('handoff targets reference only real agents', () => {
    for (const config of AGENT_CONFIGS) {
      for (const target of config.handoffTargets) {
        expect(AGENT_IDS).toContain(target);
      }
    }
  });
});

import { createHash } from 'node:crypto';

type MockTargetAccount = { config: unknown };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Mock connectors store current resource state under config.mockTargets[targetResource].
 * Ambiguous or missing state returns null so callers can fail closed.
 */
export function mockTargetStateHash(accounts: readonly MockTargetAccount[], targetResource: string): string | null {
  const matches: unknown[] = [];
  for (const account of accounts) {
    if (!account.config || typeof account.config !== 'object' || Array.isArray(account.config)) continue;
    const mockTargets = (account.config as Record<string, unknown>).mockTargets;
    if (!mockTargets || typeof mockTargets !== 'object' || Array.isArray(mockTargets)) continue;
    if (Object.hasOwn(mockTargets, targetResource)) matches.push((mockTargets as Record<string, unknown>)[targetResource]);
  }
  if (matches.length !== 1) return null;
  return createHash('sha256').update(canonical(matches[0])).digest('hex');
}

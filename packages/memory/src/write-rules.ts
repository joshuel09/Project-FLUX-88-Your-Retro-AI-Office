/**
 * Write-permission enforcement (T035, FR-023/024, CHK022).
 * Permissions come from the agent registry's PolicyConfig — presentation
 * fields can never influence these decisions (constitution II).
 */
import type { PolicyConfig } from '@flux88/agents';

export const MEMORY_CATEGORIES = ['shared', 'project', 'private', 'dept', 'ops'] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export type VerificationStatus = 'verified' | 'proposed' | 'untrusted';

export interface WriteDecision {
  allowed: boolean;
  /** When set, the write may proceed only with this verification status. */
  forcedStatus?: VerificationStatus;
  reason?: string;
}

/**
 * Owner writes anywhere with any status. Agents write only to categories in
 * their policy's memory.write list; the 'shared:proposed' grant allows writing
 * to 'shared' but forces 'proposed' status. Agents can never self-mark
 * 'verified' — verification is the owner's call.
 */
export function checkWritePermission(
  actor: { kind: 'owner' } | { kind: 'agent'; policy: PolicyConfig } | { kind: 'system' } | { kind: 'connector' },
  category: MemoryCategory,
): WriteDecision {
  if (actor.kind === 'owner') return { allowed: true };
  if (actor.kind === 'system' || actor.kind === 'connector') {
    // Non-agent machine writers only ever produce untrusted entries.
    return { allowed: true, forcedStatus: 'untrusted' };
  }
  const grants = actor.policy.memory.write;
  if (grants.includes(category)) {
    return { allowed: true, forcedStatus: 'proposed' };
  }
  if (category === 'shared' && grants.includes('shared:proposed')) {
    return { allowed: true, forcedStatus: 'proposed' };
  }
  return {
    allowed: false,
    reason: `write to '${category}' is not granted to this agent`,
  };
}

/** Categories an actor may read. Owner reads everything. */
export function readableCategories(
  actor: { kind: 'owner' } | { kind: 'agent'; policy: PolicyConfig },
): MemoryCategory[] {
  if (actor.kind === 'owner') return [...MEMORY_CATEGORIES];
  return MEMORY_CATEGORIES.filter((c) => actor.policy.memory.read.includes(c));
}

/**
 * Secret-shaped content detection (FR-024). Matches are rejected before any
 * row is written; the audit records WHICH pattern matched, never the content
 * (no secrets in logs — org security guidelines).
 */
const SECRET_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'private_key_block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'aws_access_key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'github_token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { name: 'slack_token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'anthropic_key', pattern: /\bsk-ant-[A-Za-z0-9-]{20,}\b/ },
  { name: 'generic_api_key', pattern: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'bearer_token', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/i },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/ },
  {
    name: 'credential_assignment',
    pattern: /\b(?:password|passwd|api[_-]?key|secret|token|private[_-]?key)\b\s*[:=]\s*['"]?[^\s'"]{8,}/i,
  },
  { name: 'connection_string_credentials', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s@]+@/i },
];

/** Returns the matched pattern name, or null when the content looks safe. */
export function detectSecretShaped(text: string): string | null {
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) return name;
  }
  return null;
}


/** Reject secret-shaped strings and explicit credential fields in validated JSON. */
export function containsSecretMaterial(value: unknown): boolean {
  if (typeof value === 'string') return detectSecretShaped(value) !== null;
  if (Array.isArray(value)) return value.some(containsSecretMaterial);
  if (value !== null && typeof value === 'object') return Object.entries(value).some(([key, item]) =>
    (/^(password|passwd|api[_-]?key|secret|token|private[_-]?key)$/i.test(key) && typeof item === 'string' && item.length > 0) || containsSecretMaterial(item));
  return false;
}

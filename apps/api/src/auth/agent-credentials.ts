import { createHash, randomBytes } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';

import type { AgentId } from '@flux88/core';
import { schema, type Db } from '@flux88/db';

const TOKEN_PREFIX = 'flux88_agent_';
export const AGENT_CREDENTIAL_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export function hashAgentCredential(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function rotateAgentCredential(db: Db, agentId: AgentId) {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const tokenHash = hashAgentCredential(token);
  const expiresAt = new Date(Date.now() + AGENT_CREDENTIAL_TTL_MS);
  const now = new Date();

  const credential = await db.transaction(async (tx) => {
    const lockKey = `agent-credential:${agentId}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const previous = await tx.update(schema.agentServiceCredentials).set({ revokedAt: now }).where(and(
      eq(schema.agentServiceCredentials.agentId, agentId),
      isNull(schema.agentServiceCredentials.revokedAt),
    )).returning({ id: schema.agentServiceCredentials.id });
    for (const oldCredential of previous) {
      await tx.insert(schema.auditEvents).values({
        actorType: 'owner', actorId: 'session', action: 'agent.credential_revoked',
        targetType: 'agent_credential', targetId: oldCredential.id,
        payload: { agentId, reason: 'rotated' },
      });
    }
    const [created] = await tx.insert(schema.agentServiceCredentials).values({ agentId, tokenHash, expiresAt }).returning({
      id: schema.agentServiceCredentials.id,
      expiresAt: schema.agentServiceCredentials.expiresAt,
    });
    if (!created) throw new Error('agent credential insert returned no row');
    await tx.insert(schema.auditEvents).values({
      actorType: 'owner', actorId: 'session', action: 'agent.credential_issued',
      targetType: 'agent_credential', targetId: created.id,
      payload: { agentId, expiresAt: created.expiresAt.toISOString() },
    });
    return created;
  });

  return { ...credential, token };
}

export async function revokeAgentCredential(db: Db, agentId: AgentId, credentialId: string) {
  return db.transaction(async (tx) => {
    const [credential] = await tx.update(schema.agentServiceCredentials).set({ revokedAt: new Date() }).where(and(
      eq(schema.agentServiceCredentials.id, credentialId),
      eq(schema.agentServiceCredentials.agentId, agentId),
      isNull(schema.agentServiceCredentials.revokedAt),
    )).returning({ id: schema.agentServiceCredentials.id });
    if (!credential) return null;
    await tx.insert(schema.auditEvents).values({
      actorType: 'owner', actorId: 'session', action: 'agent.credential_revoked',
      targetType: 'agent_credential', targetId: credential.id,
      payload: { agentId },
    });
    return credential;
  });
}

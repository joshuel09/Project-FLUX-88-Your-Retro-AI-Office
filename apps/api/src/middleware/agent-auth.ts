import { and, eq, gt, isNull } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';

import { schema, type Db } from '@flux88/db';
import type { AgentId } from '@flux88/core';

import { hashAgentCredential } from '../auth/agent-credentials.js';

const TOKEN_PATTERN = /^Bearer flux88_agent_[A-Za-z0-9_-]{43}$/;
export type AgentAuthEnv = { Variables: { agentId: AgentId } };

/** Bearer-token gate for the isolated, least-privilege agent API. */
export function requireAgent(db: Db): MiddlewareHandler<AgentAuthEnv> {
  return async (c, next) => {
    const authorization = c.req.header('authorization') ?? '';
    if (!TOKEN_PATTERN.test(authorization)) {
      return c.json({ error: { code: 'unauthenticated', message: 'Invalid agent credential' } }, 401);
    }
    const token = authorization.slice('Bearer '.length);
    const tokenHash = hashAgentCredential(token);
    const now = new Date();
    const [credential] = await db.select({ id: schema.agentServiceCredentials.id, agentId: schema.agentServiceCredentials.agentId })
      .from(schema.agentServiceCredentials)
      .where(and(
        eq(schema.agentServiceCredentials.tokenHash, tokenHash),
        isNull(schema.agentServiceCredentials.revokedAt),
        gt(schema.agentServiceCredentials.expiresAt, now),
      ));
    if (!credential) {
      return c.json({ error: { code: 'unauthenticated', message: 'Invalid agent credential' } }, 401);
    }
    const [agent] = await db.select({ id: schema.agents.id, enabled: schema.agents.enabled })
      .from(schema.agents).where(eq(schema.agents.id, credential.agentId));
    if (!agent?.enabled) {
      return c.json({ error: { code: 'unauthenticated', message: 'Invalid agent credential' } }, 401);
    }
    const [used] = await db.update(schema.agentServiceCredentials).set({ lastUsedAt: now }).where(and(
      eq(schema.agentServiceCredentials.id, credential.id),
      isNull(schema.agentServiceCredentials.revokedAt),
      gt(schema.agentServiceCredentials.expiresAt, now),
    )).returning({ id: schema.agentServiceCredentials.id });
    if (!used) return c.json({ error: { code: 'unauthenticated', message: 'Invalid agent credential' } }, 401);

    c.set('agentId', agent.id);
    await next();
  };
}

import { asc, eq } from 'drizzle-orm';

import type { AgentId } from '@flux88/core';
import type { Db } from '../client.js';
import { agents } from '../schema/index.js';

export async function listAgents(db: Db) {
  return db.select().from(agents).orderBy(asc(agents.department), asc(agents.id));
}

export async function getAgent(db: Db, id: AgentId) {
  const [row] = await db.select().from(agents).where(eq(agents.id, id));
  return row ?? null;
}

/** Only non-policy fields may be updated without an approval grant (T018/T040). */
export async function updateAgentPresentation(
  db: Db,
  id: AgentId,
  patch: { displayName?: string; personality?: string; roleSummary?: string; enabled?: boolean },
) {
  const [row] = await db
    .update(agents)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(agents.id, id))
    .returning();
  return row ?? null;
}

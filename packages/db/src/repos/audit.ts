import { desc, eq, and } from 'drizzle-orm';

import type { Db } from '../client.js';
import { auditEvents } from '../schema/index.js';

export type AuditActorType = 'owner' | 'agent' | 'system' | 'connector';

export interface AuditWrite {
  actorType: AuditActorType;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  payload?: Record<string, unknown>;
}

/** Append-only by DB trigger — there is intentionally no update/delete here. */
export async function writeAudit(db: Db, event: AuditWrite) {
  const [row] = await db
    .insert(auditEvents)
    .values({ ...event, payload: event.payload ?? {} })
    .returning();
  return row;
}

export async function listAudit(
  db: Db,
  opts: { limit?: number; actorId?: string; targetType?: string } = {},
) {
  const conditions = [];
  if (opts.actorId) conditions.push(eq(auditEvents.actorId, opts.actorId));
  if (opts.targetType) conditions.push(eq(auditEvents.targetType, opts.targetType));
  return db
    .select()
    .from(auditEvents)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditEvents.createdAt))
    .limit(opts.limit ?? 100);
}

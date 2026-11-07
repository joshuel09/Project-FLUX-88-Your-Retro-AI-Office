/**
 * Memory Vault service (T033): attributed, versioned, revocable knowledge
 * under write-permission rules. Every write/correction/revocation/rejection
 * is audited (constitution IV); duplicates are collapsed via dedupe hash and
 * conflicting claims are surfaced, never silently overwritten (FR-022).
 */
import { createHash } from 'node:crypto';

import { and, asc, eq, isNull, ne } from 'drizzle-orm';

import type { PolicyConfig } from '@flux88/agents';
import type { AgentId } from '@flux88/core';
import { schema, writeAudit, type Db } from '@flux88/db';

import type { Embedder } from './embedder.js';
import {
  checkWritePermission,
  detectSecretShaped,
  type MemoryCategory,
  type VerificationStatus,
} from './write-rules.js';

const { memoryEntries, memoryVersions } = schema;

export type MemoryActor =
  | { kind: 'owner' }
  | { kind: 'agent'; agentId: AgentId; policy: PolicyConfig }
  | { kind: 'system'; id: string }
  | { kind: 'connector'; id: string };

export type MemoryEntryRow = typeof schema.memoryEntries.$inferSelect;

export interface MemoryWriteInput {
  category: MemoryCategory;
  title: string;
  body: string;
  scope?: 'shared' | 'project' | 'private' | undefined;
  projectId?: string | undefined;
  sourceAttribution?: string | undefined;
  verificationStatus?: VerificationStatus | undefined;
  confidence?: number | undefined;
}

export type MemoryWriteResult =
  | { ok: true; entry: MemoryEntryRow; deduped: boolean }
  | { ok: false; code: 'forbidden' | 'secret_rejected'; message: string };

function actorAudit(actor: MemoryActor): { actorType: 'owner' | 'agent' | 'system' | 'connector'; actorId: string } {
  switch (actor.kind) {
    case 'owner':
      return { actorType: 'owner', actorId: 'session' };
    case 'agent':
      return { actorType: 'agent', actorId: actor.agentId };
    default:
      return { actorType: actor.kind, actorId: actor.id };
  }
}

function authorOf(actor: MemoryActor): string {
  return actor.kind === 'owner' ? 'owner' : actor.kind === 'agent' ? actor.agentId : actor.id;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function dedupeHashOf(category: string, title: string, body: string): string {
  return createHash('sha256').update(`${category}\n${normalize(title)}\n${normalize(body)}`).digest('hex');
}

export async function writeMemory(
  db: Db,
  embedder: Embedder,
  actor: MemoryActor,
  input: MemoryWriteInput,
): Promise<MemoryWriteResult> {
  const audit = actorAudit(actor);

  // FR-024: secret-shaped content never lands in the vault. The audit names
  // the matched pattern only — the content itself is never logged.
  const secretPattern = detectSecretShaped(`${input.title}\n${input.body}`);
  if (secretPattern) {
    await writeAudit(db, {
      ...audit,
      action: 'memory.secret_rejected',
      targetType: 'memory',
      targetId: 'rejected',
      payload: { pattern: secretPattern, category: input.category },
    });
    return { ok: false, code: 'secret_rejected', message: 'Content looks like a credential or secret and was rejected.' };
  }

  const decision = checkWritePermission(
    actor.kind === 'agent' ? { kind: 'agent', policy: actor.policy } : { kind: actor.kind },
    input.category,
  );
  if (!decision.allowed) {
    await writeAudit(db, {
      ...audit,
      action: 'memory.write_refused',
      targetType: 'memory',
      targetId: input.category,
      payload: { category: input.category, reason: decision.reason ?? 'forbidden' },
    });
    return { ok: false, code: 'forbidden', message: decision.reason ?? 'Write not permitted.' };
  }
  const status: VerificationStatus = decision.forcedStatus ?? input.verificationStatus ?? 'proposed';

  // Dedupe: identical knowledge is returned, not duplicated (FR-022).
  const hash = dedupeHashOf(input.category, input.title, input.body);
  const [existing] = await db
    .select()
    .from(memoryEntries)
    .where(and(eq(memoryEntries.dedupeHash, hash), isNull(memoryEntries.revokedAt)));
  if (existing) {
    await writeAudit(db, {
      ...audit,
      action: 'memory.deduped',
      targetType: 'memory',
      targetId: existing.id,
      payload: { category: input.category },
    });
    return { ok: true, entry: existing, deduped: true };
  }

  // Conflict surfacing: same claim title in the same category with a
  // different body is a conflict, linked on both sides.
  const siblings = await db
    .select({ id: memoryEntries.id, title: memoryEntries.title, conflictsWith: memoryEntries.conflictsWith })
    .from(memoryEntries)
    .where(
      and(eq(memoryEntries.category, input.category), isNull(memoryEntries.revokedAt), ne(memoryEntries.dedupeHash, hash)),
    );
  const conflicting = siblings.filter((s) => normalize(s.title) === normalize(input.title));

  const embedding = await embedder.embed(`${input.title}\n${input.body}`);
  const author = authorOf(actor);

  const entry = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(memoryEntries)
      .values({
        scope: input.scope ?? (input.category === 'private' ? 'private' : input.category === 'project' ? 'project' : 'shared'),
        projectId: input.projectId ?? null,
        category: input.category,
        title: input.title,
        body: input.body,
        sourceAttribution: input.sourceAttribution ?? author,
        confidence: input.confidence ?? 0.5,
        verificationStatus: status,
        author,
        embedding,
        dedupeHash: hash,
        conflictsWith: conflicting.map((c) => c.id),
      })
      .returning();
    if (!row) throw new Error('memory insert returned no row');
    await tx.insert(memoryVersions).values({ memoryEntryId: row.id, version: 1, body: input.body, editedBy: author });
    for (const sibling of conflicting) {
      const current = (sibling.conflictsWith as string[] | null) ?? [];
      await tx
        .update(memoryEntries)
        .set({ conflictsWith: [...current, row.id], updatedAt: new Date() })
        .where(eq(memoryEntries.id, sibling.id));
    }
    return row;
  });

  await writeAudit(db, {
    ...audit,
    action: 'memory.write',
    targetType: 'memory',
    targetId: entry.id,
    payload: { category: input.category, status, conflicts: conflicting.length },
  });
  return { ok: true, entry, deduped: false };
}

export async function getMemory(db: Db, id: string) {
  const [entry] = await db.select().from(memoryEntries).where(eq(memoryEntries.id, id));
  if (!entry) return null;
  const versions = await db
    .select()
    .from(memoryVersions)
    .where(eq(memoryVersions.memoryEntryId, id))
    .orderBy(asc(memoryVersions.version));
  const conflictIds = (entry.conflictsWith as string[] | null) ?? [];
  const conflicts =
    conflictIds.length === 0
      ? []
      : await Promise.all(
          conflictIds.map(async (cid) => {
            const [c] = await db
              .select({
                id: memoryEntries.id,
                title: memoryEntries.title,
                author: memoryEntries.author,
                verificationStatus: memoryEntries.verificationStatus,
                revokedAt: memoryEntries.revokedAt,
              })
              .from(memoryEntries)
              .where(eq(memoryEntries.id, cid));
            return c ?? null;
          }),
        );
  return { entry, versions, conflicts: conflicts.filter((c) => c !== null) };
}

export type MemoryActionResult =
  | { ok: true; entry: MemoryEntryRow }
  | { ok: false; code: 'not_found' | 'forbidden'; message: string };

function mayModify(actor: MemoryActor, entry: MemoryEntryRow): boolean {
  if (actor.kind === 'owner') return true;
  if (actor.kind === 'agent') return entry.author === actor.agentId;
  return false;
}

/** Correction = a new version, never a silent edit (FR-022). */
export async function correctMemory(
  db: Db,
  embedder: Embedder,
  actor: MemoryActor,
  id: string,
  patch: { body: string; changeNote?: string | undefined },
): Promise<MemoryActionResult> {
  const [entry] = await db.select().from(memoryEntries).where(eq(memoryEntries.id, id));
  if (!entry) return { ok: false, code: 'not_found', message: 'Unknown memory entry' };
  if (!mayModify(actor, entry)) return { ok: false, code: 'forbidden', message: 'Only the owner or the author may correct an entry.' };

  const secretPattern = detectSecretShaped(patch.body);
  if (secretPattern) {
    await writeAudit(db, {
      ...actorAudit(actor),
      action: 'memory.secret_rejected',
      targetType: 'memory',
      targetId: id,
      payload: { pattern: secretPattern, during: 'correction' },
    });
    return { ok: false, code: 'forbidden', message: 'Correction looks like a credential or secret and was rejected.' };
  }

  const embedding = await embedder.embed(`${entry.title}\n${patch.body}`);
  const author = authorOf(actor);
  // Agent corrections drop back to 'proposed'; owner corrections keep status.
  const status: VerificationStatus = actor.kind === 'owner' ? entry.verificationStatus : 'proposed';

  const updated = await db.transaction(async (tx) => {
    const versions = await tx
      .select({ version: memoryVersions.version })
      .from(memoryVersions)
      .where(eq(memoryVersions.memoryEntryId, id));
    const next = Math.max(0, ...versions.map((v) => v.version)) + 1;
    await tx.insert(memoryVersions).values({
      memoryEntryId: id,
      version: next,
      body: patch.body,
      editedBy: author,
      changeNote: patch.changeNote ?? '',
    });
    const [row] = await tx
      .update(memoryEntries)
      .set({
        body: patch.body,
        embedding,
        verificationStatus: status,
        dedupeHash: dedupeHashOf(entry.category, entry.title, patch.body),
        updatedAt: new Date(),
      })
      .where(eq(memoryEntries.id, id))
      .returning();
    if (!row) throw new Error('memory update returned no row');
    return row;
  });

  await writeAudit(db, {
    ...actorAudit(actor),
    action: 'memory.correct',
    targetType: 'memory',
    targetId: id,
    payload: { changeNote: patch.changeNote ?? '' },
  });
  return { ok: true, entry: updated };
}

/** Revocation hides the entry from search but preserves its history (FR-025). */
export async function revokeMemory(db: Db, actor: MemoryActor, id: string): Promise<MemoryActionResult> {
  const [entry] = await db.select().from(memoryEntries).where(eq(memoryEntries.id, id));
  if (!entry) return { ok: false, code: 'not_found', message: 'Unknown memory entry' };
  if (!mayModify(actor, entry)) return { ok: false, code: 'forbidden', message: 'Only the owner or the author may revoke an entry.' };

  const [updated] = await db
    .update(memoryEntries)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(memoryEntries.id, id))
    .returning();
  if (!updated) return { ok: false, code: 'not_found', message: 'Unknown memory entry' };

  await writeAudit(db, {
    ...actorAudit(actor),
    action: 'memory.revoke',
    targetType: 'memory',
    targetId: id,
    payload: {},
  });
  return { ok: true, entry: updated };
}

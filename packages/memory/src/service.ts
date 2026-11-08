/**
 * Memory Vault service (T033): attributed, versioned, revocable knowledge
 * under write-permission rules. Every write/correction/revocation/rejection
 * is audited (constitution IV); duplicates are collapsed via dedupe hash and
 * conflicting claims are surfaced, never silently overwritten (FR-022).
 */
import { createHash } from 'node:crypto';

import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

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

type MemoryTx = Parameters<Parameters<Db['transaction']>[0]>[0];

function partition(scope: MemoryEntryRow['scope'], projectId: string | null, author: string) {
  return and(
    eq(memoryEntries.scope, scope),
    projectId === null ? isNull(memoryEntries.projectId) : eq(memoryEntries.projectId, projectId),
    scope === 'private' ? eq(memoryEntries.author, author) : undefined,
  );
}

async function lockClaim(tx: MemoryTx, category: string, title: string) {
  // Transaction-scoped lock works across worker processes, not just this instance.
  const key = JSON.stringify([category, normalize(title)]);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

export async function writeMemory(
  db: Db,
  embedder: Embedder,
  actor: MemoryActor,
  input: MemoryWriteInput,
): Promise<MemoryWriteResult> {
  const audit = actorAudit(actor);

  // FR-024: secret-shaped content never lands in the vault — including in
  // the attribution field, which is also persisted and searchable. The audit
  // names the matched pattern only; the content itself is never logged.
  const secretPattern = detectSecretShaped(`${input.title}\n${input.body}\n${input.sourceAttribution ?? ''}\n${input.projectId ?? ''}`);
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

  const hash = dedupeHashOf(input.category, input.title, input.body);
  const scope = input.scope ?? (input.category === 'private' ? 'private' : input.category === 'project' ? 'project' : 'shared');
  const projectId = input.projectId ?? null;
  const author = authorOf(actor);
  const boundary = partition(scope, projectId, author);
  const embedding = await embedder.embed(`${input.title}\n${input.body}`);

  return db.transaction(async (tx) => {
    await lockClaim(tx, input.category, input.title);
    // Status participates in dedupe so untrusted writers cannot inherit verification.
    const [existing] = await tx.select().from(memoryEntries).where(and(
      eq(memoryEntries.dedupeHash, hash), boundary,
      eq(memoryEntries.verificationStatus, status), isNull(memoryEntries.revokedAt),
    ));
    if (existing) {
      await tx.insert(schema.auditEvents).values({
        ...audit, action: 'memory.deduped', targetType: 'memory', targetId: existing.id,
        payload: { category: input.category },
      });
      return { ok: true as const, entry: existing, deduped: true };
    }

    const siblings = await tx.select().from(memoryEntries).where(and(
      eq(memoryEntries.category, input.category), boundary,
      isNull(memoryEntries.revokedAt), ne(memoryEntries.dedupeHash, hash),
    ));
    const conflicting = siblings.filter((row) => normalize(row.title) === normalize(input.title));
    const [entry] = await tx.insert(memoryEntries).values({
      scope, projectId, category: input.category, title: input.title, body: input.body,
      sourceAttribution: input.sourceAttribution ?? author, confidence: input.confidence ?? 0.5,
      verificationStatus: status, author, embedding, dedupeHash: hash,
      conflictsWith: conflicting.map((row) => row.id),
    }).returning();
    if (!entry) throw new Error('memory insert returned no row');
    await tx.insert(memoryVersions).values({ memoryEntryId: entry.id, version: 1, body: input.body, editedBy: author });
    for (const sibling of conflicting) {
      const current = (sibling.conflictsWith as string[] | null) ?? [];
      await tx.update(memoryEntries).set({ conflictsWith: [...new Set([...current, entry.id])], updatedAt: new Date() })
        .where(eq(memoryEntries.id, sibling.id));
    }
    await tx.insert(schema.auditEvents).values({
      ...audit, action: 'memory.write', targetType: 'memory', targetId: entry.id,
      payload: { category: input.category, status, conflicts: conflicting.length },
    });
    return { ok: true as const, entry, deduped: false };
  });
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
      : await db
          .select({
            id: memoryEntries.id,
            title: memoryEntries.title,
            author: memoryEntries.author,
            verificationStatus: memoryEntries.verificationStatus,
            revokedAt: memoryEntries.revokedAt,
          })
          .from(memoryEntries)
          .where(inArray(memoryEntries.id, conflictIds));
  return { entry, versions, conflicts };
}

export type MemoryActionResult =
  | { ok: true; entry: MemoryEntryRow }
  | { ok: false; code: 'not_found' | 'forbidden' | 'secret_rejected'; message: string };

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
  // Notes are persisted in both history and audit, so scan them before either write.
  const secretPattern = detectSecretShaped(`${patch.body}\n${patch.changeNote ?? ''}`);
  if (secretPattern) {
    await writeAudit(db, {
      ...actorAudit(actor), action: 'memory.secret_rejected', targetType: 'memory', targetId: id,
      payload: { pattern: secretPattern, during: 'correction' },
    });
    return { ok: false, code: 'secret_rejected', message: 'Correction looks like a credential or secret and was rejected.' };
  }

  return db.transaction(async (tx) => {
    const [initial] = await tx.select().from(memoryEntries).where(eq(memoryEntries.id, id));
    if (!initial) return { ok: false as const, code: 'not_found' as const, message: 'Unknown memory entry' };
    await lockClaim(tx, initial.category, initial.title);
    const [entry] = await tx.select().from(memoryEntries).where(eq(memoryEntries.id, id)).for('update');
    if (!entry) return { ok: false as const, code: 'not_found' as const, message: 'Unknown memory entry' };
    const permission = checkWritePermission(
      actor.kind === 'agent' ? { kind: 'agent', policy: actor.policy } : { kind: actor.kind },
      entry.category as MemoryCategory,
    );
    if (!mayModify(actor, entry) || !permission.allowed) {
      await tx.insert(schema.auditEvents).values({
        ...actorAudit(actor), action: 'memory.write_refused', targetType: 'memory', targetId: id,
        payload: { during: 'correction', reason: 'author_or_category_permission_required' },
      });
      return { ok: false as const, code: 'forbidden' as const, message: 'Correction requires authorship and current category permission.' };
    }
    const embedding = await embedder.embed(`${entry.title}\n${patch.body}`);
    const status: VerificationStatus = actor.kind === 'owner' ? entry.verificationStatus : 'proposed';
    const versions = await tx.select({ version: memoryVersions.version }).from(memoryVersions)
      .where(eq(memoryVersions.memoryEntryId, id));
    const next = Math.max(0, ...versions.map((v) => v.version)) + 1;
    await tx.insert(memoryVersions).values({
      memoryEntryId: id, version: next, body: patch.body, editedBy: authorOf(actor), changeNote: patch.changeNote ?? '',
    });
    // Corrections can resolve or introduce conflicts; update both sides under the same claim lock.
    const siblings = await tx.select().from(memoryEntries).where(and(
      eq(memoryEntries.category, entry.category), partition(entry.scope, entry.projectId, entry.author),
      ne(memoryEntries.id, id), isNull(memoryEntries.revokedAt),
    ));
    const sameClaim = siblings.filter((row) => normalize(row.title) === normalize(entry.title));
    const conflicts = sameClaim.filter((row) => normalize(row.body) !== normalize(patch.body) && entry.revokedAt === null);
    for (const sibling of sameClaim) {
      const links = ((sibling.conflictsWith as string[] | null) ?? []).filter((link) => link !== id);
      if (conflicts.some((row) => row.id === sibling.id)) links.push(id);
      await tx.update(memoryEntries).set({ conflictsWith: links, updatedAt: new Date() }).where(eq(memoryEntries.id, sibling.id));
    }
    const [updated] = await tx.update(memoryEntries).set({
      body: patch.body, embedding, verificationStatus: status,
      dedupeHash: dedupeHashOf(entry.category, entry.title, patch.body),
      conflictsWith: conflicts.map((row) => row.id), updatedAt: new Date(),
    }).where(eq(memoryEntries.id, id)).returning();
    if (!updated) throw new Error('memory update returned no row');
    await tx.insert(schema.auditEvents).values({
      ...actorAudit(actor), action: 'memory.correct', targetType: 'memory', targetId: id,
      payload: { changeNote: patch.changeNote ?? '' },
    });
    return { ok: true as const, entry: updated };
  });
}

/** Revocation hides the entry from search but preserves its history (FR-025). */
export async function revokeMemory(db: Db, actor: MemoryActor, id: string): Promise<MemoryActionResult> {
  return db.transaction(async (tx) => {
    const [initial] = await tx.select().from(memoryEntries).where(eq(memoryEntries.id, id));
    if (!initial) return { ok: false as const, code: 'not_found' as const, message: 'Unknown memory entry' };
    await lockClaim(tx, initial.category, initial.title);
    const [entry] = await tx.select().from(memoryEntries).where(eq(memoryEntries.id, id)).for('update');
    if (!entry) return { ok: false as const, code: 'not_found' as const, message: 'Unknown memory entry' };
    if (!mayModify(actor, entry)) {
      await tx.insert(schema.auditEvents).values({
        ...actorAudit(actor), action: 'memory.write_refused', targetType: 'memory', targetId: id,
        payload: { during: 'revocation', reason: 'author_required' },
      });
      return { ok: false as const, code: 'forbidden' as const, message: 'Only the owner or the author may revoke an entry.' };
    }
    const [updated] = await tx.update(memoryEntries).set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(memoryEntries.id, id)).returning();
    if (!updated) throw new Error('memory revoke returned no row');
    await tx.insert(schema.auditEvents).values({
      ...actorAudit(actor), action: 'memory.revoke', targetType: 'memory', targetId: id, payload: {},
    });
    return { ok: true as const, entry: updated };
  });
}

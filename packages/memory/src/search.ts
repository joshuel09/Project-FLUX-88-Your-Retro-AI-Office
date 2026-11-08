/**
 * Memory search (T034): Postgres FTS for keyword mode, pgvector cosine
 * distance for semantic mode (mock embedder in Phase 1). Both modes respect
 * the actor's readable categories and never return revoked entries; every
 * result carries attribution and verification status (FR-021).
 */
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import type { AgentId } from '@flux88/core';
import { schema, type Db } from '@flux88/db';

import type { Embedder } from './embedder.js';
import type { MemoryCategory } from './write-rules.js';

const { memoryEntries } = schema;

export interface MemorySearchHit {
  id: string;
  category: string;
  title: string;
  body: string;
  author: string;
  sourceAttribution: string;
  verificationStatus: 'verified' | 'proposed' | 'untrusted';
  confidence: number;
  conflictsWith: string[];
  createdAt: Date;
  /** FTS rank (keyword) or cosine similarity (semantic), higher is better. */
  score: number;
}

export interface MemorySearchOptions {
  categories: MemoryCategory[];
  limit?: number;
  /** Trusted caller context, never supplied directly by an HTTP query. */
  actor?: { kind: 'owner' } | { kind: 'agent'; agentId: AgentId };
  projectId?: string;
}

function visibility(opts: MemorySearchOptions) {
  if (opts.actor?.kind === 'owner') return undefined;
  // Missing caller context fails closed to shared entries, even for broadly granted categories.
  const shared = eq(memoryEntries.scope, 'shared');
  if (opts.actor?.kind !== 'agent') return shared;
  return or(
    shared,
    and(eq(memoryEntries.scope, 'private'), eq(memoryEntries.author, opts.actor.agentId)),
    opts.projectId ? and(eq(memoryEntries.scope, 'project'), eq(memoryEntries.projectId, opts.projectId)) : undefined,
  );
}

const hitColumns = {
  id: memoryEntries.id,
  category: memoryEntries.category,
  title: memoryEntries.title,
  body: memoryEntries.body,
  author: memoryEntries.author,
  sourceAttribution: memoryEntries.sourceAttribution,
  verificationStatus: memoryEntries.verificationStatus,
  confidence: memoryEntries.confidence,
  conflictsWith: memoryEntries.conflictsWith,
  createdAt: memoryEntries.createdAt,
};

function toHit(row: Omit<MemorySearchHit, 'score' | 'conflictsWith'> & { conflictsWith: unknown; score?: unknown }): MemorySearchHit {
  return {
    ...row,
    conflictsWith: (row.conflictsWith as string[] | null) ?? [],
    score: typeof row.score === 'number' ? row.score : Number(row.score ?? 0),
  };
}

export async function searchKeyword(
  db: Db,
  query: string,
  opts: MemorySearchOptions,
): Promise<MemorySearchHit[]> {
  if (opts.categories.length === 0 || query.trim() === '') return [];
  const document = sql`to_tsvector('english', ${memoryEntries.title} || ' ' || ${memoryEntries.body})`;
  const tsQuery = sql`websearch_to_tsquery('english', ${query})`;
  const rows = await db
    .select({ ...hitColumns, score: sql<number>`ts_rank(${document}, ${tsQuery})` })
    .from(memoryEntries)
    .where(
      and(
        isNull(memoryEntries.revokedAt),
        inArray(memoryEntries.category, opts.categories),
        visibility(opts),
        sql`${document} @@ ${tsQuery}`,
      ),
    )
    .orderBy(sql`ts_rank(${document}, ${tsQuery}) DESC`)
    .limit(opts.limit ?? 20);
  return rows.map(toHit);
}

export async function searchSemantic(
  db: Db,
  embedder: Embedder,
  query: string,
  opts: MemorySearchOptions,
): Promise<MemorySearchHit[]> {
  if (opts.categories.length === 0 || query.trim() === '') return [];
  const vector = JSON.stringify(await embedder.embed(query));
  const distance = sql`${memoryEntries.embedding} <=> ${vector}::vector`;
  const rows = await db
    .select({ ...hitColumns, score: sql<number>`1 - (${distance})` })
    .from(memoryEntries)
    .where(
      and(
        isNull(memoryEntries.revokedAt),
        isNotNull(memoryEntries.embedding),
        inArray(memoryEntries.category, opts.categories),
        visibility(opts),
      ),
    )
    .orderBy(distance)
    .limit(opts.limit ?? 20);
  return rows.map(toHit);
}

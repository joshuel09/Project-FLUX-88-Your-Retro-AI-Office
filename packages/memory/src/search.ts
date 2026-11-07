/**
 * Memory search (T034): Postgres FTS for keyword mode, pgvector cosine
 * distance for semantic mode (mock embedder in Phase 1). Both modes respect
 * the actor's readable categories and never return revoked entries; every
 * result carries attribution and verification status (FR-021).
 */
import { and, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

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
  opts: { categories: MemoryCategory[]; limit?: number },
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
  opts: { categories: MemoryCategory[]; limit?: number },
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
      ),
    )
    .orderBy(distance)
    .limit(opts.limit ?? 20);
  return rows.map(toHit);
}

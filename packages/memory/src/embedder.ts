/**
 * Embedder abstraction (T034). Phase 1 ships a deterministic mock over the
 * same 384-dim pgvector column a real embedding model will use in Phase 2+,
 * so semantic search is testable offline (constitution V).
 */

export const EMBEDDING_DIMENSIONS = 384;

export interface Embedder {
  readonly name: 'mock' | 'real';
  embed(text: string): Promise<number[]>;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

/** FNV-1a — stable, fast, good-enough spread for bucketing tokens. */
function fnv1a(token: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Deterministic bag-of-tokens embedding: each token adds weight to a hashed
 * bucket, vector is L2-normalized. Same text always embeds identically, and
 * texts sharing vocabulary land near each other — enough for scenario 3.
 */
export class MockEmbedder implements Embedder {
  readonly name = 'mock' as const;

  async embed(text: string): Promise<number[]> {
    const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
    for (const token of tokenize(text)) {
      const hash = fnv1a(token);
      const bucket = hash % EMBEDDING_DIMENSIONS;
      // Second hash decides the sign so vectors spread across the space.
      const sign = (hash >>> 16) % 2 === 0 ? 1 : -1;
      vector[bucket] = (vector[bucket] ?? 0) + sign;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return norm === 0 ? vector : vector.map((v) => v / norm);
  }
}

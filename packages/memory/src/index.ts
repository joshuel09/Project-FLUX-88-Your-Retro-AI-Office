/**
 * @flux88/memory — Memory Vault: keyword + vector search, write-permission
 * rules, versioning, revocation (US3, FR-020..FR-025).
 */
export { EMBEDDING_DIMENSIONS, MockEmbedder, type Embedder } from './embedder.js';
export {
  MEMORY_CATEGORIES,
  checkWritePermission,
  detectSecretShaped,
  containsSecretMaterial,
  readableCategories,
  type MemoryCategory,
  type VerificationStatus,
  type WriteDecision,
} from './write-rules.js';
export {
  correctMemory,
  dedupeHashOf,
  getMemory,
  revokeMemory,
  writeMemory,
  type MemoryActionResult,
  type MemoryActor,
  type MemoryEntryRow,
  type MemoryWriteInput,
  type MemoryWriteResult,
} from './service.js';
export { searchKeyword, searchSemantic, type MemorySearchHit, type MemorySearchOptions } from './search.js';

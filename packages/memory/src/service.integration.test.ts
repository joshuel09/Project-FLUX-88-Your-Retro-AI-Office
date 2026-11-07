/**
 * T038 — acceptance scenario 3 in mock mode: agent A writes a lesson, agent B
 * retrieves it with attribution; forbidden writes are refused and audited;
 * revoked entries disappear from search but keep their history; untrusted
 * entries stay labeled. Requires the dockerized Postgres (`pnpm db:up &&
 * pnpm db:migrate`); CI provides it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AGENT_CONFIG_BY_ID, toPolicyConfig } from '@flux88/agents';
import { listAudit, type Db } from '@flux88/db';
import { connectTestDb, truncateMutableTables } from '@flux88/db/testing';

import { MockEmbedder } from './embedder.js';
import { searchKeyword, searchSemantic } from './search.js';
import { correctMemory, getMemory, revokeMemory, writeMemory } from './service.js';
import { readableCategories } from './write-rules.js';

let db: Db;
let endClient: () => Promise<void>;
const embedder = new MockEmbedder();

function policyOf(id: 'eleven' | 'marty') {
  const config = AGENT_CONFIG_BY_ID.get(id);
  if (!config) throw new Error(`missing agent config: ${id}`);
  return toPolicyConfig(config);
}
const eleven = { kind: 'agent' as const, agentId: 'eleven' as const, policy: policyOf('eleven') };
const marty = { kind: 'agent' as const, agentId: 'marty' as const, policy: policyOf('marty') };

beforeAll(async () => {
  const conn = connectTestDb();
  db = conn.db;
  endClient = () => conn.client.end();
  await truncateMutableTables(db);
});

afterAll(async () => {
  await endClient?.();
});

describe('US3 — shared Memory Vault (scenario 3)', () => {
  it('agent A writes a lesson; agent B retrieves it with attribution and status', async () => {
    const written = await writeMemory(db, embedder, eleven, {
      category: 'shared',
      title: 'CRT overlays and accessibility',
      body: 'Reduced-motion users need the CRT scanline overlay disabled; use the prefers-reduced-motion media query.',
      sourceAttribution: 'eleven: WCAG research task',
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.entry.verificationStatus).toBe('proposed'); // agents cannot self-verify
    expect(written.entry.author).toBe('eleven');

    // Agent B (marty) searches within its readable categories.
    const readable = readableCategories(marty);
    const keywordHits = await searchKeyword(db, 'CRT overlay reduced motion', { categories: readable });
    expect(keywordHits.length).toBeGreaterThan(0);
    expect(keywordHits[0]?.author).toBe('eleven');
    expect(keywordHits[0]?.sourceAttribution).toContain('eleven');

    const semanticHits = await searchSemantic(db, embedder, 'disable scanline overlay for motion-sensitive users', {
      categories: readable,
    });
    expect(semanticHits.some((h) => h.id === written.entry.id)).toBe(true);
  });

  it('refuses and audits a forbidden-category write', async () => {
    // eleven's grants are shared:proposed + project — 'ops' is forbidden.
    const refused = await writeMemory(db, embedder, eleven, {
      category: 'ops',
      title: 'Ops note',
      body: 'This should never land.',
    });
    expect(refused).toMatchObject({ ok: false, code: 'forbidden' });

    const audits = await listAudit(db, { actorId: 'eleven' });
    expect(audits.some((a) => a.action === 'memory.write_refused')).toBe(true);
  });

  it('rejects secret-shaped content and audits the pattern, not the content', async () => {
    const rejected = await writeMemory(db, embedder, eleven, {
      category: 'shared',
      title: 'Handy snippet',
      body: 'password = definitely-not-a-real-pw', // dummy test vector
    });
    expect(rejected).toMatchObject({ ok: false, code: 'secret_rejected' });

    const audits = await listAudit(db, { actorId: 'eleven' });
    const rejection = audits.find((a) => a.action === 'memory.secret_rejected');
    expect(rejection).toBeDefined();
    expect(JSON.stringify(rejection?.payload)).not.toContain('definitely-not-a-real-pw');

    // The attribution field is persisted and searchable, so it is scanned too.
    const viaAttribution = await writeMemory(db, embedder, eleven, {
      category: 'shared',
      title: 'Innocent title',
      body: 'Innocent body.',
      sourceAttribution: 'AKIAIOSFODNN7EXAMPLE', // canonical AWS docs example key
    });
    expect(viaAttribution).toMatchObject({ ok: false, code: 'secret_rejected' });
  });

  it('dedupes identical knowledge instead of duplicating it', async () => {
    const input = {
      category: 'shared' as const,
      title: 'Pnpm release-age rule',
      body: 'Dependencies must be published at least 7 days before install.',
    };
    const first = await writeMemory(db, embedder, eleven, input);
    const second = await writeMemory(db, embedder, eleven, input);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.deduped).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
  });

  it('surfaces conflicting claims on both entries', async () => {
    const a = await writeMemory(db, embedder, eleven, {
      category: 'shared',
      title: 'Default API port',
      body: 'The API listens on port 3001.',
    });
    const b = await writeMemory(db, embedder, { kind: 'owner' }, {
      category: 'shared',
      title: 'Default API port',
      body: 'The API listens on port 8080.',
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const detailA = await getMemory(db, a.entry.id);
    const detailB = await getMemory(db, b.entry.id);
    expect(detailB?.conflicts.some((c) => c?.id === a.entry.id)).toBe(true);
    expect(detailA?.entry.conflictsWith as string[]).toContain(b.entry.id);
  });

  it('corrections create versions; revocation hides from search but keeps history', async () => {
    const written = await writeMemory(db, embedder, eleven, {
      category: 'project',
      title: 'Playwright locator pitfalls',
      body: 'Strict mode flags ambiguous locators.',
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;

    const corrected = await correctMemory(db, embedder, eleven, written.entry.id, {
      body: 'Strict mode flags ambiguous locators; use exact:true for literal heading names.',
      changeNote: 'added exact:true guidance',
    });
    expect(corrected.ok).toBe(true);

    // marty is not the author — correction/revocation refused.
    const denied = await revokeMemory(db, marty, written.entry.id);
    expect(denied).toMatchObject({ ok: false, code: 'forbidden' });

    const revoked = await revokeMemory(db, eleven, written.entry.id);
    expect(revoked.ok).toBe(true);

    const hits = await searchKeyword(db, 'Playwright locator', { categories: readableCategories(marty) });
    expect(hits.some((h) => h.id === written.entry.id)).toBe(false);

    const detail = await getMemory(db, written.entry.id);
    expect(detail?.versions).toHaveLength(2);
    expect(detail?.entry.revokedAt).not.toBeNull();
  });

  it('labels untrusted writers and keeps the label in search results', async () => {
    const written = await writeMemory(db, embedder, { kind: 'connector', id: 'github-mock' }, {
      category: 'shared',
      title: 'External feedback summary',
      body: 'Imported from an external issue thread: users want keyboard navigation everywhere.',
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.entry.verificationStatus).toBe('untrusted');

    const hits = await searchKeyword(db, 'external feedback keyboard', { categories: readableCategories({ kind: 'owner' }) });
    expect(hits.find((h) => h.id === written.entry.id)?.verificationStatus).toBe('untrusted');
  });
});

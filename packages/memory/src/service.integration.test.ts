/**
 * T038 — acceptance scenario 3 in mock mode: agent A writes a lesson, agent B
 * retrieves it with attribution; forbidden writes are refused and audited;
 * revoked entries disappear from search but keep their history; untrusted
 * entries stay labeled. Requires the dockerized Postgres (`pnpm db:up &&
 * pnpm db:migrate`); CI provides it.
 */
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AGENT_CONFIG_BY_ID, toPolicyConfig } from '@flux88/agents';
import { listAudit, schema, type Db } from '@flux88/db';
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
    const viaProject = await writeMemory(db, embedder, eleven, {
      category: 'project', title: 'Safe project note', body: 'Safe body.',
      projectId: 'AKIAIOSFODNN7EXAMPLE', // dummy public test vector
    });
    expect(viaProject).toMatchObject({ ok: false, code: 'secret_rejected' });
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

  it('rejects secrets in correction notes before history or audit persistence', async () => {
    const written = await writeMemory(db, embedder, eleven, {
      category: 'shared', title: 'Correction note secret regression', body: 'Safe knowledge.',
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const rejected = await correctMemory(db, embedder, eleven, written.entry.id, {
      body: 'Still safe knowledge.', changeNote: 'password = dummy-review-secret-value',
    });
    expect(rejected).toMatchObject({ ok: false, code: 'secret_rejected' });
    const detail = await getMemory(db, written.entry.id);
    expect(detail?.versions).toHaveLength(1);
    expect(detail?.entry.body).toBe('Safe knowledge.');
    const audits = await listAudit(db, { targetType: 'memory', limit: 1000 });
    expect(JSON.stringify(audits.filter((a) => a.targetId === written.entry.id))).not.toContain('dummy-review-secret-value');
  });

  it('keeps connector duplicates untrusted even when an owner verified the same text', async () => {
    const input = { category: 'shared' as const, title: 'Untrusted duplicate regression', body: 'External claim.' };
    await writeMemory(db, embedder, { kind: 'owner' }, { ...input, verificationStatus: 'verified' });
    const external = await writeMemory(db, embedder, { kind: 'connector', id: 'review-connector' }, input);
    expect(external.ok).toBe(true);
    if (external.ok) expect(external.entry.verificationStatus).toBe('untrusted');
  });

  it('isolates deduplication between scopes and projects', async () => {
    const input = { category: 'shared' as const, title: 'Scoped duplicate regression', body: 'Same claim.' };
    const shared = await writeMemory(db, embedder, eleven, input);
    const privateEntry = await writeMemory(db, embedder, eleven, { ...input, scope: 'private' });
    const projectA = await writeMemory(db, embedder, eleven, { ...input, scope: 'project', projectId: 'review-a' });
    const projectB = await writeMemory(db, embedder, eleven, { ...input, scope: 'project', projectId: 'review-b' });
    const results = [shared, privateEntry, projectA, projectB];
    expect(results.every((r) => r.ok)).toBe(true);
    expect(new Set(results.flatMap((r) => r.ok ? [r.entry.id] : [])).size).toBe(4);
  });

  it('collapses concurrent duplicates to one entry', async () => {
    const input = { category: 'shared' as const, title: 'Concurrent duplicate regression', body: 'Same concurrent claim.' };
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const concurrentEmbedder = {
      name: 'mock' as const,
      async embed(text: string) {
        if (++arrivals === 3) release();
        await barrier;
        return embedder.embed(text);
      },
    };
    const results = await Promise.all(Array.from({ length: 3 }, () => writeMemory(db, concurrentEmbedder, eleven, input)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(new Set(results.flatMap((r) => r.ok ? [r.entry.id] : [])).size).toBe(1);
  });

  it('assigns distinct sequential versions to concurrent corrections', async () => {
    const written = await writeMemory(db, embedder, eleven, {
      category: 'shared', title: 'Concurrent corrections regression', body: 'Initial version.',
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const results = await Promise.all(['Second version.', 'Third version.'].map((body) =>
      correctMemory(db, embedder, eleven, written.entry.id, { body })));
    expect(results.every((r) => r.ok)).toBe(true);
    const detail = await getMemory(db, written.entry.id);
    expect(detail?.versions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(detail?.versions.at(-1)?.body).toBe(detail?.entry.body);
  });


  it('filters private and project entries in both search modes', async () => {
    const title = 'Visibilityscope regression';
    const shared = await writeMemory(db, embedder, eleven, { category: 'shared', title, body: 'Shared knowledge.' });
    const privateA = await writeMemory(db, embedder, eleven, { category: 'shared', title, body: 'Private A.', scope: 'private' });
    const privateB = await writeMemory(db, embedder, { kind: 'owner' }, { category: 'shared', title, body: 'Private B.', scope: 'private' });
    const projectA = await writeMemory(db, embedder, eleven, { category: 'shared', title, body: 'Project A.', scope: 'project', projectId: 'review-a' });
    const projectB = await writeMemory(db, embedder, eleven, { category: 'shared', title, body: 'Project B.', scope: 'project', projectId: 'review-b' });
    const results = [shared, privateA, privateB, projectA, projectB];
    expect(results.every((r) => r.ok)).toBe(true);
    if (results.some((r) => !r.ok)) return;
    const ids = results.flatMap((r) => r.ok ? [r.entry.id] : []);
    for (const mode of ['keyword', 'semantic']) {
      const opts = { categories: readableCategories(eleven), actor: eleven, projectId: 'review-a', limit: 100 };
      const hits = mode === 'keyword'
        ? await searchKeyword(db, 'Visibilityscope', opts)
        : await searchSemantic(db, embedder, 'Visibilityscope', opts);
      const visible = hits.map((h) => h.id);
      expect(visible).toContain(ids[0]);
      expect(visible).toContain(ids[1]);
      expect(visible).toContain(ids[3]);
      expect(visible).not.toContain(ids[2]);
      expect(visible).not.toContain(ids[4]);
      const ownerOpts = { categories: readableCategories({ kind: 'owner' }), actor: { kind: 'owner' as const }, limit: 100 };
      const ownerHits = mode === 'keyword'
        ? await searchKeyword(db, 'Visibilityscope', ownerOpts)
        : await searchSemantic(db, embedder, 'Visibilityscope', ownerOpts);
      for (const id of ids) expect(ownerHits.map((h) => h.id)).toContain(id);
    }
    const anonymous = await searchKeyword(db, 'Visibilityscope', { categories: readableCategories(eleven) });
    expect(anonymous.map((h) => h.id)).toEqual([ids[0]]);
  });

  it('rechecks category write permission on correction', async () => {
    const written = await writeMemory(db, embedder, eleven, { category: 'shared', title: 'Revoked grant regression', body: 'Original.' });
    if (!written.ok) throw new Error('write failed');
    const restricted = { ...eleven, policy: { ...eleven.policy, memory: { ...eleven.policy.memory, write: [] } } };
    const result = await correctMemory(db, embedder, restricted, written.entry.id, { body: 'Not allowed.' });
    expect(result).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await getMemory(db, written.entry.id))?.versions).toHaveLength(1);
  });

  it('updates conflict links when a correction resolves the disagreement', async () => {
    const a = await writeMemory(db, embedder, eleven, { category: 'shared', title: 'Conflict correction regression', body: 'Claim A.' });
    const b = await writeMemory(db, embedder, { kind: 'owner' }, { category: 'shared', title: 'Conflict correction regression', body: 'Claim B.' });
    if (!a.ok || !b.ok) throw new Error('write failed');
    expect((await getMemory(db, a.entry.id))?.entry.conflictsWith).toContain(b.entry.id);
    await correctMemory(db, embedder, eleven, a.entry.id, { body: 'Claim B.' });
    expect((await getMemory(db, a.entry.id))?.entry.conflictsWith).toEqual([]);
    expect((await getMemory(db, b.entry.id))?.entry.conflictsWith).toEqual([]);
  });

  it('rolls back a memory write and its version if the audit insert fails', async () => {
    await db.execute(sql`
      CREATE FUNCTION reject_review_memory_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'memory.write' AND EXISTS (
          SELECT 1 FROM memory_entries WHERE id::text = NEW.target_id AND title = 'Audit rollback regression'
        ) THEN
          RAISE EXCEPTION 'simulated audit failure';
        END IF;
        RETURN NEW;
      END;
      $$;
    `);
    try {
      await db.execute(sql`CREATE TRIGGER reject_review_memory_audit BEFORE INSERT ON audit_events
        FOR EACH ROW EXECUTE FUNCTION reject_review_memory_audit()`);
      await expect(writeMemory(db, embedder, eleven, {
        category: 'shared', title: 'Audit rollback regression', body: 'Must not persist without audit.',
      })).rejects.toThrow();
      const entries = await db.select().from(schema.memoryEntries).where(eq(schema.memoryEntries.title, 'Audit rollback regression'));
      expect(entries).toHaveLength(0);
    } finally {
      await db.execute(sql`DROP TRIGGER IF EXISTS reject_review_memory_audit ON audit_events`);
      await db.execute(sql`DROP FUNCTION reject_review_memory_audit()`);
    }
  });
});

import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';

import { loadConfig } from '@flux88/config';
import { schema } from '@flux88/db';
import { connectTestDb, TEST_DATABASE_URL, truncateMutableTables } from '@flux88/db/testing';

import { createApp } from '../app.js';
import { eventBus } from '../events.js';

const config = loadConfig({ ...process.env, DATABASE_URL: TEST_DATABASE_URL });
const connection = connectTestDb();
const app = createApp({ config, db: connection.db }).app;
const origin = new URL(config.WEB_URL).origin;
let cookie = '';

beforeEach(async () => {
  await truncateMutableTables(connection.db);
  const setup = await app.request('/api/v1/auth/setup', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.test', password: 't007-owner-test-password' }),
  });
  expect(setup.status).toBe(201);
  cookie = setup.headers.get('set-cookie')!.split(';')[0]!;
});
afterAll(async () => { await connection.client.end(); });

async function fixtures() {
  const [task] = await connection.db.insert(schema.tasks).values({ title: 'Implement feedback view', creator: 'owner' }).returning();
  const [feedback] = await connection.db.insert(schema.externalFeedback).values({
    externalId: `review-${randomUUID()}`,
    externalType: 'review_comment',
    authorLogin: 'external-reviewer',
    bodyExcerpt: '<script>untrusted note</script>',
    sourceUrl: 'https://github.com/acme/office/pull/42#discussion_r12',
  }).returning();
  return { task: task!, feedback: feedback! };
}

describe('T007 GitHub feedback triage API', () => {
  it('requires the owner session and lists bounded unmatched and linked feedback', async () => {
    expect((await app.request('/api/v1/feedback')).status).toBe(401);
    const { feedback } = await fixtures();
    const response = await app.request('/api/v1/feedback?state=unmatched', { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ items: [{ id: feedback.id, state: 'pending', provenance: 'untrusted' }] });
    expect((await app.request('/api/v1/feedback?limit=101', { headers: { Cookie: cookie } })).status).toBe(400);
  });

  it('links only an unmatched PR to an existing task and emits audit plus activity', async () => {
    const { task, feedback } = await fixtures();
    let emitted: unknown;
    const listener = (event: unknown) => { emitted = event; };
    eventBus.once('sse', listener);
    const response = await app.request(`/api/v1/feedback/${feedback.id}/link`, {
      method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: task.id }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: feedback.id, taskId: task.id, state: 'linked' });
    const [saved] = await connection.db.select().from(schema.externalFeedback);
    expect(saved?.externalLinkId).toBeTruthy();
    const [mapping] = await connection.db.select().from(schema.externalLinks);
    expect(mapping).toMatchObject({ provider: 'github', externalType: 'pull_request', externalId: 'acme/office#42', taskId: task.id });
    const [audit] = await connection.db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.action, 'github.feedback_linked'), eq(schema.auditEvents.targetId, task.id),
    ));
    expect(audit).toMatchObject({ action: 'github.feedback_linked', targetType: 'task', targetId: task.id });
    expect(emitted).toMatchObject({ channel: 'task', data: { taskId: task.id, kind: 'github.feedback_linked', feedbackId: feedback.id } });
    const linked = await app.request('/api/v1/feedback?state=linked', { headers: { Cookie: cookie } });
    expect(await linked.json()).toMatchObject({ items: [{ id: feedback.id, taskId: task.id, taskTitle: task.title }] });
  });

  it('rejects a missing task, repeated feedback link, and conflicting PR mapping', async () => {
    const { task, feedback } = await fixtures();
    const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' };
    const missing = await app.request(`/api/v1/feedback/${feedback.id}/link`, { method: 'POST', headers, body: JSON.stringify({ taskId: randomUUID() }) });
    expect(missing.status).toBe(404);
    const link = () => app.request(`/api/v1/feedback/${feedback.id}/link`, { method: 'POST', headers, body: JSON.stringify({ taskId: task.id }) });
    expect((await link()).status).toBe(200);
    expect((await link()).status).toBe(409);
    const otherTask = await connection.db.insert(schema.tasks).values({ title: 'Other task', creator: 'owner' }).returning();
    const secondFeedback = await connection.db.insert(schema.externalFeedback).values({
      externalId: `review-${randomUUID()}`, externalType: 'review_comment', authorLogin: 'reviewer', bodyExcerpt: 'feedback',
      sourceUrl: 'https://github.com/acme/office/pull/42#discussion_r13',
    }).returning();
    const conflict = await app.request(`/api/v1/feedback/${secondFeedback[0]!.id}/link`, {
      method: 'POST', headers, body: JSON.stringify({ taskId: otherTask[0]!.id }),
    });
    expect(conflict.status).toBe(409);
  });

  it('rejects a non-PR GitHub URL without changing the unmatched record', async () => {
    const { task } = await fixtures();
    const [issueFeedback] = await connection.db.insert(schema.externalFeedback).values({
      externalId: `issue-${randomUUID()}`, externalType: 'issue_comment', authorLogin: 'reviewer', bodyExcerpt: 'feedback',
      sourceUrl: 'https://github.com/acme/office/issues/42#issuecomment-12',
    }).returning();
    const response = await app.request(`/api/v1/feedback/${issueFeedback!.id}/link`, {
      method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: task.id }),
    });
    expect(response.status).toBe(400);
    const [saved] = await connection.db.select().from(schema.externalFeedback).where(eq(schema.externalFeedback.id, issueFeedback!.id));
    expect(saved).toMatchObject({ state: 'pending', taskId: null, externalLinkId: null });
  });
});

import { and, desc, eq, isNotNull, isNull, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { Db } from '@flux88/db';
import { auditEvents, externalFeedback, externalLinks, tasks } from '@flux88/db/schema';

import { emitEvent } from '../events.js';

const OWNER_CTX = { actorType: 'owner' as const, actorId: 'session' };
const linkSchema = z.object({ taskId: z.string().uuid() }).strict();
const idSchema = z.string().uuid();

function pullRequestIdentity(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl);
    const path = url.pathname.toLowerCase();
    const match = sourceUrl.length <= 2_048 && url.origin === 'https://github.com' && !url.search && !url.username && !url.password
      ? /^\/([a-z0-9_.-]+)\/([a-z0-9_.-]+)\/pull\/([1-9]\d*)\/?$/.exec(path)
      : null;
    return match && match[1] !== '.' && match[1] !== '..' && match[2] !== '.' && match[2] !== '..'
      ? `${match[1]}/${match[2]}#${match[3]}`
      : null;
  } catch {
    return null;
  }
}

export function feedbackRoutes(db: Db) {
  const app = new Hono();

  app.get('/', async (c) => {
    const rawLimit = c.req.query('limit');
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    const state = c.req.query('state') ?? 'all';
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !['all', 'unmatched', 'linked'].includes(state)) {
      return c.json({ error: { code: 'invalid_input', message: 'Invalid feedback query' } }, 400);
    }
    const conditions = state === 'unmatched'
      ? and(eq(externalFeedback.state, 'pending'), isNull(externalFeedback.taskId), isNull(externalFeedback.externalLinkId))
      : state === 'linked' ? and(eq(externalFeedback.state, 'linked'), isNotNull(externalFeedback.taskId)) :
        or(
          and(eq(externalFeedback.state, 'pending'), isNull(externalFeedback.taskId), isNull(externalFeedback.externalLinkId)),
          and(eq(externalFeedback.state, 'linked'), isNotNull(externalFeedback.taskId)),
        );
    const rows = await db.select({
      id: externalFeedback.id,
      externalId: externalFeedback.externalId,
      externalType: externalFeedback.externalType,
      taskId: externalFeedback.taskId,
      assigneeAgentId: externalFeedback.assigneeAgentId,
      authorLogin: externalFeedback.authorLogin,
      bodyExcerpt: externalFeedback.bodyExcerpt,
      sourceUrl: externalFeedback.sourceUrl,
      state: externalFeedback.state,
      provenance: externalFeedback.provenance,
      receivedAt: externalFeedback.receivedAt,
      taskTitle: tasks.title,
    }).from(externalFeedback).leftJoin(tasks, eq(externalFeedback.taskId, tasks.id))
      .where(conditions).orderBy(desc(externalFeedback.receivedAt)).limit(limit);
    return c.json({ items: rows });
  });

  app.post('/:id/link', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    const body = linkSchema.safeParse(await c.req.json().catch(() => null));
    if (!id.success || !body.success) return c.json({ error: { code: 'invalid_input', message: 'Invalid feedback link' } }, 400);

    const result = await db.transaction(async (tx) => {
      const [feedback] = await tx.select().from(externalFeedback).where(eq(externalFeedback.id, id.data)).for('update');
      if (!feedback) return { kind: 'not_found' as const };
      if (feedback.state !== 'pending' || feedback.taskId || feedback.externalLinkId) return { kind: 'conflict' as const };
      const [task] = await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, body.data.taskId));
      if (!task) return { kind: 'task_not_found' as const };
      const externalId = pullRequestIdentity(feedback.sourceUrl);
      if (!externalId) return { kind: 'invalid_source' as const };

      await tx.insert(externalLinks).values({
        provider: 'github', externalType: 'pull_request', externalId, taskId: task.id, originMarker: 'owner-created-link',
      }).onConflictDoNothing();
      const [mapping] = await tx.select().from(externalLinks).where(and(
        eq(externalLinks.provider, 'github'), eq(externalLinks.externalType, 'pull_request'), eq(externalLinks.externalId, externalId),
      ));
      if (!mapping || mapping.taskId !== task.id) return { kind: 'mapping_conflict' as const };
      const [updated] = await tx.update(externalFeedback).set({
        state: 'linked', taskId: task.id, externalLinkId: mapping.id, updatedAt: new Date(),
      }).where(and(eq(externalFeedback.id, feedback.id), eq(externalFeedback.state, 'pending'), isNull(externalFeedback.taskId), isNull(externalFeedback.externalLinkId))).returning();
      if (!updated) return { kind: 'conflict' as const };
      await tx.insert(auditEvents).values({
        ...OWNER_CTX, action: 'github.feedback_linked', targetType: 'task', targetId: task.id,
        payload: { feedbackId: feedback.id, externalLinkId: mapping.id, externalId },
      });
      return { kind: 'ok' as const, feedback: updated, taskId: task.id };
    });

    if (result.kind === 'not_found' || result.kind === 'task_not_found') {
      return c.json({ error: { code: 'not_found', message: result.kind === 'not_found' ? 'Unknown feedback' : 'Unknown task' } }, 404);
    }
    if (result.kind === 'invalid_source') return c.json({ error: { code: 'invalid_source', message: 'Feedback is not from a valid GitHub pull request' } }, 400);
    if (result.kind !== 'ok') return c.json({ error: { code: 'conflict', message: 'Feedback or pull request is already linked' } }, 409);
    emitEvent({ channel: 'task', data: { taskId: result.taskId, kind: 'github.feedback_linked', feedbackId: result.feedback.id } });
    return c.json(result.feedback);
  });

  return app;
}

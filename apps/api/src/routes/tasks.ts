/**
 * Tasks API (T024, T030) — contracts/api.md "Tasks & orchestration".
 * Every status change goes through the guarded, audited state machine; pause,
 * resume, cancel and owner input give the owner workflow control (FR-014,
 * FR-018).
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { AGENT_IDS, TASK_STATUSES, type TaskStatus } from '@flux88/core';
import type { Db } from '@flux88/db';
import {
  createArtifact,
  createHandoff,
  createTask,
  getTask,
  getTaskDeep,
  listTasks,
  taskTimeline,
  transitionTask,
  updateTaskFields,
  writeAudit,
} from '@flux88/db';

import type { TaskEnqueuer } from '../enqueue.js';
import { emitEvent } from '../events.js';

const OWNER_CTX = { actorType: 'owner' as const, actorId: 'session' };

const createSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(4000).optional(),
    priority: z.number().int().min(1).max(5).optional(),
  })
  .strict();

const patchSchema = z
  .object({
    priority: z.number().int().min(1).max(5).optional(),
    deadline: z.string().datetime().nullable().optional(),
    assigneeAgentId: z.enum(AGENT_IDS).optional(),
  })
  .strict();

const transitionSchema = z
  .object({ to: z.enum(TASK_STATUSES), reason: z.string().max(500).optional() })
  .strict();

const inputSchema = z.object({ message: z.string().min(1).max(4000) }).strict();

const idSchema = z.string().uuid();

function notFound(c: Context) {
  return c.json({ error: { code: 'not_found', message: 'Unknown task' } }, 404);
}

function transitionError(c: Context, result: { code: string; message: string }) {
  if (result.code === 'not_found') return notFound(c);
  return c.json({ error: { code: result.code, message: result.message } }, 409);
}

export function tasksRoutes(db: Db, enqueue: TaskEnqueuer) {
  const app = new Hono();

  app.get('/', async (c) => {
    const statusParam = c.req.query('status');
    const status =
      statusParam && (TASK_STATUSES as readonly string[]).includes(statusParam)
        ? (statusParam as TaskStatus)
        : undefined;
    return c.json({ items: await listTasks(db, status ? { status } : {}) });
  });

  app.post('/', async (c) => {
    const body = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: { code: 'invalid_input', message: 'Invalid task' } }, 400);

    const task = await createTask(db, { ...body.data, creator: 'owner' });
    await writeAudit(db, {
      ...OWNER_CTX,
      action: 'task.created',
      targetType: 'task',
      targetId: task.id,
      payload: { title: task.title },
    });
    const ready = await transitionTask(db, task.id, 'ready', OWNER_CTX);
    if (ready.ok) await enqueue.orchestrate(task.id);
    emitEvent({ channel: 'task', data: { taskId: task.id, status: 'ready', kind: 'created' } });
    return c.json(ready.ok ? ready.task : task, 201);
  });

  app.get('/:id', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return notFound(c);
    const deep = await getTaskDeep(db, id.data);
    return deep ? c.json(deep) : notFound(c);
  });

  app.get('/:id/timeline', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return notFound(c);
    if (!(await getTask(db, id.data))) return notFound(c);
    return c.json({ items: await taskTimeline(db, id.data) });
  });

  app.patch('/:id', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return notFound(c);
    const body = patchSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: { code: 'invalid_input', message: 'Invalid patch' } }, 400);

    const current = await getTask(db, id.data);
    if (!current) return notFound(c);

    const { assigneeAgentId, deadline, priority } = body.data;
    const updated = await updateTaskFields(db, id.data, {
      priority,
      deadline: deadline === undefined ? undefined : deadline === null ? null : new Date(deadline),
      assigneeAgentId,
    });
    if (!updated) return notFound(c);

    if (assigneeAgentId && assigneeAgentId !== current.assigneeAgentId) {
      // Owner reassignment is a recorded handoff (FR-004) and unblocks the task.
      await createHandoff(db, {
        taskId: id.data,
        ...(current.assigneeAgentId ? { fromAgentId: current.assigneeAgentId } : {}),
        toAgentId: assigneeAgentId,
        reason: 'owner reassignment',
      });
      await writeAudit(db, {
        ...OWNER_CTX,
        action: 'task.reassigned',
        targetType: 'task',
        targetId: id.data,
        payload: { from: current.assigneeAgentId, to: assigneeAgentId },
      });
      if (current.status === 'blocked') {
        const ready = await transitionTask(db, id.data, 'ready', { ...OWNER_CTX, reason: 'reassigned' });
        if (ready.ok) await enqueue.run(id.data, ready.task.retryCount);
      }
    } else {
      await writeAudit(db, {
        ...OWNER_CTX,
        action: 'task.updated',
        targetType: 'task',
        targetId: id.data,
        payload: { fields: Object.keys(body.data) },
      });
    }
    emitEvent({ channel: 'task', data: { taskId: id.data, kind: 'updated' } });
    return c.json(await getTask(db, id.data));
  });

  app.post('/:id/transition', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return notFound(c);
    const body = transitionSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: { code: 'invalid_input', message: 'Invalid transition' } }, 400);

    const result = await transitionTask(db, id.data, body.data.to, {
      ...OWNER_CTX,
      ...(body.data.reason ? { reason: body.data.reason } : {}),
    });
    if (!result.ok) return transitionError(c, result);
    emitEvent({ channel: 'task', data: { taskId: id.data, status: result.task.status } });
    return c.json(result.task);
  });

  app.post('/:id/pause', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return notFound(c);
    const result = await transitionTask(db, id.data, 'blocked', { ...OWNER_CTX, reason: 'paused_by_owner' });
    if (!result.ok) return transitionError(c, result);
    emitEvent({ channel: 'task', data: { taskId: id.data, status: 'blocked', reason: 'paused_by_owner' } });
    return c.json(result.task);
  });

  app.post('/:id/resume', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return notFound(c);
    const result = await transitionTask(db, id.data, 'ready', OWNER_CTX);
    if (!result.ok) return transitionError(c, result);
    if (result.task.assigneeAgentId) await enqueue.run(id.data, result.task.retryCount);
    else await enqueue.orchestrate(id.data);
    emitEvent({ channel: 'task', data: { taskId: id.data, status: 'ready' } });
    return c.json(result.task);
  });

  app.post('/:id/cancel', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return notFound(c);
    const result = await transitionTask(db, id.data, 'canceled', { ...OWNER_CTX, reason: 'canceled_by_owner' });
    if (!result.ok) return transitionError(c, result);
    emitEvent({ channel: 'task', data: { taskId: id.data, status: 'canceled' } });
    return c.json(result.task);
  });

  /** Owner provides input to a blocked task (FR-018, T030). */
  app.post('/:id/input', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return notFound(c);
    const body = inputSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: { code: 'invalid_input', message: 'Invalid input' } }, 400);

    const task = await getTask(db, id.data);
    if (!task) return notFound(c);

    await createArtifact(db, {
      taskId: id.data,
      kind: 'owner_input',
      title: 'Owner input',
      content: body.data.message,
      simulated: task.simulated,
    });
    await writeAudit(db, {
      ...OWNER_CTX,
      action: 'task.owner_input',
      targetType: 'task',
      targetId: id.data,
      payload: { length: body.data.message.length },
    });
    if (task.status === 'blocked') {
      const ready = await transitionTask(db, id.data, 'ready', { ...OWNER_CTX, reason: 'owner input provided' });
      if (ready.ok) {
        if (ready.task.assigneeAgentId) await enqueue.run(id.data, ready.task.retryCount);
        else await enqueue.orchestrate(id.data);
      }
    }
    emitEvent({ channel: 'task', data: { taskId: id.data, kind: 'owner_input' } });
    return c.json(await getTask(db, id.data));
  });

  return app;
}

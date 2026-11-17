import { Hono } from 'hono';
import { z } from 'zod';

import { agentConfigSchema, type AgentId } from '@flux88/agents';
import type { Db } from '@flux88/db';
import { getAgent, getTask, transitionTask } from '@flux88/db';

import { requireAgent, type AgentAuthEnv } from '../middleware/agent-auth.js';
import { emitEvent } from '../events.js';

const idSchema = z.string().uuid();
const transitionSchema = z.object({
  to: z.enum(['running', 'blocked', 'review', 'failed']),
}).strict();

async function ownTaskPolicy(db: Db, agentId: AgentId) {
  const agent = await getAgent(db, agentId);
  if (!agent?.enabled) return null;
  const config = agentConfigSchema.parse(agent.config);
  return {
    canRead: config.dataScopes.includes('tasks:own') || config.dataScopes.includes('tasks:all'),
    canUpdate: config.allowedTools.includes('tasks.update_own'),
  };
}

export function agentApiRoutes(db: Db) {
  const app = new Hono<AgentAuthEnv>();
  app.use('*', requireAgent(db));

  app.get('/me', async (c) => {
    const agent = await getAgent(db, c.get('agentId'));
    if (!agent?.enabled) return c.json({ error: { code: 'unauthenticated', message: 'Invalid agent credential' } }, 401);
    return c.json({ id: agent.id, displayName: agent.displayName, roleSummary: agent.roleSummary });
  });

  app.get('/tasks/:id', async (c) => {
    const taskId = idSchema.safeParse(c.req.param('id'));
    if (!taskId.success) return c.json({ error: { code: 'not_found', message: 'Unknown task' } }, 404);
    const agentId = c.get('agentId');
    const policy = await ownTaskPolicy(db, agentId);
    const task = await getTask(db, taskId.data);
    if (!task || !policy?.canRead || task.assigneeAgentId !== agentId) {
      return c.json({ error: { code: 'not_found', message: 'Unknown task' } }, 404);
    }
    return c.json({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      deadline: task.deadline,
    });
  });

  app.post('/tasks/:id/transition', async (c) => {
    const taskId = idSchema.safeParse(c.req.param('id'));
    if (!taskId.success) return c.json({ error: { code: 'not_found', message: 'Unknown task' } }, 404);
    const body = transitionSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: { code: 'invalid_input', message: 'Invalid agent transition' } }, 400);
    const agentId = c.get('agentId');
    const policy = await ownTaskPolicy(db, agentId);
    const task = await getTask(db, taskId.data);
    if (!policy?.canRead || !policy.canUpdate) {
      return c.json({ error: { code: 'forbidden', message: 'Agent task updates are not permitted' } }, 403);
    }
    if (!task || task.assigneeAgentId !== agentId) {
      return c.json({ error: { code: 'not_found', message: 'Unknown task' } }, 404);
    }
    const result = await transitionTask(db, task.id, body.data.to, {
      actorType: 'agent', actorId: agentId, reason: 'agent_api',
    }, agentId);
    if (!result.ok) return c.json({ error: { code: result.code, message: result.message } }, result.code === 'not_found' ? 404 : 409);
    emitEvent({ channel: 'task', data: { taskId: task.id, status: result.task.status } });
    return c.json(result.task);
  });

  return app;
}

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

import { AGENT_IDS } from '@flux88/core';
import type { Db } from '@flux88/db';
import {
  createApprovalRequest, decideApproval, getApproval, listApprovals, proposalSchema, reauthenticateOwner,
} from '../policy/approvals.js';
import { emitEvent } from '../events.js';

const createSchema = proposalSchema.extend({ requestingAgentId: z.enum(AGENT_IDS).optional() }).strict();
const decisionSchema = z.object({ password: z.string().min(1).max(256), reason: z.string().max(1000).optional() }).strict();
const statusSchema = z.enum(['pending', 'approved', 'rejected', 'expired']);

/** Mounted only under the authenticated-owner API; consumption is never an HTTP endpoint. */
export function approvalRoutes(db: Db) {
  const app = new Hono<{ Variables: { sessionId: string } }>();
  app.use(bodyLimit({ maxSize: 131_072 }));
  app.get('/', async (c) => {
    const raw = c.req.query('status');
    const status = statusSchema.safeParse(raw);
    if (raw !== undefined && !status.success) return c.json({ error: { code: 'invalid_input', message: 'Invalid approval status' } }, 400);
    return c.json({ items: await listApprovals(db, status.success ? status.data : undefined) });
  });
  app.post('/', async (c) => {
    const input = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: { code: 'invalid_input', message: 'Invalid approval proposal' } }, 400);
    const { requestingAgentId, ...proposal } = input.data;
    const result = await createApprovalRequest(db, requestingAgentId ? { kind: 'agent', agentId: requestingAgentId } : { kind: 'owner' }, proposal);
    if (!result.ok) return c.json({ error: { code: result.code, message: 'Approval proposal refused' } }, result.code === 'permission_denied' ? 403 : result.code === 'secret_rejected' ? 422 : 400);
    emitEvent({ channel: 'approval', data: { id: result.value.id, status: result.value.status } });
    return c.json(result.value, 201);
  });
  app.get('/:id', async (c) => {
    const request = await getApproval(db, c.req.param('id'));
    return request ? c.json(request) : c.json({ error: { code: 'not_found', message: 'Unknown approval' } }, 404);
  });
  for (const decision of ['approve', 'reject'] as const) {
    app.post(`/:id/${decision}`, async (c) => {
      const body = decisionSchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success || (decision === 'reject' && !body.data.reason?.trim()) || !z.string().uuid().safeParse(c.req.param('id')).success) {
        return c.json({ error: { code: 'invalid_input', message: 'Invalid approval decision' } }, 400);
      }
      const proof = await reauthenticateOwner(db, c.get('sessionId') as string, body.data.password);
      if (!proof.ok) return c.json({ error: { code: 'auth_failed', message: 'Authentication failed' } }, 401);
      const result = await decideApproval(db, proof.value, c.req.param('id'), decision, body.data.reason ?? '');
      if (!result.ok) return c.json({ error: { code: result.code, message: 'Approval decision refused' } }, result.code === 'auth_failed' ? 401 : result.code === 'not_found' ? 404 : 409);
      emitEvent({ channel: 'approval', data: { id: result.value.request.id, status: result.value.request.status } });
      return c.json({ request: result.value.request, grantId: result.value.grant?.id ?? null });
    });
  }
  return app;
}

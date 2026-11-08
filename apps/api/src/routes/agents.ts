import { Hono } from 'hono';
import { z } from 'zod';

import type { AgentId } from '@flux88/core';
import { AGENT_IDS } from '@flux88/core';
import type { Db } from '@flux88/db';
import { getAgent, listAgents, updateAgentPresentation, writeAudit } from '@flux88/db';

import { agentConfigPatchSchema, consumeApprovalGrant, getApproval, loadApprovalGrant, prepareAgentConfigChange } from '../policy/approvals.js';
import { emitEvent } from '../events.js';

/** Fields editable without approval. Policy fields go through the approval flow (T040, US2). */
const presentationPatchSchema = z
  .object({
    displayName: z.string().min(1).max(60).optional(),
    personality: z.string().min(1).max(500).optional(),
    roleSummary: z.string().min(1).max(500).optional(),
  })
  .strict();

const POLICY_FIELDS = ['allowedTools', 'dataScopes', 'prohibitedOps', 'handoffTargets', 'escalation', 'memory', 'budgets', 'enabled'];

function parseAgentId(value: string): AgentId | null {
  return (AGENT_IDS as readonly string[]).includes(value) ? (value as AgentId) : null;
}

export function agentsRoutes(db: Db) {
  const app = new Hono();

  app.get('/', async (c) => c.json({ items: await listAgents(db) }));

  app.get('/:id', async (c) => {
    const id = parseAgentId(c.req.param('id'));
    if (!id) return c.json({ error: { code: 'not_found', message: 'Unknown agent' } }, 404);
    const agent = await getAgent(db, id);
    return agent ? c.json(agent) : c.json({ error: { code: 'not_found', message: 'Unknown agent' } }, 404);
  });

  app.patch('/:id/config', async (c) => {
    const id = parseAgentId(c.req.param('id'));
    if (!id) return c.json({ error: { code: 'not_found', message: 'Unknown agent' } }, 404);

    const raw = await c.req.json().catch(() => null);
    if (raw && typeof raw === 'object' && (POLICY_FIELDS.some((f) => f in raw) || 'approvalGrantId' in raw)) {
      const envelope = z.object({ approvalGrantId: z.string().uuid().optional() }).passthrough().safeParse(raw);
      if (!envelope.success) return c.json({ error: { code: 'invalid_input', message: 'Invalid config patch' } }, 400);
      const { approvalGrantId, ...patch } = envelope.data;
      const valid = agentConfigPatchSchema.safeParse(patch);
      if (!valid.success) return c.json({ error: { code: 'invalid_input', message: 'Invalid config patch' } }, 400);
      if (!approvalGrantId) {
        const proposal = await prepareAgentConfigChange(db, id, valid.data);
        if (!proposal.ok) return c.json({ error: { code: proposal.code, message: 'Config proposal refused' } }, proposal.code === 'not_found' ? 404 : 400);
        emitEvent({ channel: 'approval', data: { id: proposal.value.id, status: 'pending' } });
        return c.json({ error: { code: 'approval_required', message: 'Approve this exact configuration change before applying it' }, approvalRequestId: proposal.value.id }, 403);
      }
      const loaded = await loadApprovalGrant(db, approvalGrantId);
      if (!loaded.ok) return c.json({ error: { code: loaded.code, message: 'Invalid approval grant' } }, 403);
      const request = await getApproval(db, loaded.value.approvalRequestId);
      if (!request) return c.json({ error: { code: 'not_found', message: 'Unknown approval' } }, 404);
      const stored = request.actionPayload as { baseStateHash?: unknown };
      const result = await consumeApprovalGrant(db, loaded.value, {
        requester: { kind: 'owner' }, actionType: 'agent_config_change', targetResource: `agent:${id}`,
        actionPayload: JSON.parse(JSON.stringify({ patch: valid.data, baseStateHash: stored.baseStateHash })),
      });
      if (!result.ok) return c.json({ error: { code: result.code, message: 'Approved config change refused' } }, 409);
      emitEvent({ channel: 'agent_status', data: { agentId: id, kind: 'config_updated' } });
      return c.json(result.value.agent);
    }

    const body = presentationPatchSchema.safeParse(raw);
    if (!body.success) return c.json({ error: { code: 'invalid_input', message: 'Invalid agent patch' } }, 400);

    const updated = await updateAgentPresentation(db, id, body.data);
    if (!updated) return c.json({ error: { code: 'not_found', message: 'Unknown agent' } }, 404);

    await writeAudit(db, { actorType: 'owner', actorId: 'session', action: 'agent.presentation_update', targetType: 'agent', targetId: id, payload: { fields: Object.keys(body.data) } });
    emitEvent({ channel: 'agent_status', data: { agentId: id, kind: 'config_updated' } });
    return c.json(updated);
  });

  return app;
}

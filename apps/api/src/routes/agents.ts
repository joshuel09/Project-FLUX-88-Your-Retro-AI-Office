import { Hono } from 'hono';
import { z } from 'zod';

import type { AgentId } from '@flux88/core';
import { AGENT_IDS } from '@flux88/core';
import type { Db } from '@flux88/db';
import { getAgent, listAgents, updateAgentPresentation, writeAudit } from '@flux88/db';

import { emitEvent } from '../events.js';

/** Fields editable without approval. Policy fields go through the approval flow (T040, US2). */
const presentationPatchSchema = z
  .object({
    displayName: z.string().min(1).max(60).optional(),
    personality: z.string().min(1).max(500).optional(),
    roleSummary: z.string().min(1).max(500).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const POLICY_FIELDS = ['allowedTools', 'dataScopes', 'prohibitedOps', 'handoffTargets', 'escalation', 'memory', 'budgets'];

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
    if (raw && typeof raw === 'object' && POLICY_FIELDS.some((f) => f in (raw as object))) {
      // Deferred to the agent_config_change approval path (T018 -> T040, constitution I).
      return c.json(
        {
          error: {
            code: 'approval_required',
            message:
              'Policy-affecting fields (scopes, prohibited ops, handoffs, memory, budgets) require an approval request. This path ships with the approvals slice (US2).',
          },
        },
        403,
      );
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

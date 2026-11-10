/** T040: immutable requests, owner decisions, and transactional single-use capabilities. */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

import { agentConfigSchema, policyConfigSchema } from '@flux88/agents';
import { AGENT_IDS, type AgentId } from '@flux88/core';
import { mockTargetStateHash, schema, type Db } from '@flux88/db';
import { detectSecretShaped } from '@flux88/memory';

import { DUMMY_HASH_PROMISE, verifyPassword } from '../auth/passwords.js';
import { evaluatePolicy } from './engine.js';

const { approvalRequests: requests, approvalGrants: grants, agents, outbox, auditEvents, owner, sessions } = schema;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type ApprovalRequest = typeof requests.$inferSelect;
export type ApprovalActor = { kind: 'owner' } | { kind: 'agent'; agentId: AgentId };
export type ApprovalCode = 'invalid_input' | 'not_found' | 'auth_failed' | 'conflict' | 'expired' |
  'already_consumed' | 'invalid_grant' | 'binding_mismatch' | 'permission_denied' | 'target_changed' | 'secret_rejected';
export type ApprovalResult<T> = { ok: true; value: T } | { ok: false; code: ApprovalCode };

export const DEFAULT_APPROVAL_TTL_MS = 15 * 60_000;
export const MAX_APPROVAL_TTL_MS = 24 * 60 * 60_000;
const MIN_TTL_MS = 60_000;
const PROOF_TTL_MS = 60_000;
const uuid = z.string().uuid();
const actorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('owner') }).strict(),
  z.object({ kind: z.literal('agent'), agentId: z.enum(AGENT_IDS) }).strict(),
]);
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const scalar = z.union([z.null(), z.boolean(), z.number().finite(), z.string()]);
function jsonAtDepth(depth: number): z.ZodType<Json> {
  if (depth === 0) return scalar;
  const child = jsonAtDepth(depth - 1);
  return z.union([scalar, z.array(child).max(1000), z.record(child).refine((v) => Object.keys(v).length <= 200)]);
}
const json = jsonAtDepth(20);
function containsSecret(value: unknown): boolean {
  if (typeof value === 'string') return detectSecretShaped(value) !== null;
  if (Array.isArray(value)) return value.some(containsSecret);
  if (value !== null && typeof value === 'object') return Object.entries(value).some(([key, item]) =>
    (/^(password|passwd|api[_-]?key|secret|token|private[_-]?key)$/i.test(key) && typeof item === 'string' && item.length > 0) || containsSecret(item));
  return false;
}
const payloadSchema = z.record(json).refine((v) => JSON.stringify(v).length <= 65_536);
export const proposalSchema = z.object({
  actionType: z.enum(schema.approvalActionEnum.enumValues),
  actionPayload: payloadSchema,
  targetResource: z.string().trim().min(1).max(500),
  expectedImpact: z.string().trim().min(1).max(2000),
  risks: z.string().trim().min(1).max(2000),
  expiresAt: z.string().datetime(),
  taskId: uuid.optional(),
  // A batch is one explicitly described payload consumed once, never a multi-use grant.
  batchId: uuid.optional(),
}).strict();
export type ApprovalProposal = z.infer<typeof proposalSchema>;
const bindingSchema = proposalSchema.pick({ actionType: true, actionPayload: true, targetResource: true })
  .extend({ requester: actorSchema }).strict();
export type ApprovalBinding = z.infer<typeof bindingSchema>;

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).filter((key) => (value as Record<string, unknown>)[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export function stateHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
export function approvalBinding(request: ApprovalRequest): ApprovalBinding {
  return {
    requester: request.requestingActorType === 'owner'
      ? { kind: 'owner' } : { kind: 'agent', agentId: request.requestingAgentId! as AgentId },
    actionType: request.actionType, targetResource: request.targetResource,
    actionPayload: request.actionPayload as Record<string, Json>,
  };
}
async function audit(tx: Tx, action: string, id: string, actor: ApprovalActor | 'system', payload: Record<string, unknown> = {}) {
  await tx.insert(auditEvents).values({
    actorType: actor === 'system' ? 'system' : actor.kind,
    actorId: actor === 'system' ? 'approvals' : actor.kind === 'owner' ? 'owner' : actor.agentId,
    action, targetType: 'approval', targetId: id, payload,
  });
}
async function denied(tx: Tx, code: ApprovalCode, id = 'rejected'): Promise<{ ok: false; code: ApprovalCode }> {
  await audit(tx, 'approval.denied', id, 'system', { code });
  return { ok: false, code };
}

/** actor is server-derived (authenticated owner or actual worker agent), never model-supplied authority. */
export async function createApprovalRequest(db: Db | Tx, rawActor: ApprovalActor, raw: unknown): Promise<ApprovalResult<ApprovalRequest>> {
  const parsed = proposalSchema.safeParse(raw);
  const identity = actorSchema.safeParse(rawActor);
  if (!parsed.success || !identity.success) return db.transaction((tx) => denied(tx, 'invalid_input'));
  const input = parsed.data;
  const actor = identity.data;
  const expiry = new Date(input.expiresAt);
  const ttl = expiry.getTime() - Date.now();
  if (ttl < MIN_TTL_MS || ttl > MAX_APPROVAL_TTL_MS) return db.transaction((tx) => denied(tx, 'invalid_input'));
  if (containsSecret(input)) return db.transaction((tx) => denied(tx, 'secret_rejected'));
  const key = stateHash({ actor: identity.data, ...input, expiresAt: expiry.toISOString(), taskId: input.taskId ?? null, batchId: input.batchId ?? null });
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    if (actor.kind === 'agent') {
      const [agent] = await tx.select().from(agents).where(eq(agents.id, actor.agentId)).for('share');
      if (!agent?.enabled || !policyConfigSchema.safeParse(agent.config).success) return denied(tx, 'permission_denied');
    }
    const [existing] = await tx.select().from(requests).where(eq(requests.dedupeKey, key));
    if (existing) return { ok: true, value: existing };
    if (expiry.getTime() - Date.now() < MIN_TTL_MS) return denied(tx, 'invalid_input');
    const targetAccounts = await tx.select({ config: schema.connectorAccounts.config }).from(schema.connectorAccounts);
    const targetStateHash = mockTargetStateHash(targetAccounts, input.targetResource);
    const [request] = await tx.insert(requests).values({
      requestingActorType: actor.kind, requestingAgentId: actor.kind === 'agent' ? actor.agentId : null,
      actionType: input.actionType, actionPayload: input.actionPayload, targetResource: input.targetResource, targetStateHash,
      expectedImpact: input.expectedImpact, risks: input.risks, expiresAt: expiry,
      taskId: input.taskId ?? null, batchId: input.batchId ?? null, dedupeKey: key,
    }).returning();
    if (!request) throw new Error('approval insert returned no row');
    await audit(tx, 'approval.requested', request.id, actor, { actionType: request.actionType });
    return { ok: true, value: request };
  });
}

const proofBrand: unique symbol = Symbol('owner-authorization');
export type OwnerAuthorization = { readonly [proofBrand]: true };
const proofs = new WeakMap<OwnerAuthorization, { sessionId: string; passwordHash: string; expiresAt: number }>();

/** Fresh password verification plus current session, with serialized lockout accounting. */
export async function reauthenticateOwner(db: Db, sessionId: string, password: string): Promise<ApprovalResult<OwnerAuthorization>> {
  if (!z.string().min(1).max(256).safeParse(password).success || !sessionId) return { ok: false, code: 'auth_failed' };
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for('share');
    const [account] = await tx.select().from(owner).where(eq(owner.id, 1)).for('update');
    const now = Date.now();
    if (!session || session.expiresAt.getTime() <= now || !account || (account.lockedUntil?.getTime() ?? 0) > now) {
      await verifyPassword(await DUMMY_HASH_PROMISE, password);
      await audit(tx, 'approval.reauth_failed', 'owner', 'system');
      return { ok: false, code: 'auth_failed' };
    }
    if (!await verifyPassword(account.passwordHash, password)) {
      const failures = account.failedAttempts + 1;
      await tx.update(owner).set({ failedAttempts: failures,
        lockedUntil: failures >= 5 ? new Date(now + 15 * 60_000) : account.lockedUntil,
      }).where(eq(owner.id, 1));
      await audit(tx, 'approval.reauth_failed', 'owner', 'system');
      return { ok: false, code: 'auth_failed' };
    }
    await tx.update(owner).set({ failedAttempts: 0, lockedUntil: null }).where(eq(owner.id, 1));
    const proof: OwnerAuthorization = Object.freeze({ [proofBrand]: true as const });
    proofs.set(proof, { sessionId, passwordHash: account.passwordHash, expiresAt: Math.min(now + PROOF_TTL_MS, session.expiresAt.getTime()) });
    return { ok: true, value: proof };
  });
}

const grantBrand: unique symbol = Symbol('approval-grant');
export type ApprovalGrant = { readonly id: string; readonly approvalRequestId: string; readonly [grantBrand]: true };
const capabilities = new WeakSet<object>();
function capability(id: string, approvalRequestId: string): ApprovalGrant {
  const grant = Object.freeze({ id, approvalRequestId, [grantBrand]: true as const });
  capabilities.add(grant);
  return grant;
}

async function expirePending(tx: Tx, request: ApprovalRequest) {
  if (request.status !== 'pending' || request.expiresAt.getTime() > Date.now()) return false;
  await tx.update(requests).set({ status: 'expired', decidedBy: 'expiry', decidedAt: new Date(Date.now()) }).where(eq(requests.id, request.id));
  await audit(tx, 'approval.expired', request.id, 'system');
  return true;
}

export async function decideApproval(db: Db, authorization: OwnerAuthorization, id: string, decision: 'approve' | 'reject', reason = ''):
  Promise<ApprovalResult<{ request: ApprovalRequest; grant: ApprovalGrant | null }>> {
  const proof = proofs.get(authorization);
  proofs.delete(authorization); // A verification authorizes one decision attempt, including concurrent attempts.
  if (!proof || proof.expiresAt <= Date.now()) return db.transaction((tx) => denied(tx, 'auth_failed'));
  if (!uuid.safeParse(id).success || !['approve', 'reject'].includes(decision) || (decision === 'reject' && !reason.trim()) || reason.length > 1000 || detectSecretShaped(reason)) {
    return db.transaction((tx) => denied(tx, 'invalid_input'));
  }
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(sessions).where(eq(sessions.id, proof.sessionId)).for('share');
    const [account] = await tx.select().from(owner).where(eq(owner.id, 1)).for('share');
    if (!session || session.expiresAt.getTime() <= Date.now() || !account || account.passwordHash !== proof.passwordHash ||
      (account.lockedUntil?.getTime() ?? 0) > Date.now() || proof.expiresAt <= Date.now()) return denied(tx, 'auth_failed');
    const [request] = await tx.select().from(requests).where(eq(requests.id, id)).for('update');
    if (!request) return denied(tx, 'not_found');
    if (proof.expiresAt <= Date.now() || session.expiresAt.getTime() <= Date.now()) return denied(tx, 'auth_failed', id);
    if (await expirePending(tx, request) || request.expiresAt.getTime() <= Date.now()) return denied(tx, 'expired', id);
    if (request.status !== 'pending') {
      if (decision === 'approve' && request.status === 'approved') {
        const [grant] = await tx.select().from(grants).where(eq(grants.approvalRequestId, id));
        if (grant) return { ok: true, value: { request, grant: capability(grant.id, id) } };
      }
      if (decision === 'reject' && request.status === 'rejected') return { ok: true, value: { request, grant: null } };
      return denied(tx, 'conflict', id);
    }
    const [updated] = await tx.update(requests).set({ status: decision === 'approve' ? 'approved' : 'rejected',
      decidedBy: 'owner', decidedAt: new Date(Date.now()), decisionReason: reason,
    }).where(eq(requests.id, id)).returning();
    if (!updated) throw new Error('approval decision returned no row');
    let grant: ApprovalGrant | null = null;
    if (decision === 'approve') {
      const [minted] = await tx.insert(grants).values({ approvalRequestId: id }).returning();
      if (!minted) throw new Error('grant insert returned no row');
      grant = capability(minted.id, id);
    }
    await audit(tx, decision === 'approve' ? 'approval.approved' : 'approval.rejected', id, { kind: 'owner' });
    return { ok: true, value: { request: updated, grant } };
  });
}

/** Server-only rehydration after restart; possession of a JSON-shaped object is not a capability. */
export async function loadApprovalGrant(db: Db, id: string): Promise<ApprovalResult<ApprovalGrant>> {
  if (!uuid.safeParse(id).success) return db.transaction((tx) => denied(tx, 'invalid_grant'));
  const [grant] = await db.select().from(grants).where(eq(grants.id, id));
  return grant ? { ok: true, value: capability(grant.id, grant.approvalRequestId) } : db.transaction((tx) => denied(tx, 'invalid_grant'));
}

export const agentConfigPatchSchema = policyConfigSchema.partial().merge(z.object({
  displayName: z.string().min(1).max(60).optional(), personality: z.string().min(1).max(500).optional(),
  roleSummary: z.string().min(1).max(500).optional(), enabled: z.boolean().optional(),
})).strict().refine((v) => Object.keys(v).length > 0);
function agentSnapshot(agent: typeof agents.$inferSelect) {
  return { id: agent.id, config: agent.config, enabled: agent.enabled, displayName: agent.displayName,
    personality: agent.personality, roleSummary: agent.roleSummary, updatedAt: agent.updatedAt.toISOString() };
}
export async function prepareAgentConfigChange(db: Db, id: AgentId, raw: unknown): Promise<ApprovalResult<ApprovalRequest>> {
  const patch = agentConfigPatchSchema.safeParse(raw);
  if (!patch.success) return { ok: false, code: 'invalid_input' };
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) return { ok: false, code: 'not_found' };
  const { enabled: _enabled, ...configPatch } = patch.data;
  if (!agentConfigSchema.safeParse({ ...(agent.config as object), ...configPatch }).success) return { ok: false, code: 'invalid_input' };
  const actionPayload = { patch: patch.data, baseStateHash: stateHash(agentSnapshot(agent)) };
  const targetResource = `agent:${id}`;
  return db.transaction(async (tx) => {
    const key = stateHash({ targetResource, actionPayload });
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    const [existing] = await tx.select().from(requests).where(and(
      eq(requests.requestingActorType, 'owner'), eq(requests.actionType, 'agent_config_change'),
      eq(requests.targetResource, targetResource), eq(requests.actionPayload, actionPayload),
      eq(requests.status, 'pending'), gt(requests.expiresAt, new Date(Date.now())),
    ));
    if (existing) return { ok: true, value: existing };
    return createApprovalRequest(tx, { kind: 'owner' }, {
      actionType: 'agent_config_change', targetResource, actionPayload,
      expectedImpact: 'Change the selected agent configuration and its effective permissions.',
      risks: 'Permission, execution budget, or enabled-state changes affect the agent security boundary.',
      expiresAt: new Date(Date.now() + DEFAULT_APPROVAL_TTL_MS).toISOString(),
    });
  });
}

/** Exact binding plus current permissions, expiry, and consumed-state are rechecked under locks. */
export async function consumeApprovalGrant(db: Db, grant: ApprovalGrant, expected: ApprovalBinding, runId?: string):
  Promise<ApprovalResult<{ outboxId: string; agent: typeof agents.$inferSelect | null }>> {
  const binding = bindingSchema.safeParse(expected);
  if (!capabilities.has(grant) || !binding.success || (runId !== undefined && !uuid.safeParse(runId).success)) {
    return db.transaction((tx) => denied(tx, 'invalid_grant'));
  }
  return db.transaction(async (tx) => {
    const [request] = await tx.select().from(requests).where(eq(requests.id, grant.approvalRequestId)).for('update');
    const [persisted] = await tx.select().from(grants).where(eq(grants.id, grant.id)).for('update');
    if (!request || !persisted || persisted.approvalRequestId !== request.id) return denied(tx, 'invalid_grant');
    if (persisted.consumedAt) return denied(tx, 'already_consumed', request.id);
    if (await expirePending(tx, request) || request.expiresAt.getTime() <= Date.now()) return denied(tx, 'expired', request.id);
    if (request.status !== 'approved') return denied(tx, 'permission_denied', request.id);
    if (canonicalJson(approvalBinding(request)) !== canonicalJson(binding.data)) return denied(tx, 'binding_mismatch', request.id);
    if (request.requestingActorType === 'agent') {
      const id = request.requestingAgentId! as AgentId;
      const [agent] = await tx.select().from(agents).where(eq(agents.id, id)).for('share');
      const decision = evaluatePolicy(id, { operation: request.actionType }, agent ? { agentId: id, enabled: agent.enabled, policy: agent.config } : null);
      if (decision.allowed || decision.code !== 'approval_required') return denied(tx, 'permission_denied', request.id);
    }
    let requesterPolicyHash: string | null = null;
    if (request.requestingActorType === 'agent') {
      const [requester] = await tx.select().from(agents).where(eq(agents.id, request.requestingAgentId! as AgentId));
      if (!requester?.enabled) return denied(tx, 'permission_denied', request.id);
      requesterPolicyHash = stateHash({ enabled: requester.enabled, policy: policyConfigSchema.parse(requester.config) });
    }
    let updatedAgent: typeof agents.$inferSelect | null = null;
    if (request.actionType === 'agent_config_change') {
      const target = z.enum(AGENT_IDS).safeParse(request.targetResource.replace(/^agent:/, ''));
      const payload = z.object({ patch: agentConfigPatchSchema, baseStateHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().safeParse(request.actionPayload);
      if (!target.success || request.targetResource !== `agent:${target.data}` || !payload.success) return denied(tx, 'invalid_input', request.id);
      const [current] = await tx.select().from(agents).where(eq(agents.id, target.data)).for('update');
      if (!current || stateHash(agentSnapshot(current)) !== payload.data.baseStateHash) return denied(tx, 'target_changed', request.id);
      if (request.expiresAt.getTime() <= Date.now()) return denied(tx, 'expired', request.id);
      const { enabled, ...patch } = payload.data.patch;
      const config = agentConfigSchema.safeParse({ ...(current.config as object), displayName: current.displayName,
        personality: current.personality, roleSummary: current.roleSummary, ...patch });
      if (!config.success) return denied(tx, 'invalid_input', request.id);
      const [updated] = await tx.update(agents).set({ config: config.data, enabled: enabled ?? current.enabled,
        displayName: payload.data.patch.displayName ?? current.displayName,
        personality: payload.data.patch.personality ?? current.personality,
        roleSummary: payload.data.patch.roleSummary ?? current.roleSummary, updatedAt: new Date(Date.now()),
      }).where(eq(agents.id, current.id)).returning();
      if (!updated) throw new Error('agent update returned no row');
      updatedAgent = updated;
      await tx.insert(schema.budgets).values({ agentId: current.id, ...config.data.budgets })
        .onConflictDoUpdate({ target: schema.budgets.agentId, set: { ...config.data.budgets, updatedAt: new Date(Date.now()) } });
    }
    if (!updatedAgent && request.expiresAt.getTime() <= Date.now()) return denied(tx, 'expired', request.id);
    // Consume and enqueue together; neither survives if outbox/audit/config persistence fails.
    await tx.update(grants).set({ consumedAt: new Date(Date.now()), consumedByRunId: runId ?? null }).where(eq(grants.id, grant.id));
    const [delivery] = await tx.insert(outbox).values({
      connector: 'mock', operation: request.actionType, grantId: grant.id,
      payload: { approvalRequestId: request.id, ...approvalBinding(request), expiresAt: request.expiresAt.toISOString(),
        requesterPolicyHash, targetStateHash: request.targetStateHash },
      idempotencyKey: `approval:${request.id}`, status: updatedAgent ? 'dispatched' : 'pending',
    }).returning();
    if (!delivery) throw new Error('outbox insert returned no row');
    await audit(tx, 'approval.consumed', request.id, approvalBinding(request).requester, { grantId: grant.id, outboxId: delivery.id });
    if (updatedAgent) await audit(tx, 'agent.config_changed', request.id, approvalBinding(request).requester, { agentId: updatedAgent.id });
    return { ok: true, value: { outboxId: delivery.id, agent: updatedAgent } };
  });
}

export async function listApprovals(db: Db, status?: ApprovalRequest['status']) {
  await db.transaction(async (tx) => {
    const pending = await tx.select().from(requests).where(and(eq(requests.status, 'pending'), lte(requests.expiresAt, new Date(Date.now()))))
      .orderBy(asc(requests.id)).for('update');
    for (const request of pending) await expirePending(tx, request);
  });
  return db.select().from(requests).where(status ? eq(requests.status, status) : undefined).orderBy(desc(requests.createdAt)).limit(100);
}
export async function getApproval(db: Db, id: string) {
  if (!uuid.safeParse(id).success) return null;
  return db.transaction(async (tx) => {
    const [request] = await tx.select().from(requests).where(eq(requests.id, id)).for('update');
    if (!request) return null;
    if (await expirePending(tx, request)) {
      const [expired] = await tx.select().from(requests).where(eq(requests.id, id));
      return expired ?? null;
    }
    return request;
  });
}

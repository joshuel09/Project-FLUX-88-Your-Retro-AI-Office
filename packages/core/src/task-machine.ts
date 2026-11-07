/**
 * Task state machine service (T023) — pure functions only.
 * This module plans a transition (patch + audit event); applying it to the
 * database happens in @flux88/db so this package stays I/O-free.
 * Subpath export (`@flux88/core/task-machine`): kept out of index.ts because
 * drizzle-kit's CJS loader cannot follow relative .js imports between files.
 */
import { canTransition, isTerminal, type TaskStatus } from './index.js';

/** FR-015: a delegation chain may never exceed this depth. */
export const MAX_DELEGATION_DEPTH = 3;

export type TaskActorType = 'owner' | 'agent' | 'system' | 'connector';

export interface TransitionContext {
  actorType: TaskActorType;
  actorId: string;
  reason?: string;
}

export interface TransitionPlan {
  ok: true;
  from: TaskStatus;
  to: TaskStatus;
  /** Column updates to apply alongside `status`. */
  patch: { status: TaskStatus; blockedReason: string | null };
  /** Audit event to append in the same operation (constitution IV). */
  audit: {
    actorType: TaskActorType;
    actorId: string;
    action: 'task.transition';
    payload: { from: TaskStatus; to: TaskStatus; reason?: string };
  };
}

export interface TransitionRejection {
  ok: false;
  code: 'illegal_transition' | 'terminal';
  message: string;
}

/** Statuses whose reason is worth keeping on the row for the owner to read. */
const REASON_BEARING: readonly TaskStatus[] = ['blocked', 'failed', 'canceled'];

/**
 * Validate and plan a status transition (FR-011). Every status change in the
 * system MUST go through this planner — direct status writes are a defect.
 */
export function planTransition(
  current: { status: TaskStatus },
  to: TaskStatus,
  ctx: TransitionContext,
): TransitionPlan | TransitionRejection {
  if (isTerminal(current.status)) {
    return {
      ok: false,
      code: 'terminal',
      message: `task is ${current.status} (terminal) and cannot move to ${to}`,
    };
  }
  if (!canTransition(current.status, to)) {
    return {
      ok: false,
      code: 'illegal_transition',
      message: `illegal transition ${current.status} -> ${to}`,
    };
  }
  const keepReason = REASON_BEARING.includes(to);
  return {
    ok: true,
    from: current.status,
    to,
    patch: { status: to, blockedReason: keepReason ? (ctx.reason ?? null) : null },
    audit: {
      actorType: ctx.actorType,
      actorId: ctx.actorId,
      action: 'task.transition',
      payload: { from: current.status, to, ...(ctx.reason ? { reason: ctx.reason } : {}) },
    },
  };
}

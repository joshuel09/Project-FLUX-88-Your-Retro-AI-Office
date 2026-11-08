# API Contract Overview: FLUX-88 (Hono HTTP API)

**Date**: 2026-11-06 · Shape-level contract; exact zod schemas land in `apps/api` during
Phase 1. All routes require an authenticated owner session unless noted; all mutations
require a CSRF token; all inputs are server-side validated; every mutation writes an audit
event.

## Conventions

- Base: `/api/v1`
- Errors: `{ error: { code, message } }` — generic auth errors, no user-existence leaks
- Pagination: `?cursor=&limit=` → `{ items, nextCursor? }`
- Live updates: `GET /events` (SSE; `task`, `approval`, `audit`, `agent_status` streams)

## Auth

| Method | Path | Purpose |
|---|---|---|
| POST | /auth/login | Owner login (lockout after 5 failures; session re-issued) |
| POST | /auth/logout | End session |
| GET  | /auth/me | Current session info |

## Agents

| Method | Path | Purpose |
|---|---|---|
| GET | /agents | All 18 agents with status + config summary |
| GET | /agents/:id | Full config |
| PATCH | /agents/:id/config | Edit configuration (validated against registry schema; **policy-affecting fields require approval flow**) |

## Tasks & orchestration

| Method | Path | Purpose |
|---|---|---|
| GET/POST | /tasks | List (filter by status/agent/area) / create |
| GET | /tasks/:id | Task with subtasks, dependencies, handoffs, artifacts, runs, costs |
| PATCH | /tasks/:id | Owner edits (priority, deadline, reassign) |
| POST | /tasks/:id/transition | Guarded status transition |
| POST | /tasks/:id/pause · /resume · /cancel | Workflow control (FR-014) |
| POST | /tasks/:id/input | Owner input to a blocked task (artifact + unblock, FR-018) |
| GET | /tasks/:id/timeline | Delegation/handoff timeline |

## Approvals

| Method | Path | Purpose |
|---|---|---|
| GET/POST | /approvals | List inbox / create an immutable proposal; inbox (pending/decided; includes expiry) |
| GET | /approvals/:id | Full immutable request detail |
| POST | /approvals/:id/approve | Fresh password reauthentication; mints one single-use grant for the exact action/batch |
| POST | /approvals/:id/reject | Fresh password reauthentication; reject with a nonempty reason |

Approval decisions accept `{ password, reason? }` (`reason` is required to reject).
The password is verified server-side and never stored in a proposal, audit, or outbox.
`POST /approvals` accepts action type/payload, target, impact, risks, expiry, optional
requesting agent/task/batch identifiers. Omit the agent for an authenticated owner
proposal. Unknown privilege fields are rejected. Every category uses single-use grants.

A policy-affecting `PATCH /agents/:id/config` without a grant creates/reuses a pending
owner proposal and returns 403 with `approvalRequestId`. This includes `enabled` changes.
After approving, repeat the exact patch with `approvalGrantId`. Changed patches, targets,
configuration snapshots, expired grants, and reused grants are refused. Successful
consumption updates agent configuration and budget limits and records a completed local
outbox action atomically. Presentation-only edits retain the existing direct path.

Internal (worker-only, service credential): `POST /internal/grants/:id/consume` is **not**
exposed; consumption happens in-process in the API via the outbox. Workers never mint or
consume grants directly.

## Memory Vault

| Method | Path | Purpose |
|---|---|---|
| GET | /memory/search?q=&mode=keyword\|semantic | Search with attribution + status |
| POST | /memory | Write (agent/system callers checked against category permissions; secret-shaped content rejected) |
| GET | /memory/:id | Entry + versions + conflicts |
| PATCH | /memory/:id | Correct (new version) |
| POST | /memory/:id/revoke | Hide from search, keep history |

## Integrations

| Method | Path | Purpose |
|---|---|---|
| GET | /integrations | Connector accounts, mode (read-only/write), health |
| PATCH | /integrations/:id | Change mode (write-enable itself requires approval) |
| POST | /webhooks/github · /webhooks/discord · /webhooks/trello | Signed webhook ingress (P3+; payloads tagged untrusted; idempotent by delivery id) |

## Audit, budgets, notifications

| Method | Path | Purpose |
|---|---|---|
| GET | /audit | Append-only event log (filter by actor/target/action) |
| GET | /budgets · PATCH /budgets/:agentId | View/set per-agent budgets |
| GET | /notifications | Owner notification history (dedupe keys visible) |

## Non-negotiable contract properties

1. No route executes an FR-030 critical action without a valid, unconsumed, unexpired
   `ApprovalGrant` bound to that exact action.
2. Approval decisions and grant consumption are idempotent and single-use (scenario 7).
3. Webhook and sync ingress is idempotent by provider delivery id (scenarios 5, 9).
4. Every response that includes simulated data marks it `simulated: true` (FR-053).

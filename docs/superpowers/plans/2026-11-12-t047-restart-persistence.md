# T047 Restart Persistence Implementation Plan

> **For agentic workers:** Inline execution in the current isolated worktree.

**Goal:** Prove durable task, approval, memory, and audit records survive a full isolated Postgres/Redis/worker restart, and verify worker reconciliation resumes one interrupted run without duplicate effects.

**Architecture:** Extend the T046 Compose harness with narrowly scoped Postgres restart/readiness and migration helpers. The Playwright integration test writes fixture rows through Drizzle, snapshots selected durable fields, restarts Postgres and Redis, compares snapshots, then starts the real worker against an interrupted run and checks reconciliation and outbox idempotency.

**Tech Stack:** TypeScript, Playwright, Docker Compose, Drizzle, PostgreSQL, Redis, existing worker reconciliation.

**Spec:** `specs/001-flux-88-platform/tasks.md` T047; `specs/001-flux-88-platform/quickstart.md` scenario 2.

## Global Constraints

- Use only the unique T046 Compose project, ephemeral loopback ports, and harness-owned child processes.
- Do not connect to, restart, or truncate shared local services or databases.
- Preserve PostgreSQL as source of truth; Redis is transport.
- Keep MockProvider and mock outbox behavior; add no live integration.
- Keep tests deterministic and clean up in `finally`.

## Review Focus

- Restart cleanup after a failed assertion: assert no containers with the unique Compose project label remain.
- Snapshot stability: omit generated timestamps that are not part of persisted identity; compare stable fields and IDs.
- Interrupted-run replay: assert one failed old run, one bounded retry, and no duplicate artifact/outbox receipt.
- Readiness races: poll only the harness-owned Postgres/Redis health after restart.

---

### Task 1: Add scoped database lifecycle helpers

**Files:**
- Modify: `e2e/failure/harness.ts`
- Test: `e2e/tests/failure-harness.spec.ts`

**Interfaces:**
- Produces `restartPostgres(): Promise<void>` with readiness polling and a migration helper that always uses `this.databaseUrl`.

- [x] Write a focused test for Postgres restart and database reachability.
- [x] Run the focused test to verify the missing helper fails.
- [x] Implement only the harness-owned restart/readiness and migration operations.
- [x] Run the focused test and e2e typecheck.

### Task 2: Verify persistence and recovery

**Files:**
- Create: `e2e/tests/restart.spec.ts`
- Modify: `specs/001-flux-88-platform/tasks.md`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consume the T046 harness and `restartPostgres()`.
- Snapshot stable task, approval, memory, and audit fields through the DB client.
- Start the real worker with harness DB/Redis URLs after persisting an interrupted running task/run.

- [x] Write the restart and recovery assertions before adapting the harness.
- [x] Verify they expose fixture and worker setup failures, then fix those setup defects.
- [x] Implement the minimal fixture setup and assertions; no application behavior change was needed.
- [x] Run focused restart/failure tests, e2e typecheck, root typecheck/build/unit tests, and wire the scoped Playwright harness tests into CI.
- [x] Confirm the exact-head CI suite before merging.

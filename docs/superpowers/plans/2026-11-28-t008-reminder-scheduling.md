# T008 Reminder Scheduling Implementation Plan

**Goal:** Persist one bounded, interval-keyed dashboard reminder for linked GitHub feedback, defer it through configured quiet hours, and recover safely after duplicate jobs or worker restarts.

**Architecture:** Reuse the existing `notifications` delivery interval, status, attempts, and quiet-hours fields. The worker periodically scans linked feedback; PostgreSQL uniqueness is the idempotency gate. The scheduler only prepares dashboard-visible rows; T010 owns approval batches and any Discord send.

**Tech Stack:** TypeScript, Drizzle/PostgreSQL, existing worker process, Vitest.

**Spec:** `specs/002-github-discord/{spec.md,tasks.md,data-model.md,quickstart.md}` (T008, FR-P3-004, FR-P3-005).

## Global Constraints

- Discord remains mock-first; this task performs no network send.
- Feedback content is untrusted; reminders use a server-defined template and source URL only.
- Only explicitly linked, unresolved feedback with an existing task can produce reminders.
- PostgreSQL is authoritative; duplicate polling and process restarts cannot duplicate one interval.
- Reminder retries are bounded per polling cycle; the next cycle re-scans durable source records.

## Review Focus

- Repeated and concurrent scheduler runs: assert one notification for one feedback interval.
- Quiet-hours boundaries and overnight ranges: assert pending reminder is marked deferred then released after quiet hours.
- Owner reassignment: assert message uses the task's current assignee rather than the ingestion snapshot.
- Old pending reminder and missed polling intervals: assert no reminder backlog or spam.
- Database/provider failure: assert at most three attempts in one poll and no raw error leakage.

## Decisions

- **Ruling:** first reminder is due one configured interval after feedback receipt; each later interval is anchored to that receipt time — this gives duplicates a stable bucket; cost if wrong: reminder timing differs from a fixed wall-clock cadence.
- **Ruling:** use `DISCORD_REMINDER_INTERVAL_HOURS` with a 24-hour default and a 1–168-hour bound — the spec requires a configured interval but defines no value; cost if wrong: owners may expect another default cadence.
- **Ruling:** interpret existing `QUIET_HOURS` in the worker host's local timezone — no timezone setting exists in project config; cost if wrong: hosts in UTC may not match the owner's local quiet hours.
- **Ruling:** create dashboard-channel pending rows and do not send or create approval grants — T010 owns exact approved-batch dispatch; cost if wrong: Discord delivery remains unavailable until T010.

## Tasks

### 1. Configure the reminder interval

- [x] Add failing config tests for default, valid bound, and rejected out-of-range values.
- [x] Add `DISCORD_REMINDER_INTERVAL_HOURS` (default 24, integer 1–168) to `packages/config/src/index.ts`.
- [x] Tighten quiet-hours validation to valid 24-hour clock values.
- [x] Run `pnpm --filter @flux88/config test` and typecheck.

### 2. Build durable scheduling

- [x] Add failing worker integration tests for not-due/due feedback, repeated/concurrent jobs, later intervals, quiet-hours deferral/release, current assignee, and pending reminder suppression.
- [x] Add a failing retry test for three-attempt cap and exponential wait sequence.
- [x] Implement `apps/worker/src/connectors/reminders.ts` using existing notifications fields and DB unique key.
- [x] Start the bounded periodic scheduler only when `review_reminder` is enabled; close it with the worker.
- [x] Run targeted tests against the provisioned worker DB role and typecheck.

### 3. Document and verify

- [x] Document interval configuration and quiet-hours timezone in the Phase 3 quickstart.
- [x] Mark T008 complete only after implementation checks pass.
- [x] Run workspace typecheck, build, unit and integration suites; GitHub CI adds the full dashboard gate.
- [x] Review the final branch diff for approval-boundary, untrusted-content, idempotency, and retry correctness.

## Execution Ledger

- Workspace: `/Users/josusama/.codex/worktrees/issue-88-t008-reminders`, branch `feature/issue-88-t008-reminders`, base `4cb1aa9`.
- Issue #88 is on project board #4; status In Progress.
- Local verification: workspace typecheck, build, and unit suites passed; integration suites passed (DB 3, memory 19, API 54, worker 40); focused config suite passed (9 tests).
- Ruling: create dashboard-visible pending records only; no Discord send or approval grant is created by T008, which leaves exact dispatch to T010.

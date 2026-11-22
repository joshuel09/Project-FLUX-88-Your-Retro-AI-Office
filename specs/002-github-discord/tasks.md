# Tasks: Phase 3 GitHub and Discord Collaboration

**Input**: Design documents from `specs/002-github-discord/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/connectors.md`, `quickstart.md`

**Tests**: Product changes require acceptance coverage. Tests use mock providers and a disposable database; CI does not need live GitHub or Discord credentials.

## Phase 1: Foundations

**Purpose**: Define provider contracts and safe configuration, then persist external identities before implementing sync or delivery.

- [ ] T001 [P] Add normalized GitHub feedback and sync-cursor contracts to `packages/connectors/src/adapter.ts` with contract tests in `packages/connectors/src/adapter.test.ts`; preserve the existing read-only overview interface (FR-P3-001, FR-P3-003).
- [ ] T002 Add deterministic GitHub feedback mock fixtures for mapped, unmapped, duplicate, oversized, and hostile-content cases in `packages/connectors/src/mock/github.ts` and `packages/connectors/src/mock/github.test.ts` (FR-P3-003, FR-P3-004, FR-P3-009).
- [ ] T003 [P] Add validated GitHub/Discord configuration for credentials, repository allowlists, owner/guild/channel IDs, and allowed notification templates in `packages/config/src/index.ts` with tests in `packages/config/src/index.test.ts` and blank examples in `env.example`; never include secret values in errors, and make runtime provider selection fail closed until each live adapter lands. Test those defaults and failure paths (FR-P3-006, FR-P3-009, FR-P3-010, FR-P3-012).
- [ ] T004 [P] Add persistent `external_feedback` records, unique Discord interaction IDs, and unique notification delivery interval with approval batch reference in `packages/db/src/schema/index.ts` and `packages/db/src/migrations/`; cover duplicate conflicts and constraints in `packages/db/src/schema.integration.test.ts` (FR-P3-003, FR-P3-004, FR-P3-007, FR-P3-013).

## Phase 2: US1 — Import GitHub review feedback (Priority: P3)

**Goal**: Read feedback from allowlisted repositories and map it only to explicitly linked tasks.

**Independent Test**: Sync mocked feedback for an externally linked PR; verify one untrusted record and activity event link to the task/assignee; repeat sync and verify no duplicates. Verify unmapped items surface to the owner without auto-assignment.

- [ ] T005 [US1] Implement bounded, read-only GitHub reads for allowlisted repositories, commits, pull requests, issues, comments, and review feedback with conditional requests, typed rate-limit/auth errors, and injected transport in `packages/connectors/src/github/client.ts`; add contract tests in `packages/connectors/src/github/client.test.ts` (FR-P3-001, FR-P3-004, FR-P3-010).
- [ ] T006 [US1] Implement idempotent feedback ingestion using provider identity and explicit `external_links` mapping in `apps/worker/src/connectors/github-sync.ts`; test duplicate delivery, missing mapping, current assignee attribution, and untrusted provenance in `apps/worker/src/connectors/github-sync.test.ts` (FR-P3-002, FR-P3-003, FR-P3-004, FR-P3-005).
- [ ] T007 [US1] Expose linked/unmatched feedback and add an audited owner action to link an unmatched PR to an existing task through the authenticated activity API/SSE and accessible UI in `apps/api/src/routes/feedback.ts`, `apps/web/app/(office)/clock-tower/activity/page.tsx`, and their tests (FR-P3-002, FR-P3-005, FR-P3-010).

## Phase 3: US2 — Send Discord notifications (Priority: P3)

**Goal**: Deliver task updates and review reminders to one owner-configured destination, with durable dedupe and quiet-hours deferral.

**Independent Test**: Schedule repeated reminder jobs for one task; verify one delivery per configured interval, no delivery during quiet hours, and one deferred send afterward. Without owner approval of an exact batch, all items remain dashboard-only; with approval, only listed messages send once.

- [ ] T008 [US2] Add durable reminder scheduling with configured interval, idempotency key, quiet-hours handling, and bounded retries in `apps/worker/src/connectors/reminders.ts`; test with a fixed clock and duplicate jobs (FR-P3-004, FR-P3-005).
- [ ] T009 [US2] Implement the Discord outbound adapter with configured destination allowlists, bounded server-defined messages, and typed rate-limit/auth errors in `packages/connectors/src/discord/client.ts`; add contract tests using injected fetch (FR-P3-006, FR-P3-010, FR-P3-012).
- [ ] T010 [US2] Add exact, time-limited notification batches to the existing approval inbox and dispatch only owner-approved messages through separate single-use `external_communication` grants in the grant-bound outbox; persist delivery attempts/results in `apps/worker/src/connectors/discord-notifications.ts` and test unapproved, expired, modified, restart, and duplicate cases (FR-P3-008, FR-P3-013).

## Phase 4: US3 — Accept authenticated Discord interactions (Priority: P3)

**Goal**: Accept only signed interactions from the configured owner and delegate to existing task/approval services.

**Independent Test**: A valid signed owner request reaches the matching service; invalid signature, stale timestamp, wrong owner, wrong channel, or duplicate interaction changes no state and is audited.

- [ ] T011 [P] [US3] Verify Discord Ed25519 signatures over raw request bytes and enforce a five-minute timestamp freshness window in `apps/api/src/integrations/discord-signature.ts`; test valid, tampered-body, missing-header, stale, and replay cases (FR-P3-006, FR-P3-007).
- [ ] T012 [US3] Add an interaction route that checks configured guild/channel/owner identity, deduplicates interaction IDs, and delegates command parsing to existing task/approval services in `apps/api/src/routes/discord-interactions.ts`; cover unauthorized and valid requests in integration tests (FR-P3-004, FR-P3-006, FR-P3-007).
- [ ] T013 [US3] Ensure Discord approval actions call the existing exact-request approval service and never mint or consume grants in the connector; test expired, wrong-target, duplicate, and unauthorized requests in `apps/api/src/policy/approvals.integration.test.ts` (FR-P3-007, FR-P3-008).

## Phase 5: US4 — Prepare safe response drafts (Priority: P3)

**Goal**: Let specialists prepare response drafts without publishing them automatically.

**Independent Test**: Draft a response to linked feedback; verify one internal draft is stored and no remote comment is created until the exact action is approved and enqueued.

- [ ] T014 [US4] Add feedback-linked response, follow-up-task, and patch draft artifacts with dedupe and untrusted-source references in `apps/worker/src/runner/drafts.ts`; test duplicate provider feedback, retry, and restart recovery in `apps/worker/src/runner/drafts.test.ts` (FR-P3-003, FR-P3-011).
- [ ] T015 [US4] Map a reviewed draft to an exact GitHub comment proposal and implement the matching grant-bound GitHub outbox executor in `apps/worker/src/runner/proposals.ts`, `packages/connectors/src/github/writer.ts`, and `apps/worker/src/outbox.ts`; test that no write occurs without approval and only the exact single-use approved action is delivered (FR-P3-008, FR-P3-011).

## Phase 6: Polish and release validation

- [ ] T016 Update `specs/002-github-discord/quickstart.md` and `README.md` with least-privilege credential setup, explicit scope approval, mock/live behavior, and secret handling (FR-P3-001, FR-P3-006, FR-P3-008, FR-P3-009, FR-P3-012, FR-P3-013).
- [ ] T017 Expose connector sync/delivery health and sanitized failure status in `apps/api/src/routes/integrations.ts` and `apps/web/app/(office)/clock-tower/integrations/page.tsx`; cover owner access, redacted errors, and mock mode in route/UI tests (FR-P3-010).
- [ ] T018 Run all acceptance flows from `specs/002-github-discord/quickstart.md` with mock providers and the disposable integration database; run the dashboard accessibility release gate and record verified results (SC-P3-001, SC-P3-002, SC-P3-003, SC-P3-004, SC-P3-005, SC-P3-006, SC-P3-007).

## Dependencies & Execution Order

- Foundations: T001 precedes T002; T003 and T004 can run in parallel with the provider contract. T003/T004 must precede live runtime wiring and feedback/delivery persistence.
- GitHub: T005 follows T001/T003; T006 follows T002/T004/T005; T007 follows T006.
- Discord notifications: T008 follows T003/T004; T009 follows T001/T003; T010 follows T008/T009 and uses the scoped approval/outbox path.
- Discord interactions: T011 follows T003; T012 follows T004/T011; T013 follows T012 and reuses the existing approval lifecycle.
- Drafts: T014 follows T006; T015 follows T014 and uses the existing proposal, policy, and outbox behavior.
- T016/T017 follow the corresponding live adapter work; T018 follows the selected stories.

## Implementation Strategy

Deliver GitHub feedback ingestion first, then Discord notifications, then authenticated interactions and safe response drafts. Keep each slice independently mock-testable. Do not enable live mode until the corresponding adapter and failure handling are implemented. Routine Discord notifications require a time-limited grant scoped to one destination and defined templates; every other remote write remains a grant-bound proposal/outbox action.

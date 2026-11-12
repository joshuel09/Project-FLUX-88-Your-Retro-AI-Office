# Tasks: FLUX-88 Phase 1 (MVP)

**Input**: Design documents from `specs/001-flux-88-platform/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, agents.md — all merged. Phase 0b scaffold merged (PR #6).

**Scope**: All [P1] requirements only. Phases 2–4 (real LLM, GitHub/Discord, Trello) are explicitly out of scope. Open decisions 1–5 use their adopted defaults (password auth, pgvector + mock embedder, dashboard approvals, this repo as monorepo root, `.claude/` stays unversioned).

**Tests**: Included — the constitution (Principle V) mandates acceptance tests per feature; quickstart.md defines the scenario-to-test mapping.

**Organization**: Slices follow plan.md "Prioritized Delivery Sequence": US5 shell → US1 tasks/delegation → US3 Memory Vault → US2 approvals → US4 hardening. Each slice is independently testable and demoable in mock mode.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5 from spec.md

## Phase 1: Setup

- [x] T001 Add Drizzle ORM, drizzle-kit, postgres driver and vitest workspace config: update `packages/db/package.json`, create `packages/db/drizzle.config.ts`, root `vitest.workspace.ts`
- [x] T002 [P] Add Tailwind CSS v4 + shadcn/ui base to `apps/web` (`apps/web/tailwind.config.ts`, `apps/web/app/globals.css`, `apps/web/components/ui/`) with retro theme tokens on `:root` (neon cyan `#5df3ff`, magenta `#ff3df0`, navy `#0b1026`, amber `#ffd37a`) incl. dark/light + `prefers-reduced-motion` guards
- [x] T003 [P] Add Playwright e2e scaffold with axe-core accessibility fixture in `e2e/playwright.config.ts`, `e2e/fixtures/a11y.ts`
- [x] T004 [P] Add integration-test harness that starts Postgres+Redis via `infra/docker-compose.yml` and truncates between tests in `packages/db/src/testing/harness.ts`

## Phase 2: Foundational (blocking all stories)

- [x] T005 Implement full Drizzle schema per data-model.md (agents, tasks, task_dependencies, handoffs, agent_runs, approval_requests, approval_grants, memory_entries, memory_versions, audit_events, connector_accounts, notifications, budgets, owner, sessions, outbox) in `packages/db/src/schema/*.ts` + initial migration in `packages/db/migrations/`
- [x] T006 Enforce append-only audit_events (INSERT/SELECT only for app roles) and create a least-privilege worker DB role that cannot mint or consume approval grants (plan Security Boundary 3, CHK026) in `packages/db/migrations/` (CHK025)
- [x] T007 [P] Implement repositories with parameterized queries only in `packages/db/src/repos/*.ts` (tasks, agents, approvals, memory, audit, budgets)
- [x] T008 [P] Implement AgentConfig zod schema per agents.md in `packages/agents/src/schema.ts`; personality fields structurally excluded from policy types (CHK018)
- [x] T009 Author all 18 agent configs per agents.md mapping table in `packages/agents/src/configs/*.ts` + roster completeness test `packages/agents/src/configs.test.ts` (exactly 18, unique IDs, non-empty scopes/prohibitedOps/memory/budgets — CHK014)
- [x] T010 Seed script: 18 agents + demo data flagged `simulated: true` in `packages/db/src/seed.ts`, wired to `pnpm db:seed`
- [x] T011 Owner auth in `apps/api/src/auth/`: Argon2id (argon2 lib), login/logout/me routes, 5-failure lockout with generic errors, session re-issue on login, Secure/HttpOnly/SameSite cookies, CSRF middleware for mutations (constitution Security Requirements; CHK019–021)
- [x] T012 [P] Audit middleware: every mutation route writes an audit event (actor, action, target) in `apps/api/src/middleware/audit.ts` (FR-070)
- [x] T013 [P] SSE endpoint `/api/v1/events` streaming task/approval/audit/agent_status channels in `apps/api/src/routes/events.ts`
- [x] T014 [P] Typed API client for the web app in `apps/web/lib/api.ts` (hono client)
- [x] T015 Dashboard shell: layout with nine office-area navigation, login page, MOCK MODE banner, reduced-motion toggle in `apps/web/app/(office)/layout.tsx`, `apps/web/app/login/page.tsx`

**Checkpoint**: migrations + seed run clean; login works; `pnpm test` green.

## Phase 3: US5 — Retro dashboard command center (spec User Story 5)

**Goal**: all nine areas navigable, agent directory live, a11y baseline. **Independent test**: quickstart scenario 7 + SC-001.

- [x] T016 [P] [US5] Agent directory with department grouping + status badges in `apps/web/app/(office)/clock-tower/agents/page.tsx`, components in `apps/web/components/agents/`
- [x] T017 [P] [US5] Nine office-area pages with themed headers and per-area content slots in `apps/web/app/(office)/{clock-tower,hawkins-lab,arcade,garage,ghost-lab,front-desk,video-store,mall,memory-vault}/page.tsx`
- [x] T018 [P] [US5] Agents API routes GET `/agents`, GET `/agents/:id`, PATCH `/agents/:id/config` (registry-schema validated; non-policy fields editable immediately; policy-affecting fields return "approval required" until T040 wires `agent_config_change` through the approval flow) in `apps/api/src/routes/agents.ts`
- [x] T019 [US5] Agent detail + permissions/rules viewer-editor (scopes, prohibited ops, budgets read-write; personality read-write) in `apps/web/app/(office)/clock-tower/agents/[id]/page.tsx`
- [x] T020 [P] [US5] Simulated-vs-real labeling component used by every feed/board (visual + aria-label) in `apps/web/components/simulated-badge.tsx` (FR-053, CHK035)
- [x] T021 [US5] e2e: login → visit all nine areas → 18 agents listed → axe passes → reduced-motion disables CRT/scanline effects in `e2e/tests/us5-dashboard.spec.ts`

## Phase 4: US1 — Delegated task execution (spec User Story 1)

**Goal**: create task → DOC decomposes via MockProvider → subtasks assigned → statuses progress → timeline visible. **Independent test**: quickstart scenario 1 (SC-002).

- [x] T022 [P] [US1] MockProvider: deterministic scripted completions + fake-but-consistent token/cost accounting in `packages/llm/src/mock.ts` (+ `LLMProvider` interface in `packages/llm/src/provider.ts`) (CHK044, CHK045)
- [x] T023 [P] [US1] Task state machine service wrapping `@flux88/core` guards with audit writes in `packages/core/src/task-machine.ts` + unit tests
- [x] T024 [US1] Tasks API: CRUD, transition, pause/resume/cancel, timeline per contracts/api.md in `apps/api/src/routes/tasks.ts`
- [x] T025 [US1] BullMQ queues + worker wiring with idempotency keys and startup reconciliation from Postgres in `apps/worker/src/queues/index.ts`, `apps/worker/src/reconcile.ts`
- [x] T026 [US1] DOC orchestrator: decomposition via MockProvider, skill-based assignee selection from agent registry, dependency-graph creation (DAG cycle check), delegation-depth limit, handoff records in `apps/worker/src/orchestrator/doc.ts`
- [x] T027 [US1] Agent runner: executes a subtask with the assigned agent's config + MockProvider, enforces per-run token/runtime/retry budgets, records agent_runs in `apps/worker/src/runner/index.ts`
- [x] T028 [P] [US1] Task board UI (columns per status, drag disabled in P1, detail drawer with artifacts/handoffs/costs) in `apps/web/app/(office)/clock-tower/tasks/`
- [x] T029 [P] [US1] Delegation timeline + activity feed (SSE-driven) in `apps/web/components/timeline/`, `apps/web/app/(office)/clock-tower/activity/page.tsx`
- [x] T030 [US1] Blocked-task escalation: blocker reason surfaces in UI, owner can reassign/provide input/cancel in `apps/api/src/routes/tasks.ts` + `apps/web/app/(office)/clock-tower/tasks/` (FR-018, CHK039)
- [x] T031 [US1] Integration test: scenario 1 end-to-end in mock mode (decomposition < 30s, correct specialists, timeline complete) in `apps/worker/src/orchestrator/doc.integration.test.ts`
- [x] T032 [US1] Loop-prevention unit tests: circular delegation refused + escalated, depth limit enforced in `apps/worker/src/orchestrator/loop-guards.test.ts` (FR-015)

## Phase 5: US3 — Shared Memory Vault (spec User Story 3)

**Goal**: agents store/retrieve attributed knowledge under write-permission rules. **Independent test**: quickstart scenario 3 (SC-004).

- [x] T033 [P] [US3] Memory service: scopes, categories, verification status, versioning, revocation, dedupe-hash, conflict surfacing in `packages/memory/src/service.ts`
- [x] T034 [P] [US3] Keyword search via Postgres FTS + `Embedder` interface with deterministic mock embedder over pgvector in `packages/memory/src/search.ts`, `packages/memory/src/embedder.ts`
- [x] T035 [US3] Write-permission enforcement per (agent, category) from registry + secret-shaped content rejection (token/key/password patterns, with audit on rejection) in `packages/memory/src/write-rules.ts` (FR-023/024, CHK022)
- [x] T036 [US3] Memory API routes per contracts/api.md in `apps/api/src/routes/memory.ts`
- [x] T037 [P] [US3] Memory Vault UI: search (keyword/semantic toggle), entry detail with attribution/status/versions/conflicts, revoke action in `apps/web/app/(office)/memory-vault/`
- [x] T038 [US3] Integration test: scenario 3 (agent A writes verified lesson → agent B retrieves with attribution; forbidden-category write refused + audited; revoked entry hidden but versioned; untrusted entry labeled) in `packages/memory/src/service.integration.test.ts`

## Phase 6: US2 — Human-in-the-loop approval (spec User Story 2)

**Goal**: default-deny policy engine + approval inbox; grants single-use and expiring. **Independent test**: quickstart scenario 4 (SC-005).

- [x] T039 [US2] Policy engine: closed critical-action category list (FR-030), default-deny evaluation keyed to acting agent identity (not DOC's) in `apps/api/src/policy/engine.ts` (CHK001, CHK015)
- [x] T040 [US2] Approval lifecycle: immutable requests (action, target, impact, risks, expiry), approve→mint single-use `ApprovalGrant` (capability type), reject, expire; consumption transactional with outbox record; includes the `agent_config_change` category consumed by PATCH `/agents/:id/config` (closes the T018 deferral) in `apps/api/src/policy/approvals.ts` (FR-032/033, CHK002–004)
- [x] T041 [P] [US2] Transactional outbox dispatcher in worker with idempotent delivery to (mock) executors in `apps/worker/src/outbox.ts`
- [x] T042 [P] [US2] Proposed-action flow for agents: runner emits proposals instead of executing critical categories; task → `awaiting_approval` in `apps/worker/src/runner/proposals.ts` (FR-031)
- [x] T043 [US2] Approval inbox UI in Clock Tower: pending list with expiry countdown, full detail, approve/reject with re-auth prompt in `apps/web/app/(office)/clock-tower/approvals/`
- [x] T044 [US2] Revalidation before execution: mock target snapshot and requester permissions are re-checked immediately before dispatch; mismatch halts, audits, and notifies the owner in `apps/worker/src/outbox.ts` (US2-AS4, CHK004–005)
- [x] T045 [US2] Integration test: scenario 6+7 (unapproved restricted action denied+audited; approved executes exactly once; reuse/expired refused; second identical request deduplicated) in `apps/api/src/policy/approvals.integration.test.ts`

## Phase 7: US4 — Durable office (spec User Story 4) + hardening

**Goal**: restart/failure safety proven; budgets visible; injection resistance tested. **Independent test**: quickstart scenarios 2, 5, 6 (SC-003, SC-008, SC-009).

- [x] T046 [US4] Failure-injection harness: kill MockProvider/worker/Redis mid-run at defined lifecycle points in `e2e/failure/harness.ts` (CHK040)
- [x] T047 [US4] Integration test: scenario 2 restart persistence (tasks/approvals/memory/audit identical after full restart; interrupted runs resume or cleanly fail; no duplicates) in `e2e/tests/restart.spec.ts`
- [ ] T048 [P] [US4] Untrusted-content handling: ingress tagging + delimiter rendering in prompt assembly in `packages/llm/src/prompt-assembly.ts` (FR-025, CHK009–010)
- [ ] T049 [US4] Adversarial fixture pack + test: hostile instructions in mock crawled content cannot change permissions, bypass approval, or elevate memory trust in `e2e/adversarial/injection.spec.ts` (SC-008, CHK011–012)
- [ ] T050 [P] [US4] Budget monitoring UI (per-agent consumption vs limits, mock numbers) in `apps/web/app/(office)/front-desk/budgets/page.tsx`; over-budget halt test in `apps/worker/src/runner/budgets.test.ts`
- [ ] T051 [P] [US4] Notifications center + audit history UI in `apps/web/app/(office)/clock-tower/audit/page.tsx` with dedupe-key display
- [ ] T052 [P] [US4] Minimal mock connector adapters implementing the shared adapter interface (read-only, health reporting) in `packages/connectors/src/mock/` + integrations health page in `apps/web/app/(office)/clock-tower/integrations/page.tsx` (FR-040)

## Phase 8: Polish & release gate

- [ ] T053 [P] Empty/zero-state designs for every dashboard surface in `apps/web/components/empty-states/` (CHK037)
- [ ] T054 [P] Contrast audit of retro tokens (4.5:1 text, 3:1 UI) + documented palette pairs in `apps/web/app/globals.css` (CHK034)
- [ ] T055 Full e2e sweep: SC-001 fresh-clone timing doc, all quickstart scenarios green, axe on all areas in `e2e/tests/release-gate.spec.ts`
- [ ] T056 Update README.md + specs/001-flux-88-platform/quickstart.md to match implemented commands; record Phase 1 demo script in `docs/demo-phase-1.md`
- [ ] T057 /speckit-converge run against spec.md [P1] requirements; append any gaps as new tasks before declaring Phase 1 done

## Dependencies

- Phase 2 blocks everything; T005 blocks T006–T015.
- US5 (T016–T021) needs only Phase 2 → first demoable slice.
- US1 (T022–T032) needs Phase 2; independent of US5 except shared shell (T015).
- US3 (T033–T038) needs Phase 2; independent of US1.
- US2 (T039–T045) needs US1's runner (T027) for proposal flow (T042).
- US4 (T046–T052) needs US1+US2+US3 complete.
- Phase 8 last.

## Parallel examples

- After T005: T007, T008, T012, T013, T014 in parallel.
- Within US1: T022, T023, T028, T029 in parallel before T024–T027 converge.
- US3 can proceed in parallel with US2 once Phase 2 + T027 are done (different packages).

## Implementation strategy

One PR per slice (per the owner's batching preference): Phase 2 foundational → US5 → US1 → US3 → US2 → US4+Polish. Each PR ends with its slice's integration/e2e tests green and a demoable state in mock mode. The owner merges each slice PR (org rule); /speckit-analyze consistency check precedes the first implementation PR.

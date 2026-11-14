# T055 release gate

Verified on 2026-11-15 against main commit `6111d4c3dbadecaf05a6d28daab230947a76bdf6`.

## Fresh clone to dashboard (SC-001)

On a macOS arm64 machine with Node 23.11.0, pnpm 10.18.3, Docker Desktop 4.91.0, a warm pnpm package store, and the Postgres/Redis images already cached, a shallow clone reached the authenticated dashboard with all 18 agents in **18.3 seconds**. The measurement started before `git clone` and ended after Playwright signed in, opened the agent directory, and confirmed all 18 seeded agent cards and the MOCK MODE banner. It includes dependency installation, isolated database startup, migration, seed, app startup, and the browser check. It does not represent a cold package or container image download.

The run used isolated Postgres and Redis containers on host ports 25488 and 26388, with web/API ports 23000 and 23001, to avoid touching other local services. The test used only generated local session credentials and the mock provider; no paid credentials were needed.

## Quickstart scenario results

| Scenario | Verification | Result |
|---|---|---|
| 1. Delegation | `apps/worker/src/orchestrator/doc.integration.test.ts`, `e2e/tests/release-gate.spec.ts` | Passed; mock DOC decomposition completed within the test's 30-second limit, and the browser showed three subtasks, dependency edges, live completion, and the handoff timeline. |
| 2. Restart persistence | `e2e/tests/restart.spec.ts` | Passed; persisted records matched and the interrupted run recovered once. |
| 3. Memory attribution | `packages/memory/src/service.integration.test.ts`, `e2e/tests/us3-memory-vault.spec.ts` | Passed. |
| 4. Approval flow | `apps/api/src/policy/approvals.integration.test.ts`, `e2e/tests/us2-approval-inbox.spec.ts` | Passed. |
| 5. Injection resistance | `e2e/adversarial/injection.spec.ts` | Passed. |
| 6. Failure injection | `e2e/tests/failure-harness.spec.ts` | Passed; provider, worker, Redis, and Postgres failure checks passed. |
| 7. Accessibility | `e2e/tests/release-gate.spec.ts` plus the existing dashboard, memory, and approval UI tests | Passed; axe ran on the login screen, all nine area pages, and eight operational dashboard routes. |

Local verification also passed: `pnpm typecheck`, `pnpm build`, `pnpm test` (71 tests), `pnpm -r --workspace-concurrency=1 --if-present test:integration` (85 tests), 14 dashboard Playwright tests, and four failure/restart/injection Playwright tests.

The scenario behavior is green. The command examples in `specs/001-flux-88-platform/quickstart.md` still include aliases that are not currently defined at the repository root; T056 tracks aligning that guide with the commands that exist.

## CI coverage

CI runs the existing failure/restart/injection harnesses, starts the office stack, waits for the web-proxied API health endpoint, then runs the approval, memory, dashboard, and release-gate Playwright suites with Chromium and axe.

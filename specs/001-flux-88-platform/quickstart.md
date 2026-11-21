# Quickstart and validation guide: FLUX-88

This guide covers the mock-first default and opt-in Claude provider. External connectors remain mocked; a live model call does not give agents live external-action tools. Planned behavior is labeled; passing a focused test does not mean every user flow is complete.

## Requirements

- Node.js 22 or newer
- pnpm 10.18.3
- Docker with Compose
- No paid credentials for the default mock mode

The local Compose services use Postgres on port `5488` and Redis on port `6388`. The web app uses `3000`; the API uses `3001`. Use a disposable local database for the demo. Integration tests truncate mutable tables in the database named by `DATABASE_URL`.

## Start a fresh local demo

Run these commands from a POSIX shell:

```sh
git clone https://github.com/joshuel09/Project-FLUX-88-Your-Retro-AI-Office.git
cd Project-FLUX-88-Your-Retro-AI-Office
cp env.example .env
set -a
. ./.env
set +a
pnpm install --frozen-lockfile
pnpm db:up
pnpm --filter @flux88/db db:migrate
pnpm --filter @flux88/db db:provision-worker-role
pnpm --filter @flux88/db db:seed
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). On first run, the login form creates the single owner account when you submit an email and a password of at least 12 characters. Use a password you choose; test passwords shown in automated tests are not demo credentials. The seeded database has 18 agent profiles, budgets, mock GitHub/Discord/Trello connector accounts, and two simulated sample tasks. The banner says **MOCK MODE — simulated activity only**.

The API and worker use process environment variables plus defaults from `packages/config`; they do not load `.env` themselves. The commands above export the copied values into the shell. Export any custom values before starting the stack. Do not use the sample session secret outside a local demo.

## Optional Claude execution

Mock mode stays enabled by default and needs no paid credentials. To use Claude, edit your local `.env` and set:

```dotenv
MOCK_LLM=false
ANTHROPIC_API_KEY=your-private-key
ANTHROPIC_MODEL=your-enabled-model-id
ANTHROPIC_INPUT_COST_CENTS_PER_MILLION=your-model-input-rate
ANTHROPIC_OUTPUT_COST_CENTS_PER_MILLION=your-model-output-rate
```

The rates are cents per million tokens for the selected model. The runner records an estimate rounded up to whole cents. Source `.env` into the shell as shown above and restart `pnpm dev`; both API and worker use the selected mode. Do not commit `.env` or put a real key in command history, logs, tests, or memory. SDK retries are disabled so the durable worker's bounded retry policy remains authoritative. CI uses a fake HTTP response and never needs a live Claude credential.

## Phase 1 demo

Use [`docs/demo-phase-1.md`](../../docs/demo-phase-1.md) for the short presenter script. It demonstrates the configured agents, mock delegation, dependency view, memory attribution, and mock connector status. The default demo does not call a live LLM or external connector.

## Implemented scenario checks

| Scenario | What is verified | Where to run it |
|---|---|---|
| 1. Delegation | DOC decomposes the tested owner goal into three specialist subtasks; the browser shows live completion, dependency edges, and a handoff timeline. Runs through the mock provider. | `apps/worker/src/orchestrator/doc.integration.test.ts`; `pnpm --dir e2e exec playwright test tests/release-gate.spec.ts` |
| Phase 2 provider | Claude request/response mapping, explicit usage-cost rates, no SDK retry, configured provider selection, and bounded worker retry with a fake Claude response. | `pnpm --filter @flux88/llm test`; `pnpm --filter @flux88/config test`; `pnpm --filter @flux88/worker exec vitest run src/runner/claude.integration.test.ts` |
| 2. Restart recovery | A disposable harness writes task, run, approval, grant, memory, outbox, and audit fixtures, restarts Postgres and Redis, checks persisted records, then verifies one interrupted worker run recovers. It does not restart or inspect the demo database. | `pnpm --dir e2e exec playwright test tests/restart.spec.ts --workers=1` |
| 3. Memory attribution | Service tests check agent attribution and write rules; the worker test checks policy-scoped retrieval, untrusted prompt framing, and validated agent writes. The browser test saves owner knowledge, searches, inspects verification status, and revokes the entry. | `packages/memory/src/service.integration.test.ts`, `apps/worker/src/runner/memory.integration.test.ts`; `pnpm --dir e2e exec playwright test tests/us3-memory-vault.spec.ts` |
| 4. Approval lifecycle | API integration tests cover owner reauthentication, immutable decisions, expiry, one-time grants, and audit records. The approval inbox browser test uses a stubbed API fixture; a full browser-to-worker approval journey is not verified by that test. | `apps/api/src/policy/approvals.integration.test.ts`; `pnpm --dir e2e exec playwright test tests/us2-approval-inbox.spec.ts` |
| 5. Injection resistance | Adversarial fixtures remain tagged as untrusted; forged permissions and approval grants are refused; connector content cannot be written as verified memory. | `pnpm --dir e2e exec playwright test adversarial/injection.spec.ts --workers=1` |
| 6. Failure handling | Disposable harness checks provider failure, worker termination, Redis and Postgres restart. These are local injected failures, not live-provider outages. | `pnpm --dir e2e exec playwright test tests/failure-harness.spec.ts --workers=1` |
| 7. Accessibility | axe checks login, all nine office areas, and eight operational routes; dashboard, memory, and approval UI suites add coverage. | `pnpm --dir e2e exec playwright test tests/release-gate.spec.ts tests/us5-dashboard.spec.ts tests/us3-memory-vault.spec.ts tests/us2-approval-inbox.spec.ts` |

All scenario commands are covered in CI. Browser suites require Chromium; tests that use the app need a running app stack. The restart, injection, and failure harnesses create their own temporary services.

## Commands that exist in this repository

Run from the repository root unless `--dir e2e` is shown.

| Command | Purpose |
|---|---|
| `pnpm db:up` / `pnpm db:down` | Start / stop Postgres and Redis Compose services |
| `pnpm --filter @flux88/db db:migrate` | Apply database migrations |
| `pnpm --filter @flux88/db db:provision-worker-role` | Create the restricted worker login from `WORKER_DATABASE_URL` using `DATABASE_URL` as the admin connection; run after migrations |
| `pnpm --filter @flux88/db db:seed` | Seed agent profiles, budgets, mock connectors, and sample tasks |
| `pnpm dev` / `pnpm build` | Run / build workspace apps |
| `pnpm typecheck` / `pnpm test` | Run workspace type checks / unit tests |
| `pnpm -r --workspace-concurrency=1 --if-present test:integration` | Run workspace integration tests against `DATABASE_URL`; use a disposable database |
| `pnpm --dir e2e exec playwright install chromium` | Install the browser needed by Playwright |
| `pnpm --dir e2e exec playwright test tests/release-gate.spec.ts` | Run the release-gate browser suite; start the app first |

There is no root `pnpm db:migrate`, `pnpm db:seed`, `pnpm test:e2e`, `pnpm test:integration`, `pnpm db:reset`, or `pnpm lint` script today. Use the commands in the table and each package's scripts.

## SC-001 timing

The release sweep measured **18.3 seconds** from a shallow clone to an authenticated dashboard showing all 18 agents on macOS arm64 with a warm pnpm store and cached Docker images. This passes the SC-001 target of under 15 minutes in that setup; it is not a cold-download estimate. See [`docs/release-gate.md`](../../docs/release-gate.md) for the machine, method, and limits.

## Further reading

- [Technical plan](plan.md)
- [Data model](data-model.md)
- [API contract](contracts/api.md)
- [Agent registry](agents.md)
- [Agent memory runtime](../../docs/agent-memory-runtime.md)
- [Phase 1 demo script](../../docs/demo-phase-1.md)
- [Release gate evidence](../../docs/release-gate.md)

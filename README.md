# Project FLUX-88 — Your Retro AI Office

FLUX-88 is a self-hosted, single-owner AI office with a retro dashboard. It is built as a spec-driven pnpm monorepo. See the [platform specification](specs/001-flux-88-platform/) and [technical plan](specs/001-flux-88-platform/plan.md).

## Status

Phase 1 is a **mock-first implementation in progress**. The repository includes a dashboard with nine office areas, 18 configured agent profiles, DOC task delegation, a Memory Vault, an owner approval inbox, and mock connector health. The default worker uses a mock LLM provider, and the GitHub, Discord, and Trello connectors use mock data. This is not a live autonomous office: live model and external-service adapters are not part of the current implementation.

See the [release gate](docs/release-gate.md) for verified scenarios and limits, and the [Phase 1 demo script](docs/demo-phase-1.md) for a guided walkthrough.

## Run locally

Requirements: Node.js 22+, pnpm 10.18.3, Docker with Compose, and a POSIX shell. No paid credentials are needed for the mock-first demo.

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
pnpm --filter @flux88/db db:seed
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). On first run, enter your email and a password with at least 12 characters; that creates the single owner account. The seed adds the 18 agent profiles, budgets, mock connectors, and sample tasks. The default service ports are web `3000`, API `3001`, Postgres `5488`, and Redis `6388`.

`env.example` lists the local defaults. API and worker read process environment variables and built-in defaults; copying a `.env` file alone does not load overrides into those processes. The commands above export the file values in the shell before startup. Generate a new `SESSION_SECRET` and review all settings before exposing a deployment beyond local demo use. Do not add real credentials to the repository.

Stop the app with `Ctrl+C`; stop the database services with `pnpm db:down`. Compose keeps its named data volumes unless you remove them separately.

## Checks

```sh
pnpm typecheck
pnpm build
pnpm test
```

Integration tests use the database in `DATABASE_URL` and clear mutable test tables. Point them at a disposable database, not a database with data you need to keep:

```sh
pnpm -r --workspace-concurrency=1 --if-present test:integration
```

Browser tests need the app stack running. Install Chromium and run the release gate with:

```sh
pnpm --dir e2e exec playwright install chromium
pnpm --dir e2e exec playwright test tests/us2-approval-inbox.spec.ts tests/us3-memory-vault.spec.ts tests/us5-dashboard.spec.ts tests/release-gate.spec.ts
```

The complete browser and failure-harness commands, scenario scope, and limits are in the [quickstart guide](specs/001-flux-88-platform/quickstart.md). CI runs those checks on pull requests and pushes to `main`.

## Repository layout

- `apps/web` — Next.js dashboard
- `apps/api` — Hono API, owner sessions, policy and approvals
- `apps/worker` — task orchestration and mock agent runs
- `packages/` — shared core, database, agent profiles, memory, LLM, connector and config code
- `specs/001-flux-88-platform` — product spec, architecture plan, data model and tasks
- `docs/` — implementation notes and demo guides

## Development flow

Start work with a GitHub issue, use a feature branch, and send changes through a pull request that closes the issue. Keep `main` protected; do not commit directly to it.

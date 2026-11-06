# Project FLUX-88 — Your Retro AI Office

A retro-styled AI office project. Development follows a spec-driven workflow powered by [spec-kit](https://github.com/github/spec-kit).

## Status

🚧 Phase 0 — specification merged, monorepo scaffold in place. The Phase 1 MVP
(dashboard, 18 agents, task orchestration, Memory Vault, approvals) is specified in
[`specs/001-flux-88-platform/`](specs/001-flux-88-platform/).

## Local development

```sh
cp env.example .env                 # mock-first defaults, zero paid credentials
pnpm install                        # Node 22+, pnpm 10 (corepack)
pnpm db:up                          # PostgreSQL 17 + pgvector, Redis 7 (Docker)
pnpm dev                            # web :3000, api :3001, worker
```

Gates: `pnpm typecheck && pnpm build && pnpm test` (also run in CI).

Layout: `apps/` (web = Next.js dashboard, api = Hono + policy engine, worker =
orchestration) and `packages/` (core, db, agents, memory, llm, connectors, config).
See [`specs/001-flux-88-platform/plan.md`](specs/001-flux-88-platform/plan.md) for
architecture and module boundaries.

## Development workflow

1. Every task starts as a GitHub issue.
2. Work happens on a feature branch (`feature/issue-N-...`).
3. Changes land on `main` only through a pull request (`Closes #N`).
4. `main` is protected: PR required, no force pushes, no deletions.

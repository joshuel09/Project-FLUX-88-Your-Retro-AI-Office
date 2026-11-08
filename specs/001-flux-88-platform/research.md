# Research & Decisions: FLUX-88

**Date**: 2026-11-06 · All Technical Context unknowns resolved; no NEEDS CLARIFICATION remain.

## D1. Monorepo tooling

- **Decision**: pnpm workspaces, no Nx/Turborepo at P0–P1.
- **Rationale**: Three apps + seven packages is small; pnpm gives workspace linking
  and fast installs without extra
  build-graph tooling. Turborepo can be added later for caching without restructuring.
- **Alternatives**: Turborepo (adds config now, value later), Nx (heavy for single-user
  project), npm/yarn workspaces (less aligned with the selected workspace tooling).

## D2. HTTP API framework

- **Decision**: Hono with zod validation (`@hono/zod-validator`), deployed as a Node
  process.
- **Rationale**: Brief prefers Hono; typed routes, tiny footprint, first-class middleware
  for auth/CSRF/audit; RPC-style client typing for the Next.js app.
- **Alternatives**: Next.js API routes only (couples policy engine to frontend deploys,
  weakens the security boundary), Fastify (fine, but Hono's typed client is better here),
  tRPC (ties contract to TS consumers; REST+SSE is more inspectable/auditable).

## D3. Persistence & ORM

- **Decision**: PostgreSQL 17 + Drizzle ORM; migrations via drizzle-kit; pgvector
  extension installed from day one.
- **Rationale**: Single durable store satisfies Principle III; Drizzle is SQL-first,
  parameterized by construction (constitution SQL rule) and generates types from schema.
- **Alternatives**: Prisma (heavier runtime, slower cold paths), Kysely (query builder
  only, no migration story we prefer).

## D4. Background jobs & orchestration

- **Decision**: Redis 7 + BullMQ in a dedicated worker app; task truth lives in Postgres,
  queues carry only job references + idempotency keys; startup reconciliation re-enqueues
  in-flight work from Postgres.
- **Rationale**: Brief prefers BullMQ; mature retries/backoff/concurrency. Treating Redis
  as disposable keeps Principle III honest.
- **Alternatives**: pg-boss (Postgres-only queues — attractive, fewer moving parts, but
  weaker rate-limit/concurrency ergonomics; revisit if Redis proves annoying), Temporal
  (overkill for single-user; operational burden).

## D5. Semantic retrieval (Open Decision 3 default)

- **Decision**: pgvector wired in P1 with a deterministic local mock embedder; real
  embeddings (Claude-compatible or local model) in P2 behind `packages/memory`'s
  `Embedder` interface. Keyword search (Postgres FTS) is the P1 guarantee.
- **Rationale**: Keeps SC-001 (no paid credentials) while avoiding a P2 schema migration.
- **Alternatives**: External vector DB (Qdrant/Weaviate — extra service, unneeded scale),
  keyword-only MVP (would make memory UX regress when vectors arrive).

## D6. LLM provider abstraction

- **Decision**: `packages/llm` exposes `LLMProvider` (complete/stream + token usage);
  adapters: `ClaudeProvider` (`@anthropic-ai/sdk`, default `claude-sonnet-5-5`, opt-in
  `claude-opus-5-5` per agent budget) and `MockProvider` (deterministic, scenario-scripted
  for tests/demo).
- **Rationale**: Brief requires Claude-first with room for others; mock-first satisfies
  Principle V and SC-001.
- **Alternatives**: Vercel AI SDK (nice streaming helpers but another abstraction layer
  over the abstraction we must own anyway), LiteLLM proxy (extra service).

## D7. Connector architecture

- **Decision**: Each connector is `packages/connectors/<provider>` implementing a shared
  adapter interface with: read methods (scope-checked), write methods that **require an
  `ApprovalGrant` argument**, a `MockProvider` twin, origin-marking to break sync loops,
  rate-limit + dedupe helpers shared via a common base.
- **Rationale**: Capability-style grants make "write without approval" unrepresentable;
  mock twins keep local dev credential-free (FR-040).
- **Alternatives**: Generic webhook bus (too abstract for 3 providers), n8n-style external
  automation (violates auditability and policy enforcement).

## D8. Owner authentication (Open Decision 2 default)

- **Decision**: Single-owner email+password with Argon2id, lockout after 5 failures,
  generic error text, session re-issue on login, CSRF tokens on mutations — all per
  constitution. GitHub OAuth optional in P3+.
- **Alternatives**: OAuth-only (depends on external availability for a self-hosted tool),
  passkeys (nice-to-have later).

## D9. UI stack & theming

- **Decision**: Tailwind CSS v4 + shadcn/ui (Radix primitives); theme tokens on `:root`
  with light/dark; retro effects (CRT/scanlines/glow) as opt-in CSS layers disabled under
  `prefers-reduced-motion` and a manual toggle; original pixel-accent assets only.
- **Rationale**: Brief preference; Radix gives the accessibility baseline (Principle X).
- **Alternatives**: Custom component library (slower, re-solves a11y), Mantine/MUI (fights
  the retro aesthetic).

## D10. Testing strategy

- **Decision**: Vitest for unit/integration (integration against dockerized Postgres+Redis),
  Playwright for e2e incl. axe accessibility checks; a failure-injection harness that kills
  providers/queues mid-run for scenarios 2 and 9; adversarial prompt-injection fixture pack
  for scenario 8.
- **Alternatives**: Jest (slower TS story), Cypress (Playwright preferred for tracing).

## D11. Real-time dashboard updates

- **Decision**: Server-Sent Events from the API (task/approval/audit streams), falling back
  to polling; no WebSocket server in P1.
- **Rationale**: One-directional updates fit SSE; simpler auth story over cookies.
- **Alternatives**: WebSockets (needed only if the dashboard later sends high-frequency
  interactions), Postgres LISTEN/NOTIFY directly to web (couples web to DB).

## D12. Audit trail shape

- **Decision**: Single append-only `audit_events` table (actor type+id, action, target
  type+id, payload JSONB, created_at); no UPDATE/DELETE grants for app roles; monthly
  partitioning deferred until needed.
- **Alternatives**: Event-sourcing everything (attractive but doubles P1 scope; the task
  state machine stays CRUD + audit).

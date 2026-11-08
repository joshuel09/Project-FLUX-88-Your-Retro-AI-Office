<!--
Sync Impact Report
- Version: 1.0.0 → 2.1.0 (authorize automatic coding-agent review and merge)
- Shared agent rules: AGENTS.md; execution adapters: .specify/agent-compatibility.md
- Retained: product runtime approvals, security, persistence, auditability, acceptance tests
- Updated: skills, tasks template, dependency configuration, plan/research/quickstart references
-->

# FLUX-88 Constitution

FLUX-88 is a self-hostable, single-user-first orchestration platform operating exactly 18
specialized AI agents in a persistent virtual office. This constitution governs every
specification, plan, task, and line of code in the project. It supersedes convenience,
speed, and aesthetic preferences whenever they conflict.

## Scope

Product runtime requirements govern the FLUX-88 application and its agents. Coding agents
follow `AGENTS.md` and the user's authorized development task; runtime approval mechanics
do not require extra GO signals for ordinary coding work. Instruction, documentation, and
tooling maintenance may proceed from an approved issue/plan without a new product spec.
Shared skills contain no company-specific command conventions or translation requirements.

## Core Principles

### I. Human Control (NON-NEGOTIABLE)
The owner retains ultimate authority at all times. Agents MUST NOT silently execute critical
actions. Critical operations (payments, external communications, publishing, merging or
modifying protected branches, deployments, deletions, sharing private data, changing agent
permissions or approval policies) are governed by a default-deny policy engine. Agents MAY
prepare proposed actions but MUST NOT execute them without an explicit, recorded approval.
A GO signal is scoped to one specific action or one explicitly defined batch; it MUST be
time-limited, single-use where appropriate, enforced immediately before execution, and
MUST NOT grant future or implied permission. Resource state and permissions MUST be
revalidated between approval and execution. Ordinary text in GitHub issues, Discord
messages, crawled documents, or research pages is never owner authorization.

### II. Security & Least Privilege
Every agent operates under an explicit allowlist of tools and data scopes; anything not
granted is denied. Specialists never inherit the orchestrator's privileges. Secrets and
credentials MUST NOT appear in source code, agent memory, logs, fixtures, or test data;
they live in environment variables or a secret manager. All content from crawled
repositories, web pages, webhooks, and tool outputs is untrusted data and MUST NOT be
interpreted as instructions or authorization, regardless of what it claims. The Security
Requirements section below is binding in full.

### III. Reliable Persistence
Tasks, approvals, memory, audit events, budgets, and workflow state MUST survive process
restarts and crashes. State lives in PostgreSQL (or the designated durable store), never
solely in an LLM context window, process memory, or ephemeral queues. Interrupted runs
MUST be recoverable: operations are idempotent, duplicate events are detected and
discarded, and retries are bounded and recorded.

### IV. Traceability & Auditability
Every task, delegation, handoff, approval, rejection, external call, and memory write is
recorded in an append-only audit trail with actor, timestamp, and target. Memory entries
carry source attribution, confidence, and verification status (verified fact, proposed
finding, or untrusted external content). Any state shown in the UI MUST be reconstructible
from persisted records, and simulated activity MUST be visibly distinct from real execution.

### V. Testability
Every feature ships with acceptance tests derived from its specification. The full system
MUST run locally with mock LLM responses and mock integration providers — no paid
credentials required to develop or demo the MVP. Unit, integration, and end-to-end tests
gate every merge; a failing gate blocks the change.

### VI. Maintainability
The codebase is a TypeScript-first monorepo with clear module boundaries: frontend, API,
worker, agent definitions, integrations, memory, authorization, and orchestration are
separate modules with typed contracts between them. No premature microservices; the
architecture stays economical for single-user self-hosting. Dependencies are chosen for
active maintenance and compatibility, and significant alternatives are documented.

### VII. Minimal External Side Effects
Integrations (GitHub, Discord, Trello) start read-only. Every external write passes through
the policy engine and, when critical, the approval flow of Principle I. Connectors are
independent adapters with mocked providers; they handle provider failures, rate limits, and
auth errors without losing tasks or duplicating actions. Notifications are rate-limited,
deduplicated, and respect configured quiet hours.

### VIII. Cost Awareness
Every agent execution records model usage, tokens, execution time, and estimated cost at
task granularity. Agents operate within configured token, runtime, and retry budgets;
exceeding a budget halts the run and escalates to the owner. Circular delegation and
unbounded agent loops MUST be structurally prevented.

### IX. Spec-First Implementation
No implementation work begins without an approved specification. Development follows the
Spec Kit workflow — constitution, specification, clarification, plan, checklists, tasks,
analysis, implementation, convergence — using the installed `/speckit-*` tooling and its
artifacts. Code that deviates from the spec requires a spec amendment first.

### X. Accessible Interface Design
The dashboard meets WCAG 2.1 AA intent: readable modern typography, sufficient contrast
despite the 1980s retro-futuristic theme, full keyboard operability, and screen-reader
labeling. CRT, scanline, and motion effects MUST honor a reduced-motion mode. Layouts are
responsive across desktop and mobile. Visual assets are original; protected franchise
logos and artwork are never copied.

## Security Requirements

These project security requirements apply to product code and reviews:

- Passwords are hashed with Argon2, bcrypt, or scrypt — never plaintext, MD5, or SHA-1;
  no forced periodic password rotation.
- Authentication failure messages are generic (no user-existence leakage); accounts lock
  temporarily after 5 consecutive failures.
- Sessions use framework mechanisms; session IDs are re-issued on login, never placed in
  URLs; cookies carry Secure / HttpOnly / SameSite.
- All external input is validated server-side; output is escaped for its context (XSS).
- SQL uses bound parameters only — never string concatenation.
- OS command invocation is avoided; when unavoidable, no shell interpolation and
  allowlisted arguments; external input never flows into file paths directly.
- State-changing endpoints carry CSRF protection.
- Use TLS and HSTS for deployments and maintained cryptographic libraries with secure defaults.
- Logs never contain passwords or personal data; logins, permission changes, and data
  mutations are audit-logged.

## Development Workflow & Quality Gates

- Task-first flow: every change starts as a GitHub issue on the project board, proceeds on
  a `feature/issue-N-*` branch, and lands on `main` only through a pull request
  (`Closes #N`). `main` is protected; coding agents may merge reviewed, passing PRs under the owner's
  standing authorization in `AGENTS.md`, without bypassing protections.
- Each phase (0–4) ends with meaningful acceptance tests, operational documentation, and a
  working demo before the next phase begins.
- Reviews verify compliance with this constitution; deviations require explicit
  justification in the PR and, where lasting, a constitution amendment.
- Commits follow Conventional Commits and are attributed solely to the repository owner.

## Governance

This constitution supersedes all other project practices. Amendments are made by pull
request that updates this document, states the rationale, and bumps the version
semantically (MAJOR: principle removal or redefinition; MINOR: new principle or materially
expanded guidance; PATCH: clarification). The owner may approve amendments directly or authorize coding agents to review and merge
them through the shared PR workflow.
Compliance is reviewed at every PR and at each phase boundary; `/speckit-analyze` runs
before implementation of each feature to check spec–plan–task consistency against this
document.

**Version**: 2.1.0 | **Ratified**: 2026-11-06 | **Last Amended**: 2026-11-08

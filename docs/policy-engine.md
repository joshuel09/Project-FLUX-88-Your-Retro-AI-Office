# Critical-action policy engine (T039)

`apps/api/src/policy/engine.ts` implements FR-030 and the acting-agent boundary in
CHK015. The critical categories come from the existing database approval-action enum;
no schema migration is needed. Server-owned definitions associate operations with exact
tool and data-scope grants. Unknown operations and wildcard grants do not authorize work.

`evaluatePolicy` is a pure decision function. Its subject is trusted server state, kept
separate from the untrusted action request. The request accepts only an operation name;
extra actor, scope, policy, approval, or grant fields are rejected. Prohibitions using
exact operation/tool identifiers are honored. Human-readable policy descriptions are
not executable rules and cannot grant permissions. Presentation fields are ignored.

Server callers use `evaluateAndAuditPolicy` with the authenticated acting agent's ID.
It reloads that agent's persisted configuration and enabled state for each evaluation;
DOC's identity or permissions must never be substituted for a specialist's identity.
Decisions are audited under the actual actor. Invalid raw identifiers and request
contents are omitted from audits so rejected input cannot leak secrets into logs.
Database and audit failures propagate; callers must not interpret an exception as allow.

This slice permits only explicitly modeled, target-independent `agents.read` and
`repo.read` operations when the actor holds both grants. Ownership/project-sensitive
operations remain unmodeled and denied. All critical operations are denied, including
when tool and scope grants exist and `approvalRequired` is empty. This module does not
execute tools, expose an HTTP route, mint approval grants, or consume capabilities.

T040 adds the immutable approval lifecycle and transactional capability consumption;
T041–T044 add proposals, outbox delivery, and execution-time revalidation. An allowed
read decision here is not a reusable capability, and no `approved: true` field or text
can authorize critical execution. Existing policy-changing config routes remain denied
until the approval layer is implemented.

Run policy unit tests with `pnpm --filter @flux88/api test`. Run API integration tests
against a separately migrated and seeded database via `DATABASE_URL` and
`pnpm --filter @flux88/api test:integration`; the suite includes existing auth tests
which require all 18 seeded agents. Do not run tests against the development database.

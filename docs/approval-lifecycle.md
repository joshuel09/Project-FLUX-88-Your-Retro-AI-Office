# Approval lifecycle (T040)

Proposals are immutable and deduplicated by a canonical fingerprint of requester,
exact action, target, impact, risks, expiry, and optional task/batch. Owners and agents
are recorded separately; owner administration never borrows an agent's identity.
Expiry is 1 minute–24 hours for new requests, with a 15-minute default for config changes.
All categories and batches consume once for the whole explicitly described payload.

Owner decisions require a current authenticated session and password verification.
Verification issues an opaque in-process authorization valid for 60 seconds and one
attempt. Session revocation, password changes, lockout, and stale verification prevent
decisions. Five incorrect passwords lock reauthentication for 15 minutes. Approval mints
one persistent grant; concurrent retries return that grant, never another capability.
Pending requests may become rejected or expired; completed decisions cannot be rewritten.
Approved requests retain decision history when their unused grant expires.

Only API-side services consume grants. HTTP has no grant-consume endpoint. Runtime
capabilities are frozen branded objects registered by the module; JSON-shaped objects
are not accepted. Server-only rehydration restores a handle from persistent state after
a restart. Consumption locks request and grant, rechecks status, expiry, exact binding,
and the actual requesting agent's current permissions. Grants cannot override those
permissions. Denials are audited; database/audit errors never mean success.

Consumption, outbox insertion, domain audit, and any local configuration mutation commit
in one transaction. Unique indexes enforce one grant per request and one outbox record
per grant. Database triggers protect immutable proposals/decisions/grants/outbox actions;
the worker role cannot mint/consume grants or insert outbox actions. Queued actions use
the transactional mock dispatcher (T041); no external adapter is invoked. Local agent configuration
changes are applied at consumption and their outbox records marked dispatched, so a
future worker must not apply them again. Outbox payloads carry requester, exact action,
target, expiry, and request ID for future execution-time revalidation (T044).

For configuration changes: PATCH a policy field (or enabled state) to create a proposal;
approve its ID with the owner password; repeat the exact patch with approvalGrantId.
The full target configuration, enabled/presentation state, and update timestamp are
hashed at proposal time and rechecked under lock. A mismatch or missing target refuses
consumption without spending the grant. Updated policy and persisted budget limits stay
in sync. Old UI presentation-only patches remain supported.

The schema migration adds owner provenance, rejection reasons, uniqueness constraints,
and guards. It does not silently merge conflicting historical approvals; duplicate
historical dedupe keys/grant deliveries must be resolved before applying its indexes.
Request immutability preserves associated task IDs; deletion paths must honor that history.

Validation: policy unit tests plus lifecycle/concurrency/expiry/rollback/HTTP tests in
apps/api/src/policy. API integration files run sequentially because auth fixtures reset
shared tables; concurrent behavior is exercised inside individual tests. Use a separately
migrated and seeded DATABASE_URL. Full worker tests must use isolated Redis, not dev queues.
The inbox UI, runner proposals and full execution-time target/permission revalidation remain T042–T044.


## Mock outbox delivery (T041)

The worker polls PostgreSQL immediately on startup and every second, processing at most
25 ready records per batch. No Redis job is required to rediscover a pending delivery.
Concurrent pollers use `FOR UPDATE SKIP LOCKED`. Each dispatch transaction runs as
`flux88_worker` via `SET LOCAL ROLE`; the connection must be allowed to assume that
migration-created role. Approval tables remain SELECT-only. This restriction applies to
the outbox transaction, not the other existing task-worker connections.

Only `mock` records with an exact immutable approved-request/consumed-grant binding,
matching operation and idempotency key, an unexpired approval, an unchanged mock target
snapshot, and unchanged requesting-agent policy can execute. Invalid, expired,
live-connector, or pending agent-configuration deliveries halt with an audit record.
Already dispatched local configuration records are never selected or reapplied. This
mock-only slice must not be used as a live connector delivery gate.

The mock executor writes a visibly simulated `outbox.mock_executed` audit receipt.
That receipt, dispatched status and delivery audit commit atomically. An exception or
crash before commit leaves no mock effect; retry/restart therefore cannot duplicate a
committed mock action. This does not establish exactly-once network delivery. Real
adapters will need provider idempotency/reconciliation and provider-specific target-state
revalidation before any live delivery is enabled.

Executor failures roll back the attempt's database writes to a savepoint and persist a
sanitized failure audit plus attempt count. Three attempts are allowed, with persisted
1-second then 2-second backoff; the final failure is terminal. Infrastructure or final
audit failures roll back the whole transaction and are retried on a later poll. Raw
errors and action payloads are not logged. Shutdown stops scheduling and drains the
current batch. No API to automatically reset terminal deliveries is added here.

Acceptance coverage: `apps/worker/src/outbox.integration.test.ts` exercises concurrent
polling, replay through a fresh connection, partial-effect rollback, durable retry limits,
expired/live/configuration refusal, worker privilege restrictions, final-audit rollback,
and poller startup/shutdown. Worker integration files run sequentially to avoid the
existing orchestration suite's table-reset fixture racing against outbox fixtures.

## Mock target and permission revalidation (T044)

At approval-request creation, the API looks for exactly one matching
`connector_accounts.config.mockTargets[targetResource]` value across connector accounts
and stores its canonical SHA-256 as immutable `approval_requests.target_state_hash`.
Missing or ambiguous target state stores no hash and is not executable. Immediately
before the mock receipt, the worker re-reads that state and compares its hash with the
request snapshot, checks the complete immutable request/outbox binding, expiry, and
consumed grant, and compares the requester agent's current enabled flag and
`policyConfigSchema` fields with the permission hash stored in the immutable outbox row.
Presentation fields such as personality do not affect the policy hash.

Any missing, changed, expired, or mismatched state sets the outbox row to
`halted_revalidation`, writes an `outbox.halted_revalidation` audit event, and adds one
deduplicated dashboard notification. No mock effect runs. This covers mutable mock target
state only; current external GitHub/Discord/Trello resource state cannot be queried until
provider adapters exist, and live connectors remain refused.

## T042 agent proposals

A provider may return an untrusted `proposedAction` object. The runner validates it against
the shared bounded critical-action schema and rejects secret-shaped fields before storing
it. It does not parse prose, select an actor, approve the request, mint a grant or execute
a tool. A valid proposal and its task `awaiting_approval` transition, usage and run status
commit atomically to the PostgreSQL proposal inbox. The worker role may SELECT/INSERT this
inbox, but remains SELECT-only on approval requests/grants and cannot insert outbox rows.

The API polls durable pending inbox rows at startup and every second. It confirms the run
succeeded, the same assigned specialist is still enabled, and the task still awaits review.
The API derives requester and task IDs from persisted run/task rows, validates again, then
creates a pending immutable approval with a 15-minute expiry and updates the inbox in one
transaction. The unique run ID, row lock and approval dedupe key make redelivery idempotent.
Invalid, stale, disabled-agent or changed-context records are rejected and waiting tasks
move to the audited blocked state. A database/audit error rolls back both inbox acceptance
and the approval. Owner approval/rejection UX remains T043; T042 does not create a grant or
outbox action and does not perform external effects.

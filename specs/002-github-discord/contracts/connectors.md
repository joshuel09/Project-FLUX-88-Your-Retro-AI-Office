# GitHub and Discord Connector Contracts

## Shared rules

- All adapters are server-side, typed, injectable, and have deterministic mock twins.
- Read calls return normalized data with source IDs, canonical URLs, timestamps, and provenance marked `untrusted` where content originates externally.
- Provider failures distinguish authentication, permission, rate limit, timeout, and transient errors without returning secret values.
- Direct remote write operations are excluded from read-only adapters. A separate GitHub write adapter accepts only the exact approval-bound outbox action and is invoked only by the existing grant-bound outbox.

## GitHub feedback read contract

Input: configured repository allowlist, requested read resource (repository, commit, pull request, issue, comment, or review feedback), persisted cursor/ETag, bounded page size, and abort/deadline signal.

Output: normalized requested resource. Feedback includes `externalId`, repository, PR/issue number, author, bounded body excerpt, source URL, created/updated timestamps, and untrusted provenance; all resources include stable provider IDs and canonical URLs where available. Return next cursor and rate-limit metadata.

Behavior: fetch only allowlisted repositories; bound pages and body size; honor conditional requests and provider retry/reset guidance; never assign a task in the adapter. A service maps feedback only through a persisted `external_links` record.

## GitHub approved write contract

The GitHub comment writer accepts an outbox action containing the exact repository, pull request, comment body, approval request, and single-use grant binding. It exposes no general-purpose write method to agents or the read-only sync service. Revalidate the target and current grant immediately before delivery; reject altered or expired actions.

## Discord send contract

Input: configured guild/channel/user destination, bounded message text, idempotency key, and deadline.

Output: provider message ID and sent timestamp or a typed error. The caller owns durable dedupe and quiet-hours scheduling. Mentions are disabled unless a specific configured owner identity is used.

## Discord interaction contract

Input: exact raw body and security headers. Verify request signature and freshness (reject timestamps more than five minutes from server time) before parsing JSON. Then persist the unique interaction ID and accept only configured command names, guild/channel, and owner user ID. Approval actions must reference an existing approval request and invoke the existing approval service; they cannot mint grants directly.

# Phase 3 Research

## D1. GitHub synchronization

- **Decision**: Begin with bounded read-only polling, reusing an injected connector interface. Use conditional requests where supported, request only the required fields, process serially per account, and persist provider identifiers before acknowledging a page.
- **Rationale**: The existing user story is defined around repeated sync cycles and duplicate-safe ingestion. Polling avoids requiring a public webhook endpoint in the first slice while retaining an eventual signed webhook path through the same ingestion service.
- **Alternatives**: Webhooks only (lower latency but introduces public ingress and signature/availability setup); unbounded periodic listing (unnecessary rate-limit and duplicate risk).
- **Evidence**: GitHub recommends authenticated conditional requests, limited response data, avoiding concurrent requests, and honoring rate-limit reset/retry guidance ([REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api), [rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)). Octokit is the official GitHub REST JavaScript client, but package/runtime compatibility should be checked before adding it ([Octokit REST](https://github.com/octokit/rest.js)).

## D2. Discord interactions

- **Decision**: Receive commands and approval callbacks through an HTTP interactions endpoint rather than a gateway bot that reads all messages. Verify `X-Signature-Ed25519` and `X-Signature-Timestamp` against the exact raw request body, reject stale/replayed requests, then check the configured owner ID and channel/guild allowlists.
- **Rationale**: This limits bot privileges and avoids message-content access while satisfying the configured-identity requirement.
- **Alternatives**: Gateway plus message-content intent (broader access and unnecessary for slash commands/buttons); trust a user ID in the JSON without signature verification (unsafe).
- **Evidence**: Discord's official interactions overview requires validation of those security headers, and the receiving/responding guide defines the HTTP interaction response contract ([interactions overview](https://github.com/discord/discord-api-docs/blob/main/developers/interactions/overview.mdx), [receiving and responding](https://github.com/discord/discord-api-docs/blob/main/developers/interactions/receiving-and-responding.mdx)).

## D3. Durable deduplication and delivery

- **Decision**: Use unique database keys for provider feedback identity and notification delivery interval. Insert/update records and enqueue work through existing transaction/outbox patterns; use the database as the source of truth.
- **Rationale**: Current `external_links` uniqueness is a useful precedent, but `notifications.dedupe_key` is currently indexed but not unique. Polling, retries and restarts require a durable uniqueness boundary.
- **Alternatives**: Redis-only dedupe (lost on restart); in-memory cooldowns (not shared across worker restarts); silent drop on uniqueness conflict (loses audit visibility).

## D4. Dependency choice

- **Decision**: Keep the plan package-neutral until the first implementation issue confirms current Node/TypeScript ESM compatibility and update policy for candidate SDKs. Inject `fetch`/transport in provider contracts so tests remain network-free.
- **Rationale**: The repo is ESM TypeScript; SDK compatibility can change and does not affect the behavioral contract.

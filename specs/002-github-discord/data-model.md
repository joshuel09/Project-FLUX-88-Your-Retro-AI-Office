# Phase 3 Data Model

Extend existing records only where they already represent the right concept. Proposed schema names below are planning targets; migration details are finalized in implementation tasks.

## External task link

Reuse `external_links` as the explicit link from a GitHub pull request to an internal task. Its `(provider, external_type, external_id)` unique key is the mapping authority. Do not infer a mapping from titles, branch names, or external text.

For GitHub pull requests, use `external_type = 'pull_request'` and the canonical `external_id = lower-case '<owner>/<repo>#<number>'`. Feedback sync may read this mapping but never create one.

## External feedback

Add a durable feedback record with:

| Field | Meaning |
|---|---|
| `id` | Internal UUID |
| `provider` | `github` initially |
| `external_id` | Stable GitHub review/comment ID; unique with provider |
| `external_link_id` | Optional task link; null means owner triage required |
| `task_id` | Nullable internal task reference |
| `assignee_agent_id` | Assignee snapshot at ingestion, for traceability |
| `author_login` | Provider identity, not authentication |
| `body_excerpt` | Bounded displayable content; treated as untrusted |
| `source_url` | Validated canonical provider URL |
| `state` | `pending`, `linked`, `resolved`, or `ignored` |
| `provenance` | Fixed `untrusted` source label for provider content |
| `received_at` | First ingestion timestamp |
| `updated_at` | Last metadata refresh |

Do not store complete raw webhook/API payloads. Store only fields needed for attribution and workflow.

## Notification delivery

Reuse `notifications` for user-visible message content. Add a durable delivery identity including channel and configured interval so unique constraints prevent duplicate sends while allowing a later reminder interval. Persist the exact approval request/batch reference and expiry for Discord delivery. Each message in an approved batch binds to a single-use grant; later messages cannot join the approved batch. Delivery status and attempt timestamps must survive worker restarts. Persist `quiet_hours_deferred` for dashboard visibility. Unapproved or expired messages remain dashboard-only.

## Discord interaction identity

Persist the Discord interaction ID, request state, and receipt timestamp under a unique provider/interaction key before executing a command. This prevents replay and duplicate delivery across API restarts. Do not store interaction tokens or full request bodies.

## Audit events

Record sync start/result, feedback mapping/unmatched triage, notification attempt/result, rejected Discord interaction, and approval delegation. Never include bot tokens, interaction tokens, or full private payloads.

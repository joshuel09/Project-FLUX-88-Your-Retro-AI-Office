# Phase 3 GitHub and Discord Collaboration

**Input**: Phase 3 in `specs/001-flux-88-platform/spec.md`, especially User Story 6 and FR-034, FR-041, FR-042, FR-044.

## Summary

Connect the office to GitHub review feedback and an optional Discord channel. GitHub feedback must map to an explicitly linked internal task and its assigned specialist. Discord may deliver task updates and accept commands from the configured owner identity. Repeated sync and delivery attempts must not create duplicate tasks or spam reminders. Remote writes remain behind the existing default-deny approval and outbox boundary.

## User Scenarios & Testing

### User Story 1 — Import GitHub review feedback (Priority: P3)

As the owner, I want review feedback from a linked GitHub pull request to appear on its internal task so the assigned specialist can respond.

**Independent Test**: With a mocked GitHub adapter, sync a review comment for a mapped pull request and verify one untrusted pending-feedback item links to the task and assignee. Repeating the sync creates no duplicate.

#### Acceptance Scenarios

1. **Given** a pull request explicitly linked to an internal task, **When** new review feedback is synced, **Then** one pending-feedback record and activity event reference that task and its current assignee.
2. **Given** repeated API polling or duplicate webhook delivery, **When** the same feedback is ingested again, **Then** no duplicate feedback item, task, or notification is created.
3. **Given** feedback that cannot be mapped unambiguously, **When** sync runs, **Then** it remains unmatched and is surfaced to the owner without assigning or executing work.
4. **Given** hostile instructions inside a GitHub issue or review, **When** an agent receives the content, **Then** it remains untrusted data and cannot change permissions or bypass approval.
5. **Given** mapped pending feedback, **When** the assigned specialist prepares a response, **Then** the response is saved as an internal draft; publishing it requires the existing approval and outbox flow.

### User Story 2 — Notify through Discord (Priority: P3)

As the owner, I want task updates and pending review reminders delivered to my configured Discord identity without duplicate or out-of-hours messages.

**Independent Test**: With a mocked Discord adapter, schedule repeated reminders and verify per-interval deduplication, quiet-hours deferral, and delivery only to an explicitly mapped identity.

#### Acceptance Scenarios

1. **Given** a notification for an assigned task, **When** Discord is configured, **Then** the message includes the task ID and internal/GitHub links and is sent to the configured destination.
2. **Given** quiet hours are active, **When** a reminder becomes due, **Then** it is deferred and delivered once after quiet hours end.
3. **Given** a duplicate notification job, **When** delivery retries, **Then** the notification is not sent twice for the same configured interval.
4. **Given** a due Discord notification has no approved batch, **When** delivery runs, **Then** it remains visible in the dashboard and approval inbox and no external message is sent.
5. **Given** the owner approves an exact, time-limited batch containing specific messages and one destination, **When** delivery runs, **Then** only those listed messages are sent once through the existing grant-bound outbox; expired batches and added messages are rejected.

### User Story 3 — Accept authenticated Discord interactions (Priority: P3)

As the owner, I want Discord task commands and approval actions accepted only from my verified identity.

**Independent Test**: A valid signed owner interaction reaches the matching service; invalid signature, stale timestamp, wrong owner, wrong channel, or duplicate interaction changes no state and is audited.

#### Acceptance Scenarios

1. **Given** a Discord command or approval interaction, **When** the sender is not the configured owner identity or the interaction signature is invalid, **Then** the request is rejected and audited without changing task or approval state.
2. **Given** an authenticated approval interaction, **When** it references a pending approval, **Then** it invokes the existing approval lifecycle and does not create a broader or reusable grant.

### User Story 4 — Prepare safe response drafts (Priority: P3)

As the owner, I want the assigned specialist to prepare a response, follow-up task, or patch draft from review feedback without publishing or applying it automatically.

**Independent Test**: Ask the mock specialist to draft a response to linked feedback; verify the draft is stored on the internal task and no GitHub write occurs until an exact approval is granted.

#### Acceptance Scenarios

1. **Given** mapped pending review feedback, **When** the assigned specialist drafts a response, follow-up task, or patch, **Then** the internal artifact is stored with links to the source feedback and task.
2. **Given** an unapproved draft, **When** worker retries or restarts, **Then** no remote comment is posted and only one draft exists.
3. **Given** an owner-approved exact comment action, **When** the outbox executes, **Then** only that comment is posted to the recorded pull request and the approval cannot be reused.

## Functional Requirements

- **FR-P3-001**: GitHub integration MUST begin read-only and provide bounded reads for allowlisted repositories, commits, pull requests, issues, comments, and review feedback through the existing connector adapter boundary.
- **FR-P3-002**: GitHub feedback MUST attach only through an explicit pull-request-to-task mapping; ambiguous or missing mappings MUST be surfaced for owner action.
- **FR-P3-003**: Feedback from GitHub MUST preserve provider identifiers, source links, author attribution, and an `untrusted` provenance label.
- **FR-P3-004**: Repeated polling, webhook retries, worker retries, and process restarts MUST be idempotent for imported feedback and scheduled reminders.
- **FR-P3-005**: Feedback notifications MUST identify the current task assignee and respect configured reminder intervals and quiet hours.
- **FR-P3-006**: Discord messages and commands MUST be limited to configured guild/channel/user identities; no implicit recipient discovery or broad mentions.
- **FR-P3-007**: Discord approval interactions MUST verify Discord request signatures and the configured owner identity, then call the existing approval service with exact request identity.
- **FR-P3-008**: All GitHub or Discord external writes MUST use the existing policy engine and grant-bound outbox; connector credentials alone MUST NOT authorize writes.
- **FR-P3-009**: Mock providers MUST remain the default and all acceptance tests MUST run without live service credentials.
- **FR-P3-010**: Connector health and synchronization failures MUST be visible without exposing credentials or raw secret-bearing provider payloads.
- **FR-P3-011**: Specialists MAY prepare internal draft responses, tasks, or patches from linked GitHub feedback; no draft is published or applied without an exact policy-engine approval.
- **FR-P3-012**: Automated Discord notifications MUST be limited to the configured owner destination and server-defined event templates explicitly enabled by the owner; free-form agent messages and unconfigured recipients MUST be rejected.
- **FR-P3-013**: Discord notification delivery MUST use a time-limited owner-approved batch that binds exact messages and destination to single-use `external_communication` grants; no unlisted or post-expiry message may be sent.

## Assumptions

- Initial GitHub ingestion uses bounded polling for simplicity; a signed webhook endpoint may be added where it materially improves latency, but must share the same idempotent ingestion path.
- Pull-request/task linking is explicitly established by an owner action or an existing external-link record. Agents do not infer mappings from titles or prompt text.
- Discord approval support is optional. The dashboard approval flow remains available and authoritative.
- Outbound draft responses or patches may be proposed, but this feature never auto-publishes; posting requires the exact approval and grant-bound outbox action.
- Secrets stay in server environment configuration and are never persisted in ordinary connector-account JSON.
- The owner explicitly enables a single Discord destination and a bounded set of server-defined notification templates. This does not authorize free-form agent messages or unconfigured recipients.
- Automated Discord delivery is an external communication. Each delivery batch requires explicit, time-limited owner approval of the exact messages and destination; configuration alone does not authorize sends.

## Success Criteria

- **SC-P3-001**: A mapped feedback item appears on the correct task and specialist after one sync; 10 repeated deliveries produce one stored item.
- **SC-P3-002**: Unmapped feedback is visible to the owner and never assigned by guesswork.
- **SC-P3-003**: 10 duplicate reminder jobs produce at most one Discord delivery per interval, and quiet-hours tests defer delivery correctly.
- **SC-P3-004**: Unauthorized Discord users and invalid signatures cannot alter approval or task state.
- **SC-P3-005**: All provider contract, integration, retry, and acceptance tests pass in mock mode with no live credentials.
- **SC-P3-006**: A GitHub/Discord write without a valid exact approval grant is rejected and audited.
- **SC-P3-007**: A response draft can be reviewed internally, while a publish attempt without an exact approval grant creates no remote change.

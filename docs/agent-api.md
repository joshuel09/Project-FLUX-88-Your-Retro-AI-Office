# Agent API credentials

Owner-session routes issue and revoke service credentials:

- `POST /api/v1/agents/:id/service-credential` rotates the agent's credential.
- `DELETE /api/v1/agents/:id/service-credential/:credentialId` revokes it.

Issuance returns a high-entropy bearer token once and expires it after 90 days. The
database stores only its SHA-256 hash. Rotation revokes the previous active token. Audit
events record the owner, agent or credential ID, and operation without the bearer token.

Agent requests use `Authorization: Bearer <token>` on the separate `/api/v1/agent` route
group:

- `GET /api/v1/agent/me` returns the credential's agent identity.
- `GET /api/v1/agent/tasks/:id` returns a task assigned to that agent, subject to its
  `tasks:own` or `tasks:all` data scope, and assignment to that agent.
- `POST /api/v1/agent/tasks/:id/transition` accepts only `running`, `blocked`, `review`,
  or `failed`, and requires the `tasks.update_own` tool grant plus task assignment.

The server derives identity from the credential; request bodies cannot select an agent.
Owner routes still require the owner session. The mock task runner does not yet use service
credentials as an LLM tool.

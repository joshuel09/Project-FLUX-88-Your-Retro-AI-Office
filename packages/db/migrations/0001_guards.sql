-- Append-only audit trail (constitution IV, FR-070, CHK025):
-- enforced by trigger so it binds every role, including table owners.
CREATE OR REPLACE FUNCTION flux88_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (%s blocked)', TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION flux88_audit_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate
BEFORE TRUNCATE ON "audit_events"
FOR EACH STATEMENT EXECUTE FUNCTION flux88_audit_append_only();
--> statement-breakpoint
-- Least-privilege worker role (plan Security Boundary 3, CHK026):
-- NOLOGIN (no credential in migrations); the worker connects with the app
-- connection and runs SET ROLE flux88_worker. It can read/write runtime
-- tables but CANNOT touch approval_requests/approval_grants decisions
-- (SELECT only) and cannot modify agents, owner or sessions.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'flux88_worker') THEN
    CREATE ROLE flux88_worker NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO flux88_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tasks", "task_dependencies", "handoffs", "agent_runs", "artifacts", "memory_entries", "memory_versions", "notifications", "external_links", "outbox" TO flux88_worker;
--> statement-breakpoint
GRANT SELECT ON "agents", "budgets", "approval_requests", "approval_grants", "connector_accounts" TO flux88_worker;
--> statement-breakpoint
GRANT INSERT, SELECT ON "audit_events" TO flux88_worker;

ALTER TABLE "approval_requests" ALTER COLUMN "requesting_agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "requesting_actor_type" "actor_type" DEFAULT 'agent' NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "decision_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_dedupe_idx" ON "approval_requests" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_grant_idx" ON "outbox" USING btree ("grant_id");--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_request_actor_check" CHECK (("approval_requests"."requesting_actor_type" = 'owner' AND "approval_requests"."requesting_agent_id" IS NULL) OR ("approval_requests"."requesting_actor_type" = 'agent' AND "approval_requests"."requesting_agent_id" IS NOT NULL));--> statement-breakpoint
CREATE FUNCTION flux88_guard_approval_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'approval requests are immutable'; END IF;
  IF ROW(NEW.id, NEW.requesting_actor_type, NEW.requesting_agent_id, NEW.task_id, NEW.action_type,
    NEW.action_payload, NEW.target_resource, NEW.expected_impact, NEW.risks, NEW.expires_at,
    NEW.batch_id, NEW.dedupe_key, NEW.created_at) IS DISTINCT FROM
    ROW(OLD.id, OLD.requesting_actor_type, OLD.requesting_agent_id, OLD.task_id, OLD.action_type,
    OLD.action_payload, OLD.target_resource, OLD.expected_impact, OLD.risks, OLD.expires_at,
    OLD.batch_id, OLD.dedupe_key, OLD.created_at) THEN RAISE EXCEPTION 'approval proposal is immutable'; END IF;
  IF ROW(NEW.status, NEW.decided_by, NEW.decided_at, NEW.decision_reason) IS DISTINCT FROM
     ROW(OLD.status, OLD.decided_by, OLD.decided_at, OLD.decision_reason) THEN
    IF OLD.status <> 'pending' OR NEW.status NOT IN ('approved','rejected','expired') OR
       NEW.decided_by IS NULL OR NEW.decided_at IS NULL THEN RAISE EXCEPTION 'invalid approval decision transition'; END IF;
    IF NEW.status = 'approved' AND NEW.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'approval expired'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER approval_request_guard BEFORE UPDATE OR DELETE ON approval_requests
FOR EACH ROW EXECUTE FUNCTION flux88_guard_approval_request();
--> statement-breakpoint
CREATE FUNCTION flux88_guard_approval_grant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request approval_requests%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'approval grants cannot be deleted'; END IF;
  SELECT * INTO request FROM approval_requests WHERE id = NEW.approval_request_id;
  IF request.status IS DISTINCT FROM 'approved' OR request.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'grant requires a live approved request';
  END IF;
  IF TG_OP = 'INSERT' AND (NEW.consumed_at IS NOT NULL OR NEW.consumed_by_run_id IS NOT NULL) THEN
    RAISE EXCEPTION 'new grant must be unconsumed';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.approval_request_id, NEW.created_at) IS DISTINCT FROM ROW(OLD.id, OLD.approval_request_id, OLD.created_at)
      OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL THEN RAISE EXCEPTION 'invalid grant consumption'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER approval_grant_guard BEFORE INSERT OR UPDATE OR DELETE ON approval_grants
FOR EACH ROW EXECUTE FUNCTION flux88_guard_approval_grant();
--> statement-breakpoint
CREATE FUNCTION flux88_guard_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request approval_requests%ROWTYPE; capability_row approval_grants%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.connector, NEW.operation, NEW.payload, NEW.grant_id, NEW.idempotency_key, NEW.created_at)
       IS DISTINCT FROM ROW(OLD.id, OLD.connector, OLD.operation, OLD.payload, OLD.grant_id, OLD.idempotency_key, OLD.created_at)
       THEN RAISE EXCEPTION 'outbox action is immutable'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO capability_row FROM approval_grants WHERE id = NEW.grant_id;
  SELECT * INTO request FROM approval_requests WHERE id = capability_row.approval_request_id;
  IF capability_row.consumed_at IS NULL OR request.status IS DISTINCT FROM 'approved' OR request.expires_at <= clock_timestamp()
    OR NEW.operation IS DISTINCT FROM request.action_type::text
    OR NEW.payload->>'approvalRequestId' IS DISTINCT FROM request.id::text
    OR NEW.payload->>'actionType' IS DISTINCT FROM request.action_type::text
    OR NEW.payload->>'targetResource' IS DISTINCT FROM request.target_resource
    OR NEW.payload->'actionPayload' IS DISTINCT FROM request.action_payload
    OR NEW.payload->>'expiresAt' IS NULL
    OR (NEW.payload->>'expiresAt')::timestamptz IS DISTINCT FROM request.expires_at
    OR NEW.payload->'requester' IS DISTINCT FROM
       (CASE WHEN request.requesting_actor_type = 'owner' THEN jsonb_build_object('kind','owner')
        ELSE jsonb_build_object('kind','agent','agentId',request.requesting_agent_id) END)
    THEN RAISE EXCEPTION 'outbox action requires exact consumed approval'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER outbox_guard BEFORE INSERT OR UPDATE ON outbox
FOR EACH ROW EXECUTE FUNCTION flux88_guard_outbox();
--> statement-breakpoint
REVOKE INSERT ON outbox FROM flux88_worker;

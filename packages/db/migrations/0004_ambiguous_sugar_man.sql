CREATE TABLE "agent_action_proposals" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"proposal" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approval_request_id" uuid,
	"rejection_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_action_proposals_state" CHECK (("agent_action_proposals"."status" = 'pending' AND "agent_action_proposals"."approval_request_id" IS NULL AND "agent_action_proposals"."rejection_code" IS NULL) OR ("agent_action_proposals"."status" = 'accepted' AND "agent_action_proposals"."approval_request_id" IS NOT NULL AND "agent_action_proposals"."rejection_code" IS NULL) OR ("agent_action_proposals"."status" = 'rejected' AND "agent_action_proposals"."approval_request_id" IS NULL AND "agent_action_proposals"."rejection_code" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "agent_action_proposals" ADD CONSTRAINT "agent_action_proposals_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_action_proposals" ADD CONSTRAINT "agent_action_proposals_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_action_proposals_pending_idx" ON "agent_action_proposals" USING btree ("status","created_at");
--> statement-breakpoint
CREATE FUNCTION flux88_guard_agent_action_proposal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'agent action proposals cannot be deleted'; END IF;
  IF ROW(NEW.run_id, NEW.proposal, NEW.created_at) IS DISTINCT FROM ROW(OLD.run_id, OLD.proposal, OLD.created_at) THEN
    RAISE EXCEPTION 'agent action proposal is immutable';
  END IF;
  IF OLD.status <> 'pending' OR NEW.status NOT IN ('accepted','rejected') THEN
    RAISE EXCEPTION 'invalid agent action proposal transition';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER agent_action_proposal_guard BEFORE UPDATE OR DELETE ON agent_action_proposals
FOR EACH ROW EXECUTE FUNCTION flux88_guard_agent_action_proposal();
--> statement-breakpoint
GRANT SELECT, INSERT ON agent_action_proposals TO flux88_worker;

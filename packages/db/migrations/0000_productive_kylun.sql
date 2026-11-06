CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('owner', 'agent', 'system', 'connector');--> statement-breakpoint
CREATE TYPE "public"."agent_id" AS ENUM('doc', 'eleven', 'data', 'egon', 'claire', 'tron', 'andie', 'mikey', 'jem', 'sloane', 'marty', 'ripley', 'kitt', 'johnny-five', 'sarah', 'robin', 'max', 'ferris');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('idle', 'running', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."approval_action" AS ENUM('payment', 'external_communication', 'publish_content', 'github_write', 'protected_branch_change', 'deployment_or_infra', 'delete_resource', 'share_private_externally', 'agent_config_change', 'policy_change', 'integration_write_enable');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."connector_mode" AS ENUM('read_only', 'write_enabled');--> statement-breakpoint
CREATE TYPE "public"."connector_provider" AS ENUM('github', 'discord', 'trello', 'mock');--> statement-breakpoint
CREATE TYPE "public"."department" AS ENUM('management', 'design', 'engineering', 'content_business');--> statement-breakpoint
CREATE TYPE "public"."memory_scope" AS ENUM('shared', 'project', 'private');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('dashboard', 'discord');--> statement-breakpoint
CREATE TYPE "public"."office_area" AS ENUM('clock-tower', 'hawkins-lab', 'arcade', 'garage', 'ghost-lab', 'front-desk', 'video-store', 'mall', 'memory-vault');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'dispatched', 'failed', 'halted_revalidation');--> statement-breakpoint
CREATE TYPE "public"."llm_provider" AS ENUM('claude', 'mock');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'halted_budget');--> statement-breakpoint
CREATE TYPE "public"."task_origin" AS ENUM('local', 'github', 'trello');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('backlog', 'ready', 'running', 'blocked', 'review', 'awaiting_approval', 'completed', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('verified', 'proposed', 'untrusted');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_id" "agent_id" NOT NULL,
	"provider" "llm_provider" DEFAULT 'mock' NOT NULL,
	"model" text,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"error" text,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" "agent_id" PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"department" "department" NOT NULL,
	"office_area" "office_area" NOT NULL,
	"role_summary" text NOT NULL,
	"personality" text NOT NULL,
	"config" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" "agent_status" DEFAULT 'idle' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requesting_agent_id" "agent_id" NOT NULL,
	"task_id" uuid,
	"action_type" "approval_action" NOT NULL,
	"action_payload" jsonb NOT NULL,
	"target_resource" text NOT NULL,
	"expected_impact" text NOT NULL,
	"risks" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"batch_id" uuid,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_id" "agent_id",
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"agent_id" "agent_id" PRIMARY KEY NOT NULL,
	"max_tokens_per_run" integer NOT NULL,
	"max_runtime_ms" integer NOT NULL,
	"max_retries" integer NOT NULL,
	"max_daily_cost_cents" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "connector_provider" NOT NULL,
	"mode" "connector_mode" DEFAULT 'read_only' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"health_status" text DEFAULT 'unknown' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "connector_provider" NOT NULL,
	"external_type" text NOT NULL,
	"external_id" text NOT NULL,
	"task_id" uuid NOT NULL,
	"origin_marker" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"from_agent_id" "agent_id",
	"to_agent_id" "agent_id" NOT NULL,
	"reason" text NOT NULL,
	"payload_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "memory_scope" DEFAULT 'shared' NOT NULL,
	"project_id" text,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"source_attribution" text NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"verification_status" "verification_status" DEFAULT 'proposed' NOT NULL,
	"author" text NOT NULL,
	"embedding" vector(384),
	"dedupe_hash" text NOT NULL,
	"conflicts_with" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"memory_entry_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"edited_by" text NOT NULL,
	"change_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" "notification_channel" DEFAULT 'dashboard' NOT NULL,
	"task_id" uuid,
	"approval_request_id" uuid,
	"body" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"quiet_hours_deferred" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector" "connector_provider" NOT NULL,
	"operation" text NOT NULL,
	"payload" jsonb NOT NULL,
	"grant_id" uuid NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"task_id" uuid NOT NULL,
	"depends_on_task_id" uuid NOT NULL,
	CONSTRAINT "task_dependencies_task_id_depends_on_task_id_pk" PRIMARY KEY("task_id","depends_on_task_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "task_status" DEFAULT 'backlog' NOT NULL,
	"creator" text NOT NULL,
	"assignee_agent_id" "agent_id",
	"parent_task_id" uuid,
	"priority" integer DEFAULT 3 NOT NULL,
	"deadline" timestamp with time zone,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"retry_limit" integer DEFAULT 2 NOT NULL,
	"delegation_depth" integer DEFAULT 0 NOT NULL,
	"origin" "task_origin" DEFAULT 'local' NOT NULL,
	"origin_ref" text,
	"simulated" boolean DEFAULT false NOT NULL,
	"blocked_reason" text,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"exec_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_grants" ADD CONSTRAINT "approval_grants_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_links" ADD CONSTRAINT "external_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_versions" ADD CONSTRAINT "memory_versions_memory_entry_id_memory_entries_id_fk" FOREIGN KEY ("memory_entry_id") REFERENCES "public"."memory_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_grant_id_approval_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."approval_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_task_id_tasks_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_idempotency_idx" ON "agent_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_grants_request_idx" ON "approval_grants" USING btree ("approval_request_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "external_links_unique_idx" ON "external_links" USING btree ("provider","external_type","external_id");--> statement-breakpoint
CREATE INDEX "memory_category_idx" ON "memory_entries" USING btree ("category");--> statement-breakpoint
CREATE INDEX "memory_dedupe_idx" ON "memory_entries" USING btree ("dedupe_hash");--> statement-breakpoint
CREATE INDEX "notifications_dedupe_idx" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_idempotency_idx" ON "outbox" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_agent_id");
CREATE TYPE "public"."discord_interaction_state" AS ENUM('received', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."external_feedback_state" AS ENUM('pending', 'linked', 'resolved', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."notification_delivery_status" AS ENUM('pending', 'attempting', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "discord_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "connector_provider" DEFAULT 'discord' NOT NULL,
	"interaction_id" text NOT NULL,
	"state" "discord_interaction_state" DEFAULT 'received' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_interactions_provider_check" CHECK ("discord_interactions"."provider" = 'discord')
);
--> statement-breakpoint
CREATE TABLE "external_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "connector_provider" DEFAULT 'github' NOT NULL,
	"external_id" text NOT NULL,
	"external_type" text NOT NULL,
	"external_link_id" uuid,
	"task_id" uuid,
	"assignee_agent_id" "agent_id",
	"author_login" text NOT NULL,
	"body_excerpt" text NOT NULL,
	"source_url" text NOT NULL,
	"state" "external_feedback_state" DEFAULT 'pending' NOT NULL,
	"provenance" text DEFAULT 'untrusted' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_feedback_provider_check" CHECK ("external_feedback"."provider" = 'github'),
	CONSTRAINT "external_feedback_provenance_check" CHECK ("external_feedback"."provenance" = 'untrusted'),
	CONSTRAINT "external_feedback_excerpt_length_check" CHECK (char_length("external_feedback"."body_excerpt") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "approval_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "approval_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "delivery_interval" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "delivery_status" "notification_delivery_status";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "delivery_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_feedback" ADD CONSTRAINT "external_feedback_external_link_id_external_links_id_fk" FOREIGN KEY ("external_link_id") REFERENCES "public"."external_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_feedback" ADD CONSTRAINT "external_feedback_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discord_interactions_provider_id_idx" ON "discord_interactions" USING btree ("provider","interaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_feedback_provider_id_idx" ON "external_feedback" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "external_feedback_task_state_idx" ON "external_feedback" USING btree ("task_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_id_batch_expiry_idx" ON "approval_requests" USING btree ("id","batch_id","expires_at");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_approval_batch_fk" FOREIGN KEY ("approval_request_id","approval_batch_id","approval_expires_at") REFERENCES "public"."approval_requests"("id","batch_id","expires_at") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_delivery_interval_unique_idx" ON "notifications" USING btree ("channel","dedupe_key","delivery_interval") WHERE "notifications"."delivery_interval" is not null;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_delivery_attempts_check" CHECK ("notifications"."delivery_attempts" >= 0);--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_approval_batch_request_check" CHECK ("notifications"."approval_batch_id" IS NULL OR "notifications"."approval_request_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_approval_batch_channel_check" CHECK ("notifications"."approval_batch_id" IS NULL OR "notifications"."channel" = 'discord');--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_approval_expiry_channel_check" CHECK ("notifications"."approval_expires_at" IS NULL OR "notifications"."channel" = 'discord');--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_approval_batch_expiry_pair_check" CHECK (("notifications"."approval_batch_id" IS NULL) = ("notifications"."approval_expires_at" IS NULL));

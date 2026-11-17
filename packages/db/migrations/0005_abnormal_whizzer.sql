CREATE TABLE "agent_service_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" "agent_id" NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_service_credentials" ADD CONSTRAINT "agent_service_credentials_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_service_credentials_hash_idx" ON "agent_service_credentials" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "agent_service_credentials_agent_idx" ON "agent_service_credentials" USING btree ("agent_id");
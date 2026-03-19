CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text DEFAULT 'codex' NOT NULL,
	"auth_mode" text DEFAULT 'api_key' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"prompt" text NOT NULL,
	"needs_browser" text DEFAULT 'false' NOT NULL,
	"sandbox_id" text,
	"session_id" text,
	"command_id" text,
	"artifact_root" text,
	"output_summary" text,
	"error" text,
	"exit_code" integer,
	"started_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_user_status_idx" ON "tasks" USING btree ("user_id","status");

-- DESTRUCTIVE: connector_auth_requests and connector_preferences are replaced
-- by integration_accounts (preferences via isPreferred flag, pending auth via
-- status='pending' + metadataJson). Verify no pending OAuth flows exist before
-- running, or accept that users mid-connection will need to restart.
--
-- DESTRUCTIVE: traces and trace_events are replaced by the extended runs and
-- run_events tables. Historical execution spans will be lost. Back up these
-- tables first if you need to preserve them.
--
-- COMPAT: `runs` and `run_events` existed before this migration via manual
-- schema push, but the creation SQL was never checked in. Fresh databases need
-- these bootstrap definitions so the rest of this migration can reach the
-- final schema entirely through the checked-in Drizzle chain.
CREATE TABLE IF NOT EXISTS "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"trigger_message_id" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"mode" text DEFAULT 'direct' NOT NULL,
	"model_id" text NOT NULL,
	"summary" text,
	"request_json" jsonb,
	"response_json" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "runs_thread_id_conversation_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."conversation_threads"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "runs_trigger_message_id_messages_id_fk" FOREIGN KEY ("trigger_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runs_conversation_idx" ON "runs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runs_thread_idx" ON "runs" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runs_status_idx" ON "runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runs_started_at_idx" ON "runs" USING btree ("started_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_events_run_seq_idx" ON "run_events" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_events_kind_idx" ON "run_events" USING btree ("kind");--> statement-breakpoint
ALTER TABLE "connector_auth_requests" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connector_preferences" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trace_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "traces" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "connector_auth_requests" CASCADE;--> statement-breakpoint
DROP TABLE "connector_preferences" CASCADE;--> statement-breakpoint
DROP TABLE "trace_events" CASCADE;--> statement-breakpoint
DROP TABLE "traces" CASCADE;--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_thread_id_conversation_threads_id_fk";
--> statement-breakpoint
DROP INDEX "conversations_platform_key_idx";--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "thread_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "model_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "message_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "parent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "root_run_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "specialist" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "runner_kind" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "depth" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_thread_id_conversation_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."conversation_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_parent_run_id_idx" ON "runs" USING btree ("parent_run_id");--> statement-breakpoint
CREATE INDEX "runs_root_run_id_idx" ON "runs" USING btree ("root_run_id");--> statement-breakpoint
CREATE INDEX "runs_specialist_idx" ON "runs" USING btree ("specialist");--> statement-breakpoint
CREATE INDEX "runs_task_id_idx" ON "runs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "runs_message_id_idx" ON "runs" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_platform_key_idx" ON "conversations" USING btree ("user_id","platform","external_conversation_key");--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN "workspace_key";

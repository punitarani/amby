-- DESTRUCTIVE: connector_auth_requests and connector_preferences are replaced
-- by integration_accounts (preferences via isPreferred flag, pending auth via
-- status='pending' + metadataJson). Verify no pending OAuth flows exist before
-- running, or accept that users mid-connection will need to restart.
--
-- DESTRUCTIVE: traces and trace_events are replaced by the extended runs and
-- run_events tables. Historical execution spans will be lost. Back up these
-- tables first if you need to preserve them.
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
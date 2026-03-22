CREATE TABLE "conversation_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_thread_key" text,
	"label" text,
	"synopsis" text,
	"keywords" text[],
	"is_default" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trace_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"thread_id" uuid,
	"message_id" uuid,
	"parent_trace_id" uuid,
	"root_trace_id" uuid,
	"agent_name" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"metadata" jsonb
);
--> statement-breakpoint
DROP INDEX "conversations_user_updated_idx";--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "platform" text NOT NULL DEFAULT 'telegram';--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "workspace_key" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "external_conversation_key" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "thread_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_events" ADD CONSTRAINT "trace_events_trace_id_traces_id_fk" FOREIGN KEY ("trace_id") REFERENCES "public"."traces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traces" ADD CONSTRAINT "traces_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traces" ADD CONSTRAINT "traces_thread_id_conversation_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."conversation_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traces" ADD CONSTRAINT "traces_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "threads_conversation_active_idx" ON "conversation_threads" USING btree ("conversation_id","status","last_active_at");--> statement-breakpoint
CREATE UNIQUE INDEX "threads_default_unique_idx" ON "conversation_threads" USING btree ("conversation_id") WHERE is_default = true;--> statement-breakpoint
CREATE UNIQUE INDEX "threads_external_key_idx" ON "conversation_threads" USING btree ("conversation_id","external_thread_key") WHERE external_thread_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "trace_events_trace_seq_idx" ON "trace_events" USING btree ("trace_id","seq");--> statement-breakpoint
CREATE INDEX "traces_conversation_idx" ON "traces" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "traces_message_id_idx" ON "traces" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "traces_parent_trace_id_idx" ON "traces" USING btree ("parent_trace_id");--> statement-breakpoint
CREATE INDEX "traces_root_trace_id_idx" ON "traces" USING btree ("root_trace_id");--> statement-breakpoint
CREATE INDEX "traces_thread_idx" ON "traces" USING btree ("thread_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_conversation_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."conversation_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_platform_key_idx" ON "conversations" USING btree ("platform","workspace_key","external_conversation_key");--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "platform" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "external_conversation_key" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN "channel_type";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "tool_calls";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "tool_results";
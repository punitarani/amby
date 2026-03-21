CREATE TABLE "task_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"seq" integer,
	"payload" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"label" text,
	"synopsis" text,
	"status" text DEFAULT 'open' NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "thread_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "channel_type" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "reply_target" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "callback_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "callback_secret_hash" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "last_event_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "last_event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "last_probe_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "notified_status" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "last_notification_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_events_task_event_id_idx" ON "task_events" USING btree ("task_id","event_id");--> statement-breakpoint
CREATE INDEX "task_events_task_id_idx" ON "task_events" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_events_task_seq_idx" ON "task_events" USING btree ("task_id","seq");--> statement-breakpoint
CREATE INDEX "task_events_task_occurred_idx" ON "task_events" USING btree ("task_id","occurred_at");--> statement-breakpoint
CREATE INDEX "threads_conversation_active_idx" ON "conversation_threads" USING btree ("conversation_id","status","last_active_at");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_conversation_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."conversation_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_callback_id_idx" ON "tasks" USING btree ("callback_id");--> statement-breakpoint
CREATE INDEX "tasks_status_heartbeat_idx" ON "tasks" USING btree ("status","heartbeat_at");
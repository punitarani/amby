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
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "threads_conversation_active_idx" ON "conversation_threads" USING btree ("conversation_id","status","last_active_at");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_conversation_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."conversation_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("thread_id","created_at");
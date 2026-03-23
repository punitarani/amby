ALTER TABLE "traces" RENAME COLUMN "agent_name" TO "specialist";
--> statement-breakpoint
ALTER TABLE "traces" ADD COLUMN "task_id" uuid;
--> statement-breakpoint
ALTER TABLE "traces" ADD COLUMN "runner_kind" text;
--> statement-breakpoint
ALTER TABLE "traces" ADD COLUMN "mode" text;
--> statement-breakpoint
ALTER TABLE "traces" ADD COLUMN "depth" integer;
--> statement-breakpoint
UPDATE "traces" SET "specialist" = 'conversation' WHERE "specialist" = 'orchestrator';
--> statement-breakpoint
CREATE INDEX "traces_task_id_idx" ON "traces" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX "traces_specialist_idx" ON "traces" USING btree ("specialist");
--> statement-breakpoint
CREATE INDEX "traces_runner_kind_idx" ON "traces" USING btree ("runner_kind");
--> statement-breakpoint
CREATE INDEX "traces_mode_idx" ON "traces" USING btree ("mode");
--> statement-breakpoint
ALTER TABLE "task_events" RENAME COLUMN "event_type" TO "kind";
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "thread_id" uuid;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "trace_id" uuid;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "parent_task_id" uuid;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "root_task_id" uuid;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "specialist" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "runner_kind" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "input" jsonb;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "output" jsonb;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "artifacts" jsonb;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "confirmation_state" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_thread_id_conversation_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."conversation_threads"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_root_task_id_fkey" FOREIGN KEY ("root_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "tasks_thread_idx" ON "tasks" USING btree ("thread_id");
--> statement-breakpoint
CREATE INDEX "tasks_trace_id_idx" ON "tasks" USING btree ("trace_id");
--> statement-breakpoint
CREATE INDEX "tasks_parent_task_id_idx" ON "tasks" USING btree ("parent_task_id");
--> statement-breakpoint
CREATE INDEX "tasks_root_task_id_idx" ON "tasks" USING btree ("root_task_id");
--> statement-breakpoint
CREATE INDEX "tasks_specialist_idx" ON "tasks" USING btree ("specialist");
--> statement-breakpoint
CREATE INDEX "tasks_runner_kind_idx" ON "tasks" USING btree ("runner_kind");

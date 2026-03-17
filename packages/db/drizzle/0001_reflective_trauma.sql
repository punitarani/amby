ALTER TABLE "memories" ADD CONSTRAINT "memories_parent_id_memories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."memories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_idx" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "conversations_user_updated_idx" ON "conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "jobs_user_id_idx" ON "jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "jobs_status_next_run_idx" ON "jobs" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "memories_user_active_idx" ON "memories" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");
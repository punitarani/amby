-- Align historical renamed-table constraints and indexes with the current
-- checked-in Drizzle schema so a fresh migrate lands at the same final state
-- as `drizzle-kit push`.
ALTER TABLE "compute_volumes" DROP CONSTRAINT IF EXISTS "user_volumes_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "compute_volumes" DROP CONSTRAINT IF EXISTS "compute_volumes_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "compute_instances" DROP CONSTRAINT IF EXISTS "sandboxes_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "compute_instances" DROP CONSTRAINT IF EXISTS "compute_instances_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "compute_instances" DROP CONSTRAINT IF EXISTS "sandboxes_volume_id_user_volumes_id_fk";--> statement-breakpoint
ALTER TABLE "compute_instances" DROP CONSTRAINT IF EXISTS "compute_instances_volume_id_compute_volumes_id_fk";--> statement-breakpoint
ALTER TABLE "integration_accounts" DROP CONSTRAINT IF EXISTS "integration_accounts_user_id_fkey";--> statement-breakpoint
ALTER TABLE "integration_accounts" DROP CONSTRAINT IF EXISTS "integration_accounts_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "automations" DROP CONSTRAINT IF EXISTS "automations_user_id_fkey";--> statement-breakpoint
ALTER TABLE "automations" DROP CONSTRAINT IF EXISTS "automations_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "compute_volumes" ADD CONSTRAINT "compute_volumes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compute_instances" ADD CONSTRAINT "compute_instances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compute_instances" ADD CONSTRAINT "compute_instances_volume_id_compute_volumes_id_fk" FOREIGN KEY ("volume_id") REFERENCES "public"."compute_volumes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automations_user_idx" ON "automations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automations_status_next_run_idx" ON "automations" USING btree ("status","next_run_at");--> statement-breakpoint

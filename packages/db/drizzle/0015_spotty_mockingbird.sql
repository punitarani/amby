CREATE TABLE "vault" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"namespace" text NOT NULL,
	"item_key" text NOT NULL,
	"display_name" text,
	"kind" text NOT NULL,
	"metadata_json" jsonb,
	"policy_json" jsonb,
	"current_version" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"vault_version_id" uuid,
	"action" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"purpose" text,
	"run_id" uuid,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"crypto_alg" text DEFAULT 'aes-256-gcm' NOT NULL,
	"kek_version" integer NOT NULL,
	"dek_wrapped" text NOT NULL,
	"nonce" text NOT NULL,
	"ciphertext" text NOT NULL,
	"created_by_type" text DEFAULT 'system' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex_auth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"compute_volume_id" uuid,
	"active_vault_id" uuid,
	"active_vault_version" integer,
	"method" text NOT NULL,
	"status" text NOT NULL,
	"api_key_last4" text,
	"account_id" text,
	"workspace_id" text,
	"plan_type" text,
	"last_refresh" timestamp with time zone,
	"pending_device_auth" jsonb,
	"last_error" text,
	"last_materialized_version" integer,
	"last_materialized_at" timestamp with time zone,
	"last_validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vault" ADD CONSTRAINT "vault_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_access_log" ADD CONSTRAINT "vault_access_log_vault_id_vault_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vault"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_versions" ADD CONSTRAINT "vault_versions_vault_id_vault_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vault"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_auth_states" ADD CONSTRAINT "codex_auth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_auth_states" ADD CONSTRAINT "codex_auth_states_compute_volume_id_compute_volumes_id_fk" FOREIGN KEY ("compute_volume_id") REFERENCES "public"."compute_volumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_auth_states" ADD CONSTRAINT "codex_auth_states_active_vault_id_vault_id_fk" FOREIGN KEY ("active_vault_id") REFERENCES "public"."vault"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vault_user_ns_key_idx" ON "vault" USING btree ("user_id","namespace","item_key");--> statement-breakpoint
CREATE INDEX "vault_user_status_idx" ON "vault" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "vault_access_log_vault_idx" ON "vault_access_log" USING btree ("vault_id");--> statement-breakpoint
CREATE INDEX "vault_access_log_actor_idx" ON "vault_access_log" USING btree ("actor_type","actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vault_versions_vault_version_idx" ON "vault_versions" USING btree ("vault_id","version");--> statement-breakpoint
CREATE INDEX "vault_versions_vault_idx" ON "vault_versions" USING btree ("vault_id");--> statement-breakpoint
CREATE UNIQUE INDEX "codex_auth_states_user_idx" ON "codex_auth_states" USING btree ("user_id");
-- Migration 0010: Finalize schema
--
-- Renames:
--   user_volumes → compute_volumes (column: daytona_volume_id → external_volume_id)
--   sandboxes → compute_instances (column: daytona_sandbox_id → external_instance_id)
--
-- Creates (if not exist):
--   integration_accounts — unified integration account storage
--   automations — replaces jobs for scheduled/recurring work
--
-- Drops:
--   jobs — replaced by automations

-- Step 1: Rename user_volumes → compute_volumes
ALTER TABLE "user_volumes" RENAME TO "compute_volumes";
ALTER TABLE "compute_volumes" RENAME COLUMN "daytona_volume_id" TO "external_volume_id";

-- Step 2: Rename sandboxes → compute_instances
ALTER TABLE "sandboxes" RENAME TO "compute_instances";
ALTER TABLE "compute_instances" RENAME COLUMN "daytona_sandbox_id" TO "external_instance_id";

-- Rename indexes to match new table names
ALTER INDEX IF EXISTS "user_volumes_user_id_unique" RENAME TO "compute_volumes_user_id_unique";
ALTER INDEX IF EXISTS "user_volumes_daytona_volume_id_unique" RENAME TO "compute_volumes_external_volume_id_unique";
ALTER INDEX IF EXISTS "sandboxes_user_main_idx" RENAME TO "compute_instances_user_main_idx";

-- Step 3: Create new tables if they don't exist yet
CREATE TABLE IF NOT EXISTS "integration_accounts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "provider" text NOT NULL,
    "external_account_id" text,
    "status" text NOT NULL DEFAULT 'pending',
    "is_preferred" boolean NOT NULL DEFAULT false,
    "metadata_json" jsonb,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "integration_accounts_user_idx" ON "integration_accounts" ("user_id");
CREATE INDEX IF NOT EXISTS "integration_accounts_provider_idx" ON "integration_accounts" ("user_id", "provider");
CREATE UNIQUE INDEX IF NOT EXISTS "integration_accounts_external_idx" ON "integration_accounts" ("user_id", "provider", "external_account_id");

CREATE TABLE IF NOT EXISTS "automations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "kind" text NOT NULL,
    "status" text NOT NULL DEFAULT 'active',
    "schedule_json" jsonb,
    "next_run_at" timestamp with time zone,
    "last_run_at" timestamp with time zone,
    "payload_json" jsonb,
    "delivery_target_json" jsonb,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Step 4: Drop obsolete tables
-- connector_auth_requests and connector_preferences are still queried by
-- the integrations service and will be migrated in a follow-up PR.
DROP TABLE IF EXISTS "jobs";

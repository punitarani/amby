-- 1. Create user_volumes table
CREATE TABLE IF NOT EXISTS "user_volumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"daytona_volume_id" text NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"auth_config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_volumes_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "user_volumes_daytona_volume_id_unique" UNIQUE("daytona_volume_id")
);
--> statement-breakpoint
ALTER TABLE "user_volumes" ADD CONSTRAINT "user_volumes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_volumes" ALTER COLUMN "status" SET DEFAULT 'creating';

--> statement-breakpoint
-- 2. Add new columns (volume_id starts nullable so we can back-fill before enforcing NOT NULL)
ALTER TABLE "sandboxes" ADD COLUMN "volume_id" uuid;
--> statement-breakpoint
ALTER TABLE "sandboxes" ADD COLUMN "role" text DEFAULT 'main' NOT NULL;
--> statement-breakpoint
ALTER TABLE "sandboxes" ADD COLUMN "snapshot" text;
--> statement-breakpoint
ALTER TABLE "sandboxes" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "sandboxes" ALTER COLUMN "status" SET DEFAULT 'volume_creating';

--> statement-breakpoint
-- 3. Back-fill volume_id from user_volumes, then remove rows that have no volume
UPDATE "sandboxes" s
   SET "volume_id" = uv."id"
  FROM "user_volumes" uv
 WHERE uv."user_id" = s."user_id";
--> statement-breakpoint
DELETE FROM "sandboxes" WHERE "volume_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "sandboxes" ALTER COLUMN "volume_id" SET NOT NULL;

--> statement-breakpoint
-- 4. FK with RESTRICT: volume_id is NOT NULL so SET NULL is invalid;
--    RESTRICT prevents physical deletion of a volume row while sandboxes reference it
ALTER TABLE "sandboxes" ADD CONSTRAINT "sandboxes_volume_id_user_volumes_id_fk" FOREIGN KEY ("volume_id") REFERENCES "public"."user_volumes"("id") ON DELETE restrict ON UPDATE no action;

--> statement-breakpoint
-- 5. Swap unique constraint for partial unique index (same statement to avoid gap).
--    Excludes soft-deleted rows so multiple deleted main sandboxes can coexist per user.
ALTER TABLE "sandboxes" DROP CONSTRAINT IF EXISTS "sandboxes_user_id_unique";
DROP INDEX IF EXISTS "sandboxes_user_main_idx";
CREATE UNIQUE INDEX "sandboxes_user_main_idx" ON "sandboxes" ("user_id", "role") WHERE role = 'main' AND status != 'deleted';

--> statement-breakpoint
-- 6. Make daytona_sandbox_id nullable (NULL = no sandbox provisioned yet)
ALTER TABLE "sandboxes" ALTER COLUMN "daytona_sandbox_id" DROP NOT NULL;

--> statement-breakpoint
-- 7. Drop columns moved to user_volumes
ALTER TABLE "sandboxes" DROP COLUMN IF EXISTS "auth_config";
--> statement-breakpoint
ALTER TABLE "sandboxes" DROP COLUMN IF EXISTS "daytona_volume_id";

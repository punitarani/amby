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
-- 2. Backfill: migrate existing sandbox volumes + auth into user_volumes
INSERT INTO "user_volumes" ("user_id", "daytona_volume_id", "status", "auth_config", "created_at", "updated_at")
SELECT
	s."user_id",
	s."daytona_volume_id",
	'ready',
	s."auth_config",
	s."created_at",
	now()
FROM "sandboxes" s
WHERE s."daytona_volume_id" IS NOT NULL
ON CONFLICT ("user_id") DO NOTHING;

--> statement-breakpoint
-- 3. Add new columns to sandboxes
ALTER TABLE "sandboxes" ADD COLUMN "volume_id" uuid;
--> statement-breakpoint
ALTER TABLE "sandboxes" ADD COLUMN "role" text DEFAULT 'main' NOT NULL;
--> statement-breakpoint
ALTER TABLE "sandboxes" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

--> statement-breakpoint
-- 4. Backfill volume_id FK from user_volumes
UPDATE "sandboxes" s
SET "volume_id" = uv."id"
FROM "user_volumes" uv
WHERE uv."user_id" = s."user_id";

--> statement-breakpoint
-- 5. Add FK constraint for volume_id
ALTER TABLE "sandboxes" ADD CONSTRAINT "sandboxes_volume_id_user_volumes_id_fk" FOREIGN KEY ("volume_id") REFERENCES "public"."user_volumes"("id") ON DELETE set null ON UPDATE no action;

--> statement-breakpoint
-- 6. Drop old unique constraint on sandboxes.user_id
ALTER TABLE "sandboxes" DROP CONSTRAINT IF EXISTS "sandboxes_user_id_unique";

--> statement-breakpoint
-- 7. Add partial unique index: one main sandbox per user
CREATE UNIQUE INDEX IF NOT EXISTS "sandboxes_user_main_idx" ON "sandboxes" ("user_id", "role") WHERE role = 'main';

--> statement-breakpoint
-- 8. Drop columns moved to user_volumes
ALTER TABLE "sandboxes" DROP COLUMN IF EXISTS "auth_config";
--> statement-breakpoint
ALTER TABLE "sandboxes" DROP COLUMN IF EXISTS "daytona_volume_id";

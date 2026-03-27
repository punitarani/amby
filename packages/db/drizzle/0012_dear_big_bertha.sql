CREATE TABLE "telegram_identity_blocks" (
	"telegram_user_id" text PRIMARY KEY NOT NULL,
	"last_user_id" text,
	"reason" text DEFAULT 'unlink' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "telegram_chat_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_phone_number" text;--> statement-breakpoint
ALTER TABLE "telegram_identity_blocks" ADD CONSTRAINT "telegram_identity_blocks_last_user_id_users_id_fk" FOREIGN KEY ("last_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_identity_blocks_last_user_idx" ON "telegram_identity_blocks" USING btree ("last_user_id");
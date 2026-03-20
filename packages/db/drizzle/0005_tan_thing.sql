CREATE TABLE "connector_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"toolkit" text NOT NULL,
	"preferred_connected_account_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connector_preferences" ADD CONSTRAINT "connector_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connector_preferences_user_toolkit_idx" ON "connector_preferences" USING btree ("user_id","toolkit");--> statement-breakpoint
CREATE INDEX "connector_preferences_connected_account_idx" ON "connector_preferences" USING btree ("preferred_connected_account_id");
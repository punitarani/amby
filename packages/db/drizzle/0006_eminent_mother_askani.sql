CREATE TABLE "connector_auth_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"toolkit" text NOT NULL,
	"redirect_url" text NOT NULL,
	"callback_url" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connector_auth_requests" ADD CONSTRAINT "connector_auth_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connector_auth_requests_user_toolkit_idx" ON "connector_auth_requests" USING btree ("user_id","toolkit");--> statement-breakpoint
CREATE INDEX "connector_auth_requests_expires_at_idx" ON "connector_auth_requests" USING btree ("expires_at");
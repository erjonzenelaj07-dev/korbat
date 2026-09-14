CREATE TYPE "auth"."auth_event_type" AS ENUM('signup', 'signin_success', 'signin_failure', 'mfa_enabled', 'mfa_disabled', 'recovery_code_used', 'recovery_codes_regenerated', 'password_set', 'password_changed', 'session_revoked', 'sessions_revoked_all', 'account_locked', 'new_device', 'not_me');--> statement-breakpoint
CREATE TYPE "auth"."user_role" AS ENUM('user', 'moderator', 'admin');--> statement-breakpoint
ALTER TYPE "auth"."email_code_purpose" ADD VALUE 'reauth';--> statement-breakpoint
CREATE TABLE "auth"."auth_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"type" "auth"."auth_event_type" NOT NULL,
	"device_id" uuid,
	"ip_hash" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."auth_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth"."email_codes" ADD COLUMN "flow_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."email_codes" ADD COLUMN "ip_hash" text;--> statement-breakpoint
ALTER TABLE "auth"."users" ADD COLUMN "role" "auth"."user_role" DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."users" ADD COLUMN "age_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth"."users" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "auth"."users" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth"."users" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth"."users" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth"."users" ADD COLUMN "totp_last_step" bigint;--> statement-breakpoint
ALTER TABLE "auth"."auth_events" ADD CONSTRAINT "auth_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_events_user_created_idx" ON "auth"."auth_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_codes_flow_idx" ON "auth"."email_codes" USING btree ("flow_id");--> statement-breakpoint
CREATE POLICY "auth_events_auth_insert" ON "auth"."auth_events" AS PERMISSIVE FOR INSERT TO "korbat_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "auth_events_auth_select" ON "auth"."auth_events" AS PERMISSIVE FOR SELECT TO "korbat_auth" USING (true);
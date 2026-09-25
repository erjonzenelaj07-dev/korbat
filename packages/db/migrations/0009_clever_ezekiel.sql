ALTER TYPE "auth"."auth_event_type" ADD VALUE 'profile_updated';--> statement-breakpoint
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'handle_changed';--> statement-breakpoint
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'email_changed';--> statement-breakpoint
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'badge_verified';--> statement-breakpoint
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'badge_removed';--> statement-breakpoint
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'export_created';--> statement-breakpoint
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'account_deleted';--> statement-breakpoint
ALTER TYPE "auth"."email_code_purpose" ADD VALUE 'delete_account';--> statement-breakpoint
CREATE TABLE "handle_history" (
	"handle_lower" text PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "handle_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth"."users" ADD COLUMN "purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "handle_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "handle_history" ADD CONSTRAINT "handle_history_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_hash_idx" ON "auth"."users" USING btree ("phone_hash") WHERE phone_hash is not null;--> statement-breakpoint
CREATE POLICY "handle_history_api_all" ON "handle_history" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
-- Existing accounts: the handle chosen at onboarding is reserved for them like every later one (1b design, section 6).
INSERT INTO "handle_history" ("handle_lower", "profile_id", "changed_at") SELECT lower("handle"), "id", "created_at" FROM "profiles" ON CONFLICT DO NOTHING;

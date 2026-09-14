CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE TYPE "auth"."email_code_purpose" AS ENUM('signup', 'login', 'change_email', 'recovery');--> statement-breakpoint
CREATE TYPE "public"."post_state" AS ENUM('visible', 'withheld', 'removed', 'deleted_by_author');--> statement-breakpoint
CREATE TYPE "public"."appeal_status" AS ENUM('open', 'upheld', 'denied');--> statement-breakpoint
CREATE TYPE "public"."case_action" AS ENUM('none', 'withhold', 'remove', 'strike', 'suspend');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'merged', 'closed');--> statement-breakpoint
CREATE TYPE "public"."target_type" AS ENUM('post', 'profile');--> statement-breakpoint
CREATE TABLE "auth"."devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_hash" text NOT NULL,
	"label" text,
	"platform" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" text,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "auth"."devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth"."email_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"purpose" "auth"."email_code_purpose" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."email_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth"."passkeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text[] DEFAULT '{}'::text[] NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "auth"."passkeys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth"."sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"reauth_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"phone_hash" text,
	"password_hash" text,
	"totp_secret_enc" text,
	"totp_enabled_at" timestamp with time zone,
	"recovery_codes_hash" text[] DEFAULT '{}'::text[] NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "auth"."users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"avatar_path" text,
	"verified_at" timestamp with time zone,
	"reputation" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "blocks_not_self" CHECK ("blocks"."blocker_id" <> "blocks"."blocked_id")
);
--> statement-breakpoint
ALTER TABLE "blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"user_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookmarks_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
ALTER TABLE "bookmarks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "follows" (
	"follower_id" uuid NOT NULL,
	"followee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_follower_id_followee_id_pk" PRIMARY KEY("follower_id","followee_id"),
	CONSTRAINT "follows_not_self" CHECK ("follows"."follower_id" <> "follows"."followee_id")
);
--> statement-breakpoint
ALTER TABLE "follows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "likes" (
	"user_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "likes_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
ALTER TABLE "likes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mutes" (
	"muter_id" uuid NOT NULL,
	"muted_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mutes_muter_id_muted_id_pk" PRIMARY KEY("muter_id","muted_id"),
	CONSTRAINT "mutes_not_self" CHECK ("mutes"."muter_id" <> "mutes"."muted_id")
);
--> statement-breakpoint
ALTER TABLE "mutes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "post_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"path" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"blurhash" text NOT NULL,
	"alt_text" text,
	"nsfw_score" real
);
--> statement-breakpoint
ALTER TABLE "post_media" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"reply_to_id" uuid,
	"quote_of_id" uuid,
	"state" "post_state" DEFAULT 'visible' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_body_len" CHECK (char_length("posts"."body") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reposts" (
	"user_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reposts_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
ALTER TABLE "reposts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"statement" text NOT NULL,
	"status" "appeal_status" DEFAULT 'open' NOT NULL,
	"reviewer_id" uuid,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "appeals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" "target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"action" "case_action" DEFAULT 'none' NOT NULL,
	"public_reason" text DEFAULT '' NOT NULL,
	"moderator_id" uuid,
	"senior" boolean DEFAULT false NOT NULL,
	"brigading_flag" boolean DEFAULT false NOT NULL,
	"weight" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"target_type" "target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"case_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "strikes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "strikes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "transparency_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" text NOT NULL,
	"action" "case_action" NOT NULL,
	"target_type" "target_type" NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"appealed" boolean DEFAULT false NOT NULL,
	"appeal_outcome" "appeal_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transparency_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth"."devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."email_codes" ADD CONSTRAINT "email_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD CONSTRAINT "sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "auth"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_profiles_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_profiles_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_profiles_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_followee_id_profiles_id_fk" FOREIGN KEY ("followee_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutes" ADD CONSTRAINT "mutes_muter_id_profiles_id_fk" FOREIGN KEY ("muter_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutes" ADD CONSTRAINT "mutes_muted_id_profiles_id_fk" FOREIGN KEY ("muted_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_reply_to_id_posts_id_fk" FOREIGN KEY ("reply_to_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_quote_of_id_posts_id_fk" FOREIGN KEY ("quote_of_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reposts" ADD CONSTRAINT "reposts_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reposts" ADD CONSTRAINT "reposts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_reviewer_id_profiles_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_moderator_id_profiles_id_fk" FOREIGN KEY ("moderator_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_profiles_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strikes" ADD CONSTRAINT "strikes_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strikes" ADD CONSTRAINT "strikes_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "auth"."devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "devices_ip_hash_idx" ON "auth"."devices" USING btree ("ip_hash");--> statement-breakpoint
CREATE INDEX "email_codes_email_idx" ON "auth"."email_codes" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "passkeys_credential_idx" ON "auth"."passkeys" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "passkeys_user_idx" ON "auth"."passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "auth"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "auth"."users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_handle_lower_idx" ON "profiles" USING btree (lower("handle"));--> statement-breakpoint
CREATE INDEX "blocks_to_idx" ON "blocks" USING btree ("blocked_id");--> statement-breakpoint
CREATE INDEX "bookmarks_post_idx" ON "bookmarks" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "follows_to_idx" ON "follows" USING btree ("followee_id");--> statement-breakpoint
CREATE INDEX "likes_post_idx" ON "likes" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "mutes_to_idx" ON "mutes" USING btree ("muted_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_media_post_position_idx" ON "post_media" USING btree ("post_id","position");--> statement-breakpoint
CREATE INDEX "posts_author_created_idx" ON "posts" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "posts_created_id_idx" ON "posts" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "posts_reply_to_idx" ON "posts" USING btree ("reply_to_id");--> statement-breakpoint
CREATE INDEX "reposts_post_idx" ON "reposts" USING btree ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appeals_case_idx" ON "appeals" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "cases_open_idx" ON "cases" USING btree ("closed_at","weight","created_at");--> statement-breakpoint
CREATE INDEX "cases_target_idx" ON "cases" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_reporter_target_idx" ON "reports" USING btree ("reporter_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "reports_target_idx" ON "reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "strikes_user_active_idx" ON "strikes" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "transparency_decided_idx" ON "transparency_log" USING btree ("decided_at");--> statement-breakpoint
CREATE POLICY "devices_auth_all" ON "auth"."devices" AS PERMISSIVE FOR ALL TO "korbat_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "email_codes_auth_all" ON "auth"."email_codes" AS PERMISSIVE FOR ALL TO "korbat_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "passkeys_auth_all" ON "auth"."passkeys" AS PERMISSIVE FOR ALL TO "korbat_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "sessions_auth_all" ON "auth"."sessions" AS PERMISSIVE FOR ALL TO "korbat_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "users_auth_all" ON "auth"."users" AS PERMISSIVE FOR ALL TO "korbat_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "profiles_api_all" ON "profiles" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "blocks_api_all" ON "blocks" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "bookmarks_api_all" ON "bookmarks" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "follows_api_all" ON "follows" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "likes_api_all" ON "likes" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "mutes_api_all" ON "mutes" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "post_media_api_all" ON "post_media" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "posts_api_all" ON "posts" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "reposts_api_all" ON "reposts" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "appeals_api_all" ON "appeals" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "audit_log_api_insert" ON "audit_log" AS PERMISSIVE FOR INSERT TO "korbat_api" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "audit_log_api_select" ON "audit_log" AS PERMISSIVE FOR SELECT TO "korbat_api" USING (true);--> statement-breakpoint
CREATE POLICY "cases_api_all" ON "cases" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "reports_api_all" ON "reports" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "strikes_api_all" ON "strikes" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "transparency_api_all" ON "transparency_log" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);
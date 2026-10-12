ALTER TYPE "public"."action_kind" ADD VALUE 'strike';--> statement-breakpoint
ALTER TYPE "public"."action_kind" ADD VALUE 'suspend';--> statement-breakpoint
ALTER TYPE "public"."action_kind" ADD VALUE 'terminate';--> statement-breakpoint
ALTER TYPE "public"."action_kind" ADD VALUE 'retire_handle';--> statement-breakpoint
ALTER TYPE "public"."action_kind" ADD VALUE 'warn_reporting';--> statement-breakpoint
ALTER TYPE "public"."action_kind" ADD VALUE 'restrict_reporting';--> statement-breakpoint
ALTER TYPE "public"."action_kind" ADD VALUE 'overrule';--> statement-breakpoint
ALTER TYPE "public"."action_kind" ADD VALUE 'lift_suspension';--> statement-breakpoint
ALTER TYPE "public"."action_kind" ADD VALUE 'unretire_handle';--> statement-breakpoint
ALTER TYPE "public"."action_kind" ADD VALUE 'lift_reporting';--> statement-breakpoint
CREATE TABLE "report_tallies" (
	"account_id" uuid NOT NULL,
	"day" date NOT NULL,
	"reports" integer NOT NULL,
	CONSTRAINT "report_tallies_account_id_day_pk" PRIMARY KEY("account_id","day")
);
--> statement-breakpoint
ALTER TABLE "report_tallies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "suspension_replies" (
	"action_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"statement" text,
	"statement_salt" text,
	"statement_digest" text,
	"filed_at" timestamp with time zone NOT NULL,
	"on_time" boolean NOT NULL,
	"answered_by" uuid,
	"answered_at" timestamp with time zone,
	"erased_at" timestamp with time zone,
	CONSTRAINT "suspension_replies_statement_len" CHECK (char_length("suspension_replies"."statement") <= 2000),
	CONSTRAINT "suspension_replies_statement" CHECK (("suspension_replies"."statement" is null) = ("suspension_replies"."statement_salt" is null) and ("suspension_replies"."statement" is null or ("suspension_replies"."erased_at" is null and "suspension_replies"."statement_salt" ~ '^[0-9a-f]{64}$' and "suspension_replies"."statement_digest" is not null and "suspension_replies"."statement_digest" = encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode("suspension_replies"."statement_salt", 'hex') || convert_to("suspension_replies"."statement", 'UTF8')), 'hex'))) and ("suspension_replies"."statement" is not null or "suspension_replies"."statement_digest" is null or "suspension_replies"."erased_at" is not null) and ("suspension_replies"."statement_digest" is null or "suspension_replies"."statement_digest" ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
ALTER TABLE "suspension_replies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "unfounded_marks" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"decision_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"intake_id" uuid NOT NULL,
	"reported_at" timestamp with time zone NOT NULL,
	"marked_at" timestamp with time zone NOT NULL,
	"withdrawn_by" uuid,
	"withdrawn_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "unfounded_marks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handle_history" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "suspended_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "suspended_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "reports_restricted_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "restored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "explore_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "decision_actions" ADD COLUMN "days" smallint;--> statement-breakpoint
ALTER TABLE "decision_actions" ADD COLUMN "announced" boolean;--> statement-breakpoint
ALTER TABLE "decision_actions" ADD COLUMN "basis" text;--> statement-breakpoint
ALTER TABLE "decision_actions" ADD COLUMN "rests_on" uuid[];--> statement-breakpoint
ALTER TABLE "decision_actions" ADD COLUMN "starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "decision_actions" ADD COLUMN "ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "decision_actions" ADD COLUMN "replaced" boolean;--> statement-breakpoint
ALTER TABLE "suspension_replies" ADD CONSTRAINT "suspension_replies_action_id_decision_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."decision_actions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspension_replies" ADD CONSTRAINT "suspension_replies_account_id_profiles_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspension_replies" ADD CONSTRAINT "suspension_replies_answered_by_decisions_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unfounded_marks" ADD CONSTRAINT "unfounded_marks_item_id_intake_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."intake_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unfounded_marks" ADD CONSTRAINT "unfounded_marks_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unfounded_marks" ADD CONSTRAINT "unfounded_marks_intake_id_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."intakes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unfounded_marks" ADD CONSTRAINT "unfounded_marks_withdrawn_by_decisions_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suspension_replies_pending_idx" ON "suspension_replies" USING btree ("filed_at") WHERE answered_by is null;--> statement-breakpoint
CREATE INDEX "unfounded_marks_account_idx" ON "unfounded_marks" USING btree ("account_id","reported_at");--> statement-breakpoint
CREATE INDEX "posts_explore_from_idx" ON "posts" USING btree ("explore_from") WHERE explore_from is not null;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_suspended" CHECK (("profiles"."suspended_from" is null) = ("profiles"."suspended_until" is null) and "profiles"."suspended_from" < "profiles"."suspended_until");--> statement-breakpoint
ALTER TABLE "decision_actions" ADD CONSTRAINT "decision_actions_days" CHECK ("decision_actions"."days" between 1 and 30);--> statement-breakpoint
ALTER TABLE "decision_actions" ADD CONSTRAINT "decision_actions_basis" CHECK ("decision_actions"."basis" in ('strikes', 'threat', 'terrorist', 'flood', 'protective', 'threat_repeat', 'ladder_end', 'reports'));--> statement-breakpoint
ALTER TABLE "decision_actions" ADD CONSTRAINT "decision_actions_announced" CHECK ("decision_actions"."announced" is null or "decision_actions"."basis" is not null);--> statement-breakpoint
CREATE POLICY "report_tallies_api_select" ON "report_tallies" AS PERMISSIVE FOR SELECT TO "korbat_api" USING (true);--> statement-breakpoint
CREATE POLICY "suspension_replies_api_all" ON "suspension_replies" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "unfounded_marks_api_all" ON "unfounded_marks" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
-- Everything below is written by hand (3e design, section 6.1): the grants and the forced columns of the schema above.
-- drizzle's migrator runs every pending migration in one transaction, with the standing ledger's migration after this one.
-- Every function is owned by the migrator, pins its search path and has EXECUTE taken from PUBLIC; a trigger function
-- fires for every role all the same. No statement here names a value that this migration added to action_kind: such a
-- value cannot be used as an enum literal before the transaction commits (enum-literals.test.ts).
--
-- 1. The grants of the three new tables. 0001's default privileges gave the API role SELECT, INSERT, UPDATE and DELETE on
-- every new public table (never TRUNCATE, which each revoke names all the same). A reply is inserted and read; marks are
-- not written by the API at all until the reporting counts' migration grants INSERT beside the trigger that checks every
-- mark; the tallies are written only by a migrator-owned trigger, and the API reads them.
REVOKE UPDATE, DELETE, TRUNCATE ON "public"."suspension_replies" FROM korbat_api;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "public"."unfounded_marks" FROM korbat_api;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "public"."report_tallies" FROM korbat_api;--> statement-breakpoint
-- 2. profiles: the API role loses the table's UPDATE and gets back every column it writes today, never the three columns
-- standing_apply derives (suspended_from, suspended_until, reports_restricted_until). drizzle's updates name only the
-- columns they set, so they keep working. INSERT stays a table privilege, since an insert names every column; the
-- trigger below keeps the three out of an insert.
REVOKE UPDATE ON "public"."profiles" FROM korbat_api;--> statement-breakpoint
GRANT UPDATE ("handle", "display_name", "bio", "avatar_path", "verified_at", "follower_count", "following_count", "post_count", "deleted_at", "handle_changed_at", "show_in_explore") ON "public"."profiles" TO korbat_api;--> statement-breakpoint
-- A profile is born with no standing: the three derived columns are null, whatever the insert supplied, for every role,
-- the pattern of 0015's post_media_insert. Only standing_apply writes them afterwards.
CREATE FUNCTION "public"."profiles_standing_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.suspended_from := NULL;
  NEW.suspended_until := NULL;
  NEW.reports_restricted_until := NULL;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."profiles_standing_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "profiles_standing_insert" BEFORE INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."profiles_standing_insert"();--> statement-breakpoint
-- 3. handle_history: the API only inserts there (onboarding, and the handle a change leaves behind), so it loses every
-- other write. A handle is born unretired, for every role: a retirement is always an update by the ledger's trigger.
REVOKE UPDATE, DELETE, TRUNCATE ON "public"."handle_history" FROM korbat_api;--> statement-breakpoint
CREATE FUNCTION "public"."handle_history_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.retired_at := NULL;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."handle_history_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "handle_history_insert" BEFORE INSERT ON "public"."handle_history" FOR EACH ROW EXECUTE FUNCTION "public"."handle_history_insert"();

CREATE TYPE "public"."activity_kind" AS ENUM('reply', 'mention', 'quote', 'follow');--> statement-breakpoint
CREATE TYPE "public"."activity_reach" AS ENUM('everyone', 'older', 'following', 'off');--> statement-breakpoint
CREATE TABLE "activity_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"kind" "activity_kind" NOT NULL,
	"actor_id" uuid NOT NULL,
	"post_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_items_post" CHECK (("activity_items"."kind"::text = 'follow') = ("activity_items"."post_id" is null)),
	CONSTRAINT "activity_items_not_self" CHECK ("activity_items"."recipient_id" <> "activity_items"."actor_id")
);
--> statement-breakpoint
ALTER TABLE "activity_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "activity_state" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"seen_at" timestamp with time zone,
	"replies" "activity_reach" DEFAULT 'everyone' NOT NULL,
	"mentions" "activity_reach" DEFAULT 'everyone' NOT NULL,
	"quotes" "activity_reach" DEFAULT 'everyone' NOT NULL,
	"follows" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "post_mentions" (
	"post_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"handle" text NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "post_mentions_post_id_account_id_pk" PRIMARY KEY("post_id","account_id"),
	CONSTRAINT "post_mentions_handle" CHECK ("post_mentions"."handle" ~ '^[a-z0-9_]{3,20}$'),
	CONSTRAINT "post_mentions_position_range" CHECK ("post_mentions"."position" between 0 and 19)
);
--> statement-breakpoint
ALTER TABLE "post_mentions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activity_items" ADD CONSTRAINT "activity_items_recipient_id_profiles_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_items" ADD CONSTRAINT "activity_items_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_items" ADD CONSTRAINT "activity_items_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_state" ADD CONSTRAINT "activity_state_account_id_profiles_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_mentions" ADD CONSTRAINT "post_mentions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_mentions" ADD CONSTRAINT "post_mentions_account_id_profiles_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_items_recipient_idx" ON "activity_items" USING btree ("recipient_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_items_post_once" ON "activity_items" USING btree ("recipient_id","post_id") WHERE post_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_items_follow_once" ON "activity_items" USING btree ("recipient_id","actor_id") WHERE kind = 'follow';--> statement-breakpoint
CREATE INDEX "activity_items_post_idx" ON "activity_items" USING btree ("post_id") WHERE post_id is not null;--> statement-breakpoint
CREATE INDEX "activity_items_actor_idx" ON "activity_items" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "activity_items_created_brin" ON "activity_items" USING brin ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "post_mentions_position" ON "post_mentions" USING btree ("post_id","position");--> statement-breakpoint
CREATE INDEX "post_mentions_account_idx" ON "post_mentions" USING btree ("account_id");--> statement-breakpoint
CREATE POLICY "activity_items_api_all" ON "activity_items" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "activity_state_api_all" ON "activity_state" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "post_mentions_api_all" ON "post_mentions" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Everything below is written by hand (2d design, sections 6.1 to 6.3, 6.5 and 6.6; Task 1). As in 0016 to 0048: every
-- function is owned by the migrator, pins its search path to public and pg_temp, names every object schema-qualified and
-- has EXECUTE taken from PUBLIC; the four trigger functions are given to nobody (they fire for every role and nobody calls
-- them), and lost_told_for to the API role alone. A guard's refusal carries its code as the message under SQLSTATE 42501
-- (activity_seen, mention_column). "For every role but the migrator" means current_user <> 'korbat_migrate': the three
-- plain triggers skip it, so the tests and the command line can write old rows and clean up as the migrator, as they do
-- for every other table. The two enums are new in this file: every function compares them as text (section 6), and the
-- unique index activity_items_follow_once names its label as a label, since an index predicate takes no cast of an enum to
-- text (enum_out is not immutable).
--
-- The CHECKs above hold the contracts' numbers and lists, and apps/api/test/integration/activity-schema.test.ts holds each
-- migrated one equal to its constant:
--   post_mentions_position_range   MENTION_STORE_MAX - 1 (packages/contracts/src/mentions.ts)
--   post_mentions_handle           a handle as apps/api/src/auth/handles.ts has it, lowercased
--   activity_kind, activity_reach  ACTIVITY_KINDS and ACTIVITY_REACH (packages/contracts/src/activity.ts), the two enums
--
-- 1. The grants (6.6). 0001's default privileges gave the API role SELECT, INSERT, UPDATE and DELETE on every new public
-- table; each table loses them all, then gets what 6.6 lists. activity_items and post_mentions: read, insert and delete,
-- never an update (a row is written once and deleted). activity_state: read, insert, delete, and UPDATE of the seen marker
-- and the four rules, under activity_state_guard, never of account_id. korbat_auth and korbat_notify get nothing.
REVOKE ALL ON "public"."activity_items", "public"."activity_state", "public"."post_mentions" FROM korbat_api;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "public"."activity_items" TO korbat_api;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "public"."activity_state" TO korbat_api;--> statement-breakpoint
GRANT UPDATE ("seen_at", "replies", "mentions", "quotes", "follows") ON "public"."activity_state" TO korbat_api;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "public"."post_mentions" TO korbat_api;--> statement-breakpoint

-- 2. activity_items_insert, plain, BEFORE INSERT, for every role but the migrator (6.1): an entry's time is the database's
-- now() (the transaction's start, with its microseconds), whatever the insert supplied, so no entry is dated into the past
-- or the future, and the list's order, the newer count and the seen marker compare times of one clock.
CREATE FUNCTION "public"."activity_items_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'korbat_migrate' THEN
    RETURN NEW;
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."activity_items_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "activity_items_insert" BEFORE INSERT ON "public"."activity_items" FOR EACH ROW EXECUTE FUNCTION "public"."activity_items_insert"();--> statement-breakpoint

-- 3. activity_state_guard, plain, BEFORE INSERT OR UPDATE, for every role but the migrator (6.2, 5.7): the seen marker
-- only moves forward and never past the server's clock. A marker an insert or an update writes anew may not be later than
-- now(), the transaction's start, which the API's least($at, now()) never passes; an update may not set it back to null or
-- earlier than it was; account_id never changes (the API role holds no UPDATE of it either). An update that leaves the
-- marker as it is, such as a change of the rules, is not held to the clock, so a clock set back never refuses one. Every
-- refusal is activity_seen under SQLSTATE 42501. The four rules need no guard: their types hold them.
CREATE FUNCTION "public"."activity_state_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'korbat_migrate' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
      RAISE EXCEPTION 'activity_seen' USING ERRCODE = '42501';
    END IF;
    IF NEW.seen_at IS NOT DISTINCT FROM OLD.seen_at THEN
      RETURN NEW;
    END IF;
    IF OLD.seen_at IS NOT NULL AND (NEW.seen_at IS NULL OR NEW.seen_at < OLD.seen_at) THEN
      RAISE EXCEPTION 'activity_seen' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.seen_at > now() THEN
    RAISE EXCEPTION 'activity_seen' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."activity_state_guard"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "activity_state_guard" BEFORE INSERT OR UPDATE ON "public"."activity_state" FOR EACH ROW EXECUTE FUNCTION "public"."activity_state_guard"();--> statement-breakpoint

-- 4. post_mentions_insert, plain, BEFORE INSERT, for every role but the migrator (6.3, 4.2): a mention is stored only with
-- a post that is visible and not imported, as createPost's own post is (its transaction inserted the post a statement
-- before). An imported post's text is never parsed (3b design, sections 5.3 and 14), and a withheld, removed, disabled or
-- deleted post gains no mention; a post that does not exist is refused the same way. No block is read: a mention is
-- stored whatever blocks exist (decision 12). The refusal is mention_column under SQLSTATE 42501.
CREATE FUNCTION "public"."post_mentions_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'korbat_migrate' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.posts p WHERE p.id = NEW.post_id AND p.state::text = 'visible' AND p.import_job_id IS NULL) THEN
    RAISE EXCEPTION 'mention_column' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."post_mentions_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "post_mentions_insert" BEFORE INSERT ON "public"."post_mentions" FOR EACH ROW EXECUTE FUNCTION "public"."post_mentions_insert"();--> statement-breakpoint

-- 5. post_mentions_erase, SECURITY DEFINER, AFTER UPDATE OF erased_at ON posts (6.3, 4.4): when a post's erased_at becomes
-- set (3c's R4 redaction, 3f's end of preservation, 3d's release), its mention rows go, so a blanked body keeps no list of
-- the handles it named. It runs for every role, the migrator included, since the erasures are the migrator's functions,
-- and as a definer its deletion rests on no grant of the role that erased. EXECUTE for nobody.
CREATE FUNCTION "public"."post_mentions_erase"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL THEN
    DELETE FROM public.post_mentions m WHERE m.post_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."post_mentions_erase"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "post_mentions_erase" AFTER UPDATE OF "erased_at" ON "public"."posts" FOR EACH ROW EXECUTE FUNCTION "public"."post_mentions_erase"();--> statement-breakpoint

-- 6. lost_told_for(p_owner, p_before, p_limit), SECURITY DEFINER, EXECUTE for the API role alone (6.5, 5.5.2): the lost
-- images of an account whose notice 3d's dispatch has handled, for Activity's list, a told-only read of the quarantine
-- beside 3d's six functions, which like them answers ids and times only (the table stays closed to the API's role). One
-- row per image the account owns (post_media.owner_id) on a post its author has not deleted, with the post's id and
-- creation time and the earliest lost_at of the image's files whose lost_told is neither pending (the mail not yet
-- handled) nor none (no notice owed), both compared as text; only a time before p_before; newest first, and by image id
-- among equal times (the files lost in one transaction share its now()); at most p_limit rows, and never more than 100.
CREATE FUNCTION "public"."lost_told_for"(p_owner uuid, p_before timestamptz, p_limit integer)
RETURNS TABLE (media_id uuid, post_id uuid, post_created_at timestamptz, lost_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.id, p.id, p.created_at, min(q.lost_at)
    FROM public.post_media m
    JOIN public.posts p ON p.id = m.post_id
    JOIN public.quarantine_files q ON q.media_id = m.id
   WHERE m.owner_id = lost_told_for.p_owner
     AND p.state::text <> 'deleted_by_author'
     AND q.lost_at IS NOT NULL
     AND q.lost_told::text NOT IN ('pending', 'none')
   GROUP BY m.id, p.id, p.created_at
  HAVING min(q.lost_at) < lost_told_for.p_before
   ORDER BY 4 DESC, 1 DESC
   LIMIT least(greatest(lost_told_for.p_limit, 0), 100)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."lost_told_for"(uuid, timestamptz, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."lost_told_for"(uuid, timestamptz, integer) TO korbat_api;

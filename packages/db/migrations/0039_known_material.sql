CREATE TABLE "media_hashes" (
	"media_id" uuid PRIMARY KEY NOT NULL,
	"sha256" "bytea" NOT NULL,
	"sha1" "bytea" NOT NULL,
	"md5" "bytea" NOT NULL,
	"pdq" "bytea",
	"pdq_quality" smallint,
	"pdq_impl" smallint,
	"check_state" text NOT NULL,
	"checked_at" timestamp with time zone,
	"source" text,
	CONSTRAINT "media_hashes_check_state" CHECK ("media_hashes"."check_state" in ('pending', 'clear', 'matched', 'unchecked', 'capped')),
	CONSTRAINT "media_hashes_lengths" CHECK (octet_length("media_hashes"."sha256") = 32 and octet_length("media_hashes"."sha1") = 20 and octet_length("media_hashes"."md5") = 16),
	CONSTRAINT "media_hashes_pdq" CHECK (("media_hashes"."pdq" is null or octet_length("media_hashes"."pdq") = 32) and ("media_hashes"."pdq_quality" is null or "media_hashes"."pdq_quality" between 0 and 100)),
	CONSTRAINT "media_hashes_source" CHECK (char_length("media_hashes"."source") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "media_hashes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "media_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"case_id" uuid,
	"source" text NOT NULL,
	"list_version" text,
	"hash_type" text NOT NULL,
	"match_kind" text NOT NULL,
	"classification" text,
	"listed" boolean NOT NULL,
	"acting" boolean NOT NULL,
	"hash" "bytea",
	"handled_at" timestamp with time zone,
	"queried_at" timestamp with time zone NOT NULL,
	"erased_at" timestamp with time zone,
	CONSTRAINT "media_matches_hash_type" CHECK ("media_matches"."hash_type" in ('sha256', 'sha1', 'md5', 'pdq')),
	CONSTRAINT "media_matches_kind" CHECK ("media_matches"."match_kind" in ('exact', 'near')),
	CONSTRAINT "media_matches_texts" CHECK (char_length("media_matches"."source") between 1 and 100 and char_length("media_matches"."list_version") between 1 and 100 and char_length("media_matches"."classification") between 1 and 100),
	CONSTRAINT "media_matches_erased" CHECK (("media_matches"."erased_at" is null) = ("media_matches"."hash" is not null) and ("media_matches"."erased_at" is null) = ("media_matches"."classification" is not null)),
	CONSTRAINT "media_matches_acting" CHECK (not "media_matches"."acting" or "media_matches"."listed")
);
--> statement-breakpoint
ALTER TABLE "media_matches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "upload_refusals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"owner_id" uuid,
	"match_id" uuid NOT NULL,
	"refused_at" timestamp with time zone NOT NULL,
	"told" "delivery_state" DEFAULT 'pending' NOT NULL,
	"lifted_told" "delivery_state",
	"objection" text,
	"objected_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_as" text,
	"end_reason" text,
	"ended_by" uuid,
	"notification_id" uuid,
	"release_id" uuid,
	CONSTRAINT "upload_refusals_media_id_unique" UNIQUE("media_id"),
	CONSTRAINT "upload_refusals_end_as" CHECK ("upload_refusals"."end_as" in ('report', 'no_report')),
	CONSTRAINT "upload_refusals_end_reason" CHECK ("upload_refusals"."end_reason" in ('source_withdrew', 'counsel_no_duty', 'other')),
	CONSTRAINT "upload_refusals_ended" CHECK (("upload_refusals"."end_as" is null) = ("upload_refusals"."ended_at" is null) and ("upload_refusals"."end_as" is null) = ("upload_refusals"."ended_by" is null) and ("upload_refusals"."end_reason" is not null) = ("upload_refusals"."end_as" is not distinct from 'no_report')),
	CONSTRAINT "upload_refusals_objection" CHECK (("upload_refusals"."objection" is null or "upload_refusals"."objected_at" is not null) and char_length("upload_refusals"."objection") between 1 and 2000),
	CONSTRAINT "upload_refusals_lifted" CHECK ("upload_refusals"."lifted_told" is null or "upload_refusals"."end_as" is not distinct from 'no_report')
);
--> statement-breakpoint
ALTER TABLE "upload_refusals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alert_outbox" DROP CONSTRAINT "alert_outbox_kind";--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "match_answer_reason" text;--> statement-breakpoint
ALTER TABLE "media_hashes" ADD CONSTRAINT "media_hashes_media_id_post_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."post_media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_refusals" ADD CONSTRAINT "upload_refusals_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_refusals" ADD CONSTRAINT "upload_refusals_match_id_media_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."media_matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_refusals" ADD CONSTRAINT "upload_refusals_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_hashes_retry_idx" ON "media_hashes" USING btree ("check_state") WHERE check_state in ('pending', 'unchecked', 'capped');--> statement-breakpoint
CREATE INDEX "media_matches_media_idx" ON "media_matches" USING btree ("media_id") WHERE erased_at is null;--> statement-breakpoint
CREATE INDEX "media_matches_open_idx" ON "media_matches" USING btree ("queried_at") WHERE handled_at is null and erased_at is null;--> statement-breakpoint
CREATE INDEX "upload_refusals_owner_idx" ON "upload_refusals" USING btree ("owner_id","refused_at");--> statement-breakpoint
ALTER TABLE "automated_signals" ADD CONSTRAINT "automated_signals_match_id_media_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."media_matches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_match_answer_reason" CHECK ("decisions"."match_answer_reason" in ('source_withdrew', 'counsel', 'other'));--> statement-breakpoint
ALTER TABLE "alert_outbox" ADD CONSTRAINT "alert_outbox_kind" CHECK ("alert_outbox"."kind" in ('contact_mail', 'contact_mail_escalated', 'order_due', 'order_opened', 'order_corrected', 'order_effected', 'order_reinstated', 'order_unverified', 'hold_ending', 'report_owed', 'handover_undestroyed', 'copy_overdue', 'copy_taken', 'alert_channel_down', 'mailbox_unreachable', 'alert_test', 'moderation_urgent', 'moderation_waiting', 'moderation_burst', 'moderation_reads', 'moderation_reveal', 'moderation_csam_lifted', 'quarantine_due', 'quarantine_lost', 'release_undestroyed', 'seal_released', 'edge_purge_failed', 'head_unwitnessed', 'head_missed', 'automated_objection', 'automation_capped', 'automated_waiting', 'matcher_down', 'hold_ended_unreported'));--> statement-breakpoint
CREATE POLICY "media_hashes_api_all" ON "media_hashes" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "media_matches_api_all" ON "media_matches" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "upload_refusals_api_all" ON "upload_refusals" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Everything below is written by hand (3d design, sections 2 rows 26 to 37, 5 "The lock order", 6 and 6.7; Task 7).
-- The design numbers this migration 0036; earlier tasks of 3d added migrations the design did not foresee, so it is 0039.
-- As in 0016 to 0038: every function is owned by the migrator, pins its search path to public and pg_temp (auth's too
-- where it writes auth.report_holds), names every object schema-qualified and has EXECUTE taken from PUBLIC; an error
-- carries its code as the message under SQLSTATE P0001, and a guard's refusal is moderation_column under SQLSTATE 42501,
-- as 3c's guards answer. "For every role but the migrator" means current_user <> 'korbat_migrate'. No function or view
-- here, and no line added to a replaced function, holds an interval literal or a number of automation_rules() or
-- release_rules(): each reads its function. The new values of intake_kind and intake_channel (0038) are named as enum
-- literals only inside PL/pgSQL bodies, and compared as text everywhere else (the enum-literal rule).
--
-- 1. The grants. 0001's default privileges gave the API role every right on a new public table; each table loses them
-- all, then gets what section 6.7 lists. media_hashes: every right, since the media module writes, reads and (with the
-- matcher off) deletes them. media_matches: read, insert, and case_id and handled_at, each once by its guard.
-- upload_refusals: read, insert, and the two notices' states and the objection, which its guard lets it write once; the
-- end, the record of the report and the release are the definer functions' and the migrator's.
REVOKE ALL ON "public"."media_hashes", "public"."media_matches", "public"."upload_refusals" FROM korbat_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "public"."media_hashes" TO korbat_api;--> statement-breakpoint
GRANT SELECT, INSERT ON "public"."media_matches" TO korbat_api;--> statement-breakpoint
GRANT UPDATE ("case_id", "handled_at") ON "public"."media_matches" TO korbat_api;--> statement-breakpoint
GRANT SELECT, INSERT ON "public"."upload_refusals" TO korbat_api;--> statement-breakpoint
GRANT UPDATE ("told", "lifted_told", "objection", "objected_at") ON "public"."upload_refusals" TO korbat_api;--> statement-breakpoint

-- 2. match_listed(source, classification) and match_acting(source, classification), SQL, IMMUTABLE (row 28): two closed
-- lists of pairs. The first holds the classifications by which a source itself names child sexual abuse material, and
-- never a wider class; the second is a part of the first, the classifications on which a program may act. In this build
-- each holds the test adapter's one listed and acting classification and nothing else (apps/api/src/media/match-adapter.ts,
-- MATCH_LISTED and MATCH_ACTING, which a database test holds the two functions to). A source's adapter adds its pairs by a
-- migration that replaces both. The API's role calls them through media_matches_insert, a plain trigger.
CREATE FUNCTION "public"."match_listed"(source text, classification text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT (match_listed.source, match_listed.classification) IN (('test', 'test_listed'))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."match_listed"(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."match_listed"(text, text) TO korbat_api;--> statement-breakpoint
CREATE FUNCTION "public"."match_acting"(source text, classification text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT (match_acting.source, match_acting.classification) IN (('test', 'test_listed'))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."match_acting"(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."match_acting"(text, text) TO korbat_api;--> statement-breakpoint

-- 3. media_matches' two triggers. media_matches_insert, plain, BEFORE INSERT, for every role: `listed` is what
-- match_listed answers for the source and the classification as returned; `acting` is listed, on match_acting, and
-- reported exact, whatever the hash type (row 28; review rulings 3 and 4); queried_at is now(); the case, the mark and the
-- erasure are null. media_matches_guard, plain, BEFORE UPDATE, for every role but the migrator: case_id and handled_at
-- change only from null, handled_at forced to now(), and nothing else changes.
CREATE FUNCTION "public"."media_matches_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.listed := coalesce(public.match_listed(NEW.source, NEW.classification), false);
  NEW.acting := NEW.listed AND coalesce(public.match_acting(NEW.source, NEW.classification), false) AND NEW.match_kind = 'exact';
  NEW.queried_at := now();
  NEW.case_id := NULL;
  NEW.handled_at := NULL;
  NEW.erased_at := NULL;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."media_matches_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "media_matches_insert" BEFORE INSERT ON "public"."media_matches" FOR EACH ROW EXECUTE FUNCTION "public"."media_matches_insert"();--> statement-breakpoint
CREATE FUNCTION "public"."media_matches_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'korbat_migrate' THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.media_id IS DISTINCT FROM OLD.media_id OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.list_version IS DISTINCT FROM OLD.list_version OR NEW.hash_type IS DISTINCT FROM OLD.hash_type
     OR NEW.match_kind IS DISTINCT FROM OLD.match_kind OR NEW.classification IS DISTINCT FROM OLD.classification
     OR NEW.listed IS DISTINCT FROM OLD.listed OR NEW.acting IS DISTINCT FROM OLD.acting OR NEW.hash IS DISTINCT FROM OLD.hash
     OR NEW.queried_at IS DISTINCT FROM OLD.queried_at OR NEW.erased_at IS DISTINCT FROM OLD.erased_at
     OR (OLD.case_id IS NOT NULL AND NEW.case_id IS DISTINCT FROM OLD.case_id)
     OR (OLD.handled_at IS NOT NULL AND NEW.handled_at IS DISTINCT FROM OLD.handled_at) THEN
    RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
  END IF;
  IF OLD.handled_at IS NULL AND NEW.handled_at IS NOT NULL THEN
    NEW.handled_at := now();
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."media_matches_guard"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "media_matches_guard" BEFORE UPDATE ON "public"."media_matches" FOR EACH ROW EXECUTE FUNCTION "public"."media_matches_guard"();--> statement-breakpoint

-- 4. upload_refusals_insert, SECURITY DEFINER, BEFORE INSERT (6.7, row 35). It takes the image's row FOR NO KEY UPDATE
-- and reads it again in a statement of its own: upload_attached unless the row exists, is on no post and is owned by
-- owner_id, and the match record names the same image; refusal_not_acting unless that record is acting. So a row that an
-- attach reached first is never held: its match takes the path of a match on a post. Then the cap's advisory lock, the
-- key automated decisions take ('korbat.decision_cap:system'), and refusals_capped once refusals_per_hour refusals were
-- written in the last hour: the caller rolls back to its savepoint, writes neither the record nor a refusal, and leaves
-- the upload processing with its check capped. It forces refused_at, the notices' states and every later column.
CREATE FUNCTION "public"."upload_refusals_insert"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m public.post_media;
  x public.media_matches;
  rules record;
  v_written integer;
BEGIN
  PERFORM 1 FROM public.post_media p WHERE p.id = NEW.media_id FOR NO KEY UPDATE;
  SELECT p.* INTO m FROM public.post_media p WHERE p.id = NEW.media_id;
  SELECT y.* INTO x FROM public.media_matches y WHERE y.id = NEW.match_id;
  IF m.id IS NULL OR m.post_id IS NOT NULL OR m.owner_id IS DISTINCT FROM NEW.owner_id OR x.id IS NULL OR x.media_id IS DISTINCT FROM NEW.media_id THEN
    RAISE EXCEPTION 'upload_attached';
  END IF;
  IF NOT x.acting THEN
    RAISE EXCEPTION 'refusal_not_acting';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('korbat.decision_cap:system', 0));
  SELECT r.* INTO rules FROM public.automation_rules() r;
  SELECT count(*)::integer INTO v_written FROM public.upload_refusals u WHERE u.refused_at > now() - make_interval(hours => 1);
  IF v_written >= rules.refusals_per_hour THEN
    RAISE EXCEPTION 'refusals_capped';
  END IF;
  NEW.refused_at := now();
  NEW.told := 'pending';
  NEW.lifted_told := NULL;
  NEW.objection := NULL;
  NEW.objected_at := NULL;
  NEW.ended_at := NULL;
  NEW.end_as := NULL;
  NEW.end_reason := NULL;
  NEW.ended_by := NULL;
  NEW.notification_id := NULL;
  NEW.release_id := NULL;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."upload_refusals_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "upload_refusals_insert" BEFORE INSERT ON "public"."upload_refusals" FOR EACH ROW EXECUTE FUNCTION "public"."upload_refusals_insert"();--> statement-breakpoint

-- 5. upload_refusals_hold, SECURITY DEFINER, AFTER INSERT (6.7, row 35, note 35): the image row's hold_until becomes
-- infinity, so gate K keeps it against the sweeper, the owner's delete and the purge, and no timer ends the hold; the
-- match record is marked handled; and the uploader's row of F's auth.report_holds is set as report_open() sets it for a
-- seal taken while deciding (set_at now(), seal_final false): inserted as released when there is none, locked, then set
-- again when it is released or its days have passed, and left as it is while it is set, so the purge of an account
-- deleted in the next days leaves its address for a report.
CREATE FUNCTION "public"."upload_refusals_hold"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r record;
BEGIN
  UPDATE public.post_media p SET hold_until = 'infinity'::timestamptz WHERE p.id = NEW.media_id;
  UPDATE public.media_matches x SET handled_at = now() WHERE x.id = NEW.match_id AND x.handled_at IS NULL;
  IF NEW.owner_id IS NOT NULL THEN
    SELECT o.* INTO r FROM public.order_rules() o;
    INSERT INTO auth.report_holds (user_id, set_at, seal_final, released_at) VALUES (NEW.owner_id, now(), false, now())
    ON CONFLICT (user_id) DO NOTHING;
    PERFORM 1 FROM auth.report_holds h WHERE h.user_id = NEW.owner_id FOR UPDATE;
    UPDATE auth.report_holds h SET set_at = now(), seal_final = false, released_at = NULL, release_reason = NULL
     WHERE h.user_id = NEW.owner_id
       AND (h.released_at IS NOT NULL OR h.set_at + make_interval(days => r.report_hold_days) <= now());
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."upload_refusals_hold"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "upload_refusals_hold" AFTER INSERT ON "public"."upload_refusals" FOR EACH ROW EXECUTE FUNCTION "public"."upload_refusals_hold"();--> statement-breakpoint

-- 6. upload_refusals_guard, plain, BEFORE UPDATE, for every role but the migrator (6.7, 7.12 step 2). The objection is
-- written once, objected_at forced now(), and only while the refusal has none, is not released and did not end as
-- no_report: one rule for the guard, the route, the app's control and the notice. Each notice's state moves only from
-- pending. Nothing else changes: the end, the record of the report and the release are the definer functions' and the
-- migrator's, which run as the owner.
CREATE FUNCTION "public"."upload_refusals_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'korbat_migrate' THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.media_id IS DISTINCT FROM OLD.media_id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.match_id IS DISTINCT FROM OLD.match_id OR NEW.refused_at IS DISTINCT FROM OLD.refused_at
     OR NEW.ended_at IS DISTINCT FROM OLD.ended_at OR NEW.end_as IS DISTINCT FROM OLD.end_as OR NEW.end_reason IS DISTINCT FROM OLD.end_reason
     OR NEW.ended_by IS DISTINCT FROM OLD.ended_by OR NEW.notification_id IS DISTINCT FROM OLD.notification_id
     OR NEW.release_id IS DISTINCT FROM OLD.release_id
     OR (NEW.told IS DISTINCT FROM OLD.told AND OLD.told::text <> 'pending')
     OR (NEW.lifted_told IS DISTINCT FROM OLD.lifted_told AND OLD.lifted_told::text IS DISTINCT FROM 'pending') THEN
    RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
  END IF;
  IF NEW.objection IS DISTINCT FROM OLD.objection OR NEW.objected_at IS DISTINCT FROM OLD.objected_at THEN
    IF OLD.objection IS NOT NULL OR OLD.objected_at IS NOT NULL OR OLD.release_id IS NOT NULL OR OLD.end_as IS NOT DISTINCT FROM 'no_report' OR NEW.objection IS NULL THEN
      RAISE EXCEPTION 'objection_not_open';
    END IF;
    NEW.objected_at := now();
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."upload_refusals_guard"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "upload_refusals_guard" BEFORE UPDATE ON "public"."upload_refusals" FOR EACH ROW EXECUTE FUNCTION "public"."upload_refusals_guard"();--> statement-breakpoint

-- 7. post_media_refused, SECURITY DEFINER, BEFORE UPDATE OF post_id ON post_media (6.7, 7.8 step 5): upload_refused when
-- a row that had no post gains one while a row of upload_refusals names it, whatever its end, while the row is erased (a
-- replay's mark of a released upload whose refusal a restore lost), or while its hold_until is infinity (a replay's mark
-- of a hold ended as report whose refusal a restore lost). It is keyed on the refusal, never on every match record: a flag
-- blocks nothing, and its upload may be posted. The refusals are read in a statement of their own, after the row's lock,
-- so an attach that waited for a refusal's commit sees it.
CREATE FUNCTION "public"."post_media_refused"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_refused boolean;
BEGIN
  IF OLD.post_id IS NOT NULL OR NEW.post_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.upload_refusals r WHERE r.media_id = OLD.id) INTO v_refused;
  IF v_refused OR OLD.erased_at IS NOT NULL OR OLD.hold_until = 'infinity'::timestamptz THEN
    RAISE EXCEPTION 'upload_refused';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."post_media_refused"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "post_media_refused" BEFORE UPDATE OF "post_id" ON "public"."post_media" FOR EACH ROW EXECUTE FUNCTION "public"."post_media_refused"();--> statement-breakpoint

-- 8. upload_hold_end(refusal, end_as, reason, staff): an admin's end of a held upload's hold (6.7, 7.12 step 4), called by
-- the route after it took the uploader's profile. In this order:
--   1. the refusal's row FOR UPDATE; hold_not_open unless the hold has not ended; or it ended as report, is not released,
--      and end_as is no_report (a report that turned out not to be owed); or it ended as no_report, its image row's
--      hold_until still lies ahead, and end_as is report (a second admin who read the alert);
--   2. admin_required unless `staff` is an admin, read FOR SHARE (staff_confirmation_ended for an account that ended);
--   3. invalid_hold_end unless end_as is report with no reason or no_report with a reason of the closed list;
--   4. the end's four columns. no_report: the image row's hold_until becomes now() plus no_report_hours, the notice that
--      the hold was lifted is owed (lifted_told pending, mailed once that delay has passed and the end still stands), and
--      the hold on the uploader's address is released (declined) when nothing else holds it: no record of the account is
--      owed and no other refusal of the account is unended or held for a report and not released. report: the image row's
--      hold_until is infinity again and nothing is owed; when it follows a no_report, the address is held again from the
--      refusal's own time (a released row loses its release, a row F's retention deleted is inserted, a set row is left),
--      so the hold runs for what is left of the days from the refusal and never longer;
--   5. an open gap of the class release whose lost line is an upload_hold_ended of this refusal is closed as reapplied,
--      naming the refusal (closed_by holds a gap's closing record; a decision's id for 3f's classes).
-- The route's audit row upload_hold_ended comes last, and upload_refusals_confirmed holds the end to it at commit.
CREATE FUNCTION "public"."upload_hold_end"(refusal uuid, end_as text, reason text, staff uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u public.upload_refusals;
  rules record;
  o record;
  v_until timestamptz;
  v_role text;
BEGIN
  SELECT x.* INTO u FROM public.upload_refusals x WHERE x.id = upload_hold_end.refusal FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  SELECT m.hold_until INTO v_until FROM public.post_media m WHERE m.id = u.media_id;
  IF NOT (u.end_as IS NULL
          OR (u.end_as = 'report' AND u.release_id IS NULL AND upload_hold_end.end_as = 'no_report')
          OR (u.end_as = 'no_report' AND v_until IS NOT NULL AND v_until > now() AND upload_hold_end.end_as = 'report')) THEN
    RAISE EXCEPTION 'hold_not_open';
  END IF;
  SELECT x.role::text INTO v_role FROM auth.users x
   WHERE x.id = upload_hold_end.staff AND x.deleted_at IS NULL AND x.role <> 'user' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_confirmation_ended';
  END IF;
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  IF NOT ((upload_hold_end.end_as = 'report' AND upload_hold_end.reason IS NULL)
          OR (upload_hold_end.end_as = 'no_report' AND upload_hold_end.reason IN ('source_withdrew', 'counsel_no_duty', 'other'))) THEN
    RAISE EXCEPTION 'invalid_hold_end';
  END IF;

  SELECT x.* INTO rules FROM public.automation_rules() x;
  IF upload_hold_end.end_as = 'no_report' THEN
    UPDATE public.upload_refusals x
       SET ended_at = now(), end_as = 'no_report', end_reason = upload_hold_end.reason, ended_by = upload_hold_end.staff, lifted_told = 'pending'
     WHERE x.id = u.id;
    UPDATE public.post_media m SET hold_until = now() + make_interval(hours => rules.no_report_hours) WHERE m.id = u.media_id;
    IF u.owner_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.authority_notifications n WHERE n.account_id = u.owner_id AND n.state = 'owed')
       AND NOT EXISTS (SELECT 1 FROM public.upload_refusals x
                        WHERE x.owner_id = u.owner_id AND x.id <> u.id AND (x.end_as IS NULL OR (x.end_as = 'report' AND x.release_id IS NULL))) THEN
      UPDATE auth.report_holds h SET released_at = now(), release_reason = 'declined' WHERE h.user_id = u.owner_id AND h.released_at IS NULL;
    END IF;
  ELSE
    UPDATE public.upload_refusals x
       SET ended_at = now(), end_as = 'report', end_reason = NULL, ended_by = upload_hold_end.staff, lifted_told = NULL
     WHERE x.id = u.id;
    UPDATE public.post_media m SET hold_until = 'infinity'::timestamptz WHERE m.id = u.media_id;
    IF u.end_as = 'no_report' AND u.owner_id IS NOT NULL THEN
      INSERT INTO auth.report_holds (user_id, set_at, seal_final, released_at) VALUES (u.owner_id, u.refused_at, false, NULL)
      ON CONFLICT (user_id) DO NOTHING;
      PERFORM 1 FROM auth.report_holds h WHERE h.user_id = u.owner_id FOR UPDATE;
      UPDATE auth.report_holds h SET set_at = u.refused_at, released_at = NULL, release_reason = NULL
       WHERE h.user_id = u.owner_id AND h.released_at IS NOT NULL;
    END IF;
  END IF;

  UPDATE public.restore_gaps g SET closed_at = now(), closed_by = u.id, disposition = 'reapplied'
   WHERE g.class = 'release' AND g.closed_at IS NULL AND g.action = 'upload_hold_ended' AND g.target_id = u.id::text;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."upload_hold_end"(uuid, text, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."upload_hold_end"(uuid, text, text, uuid) TO korbat_api;--> statement-breakpoint

-- 9. upload_refusals_confirmed, deferred to the commit, when a refusal's end changes (6.7): the transaction's head audit
-- row must be upload_hold_ended on this refusal, carry a step-up, have been written by ended_by, name the refusal's image
-- in metadata.mediaId (a restore may hold the image and not the refusal), and hold params equal to the end under the
-- contracts' names. Otherwise the commit is refused, release_mismatch. It only reads, so the audit row stays last.
CREATE FUNCTION "public"."upload_refusals_confirmed"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a public.audit_log;
  u public.upload_refusals;
BEGIN
  SELECT x.* INTO u FROM public.upload_refusals x WHERE x.id = NEW.id;
  SELECT l.* INTO a FROM public.audit_head h JOIN public.audit_log l ON l.chain_seq = h.seq WHERE h.id = 1;
  IF NOT FOUND OR a.action IS DISTINCT FROM 'upload_hold_ended' OR a.target_type IS DISTINCT FROM 'upload_refusal' OR a.target_id IS DISTINCT FROM u.id::text THEN
    RAISE EXCEPTION 'release_mismatch' USING DETAIL = 'audit: the transaction''s last audit row is not upload_hold_ended on this refusal.';
  END IF;
  IF a.step_up IS NULL OR a.actor_id IS DISTINCT FROM u.ended_by THEN
    RAISE EXCEPTION 'release_mismatch' USING DETAIL = 'stepUp: the audit row carries no confirmation by the admin who ended the hold.';
  END IF;
  IF a.metadata ->> 'mediaId' IS DISTINCT FROM u.media_id::text THEN
    RAISE EXCEPTION 'release_mismatch' USING DETAIL = 'mediaId: the audit row does not name the refusal''s image.';
  END IF;
  IF a.metadata -> 'params' IS DISTINCT FROM jsonb_build_object('endAs', u.end_as, 'reason', u.end_reason) THEN
    RAISE EXCEPTION 'release_mismatch' USING DETAIL = 'params: what the key confirmed is not how the hold ended.';
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."upload_refusals_confirmed"() FROM PUBLIC;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "upload_refusals_confirmed" AFTER UPDATE OF "ended_at", "end_as" ON "public"."upload_refusals" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD.ended_at IS DISTINCT FROM NEW.ended_at OR OLD.end_as IS DISTINCT FROM NEW.end_as) EXECUTE FUNCTION "public"."upload_refusals_confirmed"();--> statement-breakpoint

-- 10. upload_release_facts(refusal): what Held uploads shows of a hold ended as report before a release (8.6, 10.3), one
-- row, read as the owner since 3f's records and the leaves are closed to the API's role: the record upload-report opened
-- (sent, its reference, the authority's answer as what it is, which no step of upload_release reads, and when the files
-- were handed over), whether both of the image's files are in the quarantine by record, moved or lost, the newest leave
-- of that record that is not withdrawn, and whether the uploader's notice of a release taken now would be held. Null
-- members for a refusal without a record.
CREATE FUNCTION "public"."upload_release_facts"(refusal uuid)
RETURNS TABLE (reported boolean, their_reference text, answer text, answered_at timestamptz, handed_over_at timestamptz, quarantined boolean,
               leave_id uuid, leave_from text, leave_reference text, leave_received_on date, leave_untold boolean, leave_untold_until timestamptz, tell_held boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH u AS (
    SELECT x.* FROM public.upload_refusals x WHERE x.id = upload_release_facts.refusal
  ), standing_leave AS (
    SELECT l.* FROM public.release_leaves l JOIN u ON l.notification_id = u.notification_id
     WHERE l.withdrawn_at IS NULL ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1
  )
  SELECT coalesce(n.state = 'sent', false), n.their_reference, n.answer, n.answered_at,
         (SELECT max(p.delivered_at) FROM public.productions p WHERE p.notification_id = u.notification_id AND p.files IS NOT NULL),
         (SELECT count(*) FROM public.quarantine_files q WHERE q.media_id = u.media_id AND q.returned_at IS NULL AND q.destroyed_at IS NULL) >= 2,
         l.id, l.leave_from, l.reference, l.received_on, l.untold, l.untold_until,
         NOT public.release_may_tell(l.id, u.notification_id, '{}'::uuid[])
    FROM u
    LEFT JOIN public.authority_notifications n ON n.id = u.notification_id
    LEFT JOIN standing_leave l ON true
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."upload_release_facts"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."upload_release_facts"(uuid) TO korbat_api;--> statement-breakpoint

-- 11. upload_release(refusal, basis, leave, staff): seal_release for a held upload (6.7, 7.12 step 5), called by the
-- route after it took the uploader's profile. In this order:
--   1. the refusal's row FOR UPDATE: release_not_open unless it ended as report and is not released;
--   2. the facts, read after the lock from the record that notification_id names: release_not_reported unless that
--      record is sent; release_not_quarantined unless both of the image's files are in the quarantine by record;
--   3. the ground, as seal_release's step 3, with the leave recorded against that record and not withdrawn, read FOR
--      SHARE; the period while silence_days is null: release_period_unset. The record's answer is no ground;
--   4. admin_required, as seal_release's step 4;
--   5. one row of releases with upload_refusal_id, the leave and no posts; the refusal's release_id; erased_at and
--      hold_until now() on the one image row. releases_confirmed holds the release to its audit row upload_released.
CREATE FUNCTION "public"."upload_release"(refusal uuid, basis text, leave uuid, staff uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u public.upload_refusals;
  rules record;
  l public.release_leaves;
  v_role text;
  v_moved timestamptz;
  v_release uuid := gen_random_uuid();
BEGIN
  SELECT x.* INTO u FROM public.upload_refusals x WHERE x.id = upload_release.refusal FOR UPDATE;
  IF NOT FOUND OR u.end_as IS DISTINCT FROM 'report' OR u.release_id IS NOT NULL THEN
    RAISE EXCEPTION 'release_not_open';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.authority_notifications n WHERE n.id = u.notification_id AND n.state = 'sent') THEN
    RAISE EXCEPTION 'release_not_reported';
  END IF;
  IF (SELECT count(*) FROM public.quarantine_files q WHERE q.media_id = u.media_id AND q.returned_at IS NULL AND q.destroyed_at IS NULL) < 2 THEN
    RAISE EXCEPTION 'release_not_quarantined';
  END IF;
  SELECT x.* INTO rules FROM public.release_rules() x;
  IF upload_release.basis = 'leave' THEN
    SELECT x.* INTO l FROM public.release_leaves x
     WHERE x.id = upload_release.leave AND x.notification_id = u.notification_id AND x.withdrawn_at IS NULL
       FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'release_no_leave';
    END IF;
  ELSIF upload_release.basis = 'period' THEN
    IF rules.silence_days IS NULL THEN
      RAISE EXCEPTION 'release_period_unset';
    END IF;
    RAISE EXCEPTION 'release_period_running';
  ELSE
    RAISE EXCEPTION 'release_no_leave';
  END IF;
  SELECT x.role::text INTO v_role FROM auth.users x
   WHERE x.id = upload_release.staff AND x.deleted_at IS NULL AND x.role <> 'user' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_confirmation_ended';
  END IF;
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  SELECT max(q.moved_at) INTO v_moved FROM public.quarantine_files q WHERE q.media_id = u.media_id;
  INSERT INTO public.releases (id, upload_refusal_id, post_ids, basis, leave_id, their_reference, released_by, released_at, backups_clear_at, author_notice)
  VALUES (v_release, u.id, '{}'::uuid[], upload_release.basis, l.id, l.reference, upload_release.staff, now(),
          greatest(now(), coalesce(v_moved, now())) + make_interval(days => rules.backup_days), 'pending');
  UPDATE public.upload_refusals x SET release_id = v_release WHERE x.id = u.id;
  UPDATE public.post_media m SET erased_at = coalesce(m.erased_at, now()), hold_until = now() WHERE m.id = u.media_id;
  RETURN v_release;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."upload_release"(uuid, text, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."upload_release"(uuid, text, uuid, uuid) TO korbat_api;--> statement-breakpoint

-- 12. upload_release_replay(original, refusal, media, basis, leave, their_reference, released_at): release_replay for a
-- held upload (6.7, 7.3 step 2), as the migrator; EXECUTE to nobody. present when that release, or a replay of it, is
-- there; replay_no_gap unless an open gap of the class release names that release with these params; else the releases
-- row with replay_of, the original time and imported_at (its notice forced held or none by releases_notice); when the
-- restored database holds the refusal, its release_id; and, whether it does or not, erased_at and hold_until now() on the
-- image row that `media` names, when that row exists and is on no post: an upload the backup knew only as ready and
-- unchecked must not be attachable after korbat recorded its destruction. It closes the gap as imported.
CREATE FUNCTION "public"."upload_release_replay"(original uuid, refusal uuid, media uuid, basis text, leave uuid, their_reference text, released_at timestamptz) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  g public.restore_gaps;
  rules record;
  v_id uuid := gen_random_uuid();
  v_held boolean;
  v_erased integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.releases r WHERE r.id = upload_release_replay.original OR r.replay_of = upload_release_replay.original) THEN
    RETURN 'present';
  END IF;
  SELECT x.* INTO g FROM public.restore_gaps x
   WHERE x.class = 'release' AND x.closed_at IS NULL AND x.action = 'upload_released' AND x.metadata ->> 'releaseId' = upload_release_replay.original::text
     AND x.target_id = upload_release_replay.refusal::text AND x.metadata ->> 'mediaId' = upload_release_replay.media::text
     AND x.metadata -> 'params' = jsonb_build_object('basis', upload_release_replay.basis, 'leaveId', upload_release_replay.leave, 'theirReference', upload_release_replay.their_reference)
   ORDER BY x.place, x.id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'replay_no_gap';
  END IF;
  SELECT x.* INTO rules FROM public.release_rules() x;
  v_held := EXISTS (SELECT 1 FROM public.upload_refusals u WHERE u.id = upload_release_replay.refusal);
  INSERT INTO public.releases (id, upload_refusal_id, post_ids, basis, leave_id, their_reference, released_at, replay_of, backups_clear_at, author_notice, imported_at)
  VALUES (v_id, upload_release_replay.refusal, '{}'::uuid[], upload_release_replay.basis, upload_release_replay.leave, upload_release_replay.their_reference,
          coalesce(upload_release_replay.released_at, g.acted_at), upload_release_replay.original, now() + make_interval(days => rules.backup_days), 'none', now());
  IF v_held THEN
    UPDATE public.upload_refusals u SET release_id = v_id WHERE u.id = upload_release_replay.refusal AND u.release_id IS NULL;
  END IF;
  UPDATE public.post_media m SET erased_at = coalesce(m.erased_at, now()), hold_until = now()
   WHERE m.id = upload_release_replay.media AND m.post_id IS NULL;
  GET DIAGNOSTICS v_erased = ROW_COUNT;
  UPDATE public.restore_gaps x SET closed_at = now(), disposition = 'imported' WHERE x.id = g.id;
  RETURN format('replayed %s %s', CASE WHEN v_held THEN 1 ELSE 0 END, v_erased);
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."upload_release_replay"(uuid, uuid, uuid, text, uuid, text, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- 13. upload_hold_replay(refusal, media, end_as, ended_at): staff.js release-replay for a lost upload_hold_ended line
-- (6.7, 7.3 step 2), as the migrator; EXECUTE to nobody. present, with nothing written, when the restored database holds
-- the refusal: its gap waits for the admin, who ends the hold again and upload_hold_end closes it. Otherwise
-- replay_no_gap unless an open gap of the class release names the line; then, on the image row `media` names when it
-- exists and is on no post: for report, hold_until infinity, so nothing sweeps the file and post_media_refused lets
-- nobody post it; for no_report, erased_at and hold_until now(), as the end meant. It closes the gap as imported.
CREATE FUNCTION "public"."upload_hold_replay"(refusal uuid, media uuid, end_as text, ended_at timestamptz) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  g public.restore_gaps;
  v_changed integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.upload_refusals u WHERE u.id = upload_hold_replay.refusal) THEN
    RETURN 'present';
  END IF;
  SELECT x.* INTO g FROM public.restore_gaps x
   WHERE x.class = 'release' AND x.closed_at IS NULL AND x.action = 'upload_hold_ended' AND x.target_id = upload_hold_replay.refusal::text
     AND x.metadata ->> 'mediaId' = upload_hold_replay.media::text AND x.metadata -> 'params' ->> 'endAs' = upload_hold_replay.end_as
   ORDER BY x.place, x.id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'replay_no_gap';
  END IF;
  IF upload_hold_replay.end_as = 'report' THEN
    UPDATE public.post_media m SET hold_until = 'infinity'::timestamptz WHERE m.id = upload_hold_replay.media AND m.post_id IS NULL;
  ELSE
    UPDATE public.post_media m SET erased_at = coalesce(m.erased_at, now()), hold_until = now() WHERE m.id = upload_hold_replay.media AND m.post_id IS NULL;
  END IF;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  UPDATE public.restore_gaps x SET closed_at = now(), disposition = 'imported' WHERE x.id = g.id;
  RETURN format('replayed %s', v_changed);
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."upload_hold_replay"(uuid, uuid, text, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- 14. append_confirmed_audit, replaced from its text in 0034_release: its list of actions gains upload_released and
-- upload_hold_ended, an admin's release of a held upload and an admin's end of a hold (6.7). Nothing else changes.
CREATE OR REPLACE FUNCTION "public"."append_confirmed_audit"(actor_id uuid, key_id uuid, action text, target_type text, target_id text, metadata jsonb, staff_session uuid, action_hash text, step_up jsonb, request_id text, expires_ms bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  place bigint;
  stamped timestamptz;
BEGIN
  IF append_confirmed_audit.action IS NULL OR append_confirmed_audit.action NOT IN ('case_decided', 'appeals_reviewed', 'identity_revealed', 'order_event_recorded', 'order_corrected', 'order_effected', 'gap_closed', 'audit_exported', 'seal_released', 'upload_released', 'upload_hold_ended') THEN
    RAISE EXCEPTION '%', format('append_confirmed_audit does not write the action %L', append_confirmed_audit.action);
  END IF;
  IF append_confirmed_audit.actor_id IS NULL OR append_confirmed_audit.key_id IS NULL OR append_confirmed_audit.staff_session IS NULL
     OR append_confirmed_audit.action_hash IS NULL OR append_confirmed_audit.step_up IS NULL OR append_confirmed_audit.expires_ms IS NULL THEN
    RAISE EXCEPTION 'append_confirmed_audit needs an actor, a key, a staff session, an action hash, a step-up and an expiry';
  END IF;
  PERFORM 1 FROM auth.users u WHERE u.id = append_confirmed_audit.actor_id AND u.deleted_at IS NULL AND u.role <> 'user' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_confirmation_ended';
  END IF;
  PERFORM 1 FROM auth.staff_keys k
    WHERE k.id = append_confirmed_audit.key_id AND k.user_id = append_confirmed_audit.actor_id AND k.revoked_at IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_confirmation_ended';
  END IF;
  IF append_confirmed_audit.action = 'identity_revealed' THEN
    UPDATE public.staff_texts t SET confirmed_at = now()
     WHERE t.kind = 'reveal_reason' AND t.author_id = append_confirmed_audit.actor_id
       AND t.case_id = (SELECT i.case_id FROM public.intake_items i WHERE i.id::text = append_confirmed_audit.target_id)
       AND t.digest = append_confirmed_audit.metadata -> 'params' ->> 'reasonDigest'
       AND t.confirmed_at IS NULL AND t.erased_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'text_not_found';
    END IF;
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_type, target_id, metadata, staff_session, key_id, action_hash, step_up, request_id)
  VALUES (append_confirmed_audit.actor_id, append_confirmed_audit.action, append_confirmed_audit.target_type, append_confirmed_audit.target_id,
          coalesce(append_confirmed_audit.metadata, '{}'::jsonb), append_confirmed_audit.staff_session, append_confirmed_audit.key_id,
          append_confirmed_audit.action_hash, append_confirmed_audit.step_up, append_confirmed_audit.request_id)
  RETURNING chain_seq, created_at INTO place, stamped;
  IF floor(extract(epoch FROM stamped) * 1000) >= append_confirmed_audit.expires_ms THEN
    RAISE EXCEPTION 'staff_confirmation_late';
  END IF;
  RETURN place;
END $$;--> statement-breakpoint

-- 15. The function of releases_confirmed, replaced from its text in 0034_release (6.7): a row with upload_refusal_id is
-- held to upload_released on that refusal, where 0034's text asks for seal_released on the seal's ledger row; left as it
-- was, every release of a held upload would be refused at commit. A seal's release is checked as before.
CREATE OR REPLACE FUNCTION "public"."releases_confirmed"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a public.audit_log;
  v_media uuid;
BEGIN
  SELECT l.* INTO a FROM public.audit_head h JOIN public.audit_log l ON l.chain_seq = h.seq WHERE h.id = 1;
  -- 0039: a held upload's release is held to upload_released on its refusal, which names the refusal's image, with the
  -- params the key confirmed: the ground, the leave's id and its reference.
  IF NEW.upload_refusal_id IS NOT NULL THEN
    SELECT u.media_id INTO v_media FROM public.upload_refusals u WHERE u.id = NEW.upload_refusal_id;
    IF NOT FOUND OR a.action IS DISTINCT FROM 'upload_released' OR a.target_type IS DISTINCT FROM 'upload_refusal' OR a.target_id IS DISTINCT FROM NEW.upload_refusal_id::text THEN
      RAISE EXCEPTION 'release_mismatch' USING DETAIL = 'audit: the transaction''s last audit row is not upload_released on this refusal.';
    END IF;
    IF a.metadata ->> 'releaseId' IS DISTINCT FROM NEW.id::text OR a.metadata ->> 'mediaId' IS DISTINCT FROM v_media::text THEN
      RAISE EXCEPTION 'release_mismatch' USING DETAIL = 'releaseId: the audit row does not name this release and the refusal''s image.';
    END IF;
    IF a.step_up IS NULL OR a.actor_id IS DISTINCT FROM NEW.released_by THEN
      RAISE EXCEPTION 'release_mismatch' USING DETAIL = 'stepUp: the audit row carries no confirmation by the admin who released.';
    END IF;
    IF a.metadata -> 'params' IS DISTINCT FROM jsonb_build_object('basis', NEW.basis, 'leaveId', NEW.leave_id, 'theirReference', NEW.their_reference) THEN
      RAISE EXCEPTION 'release_mismatch' USING DETAIL = 'params: what the key confirmed is not what was released.';
    END IF;
    RETURN NULL;
  END IF;
  IF NOT FOUND OR a.action IS DISTINCT FROM 'seal_released' OR a.target_type IS DISTINCT FROM 'seal' OR a.target_id IS DISTINCT FROM NEW.seal_action_id::text THEN
    RAISE EXCEPTION 'release_mismatch' USING DETAIL = 'audit: the transaction''s last audit row is not seal_released on this seal.';
  END IF;
  IF a.metadata ->> 'releaseId' IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION 'release_mismatch' USING DETAIL = 'releaseId: the audit row does not name this release.';
  END IF;
  IF a.step_up IS NULL OR a.actor_id IS DISTINCT FROM NEW.released_by THEN
    RAISE EXCEPTION 'release_mismatch' USING DETAIL = 'stepUp: the audit row carries no confirmation by the admin who released.';
  END IF;
  IF a.metadata -> 'params' IS DISTINCT FROM jsonb_build_object('postIds', to_jsonb(NEW.post_ids::text[]), 'basis', NEW.basis, 'leaveId', NEW.leave_id, 'theirReference', NEW.their_reference) THEN
    RAISE EXCEPTION 'release_mismatch' USING DETAIL = 'params: what the key confirmed is not what was released.';
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint

-- 16. releases_notice, replaced from its text in 0034_release: a held upload's release has no seal and no post, so its
-- author is the refusal's uploader and its record of the report the refusal's (6.7, 7.12 step 5). Left as it was, every
-- such notice would be born none. Everything else is 0034's.
CREATE OR REPLACE FUNCTION "public"."releases_notice"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_author uuid;
  v_record uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_record := coalesce((SELECT l.notification_id FROM public.release_leaves l WHERE l.id = NEW.leave_id), public.seal_record(NEW.seal_action_id),
                         (SELECT u.notification_id FROM public.upload_refusals u WHERE u.id = NEW.upload_refusal_id));
    IF NEW.upload_refusal_id IS NOT NULL THEN
      -- 0039: a held upload's uploader, while the refusal still names them.
      SELECT u.owner_id INTO v_author FROM public.upload_refusals u WHERE u.id = NEW.upload_refusal_id;
    ELSIF NEW.seal_action_id IS NOT NULL THEN
      SELECT a.subject_account_id INTO v_author FROM public.decision_actions a WHERE a.id = NEW.seal_action_id;
    ELSE
      SELECT p.author_id INTO v_author FROM public.posts p WHERE p.id = ANY (NEW.post_ids) ORDER BY p.id LIMIT 1;
    END IF;
    NEW.author_notice_at := NULL;
    IF v_author IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_author AND p.deleted_at IS NULL) THEN
      NEW.author_notice := 'none';
    ELSIF NOT public.release_may_tell(NEW.leave_id, v_record, NEW.post_ids) THEN
      NEW.author_notice := 'held';
    ELSIF NEW.replay_of IS NULL THEN
      NEW.author_notice := 'pending';
    ELSE
      NEW.author_notice := 'none';
    END IF;
    RETURN NEW;
  END IF;
  IF current_user <> 'korbat_migrate' AND NEW.author_notice IS DISTINCT FROM OLD.author_notice THEN
    IF OLD.author_notice = 'held' AND (NEW.author_notice <> 'pending' OR NOT public.release_tellable(OLD.id)) THEN
      RAISE EXCEPTION 'moderation_column' USING DETAIL = 'A held notice moves only to pending, and only once the author may be told.';
    END IF;
    IF NEW.author_notice = 'held' THEN
      RAISE EXCEPTION 'moderation_column' USING DETAIL = 'A notice is held only by its release''s insert.';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

-- 17. release_tellable, replaced from its text in 0034_release (6.7): for a held upload's release, the record of the
-- report is the one that the refusal's notification_id names. Everything else is 0034's.
CREATE OR REPLACE FUNCTION "public"."release_tellable"(release uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT public.release_may_tell(r.leave_id,
                            coalesce((SELECT l.notification_id FROM public.release_leaves l WHERE l.id = r.leave_id), public.seal_record(r.seal_action_id),
                                     (SELECT u.notification_id FROM public.upload_refusals u WHERE u.id = r.upload_refusal_id)),
                            r.post_ids)
                     FROM public.releases r WHERE r.id = release_tellable.release), false)
$$;--> statement-breakpoint

-- 18. automated_signals_guard, replaced from its text in 0038_automated_decisions (6.7): the one check that ties a
-- match's finding to its record. Everything else is 0038's.
CREATE OR REPLACE FUNCTION "public"."automated_signals_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'korbat_migrate' THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.media_id IS DISTINCT FROM OLD.media_id
     OR NEW.score IS DISTINCT FROM OLD.score OR NEW.threshold_version IS DISTINCT FROM OLD.threshold_version
     OR NEW.match_id IS DISTINCT FROM OLD.match_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.intake_item_id IS NOT NULL AND NEW.intake_item_id IS DISTINCT FROM OLD.intake_item_id)
     OR (OLD.decision_id IS NOT NULL AND NEW.decision_id IS DISTINCT FROM OLD.decision_id)
     OR (OLD.handled_at IS NOT NULL AND NEW.handled_at IS DISTINCT FROM OLD.handled_at)
     OR (OLD.handled IS NOT NULL AND NEW.handled IS DISTINCT FROM OLD.handled) THEN
    RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
  END IF;
  IF OLD.handled_at IS NULL AND NEW.handled_at IS NOT NULL THEN
    NEW.handled_at := now();
  END IF;
  -- 0039 (6.7): when a match's signal gains its finding's item, the item's intake cites R2 exactly when the record is
  -- listed: a flag of another class cites no rule, and only a listed class may cite R2.
  IF NEW.kind = 'known_match' AND OLD.intake_item_id IS NULL AND NEW.intake_item_id IS NOT NULL THEN
    IF (SELECT k.rule_id IS NOT DISTINCT FROM 'R2' FROM public.intake_items i JOIN public.intakes k ON k.id = i.intake_id WHERE i.id = NEW.intake_item_id)
       IS DISTINCT FROM (SELECT x.listed FROM public.media_matches x WHERE x.id = NEW.match_id) THEN
      RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501', DETAIL = 'A match''s finding cites R2 exactly when its record is listed.';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

-- 19. decision_holds, replaced from its text in 0038_automated_decisions (6.7), with two changes and no other: (b) a
-- seal_media of a decision without a decider stands only for a known_match whose record is acting, so a flag cannot seal
-- as a fact of the database; (c), new, the reason of an answer without a seal on an acting match. The check sits here
-- and not in decisions_record, which runs before the decision's actions exist and cannot know whether it seals.
CREATE OR REPLACE FUNCTION "public"."decision_holds"(decision uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d public.decisions;
  a public.audit_log;
  params jsonb;
  compared jsonb;
  expected jsonb;
  recorded jsonb;
  held jsonb;
  differing text;
  measures integer;
  reversals integer;
  strikes integer;
  in_force integer;
  signed_marks jsonb;
  stored_marks jsonb;
  signed_replaced jsonb;
  stored_replaced boolean;
  lifted uuid;
  decider_role text;
  -- 3f: an order decision's item, order and case, and the rows the audit row names.
  oi public.legal_order_items;
  o public.legal_orders;
  c public.cases;
  urgent jsonb;
  -- 0038: a decision without a decider's one signal.
  sig public.automated_signals;
  -- 0039 (c): the reason an answer without a seal on an acting match signs, and whether this decision needs one.
  signed_reason jsonb;
  needs_reason boolean;
BEGIN
  -- The row as it stands now: later triggers of its transaction may have marked it since its insert.
  SELECT x.* INTO d FROM public.decisions x WHERE x.id = decision_holds.decision;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT l.* INTO a FROM public.audit_head h JOIN public.audit_log l ON l.chain_seq = h.seq WHERE h.id = 1;
  SELECT k.* INTO c FROM public.cases k WHERE k.id = d.case_id;
  -- 3f (section 6.3): an order decision is held to the one confirmed order_effected of its transaction.
  IF d.kind = 'order' THEN
    SELECT x.* INTO oi FROM public.legal_order_items x WHERE x.id = d.order_item_id;
    SELECT x.* INTO o FROM public.legal_orders x WHERE x.id = oi.order_id;
    IF a.id IS NULL OR a.action IS DISTINCT FROM 'order_effected' OR a.target_type IS DISTINCT FROM 'order' OR a.target_id IS DISTINCT FROM o.id::text THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'target: the transaction''s last audit row is not order_effected on this decision''s order.';
    END IF;
    IF a.step_up IS NULL THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'stepUp: the audit row carries no confirmation.';
    END IF;
    IF a.actor_id IS DISTINCT FROM d.decided_by THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'actor: the audit row was written by another account than the decision''s.';
    END IF;
    -- decisionIds maps each item to its decision: this one under its own item, and every pair an order decision of this
    -- transaction on that item, so one audit row covers nothing it does not name.
    IF jsonb_typeof(a.metadata -> 'decisionIds') IS DISTINCT FROM 'object' OR a.metadata -> 'decisionIds' ->> oi.id::text IS DISTINCT FROM d.id::text
       OR EXISTS (SELECT 1 FROM jsonb_each_text(a.metadata -> 'decisionIds') e
                   WHERE NOT EXISTS (SELECT 1 FROM public.decisions x
                                      WHERE x.id::text = e.value AND x.order_item_id::text = e.key AND x.kind = 'order' AND x.xact = d.xact)) THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'decisionIds: the audit row does not name this decision under its item, or names one this transaction did not take.';
    END IF;
    params := a.metadata -> 'params';
    IF params IS NULL OR jsonb_typeof(params) <> 'object' THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'params: the audit row carries none.';
    END IF;
    -- The order's row under the contracts' names. Its withholding is forced true with Section C, so params that say
    -- "must not be told" and "not withheld" equal no row.
    expected := jsonb_build_object('kind', o.kind, 'memberState', o.member_state, 'authority', o.authority, 'reference', o.reference,
      'sectionC', o.section_c, 'emergency', o.emergency, 'withholdFromAuthor', o.withhold_from_author);
    IF (params - 'items' - 'urgent') IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'params: the confirmed order facts differ from the order.';
    END IF;
    IF jsonb_typeof(params -> 'items') IS DISTINCT FROM 'array'
       OR NOT (params -> 'items' @> jsonb_build_array(jsonb_build_object('itemId', oi.id::text, 'postId', c.target_id::text)))
       OR jsonb_array_length(params -> 'items') <> (SELECT count(*) FROM jsonb_object_keys(a.metadata -> 'decisionIds'))
       OR jsonb_array_length(params -> 'items') > (SELECT r.items_per_action FROM public.order_rules() r) THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'items: the confirmed list does not name this item, or names more or fewer than it gave effect to.';
    END IF;
    -- The order's row is held FOR SHARE since decisions_record. An unverified DSA Article 9 order is given effect only by
    -- an admin who signed that it is urgent; the word is never signed where it means nothing.
    urgent := coalesce(params -> 'urgent', 'false'::jsonb);
    IF o.kind = 'dsa_art9' AND o.verified_at IS NULL THEN
      IF urgent IS DISTINCT FROM 'true'::jsonb THEN
        RAISE EXCEPTION 'order_not_verified';
      END IF;
    ELSIF urgent IS DISTINCT FROM 'false'::jsonb THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'urgent: signed for an order that is a removal order or verified.';
    END IF;
    IF (SELECT count(*) FROM public.decision_actions x WHERE x.decision_id = d.id) <> 1
       OR NOT EXISTS (SELECT 1 FROM public.decision_actions x WHERE x.decision_id = d.id AND x.kind = 'disable_by_order') THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'actions: an order decision holds exactly one disable_by_order.';
    END IF;
    RETURN;
  END IF;
  IF a.id IS NULL OR a.metadata ->> 'decisionId' IS DISTINCT FROM d.id::text THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'decisionId: the transaction''s last audit row does not name this decision.';
  END IF;
  IF d.decided_by IS NULL THEN
    -- 0038 (a), for a decision without a decider (3d design, sections 2 row 16 and 6.6): the head row carries no step-up
    -- and no key, was written by the system actor, and is automated_decided on the decision's case; it names in signalId
    -- the one signal whose decision_id is this decision, and that signal's image is an image of the case's post. Its
    -- params are compared below as case_decided's are.
    IF a.step_up IS NOT NULL OR a.key_id IS NOT NULL OR a.action_hash IS NOT NULL OR a.staff_session IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'stepUp: the audit row of a decision without a decider carries no confirmation and no key.';
    END IF;
    IF a.actor_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000000'::uuid THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'actor: the audit row of a decision without a decider is the system''s.';
    END IF;
    IF a.action IS DISTINCT FROM 'automated_decided' OR a.target_type IS DISTINCT FROM 'case' OR a.target_id IS DISTINCT FROM d.case_id::text THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'target: the audit row is not automated_decided on the decision''s case.';
    END IF;
    SELECT s.* INTO sig FROM public.automated_signals s WHERE s.decision_id = d.id;
    IF NOT FOUND OR a.metadata ->> 'signalId' IS DISTINCT FROM sig.id::text THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'signalId: the audit row does not name the one signal of this decision.';
    END IF;
    IF c.target_type IS DISTINCT FROM 'post' OR NOT EXISTS (SELECT 1 FROM public.post_media m WHERE m.id = sig.media_id AND m.post_id = c.target_id) THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'signalId: the signal''s image is not an image of the case''s post.';
    END IF;
    expected := jsonb_build_object('kind', d.kind, 'stateVersion', d.seen_state_version, 'throughSeq', d.through_seq,
      'reviewsDecisionId', d.reviews_decision_id, 'snapshotId', d.snapshot_id, 'snapshotDigest', d.snapshot_digest, 'outcome', d.outcome,
      'ground', d.ground, 'ruleId', d.rule_id, 'rulesVersion', d.rules_version, 'redressVersion', d.redress_version, 'category', d.category,
      'categoryKeyword', d.category_keyword, 'factsDigest', d.facts_digest, 'reasonDigest', d.reason_digest,
      'legalReferenceDigest', d.legal_reference_digest);
  ELSE
    IF a.step_up IS NULL THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'stepUp: the audit row carries no confirmation.';
    END IF;
    IF a.actor_id IS DISTINCT FROM d.decided_by THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'actor: the audit row was written by another account than the decision''s.';
    END IF;
    IF d.kind = 'review' THEN
      IF a.action IS DISTINCT FROM 'appeals_reviewed' OR a.target_type IS DISTINCT FROM 'decision' OR a.target_id IS DISTINCT FROM d.reviews_decision_id::text THEN
        RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'target: the audit row is not appeals_reviewed on the reviewed decision.';
      END IF;
      expected := jsonb_build_object('stateVersion', d.seen_state_version, 'appealId', d.appeal_id, 'snapshotId', d.snapshot_id,
        'snapshotDigest', d.snapshot_digest, 'outcome', d.outcome, 'rulesVersion', d.rules_version, 'redressVersion', d.redress_version,
        'category', d.category, 'reasonDigest', d.reason_digest);
    ELSE
      IF a.action IS DISTINCT FROM 'case_decided' OR a.target_type IS DISTINCT FROM 'case' OR a.target_id IS DISTINCT FROM d.case_id::text THEN
        RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'target: the audit row is not case_decided on the decision''s case.';
      END IF;
      expected := jsonb_build_object('kind', d.kind, 'stateVersion', d.seen_state_version, 'throughSeq', d.through_seq,
        'reviewsDecisionId', d.reviews_decision_id, 'snapshotId', d.snapshot_id, 'snapshotDigest', d.snapshot_digest, 'outcome', d.outcome,
        'ground', d.ground, 'ruleId', d.rule_id, 'rulesVersion', d.rules_version, 'redressVersion', d.redress_version, 'category', d.category,
        'categoryKeyword', d.category_keyword, 'factsDigest', d.facts_digest, 'reasonDigest', d.reason_digest,
        'legalReferenceDigest', d.legal_reference_digest);
    END IF;
  END IF;
  -- 3f: from Task 3 on the decide and review routes name the case's target, so that a lost decision's row says what it
  -- was about after a restore; a row that names one must name this one.
  IF a.metadata ? 'target' AND a.metadata -> 'target' IS DISTINCT FROM jsonb_build_object('type', c.target_type, 'id', c.target_id) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'target: the audit row names another target than the decision''s case.';
  END IF;
  params := a.metadata -> 'params';
  IF params IS NULL OR jsonb_typeof(params) <> 'object' THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'params: the audit row carries none.';
  END IF;
  -- A decision's two members of 3e are checked on their own below; a row made before 3e carries neither.
  -- 0039: matchAnswerReason is checked on its own in (c) below; a row made before 3d's Task 7 carries none.
  compared := CASE WHEN d.kind = 'review' THEN params - 'actions' ELSE params - 'actions' - 'unfounded' - 'replaced' - 'matchAnswerReason' END;
  IF compared IS DISTINCT FROM expected THEN
    SELECT string_agg(x.key, ', ' ORDER BY x.key) INTO differing
      FROM (SELECT coalesce(e.key, p.key) AS key
              FROM jsonb_each(expected) e FULL JOIN jsonb_each(compared) p ON p.key = e.key
             WHERE e.value IS DISTINCT FROM p.value) x;
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = format('params: %s differ from the decision.', differing);
  END IF;
  recorded := params -> 'actions';
  -- 3f: a reinstatement's signed form holds its ground; a row without one signs as before.
  SELECT coalesce(jsonb_agg(CASE WHEN x.order_ground IS NOT NULL THEN jsonb_build_object('kind', x.kind, 'mediaId', x.media_id, 'orderGround', x.order_ground)
                                 WHEN x.announced IS NULL THEN jsonb_build_object('kind', x.kind, 'mediaId', x.media_id)
                                 ELSE jsonb_build_object('kind', x.kind, 'mediaId', x.media_id, 'days', x.days, 'announced', x.announced) END), '[]'::jsonb),
         count(*) FILTER (WHERE x.kind IN ('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio',
                                           'strike', 'suspend', 'terminate', 'retire_handle', 'warn_reporting', 'restrict_reporting', 'disable_by_order')),
         count(*) FILTER (WHERE x.kind NOT IN ('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio',
                                               'strike', 'suspend', 'terminate', 'retire_handle', 'warn_reporting', 'restrict_reporting', 'disable_by_order')),
         count(*) FILTER (WHERE x.kind = 'strike')
    INTO held, measures, reversals, strikes
    FROM public.decision_actions x WHERE x.decision_id = d.id;
  IF recorded IS NULL OR jsonb_typeof(recorded) <> 'array' THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'actions: the audit row''s params list none.';
  END IF;
  IF NOT ((held) @> (recorded) AND (recorded) @> (held)) OR jsonb_array_length(held) <> jsonb_array_length(recorded) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'actions: the decision''s measures and reversals are not those the audit row''s params list.';
  END IF;

  IF d.kind <> 'review' THEN
    signed_marks := coalesce(params -> 'unfounded', '[]'::jsonb);
    IF jsonb_typeof(signed_marks) <> 'array' THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'unfounded: the audit row''s params list no marks.';
    END IF;
    SELECT coalesce(jsonb_agg(m.item_id::text), '[]'::jsonb) INTO stored_marks FROM public.unfounded_marks m WHERE m.decision_id = d.id;
    IF NOT (stored_marks @> signed_marks AND signed_marks @> stored_marks) OR jsonb_array_length(stored_marks) <> jsonb_array_length(signed_marks) THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'unfounded: the decision''s marks are not those the audit row''s params list.';
    END IF;
    signed_replaced := coalesce(params -> 'replaced', 'false'::jsonb);
    SELECT x.replaced, x.reverses_action_id INTO stored_replaced, lifted FROM public.decision_actions x WHERE x.decision_id = d.id AND x.kind = 'lift_suspension';
    IF jsonb_typeof(signed_replaced) <> 'boolean' OR (signed_replaced = 'true'::jsonb) IS DISTINCT FROM coalesce(stored_replaced, false) THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'replaced: the decision''s lift is not what the audit row''s params say.';
    END IF;
    IF coalesce(stored_replaced, false) AND (
         d.kind <> 'correction'
         OR (SELECT count(*) FROM public.decision_actions x WHERE x.decision_id = d.id) <> 1
         OR NOT EXISTS (SELECT 1 FROM public.decision_actions l WHERE l.id = lifted AND l.announced)
         OR EXISTS (SELECT 1 FROM public.suspension_periods p WHERE p.action_id = lifted AND p.starts_at < d.decided_at)) THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'replaced: only a correction whose one row lifts an announced measure that has not started withdraws it for another measure.';
    END IF;
    -- 0025: a withdrawal for another measure is an admin's (3e design, sections 7.6 step 12 and 8.7), whoever signs it.
    IF coalesce(stored_replaced, false) THEN
      SELECT u.role::text INTO decider_role FROM auth.users u WHERE u.id = d.decided_by;
      IF decider_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'admin_required';
      END IF;
    END IF;
  END IF;

  IF d.outcome = 'restricted' AND measures = 0 THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'restricted: a restriction holds at least one measure.';
  END IF;
  IF d.outcome = 'restricted' AND measures = strikes THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'restricted: a restriction holds at least one measure that is not a strike.';
  END IF;
  IF d.kind = 'final' AND d.outcome = 'restricted' AND (strikes > 0) IS DISTINCT FROM public.strike_due(d.case_id, d.ground, d.rule_id, d.suspect, d.id) THEN
    RAISE EXCEPTION 'strike_mismatch';
  END IF;
  IF d.outcome IN ('no_violation', 'not_evident') AND measures > 0 THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'no action: a decision that finds no breach holds no measure.';
  END IF;
  IF d.outcome = 'kept' AND measures + reversals > 0 THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'kept: a review that keeps the decision holds no measure and no reversal.';
  END IF;
  IF d.outcome IN ('reversed', 'partly_reversed') THEN
    IF reversals = 0 THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'reversed: a reversing decision holds at least one reversal.';
    END IF;
    SELECT count(*) INTO in_force FROM public.measures_in_force m WHERE m.decision_id = d.reviews_decision_id;
    IF d.outcome = 'reversed' AND in_force > 0 THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'reversed: a measure of the reviewed decision is still in force.';
    END IF;
    IF d.outcome = 'partly_reversed' AND in_force = 0 THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'partly_reversed: no measure of the reviewed decision is left in force.';
    END IF;
    IF d.outcome = 'partly_reversed' AND NOT EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.decision_id = d.reviews_decision_id AND m.kind <> 'strike') THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'partly_reversed: no measure of the reviewed decision but its strike is left in force.';
    END IF;
  END IF;
  -- 0038 (b), for a decision without a decider: exactly one measure and no reversal, the one its signal's kind allows: a
  -- withhold_media of the signal's image under R1 for a score, a seal_media under R2 for a match (LAB A2: two measures, a
  -- seal on an R1 finding). From the migration of known material on, the seal's signal must also name an acting record.
  IF d.decided_by IS NULL THEN
    IF measures <> 1 OR reversals <> 0 THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'actions: a decision without a decider holds exactly one measure and no reversal.';
    END IF;
    IF NOT ((sig.kind = 'r1_score' AND d.rule_id = 'R1'
             AND EXISTS (SELECT 1 FROM public.decision_actions x WHERE x.decision_id = d.id AND x.kind = 'withhold_media' AND x.media_id = sig.media_id))
         OR (sig.kind = 'known_match' AND d.rule_id = 'R2'
             AND EXISTS (SELECT 1 FROM public.decision_actions x WHERE x.decision_id = d.id AND x.kind = 'seal_media')
             -- 0039 (b): a seal stands only on a match record that is acting, which the database forces itself.
             AND EXISTS (SELECT 1 FROM public.media_matches mm WHERE mm.id = sig.match_id AND mm.acting))) THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'actions: the measure of a decision without a decider is not the one its signal allows.';
    END IF;
  END IF;
  -- 0039 (c) (6.7, 7.11, note 26): match_answer_reason is set exactly when the decision is final, holds no seal_media and
  -- considers an item of an automated intake whose match record is acting: such a decision puts an image with an exact
  -- match back before everyone with nobody having looked. It equals the signed param, and a decision without a decider or
  -- a review holds none. A flag's answer needs none.
  needs_reason := d.decided_by IS NOT NULL AND d.kind = 'final'
    AND NOT EXISTS (SELECT 1 FROM public.decision_actions x WHERE x.decision_id = d.id AND x.kind = 'seal_media')
    AND EXISTS (SELECT 1 FROM public.intake_items i JOIN public.automated_signals s ON s.intake_item_id = i.id
                  JOIN public.media_matches mm ON mm.id = s.match_id
                 WHERE i.answered_by = d.id AND s.kind = 'known_match' AND mm.acting);
  signed_reason := CASE WHEN d.kind = 'review' THEN NULL ELSE params -> 'matchAnswerReason' END;
  IF signed_reason = 'null'::jsonb THEN
    signed_reason := NULL;
  END IF;
  IF needs_reason IS DISTINCT FROM (d.match_answer_reason IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'matchAnswerReason: an answer without a seal on an acting match names its reason, and no other decision does.';
  END IF;
  IF (signed_reason #>> '{}') IS DISTINCT FROM d.match_answer_reason THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'matchAnswerReason: the signed reason differs from the decision.';
  END IF;
END $$;--> statement-breakpoint

-- 20. quarantine_plan, replaced from its text in 0034_release (6.7): the image of a refusal that ended as report and is
-- not released counts as sealed for good (an `in` line); destroy gains the image of every released refusal. An upload on
-- no post is never in `out`: it has no reader to return to (out asks for a post, as before). Everything else is 0034's.
CREATE OR REPLACE FUNCTION "public"."quarantine_plan"() RETURNS TABLE (direction text, media_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH good AS (
    SELECT DISTINCT s.post_id FROM public.seal_posts s JOIN public.measures_in_force f ON f.id = s.action_id
     WHERE f.kind = 'seal_media' AND f.decision_kind <> 'interim'
  ), held AS (
    -- 0039: the image of a refusal that ended as report and is not released counts as sealed for good.
    SELECT u.media_id FROM public.upload_refusals u WHERE u.end_as = 'report' AND u.release_id IS NULL
  ), open_files AS (
    SELECT q.media_id, bool_or(q.unknown) AS unknown,
           bool_or(EXISTS (SELECT 1 FROM public.release_posts r WHERE r.post_id = q.post_id)) AS released
      FROM public.quarantine_files q
     WHERE q.returned_at IS NULL AND q.destroyed_at IS NULL AND q.lost_at IS NULL GROUP BY q.media_id
  ), kept AS (
    SELECT q.media_id FROM public.quarantine_files q
     WHERE q.returned_at IS NULL AND q.destroyed_at IS NULL GROUP BY q.media_id HAVING count(*) = 2
  )
  SELECT 'in'::text, m.id FROM public.post_media m JOIN good g ON g.post_id = m.post_id
   WHERE m.erased_at IS NULL AND NOT EXISTS (SELECT 1 FROM kept k WHERE k.media_id = m.id)
  UNION ALL
  SELECT 'in'::text, m.id FROM public.post_media m JOIN held h ON h.media_id = m.id
   WHERE m.post_id IS NULL AND m.erased_at IS NULL AND NOT EXISTS (SELECT 1 FROM kept k WHERE k.media_id = m.id)
  UNION ALL
  SELECT 'out'::text, o.media_id FROM open_files o JOIN public.post_media m ON m.id = o.media_id
   WHERE NOT o.unknown AND m.post_id IS NOT NULL AND m.erased_at IS NULL AND NOT EXISTS (SELECT 1 FROM good g WHERE g.post_id = m.post_id)
  UNION ALL
  SELECT 'destroy'::text, o.media_id FROM open_files o
   WHERE NOT o.unknown AND (o.released OR NOT EXISTS (SELECT 1 FROM public.post_media m WHERE m.id = o.media_id)
                            OR EXISTS (SELECT 1 FROM public.upload_refusals u WHERE u.media_id = o.media_id AND u.release_id IS NOT NULL))
  UNION ALL
  SELECT 'operator'::text, o.media_id FROM open_files o WHERE o.unknown
$$;--> statement-breakpoint

-- 21. quarantine_counts, replaced from its text in 0034_release (6.7): an image of a held upload to move in is due since
-- its hold ended as report. Everything else is 0034's.
CREATE OR REPLACE FUNCTION "public"."quarantine_counts"() RETURNS TABLE (due_in integer, due_out integer, undestroyed integer, oldest timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH plan AS (
    SELECT p.direction, p.media_id FROM public.quarantine_plan() p
  ), in_at AS (
    -- 0039: a held upload's image is due since its hold ended as report.
    SELECT min(coalesce(f_d.decided_at, (SELECT u.ended_at FROM public.upload_refusals u WHERE u.media_id = p.media_id))) AS at
      FROM plan p JOIN public.post_media m ON m.id = p.media_id
      JOIN LATERAL (SELECT min(d.decided_at) AS decided_at FROM public.seal_posts s
                      JOIN public.measures_in_force f ON f.id = s.action_id AND f.kind = 'seal_media' AND f.decision_kind <> 'interim'
                      JOIN public.decisions d ON d.id = f.decision_id
                     WHERE s.post_id = m.post_id) f_d ON true
     WHERE p.direction = 'in'
  ), out_at AS (
    SELECT min(greatest(
             (SELECT max(r.created_at) FROM public.seal_posts s
                JOIN public.decision_actions a ON a.id = s.action_id AND a.kind = 'seal_media'
                JOIN public.decisions d ON d.id = a.decision_id AND d.kind <> 'interim'
                JOIN public.decision_actions r ON r.reverses_action_id = a.id
               WHERE s.post_id = m.post_id),
             (SELECT max(q.moved_at) FROM public.quarantine_files q
               WHERE q.media_id = p.media_id AND q.returned_at IS NULL AND q.destroyed_at IS NULL AND q.lost_at IS NULL))) AS at
      FROM plan p JOIN public.post_media m ON m.id = p.media_id
     WHERE p.direction = 'out'
  )
  SELECT (SELECT count(*) FROM plan WHERE direction = 'in')::integer,
         (SELECT count(*) FROM plan WHERE direction = 'out')::integer,
         (SELECT count(*) FROM public.quarantine_files q JOIN plan p ON p.media_id = q.media_id AND p.direction = 'destroy'
           WHERE q.returned_at IS NULL AND q.destroyed_at IS NULL AND q.lost_at IS NULL)::integer,
         least((SELECT at FROM in_at), (SELECT at FROM out_at))
$$;--> statement-breakpoint

-- 22. transparency_figures, replaced from its text in 0036_transparency (6.4, 6.7): the uploads' table. It keeps its JSON
-- keys, compares the intake kinds as text and reads clock_timestamp(), as 0036 wrote it; uploads stays absent from every
-- edition stored before, which no later version changes. Everything else is 0036's.
CREATE OR REPLACE FUNCTION "public"."transparency_figures"(year integer, as_of timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  k record;
  v_from timestamptz := make_timestamptz(transparency_figures.year, 1, 1, 0, 0, 0, 'UTC');
  v_to timestamptz := make_timestamptz(transparency_figures.year + 1, 1, 1, 0, 0, 0, 'UTC');
  v_due timestamptz;
  v_figures jsonb;
  v_orders jsonb;
  v_r1 record;
  v_months record;
BEGIN
  SELECT * INTO k FROM public.transparency_rules();
  v_due := make_timestamptz(transparency_figures.year + 1, k.due_month, k.due_day, 0, 0, 0, 'UTC');
  IF transparency_figures.as_of IS NULL OR transparency_figures.as_of < v_due OR clock_timestamp() < v_due THEN
    RAISE EXCEPTION 'edition_not_due';
  END IF;

  v_figures := jsonb_build_object(
    'restrictions', jsonb_build_object(
      'byGround', public.transparency_fold((
        SELECT jsonb_agg(jsonb_build_object('label', g.label, 'n', g.n) ORDER BY g.label = 'law', g.label)
          FROM (SELECT CASE WHEN d.ground::text = 'illegal' THEN 'law' ELSE d.rule_id END AS label, count(*) AS n
                  FROM public.decisions d
                 WHERE d.kind::text IN ('interim', 'final') AND d.outcome::text = 'restricted' AND d.decided_at >= v_from AND d.decided_at < v_to
                 GROUP BY 1) g)),
      'byMeasure', public.transparency_fold((
        SELECT jsonb_agg(jsonb_build_object('label', g.label, 'n', g.n) ORDER BY g.label)
          FROM (SELECT a.kind::text AS label, count(*) AS n
                  FROM public.decision_actions a JOIN public.decisions d ON d.id = a.decision_id
                 WHERE d.kind::text IN ('interim', 'final') AND d.outcome::text = 'restricted' AND d.decided_at >= v_from AND d.decided_at < v_to
                   AND a.reverses_action_id IS NULL
                 GROUP BY 1) g)),
      'total', public.band((
        SELECT count(*) FROM public.decisions d
         WHERE d.kind::text IN ('interim', 'final') AND d.outcome::text = 'restricted' AND d.decided_at >= v_from AND d.decided_at < v_to))),
    'noBreach', public.band((
      SELECT count(*) FROM public.decisions d
       WHERE d.kind::text = 'final' AND d.outcome::text IN ('no_violation', 'not_evident') AND d.decided_at >= v_from AND d.decided_at < v_to)),
    'intakes', public.transparency_fold((
      SELECT jsonb_agg(jsonb_build_object('label', g.label, 'n', g.n) ORDER BY array_position(ARRAY['rules', 'illegal', 'finding', 'automated'::text], g.label))
        FROM (SELECT CASE WHEN i.kind::text = 'user' THEN CASE WHEN i.alleges_illegal THEN 'illegal' ELSE 'rules' END ELSE i.kind::text END AS label, count(*) AS n
                FROM public.intakes i
               WHERE i.kind::text <> 'order' AND i.received_at >= v_from AND i.received_at < v_to
               GROUP BY 1) g)),
    'appeals', public.transparency_fold((
      SELECT jsonb_agg(jsonb_build_object('label', g.label, 'n', g.n) ORDER BY array_position(ARRAY['kept', 'partly_reversed', 'reversed'], g.label))
        FROM (SELECT a.result::text AS label, count(*) AS n
                FROM public.appeals a JOIN public.decisions r ON r.id = a.answered_by
               WHERE a.result IS NOT NULL AND r.decided_at >= v_from AND r.decided_at < v_to
               GROUP BY 1) g)),
    'reexaminations', public.transparency_fold((
      SELECT jsonb_agg(jsonb_build_object('label', g.label, 'n', g.n) ORDER BY g.label)
        FROM (SELECT CASE WHEN x.outcome::text IN ('restricted_rule', 'restricted_legal', 'partly_reversed', 'reversed') THEN 'action' ELSE 'no_action' END AS label, count(*) AS n
                FROM public.intake_items x JOIN public.decisions r ON r.id = x.answered_by
               WHERE x.reexamines_item_id IS NOT NULL AND r.kind::text <> 'order' AND r.decided_at >= v_from AND r.decided_at < v_to
               GROUP BY 1) g)),
    'accountMeasures', public.transparency_fold((
      SELECT jsonb_agg(jsonb_build_object('label', g.label, 'n', g.n)
                       ORDER BY array_position(ARRAY['strike', 'suspend', 'terminate', 'retire_handle', 'warn_reporting', 'restrict_reporting'], g.label))
        FROM (SELECT a.kind::text AS label, count(*) AS n
                FROM public.decision_actions a JOIN public.decisions d ON d.id = a.decision_id
               WHERE a.kind::text IN ('strike', 'suspend', 'terminate', 'retire_handle', 'warn_reporting', 'restrict_reporting')
                 AND d.kind::text <> 'order' AND d.decided_at >= v_from AND d.decided_at < v_to
               GROUP BY 1) g)),
    'automated'::text, jsonb_build_object(
      'findings', public.transparency_fold((
        SELECT jsonb_agg(jsonb_build_object('label', g.label, 'n', g.n) ORDER BY g.label)
          FROM (SELECT i.rule_id AS label, count(*) AS n
                  FROM public.intakes i
                 WHERE i.kind::text = 'automated' AND i.rule_id IS NOT NULL AND i.received_at >= v_from AND i.received_at < v_to
                 GROUP BY 1) g)),
      'measures', public.transparency_fold((
        SELECT jsonb_agg(jsonb_build_object('label', g.label, 'n', g.n) ORDER BY g.label)
          FROM (SELECT d.rule_id AS label, count(*) AS n
                  FROM public.decisions d
                 WHERE d.decided_by IS NULL AND d.kind::text IN ('interim', 'final') AND d.outcome::text = 'restricted' AND d.rule_id IS NOT NULL
                   AND d.decided_at >= v_from AND d.decided_at < v_to
                 GROUP BY 1) g))));

  -- The programs' rate (section 2, row 23): of the year's findings by a program under R1, those whose case a person's
  -- final decision had restricted by the due day; printed only as two bands, and only on a base of ten or more.
  SELECT count(*) AS base,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.intake_items t JOIN public.decisions f ON f.case_id = t.case_id
                                         WHERE t.intake_id = i.id AND f.kind::text = 'final' AND f.outcome::text = 'restricted'
                                           AND f.decided_by IS NOT NULL AND f.decided_at < v_due)) AS restricted
    INTO v_r1
    FROM public.intakes i
   WHERE i.kind::text = 'automated' AND i.rule_id = 'R1' AND i.received_at >= v_from AND i.received_at < v_to;
  IF v_r1.base >= k.floor THEN
    v_figures := jsonb_set(v_figures, '{automated,r1}', jsonb_build_object('base', public.band(v_r1.base), 'restricted', public.band(v_r1.restricted)));
  END IF;

  -- 0039 (6.4's row of uploads): the year's refusals by refused_at, by how their hold had ended by the due day (report,
  -- no_report) or that it had not (open). A row is folded and banded as every table is.
  v_figures := v_figures || jsonb_build_object('uploads', public.transparency_fold((
    SELECT jsonb_agg(jsonb_build_object('label', g.label, 'n', g.n) ORDER BY array_position(ARRAY['report', 'no_report', 'open'], g.label))
      FROM (SELECT CASE WHEN u.ended_at IS NOT NULL AND u.ended_at < v_due THEN u.end_as ELSE 'open' END AS label, count(*) AS n
              FROM public.upload_refusals u
             WHERE u.refused_at >= v_from AND u.refused_at < v_to
             GROUP BY 1) g)));

  v_orders := public.transparency_orders(transparency_figures.year, transparency_figures.as_of);
  IF v_orders IS NOT NULL THEN
    v_figures := v_figures || jsonb_build_object('orders', v_orders);
  END IF;

  -- The six full months before the due day, the same in every version of the year, whatever as_of is.
  SELECT count(*) AS months, avg(m.signed_in) AS signed_in, avg(m.signed_out_days) AS signed_out, bool_and(m.signed_out_days IS NOT NULL) AS counted_out
    INTO v_months
    FROM public.recipient_months m
   WHERE m.month >= (date_trunc('month', v_due AT TIME ZONE 'UTC') - make_interval(months => 6))::date
     AND m.month < date_trunc('month', v_due AT TIME ZONE 'UTC')::date;
  v_figures := v_figures || jsonb_build_object('recipients',
    CASE WHEN v_months.months < 6 THEN to_jsonb('not recorded'::text)
         WHEN v_months.counted_out THEN jsonb_build_object('low', public.band(round(v_months.signed_in)::bigint),
                                                           'high', public.band(round(v_months.signed_in + v_months.signed_out)::bigint))
         ELSE jsonb_build_object('low', public.band(round(v_months.signed_in)::bigint)) END);
  RETURN v_figures;
END $$;--> statement-breakpoint

-- 23. alert_steps(), replaced from its text in 0034_release with section 6.7's row marked 0036: matcher_down. Every
-- other line is 0034's, unchanged.
CREATE OR REPLACE FUNCTION "public"."alert_steps"() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_now timestamptz := now();
  r record;
  v_rows integer;
  v_written integer := 0;
BEGIN
  SELECT * INTO r FROM public.order_rules();

  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts, message_id)
  SELECT 'contact_mail_escalated', 5, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'contact_mail_escalated' AND o.message_id = m.id AND o.order_id IS NULL), 0),
         jsonb_build_object('receivedAt', public.alert_time(m.received_at), 'dueAt', public.alert_time(m.received_at + make_interval(mins => r.hour_minutes))),
         m.id
    FROM public.contact_messages m
   WHERE NOT m.stale AND m.disposition IS NULL
     AND m.received_at + make_interval(mins => r.escalate_minutes) <= v_now
     AND NOT EXISTS (SELECT 1 FROM auth.staff_sessions s WHERE s.created_at >= m.received_at OR s.last_used_at >= m.received_at)
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'contact_mail_escalated' AND o.message_id = m.id AND o.order_id IS NULL
                        AND o.created_at >= m.received_at + make_interval(mins => r.escalate_minutes))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts, message_id)
  SELECT 'order_due', 5, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'order_due' AND o.message_id = m.id AND o.order_id IS NULL), 0),
         -- The minutes left, rounded up and never below 0: an hour of order_rules() is hour_minutes minutes.
         jsonb_build_object('dueAt', public.alert_time(d.due_at),
                            'minutesLeft', greatest(0, ceil(extract(epoch FROM d.due_at - v_now) / extract(epoch FROM make_interval(mins => r.hour_minutes)) * r.hour_minutes))::integer),
         m.id
    FROM public.contact_messages m
   CROSS JOIN LATERAL (
     SELECT m.received_at + make_interval(mins => r.hour_minutes) AS due_at,
            CASE WHEN m.received_at + make_interval(mins => r.hour_minutes) <= v_now THEN m.received_at + make_interval(mins => r.hour_minutes)
                 WHEN m.received_at + make_interval(mins => r.remind_minutes) <= v_now THEN m.received_at + make_interval(mins => r.remind_minutes)
            END AS threshold) d
   WHERE NOT m.stale AND m.disposition IS NULL AND d.threshold IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'order_due' AND o.message_id = m.id AND o.order_id IS NULL AND o.created_at >= d.threshold)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts)
  SELECT 'alert_test', 3, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'alert_test' AND o.message_id IS NULL AND o.order_id IS NULL), 0),
         jsonb_build_object('at', public.alert_time(v_now))
   WHERE NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'alert_test' AND o.message_id IS NULL AND o.order_id IS NULL AND o.created_at >= v_now - make_interval(days => 1))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  -- 0027 (3f design, section 6.1, the rows marked 0025): an order's steps. Its clock started again by a restart rings the
  -- phone on call again, as a message's first push, once a restart: the threshold is the restart's clock_start, so a
  -- second restart alerts again with the next free step.
  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts, order_id)
  SELECT 'contact_mail', 5, 'on_call',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'contact_mail' AND o.order_id = c.order_id AND o.message_id IS NULL), 0),
         jsonb_build_object('dueAt', public.alert_time(c.deadline_at)),
         c.order_id
    FROM public.legal_order_clock c
    JOIN public.legal_orders lo ON lo.id = c.order_id
   WHERE lo.closed_at IS NULL AND NOT c.stopped AND c.clock_start IS NOT NULL AND c.items_open > 0
     AND EXISTS (SELECT 1 FROM public.legal_order_events e WHERE e.order_id = c.order_id AND e.kind IN ('grounds_ceased', 'clarification_received'))
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'contact_mail' AND o.order_id = c.order_id AND o.message_id IS NULL AND o.created_at >= c.clock_start)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  -- order_due for an order: a removal order that is not closed, whose clock runs, with an item neither disabled nor
  -- closed (one given effect in part is still due), at clock_start + remind_minutes and at the deadline, the later of the
  -- two that has passed. Its reminders end when it is given effect in full, closed, or stopped by an Annex III.
  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts, order_id)
  SELECT 'order_due', 5, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'order_due' AND o.order_id = c.order_id AND o.message_id IS NULL), 0),
         -- The minutes left, rounded up and never below 0: an hour of order_rules() is hour_minutes minutes.
         jsonb_build_object('dueAt', public.alert_time(c.deadline_at),
                            'minutesLeft', greatest(0, ceil(extract(epoch FROM c.deadline_at - v_now) / extract(epoch FROM make_interval(mins => r.hour_minutes)) * r.hour_minutes))::integer,
                            'itemsOpen', c.items_open),
         c.order_id
    FROM public.legal_order_clock c
    JOIN public.legal_orders lo ON lo.id = c.order_id
   CROSS JOIN LATERAL (
     SELECT CASE WHEN c.deadline_at <= v_now THEN c.deadline_at
                 WHEN c.clock_start + make_interval(mins => r.remind_minutes) <= v_now THEN c.clock_start + make_interval(mins => r.remind_minutes)
            END AS threshold) d
   WHERE lo.closed_at IS NULL AND NOT c.stopped AND c.clock_start IS NOT NULL AND c.items_open > 0 AND d.threshold IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'order_due' AND o.order_id = c.order_id AND o.message_id IS NULL AND o.created_at >= d.threshold)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  -- order_unverified, daily: among the orders that are not closed and are given effect, one count for each of its three
  -- conditions: an item disabled while the order is not verified, or added after its verification; no reasons of the
  -- authority recorded; a DSA order holding a notice with no recorded end. oldestAt is the first disabling among them.
  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts)
  SELECT 'order_unverified', 5, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'order_unverified' AND o.message_id IS NULL AND o.order_id IS NULL), 0),
         jsonb_build_object('count', u.unverified, 'textsMissing', u.texts_missing, 'holdsOpen', u.holds_open, 'oldestAt', public.alert_time(u.oldest_at))
    FROM (SELECT (count(*) FILTER (WHERE q.unverified))::integer AS unverified,
                 (count(*) FILTER (WHERE q.texts_missing))::integer AS texts_missing,
                 (count(*) FILTER (WHERE q.hold_open))::integer AS holds_open,
                 min(q.first_effect) FILTER (WHERE q.unverified OR q.texts_missing OR q.hold_open) AS oldest_at
            FROM (SELECT EXISTS (SELECT 1 FROM public.legal_order_items i
                                  WHERE i.order_id = lo.id AND i.disabled_at IS NOT NULL AND (lo.verified_at IS NULL OR i.added_at > lo.verified_at)) AS unverified,
                         lo.reasons IS NULL AS texts_missing,
                         (public.order_hold_until(lo.id) = 'infinity'::timestamptz
                          AND EXISTS (SELECT 1 FROM public.legal_order_items i JOIN public.decisions d ON d.order_item_id = i.id
                                       WHERE i.order_id = lo.id AND d.informed_at IS NULL)) AS hold_open,
                         (SELECT min(i.disabled_at) FROM public.legal_order_items i WHERE i.order_id = lo.id) AS first_effect
                    FROM public.legal_orders lo
                   WHERE lo.closed_at IS NULL
                     AND EXISTS (SELECT 1 FROM public.legal_order_items i WHERE i.order_id = lo.id AND i.disabled_at IS NOT NULL)) q) u
   WHERE u.unverified + u.texts_missing + u.holds_open > 0
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'order_unverified' AND o.message_id IS NULL AND o.order_id IS NULL AND o.created_at >= v_now - make_interval(days => 1))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  -- 0028 (3f design, section 6.1, the row marked 0026): hold_ending, daily, while an order has an untold decision whose
  -- order_hold_until is less than hold_warning_days ahead, so that whoever has the server checks the mailbox for an
  -- extension before the database releases. Facts: how many held notices, and the first end. A hold with no end
  -- ('infinity') is order_unverified's.
  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts)
  SELECT 'hold_ending', 3, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'hold_ending' AND o.message_id IS NULL AND o.order_id IS NULL), 0),
         jsonb_build_object('count', h.held, 'at', public.alert_time(h.first_end))
    FROM (SELECT count(*)::integer AS held, min(u.until) AS first_end
            FROM (SELECT public.order_hold_until(i.order_id) AS until
                    FROM public.decisions d JOIN public.legal_order_items i ON i.id = d.order_item_id
                   WHERE d.kind = 'order' AND d.informed_at IS NULL) u
           WHERE u.until IS NOT NULL AND u.until < 'infinity'::timestamptz AND u.until < v_now + make_interval(days => r.hold_warning_days)) h
   WHERE h.held > 0
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'hold_ending' AND o.message_id IS NULL AND o.order_id IS NULL AND o.created_at >= v_now - make_interval(days => 1))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  -- 0030 (3f design, section 6.1, the rows marked 0028): report_owed, daily, while at least one notification record is
  -- owed and was opened more than report_alert_hours ago; facts: how many, and the oldest's opening. Counts, no case.
  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts)
  SELECT 'report_owed', 5, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'report_owed' AND o.message_id IS NULL AND o.order_id IS NULL), 0),
         jsonb_build_object('count', q.owed, 'oldestAt', public.alert_time(q.oldest_at))
    FROM (SELECT count(*)::integer AS owed, min(n.opened_at) AS oldest_at
            FROM public.authority_notifications n
           WHERE n.state = 'owed' AND n.opened_at < v_now - make_interval(hours => r.report_alert_hours)) q
   WHERE q.owed > 0
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'report_owed' AND o.message_id IS NULL AND o.order_id IS NULL AND o.created_at >= v_now - make_interval(days => 1))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  -- handover_undestroyed, daily, while a production holds files, was delivered more than handover_alert_days ago and has
  -- no destroyed_at; facts: how many.
  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts)
  SELECT 'handover_undestroyed', 3, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'handover_undestroyed' AND o.message_id IS NULL AND o.order_id IS NULL), 0),
         jsonb_build_object('count', q.undestroyed)
    FROM (SELECT count(*)::integer AS undestroyed
            FROM public.productions p
           WHERE p.files IS NOT NULL AND p.destroyed_at IS NULL AND p.delivered_at < v_now - make_interval(days => r.handover_alert_days)) q
   WHERE q.undestroyed > 0
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'handover_undestroyed' AND o.message_id IS NULL AND o.order_id IS NULL AND o.created_at >= v_now - make_interval(days => 1))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  -- 0031 (3f design, section 6.1, the row marked 0029): copy_overdue, daily, while the newest copy mark is older than
  -- copy_overdue_hours, or there is none and the audit log's first row is that old; facts: the hours since the newest
  -- mark, or since that first row. This function is its one writer: no round of the API raises it as well.
  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts)
  SELECT 'copy_overdue', 3, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'copy_overdue' AND o.message_id IS NULL AND o.order_id IS NULL), 0),
         jsonb_build_object('hours', floor(extract(epoch FROM v_now - q.since) / extract(epoch FROM make_interval(hours => 1)))::integer)
    FROM (SELECT coalesce((SELECT m.at FROM public.copy_marks m ORDER BY m.at DESC, m.id DESC LIMIT 1),
                          (SELECT l.created_at FROM public.audit_log l ORDER BY l.chain_seq LIMIT 1)) AS since) q
   WHERE q.since IS NOT NULL AND q.since < v_now - make_interval(hours => r.copy_overdue_hours)
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'copy_overdue' AND o.message_id IS NULL AND o.order_id IS NULL AND o.created_at >= v_now - make_interval(days => 1))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  -- 0033 (3d design, section 6.1, the row marked 0030): quarantine_due, daily, while a move into the quarantine or back to
  -- the image store has been due for longer than the daily threshold (the contracts' QUARANTINE_RULES.dueHours); facts:
  -- how many images are due in and out together, and since when the oldest is. Counts and one time, no image.
  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts)
  SELECT 'quarantine_due', 3, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'quarantine_due' AND o.message_id IS NULL AND o.order_id IS NULL), 0),
         jsonb_build_object('count', c.due_in + c.due_out, 'oldestAt', public.alert_time(c.oldest))
    FROM public.quarantine_counts() c
   WHERE c.due_in + c.due_out > 0 AND c.oldest IS NOT NULL AND c.oldest <= v_now - make_interval(days => 1)
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'quarantine_due' AND o.message_id IS NULL AND o.order_id IS NULL AND o.created_at >= v_now - make_interval(days => 1))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  -- 0034 (3d design, section 6.2, the row marked 0031): release_undestroyed, daily, while a file the plan lists under
  -- destroy is still recorded in the quarantine and has been due for longer than the daily threshold: a released file
  -- counted from its release, a file of an image row that is gone from its record. Facts: how many such files there
  -- are, and the oldest time one became due. Counts and one time, no file.
  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts)
  SELECT 'release_undestroyed', 3, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'release_undestroyed' AND o.message_id IS NULL AND o.order_id IS NULL), 0),
         jsonb_build_object('count', u.n, 'oldestAt', public.alert_time(u.oldest))
    FROM (SELECT count(*)::integer AS n, min(coalesce(rel.released_at, q.moved_at)) AS oldest
            FROM public.quarantine_files q
            JOIN public.quarantine_plan() p ON p.media_id = q.media_id AND p.direction = 'destroy'
            LEFT JOIN public.release_posts rp ON rp.post_id = q.post_id
            LEFT JOIN public.releases rel ON rel.id = rp.release_id
           WHERE q.returned_at IS NULL AND q.destroyed_at IS NULL AND q.lost_at IS NULL) u
   WHERE u.n > 0 AND u.oldest <= v_now - make_interval(days => 1)
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'release_undestroyed' AND o.message_id IS NULL AND o.order_id IS NULL AND o.created_at >= v_now - make_interval(days => 1))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  -- 0039 (3d design, section 6.7, the row marked 0036): matcher_down, daily, while an upload's check has been unchecked
  -- since before matcher_down_minutes ago (by its image's created_at), within the retry's hours, and no check was
  -- answered clear or matched since then. Facts: since when, how many are unchecked, and how many wait under the
  -- limit on refusals. Counts and one time, no image.
  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts)
  SELECT 'matcher_down', 3, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'matcher_down' AND o.message_id IS NULL AND o.order_id IS NULL), 0),
         jsonb_build_object('since', public.alert_time(u.since), 'count', u.n,
                            'refusalsCapped', (SELECT count(*)::integer FROM public.media_hashes c WHERE c.check_state = 'capped'))
    FROM (SELECT count(*)::integer AS n, min(m.created_at) AS since
            FROM public.media_hashes h JOIN public.post_media m ON m.id = h.media_id CROSS JOIN public.automation_rules() a
           WHERE h.check_state = 'unchecked' AND m.created_at > v_now - make_interval(hours => a.match_retry_hours)
             AND m.created_at < v_now - make_interval(mins => a.matcher_down_minutes)) u
   WHERE u.n > 0
     AND NOT EXISTS (SELECT 1 FROM public.media_hashes h WHERE h.check_state IN ('clear', 'matched') AND h.checked_at > u.since)
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'matcher_down' AND o.message_id IS NULL AND o.order_id IS NULL AND o.created_at >= v_now - make_interval(days => 1))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  RETURN v_written;
END $$;

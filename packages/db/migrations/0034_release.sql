CREATE TABLE "release_leaves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"leave_from" text NOT NULL,
	"reference" text NOT NULL,
	"received_on" date NOT NULL,
	"untold" boolean NOT NULL,
	"untold_until" timestamp with time zone,
	"recorded_at" timestamp with time zone NOT NULL,
	"recorded_by" text,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" text,
	CONSTRAINT "release_leaves_from" CHECK ("release_leaves"."leave_from"::text in ('authority', 'court')),
	CONSTRAINT "release_leaves_reference" CHECK (char_length("release_leaves"."reference") between 1 and 200),
	CONSTRAINT "release_leaves_untold" CHECK ("release_leaves"."untold" or "release_leaves"."untold_until" is null),
	CONSTRAINT "release_leaves_withdrawn" CHECK (("release_leaves"."withdrawn_at" is null) = ("release_leaves"."withdrawn_by" is null)),
	CONSTRAINT "release_leaves_texts" CHECK (char_length("release_leaves"."recorded_by") <= 200 and char_length("release_leaves"."withdrawn_by") <= 200)
);
--> statement-breakpoint
ALTER TABLE "release_leaves" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "release_notices" (
	"subject_id" uuid PRIMARY KEY NOT NULL,
	"release_on" date NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"told" "delivery_state" DEFAULT 'pending' NOT NULL,
	"told_at" timestamp with time zone,
	"objection" text,
	"objected_at" timestamp with time zone,
	"objection_answered_at" timestamp with time zone,
	CONSTRAINT "release_notices_objection" CHECK (("release_notices"."objection" is null) = ("release_notices"."objected_at" is null) and char_length("release_notices"."objection") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "release_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "release_posts" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"release_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "release_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seal_action_id" uuid,
	"upload_refusal_id" uuid,
	"post_ids" uuid[] NOT NULL,
	"basis" text NOT NULL,
	"leave_id" uuid,
	"their_reference" text,
	"released_by" uuid,
	"released_at" timestamp with time zone NOT NULL,
	"replay_of" uuid,
	"backups_clear_at" timestamp with time zone NOT NULL,
	"author_notice" text NOT NULL,
	"author_notice_at" timestamp with time zone,
	"imported_at" timestamp with time zone,
	CONSTRAINT "releases_replay_of_key" UNIQUE("replay_of"),
	CONSTRAINT "releases_basis" CHECK ("releases"."basis" in ('leave', 'period')),
	CONSTRAINT "releases_leave" CHECK (("releases"."basis" = 'leave') = ("releases"."leave_id" is not null) and ("releases"."leave_id" is null) = ("releases"."their_reference" is null)),
	CONSTRAINT "releases_reference" CHECK (char_length("releases"."their_reference") between 1 and 200),
	CONSTRAINT "releases_notice" CHECK ("releases"."author_notice" in ('pending', 'sent', 'folded', 'suppressed', 'no_address', 'none', 'failed', 'held')),
	CONSTRAINT "releases_replay" CHECK (("releases"."replay_of" is null) = ("releases"."released_by" is not null) and ("releases"."replay_of" is null or "releases"."seal_action_id" is null))
);
--> statement-breakpoint
ALTER TABLE "releases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alert_outbox" DROP CONSTRAINT "alert_outbox_kind";--> statement-breakpoint
ALTER TABLE "restore_gaps" DROP CONSTRAINT "restore_gaps_class";--> statement-breakpoint
ALTER TABLE "release_posts" ADD CONSTRAINT "release_posts_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_released_by_profiles_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "release_leaves_notification_idx" ON "release_leaves" USING btree ("notification_id","recorded_at");--> statement-breakpoint
CREATE INDEX "release_posts_release_idx" ON "release_posts" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "releases_seal_idx" ON "releases" USING btree ("seal_action_id");--> statement-breakpoint
CREATE INDEX "releases_notice_idx" ON "releases" USING btree ("released_at") WHERE author_notice in ('pending', 'held');--> statement-breakpoint
ALTER TABLE "quarantine_files" ADD CONSTRAINT "quarantine_files_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_outbox" ADD CONSTRAINT "alert_outbox_kind" CHECK ("alert_outbox"."kind" in ('contact_mail', 'contact_mail_escalated', 'order_due', 'order_opened', 'order_corrected', 'order_effected', 'order_reinstated', 'order_unverified', 'hold_ending', 'report_owed', 'handover_undestroyed', 'copy_overdue', 'copy_taken', 'alert_channel_down', 'mailbox_unreachable', 'alert_test', 'moderation_urgent', 'moderation_waiting', 'moderation_burst', 'moderation_reads', 'moderation_reveal', 'moderation_csam_lifted', 'quarantine_due', 'quarantine_lost', 'release_undestroyed', 'seal_released'));--> statement-breakpoint
ALTER TABLE "restore_gaps" ADD CONSTRAINT "restore_gaps_class" CHECK ("restore_gaps"."class" in ('order_effect', 'seal_final', 'seal_interim', 'release', 'standing', 'restriction', 'reversal', 'no_measure', 'record'));--> statement-breakpoint
CREATE POLICY "release_leaves_api_none" ON "release_leaves" AS PERMISSIVE FOR SELECT TO "korbat_api" USING (false);--> statement-breakpoint
CREATE POLICY "release_notices_api_all" ON "release_notices" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "release_posts_api_all" ON "release_posts" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "releases_api_all" ON "releases" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Everything below is written by hand (3d design, sections 6 and 6.2). As in 0016 to 0033: every function is owned by
-- the migrator, pins its search path to public and pg_temp, names every object schema-qualified (auth's in full) and has
-- EXECUTE taken from PUBLIC; times the database writes are now(), the transaction's start; errors carry their code as the
-- message under SQLSTATE P0001. No function here holds an interval literal or a number of release_rules(): each reads it.
-- The replaced functions (frozen_for, append_confirmed_audit, gap_close, quarantine_plan, quarantine_counts, seal_custody
-- and alert_steps) are written from their built texts (0028, 0027, 0031 and 0033) with the changes named at each.
--
-- 1. The grants. 0001's default privileges gave the API role every right on a new public table; each table loses them
-- all, then gets what section 6.2 lists. release_leaves gets nothing: the API reads a leave only through release_facts,
-- and the command line, as the migrator, is its one writer. releases: read, and the two columns of the author's notice,
-- which releases_notice guards. release_posts: read. release_notices: read, and the four columns of its telling and its
-- objection.
REVOKE ALL ON "public"."release_leaves", "public"."releases", "public"."release_posts", "public"."release_notices" FROM korbat_api;--> statement-breakpoint
GRANT SELECT ON "public"."releases", "public"."release_posts", "public"."release_notices" TO korbat_api;--> statement-breakpoint
GRANT UPDATE ("author_notice", "author_notice_at") ON "public"."releases" TO korbat_api;--> statement-breakpoint
GRANT UPDATE ("told", "told_at", "objection", "objected_at") ON "public"."release_notices" TO korbat_api;--> statement-breakpoint

-- 2. release_rules(): the release's four constants (section 6.2), mirrored by the contracts' RELEASE_RULES and
-- RELEASE_POSTS_MAX, which a database test holds member for column. silence_days is counsel's and ships null: it changes
-- only by a later migration that replaces this function, and until then nothing is released by time.
CREATE FUNCTION "public"."release_rules"() RETURNS TABLE (silence_days integer, period_notice_days integer, backup_days integer, posts_max integer)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT NULL::integer, 30, 30, 1000
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."release_rules"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."release_rules"() TO korbat_api;--> statement-breakpoint

-- 3. seal_record(action): the id of 3f's record of the report of a seal, found by seal_report's own rule (0030): the
-- record the seal opened, or, for a seal that met its account's record already owed, the record a seal opened for the
-- account that was open when this seal was taken. seal_report answers that record's facts but not its id, which a leave
-- is recorded against and which release_tellable reads the marks of. Null when the seal has no record. Callable by
-- nobody but its owner: the definer functions below and the command line, as the migrator.
CREATE FUNCTION "public"."seal_record"(action uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT n.id
    FROM public.decision_actions a
    JOIN public.authority_notifications n ON n.account_id = a.subject_account_id AND n.opened_via = 'system'
   WHERE a.id = seal_record.action AND a.kind::text = 'seal_media'
     AND (n.seal_action_id = a.id OR (n.opened_at <= a.created_at AND (n.closed_at IS NULL OR n.closed_at >= a.created_at)))
   ORDER BY (n.seal_action_id = a.id) DESC, n.opened_at DESC, n.id
   LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."seal_record"(uuid) FROM PUBLIC;--> statement-breakpoint

-- 4. release_may_tell(leave, report, posts): whether the author of a release may be told, the three holds of section 6.2:
-- false while the leave is marked not to be told and its end is open or ahead; while an event of the record of the
-- report carries 3f's mark not_to_person with an end that is open or ahead (3f 7.13 step 6); while a decision about a
-- post of the release is untold under 3f's hold (informed_at null, which decisions_informed allows only to a held
-- decision). A leave the database does not hold (a replay whose lost leave is not recorded again) answers false: its mark
-- cannot be read, and the cautious side tells nobody yet. Callable by nobody but its owner.
CREATE FUNCTION "public"."release_may_tell"(leave uuid, report uuid, posts uuid[]) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT NOT (
       (release_may_tell.leave IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.release_leaves l WHERE l.id = release_may_tell.leave))
    OR EXISTS (SELECT 1 FROM public.release_leaves l
                WHERE l.id = release_may_tell.leave AND l.untold AND (l.untold_until IS NULL OR l.untold_until > now()))
    OR EXISTS (SELECT 1 FROM public.authority_notification_events e
                WHERE e.notification_id = release_may_tell.report AND e.not_to_person
                  AND (e.not_to_person_until IS NULL OR e.not_to_person_until > now()))
    OR EXISTS (SELECT 1 FROM public.cases c JOIN public.decisions d ON d.case_id = c.id
                WHERE c.target_type = 'post' AND c.target_id = ANY (release_may_tell.posts) AND d.informed_at IS NULL))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."release_may_tell"(uuid, uuid, uuid[]) FROM PUBLIC;--> statement-breakpoint

-- 5. release_leaves' two triggers. release_leaves_insert, plain, BEFORE INSERT: the time of the record is the database's,
-- and a new leave is not withdrawn. release_leaves_guard, plain, BEFORE UPDATE, binds every role, the migrator included,
-- since the migrator is the table's one writer: a recorded leave changes in two ways and no other. An open untold_until
-- is ended (set once, on a leave that is not withdrawn); and a leave recorded by mistake is withdrawn, once, its time
-- forced now(), and refused with leave_used while a release names it, which is read in a statement of its own after the
-- row's lock, so a withdrawal that waited for a release's FOR SHARE finds that release. Nothing of a withdrawn leave
-- changes. Every other change is refused (moderation_column, as 3c's guards answer).
CREATE FUNCTION "public"."release_leaves_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.recorded_at := now();
  NEW.withdrawn_at := NULL;
  NEW.withdrawn_by := NULL;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."release_leaves_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION "public"."release_leaves_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.notification_id IS DISTINCT FROM OLD.notification_id OR NEW.leave_from IS DISTINCT FROM OLD.leave_from
     OR NEW.reference IS DISTINCT FROM OLD.reference OR NEW.received_on IS DISTINCT FROM OLD.received_on OR NEW.untold IS DISTINCT FROM OLD.untold
     OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by THEN
    RAISE EXCEPTION 'moderation_column' USING DETAIL = 'A recorded leave is never rewritten: record the right one as a new leave.';
  END IF;
  IF OLD.withdrawn_at IS NOT NULL THEN
    IF NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at OR NEW.withdrawn_by IS DISTINCT FROM OLD.withdrawn_by OR NEW.untold_until IS DISTINCT FROM OLD.untold_until THEN
      RAISE EXCEPTION 'moderation_column' USING DETAIL = 'Nothing of a withdrawn leave changes.';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.untold_until IS DISTINCT FROM OLD.untold_until AND NOT (OLD.untold AND OLD.untold_until IS NULL AND NEW.untold_until IS NOT NULL) THEN
    RAISE EXCEPTION 'moderation_column' USING DETAIL = 'Only an open end of the hold on telling is ended, and only once.';
  END IF;
  IF NEW.withdrawn_at IS NOT NULL OR NEW.withdrawn_by IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.releases r WHERE r.leave_id = OLD.id) THEN
      RAISE EXCEPTION 'leave_used';
    END IF;
    NEW.withdrawn_at := now();
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."release_leaves_guard"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "release_leaves_insert" BEFORE INSERT ON "public"."release_leaves" FOR EACH ROW EXECUTE FUNCTION "public"."release_leaves_insert"();--> statement-breakpoint
CREATE TRIGGER "release_leaves_guard" BEFORE UPDATE ON "public"."release_leaves" FOR EACH ROW EXECUTE FUNCTION "public"."release_leaves_guard"();--> statement-breakpoint

-- 6. release_notices_insert, plain, BEFORE INSERT: the day's notice is born untold and without an objection, at the
-- database's time, whatever the insert supplied (its one writer is release_announce).
CREATE FUNCTION "public"."release_notices_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.created_at := now();
  NEW.told := 'pending';
  NEW.told_at := NULL;
  NEW.objection := NULL;
  NEW.objected_at := NULL;
  NEW.objection_answered_at := NULL;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."release_notices_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "release_notices_insert" BEFORE INSERT ON "public"."release_notices" FOR EACH ROW EXECUTE FUNCTION "public"."release_notices_insert"();--> statement-breakpoint

-- 7. releases_notice, plain, BEFORE INSERT OR UPDATE ON releases (section 6.2). At insert, whatever the insert supplied:
-- none for an author who no longer exists (no profile, or a deleted one, as decisions_record reads a deleted account);
-- else held while release_may_tell answers false for the new row, a replay's among them; else pending for a release and
-- none for a replay, whose author was told when the release was first taken. The record of the report is the leave's (a
-- replay names no seal), else the seal's. A row is inserted only by seal_release and release_replay, which run as their
-- owner, so this reads as the owner then. On an update by any role but the migrator, the notice leaves held only for
-- pending and only while release_tellable answers true, and never returns to held: the dispatch round makes that one
-- move in the round that finds the last hold ended. The trigger is plain so that current_user is the updating role; the
-- API's role reads the holds through release_tellable, a definer it may call.
CREATE FUNCTION "public"."releases_notice"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_author uuid;
  v_record uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_record := coalesce((SELECT l.notification_id FROM public.release_leaves l WHERE l.id = NEW.leave_id), public.seal_record(NEW.seal_action_id));
    IF NEW.seal_action_id IS NOT NULL THEN
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
REVOKE ALL ON FUNCTION "public"."releases_notice"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "releases_notice" BEFORE INSERT OR UPDATE ON "public"."releases" FOR EACH ROW EXECUTE FUNCTION "public"."releases_notice"();--> statement-breakpoint

-- 8. release_tellable(release): whether the author of this release may be told now (section 6.2): release_may_tell over
-- its leave, its record of the report and its posts. False for a release that does not exist. A boolean, nothing of a
-- record.
CREATE FUNCTION "public"."release_tellable"(release uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT public.release_may_tell(r.leave_id,
                            coalesce((SELECT l.notification_id FROM public.release_leaves l WHERE l.id = r.leave_id), public.seal_record(r.seal_action_id)),
                            r.post_ids)
                     FROM public.releases r WHERE r.id = release_tellable.release), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."release_tellable"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."release_tellable"(uuid) TO korbat_api;--> statement-breakpoint

-- 9. release_facts(action): what the console's release block shows of a seal (sections 6.2 and 8.5), one row, read as the
-- owner since 3f's records and the leaves are closed to the API's role:
--   reported, their_reference, answer, answered_at: from seal_report, the authority's assessment shown as what it is,
--     which no step of seal_release reads;
--   handed_over_at: the newest delivered_at of 3f's productions that hold files and name this ledger row;
--   quarantined: every post the seal lists and that is not released has as many image rows, erased or not, as its
--     seal_posts.images (which counts every row), and each unerased one has both its files in the quarantine by record,
--     moved or lost (6.1); preserved: post_preserved holds for one of those posts. Both over every unreleased post, not
--     over one part;
--   leave_*: the newest leave of the seal's record that is not withdrawn, or nulls;
--   tell_held: whether the author's notice of a release taken now, of the next part's posts, would be held.
CREATE FUNCTION "public"."release_facts"(action uuid)
RETURNS TABLE (reported boolean, their_reference text, answer text, answered_at timestamptz, handed_over_at timestamptz, quarantined boolean, preserved boolean,
               leave_id uuid, leave_from text, leave_reference text, leave_received_on date, leave_untold boolean, leave_untold_until timestamptz, tell_held boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH open_posts AS (
    SELECT s.post_id, s.images FROM public.seal_posts s
     WHERE s.action_id = release_facts.action AND NOT EXISTS (SELECT 1 FROM public.release_posts r WHERE r.post_id = s.post_id)
  ), part AS (
    SELECT coalesce(array_agg(o.post_id ORDER BY o.post_id), '{}'::uuid[]) AS posts
      FROM (SELECT p.post_id FROM open_posts p ORDER BY p.post_id LIMIT (SELECT x.posts_max FROM public.release_rules() x)) o
  ), standing_leave AS (
    SELECT l.* FROM public.release_leaves l
     WHERE l.notification_id = public.seal_record(release_facts.action) AND l.withdrawn_at IS NULL
     ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1
  )
  SELECT r.reported, r.their_reference, r.answer, r.answered_at,
         (SELECT max(p.delivered_at) FROM public.productions p WHERE p.seal_action_id = release_facts.action AND p.files IS NOT NULL),
         NOT EXISTS (SELECT 1 FROM open_posts o
                      WHERE (SELECT count(*) FROM public.post_media m WHERE m.post_id = o.post_id) <> o.images
                         OR EXISTS (SELECT 1 FROM public.post_media m
                                     WHERE m.post_id = o.post_id AND m.erased_at IS NULL
                                       AND (SELECT count(*) FROM public.quarantine_files q
                                             WHERE q.media_id = m.id AND q.returned_at IS NULL AND q.destroyed_at IS NULL) < 2)),
         EXISTS (SELECT 1 FROM open_posts o WHERE public.post_preserved(o.post_id)),
         l.id, l.leave_from, l.reference, l.received_on, l.untold, l.untold_until,
         NOT public.release_may_tell(l.id, public.seal_record(release_facts.action), (SELECT part.posts FROM part))
    FROM public.seal_report(release_facts.action) r
    LEFT JOIN standing_leave l ON true
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."release_facts"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."release_facts"(uuid) TO korbat_api;--> statement-breakpoint

-- 10. seal_release(action, basis, leave, staff): an admin's release of a seal for good (sections 6.2 and 7.2), called by
-- the release's route after it took the subject's profile, in this order:
--   1. the seal's ledger row, then its case FOR UPDATE; after that lock, in statements of their own: release_not_open
--      unless the row is a seal_media of a decision that is not interim, in force, listing a post not yet released. The
--      posts to release are the lowest posts_max of those, in id order: a seal over more is released in parts;
--   2. release_facts after the lock: release_not_reported, release_not_quarantined, release_preserved, each over every
--      unreleased post of the seal;
--   3. the ground. leave: release_no_leave unless the leave the request names belongs to this seal's record and is not
--      withdrawn, read FOR SHARE, so a withdrawal and a release of one leave run one after the other. The record's answer
--      is not read: an assessment is no ground. period: release_period_unset while silence_days is null; otherwise
--      release_period_running until silence_days have passed since the hand-over (or the report) and the day's notice
--      was told period_notice_days before and holds no unanswered objection. Any other word: release_no_leave;
--   4. admin_required unless `staff` is an admin, read FOR SHARE (staff_confirmation_ended for an account that ended);
--   5. one row of releases, one of release_posts a post, and erased_at on the posts' image rows where it is null, in id
--      order. backups_clear_at is the later of now and the newest move of the posts' files, plus backup_days.
-- It writes no decision and no ledger row: the seal stays in force, and the mark is what ends the freeze through it. The
-- route's audit row seal_released comes last, and releases_confirmed holds the row to it at commit.
CREATE FUNCTION "public"."seal_release"(action uuid, basis text, leave uuid, staff uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a public.decision_actions;
  d public.decisions;
  rules record;
  f record;
  l public.release_leaves;
  v_posts uuid[];
  v_role text;
  v_since timestamptz;
  v_moved timestamptz;
  v_release uuid := gen_random_uuid();
BEGIN
  SELECT x.* INTO a FROM public.decision_actions x WHERE x.id = seal_release.action;
  IF NOT FOUND OR a.kind::text <> 'seal_media' THEN
    RAISE EXCEPTION 'release_not_open';
  END IF;
  SELECT x.* INTO d FROM public.decisions x WHERE x.id = a.decision_id;
  PERFORM 1 FROM public.cases c WHERE c.id = d.case_id FOR UPDATE;
  IF d.kind::text = 'interim' OR NOT EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.id = a.id) THEN
    RAISE EXCEPTION 'release_not_open';
  END IF;
  SELECT x.* INTO rules FROM public.release_rules() x;
  SELECT coalesce(array_agg(o.post_id ORDER BY o.post_id), '{}'::uuid[]) INTO v_posts
    FROM (SELECT s.post_id FROM public.seal_posts s
           WHERE s.action_id = a.id AND NOT EXISTS (SELECT 1 FROM public.release_posts r WHERE r.post_id = s.post_id)
           ORDER BY s.post_id LIMIT rules.posts_max) o;
  IF cardinality(v_posts) = 0 THEN
    RAISE EXCEPTION 'release_not_open';
  END IF;

  SELECT x.* INTO f FROM public.release_facts(a.id) x;
  IF NOT f.reported THEN
    RAISE EXCEPTION 'release_not_reported';
  END IF;
  IF NOT f.quarantined THEN
    RAISE EXCEPTION 'release_not_quarantined';
  END IF;
  IF f.preserved THEN
    RAISE EXCEPTION 'release_preserved';
  END IF;

  IF seal_release.basis = 'leave' THEN
    SELECT x.* INTO l FROM public.release_leaves x
     WHERE x.id = seal_release.leave AND x.notification_id = public.seal_record(a.id) AND x.withdrawn_at IS NULL
       FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'release_no_leave';
    END IF;
  ELSIF seal_release.basis = 'period' THEN
    IF rules.silence_days IS NULL THEN
      RAISE EXCEPTION 'release_period_unset';
    END IF;
    v_since := coalesce(f.handed_over_at, (SELECT r.sent_at FROM public.seal_report(a.id) r));
    IF v_since IS NULL OR v_since + make_interval(days => rules.silence_days) > now()
       OR NOT EXISTS (SELECT 1 FROM public.release_notices n
                       WHERE n.subject_id = a.id AND n.told::text IN ('sent', 'folded')
                         AND n.created_at <= now() - make_interval(days => rules.period_notice_days)
                         AND (n.objection IS NULL OR n.objection_answered_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'release_period_running';
    END IF;
  ELSE
    RAISE EXCEPTION 'release_no_leave';
  END IF;

  SELECT u.role::text INTO v_role FROM auth.users u
   WHERE u.id = seal_release.staff AND u.deleted_at IS NULL AND u.role <> 'user' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_confirmation_ended';
  END IF;
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  SELECT max(q.moved_at) INTO v_moved FROM public.quarantine_files q WHERE q.post_id = ANY (v_posts);
  INSERT INTO public.releases (id, seal_action_id, post_ids, basis, leave_id, their_reference, released_by, released_at, backups_clear_at, author_notice)
  VALUES (v_release, a.id, v_posts, seal_release.basis, l.id, l.reference, seal_release.staff, now(),
          greatest(now(), coalesce(v_moved, now())) + make_interval(days => rules.backup_days), 'pending');
  INSERT INTO public.release_posts (post_id, release_id) SELECT p, v_release FROM unnest(v_posts) AS p;
  UPDATE public.post_media m SET erased_at = now()
    FROM (SELECT x.id FROM public.post_media x WHERE x.post_id = ANY (v_posts) AND x.erased_at IS NULL ORDER BY x.id FOR UPDATE) y
   WHERE m.id = y.id;
  RETURN v_release;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."seal_release"(uuid, text, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."seal_release"(uuid, text, uuid, uuid) TO korbat_api;--> statement-breakpoint

-- 11. releases_confirmed, deferred to the commit, for a release that is not a replay (section 6.2): the transaction's head
-- audit row must be seal_released on this seal's ledger row, name this release in metadata.releaseId, carry a step-up,
-- have been written by released_by, and hold params equal to the row under the contracts' names: the posts' ids, the
-- ground, the leave's id and its reference as its record holds it (the row copied it from the leave). Otherwise the commit
-- is refused, release_mismatch: what the admin's key confirmed is what was released, and the keeper's copy holds every
-- fact a replay needs. It only reads, so the audit row stays the transaction's last write.
CREATE FUNCTION "public"."releases_confirmed"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a public.audit_log;
BEGIN
  SELECT l.* INTO a FROM public.audit_head h JOIN public.audit_log l ON l.chain_seq = h.seq WHERE h.id = 1;
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
REVOKE ALL ON FUNCTION "public"."releases_confirmed"() FROM PUBLIC;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "releases_confirmed" AFTER INSERT ON "public"."releases" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.replay_of IS NULL) EXECUTE FUNCTION "public"."releases_confirmed"();--> statement-breakpoint

-- 12. release_announce(subject, staff): the day of a release by period, told to the author beforehand (section 6.2). As
-- built it answers release_period_unset, since silence_days ships null, and nothing reaches it: the route, the screen,
-- the objection's form and the mail release_day are built by the task that sets the period. With a period set: an
-- admin's (admin_required otherwise), on a seal for good in force (release_not_open) that is reported
-- (release_not_reported); the day is the later of silence_days after the hand-over (or the report) and
-- period_notice_days from now, in UTC; the row is written once and its day answered.
CREATE FUNCTION "public"."release_announce"(subject uuid, staff uuid) RETURNS date
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  rules record;
  f record;
  v_role text;
  v_since timestamptz;
BEGIN
  SELECT x.* INTO rules FROM public.release_rules() x;
  IF rules.silence_days IS NULL THEN
    RAISE EXCEPTION 'release_period_unset';
  END IF;
  SELECT u.role::text INTO v_role FROM auth.users u
   WHERE u.id = release_announce.staff AND u.deleted_at IS NULL AND u.role <> 'user' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_confirmation_ended';
  END IF;
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.id = release_announce.subject AND m.kind::text = 'seal_media' AND m.decision_kind::text <> 'interim') THEN
    RAISE EXCEPTION 'release_not_open';
  END IF;
  SELECT x.* INTO f FROM public.release_facts(release_announce.subject) x;
  IF NOT f.reported THEN
    RAISE EXCEPTION 'release_not_reported';
  END IF;
  v_since := coalesce(f.handed_over_at, (SELECT r.sent_at FROM public.seal_report(release_announce.subject) r));
  INSERT INTO public.release_notices (subject_id, release_on)
  VALUES (release_announce.subject,
          (greatest(v_since + make_interval(days => rules.silence_days), now() + make_interval(days => rules.period_notice_days)) AT TIME ZONE 'UTC')::date)
  ON CONFLICT (subject_id) DO NOTHING;
  RETURN (SELECT n.release_on FROM public.release_notices n WHERE n.subject_id = release_announce.subject);
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."release_announce"(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."release_announce"(uuid, uuid) TO korbat_api;--> statement-breakpoint

-- 13. release_replay(original, posts, basis, leave, their_reference, released_at): staff.js release-replay's write after a
-- restore (section 6.2, 7.3), as the migrator, with the app's site closed; EXECUTE to nobody. In this order:
--   1. present when a release with that id, or a replay of it, exists: idempotent, and a release the backup held is left;
--   2. replay_no_gap unless an open gap of the class release names that release (restore-import wrote it for a line it
--      checked against the chain) with these very params, so nothing but a verified line erases an image row;
--   3. one row of releases with replay_of, the original time, imported_at, no seal and no admin; its notice is forced
--      held or none by releases_notice;
--   4. a row of release_posts for each post that has none; 5. erased_at on the posts' image rows, in id order;
--   6. the gap closed as imported; 7. 'replayed <posts marked> <image rows erased>'.
-- It reads no seal: a post no seal of the restored database lists is marked all the same, and a seal for good taken again
-- afterwards lists a post that is already released and freezes nothing.
CREATE FUNCTION "public"."release_replay"(original uuid, posts uuid[], basis text, leave uuid, their_reference text, released_at timestamptz) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  g public.restore_gaps;
  rules record;
  v_posts uuid[];
  v_id uuid := gen_random_uuid();
  v_marked integer;
  v_erased integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.releases r WHERE r.id = release_replay.original OR r.replay_of = release_replay.original) THEN
    RETURN 'present';
  END IF;
  SELECT coalesce(array_agg(DISTINCT p ORDER BY p), '{}'::uuid[]) INTO v_posts FROM unnest(release_replay.posts) AS p;
  SELECT x.* INTO g FROM public.restore_gaps x
   WHERE x.class = 'release' AND x.closed_at IS NULL AND x.action = 'seal_released' AND x.metadata ->> 'releaseId' = release_replay.original::text
     AND x.metadata -> 'params' = jsonb_build_object('postIds', to_jsonb(v_posts::text[]), 'basis', release_replay.basis, 'leaveId', release_replay.leave, 'theirReference', release_replay.their_reference)
   ORDER BY x.place, x.id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'replay_no_gap';
  END IF;
  SELECT x.* INTO rules FROM public.release_rules() x;
  INSERT INTO public.releases (id, post_ids, basis, leave_id, their_reference, released_at, replay_of, backups_clear_at, author_notice, imported_at)
  VALUES (v_id, v_posts, release_replay.basis, release_replay.leave, release_replay.their_reference, coalesce(release_replay.released_at, g.acted_at),
          release_replay.original, now() + make_interval(days => rules.backup_days), 'none', now());
  INSERT INTO public.release_posts (post_id, release_id) SELECT p, v_id FROM unnest(v_posts) AS p ON CONFLICT (post_id) DO NOTHING;
  GET DIAGNOSTICS v_marked = ROW_COUNT;
  UPDATE public.post_media m SET erased_at = now()
    FROM (SELECT x.id FROM public.post_media x WHERE x.post_id = ANY (v_posts) AND x.erased_at IS NULL ORDER BY x.id FOR UPDATE) y
   WHERE m.id = y.id;
  GET DIAGNOSTICS v_erased = ROW_COUNT;
  UPDATE public.restore_gaps x SET closed_at = now(), disposition = 'imported' WHERE x.id = g.id;
  RETURN format('replayed %s %s', v_marked, v_erased);
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."release_replay"(uuid, uuid[], text, uuid, text, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- 14. frozen_for, replaced from its text in 0028 (3d design, section 6.2): only the seal arm changes, a seal in force lists
-- the post and the post is not released (release_posts, keyed on the post). The other three arms are untouched, so a
-- released post with a new unanswered suspect item is frozen again through the first, and a preserved one through the
-- fourth. It stays an SQL function that names no enum value.
CREATE OR REPLACE FUNCTION "public"."frozen_for"(post uuid, author uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
      SELECT 1 FROM public.cases c
      JOIN public.intake_items i ON i.case_id = c.id AND i.suspect AND i.answered_by IS NULL
      WHERE c.closed_at IS NULL AND c.target_type = 'post' AND c.target_id = frozen_for.post)
    OR EXISTS (
      SELECT 1 FROM public.cases c
      JOIN public.intake_items i ON i.case_id = c.id AND i.suspect AND i.answered_by IS NULL
      WHERE c.closed_at IS NULL AND c.target_type = 'account' AND c.target_id = frozen_for.author)
    OR EXISTS (
      SELECT 1 FROM public.seal_posts s
      JOIN public.measures_in_force m ON m.id = s.action_id
      WHERE s.post_id = frozen_for.post
        AND NOT EXISTS (SELECT 1 FROM public.release_posts r WHERE r.post_id = frozen_for.post))
    OR public.post_preserved(frozen_for.post)
$$;--> statement-breakpoint
-- 15. append_confirmed_audit, replaced from its text in 0027: its list of actions gains seal_released, an admin's release
-- (section 6.2). Nothing else changes; CREATE OR REPLACE keeps its owner and grants.
CREATE OR REPLACE FUNCTION "public"."append_confirmed_audit"(actor_id uuid, key_id uuid, action text, target_type text, target_id text, metadata jsonb, staff_session uuid, action_hash text, step_up jsonb, request_id text, expires_ms bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  place bigint;
  stamped timestamptz;
BEGIN
  IF append_confirmed_audit.action IS NULL OR append_confirmed_audit.action NOT IN ('case_decided', 'appeals_reviewed', 'identity_revealed', 'order_event_recorded', 'order_corrected', 'order_effected', 'gap_closed', 'audit_exported', 'seal_released') THEN
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
-- 16. gap_close, replaced from its text in 0031 (3d design, sections 7.3 and 8.7): a gap of the class release is refused
-- (gap_mismatch) before anything else is read: the console offers no control for it, and the database holds that.
CREATE OR REPLACE FUNCTION "public"."gap_close"(gap uuid, decision uuid, by_staff uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  g public.restore_gaps;
  dec public.decisions;
  v_role text;
  v_fits boolean;
  v_target jsonb;
BEGIN
  SELECT x.* INTO g FROM public.restore_gaps x WHERE x.id = gap_close.gap FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF g.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'gap_mismatch' USING DETAIL = 'The gap is closed already.';
  END IF;
  -- 0034: a gap of the class release (a lost release, a lost leave or a lost withdrawal of one) is closed only by its
  -- command, release-replay or release-leave, as the migrator: no key closes it, neither as not needed nor by a decision.
  IF g.class = 'release' THEN
    RAISE EXCEPTION 'gap_mismatch' USING DETAIL = 'class: a release gap is closed by staff.js release-replay or release-leave, not by a key.';
  END IF;

  IF gap_close.decision IS NULL THEN
    SELECT u.role::text INTO v_role FROM auth.users u
     WHERE u.id = gap_close.by_staff AND u.deleted_at IS NULL AND u.role <> 'user' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'staff_confirmation_ended';
    END IF;
    IF v_role <> 'admin' THEN
      RAISE EXCEPTION 'admin_required';
    END IF;
    UPDATE public.restore_gaps x SET closed_at = now(), disposition = 'not_needed' WHERE x.id = g.id;
    RETURN;
  END IF;

  SELECT x.* INTO dec FROM public.decisions x WHERE x.id = gap_close.decision;
  IF NOT FOUND OR dec.xact IS DISTINCT FROM pg_current_xact_id() OR dec.decided_at IS DISTINCT FROM now() OR dec.decided_by IS DISTINCT FROM gap_close.by_staff THEN
    RAISE EXCEPTION 'gap_mismatch' USING DETAIL = 'decision: not a decision this transaction made by the acting account.';
  END IF;
  -- A measure is a row that reverses nothing; a reversal names the measure it lifts.
  v_fits := CASE g.class
    WHEN 'order_effect' THEN dec.kind::text = 'order' AND g.target_type = 'order_item' AND dec.order_item_id::text IS NOT DISTINCT FROM g.target_id
    WHEN 'seal_final' THEN dec.kind::text = 'final' AND EXISTS (SELECT 1 FROM public.decision_actions a WHERE a.decision_id = dec.id AND a.kind::text = 'seal_media')
    WHEN 'seal_interim' THEN dec.kind::text = 'interim' AND EXISTS (SELECT 1 FROM public.decision_actions a WHERE a.decision_id = dec.id AND a.kind::text = 'seal_media')
    WHEN 'standing' THEN EXISTS (SELECT 1 FROM public.decision_actions a WHERE a.decision_id = dec.id AND a.kind::text IN ('suspend', 'terminate'))
    WHEN 'restriction' THEN EXISTS (SELECT 1 FROM public.decision_actions a
                                     WHERE a.decision_id = dec.id AND a.reverses_action_id IS NULL AND a.kind::text NOT IN ('seal_media', 'suspend', 'terminate', 'disable_by_order'))
    WHEN 'reversal' THEN EXISTS (SELECT 1 FROM public.decision_actions a WHERE a.decision_id = dec.id AND a.reverses_action_id IS NOT NULL)
    WHEN 'no_measure' THEN true
    ELSE false
  END;
  IF NOT v_fits THEN
    RAISE EXCEPTION 'gap_mismatch' USING DETAIL = 'class: the decision does not take again what the gap lost.';
  END IF;
  IF g.class <> 'order_effect' AND g.metadata ? 'target' THEN
    SELECT jsonb_build_object('type', c.target_type, 'id', c.target_id) INTO v_target FROM public.cases c WHERE c.id = dec.case_id;
    IF v_target IS DISTINCT FROM g.metadata -> 'target' THEN
      RAISE EXCEPTION 'gap_mismatch' USING DETAIL = 'target: the decision''s case is about another target than the lost decision''s.';
    END IF;
  END IF;
  UPDATE public.restore_gaps x SET closed_at = now(), closed_by = dec.id, disposition = 'reapplied' WHERE x.id = g.id;
END $$;--> statement-breakpoint
-- 17. quarantine_plan, replaced from its text in 0033 (section 6.2): destroy gains every image with a file without an end,
-- not marked unknown, whose post is released (quarantine_files.post_id in release_posts), so a released file is listed
-- whether or not the disposal has dropped its image row yet; quarantine-record then writes the release's id from that
-- post. A released image's rows are erased, so it is in neither in nor out. Everything else is 0033's.
CREATE OR REPLACE FUNCTION "public"."quarantine_plan"() RETURNS TABLE (direction text, media_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH good AS (
    SELECT DISTINCT s.post_id FROM public.seal_posts s JOIN public.measures_in_force f ON f.id = s.action_id
     WHERE f.kind = 'seal_media' AND f.decision_kind <> 'interim'
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
  SELECT 'out'::text, o.media_id FROM open_files o JOIN public.post_media m ON m.id = o.media_id
   WHERE NOT o.unknown AND m.post_id IS NOT NULL AND m.erased_at IS NULL AND NOT EXISTS (SELECT 1 FROM good g WHERE g.post_id = m.post_id)
  UNION ALL
  SELECT 'destroy'::text, o.media_id FROM open_files o
   WHERE NOT o.unknown AND (o.released OR NOT EXISTS (SELECT 1 FROM public.post_media m WHERE m.id = o.media_id))
  UNION ALL
  SELECT 'operator'::text, o.media_id FROM open_files o WHERE o.unknown
$$;--> statement-breakpoint
-- 18. quarantine_counts, replaced from its text in 0033: `undestroyed` counts the files of the destroy set still in the
-- quarantine, no longer their images, since the home screen's line says "Released files to destroy" and the receipt and
-- the alert release_undestroyed count files. Everything else is 0033's.
CREATE OR REPLACE FUNCTION "public"."quarantine_counts"() RETURNS TABLE (due_in integer, due_out integer, undestroyed integer, oldest timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH plan AS (
    SELECT p.direction, p.media_id FROM public.quarantine_plan() p
  ), in_at AS (
    SELECT min(f_d.decided_at) AS at
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
-- 19. seal_custody, replaced from its text in 0033: `files_left` is the files of the seal's released posts not yet
-- destroyed, found through quarantine_files.post_id, since their image rows are erased and then dropped. Everything
-- else is 0033's.
CREATE OR REPLACE FUNCTION "public"."seal_custody"(action uuid) RETURNS TABLE (files integer, moved integer, moved_at timestamptz, to_return integer, files_left integer, lost integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH posts AS (
    SELECT s.post_id FROM public.seal_posts s WHERE s.action_id = seal_custody.action
  ), images AS (
    SELECT m.id FROM public.post_media m JOIN posts p ON p.post_id = m.post_id WHERE m.erased_at IS NULL
  ), present AS (
    SELECT q.moved_at FROM public.quarantine_files q JOIN images i ON i.id = q.media_id
     WHERE q.returned_at IS NULL AND q.destroyed_at IS NULL AND q.lost_at IS NULL
  ), to_return AS (
    SELECT p.media_id FROM public.quarantine_plan() p JOIN public.post_media m ON m.id = p.media_id JOIN posts x ON x.post_id = m.post_id
     WHERE p.direction = 'out'
  )
  SELECT (2 * (SELECT count(*) FROM images))::integer,
         (SELECT count(*) FROM present)::integer,
         (SELECT max(present.moved_at) FROM present),
         (SELECT count(*) FROM public.quarantine_files q JOIN to_return t ON t.media_id = q.media_id
           WHERE q.returned_at IS NULL AND q.destroyed_at IS NULL AND q.lost_at IS NULL)::integer,
         (SELECT count(*) FROM public.quarantine_files q JOIN posts p ON p.post_id = q.post_id
           WHERE EXISTS (SELECT 1 FROM public.release_posts r WHERE r.post_id = q.post_id)
             AND q.returned_at IS NULL AND q.destroyed_at IS NULL AND q.lost_at IS NULL)::integer,
         (SELECT count(*) FROM public.quarantine_files q JOIN posts p ON p.post_id = q.post_id WHERE q.lost_at IS NOT NULL)::integer
$$;--> statement-breakpoint
-- 20. alert_steps(), replaced from its text in 0033_quarantine with section 6.2's row marked 0031: release_undestroyed.
-- Every other line is 0033's, unchanged.
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

  RETURN v_written;
END $$;

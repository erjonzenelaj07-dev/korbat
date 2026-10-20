ALTER TABLE "alert_outbox" DROP CONSTRAINT "alert_outbox_kind";--> statement-breakpoint
ALTER TABLE "head_publications" ADD COLUMN "keeper_mailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transparency_editions" ADD COLUMN "counted_orders" uuid[];--> statement-breakpoint
ALTER TABLE "alert_outbox" ADD CONSTRAINT "alert_outbox_kind" CHECK ("alert_outbox"."kind" in ('contact_mail', 'contact_mail_escalated', 'order_due', 'order_opened', 'order_corrected', 'order_effected', 'order_reinstated', 'order_unverified', 'hold_ending', 'report_owed', 'handover_undestroyed', 'copy_overdue', 'copy_taken', 'alert_channel_down', 'mailbox_unreachable', 'alert_test', 'moderation_urgent', 'moderation_waiting', 'moderation_burst', 'moderation_reads', 'moderation_reveal', 'moderation_csam_lifted', 'quarantine_due', 'quarantine_lost', 'release_undestroyed', 'seal_released', 'edge_purge_failed', 'head_unwitnessed', 'head_missed', 'automated_objection', 'automation_capped', 'automated_waiting', 'matcher_down', 'hold_ended_unreported', 'head_unmailed'));--> statement-breakpoint
-- Written by hand below the lines drizzle generated (3d design, sections 6.2 to 6.8, and the fixes one adversarial review
-- of the built code upheld; Task 9). The generated lines add the alert kind head_unmailed (review M13), the keeper's mail
-- column of head_publications (M13) and the order ids a version of the edition counted (M4). As in 0016 to 0040: every
-- function is owned by the migrator, pins its search path to public and pg_temp, names every object schema-qualified
-- (auth's in full) and has EXECUTE taken from PUBLIC; an error carries its code as the message under SQLSTATE P0001; enum
-- values are compared as text, and no function 3d created holds an interval literal. Each replaced function is written
-- in full from its newest text, which is named at each, with the changes named there and no other.

-- 1. frozen_for, replaced from its text in 0034_release (review H2): the seal arm also holds a released post while its
-- release's notice is held (author_notice 'held'), so until the dispatch round that tells the notice the post reads as it
-- did under the seal: its image rows cannot be deleted, the disposal keeps them, and a decision on its case meets the
-- freeze as before. The other three arms are untouched. It stays an SQL function that names no enum value.
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
        AND NOT EXISTS (SELECT 1 FROM public.release_posts r JOIN public.releases x ON x.id = r.release_id
                         WHERE r.post_id = frozen_for.post AND x.author_notice <> 'held'))
    OR public.post_preserved(frozen_for.post)
$$;--> statement-breakpoint

-- 2. seal_release, replaced from its text in 0034_release (review M2): after the case's lock and the check that the seal
-- is open, staff_recused when the admin is too close to the seal's case (staff_case_conflict without the reporters, as
-- the routes ask), so a release on a linked account is refused before anything is written and not after its commit.
-- Everything else is 0034's.
CREATE OR REPLACE FUNCTION "public"."seal_release"(action uuid, basis text, leave uuid, staff uuid) RETURNS uuid
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
  -- Review M2: an admin too close to the seal's subject (staff_case_conflict, 3c's recusal) is refused before any fact.
  IF public.staff_case_conflict(seal_release.staff, d.case_id, false) THEN
    RAISE EXCEPTION 'staff_recused';
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

-- 3. upload_hold_end, replaced from its text in 0039_known_material (review M2 and L4): staff_recused after the admin's
-- check when the admin is too close to the uploader (staff_party_conflict over the uploader alone); and in the end as
-- no_report the uploader's auth.report_holds row is locked FOR UPDATE before the two reads that decide whether the
-- address is released, so a second refusal written meanwhile keeps the hold. Everything else is 0039's.
CREATE OR REPLACE FUNCTION "public"."upload_hold_end"(refusal uuid, end_as text, reason text, staff uuid) RETURNS void
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
  -- Review M2: an admin too close to the uploader (3c's recusal, staff_party_conflict) is refused, and nothing is written.
  IF u.owner_id IS NOT NULL AND public.staff_party_conflict(upload_hold_end.staff, ARRAY[u.owner_id], NULL) THEN
    RAISE EXCEPTION 'staff_recused';
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
    -- Review L4: the address's hold row first, FOR UPDATE, as a refusal's trigger takes it: a refusal of the same account
    -- that commits while this waits is then seen by the reads below, each a statement of its own after the lock.
    IF u.owner_id IS NOT NULL THEN
      PERFORM 1 FROM auth.report_holds h WHERE h.user_id = u.owner_id FOR UPDATE;
    END IF;
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

-- 4. upload_release, replaced from its text in 0039_known_material (review M2): staff_recused right after the refusal's
-- lock when the admin is too close to the uploader. Everything else is 0039's.
CREATE OR REPLACE FUNCTION "public"."upload_release"(refusal uuid, basis text, leave uuid, staff uuid) RETURNS uuid
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
  -- Review M2: an admin too close to the uploader is refused before any fact.
  IF u.owner_id IS NOT NULL AND public.staff_party_conflict(upload_release.staff, ARRAY[u.owner_id], NULL) THEN
    RAISE EXCEPTION 'staff_recused';
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

-- 5. edition_publish, replaced from its text in 0036_transparency (review M3 and M4). M3: before the year's lock, null
-- and nothing written for a year that ended before the oldest account's creation (no profile created before the next
-- year began, which is also the case while no profile exists), so the API never freezes an edition of a year korbat did
-- not run. M4: each version stores in counted_orders the orders transparency_order_ids() named at its instant, and a
-- version hold_ended is due when the list at this call's instant names an order that the newest version's stored list
-- does not (6.4 step 2's "the newest version's orders"), not a list computed again at that version's instant, which
-- reads order_hold_until() as it stands now: an end recorded later with an instant before the version made the order
-- look counted then, and it was left out for good. A version stored before this migration has no list and is read as
-- the list at its instant, as before. The public read never returns the column. Everything else is 0036's.
CREATE OR REPLACE FUNCTION "public"."edition_publish"(year integer, reason text) RETURNS smallint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  k record;
  v_at timestamptz;
  v_due timestamptz;
  newest public.transparency_editions;
  v_exists boolean;
  v_version smallint;
  v_reason text;
  v_figures jsonb;
  v_orders jsonb;
BEGIN
  IF edition_publish.reason IS NULL OR edition_publish.reason NOT IN ('first', 'correction') THEN
    RAISE EXCEPTION 'invalid_edition';
  END IF;
  IF edition_publish.reason = 'correction' AND session_user <> 'korbat_migrate' THEN
    RAISE EXCEPTION 'invalid_edition';
  END IF;
  -- Review M3: a year that ended before the oldest account's creation, or any year while no account exists, is no year
  -- korbat ran: nothing is stored for it, whoever asks.
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.created_at < make_timestamptz(edition_publish.year + 1, 1, 1, 0, 0, 0, 'UTC')) THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('korbat.edition:' || edition_publish.year::text, 0));
  SELECT * INTO k FROM public.transparency_rules();
  v_at := clock_timestamp();
  v_due := make_timestamptz(edition_publish.year + 1, k.due_month, k.due_day, 0, 0, 0, 'UTC');
  SELECT * INTO newest FROM public.transparency_editions e WHERE e.year = edition_publish.year ORDER BY e.version DESC LIMIT 1;
  v_exists := FOUND;
  IF edition_publish.reason = 'correction' THEN
    IF v_at < v_due THEN
      RAISE EXCEPTION 'edition_not_due';
    END IF;
    IF NOT v_exists THEN
      RAISE EXCEPTION 'invalid_edition';
    END IF;
    v_figures := public.transparency_figures(edition_publish.year, v_at);
    v_version := newest.version + 1;
    v_reason := 'correction';
  ELSIF NOT v_exists THEN
    IF v_at < v_due THEN
      RETURN NULL;
    END IF;
    v_figures := public.transparency_figures(edition_publish.year, v_at);
    v_version := 1;
    v_reason := 'first';
  ELSIF EXISTS (SELECT a.id FROM public.transparency_order_ids(edition_publish.year, v_at) AS a(id)
                EXCEPT
                SELECT b.id FROM unnest(coalesce(newest.counted_orders,
                                                 ARRAY(SELECT c.id FROM public.transparency_order_ids(edition_publish.year, newest.computed_at) AS c(id)))) AS b(id)) THEN
    v_orders := public.transparency_orders(edition_publish.year, v_at);
    v_figures := (newest.figures - 'orders') || CASE WHEN v_orders IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('orders', v_orders) END;
    v_version := newest.version + 1;
    v_reason := 'hold_ended';
  ELSE
    RETURN NULL;
  END IF;
  INSERT INTO public.transparency_editions (year, version, computed_at, published_at, method, reason, figures, counted_orders)
  VALUES (edition_publish.year, v_version, v_at, v_at, k.method, v_reason, v_figures,
          ARRAY(SELECT o.id FROM public.transparency_order_ids(edition_publish.year, v_at) AS o(id) ORDER BY o.id));
  -- The system actor (apps/api/src/auth/admin.ts, SYSTEM_ACTOR_ID): no person published it.
  INSERT INTO public.audit_log (actor_id, action, target_type, target_id, metadata)
  VALUES ('00000000-0000-0000-0000-000000000000', 'edition_published', 'edition', edition_publish.year::text || '.' || v_version::text,
          jsonb_build_object('year', edition_publish.year, 'version', v_version, 'reason', v_reason));
  RETURN v_version;
END $$;--> statement-breakpoint

-- 6. upload_refusals_logged, SECURITY DEFINER, AFTER INSERT ON upload_refusals (review M7): every refusal writes the
-- system's plain audit row upload_refused on the refusal, naming its image, in the transaction that stored it and as its
-- last write (the trigger's name sorts after upload_refusals_hold's, so it fires after it, and nothing follows a
-- refusal's insert in the media module's transactions). A restore that loses the refusal then loses no fact: the
-- keeper's copy holds the line, and staff.js release-replay holds the upload again (upload_refused_replay).
CREATE FUNCTION "public"."upload_refusals_logged"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- The system actor (apps/api/src/auth/admin.ts, SYSTEM_ACTOR_ID): no person refused it.
  INSERT INTO public.audit_log (actor_id, action, target_type, target_id, metadata)
  VALUES ('00000000-0000-0000-0000-000000000000', 'upload_refused', 'upload_refusal', NEW.id::text, jsonb_build_object('mediaId', NEW.media_id));
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."upload_refusals_logged"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "upload_refusals_logged" AFTER INSERT ON "public"."upload_refusals" FOR EACH ROW EXECUTE FUNCTION "public"."upload_refusals_logged"();--> statement-breakpoint

-- 7. upload_refused_replay(refusal, media): staff.js release-replay for a lost upload_refused line (review M7), as the
-- migrator; EXECUTE to nobody. present, with nothing written, when the restored database holds the refusal, and when the
-- image row is held already or erased (a replay's own mark, so a second run writes nothing). Otherwise the image row
-- `media` names, on no post, is held again: hold_until infinity, so nothing sweeps it and post_media_refused refuses its
-- attach (upload_refused), and it answers held 1; held 0 when no such row is left. A later line of the same upload (its
-- end, its release) is replayed after it, in place order. No gap names a refusal: the line itself is the fact, and the
-- replay takes only lines above the restored head.
CREATE FUNCTION "public"."upload_refused_replay"(refusal uuid, media uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m public.post_media;
BEGIN
  IF EXISTS (SELECT 1 FROM public.upload_refusals u WHERE u.id = upload_refused_replay.refusal) THEN
    RETURN 'present';
  END IF;
  SELECT x.* INTO m FROM public.post_media x WHERE x.id = upload_refused_replay.media AND x.post_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'held 0';
  END IF;
  IF m.erased_at IS NOT NULL OR m.hold_until = 'infinity'::timestamptz THEN
    RETURN 'present';
  END IF;
  UPDATE public.post_media x SET hold_until = 'infinity'::timestamptz WHERE x.id = m.id;
  RETURN 'held 1';
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."upload_refused_replay"(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- 8. upload_hold_replay, replaced from its text in 0039_known_material (review M5): the image row is changed only while
-- it is not erased, so the replay of an end as report after the replay of the release erased the row no longer sets its
-- hold to infinity and keeps the file for good. Everything else is 0039's.
CREATE OR REPLACE FUNCTION "public"."upload_hold_replay"(refusal uuid, media uuid, end_as text, ended_at timestamptz) RETURNS text
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
  -- Review M5: a row a replayed release erased already is passed over, so a release replayed before the end never keeps
  -- its file for good.
  IF upload_hold_replay.end_as = 'report' THEN
    UPDATE public.post_media m SET hold_until = 'infinity'::timestamptz WHERE m.id = upload_hold_replay.media AND m.post_id IS NULL AND m.erased_at IS NULL;
  ELSE
    UPDATE public.post_media m SET erased_at = now(), hold_until = now() WHERE m.id = upload_hold_replay.media AND m.post_id IS NULL AND m.erased_at IS NULL;
  END IF;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  UPDATE public.restore_gaps x SET closed_at = now(), disposition = 'imported' WHERE x.id = g.id;
  RETURN format('replayed %s', v_changed);
END $$;--> statement-breakpoint

-- 9. The keeper's mail on the day's head row (review M13): the API's role may set keeper_mailed_at, the column the
-- generated lines above add, once, from null, at the clock's time. head_publications_insert and head_publications_guard
-- are replaced from their texts in 0037_head_publications with that column and nothing else: an insert by any role but
-- the migrator leaves it null, and the guard lets it change only from null, forcing now().
GRANT UPDATE ("keeper_mailed_at") ON "public"."head_publications" TO korbat_api;--> statement-breakpoint
-- A value published before this migration was mailed, if at all, by the round that published it, which kept no state:
-- it is taken as mailed, so the first day after the upgrade raises no head_unmailed for it.
UPDATE "public"."head_publications" SET "keeper_mailed_at" = "published_at" WHERE "kind" = 'head' AND "published_at" IS NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."head_publications_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_seq bigint;
  v_hash text;
BEGIN
  IF current_user = 'korbat_migrate' THEN
    RETURN NEW;
  END IF;
  SELECT a.seq, a.hash INTO v_seq, v_hash FROM public.audit_head a WHERE a.id = 1;
  NEW.kind := 'head';
  NEW.day := (now() AT TIME ZONE 'UTC')::date;
  NEW.chain_seq := v_seq;
  NEW.value := public.head_value(NEW.day, v_seq, v_hash);
  NEW.token := NULL;
  NEW.witnessed_at := NULL;
  NEW.published_at := NULL;
  NEW.retired_at := NULL;
  NEW.last_day := NULL;
  NEW.keeper_mailed_at := NULL;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."head_publications_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'korbat_migrate' THEN
    RETURN NEW;
  END IF;
  IF NEW.day IS DISTINCT FROM OLD.day OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.chain_seq IS DISTINCT FROM OLD.chain_seq
     OR NEW.value IS DISTINCT FROM OLD.value OR NEW.witness IS DISTINCT FROM OLD.witness OR NEW.retired_at IS DISTINCT FROM OLD.retired_at
     OR NEW.last_day IS DISTINCT FROM OLD.last_day
     OR (OLD.token IS NOT NULL AND NEW.token IS DISTINCT FROM OLD.token)
     OR (OLD.witnessed_at IS NOT NULL AND NEW.witnessed_at IS DISTINCT FROM OLD.witnessed_at)
     OR (OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at)
     OR (OLD.keeper_mailed_at IS NOT NULL AND NEW.keeper_mailed_at IS DISTINCT FROM OLD.keeper_mailed_at) THEN
    RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
  END IF;
  IF OLD.witnessed_at IS NULL AND NEW.witnessed_at IS NOT NULL THEN
    NEW.witnessed_at := now();
  END IF;
  IF OLD.published_at IS NULL AND NEW.published_at IS NOT NULL THEN
    NEW.published_at := now();
  END IF;
  IF OLD.keeper_mailed_at IS NULL AND NEW.keeper_mailed_at IS NOT NULL THEN
    NEW.keeper_mailed_at := now();
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

-- 10. quarantine_files_update, replaced from its text in 0033_quarantine (review M12): a lost file's notice may move from
-- none to pending, and then only to what quarantine_lost_told() says at that moment; every other change of lost_told is
-- still from pending alone. Everything else is 0033's.
CREATE OR REPLACE FUNCTION "public"."quarantine_files_update"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.media_id := OLD.media_id;
  NEW.file := OLD.file;
  NEW.post_id := OLD.post_id;
  NEW.unknown := OLD.unknown;
  NEW.imported_at := OLD.imported_at;
  IF OLD.sha256 IS NOT NULL THEN
    NEW.size := OLD.size;
    NEW.sha256 := OLD.sha256;
  END IF;
  IF OLD.returned_at IS NOT NULL AND NEW.returned_at IS NULL THEN
    NEW.moved_at := now();
  END IF;
  IF OLD.returned_at IS NULL AND NEW.returned_at IS NOT NULL THEN
    NEW.returned_at := now();
  END IF;
  IF OLD.destroyed_at IS NULL AND NEW.destroyed_at IS NOT NULL THEN
    NEW.destroyed_at := now();
  END IF;
  IF NEW.lost_at IS NULL THEN
    NEW.lost_told := NULL;
  ELSIF OLD.lost_at IS NULL THEN
    NEW.lost_at := now();
    NEW.lost_told := public.quarantine_lost_told(NEW.media_id);
  ELSIF OLD.lost_told::text = 'none' AND NEW.lost_told::text = 'pending' THEN
    -- Review M12: a notice owed to nobody when the file was lost (its image sealed for good) is weighed again when the
    -- seal ends: owed (pending) only for an image of a post its author still has, not erased and not sealed for good.
    NEW.lost_told := public.quarantine_lost_told(NEW.media_id);
  ELSIF OLD.lost_told::text <> 'pending' OR NEW.lost_told IS NULL THEN
    NEW.lost_told := OLD.lost_told;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

-- 11. post_media_lost_told, SECURITY DEFINER, AFTER UPDATE OF moderation_state ON post_media (review M12): when an image
-- stops being sealed (the seal for good that was in force over its post is lifted), its lost files' notices that were
-- owed to nobody while it was sealed are weighed again, so lost_untold() lists the image and the dispatch round mails its
-- author image_lost once. A file lost while the image was sealed for good was born with lost_told none, and nothing else
-- changes that.
CREATE FUNCTION "public"."post_media_lost_told"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.moderation_state::text = 'sealed' AND NEW.moderation_state::text <> 'sealed' THEN
    UPDATE public.quarantine_files q SET lost_told = 'pending'
     WHERE q.media_id = NEW.id AND q.lost_at IS NOT NULL AND q.lost_told::text = 'none';
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."post_media_lost_told"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "post_media_lost_told" AFTER UPDATE OF "moderation_state" ON "public"."post_media" FOR EACH ROW EXECUTE FUNCTION "public"."post_media_lost_told"();--> statement-breakpoint

-- 12. transparency_figures, replaced from its text in 0039_known_material (review L5): the uploads' table reads each
-- refusal's end as it stood on the due day from the newest upload_hold_ended audit row before that day, so a correction
-- computed later prints the same fates as the version of the due day. It keeps its JSON keys, compares the intake kinds as
-- text and reads clock_timestamp(), as 0036 and 0039 wrote it. Everything else is 0039's.
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
  -- no_report) or that it had not (open). A row is folded and banded as every table is. Review L5: the end as it stood on
  -- the due day is the newest upload_hold_ended audit row of the refusal before that day, since an end changed after it
  -- (report to no_report or back) moves ended_at past it; a refusal without such a row reads its columns, as before.
  v_figures := v_figures || jsonb_build_object('uploads', public.transparency_fold((
    SELECT jsonb_agg(jsonb_build_object('label', g.label, 'n', g.n) ORDER BY array_position(ARRAY['report', 'no_report', 'open'], g.label))
      FROM (SELECT coalesce((SELECT a.metadata -> 'params' ->> 'endAs' FROM public.audit_log a
                              WHERE a.action = 'upload_hold_ended' AND a.target_type = 'upload_refusal' AND a.target_id = u.id::text
                                AND a.created_at < v_due
                              ORDER BY a.chain_seq DESC LIMIT 1),
                            CASE WHEN u.ended_at IS NOT NULL AND u.ended_at < v_due THEN u.end_as ELSE 'open' END) AS label, count(*) AS n
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
END $$;

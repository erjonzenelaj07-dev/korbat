-- Appeals (3c design, section 6.3). Written by hand: this migration changes no table. It adds the trigger that decides
-- whether an appeal is open, two functions that answer who may review one, and replaces three functions of migration 0016
-- (CREATE OR REPLACE keeps each one's owner, grants and trigger): decisions_record, which now accepts a review;
-- decisions_apply, which now answers the appeal; and decision_actions_apply, which now refuses a seal taken while deciding
-- that would not be in force. As in 0016, every function is owned by the migrator, pins its search path, names every
-- object schema-qualified and has EXECUTE taken from PUBLIC; errors carry their code as the message under SQLSTATE P0001;
-- and a read that follows a lock is a statement of its own, which under READ COMMITTED sees every row committed while
-- the lock waited.
--
-- An appeal is checked and completed before it is stored. Whatever the insert supplied, the database sets when it was
-- filed and leaves it unanswered and unerased. It runs as its owner, since the API role cannot lock a case. In this order:
--   1. Before any check, the appealed decision's case, FOR KEY SHARE until the commit. That waits for whoever holds the
--      case FOR UPDATE: every decision (a correction that reverses the appealed decision among them) and the erasures of
--      a later migration. It does not wait for an intake's update of an open case, which changes no key, so a flood of
--      reports never holds an appeal back, nor an appeal a report.
--   2. The decision is final and restricts: what korbat does while it decides cannot be appealed, nor a decision that
--      restricts nothing, a review or a correction.
--   3. The appellant is the decision's subject: the author of the case's post, or the case's account.
--   4. The window: six calendar months after the author was told, compared with the clock read now, after the lock,
--      never with now(), which is the transaction's start. An appeal whose transaction began before its deadline but
--      whose lock waited for an erasure that found the decision final is refused, not left pending on erased evidence.
--   5. At least one of the decision's measures is in force: a decision that a correction reversed in full leaves its
--      author nothing to appeal, and an appeal filed while such a correction commits waits for it at step 1 and is
--      refused here.
-- Each refusal is appeal_not_open. The unique index appeals_once refuses a second appeal of one decision.
CREATE FUNCTION "public"."appeals_check"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d public.decisions;
  c public.cases;
  subject uuid;
BEGIN
  NEW.filed_at := now();
  NEW.answered_by := NULL;
  NEW.result := NULL;
  NEW.answered_at := NULL;
  NEW.erased_at := NULL;

  -- 1. A decision's case never changes, so the subquery's read before the lock names the right row.
  PERFORM 1 FROM public.cases k WHERE k.id = (SELECT x.case_id FROM public.decisions x WHERE x.id = NEW.decision_id) FOR KEY SHARE;

  -- 2.
  SELECT x.* INTO d FROM public.decisions x WHERE x.id = NEW.decision_id;
  IF NOT FOUND OR d.kind <> 'final' OR d.outcome <> 'restricted' THEN
    RAISE EXCEPTION 'appeal_not_open';
  END IF;

  -- 3.
  SELECT k.* INTO c FROM public.cases k WHERE k.id = d.case_id;
  IF c.target_type = 'post' THEN
    SELECT p.author_id INTO subject FROM public.posts p WHERE p.id = c.target_id;
  ELSE
    subject := c.target_id;
  END IF;
  IF subject IS NULL OR NEW.appellant_account_id IS DISTINCT FROM subject THEN
    RAISE EXCEPTION 'appeal_not_open';
  END IF;

  -- 4.
  IF NOT (clock_timestamp() < public.appeal_deadline(d.informed_at)) THEN
    RAISE EXCEPTION 'appeal_not_open';
  END IF;

  -- 5.
  IF NOT EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.decision_id = d.id) THEN
    RAISE EXCEPTION 'appeal_not_open';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."appeals_check"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "appeals_check" BEFORE INSERT ON "public"."appeals" FOR EACH ROW EXECUTE FUNCTION "public"."appeals_check"();--> statement-breakpoint
-- Whether the review of an appeal of this decision needs an admin. It reads two stored facts and nothing else: true when
-- the decision cites R2 or holds a seal; false otherwise, also for a decision that does not exist. It never reads the
-- freeze, so its answer does not change while an appeal waits, and it can be true only for a decision whose author was
-- told that it cites R2 or sealed their images, so the author's screen may show it as it is. A decision's own needs_admin
-- is not inherited by its review: the review of a restriction under R5 is any eligible moderator's. decisions_record
-- forces a review's needs_admin from it, and appeal_reviewer_state and the API's lists read it.
CREATE FUNCTION "public"."review_needs_admin"(decision uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT d.rule_id IS NOT DISTINCT FROM 'R2'
        OR EXISTS (SELECT 1 FROM public.decision_actions a WHERE a.decision_id = d.id AND a.kind = 'seal_media')
      FROM public.decisions d WHERE d.id = review_needs_admin.decision), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."review_needs_admin"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."review_needs_admin"(uuid) TO korbat_api;--> statement-breakpoint
-- Whether anyone at korbat may review a pending appeal now, as a word and never as accounts: null for an appeal that
-- does not exist or is answered; `available` when at least one live staff account decided no decision of the appeal's
-- case, opened no finding in it (the rule decisions_record refuses a review by, reviewer_conflict) and is not too close
-- to the case's subject or to anyone who reported in it; else `none_single_staff` when korbat has at most one live staff
-- account; else `none_eligible`. When the review needs an admin only admins count, in each of the three answers. It
-- runs as its owner, since the API role holds nothing in the auth schema, reads staff accounts without a lock, and only
-- reads.
CREATE FUNCTION "public"."appeal_reviewer_state"(appeal uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a public.appeals;
  appealed_case uuid;
  admins_only boolean;
  live_staff integer;
BEGIN
  SELECT x.* INTO a FROM public.appeals x WHERE x.id = appeal_reviewer_state.appeal;
  IF NOT FOUND OR a.answered_by IS NOT NULL THEN
    RETURN NULL;
  END IF;
  SELECT d.case_id INTO appealed_case FROM public.decisions d WHERE d.id = a.decision_id;
  admins_only := public.review_needs_admin(a.decision_id);
  IF EXISTS (
       SELECT 1 FROM auth.users u
        WHERE u.role <> 'user' AND u.deleted_at IS NULL AND (NOT admins_only OR u.role = 'admin')
          AND NOT EXISTS (SELECT 1 FROM public.decisions x WHERE x.case_id = appealed_case AND x.decided_by = u.id)
          AND NOT EXISTS (SELECT 1 FROM public.intake_items i JOIN public.intakes n ON n.id = i.intake_id
                           WHERE i.case_id = appealed_case AND n.finding_by = u.id)
          AND NOT public.staff_case_conflict(u.id, appealed_case, true)) THEN
    RETURN 'available';
  END IF;
  SELECT count(*) INTO live_staff FROM auth.users u
   WHERE u.role <> 'user' AND u.deleted_at IS NULL AND (NOT admins_only OR u.role = 'admin');
  RETURN CASE WHEN live_staff <= 1 THEN 'none_single_staff' ELSE 'none_eligible' END;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."appeal_reviewer_state"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."appeal_reviewer_state"(uuid) TO korbat_api;--> statement-breakpoint
-- decisions_record, replaced: a review is a decision too. Everything migration 0016 says of this function stands, and
-- is stated again here in full, since a replaced function keeps nothing of its old body. What a review adds, by step:
--   2. A review names a final decision of this case that restricts (reviews_decision_id), keeps it or reverses it in part
--      or in full, and carries that decision's category and rules version and a reason. Its appeal is forced: the one
--      pending appeal of the reviewed decision, read after step 1's lock, so that a review answers exactly that appeal
--      whatever the insert supplied; with none pending it is case_changed (the appeal was answered meanwhile, by another
--      review or by a correction that reversed everything). No other decision names an appeal.
--   4. Its reason is a saved text of the kind review_reason, as a correction's is.
--   5. Its parties are the case's subject and the signed-in reporters of the items the reviewed decision answered.
--      Then the reviewer's own conflict (reviewer_conflict): nobody reviews a case in which they decided anything, a
--      measure taken while deciding included, or opened a finding. A different person reviews, and the database holds it.
--   6. suspect is the reviewed decision's, as for a correction. needs_admin is review_needs_admin of the reviewed
--      decision: true when that decision cites R2 or sealed images, and not inherited otherwise, so a restriction under
--      R5 is reviewed by any eligible moderator.
--   9. The source is the reviewed decision's.
--  10. The author is told of every review, a kept one included: it answers their own appeal.
CREATE OR REPLACE FUNCTION "public"."decisions_record"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c public.cases;
  -- The decision a correction or a review is about.
  reviewed public.decisions;
  pending_appeal uuid;
  snapshot public.evidence_snapshots;
  subject uuid;
  reporters uuid[];
  considers_suspect boolean;
  considers_illegal boolean;
  considers_r5 boolean;
  from_notice boolean;
  from_user boolean;
  decider_role text;
  frozen boolean;
  per_hour integer;
  per_day integer;
  in_hour integer;
  in_day integer;
  reason_kind public.staff_text_kind;
  ends_interim boolean := false;
  target_deleted boolean;
BEGIN
  NEW.decided_at := now();
  NEW.xact := pg_current_xact_id();
  NEW.puid := replace(gen_random_uuid()::text, '-', '');
  NEW.informed_at := NEW.decided_at;
  NEW.answers_from_seq := NULL;
  NEW.automated_detection := false;
  NEW.automated_decision := 'not_automated';
  NEW.territorial_scope := 'worldwide';
  NEW.author_mail_at := NULL;
  -- Only the erasure of a later migration marks a decision redacted.
  NEW.redacted_at := NULL;
  -- Only a review names an appeal, and step 2 forces which.
  NEW.appeal_id := NULL;

  -- 1.
  SELECT k.* INTO c FROM public.cases k WHERE k.id = NEW.case_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a decision names a case that does not exist' USING ERRCODE = '23503';
  END IF;
  IF c.state_version IS DISTINCT FROM NEW.seen_state_version THEN
    RAISE EXCEPTION 'case_changed';
  END IF;

  -- 2.
  IF NEW.kind = 'interim' THEN
    IF NEW.outcome <> 'restricted' OR c.closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'An interim decision restricts, on an open case.';
    END IF;
  ELSIF NEW.kind = 'final' THEN
    IF NEW.outcome NOT IN ('restricted', 'no_violation', 'not_evident') OR c.closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A final decision restricts or finds no breach, on an open case.';
    END IF;
    IF NOT (c.answered_seq < NEW.through_seq AND NEW.through_seq <= c.intake_seq) THEN
      RAISE EXCEPTION 'case_changed';
    END IF;
    NEW.answers_from_seq := c.answered_seq + 1;
  ELSIF NEW.kind = 'correction' THEN
    SELECT d.* INTO reviewed FROM public.decisions d
     WHERE d.id = NEW.reviews_decision_id AND d.case_id = NEW.case_id AND d.kind IN ('interim', 'final') AND d.outcome = 'restricted';
    IF NOT FOUND OR NEW.outcome NOT IN ('partly_reversed', 'reversed') OR NEW.category <> reviewed.category
       OR NEW.rules_version <> reviewed.rules_version OR NEW.reason_digest IS NULL THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A correction reverses a restricting decision of its case, with that decision''s category and rules version and a reason.';
    END IF;
  ELSIF NEW.kind = 'review' THEN
    SELECT d.* INTO reviewed FROM public.decisions d
     WHERE d.id = NEW.reviews_decision_id AND d.case_id = NEW.case_id AND d.kind = 'final' AND d.outcome = 'restricted';
    IF NOT FOUND OR NEW.outcome NOT IN ('kept', 'partly_reversed', 'reversed') OR NEW.category <> reviewed.category
       OR NEW.rules_version <> reviewed.rules_version OR NEW.reason_digest IS NULL THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A review keeps or reverses a final restriction of its case, with that decision''s category and rules version and a reason.';
    END IF;
    -- A statement of its own after the case's lock: it sees an appeal, and an answer to one, that committed while the lock waited.
    SELECT a.id INTO pending_appeal FROM public.appeals a WHERE a.decision_id = reviewed.id AND a.answered_by IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'case_changed';
    END IF;
    NEW.appeal_id := pending_appeal;
  ELSE
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A decision is interim, final, a correction or a review.';
  END IF;

  -- 3.
  SELECT s.* INTO snapshot FROM public.evidence_snapshots s WHERE s.id = NEW.snapshot_id;
  IF NOT FOUND OR snapshot.case_id <> NEW.case_id THEN
    RAISE EXCEPTION 'snapshot_mismatch';
  END IF;
  IF snapshot.erased_at IS NOT NULL THEN
    RAISE EXCEPTION 'snapshot_erased';
  END IF;
  IF snapshot.digest IS DISTINCT FROM NEW.snapshot_digest THEN
    RAISE EXCEPTION 'snapshot_mismatch';
  END IF;

  -- 4. A read: decisions_apply confirms the texts, and refuses when one is gone by then.
  reason_kind := CASE WHEN NEW.kind IN ('review', 'correction') THEN 'review_reason' ELSE 'reason' END;
  IF (NEW.facts_digest IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.staff_texts t WHERE t.digest = NEW.facts_digest AND t.case_id = NEW.case_id AND t.author_id = NEW.decided_by
           AND t.kind = 'facts' AND t.confirmed_at IS NULL AND t.erased_at IS NULL))
     OR (NEW.reason_digest IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.staff_texts t WHERE t.digest = NEW.reason_digest AND t.case_id = NEW.case_id AND t.author_id = NEW.decided_by
           AND t.kind = reason_kind AND t.confirmed_at IS NULL AND t.erased_at IS NULL))
     OR (NEW.legal_reference_digest IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.staff_texts t WHERE t.digest = NEW.legal_reference_digest AND t.case_id = NEW.case_id AND t.author_id = NEW.decided_by
           AND t.kind = 'legal_reference' AND t.confirmed_at IS NULL AND t.erased_at IS NULL)) THEN
    RAISE EXCEPTION 'text_not_found';
  END IF;

  -- 5. What the decision considers: a final decision the items it answers, an interim one every unanswered item, a
  -- correction or a review the items its reviewed decision answered (for a corrected interim decision, every unanswered
  -- item). One statement after the case's lock reads every fact the steps below need of them.
  IF c.target_type = 'post' THEN
    SELECT p.author_id INTO subject FROM public.posts p WHERE p.id = c.target_id;
  ELSE
    subject := c.target_id;
  END IF;
  SELECT coalesce(array_agg(DISTINCT i.reporter_account_id) FILTER (WHERE i.reporter_account_id IS NOT NULL), '{}'::uuid[]),
         coalesce(bool_or(i.suspect), false),
         coalesce(bool_or(i.alleges_illegal), false),
         coalesce(bool_or(n.rule_id = 'R5'), false),
         coalesce(bool_or(n.kind = 'user' AND i.alleges_illegal), false),
         coalesce(bool_or(n.kind = 'user'), false)
    INTO reporters, considers_suspect, considers_illegal, considers_r5, from_notice, from_user
    FROM public.intake_items i JOIN public.intakes n ON n.id = i.intake_id
   WHERE i.case_id = NEW.case_id
     AND CASE WHEN NEW.kind = 'final' THEN i.seq BETWEEN NEW.answers_from_seq AND NEW.through_seq
              WHEN NEW.kind IN ('correction', 'review') AND reviewed.kind = 'final' THEN i.answered_by = reviewed.id
              ELSE i.answered_by IS NULL END;
  IF public.staff_party_conflict(NEW.decided_by, array_remove(ARRAY[subject], NULL) || reporters, CASE WHEN c.target_type = 'post' THEN c.target_id END) THEN
    RAISE EXCEPTION 'staff_recused';
  END IF;
  -- The decision being inserted is not stored yet, so every decision of the case this reads is an earlier one.
  IF NEW.kind = 'review' AND (
       EXISTS (SELECT 1 FROM public.decisions x WHERE x.case_id = NEW.case_id AND x.decided_by = NEW.decided_by)
       OR EXISTS (SELECT 1 FROM public.intake_items i JOIN public.intakes n ON n.id = i.intake_id
                   WHERE i.case_id = NEW.case_id AND n.finding_by = NEW.decided_by)) THEN
    RAISE EXCEPTION 'reviewer_conflict';
  END IF;

  -- 6.
  SELECT u.role::text INTO decider_role FROM auth.users u WHERE u.id = NEW.decided_by FOR SHARE;
  PERFORM public.account_is_staff(subject);
  NEW.suspect := CASE WHEN NEW.kind IN ('correction', 'review') THEN reviewed.suspect ELSE considers_suspect END;
  NEW.unseen := false;
  IF NEW.kind = 'final' AND c.target_type = 'post' THEN
    -- Read now, before decisions_apply answers anything: frozen through a suspect item of this case, through the author's
    -- account's case, or through a seal in force.
    SELECT public.post_frozen(c.target_id) INTO frozen;
    NEW.unseen := coalesce(frozen, false);
  END IF;
  IF NEW.kind = 'final' AND NEW.suspect AND EXISTS (
       SELECT 1 FROM public.intake_items i WHERE i.case_id = NEW.case_id AND i.suspect AND i.answered_by IS NULL AND i.seq > NEW.through_seq) THEN
    RAISE EXCEPTION 'case_changed';
  END IF;
  IF NEW.rule_id IS NOT DISTINCT FROM 'R2' AND NOT NEW.suspect THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A decision under R2 rests on a suspect item: a finding citing R2 is opened first.';
  END IF;
  NEW.needs_admin := CASE NEW.kind
                       WHEN 'final' THEN NEW.suspect OR considers_r5 OR coalesce(NEW.rule_id IN ('R2', 'R5'), false)
                       WHEN 'correction' THEN reviewed.needs_admin
                       WHEN 'review' THEN public.review_needs_admin(NEW.reviews_decision_id)
                       ELSE false END;
  IF NEW.needs_admin AND decider_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  -- 7. A one-bigint key: the social module's pair locks use the two-key space, so the two never meet.
  PERFORM pg_advisory_xact_lock(hashtextextended('korbat.decision_cap:' || NEW.decided_by::text, 0));
  SELECT l.decisions_per_hour, l.decisions_per_day INTO per_hour, per_day FROM public.moderation_limits l WHERE l.id = 1;
  SELECT count(*) FILTER (WHERE d.decided_at > now() - interval '1 hour'), count(*) INTO in_hour, in_day
    FROM public.decisions d WHERE d.decided_by = NEW.decided_by AND d.decided_at > now() - interval '1 day';
  IF in_hour >= coalesce(per_hour, 60) OR in_day >= coalesce(per_day, 300) THEN
    RAISE EXCEPTION 'decision_cap';
  END IF;

  -- 8.
  IF (NEW.ground IS NOT DISTINCT FROM 'illegal' OR NEW.outcome = 'not_evident') AND NOT considers_illegal THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'The ground of the law, and "illegality not evident", need a considered item that alleges illegality.';
  END IF;

  -- 9.
  NEW.source := CASE WHEN NEW.kind IN ('correction', 'review') THEN reviewed.source
                     WHEN from_notice THEN 'notice'::public.decision_source
                     WHEN from_user THEN 'report'::public.decision_source
                     ELSE 'own_initiative'::public.decision_source END;

  -- 10. Both reads come after the case's lock and after the subject's profile lock, which the deciding transaction takes
  -- first and the author's deletion and the purge take too, so the target cannot be deleted before the commit.
  IF NEW.kind = 'final' AND NEW.through_seq = c.intake_seq THEN
    SELECT EXISTS (SELECT 1 FROM public.measures_in_force m JOIN public.decisions d ON d.id = m.decision_id
                    WHERE m.case_id = NEW.case_id AND m.decision_kind = 'interim' AND m.kind <> 'seal_media' AND d.author_mail <> 'none')
      INTO ends_interim;
  END IF;
  NEW.ended_interim := ends_interim;
  IF c.target_type = 'post' THEN
    SELECT p.state = 'deleted_by_author' INTO target_deleted FROM public.posts p WHERE p.id = c.target_id;
  ELSE
    SELECT p.deleted_at IS NOT NULL INTO target_deleted FROM public.profiles p WHERE p.id = c.target_id;
  END IF;
  NEW.author_mail := CASE
                       WHEN NEW.ended_interim THEN 'pending'
                       WHEN NEW.kind = 'interim' AND NOT coalesce(target_deleted, false) THEN 'pending'
                       WHEN NEW.kind = 'final' AND NEW.outcome = 'restricted' THEN 'pending'
                       WHEN NEW.kind = 'correction' AND reviewed.author_mail <> 'none' THEN 'pending'
                       WHEN NEW.kind = 'review' THEN 'pending'
                       ELSE 'none' END::public.delivery_state;
  RETURN NEW;
END $$;--> statement-breakpoint
-- decisions_apply, replaced: what a stored decision does to its case, before any of its measures exists, as migration
-- 0016 states it and as it stands again below, and now also what it does to an appeal:
--   - a review answers its one appeal, the one decisions_record forced: who answered, the review's outcome as the
--     result, and when. An appeal that is answered by then is case_changed; decisions_record read it pending under the
--     case's lock, so this is a guard and not a path;
--   - a correction that reverses everything answers the corrected decision's pending appeal as reversed, when there is
--     one: nothing of the decision is left to review. The deferred check refuses at commit a correction that says
--     "reversed" and leaves a measure in force, so the answer never stands on a false outcome;
--   - a correction that reverses part answers none: the appeal waits for a review, whose reversals reach only what is
--     still in force, and whose "kept" means that what remains stands.
CREATE OR REPLACE FUNCTION "public"."decisions_apply"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c public.cases;
  seals_before uuid[];
  ended uuid[];
  listed uuid[];
  open_items integer;
  open_lane smallint;
  oldest timestamptz;
  digests text[];
  confirmed integer;
BEGIN
  IF NEW.kind = 'final' THEN
    SELECT coalesce(array_agg(m.id), '{}'::uuid[]) INTO seals_before
      FROM public.measures_in_force m WHERE m.case_id = NEW.case_id AND m.kind = 'seal_media' AND m.decision_kind = 'interim';
    UPDATE public.intake_items i
       SET answered_by = NEW.id,
           outcome = CASE NEW.outcome
                       WHEN 'restricted' THEN CASE WHEN NEW.ground = 'illegal' THEN 'restricted_legal' ELSE 'restricted_rule' END
                       WHEN 'not_evident' THEN CASE WHEN i.alleges_illegal THEN 'not_evident' ELSE 'no_violation' END
                       ELSE 'no_violation' END::public.item_outcome
     WHERE i.case_id = NEW.case_id AND i.seq BETWEEN NEW.answers_from_seq AND NEW.through_seq AND i.answered_by IS NULL;
    SELECT count(*), min(i.lane), min(i.created_at) INTO open_items, open_lane, oldest
      FROM public.intake_items i WHERE i.case_id = NEW.case_id AND i.answered_by IS NULL;
    UPDATE public.cases k
       SET state_version = k.state_version + 1,
           last_decided_at = now(),
           answered_seq = NEW.through_seq,
           lane = coalesce(open_lane, 2),
           oldest_open_at = oldest,
           closed_at = CASE WHEN open_items = 0 THEN now() END
     WHERE k.id = NEW.case_id
    RETURNING k.* INTO c;
    IF c.closed_at IS NOT NULL AND c.target_type = 'post' THEN
      PERFORM public.moderation_apply(ARRAY[c.target_id], true);
    END IF;
    SELECT coalesce(array_agg(s.id), '{}'::uuid[]) INTO ended
      FROM unnest(seals_before) AS s(id) WHERE NOT EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.id = s.id);
    IF cardinality(ended) > 0 THEN
      SELECT array_agg(DISTINCT s.post_id) INTO listed FROM public.seal_posts s WHERE s.action_id = ANY(ended);
      PERFORM public.moderation_apply(listed, false);
      IF EXISTS (SELECT 1 FROM public.decision_actions a JOIN public.decisions d ON d.id = a.decision_id WHERE a.id = ANY(ended) AND d.author_mail <> 'none') THEN
        UPDATE public.decisions d
           SET ended_interim = true, author_mail = CASE WHEN d.author_mail = 'none' THEN 'pending'::public.delivery_state ELSE d.author_mail END
         WHERE d.id = NEW.id;
      END IF;
    END IF;
  ELSE
    UPDATE public.cases k SET state_version = k.state_version + 1, last_decided_at = now() WHERE k.id = NEW.case_id;
  END IF;

  IF NEW.kind = 'review' THEN
    UPDATE public.appeals a
       SET answered_by = NEW.id, result = NEW.outcome::text::public.appeal_result, answered_at = now()
     WHERE a.id = NEW.appeal_id AND a.answered_by IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'case_changed';
    END IF;
  ELSIF NEW.kind = 'correction' AND NEW.outcome = 'reversed' THEN
    UPDATE public.appeals a
       SET answered_by = NEW.id, result = 'reversed', answered_at = now()
     WHERE a.decision_id = NEW.reviews_decision_id AND a.answered_by IS NULL;
  END IF;

  digests := array_remove(ARRAY[NEW.facts_digest, NEW.reason_digest, NEW.legal_reference_digest], NULL);
  IF cardinality(digests) > 0 THEN
    UPDATE public.staff_texts t SET decision_id = NEW.id, confirmed_at = now()
     WHERE t.digest = ANY(digests) AND t.confirmed_at IS NULL AND t.erased_at IS NULL;
    GET DIAGNOSTICS confirmed = ROW_COUNT;
    IF confirmed <> cardinality(digests) THEN
      RAISE EXCEPTION 'text_not_found';
    END IF;
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
-- decision_actions_apply, replaced: what a row of the ledger does once it is stored, as migration 0016 states it and as
-- it stands again below, with one step more for a seal taken while deciding. Such a seal stands for the suspect items
-- that had arrived by its decision's time (measures_in_force compares each item's created_at with the decision's
-- decided_at, and both are the starts of their transactions). So a seal whose only unanswered suspect item belongs to a
-- transaction that began after the decision's, and that committed before the decision locked its case, would be
-- recorded, told to its author, and not be in force: the images would stay served while the statement says that they
-- are sealed. The database now refuses it itself. Once the seal's list is written, a seal of an interim decision that
-- the view does not hold raises case_changed, with nothing stored: the console reads the case again, and the person
-- confirms again in a transaction that begins after the report. A seal that rests on an earlier unanswered suspect item
-- as well is in force and passes, whatever arrived later. A seal for good never ends with its case, and is not asked.
CREATE OR REPLACE FUNCTION "public"."decision_actions_apply"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d public.decisions;
  c public.cases;
  locked uuid[];
  listed uuid[];
  target_deleted boolean;
  covered boolean;
  snapshot public.evidence_snapshots;
BEGIN
  SELECT x.* INTO d FROM public.decisions x WHERE x.id = NEW.decision_id;
  SELECT k.* INTO c FROM public.cases k WHERE k.id = d.case_id;

  IF NEW.post_id IS NOT NULL THEN
    PERFORM public.moderation_apply(ARRAY[NEW.post_id], true);
  END IF;

  IF NEW.kind = 'seal_media' THEN
    IF c.target_type = 'post' THEN
      SELECT array_agg(l.post_id) INTO locked
        FROM (SELECT m.post_id FROM public.post_media m WHERE m.post_id = c.target_id ORDER BY m.id FOR NO KEY UPDATE) l;
    ELSE
      SELECT array_agg(l.post_id) INTO locked
        FROM (SELECT m.post_id FROM public.post_media m WHERE m.owner_id = c.target_id AND m.post_id IS NOT NULL ORDER BY m.id FOR NO KEY UPDATE) l;
    END IF;
    IF locked IS NULL THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'The case reaches no image: there is nothing to seal.';
    END IF;
    INSERT INTO public.seal_posts (action_id, post_id, images)
    SELECT NEW.id, l.post_id, count(*) FROM unnest(locked) AS l(post_id) GROUP BY l.post_id;
    -- The view itself is asked, never a copy of its clause: it is the one definition of which measures stand.
    IF d.kind = 'interim' AND NOT EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.id = NEW.id) THEN
      RAISE EXCEPTION 'case_changed';
    END IF;
    SELECT array_agg(s.post_id) INTO listed FROM public.seal_posts s WHERE s.action_id = NEW.id;
    IF c.target_type = 'post' THEN
      SELECT p.state = 'deleted_by_author' INTO target_deleted FROM public.posts p WHERE p.id = c.target_id;
    ELSE
      SELECT p.deleted_at IS NOT NULL INTO target_deleted FROM public.profiles p WHERE p.id = c.target_id;
    END IF;
    SELECT NOT EXISTS (
             SELECT 1 FROM public.seal_posts mine
              WHERE mine.action_id = NEW.id
                AND NOT EXISTS (SELECT 1 FROM public.seal_posts s JOIN public.measures_in_force f ON f.id = s.action_id
                                 WHERE s.post_id = mine.post_id AND s.action_id <> NEW.id AND (d.kind = 'interim' OR f.decision_kind <> 'interim')))
      INTO covered;
    UPDATE public.decision_actions a
       SET no_effect = CASE WHEN coalesce(target_deleted, false) THEN 'deleted' WHEN covered THEN 'already' END
     WHERE a.id = NEW.id;
    PERFORM public.moderation_apply(listed, false);
  ELSIF NEW.kind = 'unseal_media' THEN
    SELECT array_agg(s.post_id) INTO listed FROM public.seal_posts s WHERE s.action_id = NEW.reverses_action_id;
    PERFORM public.moderation_apply(listed, false);
  ELSIF NEW.kind IN ('reset_display_name', 'reset_bio') AND NEW.no_effect IS NULL THEN
    SELECT s.* INTO snapshot FROM public.evidence_snapshots s WHERE s.id = d.snapshot_id;
    IF NEW.kind = 'reset_display_name' THEN
      UPDATE public.profiles p SET display_name = p.handle WHERE p.id = NEW.subject_account_id AND p.display_name = snapshot.display_name;
    ELSE
      UPDATE public.profiles p SET bio = '' WHERE p.id = NEW.subject_account_id AND p.bio = snapshot.bio;
    END IF;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'profile_changed';
    END IF;
  END IF;

  IF NEW.reverses_action_id IS NOT NULL AND d.kind IN ('review', 'correction') THEN
    UPDATE public.intake_items i SET revision_pending_at = now()
     WHERE i.answered_by = d.reviews_decision_id AND EXISTS (SELECT 1 FROM public.decisions r WHERE r.id = d.reviews_decision_id AND r.kind = 'final');
  END IF;
  RETURN NULL;
END $$;

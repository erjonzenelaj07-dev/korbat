-- The ledger of authorities' orders (3f design, section 6.3; Task 3, "Giving effect"). Written by hand: this migration
-- changes no table. It replaces one view and eleven functions, each stated whole from its newest built text (CREATE OR
-- REPLACE keeps each one's owner, grants and trigger), and adds three: post_preserved, order_notice_held and
-- order_notices_release. The design numbers it 0026; 3e's dry run ended at 0025 and Tasks 1 and 2 took 0026 and 0027,
-- so it is the next free number.
--
-- As in 0016 to 0027: every function is owned by the migrator, pins its search path to public and pg_temp (and names
-- auth's objects in full), names every object schema-qualified and has EXECUTE taken from PUBLIC; times the database
-- writes are now(), the transaction's start, unless clock_timestamp() is named; errors carry their code as the message
-- under SQLSTATE P0001; a read that must see what committed while a lock waited is a statement of its own after that
-- lock. The eight values 0027 added are named as enum literals only inside PL/pgSQL bodies; views and SQL functions
-- compare them as text (enum-literals.test.ts). No new code holds an interval literal or a number of order_rules().
--
-- What every decision of this file serves, said once: nothing reaches an author while an order's notice is held, on any
-- path. A held decision is one with informed_at null and author_mail none, which the CHECK decisions_informed allows and
-- which only a decision owed a telling ever is; order_notices_release() is the one writer that tells it afterwards.
--
-- 1. measures_in_force, replaced (0021): its list of measures gains disable_by_order, compared as text. An order's
-- decision is never interim, so its measure is in force until a row reverses it, whatever its case does.
CREATE OR REPLACE VIEW "public"."measures_in_force" WITH (security_invoker = true) AS
SELECT a.id, a.kind, a.post_id, a.media_id, a.subject_account_id, d.id AS decision_id, d.kind AS decision_kind, d.case_id
  FROM public.decision_actions a
  JOIN public.decisions d ON d.id = a.decision_id
 WHERE a.kind::text IN ('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio', 'strike', 'suspend', 'terminate', 'retire_handle', 'warn_reporting', 'restrict_reporting', 'disable_by_order')
   AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = a.id)
   AND (d.kind <> 'interim'
     OR CASE WHEN a.kind = 'seal_media'
          THEN EXISTS (SELECT 1 FROM public.intake_items i
                        WHERE i.case_id = d.case_id AND i.suspect AND i.answered_by IS NULL AND i.created_at <= d.decided_at)
          ELSE EXISTS (SELECT 1 FROM public.cases c WHERE c.id = d.case_id AND c.closed_at IS NULL)
        END);--> statement-breakpoint
-- 2. Whether an order's notice about this post is held now: an order's decision about it that its author has not been
-- told of, whose measure is in force. The one place the test of decisions_record's step 10 is written, which the two
-- later writers of a decision's mail (decisions_apply's ended seals, decision_actions_check's step 11) ask too. Its
-- callers are the ledger's definer functions; the API reads the same through its own query.
CREATE FUNCTION "public"."order_notice_held"(post uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.measures_in_force m
    JOIN public.decisions d ON d.id = m.decision_id
    WHERE m.post_id = order_notice_held.post AND m.kind::text = 'disable_by_order' AND d.kind::text = 'order' AND d.informed_at IS NULL)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."order_notice_held"(uuid) FROM PUBLIC;--> statement-breakpoint
-- 3. Whether a post is preserved for an order (TCO Art. 6): an item of it whose preservation runs. The one place the test
-- is written; frozen_for's fourth arm and the staff case page's snapshot read call it, and nothing on the author's side.
CREATE FUNCTION "public"."post_preserved"(post uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.legal_order_items oi
                  WHERE oi.post_id = post_preserved.post AND oi.preserve_until > now() AND oi.preserve_ended_at IS NULL)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."post_preserved"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."post_preserved"(uuid) TO korbat_api;--> statement-breakpoint
-- 4. frozen_for, replaced (0015): a fourth arm, a preserved post. The name stays, and from here on "frozen" means frozen
-- or preserved: gate K keeps a preserved post's image rows against every delete, gate E its snapshots against every
-- erasure and the R4 redaction, gate V opens none of its images for staff, and a final decision on a case about it is
-- unseen. snapshot_withheld is not touched.
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
      WHERE s.post_id = frozen_for.post)
    OR public.post_preserved(frozen_for.post)
$$;--> statement-breakpoint
-- 5. moderation_apply, replaced (0023). Everything 0016 and 0023 say of it stands. A post's level is now the first of
-- these that applies: disabled (the post is not erased, and a disable_by_order in force that withholds from the author
-- lists it); removed (erased, or a remove in force, or a disable_by_order in force that does not withhold or lists an
-- erased post); withheld; visible. So the result does not depend on the order in which a removal, a disabling and their
-- reversals arrive, and a reinstated post that korbat also removed under a rule stays removed. The state follows the
-- level through text and never moves to or from deleted_by_author; image states do not change, since no reader shows an
-- image of a disabled post; Explore's three columns follow as 0023 has them.
CREATE OR REPLACE FUNCTION "public"."moderation_apply"(posts uuid[], levels boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ids uuid[];
  derived public.moderation_level[];
BEGIN
  IF moderation_apply.levels THEN
    PERFORM 1 FROM public.posts p WHERE p.id = ANY(moderation_apply.posts) ORDER BY p.id FOR UPDATE;
    SELECT array_agg(p.id),
           array_agg(CASE
             WHEN p.erased_at IS NULL AND EXISTS (SELECT 1 FROM public.measures_in_force m JOIN public.decision_actions x ON x.id = m.id
                                                   WHERE m.post_id = p.id AND m.kind = 'disable_by_order' AND x.withhold_author) THEN 'disabled'
             WHEN p.erased_at IS NOT NULL OR EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.post_id = p.id AND m.kind IN ('remove', 'disable_by_order')) THEN 'removed'
             WHEN EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.post_id = p.id AND m.kind = 'withhold') THEN 'withheld'
             ELSE 'visible' END::public.moderation_level)
      INTO ids, derived
      FROM public.posts p WHERE p.id = ANY(moderation_apply.posts);
    -- The level and Explore's three columns in one statement; each expression reads the row before it.
    UPDATE public.posts p SET moderation_level = v.level,
           hidden_at = CASE WHEN p.moderation_level = 'visible' THEN now() ELSE p.hidden_at END,
           restored_at = CASE WHEN v.level = 'visible' THEN now() ELSE p.restored_at END,
           explore_from = CASE WHEN v.level = 'visible' THEN coalesce(p.explore_from, p.created_at) + (now() - p.hidden_at) ELSE p.explore_from END
      FROM unnest(ids, derived) AS v(id, level)
     WHERE p.id = v.id AND p.moderation_level <> v.level;
    UPDATE public.posts p SET state = v.level::text::public.post_state
      FROM unnest(ids, derived) AS v(id, level)
     WHERE p.id = v.id AND p.state <> 'deleted_by_author' AND p.state <> v.level::text::public.post_state;
  END IF;
  PERFORM 1 FROM public.post_media m WHERE m.post_id = ANY(moderation_apply.posts) ORDER BY m.id FOR NO KEY UPDATE;
  UPDATE public.post_media i SET moderation_state = v.state
    FROM (SELECT m.id,
                 CASE
                   WHEN EXISTS (SELECT 1 FROM public.seal_posts s JOIN public.measures_in_force f ON f.id = s.action_id WHERE s.post_id = m.post_id) THEN 'sealed'
                   WHEN m.erased_at IS NOT NULL
                     OR EXISTS (SELECT 1 FROM public.measures_in_force f WHERE f.post_id = m.post_id AND f.kind = 'remove_media' AND f.media_id = m.id) THEN 'removed'
                   WHEN EXISTS (SELECT 1 FROM public.measures_in_force f WHERE f.post_id = m.post_id AND f.kind = 'withhold_media' AND f.media_id = m.id) THEN 'withheld'
                   ELSE 'visible' END::public.media_moderation_state AS state
            FROM public.post_media m WHERE m.post_id = ANY(moderation_apply.posts)) v
   WHERE i.id = v.id AND i.moderation_state <> v.state;
END $$;--> statement-breakpoint
-- 6. posts_guard, replaced (0023). Everything 0016 and 0023 say of it stands. One clause is added: for every role but
-- the migrator, a post whose level is disabled moves to deleted_by_author only once its author's profile is deleted
-- (the purge, which writes its profile row before its tombstones); otherwise moderation_column. So the author's own
-- deletion of a disabled post is refused here as the route refuses it. A tombstone stays terminal: a later
-- reinstatement changes the level and leaves the state deleted_by_author.
CREATE OR REPLACE FUNCTION "public"."posts_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_user <> 'korbat_migrate' AND (NEW.state <> 'visible' OR NEW.moderation_level <> 'visible' OR NEW.erased_at IS NOT NULL) THEN
      RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
    END IF;
    IF current_user <> 'korbat_migrate' THEN
      NEW.hidden_at := NULL;
      NEW.restored_at := NULL;
      NEW.explore_from := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state = 'deleted_by_author' AND NEW.state <> 'deleted_by_author' THEN
    RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
  END IF;
  IF current_user <> 'korbat_migrate' AND ((NEW.state IS DISTINCT FROM OLD.state AND NEW.state <> 'deleted_by_author')
      OR NEW.moderation_level IS DISTINCT FROM OLD.moderation_level OR NEW.erased_at IS DISTINCT FROM OLD.erased_at) THEN
    RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
  END IF;
  IF current_user <> 'korbat_migrate' AND OLD.moderation_level = 'disabled' AND OLD.state <> 'deleted_by_author' AND NEW.state = 'deleted_by_author'
     AND NOT EXISTS (SELECT 1 FROM public.profiles a WHERE a.id = OLD.author_id AND a.deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
-- 7. decisions_record, replaced (0021). Everything 0016, 0017 and 0021 say of it stands, stated again in full since a
-- replaced function keeps nothing of its old body. What 3f changes, by step:
--   2. A branch for the kind order, which alone names an order's item (invalid_decision otherwise): the item, then its
--      order's row FOR SHARE (section 5, the lock order, item 2), read again in a statement of its own; order_closed for
--      a closed order; invalid_decision unless the order is no dsa_art10, the case is an open post case whose target is
--      the item's post, the outcome restricted, the ground illegal and the three text digests null; unless the item's
--      intake item is an unanswered item of this case, about this post, of an intake of the kind order (the API role
--      writes that column, so it is not trusted); and with the detail "already given effect" when the item's measure
--      stands. A correction may correct an order decision, always with the outcome reversed (it holds one measure), and
--      takes that decision's row FOR SHARE first and reads it in a statement of its own: it waits for a release that is
--      telling that decision, or the release waits for it.
--   5. An order decision considers its own item alone; a final or an interim decision never considers an item of an
--      order's intake; a correction of an order decision the item that decision answered. Recusal is not asked of an
--      order decision or of the correction of one (row 13).
--   6. needs_admin is false for an order decision and true for the correction of one; for an order decision on a
--      dsa_art9 order that is not verified it is true, and a decider who is not an admin is refused order_not_verified
--      in place of admin_required (decision_holds then ties an admin's effect to the signed urgent). suspect and unseen
--      are false for an order decision.
--   7. The decision caps count no order decision and refuse none; an order decision is refused order_cap at
--      decisions_per_day of order_rules() order decisions of its account in 24 hours, under the same advisory lock.
--   9. The source of an order decision is order.
--  10. A final decision ends its interim measures when it leaves no unanswered item above its range (an answered order
--      item may lie there). An order decision has through_seq 0, the category and keyword its order's kind fixes, and is
--      told at once (informed_at = decided_at, the mail pending) unless its order holds the notice
--      (order_hold_until(order) > now()): then informed_at is null and the mail none. The correction of an untold order
--      decision is untold too. And any other decision the built text would tell its author (the mail pending), on a post
--      case whose target has an untold order decision whose measure is in force (order_notice_held, a statement of its
--      own after the case's lock), is untold too: korbat's own statement about such a post cannot be both true and
--      silent. A decision the built text tells nobody of keeps informed_at = decided_at and the mail none, so an untold
--      decision is always one owed a telling, which order_notices_release() gives.
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
  -- 3f: an order decision's item and order, and whether a notice about the case's post is held.
  oi public.legal_order_items;
  o public.legal_orders;
  held boolean := false;
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
  IF (NEW.kind = 'order') <> (NEW.order_item_id IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'Only an order decision names an order''s item, and it always does.';
  END IF;
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
    -- 3f: a correction of an order decision waits for a release that is telling it, and a release waits for it.
    PERFORM 1 FROM public.decisions d WHERE d.id = NEW.reviews_decision_id AND d.case_id = NEW.case_id AND d.kind = 'order' FOR SHARE;
    -- A kept correction may be about a final decision that found no breach (the withdrawal of its marks); every other
    -- correction is about a decision that restricted. A statement of its own after the lock above.
    SELECT d.* INTO reviewed FROM public.decisions d
     WHERE d.id = NEW.reviews_decision_id AND d.case_id = NEW.case_id AND d.kind IN ('interim', 'final', 'order')
       AND (d.outcome = 'restricted' OR (NEW.outcome = 'kept' AND d.kind = 'final' AND d.outcome = 'no_violation'));
    IF NOT FOUND OR NEW.outcome NOT IN ('kept', 'partly_reversed', 'reversed') OR NEW.category <> reviewed.category
       OR NEW.rules_version <> reviewed.rules_version OR NEW.reason_digest IS NULL THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A correction keeps or reverses a restricting decision of its case, with that decision''s category and rules version and a reason.';
    END IF;
    IF reviewed.kind = 'order' AND NEW.outcome <> 'reversed' THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'An order decision holds one measure: its correction reverses it.';
    END IF;
    IF NEW.outcome = 'kept' AND reviewed.outcome = 'restricted' AND NOT EXISTS (
         SELECT 1 FROM public.decision_actions a JOIN public.suspension_replies r ON r.action_id = a.id
          WHERE a.decision_id = reviewed.id AND a.kind IN ('suspend', 'terminate') AND r.answered_by IS NULL
            AND public.standing_basis_broken_at(a.id) IS NULL) THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'kept: a correction keeps a decision only to answer a reply to its standing measure, or to withdraw the marks of a decision that found no breach.';
    END IF;
    IF NEW.outcome = 'kept' AND reviewed.outcome = 'no_violation' AND NOT EXISTS (
         SELECT 1 FROM public.unfounded_marks m WHERE m.decision_id = reviewed.id AND m.withdrawn_by IS NULL) THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'kept: the decision that found no breach holds no mark left to withdraw.';
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
  ELSIF NEW.kind = 'order' THEN
    -- 3f. The item first: the effect's own transaction wrote its intake item and holds its row.
    SELECT x.* INTO oi FROM public.legal_order_items x WHERE x.id = NEW.order_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'An order decision names an item of an order.';
    END IF;
    PERFORM 1 FROM public.legal_orders x WHERE x.id = oi.order_id FOR SHARE;
    -- A statement of its own after the lock: a closing, a correction or a hold's end that committed meanwhile is read.
    SELECT x.* INTO o FROM public.legal_orders x WHERE x.id = oi.order_id;
    IF o.closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'order_closed';
    END IF;
    IF o.kind = 'dsa_art10' OR c.closed_at IS NOT NULL OR c.target_type <> 'post' OR c.target_id IS DISTINCT FROM oi.post_id
       OR NEW.outcome <> 'restricted' OR NEW.ground IS DISTINCT FROM 'illegal'
       OR NEW.facts_digest IS NOT NULL OR NEW.reason_digest IS NOT NULL OR NEW.legal_reference_digest IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'An order decision restricts, on the law and with no text of korbat''s, the post its item names, on an open case about it.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.intake_items i JOIN public.intakes n ON n.id = i.intake_id
                    WHERE i.id = oi.intake_item_id AND i.case_id = NEW.case_id AND i.target_type = 'post' AND i.target_id = oi.post_id
                      AND n.kind = 'order' AND i.answered_by IS NULL) THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'The item''s intake item is not an unanswered item of an order''s intake, of this case and about this post.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.id = oi.action_id) THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'already given effect';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A decision is interim, final, an order''s, a correction or a review.';
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
  -- item), and (3f) an order decision its own item alone. No decision but an order's considers an item of an order's
  -- intake. One statement after the case's lock reads every fact the steps below need of them.
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
     AND CASE WHEN NEW.kind = 'order' THEN i.id = oi.intake_item_id AND i.answered_by IS NULL
              WHEN NEW.kind = 'final' THEN i.seq BETWEEN NEW.answers_from_seq AND NEW.through_seq AND n.kind <> 'order'
              WHEN NEW.kind IN ('correction', 'review') AND reviewed.kind IN ('final', 'order') THEN i.answered_by = reviewed.id
              ELSE i.answered_by IS NULL AND n.kind <> 'order' END;
  -- 3f (row 13): an order leaves no discretion in either direction, so recusal is asked neither of an order decision nor
  -- of the correction that reinstates.
  IF NEW.kind <> 'order' AND NOT (NEW.kind = 'correction' AND reviewed.kind = 'order')
     AND public.staff_party_conflict(NEW.decided_by, array_remove(ARRAY[subject], NULL) || reporters, CASE WHEN c.target_type = 'post' THEN c.target_id END) THEN
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
  NEW.suspect := CASE WHEN NEW.kind IN ('correction', 'review') THEN reviewed.suspect WHEN NEW.kind = 'order' THEN false ELSE considers_suspect END;
  NEW.unseen := false;
  IF NEW.kind = 'final' AND c.target_type = 'post' THEN
    -- Read now, before decisions_apply answers anything: frozen through a suspect item of this case, through the author's
    -- account's case, through a seal in force, or (3f) through a preservation.
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
                       WHEN 'correction' THEN reviewed.needs_admin OR reviewed.kind = 'order'
                       WHEN 'review' THEN public.review_needs_admin(NEW.reviews_decision_id)
                       -- 3f (row 12): a DSA Article 9 order is verified before effect, or given effect by an admin as urgent.
                       WHEN 'order' THEN o.kind = 'dsa_art9' AND o.verified_at IS NULL
                       ELSE false END;
  IF NEW.needs_admin AND decider_role IS DISTINCT FROM 'admin' THEN
    IF NEW.kind = 'order' THEN
      RAISE EXCEPTION 'order_not_verified';
    END IF;
    RAISE EXCEPTION 'admin_required';
  END IF;

  -- 7. A one-bigint key: the social module's pair locks use the two-key space, so the two never meet. 3f: the caps count
  -- no order decision and refuse none; an order decision has its own cap, counted under the same lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('korbat.decision_cap:' || NEW.decided_by::text, 0));
  SELECT l.decisions_per_hour, l.decisions_per_day INTO per_hour, per_day FROM public.moderation_limits l WHERE l.id = 1;
  SELECT count(*) FILTER (WHERE d.decided_at > now() - interval '1 hour'), count(*) INTO in_hour, in_day
    FROM public.decisions d WHERE d.decided_by = NEW.decided_by AND d.decided_at > now() - interval '1 day' AND d.kind <> 'order';
  IF NEW.kind <> 'order' AND (in_hour >= coalesce(per_hour, 60) OR in_day >= coalesce(per_day, 300)) THEN
    RAISE EXCEPTION 'decision_cap';
  END IF;
  IF NEW.kind = 'order' AND (SELECT count(*) FROM public.decisions d
                              WHERE d.decided_by = NEW.decided_by AND d.kind = 'order' AND d.decided_at > now() - make_interval(days => 1))
                            >= (SELECT r.decisions_per_day FROM public.order_rules() r) THEN
    RAISE EXCEPTION 'order_cap';
  END IF;

  -- 8.
  IF (NEW.ground IS NOT DISTINCT FROM 'illegal' OR NEW.outcome = 'not_evident') AND NOT considers_illegal THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'The ground of the law, and "illegality not evident", need a considered item that alleges illegality.';
  END IF;

  -- 9.
  NEW.source := CASE WHEN NEW.kind = 'order' THEN 'order'::public.decision_source
                     WHEN NEW.kind IN ('correction', 'review') THEN reviewed.source
                     WHEN from_notice THEN 'notice'::public.decision_source
                     WHEN from_user THEN 'report'::public.decision_source
                     ELSE 'own_initiative'::public.decision_source END;

  -- 10. Both reads come after the case's lock and after the subject's profile lock, which the deciding transaction takes
  -- first and the author's deletion and the purge take too, so the target cannot be deleted before the commit. 3f: a final
  -- decision closes its case, and ends its interim measures, when it leaves no unanswered item above its range.
  IF NEW.kind = 'final' AND NOT EXISTS (SELECT 1 FROM public.intake_items i
                                         WHERE i.case_id = NEW.case_id AND i.answered_by IS NULL AND i.seq > NEW.through_seq) THEN
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
                       -- The withdrawal of a no-breach decision's marks concerns the people who reported, not the author.
                       WHEN NEW.kind = 'correction' AND NEW.outcome = 'kept' AND reviewed.outcome <> 'restricted' THEN 'none'
                       WHEN NEW.kind = 'correction' AND reviewed.author_mail <> 'none' THEN 'pending'
                       WHEN NEW.kind = 'review' THEN 'pending'
                       ELSE 'none' END::public.delivery_state;
  IF NEW.kind = 'order' THEN
    -- 3f (section 6.3, step 10.2): korbat does not assess what an order names and classifies nothing an authority ordered;
    -- the decision is never exported. Told at once unless the order holds the notice.
    NEW.through_seq := 0;
    IF o.kind = 'tco_removal' THEN
      NEW.category := 'STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY';
      NEW.category_keyword := 'KEYWORD_TERRORIST_CONTENT';
    ELSE
      NEW.category := 'STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE';
      NEW.category_keyword := NULL;
    END IF;
    held := coalesce(public.order_hold_until(o.id) > now(), false);
    NEW.informed_at := CASE WHEN held THEN NULL ELSE NEW.decided_at END;
    NEW.author_mail := CASE WHEN held THEN 'none' ELSE 'pending' END::public.delivery_state;
  ELSIF NEW.kind = 'correction' AND reviewed.kind = 'order' AND reviewed.informed_at IS NULL THEN
    -- 10.3: a reinstatement while the notice is held tells nothing either; the release tells both.
    NEW.informed_at := NULL;
    NEW.author_mail := 'none';
  END IF;
  IF NEW.kind <> 'order' AND NEW.author_mail = 'pending' AND c.target_type = 'post' THEN
    -- 10.4, a statement of its own after the case's lock: nothing reaches an author while a notice is held, on any path.
    SELECT public.order_notice_held(c.target_id) INTO held;
    IF held THEN
      NEW.informed_at := NULL;
      NEW.author_mail := 'none';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
-- 8. decisions_apply, replaced (0021). Everything 0016, 0017 and 0021 say of it stands, stated again in full. What 3f
-- changes:
--   - An order decision, in this order: it answers its own item as restricted_legal (invalid_decision unless exactly
--     one row was written); it recomputes the lane, the oldest open time and the closing from the items left; it moves
--     the case's version and last decision; it sets answered_seq = intake_seq only when no item is left, which closes
--     the case; and for a case it closed it calls moderation_apply.
--   - A final decision sets answered_seq = intake_seq when it closes its case (an answered order item may lie above its
--     range, and cases_closed_answered asks for equality), its through_seq otherwise.
--   - The interim seal a final decision ends makes it owed a telling, as built; on a post whose order's notice is held
--     that telling is held too (informed_at null, the mail none), and the release gives it.
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
  reply record;
  answered integer;
  held boolean;
BEGIN
  IF NEW.kind = 'order' THEN
    UPDATE public.intake_items i SET answered_by = NEW.id, outcome = 'restricted_legal'
     WHERE i.id = (SELECT x.intake_item_id FROM public.legal_order_items x WHERE x.id = NEW.order_item_id)
       AND i.case_id = NEW.case_id AND i.answered_by IS NULL;
    GET DIAGNOSTICS answered = ROW_COUNT;
    IF answered <> 1 THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'An order decision answers its own item.';
    END IF;
    SELECT count(*), min(i.lane), min(i.created_at) INTO open_items, open_lane, oldest
      FROM public.intake_items i WHERE i.case_id = NEW.case_id AND i.answered_by IS NULL;
    UPDATE public.cases k
       SET state_version = k.state_version + 1,
           last_decided_at = now(),
           lane = coalesce(open_lane, 2),
           oldest_open_at = oldest,
           answered_seq = CASE WHEN open_items = 0 THEN k.intake_seq ELSE k.answered_seq END,
           closed_at = CASE WHEN open_items = 0 THEN now() END
     WHERE k.id = NEW.case_id
    RETURNING k.* INTO c;
    IF c.closed_at IS NOT NULL THEN
      PERFORM public.moderation_apply(ARRAY[c.target_id], true);
    END IF;
  ELSIF NEW.kind = 'final' THEN
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
           answered_seq = CASE WHEN open_items = 0 THEN k.intake_seq ELSE NEW.through_seq END,
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
        -- 3f: a statement of its own; on a post whose order's notice is held the telling this makes owed is held too.
        held := c.target_type = 'post' AND public.order_notice_held(c.target_id);
        UPDATE public.decisions d
           SET ended_interim = true,
               author_mail = CASE WHEN d.author_mail = 'none' AND NOT held THEN 'pending'::public.delivery_state ELSE d.author_mail END,
               informed_at = CASE WHEN d.author_mail = 'none' AND held THEN NULL ELSE d.informed_at END
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

  -- 3e: the answer to a reply.
  IF (NEW.kind IN ('review', 'correction') AND NEW.outcome = 'kept') OR (NEW.kind = 'review' AND NEW.outcome = 'partly_reversed') THEN
    FOR reply IN
      SELECT r.action_id, r.on_time, a.subject_account_id
        FROM public.decision_actions a JOIN public.suspension_replies r ON r.action_id = a.id
       WHERE a.decision_id = NEW.reviews_decision_id AND a.kind IN ('suspend', 'terminate') AND r.answered_by IS NULL
       ORDER BY r.action_id
    LOOP
      IF reply.on_time THEN
        PERFORM 1 FROM public.profiles p WHERE p.id = reply.subject_account_id FOR UPDATE;
      END IF;
      UPDATE public.suspension_replies r SET answered_by = NEW.id, answered_at = now() WHERE r.action_id = reply.action_id AND r.answered_by IS NULL;
      IF reply.on_time THEN
        PERFORM public.standing_apply(reply.subject_account_id);
      END IF;
    END LOOP;
  END IF;
  -- 3e: a kept correction of a decision that found no breach withdraws all of its marks together.
  IF NEW.kind = 'correction' AND NEW.outcome = 'kept' THEN
    UPDATE public.unfounded_marks m SET withdrawn_by = NEW.id, withdrawn_at = now()
     WHERE m.decision_id = NEW.reviews_decision_id AND m.withdrawn_by IS NULL;
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
-- 9. decision_actions_check, replaced (0025). Everything 0016, 0021 and 0025 say of it stands, stated again in full. What
-- 3f changes, by step:
--   2. withhold_author is cleared, and order_ground on every kind but reinstate_by_order. Both new kinds are post kinds
--      (post_id is the case's target); disable_by_order is a measure.
--   3. An order decision holds one disable_by_order and nothing else; no other decision kind holds it. A
--      reinstate_by_order only in a correction, with its ground (invalid_decision otherwise).
--   6. reinstate_by_order lifts disable_by_order.
--   8. staff_target does not refuse an order decision (row 13).
--   9. reinstate_by_order marks the decision needs_admin and refuses a decider who is not an admin, as unseal_media does.
--   New: a disable_by_order's withhold_author is forced to its order's withhold_from_author.
--  10. no_effect: a disable_by_order is deleted on a deleted post, and already when the level is disabled, or removed and
--      the measure does not withhold from the author; a remove on a disabled post is already too.
--  11. The interim measure a reversal lifts makes its decision owed a telling, as built; on a post whose order's notice is
--      held that telling is held too (informed_at null, the mail none), and the release gives it.
CREATE OR REPLACE FUNCTION "public"."decision_actions_check"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d public.decisions;
  c public.cases;
  subject uuid;
  is_measure boolean;
  lifted public.action_kind[];
  target uuid;
  target_decision public.decisions;
  decider_role text;
  post_state public.post_state;
  post_level public.moderation_level;
  image_state public.media_moderation_state;
  profile public.profiles;
  rules record;
  max_days integer;
  basis_decision uuid;
  earlier_decision uuid;
  ladder_count integer;
  ladder_decisions uuid[];
  newest_strike_at timestamptz;
  newest_rule text;
  last_ladder_at timestamptz;
  rungs_used integer;
  ladder_holds boolean := false;
  reports_sent integer;
  reports_marked integer;
  warning_decision uuid;
  warning_told timestamptz;
  -- 3f: the order a disable_by_order gives effect to, and whether a notice about the case's post is held.
  ord public.legal_orders;
  held boolean;
BEGIN
  -- 1.
  SELECT x.* INTO d FROM public.decisions x WHERE x.id = NEW.decision_id;
  IF NOT FOUND OR d.xact IS DISTINCT FROM pg_current_xact_id() OR d.decided_at IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A measure or a reversal is added only in the transaction of its own decision.';
  END IF;
  SELECT k.* INTO c FROM public.cases k WHERE k.id = d.case_id;

  -- 2.
  NEW.subject_account_id := NULL;
  NEW.post_id := NULL;
  NEW.reverses_action_id := NULL;
  NEW.no_effect := NULL;
  NEW.created_at := now();
  NEW.basis := NULL;
  NEW.rests_on := NULL;
  NEW.starts_at := NULL;
  NEW.ends_at := NULL;
  IF NEW.kind NOT IN ('suspend', 'restrict_reporting') THEN
    NEW.days := NULL;
  END IF;
  IF NEW.kind NOT IN ('suspend', 'terminate', 'restrict_reporting') THEN
    NEW.announced := NULL;
  END IF;
  NEW.replaced := CASE WHEN NEW.kind = 'lift_suspension' THEN coalesce(NEW.replaced, false) END;
  -- 3f: the withholding is forced below for a disable_by_order alone, and only a reinstatement names its ground.
  NEW.withhold_author := NULL;
  IF NEW.kind <> 'reinstate_by_order' THEN
    NEW.order_ground := NULL;
  END IF;
  IF NEW.kind IN ('seal_media', 'unseal_media') THEN
    NEW.media_id := NULL;
  END IF;
  IF c.target_type = 'post' THEN
    SELECT p.author_id INTO subject FROM public.posts p WHERE p.id = c.target_id;
  ELSE
    subject := c.target_id;
  END IF;
  IF subject IS NULL THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'The case''s target does not exist.';
  END IF;
  NEW.subject_account_id := subject;
  IF NEW.kind IN ('withhold', 'remove', 'restore', 'withhold_media', 'remove_media', 'restore_media', 'disable_by_order', 'reinstate_by_order') THEN
    NEW.post_id := c.target_id;
  END IF;
  is_measure := NEW.kind IN ('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio',
                             'strike', 'suspend', 'terminate', 'retire_handle', 'warn_reporting', 'restrict_reporting', 'disable_by_order');

  -- 3.
  IF (NEW.post_id IS NOT NULL AND c.target_type <> 'post')
     OR (NEW.kind IN ('reset_display_name', 'reset_bio', 'restore_display_name', 'restore_bio') AND c.target_type <> 'account') THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'Post and image measures belong to a post case, field measures to an account case.';
  END IF;
  IF (NEW.kind IN ('strike', 'overrule') AND c.target_type <> 'post')
     OR (NEW.kind IN ('suspend', 'terminate', 'retire_handle', 'warn_reporting', 'restrict_reporting', 'lift_suspension', 'unretire_handle', 'lift_reporting') AND c.target_type <> 'account') THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A strike and its overruling belong to a post case, the account measures and their reversals to an account case.';
  END IF;
  IF NOT (CASE d.kind
            WHEN 'interim' THEN NEW.kind IN ('withhold', 'withhold_media', 'reset_display_name', 'reset_bio', 'seal_media', 'restore', 'restore_media')
            WHEN 'final' THEN NEW.kind IN ('remove', 'remove_media', 'reset_display_name', 'reset_bio', 'seal_media', 'restore', 'restore_media',
                                           'strike', 'suspend', 'terminate', 'retire_handle', 'warn_reporting', 'restrict_reporting')
            -- 3f: an order decision holds disable_by_order and nothing else, and no other decision holds it.
            WHEN 'order' THEN NEW.kind = 'disable_by_order'
            ELSE NOT is_measure END) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A decision of this kind does not hold this measure or reversal.';
  END IF;
  IF NEW.kind = 'disable_by_order' AND EXISTS (SELECT 1 FROM public.decision_actions x WHERE x.decision_id = d.id) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'An order decision holds exactly one disable_by_order.';
  END IF;
  IF NEW.kind = 'reinstate_by_order' AND (NEW.order_ground IS NULL OR d.kind <> 'correction') THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A reinstatement after an order is a correction and names its ground.';
  END IF;
  IF NEW.kind = 'overrule' AND d.outcome <> 'reversed' THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A strike falls only with its whole finding: it is overruled only by a review or a correction that reverses the decision.';
  END IF;
  IF NEW.kind = 'retire_handle' AND EXISTS (SELECT 1 FROM public.decision_actions x WHERE x.decision_id = d.id) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'The retirement of a handle is its decision''s first measure.';
  END IF;
  IF (NEW.kind = 'suspend' AND (NEW.days IS NULL OR NEW.announced IS NULL))
     OR (NEW.kind = 'terminate' AND NEW.announced IS NULL)
     OR (NEW.kind = 'restrict_reporting' AND (NEW.days IS NULL OR NEW.announced IS DISTINCT FROM false)) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A suspension names its days and whether it is announced, a termination whether it is announced, a restriction of reporting its days and that it is not announced.';
  END IF;
  IF (NEW.kind IN ('suspend', 'terminate') AND EXISTS (SELECT 1 FROM public.decision_actions x WHERE x.decision_id = d.id AND x.kind = 'seal_media'))
     OR (NEW.kind = 'seal_media' AND EXISTS (SELECT 1 FROM public.decision_actions x WHERE x.decision_id = d.id AND x.kind IN ('suspend', 'terminate'))) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A decision that seals holds no suspension or termination: each has a decision, a statement and an appeal of its own.';
  END IF;
  IF NEW.kind IN ('withhold', 'remove') AND EXISTS (
       SELECT 1 FROM public.decision_actions x WHERE x.decision_id = d.id AND x.kind IN ('withhold', 'remove')) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A decision holds at most one post measure.';
  END IF;
  IF NEW.kind IN ('withhold_media', 'remove_media', 'restore_media') THEN
    IF NEW.media_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.post_media m WHERE m.id = NEW.media_id AND m.post_id = c.target_id) THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'An image measure names an image of the case''s post.';
    END IF;
  ELSIF NEW.media_id IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'Only an image measure names an image.';
  END IF;

  -- 4.
  IF c.target_type = 'post' THEN
    PERFORM 1 FROM public.posts p WHERE p.id = c.target_id FOR UPDATE;
  END IF;

  -- 5.
  IF d.kind = 'interim' AND NEW.kind IN ('withhold', 'withhold_media') AND EXISTS (
       SELECT 1 FROM public.measures_in_force m
        WHERE m.case_id = c.id AND m.decision_kind = 'interim' AND m.kind = NEW.kind AND m.media_id IS NOT DISTINCT FROM NEW.media_id) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'The case already holds this interim measure in force.';
  END IF;

  -- 6.
  IF NOT is_measure THEN
    lifted := CASE NEW.kind
                WHEN 'restore' THEN ARRAY['withhold', 'remove']
                WHEN 'unseal_media' THEN ARRAY['seal_media']
                WHEN 'restore_media' THEN ARRAY['withhold_media', 'remove_media']
                WHEN 'restore_display_name' THEN ARRAY['reset_display_name']
                WHEN 'overrule' THEN ARRAY['strike']
                WHEN 'lift_suspension' THEN ARRAY['suspend', 'terminate']
                WHEN 'unretire_handle' THEN ARRAY['retire_handle']
                WHEN 'lift_reporting' THEN ARRAY['warn_reporting', 'restrict_reporting']
                WHEN 'reinstate_by_order' THEN ARRAY['disable_by_order']
                ELSE ARRAY['reset_bio'] END::public.action_kind[];
    IF d.kind IN ('review', 'correction') THEN
      SELECT a.id INTO target FROM public.decision_actions a
       WHERE a.decision_id = d.reviews_decision_id AND a.kind = ANY(lifted) AND a.media_id IS NOT DISTINCT FROM NEW.media_id;
    ELSE
      SELECT m.id INTO target FROM public.measures_in_force m
       WHERE m.case_id = c.id AND m.decision_kind = 'interim' AND m.media_id IS NOT DISTINCT FROM NEW.media_id
         AND m.kind = CASE NEW.kind WHEN 'restore' THEN 'withhold' ELSE 'withhold_media' END::public.action_kind;
    END IF;
    IF target IS NULL OR NOT EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.id = target) THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A reversal lifts a measure that is in force.';
    END IF;
    NEW.reverses_action_id := target;
  END IF;

  -- 7.
  IF NEW.kind = 'seal_media' AND NOT (d.suspect AND (d.rule_id IS NOT DISTINCT FROM 'R2' OR d.category = 'STATEMENT_CATEGORY_PROTECTION_OF_MINORS')) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A seal needs a decision that rests on a suspect item, under R2 or in the category Protection of minors.';
  END IF;

  -- 8. The subject's row is held FOR SHARE since decisions_record, so the lock order holds. 3f (row 13): an order about a
  -- staff member's post is given effect like any other.
  IF is_measure AND public.account_is_staff(subject) AND d.kind NOT IN ('interim', 'order') THEN
    RAISE EXCEPTION 'staff_target';
  END IF;

  -- 9. The deciding account's row is held FOR SHARE since decisions_record; this reads the same row again.
  IF NEW.kind IN ('unseal_media', 'reinstate_by_order') THEN
    UPDATE public.decisions x SET needs_admin = true WHERE x.id = d.id;
    SELECT u.role::text INTO decider_role FROM auth.users u WHERE u.id = d.decided_by FOR SHARE;
    IF decider_role IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'admin_required';
    END IF;
  END IF;

  -- 3f: a disable_by_order withholds from the author exactly when its order does (the order's row is held FOR SHARE
  -- since decisions_record), so signed params can never show a held notice's post to its author.
  IF NEW.kind = 'disable_by_order' THEN
    SELECT x.* INTO ord FROM public.legal_orders x JOIN public.legal_order_items i ON i.order_id = x.id WHERE i.id = d.order_item_id;
    NEW.withhold_author := ord.withhold_from_author;
  END IF;

  -- 9a. A standing measure.
  IF NEW.kind IN ('suspend', 'terminate') THEN
    SELECT k.* INTO rules FROM public.standing_rules() k;
    -- 9a.1. Free when the API holds the row FOR UPDATE, as it does for these decisions.
    PERFORM 1 FROM public.profiles p WHERE p.id = subject FOR UPDATE;
    -- 9a.2. A statement of its own after the lock: one standing measure at a time, one with no start yet included.
    IF EXISTS (SELECT 1 FROM public.standing_live s WHERE s.account_id = subject) THEN
      RAISE EXCEPTION 'standing_conflict';
    END IF;
    -- 9a.3 and 9a.4. The basis: the first row of the table that fits the decision's own columns.
    IF d.rule_id IS NOT DISTINCT FROM 'R2' THEN
      -- A seal for good of the subject's images (a seal of a final decision about the account or one of its posts) in
      -- force, at most basis_age_days old, on which no protective suspension, standing or lifted, has rested yet.
      IF NEW.kind = 'suspend' AND NOT NEW.announced THEN
        SELECT m.decision_id INTO basis_decision
          FROM public.measures_in_force m JOIN public.decisions x ON x.id = m.decision_id
         WHERE m.kind = 'seal_media' AND m.decision_kind = 'final' AND m.subject_account_id = subject
           AND x.decided_at >= now() - make_interval(days => rules.basis_age_days)
           AND NOT EXISTS (SELECT 1 FROM public.decision_actions p WHERE p.kind = 'suspend' AND p.basis = 'protective' AND m.decision_id = ANY(p.rests_on))
         ORDER BY x.decided_at DESC, x.id DESC LIMIT 1;
        IF basis_decision IS NOT NULL THEN
          NEW.basis := 'protective';
          NEW.rests_on := ARRAY[basis_decision];
          max_days := rules.protective_days;
        END IF;
      END IF;
      IF NEW.basis IS NULL THEN
        IF NEW.kind = 'terminate' THEN
          RAISE EXCEPTION 'ground_not_established';
        END IF;
        RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'basis: under R2 only a protective suspension at once is open, on a seal for good no protective suspension rested on.';
      END IF;
    ELSIF d.ground IS NOT DISTINCT FROM 'illegal' THEN
      IF NEW.kind = 'suspend' AND NOT NEW.announced AND d.category_keyword IS NOT DISTINCT FROM 'KEYWORD_TERRORIST_CONTENT' THEN
        SELECT x.id INTO basis_decision
          FROM public.decisions x JOIN public.cases xc ON xc.id = x.case_id AND xc.target_type = 'post'
          JOIN public.posts xp ON xp.id = xc.target_id AND xp.author_id = subject
         WHERE x.kind = 'final' AND x.outcome = 'restricted' AND x.ground = 'illegal' AND x.category_keyword = 'KEYWORD_TERRORIST_CONTENT'
           AND x.decided_at >= now() - make_interval(days => rules.basis_age_days)
           AND EXISTS (SELECT 1 FROM public.measures_in_force f WHERE f.decision_id = x.id)
         ORDER BY x.decided_at DESC, x.id DESC LIMIT 1;
        IF basis_decision IS NOT NULL THEN
          NEW.basis := 'terrorist';
          NEW.rests_on := ARRAY[basis_decision];
          max_days := rules.terrorist_days;
        END IF;
      END IF;
      IF NEW.basis IS NULL THEN
        RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'basis: on the law only a suspension at once on terrorist content is open, on a final decision that found it in a post of the account.';
      END IF;
    ELSE
      IF d.rule_id = 'R5' AND NEW.kind = 'suspend' AND NOT NEW.announced THEN
        SELECT x.id INTO basis_decision
          FROM public.decisions x JOIN public.cases xc ON xc.id = x.case_id AND xc.target_type = 'post'
          JOIN public.posts xp ON xp.id = xc.target_id AND xp.author_id = subject
         WHERE x.kind = 'final' AND x.outcome = 'restricted' AND x.rule_id = 'R5'
           AND x.decided_at >= now() - make_interval(days => rules.basis_age_days)
           AND EXISTS (SELECT 1 FROM public.measures_in_force f WHERE f.decision_id = x.id)
         ORDER BY x.decided_at DESC, x.id DESC LIMIT 1;
        IF basis_decision IS NOT NULL THEN
          NEW.basis := 'threat';
          NEW.rests_on := ARRAY[basis_decision];
          max_days := rules.threat_days;
        END IF;
      ELSIF d.rule_id = 'R5' AND NEW.kind = 'terminate' AND NOT NEW.announced THEN
        -- A suspension of the subject on the basis threat that stands, whose basis holds and that was decided within
        -- ladder_memory_days, and a final R5 decision as above about a post made after that suspension's decision was told.
        SELECT a.rests_on[1], x.id INTO earlier_decision, basis_decision
          FROM public.decision_actions a
          JOIN public.decisions ad ON ad.id = a.decision_id
          JOIN public.posts xp ON xp.author_id = subject AND xp.created_at > ad.informed_at
          JOIN public.cases xc ON xc.target_type = 'post' AND xc.target_id = xp.id
          JOIN public.decisions x ON x.case_id = xc.id
         WHERE a.subject_account_id = subject AND a.kind = 'suspend' AND a.basis = 'threat'
           AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = a.id)
           AND public.standing_basis_broken_at(a.id) IS NULL
           AND ad.decided_at >= now() - make_interval(days => rules.ladder_memory_days)
           AND x.kind = 'final' AND x.outcome = 'restricted' AND x.rule_id = 'R5'
           AND x.decided_at >= now() - make_interval(days => rules.basis_age_days)
           AND EXISTS (SELECT 1 FROM public.measures_in_force f WHERE f.decision_id = x.id)
         ORDER BY x.decided_at DESC, x.id DESC, ad.decided_at DESC LIMIT 1;
        IF basis_decision IS NOT NULL THEN
          NEW.basis := 'threat_repeat';
          NEW.rests_on := ARRAY[earlier_decision, basis_decision];
        END IF;
      ELSIF d.rule_id = 'R6' AND NEW.kind = 'suspend' AND NOT NEW.announced THEN
        -- The count is a floor under the admin's finding, which the decision's facts state, and never the finding.
        IF (SELECT count(*) FROM public.posts p WHERE p.author_id = subject AND p.created_at > now() - make_interval(mins => rules.flood_minutes)) >= rules.flood_posts THEN
          NEW.basis := 'flood';
          max_days := rules.flood_days;
        END IF;
      END IF;
      IF NEW.basis IS NULL AND NEW.announced THEN
        -- The ladder. The subject's active strikes, oldest first, and the rule of the newest.
        SELECT count(*), coalesce(array_agg(s.decision_id ORDER BY s.created_at, s.action_id), '{}'::uuid[]), max(s.created_at)
          INTO ladder_count, ladder_decisions, newest_strike_at
          FROM public.active_strikes s WHERE s.account_id = subject;
        SELECT x.rule_id INTO newest_rule
          FROM public.active_strikes s JOIN public.decisions x ON x.id = s.decision_id
         WHERE s.account_id = subject ORDER BY s.created_at DESC, s.action_id DESC LIMIT 1;
        SELECT max(a.created_at) INTO last_ladder_at FROM public.decision_actions a
         WHERE a.subject_account_id = subject AND a.kind IN ('suspend', 'terminate') AND a.basis IN ('strikes', 'ladder_end')
           AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = a.id);
        SELECT count(*) INTO rungs_used FROM public.decision_actions a JOIN public.decisions ad ON ad.id = a.decision_id
         WHERE a.subject_account_id = subject AND a.kind = 'suspend' AND a.basis = 'strikes'
           AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = a.id)
           AND public.standing_basis_broken_at(a.id) IS NULL
           AND ad.decided_at >= now() - make_interval(days => rules.ladder_memory_days);
        ladder_holds := ladder_count >= rules.ladder_strikes
                        AND (last_ladder_at IS NULL OR newest_strike_at > last_ladder_at)
                        AND d.rule_id IS NOT DISTINCT FROM newest_rule;
        IF ladder_holds AND NEW.kind = 'suspend' THEN
          NEW.basis := 'strikes';
          NEW.rests_on := ladder_decisions;
          max_days := rules.ladder_days[least(rungs_used + 1, cardinality(rules.ladder_days))];
        ELSIF ladder_holds AND NEW.kind = 'terminate' AND rungs_used >= cardinality(rules.ladder_days) THEN
          NEW.basis := 'ladder_end';
          NEW.rests_on := ladder_decisions;
        END IF;
      END IF;
      IF NEW.basis IS NULL THEN
        RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'basis: none fits. A measure at once needs its ground (R5 threat or second threat, R6 flood); an announced one the ladder.';
      END IF;
    END IF;
    -- 9a.5.
    IF NEW.kind = 'suspend' AND NEW.days > max_days THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = format('days: at most %s on the basis %s.', max_days, NEW.basis);
    END IF;
    -- 9a.6.
    NEW.starts_at := CASE WHEN NEW.announced THEN now() + make_interval(hours => rules.reply_window_hours) ELSE now() END;
    -- 9a.7. The deciding account's row is held FOR SHARE since decisions_record; this reads the same row again.
    IF NOT NEW.announced OR NEW.kind = 'terminate' THEN
      UPDATE public.decisions x SET needs_admin = true WHERE x.id = d.id;
      SELECT u.role::text INTO decider_role FROM auth.users u WHERE u.id = d.decided_by FOR SHARE;
      IF decider_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'admin_required';
      END IF;
    END IF;
    -- 9a.8. Findings only: such a measure judges nothing a report in this case named.
    IF NEW.basis IN ('strikes', 'protective', 'ladder_end') AND EXISTS (
         SELECT 1 FROM public.intake_items i JOIN public.intakes n ON n.id = i.intake_id WHERE i.answered_by = d.id AND n.kind = 'user') THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'open_reports';
    END IF;
  END IF;

  -- 9b. A strike.
  IF NEW.kind = 'strike' THEN
    SELECT k.* INTO rules FROM public.standing_rules() k;
    PERFORM 1 FROM public.profiles p WHERE p.id = subject FOR NO KEY UPDATE;
    NEW.ends_at := now() + make_interval(days => rules.strike_days);
  END IF;

  -- 9c. A warning and a restriction of reporting (3e design, section 6.3). The counts are of reports (intakes): a report
  -- is marked when one of its items holds a mark that counts, which is a mark whose report was sent on a UTC day within
  -- report_frame_days, that no correction withdrew, and whose item no re-examination ended in a restriction. The view
  -- reporting_record is the reporting counts' migration's: PL/pgSQL resolves it only when this branch runs, which no
  -- route allows before that migration exists. The refusal open_reports comes first, before any count is read.
  IF NEW.kind IN ('warn_reporting', 'restrict_reporting') THEN
    SELECT k.* INTO rules FROM public.standing_rules() k;
    IF d.rule_id IS DISTINCT FROM 'R6' THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A warning or a restriction of reporting cites R6.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.intake_items i JOIN public.intakes n ON n.id = i.intake_id WHERE i.answered_by = d.id AND n.kind = 'user') THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'open_reports';
    END IF;
    IF NEW.kind = 'warn_reporting' THEN
      SELECT r.reports, r.unfounded INTO reports_sent, reports_marked FROM public.reporting_record r WHERE r.account_id = subject;
      IF coalesce(reports_marked, 0) < rules.report_warn_marks OR coalesce(reports_marked, 0) < rules.report_warn_share * coalesce(reports_sent, 0) THEN
        RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'warning: the account''s marked reports are below the threshold.';
      END IF;
      IF EXISTS (SELECT 1 FROM public.decision_actions w WHERE w.subject_account_id = subject AND w.kind = 'warn_reporting' AND w.ends_at > now()
                    AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = w.id)) THEN
        RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'warning: a warning of the account still counts.';
      END IF;
      NEW.basis := 'reports';
      NEW.ends_at := now() + make_interval(days => rules.report_frame_days);
    ELSE
      SELECT w.decision_id, wd.informed_at INTO warning_decision, warning_told
        FROM public.decision_actions w JOIN public.decisions wd ON wd.id = w.decision_id
       WHERE w.subject_account_id = subject AND w.kind = 'warn_reporting' AND w.ends_at > now()
         AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = w.id)
       ORDER BY w.created_at DESC, w.id DESC LIMIT 1;
      IF warning_decision IS NULL THEN
        RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'restriction: the account has no warning that still counts.';
      END IF;
      -- Reports the person sent after korbat told them of the warning, never reports sent before it and decided after.
      SELECT count(DISTINCT m.intake_id) INTO reports_marked
        FROM public.unfounded_marks m
       WHERE m.account_id = subject AND m.reported_at > warning_told AND m.withdrawn_by IS NULL
         AND EXISTS (SELECT 1 FROM public.intake_items o WHERE o.id = m.item_id AND o.outcome_sent_at IS NOT NULL)
         AND (m.reported_at AT TIME ZONE 'UTC')::date > (now() AT TIME ZONE 'UTC')::date - rules.report_frame_days
         AND NOT EXISTS (SELECT 1 FROM public.intake_items x WHERE x.reexamines_item_id = m.item_id AND x.outcome IN ('restricted_rule', 'restricted_legal'));
      IF reports_marked < rules.report_restrict_marks THEN
        RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'restriction: too few marked reports sent since the warning.';
      END IF;
      IF NEW.days > rules.report_restrict_days THEN
        RAISE EXCEPTION 'invalid_decision' USING DETAIL = format('days: at most %s for a restriction of reporting.', rules.report_restrict_days);
      END IF;
      IF EXISTS (SELECT 1 FROM public.decision_actions x WHERE x.subject_account_id = subject AND x.kind = 'restrict_reporting'
                    AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = x.id)
                    AND public.standing_basis_broken_at(x.id) IS NULL AND x.starts_at + make_interval(days => x.days) > now()) THEN
        RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'restriction: a restriction of the account''s reports still runs.';
      END IF;
      NEW.basis := 'reports';
      NEW.rests_on := ARRAY[warning_decision];
      NEW.starts_at := now();
    END IF;
  END IF;

  -- 10.
  IF is_measure AND NEW.kind NOT IN ('seal_media', 'strike') THEN
    IF c.target_type = 'post' THEN
      SELECT p.state, p.moderation_level INTO post_state, post_level FROM public.posts p WHERE p.id = c.target_id;
      IF post_state = 'deleted_by_author' THEN
        NEW.no_effect := 'deleted';
      ELSIF NEW.kind = 'withhold' THEN
        NEW.no_effect := CASE WHEN post_level <> 'visible' THEN 'already' END;
      ELSIF NEW.kind = 'remove' THEN
        NEW.no_effect := CASE WHEN post_level IN ('removed', 'disabled') THEN 'already' END;
      ELSIF NEW.kind = 'disable_by_order' THEN
        NEW.no_effect := CASE WHEN post_level = 'disabled' OR (post_level = 'removed' AND NOT NEW.withhold_author) THEN 'already' END;
      ELSE
        SELECT m.moderation_state INTO image_state FROM public.post_media m WHERE m.id = NEW.media_id;
        NEW.no_effect := CASE WHEN post_level <> 'visible'
                                OR (NEW.kind = 'withhold_media' AND image_state <> 'visible')
                                OR (NEW.kind = 'remove_media' AND image_state IN ('removed', 'sealed')) THEN 'already' END;
      END IF;
    ELSE
      SELECT p.* INTO profile FROM public.profiles p WHERE p.id = subject;
      IF profile.deleted_at IS NOT NULL THEN
        NEW.no_effect := 'deleted';
      ELSIF (NEW.kind = 'reset_display_name' AND profile.display_name = profile.handle) OR (NEW.kind = 'reset_bio' AND profile.bio = '') THEN
        NEW.no_effect := 'already';
      ELSIF NEW.kind = 'retire_handle' AND EXISTS (
              SELECT 1 FROM public.evidence_snapshots s JOIN public.handle_history h ON h.handle_lower = lower(s.handle)
               WHERE s.id = d.snapshot_id AND h.retired_at IS NOT NULL) THEN
        NEW.no_effect := 'already';
      END IF;
    END IF;
  END IF;

  -- 11.
  IF target IS NOT NULL THEN
    SELECT x.* INTO target_decision FROM public.decisions x JOIN public.decision_actions a ON a.decision_id = x.id WHERE a.id = target;
    IF target_decision.kind = 'interim' AND target_decision.author_mail <> 'none' THEN
      -- 3f: a statement of its own; on a post whose order's notice is held the telling this makes owed is held too.
      held := c.target_type = 'post' AND public.order_notice_held(c.target_id);
      UPDATE public.decisions x
         SET ended_interim = true,
             author_mail = CASE WHEN x.author_mail = 'none' AND NOT held THEN 'pending'::public.delivery_state ELSE x.author_mail END,
             informed_at = CASE WHEN x.author_mail = 'none' AND held THEN NULL ELSE x.informed_at END
       WHERE x.id = d.id;
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

-- 10. decision_actions_apply, replaced (0021). Everything 0016, 0017 and 0021 say of it stands, stated again in full; its
-- first step derives the post's level for both new kinds, which name a post. Added:
--   - disable_by_order: one update of its order's item and one event. The item's row is read first, since it tells two
--     cases apart. An earlier preservation of the item ended (preserve_ended_at is set: a reinstatement, or the end of
--     its six months): this is a new disabling, and an order that preserves keeps the post six months and a day from
--     now, whatever the column held. None ended (a first effect, or one taken again after a restore whose preservation
--     never ended): preserve_until is set only when it is null. In both cases the item's decision and measure become this
--     decision and this row, its reinstatement and the end of its preservation are cleared, disabled_at is set only when
--     it is null, and a closing is cleared; then the event effect_given, by the deciding account, from the console.
--   - reinstate_by_order: the item whose action_id is the lifted measure gets reinstated_at and, while a preservation of
--     it runs, preserve_ended_at; then the event reinstated with the measure's ground.
--   The built last step marks no item for a correction of an order decision: it reads final decisions only.
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
  lifted public.decision_actions;
  retired_lower text;
  placeholder text;
  -- 3f: the order's item a disable_by_order gives effect to, as it stood before this measure, and whether its order preserves.
  item public.legal_order_items;
  preserves boolean;
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
  ELSIF NEW.kind = 'retire_handle' AND NEW.no_effect IS NULL THEN
    SELECT s.* INTO snapshot FROM public.evidence_snapshots s WHERE s.id = d.snapshot_id;
    retired_lower := lower(snapshot.handle);
    placeholder := 'retired_' || substr(encode(sha256(convert_to(NEW.id::text, 'UTF8')), 'hex'), 1, 12);
    INSERT INTO public.handle_history (handle_lower, profile_id)
    SELECT retired_lower, p.id FROM public.profiles p WHERE p.id = NEW.subject_account_id AND lower(p.handle) = retired_lower
    ON CONFLICT DO NOTHING;
    UPDATE public.handle_history h SET retired_at = now()
     WHERE h.handle_lower = retired_lower AND h.profile_id = NEW.subject_account_id AND h.retired_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'profile_changed';
    END IF;
    UPDATE public.profiles p SET handle = placeholder, handle_changed_at = NULL
     WHERE p.id = NEW.subject_account_id AND lower(p.handle) = retired_lower;
  ELSIF NEW.kind = 'unretire_handle' THEN
    SELECT l.* INTO lifted FROM public.decision_actions l WHERE l.id = NEW.reverses_action_id;
    IF lifted.no_effect IS NULL THEN
      SELECT s.* INTO snapshot FROM public.decisions x JOIN public.evidence_snapshots s ON s.id = x.snapshot_id WHERE x.id = lifted.decision_id;
      retired_lower := lower(snapshot.handle);
      placeholder := 'retired_' || substr(encode(sha256(convert_to(lifted.id::text, 'UTF8')), 'hex'), 1, 12);
      UPDATE public.handle_history h SET retired_at = NULL
       WHERE h.handle_lower = retired_lower AND h.profile_id = lifted.subject_account_id;
      UPDATE public.profiles p SET handle_changed_at = NULL WHERE p.id = lifted.subject_account_id AND p.deleted_at IS NULL;
      UPDATE public.profiles p SET handle = snapshot.handle
       WHERE p.id = lifted.subject_account_id AND p.deleted_at IS NULL AND lower(p.handle) = placeholder;
    END IF;
  ELSIF NEW.kind = 'lift_suspension' THEN
    UPDATE public.suspension_replies r SET answered_by = d.id, answered_at = now()
     WHERE r.action_id = NEW.reverses_action_id AND r.answered_by IS NULL;
  END IF;

  -- 3f (section 6.3). The item's row is read before anything is cleared, since it tells a new disabling from a first one
  -- or one taken again after a restore.
  IF NEW.kind = 'disable_by_order' THEN
    SELECT x.* INTO item FROM public.legal_order_items x WHERE x.id = d.order_item_id;
    SELECT x.preserve INTO preserves FROM public.legal_orders x WHERE x.id = item.order_id;
    -- An earlier preservation that ended (a reinstatement, or its end) makes this a new disabling: six months and a day
    -- from now, never from the first (TCO Art. 6(2)), and what the earlier end erased stays erased. Otherwise a kept end
    -- stays, so a measure taken again after a restore starts no new period. disabled_at keeps the first disabling,
    -- which Annex II and the clock read; a closing is cleared, since an item given effect is no closed one.
    UPDATE public.legal_order_items i
       SET decision_id = d.id, action_id = NEW.id,
           disabled_at = coalesce(i.disabled_at, now()),
           preserve_until = CASE WHEN NOT coalesce(preserves, false) THEN i.preserve_until
                                 WHEN item.preserve_ended_at IS NOT NULL THEN public.order_preserve_until(now())
                                 ELSE coalesce(i.preserve_until, public.order_preserve_until(now())) END,
           reinstated_at = NULL, preserve_ended_at = NULL, closed_at = NULL, closed_reason = NULL
     WHERE i.id = d.order_item_id;
    -- By the console, like the decision: decision_holds binds the event's decision to its audit row.
    INSERT INTO public.legal_order_events (order_id, item_id, kind, at, by_staff, via)
    VALUES (item.order_id, item.id, 'effect_given', clock_timestamp(), d.decided_by, 'console');
  ELSIF NEW.kind = 'reinstate_by_order' THEN
    -- The item whose measure this lifts: reinstated now, and a preservation that runs ends now.
    UPDATE public.legal_order_items i
       SET reinstated_at = now(),
           preserve_ended_at = CASE WHEN i.preserve_until IS NULL THEN i.preserve_ended_at ELSE coalesce(i.preserve_ended_at, now()) END
     WHERE i.action_id = NEW.reverses_action_id
    RETURNING i.* INTO item;
    INSERT INTO public.legal_order_events (order_id, item_id, kind, at, ground, by_staff, via)
    VALUES (item.order_id, item.id, 'reinstated', clock_timestamp(), NEW.order_ground, d.decided_by, 'console');
  END IF;

  -- A reversal that breaks the basis of a standing measure resting on the reviewed decision answers that measure's reply.
  IF NEW.reverses_action_id IS NOT NULL AND d.kind IN ('review', 'correction') THEN
    UPDATE public.suspension_replies r SET answered_by = d.id, answered_at = now()
      FROM public.decision_actions s
     WHERE r.action_id = s.id AND r.answered_by IS NULL AND s.kind IN ('suspend', 'terminate')
       AND d.reviews_decision_id = ANY(s.rests_on) AND public.standing_basis_broken_at(s.id) IS NOT NULL;
  END IF;

  IF NEW.reverses_action_id IS NOT NULL AND d.kind IN ('review', 'correction') THEN
    UPDATE public.intake_items i SET revision_pending_at = now()
     WHERE i.answered_by = d.reviews_decision_id AND EXISTS (SELECT 1 FROM public.decisions r WHERE r.id = d.reviews_decision_id AND r.kind = 'final');
  END IF;

  IF NEW.kind IN ('suspend', 'terminate', 'lift_suspension', 'overrule', 'restrict_reporting', 'lift_reporting')
     OR (NEW.reverses_action_id IS NOT NULL AND d.kind IN ('review', 'correction') AND EXISTS (
           SELECT 1 FROM public.decision_actions s
            WHERE s.subject_account_id = NEW.subject_account_id AND s.kind IN ('suspend', 'terminate', 'restrict_reporting')
              AND d.reviews_decision_id = ANY(s.rests_on))) THEN
    PERFORM public.standing_apply(NEW.subject_account_id);
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint

-- 11. decision_holds, replaced (0025). Everything 0016, 0021 and 0025 say of it stands, stated again in full. What 3f
-- changes:
--   - For an order decision the check of (a) is this, and (b) is "exactly one disable_by_order and no other row": the
--     transaction's head audit row is order_effected on the decision's order, carries a step-up and was written by the
--     deciding account; metadata.decisionIds, an object from item id to decision id, names this decision under its item,
--     and every pair in it names an order decision of this transaction on that item; params without items and urgent
--     equal the order's row under the contracts' names; params.items lists {itemId, postId} for this item with the case's
--     target, has as many entries as decisionIds and at most items_per_action; and for a dsa_art9 order whose
--     verified_at is null (read under the order's row lock, which decisions_record took) params.urgent is true, else
--     order_not_verified, while for every other order it is absent or false, else invalid_decision.
--   - For every other decision the comparison stands. A reinstatement's signed form gains orderGround. When the audit
--     row's metadata holds a member target, it must equal {type, id} of the case's target (invalid_decision otherwise).
--     The two lists of measures gain disable_by_order.
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
  compared := CASE WHEN d.kind = 'review' THEN params - 'actions' ELSE params - 'actions' - 'unfounded' - 'replaced' END;
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
END $$;--> statement-breakpoint

-- 12. appeals_check, replaced (0021). Everything 0017 and 0021 say of it stands, stated again in full. Two changes: an
-- appeal against a decision of the kind order is refused not_appealable before any other test (as built it would be
-- appeal_not_open, which the app words as a window that has closed); and step 4 refuses a decision whose window is null.
-- A decision held with an order's notice has informed_at null until the release, so appeal_deadline is null: as built,
-- NOT (now < null) is null and the IF let the appeal through. Its time to appeal counts from the release.
CREATE OR REPLACE FUNCTION "public"."appeals_check"() RETURNS trigger
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
  -- 3f (row 27): before the other tests, korbat's appeal does not apply to an order's decision.
  IF FOUND AND d.kind = 'order' THEN
    RAISE EXCEPTION 'not_appealable';
  END IF;
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
  -- 3f: a decision held with an order's notice has no informed_at yet, so its window is null and has not opened.
  IF NOT coalesce(clock_timestamp() < public.appeal_deadline(public.appeal_informed_at(d.id)), false) THEN
    RAISE EXCEPTION 'appeal_not_open';
  END IF;

  -- 5.
  IF NOT EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.decision_id = d.id) THEN
    RAISE EXCEPTION 'appeal_not_open';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

-- 13. legal_order_events_confirmed, replaced (0027). Everything 0027 says of it stands. The ledger's events effect_given
-- and reinstated are the deciding account's acts in the console, so they are written by the console, but each belongs to
-- a decision that decision_holds binds to its own audit row (order_effected, case_decided): the check returns for them
-- before it asks for an order_event_recorded or order_corrected row, which their transaction does not write.
CREATE OR REPLACE FUNCTION "public"."legal_order_events_confirmed"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a public.audit_log;
  expected text;
BEGIN
  -- 0028: the ledger's two events, written by decision_actions_apply for the decision that gives effect or reinstates,
  -- are bound to that decision's own audit row by decision_holds; the API role cannot write either (legal_order_events_insert).
  IF NEW.kind IN ('effect_given', 'reinstated') THEN
    RETURN NULL;
  END IF;
  expected := CASE WHEN NEW.kind = 'corrected' THEN 'order_corrected' ELSE 'order_event_recorded' END;
  SELECT l.* INTO a FROM public.audit_head h JOIN public.audit_log l ON l.chain_seq = h.seq WHERE h.id = 1;
  IF NOT FOUND OR a.action IS DISTINCT FROM expected OR a.target_type IS DISTINCT FROM 'order' OR a.target_id IS DISTINCT FROM NEW.order_id::text THEN
    RAISE EXCEPTION 'order_event_refused' USING DETAIL = 'audit: the transaction''s last audit row is not this action on this order.';
  END IF;
  IF a.metadata ->> 'eventId' IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION 'order_event_refused' USING DETAIL = 'eventId: the audit row does not name this event.';
  END IF;
  IF a.actor_id IS DISTINCT FROM NEW.by_staff THEN
    RAISE EXCEPTION 'order_event_refused' USING DETAIL = 'actor: the audit row was written by another account than the event''s.';
  END IF;
  IF a.step_up IS NULL AND (NEW.kind <> 'corrected' OR NEW.ground = 'admin') THEN
    RAISE EXCEPTION 'order_event_refused' USING DETAIL = 'stepUp: the audit row carries no confirmation.';
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint

-- 14. order_correct, replaced (0027). Everything 0027 says of it stands, with one change in step 5: when Section C is set
-- after effect, only the decisions their author was told of are untold again (author_mail other than none, as
-- toldToAuthor reads). As built, a decision that told nobody (a report answered "no breach", whose mail is none) was
-- made untold too, and order_notices_release(), which tells every untold decision, would then have mailed its author.
CREATE OR REPLACE FUNCTION "public"."order_correct"(order_id uuid, facts jsonb, by_staff uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  o public.legal_orders;
  v_new public.legal_orders;
  v_role text;
  v_rule text;
  v_effect boolean;
  v_key text;
  v_item jsonb;
  v_items integer;
  v_posts uuid[];
  v_event uuid;
BEGIN
  SELECT x.* INTO o FROM public.legal_orders x WHERE x.id = order_correct.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF o.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'order_closed';
  END IF;
  SELECT u.role::text INTO v_role FROM auth.users u
   WHERE u.id = order_correct.by_staff AND u.deleted_at IS NULL AND u.role <> 'user' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_confirmation_ended';
  END IF;

  -- The members: only the list's, each of its type, at least one.
  IF order_correct.facts IS NULL OR jsonb_typeof(order_correct.facts) <> 'object' OR order_correct.facts = '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid_request' USING DETAIL = 'facts: an object with at least one member.';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(order_correct.facts) LOOP
    IF v_key NOT IN ('kind', 'memberState', 'authority', 'reference', 'channel', 'sectionC', 'emergency', 'withholdFromAuthor', 'crossBorder', 'closeItems') THEN
      RAISE EXCEPTION 'invalid_request' USING DETAIL = format('facts: %s is not a member a correction takes.', v_key);
    END IF;
    IF (v_key IN ('sectionC', 'emergency', 'withholdFromAuthor', 'crossBorder') AND jsonb_typeof(order_correct.facts -> v_key) <> 'boolean')
       OR (v_key IN ('kind', 'memberState', 'authority', 'reference', 'channel') AND jsonb_typeof(order_correct.facts -> v_key) <> 'string')
       OR (v_key = 'closeItems' AND jsonb_typeof(order_correct.facts -> v_key) <> 'array') THEN
      RAISE EXCEPTION 'invalid_request' USING DETAIL = format('facts: %s has the wrong type.', v_key);
    END IF;
  END LOOP;
  IF order_correct.facts ? 'channel' AND o.message_id IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_request' USING DETAIL = 'channel: an order opened from a message arrived in the mailbox.';
  END IF;

  v_effect := EXISTS (SELECT 1 FROM public.legal_order_items i WHERE i.order_id = o.id AND i.disabled_at IS NOT NULL);
  IF NOT v_effect THEN
    v_rule := 'entry';
  ELSIF order_correct.facts = '{"sectionC": true}'::jsonb THEN
    v_rule := 'caution';
  ELSE
    v_rule := 'admin';
    IF v_role <> 'admin' THEN
      RAISE EXCEPTION 'admin_required';
    END IF;
  END IF;

  IF order_correct.facts ? 'closeItems' THEN
    v_items := 0;
    FOR v_item IN SELECT jsonb_array_elements(order_correct.facts -> 'closeItems') LOOP
      IF jsonb_typeof(v_item) <> 'object' OR coalesce((v_item ->> 'reason') IN ('no_post', 'not_named', 'withdrawn'), false) = false THEN
        RAISE EXCEPTION 'invalid_request' USING DETAIL = 'closeItems: each is an item and one of the three reasons.';
      END IF;
      UPDATE public.legal_order_items i SET closed_at = now(), closed_reason = v_item ->> 'reason'
       WHERE i.id::text = v_item ->> 'itemId' AND i.order_id = o.id AND i.disabled_at IS NULL AND i.closed_at IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid_request' USING DETAIL = 'closeItems: not an open item of this order.';
      END IF;
      v_items := v_items + 1;
    END LOOP;
    IF v_items = 0 THEN
      RAISE EXCEPTION 'invalid_request' USING DETAIL = 'closeItems: at least one item.';
    END IF;
  END IF;

  BEGIN
    UPDATE public.legal_orders x SET
           kind = coalesce(order_correct.facts ->> 'kind', x.kind),
           member_state = coalesce(order_correct.facts ->> 'memberState', x.member_state),
           authority = coalesce(order_correct.facts ->> 'authority', x.authority),
           reference = coalesce(order_correct.facts ->> 'reference', x.reference),
           channel = coalesce(order_correct.facts ->> 'channel', x.channel),
           section_c = coalesce((order_correct.facts ->> 'sectionC')::boolean, x.section_c),
           emergency = coalesce((order_correct.facts ->> 'emergency')::boolean, x.emergency),
           cross_border = coalesce((order_correct.facts ->> 'crossBorder')::boolean, x.cross_border),
           -- The forced columns follow the corrected ones in the same statement, as at the insert: legal_orders_tco is
           -- checked at each row's update, so a kind made a removal order never stands a moment without them.
           withhold_from_author = coalesce((order_correct.facts ->> 'withholdFromAuthor')::boolean, x.withhold_from_author)
                                  OR coalesce(order_correct.facts ->> 'kind', x.kind) = 'tco_removal'
                                  OR coalesce((order_correct.facts ->> 'sectionC')::boolean, x.section_c),
           preserve = coalesce(order_correct.facts ->> 'kind', x.kind) = 'tco_removal'
     WHERE x.id = o.id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'order_exists';
  END;
  -- A statement of its own reads the row as it now stands.
  SELECT x.* INTO v_new FROM public.legal_orders x WHERE x.id = o.id;

  IF v_effect THEN
    -- The posts the order disabled, each with the time of the order's first decision about it.
    IF v_new.section_c AND NOT o.section_c THEN
      UPDATE public.decisions d SET informed_at = NULL, author_mail = 'none'
        FROM (SELECT i.post_id, min(od.decided_at) AS since
                FROM public.legal_order_items i JOIN public.decisions od ON od.order_item_id = i.id
               WHERE i.order_id = o.id AND i.post_id IS NOT NULL
               GROUP BY i.post_id) p, public.cases c
       WHERE c.id = d.case_id AND c.target_type = 'post' AND c.target_id = p.post_id AND d.decided_at >= p.since
         -- 0028: only a decision its author was told of (toldToAuthor's two halves); one that told nobody stays so.
         AND d.author_mail <> 'none' AND d.informed_at IS NOT NULL;
    END IF;
    IF o.section_c AND NOT v_new.section_c
       AND EXISTS (SELECT 1 FROM public.legal_order_items i JOIN public.decisions d ON d.order_item_id = i.id
                    WHERE i.order_id = o.id AND d.informed_at IS NULL) THEN
      UPDATE public.legal_orders x SET hold_ended_at = now(), hold_end_reason = 'not_ordered' WHERE x.id = o.id AND x.hold_ended_at IS NULL;
      INSERT INTO public.legal_order_events (order_id, kind, at, ground, by_staff, via)
      VALUES (o.id, 'hold_ended', clock_timestamp(), 'not_ordered', NULL, 'system');
    END IF;
    IF v_new.preserve AND NOT o.preserve THEN
      UPDATE public.legal_order_items i SET preserve_until = public.order_preserve_until(d.decided_at)
        FROM public.decisions d
       WHERE i.order_id = o.id AND d.id = i.decision_id AND i.preserve_until IS NULL
         AND EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.id = i.action_id);
    ELSIF o.preserve AND NOT v_new.preserve THEN
      INSERT INTO public.legal_order_events (order_id, item_id, kind, at, by_staff, via)
      SELECT o.id, i.id, 'preservation_ended', clock_timestamp(), NULL, 'system'
        FROM public.legal_order_items i
       WHERE i.order_id = o.id AND i.preserve_until IS NOT NULL AND i.preserve_ended_at IS NULL;
      UPDATE public.legal_order_items i SET preserve_ended_at = now()
       WHERE i.order_id = o.id AND i.preserve_until IS NOT NULL AND i.preserve_ended_at IS NULL;
    END IF;
    IF v_new.withhold_from_author IS DISTINCT FROM o.withhold_from_author THEN
      UPDATE public.decision_actions a SET withhold_author = v_new.withhold_from_author
        FROM public.legal_order_items i
       WHERE i.order_id = o.id AND a.id = i.action_id
         AND EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.id = a.id);
      SELECT array_agg(i.post_id ORDER BY i.post_id) INTO v_posts
        FROM public.legal_order_items i
       WHERE i.order_id = o.id AND i.post_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.id = i.action_id);
      IF v_posts IS NOT NULL THEN
        PERFORM public.moderation_apply(v_posts, true);
      END IF;
    END IF;
  END IF;

  INSERT INTO public.legal_order_events (order_id, kind, at, ground, by_staff, via)
  VALUES (o.id, 'corrected', clock_timestamp(), v_rule, order_correct.by_staff, 'console')
  RETURNING id INTO v_event;
  RETURN v_event;
END $$;--> statement-breakpoint

-- 15. alert_steps(), replaced from its text in 0027_orders with the row marked 0026 in section 6.1: hold_ending. Every
-- other line is 0027's, unchanged.
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

  RETURN v_written;
END $$;--> statement-breakpoint

-- 16. order_notices_release(): the writer of a decision's informed_at after its insert (the only other one is
-- order_correct, which can only untell). The dispatch round calls it, every ten minutes, before it mails statements. It
-- answers how many decisions it told, in both of its steps. In this order:
--   1. The rows of the orders that have an untold order decision, FOR SHARE in id order: a hold's end, an extension and
--      a correction either commit before this reads them or wait for it.
--   2. In a statement of its own, the untold order decisions whose order holds nothing (order_hold_until is null) or
--      whose hold has ended (order_hold_until(order) <= clock_timestamp()), FOR UPDATE in id order. Each gets
--      informed_at = clock_timestamp(), read after the test, so the stored time is never before the end (now(), the
--      transaction's start, could be), and the mail pending; its item gets the event notice_released, by the system.
--   3. In a statement of its own, which runs in every call, also when step 2 told nothing: every untold decision that is
--      not an order decision (the correction of one, or a decision of korbat's own that decisions_record held), on a
--      post case whose target has no untold order decision any more, gets the same two values. So a reinstatement that
--      committed beside a release is told by the next round at the latest, and a held decision of korbat's own waits for
--      every order decision about its post, also one whose measure was lifted meanwhile, since its statement may name
--      "another decision".
-- A notice released to an account that no longer exists is set pending like any other; the mailer then has no address
-- for it and gives it up.
CREATE FUNCTION "public"."order_notices_release"() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r record;
  told integer := 0;
BEGIN
  PERFORM 1 FROM public.legal_orders o
   WHERE EXISTS (SELECT 1 FROM public.legal_order_items i JOIN public.decisions d ON d.order_item_id = i.id
                  WHERE i.order_id = o.id AND d.kind = 'order' AND d.informed_at IS NULL)
   ORDER BY o.id FOR SHARE;
  FOR r IN
    SELECT d.id, i.id AS item_id, i.order_id
      FROM public.decisions d JOIN public.legal_order_items i ON i.id = d.order_item_id
     WHERE d.kind = 'order' AND d.informed_at IS NULL
       AND coalesce(public.order_hold_until(i.order_id) <= clock_timestamp(), true)
     ORDER BY d.id
       FOR UPDATE OF d
  LOOP
    UPDATE public.decisions x SET informed_at = clock_timestamp(), author_mail = 'pending' WHERE x.id = r.id;
    INSERT INTO public.legal_order_events (order_id, item_id, kind, at, by_staff, via)
    VALUES (r.order_id, r.item_id, 'notice_released', clock_timestamp(), NULL, 'system');
    told := told + 1;
  END LOOP;
  FOR r IN
    SELECT d.id
      FROM public.decisions d JOIN public.cases c ON c.id = d.case_id
     WHERE d.kind <> 'order' AND d.informed_at IS NULL AND c.target_type = 'post'
       AND NOT EXISTS (SELECT 1 FROM public.decisions od JOIN public.cases oc ON oc.id = od.case_id
                        WHERE od.kind = 'order' AND od.informed_at IS NULL AND oc.target_type = 'post' AND oc.target_id = c.target_id)
     ORDER BY d.id
       FOR UPDATE OF d
  LOOP
    UPDATE public.decisions x SET informed_at = clock_timestamp(), author_mail = 'pending' WHERE x.id = r.id;
    told := told + 1;
  END LOOP;
  RETURN told;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."order_notices_release"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."order_notices_release"() TO korbat_api;

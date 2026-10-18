-- What the review of 3f as built upheld, in the database (3f design, section 19). Written by hand: this migration
-- changes no table.

-- 1. legal_order_events_ground, written by drizzle from the schema (3f's review, people2): a texts_recorded event names the
-- one of the authority's three texts it wrote (reasons, redress or scope) as its ground, so the notice can say since
-- when it holds the reasons; an event written before this migration keeps its null ground, which the last clause allows.
ALTER TABLE "legal_order_events" DROP CONSTRAINT "legal_order_events_ground";--> statement-breakpoint
ALTER TABLE "legal_order_events" ADD CONSTRAINT "legal_order_events_ground" CHECK ((kind = 'annex3_sent' and ground in ('force_majeure', 'manifest_error', 'insufficient_information')) or (kind = 'closed_without_effect' and ground in ('withdrawn', 'annulled', 'scrutiny', 'not_authentic', 'wrong_item', 'not_addressed')) or (kind = 'corrected' and ground in ('entry', 'caution', 'admin')) or (kind = 'reinstated' and ground in ('withdrawn', 'annulled', 'scrutiny', 'not_authentic', 'wrong_item')) or (kind = 'hold_ended' and ground in ('not_authentic', 'annulled', 'released_by_authority', 'not_ordered')) or (kind = 'scrutiny_decided' and ground in ('upheld', 'annulled')) or (kind = 'texts_recorded' and ground in ('reasons', 'redress', 'scope')) or (kind not in ('annex3_sent', 'closed_without_effect', 'corrected', 'reinstated', 'hold_ended', 'scrutiny_decided') and ground is null));--> statement-breakpoint

-- 2. active_strikes, replaced (0021): a strike counts only once its decision is told (informed_at set). A decision held
-- with an order's notice counts nowhere its author can see (Cases' "Your standing", /api/me, the export) and, through
-- the ladder's count below, supports no measure; the release tells it, and it counts from then until its own end.
-- Everything 0021 says of the view stands. CREATE OR REPLACE keeps its grants; korbat_api reads decisions already.
CREATE OR REPLACE VIEW "public"."active_strikes" WITH (security_invoker = true) AS
SELECT a.id AS action_id, a.subject_account_id AS account_id, a.decision_id, a.created_at, a.ends_at
  FROM public.decision_actions a
 WHERE a.kind::text = 'strike'
   AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = a.id)
   AND a.ends_at > clock_timestamp()
   AND EXISTS (SELECT 1 FROM public.decisions d WHERE d.id = a.decision_id AND d.informed_at IS NOT NULL);--> statement-breakpoint

-- 3. decision_actions_check, replaced (0028). Everything 0016, 0021, 0025 and 0028 say of it stands, stated again in
-- full, with one change in step 9a.3 and 9a.4: each basis of a measure at once (protective, terrorist, threat, and the
-- newer threat of threat_repeat) takes only a decision its subject has been told of (informed_at set), as the ladder's
-- count does through active_strikes. A measure resting on a decision held with an order's notice would tell the author,
-- at once and on the account's case, what the hold keeps from them; with no other basis it fails with the errors it has.
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
           AND x.informed_at IS NOT NULL
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
           AND x.informed_at IS NOT NULL
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
           AND x.informed_at IS NOT NULL
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
           AND x.informed_at IS NOT NULL
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

-- 4. order_correct, replaced (0028). Everything 0027 and 0028 say of it stands, stated again in full, with three changes:
--   - (database4) it takes the order's items in post order before the order's row, and the row FOR NO KEY UPDATE, so
--     it takes its locks in the effect's order (section 5): as built it held the row FOR UPDATE and then waited for an
--     item the effect held, while the effect waited for the row, and one of the two was ended by a deadlock;
--   - (database1) when Section C becomes true, a hold ended as not_ordered is no longer ended;
--   - (database2) when the preservation becomes owed again, an item whose preservation ended without an erasure while
--     its measure stands is preserved again, from its decision, as a first one is.
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
  -- 0032 (database4): the order's items first, in post order, as the effect holds them before it reads the order's row
  -- FOR SHARE (section 5, items 1 and 2): a correction that waits for an item an effect holds then holds nothing that
  -- effect waits for. The row itself FOR NO KEY UPDATE, which an event's insert does not wait for (its foreign key takes
  -- the row FOR KEY SHARE), so order_preservation_end, which holds an item and then inserts its event, never waits here.
  PERFORM 1 FROM public.legal_order_items i WHERE i.order_id = order_correct.order_id ORDER BY i.post_id, i.id FOR NO KEY UPDATE;
  SELECT x.* INTO o FROM public.legal_orders x WHERE x.id = order_correct.order_id FOR NO KEY UPDATE;
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

  -- 0032 (database1): "must not be told" set again holds again, given effect or not. The end korbat recorded as its own
  -- mistake (not_ordered) when Section C was unset is no end once Section C stands again: order_hold_until would answer
  -- that past end, the release would tell the author at its next round, and every later disabling would be told at once.
  -- An end of any other reason (the authority's, a court's) stands.
  IF v_new.section_c AND NOT o.section_c AND v_new.hold_end_reason IS NOT DISTINCT FROM 'not_ordered' THEN
    UPDATE public.legal_orders x SET hold_ended_at = NULL, hold_end_reason = NULL WHERE x.id = o.id;
  END IF;

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
      -- 0032 (database2): also an item whose preservation an earlier correction to another kind ended while its measure
      -- stands and nothing was erased (the post's erased_at null): the preservation is owed again (TCO Art. 6), from the
      -- same decision, and the end is cleared. A reinstated item's measure no longer stands, and an erased post stays so.
      UPDATE public.legal_order_items i SET preserve_until = public.order_preserve_until(d.decided_at), preserve_ended_at = NULL
        FROM public.decisions d, public.posts p
       WHERE i.order_id = o.id AND d.id = i.decision_id AND p.id = i.post_id
         AND (i.preserve_until IS NULL OR (i.preserve_ended_at IS NOT NULL AND p.erased_at IS NULL))
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

-- 5. erase_authority_records(), replaced (0030). Everything 0030 says of it stands, stated again in full, with one change:
-- a record is kept while any seal that seal_report attributes to it is in force, not only the seal whose id it holds.
CREATE OR REPLACE FUNCTION "public"."erase_authority_records"() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r record;
  v_cut timestamptz;
  v_rows integer;
  v_deleted integer := 0;
BEGIN
  SELECT * INTO r FROM public.order_rules();
  v_cut := now() - make_interval(years => r.record_keep_years);

  DELETE FROM public.authority_notifications n
   WHERE greatest(n.opened_at, n.sent_at, n.answered_at, n.closed_at,
                  (SELECT max(greatest(e.at, e.occurred_at)) FROM public.authority_notification_events e WHERE e.notification_id = n.id)) < v_cut
     -- 0032 (database3): no seal in force that seal_report would answer with this record: the seal that opened it, or
     -- a seal of its account taken while it was open (a seal for good after the one taken while deciding), the window
     -- seal_report reads. As built only the first seal kept it, and a seal for good still in force lost its record.
     AND NOT EXISTS (SELECT 1 FROM public.measures_in_force m JOIN public.decision_actions a ON a.id = m.id
                      WHERE m.id = n.seal_action_id
                         OR (m.kind::text = 'seal_media' AND n.opened_via = 'system' AND a.subject_account_id = n.account_id
                             AND n.opened_at <= a.created_at AND (n.closed_at IS NULL OR n.closed_at >= a.created_at)))
     AND NOT EXISTS (SELECT 1 FROM public.authority_notification_events e
                      WHERE e.notification_id = n.id AND e.not_to_person AND (e.not_to_person_until IS NULL OR e.not_to_person_until > now()));
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_deleted := v_deleted + v_rows;

  DELETE FROM public.productions p
   WHERE greatest(p.opened_at, p.delivered_at, p.destroyed_at) < v_cut
     AND (p.files IS NULL OR p.destroyed_at IS NOT NULL)
     AND (p.not_to_person_until IS NULL OR p.not_to_person_until <= now());
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_deleted := v_deleted + v_rows;

  DELETE FROM auth.report_holds h
   WHERE (h.released_at IS NOT NULL OR h.set_at + make_interval(days => r.report_hold_days) <= now())
     AND NOT EXISTS (SELECT 1 FROM public.authority_notifications n WHERE n.account_id = h.user_id);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_deleted := v_deleted + v_rows;
  RETURN v_deleted;
END $$;--> statement-breakpoint

-- 6. decisions_record, replaced (0028). Everything 0016, 0017, 0021 and 0028 say of it stands, stated again in full, with
-- one change in step 10.2: an order decision is held when its own order holds the notice, or when another order's
-- notice about the same post is held (order_notice_held). As built a second order on a post whose notice another order
-- held was told at once, and its notice told the author that another decision already kept the post from being shown.
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
    -- 0032 (database5): also held while another order's notice about this post is held (order_notice_held, a read
    -- after the case's lock): the notice of a second order would tell the author of the first, held one.
    held := coalesce(public.order_hold_until(o.id) > now(), false) OR public.order_notice_held(c.target_id);
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

-- 7. order_notices_release(), replaced (0028). Everything 0028 says of it stands, stated again in full, with one change
-- in step 2: an untold order decision whose own order holds nothing any more is told only when no other untold order
-- decision about the same post, with its measure in force, is still held by its own order's hold; both are then told in
-- the same call.
CREATE OR REPLACE FUNCTION "public"."order_notices_release"() RETURNS integer
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
       -- 0032 (database5): and no other untold order decision about the same post, its measure in force, is still held
       -- by its own order's hold: an order decision held by another order's notice waits for that one, and goes with it.
       AND NOT EXISTS (SELECT 1 FROM public.decisions od JOIN public.legal_order_items oi ON oi.id = od.order_item_id
                        WHERE od.kind = 'order' AND od.informed_at IS NULL AND od.id <> d.id AND oi.post_id = i.post_id
                          AND EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.decision_id = od.id AND m.kind::text = 'disable_by_order')
                          AND coalesce(public.order_hold_until(oi.order_id) > clock_timestamp(), false))
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

-- 8. auth.address_hold_told(account), new (access3): whether a deletion's mail may print the hold's paragraph. The
-- address stays held whatever this answers (auth.address_held); the paragraph, which says that korbat has sealed
-- images of the account, goes only when no seal that holds it is untold: no seal_media of the account, in force or
-- named by one of its records, whose decision is held with an order's notice (informed_at null). Otherwise the mail
-- goes in the one wording for every account, which says no more than the person was told (7.15). A hold with no seal
-- behind it reads as told. As the auth module's other three reads: definer, the auth role alone may call it.
CREATE OR REPLACE FUNCTION "auth"."address_hold_told"(account uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.decision_actions a JOIN public.decisions d ON d.id = a.decision_id
     WHERE a.kind::text = 'seal_media' AND a.subject_account_id = address_hold_told.account AND d.informed_at IS NULL
       AND (EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.id = a.id)
            OR EXISTS (SELECT 1 FROM public.authority_notifications n WHERE n.seal_action_id = a.id)))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth"."address_hold_told"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth"."address_hold_told"(uuid) TO korbat_auth;--> statement-breakpoint

-- What the review of account sanctions as built upheld, in the database (3e design, section 19; the design names no
-- migration for it). Written by hand: this migration changes no table. It replaces one view and four functions, each
-- stated whole from its newest text (CREATE OR REPLACE keeps each one's owner, grants and trigger), and back-fills the
-- tallies of reports sent before the reporting counts' migration (0022) existed.
--
-- As in 0016 to 0024: every function is owned by the migrator, pins its search path, names every object schema-qualified
-- and has EXECUTE taken from PUBLIC; errors carry their code as the message under SQLSTATE P0001; times the database
-- writes are now(), the transaction's start; a read that must see what committed while a lock waited is a statement of
-- its own after that lock. No statement here names a value that 3e's schema migration added to action_kind outside a
-- PL/pgSQL body, and every number is read from standing_rules(), never typed as an interval (enum-literals.test.ts,
-- standing-grants.test.ts).
--
-- 1. A mark counts only once its item's outcome is released (intake_items.outcome_sent_at is set): before the daily
-- release the person cannot read the mark, nor ask for a re-examination of it, so no warning or restriction may rest on
-- it (3e design, section 7.9 step 3). reporting_record, replaced (0022), counts and lists only such marks; everything
-- 0022 says of it stands. decision_actions_check, replaced (0021), counts the marked reports sent since the warning, for a
-- restriction, by the same rule; everything 0021 says of it stands, stated again in full.
CREATE OR REPLACE VIEW "public"."reporting_record" WITH (security_invoker = true) AS
WITH frame AS (SELECT (now() AT TIME ZONE 'UTC')::date - k.report_frame_days AS before FROM public.standing_rules() k)
SELECT a.account_id,
       coalesce((SELECT sum(t.reports) FROM public.report_tallies t WHERE t.account_id = a.account_id AND t.day > f.before), 0)::integer AS reports,
       (SELECT count(DISTINCT m.intake_id) FROM public.unfounded_marks m
         WHERE m.account_id = a.account_id AND m.withdrawn_by IS NULL AND (m.reported_at AT TIME ZONE 'UTC')::date > f.before
           AND EXISTS (SELECT 1 FROM public.intake_items o WHERE o.id = m.item_id AND o.outcome_sent_at IS NOT NULL)
           AND NOT EXISTS (SELECT 1 FROM public.intake_items x WHERE x.reexamines_item_id = m.item_id AND x.outcome IN ('restricted_rule', 'restricted_legal')))::integer AS unfounded
  FROM frame f,
       LATERAL (SELECT t.account_id FROM public.report_tallies t WHERE t.day > f.before
                UNION
                SELECT m.account_id FROM public.unfounded_marks m WHERE m.withdrawn_by IS NULL AND (m.reported_at AT TIME ZONE 'UTC')::date > f.before
                   AND EXISTS (SELECT 1 FROM public.intake_items o WHERE o.id = m.item_id AND o.outcome_sent_at IS NOT NULL)) a;--> statement-breakpoint
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
  IF NEW.kind IN ('withhold', 'remove', 'restore', 'withhold_media', 'remove_media', 'restore_media') THEN
    NEW.post_id := c.target_id;
  END IF;
  is_measure := NEW.kind IN ('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio',
                             'strike', 'suspend', 'terminate', 'retire_handle', 'warn_reporting', 'restrict_reporting');

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
            ELSE NOT is_measure END) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A decision of this kind does not hold this measure or reversal.';
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

  -- 8. The subject's row is held FOR SHARE since decisions_record, so the lock order holds.
  IF is_measure AND public.account_is_staff(subject) AND d.kind <> 'interim' THEN
    RAISE EXCEPTION 'staff_target';
  END IF;

  -- 9. The deciding account's row is held FOR SHARE since decisions_record; this reads the same row again.
  IF NEW.kind = 'unseal_media' THEN
    UPDATE public.decisions x SET needs_admin = true WHERE x.id = d.id;
    SELECT u.role::text INTO decider_role FROM auth.users u WHERE u.id = d.decided_by FOR SHARE;
    IF decider_role IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'admin_required';
    END IF;
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
        NEW.no_effect := CASE WHEN post_level = 'removed' THEN 'already' END;
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
      UPDATE public.decisions x
         SET ended_interim = true, author_mail = CASE WHEN x.author_mail = 'none' THEN 'pending'::public.delivery_state ELSE x.author_mail END
       WHERE x.id = d.id;
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
-- 2. decision_holds, replaced (0021). Everything 0016 and 0021 say of it stands, stated again in full. Added: a stored
-- replaced = true (a withdrawal of an announced measure for another) is accepted only when the deciding account is an
-- admin (admin_required otherwise), read from its auth row, which decisions_record already holds FOR SHARE.
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
BEGIN
  -- The row as it stands now: later triggers of its transaction may have marked it since its insert.
  SELECT x.* INTO d FROM public.decisions x WHERE x.id = decision_holds.decision;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT l.* INTO a FROM public.audit_head h JOIN public.audit_log l ON l.chain_seq = h.seq WHERE h.id = 1;
  IF NOT FOUND OR a.metadata ->> 'decisionId' IS DISTINCT FROM d.id::text THEN
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
  SELECT coalesce(jsonb_agg(CASE WHEN x.announced IS NULL THEN jsonb_build_object('kind', x.kind, 'mediaId', x.media_id)
                                 ELSE jsonb_build_object('kind', x.kind, 'mediaId', x.media_id, 'days', x.days, 'announced', x.announced) END), '[]'::jsonb),
         count(*) FILTER (WHERE x.kind IN ('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio',
                                           'strike', 'suspend', 'terminate', 'retire_handle', 'warn_reporting', 'restrict_reporting')),
         count(*) FILTER (WHERE x.kind NOT IN ('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio',
                                               'strike', 'suspend', 'terminate', 'retire_handle', 'warn_reporting', 'restrict_reporting')),
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
-- 3. suspension_replies_check, replaced (0021). Everything 0021 says of it stands, stated again in full. Added to step 4:
-- reply_not_open when the account's auth row is marked deleted. The take-down marks it in the auth module's own
-- transaction while it holds the profile FOR UPDATE, and this step runs after the profile's lock, so a reply that waited
-- behind the take-down sees its commit and is refused; the profile itself is marked deleted only by the purge after it.
CREATE OR REPLACE FUNCTION "public"."suspension_replies_check"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  measure public.decision_actions;
  period_start timestamptz;
  period_end timestamptz;
BEGIN
  -- 1.
  NEW.answered_by := NULL;
  NEW.answered_at := NULL;
  NEW.erased_at := NULL;
  -- 2.
  SELECT a.* INTO measure FROM public.decision_actions a WHERE a.id = NEW.action_id;
  IF NOT FOUND OR measure.kind NOT IN ('suspend', 'terminate') OR measure.subject_account_id IS DISTINCT FROM NEW.account_id THEN
    RAISE EXCEPTION 'reply_not_open';
  END IF;
  -- 3.
  PERFORM 1 FROM public.profiles p WHERE p.id = NEW.account_id FOR UPDATE;
  -- 4.
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.account_id AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'reply_not_open';
  END IF;
  -- 0025: an account the take-down took down is marked deleted in auth first; its profile only by the purge after it.
  IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.account_id AND u.deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'reply_not_open';
  END IF;
  IF EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = measure.id) THEN
    RAISE EXCEPTION 'reply_not_open';
  END IF;
  IF public.standing_basis_broken_at(measure.id) IS NOT NULL THEN
    RAISE EXCEPTION 'reply_not_open';
  END IF;
  IF EXISTS (SELECT 1 FROM public.suspension_replies r WHERE r.action_id = measure.id) THEN
    RAISE EXCEPTION 'reply_not_open';
  END IF;
  -- 5.
  SELECT p.starts_at, p.ends_at INTO period_start, period_end FROM public.suspension_periods p WHERE p.action_id = measure.id;
  NEW.filed_at := clock_timestamp();
  IF period_end IS NOT NULL AND period_end <= NEW.filed_at THEN
    RAISE EXCEPTION 'reply_not_open';
  END IF;
  NEW.on_time := period_start IS NULL OR NEW.filed_at < period_start;
  RETURN NEW;
END $$;--> statement-breakpoint
-- 4. erase_reply_statements, replaced (0024). Everything 0024 says of it stands, stated again in full. Added: an answered
-- reply's text also goes once the decision of the measure it replied to holds nothing in force (measures_in_force), the
-- moment an appeal of it is no longer open (appeals_check), so a text is never kept for an appeal that cannot come.
CREATE OR REPLACE FUNCTION "public"."erase_reply_statements"() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n integer;
BEGIN
  PERFORM 1
     FROM public.suspension_replies r
     JOIN public.decision_actions a ON a.id = r.action_id
    WHERE r.statement IS NOT NULL AND r.answered_at IS NOT NULL
      AND (public.decision_final_at(a.decision_id) <= now() OR NOT EXISTS (SELECT 1 FROM public.measures_in_force f WHERE f.decision_id = a.decision_id))
    ORDER BY r.action_id
      FOR UPDATE OF r;
  UPDATE public.suspension_replies r SET statement = NULL, statement_salt = NULL, erased_at = now()
    FROM public.decision_actions a
   WHERE a.id = r.action_id AND r.statement IS NOT NULL AND r.answered_at IS NOT NULL
     AND (public.decision_final_at(a.decision_id) <= now() OR NOT EXISTS (SELECT 1 FROM public.measures_in_force f WHERE f.decision_id = a.decision_id));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;--> statement-breakpoint
-- 5. The tallies of the signed-in reports under a rule that korbat received within the frame before 0022 existed: its
-- trigger counts only the reports received after it, so a mark set on such a report afterwards would count on one side
-- of reporting_record only. Each account's tally of each UTC day within report_frame_days is set to at least the number
-- of such reports it sent that day, which is what report_tallies_count would have written. The larger of the two is kept,
-- so a database whose trigger already counted some of them (one that ran 0022 before this migration) counts none twice,
-- and running it again changes nothing.
INSERT INTO "public"."report_tallies" AS t (account_id, day, reports)
SELECT n.reporter_id, (n.received_at AT TIME ZONE 'UTC')::date, count(*)::integer
  FROM public.intakes n CROSS JOIN public.standing_rules() k
 WHERE n.kind = 'user' AND n.reporter_id IS NOT NULL AND NOT n.alleges_illegal AND NOT n.csam
   AND (n.received_at AT TIME ZONE 'UTC')::date > (now() AT TIME ZONE 'UTC')::date - k.report_frame_days
 GROUP BY n.reporter_id, (n.received_at AT TIME ZONE 'UTC')::date
ON CONFLICT (account_id, day) DO UPDATE SET reports = greatest(t.reports, excluded.reports);

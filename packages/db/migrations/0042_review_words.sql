-- Written by hand (3d design, sections 6.4, 6.7 and 7.12; W.2 and W.5), the second half of the fixes one adversarial
-- review of the built code upheld (Task 10, the words and the proofs). Two rulings need the database: L9, an objection
-- to a refused upload stays open during a no_report end's delay, which the guard states; and L13, the yearly
-- edition's table of uploads prints its total line. As in 0016 to 0041: every function is owned by the migrator, pins
-- its search path to public and pg_temp, names every object schema-qualified and keeps EXECUTE taken from PUBLIC (a
-- replaced function keeps its grants); an error carries its code as the message under SQLSTATE P0001; enum values are
-- compared as text, and no function holds an interval literal. Each replaced function is written in full from its
-- newest text, which is named at each, with the changes named there and no other.

-- 1. upload_refusals_guard, plain, replaced from its text in 0039_known_material (review L9): an objection is open while
-- the refusal has none, is not released, and has not ended as no_report or ended so within its delay of no_report_hours
-- (ended_at plus automation_rules().no_report_hours, the instant the API tells the uploader of that end): one rule for
-- the guard, the route's statement, the app's control and the notice's paragraph. Everything else is 0039's.
CREATE OR REPLACE FUNCTION "public"."upload_refusals_guard"() RETURNS trigger
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
    -- Review L9: an end as no_report closes the objection only once its delay of no_report_hours has passed, the
    -- moment the uploader is told of it; within the delay a second admin may still end it as report.
    IF OLD.objection IS NOT NULL OR OLD.objected_at IS NOT NULL OR OLD.release_id IS NOT NULL OR NEW.objection IS NULL
       OR (OLD.end_as IS NOT DISTINCT FROM 'no_report'
           AND OLD.ended_at + make_interval(hours => (SELECT r.no_report_hours FROM public.automation_rules() r)) <= now()) THEN
      RAISE EXCEPTION 'objection_not_open';
    END IF;
    NEW.objected_at := now();
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

-- 2. transparency_figures, replaced from its text in 0041_review (review L13): the uploads' table begins with the row
-- refused, the year's refusals by refused_at banded by themselves, then the fates folded as before. Everything else is
-- 0041's.
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
  v_refused bigint;
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
  -- Review L13: the table's first line is its total, the year's refusals ("Uploads refused on a match"), banded by
  -- itself and never folded with the fates, so that a total under the floor is not counted twice in other; a year
  -- without a refusal keeps its empty table.
  SELECT count(*) INTO v_refused FROM public.upload_refusals u WHERE u.refused_at >= v_from AND u.refused_at < v_to;
  v_figures := v_figures || jsonb_build_object('uploads',
    CASE WHEN v_refused > 0 THEN jsonb_build_array(jsonb_build_object('label', 'refused', 'count', public.band(v_refused))) ELSE '[]'::jsonb END
    || public.transparency_fold((
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

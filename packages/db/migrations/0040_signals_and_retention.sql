-- Written by hand (3d design, sections 2 rows 33, 37 and 47, 6.8, 6.9, 6.10, 7.13 and 7.14; Task 8), through
-- generate:custom: it changes no table, so a second generate prints "No schema changes". The design numbers this migration
-- 0037; earlier tasks of 3d added migrations the design did not foresee (3f ended at 0032), so it is 0040.
-- As in 0016 to 0039: every function is owned by the migrator, pins its search path to public and pg_temp, names every
-- object schema-qualified and has EXECUTE taken from PUBLIC; an error carries its code as the message under SQLSTATE
-- P0001. Neither function names a value that 0038 added to intake_kind or intake_channel, as an enum literal or as text
-- (the stricter form of the enum-literal rule, which enum-literals.test.ts reads this file under), and neither holds an
-- interval literal or a number of automation_rules(): case_flag's four numbers are its own, and erase_automation_records
-- reads match_keep_days from automation_rules().

-- 1. case_flag(case_id): the flag "possible coordinated reporting" (row 47, 7.13), computed at read from rows 3c already
-- keeps, STABLE, a definer, EXECUTE to the API's role alone. In this order:
--   1. the case's unanswered items of signed-in reporters (intake_items with answered_by null and reporter_account_id not
--      null), each with its created_at. An item whose reporter retention forgot (forget_reporter, C 6.4) has none, and a
--      signed-out notice never had one, so neither counts: the flag goes dark by itself;
--   2. among the windows of window_minutes that begin at one of those items (from the item's time, up to but not
--      including the window's end), the one with the most distinct reporters, then the most items, then the earliest;
--      `items` and `reporters` are its two counts (0 and 0 when there is none);
--   3. `coordinated` is true when items is at least min_items, reporters is at least min_reporters, and at least
--      linked_share of those reporters follow, or are followed by, another of them (public.follows).
-- Its four numbers are constants of this function, in the CTE `rules`, mirrored by the contracts' SIGNAL_RULES (a test
-- reads them from the function's text and holds them to it). It answers counts and never a reporter: the reporters'
-- array never leaves the statement. It keeps nothing, and no function, view, index or decision names it: the API calls
-- it from the queue's read and the case answer's read alone (row 48).
CREATE FUNCTION "public"."case_flag"(case_id uuid) RETURNS TABLE (coordinated boolean, items integer, reporters integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH rules AS (
    SELECT 5 AS min_items, 5 AS min_reporters, 60 AS window_minutes, 0.5::numeric AS linked_share
  ), open_items AS (
    SELECT i.reporter_account_id AS reporter, i.created_at
      FROM public.intake_items i
     WHERE i.case_id = case_flag.case_id AND i.answered_by IS NULL AND i.reporter_account_id IS NOT NULL
  ), windows AS (
    SELECT w.start, count(*)::integer AS items, count(DISTINCT o.reporter)::integer AS reporters, array_agg(DISTINCT o.reporter) AS who
      FROM (SELECT DISTINCT x.created_at AS start FROM open_items x) w
      CROSS JOIN rules r
      JOIN open_items o ON o.created_at >= w.start AND o.created_at < w.start + make_interval(mins => r.window_minutes)
     GROUP BY w.start
  ), best AS (
    SELECT b.items, b.reporters, b.who FROM windows b ORDER BY b.reporters DESC, b.items DESC, b.start LIMIT 1
  ), linked AS (
    SELECT count(*)::integer AS n
      FROM best b CROSS JOIN LATERAL unnest(b.who) AS r(id)
     WHERE EXISTS (SELECT 1 FROM public.follows f
                    WHERE (f.follower_id = r.id AND f.followee_id = ANY (b.who) AND f.followee_id <> r.id)
                       OR (f.followee_id = r.id AND f.follower_id = ANY (b.who) AND f.follower_id <> r.id))
  )
  SELECT coalesce(b.items >= r.min_items AND b.reporters >= r.min_reporters AND l.n >= r.linked_share * b.reporters, false),
         coalesce(b.items, 0),
         coalesce(b.reporters, 0)
    FROM rules r LEFT JOIN best b ON true LEFT JOIN linked l ON true
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."case_flag"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."case_flag"(uuid) TO korbat_api;--> statement-breakpoint

-- 2. erase_automation_records(): the retention job's step automation_records (6.8, 6.10, 7.14), called in every round,
-- a definer, EXECUTE to the API's role alone. It answers how many rows it changed. The guards of media_matches and
-- upload_refusals let the migrator through (0039), which is who this function runs as. In this order:
--   1. Match records. A record of media_matches gets hash and classification null and erased_at when match_keep_days
--      have passed since its anchor: for a refusal's record, the release of the refusal or its end as no_report (an
--      unended hold, or one ended as report and not released, keeps it); for a record with a case, the release of the
--      case's post when it is in release_posts, else the case's closing, and never while a seal for good in force lists a
--      post of the case, or the case's own post, that is not in release_posts; and with neither (a flagged upload that
--      was never posted), its queried_at. So a post's record and an upload's end the same way: the hash of a file korbat
--      released goes match_keep_days after the release, as the terms' list says. Then every refusal whose record is
--      erased loses its owner_id and its objection (review ruling 6): its row stays with its times, its end and its
--      release, and names nobody.
--   2. Objections. An automated_objections row gets text null and erased_at once its decision's texts are due by 3c's
--      schedule: the test of erase_statement_texts (0018), applied by calling it, which raises not_due until the
--      decision's subject account has been deleted for 3c's months. A decision without a decider has no text of its own,
--      so the call erases nothing and only answers whether the decision's texts are due. Only an objection whose subject
--      is deleted at all is tried.
--   3. Signals, once handled. A signal that no statement reads (one handled as gone, which has neither an item nor a
--      decision) is deleted: a match's once its record is erased, a score's match_keep_days after it was handled. A
--      signal that a statement reads (it names a decision, or its finding's item) is the record of the automated means
--      that decision's statement prints, and the statement reads it at every render (DecisionStatement.signal): it is
--      deleted under the same conditions (a match's record erased; a score's intake erased) and only once the texts of
--      its case's decisions are due, by the same test as the objections. The sweep reads a match's handled mark on the
--      record itself (review ruling 8), so no deletion here can make it act twice.
-- It never touches releases, release_posts, release_leaves, release_notices or quarantine_files: it reads the first two
-- for a release's time and writes none of them. The forgetting of hashes and scores once a tool is off is not here: it is
-- the media module's two statements in the same round (section 5).
CREATE FUNCTION "public"."erase_automation_records"() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_keep interval;
  v_changed integer := 0;
  v_rows integer;
  v_id uuid;
  v_decision uuid;
  v_due boolean;
BEGIN
  SELECT make_interval(days => a.match_keep_days) INTO v_keep FROM public.automation_rules() a;

  -- 1. Match records, then the refusals whose record is erased.
  UPDATE public.media_matches m SET hash = NULL, classification = NULL, erased_at = now()
   WHERE m.erased_at IS NULL
     AND CASE
           WHEN EXISTS (SELECT 1 FROM public.upload_refusals u WHERE u.match_id = m.id) THEN
             (SELECT coalesce((SELECT r.released_at FROM public.releases r WHERE r.id = u.release_id),
                              CASE WHEN u.end_as = 'no_report' THEN u.ended_at END)
                FROM public.upload_refusals u WHERE u.match_id = m.id ORDER BY u.refused_at DESC LIMIT 1) <= now() - v_keep
           WHEN m.case_id IS NOT NULL THEN
             (SELECT coalesce((SELECT r.released_at FROM public.release_posts p JOIN public.releases r ON r.id = p.release_id
                                WHERE c.target_type = 'post' AND p.post_id = c.target_id),
                              c.closed_at)
                FROM public.cases c WHERE c.id = m.case_id) <= now() - v_keep
             AND NOT EXISTS (SELECT 1 FROM public.seal_posts s JOIN public.measures_in_force f ON f.id = s.action_id
                              WHERE f.kind = 'seal_media' AND f.decision_kind <> 'interim'
                                AND (f.case_id = m.case_id
                                     OR s.post_id = (SELECT c.target_id FROM public.cases c WHERE c.id = m.case_id AND c.target_type = 'post'))
                                AND NOT EXISTS (SELECT 1 FROM public.release_posts p WHERE p.post_id = s.post_id))
           ELSE m.queried_at <= now() - v_keep
         END;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_changed := v_changed + v_rows;
  UPDATE public.upload_refusals u SET owner_id = NULL, objection = NULL
   WHERE (u.owner_id IS NOT NULL OR u.objection IS NOT NULL)
     AND EXISTS (SELECT 1 FROM public.media_matches m WHERE m.id = u.match_id AND m.erased_at IS NOT NULL);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_changed := v_changed + v_rows;

  -- 2. Objections whose decision's texts are due.
  FOR v_decision IN
    SELECT o.decision_id
      FROM public.automated_objections o
      JOIN public.decisions d ON d.id = o.decision_id
      JOIN public.cases k ON k.id = d.case_id
      JOIN auth.users u ON u.id = CASE WHEN k.target_type = 'post' THEN (SELECT p.author_id FROM public.posts p WHERE p.id = k.target_id) ELSE k.target_id END
     WHERE o.erased_at IS NULL AND u.deleted_at IS NOT NULL
     ORDER BY o.decision_id
  LOOP
    v_due := true;
    BEGIN
      PERFORM public.erase_statement_texts(v_decision);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'not_due' THEN
        RAISE;
      END IF;
      v_due := false;
    END;
    IF v_due THEN
      UPDATE public.automated_objections o SET text = NULL, erased_at = now() WHERE o.decision_id = v_decision AND o.erased_at IS NULL;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_changed := v_changed + v_rows;
    END IF;
  END LOOP;

  -- 3. Signals. First those no statement reads: handled as gone, with neither an item nor a decision.
  DELETE FROM public.automated_signals s
   WHERE s.handled_at IS NOT NULL AND s.intake_item_id IS NULL AND s.decision_id IS NULL
     AND ((s.kind = 'known_match' AND EXISTS (SELECT 1 FROM public.media_matches m WHERE m.id = s.match_id AND m.erased_at IS NOT NULL))
          OR (s.kind = 'r1_score' AND s.handled = 'gone' AND s.handled_at <= now() - v_keep));
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_changed := v_changed + v_rows;
  -- Then those a statement reads, once the texts of their case's decisions are due: one decision of the case is tested
  -- (the signal's own, else the case's first), since every decision of a case has the case's subject.
  FOR v_id, v_decision IN
    SELECT s.id, coalesce(s.decision_id, (SELECT d.id FROM public.decisions d WHERE d.case_id = x.case_id ORDER BY d.decided_at, d.id LIMIT 1))
      FROM public.automated_signals s
      LEFT JOIN public.intake_items i ON i.id = s.intake_item_id
      CROSS JOIN LATERAL (SELECT coalesce(i.case_id, (SELECT d.case_id FROM public.decisions d WHERE d.id = s.decision_id)) AS case_id) x
      JOIN public.cases k ON k.id = x.case_id
      JOIN auth.users u ON u.id = CASE WHEN k.target_type = 'post' THEN (SELECT p.author_id FROM public.posts p WHERE p.id = k.target_id) ELSE k.target_id END
     WHERE s.handled_at IS NOT NULL AND (s.intake_item_id IS NOT NULL OR s.decision_id IS NOT NULL) AND u.deleted_at IS NOT NULL
       AND ((s.kind = 'known_match' AND EXISTS (SELECT 1 FROM public.media_matches m WHERE m.id = s.match_id AND m.erased_at IS NOT NULL))
            OR (s.kind = 'r1_score' AND EXISTS (SELECT 1 FROM public.intakes n WHERE n.id = i.intake_id AND n.erased_at IS NOT NULL)))
     ORDER BY s.id
  LOOP
    -- A case without a decision has no statement to test by; its signal waits.
    IF v_decision IS NULL THEN
      CONTINUE;
    END IF;
    v_due := true;
    BEGIN
      PERFORM public.erase_statement_texts(v_decision);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'not_due' THEN
        RAISE;
      END IF;
      v_due := false;
    END;
    IF v_due THEN
      DELETE FROM public.automated_signals s WHERE s.id = v_id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_changed := v_changed + v_rows;
    END IF;
  END LOOP;

  RETURN v_changed;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."erase_automation_records"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."erase_automation_records"() TO korbat_api;

-- The reporting counts (3e design, section 6.3). Written by hand: this migration changes no table. The standing ledger's
-- migration already holds the warning and the restriction of reporting and the withdrawal of marks; this one adds the
-- writers of the two counts they rest on, the view that counts them, and the check of every mark, and only then lets the
-- API role insert a mark.
--
-- As in 0016 to 0021: every function is owned by the migrator, pins its search path, names every object schema-qualified
-- and has EXECUTE taken from PUBLIC; a trigger function fires for every role all the same; errors carry their code as the
-- message under SQLSTATE P0001; times the database writes are now(), the transaction's start. No statement here names a
-- value that the schema migration of 3e added to action_kind, and every number is read from standing_rules(), never typed
-- as an interval (enum-literals.test.ts, standing-grants.test.ts).
--
-- The unit is the report: one row of intakes, whatever it names (one to ten items). report_tallies counts reports by the
-- UTC day they were received; a mark is a row an item, counted through its report. A report is marked when at least one
-- of its items holds a mark that counts, so the marked reports are never more than the reports, and one report never
-- reaches a threshold alone.
--
-- 1. The check of every mark, before its row is stored. A mark is a moderator's, signed with the decision that sets it:
-- only that decision's own transaction adds one (the xact and decided_at pair of 0016's decision_actions_check), only a
-- final decision that found no breach, and only on an item that decision answered which is no re-examination and came
-- from a signed-in person's report under a rule: never a notice of illegality, never the path for child sexual abuse
-- material (it stores no sender), never a finding, never a signed-out notice. The reporter, the report, the time that
-- report was sent and the time of the mark are forced from the rows, whatever the insert supplied; a mark is born
-- standing. Each refusal is invalid_decision with a detail, which the API logs and never answers.
CREATE FUNCTION "public"."unfounded_marks_check"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d public.decisions;
  i public.intake_items;
  n public.intakes;
BEGIN
  -- 1.
  SELECT x.* INTO d FROM public.decisions x WHERE x.id = NEW.decision_id;
  IF NOT FOUND OR d.xact IS DISTINCT FROM pg_current_xact_id() OR d.decided_at IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'mark: a mark is added only in the transaction of its own decision.';
  END IF;
  IF d.kind <> 'final' OR d.outcome <> 'no_violation' THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'mark: only a final decision that found no breach marks a report.';
  END IF;
  -- 2.
  SELECT x.* INTO i FROM public.intake_items x WHERE x.id = NEW.item_id;
  IF NOT FOUND OR i.answered_by IS DISTINCT FROM d.id OR i.reexamines_item_id IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'mark: the item is not one this decision answered, or it is a re-examination.';
  END IF;
  SELECT x.* INTO n FROM public.intakes x WHERE x.id = i.intake_id;
  IF n.kind <> 'user' OR n.reporter_id IS NULL OR n.alleges_illegal OR n.csam THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'mark: only a signed-in person''s report under a rule can be marked.';
  END IF;
  -- 3.
  NEW.account_id := n.reporter_id;
  NEW.intake_id := n.id;
  NEW.reported_at := n.received_at;
  NEW.marked_at := now();
  NEW.withdrawn_by := NULL;
  NEW.withdrawn_at := NULL;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."unfounded_marks_check"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "unfounded_marks_check" BEFORE INSERT ON "public"."unfounded_marks" FOR EACH ROW EXECUTE FUNCTION "public"."unfounded_marks_check"();--> statement-breakpoint
-- The API role may insert a mark from here on, now that every mark meets the check above; it never updates or deletes
-- one (the schema migration of 3e revoked those): only decisions_apply withdraws marks, and only the retention job and an
-- account's deletion delete them.
GRANT INSERT ON "public"."unfounded_marks" TO korbat_api;--> statement-breakpoint
-- 2. The decision's check at commit, queued again by every mark, as 0016's decision_actions_recheck is by every row of
-- the ledger. A decision that found no breach usually holds no ledger row, so without this a transaction could make the
-- decision's own deferred check run early (SET CONSTRAINTS ALL IMMEDIATE) and add a mark afterwards that no key signed.
CREATE FUNCTION "public"."unfounded_marks_recheck"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.decision_holds(NEW.decision_id);
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."unfounded_marks_recheck"() FROM PUBLIC;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "unfounded_marks_recheck" AFTER INSERT ON "public"."unfounded_marks" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."unfounded_marks_recheck"();--> statement-breakpoint
-- 3. The one writer of the tallies: every report a signed-in person sends under a rule adds 1 to that person's row of the
-- UTC day it was received, in one upsert, in the intake's own transaction (so a refused or retried intake counts
-- nothing). A notice of illegality, the path for child sexual abuse material, a signed-out notice and a moderator's
-- finding are never counted. The API role holds no write on the table, so it can neither lower nor raise a count.
CREATE FUNCTION "public"."report_tallies_count"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.kind = 'user' AND NEW.reporter_id IS NOT NULL AND NOT NEW.alleges_illegal AND NOT NEW.csam THEN
    INSERT INTO public.report_tallies AS t (account_id, day, reports) VALUES (NEW.reporter_id, (NEW.received_at AT TIME ZONE 'UTC')::date, 1)
      ON CONFLICT (account_id, day) DO UPDATE SET reports = t.reports + 1;
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."report_tallies_count"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "report_tallies_count" AFTER INSERT ON "public"."intakes" FOR EACH ROW EXECUTE FUNCTION "public"."report_tallies_count"();--> statement-breakpoint
-- 4. Each account's record of reporting, in reports on both sides, by the UTC day they were sent: `reports` is the sum
-- of its tallies of the days within report_frame_days (today among them), `unfounded` the number of its marked reports
-- in that frame, the distinct reports among its marks that count. A mark counts while its report's day lies within the
-- frame, no correction withdrew it, and no re-examination of its item ended in a restriction (a derivation: nothing is
-- written). This is exactly how the restriction's branch of decision_actions_check counts the marks it reads inline. An
-- account is listed when it has a tally or a mark that counts in the frame; the view is read with the account's id, so
-- each arm uses its index ((account_id, day) and unfounded_marks_account_idx). The counts feed the two measures and the
-- console's list of reporting records, and nothing else: no queue order, limit or weight reads them.
CREATE VIEW "public"."reporting_record" WITH (security_invoker = true) AS
WITH frame AS (SELECT (now() AT TIME ZONE 'UTC')::date - k.report_frame_days AS before FROM public.standing_rules() k)
SELECT a.account_id,
       coalesce((SELECT sum(t.reports) FROM public.report_tallies t WHERE t.account_id = a.account_id AND t.day > f.before), 0)::integer AS reports,
       (SELECT count(DISTINCT m.intake_id) FROM public.unfounded_marks m
         WHERE m.account_id = a.account_id AND m.withdrawn_by IS NULL AND (m.reported_at AT TIME ZONE 'UTC')::date > f.before
           AND NOT EXISTS (SELECT 1 FROM public.intake_items x WHERE x.reexamines_item_id = m.item_id AND x.outcome IN ('restricted_rule', 'restricted_legal')))::integer AS unfounded
  FROM frame f,
       LATERAL (SELECT t.account_id FROM public.report_tallies t WHERE t.day > f.before
                UNION
                SELECT m.account_id FROM public.unfounded_marks m WHERE m.withdrawn_by IS NULL AND (m.reported_at AT TIME ZONE 'UTC')::date > f.before) a;--> statement-breakpoint
REVOKE ALL ON "public"."reporting_record" FROM korbat_api;--> statement-breakpoint
GRANT SELECT ON "public"."reporting_record" TO korbat_api;--> statement-breakpoint
-- 5. forget_reporter, replaced (0018): at an account's deletion it also deletes the account's marks and tallies, so that
-- no count of a person who left is kept. Everything 0018 says of it stands, stated again in full: it acts only on an
-- account whose auth row is marked deleted, read here, and changes nothing for any other; it answers how many rows it
-- changed or deleted, 0 when run again.
CREATE OR REPLACE FUNCTION "public"."forget_reporter"(account uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  changed integer;
  n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = forget_reporter.account AND u.deleted_at IS NOT NULL) THEN
    RETURN 0;
  END IF;
  UPDATE public.intakes k SET reporter_id = NULL WHERE k.reporter_id = forget_reporter.account;
  GET DIAGNOSTICS changed = ROW_COUNT;
  UPDATE public.intake_items i SET reporter_account_id = NULL WHERE i.reporter_account_id = forget_reporter.account;
  GET DIAGNOSTICS n = ROW_COUNT;
  changed := changed + n;
  -- 3e: the reporting counts of the account go with it.
  DELETE FROM public.unfounded_marks m WHERE m.account_id = forget_reporter.account;
  GET DIAGNOSTICS n = ROW_COUNT;
  changed := changed + n;
  DELETE FROM public.report_tallies t WHERE t.account_id = forget_reporter.account;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN changed + n;
END $$;

-- Retention of account sanctions (3e design, section 6.5; the design names this migration 0023, one lower, since 3c's
-- review added 0019). Written by hand: this migration changes no table. It adds the two functions the retention job calls
-- in every round (3e design, section 7.14): one erases the text of a reply to a suspension or a termination once korbat
-- has answered it and its decision is final for its author, and one forgets the reporting counts of the days that have
-- left their frame. What korbat keeps of 3e, and for how long, is section 6.7's table, which the terms publish.
--
-- As in 0016 to 0023: every function is owned by the migrator, pins its search path, names every object schema-qualified
-- and has EXECUTE taken from PUBLIC; errors carry their code as the message under SQLSTATE P0001; times the database
-- writes are now(), the transaction's start; a read that must see what committed while a lock waited is a statement of
-- its own after that lock. No statement here names a value that 3e's schema migration added to action_kind, and every
-- number is read from standing_rules() or from decision_final_at, never typed as an interval (enum-literals.test.ts,
-- standing-grants.test.ts).
--
-- 1. The text of a reply, erased as 0018 erases an appeal's statement: once nobody can need it any more. A reply's text
-- goes only when the reply is answered (answered_at is set) and the decision of the measure it replied to is final for
-- its author (decision_final_at: the six months to appeal passed unused, counted from the later informed_at when a kept
-- answer to a reply filed on time started the measure, or the appeal answered). An unanswered reply keeps its text
-- however old its decision is: one filed after the decision became final, and one left unanswered past that, are still
-- there for whoever answers them, so no reply is erased before somebody has read it. The function first locks, in
-- action_id order, the replies that look due, so two rounds meet in one order; then, in a statement of its own that sees
-- what committed while it waited, it blanks the text and the salt of each that is still due, keeps the digest (the
-- record's proof of what was written) and the row, and sets erased_at. The table's check accepts exactly that shape: no
-- text, no salt, a digest and erased_at. It is the one writer of suspension_replies.erased_at. It answers how many
-- replies it erased, 0 when run again.
CREATE FUNCTION "public"."erase_reply_statements"() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n integer;
BEGIN
  PERFORM 1
     FROM public.suspension_replies r
     JOIN public.decision_actions a ON a.id = r.action_id
    WHERE r.statement IS NOT NULL AND r.answered_at IS NOT NULL
      AND public.decision_final_at(a.decision_id) <= now()
    ORDER BY r.action_id
      FOR UPDATE OF r;
  UPDATE public.suspension_replies r SET statement = NULL, statement_salt = NULL, erased_at = now()
    FROM public.decision_actions a
   WHERE a.id = r.action_id AND r.statement IS NOT NULL AND r.answered_at IS NOT NULL
     AND public.decision_final_at(a.decision_id) <= now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."erase_reply_statements"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."erase_reply_statements"() TO korbat_api;--> statement-breakpoint
-- 2. The reporting counts of the days before the frame. The view reporting_record (0022) counts a tally whose UTC day is
-- after today's minus report_frame_days, and a mark whose report was sent on such a day; this deletes exactly the
-- complement: every mark, withdrawn ones included, whose report was sent on a UTC day at or before that boundary, and
-- every tally of such a day. So both sides of a count leave on the same day, the day the frame passes their report,
-- and what the warning and the restriction read does not change when this runs. An account's rows of both tables also
-- go with its deletion, through forget_reporter (0022). It answers how many rows it deleted, marks and tallies
-- together, 0 when run again the same day.
CREATE FUNCTION "public"."forget_report_counts"() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  boundary date;
  changed integer;
  n integer;
BEGIN
  SELECT (now() AT TIME ZONE 'UTC')::date - k.report_frame_days INTO boundary FROM public.standing_rules() k;
  DELETE FROM public.unfounded_marks m WHERE (m.reported_at AT TIME ZONE 'UTC')::date <= boundary;
  GET DIAGNOSTICS changed = ROW_COUNT;
  DELETE FROM public.report_tallies t WHERE t.day <= boundary;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN changed + n;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."forget_report_counts"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."forget_report_counts"() TO korbat_api;

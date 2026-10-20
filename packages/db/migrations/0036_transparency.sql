CREATE TABLE "recipient_months" (
	"month" date PRIMARY KEY NOT NULL,
	"signed_in" integer NOT NULL,
	"signed_out_days" integer,
	"method" smallint NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "recipient_months_first_day" CHECK (extract(day from "recipient_months"."month") = 1),
	CONSTRAINT "recipient_months_counts" CHECK ("recipient_months"."signed_in" >= 0 and "recipient_months"."signed_out_days" >= 0)
);
--> statement-breakpoint
ALTER TABLE "recipient_months" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "transparency_editions" (
	"year" smallint NOT NULL,
	"version" smallint NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"method" smallint NOT NULL,
	"reason" text NOT NULL,
	"figures" jsonb NOT NULL,
	CONSTRAINT "transparency_editions_year_version_pk" PRIMARY KEY("year","version"),
	CONSTRAINT "transparency_editions_reason" CHECK ("transparency_editions"."reason" in ('first', 'hold_ended', 'correction')),
	CONSTRAINT "transparency_editions_first" CHECK ("transparency_editions"."version" >= 1 and ("transparency_editions"."version" = 1) = ("transparency_editions"."reason" = 'first'))
);
--> statement-breakpoint
ALTER TABLE "transparency_editions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "recipient_months_api_all" ON "recipient_months" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "transparency_editions_api_all" ON "transparency_editions" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Everything below is written by hand (3d design, sections 6 and 6.4; Task 4). As in 0016 to 0035: every function is
-- owned by the migrator, pins its search path to public and pg_temp, names every object schema-qualified and has EXECUTE
-- taken from PUBLIC; an error carries its code as the message under SQLSTATE P0001.
--
-- This migration comes before the intake kind `automated` and the channel `system` exist (they come with the automated
-- decision's migration, Task 6). A function that named such a label as an enum literal would be created without
-- complaint and fail when first called, so neither label appears here as a literal of its enum anywhere, a PL/pgSQL body
-- included: every kind, channel, outcome and state is compared as text (`kind::text = 'automated'`), as 3f's labels are
-- (enum-literals.test.ts reads this file under that stricter form). No decision of the kind `order` is in any table but
-- the order section, which counts orders the way staff.js tco-counts does (apps/api/src/cli/counts.ts).
--
-- 1. The grants. 0001's default privileges gave the API role every right on a new public table; both tables lose them
-- all, then get what section 6.4 lists. transparency_editions: read; edition_publish() is its one writer. recipient_months:
-- read, and the insert of a month's two numbers at its close; computed_at is forced.
REVOKE ALL ON "public"."transparency_editions" FROM korbat_api;--> statement-breakpoint
REVOKE ALL ON "public"."recipient_months" FROM korbat_api;--> statement-breakpoint
GRANT SELECT ON "public"."transparency_editions" TO korbat_api;--> statement-breakpoint
GRANT SELECT ON "public"."recipient_months" TO korbat_api;--> statement-breakpoint
GRANT INSERT ("month", "signed_in", "signed_out_days", "method") ON "public"."recipient_months" TO korbat_api;--> statement-breakpoint

-- 2. Public record is never changed (section 2, row 2): an update of either table is refused for every role, the
-- migrator included, and a delete for every role but the migrator, whose delete is a test's cleanup; the API's role holds
-- neither right in the first place. A correction of an edition is a new version beside the older ones.
CREATE FUNCTION "public"."transparency_frozen"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR current_user <> 'korbat_migrate' THEN
    RAISE EXCEPTION 'edition_frozen';
  END IF;
  RETURN OLD;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."transparency_frozen"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "transparency_editions_frozen" BEFORE UPDATE OR DELETE ON "public"."transparency_editions" FOR EACH ROW EXECUTE FUNCTION "public"."transparency_frozen"();--> statement-breakpoint
CREATE TRIGGER "recipient_months_frozen" BEFORE UPDATE OR DELETE ON "public"."recipient_months" FOR EACH ROW EXECUTE FUNCTION "public"."transparency_frozen"();--> statement-breakpoint

-- 3. recipient_months_insert: computed_at is the moment of the month's close, whatever the insert supplied.
CREATE FUNCTION "public"."recipient_months_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.computed_at := now();
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."recipient_months_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "recipient_months_insert" BEFORE INSERT ON "public"."recipient_months" FOR EACH ROW EXECUTE FUNCTION "public"."recipient_months_insert"();--> statement-breakpoint

-- 4. transparency_rules(): the five constants of the public figures (section 6.4), mirrored by the contracts'
-- TRANSPARENCY_RULES, which a database test holds member for column: the floor under which a count prints as "1 to 9" and
-- a row is folded into "other", the rounding of every other count, the due day of a year's edition (1 March of the next
-- year, in UTC) and the method's version. Each is the owner's (section 2, rows 2 and 3).
CREATE FUNCTION "public"."transparency_rules"() RETURNS TABLE (floor integer, round_to integer, due_month integer, due_day integer, method integer)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT 10, 10, 3, 1, 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."transparency_rules"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."transparency_rules"() TO korbat_api;--> statement-breakpoint

-- 5. band(n): the only place a count becomes public text (section 2, row 3): 0 for zero; "1 to 9" under the floor;
-- otherwise "about" and the count rounded to the nearest round_to, halves upward. The contracts' band() prints the same,
-- which a table test over 0 to 200 holds. A negative count is no count: null.
CREATE FUNCTION "public"."band"(n bigint) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
           WHEN band.n IS NULL OR band.n < 0 THEN NULL
           WHEN band.n = 0 THEN '0'
           WHEN band.n < r.floor THEN '1 to ' || (r.floor - 1)::text
           ELSE 'about ' || ((band.n + r.round_to / 2) / r.round_to * r.round_to)::text
         END
    FROM public.transparency_rules() r
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."band"(bigint) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."band"(bigint) TO korbat_api;--> statement-breakpoint

-- 6. transparency_fold(counted): one table of an edition from its exact counts, given as a JSON array of
-- {label, n} in the order the table prints them. A row of zero is dropped; a row under the floor is folded into the
-- row "other", printed last with its own band; every other row keeps its label and is banded. So the printed rows do
-- not give the printed total, and no folded cell can be subtracted back (LAB E4). Nobody but the definer functions below
-- calls it.
CREATE FUNCTION "public"."transparency_fold"(counted jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  WITH r AS (SELECT t.floor FROM public.transparency_rules() t),
  given AS (SELECT e.value->>'label' AS label, (e.value->>'n')::bigint AS n, e.ordinality AS at
              FROM jsonb_array_elements(coalesce(transparency_fold.counted, '[]'::jsonb)) WITH ORDINALITY e
             WHERE (e.value->>'n')::bigint > 0),
  folded AS (SELECT sum(g.n)::bigint AS n FROM given g, r WHERE g.n < r.floor)
  SELECT coalesce(jsonb_agg(x.line ORDER BY x.at), '[]'::jsonb)
    FROM (SELECT jsonb_build_object('label', g.label, 'count', public.band(g.n)) AS line, g.at FROM given g, r WHERE g.n >= r.floor
          UNION ALL
          SELECT jsonb_build_object('label', 'other', 'count', public.band(f.n)), 9223372036854775807 FROM folded f WHERE f.n IS NOT NULL) x
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."transparency_fold"(jsonb) FROM PUBLIC;--> statement-breakpoint

-- 7. transparency_order_held(order, as_of): whether an order is left out of the public figures at an instant (section 2,
-- row 5; 6.4 step 5): one of its decisions was untold then (taken by then, and not told by then) and its hold, as
-- order_hold_until() reads it now, lies after that instant. Read at the present it is "untold now and held now"; read at
-- an older version's own instant it says which orders that version left out, from the same rows by the same times, so an
-- order received in the year and disabled or told later is not lost between the section and the test of its new version.
CREATE FUNCTION "public"."transparency_order_held"(order_id uuid, as_of timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.decisions d JOIN public.legal_order_items i ON i.id = d.order_item_id
                  WHERE i.order_id = transparency_order_held.order_id
                    AND d.decided_at <= transparency_order_held.as_of
                    AND (d.informed_at IS NULL OR d.informed_at > transparency_order_held.as_of))
     AND coalesce(public.order_hold_until(transparency_order_held.order_id) > transparency_order_held.as_of, false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."transparency_order_held"(uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- 8. transparency_order_ids(year, as_of): the removal orders the order section of a year counts at an instant: recorded
-- by then, not held then, and with a row of the year that a figure counts (received in it, or without a receipt opened
-- in it; an item disabled in it; an Annex III, a scrutiny or a reinstatement that took effect in it; an authority's
-- access to its preserved content opened in it). The section is printed when this is not empty, and a year gains a
-- version hold_ended when it names an order that it did not name at the newest version's own instant.
CREATE FUNCTION "public"."transparency_order_ids"(year integer, as_of timestamptz) RETURNS SETOF uuid
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH y AS (SELECT make_timestamptz(transparency_order_ids.year, 1, 1, 0, 0, 0, 'UTC') AS f, make_timestamptz(transparency_order_ids.year + 1, 1, 1, 0, 0, 0, 'UTC') AS t)
  SELECT o.id FROM public.legal_orders o, y
   WHERE o.kind::text = 'tco_removal' AND o.opened_at <= transparency_order_ids.as_of
     AND NOT public.transparency_order_held(o.id, transparency_order_ids.as_of)
     AND ((coalesce(o.received_at, o.opened_at) >= y.f AND coalesce(o.received_at, o.opened_at) < y.t)
          OR EXISTS (SELECT 1 FROM public.legal_order_items t WHERE t.order_id = o.id AND t.disabled_at >= y.f AND t.disabled_at < y.t)
          OR EXISTS (SELECT 1 FROM public.legal_order_events e
                      WHERE e.order_id = o.id AND e.kind::text IN ('annex3_sent', 'scrutiny_requested', 'scrutiny_decided', 'reinstated')
                        AND coalesce(e.effective_at, e.at) >= y.f AND coalesce(e.effective_at, e.at) < y.t)
          OR EXISTS (SELECT 1 FROM public.productions p
                      WHERE p.order_id = o.id AND p.instrument = 'preserved_access' AND p.purpose::text = 'authority' AND p.opened_at >= y.f AND p.opened_at < y.t))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."transparency_order_ids"(integer, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- 9. transparency_orders(year, as_of): the order section of a year's edition (6.4 step 5; section 2, rows 4 and 5): the
-- figures that staff.js tco-counts prints, read by the same statements (apps/api/src/cli/counts.ts, tcoCounts; a test
-- holds the two equal on the same rows), as numbers and without the issuing state, of the orders that
-- transparency_order_ids() names, so an order is left out while its notice is held. A figure the rows can no longer give
-- is null, never 0: the order figures of a year whose records of a removal order the retention job erased (judged by the
-- erasure's own audit row, as tco-counts judges it), and the authority's accesses whose production is gone. Null, and
-- so no member, when no order is countable and nothing was erased: nothing says whether an order was left out.
CREATE FUNCTION "public"."transparency_orders"(year integer, as_of timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_from timestamptz := make_timestamptz(transparency_orders.year, 1, 1, 0, 0, 0, 'UTC');
  v_to timestamptz := make_timestamptz(transparency_orders.year + 1, 1, 1, 0, 0, 0, 'UTC');
  v_ids uuid[];
  v_erased boolean;
  v_received jsonb;
  v_minutes jsonb;
  v_disabled integer;
  v_events record;
  v_access integer;
  v_access_erased boolean;
  v_terrorist integer;
  v_referrals integer;
BEGIN
  SELECT coalesce(array_agg(n.id), '{}') INTO v_ids FROM public.transparency_order_ids(transparency_orders.year, transparency_orders.as_of) AS n(id);
  -- Whether the retention job erased the records of a removal order that could have held a row of this year (tco-counts'
  -- ordersErased): its erasure row names the order's kind and receipt as they stood then; one written before 3f's review
  -- names neither, and counts for every year it could reach.
  SELECT EXISTS (
           SELECT 1 FROM public.audit_log r CROSS JOIN public.order_rules() k
            WHERE r.action = 'moderation_retention' AND r.metadata->>'step' = 'order_records'
              AND r.created_at - make_interval(years => k.record_keep_years) >= v_from
              AND (NOT (r.metadata ? 'kind')
                   OR (r.metadata->>'kind' = 'tco_removal'
                       AND coalesce((r.metadata->>'receivedAt')::timestamptz, (r.metadata->>'openedAt')::timestamptz) < v_to)))
    INTO v_erased;
  IF cardinality(v_ids) = 0 AND NOT v_erased THEN
    RETURN NULL;
  END IF;
  -- The orders received in the year (or opened in it without a receipt), with their clocks: tco-counts' orders.
  SELECT jsonb_build_object('total', count(*), 'crossBorder', count(*) FILTER (WHERE c.cross_border)),
         jsonb_build_object(
           'list', coalesce(jsonb_agg(c.minutes ORDER BY c.minutes ASC NULLS LAST) FILTER (WHERE c.finished), '[]'::jsonb),
           'outside', count(*) FILTER (WHERE c.finished AND c.within_hour = false),
           'withoutReceipt', count(*) FILTER (WHERE c.finished AND c.within_hour IS NULL),
           'open', count(*) FILTER (WHERE c.items_open > 0))
    INTO v_received, v_minutes
    FROM (SELECT o.cross_border, k.items_open, (k.items_open = 0 AND k.last_effect_at IS NOT NULL) AS finished, k.within_hour,
                 floor(extract(epoch FROM (k.last_effect_at - k.clock_start)) / 60)::int AS minutes
            FROM public.legal_orders o
            JOIN public.legal_order_clock k ON k.order_id = o.id
           WHERE o.id = ANY (v_ids) AND coalesce(o.received_at, o.opened_at) >= v_from AND coalesce(o.received_at, o.opened_at) < v_to) c;
  SELECT count(*)::int INTO v_disabled
    FROM public.legal_order_items t
   WHERE t.order_id = ANY (v_ids) AND t.disabled_at >= v_from AND t.disabled_at < v_to;
  SELECT count(*) FILTER (WHERE e.kind::text = 'annex3_sent' AND e.ground = 'force_majeure') AS force_majeure,
         count(*) FILTER (WHERE e.kind::text = 'annex3_sent' AND e.ground = 'manifest_error') AS manifest_error,
         count(*) FILTER (WHERE e.kind::text = 'annex3_sent' AND e.ground = 'insufficient_information') AS insufficient_information,
         count(*) FILTER (WHERE e.kind::text = 'scrutiny_requested') AS requested,
         count(*) FILTER (WHERE e.kind::text = 'scrutiny_decided' AND e.ground = 'annulled') AS annulled,
         count(*) FILTER (WHERE e.kind::text = 'scrutiny_decided' AND e.ground = 'upheld') AS upheld,
         count(*) FILTER (WHERE e.kind::text = 'reinstated' AND e.ground = 'withdrawn') AS withdrawn,
         count(*) FILTER (WHERE e.kind::text = 'reinstated' AND e.ground = 'annulled') AS reinstated_annulled,
         count(*) FILTER (WHERE e.kind::text = 'reinstated' AND e.ground = 'scrutiny') AS scrutiny,
         count(*) FILTER (WHERE e.kind::text = 'reinstated' AND e.ground = 'not_authentic') AS not_authentic,
         count(*) FILTER (WHERE e.kind::text = 'reinstated' AND e.ground = 'wrong_item') AS wrong_item
    INTO v_events
    FROM public.legal_order_events e
   WHERE e.order_id = ANY (v_ids) AND coalesce(e.effective_at, e.at) >= v_from AND coalesce(e.effective_at, e.at) < v_to;
  -- An authority's access is recorded twice: as its production, which goes with the order's records, and in the audit
  -- row preserved_accessed, which stays. An access to a held order's content is left out with the order.
  SELECT count(*)::int INTO v_access
    FROM public.productions p
   WHERE p.instrument = 'preserved_access' AND p.purpose::text = 'authority' AND p.opened_at >= v_from AND p.opened_at < v_to
     AND (p.order_id IS NULL OR NOT public.transparency_order_held(p.order_id, transparency_orders.as_of));
  SELECT EXISTS (SELECT 1 FROM public.audit_log a
                  WHERE a.action = 'preserved_accessed' AND (a.metadata->>'purpose')::text = 'authority' AND a.created_at >= v_from AND a.created_at < v_to
                    AND NOT EXISTS (SELECT 1 FROM public.productions p WHERE p.id::text = a.metadata->>'productionId'))
    INTO v_access_erased;
  -- korbat's own final decisions on terrorist content, which the ledger keeps for good; an order's decision is of the kind order.
  SELECT count(*)::int INTO v_terrorist
    FROM public.decisions d
   WHERE d.kind::text = 'final' AND d.outcome::text = 'restricted' AND d.category_keyword = 'KEYWORD_TERRORIST_CONTENT'
     AND d.decided_at >= v_from AND d.decided_at < v_to;
  SELECT count(*)::int INTO v_referrals
    FROM public.audit_log a
   WHERE a.action = 'contact_closed' AND a.metadata->>'disposition' = 'referral' AND a.created_at >= v_from AND a.created_at < v_to;
  RETURN jsonb_build_object(
    'received', CASE WHEN v_erased THEN NULL ELSE v_received END,
    'itemsDisabled', CASE WHEN v_erased THEN NULL ELSE v_disabled END,
    'minutes', CASE WHEN v_erased THEN NULL ELSE v_minutes END,
    'annex3', CASE WHEN v_erased THEN NULL ELSE jsonb_build_object('force_majeure', v_events.force_majeure, 'manifest_error', v_events.manifest_error,
                                                                   'insufficient_information', v_events.insufficient_information) END,
    'scrutiny', CASE WHEN v_erased THEN NULL ELSE jsonb_build_object('requested', v_events.requested, 'annulled', v_events.annulled, 'upheld', v_events.upheld) END,
    'reinstated', CASE WHEN v_erased THEN NULL ELSE jsonb_build_object('withdrawn', v_events.withdrawn, 'annulled', v_events.reinstated_annulled, 'scrutiny', v_events.scrutiny,
                                                                       'not_authentic', v_events.not_authentic, 'wrong_item', v_events.wrong_item) END,
    'authorityAccess', CASE WHEN v_access_erased THEN NULL ELSE v_access END,
    'terroristWithoutOrder', v_terrorist,
    'referralsClosed', v_referrals);
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."transparency_orders"(integer, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- 10. transparency_figures(year, as_of): one year's figures (6.4), executable by nobody but its owner, so only
-- edition_publish() and the migrator's tests compute them. In this order:
--   1. edition_not_due before the due day of year + 1 in UTC, by as_of and by the clock alike: no figure of the running
--      year exists anywhere, whoever asks and whatever instant is passed.
--   2. Every table counts rows whose time lies in the year in UTC, as they stood on the due day: where a table counts a
--      row's later fate (whether a person's decision then restricted a program's finding), it is the fate by the due day,
--      so a version computed later prints the same tables. as_of moves the order section alone. No decision of the kind
--      order is in any table.
--   3. The tables, each folded and banded by transparency_fold(): restrictions by ground (each rule, the law) and by kind
--      of measure, never crossed, and their total; decisions that found no breach; intakes by kind, a user's notice of
--      illegality apart from a report under the rules, never an order's; appeals answered in the year by their result;
--      re-examinations answered in the year by their answer; 3e's six account measures by kind; and the programs' table:
--      decisions without a decider by rule, intakes of the kind automated that cite a rule by rule, and of the R1
--      findings those whose case a person's final decision had restricted by the due day, as two bands and only on a
--      base of ten or more. (The uploads' table comes with Task 7's migration, which replaces this function.)
--   4. The order section, transparency_orders(year, as_of), absent while it is null.
--   5. The recipients: the average of the six stored months before the due day (RECIPIENT_RULES.months), whatever as_of
--      is, as two bands, the second absent when a month did not count signed-out readers; "not recorded" with fewer.
-- The JSON holds banded strings only, but the order section's numbers.
CREATE FUNCTION "public"."transparency_figures"(year integer, as_of timestamptz) RETURNS jsonb
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
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."transparency_figures"(integer, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- 11. edition_publish(year, reason): the one writer of transparency_editions (6.4, 7.6), executable by the API's role,
-- whose transparency job calls it daily with the reason first for the last closed year and every earlier year that has an
-- edition. In this order:
--   1. The reason is first or correction (hold_ended is this function's to choose), and correction only when the
--      session's role is the migrator (staff.js edition <year> --correct): invalid_edition otherwise. session_user, since
--      inside this function current_user is its owner.
--   2. An advisory transaction lock on the year, so two calls for one year run one after the other.
--   3. Which version, if any, at this call's own instant (clock_timestamp(), so that a test that ends a hold in the same
--      transaction as an earlier version still sees the earlier instant as earlier):
--      - no version: version 1, first, once the edition is due; before that null, and nothing written;
--      - correction: edition_not_due before the due day; then the next version, every table computed again as of the
--        same due day (invalid_edition while no version exists: the first one is the job's);
--      - a version exists and transparency_order_ids() now names an order that it did not name at the newest version's
--        instant: the next version, hold_ended, which copies the newest version's stored figures and replaces the order
--        section alone, so two versions never differ by what happened to anyone else in between;
--      - otherwise null.
--   4. One row, both times this call's instant, and the rules' method.
--   5. The plain audit row edition_published by the system, without a step-up, on the edition `<year>.<version>`, with
--      the year, the version and the reason: the transaction's last statement.
-- It answers the version it wrote.
CREATE FUNCTION "public"."edition_publish"(year integer, reason text) RETURNS smallint
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
                SELECT b.id FROM public.transparency_order_ids(edition_publish.year, newest.computed_at) AS b(id)) THEN
    v_orders := public.transparency_orders(edition_publish.year, v_at);
    v_figures := (newest.figures - 'orders') || CASE WHEN v_orders IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('orders', v_orders) END;
    v_version := newest.version + 1;
    v_reason := 'hold_ended';
  ELSE
    RETURN NULL;
  END IF;
  INSERT INTO public.transparency_editions (year, version, computed_at, published_at, method, reason, figures)
  VALUES (edition_publish.year, v_version, v_at, v_at, k.method, v_reason, v_figures);
  -- The system actor (apps/api/src/auth/admin.ts, SYSTEM_ACTOR_ID): no person published it.
  INSERT INTO public.audit_log (actor_id, action, target_type, target_id, metadata)
  VALUES ('00000000-0000-0000-0000-000000000000', 'edition_published', 'edition', edition_publish.year::text || '.' || v_version::text,
          jsonb_build_object('year', edition_publish.year, 'version', v_version, 'reason', v_reason));
  RETURN v_version;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."edition_publish"(integer, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."edition_publish"(integer, text) TO korbat_api;

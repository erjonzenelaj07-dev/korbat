CREATE TABLE "copy_marks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "copy_marks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"staff_id" uuid NOT NULL,
	"place" bigint NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "copy_marks_place" CHECK ("copy_marks"."place" > 0)
);
--> statement-breakpoint
ALTER TABLE "copy_marks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "restore_gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"place" bigint NOT NULL,
	"hash" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb,
	"acted_at" timestamp with time zone NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	"class" text NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"disposition" text,
	CONSTRAINT "restore_gaps_place_key" UNIQUE("import_id","place","target_id"),
	CONSTRAINT "restore_gaps_class" CHECK ("restore_gaps"."class" in ('order_effect', 'seal_final', 'seal_interim', 'standing', 'restriction', 'reversal', 'no_measure', 'record')),
	CONSTRAINT "restore_gaps_disposition" CHECK ("restore_gaps"."disposition" in ('reapplied', 'not_needed', 'imported')),
	CONSTRAINT "restore_gaps_closed" CHECK (("restore_gaps"."closed_at" is null) = ("restore_gaps"."disposition" is null) and ("restore_gaps"."closed_by" is not null) = ("restore_gaps"."disposition" is not distinct from 'reapplied')),
	CONSTRAINT "restore_gaps_hash" CHECK ("restore_gaps"."hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "restore_gaps_place" CHECK ("restore_gaps"."place" > 0)
);
--> statement-breakpoint
ALTER TABLE "restore_gaps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "restore_gaps_open_idx" ON "restore_gaps" USING btree ("class") WHERE closed_at is null;--> statement-breakpoint
CREATE POLICY "copy_marks_api_all" ON "copy_marks" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "restore_gaps_api_all" ON "restore_gaps" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Everything below is written by hand (3f design, section 6.6). As in 0016 to 0030: every function is owned by the
-- migrator, pins its search path to public and pg_temp (and names auth's objects in full), names every object
-- schema-qualified and has EXECUTE taken from PUBLIC; times the database writes are now(), the transaction's start, unless
-- clock_timestamp() is named; errors carry their code as the message under SQLSTATE P0001. No function here holds an
-- interval literal or a number of order_rules(): each is read from there. The eight enum values of 0027 are named only
-- inside PL/pgSQL bodies.
--
-- 1. The grants. 0001's default privileges gave the API role every write on a new public table; each table loses them
-- all, then gets what section 6.6 lists. The gaps: read only; the import writes them as the migrator, gap_close as its
-- owner, and a record command given --gap, as the migrator, closes one of the class record. The copy marks: read, and the
-- insert of the two columns the mark route supplies; the trigger forces the time.
REVOKE ALL ON "public"."restore_gaps", "public"."copy_marks" FROM korbat_api;--> statement-breakpoint
GRANT SELECT ON "public"."restore_gaps", "public"."copy_marks" TO korbat_api;--> statement-breakpoint
GRANT INSERT ("staff_id", "place") ON "public"."copy_marks" TO korbat_api;--> statement-breakpoint

-- 2. copy_marks_insert: a mark's time is the database's clock when it joined the table, whatever the insert supplied, for
-- every role, so the copy's age that alert_steps() and the home screen read is never a time someone typed.
CREATE FUNCTION "public"."copy_marks_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.at := clock_timestamp();
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."copy_marks_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "copy_marks_insert" BEFORE INSERT ON "public"."copy_marks" FOR EACH ROW EXECUTE FUNCTION "public"."copy_marks_insert"();--> statement-breakpoint

-- 3. gap_close: closes one open gap after a restore (sections 6.6 and 7.17 step 6), in the transaction of the decision that
-- took the lost measure again, or with none, by an admin, as not needed. It runs as its owner, since the API role holds no
-- write on restore_gaps; the acting account is its third argument, which must have made the decision for a closing with
-- one, and which restore_gaps_confirmed holds to the audit row a key confirmed for a closing without one. In this order:
--   1. The gap's row FOR UPDATE (not_found when there is none); gap_mismatch when it is closed.
--   2. Without a decision: the acting account's auth.users row FOR SHARE is live staff (staff_confirmation_ended
--      otherwise) and an admin (admin_required); the gap is closed now as not_needed. The route then writes gap_closed
--      through append_confirmed_audit, and restore_gaps_confirmed holds the closing to it at commit.
--   3. With a decision: the decision was inserted by this transaction, by the acting account (the xact and decided_at
--      pair of 0016, which decisions_record forces), and fits the gap's class, else gap_mismatch:
--        order_effect: an order decision whose order item is the gap's item;
--        seal_final, seal_interim: a final, or an interim, decision that holds a seal_media;
--        standing: one that holds a suspend or a terminate; restriction: one that holds another measure; reversal: one
--        that holds a reversal; no_measure: any decision; record: none (a record is entered again by its command);
--        for every class but order_effect: the decision's case has the target the gap's metadata names, when it names one.
--      The gap is closed now, by the decision, as reapplied. The decide, review and effect routes call it after their
--      ledger rows and before their audit row, so the decision's own check at commit covers the transaction.
-- Nothing here writes the ledger: a gap is a list entry, and closing one restricts nothing.
CREATE FUNCTION "public"."gap_close"(gap uuid, decision uuid, by_staff uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  g public.restore_gaps;
  dec public.decisions;
  v_role text;
  v_fits boolean;
  v_target jsonb;
BEGIN
  SELECT x.* INTO g FROM public.restore_gaps x WHERE x.id = gap_close.gap FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF g.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'gap_mismatch' USING DETAIL = 'The gap is closed already.';
  END IF;

  IF gap_close.decision IS NULL THEN
    SELECT u.role::text INTO v_role FROM auth.users u
     WHERE u.id = gap_close.by_staff AND u.deleted_at IS NULL AND u.role <> 'user' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'staff_confirmation_ended';
    END IF;
    IF v_role <> 'admin' THEN
      RAISE EXCEPTION 'admin_required';
    END IF;
    UPDATE public.restore_gaps x SET closed_at = now(), disposition = 'not_needed' WHERE x.id = g.id;
    RETURN;
  END IF;

  SELECT x.* INTO dec FROM public.decisions x WHERE x.id = gap_close.decision;
  IF NOT FOUND OR dec.xact IS DISTINCT FROM pg_current_xact_id() OR dec.decided_at IS DISTINCT FROM now() OR dec.decided_by IS DISTINCT FROM gap_close.by_staff THEN
    RAISE EXCEPTION 'gap_mismatch' USING DETAIL = 'decision: not a decision this transaction made by the acting account.';
  END IF;
  -- A measure is a row that reverses nothing; a reversal names the measure it lifts.
  v_fits := CASE g.class
    WHEN 'order_effect' THEN dec.kind::text = 'order' AND g.target_type = 'order_item' AND dec.order_item_id::text IS NOT DISTINCT FROM g.target_id
    WHEN 'seal_final' THEN dec.kind::text = 'final' AND EXISTS (SELECT 1 FROM public.decision_actions a WHERE a.decision_id = dec.id AND a.kind::text = 'seal_media')
    WHEN 'seal_interim' THEN dec.kind::text = 'interim' AND EXISTS (SELECT 1 FROM public.decision_actions a WHERE a.decision_id = dec.id AND a.kind::text = 'seal_media')
    WHEN 'standing' THEN EXISTS (SELECT 1 FROM public.decision_actions a WHERE a.decision_id = dec.id AND a.kind::text IN ('suspend', 'terminate'))
    WHEN 'restriction' THEN EXISTS (SELECT 1 FROM public.decision_actions a
                                     WHERE a.decision_id = dec.id AND a.reverses_action_id IS NULL AND a.kind::text NOT IN ('seal_media', 'suspend', 'terminate', 'disable_by_order'))
    WHEN 'reversal' THEN EXISTS (SELECT 1 FROM public.decision_actions a WHERE a.decision_id = dec.id AND a.reverses_action_id IS NOT NULL)
    WHEN 'no_measure' THEN true
    ELSE false
  END;
  IF NOT v_fits THEN
    RAISE EXCEPTION 'gap_mismatch' USING DETAIL = 'class: the decision does not take again what the gap lost.';
  END IF;
  IF g.class <> 'order_effect' AND g.metadata ? 'target' THEN
    SELECT jsonb_build_object('type', c.target_type, 'id', c.target_id) INTO v_target FROM public.cases c WHERE c.id = dec.case_id;
    IF v_target IS DISTINCT FROM g.metadata -> 'target' THEN
      RAISE EXCEPTION 'gap_mismatch' USING DETAIL = 'target: the decision''s case is about another target than the lost decision''s.';
    END IF;
  END IF;
  UPDATE public.restore_gaps x SET closed_at = now(), closed_by = dec.id, disposition = 'reapplied' WHERE x.id = g.id;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."gap_close"(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."gap_close"(uuid, uuid, uuid) TO korbat_api;--> statement-breakpoint

-- 4. restore_gaps_confirmed, deferred to the commit: a gap closed as not needed stands only with its audit row, as a
-- console's order event does (legal_order_events_confirmed). The transaction's head audit row must be gap_closed on this
-- gap, carry a step-up and have been written by a live admin: the gap stores no account for this disposition, so the check
-- takes the audit row's actor. Otherwise the commit is refused (gap_mismatch). A gap closed with a decision needs no check
-- of its own: that decision's decision_holds covers the transaction. So no statement run as the API's role can empty the
-- list of gaps, which is what opens the app's site after a restore, without a key. It only reads, so the audit row stays
-- the transaction's last write; it runs as its owner, which reads the audit head whatever the caller holds.
CREATE FUNCTION "public"."restore_gaps_confirmed"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a public.audit_log;
BEGIN
  SELECT l.* INTO a FROM public.audit_head h JOIN public.audit_log l ON l.chain_seq = h.seq WHERE h.id = 1;
  IF NOT FOUND OR a.action IS DISTINCT FROM 'gap_closed' OR a.target_type IS DISTINCT FROM 'restore_gap' OR a.target_id IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION 'gap_mismatch' USING DETAIL = 'audit: the transaction''s last audit row is not gap_closed on this gap.';
  END IF;
  IF a.step_up IS NULL THEN
    RAISE EXCEPTION 'gap_mismatch' USING DETAIL = 'stepUp: the audit row carries no confirmation.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = a.actor_id AND u.deleted_at IS NULL AND u.role = 'admin') THEN
    RAISE EXCEPTION 'gap_mismatch' USING DETAIL = 'actor: the audit row was not written by an admin.';
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."restore_gaps_confirmed"() FROM PUBLIC;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "restore_gaps_confirmed" AFTER UPDATE ON "public"."restore_gaps" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.disposition = 'not_needed' AND OLD.disposition IS DISTINCT FROM 'not_needed') EXECUTE FUNCTION "public"."restore_gaps_confirmed"();--> statement-breakpoint

-- 5. delete_restore_gaps: not_due unless older_than is at least gap_keep_months back; then it deletes the gaps closed
-- before older_than as not_needed or imported, and the copy marks older than it but the newest. A gap that a decision
-- closed (reapplied) is never deleted: the statement of a decision taken again reads the lost decision's day from it, at
-- every opening, for as long as the ledger keeps the decision. Answers how many rows it deleted, and nothing else.
CREATE FUNCTION "public"."delete_restore_gaps"(older_than timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rows integer;
  v_deleted integer := 0;
BEGIN
  IF delete_restore_gaps.older_than IS NULL
     OR delete_restore_gaps.older_than > now() - make_interval(months => (SELECT r.gap_keep_months FROM public.order_rules() r)) THEN
    RAISE EXCEPTION 'not_due';
  END IF;

  DELETE FROM public.restore_gaps g
   WHERE g.disposition IN ('not_needed', 'imported') AND g.closed_at < delete_restore_gaps.older_than;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_deleted := v_deleted + v_rows;

  -- The newest mark stays, however old: it is what says when the copy was last taken.
  DELETE FROM public.copy_marks m
   WHERE m.at < delete_restore_gaps.older_than
     AND m.id <> (SELECT x.id FROM public.copy_marks x ORDER BY x.at DESC, x.id DESC LIMIT 1);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_deleted + v_rows;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."delete_restore_gaps"(timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."delete_restore_gaps"(timestamptz) TO korbat_api;--> statement-breakpoint

-- 6. legal_order_events_confirmed, replaced (0028). Everything 0027 and 0028 say of it stands, with one exemption: an
-- order the import wrote again after a restore (imported_at is set; only the migrator writes that column) keeps its
-- console events with their original times, and an event dated before the import is one the lost database had confirmed,
-- whose audit row is in the keeper's file and not in this transaction. Every event the console writes afterwards is
-- dated by the clock after the import committed (the insert trigger forces the clock's time for the API role, and
-- order_event_record, order_correct and the ledger stamp clock_timestamp()), so it is checked as before.
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
  -- 0031: an imported order's events from before its import were confirmed in the lost database.
  IF EXISTS (SELECT 1 FROM public.legal_orders o WHERE o.id = NEW.order_id AND o.imported_at IS NOT NULL AND NEW.at < o.imported_at) THEN
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

-- 7. alert_steps(), replaced from its text in 0030_authority_records with section 6.1's row marked 0029: copy_overdue.
-- Every other line is 0030's, unchanged.
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

  -- 0030 (3f design, section 6.1, the rows marked 0028): report_owed, daily, while at least one notification record is
  -- owed and was opened more than report_alert_hours ago; facts: how many, and the oldest's opening. Counts, no case.
  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts)
  SELECT 'report_owed', 5, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'report_owed' AND o.message_id IS NULL AND o.order_id IS NULL), 0),
         jsonb_build_object('count', q.owed, 'oldestAt', public.alert_time(q.oldest_at))
    FROM (SELECT count(*)::integer AS owed, min(n.opened_at) AS oldest_at
            FROM public.authority_notifications n
           WHERE n.state = 'owed' AND n.opened_at < v_now - make_interval(hours => r.report_alert_hours)) q
   WHERE q.owed > 0
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'report_owed' AND o.message_id IS NULL AND o.order_id IS NULL AND o.created_at >= v_now - make_interval(days => 1))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  -- handover_undestroyed, daily, while a production holds files, was delivered more than handover_alert_days ago and has
  -- no destroyed_at; facts: how many.
  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts)
  SELECT 'handover_undestroyed', 3, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'handover_undestroyed' AND o.message_id IS NULL AND o.order_id IS NULL), 0),
         jsonb_build_object('count', q.undestroyed)
    FROM (SELECT count(*)::integer AS undestroyed
            FROM public.productions p
           WHERE p.files IS NOT NULL AND p.destroyed_at IS NULL AND p.delivered_at < v_now - make_interval(days => r.handover_alert_days)) q
   WHERE q.undestroyed > 0
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'handover_undestroyed' AND o.message_id IS NULL AND o.order_id IS NULL AND o.created_at >= v_now - make_interval(days => 1))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  -- 0031 (3f design, section 6.1, the row marked 0029): copy_overdue, daily, while the newest copy mark is older than
  -- copy_overdue_hours, or there is none and the audit log's first row is that old; facts: the hours since the newest
  -- mark, or since that first row. This function is its one writer: no round of the API raises it as well.
  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts)
  SELECT 'copy_overdue', 3, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'copy_overdue' AND o.message_id IS NULL AND o.order_id IS NULL), 0),
         jsonb_build_object('hours', floor(extract(epoch FROM v_now - q.since) / extract(epoch FROM make_interval(hours => 1)))::integer)
    FROM (SELECT coalesce((SELECT m.at FROM public.copy_marks m ORDER BY m.at DESC, m.id DESC LIMIT 1),
                          (SELECT l.created_at FROM public.audit_log l ORDER BY l.chain_seq LIMIT 1)) AS since) q
   WHERE q.since IS NOT NULL AND q.since < v_now - make_interval(hours => r.copy_overdue_hours)
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'copy_overdue' AND o.message_id IS NULL AND o.order_id IS NULL AND o.created_at >= v_now - make_interval(days => 1))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  RETURN v_written;
END $$;

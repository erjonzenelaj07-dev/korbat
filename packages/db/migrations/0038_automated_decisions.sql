ALTER TYPE "public"."intake_channel" ADD VALUE 'system';--> statement-breakpoint
ALTER TYPE "public"."intake_kind" ADD VALUE 'automated';--> statement-breakpoint
CREATE TABLE "automated_objections" (
	"decision_id" uuid PRIMARY KEY NOT NULL,
	"text" text,
	"created_at" timestamp with time zone NOT NULL,
	"erased_at" timestamp with time zone,
	CONSTRAINT "automated_objections_text" CHECK (("automated_objections"."text" is null) = ("automated_objections"."erased_at" is not null) and char_length("automated_objections"."text") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "automated_objections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "automated_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"media_id" uuid NOT NULL,
	"score" real,
	"threshold_version" smallint,
	"match_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"intake_item_id" uuid,
	"decision_id" uuid,
	"handled_at" timestamp with time zone,
	"handled" text,
	CONSTRAINT "automated_signals_kind" CHECK ("automated_signals"."kind" in ('r1_score', 'known_match')),
	CONSTRAINT "automated_signals_handled" CHECK ("automated_signals"."handled" in ('finding', 'measure', 'capped', 'covered', 'gone')),
	CONSTRAINT "automated_signals_handled_at" CHECK (("automated_signals"."handled_at" is null) = ("automated_signals"."handled" is null)),
	CONSTRAINT "automated_signals_score" CHECK ((("automated_signals"."score" is not null and "automated_signals"."threshold_version" is not null) = ("automated_signals"."kind" = 'r1_score')) and (("automated_signals"."match_id" is not null) = ("automated_signals"."kind" = 'known_match'))),
	CONSTRAINT "automated_signals_score_range" CHECK ("automated_signals"."score" is null or ("automated_signals"."score" >= 0 and "automated_signals"."score" <= 1))
);
--> statement-breakpoint
ALTER TABLE "automated_signals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "decisions" DROP CONSTRAINT "decisions_restricted";--> statement-breakpoint
ALTER TABLE "intakes" DROP CONSTRAINT "intakes_has_ground";--> statement-breakpoint
ALTER TABLE "intakes" DROP CONSTRAINT "intakes_finding";--> statement-breakpoint
ALTER TABLE "intakes" DROP CONSTRAINT "intakes_r2_finding_only";--> statement-breakpoint
ALTER TABLE "alert_outbox" DROP CONSTRAINT "alert_outbox_kind";--> statement-breakpoint
ALTER TABLE "decisions" ALTER COLUMN "decided_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "automated_objections" ADD CONSTRAINT "automated_objections_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automated_signals" ADD CONSTRAINT "automated_signals_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automated_signals_one" ON "automated_signals" USING btree ("media_id","kind");--> statement-breakpoint
CREATE INDEX "automated_signals_open" ON "automated_signals" USING btree ("media_id","kind") WHERE handled_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "automated_signals_item" ON "automated_signals" USING btree ("intake_item_id") WHERE intake_item_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "automated_signals_decision" ON "automated_signals" USING btree ("decision_id") WHERE decision_id is not null;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_decider" CHECK (("decisions"."decided_by" is null) = ("decisions"."automated_decision" = 'fully') and ("decisions"."decided_by" is not null or "decisions"."kind"::text = 'interim'));--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_restricted" CHECK ("decisions"."outcome" <> 'restricted' or ("decisions"."ground" is not null and (("decisions"."facts_digest" is not null and "decisions"."reason_digest" is not null) or "decisions"."decided_by" is null)) or "decisions"."kind"::text = 'order');--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_automated" CHECK ("intakes"."kind"::text <> 'automated' or ("intakes"."automated_processing" and ("intakes"."rule_id" is null or "intakes"."rule_id" in ('R1', 'R2')) and not "intakes"."alleges_illegal" and not "intakes"."csam" and "intakes"."reporter_id" is null and "intakes"."contact_id" is null and "intakes"."finding_by" is null));--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_has_ground" CHECK ("intakes"."rule_id" is not null or "intakes"."alleges_illegal" or "intakes"."csam" or "intakes"."kind"::text = 'automated');--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_finding" CHECK (("intakes"."kind" = 'finding') = ("intakes"."finding_by" is not null) and ("intakes"."kind" = 'finding') = ("intakes"."channel" = 'staff') and ("intakes"."kind"::text = 'automated') = ("intakes"."channel"::text = 'system'));--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_r2_finding_only" CHECK ("intakes"."rule_id" is distinct from 'R2' or "intakes"."kind"::text in ('finding', 'automated'));--> statement-breakpoint
ALTER TABLE "alert_outbox" ADD CONSTRAINT "alert_outbox_kind" CHECK ("alert_outbox"."kind" in ('contact_mail', 'contact_mail_escalated', 'order_due', 'order_opened', 'order_corrected', 'order_effected', 'order_reinstated', 'order_unverified', 'hold_ending', 'report_owed', 'handover_undestroyed', 'copy_overdue', 'copy_taken', 'alert_channel_down', 'mailbox_unreachable', 'alert_test', 'moderation_urgent', 'moderation_waiting', 'moderation_burst', 'moderation_reads', 'moderation_reveal', 'moderation_csam_lifted', 'quarantine_due', 'quarantine_lost', 'release_undestroyed', 'seal_released', 'edge_purge_failed', 'head_unwitnessed', 'head_missed', 'automated_objection', 'automation_capped', 'automated_waiting'));--> statement-breakpoint
CREATE POLICY "automated_objections_api_all" ON "automated_objections" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "automated_signals_api_all" ON "automated_signals" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
-- Everything below is written by hand (3d design, sections 2 rows 14 to 18 and 25, 5 "The lock order", 6 and 6.6; Task 6).
-- The design numbers this migration 0035; earlier tasks of 3d added migrations the design did not foresee, so it is 0038.
-- As in 0016 to 0037: every function is owned by the migrator, pins its search path to public and pg_temp, names every
-- object schema-qualified and has EXECUTE taken from PUBLIC; an error carries its code as the message under SQLSTATE
-- P0001, and a guard's refusal is moderation_column under SQLSTATE 42501, as 3c's guards answer. "For every role but the
-- migrator" means current_user <> 'korbat_migrate'.
--
-- The rule for the two new values (section 6): ALTER TYPE ... ADD VALUE cannot be used as a literal of the enum before
-- the migrating transaction commits (55P04), and drizzle runs every pending migration in one transaction. So `automated`
-- and `system` are named as enum literals only inside PL/pgSQL bodies, which are parsed when first called; every CHECK
-- above compares kind::text and channel::text; no index predicate and no default names one; and no statement here runs a
-- function that touches one. The source test enum-literals.test.ts reads this file under that rule.
--
-- 1. The grants. 0001's default privileges gave the API role every right on a new public table; each table loses them
-- all, then gets what section 6.6 lists. automated_signals: the API's role reads, inserts and sets the last four columns
-- (the finding's item, the decision, and when and how the signal was handled), each once by the guard below; no DELETE (the
-- retention of signals is a later task's, as a definer function). automated_objections: it reads and inserts, and neither
-- updates nor deletes: an objection is answered by a person's decision, which stores nothing on it.
REVOKE ALL ON "public"."automated_signals" FROM korbat_api;--> statement-breakpoint
GRANT SELECT, INSERT ON "public"."automated_signals" TO korbat_api;--> statement-breakpoint
GRANT UPDATE ("intake_item_id", "decision_id", "handled_at", "handled") ON "public"."automated_signals" TO korbat_api;--> statement-breakpoint
REVOKE ALL ON "public"."automated_objections" FROM korbat_api;--> statement-breakpoint
GRANT SELECT, INSERT ON "public"."automated_objections" TO korbat_api;--> statement-breakpoint

-- 2. automation_rules(): the program's numbers (section 6.6's table), mirrored by the contracts' AUTOMATION_RULES, which a
-- database test holds member for column. The caps by rule and the two limits on unanswered measures (row 18); the R1
-- threshold, null until the owner's build task measures one and replaces this function, with its version (row 23); the
-- published target of an answer to a request for a person (row 25); and the numbers of known material (rows 33 to 37),
-- which the migration of known material reads. Every number is the owner's to overturn.
CREATE FUNCTION "public"."automation_rules"() RETURNS TABLE (decisions_per_hour integer, decisions_per_day integer, r2_decisions_per_hour integer, r2_decisions_per_day integer, unanswered_max integer, unanswered_hours integer, r1_threshold real, r1_threshold_version smallint, objection_target_hours integer, match_timeout_ms integer, match_retry_hours integer, matcher_down_minutes integer, refusals_per_hour integer, no_report_hours integer, pdq_min_quality integer, match_keep_days integer)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT 20, 100, 20, 100, 20, 72, NULL::real, 1::smallint, 24, 3000, 24, 15, 20, 24, 50, 180
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."automation_rules"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."automation_rules"() TO korbat_api;--> statement-breakpoint

-- 3. automated_signals_insert, plain, BEFORE INSERT: the signal is born unhandled, tied to no item and no decision, at
-- now(), whatever the insert supplied, for every role.
CREATE FUNCTION "public"."automated_signals_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.created_at := now();
  NEW.intake_item_id := NULL;
  NEW.decision_id := NULL;
  NEW.handled_at := NULL;
  NEW.handled := NULL;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."automated_signals_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "automated_signals_insert" BEFORE INSERT ON "public"."automated_signals" FOR EACH ROW EXECUTE FUNCTION "public"."automated_signals_insert"();--> statement-breakpoint

-- 4. automated_signals_guard, plain, BEFORE UPDATE, for every role but the migrator: each of the four columns the API may
-- set changes only from null, and nothing else of the row changes, so a signal is never pointed at a second item or a
-- second decision and a handled signal is never handled again. handled_at is forced to now() when it is first set.
CREATE FUNCTION "public"."automated_signals_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'korbat_migrate' THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.media_id IS DISTINCT FROM OLD.media_id
     OR NEW.score IS DISTINCT FROM OLD.score OR NEW.threshold_version IS DISTINCT FROM OLD.threshold_version
     OR NEW.match_id IS DISTINCT FROM OLD.match_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.intake_item_id IS NOT NULL AND NEW.intake_item_id IS DISTINCT FROM OLD.intake_item_id)
     OR (OLD.decision_id IS NOT NULL AND NEW.decision_id IS DISTINCT FROM OLD.decision_id)
     OR (OLD.handled_at IS NOT NULL AND NEW.handled_at IS DISTINCT FROM OLD.handled_at)
     OR (OLD.handled IS NOT NULL AND NEW.handled IS DISTINCT FROM OLD.handled) THEN
    RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
  END IF;
  IF OLD.handled_at IS NULL AND NEW.handled_at IS NOT NULL THEN
    NEW.handled_at := now();
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."automated_signals_guard"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "automated_signals_guard" BEFORE UPDATE ON "public"."automated_signals" FOR EACH ROW EXECUTE FUNCTION "public"."automated_signals_guard"();--> statement-breakpoint

-- 5. automated_objections_insert, SECURITY DEFINER, BEFORE INSERT ("Ask for a person", section 7.10): objection_not_open
-- unless the decision has no decider and a measure of it is in force. It runs as its owner, so it reads the view of
-- measures in force whatever the caller may read. A second text for the same decision meets the primary key, which the
-- route answers with the same code. created_at is now(), and a new objection is never erased.
CREATE FUNCTION "public"."automated_objections_insert"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW.created_at := now();
  NEW.erased_at := NULL;
  IF NOT EXISTS (SELECT 1 FROM public.decisions d WHERE d.id = NEW.decision_id AND d.decided_by IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.decision_id = NEW.decision_id) THEN
    RAISE EXCEPTION 'objection_not_open';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."automated_objections_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "automated_objections_insert" BEFORE INSERT ON "public"."automated_objections" FOR EACH ROW EXECUTE FUNCTION "public"."automated_objections_insert"();--> statement-breakpoint

-- 6. Nothing else is created, and no function that 3c, 3e or 3f built is touched but the two below. strike_due (0021) is
-- asked by decision_holds for a final decision only, so a program's decision, always interim, is never due a strike;
-- decision_actions_check is not replaced: its step 3 refuses a final measure in an interim decision, its step 7 a seal
-- that rests on no suspect item under R2, and its step 9 reads a role only for the kinds that need an admin, which a
-- program's decision never holds. decisions_apply and measures_in_force are untouched: a program's measure ends with
-- the case's final decision, a seal with the answer to its suspect items, and a person's correction lifts either at once.

-- 7. decisions_record, replaced (0032). Everything 0016, 0017, 0021, 0028 and 0032 say of it stands, stated again in full,
-- with 3d's changes (section 6.6) and no other: the two automation columns are no longer forced to false and
-- not_automated (without a decider true and fully, with one set in step 6); step 2 asks of a decision without a decider
-- the kind interim, the ground incompatible, R1 or R2, no text and no order's item; step 5's one read also says whether a
-- considered item is of a program's finding, of one citing R2 and of one citing the decision's rule, which a decision
-- without a decider must consider, and recusal is not asked of the system; step 6 reads no role without a decider, refuses
-- already_protected, and sets the automation columns of a decision with one; step 7's lock key ends in system without a
-- decider, whose caps are counted by rule against automation_rules() with the two limits on unanswered measures
-- (automation_capped, the limit met as its detail); step 9's source is own_initiative without a decider. The new
-- values of intake_kind are named only inside this PL/pgSQL body (the enum-literal rule).
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
  -- 0038: what the considered items say of a program's finding, the program's rules, and its count of measures in force.
  considers_automated boolean;
  considers_automated_r2 boolean;
  considers_automated_rule boolean;
  auto_rules record;
  unanswered integer;
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
  -- 0038 (3d design, section 6.6): no longer forced to false and not_automated for every decision. Without a decider they
  -- are true and fully; with one they start as false and not_automated and step 6 sets them from what is considered.
  IF NEW.decided_by IS NULL THEN
    NEW.automated_detection := true;
    NEW.automated_decision := 'fully';
  ELSE
    NEW.automated_detection := false;
    NEW.automated_decision := 'not_automated';
  END IF;
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
  -- 0038: a decision without a decider (a program's) is interim, on the ground incompatible under rule R1 or R2, with no
  -- staff text and no order's item; the built interim branch below then asks for the outcome restricted on an open case.
  IF NEW.decided_by IS NULL AND (NEW.kind IS DISTINCT FROM 'interim' OR NEW.ground IS DISTINCT FROM 'incompatible' OR NEW.rule_id IS NULL
       OR NEW.rule_id NOT IN ('R1', 'R2') OR NEW.facts_digest IS NOT NULL OR NEW.reason_digest IS NOT NULL
       OR NEW.legal_reference_digest IS NOT NULL OR NEW.order_item_id IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A decision without a decider is interim, on the ground incompatible under R1 or R2, with no text and no order''s item.';
  END IF;
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
         coalesce(bool_or(n.kind = 'user'), false),
         -- 0038: whether a considered item is of a program's finding; of one citing R2; of one citing this decision's rule.
         coalesce(bool_or(n.kind = 'automated'), false),
         coalesce(bool_or(n.kind = 'automated' AND n.rule_id = 'R2'), false),
         coalesce(bool_or(n.kind = 'automated' AND n.rule_id IS NOT DISTINCT FROM NEW.rule_id), false)
    INTO reporters, considers_suspect, considers_illegal, considers_r5, from_notice, from_user, considers_automated, considers_automated_r2, considers_automated_rule
    FROM public.intake_items i JOIN public.intakes n ON n.id = i.intake_id
   WHERE i.case_id = NEW.case_id
     AND CASE WHEN NEW.kind = 'order' THEN i.id = oi.intake_item_id AND i.answered_by IS NULL
              WHEN NEW.kind = 'final' THEN i.seq BETWEEN NEW.answers_from_seq AND NEW.through_seq AND n.kind <> 'order'
              WHEN NEW.kind IN ('correction', 'review') AND reviewed.kind IN ('final', 'order') THEN i.answered_by = reviewed.id
              ELSE i.answered_by IS NULL AND n.kind <> 'order' END;
  -- 0038: a decision without a decider rests on a program's finding under its own rule.
  IF NEW.decided_by IS NULL AND NOT considers_automated_rule THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A decision without a decider considers a program''s finding under its own rule.';
  END IF;
  -- 3f (row 13): an order leaves no discretion in either direction, so recusal is asked neither of an order decision nor
  -- of the correction that reinstates. 0038: nor of a decision without a decider: the system is no party.
  IF NEW.kind <> 'order' AND NOT (NEW.kind = 'correction' AND reviewed.kind = 'order') AND NEW.decided_by IS NOT NULL
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
  -- 0038: without a decider no auth.users row is read (the lock order, item 2), and needs_admin is false below as for
  -- every interim decision.
  IF NEW.decided_by IS NOT NULL THEN
    SELECT u.role::text INTO decider_role FROM auth.users u WHERE u.id = NEW.decided_by FOR SHARE;
  END IF;
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
  -- 0038 (section 2 row 26, 6.6): what a decision with a decider records of automated means, whatever the request said. A
  -- decision taken while deciding or deciding the case: detected when it considers a program's finding; partially
  -- automated when it restricts, is suspect and considers a program's finding citing R2, since the person cannot look at
  -- a matched image and the comparison is a fact it rests on. A review or a correction takes its reviewed decision's
  -- detection and is not automated. No decision with a decider can read fully.
  IF NEW.decided_by IS NOT NULL THEN
    IF NEW.kind IN ('interim', 'final') THEN
      NEW.automated_detection := considers_automated;
      NEW.automated_decision := CASE WHEN NEW.outcome = 'restricted' AND NEW.suspect AND considers_automated_r2 THEN 'partially' ELSE 'not_automated' END;
    ELSIF NEW.kind IN ('correction', 'review') THEN
      NEW.automated_detection := reviewed.automated_detection;
      NEW.automated_decision := 'not_automated';
    END IF;
  ELSE
    -- 0038: a program takes no measure where one already protects what it would protect (LAB C3, C4: the built code
    -- accepts a second seal while one stands; a person may still take one, a program may not). Under R2: a seal in force
    -- lists the case's post. Under R1: a withhold of the post is in force, or a withhold_media is in force for the image of
    -- every unanswered program's finding of the case that cites R1.
    IF NEW.rule_id = 'R2' AND EXISTS (SELECT 1 FROM public.seal_posts s JOIN public.measures_in_force m ON m.id = s.action_id
                                       WHERE c.target_type = 'post' AND s.post_id = c.target_id) THEN
      RAISE EXCEPTION 'already_protected';
    END IF;
    IF NEW.rule_id = 'R1' AND (
         EXISTS (SELECT 1 FROM public.measures_in_force m WHERE c.target_type = 'post' AND m.kind = 'withhold' AND m.post_id = c.target_id)
         OR NOT EXISTS (SELECT 1 FROM public.intake_items i JOIN public.intakes n ON n.id = i.intake_id
                         WHERE i.case_id = c.id AND i.answered_by IS NULL AND n.kind = 'automated' AND n.rule_id = 'R1'
                           AND NOT EXISTS (SELECT 1 FROM public.measures_in_force m
                                            WHERE m.case_id = c.id AND m.kind = 'withhold_media' AND m.media_id IS NOT DISTINCT FROM i.media_id))) THEN
      RAISE EXCEPTION 'already_protected';
    END IF;
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
  -- no order decision and refuse none; an order decision has its own cap, counted under the same lock. 0038: "no decider"
  -- is one decider, the system, whose key ends in system, so two programs' decisions count each other one after the other.
  -- The counts are two branches, decided_by = NEW.decided_by with a decider and decided_by IS NULL without, so that either
  -- stays on decisions_decided_by_idx; a person's caps count no system decision.
  PERFORM pg_advisory_xact_lock(hashtextextended('korbat.decision_cap:' || coalesce(NEW.decided_by::text, 'system'), 0));
  IF NEW.decided_by IS NOT NULL THEN
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
  ELSE
    -- 0038 (section 2 row 18, 6.6, 7.9 step 2.5): the program's four limits, each read from automation_rules(), the first
    -- three for this decision's rule alone, so a burst of scores never uses up the seals of known matches. Each refusal is
    -- automation_capped with the limit met as its detail (the contracts' CAP_LIMITS); the step then keeps the finding.
    SELECT r.* INTO auto_rules FROM public.automation_rules() r;
    SELECT count(*) FILTER (WHERE d.decided_at > now() - make_interval(hours => 1)), count(*) INTO in_hour, in_day
      FROM public.decisions d WHERE d.decided_by IS NULL AND d.rule_id = NEW.rule_id AND d.decided_at > now() - make_interval(days => 1);
    IF in_hour >= (CASE WHEN NEW.rule_id = 'R2' THEN auto_rules.r2_decisions_per_hour ELSE auto_rules.decisions_per_hour END) THEN
      RAISE EXCEPTION 'automation_capped' USING DETAIL = 'hour';
    END IF;
    IF in_day >= (CASE WHEN NEW.rule_id = 'R2' THEN auto_rules.r2_decisions_per_day ELSE auto_rules.decisions_per_day END) THEN
      RAISE EXCEPTION 'automation_capped' USING DETAIL = 'day';
    END IF;
    -- Two limits that end nothing and only stop new measures while no person answers: this rule's measures of decisions
    -- without a decider in force, and, under either rule, a request for a person whose measure is in force and that has
    -- waited longer than unanswered_hours.
    SELECT count(*) INTO unanswered FROM public.measures_in_force m JOIN public.decisions d ON d.id = m.decision_id
     WHERE d.decided_by IS NULL AND d.rule_id = NEW.rule_id;
    IF unanswered >= auto_rules.unanswered_max THEN
      RAISE EXCEPTION 'automation_capped' USING DETAIL = 'unanswered';
    END IF;
    -- The alias is not o, which names this function's order variable.
    IF EXISTS (SELECT 1 FROM public.automated_objections obj
                WHERE obj.created_at < now() - make_interval(hours => auto_rules.unanswered_hours)
                  AND EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.decision_id = obj.decision_id)) THEN
      RAISE EXCEPTION 'automation_capped' USING DETAIL = 'waiting';
    END IF;
  END IF;

  -- 8.
  IF (NEW.ground IS NOT DISTINCT FROM 'illegal' OR NEW.outcome = 'not_evident') AND NOT considers_illegal THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'The ground of the law, and "illegality not evident", need a considered item that alleges illegality.';
  END IF;

  -- 9.
  -- 0038: a decision without a decider rests on its signal, not on a report, whatever other items wait on the case.
  NEW.source := CASE WHEN NEW.kind = 'order' THEN 'order'::public.decision_source
                     WHEN NEW.decided_by IS NULL THEN 'own_initiative'::public.decision_source
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


-- 8. decision_holds, replaced (0028). Everything 0016, 0021, 0025 and 0028 say of it stands, stated again in full, with
-- 3d's two parts for a decision without a decider (section 6.6) and no other change: (a) its head audit row carries no
-- step-up and no key, is the system's automated_decided on the decision's case, names in signalId the one signal whose
-- decision_id is this decision, whose image is an image of the case's post, and its params equal the decision's columns
-- and its ledger rows as case_decided's do; (b) it holds exactly one measure and no reversal, the one its signal's kind
-- allows. Every decision with a decider passes the built checks unchanged.
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
  -- 0038: a decision without a decider's one signal.
  sig public.automated_signals;
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
  IF d.decided_by IS NULL THEN
    -- 0038 (a), for a decision without a decider (3d design, sections 2 row 16 and 6.6): the head row carries no step-up
    -- and no key, was written by the system actor, and is automated_decided on the decision's case; it names in signalId
    -- the one signal whose decision_id is this decision, and that signal's image is an image of the case's post. Its
    -- params are compared below as case_decided's are.
    IF a.step_up IS NOT NULL OR a.key_id IS NOT NULL OR a.action_hash IS NOT NULL OR a.staff_session IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'stepUp: the audit row of a decision without a decider carries no confirmation and no key.';
    END IF;
    IF a.actor_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000000'::uuid THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'actor: the audit row of a decision without a decider is the system''s.';
    END IF;
    IF a.action IS DISTINCT FROM 'automated_decided' OR a.target_type IS DISTINCT FROM 'case' OR a.target_id IS DISTINCT FROM d.case_id::text THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'target: the audit row is not automated_decided on the decision''s case.';
    END IF;
    SELECT s.* INTO sig FROM public.automated_signals s WHERE s.decision_id = d.id;
    IF NOT FOUND OR a.metadata ->> 'signalId' IS DISTINCT FROM sig.id::text THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'signalId: the audit row does not name the one signal of this decision.';
    END IF;
    IF c.target_type IS DISTINCT FROM 'post' OR NOT EXISTS (SELECT 1 FROM public.post_media m WHERE m.id = sig.media_id AND m.post_id = c.target_id) THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'signalId: the signal''s image is not an image of the case''s post.';
    END IF;
    expected := jsonb_build_object('kind', d.kind, 'stateVersion', d.seen_state_version, 'throughSeq', d.through_seq,
      'reviewsDecisionId', d.reviews_decision_id, 'snapshotId', d.snapshot_id, 'snapshotDigest', d.snapshot_digest, 'outcome', d.outcome,
      'ground', d.ground, 'ruleId', d.rule_id, 'rulesVersion', d.rules_version, 'redressVersion', d.redress_version, 'category', d.category,
      'categoryKeyword', d.category_keyword, 'factsDigest', d.facts_digest, 'reasonDigest', d.reason_digest,
      'legalReferenceDigest', d.legal_reference_digest);
  ELSE
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
  -- 0038 (b), for a decision without a decider: exactly one measure and no reversal, the one its signal's kind allows: a
  -- withhold_media of the signal's image under R1 for a score, a seal_media under R2 for a match (LAB A2: two measures, a
  -- seal on an R1 finding). From the migration of known material on, the seal's signal must also name an acting record.
  IF d.decided_by IS NULL THEN
    IF measures <> 1 OR reversals <> 0 THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'actions: a decision without a decider holds exactly one measure and no reversal.';
    END IF;
    IF NOT ((sig.kind = 'r1_score' AND d.rule_id = 'R1'
             AND EXISTS (SELECT 1 FROM public.decision_actions x WHERE x.decision_id = d.id AND x.kind = 'withhold_media' AND x.media_id = sig.media_id))
         OR (sig.kind = 'known_match' AND d.rule_id = 'R2'
             AND EXISTS (SELECT 1 FROM public.decision_actions x WHERE x.decision_id = d.id AND x.kind = 'seal_media'))) THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'actions: the measure of a decision without a decider is not the one its signal allows.';
    END IF;
  END IF;
END $$;--> statement-breakpoint


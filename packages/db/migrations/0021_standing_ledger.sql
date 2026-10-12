-- The standing ledger (3e design, section 6.2). Written by hand: this migration changes no table. It adds the constants of
-- account sanctions, the views that say when a strike counts and when a suspension runs, the one writer of an account's
-- standing (standing_apply), the rule that says when a decision gives a strike (strike_due), the triggers of replies and of
-- a statement mail's outcome, and replaces one view and nine functions of migrations 0015 to 0018 (CREATE OR REPLACE
-- keeps each one's owner, grants and trigger; each is stated whole, as built, with the changes section 6.2 lists).
--
-- As in 0016 to 0019: every function is owned by the migrator, pins its search path, names every object
-- schema-qualified and has EXECUTE taken from PUBLIC; a trigger function fires for every role all the same; errors carry
-- their code as the message under SQLSTATE P0001 unless a SQLSTATE is named; times the database writes are now(), the
-- transaction's start, unless clock_timestamp() is named; and a read that follows a lock is a statement of its own, which
-- under READ COMMITTED sees every row committed while the lock waited.
--
-- The rule for the new values of action_kind. The schema migration before this one added ten values, and drizzle's
-- migrator runs both in one transaction: a value added there cannot be used as an enum literal before that transaction
-- commits (SQLSTATE 55P04) in anything parsed when it is created or run. So the ten values are named as enum literals only
-- inside PL/pgSQL bodies, which are parsed when first called (no statement here calls one); views and SQL-language
-- functions compare kind::text; and no check, default or index predicate names one. A source test holds this file to it.
-- Every number of 3e is read from standing_rules(), never typed as an interval.
--
-- measures_in_force, replaced: its list of measures gains the six of 3e, compared as text. For them "in force" means
-- that no row reverses them (none is ever taken while deciding), whatever the clock says: whether a strike still counts or
-- a suspension runs now is asked of active_strikes and suspension_periods below. Nothing else changes.
CREATE OR REPLACE VIEW "public"."measures_in_force" WITH (security_invoker = true) AS
SELECT a.id, a.kind, a.post_id, a.media_id, a.subject_account_id, d.id AS decision_id, d.kind AS decision_kind, d.case_id
  FROM public.decision_actions a
  JOIN public.decisions d ON d.id = a.decision_id
 WHERE a.kind::text IN ('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio', 'strike', 'suspend', 'terminate', 'retire_handle', 'warn_reporting', 'restrict_reporting')
   AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = a.id)
   AND (d.kind <> 'interim'
     OR CASE WHEN a.kind = 'seal_media'
          THEN EXISTS (SELECT 1 FROM public.intake_items i
                        WHERE i.case_id = d.case_id AND i.suspect AND i.answered_by IS NULL AND i.created_at <= d.decided_at)
          ELSE EXISTS (SELECT 1 FROM public.cases c WHERE c.id = d.case_id AND c.closed_at IS NULL)
        END);--> statement-breakpoint
-- The constants of account sanctions, one row of named values; the contracts' STANDING_RULES holds the same, and a
-- database test compares the two name by name. Every function and view below reads its numbers from here. Each is a
-- cautious default without a source of its own (3e design, section 2): one line to change.
CREATE FUNCTION "public"."standing_rules"() RETURNS TABLE (
  strike_days integer, ladder_strikes integer, ladder_days integer[], ladder_memory_days integer, reply_window_hours integer, undelivered_hours integer,
  threat_days integer, terrorist_days integer, flood_days integer, flood_posts integer, flood_minutes integer, protective_days integer, basis_age_days integer,
  report_frame_days integer, report_warn_marks integer, report_warn_share numeric, report_restrict_marks integer, report_restrict_days integer)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT 90, 3, ARRAY[3, 7, 30], 365, 168, 336, 30, 30, 7, 20, 60, 14, 30, 90, 5, 0.5, 3, 30
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."standing_rules"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."standing_rules"() TO korbat_api;--> statement-breakpoint
-- The strikes that count now: every strike that no overruling reversed and whose end of counting lies ahead of the clock.
-- A strike's account is its row's subject. Expiry writes nothing: the clock alone moves a strike out of this view.
CREATE VIEW "public"."active_strikes" WITH (security_invoker = true) AS
SELECT a.id AS action_id, a.subject_account_id AS account_id, a.decision_id, a.created_at, a.ends_at
  FROM public.decision_actions a
 WHERE a.kind::text = 'strike'
   AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = a.id)
   AND a.ends_at > clock_timestamp();--> statement-breakpoint
REVOKE ALL ON "public"."active_strikes" FROM korbat_api;--> statement-breakpoint
GRANT SELECT ON "public"."active_strikes" TO korbat_api;--> statement-breakpoint
-- Whether the basis of a standing measure, or of a restriction of reporting, still holds: null while it holds, else the
-- created_at of the reversal that broke it. It reads the ledger by primary key and by reverses_action_id. By basis:
--   - strikes, ladder_end: it holds while at least ladder_strikes of the decisions in rests_on still hold a strike that
--     no overruling reversed (a strike's expiry does not break it); the breaking reversal is the overruling that left
--     fewer standing, of those on its strikes in the order of created_at and id the one at position
--     cardinality(rests_on) - ladder_strikes + 1;
--   - threat, terrorist, threat_repeat: it holds while each decision in rests_on still holds a measure in force; for each
--     that holds none, its latest reversal broke it, and of those the earliest is the answer;
--   - protective: it holds while the decision in rests_on still holds its seal in force; the unseal that lifted it broke it;
--   - reports (a restriction of reporting): it holds while the decision in rests_on still holds its warning; the lift of
--     that warning broke it. A warning itself has no rests_on and always holds;
--   - flood: it always holds.
CREATE FUNCTION "public"."standing_basis_broken_at"(action uuid) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
           WHEN m.basis IN ('strikes', 'ladder_end') THEN (
             SELECT o.created_at
               FROM public.decision_actions s JOIN public.decision_actions o ON o.reverses_action_id = s.id
              WHERE s.decision_id = ANY(m.rests_on) AND s.kind::text = 'strike'
              ORDER BY o.created_at, o.id
             OFFSET greatest(0, cardinality(m.rests_on) - (SELECT k.ladder_strikes FROM public.standing_rules() k)) LIMIT 1)
           WHEN m.basis IN ('threat', 'terrorist', 'threat_repeat') THEN (
             SELECT min((SELECT max(r.created_at) FROM public.decision_actions x JOIN public.decision_actions r ON r.reverses_action_id = x.id WHERE x.decision_id = b.id))
               FROM unnest(m.rests_on) AS b(id)
              WHERE NOT EXISTS (SELECT 1 FROM public.measures_in_force f WHERE f.decision_id = b.id))
           WHEN m.basis = 'protective' THEN (
             SELECT r.created_at
               FROM public.decision_actions s JOIN public.decision_actions r ON r.reverses_action_id = s.id
              WHERE s.decision_id = m.rests_on[1] AND s.kind = 'seal_media')
           WHEN m.basis = 'reports' AND m.rests_on IS NOT NULL THEN (
             SELECT r.created_at
               FROM public.decision_actions w JOIN public.decision_actions r ON r.reverses_action_id = w.id
              WHERE w.decision_id = m.rests_on[1] AND w.kind::text = 'warn_reporting')
         END
    FROM public.decision_actions m
   WHERE m.id = standing_basis_broken_at.action
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."standing_basis_broken_at"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."standing_basis_broken_at"(uuid) TO korbat_api;--> statement-breakpoint
-- When each standing measure (a suspend or a terminate) runs: one row a measure that has a start and ends after it.
-- Its start is the first of these that applies, and no start of an announced measure lies before the row's starts_at,
-- the earliest start its statement names:
--   - taken at once: the row's created_at;
--   - announced, with a reply filed on time: once the reply is answered, the later of that answer and starts_at; null
--     while it waits (an answered on-time reply fixes the start whatever the mail did: the person read the notice);
--   - announced, the statement mail sent (korbat's own relay accepted it): the later of starts_at and the time it was
--     recorded sent plus the reply window;
--   - announced, the mail pending or none: null, so nothing starts while korbat does not know what became of the mail;
--   - announced, any other state (failed, or no_address for an account that is gone): the later of the decision plus the
--     undelivered window and the time that outcome was recorded, so a mail given up late never gives a start in the past.
-- A late reply changes nothing here: the mail's rows apply. Its end is infinity for a terminate, else the start plus
-- its days, cut to the reversal that lifted it and to the time its basis broke. A measure with no start, or one lifted
-- or broken at or before its start, has no row.
CREATE VIEW "public"."suspension_periods" WITH (security_invoker = true) AS
SELECT p.action_id, p.account_id, p.kind, p.decision_id, p.basis, p.starts_at, p.ends_at
  FROM (
    SELECT s.action_id, s.account_id, s.kind, s.decision_id, s.basis, s.start AS starts_at,
           least(CASE WHEN s.kind::text = 'terminate' THEN 'infinity'::timestamptz ELSE s.start + make_interval(days => s.days) END,
                 coalesce(s.lifted_at, 'infinity'::timestamptz),
                 coalesce(s.broken_at, 'infinity'::timestamptz)) AS ends_at
      FROM (
        SELECT a.id AS action_id, a.subject_account_id AS account_id, a.kind, a.decision_id, a.basis, a.days,
               CASE
                 WHEN NOT a.announced THEN a.created_at
                 WHEN r.on_time THEN CASE WHEN r.answered_at IS NULL THEN NULL ELSE greatest(a.starts_at, r.answered_at) END
                 WHEN d.author_mail = 'sent' THEN greatest(a.starts_at, d.author_mail_at + make_interval(hours => k.reply_window_hours))
                 WHEN d.author_mail IN ('pending', 'none') THEN NULL
                 ELSE greatest(a.starts_at, a.created_at + make_interval(hours => k.undelivered_hours), d.author_mail_at)
               END AS start,
               (SELECT x.created_at FROM public.decision_actions x WHERE x.reverses_action_id = a.id) AS lifted_at,
               public.standing_basis_broken_at(a.id) AS broken_at
          FROM public.decision_actions a
          JOIN public.decisions d ON d.id = a.decision_id
          LEFT JOIN public.suspension_replies r ON r.action_id = a.id
          CROSS JOIN public.standing_rules() k
         WHERE a.kind::text IN ('suspend', 'terminate')
      ) s
     WHERE s.start IS NOT NULL
  ) p
 WHERE p.ends_at > p.starts_at;--> statement-breakpoint
REVOKE ALL ON "public"."suspension_periods" FROM korbat_api;--> statement-breakpoint
GRANT SELECT ON "public"."suspension_periods" TO korbat_api;--> statement-breakpoint
-- Every standing measure that stands (no lift), whose basis holds, and whose period has not ended by the clock: one with
-- no start yet is in it. The rule standing_conflict keeps it at one row an account.
CREATE VIEW "public"."standing_live" WITH (security_invoker = true) AS
SELECT a.subject_account_id AS account_id, a.id AS action_id
  FROM public.decision_actions a
 WHERE a.kind::text IN ('suspend', 'terminate')
   AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = a.id)
   AND public.standing_basis_broken_at(a.id) IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.suspension_periods p WHERE p.action_id = a.id AND p.ends_at <= clock_timestamp());--> statement-breakpoint
REVOKE ALL ON "public"."standing_live" FROM korbat_api;--> statement-breakpoint
GRANT SELECT ON "public"."standing_live" TO korbat_api;--> statement-breakpoint
-- The one writer of profiles.suspended_from, suspended_until and reports_restricted_until. Its caller holds the account's
-- profile row. In this order: one statement reads the account's period that has not ended by the clock (the earliest
-- start first; there is at most one) and the latest end among the account's restrictions of reporting that stand and
-- whose basis holds; then one statement updates the row, only when it is not deleted and a value differs. A deleted
-- account's row is never written, as 3c's resets write nothing into a row the purge anonymised. Expiry needs no call: the
-- predicate of a write compares the columns with the clock, and a stale ended interval refuses nothing. Nobody may call
-- it: the ledger's triggers do, as its owner.
CREATE FUNCTION "public"."standing_apply"(account uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  period_from timestamptz;
  period_until timestamptz;
  reports_until timestamptz;
BEGIN
  -- 1.
  SELECT s.starts_at, s.ends_at,
         (SELECT max(a.starts_at + make_interval(days => a.days)) FROM public.decision_actions a
           WHERE a.subject_account_id = standing_apply.account AND a.kind = 'restrict_reporting'
             AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = a.id)
             AND public.standing_basis_broken_at(a.id) IS NULL)
    INTO period_from, period_until, reports_until
    FROM (SELECT 1) one
    LEFT JOIN LATERAL (SELECT p.starts_at, p.ends_at FROM public.suspension_periods p
                        WHERE p.account_id = standing_apply.account AND p.ends_at > clock_timestamp()
                        ORDER BY p.starts_at LIMIT 1) s ON true;
  -- 2.
  UPDATE public.profiles p
     SET suspended_from = period_from, suspended_until = period_until, reports_restricted_until = reports_until
   WHERE p.id = standing_apply.account AND p.deleted_at IS NULL
     AND (p.suspended_from IS DISTINCT FROM period_from OR p.suspended_until IS DISTINCT FROM period_until
          OR p.reports_restricted_until IS DISTINCT FROM reports_until);
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."standing_apply"(uuid) FROM PUBLIC;--> statement-breakpoint
-- Whether a final restriction of this case on this ground and rule, resting or not on a suspect item, gives a strike. The
-- console asks it before the form is sent, with leave_out null; decision_holds asks it at commit with its own decision,
-- which both reads below leave out. True when all of these hold, read in this order:
--   1. the case is about a post;
--   2. the ground is incompatible (a korbat rule), the rule is not R2, and the decision rests on no suspect item;
--   3. no strike that stands (no overruling reversed it, whatever the clock says) belongs to a decision of any case about
--      this post: a post gets at most one strike for as long as its strike is not overruled;
--   4. the post was created after the latest informed_at among the decisions that hold a standing strike of the post's
--      author, or the author has none: a post written before its author was told of their newest strike never gets one.
-- Two decisions about posts of one author run one after the other: each holds the author's profile row, which the API
-- takes first and decision_actions_check takes again for a strike.
CREATE FUNCTION "public"."strike_due"(case_id uuid, ground public.decision_ground, rule text, suspect boolean, leave_out uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c public.cases;
  post public.posts;
  last_told timestamptz;
BEGIN
  -- 1.
  SELECT k.* INTO c FROM public.cases k WHERE k.id = strike_due.case_id;
  IF NOT FOUND OR c.target_type <> 'post' THEN
    RETURN false;
  END IF;
  -- 2.
  IF strike_due.ground IS DISTINCT FROM 'incompatible' OR strike_due.rule IS NULL OR strike_due.rule = 'R2' OR coalesce(strike_due.suspect, true) THEN
    RETURN false;
  END IF;
  SELECT p.* INTO post FROM public.posts p WHERE p.id = c.target_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  -- 3.
  IF EXISTS (SELECT 1 FROM public.decision_actions a
               JOIN public.decisions d ON d.id = a.decision_id
               JOIN public.cases x ON x.id = d.case_id
              WHERE x.target_type = 'post' AND x.target_id = post.id AND a.kind = 'strike'
                AND d.id IS DISTINCT FROM strike_due.leave_out
                AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = a.id)) THEN
    RETURN false;
  END IF;
  -- 4.
  SELECT max(d.informed_at) INTO last_told
    FROM public.decision_actions a JOIN public.decisions d ON d.id = a.decision_id
   WHERE a.subject_account_id = post.author_id AND a.kind = 'strike'
     AND d.id IS DISTINCT FROM strike_due.leave_out
     AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = a.id);
  RETURN last_told IS NULL OR post.created_at > last_told;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."strike_due"(uuid, public.decision_ground, text, boolean, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."strike_due"(uuid, public.decision_ground, text, boolean, uuid) TO korbat_api;--> statement-breakpoint
-- The one statement of the moment from which a decision's six months to appeal run. For a decision that holds a standing
-- measure whose reply was filed on time and answered by a correction that kept the decision: the later of the
-- decision's informed_at and that correction's (the six months run anew from the answer, so a held start never outlasts
-- the appeal). For every other decision: its informed_at. Null for an id that names no decision.
CREATE FUNCTION "public"."appeal_informed_at"(decision uuid) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT greatest(d.informed_at,
                  (SELECT max(k.informed_at)
                     FROM public.decision_actions a
                     JOIN public.suspension_replies r ON r.action_id = a.id
                     JOIN public.decisions k ON k.id = r.answered_by
                    WHERE a.decision_id = d.id AND a.kind::text IN ('suspend', 'terminate') AND r.on_time
                      AND k.kind = 'correction' AND k.outcome = 'kept'))
    FROM public.decisions d
   WHERE d.id = appeal_informed_at.decision
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."appeal_informed_at"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."appeal_informed_at"(uuid) TO korbat_api;--> statement-breakpoint
-- decision_final_at, replaced (0018). When a decision is final for its author: for a final decision that restricts, null
-- while its author's appeal is pending, and also while a standing measure it holds has a reply filed on time that nobody
-- has answered (that reply holds the start, and the six months may run anew from its answer); the answer to the appeal
-- once answered; and, when none was filed, the end of the appeal's window counted from appeal_informed_at. For every other
-- decision the moment it was taken. Null for an id that names no decision.
CREATE OR REPLACE FUNCTION "public"."decision_final_at"(decision_id uuid) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
           WHEN d.kind = 'final' AND d.outcome = 'restricted'
             THEN CASE
                    WHEN EXISTS (SELECT 1 FROM public.decision_actions x JOIN public.suspension_replies r ON r.action_id = x.id
                                  WHERE x.decision_id = d.id AND x.kind::text IN ('suspend', 'terminate') AND r.on_time AND r.answered_by IS NULL) THEN NULL
                    WHEN a.id IS NULL THEN public.appeal_deadline(public.appeal_informed_at(d.id))
                    ELSE a.answered_at END
           ELSE d.decided_at
         END
    FROM public.decisions d
    LEFT JOIN public.appeals a ON a.decision_id = d.id
   WHERE d.id = decision_final_at.decision_id
$$;--> statement-breakpoint
-- review_needs_admin, replaced (0017). Whether the review of an appeal of this decision needs an admin, from stored facts
-- alone: true when the decision cites R2 or holds a seal, and now also when it holds a termination or a suspension taken
-- at once (only an admin takes those). A restriction of reporting starts at once too but needs no admin, so any other
-- moderator reviews it. False otherwise, also for a decision that does not exist.
CREATE OR REPLACE FUNCTION "public"."review_needs_admin"(decision uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT d.rule_id IS NOT DISTINCT FROM 'R2'
        OR EXISTS (SELECT 1 FROM public.decision_actions a WHERE a.decision_id = d.id AND a.kind = 'seal_media')
        OR EXISTS (SELECT 1 FROM public.decision_actions a
                    WHERE a.decision_id = d.id AND (a.kind::text = 'terminate' OR (a.kind::text = 'suspend' AND a.announced IS FALSE)))
      FROM public.decisions d WHERE d.id = review_needs_admin.decision), false)
$$;--> statement-breakpoint
-- item_current_outcome, replaced (0016). What an item's sender is shown as of a time: an item keeps the outcome its
-- answering decision wrote, and this reads it against the ledger. A restricted item reads "reversed" when every listed
-- measure of its answering decision was lifted by a reversal recorded before the time, "partly reversed" when some were,
-- else as written; any other item as written. The listed measures gain a retirement, a suspension and a termination,
-- compared as text: the account measures a reporter's item can meet (the ladder's measures, a protective suspension and
-- the reporting measures answer findings only). Never a strike: an item's line is the same with and without one. It
-- reads reversal rows only: a start or an end by the clock, a reply and its answer, and a broken basis change no line.
-- Nobody may call it: release_outcomes does, as its owner.
CREATE OR REPLACE FUNCTION "public"."item_current_outcome"(item uuid, at timestamptz) RETURNS "public"."item_outcome"
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
           WHEN i.outcome NOT IN ('restricted_rule', 'restricted_legal') THEN i.outcome
           WHEN m.measures > 0 AND m.lifted = m.measures THEN 'reversed'::public.item_outcome
           WHEN m.lifted > 0 THEN 'partly_reversed'::public.item_outcome
           ELSE i.outcome END
    FROM public.intake_items i
    LEFT JOIN LATERAL (
      SELECT count(*) AS measures,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.decision_actions r
                                             WHERE r.reverses_action_id = a.id AND r.created_at < item_current_outcome.at)) AS lifted
        FROM public.decision_actions a
       WHERE a.decision_id = i.answered_by
         AND a.kind::text IN ('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio', 'retire_handle', 'suspend', 'terminate')) m ON true
   WHERE i.id = item_current_outcome.item
$$;--> statement-breakpoint
-- appeals_check, replaced (0017). Everything 0017 says of it stands, with one change at step 4: the six months run from
-- appeal_informed_at, which for a decision whose standing measure a correction kept after a reply filed on time is the
-- later of the two decisions' informed_at, and for every other decision its informed_at.
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
  IF NOT (clock_timestamp() < public.appeal_deadline(public.appeal_informed_at(d.id))) THEN
    RAISE EXCEPTION 'appeal_not_open';
  END IF;

  -- 5.
  IF NOT EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.decision_id = d.id) THEN
    RAISE EXCEPTION 'appeal_not_open';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
-- decisions_record, replaced (0017). Everything 0016 and 0017 say of it stands, stated again in full since a replaced
-- function keeps nothing of its old body. Two changes, both for a correction:
--   2. A correction may also have the outcome kept, in two cases and no other (invalid_decision otherwise). It answers a
--      reply: the corrected decision holds a standing measure whose reply nobody has answered and whose basis holds (a
--      measure whose basis broke has no reply left to answer, since the reversal that broke it answered it). Or it
--      withdraws marks: the corrected decision is a final decision of the same case that found no breach and holds at
--      least one mark "manifestly unfounded" that is not withdrawn; this is the one correction of a decision that
--      restricted nothing. Like every correction, a kept one carries a reason and takes the corrected decision's
--      needs_admin.
--  10. A kept correction that answers a reply is mailed, like every correction of a decision its author was told of. One
--      that withdraws marks tells the author nothing: it concerns the people who reported.
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
    -- A kept correction may be about a final decision that found no breach (the withdrawal of its marks); every other
    -- correction is about a decision that restricted.
    SELECT d.* INTO reviewed FROM public.decisions d
     WHERE d.id = NEW.reviews_decision_id AND d.case_id = NEW.case_id AND d.kind IN ('interim', 'final')
       AND (d.outcome = 'restricted' OR (NEW.outcome = 'kept' AND d.kind = 'final' AND d.outcome = 'no_violation'));
    IF NOT FOUND OR NEW.outcome NOT IN ('kept', 'partly_reversed', 'reversed') OR NEW.category <> reviewed.category
       OR NEW.rules_version <> reviewed.rules_version OR NEW.reason_digest IS NULL THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A correction keeps or reverses a restricting decision of its case, with that decision''s category and rules version and a reason.';
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
  ELSE
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A decision is interim, final, a correction or a review.';
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
  -- item). One statement after the case's lock reads every fact the steps below need of them.
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
     AND CASE WHEN NEW.kind = 'final' THEN i.seq BETWEEN NEW.answers_from_seq AND NEW.through_seq
              WHEN NEW.kind IN ('correction', 'review') AND reviewed.kind = 'final' THEN i.answered_by = reviewed.id
              ELSE i.answered_by IS NULL END;
  IF public.staff_party_conflict(NEW.decided_by, array_remove(ARRAY[subject], NULL) || reporters, CASE WHEN c.target_type = 'post' THEN c.target_id END) THEN
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
  NEW.suspect := CASE WHEN NEW.kind IN ('correction', 'review') THEN reviewed.suspect ELSE considers_suspect END;
  NEW.unseen := false;
  IF NEW.kind = 'final' AND c.target_type = 'post' THEN
    -- Read now, before decisions_apply answers anything: frozen through a suspect item of this case, through the author's
    -- account's case, or through a seal in force.
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
                       WHEN 'correction' THEN reviewed.needs_admin
                       WHEN 'review' THEN public.review_needs_admin(NEW.reviews_decision_id)
                       ELSE false END;
  IF NEW.needs_admin AND decider_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  -- 7. A one-bigint key: the social module's pair locks use the two-key space, so the two never meet.
  PERFORM pg_advisory_xact_lock(hashtextextended('korbat.decision_cap:' || NEW.decided_by::text, 0));
  SELECT l.decisions_per_hour, l.decisions_per_day INTO per_hour, per_day FROM public.moderation_limits l WHERE l.id = 1;
  SELECT count(*) FILTER (WHERE d.decided_at > now() - interval '1 hour'), count(*) INTO in_hour, in_day
    FROM public.decisions d WHERE d.decided_by = NEW.decided_by AND d.decided_at > now() - interval '1 day';
  IF in_hour >= coalesce(per_hour, 60) OR in_day >= coalesce(per_day, 300) THEN
    RAISE EXCEPTION 'decision_cap';
  END IF;

  -- 8.
  IF (NEW.ground IS NOT DISTINCT FROM 'illegal' OR NEW.outcome = 'not_evident') AND NOT considers_illegal THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'The ground of the law, and "illegality not evident", need a considered item that alleges illegality.';
  END IF;

  -- 9.
  NEW.source := CASE WHEN NEW.kind IN ('correction', 'review') THEN reviewed.source
                     WHEN from_notice THEN 'notice'::public.decision_source
                     WHEN from_user THEN 'report'::public.decision_source
                     ELSE 'own_initiative'::public.decision_source END;

  -- 10. Both reads come after the case's lock and after the subject's profile lock, which the deciding transaction takes
  -- first and the author's deletion and the purge take too, so the target cannot be deleted before the commit.
  IF NEW.kind = 'final' AND NEW.through_seq = c.intake_seq THEN
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
  RETURN NEW;
END $$;--> statement-breakpoint
-- decisions_apply, replaced (0017). Everything 0016 and 0017 say of it stands, stated again in full. Added, after the
-- appeal's answer and before the texts are confirmed:
--   - A decision that answers a reply: a review or a correction that keeps the decision, or a review that reverses part
--     of it, whose reviewed decision holds a standing measure with an unanswered reply. A review always answers the reply
--     of the decision it reviews, whatever it decides: the reviewer read the case, and no start stays held by a reply
--     nobody will answer in an appeal. A correction that reverses part does not (among corrections a lift answers the
--     reply, in decision_actions_apply, and a kept one here). In this order, for the reply: when it was filed on time,
--     the subject's profile row FOR UPDATE (free when the API holds it); the reply's answering decision and its time;
--     and when it was filed on time, standing_apply, so a suspension held by the reply starts at the later of this
--     decision's time and its earliest start (suspension_periods). The trigger runs before the decision's own rows
--     exist: when a review that reverses part goes on to lift the measure, its lift derives the columns again.
--   - A correction that keeps a decision that found no breach: one statement withdraws every mark that decision set and
--     that is not withdrawn, all of them together.
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
BEGIN
  IF NEW.kind = 'final' THEN
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
           answered_seq = NEW.through_seq,
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
        UPDATE public.decisions d
           SET ended_interim = true, author_mail = CASE WHEN d.author_mail = 'none' THEN 'pending'::public.delivery_state ELSE d.author_mail END
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
-- decision_actions_check, replaced (0016). Everything 0016 says of it stands, stated again in full. What 3e changes, by
-- step:
--   2. It also clears basis, rests_on, starts_at and ends_at; clears days on every kind but suspend and
--      restrict_reporting; clears announced on every kind but those two and terminate; and clears replaced on every kind
--      but lift_suspension, where a null becomes false. The six new measures are measures; none of the ten new kinds
--      names a post.
--   3. Fit: a strike and its overruling only on a post case, the other eight only on an account case; the six measures
--      only in a final decision, the four reversals only in a review or correction; overrule only when the outcome is
--      reversed (a strike falls only with its whole finding); retire_handle only as its decision's first row; a suspend
--      names its days and whether it is announced, a terminate whether it is announced, a restrict_reporting its days
--      and announced false; and a decision that holds a seal holds no standing measure, nor the other way round.
--   6. The map of what a reversal lifts gains the four reversals of 3e.
--   9a. New, for a standing measure (a suspend or a terminate), in this order: the subject's profile row FOR UPDATE;
--      standing_conflict when a standing measure of the subject is live (standing_live), read in a statement of its own;
--      the basis, by the first row of the design's table that fits, which forces basis, rests_on and the most days (the
--      measure is refused when none fits); the days; the times; an admin for a measure taken at once and for every
--      terminate; and a ladder or protective measure refused while its decision answered a user's report (open_reports).
--   9b. New, for a strike: the subject's profile row FOR NO KEY UPDATE, so that two decisions on posts of one author run
--      one after the other whoever the caller is, and its end of counting. Whether one is due is decision_holds' question.
--   9c. New, for a warning and a restriction of reporting (the counts they read are those of the reporting counts'
--      migration): R6, findings only (open_reports, refused before any count is read), and the thresholds.
--  10. A strike never has no_effect, also on a deleted post: what counts is the breach. The five account measures get
--      deleted when the account is deleted, and a retirement already when the snapshot's handle is retired.
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
-- decision_actions_apply, replaced (0017). Everything 0016 and 0017 say of it stands, stated again in full;
-- moderation_apply is not called for the kinds of 3e, which name no post. Added:
--   - A retirement that changes something. h is the decision's snapshot's handle in lowercase. When the subject's profile
--     still holds h, its row of handle_history is inserted first (a handle the account changed to and still holds has
--     none yet: a change reserves the handle it leaves, not the one it takes); then that row is marked retired
--     (profile_changed when there is none to mark); then, by compare-and-set, a profile that still holds h gets the
--     placeholder (retired_ and the first 12 hex digits of the sha256 of the measure's id) and handle_changed_at null, so
--     its holder may choose a new handle at once. A profile that has moved on is left alone.
--   - The lifting of a retirement that had changed something: the handle's retirement is cleared; then, on a profile that
--     is not deleted, handle_changed_at is cleared and the handle given back where the profile still holds that measure's
--     placeholder. A retirement that changed nothing is lifted without a write.
--   - The lifting of a suspension or termination: its unanswered reply, if any, is answered by this decision.
--   - A reversal in a review or a correction that breaks the basis of a standing measure resting on the reviewed
--     decision: that measure's unanswered reply is answered by this decision, as a lift answers it.
--   - Last, standing_apply for the subject, after a standing measure, a restriction of reporting, their reversals and
--     an overruling, and after any reversal in a review or a correction of a decision that a standing measure or a
--     restriction of reporting of the subject rests on. Its caller holds the subject's profile row: the API takes it first.
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
-- decision_holds, replaced (0016). Everything 0016 says of it stands, stated again in full. What 3e changes:
--   (a) The two lists of measures gain the six of 3e. A signed action entry is {kind, mediaId}, and for a row whose
--       announced is set (a suspension, a termination, a restriction of reporting) also {days, announced}, compared as
--       the other members are. Two members of a decision's params are left out of the comparison with the decision's
--       columns and checked on their own: unfounded (the item ids the decision marks; a missing member counts as []),
--       compared as a set with the decision's rows of unfounded_marks; and replaced (a missing member counts as false),
--       compared with the replaced column of the decision's lift_suspension, and accepted as true only on a correction
--       whose one row lifts an announced measure that had not started at this decision's time (no period of it began
--       before the decision).
--   (b) Four rules more: a final restriction holds a strike exactly when strike_due says so for its case, ground, rule
--       and suspicion, with itself left out (strike_mismatch otherwise); a restriction holds at least one measure that is
--       not a strike; a reversal in part leaves in force a measure of the reviewed decision other than its strike, so a
--       strike never outlives everything it was given for; and a kept correction, as a kept review, holds no row.
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
-- The guard of retired handles, for every role but the migrator (inside decision_actions_apply the current role is the
-- migrator, so the retirement itself passes): a profile may neither take nor be given a handle of the placeholder's form
-- (handle_reserved), nor a handle whose row of handle_history is retired (handle_retired), its former holder included.
-- Onboarding and a handle change check the same first, to answer with a code; this is what holds under a race. The
-- function is plain, so current_user is the role that ran the statement. An update that leaves the handle as it was is
-- not judged again.
CREATE FUNCTION "public"."profiles_handle_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'korbat_migrate' OR (TG_OP = 'UPDATE' AND NEW.handle IS NOT DISTINCT FROM OLD.handle) THEN
    RETURN NEW;
  END IF;
  IF lower(NEW.handle) ~ '^retired_[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'handle_reserved';
  END IF;
  IF EXISTS (SELECT 1 FROM public.handle_history h WHERE h.handle_lower = lower(NEW.handle) AND h.retired_at IS NOT NULL) THEN
    RAISE EXCEPTION 'handle_retired';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."profiles_handle_guard"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "profiles_handle_guard" BEFORE INSERT OR UPDATE OF "handle" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."profiles_handle_guard"();--> statement-breakpoint
-- A reply to a standing measure is checked and completed before it is stored. It runs as its owner. In this order:
--   1. It forces answered_by, answered_at and erased_at null.
--   2. The measure is a suspension or a termination whose subject is the reply's account (reply_not_open otherwise). A
--      reply is open to a measure taken at once as to an announced one.
--   3. The account's profile row FOR UPDATE: every writer of a start holds it, so from here only the clock can bring one.
--   4. In statements of their own: reply_not_open when the profile is deleted, the measure was lifted, its basis is
--      broken, or it has a reply already.
--   5. The measure's period; then filed_at, read from the clock last; reply_not_open when the period has ended; on_time
--      when the period has no start yet or the reply came before it. A reply to a measure taken at once is never on time.
CREATE FUNCTION "public"."suspension_replies_check"() RETURNS trigger
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
REVOKE ALL ON FUNCTION "public"."suspension_replies_check"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "suspension_replies_check" BEFORE INSERT ON "public"."suspension_replies" FOR EACH ROW EXECUTE FUNCTION "public"."suspension_replies_check"();--> statement-breakpoint
-- What a stored reply does: the measure's case moves to a new version, so a correction drafted before the reply is
-- refused (case_changed); then the account's standing is derived again, which after an on-time reply clears the period
-- before the commit.
CREATE FUNCTION "public"."suspension_replies_apply"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.cases k SET state_version = k.state_version + 1
   WHERE k.id = (SELECT d.case_id FROM public.decision_actions a JOIN public.decisions d ON d.id = a.decision_id WHERE a.id = NEW.action_id);
  PERFORM public.standing_apply(NEW.account_id);
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."suspension_replies_apply"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "suspension_replies_apply" AFTER INSERT ON "public"."suspension_replies" FOR EACH ROW EXECUTE FUNCTION "public"."suspension_replies_apply"();--> statement-breakpoint
-- The statement mail of a decision that holds an announced measure moves one way, for every role but the migrator: from
-- pending only to sent, failed or no_address, each with author_mail_at the time it was recorded (now(), whatever was
-- supplied), and never again. So the API role can make a signed suspension start as signed, or delay it by leaving the
-- mail pending, and never start it before its earliest start nor un-send a notice. Each refusal is moderation_column
-- under SQLSTATE 42501, as posts_guard raises. The function is plain, so current_user is the role that ran the statement.
CREATE FUNCTION "public"."decisions_mail_forward"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'korbat_migrate' OR NOT EXISTS (
       SELECT 1 FROM public.decision_actions a WHERE a.decision_id = NEW.id AND a.kind IN ('suspend', 'terminate') AND a.announced) THEN
    RETURN NEW;
  END IF;
  IF OLD.author_mail = 'pending' THEN
    IF NEW.author_mail = 'pending' THEN
      IF NEW.author_mail_at IS DISTINCT FROM OLD.author_mail_at THEN
        RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.author_mail IN ('sent', 'failed', 'no_address') THEN
      NEW.author_mail_at := now();
    ELSE
      RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.author_mail IS DISTINCT FROM OLD.author_mail OR NEW.author_mail_at IS DISTINCT FROM OLD.author_mail_at THEN
    RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."decisions_mail_forward"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "decisions_mail_forward" BEFORE UPDATE OF "author_mail", "author_mail_at" ON "public"."decisions" FOR EACH ROW EXECUTE FUNCTION "public"."decisions_mail_forward"();--> statement-breakpoint
-- The outcome of an announcing decision's statement mail fixes the measure's start: standing_apply for the subject of
-- the decision's announced measure, whenever the mail's state changed. The caller holds that profile row.
CREATE FUNCTION "public"."decisions_mail_standing"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  subject uuid;
BEGIN
  SELECT a.subject_account_id INTO subject FROM public.decision_actions a
   WHERE a.decision_id = NEW.id AND a.kind IN ('suspend', 'terminate') AND a.announced;
  IF subject IS NOT NULL THEN
    PERFORM public.standing_apply(subject);
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."decisions_mail_standing"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "decisions_mail_standing" AFTER UPDATE OF "author_mail" ON "public"."decisions" FOR EACH ROW
  WHEN (OLD."author_mail" IS DISTINCT FROM NEW."author_mail")
  EXECUTE FUNCTION "public"."decisions_mail_standing"();--> statement-breakpoint
-- Whether an account holds a standing measure that is live, or a restriction of its reports that has not ended:
-- grant-role asks it on the auth role, in a statement of its own after its lock on the account's auth row, and promotes
-- nobody it answers true for. A deciding transaction reads that row FOR SHARE (account_is_staff), so in both orders no
-- staff account holds a standing measure.
CREATE FUNCTION "auth"."account_standing"(account uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.standing_live s WHERE s.account_id = account_standing.account)
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = account_standing.account AND p.reports_restricted_until > clock_timestamp());
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth"."account_standing"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth"."account_standing"(uuid) TO korbat_auth;--> statement-breakpoint
-- The accounts due for their termination's take-down: one row for each account that is not deleted and holds a
-- termination that stands, whose basis holds, whose period has started, that no reply, on time or late, waits on, and
-- whose decision is final for its author (decision_final_at, null while an appeal is pending). With the case of that
-- decision, which the take-down locks before it reads again, and the decision's time, which the final mail prints. It
-- only reads.
CREATE FUNCTION "public"."terminations_due"() RETURNS TABLE (account_id uuid, case_id uuid, decided_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT a.subject_account_id, d.case_id, d.decided_at
    FROM public.decision_actions a
    JOIN public.decisions d ON d.id = a.decision_id
    JOIN public.profiles p ON p.id = a.subject_account_id
   WHERE a.kind = 'terminate'
     AND p.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = a.id)
     AND public.standing_basis_broken_at(a.id) IS NULL
     AND EXISTS (SELECT 1 FROM public.suspension_periods s WHERE s.action_id = a.id AND s.starts_at <= clock_timestamp())
     AND NOT EXISTS (SELECT 1 FROM public.suspension_replies r WHERE r.action_id = a.id AND r.answered_by IS NULL)
     AND public.decision_final_at(d.id) <= clock_timestamp()
   ORDER BY d.decided_at, a.id;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."terminations_due"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."terminations_due"() TO korbat_api;

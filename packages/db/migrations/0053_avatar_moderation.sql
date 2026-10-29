CREATE TABLE "avatar_resets" (
	"action_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"until" timestamp with time zone NOT NULL,
	CONSTRAINT "avatar_resets_sha256" CHECK ("avatar_resets"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "avatar_resets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "avatar_reviews" (
	"media_id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "avatar_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seal_avatars" (
	"action_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	CONSTRAINT "seal_avatars_action_id_media_id_pk" PRIMARY KEY("action_id","media_id")
);
--> statement-breakpoint
ALTER TABLE "seal_avatars" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "releases" ADD COLUMN "avatar_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "avatar_resets" ADD CONSTRAINT "avatar_resets_action_id_decision_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."decision_actions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avatar_reviews" ADD CONSTRAINT "avatar_reviews_item_id_intake_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."intake_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seal_avatars" ADD CONSTRAINT "seal_avatars_action_id_decision_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."decision_actions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "avatar_resets_account_idx" ON "avatar_resets" USING btree ("account_id","until");--> statement-breakpoint
CREATE INDEX "avatar_reviews_item_idx" ON "avatar_reviews" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "seal_avatars_media_idx" ON "seal_avatars" USING btree ("media_id");--> statement-breakpoint
CREATE POLICY "avatar_resets_api_all" ON "avatar_resets" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "avatar_reviews_api_all" ON "avatar_reviews" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "seal_avatars_api_all" ON "seal_avatars" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Everything below is written by hand (2d design, sections 6.5, 6.6, 6.8, 7.6 and 7.7; Task 4). The generated lines above
-- add the three tables of the moderation of avatars, each with row level security and one policy for the API role:
-- seal_avatars (the avatars an account case's seal listed, keyed by the seal's ledger row and the image, with no key to
-- the image, which may go), avatar_reviews (R1's hold for review of an avatar under its finding's item) and avatar_resets
-- (a reset picture's SHA-256 and the end of its 30 days, one row a reset); and releases.avatar_ids, a released seal's
-- avatars beside its posts. 0052_avatar_kinds, the file before this one, added reset_avatar and restore_avatar to
-- action_kind and nothing else.
--
-- The enum-literal rule (6.5; packages/db/test/enum-literals.test.ts). An upgrade runs every pending migration in one
-- transaction, 0049 to 0053 together on a database upgraded from 0048, and a value ADD VALUE added cannot be used as an
-- enum literal before that transaction commits (55P04) in anything parsed when it is created or run. So reset_avatar and
-- restore_avatar appear as literals only inside PL/pgSQL bodies (decision_actions_check, decision_actions_apply,
-- redact_r4_body, decision_holds), and everywhere else, the view measures_in_force and the SQL functions
-- item_current_outcome and case_evidence_due_at, a kind is compared as text. Every other enum this file's new code reads
-- (media_kind, the image's status and state) is compared as text too, as 2d compares every enum.
--
-- As in 0049 to 0051: every function is owned by the migrator, pins its search path to public and pg_temp and has
-- EXECUTE taken from PUBLIC; a refusal is a code word under SQLSTATE P0001 as the ledger's are; times are now(), the
-- transaction's start. Each replaced function or view is written in full from its newest text, which is named at each,
-- with the changes named there and no other; CREATE OR REPLACE keeps its owner, its grants and its trigger, and every
-- replacement states its definer flag and pinned search path again.
--
-- What 6.5 asks beyond the list of 6.8, done here and named at each (the report's "Where the code differs"): the
-- deciding transaction that answers an item is decisions_apply, which this file replaces to derive the reviewed avatars
-- again and the avatars of the interim seals that end with the answer; release_facts holds a release until the seal's
-- avatars are quarantined too; quarantine_plan and quarantine_counts move a sealed avatar's files in and out as a post's;
-- erase_case_evidence erases avatar_resets and avatar_reviews with a case's evidence (6.7); and avatar_sealed, the seal's
-- arm of post_media_keep as a function of its own, which the media repository's disposal reads as it reads
-- account_frozen, since the API may name neither frozen_for nor the seal's tables in a keep rule of its own.

-- 1. The lists of the measures (6.5, "Every list of the measures"). measures_in_force, replaced from its text in
-- 0028_orders_ledger: its list of measures gains reset_avatar, compared as text with the rest. A reset is in force as a
-- display name's is: a final one until a reversal, an interim one while its case is open.
CREATE OR REPLACE VIEW "public"."measures_in_force" WITH (security_invoker = true) AS
SELECT a.id, a.kind, a.post_id, a.media_id, a.subject_account_id, d.id AS decision_id, d.kind AS decision_kind, d.case_id
  FROM public.decision_actions a
  JOIN public.decisions d ON d.id = a.decision_id
 WHERE a.kind::text IN ('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio', 'strike', 'suspend', 'terminate', 'retire_handle', 'warn_reporting', 'restrict_reporting', 'disable_by_order', 'reset_avatar')
   AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = a.id)
   AND (d.kind <> 'interim'
     OR CASE WHEN a.kind = 'seal_media'
          THEN EXISTS (SELECT 1 FROM public.intake_items i
                        WHERE i.case_id = d.case_id AND i.suspect AND i.answered_by IS NULL AND i.created_at <= d.decided_at)
          ELSE EXISTS (SELECT 1 FROM public.cases c WHERE c.id = d.case_id AND c.closed_at IS NULL)
        END);--> statement-breakpoint

-- 2. item_current_outcome, replaced from its text in 0021_standing_ledger: the listed measures of an item's answering
-- decision gain reset_avatar, compared as text, so a reporter's item reads "reversed" when the reset of the picture they
-- reported is lifted, as for a display name.
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
         AND a.kind::text IN ('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio', 'reset_avatar', 'retire_handle', 'suspend', 'terminate')) m ON true
   WHERE i.id = item_current_outcome.item
$$;--> statement-breakpoint

-- 3. case_evidence_due_at, replaced from its text in 0018_retention: the field resets whose end keeps a case's evidence 30
-- days longer gain reset_avatar, and the list is compared as text (it was an enum comparison of two old values). So the
-- snapshot that holds a reset picture outlives the reset by 30 days, as a reset display name's does.
CREATE OR REPLACE FUNCTION "public"."case_evidence_due_at"(case_id uuid) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
           WHEN c.closed_at IS NULL THEN NULL
           WHEN EXISTS (SELECT 1 FROM public.decisions d
                         WHERE d.case_id = c.id AND d.kind = 'final' AND d.outcome = 'restricted'
                           AND EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.decision_id = d.id)
                           AND coalesce(public.decision_final_at(d.id) > now(), true)) THEN NULL
           ELSE greatest(
             c.closed_at,
             (SELECT max(public.decision_final_at(d.id)) FROM public.decisions d
               WHERE d.case_id = c.id AND d.kind = 'final' AND d.outcome = 'restricted'
                 AND EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.decision_id = d.id)),
             (SELECT max(s.taken_at) + interval '24 hours' FROM public.evidence_snapshots s WHERE s.case_id = c.id AND s.erased_at IS NULL),
             (SELECT max(t.created_at) + interval '24 hours' FROM public.staff_texts t
               WHERE t.case_id = c.id AND t.confirmed_at IS NULL AND t.erased_at IS NULL),
             (SELECT max(coalesce(r.created_at, c.closed_at)) + interval '30 days'
                FROM public.decision_actions a
                JOIN public.decisions d ON d.id = a.decision_id
                LEFT JOIN public.decision_actions r ON r.reverses_action_id = a.id
               WHERE d.case_id = c.id AND a.kind::text IN ('reset_display_name', 'reset_bio', 'reset_avatar')
                 AND NOT EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.id = a.id)))
         END
    FROM public.cases c
   WHERE c.id = case_evidence_due_at.case_id
$$;--> statement-breakpoint

-- 4. redact_r4_body, replaced from its text in 0019_redaction_scope: its two lists of R4's measures gain reset_avatar, so
-- an avatar reset under R4 is a candidate and its held snapshot is erased with a display name's. Nothing else changes: the
-- reset picture's row is detached already, and the case's hold on it ends with the case's evidence.
CREATE OR REPLACE FUNCTION "public"."redact_r4_body"(decision_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d public.decisions;
  c public.cases;
  final_at timestamptz;
  redacted timestamptz;
  in_force boolean;
  removes boolean;
  frozen boolean;
  removed_images uuid[];
  released uuid[];
BEGIN
  -- 1.
  SELECT x.* INTO d FROM public.decisions x WHERE x.id = redact_r4_body.decision_id;
  IF NOT FOUND OR d.kind <> 'final' OR d.rule_id IS DISTINCT FROM 'R4'
     OR NOT EXISTS (SELECT 1 FROM public.decision_actions a
                     WHERE a.decision_id = d.id AND a.kind IN ('remove', 'remove_media', 'reset_bio', 'reset_display_name', 'reset_avatar')) THEN
    RAISE EXCEPTION 'invalid_decision';
  END IF;
  -- A decision's case, its time and a case's target never change, so this read before the locks names the right rows.
  SELECT k.* INTO c FROM public.cases k WHERE k.id = d.case_id;

  -- 2. A snapshot's time never changes either, and none can still appear that was taken before a decision this old, so
  -- the cases read here are the cases whose snapshots step 5 erases.
  IF c.target_type = 'account' THEN
    PERFORM 1 FROM public.profiles p WHERE p.id = c.target_id FOR NO KEY UPDATE;
  END IF;
  PERFORM 1 FROM public.cases k
    WHERE k.id = c.id
       OR k.id IN (SELECT s.case_id FROM public.evidence_snapshots s
                    WHERE s.target_type = c.target_type AND s.target_id = c.target_id
                      AND s.erased_at IS NULL AND s.taken_at <= d.decided_at)
    ORDER BY k.id FOR UPDATE;
  IF c.target_type = 'post' THEN
    PERFORM 1 FROM public.posts p WHERE p.id = c.target_id FOR UPDATE;
    PERFORM 1 FROM public.post_media m WHERE m.post_id = c.target_id ORDER BY m.id FOR NO KEY UPDATE;
  END IF;

  -- 3.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'read_committed_only' USING ERRCODE = '25000';
  END IF;
  SELECT public.decision_final_at(d.id) INTO final_at;
  IF final_at IS NULL OR final_at > now() THEN
    RAISE EXCEPTION 'not_due';
  END IF;
  SELECT x.redacted_at INTO redacted FROM public.decisions x WHERE x.id = d.id;
  IF redacted IS NOT NULL THEN
    RETURN false;
  END IF;
  SELECT count(*) > 0, coalesce(bool_or(f.kind = 'remove'), false), coalesce(array_agg(f.media_id) FILTER (WHERE f.kind = 'remove_media'), '{}'::uuid[])
    INTO in_force, removes, removed_images
    FROM public.measures_in_force f
   WHERE f.decision_id = d.id AND f.kind IN ('remove', 'remove_media', 'reset_bio', 'reset_display_name', 'reset_avatar');
  IF NOT in_force THEN
    RETURN false;
  END IF;
  IF c.target_type = 'post' THEN
    SELECT public.post_frozen(c.target_id) INTO frozen;
    IF frozen THEN
      RETURN false;
    END IF;
  END IF;

  -- 4.
  released := removed_images;
  IF removes THEN
    UPDATE public.posts p SET body = '', erased_at = coalesce(p.erased_at, now()) WHERE p.id = c.target_id;
    SELECT coalesce(array_agg(m.id), '{}'::uuid[]) INTO released FROM public.post_media m WHERE m.post_id = c.target_id;
  END IF;
  IF cardinality(removed_images) > 0 THEN
    UPDATE public.post_media m SET erased_at = coalesce(m.erased_at, now()) WHERE m.id = ANY(removed_images) AND m.post_id = c.target_id;
  END IF;

  -- 5. Only what was copied up to the decision: a later snapshot is another look at the target, and its case's own.
  PERFORM public.erase_snapshots(ARRAY(SELECT s.id FROM public.evidence_snapshots s
                                        WHERE s.target_type = c.target_type AND s.target_id = c.target_id
                                          AND s.erased_at IS NULL AND s.taken_at <= d.decided_at));

  -- 6.
  IF NOT EXISTS (SELECT 1 FROM public.evidence_snapshots s
                  WHERE s.target_type = c.target_type AND s.target_id = c.target_id
                    AND s.erased_at IS NULL AND s.taken_at <= d.decided_at) THEN
    UPDATE public.decisions x SET redacted_at = now() WHERE x.id = d.id;
  END IF;

  -- 7.
  PERFORM public.release_case_holds(c.id, released);
  IF c.target_type = 'post' THEN
    PERFORM public.moderation_apply(ARRAY[c.target_id], true);
  END IF;
  RETURN true;
END $$;--> statement-breakpoint

-- 5. decision_holds, replaced from its text in 0039_known_material: the signed form's two counts of measures (IN and NOT
-- IN) gain reset_avatar, so it is counted as a measure and restore_avatar as a reversal.
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
  -- 0039 (c): the reason an answer without a seal on an acting match signs, and whether this decision needs one.
  signed_reason jsonb;
  needs_reason boolean;
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
  -- 0039: matchAnswerReason is checked on its own in (c) below; a row made before 3d's Task 7 carries none.
  compared := CASE WHEN d.kind = 'review' THEN params - 'actions' ELSE params - 'actions' - 'unfounded' - 'replaced' - 'matchAnswerReason' END;
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
                                           'strike', 'suspend', 'terminate', 'retire_handle', 'warn_reporting', 'restrict_reporting', 'disable_by_order', 'reset_avatar')),
         count(*) FILTER (WHERE x.kind NOT IN ('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio',
                                               'strike', 'suspend', 'terminate', 'retire_handle', 'warn_reporting', 'restrict_reporting', 'disable_by_order', 'reset_avatar')),
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
             AND EXISTS (SELECT 1 FROM public.decision_actions x WHERE x.decision_id = d.id AND x.kind = 'seal_media')
             -- 0039 (b): a seal stands only on a match record that is acting, which the database forces itself.
             AND EXISTS (SELECT 1 FROM public.media_matches mm WHERE mm.id = sig.match_id AND mm.acting))) THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'actions: the measure of a decision without a decider is not the one its signal allows.';
    END IF;
  END IF;
  -- 0039 (c) (6.7, 7.11, note 26): match_answer_reason is set exactly when the decision is final, holds no seal_media and
  -- considers an item of an automated intake whose match record is acting: such a decision puts an image with an exact
  -- match back before everyone with nobody having looked. It equals the signed param, and a decision without a decider or
  -- a review holds none. A flag's answer needs none.
  needs_reason := d.decided_by IS NOT NULL AND d.kind = 'final'
    AND NOT EXISTS (SELECT 1 FROM public.decision_actions x WHERE x.decision_id = d.id AND x.kind = 'seal_media')
    AND EXISTS (SELECT 1 FROM public.intake_items i JOIN public.automated_signals s ON s.intake_item_id = i.id
                  JOIN public.media_matches mm ON mm.id = s.match_id
                 WHERE i.answered_by = d.id AND s.kind = 'known_match' AND mm.acting);
  signed_reason := CASE WHEN d.kind = 'review' THEN NULL ELSE params -> 'matchAnswerReason' END;
  IF signed_reason = 'null'::jsonb THEN
    signed_reason := NULL;
  END IF;
  IF needs_reason IS DISTINCT FROM (d.match_answer_reason IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'matchAnswerReason: an answer without a seal on an acting match names its reason, and no other decision does.';
  END IF;
  IF (signed_reason #>> '{}') IS DISTINCT FROM d.match_answer_reason THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'matchAnswerReason: the signed reason differs from the decision.';
  END IF;
END $$;--> statement-breakpoint

-- 6. The grants (6.6). 0001's default privileges gave the API role SELECT, INSERT, UPDATE and DELETE on each new table
-- (never TRUNCATE, which the revoke names all the same, as 0015 writes for seal_posts). It keeps SELECT alone: only the
-- definer functions below write them. korbat_auth and korbat_notify were given nothing on a public table.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "public"."seal_avatars", "public"."avatar_reviews", "public"."avatar_resets" FROM korbat_api;--> statement-breakpoint

-- 7. avatar_sealed(media), plain SQL, STABLE: the seal's arm of post_media_keep for an avatar (6.5), mirroring frozen_for's
-- seal arm: a seal in force (measures_in_force) lists the image in seal_avatars, and no release that lists it in
-- avatar_ids has a notice other than held. post_media_keep reads it, and the media repository's disposal (DISPOSABLE)
-- reads it for an avatar, so that it does not take again, round after round, a row the trigger keeps, as it reads
-- account_frozen. It names no enum value. EXECUTE for the API role alone.
CREATE FUNCTION "public"."avatar_sealed"(media uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.seal_avatars s
    JOIN public.measures_in_force m ON m.id = s.action_id
    WHERE s.media_id = avatar_sealed.media
      AND NOT EXISTS (SELECT 1 FROM public.releases x WHERE avatar_sealed.media = ANY (x.avatar_ids) AND x.author_notice <> 'held'))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."avatar_sealed"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."avatar_sealed"(uuid) TO korbat_api;--> statement-breakpoint

-- 8. avatar_apply(media), SECURITY DEFINER (6.5): the one writer of an avatar's moderation_state, as moderation_apply is
-- of a post's images (which works by post, and an avatar has none). It locks the named rows of kind avatar in id order
-- FOR NO KEY UPDATE, then sets each one's state to sealed while a seal in force lists it in seal_avatars, else withheld
-- while avatar_reviews lists it under an item nobody answered, else visible, writing only a row whose state changes, so
-- post_media_purge writes the outbox row of an avatar that stops being public and no other. A null or empty list does
-- nothing. EXECUTE for nobody: decision_actions_apply, decisions_apply and avatar_review call it as its owner.
CREATE FUNCTION "public"."avatar_apply"(media uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF avatar_apply.media IS NULL OR cardinality(avatar_apply.media) = 0 THEN
    RETURN;
  END IF;
  PERFORM 1 FROM public.post_media m WHERE m.id = ANY (avatar_apply.media) AND m.kind::text = 'avatar' ORDER BY m.id FOR NO KEY UPDATE;
  UPDATE public.post_media i SET moderation_state = v.state
    FROM (SELECT m.id,
                 CASE
                   WHEN EXISTS (SELECT 1 FROM public.seal_avatars s JOIN public.measures_in_force f ON f.id = s.action_id WHERE s.media_id = m.id) THEN 'sealed'
                   WHEN EXISTS (SELECT 1 FROM public.avatar_reviews r JOIN public.intake_items x ON x.id = r.item_id
                                 WHERE r.media_id = m.id AND x.answered_by IS NULL) THEN 'withheld'
                   ELSE 'visible' END::public.media_moderation_state AS state
            FROM public.post_media m WHERE m.id = ANY (avatar_apply.media) AND m.kind::text = 'avatar') v
   WHERE i.id = v.id AND i.moderation_state <> v.state;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."avatar_apply"(uuid[]) FROM PUBLIC;--> statement-breakpoint

-- 9. avatar_review(p_media, p_item), SECURITY DEFINER (6.5, 7.6): R1's hold for review of an avatar, which the program's
-- step calls while AUTOMATION_R1_ACTS is on, after its finding's item, in the step's transaction. The item must be an
-- unanswered item of a program's finding citing R1 about an account, and the image an avatar that account owns, else
-- invalid_review and nothing is written. One row an avatar: a second call for the same avatar keeps the first item. Then
-- avatar_apply, which makes the row withheld. EXECUTE for the API role alone.
CREATE FUNCTION "public"."avatar_review"(p_media uuid, p_item uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.intake_items i
                   JOIN public.intakes n ON n.id = i.intake_id
                   JOIN public.post_media m ON m.id = avatar_review.p_media
                  WHERE i.id = avatar_review.p_item AND i.answered_by IS NULL AND i.target_type::text = 'account' AND i.target_id = m.owner_id
                    AND n.kind::text = 'automated' AND n.rule_id = 'R1' AND m.kind::text = 'avatar') THEN
    RAISE EXCEPTION 'invalid_review';
  END IF;
  INSERT INTO public.avatar_reviews (media_id, item_id) VALUES (avatar_review.p_media, avatar_review.p_item) ON CONFLICT (media_id) DO NOTHING;
  PERFORM public.avatar_apply(ARRAY[avatar_review.p_media]);
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."avatar_review"(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."avatar_review"(uuid, uuid) TO korbat_api;--> statement-breakpoint

-- 10. post_media_keep, replaced from its text in 0051_avatars (6.5): a row of kind avatar on no post is also retained
-- while avatar_sealed holds for it (a seal in force lists it, no release with a notice other than held does), read in
-- the same statement as the frozen account case, after the row's lock. A sealed avatar no hold keeps (one set after the
-- report, so in no snapshot) is then never deleted by its owner, a replacement, the sweeper or the purge while 3d's
-- quarantine lists it. The rest is 0051's.
CREATE OR REPLACE FUNCTION "public"."post_media_keep"() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  retained boolean;
BEGIN
  IF OLD.post_id IS NULL THEN
    retained := coalesce(OLD.hold_until > now(), false);
    IF NOT retained AND OLD.kind::text = 'avatar' THEN
      IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'read_committed_only' USING ERRCODE = '25000';
      END IF;
      SELECT public.account_frozen(OLD.owner_id) OR public.avatar_sealed(OLD.id) INTO retained;
    END IF;
  ELSE
    IF current_setting('transaction_isolation') <> 'read committed' THEN
      RAISE EXCEPTION 'read_committed_only' USING ERRCODE = '25000';
    END IF;
    IF OLD.hold_until > now() THEN
      retained := true;
    ELSE
      SELECT public.frozen_for(OLD.post_id, OLD.owner_id) INTO retained;
    END IF;
  END IF;
  IF retained THEN
    IF pg_trigger_depth() > 1 THEN
      RAISE EXCEPTION 'post_media row % is retained', OLD.id USING ERRCODE = '23001';
    END IF;
    RETURN NULL;
  END IF;
  RETURN OLD;
END $$;--> statement-breakpoint

-- 11. post_media_purge, replaced from its text in 0051_avatars (6.4, 6.5): an erasure writes the cause released also for
-- an avatar a release lists in avatar_ids, as for an image of a released post. The rest is 0051's: a row that was never
-- served (on no post and no profile, or not ready) writes nothing, so only a current avatar's erasure writes released.
CREATE OR REPLACE FUNCTION "public"."post_media_purge"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cause text;
BEGIN
  IF (OLD.post_id IS NULL AND OLD.profile_id IS NULL) OR OLD.status::text <> 'ready' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    v_cause := 'deleted';
  ELSIF OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL THEN
    v_cause := CASE WHEN EXISTS (SELECT 1 FROM public.release_posts r WHERE r.post_id = OLD.post_id)
                      OR EXISTS (SELECT 1 FROM public.releases x WHERE OLD.id = ANY (x.avatar_ids)) THEN 'released' ELSE 'deleted' END;
  ELSIF OLD.moderation_state::text = 'visible' AND NEW.moderation_state::text <> 'visible' THEN
    v_cause := 'state';
  ELSIF OLD.profile_id IS NOT NULL AND NEW.profile_id IS NULL THEN
    v_cause := 'state';
  ELSE
    RETURN NULL;
  END IF;
  INSERT INTO public.edge_purges (media_id, cause) VALUES (OLD.id, v_cause);
  RETURN NULL;
END $$;--> statement-breakpoint

-- 12. decision_actions_check, replaced from its text in 0044_imported_posts (6.5). Everything 0016 to 0044 say of it
-- stands, stated again in full, with the avatar's kinds added where the field kinds are: reset_avatar is a measure (step
-- 2), on an account case only (step 3) with restore_avatar, in an interim or a final decision; restore_avatar lifts
-- reset_avatar (step 6), in a review or a correction as restore_display_name; and its no_effect (step 10) is already when
-- the account has no avatar (no row's profile_id names it) and deleted when its profile is deleted (the existing first
-- branch).
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
                             'strike', 'suspend', 'terminate', 'retire_handle', 'warn_reporting', 'restrict_reporting', 'disable_by_order', 'reset_avatar');

  -- 3.
  IF (NEW.post_id IS NOT NULL AND c.target_type <> 'post')
     OR (NEW.kind IN ('reset_display_name', 'reset_bio', 'restore_display_name', 'restore_bio', 'reset_avatar', 'restore_avatar') AND c.target_type <> 'account') THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'Post and image measures belong to a post case, field measures to an account case.';
  END IF;
  IF (NEW.kind IN ('strike', 'overrule') AND c.target_type <> 'post')
     OR (NEW.kind IN ('suspend', 'terminate', 'retire_handle', 'warn_reporting', 'restrict_reporting', 'lift_suspension', 'unretire_handle', 'lift_reporting') AND c.target_type <> 'account') THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A strike and its overruling belong to a post case, the account measures and their reversals to an account case.';
  END IF;
  IF NOT (CASE d.kind
            WHEN 'interim' THEN NEW.kind IN ('withhold', 'withhold_media', 'reset_display_name', 'reset_bio', 'reset_avatar', 'seal_media', 'restore', 'restore_media')
            WHEN 'final' THEN NEW.kind IN ('remove', 'remove_media', 'reset_display_name', 'reset_bio', 'reset_avatar', 'seal_media', 'restore', 'restore_media',
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
                WHEN 'restore_avatar' THEN ARRAY['reset_avatar']
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
        IF (SELECT count(*) FROM public.posts p WHERE p.author_id = subject AND p.created_at > now() - make_interval(mins => rules.flood_minutes) AND p.import_job_id IS NULL) >= rules.flood_posts THEN
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
      ELSIF (NEW.kind = 'reset_display_name' AND profile.display_name = profile.handle) OR (NEW.kind = 'reset_bio' AND profile.bio = '')
            OR (NEW.kind = 'reset_avatar' AND NOT EXISTS (SELECT 1 FROM public.post_media m WHERE m.profile_id = subject)) THEN
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

-- 13. decision_actions_apply, replaced from its text in 0028_orders_ledger (6.5). Everything 0016 to 0028 say of it
-- stands, stated again in full, with three changes:
--   - a seal_media on an account case also locks, after the posts' images and in id order, every ready and unerased row
--     of kind avatar the account owns (the current one and any former one a hold keeps), lists them in seal_avatars, and
--     raises invalid_decision only when both its lists are empty; its no_effect already asks the avatars to be covered by
--     another seal as the posts are; and avatar_apply derives their state, as moderation_apply derives the posts' images'.
--     An unseal_media applies again to the lifted seal's avatars;
--   - a reset_avatar whose no_effect is null is a compare-and-set against the decision's snapshot (profile_changed unless
--     the profile's current avatar is the picture the snapshot holds), then that row's profile_id is set null and its
--     avatar_resets row written with the row's avatar_sha256 and until 30 days on (AVATAR_RESET_DAYS in the contracts);
--   - a restore_avatar does nothing: korbat puts no picture back.
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
  -- 3f: the order's item a disable_by_order gives effect to, as it stood before this measure, and whether its order preserves.
  item public.legal_order_items;
  preserves boolean;
  -- 2d: an account seal's avatars, a seal's or a lifted seal's list of them, and a reset picture's id and hash.
  avatars uuid[];
  avatar_listed uuid[];
  snapshot_avatar uuid;
  reset_sha text;
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
      -- 2d: then, after the posts' images and in id order, every ready and unerased row of kind avatar the account owns:
      -- its current avatar and any former one a hold keeps.
      SELECT array_agg(l.id) INTO avatars
        FROM (SELECT m.id FROM public.post_media m
               WHERE m.owner_id = c.target_id AND m.kind::text = 'avatar' AND m.status::text = 'ready' AND m.erased_at IS NULL
               ORDER BY m.id FOR NO KEY UPDATE) l;
    END IF;
    -- 2d: a seal with nothing in either list seals nothing.
    IF locked IS NULL AND avatars IS NULL THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'The case reaches no image: there is nothing to seal.';
    END IF;
    INSERT INTO public.seal_posts (action_id, post_id, images)
    SELECT NEW.id, l.post_id, count(*) FROM unnest(locked) AS l(post_id) GROUP BY l.post_id;
    INSERT INTO public.seal_avatars (action_id, media_id) SELECT NEW.id, l.media_id FROM unnest(avatars) AS l(media_id);
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
       -- 2d: and every avatar it lists is listed by another seal in force too.
       AND NOT EXISTS (
             SELECT 1 FROM public.seal_avatars mine
              WHERE mine.action_id = NEW.id
                AND NOT EXISTS (SELECT 1 FROM public.seal_avatars s JOIN public.measures_in_force f ON f.id = s.action_id
                                 WHERE s.media_id = mine.media_id AND s.action_id <> NEW.id AND (d.kind = 'interim' OR f.decision_kind <> 'interim')))
      INTO covered;
    UPDATE public.decision_actions a
       SET no_effect = CASE WHEN coalesce(target_deleted, false) THEN 'deleted' WHEN covered THEN 'already' END
     WHERE a.id = NEW.id;
    PERFORM public.moderation_apply(listed, false);
    -- 2d: the seal's avatars are derived as its posts' images are.
    SELECT array_agg(s.media_id) INTO avatar_listed FROM public.seal_avatars s WHERE s.action_id = NEW.id;
    PERFORM public.avatar_apply(avatar_listed);
  ELSIF NEW.kind = 'unseal_media' THEN
    SELECT array_agg(s.post_id) INTO listed FROM public.seal_posts s WHERE s.action_id = NEW.reverses_action_id;
    PERFORM public.moderation_apply(listed, false);
    -- 2d: and the lifted seal's avatars again.
    SELECT array_agg(s.media_id) INTO avatar_listed FROM public.seal_avatars s WHERE s.action_id = NEW.reverses_action_id;
    PERFORM public.avatar_apply(avatar_listed);
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
  ELSIF NEW.kind = 'reset_avatar' AND NEW.no_effect IS NULL THEN
    -- 2d: compare-and-set against the decision's snapshot, as for a display name: the profile's current avatar must be the
    -- picture the snapshot holds (its media's one entry), or profile_changed. The row is detached, which writes its
    -- outbox row (post_media_purge), and stays while a hold keeps it; its hash is kept for AVATAR_RESET_DAYS (30) days.
    SELECT s.* INTO snapshot FROM public.evidence_snapshots s WHERE s.id = d.snapshot_id;
    snapshot_avatar := (snapshot.media -> 0 ->> 'id')::uuid;
    UPDATE public.post_media m SET profile_id = NULL
     WHERE m.profile_id = NEW.subject_account_id AND m.id = snapshot_avatar
    RETURNING m.avatar_sha256 INTO reset_sha;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'profile_changed';
    END IF;
    INSERT INTO public.avatar_resets (action_id, account_id, sha256, until)
    VALUES (NEW.id, NEW.subject_account_id, reset_sha, now() + make_interval(days => 30));
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

  -- 3f (section 6.3). The item's row is read before anything is cleared, since it tells a new disabling from a first one
  -- or one taken again after a restore.
  IF NEW.kind = 'disable_by_order' THEN
    SELECT x.* INTO item FROM public.legal_order_items x WHERE x.id = d.order_item_id;
    SELECT x.preserve INTO preserves FROM public.legal_orders x WHERE x.id = item.order_id;
    -- An earlier preservation that ended (a reinstatement, or its end) makes this a new disabling: six months and a day
    -- from now, never from the first (TCO Art. 6(2)), and what the earlier end erased stays erased. Otherwise a kept end
    -- stays, so a measure taken again after a restore starts no new period. disabled_at keeps the first disabling,
    -- which Annex II and the clock read; a closing is cleared, since an item given effect is no closed one.
    UPDATE public.legal_order_items i
       SET decision_id = d.id, action_id = NEW.id,
           disabled_at = coalesce(i.disabled_at, now()),
           preserve_until = CASE WHEN NOT coalesce(preserves, false) THEN i.preserve_until
                                 WHEN item.preserve_ended_at IS NOT NULL THEN public.order_preserve_until(now())
                                 ELSE coalesce(i.preserve_until, public.order_preserve_until(now())) END,
           reinstated_at = NULL, preserve_ended_at = NULL, closed_at = NULL, closed_reason = NULL
     WHERE i.id = d.order_item_id;
    -- By the console, like the decision: decision_holds binds the event's decision to its audit row.
    INSERT INTO public.legal_order_events (order_id, item_id, kind, at, by_staff, via)
    VALUES (item.order_id, item.id, 'effect_given', clock_timestamp(), d.decided_by, 'console');
  ELSIF NEW.kind = 'reinstate_by_order' THEN
    -- The item whose measure this lifts: reinstated now, and a preservation that runs ends now.
    UPDATE public.legal_order_items i
       SET reinstated_at = now(),
           preserve_ended_at = CASE WHEN i.preserve_until IS NULL THEN i.preserve_ended_at ELSE coalesce(i.preserve_ended_at, now()) END
     WHERE i.action_id = NEW.reverses_action_id
    RETURNING i.* INTO item;
    INSERT INTO public.legal_order_events (order_id, item_id, kind, at, ground, by_staff, via)
    VALUES (item.order_id, item.id, 'reinstated', clock_timestamp(), NEW.order_ground, d.decided_by, 'console');
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

-- 14. decisions_apply, replaced from its text in 0030_authority_records (6.5: "the deciding transaction that answers an
-- item calls avatar_apply for the avatars avatar_reviews names under it"). It is the trigger that answers a final
-- decision's items, so after that update it derives again every avatar R1's review withheld under an item this decision
-- answered; and where it derives the posts of the interim seals that ended with the answer, it derives their avatars too.
-- Everything else is 0030's.
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
  answered integer;
  held boolean;
  -- 2d: the avatars to derive again.
  avatars uuid[];
BEGIN
  IF NEW.kind = 'order' THEN
    UPDATE public.intake_items i SET answered_by = NEW.id, outcome = 'restricted_legal'
     WHERE i.id = (SELECT x.intake_item_id FROM public.legal_order_items x WHERE x.id = NEW.order_item_id)
       AND i.case_id = NEW.case_id AND i.answered_by IS NULL;
    GET DIAGNOSTICS answered = ROW_COUNT;
    IF answered <> 1 THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'An order decision answers its own item.';
    END IF;
    SELECT count(*), min(i.lane), min(i.created_at) INTO open_items, open_lane, oldest
      FROM public.intake_items i WHERE i.case_id = NEW.case_id AND i.answered_by IS NULL;
    UPDATE public.cases k
       SET state_version = k.state_version + 1,
           last_decided_at = now(),
           lane = coalesce(open_lane, 2),
           oldest_open_at = oldest,
           answered_seq = CASE WHEN open_items = 0 THEN k.intake_seq ELSE k.answered_seq END,
           closed_at = CASE WHEN open_items = 0 THEN now() END
     WHERE k.id = NEW.case_id
    RETURNING k.* INTO c;
    IF c.closed_at IS NOT NULL THEN
      PERFORM public.moderation_apply(ARRAY[c.target_id], true);
    END IF;
  ELSIF NEW.kind = 'final' THEN
    SELECT coalesce(array_agg(m.id), '{}'::uuid[]) INTO seals_before
      FROM public.measures_in_force m WHERE m.case_id = NEW.case_id AND m.kind = 'seal_media' AND m.decision_kind = 'interim';
    UPDATE public.intake_items i
       SET answered_by = NEW.id,
           outcome = CASE NEW.outcome
                       WHEN 'restricted' THEN CASE WHEN NEW.ground = 'illegal' THEN 'restricted_legal' ELSE 'restricted_rule' END
                       WHEN 'not_evident' THEN CASE WHEN i.alleges_illegal THEN 'not_evident' ELSE 'no_violation' END
                       ELSE 'no_violation' END::public.item_outcome
     WHERE i.case_id = NEW.case_id AND i.seq BETWEEN NEW.answers_from_seq AND NEW.through_seq AND i.answered_by IS NULL;
    -- 2d: R1's hold for review ends with the answer to its item: each avatar it withheld is derived again, visible, or
    -- under a reset_avatar of this decision (applied after this row) detached.
    SELECT array_agg(r.media_id) INTO avatars FROM public.avatar_reviews r JOIN public.intake_items i ON i.id = r.item_id
     WHERE i.case_id = NEW.case_id AND i.answered_by = NEW.id;
    PERFORM public.avatar_apply(avatars);
    SELECT count(*), min(i.lane), min(i.created_at) INTO open_items, open_lane, oldest
      FROM public.intake_items i WHERE i.case_id = NEW.case_id AND i.answered_by IS NULL;
    UPDATE public.cases k
       SET state_version = k.state_version + 1,
           last_decided_at = now(),
           answered_seq = CASE WHEN open_items = 0 THEN k.intake_seq ELSE NEW.through_seq END,
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
      -- 2d: and the ended seals' avatars.
      SELECT array_agg(DISTINCT s.media_id) INTO avatars FROM public.seal_avatars s WHERE s.action_id = ANY(ended);
      PERFORM public.avatar_apply(avatars);
      IF EXISTS (SELECT 1 FROM public.decision_actions a JOIN public.decisions d ON d.id = a.decision_id WHERE a.id = ANY(ended) AND d.author_mail <> 'none') THEN
        -- 3f: a statement of its own; on a post whose order's notice is held the telling this makes owed is held too.
        held := c.target_type = 'post' AND public.order_notice_held(c.target_id);
        UPDATE public.decisions d
           SET ended_interim = true,
               author_mail = CASE WHEN d.author_mail = 'none' AND NOT held THEN 'pending'::public.delivery_state ELSE d.author_mail END,
               informed_at = CASE WHEN d.author_mail = 'none' AND held THEN NULL ELSE d.informed_at END
         WHERE d.id = NEW.id;
      END IF;
    END IF;
    -- 0030 (3f design, section 6.5): a final decision that answered a suspect item, after it answered the items, closes
    -- the account's owed records that a seal opened when no seal of the account is left in force, and releases its hold.
    IF EXISTS (SELECT 1 FROM public.intake_items i WHERE i.case_id = NEW.case_id AND i.answered_by = NEW.id AND i.suspect) THEN
      PERFORM public.report_close_unsealed(NEW.case_id);
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

-- 15. The release (6.5, 7.7). release_facts, replaced from its text in 0034_release: `quarantined` also asks every avatar
-- the seal lists that no release lists yet, while its row is there and not erased, to have both its files in the
-- quarantine by record, so seal_release refuses (release_not_quarantined) a release whose avatars are still in the store.
-- Everything else is 0034's.
CREATE OR REPLACE FUNCTION "public"."release_facts"(action uuid)
RETURNS TABLE (reported boolean, their_reference text, answer text, answered_at timestamptz, handed_over_at timestamptz, quarantined boolean, preserved boolean,
               leave_id uuid, leave_from text, leave_reference text, leave_received_on date, leave_untold boolean, leave_untold_until timestamptz, tell_held boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH open_posts AS (
    SELECT s.post_id, s.images FROM public.seal_posts s
     WHERE s.action_id = release_facts.action AND NOT EXISTS (SELECT 1 FROM public.release_posts r WHERE r.post_id = s.post_id)
  ), part AS (
    SELECT coalesce(array_agg(o.post_id ORDER BY o.post_id), '{}'::uuid[]) AS posts
      FROM (SELECT p.post_id FROM open_posts p ORDER BY p.post_id LIMIT (SELECT x.posts_max FROM public.release_rules() x)) o
  ), open_avatars AS (
    -- 2d: the seal's avatars that no release lists yet.
    SELECT s.media_id FROM public.seal_avatars s
     WHERE s.action_id = release_facts.action AND NOT EXISTS (SELECT 1 FROM public.releases x WHERE s.media_id = ANY (x.avatar_ids))
  ), standing_leave AS (
    SELECT l.* FROM public.release_leaves l
     WHERE l.notification_id = public.seal_record(release_facts.action) AND l.withdrawn_at IS NULL
     ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1
  )
  SELECT r.reported, r.their_reference, r.answer, r.answered_at,
         (SELECT max(p.delivered_at) FROM public.productions p WHERE p.seal_action_id = release_facts.action AND p.files IS NOT NULL),
         NOT EXISTS (SELECT 1 FROM open_posts o
                      WHERE (SELECT count(*) FROM public.post_media m WHERE m.post_id = o.post_id) <> o.images
                         OR EXISTS (SELECT 1 FROM public.post_media m
                                     WHERE m.post_id = o.post_id AND m.erased_at IS NULL
                                       AND (SELECT count(*) FROM public.quarantine_files q
                                             WHERE q.media_id = m.id AND q.returned_at IS NULL AND q.destroyed_at IS NULL) < 2))
           AND NOT EXISTS (SELECT 1 FROM open_avatars o JOIN public.post_media m ON m.id = o.media_id
                            WHERE m.erased_at IS NULL
                              AND (SELECT count(*) FROM public.quarantine_files q
                                    WHERE q.media_id = m.id AND q.returned_at IS NULL AND q.destroyed_at IS NULL) < 2),
         EXISTS (SELECT 1 FROM open_posts o WHERE public.post_preserved(o.post_id)),
         l.id, l.leave_from, l.reference, l.received_on, l.untold, l.untold_until,
         NOT public.release_may_tell(l.id, public.seal_record(release_facts.action), (SELECT part.posts FROM part))
    FROM public.seal_report(release_facts.action) r
    LEFT JOIN standing_leave l ON true
$$;--> statement-breakpoint

-- 16. seal_release, replaced from its text in 0041_review (6.5): the release also takes every avatar the seal lists that
-- no release lists yet (all of them with the first part, since a seal lists an account's few), writes them to
-- releases.avatar_ids beside post_ids, counts their quarantine's times in backups_clear_at, and erases their rows with the
-- posts' images in one id order. release_not_open only when both lists are empty. The confirmed params and
-- releases_confirmed are unchanged: the avatars are the seal's list, which no caller chooses. Everything else is 0041's.
CREATE OR REPLACE FUNCTION "public"."seal_release"(action uuid, basis text, leave uuid, staff uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a public.decision_actions;
  d public.decisions;
  rules record;
  f record;
  l public.release_leaves;
  v_posts uuid[];
  -- 2d: the seal's avatars that no release lists yet.
  v_avatars uuid[];
  v_role text;
  v_since timestamptz;
  v_moved timestamptz;
  v_release uuid := gen_random_uuid();
BEGIN
  SELECT x.* INTO a FROM public.decision_actions x WHERE x.id = seal_release.action;
  IF NOT FOUND OR a.kind::text <> 'seal_media' THEN
    RAISE EXCEPTION 'release_not_open';
  END IF;
  SELECT x.* INTO d FROM public.decisions x WHERE x.id = a.decision_id;
  PERFORM 1 FROM public.cases c WHERE c.id = d.case_id FOR UPDATE;
  IF d.kind::text = 'interim' OR NOT EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.id = a.id) THEN
    RAISE EXCEPTION 'release_not_open';
  END IF;
  SELECT x.* INTO rules FROM public.release_rules() x;
  SELECT coalesce(array_agg(o.post_id ORDER BY o.post_id), '{}'::uuid[]) INTO v_posts
    FROM (SELECT s.post_id FROM public.seal_posts s
           WHERE s.action_id = a.id AND NOT EXISTS (SELECT 1 FROM public.release_posts r WHERE r.post_id = s.post_id)
           ORDER BY s.post_id LIMIT rules.posts_max) o;
  SELECT coalesce(array_agg(s.media_id ORDER BY s.media_id), '{}'::uuid[]) INTO v_avatars
    FROM public.seal_avatars s
   WHERE s.action_id = a.id AND NOT EXISTS (SELECT 1 FROM public.releases x WHERE s.media_id = ANY (x.avatar_ids));
  IF cardinality(v_posts) = 0 AND cardinality(v_avatars) = 0 THEN
    RAISE EXCEPTION 'release_not_open';
  END IF;
  -- Review M2: an admin too close to the seal's subject (staff_case_conflict, 3c's recusal) is refused before any fact.
  IF public.staff_case_conflict(seal_release.staff, d.case_id, false) THEN
    RAISE EXCEPTION 'staff_recused';
  END IF;

  SELECT x.* INTO f FROM public.release_facts(a.id) x;
  IF NOT f.reported THEN
    RAISE EXCEPTION 'release_not_reported';
  END IF;
  IF NOT f.quarantined THEN
    RAISE EXCEPTION 'release_not_quarantined';
  END IF;
  IF f.preserved THEN
    RAISE EXCEPTION 'release_preserved';
  END IF;

  IF seal_release.basis = 'leave' THEN
    SELECT x.* INTO l FROM public.release_leaves x
     WHERE x.id = seal_release.leave AND x.notification_id = public.seal_record(a.id) AND x.withdrawn_at IS NULL
       FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'release_no_leave';
    END IF;
  ELSIF seal_release.basis = 'period' THEN
    IF rules.silence_days IS NULL THEN
      RAISE EXCEPTION 'release_period_unset';
    END IF;
    v_since := coalesce(f.handed_over_at, (SELECT r.sent_at FROM public.seal_report(a.id) r));
    IF v_since IS NULL OR v_since + make_interval(days => rules.silence_days) > now()
       OR NOT EXISTS (SELECT 1 FROM public.release_notices n
                       WHERE n.subject_id = a.id AND n.told::text IN ('sent', 'folded')
                         AND n.created_at <= now() - make_interval(days => rules.period_notice_days)
                         AND (n.objection IS NULL OR n.objection_answered_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'release_period_running';
    END IF;
  ELSE
    RAISE EXCEPTION 'release_no_leave';
  END IF;

  SELECT u.role::text INTO v_role FROM auth.users u
   WHERE u.id = seal_release.staff AND u.deleted_at IS NULL AND u.role <> 'user' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_confirmation_ended';
  END IF;
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  SELECT max(q.moved_at) INTO v_moved FROM public.quarantine_files q WHERE q.post_id = ANY (v_posts) OR q.media_id = ANY (v_avatars);
  INSERT INTO public.releases (id, seal_action_id, post_ids, basis, leave_id, their_reference, released_by, released_at, backups_clear_at, author_notice, avatar_ids)
  VALUES (v_release, a.id, v_posts, seal_release.basis, l.id, l.reference, seal_release.staff, now(),
          greatest(now(), coalesce(v_moved, now())) + make_interval(days => rules.backup_days), 'pending', v_avatars);
  INSERT INTO public.release_posts (post_id, release_id) SELECT p, v_release FROM unnest(v_posts) AS p;
  UPDATE public.post_media m SET erased_at = now()
    FROM (SELECT x.id FROM public.post_media x WHERE (x.post_id = ANY (v_posts) OR x.id = ANY (v_avatars)) AND x.erased_at IS NULL ORDER BY x.id FOR UPDATE) y
   WHERE m.id = y.id;
  RETURN v_release;
END $$;--> statement-breakpoint

-- 17. release_replay, replaced from its text in 0034_release (6.5): the replayed release also lists in avatar_ids, and
-- erases, the avatars that the restored database's seal_avatars lists under the gap's seal (its target) and no release
-- lists yet. The params a replay reads name posts alone, as the release's confirmed params do, so the avatars are read
-- from the seal where the restored database holds it. Everything else is 0034's.
CREATE OR REPLACE FUNCTION "public"."release_replay"(original uuid, posts uuid[], basis text, leave uuid, their_reference text, released_at timestamptz) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  g public.restore_gaps;
  rules record;
  v_posts uuid[];
  -- 2d: the avatars the restored database's seal lists that no release lists yet.
  v_avatars uuid[];
  v_id uuid := gen_random_uuid();
  v_marked integer;
  v_erased integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.releases r WHERE r.id = release_replay.original OR r.replay_of = release_replay.original) THEN
    RETURN 'present';
  END IF;
  SELECT coalesce(array_agg(DISTINCT p ORDER BY p), '{}'::uuid[]) INTO v_posts FROM unnest(release_replay.posts) AS p;
  SELECT x.* INTO g FROM public.restore_gaps x
   WHERE x.class = 'release' AND x.closed_at IS NULL AND x.action = 'seal_released' AND x.metadata ->> 'releaseId' = release_replay.original::text
     AND x.metadata -> 'params' = jsonb_build_object('postIds', to_jsonb(v_posts::text[]), 'basis', release_replay.basis, 'leaveId', release_replay.leave, 'theirReference', release_replay.their_reference)
   ORDER BY x.place, x.id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'replay_no_gap';
  END IF;
  SELECT x.* INTO rules FROM public.release_rules() x;
  SELECT coalesce(array_agg(s.media_id ORDER BY s.media_id), '{}'::uuid[]) INTO v_avatars
    FROM public.seal_avatars s
   WHERE s.action_id::text = g.target_id AND NOT EXISTS (SELECT 1 FROM public.releases x WHERE s.media_id = ANY (x.avatar_ids));
  INSERT INTO public.releases (id, post_ids, basis, leave_id, their_reference, released_at, replay_of, backups_clear_at, author_notice, imported_at, avatar_ids)
  VALUES (v_id, v_posts, release_replay.basis, release_replay.leave, release_replay.their_reference, coalesce(release_replay.released_at, g.acted_at),
          release_replay.original, now() + make_interval(days => rules.backup_days), 'none', now(), v_avatars);
  INSERT INTO public.release_posts (post_id, release_id) SELECT p, v_id FROM unnest(v_posts) AS p ON CONFLICT (post_id) DO NOTHING;
  GET DIAGNOSTICS v_marked = ROW_COUNT;
  UPDATE public.post_media m SET erased_at = now()
    FROM (SELECT x.id FROM public.post_media x WHERE (x.post_id = ANY (v_posts) OR x.id = ANY (v_avatars)) AND x.erased_at IS NULL ORDER BY x.id FOR UPDATE) y
   WHERE m.id = y.id;
  GET DIAGNOSTICS v_erased = ROW_COUNT;
  UPDATE public.restore_gaps x SET closed_at = now(), disposition = 'imported' WHERE x.id = g.id;
  RETURN format('replayed %s %s', v_marked, v_erased);
END $$;--> statement-breakpoint

-- 18. The quarantine (7.7: "3d's quarantine service moves a sealed avatar's two files as it moves a held upload's").
-- quarantine_plan, replaced from its text in 0039_known_material: an avatar a seal for good in force lists is moved in
-- (an `in` line) while its row is unerased; an avatar a seal listed and no seal for good lists now, that is not erased,
-- not released and not a held upload, returns (an `out` line), so a lifted seal's avatar is served again; and a file of
-- an avatar a release lists is destroyed as a released post's. Everything else is 0039's.
CREATE OR REPLACE FUNCTION "public"."quarantine_plan"() RETURNS TABLE (direction text, media_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH good AS (
    SELECT DISTINCT s.post_id FROM public.seal_posts s JOIN public.measures_in_force f ON f.id = s.action_id
     WHERE f.kind = 'seal_media' AND f.decision_kind <> 'interim'
  ), good_avatars AS (
    -- 2d: an avatar a seal for good in force lists.
    SELECT DISTINCT s.media_id FROM public.seal_avatars s JOIN public.measures_in_force f ON f.id = s.action_id
     WHERE f.kind = 'seal_media' AND f.decision_kind <> 'interim'
  ), held AS (
    -- 0039: the image of a refusal that ended as report and is not released counts as sealed for good.
    SELECT u.media_id FROM public.upload_refusals u WHERE u.end_as = 'report' AND u.release_id IS NULL
  ), open_files AS (
    SELECT q.media_id, bool_or(q.unknown) AS unknown,
           bool_or(EXISTS (SELECT 1 FROM public.release_posts r WHERE r.post_id = q.post_id)
                   OR EXISTS (SELECT 1 FROM public.releases x WHERE q.media_id = ANY (x.avatar_ids))) AS released
      FROM public.quarantine_files q
     WHERE q.returned_at IS NULL AND q.destroyed_at IS NULL AND q.lost_at IS NULL GROUP BY q.media_id
  ), kept AS (
    SELECT q.media_id FROM public.quarantine_files q
     WHERE q.returned_at IS NULL AND q.destroyed_at IS NULL GROUP BY q.media_id HAVING count(*) = 2
  )
  SELECT 'in'::text, m.id FROM public.post_media m JOIN good g ON g.post_id = m.post_id
   WHERE m.erased_at IS NULL AND NOT EXISTS (SELECT 1 FROM kept k WHERE k.media_id = m.id)
  UNION ALL
  SELECT 'in'::text, m.id FROM public.post_media m JOIN held h ON h.media_id = m.id
   WHERE m.post_id IS NULL AND m.erased_at IS NULL AND NOT EXISTS (SELECT 1 FROM kept k WHERE k.media_id = m.id)
  UNION ALL
  SELECT 'in'::text, m.id FROM public.post_media m JOIN good_avatars g ON g.media_id = m.id
   WHERE m.erased_at IS NULL AND NOT EXISTS (SELECT 1 FROM kept k WHERE k.media_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM held h WHERE h.media_id = m.id)
  UNION ALL
  SELECT 'out'::text, o.media_id FROM open_files o JOIN public.post_media m ON m.id = o.media_id
   WHERE NOT o.unknown AND m.post_id IS NOT NULL AND m.erased_at IS NULL AND NOT EXISTS (SELECT 1 FROM good g WHERE g.post_id = m.post_id)
  UNION ALL
  SELECT 'out'::text, o.media_id FROM open_files o JOIN public.post_media m ON m.id = o.media_id
   WHERE NOT o.unknown AND m.post_id IS NULL AND m.erased_at IS NULL AND NOT o.released
     AND EXISTS (SELECT 1 FROM public.seal_avatars s WHERE s.media_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM good_avatars g WHERE g.media_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.upload_refusals u WHERE u.media_id = m.id)
  UNION ALL
  SELECT 'destroy'::text, o.media_id FROM open_files o
   WHERE NOT o.unknown AND (o.released OR NOT EXISTS (SELECT 1 FROM public.post_media m WHERE m.id = o.media_id)
                            OR EXISTS (SELECT 1 FROM public.upload_refusals u WHERE u.media_id = o.media_id AND u.release_id IS NOT NULL))
  UNION ALL
  SELECT 'operator'::text, o.media_id FROM open_files o WHERE o.unknown
$$;--> statement-breakpoint

-- 19. quarantine_counts, replaced from its text in 0039_known_material: a sealed avatar to move in is due since the first
-- seal for good that lists it, and one to return since that seal was lifted, as a post's image. Everything else is 0039's.
CREATE OR REPLACE FUNCTION "public"."quarantine_counts"() RETURNS TABLE (due_in integer, due_out integer, undestroyed integer, oldest timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH plan AS (
    SELECT p.direction, p.media_id FROM public.quarantine_plan() p
  ), in_at AS (
    -- 0039: a held upload's image is due since its hold ended as report.
    SELECT min(coalesce(f_d.decided_at,
                        -- 2d: a sealed avatar's image is due since the first seal for good that lists it.
                        (SELECT min(d.decided_at) FROM public.seal_avatars s
                           JOIN public.measures_in_force f ON f.id = s.action_id AND f.kind = 'seal_media' AND f.decision_kind <> 'interim'
                           JOIN public.decisions d ON d.id = f.decision_id
                          WHERE s.media_id = p.media_id),
                        (SELECT u.ended_at FROM public.upload_refusals u WHERE u.media_id = p.media_id))) AS at
      FROM plan p JOIN public.post_media m ON m.id = p.media_id
      JOIN LATERAL (SELECT min(d.decided_at) AS decided_at FROM public.seal_posts s
                      JOIN public.measures_in_force f ON f.id = s.action_id AND f.kind = 'seal_media' AND f.decision_kind <> 'interim'
                      JOIN public.decisions d ON d.id = f.decision_id
                     WHERE s.post_id = m.post_id) f_d ON true
     WHERE p.direction = 'in'
  ), out_at AS (
    SELECT min(greatest(
             (SELECT max(r.created_at) FROM public.seal_posts s
                JOIN public.decision_actions a ON a.id = s.action_id AND a.kind = 'seal_media'
                JOIN public.decisions d ON d.id = a.decision_id AND d.kind <> 'interim'
                JOIN public.decision_actions r ON r.reverses_action_id = a.id
               WHERE s.post_id = m.post_id),
             -- 2d: a sealed avatar's files are due back since its seal for good was lifted.
             (SELECT max(r.created_at) FROM public.seal_avatars s
                JOIN public.decision_actions a ON a.id = s.action_id AND a.kind = 'seal_media'
                JOIN public.decisions d ON d.id = a.decision_id AND d.kind <> 'interim'
                JOIN public.decision_actions r ON r.reverses_action_id = a.id
               WHERE s.media_id = p.media_id),
             (SELECT max(q.moved_at) FROM public.quarantine_files q
               WHERE q.media_id = p.media_id AND q.returned_at IS NULL AND q.destroyed_at IS NULL AND q.lost_at IS NULL))) AS at
      FROM plan p JOIN public.post_media m ON m.id = p.media_id
     WHERE p.direction = 'out'
  )
  SELECT (SELECT count(*) FROM plan WHERE direction = 'in')::integer,
         (SELECT count(*) FROM plan WHERE direction = 'out')::integer,
         (SELECT count(*) FROM public.quarantine_files q JOIN plan p ON p.media_id = q.media_id AND p.direction = 'destroy'
           WHERE q.returned_at IS NULL AND q.destroyed_at IS NULL AND q.lost_at IS NULL)::integer,
         least((SELECT at FROM in_at), (SELECT at FROM out_at))
$$;--> statement-breakpoint

-- 20. erase_case_evidence, replaced from its text in 0018_retention (6.7: an avatar_resets row and an avatar_reviews row
-- are kept as long as their case's evidence and erased by 3c's retention of it): before the holds are released it
-- deletes the avatar_resets rows of the case's decisions' resets and the avatar_reviews rows of the case's items, and
-- counts them among the rows it changed. A reset's 30 days are over by then: the evidence is due 30 days after a reset
-- stopped being in force at the earliest (case_evidence_due_at above). Everything else is 0018's.
CREATE OR REPLACE FUNCTION "public"."erase_case_evidence"(case_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  due timestamptz;
  changed integer;
  n integer;
BEGIN
  PERFORM 1 FROM public.cases c WHERE c.id = erase_case_evidence.case_id FOR UPDATE;
  SELECT public.case_evidence_due_at(erase_case_evidence.case_id) INTO due;
  IF due IS NULL OR due > now() THEN
    RAISE EXCEPTION 'not_due';
  END IF;

  SELECT public.erase_snapshots(ARRAY(SELECT s.id FROM public.evidence_snapshots s
                                       WHERE s.case_id = erase_case_evidence.case_id AND s.erased_at IS NULL)) INTO changed;

  UPDATE public.staff_texts t SET text = NULL, salt = NULL, erased_at = now()
   WHERE t.case_id = erase_case_evidence.case_id AND t.confirmed_at IS NULL AND t.erased_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  changed := changed + n;

  UPDATE public.appeals a SET statement = NULL, statement_salt = NULL, erased_at = now()
   WHERE a.statement IS NOT NULL
     AND a.decision_id IN (SELECT d.id FROM public.decisions d WHERE d.case_id = erase_case_evidence.case_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  changed := changed + n;

  -- 2d: the reset pictures' hashes of the case's resets and R1's holds for review under its items go with its evidence.
  DELETE FROM public.avatar_resets r
   WHERE r.action_id IN (SELECT a.id FROM public.decision_actions a JOIN public.decisions d ON d.id = a.decision_id
                          WHERE d.case_id = erase_case_evidence.case_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  changed := changed + n;
  DELETE FROM public.avatar_reviews r
   WHERE r.item_id IN (SELECT i.id FROM public.intake_items i WHERE i.case_id = erase_case_evidence.case_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  changed := changed + n;

  SELECT public.release_case_holds(erase_case_evidence.case_id, NULL) INTO n;
  RETURN changed + n;
END $$;

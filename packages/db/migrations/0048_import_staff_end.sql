ALTER TABLE "import_jobs" DROP CONSTRAINT "import_jobs_staff";--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "staff_case_id" uuid;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "staff_decision_id" uuid;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_staff" CHECK (("import_jobs"."staff_ended_at" is null) = ("import_jobs"."staff_rule_id" is null) and ("import_jobs"."staff_ended_at" is null) = ("import_jobs"."staff_case_id" is null) and ("import_jobs"."staff_ended_at" is null) = ("import_jobs"."staff_decision_id" is null));
--> statement-breakpoint
-- Everything below is written by hand (3b Task 6, the orchestrator's rulings of 2026-10-26 on the design's sections 6.1,
-- 8.7 and 9.3), in the conventions of 0043: every function owned by the migrator, its search path pinned to public and
-- pg_temp, every object schema-qualified, a guard's refusal import_column under SQLSTATE 42501, the migrator skipped.
-- The lines drizzle generated above add import_jobs.staff_case_id and staff_decision_id, the case about one of the
-- import's posts that an admin ended the import from and the decision recorded on it that the end rests on, so the
-- person's screen links to that decision; import_jobs_staff now holds the staff end's four columns set together or not
-- at all. Neither names its table by a foreign key: the moderation module's retention erases on its own clock.
--
-- 1. The grant (6.4): the API role may UPDATE the two new columns, under import_jobs_guard.
GRANT UPDATE ("staff_case_id", "staff_decision_id") ON "public"."import_jobs" TO korbat_api;--> statement-breakpoint

-- 2. import_jobs_insert, replaced: 0047's text, byte for byte, with two lines more: a new import was ended by nobody, so
-- the two new columns are forced to null with the other two of the staff end. CREATE OR REPLACE keeps the function's
-- owner, its grants and its trigger.
CREATE OR REPLACE FUNCTION "public"."import_jobs_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'korbat_migrate' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles a WHERE a.id = NEW.owner_id AND a.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  NEW.status := 'uploading';
  NEW.created_at := clock_timestamp();
  NEW.received_bytes := 0;
  NEW.uploaded_at := NULL;
  NEW.scanned_at := NULL;
  NEW.confirmed_at := NULL;
  NEW.ended_at := NULL;
  NEW.failure := NULL;
  NEW.stop_reason := NULL;
  NEW.staff_ended_at := NULL;
  NEW.staff_rule_id := NULL;
  NEW.staff_case_id := NULL;
  NEW.staff_decision_id := NULL;
  NEW.refused_at_original := NULL;
  NEW.refused_words := NULL;
  NEW.scan := NULL;
  NEW.choice := NULL;
  NEW.stated_at := NULL;
  NEW.seed := NULL;
  NEW.post_cursor := 0;
  NEW.image_cursor := 0;
  NEW.posts_published := 0;
  NEW.images_kept := 0;
  NEW.images_left_out := 0;
  NEW.images_left_out_by := '{}'::jsonb;
  NEW.posts_removed := 0;
  RETURN NEW;
END $$;--> statement-breakpoint

-- 3. import_jobs_guard, replaced: 0047's text, byte for byte, with its rule of the staff end over the four columns: they
-- change only in the move into stopped or undoing that sets them first (the move an admin's end makes, 8.7), and the
-- move into stopped sets them exactly when its reason is by_staff. CHECK import_jobs_staff holds the four together.
CREATE OR REPLACE FUNCTION "public"."import_jobs_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  was text;
  goes text;
  moved boolean;
  confirming boolean;
BEGIN
  IF current_user = 'korbat_migrate' THEN
    RETURN NEW;
  END IF;
  was := OLD.status::text;
  goes := NEW.status::text;
  moved := goes <> was;
  confirming := moved AND was = 'ready' AND goes IN ('preparing', 'publishing');
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.source::text IS DISTINCT FROM OLD.source::text
     OR NEW.declared_bytes IS DISTINCT FROM OLD.declared_bytes OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF moved AND (was, goes) NOT IN (('uploading', 'scanning'), ('uploading', 'failed'), ('uploading', 'cancelled'), ('uploading', 'expired'),
                                   ('scanning', 'ready'), ('scanning', 'failed'), ('scanning', 'cancelled'),
                                   ('ready', 'preparing'), ('ready', 'publishing'), ('ready', 'cancelled'), ('ready', 'expired'),
                                   ('preparing', 'publishing'), ('preparing', 'stopped'),
                                   ('publishing', 'done'), ('publishing', 'stopped'),
                                   ('done', 'undoing'), ('stopped', 'undoing'), ('undoing', 'undone')) THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF moved AND was = 'stopped' AND goes = 'undoing' AND NEW.posts_published <= 0 THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF (NEW.ended_at IS DISTINCT FROM OLD.ended_at AND NOT (moved AND goes IN ('done', 'stopped', 'undone', 'failed', 'cancelled', 'expired')))
     OR (moved AND goes IN ('done', 'stopped', 'undone', 'failed', 'cancelled', 'expired') AND NEW.ended_at IS NULL) THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF (NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at AND NOT (moved AND goes = 'scanning'))
     OR (moved AND goes = 'scanning' AND (NEW.uploaded_at IS NULL OR NEW.received_bytes <> NEW.declared_bytes)) THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF (NEW.scanned_at IS DISTINCT FROM OLD.scanned_at AND NOT (moved AND was = 'scanning'))
     OR (moved AND was = 'scanning' AND NEW.scanned_at IS NULL) THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF (NEW.scan IS DISTINCT FROM OLD.scan AND NOT (moved AND (goes = 'ready' OR was = 'ready')))
     OR (moved AND goes = 'ready' AND NEW.scan IS NULL)
     OR (moved AND was = 'ready' AND (NEW.scan -> 'months' IS DISTINCT FROM '[]'::jsonb OR NEW.scan -> 'samples' IS DISTINCT FROM '[]'::jsonb
                                      OR NEW.scan -> 'pages' IS DISTINCT FROM '[]'::jsonb OR NEW.scan #> '{skipped,not_public}' IS NOT NULL)) THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF ((NEW.choice IS DISTINCT FROM OLD.choice OR NEW.stated_at IS DISTINCT FROM OLD.stated_at OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at) AND NOT confirming)
     OR (NEW.seed IS DISTINCT FROM OLD.seed AND NOT confirming AND NEW.seed IS NOT NULL)
     OR (confirming AND (NEW.choice IS NULL OR NEW.stated_at IS NULL OR NEW.confirmed_at IS NULL OR NEW.seed IS NULL))
     OR (moved AND goes IN ('done', 'stopped') AND NEW.seed IS NOT NULL) THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF (NEW.failure IS DISTINCT FROM OLD.failure AND NOT (moved AND goes = 'failed'))
     OR (NEW.stop_reason IS DISTINCT FROM OLD.stop_reason AND NOT (moved AND goes = 'stopped')) THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF ((NEW.staff_ended_at IS DISTINCT FROM OLD.staff_ended_at OR NEW.staff_rule_id IS DISTINCT FROM OLD.staff_rule_id
       OR NEW.staff_case_id IS DISTINCT FROM OLD.staff_case_id OR NEW.staff_decision_id IS DISTINCT FROM OLD.staff_decision_id)
      AND NOT (moved AND goes IN ('stopped', 'undoing') AND OLD.staff_ended_at IS NULL AND OLD.staff_rule_id IS NULL
               AND OLD.staff_case_id IS NULL AND OLD.staff_decision_id IS NULL))
     OR (moved AND goes = 'stopped' AND (NEW.stop_reason IS NOT DISTINCT FROM 'by_staff') <> (NEW.staff_ended_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF (NEW.refused_at_original IS DISTINCT FROM OLD.refused_at_original OR NEW.refused_words IS DISTINCT FROM OLD.refused_words)
     AND NOT (moved AND goes = 'stopped' AND NEW.stop_reason IS NOT DISTINCT FROM 'refused_image') THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF NEW.received_bytes < OLD.received_bytes OR NEW.post_cursor < OLD.post_cursor OR NEW.image_cursor < OLD.image_cursor
     OR NEW.posts_published < OLD.posts_published OR NEW.images_kept < OLD.images_kept OR NEW.images_left_out < OLD.images_left_out
     OR NEW.posts_removed < OLD.posts_removed THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(NEW.images_left_out_by) = 'object' THEN
    IF NEW.images_left_out_by IS DISTINCT FROM OLD.images_left_out_by
       AND (EXISTS (SELECT 1 FROM jsonb_each(NEW.images_left_out_by) e
                     WHERE CASE WHEN jsonb_typeof(e.value) <> 'number' THEN true
                                ELSE (e.value)::numeric <> trunc((e.value)::numeric)
                                     OR (e.value)::numeric < coalesce((OLD.images_left_out_by ->> e.key)::numeric, 0) END)
            OR EXISTS (SELECT 1 FROM jsonb_each(OLD.images_left_out_by) o WHERE NOT (NEW.images_left_out_by ? o.key))) THEN
      RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
    END IF;
    IF (SELECT coalesce(sum((e.value)::numeric), 0) FROM jsonb_each(NEW.images_left_out_by) e) <> NEW.images_left_out THEN
      RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

-- 4. append_confirmed_audit, replaced from its text in 0039_known_material: its list of actions gains
-- import_ended_by_staff, an admin's end of a whole import (8.7), last. Nothing else changes.
CREATE OR REPLACE FUNCTION "public"."append_confirmed_audit"(actor_id uuid, key_id uuid, action text, target_type text, target_id text, metadata jsonb, staff_session uuid, action_hash text, step_up jsonb, request_id text, expires_ms bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  place bigint;
  stamped timestamptz;
BEGIN
  IF append_confirmed_audit.action IS NULL OR append_confirmed_audit.action NOT IN ('case_decided', 'appeals_reviewed', 'identity_revealed', 'order_event_recorded', 'order_corrected', 'order_effected', 'gap_closed', 'audit_exported', 'seal_released', 'upload_released', 'upload_hold_ended', 'import_ended_by_staff') THEN
    RAISE EXCEPTION '%', format('append_confirmed_audit does not write the action %L', append_confirmed_audit.action);
  END IF;
  IF append_confirmed_audit.actor_id IS NULL OR append_confirmed_audit.key_id IS NULL OR append_confirmed_audit.staff_session IS NULL
     OR append_confirmed_audit.action_hash IS NULL OR append_confirmed_audit.step_up IS NULL OR append_confirmed_audit.expires_ms IS NULL THEN
    RAISE EXCEPTION 'append_confirmed_audit needs an actor, a key, a staff session, an action hash, a step-up and an expiry';
  END IF;
  PERFORM 1 FROM auth.users u WHERE u.id = append_confirmed_audit.actor_id AND u.deleted_at IS NULL AND u.role <> 'user' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_confirmation_ended';
  END IF;
  PERFORM 1 FROM auth.staff_keys k
    WHERE k.id = append_confirmed_audit.key_id AND k.user_id = append_confirmed_audit.actor_id AND k.revoked_at IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_confirmation_ended';
  END IF;
  IF append_confirmed_audit.action = 'identity_revealed' THEN
    UPDATE public.staff_texts t SET confirmed_at = now()
     WHERE t.kind = 'reveal_reason' AND t.author_id = append_confirmed_audit.actor_id
       AND t.case_id = (SELECT i.case_id FROM public.intake_items i WHERE i.id::text = append_confirmed_audit.target_id)
       AND t.digest = append_confirmed_audit.metadata -> 'params' ->> 'reasonDigest'
       AND t.confirmed_at IS NULL AND t.erased_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'text_not_found';
    END IF;
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_type, target_id, metadata, staff_session, key_id, action_hash, step_up, request_id)
  VALUES (append_confirmed_audit.actor_id, append_confirmed_audit.action, append_confirmed_audit.target_type, append_confirmed_audit.target_id,
          coalesce(append_confirmed_audit.metadata, '{}'::jsonb), append_confirmed_audit.staff_session, append_confirmed_audit.key_id,
          append_confirmed_audit.action_hash, append_confirmed_audit.step_up, append_confirmed_audit.request_id)
  RETURNING chain_seq, created_at INTO place, stamped;
  IF floor(extract(epoch FROM stamped) * 1000) >= append_confirmed_audit.expires_ms THEN
    RAISE EXCEPTION 'staff_confirmation_late';
  END IF;
  RETURN place;
END $$;--> statement-breakpoint

-- 5. gap_close, replaced from its text in 0034_release (the orchestrator's ruling for Task 6): restore-import writes a
-- lost import_ended_by_staff row as an open gap of the class restriction on the import (apps/api/src/cli/restore.ts),
-- which an admin closes by ending the import again from a case, with the gap named, as a decision closes the gap of a
-- lost decision. The decision branch below asks for a decision made by the closing transaction, which an end never makes:
-- so a gap of that action is closed, before that branch, by the end's own decision, which the import's row must now hold
-- with this transaction's time. Everything else is 0034's text.
CREATE OR REPLACE FUNCTION "public"."gap_close"(gap uuid, decision uuid, by_staff uuid) RETURNS void
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
  -- 0034: a gap of the class release (a lost release, a lost leave or a lost withdrawal of one) is closed only by its
  -- command, release-replay or release-leave, as the migrator: no key closes it, neither as not needed nor by a decision.
  IF g.class = 'release' THEN
    RAISE EXCEPTION 'gap_mismatch' USING DETAIL = 'class: a release gap is closed by staff.js release-replay or release-leave, not by a key.';
  END IF;

  -- 0048 (3b Task 6): a lost admin's end of an import (import_ended_by_staff) is taken again by ending that import again:
  -- with a decision, the gap closes only in the transaction of that end, by a live admin, when the import the gap names
  -- now carries a staff end by this decision, set at this transaction's time (its staff_ended_at is now()). No decision
  -- of the case closes it, whatever its class says, and as not needed it closes as every gap does, below.
  IF g.action = 'import_ended_by_staff' AND gap_close.decision IS NOT NULL THEN
    SELECT u.role::text INTO v_role FROM auth.users u
     WHERE u.id = gap_close.by_staff AND u.deleted_at IS NULL AND u.role <> 'user' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'staff_confirmation_ended';
    END IF;
    IF v_role <> 'admin' THEN
      RAISE EXCEPTION 'admin_required';
    END IF;
    IF g.target_type IS DISTINCT FROM 'import' OR NOT EXISTS (
         SELECT 1 FROM public.import_jobs j
          WHERE j.id::text = g.target_id AND j.staff_decision_id = gap_close.decision AND j.staff_ended_at = now()) THEN
      RAISE EXCEPTION 'gap_mismatch' USING DETAIL = 'import: the import the gap names was not ended again by this transaction, by this decision.';
    END IF;
    UPDATE public.restore_gaps x SET closed_at = now(), closed_by = gap_close.decision, disposition = 'reapplied' WHERE x.id = g.id;
    RETURN;
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

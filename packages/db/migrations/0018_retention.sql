-- Retention (3c design, section 6.4). Written by hand: this migration changes no table. Each kind of data has a due rule
-- of its own, read only from the anchors of the data it erases, and an erase function of its own, which checks that rule
-- itself against values the API role cannot set: so the retention job names what it believes is due, and the database
-- decides. No due rule knows the freeze of the path for suspected child sexual abuse material: a frozen post's snapshots
-- are kept by erase_snapshots (gate E), the one function that erases a snapshot, and its image rows by the keep trigger
-- of migration 0015 (gate K), which every erase function and every delete meets. As in 0016 and 0017, every function is
-- owned by the migrator, pins its search path, names every object schema-qualified and has EXECUTE taken from PUBLIC;
-- errors carry their code as the message under SQLSTATE P0001 unless a SQLSTATE is named; and a read that follows a lock is
-- a statement of its own, which under READ COMMITTED sees every row committed while the lock waited. The periods (24
-- hours, 30 days, 12 months) are the contracts' RETENTION, which a database test holds these functions to.
--
-- When a decision is final for its author: for a final decision that restricts, the answer to the author's appeal (null
-- while one is pending) or, when none was filed, the end of the appeal's window; for every other decision the moment it
-- was taken, since what korbat does while it decides, a decision without action, a review and a correction cannot be
-- appealed. Null for an id that names no decision.
CREATE FUNCTION "public"."decision_final_at"(decision_id uuid) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
           WHEN d.kind = 'final' AND d.outcome = 'restricted'
             THEN CASE WHEN a.id IS NULL THEN public.appeal_deadline(d.informed_at) ELSE a.answered_at END
           ELSE d.decided_at
         END
    FROM public.decisions d
    LEFT JOIN public.appeals a ON a.decision_id = d.id
   WHERE d.id = decision_final_at.decision_id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."decision_final_at"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."decision_final_at"(uuid) TO korbat_api;--> statement-breakpoint
-- When a case's evidence (its snapshots, notes, draft texts, appeal statements and holds) is due. Null, which is "not
-- due", while the case is open, and while a final restriction of the case with a measure in force is not yet final for its
-- author. Otherwise the latest of: the case's close; when those restrictions became final; 24 hours after the case's
-- newest unerased snapshot and its newest unconfirmed, unerased text, so that a snapshot or a draft taken on a case
-- already due, for a correction or a review, is not erased under the person using it; and 30 days after each field reset
-- of the case stopped being in force (its reversal, or the case's close for a reset taken while deciding), so that the
-- person can read the old value on the screen of the decision that reset it for at least that long. It reads nothing
-- about items, mails, releases, notifiers or the freeze.
CREATE FUNCTION "public"."case_evidence_due_at"(case_id uuid) RETURNS timestamptz
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
               WHERE d.case_id = c.id AND a.kind IN ('reset_display_name', 'reset_bio')
                 AND NOT EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.id = a.id)))
         END
    FROM public.cases c
   WHERE c.id = case_evidence_due_at.case_id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."case_evidence_due_at"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."case_evidence_due_at"(uuid) TO korbat_api;--> statement-breakpoint
-- When an intake's record (its explanation, its cited law, who sent it and its re-examinations' statements) is due. Null
-- while korbat still owes any of its items something: an answer (a re-examination included), the release of an outcome or
-- of a changed outcome, a mail, or the chance to ask for a re-examination, which is open by the attach trigger's own rule
-- (a moderator's answer without action, released, inside the six months, not re-examined, and either no re-examination
-- itself or one about a post that is not suspect, answered while nobody could open the post's images); and while a
-- restriction that answered one of its items is not yet final for its author, so that a reversal on the author's appeal
-- still reaches a signed-in reporter. Otherwise 30 days after the last release, while the reporter's list shows it.
CREATE FUNCTION "public"."intake_due_at"(intake_id uuid) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM public.intake_items i
                         LEFT JOIN public.decisions d ON d.id = i.answered_by
                        WHERE i.intake_id = n.id
                          AND (i.outcome IS NULL
                            OR i.revision_pending_at IS NOT NULL
                            OR i.outcome_sent_at IS NULL
                            OR i.outcome_mail = 'pending'
                            OR (i.outcome IN ('no_violation', 'not_evident') AND i.answered_by IS NOT NULL
                                AND public.appeal_deadline(i.outcome_sent_at) > now()
                                AND NOT EXISTS (SELECT 1 FROM public.intake_items x WHERE x.reexamines_item_id = i.id)
                                AND (i.reexamines_item_id IS NULL OR (i.target_type = 'post' AND NOT i.suspect AND d.unseen)))
                            OR (d.outcome = 'restricted' AND coalesce(public.decision_final_at(d.id) > now(), true)))) THEN NULL
           ELSE (SELECT max(greatest(i.outcome_sent_at, i.revised_sent_at)) + interval '30 days'
                   FROM public.intake_items i WHERE i.intake_id = n.id)
         END
    FROM public.intakes n
   WHERE n.id = intake_due_at.intake_id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."intake_due_at"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."intake_due_at"(uuid) TO korbat_api;--> statement-breakpoint
-- Erases a case's evidence once it is due, and answers how many rows it changed. First the case's row FOR UPDATE: that
-- waits for a decision on the case, for an appeal being filed (which holds the row FOR KEY SHARE) and for the insert of
-- a snapshot or a text (their foreign keys hold it the same way); then the due time is read in a statement of its own,
-- which sees what they committed (without the lock, a decision that had read its snapshot unerased committed naming a
-- snapshot the erasure had just erased). A null due time is not due. It then erases the case's unerased snapshots
-- through the one function that erases a snapshot, which keeps those of a frozen post; the case's notes and unconfirmed
-- texts (a text a decision confirmed is that decision's statement, kept until its own rule erases it); and the statements
-- of the appeals of the case's decisions, each with its digest kept. Last it releases the case's holds, which frees no
-- image of a frozen post: the keep trigger holds those whether a hold stands or not. It touches no intake.
CREATE FUNCTION "public"."erase_case_evidence"(case_id uuid) RETURNS integer
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

  SELECT public.release_case_holds(erase_case_evidence.case_id, NULL) INTO n;
  RETURN changed + n;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."erase_case_evidence"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."erase_case_evidence"(uuid) TO korbat_api;--> statement-breakpoint
-- Gate E: the one function that erases a snapshot's content, and the only writer of evidence_snapshots.erased_at. In one
-- statement it erases each named snapshot that is not erased yet (the content columns and the salt null, the digest, the
-- handles, the ids and the times kept), except a snapshot of a post that is frozen: so no path erases a snapshot of a
-- frozen post, in whatever case the snapshot is, and no due rule needs a term for it. It answers how many it erased. It
-- judges the freeze on its statement's snapshot: a suspect item that commits during that statement is not seen, and the
-- outcome equals "erased first, reported second". Outside READ COMMITTED that read would see the transaction's old
-- snapshot, so it refuses to run there (read_committed_only, as the keep trigger does). Nobody may call it: the two
-- erasures of this migration do, as its owner.
CREATE FUNCTION "public"."erase_snapshots"(snapshots uuid[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n integer;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'read_committed_only' USING ERRCODE = '25000';
  END IF;
  UPDATE public.evidence_snapshots s
     SET erased_at = now(), body = NULL, media = NULL, display_name = NULL, bio = NULL, salt = NULL
   WHERE s.id = ANY(erase_snapshots.snapshots) AND s.erased_at IS NULL
     AND NOT (s.target_type = 'post' AND public.post_frozen(s.target_id));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."erase_snapshots"(uuid[]) FROM PUBLIC;--> statement-breakpoint
-- Erases an intake's record once it is due, and answers how many rows it changed. First the intake's row FOR UPDATE,
-- which a re-examination waits for (the attach trigger holds the row FOR KEY SHARE and then refuses an erased intake);
-- then the due time, in a statement of its own. It nulls the explanation and the cited law and marks the intake erased
-- (its good-faith statement stays), forgets who sent it, on the intake and on its items, so that who reported whom goes
-- with the record, and erases its re-examinations' statements, each with its digest kept.
CREATE FUNCTION "public"."erase_intake"(intake_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  due timestamptz;
  changed integer;
  n integer;
BEGIN
  PERFORM 1 FROM public.intakes k WHERE k.id = erase_intake.intake_id FOR UPDATE;
  SELECT public.intake_due_at(erase_intake.intake_id) INTO due;
  IF due IS NULL OR due > now() THEN
    RAISE EXCEPTION 'not_due';
  END IF;

  UPDATE public.intakes k SET explanation = NULL, cited_law = NULL, reporter_id = NULL, erased_at = now()
   WHERE k.id = erase_intake.intake_id AND k.erased_at IS NULL;
  GET DIAGNOSTICS changed = ROW_COUNT;

  UPDATE public.intake_items i SET reporter_account_id = NULL
   WHERE i.intake_id = erase_intake.intake_id AND i.reporter_account_id IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  changed := changed + n;

  UPDATE public.intake_items i SET statement = NULL, statement_salt = NULL, erased_at = now()
   WHERE i.intake_id = erase_intake.intake_id AND i.statement IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN changed + n;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."erase_intake"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."erase_intake"(uuid) TO korbat_api;--> statement-breakpoint
-- Erases a decision's statement texts (its facts, its reason and its legal reference; for a review or a correction the
-- reason it gave), each with its digest kept, once the decision's subject account has been deleted for 12 months, and
-- answers how many it erased. The retention job finds its candidates by the profile's deletion mark, which the API role
-- can write; this function decides by the auth row's mark, which the API's other role can set only to now() and never
-- clear (users_deleted_mark, below), so code running as the API cannot erase a live account's statements. The take-down
-- marks the auth row before the purge marks the profile, so the function never refuses a decision the job names in good
-- faith. The decision's row is locked first, so two erasures of one decision run one after the other.
CREATE FUNCTION "public"."erase_statement_texts"(decision_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d public.decisions;
  subject uuid;
  deleted timestamptz;
  n integer;
BEGIN
  SELECT x.* INTO d FROM public.decisions x WHERE x.id = erase_statement_texts.decision_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_due';
  END IF;
  SELECT CASE WHEN k.target_type = 'post' THEN (SELECT p.author_id FROM public.posts p WHERE p.id = k.target_id) ELSE k.target_id END
    INTO subject
    FROM public.cases k WHERE k.id = d.case_id;
  SELECT u.deleted_at INTO deleted FROM auth.users u WHERE u.id = subject;
  IF deleted IS NULL OR deleted > now() - interval '12 months' THEN
    RAISE EXCEPTION 'not_due';
  END IF;
  UPDATE public.staff_texts t SET text = NULL, salt = NULL, erased_at = now()
   WHERE t.digest IN (d.facts_digest, d.reason_digest, d.legal_reference_digest) AND t.erased_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."erase_statement_texts"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."erase_statement_texts"(uuid) TO korbat_api;--> statement-breakpoint
-- The R4 redaction: content restricted under rule R4 (personal information) is erased once the restriction is final for
-- its author, a one-way erasure keyed on the decision's measures in force. True when it changed something. In this order:
--   1. It refuses (invalid_decision) any decision that is not final, does not cite R4, or holds no removal of a post or
--      an image and no field reset.
--   2. Its locks, before it writes anything, in the order of every other transaction that touches moderation: for an
--      account case the profile's row FOR NO KEY UPDATE; the decision's case FOR UPDATE, so it waits for a decision on the
--      case or an appeal being filed and sees their commits; for a post case the post's row FOR UPDATE and then, in a
--      statement of its own, every image row of the post in id order FOR NO KEY UPDATE. Writing an image's erasure mark
--      before locking the post's images in order deadlocked with an intake locking the same images.
--   3. Then, each in a statement of its own: it refuses to run outside READ COMMITTED (read_committed_only), where its
--      reads would see the transaction's old snapshot; it refuses (not_due) a decision that is not yet final for its
--      author; and it changes nothing and answers false unless the decision is not redacted yet and one of its R4 measures
--      is in force, whatever the post's lifecycle (the author's deletion and the purge leave korbat's copies, which must
--      still go). For a post case it also changes nothing and answers false while the post is frozen: the post's body,
--      its images and its snapshots in every case then wait for the end of the freeze, and the caller tries again later.
--   4. For a post removal in force it blanks the post's body and marks the post erased, which removes it for good; for
--      an image removal in force it marks that image erased. The post's mark is set only for a post-level removal. A mark
--      that is already set keeps its time: the content went then.
--   5. It erases, through the one function that erases a snapshot, every unerased snapshot of the decision's target (the
--      post, or the account), in this case and in any other, so no copy of the content outlives the restriction's
--      finality.
--   6. It marks the decision redacted only when no unerased snapshot of that target is left in any case. When the
--      freeze began between step 3 and step 5 (a suspect item about the author's account locks no row this function
--      holds), a snapshot was kept, the decision stays a candidate, and the call after the freeze ends finishes it.
--   7. It releases the case's holds on the images it erased (every image of the post for a post removal, that image for
--      an image removal); the case's other holds stay its evidence. For a post case it then derives the post's level and
--      its images' states again: an erased post is removed, and so is an erased image.
CREATE FUNCTION "public"."redact_r4_body"(decision_id uuid) RETURNS boolean
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
                     WHERE a.decision_id = d.id AND a.kind IN ('remove', 'remove_media', 'reset_bio', 'reset_display_name')) THEN
    RAISE EXCEPTION 'invalid_decision';
  END IF;
  -- A decision's case and a case's target never change, so this read before the locks names the right rows.
  SELECT k.* INTO c FROM public.cases k WHERE k.id = d.case_id;

  -- 2.
  IF c.target_type = 'account' THEN
    PERFORM 1 FROM public.profiles p WHERE p.id = c.target_id FOR NO KEY UPDATE;
  END IF;
  PERFORM 1 FROM public.cases k WHERE k.id = c.id FOR UPDATE;
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
   WHERE f.decision_id = d.id AND f.kind IN ('remove', 'remove_media', 'reset_bio', 'reset_display_name');
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

  -- 5.
  PERFORM public.erase_snapshots(ARRAY(SELECT s.id FROM public.evidence_snapshots s
                                        WHERE s.target_type = c.target_type AND s.target_id = c.target_id AND s.erased_at IS NULL));

  -- 6.
  IF NOT EXISTS (SELECT 1 FROM public.evidence_snapshots s
                  WHERE s.target_type = c.target_type AND s.target_id = c.target_id AND s.erased_at IS NULL) THEN
    UPDATE public.decisions x SET redacted_at = now() WHERE x.id = d.id;
  END IF;

  -- 7.
  PERFORM public.release_case_holds(c.id, released);
  IF c.target_type = 'post' THEN
    PERFORM public.moderation_apply(ARRAY[c.target_id], true);
  END IF;
  RETURN true;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."redact_r4_body"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."redact_r4_body"(uuid) TO korbat_api;--> statement-breakpoint
-- Deletes the staff texts nobody confirmed (never a note or a recorded choice not to seal, which are never confirmed and
-- go with their case's evidence, and never a confirmed text) that were saved before the given time, and answers how many.
-- It refuses (not_due) a time less than 24 hours back, so no caller deletes a draft a moderator is still working on.
CREATE FUNCTION "public"."sweep_staff_texts"(older_than timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n integer;
BEGIN
  IF sweep_staff_texts.older_than IS NULL OR sweep_staff_texts.older_than > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'not_due';
  END IF;
  DELETE FROM public.staff_texts t
   WHERE t.kind NOT IN ('note', 'seal_declined') AND t.confirmed_at IS NULL AND t.created_at < sweep_staff_texts.older_than;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."sweep_staff_texts"(timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."sweep_staff_texts"(timestamptz) TO korbat_api;--> statement-breakpoint
-- Deletes the access rows older than the given time, and answers how many rows it changed. It first erases the reveal
-- reasons that the reveals among them name (text and salt null, the digest kept): a reason is kept as long as the access
-- row that names it. It refuses (not_due) a time less than 12 months back.
CREATE FUNCTION "public"."delete_access_log"(older_than timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  changed integer;
  n integer;
BEGIN
  IF delete_access_log.older_than IS NULL OR delete_access_log.older_than > now() - interval '12 months' THEN
    RAISE EXCEPTION 'not_due';
  END IF;
  UPDATE public.staff_texts t SET text = NULL, salt = NULL, erased_at = now()
   WHERE t.kind = 'reveal_reason' AND t.erased_at IS NULL
     AND t.id IN (SELECT l.text_id FROM public.case_access_log l
                   WHERE l.kind = 'identity_revealed' AND l.text_id IS NOT NULL AND l.at < delete_access_log.older_than);
  GET DIAGNOSTICS changed = ROW_COUNT;
  DELETE FROM public.case_access_log l WHERE l.at < delete_access_log.older_than;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN changed + n;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."delete_access_log"(timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."delete_access_log"(timestamptz) TO korbat_api;--> statement-breakpoint
-- Forgets that a deleted account sent its reports: the reporter's id goes from its intakes and from their items, and the
-- intakes go on being processed. It acts only on an account whose auth row is marked deleted, read here, and changes
-- nothing for any other: the take-down sets that mark before any step of the purge, so the purge's call finds it. It
-- answers how many rows it changed, 0 when run again.
CREATE FUNCTION "public"."forget_reporter"(account uuid) RETURNS integer
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
  RETURN changed + n;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."forget_reporter"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."forget_reporter"(uuid) TO korbat_api;--> statement-breakpoint
-- An account's deletion mark, held against the API's other role. The API holds korbat_auth too: without this trigger,
-- code running as the API could back-date a live account's mark, call erase_statement_texts or forget_reporter above, and
-- clear the mark again. For korbat_auth a mark that is set can be neither cleared nor changed (SQLSTATE 23514), and a
-- mark set from null becomes now(), whatever value was supplied: no code clears the mark, and now() replaces the
-- take-down's own time with its transaction's start. The function is plain, so current_user is the role that ran the
-- statement. The migrator, and tests that move the clock as it, are not bound.
CREATE FUNCTION "auth"."users_deleted_mark"() RETURNS trigger
LANGUAGE plpgsql SET search_path = auth, pg_temp AS $$
BEGIN
  IF current_user = 'korbat_auth' THEN
    IF OLD.deleted_at IS NOT NULL THEN
      IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
        RAISE EXCEPTION 'an account''s deletion mark is never cleared or changed (users_deleted_mark)'
          USING ERRCODE = '23514', TABLE = 'users', CONSTRAINT = 'users_deleted_mark';
      END IF;
    ELSIF NEW.deleted_at IS NOT NULL THEN
      NEW.deleted_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth"."users_deleted_mark"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "users_deleted_mark" BEFORE UPDATE OF "deleted_at" ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "auth"."users_deleted_mark"();--> statement-breakpoint
-- Releases a case's holds, one row at a time in the order of their images' ids, which is the order every other
-- transaction locks image rows in (each release takes its image's row through the trigger that keeps hold_until): every
-- unreleased hold of the case when no image is named, otherwise only those on the named images. It answers how many it
-- released. Nobody may call it: the two erasures of this migration do, as its owner.
CREATE FUNCTION "public"."release_case_holds"(case_id uuid, media uuid[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  hold bigint;
  n integer := 0;
BEGIN
  FOR hold IN
    SELECT h.id FROM public.media_holds h
     WHERE h.case_id = release_case_holds.case_id AND h.released_at IS NULL
       AND (release_case_holds.media IS NULL OR h.media_id = ANY(release_case_holds.media))
     ORDER BY h.media_id, h.id
  LOOP
    UPDATE public.media_holds h SET released_at = now() WHERE h.id = hold AND h.released_at IS NULL;
    IF FOUND THEN
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."release_case_holds"(uuid, uuid[]) FROM PUBLIC;--> statement-breakpoint
-- How many personal accounts each staff account has linked: one row for each staff account with at least one link, never
-- which accounts. `staff.js keys` prints the counts for the operator's comparison with their own records; the auth role
-- holds nothing on the table itself.
CREATE FUNCTION "auth"."staff_link_counts"() RETURNS TABLE (staff_user_id uuid, links integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = auth, pg_temp AS $$
  SELECT l.staff_user_id, count(*)::integer FROM auth.staff_personal_accounts l GROUP BY l.staff_user_id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth"."staff_link_counts"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth"."staff_link_counts"() TO korbat_auth;

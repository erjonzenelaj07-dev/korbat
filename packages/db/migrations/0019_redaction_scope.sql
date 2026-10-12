-- The reach of the R4 redaction (3c design, section 6.4), corrected after the review of the built code. Written by hand:
-- this migration changes no table. It replaces redact_r4_body of migration 0018 (CREATE OR REPLACE keeps its owner and
-- its grants) in two places, and leaves everything else of it as it was:
--   * Which copies it erases (step 5), and which must be gone before it marks the decision (step 6): the snapshots of the
--     decision's target that were taken up to the decision, in whatever case they are. Those hold what the decision
--     restricted. A snapshot taken afterwards is a later look at the target: of an account it holds what the person wrote
--     since the reset, which the decision never judged; of a post it is the evidence of a case that was open then or was
--     opened later. 0018 erased those as well, an open and undecided case's among them, so that case's decision was then
--     refused on the copy its moderator had read, and a fresh copy held whatever the target had become. A later snapshot
--     goes by its own case's rule (erase_case_evidence), never by this function. Both times are the starts of their
--     transactions (the triggers of 0015 and 0016 stamp them), and a decision names a snapshot that was stored before
--     its own transaction began, so the copy a decision was taken on always lies before it.
--   * Its locks (step 2): after the profile and before the post it takes, in one statement and in id order, FOR UPDATE,
--     the decision's own case and every other case that holds a snapshot it is about to erase. 0018 took the decision's
--     case alone and erased other cases' snapshots without their locks, so a decision on one of those cases that had read
--     its snapshot whole committed naming a snapshot erased beside it. With the lock such a decision either commits
--     first, or waits at its case and is refused (snapshot_erased) before it stores anything. Every case taken here is
--     about one target, which has at most one open case; an intake takes at most that one, and a decision, an appeal and
--     an erasure take one case each, so no other transaction holds two of these rows and the order among them cannot
--     close a cycle. The place of the cases in the one lock order is unchanged: after profile rows, before the post.
-- The steps, as 0018 numbered them:
--   1. It refuses (invalid_decision) any decision that is not final, does not cite R4, or holds no removal of a post or
--      an image and no field reset.
--   2. Its locks, before it writes anything: for an account case the profile's row FOR NO KEY UPDATE; the cases named
--      above, in id order, FOR UPDATE; for a post case the post's row FOR UPDATE and then, in a statement of its own,
--      every image row of the post in id order FOR NO KEY UPDATE.
--   3. Then, each in a statement of its own: it refuses to run outside READ COMMITTED (read_committed_only); it refuses
--      (not_due) a decision that is not yet final for its author; and it changes nothing and answers false unless the
--      decision is not redacted yet and one of its R4 measures is in force. For a post case it also changes nothing and
--      answers false while the post is frozen.
--   4. For a post removal in force it blanks the post's body and marks the post erased; for an image removal in force it
--      marks that image erased. A mark that is already set keeps its time.
--   5. It erases, through the one function that erases a snapshot, every unerased snapshot of the decision's target
--      taken up to the decision, in this case and in any other.
--   6. It marks the decision redacted only when no unerased snapshot of that target taken up to the decision is left.
--      When the freeze began between step 3 and step 5, a snapshot was kept, the decision stays a candidate, and the
--      call after the freeze ends finishes it.
--   7. It releases the case's holds on the images it erased, and for a post case derives the post's level and its
--      images' states again.
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
                     WHERE a.decision_id = d.id AND a.kind IN ('remove', 'remove_media', 'reset_bio', 'reset_display_name')) THEN
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
END $$;

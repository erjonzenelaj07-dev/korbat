-- LAB 3d prototype, tables and plain functions (run inside 30-proto.sql, one transaction, as korbat_migrate, on 0017).
ALTER TYPE public.intake_kind ADD VALUE 'automated';
ALTER TYPE public.intake_channel ADD VALUE 'system';

-- A decider that is not a person.
ALTER TABLE public.decisions ALTER COLUMN decided_by DROP NOT NULL;
ALTER TABLE public.decisions ADD CONSTRAINT decisions_decider
  CHECK ((decided_by IS NULL) = (automated_decision = 'fully') AND (decided_by IS NOT NULL OR kind::text = 'interim'));
ALTER TABLE public.decisions DROP CONSTRAINT decisions_restricted;
ALTER TABLE public.decisions ADD CONSTRAINT decisions_restricted
  CHECK (outcome::text <> 'restricted' OR (ground IS NOT NULL AND (decided_by IS NULL OR (facts_digest IS NOT NULL AND reason_digest IS NOT NULL))));
ALTER TABLE public.intakes DROP CONSTRAINT intakes_finding;
ALTER TABLE public.intakes ADD CONSTRAINT intakes_finding
  CHECK ((kind::text = 'finding') = (finding_by IS NOT NULL) AND (kind::text = 'finding') = (channel::text = 'staff')
     AND (kind::text = 'automated') = (channel::text = 'system'));
ALTER TABLE public.intakes DROP CONSTRAINT intakes_r2_finding_only;
ALTER TABLE public.intakes ADD CONSTRAINT intakes_r2_finding_only
  CHECK (rule_id IS DISTINCT FROM 'R2' OR kind::text IN ('finding', 'automated'));
ALTER TABLE public.intakes ADD CONSTRAINT intakes_automated
  CHECK (kind::text <> 'automated' OR (automated_processing AND rule_id IN ('R1', 'R2') AND NOT alleges_illegal AND NOT csam
     AND reporter_id IS NULL AND contact_id IS NULL AND finding_by IS NULL));

CREATE TABLE public.automated_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('r1_score', 'known_match')),
  media_id uuid NOT NULL,
  decision_id uuid REFERENCES public.decisions(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.automated_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY automated_signals_api ON public.automated_signals FOR ALL TO korbat_api USING (true) WITH CHECK (true);
REVOKE ALL ON public.automated_signals FROM korbat_api;
GRANT SELECT, INSERT ON public.automated_signals TO korbat_api;
GRANT UPDATE (decision_id) ON public.automated_signals TO korbat_api;

CREATE FUNCTION public.automation_rules() RETURNS TABLE (decisions_per_hour integer, decisions_per_day integer)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$ SELECT 5, 50 $$;
REVOKE ALL ON FUNCTION public.automation_rules() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.automation_rules() TO korbat_api;

-- The release: the record, the mark keyed on seal_posts' key, the clause in the seal arm.
CREATE TABLE public.releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seal_action_id uuid,
  post_ids uuid[] NOT NULL,
  basis text NOT NULL CHECK (basis IN ('answer', 'period')),
  answer text,
  their_reference text,
  released_at timestamptz NOT NULL,
  replay_of uuid,
  CONSTRAINT releases_replay_once UNIQUE (replay_of)
);
CREATE TABLE public.seal_releases (
  action_id uuid NOT NULL,
  post_id uuid NOT NULL,
  release_id uuid NOT NULL REFERENCES public.releases(id),
  PRIMARY KEY (action_id, post_id),
  FOREIGN KEY (action_id, post_id) REFERENCES public.seal_posts(action_id, post_id)
);
ALTER TABLE public.releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seal_releases ENABLE ROW LEVEL SECURITY;
CREATE POLICY releases_api ON public.releases FOR SELECT TO korbat_api USING (true);
CREATE POLICY seal_releases_api ON public.seal_releases FOR SELECT TO korbat_api USING (true);
REVOKE ALL ON public.releases, public.seal_releases FROM korbat_api;
GRANT SELECT ON public.releases, public.seal_releases TO korbat_api;

-- Stand-in for 3f's record of the report (authority_notifications) and its seal_report, as F 6.5 specifies them.
CREATE TABLE public.lab_notifications (seal_action_id uuid, case_id uuid, account_id uuid, state text, answer text, their_reference text, answered_at timestamptz);
REVOKE ALL ON public.lab_notifications FROM korbat_api;
CREATE FUNCTION public.seal_report(action uuid) RETURNS TABLE (reported boolean, their_reference text, answered_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT n.state = 'sent', n.their_reference, n.answered_at
    FROM public.decision_actions a JOIN public.decisions d ON d.id = a.decision_id
    JOIN public.lab_notifications n ON n.case_id = d.case_id AND n.account_id = a.subject_account_id
   WHERE a.id = seal_report.action
$$;
REVOKE ALL ON FUNCTION public.seal_report(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.frozen_for(post uuid, author uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
      SELECT 1 FROM public.cases c
      JOIN public.intake_items i ON i.case_id = c.id AND i.suspect AND i.answered_by IS NULL
      WHERE c.closed_at IS NULL AND c.target_type = 'post' AND c.target_id = frozen_for.post)
    OR EXISTS (
      SELECT 1 FROM public.cases c
      JOIN public.intake_items i ON i.case_id = c.id AND i.suspect AND i.answered_by IS NULL
      WHERE c.closed_at IS NULL AND c.target_type = 'account' AND c.target_id = frozen_for.author)
    OR EXISTS (
      SELECT 1 FROM public.seal_posts s
      JOIN public.measures_in_force m ON m.id = s.action_id
      WHERE s.post_id = frozen_for.post
        AND NOT EXISTS (SELECT 1 FROM public.seal_releases r WHERE r.action_id = s.action_id AND r.post_id = s.post_id))
$$;

-- The release itself (the admin's confirmed action calls it; the audit tie is not prototyped here).
CREATE FUNCTION public.seal_release(action uuid, basis text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  rep record; word text; rid uuid; posts uuid[];
BEGIN
  PERFORM 1 FROM public.measures_in_force m WHERE m.id = seal_release.action AND m.kind = 'seal_media' AND m.decision_kind = 'final';
  IF NOT FOUND THEN RAISE EXCEPTION 'release_not_open' USING DETAIL = 'Only a seal for good that is in force is released.'; END IF;
  SELECT r.* INTO rep FROM public.seal_report(seal_release.action) r;
  IF rep.reported IS NOT TRUE THEN RAISE EXCEPTION 'release_not_reported'; END IF;
  SELECT n.answer INTO word FROM public.decision_actions a JOIN public.decisions d ON d.id = a.decision_id
    JOIN public.lab_notifications n ON n.case_id = d.case_id AND n.account_id = a.subject_account_id WHERE a.id = seal_release.action;
  IF seal_release.basis = 'answer' AND word IS DISTINCT FROM 'illegal' THEN RAISE EXCEPTION 'release_not_for_answer'; END IF;
  IF seal_release.basis = 'period' THEN RAISE EXCEPTION 'release_period_unset'; END IF;
  SELECT array_agg(s.post_id ORDER BY s.post_id) INTO posts FROM public.seal_posts s WHERE s.action_id = seal_release.action
     AND NOT EXISTS (SELECT 1 FROM public.seal_releases r WHERE r.action_id = s.action_id AND r.post_id = s.post_id);
  IF posts IS NULL THEN RAISE EXCEPTION 'release_not_open' USING DETAIL = 'Already released.'; END IF;
  INSERT INTO public.releases (seal_action_id, post_ids, basis, answer, their_reference, released_at)
  VALUES (seal_release.action, posts, seal_release.basis, word, rep.their_reference, now()) RETURNING id INTO rid;
  INSERT INTO public.seal_releases (action_id, post_id, release_id) SELECT seal_release.action, p, rid FROM unnest(posts) p;
  UPDATE public.post_media m SET erased_at = now() WHERE m.post_id = ANY(posts) AND m.erased_at IS NULL;
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.seal_release(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seal_release(uuid, text) TO korbat_api;

-- The replay after a restore: one recorded release, applied to every seal in force that lists one of its posts,
-- whenever that seal was taken; a post no seal lists is erased all the same. Idempotent by replay_of.
CREATE FUNCTION public.release_replay(original uuid, posts uuid[], basis text, answer text, their_reference text, released_at timestamptz) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  rid uuid; marks integer; rows integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.releases r WHERE r.id = original OR r.replay_of = original) THEN RETURN 'present'; END IF;
  INSERT INTO public.releases (post_ids, basis, answer, their_reference, released_at, replay_of)
  VALUES (posts, basis, answer, their_reference, released_at, original) RETURNING id INTO rid;
  INSERT INTO public.seal_releases (action_id, post_id, release_id)
  SELECT s.action_id, s.post_id, rid FROM public.seal_posts s JOIN public.measures_in_force m ON m.id = s.action_id
   WHERE s.post_id = ANY(posts) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS marks = ROW_COUNT;
  UPDATE public.post_media m SET erased_at = now() WHERE m.post_id = ANY(posts) AND m.erased_at IS NULL;
  GET DIAGNOSTICS rows = ROW_COUNT;
  RETURN format('replayed: %s marks, %s image rows', marks, rows);
END $$;
REVOKE ALL ON FUNCTION public.release_replay(uuid, uuid[], text, text, text, timestamptz) FROM PUBLIC;

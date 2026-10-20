-- LAB D, part 1: the release on the answer "illegal" (b02), the clause in the seal arm, gate K afterwards, the cost.
\set VERBOSITY terse
\pset format unaligned
\pset tuples_only on
SET ROLE korbat_api;
\set seal '(SELECT m.id FROM public.measures_in_force m JOIN public.cases k ON k.id = m.case_id WHERE k.target_id = \'00000000-0000-4000-8000-000000000b02\' AND m.decision_kind = \'final\')'
\echo == D2 the release
SELECT public.seal_release(:seal, 'answer') IS NOT NULL;
SELECT public.lab_state('00000000-0000-4000-8000-000000000b02');
SELECT format('release: basis=%s answer=%s reference=%s posts=%s; marks=%s', r.basis, r.answer, r.their_reference, cardinality(r.post_ids), (SELECT count(*) FROM public.seal_releases)) FROM public.releases r;
\echo -- a second release of the same seal
SELECT public.seal_release(:seal, 'answer');
\echo == D3 gate K after the release: the API role deletes the image rows of b02 (rows deleted, rows left)
WITH gone AS (DELETE FROM public.post_media WHERE post_id = '00000000-0000-4000-8000-000000000b02' RETURNING 1) SELECT count(*) FROM gone;
SELECT count(*) FROM public.post_media WHERE post_id = '00000000-0000-4000-8000-000000000b02';
\echo == D4 a new suspect item about the released post freezes it again through the first arm (b02), and a write of marks by the API role
BEGIN; SELECT public.lab_finding('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-00000000000b', 'R2') IS NOT NULL; COMMIT;
SELECT public.lab_state('00000000-0000-4000-8000-000000000b02');
INSERT INTO public.seal_releases (action_id, post_id, release_id) SELECT s.action_id, s.post_id, (SELECT id FROM public.releases LIMIT 1) FROM public.seal_posts s LIMIT 1;
UPDATE public.post_media SET erased_at = now() WHERE id = '00000000-0000-4000-8000-000000000d01';
RESET ROLE;
\echo == D5 the record a keeper's copy would carry (one line)
\pset format unaligned
SELECT jsonb_build_object('id', r.id, 'posts', r.post_ids, 'basis', r.basis, 'answer', r.answer, 'reference', r.their_reference, 'at', r.released_at)::text FROM public.releases r \g tail.jsonl.tmp
\echo == D6 the cost of the clause: 20000 calls each, ms a call (old body, new body)
CREATE FUNCTION public.frozen_for_old(post uuid, author uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.cases c JOIN public.intake_items i ON i.case_id = c.id AND i.suspect AND i.answered_by IS NULL
                  WHERE c.closed_at IS NULL AND c.target_type = 'post' AND c.target_id = frozen_for_old.post)
    OR EXISTS (SELECT 1 FROM public.cases c JOIN public.intake_items i ON i.case_id = c.id AND i.suspect AND i.answered_by IS NULL
                WHERE c.closed_at IS NULL AND c.target_type = 'account' AND c.target_id = frozen_for_old.author)
    OR EXISTS (SELECT 1 FROM public.seal_posts s JOIN public.measures_in_force m ON m.id = s.action_id WHERE s.post_id = frozen_for_old.post) $$;
DO $$
DECLARE t0 timestamptz; p uuid; lbl text; a uuid := '00000000-0000-4000-8000-000000000001'; x boolean; old_ms numeric; new_ms numeric;
BEGIN
  FOR lbl, p IN VALUES ('a post nobody reported (b10)', '00000000-0000-4000-8000-000000000b0a'::uuid), ('a sealed post, seal while deciding (b07)', '00000000-0000-4000-8000-000000000b07'::uuid) LOOP
    t0 := clock_timestamp(); FOR i IN 1..20000 LOOP x := public.frozen_for_old(p, NULL); END LOOP; old_ms := extract(epoch FROM clock_timestamp() - t0) * 1000 / 20000;
    t0 := clock_timestamp(); FOR i IN 1..20000 LOOP x := public.frozen_for(p, NULL); END LOOP; new_ms := extract(epoch FROM clock_timestamp() - t0) * 1000 / 20000;
    RAISE NOTICE '%: old % ms, new % ms, answer %', lbl, round(old_ms, 4), round(new_ms, 4), x;
  END LOOP;
END $$;
EXPLAIN (COSTS OFF) SELECT 1 FROM public.seal_posts s JOIN public.measures_in_force m ON m.id = s.action_id
 WHERE s.post_id = '00000000-0000-4000-8000-000000000b07' AND NOT EXISTS (SELECT 1 FROM public.seal_releases r WHERE r.action_id = s.action_id AND r.post_id = s.post_id);

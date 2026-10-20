-- LAB D, part 4, on labq after part 3: the same clause keyed on the post alone (the model's choice after part 3).
\set VERBOSITY terse
\pset format unaligned
\pset tuples_only on
CREATE TABLE public.release_posts (post_id uuid PRIMARY KEY, release_id uuid NOT NULL REFERENCES public.releases(id));
GRANT SELECT ON public.release_posts TO korbat_api;
INSERT INTO public.release_posts SELECT DISTINCT ON (p) p, r.id FROM public.releases r, unnest(r.post_ids) p ORDER BY p, r.released_at;
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
    OR (EXISTS (
      SELECT 1 FROM public.seal_posts s
      JOIN public.measures_in_force m ON m.id = s.action_id
      WHERE s.post_id = frozen_for.post)
      AND NOT EXISTS (SELECT 1 FROM public.release_posts r WHERE r.post_id = frozen_for.post))
$$;
SELECT 'b02, sealed for good again after the replay: ' || public.lab_state('00000000-0000-4000-8000-000000000b02');
SELECT 'b07, sealed and not released: ' || public.lab_state('00000000-0000-4000-8000-000000000b07');
SET ROLE korbat_api;
WITH gone AS (DELETE FROM public.post_media WHERE post_id = '00000000-0000-4000-8000-000000000b02' RETURNING 1) SELECT 'rows of b02 the API role deletes: ' || count(*) FROM gone;
RESET ROLE;
DO $$
DECLARE t0 timestamptz; x boolean; ms numeric;
BEGIN
  t0 := clock_timestamp(); FOR i IN 1..20000 LOOP x := public.frozen_for('00000000-0000-4000-8000-000000000b0a', NULL); END LOOP;
  ms := extract(epoch FROM clock_timestamp() - t0) * 1000 / 20000; RAISE NOTICE 'by post, a post nobody reported: % ms a call, answer %', round(ms, 4), x;
  t0 := clock_timestamp(); FOR i IN 1..20000 LOOP x := public.frozen_for('00000000-0000-4000-8000-000000000b07', NULL); END LOOP;
  ms := extract(epoch FROM clock_timestamp() - t0) * 1000 / 20000; RAISE NOTICE 'by post, a sealed post: % ms a call, answer %', round(ms, 4), x;
END $$;

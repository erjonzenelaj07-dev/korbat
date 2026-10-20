-- LAB D, part 2: the replay of the recorded release on a restored database. As postgres (the command line is the migrator).
-- labr: the backup was taken after the seal for good. labq: before it (only the automatic seal while deciding exists).
\set VERBOSITY terse
\pset format unaligned
\pset tuples_only on
SELECT 'before: ' || public.lab_state('00000000-0000-4000-8000-000000000b02');
SELECT public.release_replay((j ->> 'id')::uuid, ARRAY(SELECT jsonb_array_elements_text(j -> 'posts')::uuid), j ->> 'basis', j ->> 'answer', j ->> 'reference', (j ->> 'at')::timestamptz)
  FROM (SELECT :'rec'::jsonb AS j) x;
SELECT 'after:  ' || public.lab_state('00000000-0000-4000-8000-000000000b02');
\echo -- run again (idempotent)
SELECT public.release_replay((j ->> 'id')::uuid, ARRAY(SELECT jsonb_array_elements_text(j -> 'posts')::uuid), j ->> 'basis', j ->> 'answer', j ->> 'reference', (j ->> 'at')::timestamptz)
  FROM (SELECT :'rec'::jsonb AS j) x;
SELECT format('releases=%s marks=%s (of seals: %s)', (SELECT count(*) FROM public.releases), (SELECT count(*) FROM public.seal_releases),
  (SELECT string_agg(d.kind::text || CASE WHEN d.decided_by IS NULL THEN ' by system' ELSE ' by staff' END, ', ') FROM public.seal_releases r JOIN public.decision_actions a ON a.id = r.action_id JOIN public.decisions d ON d.id = a.decision_id));

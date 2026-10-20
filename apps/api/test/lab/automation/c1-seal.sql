-- LAB C, part 1: the automatic seal against the freeze. As postgres with SET ROLE korbat_api, on a fresh reset.
\set VERBOSITY terse
\pset format unaligned
\pset tuples_only on
SET ROLE korbat_api;
\echo == C1 a match on d02 of post b02 (two images): the automated seal while an admin decides
BEGIN; SELECT public.lab_auto('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-000000000d02', 'R2') IS NOT NULL; COMMIT;
SELECT public.lab_state('00000000-0000-4000-8000-000000000b02');
SELECT format('decision: kind=%s suspect=%s detection=%s decision=%s needs_admin=%s; seal_posts: %s', d.kind, d.suspect, d.automated_detection, d.automated_decision, d.needs_admin,
  (SELECT string_agg(format('post ..%s images=%s', right(s.post_id::text, 3), s.images), ',') FROM public.seal_posts s JOIN public.decision_actions a ON a.id = s.action_id WHERE a.decision_id = d.id))
  FROM public.decisions d;
\echo == C2 gate K while frozen: the API role deletes the image rows of b02 (rows deleted, then rows left)
WITH gone AS (DELETE FROM public.post_media WHERE post_id = '00000000-0000-4000-8000-000000000b02' RETURNING 1) SELECT count(*) FROM gone;
SELECT count(*) FROM public.post_media WHERE post_id = '00000000-0000-4000-8000-000000000b02';
\echo == C3 a person seals while deciding on the same case, the automatic seal in force (admin A)
BEGIN;
SELECT public.lab_person('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000aa', 'interim', 'restricted', 'R2',
  '[{"kind":"seal_media","mediaId":null}]') IS NOT NULL;
COMMIT; ROLLBACK;
SELECT public.lab_state('00000000-0000-4000-8000-000000000b02');
\echo == C4 the other order (b07): a person's finding citing R2 and seal while deciding first, then a match arrives
BEGIN; SELECT public.lab_finding('00000000-0000-4000-8000-000000000b07', '00000000-0000-4000-8000-00000000000b', 'R2') IS NOT NULL;
SELECT public.lab_person('00000000-0000-4000-8000-000000000b07', '00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000bb', 'interim', 'restricted', 'R2',
  '[{"kind":"seal_media","mediaId":null}]') IS NOT NULL; COMMIT;
SELECT public.lab_state('00000000-0000-4000-8000-000000000b07');
BEGIN; SELECT public.lab_auto('00000000-0000-4000-8000-000000000b07', '00000000-0000-4000-8000-000000000d09', 'R2') IS NOT NULL; COMMIT; ROLLBACK;
SELECT public.lab_state('00000000-0000-4000-8000-000000000b07');
\echo == C5 the fallback for a match (act off) on b06: the finding freezes, nothing is sealed
BEGIN; SELECT public.lab_auto('00000000-0000-4000-8000-000000000b06', '00000000-0000-4000-8000-000000000d08', 'R2', 'off') IS NULL; COMMIT;
SELECT public.lab_state('00000000-0000-4000-8000-000000000b06');
\echo == C6 an automatic seal that an admin answers without a seal (b03): the seal ends with the answer
BEGIN; SELECT public.lab_auto('00000000-0000-4000-8000-000000000b03', '00000000-0000-4000-8000-000000000d04', 'R2') IS NOT NULL; COMMIT;
SELECT public.lab_state('00000000-0000-4000-8000-000000000b03');
\echo -- a moderator may not answer it
BEGIN; SELECT public.lab_person('00000000-0000-4000-8000-000000000b03', '00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000bb', 'final', 'no_violation', NULL, '[]') IS NOT NULL; COMMIT; ROLLBACK;
BEGIN; SELECT public.lab_person('00000000-0000-4000-8000-000000000b03', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000aa', 'final', 'no_violation', NULL, '[]') IS NOT NULL; COMMIT;
SELECT public.lab_state('00000000-0000-4000-8000-000000000b03');
SELECT format('the answer: unseen=%s suspect=%s detection=%s decision=%s', d.unseen, d.suspect, d.automated_detection, d.automated_decision) FROM public.decisions d
  JOIN public.cases c ON c.id = d.case_id WHERE c.target_id = '00000000-0000-4000-8000-000000000b03' AND d.kind = 'final';

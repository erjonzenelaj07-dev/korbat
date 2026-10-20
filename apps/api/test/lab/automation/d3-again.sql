-- LAB D, part 3, on labq after the replay: the admin takes the lost seal for good again (3f's gap seal_final), then a post no seal ever listed.
\set VERBOSITY terse
\pset format unaligned
\pset tuples_only on
SET ROLE korbat_api;
\echo == the seal for good taken again on b02 after the replay
BEGIN; SELECT public.lab_person('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000aa', 'final', 'restricted', 'R2',
  '[{"kind":"seal_media","mediaId":null}]') IS NOT NULL; COMMIT; ROLLBACK;
SELECT public.lab_state('00000000-0000-4000-8000-000000000b02');
SELECT format('seal_posts rows: %s; marks: %s', (SELECT count(*) FROM public.seal_posts WHERE post_id = '00000000-0000-4000-8000-000000000b02'), (SELECT count(*) FROM public.seal_releases));
\echo == or answered without a seal instead (run on a second copy)
RESET ROLE;
\echo == a release whose post no seal of this database lists (b08)
SELECT public.release_replay(gen_random_uuid(), ARRAY['00000000-0000-4000-8000-000000000b08'::uuid], 'answer', 'illegal', 'AZ 2/26', now());
SELECT public.lab_state('00000000-0000-4000-8000-000000000b08');

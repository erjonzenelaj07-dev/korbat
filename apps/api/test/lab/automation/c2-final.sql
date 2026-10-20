-- LAB C, part 2: a person's seal for good after the automatic seal (b02), and the release's refusals.
\set VERBOSITY terse
\pset format unaligned
\pset tuples_only on
SET ROLE korbat_api;
\echo == C7 the seal for good on b02: a moderator is refused, the admin seals unseen
BEGIN; SELECT public.lab_person('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000bb', 'final', 'restricted', 'R2',
  '[{"kind":"seal_media","mediaId":null}]') IS NOT NULL; COMMIT; ROLLBACK;
BEGIN; SELECT public.lab_person('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000aa', 'final', 'restricted', 'R2',
  '[{"kind":"seal_media","mediaId":null}]') IS NOT NULL; COMMIT;
SELECT public.lab_state('00000000-0000-4000-8000-000000000b02');
SELECT format('%s by %s: unseen=%s detection=%s decision=%s needs_admin=%s', d.kind, CASE WHEN d.decided_by IS NULL THEN 'system' ELSE 'staff' END, d.unseen, d.automated_detection, d.automated_decision, d.needs_admin)
  FROM public.decisions d JOIN public.cases c ON c.id = d.case_id WHERE c.target_id = '00000000-0000-4000-8000-000000000b02' ORDER BY d.decided_at;
\echo == D1 the release refused: not reported; reported without an answer; answered not_illegal; a seal taken while deciding
\set seal '(SELECT m.id FROM public.measures_in_force m JOIN public.cases k ON k.id = m.case_id WHERE k.target_id = \'00000000-0000-4000-8000-000000000b02\' AND m.decision_kind = \'final\')'
SELECT public.seal_release(:seal, 'answer');
RESET ROLE;
INSERT INTO public.lab_notifications (case_id, account_id, state) SELECT m.case_id, m.subject_account_id, 'sent' FROM public.measures_in_force m WHERE m.id = :seal;
SET ROLE korbat_api;
SELECT public.seal_release(:seal, 'answer');
SELECT public.seal_release(:seal, 'period');
RESET ROLE; UPDATE public.lab_notifications SET answer = 'not_illegal', their_reference = 'AZ 1/26', answered_at = now(); SET ROLE korbat_api;
SELECT public.seal_release(:seal, 'answer');
SELECT public.seal_release((SELECT m.id FROM public.measures_in_force m JOIN public.cases k ON k.id = m.case_id WHERE k.target_id = '00000000-0000-4000-8000-000000000b07' LIMIT 1), 'answer');
RESET ROLE; UPDATE public.lab_notifications SET answer = 'illegal'; SET ROLE korbat_api;
SELECT public.lab_state('00000000-0000-4000-8000-000000000b02');

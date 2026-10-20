-- LAB A: a decision by the system actor through the replaced checks. As korbat_api, on a fresh reset.
\set VERBOSITY terse
\pset format unaligned
\pset tuples_only on
\echo == A1 automated R1 withhold of one image (b01, d01): commits
BEGIN;
SELECT public.lab_auto('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-000000000d01', 'R1') IS NOT NULL;
COMMIT;
SELECT public.lab_state('00000000-0000-4000-8000-000000000b01');
SELECT format('kind=%s decided_by=%s detection=%s decision=%s needs_admin=%s source=%s suspect=%s author_mail=%s facts=%s', d.kind, coalesce(d.decided_by::text, 'null'),
  d.automated_detection, d.automated_decision, d.needs_admin, d.source, d.suspect, d.author_mail, coalesce(d.facts_digest, 'null')) FROM public.decisions d;
SELECT format('audit: actor=%s action=%s step_up=%s key=%s', l.actor_id, l.action, coalesce(l.step_up::text, 'null'), coalesce(l.key_id::text, 'null'))
  FROM public.audit_log l ORDER BY l.chain_seq DESC LIMIT 1;
\echo == A2 the faults, each on post b04 (image d06): every one must be refused, and nothing may remain
\echo -- final kind as the system
BEGIN; SELECT public.lab_auto('00000000-0000-4000-8000-000000000b04', '00000000-0000-4000-8000-000000000d06', 'R1', 'on', 'final') IS NOT NULL; COMMIT; ROLLBACK;
\echo -- no audit row
BEGIN; SELECT public.lab_auto('00000000-0000-4000-8000-000000000b04', '00000000-0000-4000-8000-000000000d06', 'R1', 'on', 'no_audit') IS NOT NULL; COMMIT; ROLLBACK;
\echo -- a staff key's confirmed row case_decided for a decision without a decider
BEGIN; SELECT public.lab_auto('00000000-0000-4000-8000-000000000b04', '00000000-0000-4000-8000-000000000d06', 'R1', 'on', 'staff_audit') IS NOT NULL; COMMIT; ROLLBACK;
\echo -- no signal linked
BEGIN; SELECT public.lab_auto('00000000-0000-4000-8000-000000000b04', '00000000-0000-4000-8000-000000000d06', 'R1', 'on', 'no_signal') IS NOT NULL; COMMIT; ROLLBACK;
\echo -- two measures
BEGIN; SELECT public.lab_auto('00000000-0000-4000-8000-000000000b04', '00000000-0000-4000-8000-000000000d06', 'R1', 'on', 'two_measures') IS NOT NULL; COMMIT; ROLLBACK;
\echo -- a final measure (remove_media)
BEGIN; SELECT public.lab_auto('00000000-0000-4000-8000-000000000b04', '00000000-0000-4000-8000-000000000d06', 'R1', 'on', 'measure_remove') IS NOT NULL; COMMIT; ROLLBACK;
\echo -- rule R3 on the decision
BEGIN; SELECT public.lab_auto('00000000-0000-4000-8000-000000000b04', '00000000-0000-4000-8000-000000000d06', 'R1', 'on', 'rule_r3') IS NOT NULL; COMMIT; ROLLBACK;
\echo -- an automated intake citing R3
BEGIN; SELECT public.lab_auto('00000000-0000-4000-8000-000000000b04', '00000000-0000-4000-8000-000000000d06', 'R1', 'on', 'finding_r3') IS NOT NULL; COMMIT; ROLLBACK;
\echo -- a seal (R2 measure) resting on an R1 score
BEGIN; SELECT public.lab_auto('00000000-0000-4000-8000-000000000b04', '00000000-0000-4000-8000-000000000d06', 'R2', 'on', 'finding_r3') IS NOT NULL; COMMIT; ROLLBACK;
\echo -- a person as decider of an insert that claims automated_decision fully (the trigger forces the columns)
BEGIN;
SELECT public.lab_finding('00000000-0000-4000-8000-000000000b04', '00000000-0000-4000-8000-00000000000b', 'R3') IS NOT NULL;
SELECT public.lab_person('00000000-0000-4000-8000-000000000b04', '00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000bb', 'interim', 'restricted', 'R3',
  '[{"kind":"withhold","mediaId":null}]') IS NOT NULL;
SELECT format('person interim: detection=%s decision=%s', d.automated_detection, d.automated_decision) FROM public.decisions d WHERE d.decided_by IS NOT NULL;
ROLLBACK;
SELECT format('after the faults: decisions=%s cases=%s state b04: %s', (SELECT count(*) FROM public.decisions), (SELECT count(*) FROM public.cases), public.lab_state('00000000-0000-4000-8000-000000000b04'));
\echo == A3 a direct insert as korbat_api with decided_by null and no trigger path around: the CHECK and the commit check
BEGIN;
UPDATE public.decisions SET decided_by = '00000000-0000-4000-8000-00000000000b';
ROLLBACK;
\echo == A4 the fallback (act off): finding and signal only
BEGIN; SELECT public.lab_auto('00000000-0000-4000-8000-000000000b05', '00000000-0000-4000-8000-000000000d07', 'R1', 'off') IS NULL; COMMIT;
SELECT public.lab_state('00000000-0000-4000-8000-000000000b05');
SELECT format('items: %s', string_agg(format('lane=%s suspect=%s kind=%s', i.lane, i.suspect, n.kind), '; ')) FROM public.intake_items i JOIN public.intakes n ON n.id = i.intake_id
 WHERE i.target_id = '00000000-0000-4000-8000-000000000b05';
\echo == A5 a moderator decides the R1 case of b01 for good (remove_media): the flags of a person's decision after a score
BEGIN;
SELECT public.lab_person('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000bb', 'final', 'restricted', 'R1',
  '[{"kind":"remove_media","mediaId":"00000000-0000-4000-8000-000000000d01"}]') IS NOT NULL;
COMMIT;
SELECT public.lab_state('00000000-0000-4000-8000-000000000b01');
SELECT format('%s: decided_by=%s detection=%s decision=%s ended_interim=%s', d.kind, CASE WHEN d.decided_by IS NULL THEN 'null' ELSE 'staff' END, d.automated_detection, d.automated_decision, d.ended_interim)
  FROM public.decisions d JOIN public.cases c ON c.id = d.case_id WHERE c.target_id = '00000000-0000-4000-8000-000000000b01' ORDER BY d.decided_at;
\echo == A6 a moderator lifts an automated withhold at once by a correction (b06, d08)
BEGIN; SELECT public.lab_auto('00000000-0000-4000-8000-000000000b06', '00000000-0000-4000-8000-000000000d08', 'R1') IS NOT NULL; COMMIT;
SELECT public.lab_state('00000000-0000-4000-8000-000000000b06');
BEGIN;
SELECT public.lab_person('00000000-0000-4000-8000-000000000b06', '00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000bb', 'correction', 'reversed', NULL,
  '[{"kind":"restore_media","mediaId":"00000000-0000-4000-8000-000000000d08"}]', (SELECT d.id FROM public.decisions d JOIN public.cases c ON c.id = d.case_id WHERE c.target_id = '00000000-0000-4000-8000-000000000b06' AND d.decided_by IS NULL)) IS NOT NULL;
COMMIT;
SELECT public.lab_state('00000000-0000-4000-8000-000000000b06');
\echo == A7 or decides no breach: the automated withhold ends with the case (b07, d09)
BEGIN; SELECT public.lab_auto('00000000-0000-4000-8000-000000000b07', '00000000-0000-4000-8000-000000000d09', 'R1') IS NOT NULL; COMMIT;
BEGIN;
SELECT public.lab_person('00000000-0000-4000-8000-000000000b07', '00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000bb', 'final', 'no_violation', NULL, '[]') IS NOT NULL;
COMMIT;
SELECT public.lab_state('00000000-0000-4000-8000-000000000b07');
\echo == A8 the cap (automation_rules: 5 an hour): the system has decided 3 times; three more on b08, b09, b10
BEGIN; SELECT public.lab_auto('00000000-0000-4000-8000-000000000b08', '00000000-0000-4000-8000-000000000d0a', 'R1') IS NOT NULL; COMMIT;
BEGIN; SELECT public.lab_auto('00000000-0000-4000-8000-000000000b04', '00000000-0000-4000-8000-000000000d06', 'R1') IS NOT NULL; COMMIT;
\echo -- the sixth within the hour
BEGIN; SELECT public.lab_auto('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-000000000d02', 'R1') IS NOT NULL; COMMIT; ROLLBACK;
SELECT format('system decisions: %s; b02: %s', (SELECT count(*) FROM public.decisions WHERE decided_by IS NULL), public.lab_state('00000000-0000-4000-8000-000000000b02'));

-- LAB E: the counts' queries with the delay and the small-number rule, on synthetic decisions (no real data).
-- As postgres on a copy (labe) of the reset database; triggers off for the bulk insert only.
\set VERBOSITY terse
\pset format aligned
\pset tuples_only off
SET session_replication_role = replica;
INSERT INTO public.decisions (case_id, kind, seen_state_version, outcome, ground, rule_id, rules_version, redress_version, category, source, snapshot_id, snapshot_digest,
                              facts_digest, reason_digest, legal_reference_digest, decided_by, decided_at, xact, puid, informed_at, suspect, needs_admin, ended_interim, automated_detection)
SELECT gen_random_uuid(), 'final', 0, 'restricted', CASE WHEN r IS NULL THEN 'illegal'::public.decision_ground ELSE 'incompatible' END, r, 2, 1, 'STATEMENT_CATEGORY_VIOLENCE', 'report',
       gen_random_uuid(), repeat('a', 64), repeat('b', 64), repeat('c', 64), CASE WHEN r IS NULL THEN repeat('d', 64) END, '00000000-0000-4000-8000-00000000000b',
       make_timestamptz(y, 1 + (g % 12), 1 + (g % 28), 12, 0, 0, 'UTC'), '1'::xid8, md5(random()::text || g), now(), false, false, false, coalesce(r = 'R1' AND g % 3 = 0, false)
  FROM (VALUES (2025, 'R1', 61), (2025, 'R3', 94), (2025, 'R4', 35), (2025, 'R5', 12), (2025, 'R6', 7), (2025, 'R2', 3), (2025, NULL, 4),
               (2026, 'R1', 40), (2026, 'R3', 55), (2026, 'R2', 1)) AS v(y, r, n), generate_series(1, v.n) g;
INSERT INTO public.decisions (case_id, kind, seen_state_version, outcome, rules_version, redress_version, category, source, snapshot_id, snapshot_digest,
                              decided_by, decided_at, xact, puid, informed_at, suspect, needs_admin, ended_interim)
SELECT gen_random_uuid(), 'final', 0, 'no_violation', 2, 1, 'STATEMENT_CATEGORY_VIOLENCE', 'report', gen_random_uuid(), repeat('a', 64), '00000000-0000-4000-8000-00000000000b',
       make_timestamptz(2025, 1 + (g % 12), 5, 12, 0, 0, 'UTC'), '1'::xid8, md5(random()::text || g), now(), false, false, false FROM generate_series(1, 143) g;
SET session_replication_role = origin;
CREATE TABLE public.lab_orders (id serial PRIMARY KEY, effected_at timestamptz, hold_until timestamptz);
INSERT INTO public.lab_orders (effected_at, hold_until) VALUES ('2025-05-02 10:00+00', NULL), ('2025-11-20 10:00+00', '2027-01-01 00:00+00');

CREATE FUNCTION public.lab_band(n bigint) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN n = 0 THEN '0' WHEN n < 10 THEN '1 to 9' ELSE 'about ' || (round(n / 10.0) * 10)::bigint END $$;
-- One table of an edition: decisions that restricted, by ground, for a closed year after the delay; rows under ten folded.
CREATE FUNCTION public.lab_figures(y integer, at timestamptz) RETURNS TABLE (label text, exact bigint, published text)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF at < make_timestamptz(y + 1, 3, 1, 0, 0, 0, 'UTC') THEN RAISE EXCEPTION 'edition_not_due'; END IF;
  RETURN QUERY
  WITH raw AS (
    SELECT coalesce(d.rule_id, 'law') AS label, count(*) AS n FROM public.decisions d
     WHERE d.kind::text = 'final' AND d.outcome::text = 'restricted'
       AND d.decided_at >= make_timestamptz(y, 1, 1, 0, 0, 0, 'UTC') AND d.decided_at < make_timestamptz(y + 1, 1, 1, 0, 0, 0, 'UTC')
     GROUP BY 1),
  folded AS (
    SELECT CASE WHEN r.n < 10 THEN 'other grounds' ELSE r.label END AS label, sum(r.n)::bigint AS n FROM raw r GROUP BY 1)
  SELECT f.label, f.n, public.lab_band(f.n) FROM folded f
  UNION ALL SELECT 'all restrictions', sum(r.n)::bigint, public.lab_band(sum(r.n)::bigint) FROM raw r
  ORDER BY 1;
END $$;
\echo == E1 the raw cells of 2025 (never published)
SELECT coalesce(rule_id, 'law') AS ground, count(*) FROM public.decisions WHERE kind = 'final' AND outcome = 'restricted' AND decided_at >= '2025-01-01+00' AND decided_at < '2026-01-01+00' GROUP BY 1 ORDER BY 1;
\echo == E2 the edition of 2025 as computed on 2026-10-09
SELECT * FROM public.lab_figures(2025, '2026-10-09 12:00+00');
\echo == E3 the edition of 2025 asked for on 2026-02-28, and the open year 2026 asked for today
SELECT * FROM public.lab_figures(2025, '2026-02-28 12:00+00');
SELECT * FROM public.lab_figures(2026, '2026-10-09 12:00+00');
\echo == E4 subtraction: the published total minus the published rows leaves a range, not a number
SELECT string_agg(published, ' + ' ORDER BY label) FILTER (WHERE label <> 'all restrictions') AS rows_published, max(published) FILTER (WHERE label = 'all restrictions') AS total_published
  FROM public.lab_figures(2025, '2026-10-09 12:00+00');
\echo == E5 orders of 2025 countable on 2026-03-01: one of the two is under a hold until 2027
SELECT public.lab_band(count(*) FILTER (WHERE o.hold_until IS NULL OR o.hold_until <= '2026-03-01+00')) AS counted, count(*) AS exact_in_database FROM public.lab_orders o
 WHERE o.effected_at >= '2025-01-01+00' AND o.effected_at < '2026-01-01+00';
\echo == E6 the rate rule: found by automated means under R1 in 2025, and the share a person then restricted, printed only when the base is ten or more
SELECT public.lab_band(count(*) FILTER (WHERE automated_detection)) AS r1_found_by_program, public.lab_band(count(*)) AS r1_all FROM public.decisions
 WHERE rule_id = 'R1' AND kind = 'final' AND decided_at >= '2025-01-01+00' AND decided_at < '2026-01-01+00';
\echo == E7 cost on 20000 more decisions
SET session_replication_role = replica;
INSERT INTO public.decisions (case_id, kind, seen_state_version, outcome, ground, rule_id, rules_version, redress_version, category, source, snapshot_id, snapshot_digest,
                              facts_digest, reason_digest, decided_by, decided_at, xact, puid, informed_at, suspect, needs_admin, ended_interim)
SELECT gen_random_uuid(), 'final', 0, 'restricted', 'incompatible', 'R' || (1 + g % 6), 2, 1, 'STATEMENT_CATEGORY_VIOLENCE', 'report', gen_random_uuid(), repeat('a', 64),
       repeat('b', 64), repeat('c', 64), '00000000-0000-4000-8000-00000000000b', make_timestamptz(2024, 1 + (g % 12), 1 + (g % 28), 12, 0, 0, 'UTC'), '1'::xid8, md5(random()::text || g), now(), false, false, false
  FROM generate_series(1, 20000) g;
SET session_replication_role = origin;
ANALYZE public.decisions;
\timing on
SELECT count(*) AS rows_of_edition_2024 FROM public.lab_figures(2024, '2026-10-09 12:00+00');
\timing off

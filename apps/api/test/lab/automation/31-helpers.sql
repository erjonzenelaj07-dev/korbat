-- LAB 3d helpers, as korbat_migrate after 30-proto.sql. SECURITY INVOKER: called by korbat_api they run the statements
-- the API would run, in the caller's transaction, so triggers, locks and deferred checks are the real ones.
CREATE FUNCTION public.lab_salt() RETURNS text LANGUAGE sql VOLATILE AS $$ SELECT encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex') $$;
CREATE FUNCTION public.lab_digest(salt text, body text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode(salt, 'hex') || convert_to(body, 'UTF8')), 'hex') $$;
CREATE FUNCTION public.lab_ref() RETURNS text LANGUAGE sql VOLATILE AS $$ SELECT 'N-' || translate(upper(substr(public.lab_salt(), 1, 10)), '0189', 'GHIJ') $$;
CREATE FUNCTION public.lab_params(d public.decisions, acts jsonb) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('kind', d.kind, 'stateVersion', d.seen_state_version, 'throughSeq', d.through_seq,
    'reviewsDecisionId', d.reviews_decision_id, 'snapshotId', d.snapshot_id, 'snapshotDigest', d.snapshot_digest, 'outcome', d.outcome,
    'ground', d.ground, 'ruleId', d.rule_id, 'rulesVersion', d.rules_version, 'redressVersion', d.redress_version, 'category', d.category,
    'categoryKeyword', d.category_keyword, 'factsDigest', d.facts_digest, 'reasonDigest', d.reason_digest,
    'legalReferenceDigest', d.legal_reference_digest, 'actions', acts) $$;

-- The open case of a post (opened when there is none), with the author's profile locked first, as the API does.
CREATE FUNCTION public.lab_case(post uuid) RETURNS public.cases LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE c public.cases; author uuid;
BEGIN
  SELECT q.author_id INTO author FROM public.posts q WHERE q.id = post;
  PERFORM 1 FROM public.profiles p WHERE p.id = author FOR NO KEY UPDATE;
  SELECT k.* INTO c FROM public.cases k WHERE k.target_type = 'post' AND k.target_id = post AND k.closed_at IS NULL;
  IF NOT FOUND THEN INSERT INTO public.cases (target_type, target_id, opened_at) VALUES ('post', post, now()) RETURNING * INTO c; END IF;
  RETURN c;
END $$;
CREATE FUNCTION public.lab_snapshot(c public.cases, post uuid) RETURNS public.evidence_snapshots LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE s text := public.lab_salt(); e public.evidence_snapshots;
BEGIN
  INSERT INTO public.evidence_snapshots (case_id, target_type, target_id, taken_at, author_handle, body, salt, digest)
  VALUES (c.id, 'post', post, now(), 's', 'b', s, public.lab_digest(s, 'snap')) RETURNING * INTO e;
  RETURN e;
END $$;

-- The automated step: finding (automated, system), signal, automated interim decision with one measure, the system's audit row.
-- act: 'on' takes the measure; 'off' is the fallback (finding and signal only). tamper injects one fault.
CREATE FUNCTION public.lab_auto(post uuid, media uuid, rule text, act text DEFAULT 'on', tamper text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  c public.cases; e public.evidence_snapshots; d public.decisions; iid uuid; sid uuid; author uuid;
  measure text := CASE WHEN rule = 'R2' THEN 'seal_media' ELSE 'withhold_media' END; acts jsonb;
BEGIN
  SELECT q.author_id INTO author FROM public.posts q WHERE q.id = post;
  c := public.lab_case(post);
  INSERT INTO public.intakes (kind, ref, channel, rule_id, category, automated_processing, received_at)
  VALUES ('automated', public.lab_ref(), 'system', CASE WHEN tamper = 'finding_r3' THEN 'R3' ELSE rule END,
          CASE WHEN rule = 'R2' THEN 'STATEMENT_CATEGORY_PROTECTION_OF_MINORS' ELSE 'STATEMENT_CATEGORY_VIOLENCE' END, true, now()) RETURNING id INTO iid;
  INSERT INTO public.intake_items (intake_id, position, target_type, target_id, case_id, lane, created_at)
  VALUES (iid, 1, 'post', post, c.id, CASE WHEN rule = 'R2' THEN 0 ELSE 2 END, now());
  INSERT INTO public.automated_signals (kind, media_id) VALUES (CASE WHEN rule = 'R2' THEN 'known_match' ELSE 'r1_score' END, media) RETURNING id INTO sid;
  IF act = 'off' THEN RETURN NULL; END IF;
  SELECT k.* INTO c FROM public.cases k WHERE k.id = c.id;
  e := public.lab_snapshot(c, post);
  IF tamper = 'measure_remove' THEN measure := 'remove_media'; END IF;
  INSERT INTO public.decisions (case_id, kind, seen_state_version, through_seq, outcome, ground, rule_id, rules_version, redress_version, category, source,
                                snapshot_id, snapshot_digest, decided_by, decided_at, xact, puid, informed_at, suspect, needs_admin, ended_interim)
  VALUES (c.id, CASE WHEN tamper = 'final' THEN 'final'::public.decision_kind ELSE 'interim' END, c.state_version,
          CASE WHEN tamper = 'final' THEN c.intake_seq ELSE 0 END, 'restricted', 'incompatible', CASE WHEN tamper = 'rule_r3' THEN 'R3' ELSE rule END, 2, 1,
          CASE WHEN rule = 'R2' THEN 'STATEMENT_CATEGORY_PROTECTION_OF_MINORS' ELSE 'STATEMENT_CATEGORY_VIOLENCE' END, 'own_initiative',
          e.id, e.digest, NULL, now(), pg_current_xact_id(), 'x', now(), false, false, false) RETURNING * INTO d;
  acts := jsonb_build_array(jsonb_build_object('kind', measure, 'mediaId', CASE WHEN measure = 'seal_media' THEN NULL ELSE media END));
  INSERT INTO public.decision_actions (decision_id, kind, media_id, subject_account_id, created_at)
  VALUES (d.id, measure::public.action_kind, CASE WHEN measure = 'seal_media' THEN NULL ELSE media END, author, now());
  IF tamper = 'two_measures' THEN
    INSERT INTO public.decision_actions (decision_id, kind, subject_account_id, created_at) VALUES (d.id, 'withhold', author, now());
    acts := acts || jsonb_build_array(jsonb_build_object('kind', 'withhold', 'mediaId', NULL));
  END IF;
  IF tamper IS DISTINCT FROM 'no_signal' THEN UPDATE public.automated_signals SET decision_id = d.id WHERE id = sid; END IF;
  IF tamper = 'no_audit' THEN RETURN d.id; END IF;
  IF tamper = 'staff_audit' THEN
    PERFORM public.append_confirmed_audit('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000bb', 'case_decided', 'case', c.id::text,
      jsonb_build_object('decisionId', d.id, 'signalId', sid, 'params', public.lab_params(d, acts)),
      gen_random_uuid(), repeat('a', 64), '{}'::jsonb, 'lab', (extract(epoch FROM clock_timestamp()) * 1000)::bigint + 60000);
    RETURN d.id;
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_type, target_id, metadata, request_id)
  VALUES ('00000000-0000-0000-0000-000000000000', 'automated_decided', 'case', c.id::text,
          jsonb_build_object('decisionId', d.id, 'signalId', sid, 'params', public.lab_params(d, acts)), 'lab');
  RETURN d.id;
END $$;

-- A person's finding citing a rule (R2 makes the item suspect), as POST /api/staff/findings.
CREATE FUNCTION public.lab_finding(post uuid, staff uuid, rule text) RETURNS uuid LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE c public.cases; iid uuid;
BEGIN
  c := public.lab_case(post);
  INSERT INTO public.intakes (kind, ref, channel, finding_by, rule_id, category, received_at)
  VALUES ('finding', public.lab_ref(), 'staff', staff, rule, 'STATEMENT_CATEGORY_PROTECTION_OF_MINORS', now()) RETURNING id INTO iid;
  INSERT INTO public.intake_items (intake_id, position, target_type, target_id, case_id, lane, created_at) VALUES (iid, 1, 'post', post, c.id, 0, now());
  RETURN c.id;
END $$;

-- A person's decision on a post's open case: kind interim, final or correction (of decision corrects), with its actions.
CREATE FUNCTION public.lab_person(post uuid, decider uuid, key uuid, kind text, outcome text, rule text, acts jsonb, corrects uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  c public.cases; e public.evidence_snapshots; d public.decisions; author uuid; s text; fd text; rd text; a jsonb; o public.decisions;
  cat text := CASE WHEN rule = 'R2' THEN 'STATEMENT_CATEGORY_PROTECTION_OF_MINORS' ELSE 'STATEMENT_CATEGORY_VIOLENCE' END;
BEGIN
  SELECT q.author_id INTO author FROM public.posts q WHERE q.id = post;
  c := public.lab_case(post);
  IF corrects IS NOT NULL THEN
    SELECT x.* INTO o FROM public.decisions x WHERE x.id = corrects;
    SELECT k.* INTO c FROM public.cases k WHERE k.id = o.case_id;
    cat := o.category;
  END IF;
  e := public.lab_snapshot(c, post);
  IF outcome = 'restricted' THEN
    s := public.lab_salt(); fd := public.lab_digest(s, 'facts');
    INSERT INTO public.staff_texts (case_id, author_id, kind, text, salt, digest, created_at) VALUES (c.id, decider, 'facts', 'facts', s, fd, now());
  END IF;
  IF outcome = 'restricted' OR kind = 'correction' THEN
    s := public.lab_salt(); rd := public.lab_digest(s, 'reason');
    INSERT INTO public.staff_texts (case_id, author_id, kind, text, salt, digest, created_at)
    VALUES (c.id, decider, CASE WHEN kind = 'correction' THEN 'review_reason'::public.staff_text_kind ELSE 'reason' END, 'reason', s, rd, now());
  END IF;
  SELECT k.* INTO c FROM public.cases k WHERE k.id = c.id;
  INSERT INTO public.decisions (case_id, kind, reviews_decision_id, seen_state_version, through_seq, outcome, ground, rule_id, rules_version, redress_version, category, source,
                                snapshot_id, snapshot_digest, facts_digest, reason_digest, decided_by, decided_at, xact, puid, informed_at, suspect, needs_admin, ended_interim)
  VALUES (c.id, kind::public.decision_kind, corrects, c.state_version, CASE WHEN kind = 'final' THEN c.intake_seq ELSE 0 END, outcome::public.decision_outcome,
          CASE WHEN outcome = 'restricted' THEN 'incompatible'::public.decision_ground END, CASE WHEN outcome = 'restricted' THEN rule END,
          CASE WHEN corrects IS NOT NULL THEN o.rules_version ELSE 2 END, 1, cat, 'own_initiative',
          e.id, e.digest, fd, rd, decider, now(), pg_current_xact_id(), 'x', now(), false, false, false) RETURNING * INTO d;
  FOR a IN SELECT * FROM jsonb_array_elements(acts) LOOP
    INSERT INTO public.decision_actions (decision_id, kind, media_id, subject_account_id, created_at)
    VALUES (d.id, (a ->> 'kind')::public.action_kind, (a ->> 'mediaId')::uuid, author, now());
  END LOOP;
  SELECT x.* INTO d FROM public.decisions x WHERE x.id = d.id;
  PERFORM public.append_confirmed_audit(decider, key, 'case_decided', 'case', c.id::text,
    jsonb_build_object('decisionId', d.id, 'params', public.lab_params(d, acts)),
    gen_random_uuid(), repeat('a', 64), '{}'::jsonb, 'lab', (extract(epoch FROM clock_timestamp()) * 1000)::bigint + 60000);
  RETURN d.id;
END $$;

-- What a test prints of a post: its images' states, the freeze, the measures in force.
CREATE FUNCTION public.lab_state(post uuid) RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT format('level=%s images=[%s] frozen=%s in_force=[%s]',
    (SELECT q.moderation_level FROM public.posts q WHERE q.id = post),
    (SELECT string_agg(m.moderation_state::text || CASE WHEN m.erased_at IS NOT NULL THEN '(erased)' ELSE '' END, ',' ORDER BY m.position) FROM public.post_media m WHERE m.post_id = post),
    public.post_frozen(post),
    (SELECT string_agg(f.decision_kind::text || ':' || f.kind::text, ',' ORDER BY f.kind::text, f.decision_kind::text)
       FROM public.measures_in_force f JOIN public.cases k ON k.id = f.case_id WHERE k.target_id = post))
$$;

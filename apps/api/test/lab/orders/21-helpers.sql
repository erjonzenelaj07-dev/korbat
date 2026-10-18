-- LAB 3f helpers, run as korbat_migrate after 20-proto.sql. SECURITY INVOKER: called by korbat_api they run the
-- statements the API would run, in the caller's transaction, so the triggers, locks and deferred checks are the real ones.
CREATE TABLE public.lab_events (id bigserial PRIMARY KEY, kind text NOT NULL, n integer, took_ms numeric, at timestamptz NOT NULL DEFAULT clock_timestamp());
GRANT SELECT, INSERT ON public.lab_events TO korbat_api;
GRANT USAGE, SELECT ON SEQUENCE public.lab_events_id_seq TO korbat_api;
ALTER TABLE public.lab_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY lab_events_all ON public.lab_events FOR ALL TO korbat_api USING (true) WITH CHECK (true);

CREATE FUNCTION public.lab_salt() RETURNS text LANGUAGE sql VOLATILE AS $$ SELECT encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex') $$;
CREATE FUNCTION public.lab_digest(salt text, body text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode(salt, 'hex') || convert_to(body, 'UTF8')), 'hex') $$;
CREATE FUNCTION public.lab_ref() RETURNS text LANGUAGE sql VOLATILE AS $$ SELECT 'N-' || translate(upper(substr(public.lab_salt(), 1, 10)), '0189', 'GHIJ') $$;

-- Opens an order from a contact message, as POST /api/staff/orders would: the row, its items, the event.
CREATE FUNCTION public.lab_order_open(msg uuid, kind text, state text, authority text, reference text, section_c boolean, posts uuid[], staff uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  oid uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.legal_orders (id, kind, member_state, authority, reference, channel, message_id, section_c, emergency, cross_border, withhold_from_author, opened_by)
  VALUES (oid, kind, state, authority, reference, 'mailbox', msg, section_c, false, state <> 'DE', kind = 'tco_removal', staff);
  INSERT INTO public.legal_order_items (id, order_id, position, link, post_id)
  SELECT gen_random_uuid(), oid, t.n, 'https://korbat.example/post/' || t.p, t.p FROM unnest(posts) WITH ORDINALITY AS t(p, n);
  INSERT INTO public.legal_order_events (order_id, kind, by_staff) VALUES (oid, 'opened', staff);
  RETURN oid;
END $$;

-- "Disable for an order": one transaction for up to ten items, one audit row. tamper names a fault to inject.
CREATE FUNCTION public.lab_order_effect(oid uuid, decider uuid, key uuid, tamper text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  o public.legal_orders;
  it record;
  c public.cases;
  iid uuid;
  item_id uuid;
  snap uuid;
  s text;
  dg text;
  did uuid;
  h text;
  ids jsonb := '{}'::jsonb;
  items jsonb := '[]'::jsonb;
  n integer := 0;
  t0 timestamptz := clock_timestamp();
BEGIN
  SELECT x.* INTO o FROM public.legal_orders x WHERE x.id = oid;
  -- 1. The authors' profiles, in id order.
  PERFORM 1 FROM public.profiles p WHERE p.id IN (SELECT q.author_id FROM public.legal_order_items i JOIN public.posts q ON q.id = i.post_id WHERE i.order_id = oid)
    ORDER BY p.id FOR NO KEY UPDATE;
  INSERT INTO public.intakes (kind, ref, channel, alleges_illegal, category, received_at)
  VALUES ('order', public.lab_ref(), 'authority', true, 'STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY', now()) RETURNING id INTO iid;
  -- 2. The intake items first, in post id order: each insert's attach trigger takes its case, so the cases are taken in
  -- their targets' order before any post (the API role cannot lock a case itself: it holds no UPDATE on cases).
  FOR it IN SELECT i.id, i.post_id FROM public.legal_order_items i JOIN public.posts q ON q.id = i.post_id
             WHERE i.order_id = oid AND NOT EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.id = i.action_id) ORDER BY i.post_id LOOP
    n := n + 1;
    SELECT k.* INTO c FROM public.cases k WHERE k.target_type = 'post' AND k.target_id = it.post_id AND k.closed_at IS NULL;
    IF NOT FOUND THEN
      INSERT INTO public.cases (target_type, target_id, opened_at) VALUES ('post', it.post_id, now()) RETURNING * INTO c;
    END IF;
    INSERT INTO public.intake_items (intake_id, position, target_type, target_id, case_id, lane, created_at)
    VALUES (iid, n, 'post', it.post_id, c.id, 0, now()) RETURNING id INTO item_id;
    UPDATE public.legal_order_items SET intake_item_id = item_id WHERE id = it.id;
  END LOOP;
  -- 3. Then, post by post in id order: the snapshot, the decision and its measure.
  FOR it IN SELECT i.id, i.post_id, q.author_id, a.handle, x.case_id FROM public.legal_order_items i JOIN public.posts q ON q.id = i.post_id
              JOIN public.profiles a ON a.id = q.author_id JOIN public.intake_items x ON x.id = i.intake_item_id
             WHERE i.order_id = oid AND x.intake_id = iid ORDER BY i.post_id LOOP
    SELECT k.* INTO c FROM public.cases k WHERE k.id = it.case_id;
    s := public.lab_salt();
    dg := public.lab_digest(s, 'snapshot of ' || it.post_id);
    INSERT INTO public.evidence_snapshots (case_id, target_type, target_id, taken_at, author_handle, post_state, post_created_at, body, salt, digest)
    SELECT c.id, 'post', q.id, now(), it.handle, q.state, q.created_at, q.body, s, dg FROM public.posts q WHERE q.id = it.post_id RETURNING id INTO snap;
    INSERT INTO public.decisions (case_id, kind, order_item_id, seen_state_version, through_seq, outcome, ground, rules_version, redress_version, category, source,
                                  snapshot_id, snapshot_digest, decided_by, decided_at, xact, puid, informed_at, suspect, needs_admin, ended_interim)
    VALUES (c.id, 'order', it.id, c.state_version, 0, 'restricted', 'illegal', 2, 1, 'STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH', 'own_initiative',
            snap, dg, decider, now(), pg_current_xact_id(), 'x', now(), false, false, false) RETURNING id INTO did;
    INSERT INTO public.decision_actions (decision_id, kind, subject_account_id, created_at) VALUES (did, 'disable_by_order', it.author_id, now());
    IF tamper = 'extra_measure' THEN
      INSERT INTO public.decision_actions (decision_id, kind, subject_account_id, created_at) VALUES (did, 'remove', it.author_id, now());
    END IF;
    ids := ids || jsonb_build_object(it.id::text, did);
    IF NOT (tamper IS NOT DISTINCT FROM 'missing_item' AND ids = jsonb_build_object(it.id::text, did)) THEN
      items := items || jsonb_build_array(jsonb_build_object('itemId', it.id, 'postId', it.post_id));
    END IF;
  END LOOP;
  IF tamper = 'no_audit' THEN RETURN n; END IF;
  PERFORM public.append_confirmed_audit(decider, key, CASE WHEN tamper = 'wrong_action' THEN 'case_decided' ELSE 'order_effected' END, 'order', oid::text,
    jsonb_build_object('decisionIds', ids, 'params', jsonb_build_object('kind', o.kind, 'memberState', o.member_state, 'authority', o.authority,
      'reference', CASE WHEN tamper = 'wrong_reference' THEN 'forged' ELSE o.reference END, 'sectionC', o.section_c, 'emergency', o.emergency,
      'withholdFromAuthor', o.withhold_from_author, 'items', items)),
    gen_random_uuid(), repeat('a', 64), '{}'::jsonb, 'lab', (extract(epoch FROM clock_timestamp()) * 1000)::bigint + 60000);
  INSERT INTO public.lab_events (kind, n, took_ms) VALUES ('order_effect', n, extract(epoch FROM clock_timestamp() - t0) * 1000);
  RETURN n;
END $$;

-- An ordinary 3c removal of a post on a moderator's finding (final, restricted, ground incompatible), for the derivation test.
CREATE FUNCTION public.lab_remove(post uuid, decider uuid, key uuid, rule text) RETURNS uuid
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  c public.cases; iid uuid; s text; dg text; fd text; rd text; snap uuid; d public.decisions; author uuid; h text;
BEGIN
  SELECT q.author_id, a.handle INTO author, h FROM public.posts q JOIN public.profiles a ON a.id = q.author_id WHERE q.id = post;
  PERFORM 1 FROM public.profiles p WHERE p.id = author FOR NO KEY UPDATE;
  SELECT k.* INTO c FROM public.cases k WHERE k.target_type = 'post' AND k.target_id = post AND k.closed_at IS NULL;
  IF NOT FOUND THEN INSERT INTO public.cases (target_type, target_id, opened_at) VALUES ('post', post, now()) RETURNING * INTO c; END IF;
  INSERT INTO public.intakes (kind, ref, channel, finding_by, rule_id, category, received_at)
  VALUES ('finding', public.lab_ref(), 'staff', decider, rule, 'STATEMENT_CATEGORY_VIOLENCE', now()) RETURNING id INTO iid;
  INSERT INTO public.intake_items (intake_id, position, target_type, target_id, case_id, lane, created_at) VALUES (iid, 1, 'post', post, c.id, 1, now());
  s := public.lab_salt(); dg := public.lab_digest(s, 'snap');
  INSERT INTO public.evidence_snapshots (case_id, target_type, target_id, taken_at, author_handle, body, salt, digest) VALUES (c.id, 'post', post, now(), h, 'b', s, dg) RETURNING id INTO snap;
  s := public.lab_salt(); fd := public.lab_digest(s, 'facts');
  INSERT INTO public.staff_texts (case_id, author_id, kind, text, salt, digest, created_at) VALUES (c.id, decider, 'facts', 'facts', s, fd, now());
  s := public.lab_salt(); rd := public.lab_digest(s, 'reason');
  INSERT INTO public.staff_texts (case_id, author_id, kind, text, salt, digest, created_at) VALUES (c.id, decider, 'reason', 'reason', s, rd, now());
  SELECT k.* INTO c FROM public.cases k WHERE k.id = c.id;
  INSERT INTO public.decisions (case_id, kind, seen_state_version, through_seq, outcome, ground, rule_id, rules_version, redress_version, category, source,
                                snapshot_id, snapshot_digest, facts_digest, reason_digest, decided_by, decided_at, xact, puid, informed_at, suspect, needs_admin, ended_interim)
  VALUES (c.id, 'final', c.state_version, c.intake_seq, 'restricted', 'incompatible', rule, 2, 1, 'STATEMENT_CATEGORY_VIOLENCE', 'own_initiative',
          snap, dg, fd, rd, decider, now(), pg_current_xact_id(), 'x', now(), false, false, false) RETURNING * INTO d;
  INSERT INTO public.decision_actions (decision_id, kind, subject_account_id, created_at) VALUES (d.id, 'remove', author, now());
  PERFORM public.append_confirmed_audit(decider, key, 'case_decided', 'case', c.id::text,
    jsonb_build_object('decisionId', d.id, 'params', jsonb_build_object('kind', d.kind, 'stateVersion', d.seen_state_version, 'throughSeq', d.through_seq,
      'reviewsDecisionId', d.reviews_decision_id, 'snapshotId', d.snapshot_id, 'snapshotDigest', d.snapshot_digest, 'outcome', d.outcome,
      'ground', d.ground, 'ruleId', d.rule_id, 'rulesVersion', d.rules_version, 'redressVersion', d.redress_version, 'category', d.category,
      'categoryKeyword', d.category_keyword, 'factsDigest', d.facts_digest, 'reasonDigest', d.reason_digest,
      'legalReferenceDigest', d.legal_reference_digest, 'actions', jsonb_build_array(jsonb_build_object('kind', 'remove', 'mediaId', NULL)))),
    gen_random_uuid(), repeat('a', 64), '{}'::jsonb, 'lab', (extract(epoch FROM clock_timestamp()) * 1000)::bigint + 60000);
  RETURN d.id;
END $$;

-- A correction that reverses one decision in full: restore (a removal) or reinstate_by_order (an order's disabling).
CREATE FUNCTION public.lab_correct(decision uuid, decider uuid, key uuid, reversal text, ground text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  o public.decisions; c public.cases; d public.decisions; author uuid; s text := public.lab_salt(); rd text; act jsonb;
BEGIN
  SELECT x.* INTO o FROM public.decisions x WHERE x.id = decision;
  SELECT x.* INTO c FROM public.cases x WHERE x.id = o.case_id;
  SELECT q.author_id INTO author FROM public.posts q WHERE q.id = c.target_id;
  PERFORM 1 FROM public.profiles p WHERE p.id = author FOR NO KEY UPDATE;
  SELECT x.* INTO c FROM public.cases x WHERE x.id = o.case_id;
  rd := public.lab_digest(s, 'lab correction');
  INSERT INTO public.staff_texts (case_id, author_id, kind, text, salt, digest, created_at) VALUES (c.id, decider, 'review_reason', 'lab correction', s, rd, now());
  INSERT INTO public.decisions (case_id, kind, reviews_decision_id, seen_state_version, through_seq, outcome, rules_version, redress_version, category, source,
                                snapshot_id, snapshot_digest, reason_digest, decided_by, decided_at, xact, puid, informed_at, suspect, needs_admin, ended_interim)
  VALUES (c.id, 'correction', o.id, c.state_version, 0, 'reversed', o.rules_version, 1, o.category, 'own_initiative',
          o.snapshot_id, o.snapshot_digest, rd, decider, now(), pg_current_xact_id(), 'x', now(), false, false, false) RETURNING * INTO d;
  INSERT INTO public.decision_actions (decision_id, kind, subject_account_id, order_ground, created_at) VALUES (d.id, reversal::public.action_kind, author, ground, now());
  act := jsonb_build_object('kind', reversal, 'mediaId', NULL) || CASE WHEN ground IS NOT NULL THEN jsonb_build_object('orderGround', ground) ELSE '{}'::jsonb END;
  PERFORM public.append_confirmed_audit(decider, key, 'case_decided', 'case', c.id::text,
    jsonb_build_object('decisionId', d.id, 'params', jsonb_build_object('kind', d.kind, 'stateVersion', d.seen_state_version, 'throughSeq', d.through_seq,
      'reviewsDecisionId', d.reviews_decision_id, 'snapshotId', d.snapshot_id, 'snapshotDigest', d.snapshot_digest, 'outcome', d.outcome,
      'ground', d.ground, 'ruleId', d.rule_id, 'rulesVersion', d.rules_version, 'redressVersion', d.redress_version, 'category', d.category,
      'categoryKeyword', d.category_keyword, 'factsDigest', d.facts_digest, 'reasonDigest', d.reason_digest,
      'legalReferenceDigest', d.legal_reference_digest, 'actions', jsonb_build_array(act))),
    gen_random_uuid(), repeat('a', 64), '{}'::jsonb, 'lab', (extract(epoch FROM clock_timestamp()) * 1000)::bigint + 60000);
  RETURN d.id;
END $$;

-- What the readers decide, as SQL: postAccess (apps/api/src/social/visibility.ts:20) and serve's isShown (media/flows/serve.ts:23).
CREATE FUNCTION public.lab_post_access(viewer uuid, post uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE q.state::text WHEN 'deleted_by_author' THEN 'deleted' WHEN 'visible' THEN 'shown'
                            WHEN 'withheld' THEN CASE WHEN viewer = q.author_id THEN 'shown' ELSE 'hidden' END
                            WHEN 'removed' THEN CASE WHEN viewer = q.author_id THEN 'shown' ELSE 'hidden' END
                            ELSE 'hidden' END FROM public.posts q WHERE q.id = post $$;
GRANT EXECUTE ON FUNCTION public.lab_salt(), public.lab_digest(text, text), public.lab_ref(),
  public.lab_order_open(uuid, text, text, text, text, boolean, uuid[], uuid), public.lab_order_effect(uuid, uuid, uuid, text),
  public.lab_remove(uuid, uuid, uuid, text), public.lab_correct(uuid, uuid, uuid, text, text), public.lab_post_access(uuid, uuid),
  public.order_rules(), public.order_hold_end(timestamptz, boolean), public.order_hold_until(uuid), public.order_preserve_until(timestamptz) TO korbat_api;

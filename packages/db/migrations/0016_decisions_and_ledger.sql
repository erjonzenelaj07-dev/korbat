-- Decisions and the ledger (3c design, section 6.2). Written by hand: this migration changes no table. The API inserts a
-- decision and its measures; the triggers below check them, force what the API must not choose, and derive every post's
-- level and every image's state from the ledger of measures (decision_actions, with seal_posts), so that no restriction
-- exists without a decision a staff key confirmed. Every function is owned by the migrator, pins its search path, names
-- every object schema-qualified and has EXECUTE taken from PUBLIC: a trigger function fires for every role all the same,
-- and the few that a role calls directly are granted to that role alone. Errors carry their code as the message under
-- SQLSTATE P0001 unless a SQLSTATE is named. Under READ COMMITTED each statement of a PL/pgSQL function takes a fresh
-- snapshot, so a read in a statement of its own after a lock sees every row committed while the lock waited: the
-- functions below are written in that form wherever a lock comes first.
--
-- Whether an account is staff, for the rule that no final measure restricts a staff account. It runs as its owner, since
-- the API role holds nothing in the auth schema, and it takes the account's row FOR SHARE: a concurrent promotion either
-- waits for the decision's commit or is read by it (FOR KEY SHARE would let a promotion slip between the read and the
-- commit). False when there is no such account. Only the triggers below call it.
CREATE FUNCTION "public"."account_is_staff"(account uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = auth, pg_temp AS $$
DECLARE
  staff boolean;
BEGIN
  SELECT u.role <> 'user' INTO staff FROM auth.users u WHERE u.id = account_is_staff.account FOR SHARE;
  RETURN coalesce(staff, false);
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."account_is_staff"(uuid) FROM PUBLIC;--> statement-breakpoint
-- Recusal: whether a staff account is too close to the parties of a case to decide it. True when the staff account is
-- itself a party, or a personal account the operator linked to it (auth.staff_personal_accounts, which no API role can
-- read) is a party, follows, blocks or mutes one, replied to a post of one in the last 90 days, or wrote the post that the
-- case's own post replies to or quotes. Only what the linked account did, and the post the case judges, count: a party's
-- own follow, block, mute or reply towards a linked account never does, since anyone can make one without the staff member
-- doing anything, and one click would otherwise put an account beyond every staff member whose posting account it follows.
-- It runs as its owner and answers one boolean. Only the triggers below and staff_case_conflict call it.
CREATE FUNCTION "public"."staff_party_conflict"(staff uuid, parties uuid[], target_post uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(staff_party_conflict.staff = ANY(staff_party_conflict.parties), false)
    OR EXISTS (
      SELECT 1 FROM auth.staff_personal_accounts l
       WHERE l.staff_user_id = staff_party_conflict.staff
         AND (l.personal_user_id = ANY(staff_party_conflict.parties)
           OR EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = l.personal_user_id AND f.followee_id = ANY(staff_party_conflict.parties))
           OR EXISTS (SELECT 1 FROM public.blocks b WHERE b.blocker_id = l.personal_user_id AND b.blocked_id = ANY(staff_party_conflict.parties))
           OR EXISTS (SELECT 1 FROM public.mutes m WHERE m.muter_id = l.personal_user_id AND m.muted_id = ANY(staff_party_conflict.parties))
           OR EXISTS (SELECT 1 FROM public.posts r JOIN public.posts o ON o.id = r.reply_to_id
                       WHERE r.author_id = l.personal_user_id AND o.author_id = ANY(staff_party_conflict.parties) AND r.created_at > now() - interval '90 days')
           OR EXISTS (SELECT 1 FROM public.posts t JOIN public.posts o ON o.id IN (t.reply_to_id, t.quote_of_id)
                       WHERE t.id = staff_party_conflict.target_post AND o.author_id = l.personal_user_id)))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."staff_party_conflict"(uuid, uuid[], uuid) FROM PUBLIC;--> statement-breakpoint
-- The same question about a case, for the routes: they hand over a case, never a list of accounts. False when the case
-- does not exist. The parties are the case's subject (a post's author, or the account) and, with `everyone`, every
-- signed-in reporter of its items; without it a refused read says nothing about who reported.
CREATE FUNCTION "public"."staff_case_conflict"(staff uuid, case_id uuid, everyone boolean) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c public.cases;
  subject uuid;
  parties uuid[];
BEGIN
  SELECT k.* INTO c FROM public.cases k WHERE k.id = staff_case_conflict.case_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF c.target_type = 'post' THEN
    SELECT p.author_id INTO subject FROM public.posts p WHERE p.id = c.target_id;
  ELSE
    subject := c.target_id;
  END IF;
  parties := array_remove(ARRAY[subject], NULL);
  IF staff_case_conflict.everyone THEN
    parties := parties || coalesce((SELECT array_agg(DISTINCT i.reporter_account_id) FROM public.intake_items i
                                     WHERE i.case_id = c.id AND i.reporter_account_id IS NOT NULL), '{}'::uuid[]);
  END IF;
  RETURN public.staff_party_conflict(staff_case_conflict.staff, parties, CASE WHEN c.target_type = 'post' THEN c.target_id END);
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."staff_case_conflict"(uuid, uuid, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."staff_case_conflict"(uuid, uuid, boolean) TO korbat_api;--> statement-breakpoint
-- The one predicate by which a snapshot's content is withheld wherever it would be shown: true when the snapshot is
-- erased, or when it holds content (a body that is not empty, or an image with an alt text) and its post's content was
-- erased since (posts.erased_at). A snapshot taken after such an erasure holds no content, so it is shown as it is. An id
-- that names no snapshot is answered true: there is nothing to show.
CREATE FUNCTION "public"."snapshot_withheld"(snapshot uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT s.erased_at IS NOT NULL
        OR ((coalesce(s.body, '') <> ''
             OR CASE WHEN jsonb_typeof(s.media) = 'array'
                     THEN EXISTS (SELECT 1 FROM jsonb_array_elements(s.media) image WHERE image ->> 'alt' IS NOT NULL)
                     ELSE false END)
            AND s.target_type = 'post'
            AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = s.target_id AND p.erased_at IS NOT NULL))
      FROM public.evidence_snapshots s WHERE s.id = snapshot_withheld.snapshot), true)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."snapshot_withheld"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."snapshot_withheld"(uuid) TO korbat_api;--> statement-breakpoint
-- The one writer of the moderation columns: posts.moderation_level, posts.state other than the author's deletion, and
-- post_media.moderation_state. It derives them from the ledger: a post's level is the strongest post measure in force over
-- every case (removed also when its content was erased), and an image is sealed while a seal in force lists its post, else
-- removed, withheld or visible by the image measures in force (removed also when it was erased). The result does not
-- depend on the order in which cases, measures and reversals arrive, and an auditor can recompute it. With `levels` it
-- takes the posts first, in id order, then their image rows in id order; without it only the image rows, which is the form
-- a seal uses: a seal changes no post's level, images come onto a post only in the transaction that creates it, and an
-- image never leaves its post, so the image rows are where the derivation of image states serialises. Each read is a
-- statement of its own after its locks. posts.state mirrors the level unless the author deleted the post: the author's
-- deletion is terminal, and moderation never moves state to or from it. Nobody may call it: its owner does, from the
-- triggers below and from the erasure of a later migration.
CREATE FUNCTION "public"."moderation_apply"(posts uuid[], levels boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ids uuid[];
  derived public.moderation_level[];
BEGIN
  IF moderation_apply.levels THEN
    PERFORM 1 FROM public.posts p WHERE p.id = ANY(moderation_apply.posts) ORDER BY p.id FOR UPDATE;
    SELECT array_agg(p.id),
           array_agg(CASE
             WHEN p.erased_at IS NOT NULL OR EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.post_id = p.id AND m.kind = 'remove') THEN 'removed'
             WHEN EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.post_id = p.id AND m.kind = 'withhold') THEN 'withheld'
             ELSE 'visible' END::public.moderation_level)
      INTO ids, derived
      FROM public.posts p WHERE p.id = ANY(moderation_apply.posts);
    UPDATE public.posts p SET moderation_level = v.level
      FROM unnest(ids, derived) AS v(id, level)
     WHERE p.id = v.id AND p.moderation_level <> v.level;
    UPDATE public.posts p SET state = v.level::text::public.post_state
      FROM unnest(ids, derived) AS v(id, level)
     WHERE p.id = v.id AND p.state <> 'deleted_by_author' AND p.state <> v.level::text::public.post_state;
  END IF;
  PERFORM 1 FROM public.post_media m WHERE m.post_id = ANY(moderation_apply.posts) ORDER BY m.id FOR NO KEY UPDATE;
  UPDATE public.post_media i SET moderation_state = v.state
    FROM (SELECT m.id,
                 CASE
                   WHEN EXISTS (SELECT 1 FROM public.seal_posts s JOIN public.measures_in_force f ON f.id = s.action_id WHERE s.post_id = m.post_id) THEN 'sealed'
                   WHEN m.erased_at IS NOT NULL
                     OR EXISTS (SELECT 1 FROM public.measures_in_force f WHERE f.post_id = m.post_id AND f.kind = 'remove_media' AND f.media_id = m.id) THEN 'removed'
                   WHEN EXISTS (SELECT 1 FROM public.measures_in_force f WHERE f.post_id = m.post_id AND f.kind = 'withhold_media' AND f.media_id = m.id) THEN 'withheld'
                   ELSE 'visible' END::public.media_moderation_state AS state
            FROM public.post_media m WHERE m.post_id = ANY(moderation_apply.posts)) v
   WHERE i.id = v.id AND i.moderation_state <> v.state;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."moderation_apply"(uuid[], boolean) FROM PUBLIC;--> statement-breakpoint
-- The posts' guard. The column grants of migration 0015 leave posts.state writable by the API role, which the author's
-- deletion needs; this trigger holds what it may write there. For every role, the migrator included: a post never leaves
-- deleted_by_author. For every role but the migrator: a post is inserted visible, at level visible and unerased, and an
-- update moves state only to deleted_by_author and never changes the level or the erasure time. The function is plain, so
-- current_user is the role that ran the statement: the API role can neither become the migrator nor switch the trigger
-- off, and inside the migrator-owned definer functions (moderation_apply, and the erasure of a later migration) it is the
-- migrator. The update trigger fires only for a statement that names one of the three columns and really changes one, so
-- the counter updates of likes, reposts, replies and quotes never meet it.
CREATE FUNCTION "public"."posts_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_user <> 'korbat_migrate' AND (NEW.state <> 'visible' OR NEW.moderation_level <> 'visible' OR NEW.erased_at IS NOT NULL) THEN
      RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state = 'deleted_by_author' AND NEW.state <> 'deleted_by_author' THEN
    RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
  END IF;
  IF current_user <> 'korbat_migrate' AND ((NEW.state IS DISTINCT FROM OLD.state AND NEW.state <> 'deleted_by_author')
      OR NEW.moderation_level IS DISTINCT FROM OLD.moderation_level OR NEW.erased_at IS DISTINCT FROM OLD.erased_at) THEN
    RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."posts_guard"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "posts_guard_insert" BEFORE INSERT ON "public"."posts" FOR EACH ROW EXECUTE FUNCTION "public"."posts_guard"();--> statement-breakpoint
CREATE TRIGGER "posts_guard_update" BEFORE UPDATE OF "state", "moderation_level", "erased_at" ON "public"."posts" FOR EACH ROW
  WHEN (OLD."state" IS DISTINCT FROM NEW."state" OR OLD."moderation_level" IS DISTINCT FROM NEW."moderation_level" OR OLD."erased_at" IS DISTINCT FROM NEW."erased_at")
  EXECUTE FUNCTION "public"."posts_guard"();--> statement-breakpoint
-- A decision is checked and completed before it is stored. Whatever the insert supplied, the database sets when and in
-- which transaction it was decided, its public id, the first item it answers, its source, that nothing was automated and
-- that it applies everywhere, whether it rests on a suspect item, whether nobody could open the post's images when it was
-- taken, whether it needed an admin, whether it ended something done while deciding, and whether its author is told. It
-- runs as its owner (the API role cannot lock a case or read the auth schema). In this order:
--   1. The case, FOR UPDATE until the commit: two decisions of one case run one after the other, and no item attaches
--      meanwhile. The decision names the version of the case its moderator saw and is refused (case_changed) when another
--      decision landed since.
--   2. The kind and its outcomes. An interim decision restricts, on an open case. A final one restricts or finds no
--      breach, on an open case, and answers the items from the first unanswered one through through_seq, which must lie in
--      that range (case_changed otherwise: the items moved). A correction reverses, in part or in full, a restricting
--      interim or final decision of the same case, carries that decision's category and rules version and has a reason. A
--      review is refused until the migration that brings appeals replaces this function. Anything else is invalid_decision.
--   3. The snapshot belongs to the case, is not erased and has the digest the decision names.
--   4. Each text the decision names by its digest is a saved, unconfirmed, unerased text of this case by the deciding
--      account, of the matching kind.
--   5. The parties: the case's subject and the signed-in reporters of the items the decision considers. A deciding account
--      that is one of them, or close to one through a linked personal account, is refused (staff_recused).
--   6. The role and the suspicion. The deciding account's row and then the subject's are taken FOR SHARE, so a demotion or
--      a promotion either waits for the commit or is read here. suspect, unseen and needs_admin are forced. A final
--      decision that answers a suspect item answers every unanswered suspect item of its case (case_changed when one lies
--      beyond its range), so none is left behind and a seal taken while deciding never ends while one is unanswered. A
--      decision under R2 rests on a suspect item. Only an admin takes a decision that needs one (admin_required); an
--      interim decision never does, so whoever is on duty can seal reported images or withhold a threat at once.
--   7. The caps, under an advisory lock of the deciding account held until the commit, so one person's decisions are
--      counted one at a time: no more decisions in the last hour or day than moderation_limits allows (decision_cap).
--   8. The ground: "illegal", and the outcome "illegality not evident", each need a considered item that alleges
--      illegality.
--   9. The source, from the considered items: a notice, a report, or the moderator's own finding.
--  10. Telling. A final decision that closes its case while a measure taken while deciding, of which the author was told,
--      is in force ends that measure, and says so. The author is told of an interim decision (unless the target is
--      deleted, since such a measure can never take effect), of a final restriction, of a correction of a decision they
--      were told of, and of every decision that ends something they were told of; of nothing else.
CREATE FUNCTION "public"."decisions_record"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c public.cases;
  corrected public.decisions;
  snapshot public.evidence_snapshots;
  subject uuid;
  reporters uuid[];
  considers_suspect boolean;
  considers_illegal boolean;
  considers_r5 boolean;
  from_notice boolean;
  from_user boolean;
  decider_role text;
  frozen boolean;
  per_hour integer;
  per_day integer;
  in_hour integer;
  in_day integer;
  reason_kind public.staff_text_kind;
  ends_interim boolean := false;
  target_deleted boolean;
BEGIN
  NEW.decided_at := now();
  NEW.xact := pg_current_xact_id();
  NEW.puid := replace(gen_random_uuid()::text, '-', '');
  NEW.informed_at := NEW.decided_at;
  NEW.answers_from_seq := NULL;
  NEW.automated_detection := false;
  NEW.automated_decision := 'not_automated';
  NEW.territorial_scope := 'worldwide';
  NEW.author_mail_at := NULL;
  -- Only the erasure of a later migration marks a decision redacted.
  NEW.redacted_at := NULL;

  -- 1.
  SELECT k.* INTO c FROM public.cases k WHERE k.id = NEW.case_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a decision names a case that does not exist' USING ERRCODE = '23503';
  END IF;
  IF c.state_version IS DISTINCT FROM NEW.seen_state_version THEN
    RAISE EXCEPTION 'case_changed';
  END IF;

  -- 2.
  IF NEW.kind = 'interim' THEN
    IF NEW.outcome <> 'restricted' OR c.closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'An interim decision restricts, on an open case.';
    END IF;
  ELSIF NEW.kind = 'final' THEN
    IF NEW.outcome NOT IN ('restricted', 'no_violation', 'not_evident') OR c.closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A final decision restricts or finds no breach, on an open case.';
    END IF;
    IF NOT (c.answered_seq < NEW.through_seq AND NEW.through_seq <= c.intake_seq) THEN
      RAISE EXCEPTION 'case_changed';
    END IF;
    NEW.answers_from_seq := c.answered_seq + 1;
  ELSIF NEW.kind = 'correction' THEN
    SELECT d.* INTO corrected FROM public.decisions d
     WHERE d.id = NEW.reviews_decision_id AND d.case_id = NEW.case_id AND d.kind IN ('interim', 'final') AND d.outcome = 'restricted';
    IF NOT FOUND OR NEW.outcome NOT IN ('partly_reversed', 'reversed') OR NEW.category <> corrected.category
       OR NEW.rules_version <> corrected.rules_version OR NEW.reason_digest IS NULL THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A correction reverses a restricting decision of its case, with that decision''s category and rules version and a reason.';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A review waits for the migration that brings appeals.';
  END IF;

  -- 3.
  SELECT s.* INTO snapshot FROM public.evidence_snapshots s WHERE s.id = NEW.snapshot_id;
  IF NOT FOUND OR snapshot.case_id <> NEW.case_id THEN
    RAISE EXCEPTION 'snapshot_mismatch';
  END IF;
  IF snapshot.erased_at IS NOT NULL THEN
    RAISE EXCEPTION 'snapshot_erased';
  END IF;
  IF snapshot.digest IS DISTINCT FROM NEW.snapshot_digest THEN
    RAISE EXCEPTION 'snapshot_mismatch';
  END IF;

  -- 4. A read: decisions_apply confirms the texts, and refuses when one is gone by then.
  reason_kind := CASE WHEN NEW.kind IN ('review', 'correction') THEN 'review_reason' ELSE 'reason' END;
  IF (NEW.facts_digest IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.staff_texts t WHERE t.digest = NEW.facts_digest AND t.case_id = NEW.case_id AND t.author_id = NEW.decided_by
           AND t.kind = 'facts' AND t.confirmed_at IS NULL AND t.erased_at IS NULL))
     OR (NEW.reason_digest IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.staff_texts t WHERE t.digest = NEW.reason_digest AND t.case_id = NEW.case_id AND t.author_id = NEW.decided_by
           AND t.kind = reason_kind AND t.confirmed_at IS NULL AND t.erased_at IS NULL))
     OR (NEW.legal_reference_digest IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.staff_texts t WHERE t.digest = NEW.legal_reference_digest AND t.case_id = NEW.case_id AND t.author_id = NEW.decided_by
           AND t.kind = 'legal_reference' AND t.confirmed_at IS NULL AND t.erased_at IS NULL)) THEN
    RAISE EXCEPTION 'text_not_found';
  END IF;

  -- 5. What the decision considers: a final decision the items it answers, an interim one every unanswered item, a
  -- correction the items its corrected decision answered (for a corrected interim decision, every unanswered item). One
  -- statement after the case's lock reads every fact the steps below need of them.
  IF c.target_type = 'post' THEN
    SELECT p.author_id INTO subject FROM public.posts p WHERE p.id = c.target_id;
  ELSE
    subject := c.target_id;
  END IF;
  SELECT coalesce(array_agg(DISTINCT i.reporter_account_id) FILTER (WHERE i.reporter_account_id IS NOT NULL), '{}'::uuid[]),
         coalesce(bool_or(i.suspect), false),
         coalesce(bool_or(i.alleges_illegal), false),
         coalesce(bool_or(n.rule_id = 'R5'), false),
         coalesce(bool_or(n.kind = 'user' AND i.alleges_illegal), false),
         coalesce(bool_or(n.kind = 'user'), false)
    INTO reporters, considers_suspect, considers_illegal, considers_r5, from_notice, from_user
    FROM public.intake_items i JOIN public.intakes n ON n.id = i.intake_id
   WHERE i.case_id = NEW.case_id
     AND CASE WHEN NEW.kind = 'final' THEN i.seq BETWEEN NEW.answers_from_seq AND NEW.through_seq
              WHEN NEW.kind = 'correction' AND corrected.kind = 'final' THEN i.answered_by = corrected.id
              ELSE i.answered_by IS NULL END;
  IF public.staff_party_conflict(NEW.decided_by, array_remove(ARRAY[subject], NULL) || reporters, CASE WHEN c.target_type = 'post' THEN c.target_id END) THEN
    RAISE EXCEPTION 'staff_recused';
  END IF;

  -- 6.
  SELECT u.role::text INTO decider_role FROM auth.users u WHERE u.id = NEW.decided_by FOR SHARE;
  PERFORM public.account_is_staff(subject);
  NEW.suspect := CASE WHEN NEW.kind = 'correction' THEN corrected.suspect ELSE considers_suspect END;
  NEW.unseen := false;
  IF NEW.kind = 'final' AND c.target_type = 'post' THEN
    -- Read now, before decisions_apply answers anything: frozen through a suspect item of this case, through the author's
    -- account's case, or through a seal in force.
    SELECT public.post_frozen(c.target_id) INTO frozen;
    NEW.unseen := coalesce(frozen, false);
  END IF;
  IF NEW.kind = 'final' AND NEW.suspect AND EXISTS (
       SELECT 1 FROM public.intake_items i WHERE i.case_id = NEW.case_id AND i.suspect AND i.answered_by IS NULL AND i.seq > NEW.through_seq) THEN
    RAISE EXCEPTION 'case_changed';
  END IF;
  IF NEW.rule_id IS NOT DISTINCT FROM 'R2' AND NOT NEW.suspect THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A decision under R2 rests on a suspect item: a finding citing R2 is opened first.';
  END IF;
  NEW.needs_admin := CASE NEW.kind
                       WHEN 'final' THEN NEW.suspect OR considers_r5 OR coalesce(NEW.rule_id IN ('R2', 'R5'), false)
                       WHEN 'correction' THEN corrected.needs_admin
                       ELSE false END;
  IF NEW.needs_admin AND decider_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  -- 7. A one-bigint key: the social module's pair locks use the two-key space, so the two never meet.
  PERFORM pg_advisory_xact_lock(hashtextextended('korbat.decision_cap:' || NEW.decided_by::text, 0));
  SELECT l.decisions_per_hour, l.decisions_per_day INTO per_hour, per_day FROM public.moderation_limits l WHERE l.id = 1;
  SELECT count(*) FILTER (WHERE d.decided_at > now() - interval '1 hour'), count(*) INTO in_hour, in_day
    FROM public.decisions d WHERE d.decided_by = NEW.decided_by AND d.decided_at > now() - interval '1 day';
  IF in_hour >= coalesce(per_hour, 60) OR in_day >= coalesce(per_day, 300) THEN
    RAISE EXCEPTION 'decision_cap';
  END IF;

  -- 8.
  IF (NEW.ground IS NOT DISTINCT FROM 'illegal' OR NEW.outcome = 'not_evident') AND NOT considers_illegal THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'The ground of the law, and "illegality not evident", need a considered item that alleges illegality.';
  END IF;

  -- 9.
  NEW.source := CASE WHEN NEW.kind = 'correction' THEN corrected.source
                     WHEN from_notice THEN 'notice'::public.decision_source
                     WHEN from_user THEN 'report'::public.decision_source
                     ELSE 'own_initiative'::public.decision_source END;

  -- 10. Both reads come after the case's lock and after the subject's profile lock, which the deciding transaction takes
  -- first and the author's deletion and the purge take too, so the target cannot be deleted before the commit.
  IF NEW.kind = 'final' AND NEW.through_seq = c.intake_seq THEN
    SELECT EXISTS (SELECT 1 FROM public.measures_in_force m JOIN public.decisions d ON d.id = m.decision_id
                    WHERE m.case_id = NEW.case_id AND m.decision_kind = 'interim' AND m.kind <> 'seal_media' AND d.author_mail <> 'none')
      INTO ends_interim;
  END IF;
  NEW.ended_interim := ends_interim;
  IF c.target_type = 'post' THEN
    SELECT p.state = 'deleted_by_author' INTO target_deleted FROM public.posts p WHERE p.id = c.target_id;
  ELSE
    SELECT p.deleted_at IS NOT NULL INTO target_deleted FROM public.profiles p WHERE p.id = c.target_id;
  END IF;
  NEW.author_mail := CASE
                       WHEN NEW.ended_interim THEN 'pending'
                       WHEN NEW.kind = 'interim' AND NOT coalesce(target_deleted, false) THEN 'pending'
                       WHEN NEW.kind = 'final' AND NEW.outcome = 'restricted' THEN 'pending'
                       WHEN NEW.kind = 'correction' AND corrected.author_mail <> 'none' THEN 'pending'
                       ELSE 'none' END::public.delivery_state;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."decisions_record"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "decisions_record" BEFORE INSERT ON "public"."decisions" FOR EACH ROW EXECUTE FUNCTION "public"."decisions_record"();--> statement-breakpoint
-- What a stored decision does to its case, before any of its measures exists (they are inserted after it, and their own
-- triggers do the rest). A final decision answers its items: a restriction on the law as restricted_legal, on a rule as
-- restricted_rule; "illegality not evident" as that on an item that alleged illegality and as no_violation on any other;
-- "no breach" as no_violation. Every decision moves the case's version. A final one moves answered_seq, recomputes the
-- lane and the oldest open time from the items still unanswered, closes the case when none is left, and for a post case
-- it closed derives the post's level again, so that what was done while deciding ends. One place decides that a seal taken
-- while deciding has ended: this trigger reads the case's such seals in force before it answers the items and again
-- after, derives the image states of every post an ended seal listed, and, when the author was told of one of them, marks
-- the decision as ending it and tells them. Last, it confirms the decision's texts, and refuses (text_not_found) unless it
-- confirmed one text for each digest the decision names: a sweep that deleted a text since decisions_record read it would
-- otherwise leave the decision naming nothing.
CREATE FUNCTION "public"."decisions_apply"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c public.cases;
  seals_before uuid[];
  ended uuid[];
  listed uuid[];
  open_items integer;
  open_lane smallint;
  oldest timestamptz;
  digests text[];
  confirmed integer;
BEGIN
  IF NEW.kind = 'final' THEN
    SELECT coalesce(array_agg(m.id), '{}'::uuid[]) INTO seals_before
      FROM public.measures_in_force m WHERE m.case_id = NEW.case_id AND m.kind = 'seal_media' AND m.decision_kind = 'interim';
    UPDATE public.intake_items i
       SET answered_by = NEW.id,
           outcome = CASE NEW.outcome
                       WHEN 'restricted' THEN CASE WHEN NEW.ground = 'illegal' THEN 'restricted_legal' ELSE 'restricted_rule' END
                       WHEN 'not_evident' THEN CASE WHEN i.alleges_illegal THEN 'not_evident' ELSE 'no_violation' END
                       ELSE 'no_violation' END::public.item_outcome
     WHERE i.case_id = NEW.case_id AND i.seq BETWEEN NEW.answers_from_seq AND NEW.through_seq AND i.answered_by IS NULL;
    SELECT count(*), min(i.lane), min(i.created_at) INTO open_items, open_lane, oldest
      FROM public.intake_items i WHERE i.case_id = NEW.case_id AND i.answered_by IS NULL;
    UPDATE public.cases k
       SET state_version = k.state_version + 1,
           last_decided_at = now(),
           answered_seq = NEW.through_seq,
           lane = coalesce(open_lane, 2),
           oldest_open_at = oldest,
           closed_at = CASE WHEN open_items = 0 THEN now() END
     WHERE k.id = NEW.case_id
    RETURNING k.* INTO c;
    IF c.closed_at IS NOT NULL AND c.target_type = 'post' THEN
      PERFORM public.moderation_apply(ARRAY[c.target_id], true);
    END IF;
    SELECT coalesce(array_agg(s.id), '{}'::uuid[]) INTO ended
      FROM unnest(seals_before) AS s(id) WHERE NOT EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.id = s.id);
    IF cardinality(ended) > 0 THEN
      SELECT array_agg(DISTINCT s.post_id) INTO listed FROM public.seal_posts s WHERE s.action_id = ANY(ended);
      PERFORM public.moderation_apply(listed, false);
      IF EXISTS (SELECT 1 FROM public.decision_actions a JOIN public.decisions d ON d.id = a.decision_id WHERE a.id = ANY(ended) AND d.author_mail <> 'none') THEN
        UPDATE public.decisions d
           SET ended_interim = true, author_mail = CASE WHEN d.author_mail = 'none' THEN 'pending'::public.delivery_state ELSE d.author_mail END
         WHERE d.id = NEW.id;
      END IF;
    END IF;
  ELSE
    UPDATE public.cases k SET state_version = k.state_version + 1, last_decided_at = now() WHERE k.id = NEW.case_id;
  END IF;

  digests := array_remove(ARRAY[NEW.facts_digest, NEW.reason_digest, NEW.legal_reference_digest], NULL);
  IF cardinality(digests) > 0 THEN
    UPDATE public.staff_texts t SET decision_id = NEW.id, confirmed_at = now()
     WHERE t.digest = ANY(digests) AND t.confirmed_at IS NULL AND t.erased_at IS NULL;
    GET DIAGNOSTICS confirmed = ROW_COUNT;
    IF confirmed <> cardinality(digests) THEN
      RAISE EXCEPTION 'text_not_found';
    END IF;
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."decisions_apply"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "decisions_apply" AFTER INSERT ON "public"."decisions" FOR EACH ROW EXECUTE FUNCTION "public"."decisions_apply"();--> statement-breakpoint
-- A measure or a reversal is checked and completed before it joins the ledger. In this order:
--   1. Its decision was inserted by this transaction: the stored transaction id and the decision's time are compared
--      together, a pair a logical restore cannot reproduce (it restarts the counter while rows keep their stamps). So a
--      row is added to the ledger only with its own confirmed decision.
--   2. The columns the API must not choose are cleared and forced: the subject, the post, the measure a reversal lifts,
--      whether the measure changed anything, and the time; a seal and its lifting name no image.
--   3. Fit. Post and image kinds only on a post case, field kinds only on an account case. An interim decision withholds
--      (the post or one image) or resets a field; a final one removes or resets; either may seal the images its case
--      reaches, and either may lift the case's interim withhold of the post or of an image. A correction or a review holds
--      reversals only, and only one of them lifts a seal. A decision holds at most one post measure. An image measure
--      names an image of the post; no other kind names one.
--   4. On a post case the post is locked FOR UPDATE, the lock moderation_apply takes after the insert, taken earlier in
--      the same order; what follows is read in statements of their own.
--   5. A second interim withhold of the post, or of the same image, while one is in force in the case is refused. A second
--      interim reset is not: its author may set the field again at any time, so whoever is on duty can reset it again.
--   6. A reversal names exactly one measure: for a correction or a review the measure of the matching kind and image held
--      by the reviewed decision; for an interim or final decision the case's interim withhold of that kind and image in
--      force. That measure must be in force. There is never a choice among several, and no search for "the newest".
--   7. A seal needs a decision that rests on a suspect item and is under R2 or in the category Protection of minors. It
--      is not refused because a seal of the case is already in force: each seal has its own list, which on an account's
--      case is how images posted since are covered.
--   8. No measure of a decision that is not interim restricts a staff account (staff_target): staff are disciplined by
--      demotion, while an interim measure applies to them as to anyone.
--   9. Lifting a seal needs an admin, whatever the decision's kind, and marks the decision as needing one.
--  10. Whether the measure changes anything now: "deleted" when the post or the account is deleted; "already" when the
--      post's level already is at least the measure's, when an image's post is not visible or the image's own state already
--      is at least the measure's, or when the field already holds its placeholder; else null. A seal's is set by
--      decision_actions_apply, once it has made the seal's list.
--  11. A reversal of an interim measure of which the author was told marks the decision as ending it and tells them.
CREATE FUNCTION "public"."decision_actions_check"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d public.decisions;
  c public.cases;
  subject uuid;
  is_measure boolean;
  lifted public.action_kind[];
  target uuid;
  target_decision public.decisions;
  decider_role text;
  post_state public.post_state;
  post_level public.moderation_level;
  image_state public.media_moderation_state;
  profile public.profiles;
BEGIN
  -- 1.
  SELECT x.* INTO d FROM public.decisions x WHERE x.id = NEW.decision_id;
  IF NOT FOUND OR d.xact IS DISTINCT FROM pg_current_xact_id() OR d.decided_at IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A measure or a reversal is added only in the transaction of its own decision.';
  END IF;
  SELECT k.* INTO c FROM public.cases k WHERE k.id = d.case_id;

  -- 2.
  NEW.subject_account_id := NULL;
  NEW.post_id := NULL;
  NEW.reverses_action_id := NULL;
  NEW.no_effect := NULL;
  NEW.created_at := now();
  IF NEW.kind IN ('seal_media', 'unseal_media') THEN
    NEW.media_id := NULL;
  END IF;
  IF c.target_type = 'post' THEN
    SELECT p.author_id INTO subject FROM public.posts p WHERE p.id = c.target_id;
  ELSE
    subject := c.target_id;
  END IF;
  IF subject IS NULL THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'The case''s target does not exist.';
  END IF;
  NEW.subject_account_id := subject;
  IF NEW.kind IN ('withhold', 'remove', 'restore', 'withhold_media', 'remove_media', 'restore_media') THEN
    NEW.post_id := c.target_id;
  END IF;
  is_measure := NEW.kind IN ('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio');

  -- 3.
  IF (NEW.post_id IS NOT NULL AND c.target_type <> 'post')
     OR (NEW.kind IN ('reset_display_name', 'reset_bio', 'restore_display_name', 'restore_bio') AND c.target_type <> 'account') THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'Post and image measures belong to a post case, field measures to an account case.';
  END IF;
  IF NOT (CASE d.kind
            WHEN 'interim' THEN NEW.kind IN ('withhold', 'withhold_media', 'reset_display_name', 'reset_bio', 'seal_media', 'restore', 'restore_media')
            WHEN 'final' THEN NEW.kind IN ('remove', 'remove_media', 'reset_display_name', 'reset_bio', 'seal_media', 'restore', 'restore_media')
            ELSE NOT is_measure END) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A decision of this kind does not hold this measure or reversal.';
  END IF;
  IF NEW.kind IN ('withhold', 'remove') AND EXISTS (
       SELECT 1 FROM public.decision_actions x WHERE x.decision_id = d.id AND x.kind IN ('withhold', 'remove')) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A decision holds at most one post measure.';
  END IF;
  IF NEW.kind IN ('withhold_media', 'remove_media', 'restore_media') THEN
    IF NEW.media_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.post_media m WHERE m.id = NEW.media_id AND m.post_id = c.target_id) THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'An image measure names an image of the case''s post.';
    END IF;
  ELSIF NEW.media_id IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'Only an image measure names an image.';
  END IF;

  -- 4.
  IF c.target_type = 'post' THEN
    PERFORM 1 FROM public.posts p WHERE p.id = c.target_id FOR UPDATE;
  END IF;

  -- 5.
  IF d.kind = 'interim' AND NEW.kind IN ('withhold', 'withhold_media') AND EXISTS (
       SELECT 1 FROM public.measures_in_force m
        WHERE m.case_id = c.id AND m.decision_kind = 'interim' AND m.kind = NEW.kind AND m.media_id IS NOT DISTINCT FROM NEW.media_id) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'The case already holds this interim measure in force.';
  END IF;

  -- 6.
  IF NOT is_measure THEN
    lifted := CASE NEW.kind
                WHEN 'restore' THEN ARRAY['withhold', 'remove']
                WHEN 'unseal_media' THEN ARRAY['seal_media']
                WHEN 'restore_media' THEN ARRAY['withhold_media', 'remove_media']
                WHEN 'restore_display_name' THEN ARRAY['reset_display_name']
                ELSE ARRAY['reset_bio'] END::public.action_kind[];
    IF d.kind IN ('review', 'correction') THEN
      SELECT a.id INTO target FROM public.decision_actions a
       WHERE a.decision_id = d.reviews_decision_id AND a.kind = ANY(lifted) AND a.media_id IS NOT DISTINCT FROM NEW.media_id;
    ELSE
      SELECT m.id INTO target FROM public.measures_in_force m
       WHERE m.case_id = c.id AND m.decision_kind = 'interim' AND m.media_id IS NOT DISTINCT FROM NEW.media_id
         AND m.kind = CASE NEW.kind WHEN 'restore' THEN 'withhold' ELSE 'withhold_media' END::public.action_kind;
    END IF;
    IF target IS NULL OR NOT EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.id = target) THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A reversal lifts a measure that is in force.';
    END IF;
    NEW.reverses_action_id := target;
  END IF;

  -- 7.
  IF NEW.kind = 'seal_media' AND NOT (d.suspect AND (d.rule_id IS NOT DISTINCT FROM 'R2' OR d.category = 'STATEMENT_CATEGORY_PROTECTION_OF_MINORS')) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A seal needs a decision that rests on a suspect item, under R2 or in the category Protection of minors.';
  END IF;

  -- 8. The subject's row is held FOR SHARE since decisions_record, so the lock order holds.
  IF is_measure AND public.account_is_staff(subject) AND d.kind <> 'interim' THEN
    RAISE EXCEPTION 'staff_target';
  END IF;

  -- 9. The deciding account's row is held FOR SHARE since decisions_record; this reads the same row again.
  IF NEW.kind = 'unseal_media' THEN
    UPDATE public.decisions x SET needs_admin = true WHERE x.id = d.id;
    SELECT u.role::text INTO decider_role FROM auth.users u WHERE u.id = d.decided_by FOR SHARE;
    IF decider_role IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'admin_required';
    END IF;
  END IF;

  -- 10.
  IF is_measure AND NEW.kind <> 'seal_media' THEN
    IF c.target_type = 'post' THEN
      SELECT p.state, p.moderation_level INTO post_state, post_level FROM public.posts p WHERE p.id = c.target_id;
      IF post_state = 'deleted_by_author' THEN
        NEW.no_effect := 'deleted';
      ELSIF NEW.kind = 'withhold' THEN
        NEW.no_effect := CASE WHEN post_level <> 'visible' THEN 'already' END;
      ELSIF NEW.kind = 'remove' THEN
        NEW.no_effect := CASE WHEN post_level = 'removed' THEN 'already' END;
      ELSE
        SELECT m.moderation_state INTO image_state FROM public.post_media m WHERE m.id = NEW.media_id;
        NEW.no_effect := CASE WHEN post_level <> 'visible'
                                OR (NEW.kind = 'withhold_media' AND image_state <> 'visible')
                                OR (NEW.kind = 'remove_media' AND image_state IN ('removed', 'sealed')) THEN 'already' END;
      END IF;
    ELSE
      SELECT p.* INTO profile FROM public.profiles p WHERE p.id = subject;
      IF profile.deleted_at IS NOT NULL THEN
        NEW.no_effect := 'deleted';
      ELSIF (NEW.kind = 'reset_display_name' AND profile.display_name = profile.handle) OR (NEW.kind = 'reset_bio' AND profile.bio = '') THEN
        NEW.no_effect := 'already';
      END IF;
    END IF;
  END IF;

  -- 11.
  IF target IS NOT NULL THEN
    SELECT x.* INTO target_decision FROM public.decisions x JOIN public.decision_actions a ON a.decision_id = x.id WHERE a.id = target;
    IF target_decision.kind = 'interim' AND target_decision.author_mail <> 'none' THEN
      UPDATE public.decisions x
         SET ended_interim = true, author_mail = CASE WHEN x.author_mail = 'none' THEN 'pending'::public.delivery_state ELSE x.author_mail END
       WHERE x.id = d.id;
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."decision_actions_check"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "decision_actions_check" BEFORE INSERT ON "public"."decision_actions" FOR EACH ROW EXECUTE FUNCTION "public"."decision_actions_check"();--> statement-breakpoint
-- What a row of the ledger does once it is stored.
--   - Every post or image measure or reversal: the post's level and its images' states are derived again.
--   - A seal, in this order: (1) one statement locks the image rows the case reaches, in id order: the rows of the case's
--     post, or every row of the account that is on a post. No post is locked for it. (2) One row of seal_posts for each
--     post among the rows that statement returned, with their number; with none there is nothing to seal, and the seal is
--     refused. The list is fixed at that moment: an image posted later is not sealed by it. This function is the only
--     writer of seal_posts, so no caller chooses a seal's list. (3) Whether the seal changes anything now: "deleted" when
--     the case's target is deleted; "already" when seals in force of at least its own standing already list every post it
--     lists (for a seal taken while deciding, any seal in force; for a seal for good, seals for good only, so that the seal
--     for good that follows its case's seal taken while deciding is not told as changing nothing); else null. (4) The
--     image states of the listed posts are derived, under the image rows' locks alone.
--   - Lifting a seal: the image states of the posts the lifted seal listed are derived again.
--   - A reset of the display name or the bio that changes something: the live field must still equal the decision's
--     snapshot (profile_changed otherwise), then the display name becomes the handle as it then stands, or the bio empty.
--     A reset with no effect writes nothing, so nothing is ever written into a row the purge anonymised. Lifting a reset
--     writes nothing either: the old value stays readable on the screen of the decision that reset it.
--   - A reversal in a correction or a review of a final decision: the items that decision answered are marked, so the
--     daily release shows their senders the new outcome.
CREATE FUNCTION "public"."decision_actions_apply"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d public.decisions;
  c public.cases;
  locked uuid[];
  listed uuid[];
  target_deleted boolean;
  covered boolean;
  snapshot public.evidence_snapshots;
BEGIN
  SELECT x.* INTO d FROM public.decisions x WHERE x.id = NEW.decision_id;
  SELECT k.* INTO c FROM public.cases k WHERE k.id = d.case_id;

  IF NEW.post_id IS NOT NULL THEN
    PERFORM public.moderation_apply(ARRAY[NEW.post_id], true);
  END IF;

  IF NEW.kind = 'seal_media' THEN
    IF c.target_type = 'post' THEN
      SELECT array_agg(l.post_id) INTO locked
        FROM (SELECT m.post_id FROM public.post_media m WHERE m.post_id = c.target_id ORDER BY m.id FOR NO KEY UPDATE) l;
    ELSE
      SELECT array_agg(l.post_id) INTO locked
        FROM (SELECT m.post_id FROM public.post_media m WHERE m.owner_id = c.target_id AND m.post_id IS NOT NULL ORDER BY m.id FOR NO KEY UPDATE) l;
    END IF;
    IF locked IS NULL THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'The case reaches no image: there is nothing to seal.';
    END IF;
    INSERT INTO public.seal_posts (action_id, post_id, images)
    SELECT NEW.id, l.post_id, count(*) FROM unnest(locked) AS l(post_id) GROUP BY l.post_id;
    SELECT array_agg(s.post_id) INTO listed FROM public.seal_posts s WHERE s.action_id = NEW.id;
    IF c.target_type = 'post' THEN
      SELECT p.state = 'deleted_by_author' INTO target_deleted FROM public.posts p WHERE p.id = c.target_id;
    ELSE
      SELECT p.deleted_at IS NOT NULL INTO target_deleted FROM public.profiles p WHERE p.id = c.target_id;
    END IF;
    SELECT NOT EXISTS (
             SELECT 1 FROM public.seal_posts mine
              WHERE mine.action_id = NEW.id
                AND NOT EXISTS (SELECT 1 FROM public.seal_posts s JOIN public.measures_in_force f ON f.id = s.action_id
                                 WHERE s.post_id = mine.post_id AND s.action_id <> NEW.id AND (d.kind = 'interim' OR f.decision_kind <> 'interim')))
      INTO covered;
    UPDATE public.decision_actions a
       SET no_effect = CASE WHEN coalesce(target_deleted, false) THEN 'deleted' WHEN covered THEN 'already' END
     WHERE a.id = NEW.id;
    PERFORM public.moderation_apply(listed, false);
  ELSIF NEW.kind = 'unseal_media' THEN
    SELECT array_agg(s.post_id) INTO listed FROM public.seal_posts s WHERE s.action_id = NEW.reverses_action_id;
    PERFORM public.moderation_apply(listed, false);
  ELSIF NEW.kind IN ('reset_display_name', 'reset_bio') AND NEW.no_effect IS NULL THEN
    SELECT s.* INTO snapshot FROM public.evidence_snapshots s WHERE s.id = d.snapshot_id;
    IF NEW.kind = 'reset_display_name' THEN
      UPDATE public.profiles p SET display_name = p.handle WHERE p.id = NEW.subject_account_id AND p.display_name = snapshot.display_name;
    ELSE
      UPDATE public.profiles p SET bio = '' WHERE p.id = NEW.subject_account_id AND p.bio = snapshot.bio;
    END IF;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'profile_changed';
    END IF;
  END IF;

  IF NEW.reverses_action_id IS NOT NULL AND d.kind IN ('review', 'correction') THEN
    UPDATE public.intake_items i SET revision_pending_at = now()
     WHERE i.answered_by = d.reviews_decision_id AND EXISTS (SELECT 1 FROM public.decisions r WHERE r.id = d.reviews_decision_id AND r.kind = 'final');
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."decision_actions_apply"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "decision_actions_apply" AFTER INSERT ON "public"."decision_actions" FOR EACH ROW EXECUTE FUNCTION "public"."decision_actions_apply"();--> statement-breakpoint
-- What cannot stand is refused at commit. Two deferred constraint triggers run after the transaction's last statement,
-- while the audit head is still held: one for the decision's row and one for each row of its ledger, and each runs the
-- same check of the decision, public.decision_holds. A caller can only make them run earlier (SET CONSTRAINTS ...
-- IMMEDIATE), never skip them: a ledger row inserted after an early check queues the check again, so no measure and no
-- reversal commits that the audit row's params do not list. The check requires:
--   (a) the audit link. The newest audit row, which this transaction wrote last, names this decision in its metadata,
--       carries a step-up, and was written by the deciding account, as case_decided on this case (appeals_reviewed on the
--       reviewed decision for a review). Its params, without their list of actions, equal the decision's own columns
--       under the contracts' member names, and its list of actions equals the decision's ledger rows as a set. So what a
--       staff key confirmed is exactly what was stored, and a decision without its audit row never commits.
--   (b) the outcome and the ledger agree. A restriction holds at least one measure; "no breach" holds none (it may lift
--       the case's interim withholds); "kept" holds nothing; "reversed" holds a reversal and leaves no measure of the
--       reviewed decision in force; "partly reversed" holds a reversal and leaves at least one in force.
-- Each refusal is invalid_decision with a detail naming the member or the rule. It reads only, so an audit row stays the
-- last statement that writes in its transaction. Nobody may call it: the two trigger functions below do, as its owner.
CREATE FUNCTION "public"."decision_holds"(decision uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d public.decisions;
  a public.audit_log;
  params jsonb;
  expected jsonb;
  recorded jsonb;
  held jsonb;
  differing text;
  measures integer;
  reversals integer;
  in_force integer;
BEGIN
  -- The row as it stands now: later triggers of its transaction may have marked it since its insert.
  SELECT x.* INTO d FROM public.decisions x WHERE x.id = decision_holds.decision;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT l.* INTO a FROM public.audit_head h JOIN public.audit_log l ON l.chain_seq = h.seq WHERE h.id = 1;
  IF NOT FOUND OR a.metadata ->> 'decisionId' IS DISTINCT FROM d.id::text THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'decisionId: the transaction''s last audit row does not name this decision.';
  END IF;
  IF a.step_up IS NULL THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'stepUp: the audit row carries no confirmation.';
  END IF;
  IF a.actor_id IS DISTINCT FROM d.decided_by THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'actor: the audit row was written by another account than the decision''s.';
  END IF;
  IF d.kind = 'review' THEN
    IF a.action IS DISTINCT FROM 'appeals_reviewed' OR a.target_type IS DISTINCT FROM 'decision' OR a.target_id IS DISTINCT FROM d.reviews_decision_id::text THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'target: the audit row is not appeals_reviewed on the reviewed decision.';
    END IF;
    expected := jsonb_build_object('stateVersion', d.seen_state_version, 'appealId', d.appeal_id, 'snapshotId', d.snapshot_id,
      'snapshotDigest', d.snapshot_digest, 'outcome', d.outcome, 'rulesVersion', d.rules_version, 'redressVersion', d.redress_version,
      'category', d.category, 'reasonDigest', d.reason_digest);
  ELSE
    IF a.action IS DISTINCT FROM 'case_decided' OR a.target_type IS DISTINCT FROM 'case' OR a.target_id IS DISTINCT FROM d.case_id::text THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'target: the audit row is not case_decided on the decision''s case.';
    END IF;
    expected := jsonb_build_object('kind', d.kind, 'stateVersion', d.seen_state_version, 'throughSeq', d.through_seq,
      'reviewsDecisionId', d.reviews_decision_id, 'snapshotId', d.snapshot_id, 'snapshotDigest', d.snapshot_digest, 'outcome', d.outcome,
      'ground', d.ground, 'ruleId', d.rule_id, 'rulesVersion', d.rules_version, 'redressVersion', d.redress_version, 'category', d.category,
      'categoryKeyword', d.category_keyword, 'factsDigest', d.facts_digest, 'reasonDigest', d.reason_digest,
      'legalReferenceDigest', d.legal_reference_digest);
  END IF;
  params := a.metadata -> 'params';
  IF params IS NULL OR jsonb_typeof(params) <> 'object' THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'params: the audit row carries none.';
  END IF;
  IF (params - 'actions') IS DISTINCT FROM expected THEN
    SELECT string_agg(x.key, ', ' ORDER BY x.key) INTO differing
      FROM (SELECT coalesce(e.key, p.key) AS key
              FROM jsonb_each(expected) e FULL JOIN jsonb_each(params - 'actions') p ON p.key = e.key
             WHERE e.value IS DISTINCT FROM p.value) x;
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = format('params: %s differ from the decision.', differing);
  END IF;
  recorded := params -> 'actions';
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'mediaId', x.media_id)), '[]'::jsonb),
         count(*) FILTER (WHERE x.kind IN ('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio')),
         count(*) FILTER (WHERE x.kind NOT IN ('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio'))
    INTO held, measures, reversals
    FROM public.decision_actions x WHERE x.decision_id = d.id;
  IF recorded IS NULL OR jsonb_typeof(recorded) <> 'array' THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'actions: the audit row''s params list none.';
  END IF;
  IF NOT ((held) @> (recorded) AND (recorded) @> (held)) OR jsonb_array_length(held) <> jsonb_array_length(recorded) THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'actions: the decision''s measures and reversals are not those the audit row''s params list.';
  END IF;

  IF d.outcome = 'restricted' AND measures = 0 THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'restricted: a restriction holds at least one measure.';
  END IF;
  IF d.outcome IN ('no_violation', 'not_evident') AND measures > 0 THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'no action: a decision that finds no breach holds no measure.';
  END IF;
  IF d.outcome = 'kept' AND measures + reversals > 0 THEN
    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'kept: a review that keeps the decision holds no measure and no reversal.';
  END IF;
  IF d.outcome IN ('reversed', 'partly_reversed') THEN
    IF reversals = 0 THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'reversed: a reversing decision holds at least one reversal.';
    END IF;
    SELECT count(*) INTO in_force FROM public.measures_in_force m WHERE m.decision_id = d.reviews_decision_id;
    IF d.outcome = 'reversed' AND in_force > 0 THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'reversed: a measure of the reviewed decision is still in force.';
    END IF;
    IF d.outcome = 'partly_reversed' AND in_force = 0 THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'partly_reversed: no measure of the reviewed decision is left in force.';
    END IF;
  END IF;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."decision_holds"(uuid) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION "public"."decisions_check"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.decision_holds(NEW.id);
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."decisions_check"() FROM PUBLIC;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "decisions_check" AFTER INSERT ON "public"."decisions" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."decisions_check"();--> statement-breakpoint
-- The same check, queued by every row of the ledger. A deferred trigger that has run is not queued again by itself, so
-- without this one a transaction could make the decision's check run early and add a measure afterwards.
CREATE FUNCTION "public"."decision_actions_recheck"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.decision_holds(NEW.decision_id);
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."decision_actions_recheck"() FROM PUBLIC;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "decision_actions_recheck" AFTER INSERT ON "public"."decision_actions" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."decision_actions_recheck"();--> statement-breakpoint
-- The audit row of an action a staff key confirmed on the API's role, as the last statement of that action's transaction.
-- It runs as its owner, so it can read the auth schema, on which the API role holds nothing. It writes only the three
-- actions of moderation cases, and only with a key, a session, an action hash, a step-up and the challenge's expiry. It
-- takes the acting account's row FOR SHARE and then, in a second statement, the key's row FOR SHARE, and refuses
-- (staff_confirmation_ended) unless the account is live staff and the key is its own and live: a revocation, a demotion
-- or a take-down either committed before, and is read here, or waits for this commit, in either order. (FOR KEY SHARE
-- would let a decision commit after its key was revoked; the key before the account deadlocks with a revocation.) For a
-- reveal it confirms the reason text the params name (text_not_found when there is none to confirm). Then it writes the
-- row, and refuses (staff_confirmation_late) when the row joined the chain at or after the challenge's expiry, which
-- rolls the whole transaction back: audit-verify refuses such a row for good. It answers the row's place in the chain.
CREATE FUNCTION "public"."append_confirmed_audit"(actor_id uuid, key_id uuid, action text, target_type text, target_id text, metadata jsonb, staff_session uuid, action_hash text, step_up jsonb, request_id text, expires_ms bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  place bigint;
  stamped timestamptz;
BEGIN
  IF append_confirmed_audit.action IS NULL OR append_confirmed_audit.action NOT IN ('case_decided', 'appeals_reviewed', 'identity_revealed') THEN
    RAISE EXCEPTION '%', format('append_confirmed_audit does not write the action %L', append_confirmed_audit.action);
  END IF;
  IF append_confirmed_audit.actor_id IS NULL OR append_confirmed_audit.key_id IS NULL OR append_confirmed_audit.staff_session IS NULL
     OR append_confirmed_audit.action_hash IS NULL OR append_confirmed_audit.step_up IS NULL OR append_confirmed_audit.expires_ms IS NULL THEN
    RAISE EXCEPTION 'append_confirmed_audit needs an actor, a key, a staff session, an action hash, a step-up and an expiry';
  END IF;
  PERFORM 1 FROM auth.users u WHERE u.id = append_confirmed_audit.actor_id AND u.deleted_at IS NULL AND u.role <> 'user' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_confirmation_ended';
  END IF;
  PERFORM 1 FROM auth.staff_keys k
    WHERE k.id = append_confirmed_audit.key_id AND k.user_id = append_confirmed_audit.actor_id AND k.revoked_at IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_confirmation_ended';
  END IF;
  IF append_confirmed_audit.action = 'identity_revealed' THEN
    UPDATE public.staff_texts t SET confirmed_at = now()
     WHERE t.kind = 'reveal_reason' AND t.author_id = append_confirmed_audit.actor_id
       AND t.case_id = (SELECT i.case_id FROM public.intake_items i WHERE i.id::text = append_confirmed_audit.target_id)
       AND t.digest = append_confirmed_audit.metadata -> 'params' ->> 'reasonDigest'
       AND t.confirmed_at IS NULL AND t.erased_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'text_not_found';
    END IF;
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_type, target_id, metadata, staff_session, key_id, action_hash, step_up, request_id)
  VALUES (append_confirmed_audit.actor_id, append_confirmed_audit.action, append_confirmed_audit.target_type, append_confirmed_audit.target_id,
          coalesce(append_confirmed_audit.metadata, '{}'::jsonb), append_confirmed_audit.staff_session, append_confirmed_audit.key_id,
          append_confirmed_audit.action_hash, append_confirmed_audit.step_up, append_confirmed_audit.request_id)
  RETURNING chain_seq, created_at INTO place, stamped;
  IF floor(extract(epoch FROM stamped) * 1000) >= append_confirmed_audit.expires_ms THEN
    RAISE EXCEPTION 'staff_confirmation_late';
  END IF;
  RETURN place;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."append_confirmed_audit"(uuid, uuid, text, text, text, jsonb, uuid, text, jsonb, text, bigint) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."append_confirmed_audit"(uuid, uuid, text, text, text, jsonb, uuid, text, jsonb, text, bigint) TO korbat_api;--> statement-breakpoint
-- What an item's sender is shown as of a time: an item keeps the outcome its answering decision wrote, and this reads it
-- against the ledger. A restricted item reads "reversed" when every measure of its answering decision was lifted by a
-- reversal recorded before the time, "partly reversed" when some were, else as written; any other item as written.
-- Nobody may call it: release_outcomes does, as its owner.
CREATE FUNCTION "public"."item_current_outcome"(item uuid, at timestamptz) RETURNS "public"."item_outcome"
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
           WHEN i.outcome NOT IN ('restricted_rule', 'restricted_legal') THEN i.outcome
           WHEN m.measures > 0 AND m.lifted = m.measures THEN 'reversed'::public.item_outcome
           WHEN m.lifted > 0 THEN 'partly_reversed'::public.item_outcome
           ELSE i.outcome END
    FROM public.intake_items i
    LEFT JOIN LATERAL (
      SELECT count(*) AS measures,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.decision_actions r
                                             WHERE r.reverses_action_id = a.id AND r.created_at < item_current_outcome.at)) AS lifted
        FROM public.decision_actions a
       WHERE a.decision_id = i.answered_by
         AND a.kind IN ('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio')) m ON true
   WHERE i.id = item_current_outcome.item
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."item_current_outcome"(uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint
-- The daily release: the only writer of an item's release time, of what its sender is shown, and of the time a changed
-- outcome was shown, so the API supplies neither a time nor an outcome and cannot tell a notifier a false one. The
-- cut-off is not in the future. It locks its items in id order, and each write is a statement of its own after the lock:
--   (1) every item with an outcome that is not yet released and was answered before the cut-off (by its decision's time;
--       an item answered at intake, by its own) is released now, with its outcome as of the cut-off;
--   (2) every released item with a revision pending is shown its outcome as of the cut-off when that differs from what it
--       was shown, and its mail is due again unless it never had one;
--   (3) in both, the pending mark is cleared when it lies before the cut-off and kept otherwise, so a reversal made after
--       the cut-off is released at the next one.
-- It answers how many items it changed.
CREATE FUNCTION "public"."release_outcomes"(cutoff timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ids uuid[];
  released uuid[];
  revised integer;
BEGIN
  IF release_outcomes.cutoff IS NULL OR release_outcomes.cutoff > now() THEN
    RAISE EXCEPTION 'release_outcomes takes a cut-off that is not in the future' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(l.id) INTO ids
    FROM (SELECT i.id FROM public.intake_items i
           WHERE (i.outcome IS NOT NULL AND i.outcome_sent_at IS NULL
                  AND coalesce((SELECT d.decided_at FROM public.decisions d WHERE d.id = i.answered_by), i.created_at) < release_outcomes.cutoff)
              OR (i.outcome_sent_at IS NOT NULL AND i.revision_pending_at IS NOT NULL)
           ORDER BY i.id FOR UPDATE OF i) l;
  IF ids IS NULL THEN
    RETURN 0;
  END IF;
  WITH done AS (
    UPDATE public.intake_items i
       SET outcome_sent_at = now(),
           shown_outcome = public.item_current_outcome(i.id, release_outcomes.cutoff),
           revision_pending_at = CASE WHEN i.revision_pending_at < release_outcomes.cutoff THEN NULL ELSE i.revision_pending_at END
     WHERE i.id = ANY(ids) AND i.outcome IS NOT NULL AND i.outcome_sent_at IS NULL
       AND coalesce((SELECT d.decided_at FROM public.decisions d WHERE d.id = i.answered_by), i.created_at) < release_outcomes.cutoff
    RETURNING i.id)
  SELECT coalesce(array_agg(done.id), '{}'::uuid[]) INTO released FROM done;
  UPDATE public.intake_items i
     SET shown_outcome = v.current,
         revised_sent_at = CASE WHEN v.current IS DISTINCT FROM i.shown_outcome THEN now() ELSE i.revised_sent_at END,
         outcome_mail = CASE WHEN v.current IS DISTINCT FROM i.shown_outcome AND i.outcome_mail <> 'none' THEN 'pending'::public.delivery_state ELSE i.outcome_mail END,
         revision_pending_at = CASE WHEN i.revision_pending_at < release_outcomes.cutoff THEN NULL ELSE i.revision_pending_at END
    FROM (SELECT x.id, public.item_current_outcome(x.id, release_outcomes.cutoff) AS current FROM public.intake_items x WHERE x.id = ANY(ids)) v
   WHERE i.id = v.id AND NOT (i.id = ANY(released)) AND i.outcome_sent_at IS NOT NULL AND i.revision_pending_at IS NOT NULL
     AND (v.current IS DISTINCT FROM i.shown_outcome OR i.revision_pending_at < release_outcomes.cutoff);
  GET DIAGNOSTICS revised = ROW_COUNT;
  RETURN cardinality(released) + revised;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."release_outcomes"(timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."release_outcomes"(timestamptz) TO korbat_api;--> statement-breakpoint
-- A case's history in one read, without a table of its own: one row for each item attached, snapshot taken, decision,
-- appeal filed or answered, note, recorded choice not to seal, reveal of a source, erased snapshot and redaction, in the
-- order of their times. A row names its event and the row it is about (ref_id: the item, the snapshot, the decision, the
-- appeal, the text, or for a reveal the item whose source was revealed); the other columns are set for the events they
-- belong to. Notes and erasures carry ids, never text. The view runs with its reader's rights.
CREATE VIEW "public"."case_history" WITH (security_invoker = true) AS
SELECT h.case_id, h.at, h.event, h.ref_id, h.seq, h.intake_kind, h.rule_id, h.alleges_illegal, h.csam, h.reexamination, h.decision_kind, h.outcome, h.staff_id, h.result
  FROM (
    SELECT i.case_id, i.created_at AS at, 'item'::text AS event, i.id AS ref_id, i.seq, n.kind AS intake_kind, n.rule_id, n.alleges_illegal, n.csam,
           (i.reexamines_item_id IS NOT NULL) AS reexamination, NULL::public.decision_kind AS decision_kind, NULL::public.decision_outcome AS outcome,
           NULL::uuid AS staff_id, NULL::public.appeal_result AS result
      FROM public.intake_items i JOIN public.intakes n ON n.id = i.intake_id WHERE i.case_id IS NOT NULL
    UNION ALL
    SELECT s.case_id, s.taken_at, 'snapshot', s.id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL FROM public.evidence_snapshots s
    UNION ALL
    SELECT d.case_id, d.decided_at, 'decision', d.id, NULL, NULL, NULL, NULL, NULL, NULL, d.kind, d.outcome, d.decided_by, NULL FROM public.decisions d
    UNION ALL
    SELECT d.case_id, a.filed_at, 'appeal_filed', a.id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      FROM public.appeals a JOIN public.decisions d ON d.id = a.decision_id
    UNION ALL
    SELECT d.case_id, a.answered_at, 'appeal_answered', a.id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, a.result
      FROM public.appeals a JOIN public.decisions d ON d.id = a.decision_id WHERE a.answered_at IS NOT NULL
    UNION ALL
    SELECT t.case_id, t.created_at, t.kind::text, t.id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      FROM public.staff_texts t WHERE t.kind IN ('note', 'seal_declined')
    UNION ALL
    SELECT l.case_id, l.at, 'reveal', l.intake_item_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, l.staff_id, NULL
      FROM public.case_access_log l WHERE l.kind = 'identity_revealed'
    UNION ALL
    SELECT s.case_id, s.erased_at, 'evidence_erased', s.id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      FROM public.evidence_snapshots s WHERE s.erased_at IS NOT NULL
    UNION ALL
    SELECT d.case_id, d.redacted_at, 'redaction', d.id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      FROM public.decisions d WHERE d.redacted_at IS NOT NULL
  ) h
 ORDER BY h.at, h.event, h.ref_id;--> statement-breakpoint
-- 0001's default privileges cover views too; the API role reads this one and nothing more.
REVOKE ALL ON "public"."case_history" FROM korbat_api;--> statement-breakpoint
GRANT SELECT ON "public"."case_history" TO korbat_api;

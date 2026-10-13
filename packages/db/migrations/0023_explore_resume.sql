-- Explore's resume rule (3e design, section 6.4; the design names this migration 0022, one lower, since 3c's review added
-- 0019). Written by hand: this migration changes no table. The three columns of posts it gives a writer (hidden_at,
-- restored_at, explore_from) were added by 3e's schema migration, outside the API role's column grants, and nothing has
-- written them yet. It replaces two functions of migration 0016, each stated whole as built there with the changes below
-- and no other. CREATE OR REPLACE keeps each one's owner (the migrator), its grants (EXECUTE taken from PUBLIC in 0016,
-- given to nobody) and its triggers; the pinned search path is part of the definition and is stated again.
--
-- As in 0016 to 0022: every object is named schema-qualified; a trigger function fires for every role all the same; times
-- the database writes are now(), the transaction's start. No statement here names a value that 3e's schema migration added
-- to action_kind, and no interval is typed (enum-literals.test.ts, standing-grants.test.ts).
--
-- moderation_apply, replaced: it stays the one writer of a post's level and becomes the one writer of the three columns,
-- in the same UPDATE that moves the level, and so only when the level really changes. In that UPDATE every SET expression
-- reads the row as it was before the statement, so hidden_at below is the start of the span that ends:
--   * the level leaves visible: hidden_at is now();
--   * the level returns to visible: restored_at is now(), and explore_from is coalesce(explore_from, created_at) plus the
--     span just ended (now() - hidden_at);
--   * the level moves between withheld and removed: none of the three changes.
-- No function reads the clock for a post. now() here is the deciding transaction's start, which is the decided_at of the
-- decision that moved the level and the created_at of its ledger rows, so explore_from is created_at plus the hidden
-- spans the ledger gives: from a measure's row to its reversal's row, or to the decided_at of the final decision that
-- closed the case of an interim measure. The rule is keyed on the level alone, so a seal (which changes no level) moves
-- nothing, and a later measure that joins the level's derivation needs no change here. A post hidden before this
-- migration has no hidden_at: when it is restored, the sum is null, its explore_from stays null and it keeps its original
-- age. No backfill is written: nothing is public before 3e.
--
-- What the derivation itself does is 0016's, unchanged: the measures in force on every case decide the level and the
-- images' states, the result does not depend on the order in which cases, measures and reversals arrive, and an auditor
-- can recompute it. With `levels` it takes the posts first, in id order, then their image rows in id order; without it
-- only the image rows, which is the form a seal uses. posts.state mirrors the level unless the author deleted the post.
-- Nobody may call it: its owner does, from the triggers of the ledger and from the erasure of a later migration.
CREATE OR REPLACE FUNCTION "public"."moderation_apply"(posts uuid[], levels boolean) RETURNS void
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
    -- The level and Explore's three columns in one statement; each expression reads the row before it.
    UPDATE public.posts p SET moderation_level = v.level,
           hidden_at = CASE WHEN p.moderation_level = 'visible' THEN now() ELSE p.hidden_at END,
           restored_at = CASE WHEN v.level = 'visible' THEN now() ELSE p.restored_at END,
           explore_from = CASE WHEN v.level = 'visible' THEN coalesce(p.explore_from, p.created_at) + (now() - p.hidden_at) ELSE p.explore_from END
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
-- posts_guard, replaced: on an INSERT by any role but the migrator it also forces Explore's three columns null, whatever
-- the insert supplied, so a post is born never hidden and the API role cannot choose when a post resumes. The migrator's
-- insert keeps them, as it keeps every column. The API role holds no UPDATE grant on the three (0015's column grants leave
-- them out), and the update trigger, which fires only when state, the level or the erasure time changes, does not need
-- them. Everything else is 0016's, unchanged: for every role, the migrator included, a post never leaves
-- deleted_by_author; for every role but the migrator, a post is inserted visible, at level visible and unerased, and an
-- update moves state only to deleted_by_author and never changes the level or the erasure time. The function is plain, so
-- current_user is the role that ran the statement, and inside the migrator-owned definer functions it is the migrator.
CREATE OR REPLACE FUNCTION "public"."posts_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_user <> 'korbat_migrate' AND (NEW.state <> 'visible' OR NEW.moderation_level <> 'visible' OR NEW.erased_at IS NOT NULL) THEN
      RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
    END IF;
    IF current_user <> 'korbat_migrate' THEN
      NEW.hidden_at := NULL;
      NEW.restored_at := NULL;
      NEW.explore_from := NULL;
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
END $$;

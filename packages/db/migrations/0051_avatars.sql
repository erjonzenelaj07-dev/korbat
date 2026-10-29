CREATE TYPE "public"."media_kind" AS ENUM('post', 'avatar');--> statement-breakpoint
ALTER TABLE "post_media" ADD COLUMN "kind" "media_kind" DEFAULT 'post' NOT NULL;--> statement-breakpoint
ALTER TABLE "post_media" ADD COLUMN "profile_id" uuid;--> statement-breakpoint
ALTER TABLE "post_media" ADD COLUMN "avatar_sha256" text;--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "post_media_avatar_idx" ON "post_media" USING btree ("profile_id") WHERE profile_id is not null;--> statement-breakpoint
CREATE INDEX "post_media_owner_avatar_idx" ON "post_media" USING btree ("owner_id") WHERE kind = 'avatar';--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "avatar_path";--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_kind_place" CHECK (("post_media"."kind"::text = 'post' and "post_media"."profile_id" is null) or ("post_media"."kind"::text = 'avatar' and "post_media"."post_id" is null and "post_media"."position" is null and "post_media"."alt_text" is null));--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_avatar_owner" CHECK ("post_media"."profile_id" is null or "post_media"."profile_id" = "post_media"."owner_id");--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_avatar_sha256" CHECK (("post_media"."kind"::text = 'post' and "post_media"."avatar_sha256" is null) or ("post_media"."kind"::text = 'avatar' and "post_media"."avatar_sha256" is not null and "post_media"."avatar_sha256" ~ '^[0-9a-f]{64}$'));
--> statement-breakpoint
-- Everything below is written by hand (2d design, sections 6.4, 6.6 and 6.8; Task 3). The generated lines above add the
-- enum media_kind, created whole with the contracts' MEDIA_KINDS; post_media's kind, profile_id (the profile the row is the
-- avatar of, with no on delete clause: no profile row is ever deleted, and the purge deletes the rows) and avatar_sha256;
-- the CHECKs post_media_kind_place, post_media_avatar_owner and post_media_avatar_sha256 (an avatar's hash is 64 lowercase
-- hex characters, never null, a post's image has none); the unique index post_media_avatar_idx, one avatar a profile, which avatarsOf
-- reads; post_media_owner_avatar_idx, an owner's avatars; and the drop of profiles.avatar_path (decision 18), with which its
-- column grant of 0020 goes. As in 0049: every function is owned by the migrator, pins its search path to public and
-- pg_temp and has EXECUTE taken from PUBLIC; a refusal is a code word, under SQLSTATE 42501 where it guards a column; the
-- new enum and every other enum are compared as text in every body. Each replaced function is written in full from its
-- newest text, named at each, with the changes named there and no other; CREATE OR REPLACE keeps its owner and its revoked
-- EXECUTE, and every replacement states its definer flag and pinned search path again. A trigger whose columns change is
-- dropped and created again under its name, since the columns of an UPDATE OF trigger are part of the trigger.
--
-- Same-event row triggers fire in the order of their names. BEFORE UPDATE OF profile_id: post_media_avatar_guard, then
-- post_media_refused. So for the API's role the guard refuses an erased row's set (avatar_column) before the refusal reads
-- it; post_media_refused's erased arm is reached by a role the guard skips, the migrator, and activity-schema.test.ts tests
-- its three arms as the migrator, and the refusal's and the hold's arms as the API role too.

-- 1. The grants (6.6). profile_id under the guard below; kind and avatar_sha256 are written by the insert alone (INSERT is
-- a table privilege of the API role, 0001), never updated: no grant names them.
GRANT UPDATE ("profile_id") ON "public"."post_media" TO korbat_api;--> statement-breakpoint

-- 2. post_media_avatar_guard, plain, BEFORE UPDATE OF profile_id, for every role but the migrator (6.4): profile_id moves
-- only from a value to null (a detach, always allowed) or from null to the row's own owner_id, and only on a row of kind
-- avatar that is ready, visible and not erased, whose owner's profile is not deleted. Every other change is refused
-- avatar_column under SQLSTATE 42501. The account's standing is the writing statement's (setAvatar takes the acting row
-- through 3e's predicate first, 7.3); the guard does not read it. The profile is read in a statement of its own, after the
-- row's lock, so a purge that committed meanwhile is seen.
CREATE FUNCTION "public"."post_media_avatar_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_live boolean;
BEGIN
  IF current_user = 'korbat_migrate' OR NEW.profile_id IS NOT DISTINCT FROM OLD.profile_id OR NEW.profile_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.profile_id IS NOT NULL OR NEW.profile_id <> NEW.owner_id OR NEW.kind::text <> 'avatar' OR NEW.status::text <> 'ready'
      OR NEW.moderation_state::text <> 'visible' OR NEW.erased_at IS NOT NULL THEN
    RAISE EXCEPTION 'avatar_column' USING ERRCODE = '42501';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.owner_id AND p.deleted_at IS NULL) INTO v_live;
  IF NOT v_live THEN
    RAISE EXCEPTION 'avatar_column' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."post_media_avatar_guard"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "post_media_avatar_guard" BEFORE UPDATE OF "profile_id" ON "public"."post_media" FOR EACH ROW EXECUTE FUNCTION "public"."post_media_avatar_guard"();--> statement-breakpoint

-- 3. post_media_insert, replaced from its text in 0015_greedy_zuras (6.4): a row inserted with a profile_id is refused
-- (moderation_column, 42501), as one that names a post is, for every role. INSERT is a table privilege, and the guard above
-- fires only on UPDATE, so an inserted row could otherwise be an avatar before any check had seen it. Everything else is
-- 0015's: a row is born on no post, visible, unheld and unerased.
CREATE OR REPLACE FUNCTION "public"."post_media_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.post_id IS NOT NULL OR NEW.profile_id IS NOT NULL THEN
    RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
  END IF;
  NEW.moderation_state := 'visible';
  NEW.hold_until := NULL;
  NEW.erased_at := NULL;
  RETURN NEW;
END $$;--> statement-breakpoint

-- 4. post_media_refused, replaced from its text in 0039_known_material (6.4, 7.3 step 2): it fires BEFORE UPDATE OF post_id
-- and profile_id, with the same refusal for either column going from null to a value: upload_refused while a row of
-- upload_refusals names the image, while the row is erased, or while its hold_until is infinity, the refusals read in a
-- statement of their own after the row's lock, as for a post's image. The API answers it avatar_not_ready for an avatar.
-- Still a definer: the API's role cannot read upload_refusals' every row.
CREATE OR REPLACE FUNCTION "public"."post_media_refused"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_refused boolean;
BEGIN
  IF NOT ((OLD.post_id IS NULL AND NEW.post_id IS NOT NULL) OR (OLD.profile_id IS NULL AND NEW.profile_id IS NOT NULL)) THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.upload_refusals r WHERE r.media_id = OLD.id) INTO v_refused;
  IF v_refused OR OLD.erased_at IS NOT NULL OR OLD.hold_until = 'infinity'::timestamptz THEN
    RAISE EXCEPTION 'upload_refused';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER "post_media_refused" ON "public"."post_media";--> statement-breakpoint
CREATE TRIGGER "post_media_refused" BEFORE UPDATE OF "post_id", "profile_id" ON "public"."post_media" FOR EACH ROW EXECUTE FUNCTION "public"."post_media_refused"();--> statement-breakpoint

-- 5. account_frozen(account), plain SQL, STABLE: frozen_for's second arm as its newest text (0041_review) has it, an open
-- case about the account with a suspect item nobody answered. With no post, an avatar's row can be frozen by this arm
-- alone. post_media_keep reads it below, and the media repository's disposal (DISPOSABLE) reads it for an avatar on no
-- post, so that it does not take again, round after round, a row the trigger keeps: the API names frozen_for nowhere
-- (apps/api/test/architecture.test.ts). EXECUTE for the API role alone, as post_frozen's.
CREATE FUNCTION "public"."account_frozen"(account uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cases c
    JOIN public.intake_items i ON i.case_id = c.id AND i.suspect AND i.answered_by IS NULL
    WHERE c.closed_at IS NULL AND c.target_type = 'account' AND c.target_id = account_frozen.account)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."account_frozen"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."account_frozen"(uuid) TO korbat_api;--> statement-breakpoint

-- 6. post_media_keep, replaced from its text in 0015_greedy_zuras (6.4): a row on no post is also retained while it is of
-- kind avatar and its owner has an account case frozen by a suspect report (account_frozen, frozen_for's second arm), read
-- in a statement of its own after the row's lock and refused outside READ COMMITTED as for a row on a post, so a delete
-- that waited for an intake's lock reads the suspect item it committed. Its owner's removal, a replacement, the sweeper
-- and the purge then skip such a row, as they skip a held one. An upload on no post that is no avatar still never reads
-- the predicate. Task 4 (avatar_moderation) adds the seal's arm. The rest is 0015's.
CREATE OR REPLACE FUNCTION "public"."post_media_keep"() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  retained boolean;
BEGIN
  IF OLD.post_id IS NULL THEN
    retained := coalesce(OLD.hold_until > now(), false);
    IF NOT retained AND OLD.kind::text = 'avatar' THEN
      IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'read_committed_only' USING ERRCODE = '25000';
      END IF;
      SELECT public.account_frozen(OLD.owner_id) INTO retained;
    END IF;
  ELSE
    IF current_setting('transaction_isolation') <> 'read committed' THEN
      RAISE EXCEPTION 'read_committed_only' USING ERRCODE = '25000';
    END IF;
    IF OLD.hold_until > now() THEN
      retained := true;
    ELSE
      SELECT public.frozen_for(OLD.post_id, OLD.owner_id) INTO retained;
    END IF;
  END IF;
  IF retained THEN
    IF pg_trigger_depth() > 1 THEN
      RAISE EXCEPTION 'post_media row % is retained', OLD.id USING ERRCODE = '23001';
    END IF;
    RETURN NULL;
  END IF;
  RETURN OLD;
END $$;--> statement-breakpoint

-- 7. post_media_purge, replaced from its text in 0035_edge_purges (6.4, 7.6 "The edge"), with the same body and two
-- changes: a row counts as served when it was on a post or was an avatar (OLD.post_id or OLD.profile_id set), and a row
-- whose profile_id goes from a value to null writes cause state (an avatar replaced, removed or, in Task 4, reset). The
-- trigger fires on moderation_state, erased_at and profile_id, and on delete. So the purge's delete of a current avatar
-- writes deleted, its detach state, and an upload never set, or an avatar detached before, writes nothing. Task 4
-- (avatar_moderation) adds the released cause of an avatar.
CREATE OR REPLACE FUNCTION "public"."post_media_purge"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cause text;
BEGIN
  IF (OLD.post_id IS NULL AND OLD.profile_id IS NULL) OR OLD.status::text <> 'ready' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    v_cause := 'deleted';
  ELSIF OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL THEN
    v_cause := CASE WHEN EXISTS (SELECT 1 FROM public.release_posts r WHERE r.post_id = OLD.post_id) THEN 'released' ELSE 'deleted' END;
  ELSIF OLD.moderation_state::text = 'visible' AND NEW.moderation_state::text <> 'visible' THEN
    v_cause := 'state';
  ELSIF OLD.profile_id IS NOT NULL AND NEW.profile_id IS NULL THEN
    v_cause := 'state';
  ELSE
    RETURN NULL;
  END IF;
  INSERT INTO public.edge_purges (media_id, cause) VALUES (OLD.id, v_cause);
  RETURN NULL;
END $$;--> statement-breakpoint
DROP TRIGGER "post_media_purge" ON "public"."post_media";--> statement-breakpoint
CREATE TRIGGER "post_media_purge" AFTER UPDATE OF "moderation_state", "erased_at", "profile_id" OR DELETE ON "public"."post_media" FOR EACH ROW EXECUTE FUNCTION "public"."post_media_purge"();

CREATE TABLE "edge_purges" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "edge_purges_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"media_id" uuid NOT NULL,
	"cause" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"next_at" timestamp with time zone NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"outcome" text,
	"done_at" timestamp with time zone,
	CONSTRAINT "edge_purges_cause" CHECK ("edge_purges"."cause" in ('state', 'deleted', 'released')),
	CONSTRAINT "edge_purges_outcome" CHECK ("edge_purges"."outcome" in ('accepted', 'failed', 'off')),
	CONSTRAINT "edge_purges_done" CHECK (("edge_purges"."outcome" is null) = ("edge_purges"."done_at" is null)),
	CONSTRAINT "edge_purges_attempts" CHECK ("edge_purges"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "edge_purges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alert_outbox" DROP CONSTRAINT "alert_outbox_kind";--> statement-breakpoint
CREATE INDEX "edge_purges_due_idx" ON "edge_purges" USING btree ("next_at") WHERE done_at is null;--> statement-breakpoint
CREATE INDEX "edge_purges_media_idx" ON "edge_purges" USING btree ("media_id","id");--> statement-breakpoint
ALTER TABLE "alert_outbox" ADD CONSTRAINT "alert_outbox_kind" CHECK ("alert_outbox"."kind" in ('contact_mail', 'contact_mail_escalated', 'order_due', 'order_opened', 'order_corrected', 'order_effected', 'order_reinstated', 'order_unverified', 'hold_ending', 'report_owed', 'handover_undestroyed', 'copy_overdue', 'copy_taken', 'alert_channel_down', 'mailbox_unreachable', 'alert_test', 'moderation_urgent', 'moderation_waiting', 'moderation_burst', 'moderation_reads', 'moderation_reveal', 'moderation_csam_lifted', 'quarantine_due', 'quarantine_lost', 'release_undestroyed', 'seal_released', 'edge_purge_failed'));--> statement-breakpoint
CREATE POLICY "edge_purges_api_all" ON "edge_purges" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Everything below is written by hand (3d design, sections 6 and 6.3). As in 0016 to 0034: every function is owned by
-- the migrator, pins its search path to public and pg_temp, names every object schema-qualified and has EXECUTE taken
-- from PUBLIC. The two trigger functions compare every state through text and name no enum literal, so 3f's level
-- disabled and every later level or state are covered without being named. They take no lock: each inserts into a
-- table that nothing else writes, after the statement that hid the image, and reads its other rows without locking them.
--
-- 1. The grants. 0001's default privileges gave the API role SELECT, INSERT, UPDATE and DELETE on every new public table
-- and USAGE on its identity sequence; edge_purges loses them all, then gets what section 6.3 lists: it reads the rows,
-- moves the four columns of a purge's progress, and deletes a row once it is 30 days past done_at (the retention job's
-- step, Task 8). No INSERT: only the two triggers below write a row, so no route can forget one and none can invent one.
REVOKE ALL ON "public"."edge_purges" FROM korbat_api;--> statement-breakpoint
REVOKE ALL ON SEQUENCE "public"."edge_purges_id_seq" FROM korbat_api;--> statement-breakpoint
GRANT SELECT, DELETE ON "public"."edge_purges" TO korbat_api;--> statement-breakpoint
GRANT UPDATE ("attempts", "next_at", "outcome", "done_at") ON "public"."edge_purges" TO korbat_api;--> statement-breakpoint

-- 2. edge_purges_insert: the forced columns of a new row, whatever the insert supplied. created_at is the moment of the
-- insert (clock_timestamp()), so rows of one transaction keep the order they were written in; next_at is the
-- transaction's start: a row is due at once, from the first round that can see it.
CREATE FUNCTION "public"."edge_purges_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.created_at := clock_timestamp();
  NEW.next_at := now();
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."edge_purges_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "edge_purges_insert" BEFORE INSERT ON "public"."edge_purges" FOR EACH ROW EXECUTE FUNCTION "public"."edge_purges_insert"();--> statement-breakpoint

-- 3. post_media_purge: one row for an image row that is on a post and ready (only such an image was ever served to anyone,
-- so an upload on no post, a held one among them, never gets a row), when the row is deleted (cause deleted); when its
-- erased_at becomes set (cause released when its post is in release_posts, which seal_release and release_replay write
-- before they set erased_at, else deleted); or when its moderation_state was visible and no longer is (cause state). The
-- moderation state is moved only by moderation_apply, for every measure of 3c, 3e and 3f; erased_at by the R4
-- redaction, the end of an order's preservation and the release; a delete by the author's deletion, the account's purge
-- and the disposal. A row is written whether the edge's adapter is on or off. A row that post_media_keep keeps is not
-- deleted, so it fires nothing.
CREATE FUNCTION "public"."post_media_purge"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cause text;
BEGIN
  IF OLD.post_id IS NULL OR OLD.status::text <> 'ready' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    v_cause := 'deleted';
  ELSIF OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL THEN
    v_cause := CASE WHEN EXISTS (SELECT 1 FROM public.release_posts r WHERE r.post_id = OLD.post_id) THEN 'released' ELSE 'deleted' END;
  ELSIF OLD.moderation_state::text = 'visible' AND NEW.moderation_state::text <> 'visible' THEN
    v_cause := 'state';
  ELSE
    RETURN NULL;
  END IF;
  INSERT INTO public.edge_purges (media_id, cause) VALUES (OLD.id, v_cause);
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."post_media_purge"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "post_media_purge" AFTER UPDATE OF "moderation_state", "erased_at" OR DELETE ON "public"."post_media" FOR EACH ROW EXECUTE FUNCTION "public"."post_media_purge"();--> statement-breakpoint

-- 4. posts_purge: one row for each ready, unerased image of the post when its state was visible and no longer is (cause
-- deleted when it became deleted_by_author, else state), or else when its level was visible and no longer is (cause
-- state). moderation_apply writes the level and the state in two statements, so a measure on a post writes two rows an
-- image, which the job sends as one prefix; an author's deletion writes the state, and its images' rows when they are
-- deleted after it. The images are read, never locked: moderation_apply locks them after the post, in id order.
CREATE FUNCTION "public"."posts_purge"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cause text;
BEGIN
  IF OLD.state::text = 'visible' AND NEW.state::text <> 'visible' THEN
    v_cause := CASE WHEN NEW.state::text = 'deleted_by_author' THEN 'deleted' ELSE 'state' END;
  ELSIF OLD.moderation_level::text = 'visible' AND NEW.moderation_level::text <> 'visible' THEN
    v_cause := 'state';
  ELSE
    RETURN NULL;
  END IF;
  INSERT INTO public.edge_purges (media_id, cause)
  SELECT m.id, v_cause FROM public.post_media m
   WHERE m.post_id = NEW.id AND m.status::text = 'ready' AND m.erased_at IS NULL
   ORDER BY m.id;
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."posts_purge"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "posts_purge" AFTER UPDATE OF "moderation_level", "state" ON "public"."posts" FOR EACH ROW EXECUTE FUNCTION "public"."posts_purge"();

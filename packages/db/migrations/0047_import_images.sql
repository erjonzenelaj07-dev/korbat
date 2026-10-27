ALTER TABLE "alert_outbox" DROP CONSTRAINT "alert_outbox_kind";--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "images_left_out_by" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "post_media_import_unattached_idx" ON "post_media" USING btree ("import_job_id") WHERE import_job_id is not null and post_id is null;--> statement-breakpoint
ALTER TABLE "alert_outbox" ADD CONSTRAINT "alert_outbox_kind" CHECK ("alert_outbox"."kind" in ('contact_mail', 'contact_mail_escalated', 'order_due', 'order_opened', 'order_corrected', 'order_effected', 'order_reinstated', 'order_unverified', 'hold_ending', 'report_owed', 'handover_undestroyed', 'copy_overdue', 'copy_taken', 'alert_channel_down', 'mailbox_unreachable', 'alert_test', 'moderation_urgent', 'moderation_waiting', 'moderation_burst', 'moderation_reads', 'moderation_reveal', 'moderation_csam_lifted', 'quarantine_due', 'quarantine_lost', 'release_undestroyed', 'seal_released', 'edge_purge_failed', 'head_unwitnessed', 'head_missed', 'automated_objection', 'automation_capped', 'automated_waiting', 'matcher_down', 'hold_ended_unreported', 'head_unmailed', 'import_image_flagged'));--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_left_out_by" CHECK (jsonb_typeof("import_jobs"."images_left_out_by") = 'object' and octet_length("import_jobs"."images_left_out_by"::text) <= 1024 and ("import_jobs"."images_left_out_by" - array['video', 'sensitive', 'unsupported', 'too_large', 'missing_file', 'bluesky_no_files', 'images_off', 'not_chosen', 'no_description', 'over_image_cap', 'failed', 'not_checked', 'flagged']) = '{}'::jsonb);
--> statement-breakpoint
-- Everything below is written by hand (3b Task 5, the orchestrator's rulings of 2026-10-26 on the design's sections 6.1,
-- 7.4, 8.1 and 9.3), in the conventions of 0043: every function owned by the migrator, its search path pinned to public and
-- pg_temp, every object schema-qualified, a guard's refusal import_column under SQLSTATE 42501, the migrator skipped.
-- The lines drizzle generated above:
--   - alert_outbox_kind is replaced with 0041's list and one kind more, last: import_image_flagged, the staff alert of
--     8.1 for imported images whose match does not act (ALERT_KIND_LIST; alerts-grants.test.ts holds the two equal);
--   - import_jobs.images_left_out_by, the images the preparation left out as counts by reason, so the result can say why
--     (the ruling); its CHECK import_jobs_left_out_by takes only names of IMPORT_IMAGE_SKIPS (import-schema.test.ts holds
--     the list equal) in at most 1,024 bytes;
--   - post_media_import_unattached_idx, the imports whose images are still on no post: import-drive asks it every round
--     for the leftovers of imports that have ended (7.4), and it holds only rows on their way to a post.
--
-- 1. The grant (6.4): the API role may UPDATE the new column, under import_jobs_guard; it inserts it as a table privilege,
-- and import_jobs_insert forces it.
GRANT UPDATE ("images_left_out_by") ON "public"."import_jobs" TO korbat_api;--> statement-breakpoint

-- 2. import_jobs_insert, replaced: 0043's text, byte for byte, with one line more: a new import has left out no image, so
-- images_left_out_by is forced to the empty object, as images_left_out is forced to 0. CREATE OR REPLACE keeps the
-- function's owner, its grants and its trigger.
CREATE OR REPLACE FUNCTION "public"."import_jobs_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'korbat_migrate' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles a WHERE a.id = NEW.owner_id AND a.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  NEW.status := 'uploading';
  NEW.created_at := clock_timestamp();
  NEW.received_bytes := 0;
  NEW.uploaded_at := NULL;
  NEW.scanned_at := NULL;
  NEW.confirmed_at := NULL;
  NEW.ended_at := NULL;
  NEW.failure := NULL;
  NEW.stop_reason := NULL;
  NEW.staff_ended_at := NULL;
  NEW.staff_rule_id := NULL;
  NEW.refused_at_original := NULL;
  NEW.refused_words := NULL;
  NEW.scan := NULL;
  NEW.choice := NULL;
  NEW.stated_at := NULL;
  NEW.seed := NULL;
  NEW.post_cursor := 0;
  NEW.image_cursor := 0;
  NEW.posts_published := 0;
  NEW.images_kept := 0;
  NEW.images_left_out := 0;
  NEW.images_left_out_by := '{}'::jsonb;
  NEW.posts_removed := 0;
  RETURN NEW;
END $$;--> statement-breakpoint

-- 3. import_jobs_guard, replaced: 0043's text, byte for byte, with two rules more at its end, for images_left_out_by:
--   - each count is a whole number, none smaller than it was, and no reason it held goes (a reason's count only grows,
--     as images_left_out does);
--   - on every update its counts sum to images_left_out: every image left out is counted under one reason, so a writer
--     that adds to images_left_out names the reason in the same statement.
--   Both are asked only of an object: anything else is the CHECK import_jobs_left_out_by's to refuse, after this trigger.
CREATE OR REPLACE FUNCTION "public"."import_jobs_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  was text;
  goes text;
  moved boolean;
  confirming boolean;
BEGIN
  IF current_user = 'korbat_migrate' THEN
    RETURN NEW;
  END IF;
  was := OLD.status::text;
  goes := NEW.status::text;
  moved := goes <> was;
  confirming := moved AND was = 'ready' AND goes IN ('preparing', 'publishing');
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.source::text IS DISTINCT FROM OLD.source::text
     OR NEW.declared_bytes IS DISTINCT FROM OLD.declared_bytes OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF moved AND (was, goes) NOT IN (('uploading', 'scanning'), ('uploading', 'failed'), ('uploading', 'cancelled'), ('uploading', 'expired'),
                                   ('scanning', 'ready'), ('scanning', 'failed'), ('scanning', 'cancelled'),
                                   ('ready', 'preparing'), ('ready', 'publishing'), ('ready', 'cancelled'), ('ready', 'expired'),
                                   ('preparing', 'publishing'), ('preparing', 'stopped'),
                                   ('publishing', 'done'), ('publishing', 'stopped'),
                                   ('done', 'undoing'), ('stopped', 'undoing'), ('undoing', 'undone')) THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF moved AND was = 'stopped' AND goes = 'undoing' AND NEW.posts_published <= 0 THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF (NEW.ended_at IS DISTINCT FROM OLD.ended_at AND NOT (moved AND goes IN ('done', 'stopped', 'undone', 'failed', 'cancelled', 'expired')))
     OR (moved AND goes IN ('done', 'stopped', 'undone', 'failed', 'cancelled', 'expired') AND NEW.ended_at IS NULL) THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF (NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at AND NOT (moved AND goes = 'scanning'))
     OR (moved AND goes = 'scanning' AND (NEW.uploaded_at IS NULL OR NEW.received_bytes <> NEW.declared_bytes)) THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF (NEW.scanned_at IS DISTINCT FROM OLD.scanned_at AND NOT (moved AND was = 'scanning'))
     OR (moved AND was = 'scanning' AND NEW.scanned_at IS NULL) THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF (NEW.scan IS DISTINCT FROM OLD.scan AND NOT (moved AND (goes = 'ready' OR was = 'ready')))
     OR (moved AND goes = 'ready' AND NEW.scan IS NULL)
     OR (moved AND was = 'ready' AND (NEW.scan -> 'months' IS DISTINCT FROM '[]'::jsonb OR NEW.scan -> 'samples' IS DISTINCT FROM '[]'::jsonb
                                      OR NEW.scan -> 'pages' IS DISTINCT FROM '[]'::jsonb OR NEW.scan #> '{skipped,not_public}' IS NOT NULL)) THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF ((NEW.choice IS DISTINCT FROM OLD.choice OR NEW.stated_at IS DISTINCT FROM OLD.stated_at OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at) AND NOT confirming)
     OR (NEW.seed IS DISTINCT FROM OLD.seed AND NOT confirming AND NEW.seed IS NOT NULL)
     OR (confirming AND (NEW.choice IS NULL OR NEW.stated_at IS NULL OR NEW.confirmed_at IS NULL OR NEW.seed IS NULL))
     OR (moved AND goes IN ('done', 'stopped') AND NEW.seed IS NOT NULL) THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF (NEW.failure IS DISTINCT FROM OLD.failure AND NOT (moved AND goes = 'failed'))
     OR (NEW.stop_reason IS DISTINCT FROM OLD.stop_reason AND NOT (moved AND goes = 'stopped')) THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF ((NEW.staff_ended_at IS DISTINCT FROM OLD.staff_ended_at OR NEW.staff_rule_id IS DISTINCT FROM OLD.staff_rule_id)
      AND NOT (moved AND goes IN ('stopped', 'undoing') AND OLD.staff_ended_at IS NULL AND OLD.staff_rule_id IS NULL))
     OR (moved AND goes = 'stopped' AND (NEW.stop_reason IS NOT DISTINCT FROM 'by_staff') <> (NEW.staff_ended_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF (NEW.refused_at_original IS DISTINCT FROM OLD.refused_at_original OR NEW.refused_words IS DISTINCT FROM OLD.refused_words)
     AND NOT (moved AND goes = 'stopped' AND NEW.stop_reason IS NOT DISTINCT FROM 'refused_image') THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF NEW.received_bytes < OLD.received_bytes OR NEW.post_cursor < OLD.post_cursor OR NEW.image_cursor < OLD.image_cursor
     OR NEW.posts_published < OLD.posts_published OR NEW.images_kept < OLD.images_kept OR NEW.images_left_out < OLD.images_left_out
     OR NEW.posts_removed < OLD.posts_removed THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(NEW.images_left_out_by) = 'object' THEN
    IF NEW.images_left_out_by IS DISTINCT FROM OLD.images_left_out_by
       AND (EXISTS (SELECT 1 FROM jsonb_each(NEW.images_left_out_by) e
                     WHERE CASE WHEN jsonb_typeof(e.value) <> 'number' THEN true
                                ELSE (e.value)::numeric <> trunc((e.value)::numeric)
                                     OR (e.value)::numeric < coalesce((OLD.images_left_out_by ->> e.key)::numeric, 0) END)
            OR EXISTS (SELECT 1 FROM jsonb_each(OLD.images_left_out_by) o WHERE NOT (NEW.images_left_out_by ? o.key))) THEN
      RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
    END IF;
    IF (SELECT coalesce(sum((e.value)::numeric), 0) FROM jsonb_each(NEW.images_left_out_by) e) <> NEW.images_left_out THEN
      RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

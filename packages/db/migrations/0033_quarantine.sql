CREATE TABLE "quarantine_files" (
	"media_id" uuid NOT NULL,
	"file" text NOT NULL,
	"post_id" uuid,
	"size" bigint,
	"sha256" text,
	"moved_at" timestamp with time zone NOT NULL,
	"returned_at" timestamp with time zone,
	"destroyed_at" timestamp with time zone,
	"release_id" uuid,
	"lost_at" timestamp with time zone,
	"lost_told" "delivery_state",
	"imported_at" timestamp with time zone,
	"unknown" boolean NOT NULL,
	CONSTRAINT "quarantine_files_pkey" PRIMARY KEY("media_id","file"),
	CONSTRAINT "quarantine_files_file" CHECK ("quarantine_files"."file" in ('files/' || left("quarantine_files"."media_id"::text, 2) || '/' || "quarantine_files"."media_id"::text || '/small.webp', 'files/' || left("quarantine_files"."media_id"::text, 2) || '/' || "quarantine_files"."media_id"::text || '/large.webp')),
	CONSTRAINT "quarantine_files_digest" CHECK (("quarantine_files"."size" is null) = ("quarantine_files"."sha256" is null) and ("quarantine_files"."size" is null or ("quarantine_files"."size" > 0 and "quarantine_files"."sha256" ~ '^[0-9a-f]{64}$')) and ("quarantine_files"."size" is not null or "quarantine_files"."lost_at" is not null)),
	CONSTRAINT "quarantine_files_ends" CHECK (num_nonnulls("quarantine_files"."returned_at", "quarantine_files"."destroyed_at", "quarantine_files"."lost_at") <= 1),
	CONSTRAINT "quarantine_files_release" CHECK ("quarantine_files"."release_id" is null or "quarantine_files"."destroyed_at" is not null),
	CONSTRAINT "quarantine_files_told" CHECK (("quarantine_files"."lost_told" is null) = ("quarantine_files"."lost_at" is null))
);
--> statement-breakpoint
ALTER TABLE "quarantine_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alert_outbox" DROP CONSTRAINT "alert_outbox_kind";--> statement-breakpoint
CREATE INDEX "quarantine_files_post_idx" ON "quarantine_files" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "quarantine_files_untold_idx" ON "quarantine_files" USING btree ("media_id") WHERE lost_told = 'pending';--> statement-breakpoint
ALTER TABLE "alert_outbox" ADD CONSTRAINT "alert_outbox_kind" CHECK ("alert_outbox"."kind" in ('contact_mail', 'contact_mail_escalated', 'order_due', 'order_opened', 'order_corrected', 'order_effected', 'order_reinstated', 'order_unverified', 'hold_ending', 'report_owed', 'handover_undestroyed', 'copy_overdue', 'copy_taken', 'alert_channel_down', 'mailbox_unreachable', 'alert_test', 'moderation_urgent', 'moderation_waiting', 'moderation_burst', 'moderation_reads', 'moderation_reveal', 'moderation_csam_lifted', 'quarantine_due', 'quarantine_lost'));--> statement-breakpoint
CREATE POLICY "quarantine_files_api_none" ON "quarantine_files" AS PERMISSIVE FOR SELECT TO "korbat_api" USING (false);
--> statement-breakpoint
-- Everything below is written by hand (3d design, sections 6 and 6.1). As in 0016 to 0032: every function is owned by
-- the migrator, pins its search path to public and pg_temp, names every object schema-qualified and has EXECUTE taken
-- from PUBLIC; times the database writes are now(), the transaction's start; errors carry their code as the message under
-- SQLSTATE P0001. No function here holds an interval literal: the one day of quarantine_due is F's daily threshold, the
-- contracts' QUARANTINE_RULES.dueHours, written as alert_steps() writes it for every daily kind.
--
-- 1. The grants. 0001's default privileges gave the API role every right on a new public table; quarantine_files loses
-- them all and gets none back: only the command line, as the migrator, reads and writes it (quarantine-list through
-- quarantine_plan(), quarantine-record by its statements). The API's role reaches the quarantine through the six
-- functions below that are granted to it, which answer counts, one time and booleans, never a file's name or digest.
REVOKE ALL ON "public"."quarantine_files" FROM korbat_api;--> statement-breakpoint

-- 2. quarantine_files_insert: what a row says of its image is the database's, whatever the insert supplied. `unknown` is
-- true when no image row with the id exists, so the file is one the database cannot place (the plan's operator line);
-- `post_id` is the image's post then (a row imported after a restore keeps the post it names for an image the database
-- does not know). `moved_at` is the record's time, which is not before the move; a row written again after a restore
-- (imported_at set) keeps a supplied moved_at that is not after the clock. A new row has no end but `lost`, which a
-- `lost` line writes as the row's first state, at the record's time. `lost_told`: the author's notice of a lost file is
-- owed (pending) only for an image on a post, not erased and not sealed for good; else none.
CREATE FUNCTION "public"."quarantine_files_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_post uuid;
  v_known boolean;
BEGIN
  SELECT m.post_id, true INTO v_post, v_known FROM public.post_media m WHERE m.id = NEW.media_id;
  NEW.unknown := v_known IS NULL;
  IF v_known IS NOT NULL OR NEW.imported_at IS NULL THEN
    NEW.post_id := v_post;
  END IF;
  IF NEW.imported_at IS NULL OR NEW.moved_at IS NULL OR NEW.moved_at > clock_timestamp() THEN
    NEW.moved_at := now();
  END IF;
  NEW.returned_at := NULL;
  NEW.destroyed_at := NULL;
  NEW.release_id := NULL;
  IF NEW.lost_at IS NOT NULL THEN
    NEW.lost_at := now();
    NEW.lost_told := public.quarantine_lost_told(NEW.media_id);
  ELSE
    NEW.lost_told := NULL;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."quarantine_files_insert"() FROM PUBLIC;--> statement-breakpoint

-- 3. quarantine_files_update: a row's identity, its post, its mark and the digest it was moved with never change: the
-- files of an id never change, so a later line with another digest is reported by the command and leaves the stored
-- one (a row written as lost before any move takes the digest of the move that finds its file). An end's time is the
-- record's own when the end is set, and a row that returned and is moved again keeps its row, its returned_at cleared
-- and its moved_at the new record's time. A time already set is left as the update gives it: only the migrator writes
-- this table, and that is how a test moves a record back in time (ageCustodyForTest). `lost_told` is forced when lost_at
-- is set, and afterwards changes only from pending, through lost_told().
CREATE FUNCTION "public"."quarantine_files_update"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.media_id := OLD.media_id;
  NEW.file := OLD.file;
  NEW.post_id := OLD.post_id;
  NEW.unknown := OLD.unknown;
  NEW.imported_at := OLD.imported_at;
  IF OLD.sha256 IS NOT NULL THEN
    NEW.size := OLD.size;
    NEW.sha256 := OLD.sha256;
  END IF;
  IF OLD.returned_at IS NOT NULL AND NEW.returned_at IS NULL THEN
    NEW.moved_at := now();
  END IF;
  IF OLD.returned_at IS NULL AND NEW.returned_at IS NOT NULL THEN
    NEW.returned_at := now();
  END IF;
  IF OLD.destroyed_at IS NULL AND NEW.destroyed_at IS NOT NULL THEN
    NEW.destroyed_at := now();
  END IF;
  IF NEW.lost_at IS NULL THEN
    NEW.lost_told := NULL;
  ELSIF OLD.lost_at IS NULL THEN
    NEW.lost_at := now();
    NEW.lost_told := public.quarantine_lost_told(NEW.media_id);
  ELSIF OLD.lost_told <> 'pending' OR NEW.lost_told IS NULL THEN
    NEW.lost_told := OLD.lost_told;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."quarantine_files_update"() FROM PUBLIC;--> statement-breakpoint

-- 4. Two helpers of the functions below, callable by nobody but their owner. quarantine_sealed_for_good: a seal_media in
-- force lists the post and its decision is not interim (measures_in_force; a seal taken while deciding, a person's or a
-- program's, is meant to end within hours and leaves its files in the store: section 2, row 38). quarantine_lost_told:
-- the state a lost file's notice is born in, pending only for an image of a post its author still has, not erased and
-- not sealed for good.
CREATE FUNCTION "public"."quarantine_sealed_for_good"(post uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.seal_posts s JOIN public.measures_in_force f ON f.id = s.action_id
                  WHERE s.post_id = quarantine_sealed_for_good.post AND f.kind = 'seal_media' AND f.decision_kind <> 'interim')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."quarantine_sealed_for_good"(uuid) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION "public"."quarantine_lost_told"(media uuid) RETURNS "public"."delivery_state"
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.post_media m JOIN public.posts p ON p.id = m.post_id
                            WHERE m.id = quarantine_lost_told.media AND m.erased_at IS NULL AND p.erased_at IS NULL
                              AND p.state <> 'deleted_by_author' AND NOT public.quarantine_sealed_for_good(m.post_id))
              THEN 'pending'::public.delivery_state ELSE 'none'::public.delivery_state END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."quarantine_lost_told"(uuid) FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "quarantine_files_insert" BEFORE INSERT ON "public"."quarantine_files" FOR EACH ROW EXECUTE FUNCTION "public"."quarantine_files_insert"();--> statement-breakpoint
CREATE TRIGGER "quarantine_files_update" BEFORE UPDATE ON "public"."quarantine_files" FOR EACH ROW EXECUTE FUNCTION "public"."quarantine_files_update"();--> statement-breakpoint

-- 5. quarantine_plan(): what the mover is to do, one row an image (section 6.1), for staff.js quarantine-list alone, as the
-- migrator: EXECUTE to nobody. A file "has no end" while its returned_at, destroyed_at and lost_at are null. An image is
-- "in the quarantine" when each of its two files has a row with returned_at and destroyed_at null: a lost file counts
-- here, since nothing of it is left to move.
--   in:       every image row, not erased, of a post sealed for good, that is not in the quarantine;
--   out:      every image with a file without an end, not marked unknown, whose image row exists, is on a post, is not
--             erased and is not sealed for good (an unseal_media, or a stale list's move of a file whose seal was lifted);
--   destroy:  every image with a file without an end, not marked unknown, whose image row no longer exists;
--   operator: every image with a file without an end marked unknown, which nothing destroys or returns on a list's word.
CREATE FUNCTION "public"."quarantine_plan"() RETURNS TABLE (direction text, media_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH good AS (
    SELECT DISTINCT s.post_id FROM public.seal_posts s JOIN public.measures_in_force f ON f.id = s.action_id
     WHERE f.kind = 'seal_media' AND f.decision_kind <> 'interim'
  ), open_files AS (
    SELECT q.media_id, bool_or(q.unknown) AS unknown FROM public.quarantine_files q
     WHERE q.returned_at IS NULL AND q.destroyed_at IS NULL AND q.lost_at IS NULL GROUP BY q.media_id
  ), kept AS (
    SELECT q.media_id FROM public.quarantine_files q
     WHERE q.returned_at IS NULL AND q.destroyed_at IS NULL GROUP BY q.media_id HAVING count(*) = 2
  )
  SELECT 'in'::text, m.id FROM public.post_media m JOIN good g ON g.post_id = m.post_id
   WHERE m.erased_at IS NULL AND NOT EXISTS (SELECT 1 FROM kept k WHERE k.media_id = m.id)
  UNION ALL
  SELECT 'out'::text, o.media_id FROM open_files o JOIN public.post_media m ON m.id = o.media_id
   WHERE NOT o.unknown AND m.post_id IS NOT NULL AND m.erased_at IS NULL AND NOT EXISTS (SELECT 1 FROM good g WHERE g.post_id = m.post_id)
  UNION ALL
  SELECT 'destroy'::text, o.media_id FROM open_files o
   WHERE NOT o.unknown AND NOT EXISTS (SELECT 1 FROM public.post_media m WHERE m.id = o.media_id)
  UNION ALL
  SELECT 'operator'::text, o.media_id FROM open_files o WHERE o.unknown
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."quarantine_plan"() FROM PUBLIC;--> statement-breakpoint

-- 6. quarantine_counts(): the sizes of the three sets the mover carries out, in images, and the earliest time a move in
-- or out became due: for `in` its seal's decided_at (the oldest seal for good in force listing the post), for `out` the
-- created_at of the newest ledger row that reversed a seal for good listing its post, or the move's own record when a
-- stale list moved the file after that. What the console's home and quarantine_due learn: counts and one time, no id.
CREATE FUNCTION "public"."quarantine_counts"() RETURNS TABLE (due_in integer, due_out integer, undestroyed integer, oldest timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH plan AS (
    SELECT p.direction, p.media_id FROM public.quarantine_plan() p
  ), in_at AS (
    SELECT min(f_d.decided_at) AS at
      FROM plan p JOIN public.post_media m ON m.id = p.media_id
      JOIN LATERAL (SELECT min(d.decided_at) AS decided_at FROM public.seal_posts s
                      JOIN public.measures_in_force f ON f.id = s.action_id AND f.kind = 'seal_media' AND f.decision_kind <> 'interim'
                      JOIN public.decisions d ON d.id = f.decision_id
                     WHERE s.post_id = m.post_id) f_d ON true
     WHERE p.direction = 'in'
  ), out_at AS (
    SELECT min(greatest(
             (SELECT max(r.created_at) FROM public.seal_posts s
                JOIN public.decision_actions a ON a.id = s.action_id AND a.kind = 'seal_media'
                JOIN public.decisions d ON d.id = a.decision_id AND d.kind <> 'interim'
                JOIN public.decision_actions r ON r.reverses_action_id = a.id
               WHERE s.post_id = m.post_id),
             (SELECT max(q.moved_at) FROM public.quarantine_files q
               WHERE q.media_id = p.media_id AND q.returned_at IS NULL AND q.destroyed_at IS NULL AND q.lost_at IS NULL))) AS at
      FROM plan p JOIN public.post_media m ON m.id = p.media_id
     WHERE p.direction = 'out'
  )
  SELECT (SELECT count(*) FROM plan WHERE direction = 'in')::integer,
         (SELECT count(*) FROM plan WHERE direction = 'out')::integer,
         (SELECT count(*) FROM plan WHERE direction = 'destroy')::integer,
         least((SELECT at FROM in_at), (SELECT at FROM out_at))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."quarantine_counts"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."quarantine_counts"() TO korbat_api;--> statement-breakpoint

-- 7. seal_custody(action): the same for one seal, which its case shows (CaseDecision.custody), for the posts its ledger row
-- lists in seal_posts: `files`, two for each image row of those posts that is not erased; `moved`, how many of those
-- files have a row without an end, and `moved_at` the newest of their records; `to_return`, the files without an end of
-- the images of those posts that the plan lists under out; `files_left`, 0 until the release (Task 2) adds its released
-- files; `lost`, the files recorded as lost whose row names one of those posts. Counts and one time, never a name.
CREATE FUNCTION "public"."seal_custody"(action uuid) RETURNS TABLE (files integer, moved integer, moved_at timestamptz, to_return integer, files_left integer, lost integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH posts AS (
    SELECT s.post_id FROM public.seal_posts s WHERE s.action_id = seal_custody.action
  ), images AS (
    SELECT m.id FROM public.post_media m JOIN posts p ON p.post_id = m.post_id WHERE m.erased_at IS NULL
  ), present AS (
    SELECT q.moved_at FROM public.quarantine_files q JOIN images i ON i.id = q.media_id
     WHERE q.returned_at IS NULL AND q.destroyed_at IS NULL AND q.lost_at IS NULL
  ), to_return AS (
    SELECT p.media_id FROM public.quarantine_plan() p JOIN public.post_media m ON m.id = p.media_id JOIN posts x ON x.post_id = m.post_id
     WHERE p.direction = 'out'
  )
  SELECT (2 * (SELECT count(*) FROM images))::integer,
         (SELECT count(*) FROM present)::integer,
         (SELECT max(present.moved_at) FROM present),
         (SELECT count(*) FROM public.quarantine_files q JOIN to_return t ON t.media_id = q.media_id
           WHERE q.returned_at IS NULL AND q.destroyed_at IS NULL AND q.lost_at IS NULL)::integer,
         0,
         (SELECT count(*) FROM public.quarantine_files q JOIN posts p ON p.post_id = q.post_id WHERE q.lost_at IS NOT NULL)::integer
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."seal_custody"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."seal_custody"(uuid) TO korbat_api;--> statement-breakpoint

-- 8. media_quarantined(media) and media_lost(media): whether a file of the image has a row without an end, and whether
-- one is recorded as lost. serve and the owner's status ask them only for a visible image whose file is missing, to
-- answer "being restored" or that korbat lost it, in the place of an error (section 2, row 39).
CREATE FUNCTION "public"."media_quarantined"(media uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.quarantine_files q
                  WHERE q.media_id = media_quarantined.media AND q.returned_at IS NULL AND q.destroyed_at IS NULL AND q.lost_at IS NULL)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."media_quarantined"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."media_quarantined"(uuid) TO korbat_api;--> statement-breakpoint
CREATE FUNCTION "public"."media_lost"(media uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.quarantine_files q WHERE q.media_id = media_lost.media AND q.lost_at IS NOT NULL)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."media_lost"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."media_lost"(uuid) TO korbat_api;--> statement-breakpoint

-- 9. lost_untold(n) and lost_told(media, outcome): the dispatch job's one way to learn of a lost file whose author is owed
-- the notice (one row an image, the earliest lost first), and to record the mail's outcome, which changes a row only
-- from pending: the table is closed to the API's role.
CREATE FUNCTION "public"."lost_untold"(n integer) RETURNS TABLE (media_id uuid, lost_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT q.media_id, min(q.lost_at) FROM public.quarantine_files q
   WHERE q.lost_told = 'pending' GROUP BY q.media_id ORDER BY 2, 1 LIMIT greatest(lost_untold.n, 0)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."lost_untold"(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."lost_untold"(integer) TO korbat_api;--> statement-breakpoint
CREATE FUNCTION "public"."lost_told"(media uuid, outcome "public"."delivery_state") RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.quarantine_files q SET lost_told = lost_told.outcome WHERE q.media_id = lost_told.media AND q.lost_told = 'pending'
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."lost_told"(uuid, "public"."delivery_state") FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."lost_told"(uuid, "public"."delivery_state") TO korbat_api;--> statement-breakpoint

-- 10. alert_steps(), replaced from its text in 0031_recovery with section 6.1's row marked 0030: quarantine_due.
CREATE OR REPLACE FUNCTION "public"."alert_steps"() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_now timestamptz := now();
  r record;
  v_rows integer;
  v_written integer := 0;
BEGIN
  SELECT * INTO r FROM public.order_rules();

  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts, message_id)
  SELECT 'contact_mail_escalated', 5, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'contact_mail_escalated' AND o.message_id = m.id AND o.order_id IS NULL), 0),
         jsonb_build_object('receivedAt', public.alert_time(m.received_at), 'dueAt', public.alert_time(m.received_at + make_interval(mins => r.hour_minutes))),
         m.id
    FROM public.contact_messages m
   WHERE NOT m.stale AND m.disposition IS NULL
     AND m.received_at + make_interval(mins => r.escalate_minutes) <= v_now
     AND NOT EXISTS (SELECT 1 FROM auth.staff_sessions s WHERE s.created_at >= m.received_at OR s.last_used_at >= m.received_at)
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'contact_mail_escalated' AND o.message_id = m.id AND o.order_id IS NULL
                        AND o.created_at >= m.received_at + make_interval(mins => r.escalate_minutes))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts, message_id)
  SELECT 'order_due', 5, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'order_due' AND o.message_id = m.id AND o.order_id IS NULL), 0),
         -- The minutes left, rounded up and never below 0: an hour of order_rules() is hour_minutes minutes.
         jsonb_build_object('dueAt', public.alert_time(d.due_at),
                            'minutesLeft', greatest(0, ceil(extract(epoch FROM d.due_at - v_now) / extract(epoch FROM make_interval(mins => r.hour_minutes)) * r.hour_minutes))::integer),
         m.id
    FROM public.contact_messages m
   CROSS JOIN LATERAL (
     SELECT m.received_at + make_interval(mins => r.hour_minutes) AS due_at,
            CASE WHEN m.received_at + make_interval(mins => r.hour_minutes) <= v_now THEN m.received_at + make_interval(mins => r.hour_minutes)
                 WHEN m.received_at + make_interval(mins => r.remind_minutes) <= v_now THEN m.received_at + make_interval(mins => r.remind_minutes)
            END AS threshold) d
   WHERE NOT m.stale AND m.disposition IS NULL AND d.threshold IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'order_due' AND o.message_id = m.id AND o.order_id IS NULL AND o.created_at >= d.threshold)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts)
  SELECT 'alert_test', 3, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'alert_test' AND o.message_id IS NULL AND o.order_id IS NULL), 0),
         jsonb_build_object('at', public.alert_time(v_now))
   WHERE NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'alert_test' AND o.message_id IS NULL AND o.order_id IS NULL AND o.created_at >= v_now - make_interval(days => 1))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  -- 0027 (3f design, section 6.1, the rows marked 0025): an order's steps. Its clock started again by a restart rings the
  -- phone on call again, as a message's first push, once a restart: the threshold is the restart's clock_start, so a
  -- second restart alerts again with the next free step.
  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts, order_id)
  SELECT 'contact_mail', 5, 'on_call',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'contact_mail' AND o.order_id = c.order_id AND o.message_id IS NULL), 0),
         jsonb_build_object('dueAt', public.alert_time(c.deadline_at)),
         c.order_id
    FROM public.legal_order_clock c
    JOIN public.legal_orders lo ON lo.id = c.order_id
   WHERE lo.closed_at IS NULL AND NOT c.stopped AND c.clock_start IS NOT NULL AND c.items_open > 0
     AND EXISTS (SELECT 1 FROM public.legal_order_events e WHERE e.order_id = c.order_id AND e.kind IN ('grounds_ceased', 'clarification_received'))
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'contact_mail' AND o.order_id = c.order_id AND o.message_id IS NULL AND o.created_at >= c.clock_start)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  -- order_due for an order: a removal order that is not closed, whose clock runs, with an item neither disabled nor
  -- closed (one given effect in part is still due), at clock_start + remind_minutes and at the deadline, the later of the
  -- two that has passed. Its reminders end when it is given effect in full, closed, or stopped by an Annex III.
  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts, order_id)
  SELECT 'order_due', 5, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'order_due' AND o.order_id = c.order_id AND o.message_id IS NULL), 0),
         -- The minutes left, rounded up and never below 0: an hour of order_rules() is hour_minutes minutes.
         jsonb_build_object('dueAt', public.alert_time(c.deadline_at),
                            'minutesLeft', greatest(0, ceil(extract(epoch FROM c.deadline_at - v_now) / extract(epoch FROM make_interval(mins => r.hour_minutes)) * r.hour_minutes))::integer,
                            'itemsOpen', c.items_open),
         c.order_id
    FROM public.legal_order_clock c
    JOIN public.legal_orders lo ON lo.id = c.order_id
   CROSS JOIN LATERAL (
     SELECT CASE WHEN c.deadline_at <= v_now THEN c.deadline_at
                 WHEN c.clock_start + make_interval(mins => r.remind_minutes) <= v_now THEN c.clock_start + make_interval(mins => r.remind_minutes)
            END AS threshold) d
   WHERE lo.closed_at IS NULL AND NOT c.stopped AND c.clock_start IS NOT NULL AND c.items_open > 0 AND d.threshold IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'order_due' AND o.order_id = c.order_id AND o.message_id IS NULL AND o.created_at >= d.threshold)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  -- order_unverified, daily: among the orders that are not closed and are given effect, one count for each of its three
  -- conditions: an item disabled while the order is not verified, or added after its verification; no reasons of the
  -- authority recorded; a DSA order holding a notice with no recorded end. oldestAt is the first disabling among them.
  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts)
  SELECT 'order_unverified', 5, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'order_unverified' AND o.message_id IS NULL AND o.order_id IS NULL), 0),
         jsonb_build_object('count', u.unverified, 'textsMissing', u.texts_missing, 'holdsOpen', u.holds_open, 'oldestAt', public.alert_time(u.oldest_at))
    FROM (SELECT (count(*) FILTER (WHERE q.unverified))::integer AS unverified,
                 (count(*) FILTER (WHERE q.texts_missing))::integer AS texts_missing,
                 (count(*) FILTER (WHERE q.hold_open))::integer AS holds_open,
                 min(q.first_effect) FILTER (WHERE q.unverified OR q.texts_missing OR q.hold_open) AS oldest_at
            FROM (SELECT EXISTS (SELECT 1 FROM public.legal_order_items i
                                  WHERE i.order_id = lo.id AND i.disabled_at IS NOT NULL AND (lo.verified_at IS NULL OR i.added_at > lo.verified_at)) AS unverified,
                         lo.reasons IS NULL AS texts_missing,
                         (public.order_hold_until(lo.id) = 'infinity'::timestamptz
                          AND EXISTS (SELECT 1 FROM public.legal_order_items i JOIN public.decisions d ON d.order_item_id = i.id
                                       WHERE i.order_id = lo.id AND d.informed_at IS NULL)) AS hold_open,
                         (SELECT min(i.disabled_at) FROM public.legal_order_items i WHERE i.order_id = lo.id) AS first_effect
                    FROM public.legal_orders lo
                   WHERE lo.closed_at IS NULL
                     AND EXISTS (SELECT 1 FROM public.legal_order_items i WHERE i.order_id = lo.id AND i.disabled_at IS NOT NULL)) q) u
   WHERE u.unverified + u.texts_missing + u.holds_open > 0
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'order_unverified' AND o.message_id IS NULL AND o.order_id IS NULL AND o.created_at >= v_now - make_interval(days => 1))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  -- 0028 (3f design, section 6.1, the row marked 0026): hold_ending, daily, while an order has an untold decision whose
  -- order_hold_until is less than hold_warning_days ahead, so that whoever has the server checks the mailbox for an
  -- extension before the database releases. Facts: how many held notices, and the first end. A hold with no end
  -- ('infinity') is order_unverified's.
  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts)
  SELECT 'hold_ending', 3, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'hold_ending' AND o.message_id IS NULL AND o.order_id IS NULL), 0),
         jsonb_build_object('count', h.held, 'at', public.alert_time(h.first_end))
    FROM (SELECT count(*)::integer AS held, min(u.until) AS first_end
            FROM (SELECT public.order_hold_until(i.order_id) AS until
                    FROM public.decisions d JOIN public.legal_order_items i ON i.id = d.order_item_id
                   WHERE d.kind = 'order' AND d.informed_at IS NULL) u
           WHERE u.until IS NOT NULL AND u.until < 'infinity'::timestamptz AND u.until < v_now + make_interval(days => r.hold_warning_days)) h
   WHERE h.held > 0
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'hold_ending' AND o.message_id IS NULL AND o.order_id IS NULL AND o.created_at >= v_now - make_interval(days => 1))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  -- 0030 (3f design, section 6.1, the rows marked 0028): report_owed, daily, while at least one notification record is
  -- owed and was opened more than report_alert_hours ago; facts: how many, and the oldest's opening. Counts, no case.
  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts)
  SELECT 'report_owed', 5, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'report_owed' AND o.message_id IS NULL AND o.order_id IS NULL), 0),
         jsonb_build_object('count', q.owed, 'oldestAt', public.alert_time(q.oldest_at))
    FROM (SELECT count(*)::integer AS owed, min(n.opened_at) AS oldest_at
            FROM public.authority_notifications n
           WHERE n.state = 'owed' AND n.opened_at < v_now - make_interval(hours => r.report_alert_hours)) q
   WHERE q.owed > 0
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'report_owed' AND o.message_id IS NULL AND o.order_id IS NULL AND o.created_at >= v_now - make_interval(days => 1))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  -- handover_undestroyed, daily, while a production holds files, was delivered more than handover_alert_days ago and has
  -- no destroyed_at; facts: how many.
  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts)
  SELECT 'handover_undestroyed', 3, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'handover_undestroyed' AND o.message_id IS NULL AND o.order_id IS NULL), 0),
         jsonb_build_object('count', q.undestroyed)
    FROM (SELECT count(*)::integer AS undestroyed
            FROM public.productions p
           WHERE p.files IS NOT NULL AND p.destroyed_at IS NULL AND p.delivered_at < v_now - make_interval(days => r.handover_alert_days)) q
   WHERE q.undestroyed > 0
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'handover_undestroyed' AND o.message_id IS NULL AND o.order_id IS NULL AND o.created_at >= v_now - make_interval(days => 1))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  -- 0031 (3f design, section 6.1, the row marked 0029): copy_overdue, daily, while the newest copy mark is older than
  -- copy_overdue_hours, or there is none and the audit log's first row is that old; facts: the hours since the newest
  -- mark, or since that first row. This function is its one writer: no round of the API raises it as well.
  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts)
  SELECT 'copy_overdue', 3, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'copy_overdue' AND o.message_id IS NULL AND o.order_id IS NULL), 0),
         jsonb_build_object('hours', floor(extract(epoch FROM v_now - q.since) / extract(epoch FROM make_interval(hours => 1)))::integer)
    FROM (SELECT coalesce((SELECT m.at FROM public.copy_marks m ORDER BY m.at DESC, m.id DESC LIMIT 1),
                          (SELECT l.created_at FROM public.audit_log l ORDER BY l.chain_seq LIMIT 1)) AS since) q
   WHERE q.since IS NOT NULL AND q.since < v_now - make_interval(hours => r.copy_overdue_hours)
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'copy_overdue' AND o.message_id IS NULL AND o.order_id IS NULL AND o.created_at >= v_now - make_interval(days => 1))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  -- 0033 (3d design, section 6.1, the row marked 0030): quarantine_due, daily, while a move into the quarantine or back to
  -- the image store has been due for longer than the daily threshold (the contracts' QUARANTINE_RULES.dueHours); facts:
  -- how many images are due in and out together, and since when the oldest is. Counts and one time, no image.
  INSERT INTO public.alert_outbox (kind, priority, scope, step, facts)
  SELECT 'quarantine_due', 3, 'all',
         coalesce((SELECT max(o.step) + 1 FROM public.alert_outbox o
                    WHERE o.kind = 'quarantine_due' AND o.message_id IS NULL AND o.order_id IS NULL), 0),
         jsonb_build_object('count', c.due_in + c.due_out, 'oldestAt', public.alert_time(c.oldest))
    FROM public.quarantine_counts() c
   WHERE c.due_in + c.due_out > 0 AND c.oldest IS NOT NULL AND c.oldest <= v_now - make_interval(days => 1)
     AND NOT EXISTS (SELECT 1 FROM public.alert_outbox o
                      WHERE o.kind = 'quarantine_due' AND o.message_id IS NULL AND o.order_id IS NULL AND o.created_at >= v_now - make_interval(days => 1))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_written := v_written + v_rows;

  RETURN v_written;
END $$;

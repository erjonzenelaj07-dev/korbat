CREATE TYPE "public"."import_source" AS ENUM('x', 'mastodon', 'bluesky');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('uploading', 'scanning', 'ready', 'preparing', 'publishing', 'done', 'stopped', 'undoing', 'undone', 'failed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"source" "import_source" NOT NULL,
	"status" "import_status" DEFAULT 'uploading' NOT NULL,
	"declared_bytes" bigint NOT NULL,
	"received_bytes" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_at" timestamp with time zone,
	"scanned_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"failure" text,
	"stop_reason" text,
	"staff_ended_at" timestamp with time zone,
	"staff_rule_id" text,
	"refused_at_original" date,
	"refused_words" text,
	"scan" jsonb,
	"choice" jsonb,
	"stated_at" timestamp with time zone,
	"seed" "bytea",
	"post_cursor" integer DEFAULT 0 NOT NULL,
	"image_cursor" integer DEFAULT 0 NOT NULL,
	"posts_published" integer DEFAULT 0 NOT NULL,
	"images_kept" integer DEFAULT 0 NOT NULL,
	"images_left_out" integer DEFAULT 0 NOT NULL,
	"posts_removed" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "import_jobs_declared_bytes" CHECK ("import_jobs"."declared_bytes" between 1 and 2147483648),
	CONSTRAINT "import_jobs_received_bytes" CHECK ("import_jobs"."received_bytes" between 0 and "import_jobs"."declared_bytes"),
	CONSTRAINT "import_jobs_failure" CHECK ("import_jobs"."failure" in ('not_this_source', 'not_an_archive', 'tar_gz', 'partial_archive', 'encrypted', 'too_many_entries', 'too_large_uncompressed', 'bad_entry_name', 'unreadable', 'nothing_to_import', 'scan_timed_out', 'interrupted')),
	CONSTRAINT "import_jobs_failed" CHECK (("import_jobs"."status"::text = 'failed') = ("import_jobs"."failure" is not null)),
	CONSTRAINT "import_jobs_stop_reason" CHECK ("import_jobs"."stop_reason" in ('refused_image', 'by_author', 'by_staff', 'time_ran_out')),
	CONSTRAINT "import_jobs_stopped" CHECK (("import_jobs"."status"::text <> 'stopped' or "import_jobs"."stop_reason" is not null) and ("import_jobs"."stop_reason" is null or "import_jobs"."status"::text in ('stopped', 'undoing', 'undone'))),
	CONSTRAINT "import_jobs_staff" CHECK (("import_jobs"."staff_ended_at" is null) = ("import_jobs"."staff_rule_id" is null)),
	CONSTRAINT "import_jobs_refused" CHECK (("import_jobs"."refused_at_original" is null) = ("import_jobs"."refused_words" is null)),
	CONSTRAINT "import_jobs_refused_words" CHECK (char_length("import_jobs"."refused_words") <= 80),
	CONSTRAINT "import_jobs_scan" CHECK (jsonb_typeof("import_jobs"."scan") = 'object' and octet_length("import_jobs"."scan"::text) <= 262144),
	CONSTRAINT "import_jobs_choice" CHECK (jsonb_typeof("import_jobs"."choice") = 'object' and octet_length("import_jobs"."choice"::text) <= 1024),
	CONSTRAINT "import_jobs_stated" CHECK (("import_jobs"."choice" is null) = ("import_jobs"."stated_at" is null)),
	CONSTRAINT "import_jobs_seed" CHECK (octet_length("import_jobs"."seed") = 32),
	CONSTRAINT "import_jobs_counts" CHECK ("import_jobs"."post_cursor" >= 0 and "import_jobs"."image_cursor" >= 0 and "import_jobs"."posts_published" >= 0 and "import_jobs"."images_kept" >= 0 and "import_jobs"."images_left_out" >= 0 and "import_jobs"."posts_removed" >= 0)
);
--> statement-breakpoint
ALTER TABLE "import_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_keys" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"key" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_keys_key" CHECK (octet_length("import_keys"."key") = 32)
);
--> statement-breakpoint
ALTER TABLE "import_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_picks" (
	"import_job_id" uuid NOT NULL,
	"ref" integer NOT NULL,
	"left_out" boolean DEFAULT false NOT NULL,
	"alts" jsonb,
	CONSTRAINT "import_picks_import_job_id_ref_pk" PRIMARY KEY("import_job_id","ref"),
	CONSTRAINT "import_picks_alts" CHECK (case jsonb_typeof("import_picks"."alts") when 'array' then jsonb_array_length("import_picks"."alts") <= 4 and octet_length("import_picks"."alts"::text) <= 16384 else "import_picks"."alts" is null end)
);
--> statement-breakpoint
ALTER TABLE "import_picks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_keys" ADD CONSTRAINT "import_keys_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_picks" ADD CONSTRAINT "import_picks_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_jobs_one_active" ON "import_jobs" USING btree ("owner_id") WHERE status in ('uploading', 'scanning', 'ready', 'preparing', 'publishing');--> statement-breakpoint
CREATE INDEX "import_jobs_status_idx" ON "import_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "import_jobs_owner_idx" ON "import_jobs" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE POLICY "import_jobs_api_all" ON "import_jobs" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "import_keys_api_all" ON "import_keys" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "import_picks_api_all" ON "import_picks" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Everything below is written by hand (3b design, sections 6.1, 6.4 and 6.7; Task 2). As in 0016 to 0042: every function
-- is owned by the migrator, pins its search path to public and pg_temp, names every object schema-qualified and has
-- EXECUTE taken from PUBLIC and given to nobody (each is a plain trigger function: it fires for every role and nobody
-- calls it); an error carries its code as the message under SQLSTATE P0001 (not_found), and a guard's refusal is
-- import_column under SQLSTATE 42501. "For every role but the migrator" means current_user <> 'korbat_migrate'. Every
-- trigger of this file skips the migrator, the two delete rules included (6.1 does not say whether they do), so the tests
-- and the command line can clean up as the migrator, as they clean up every other table. The two enums are new in this
-- file: each function compares them as text (section 6), and the unique index above names its five labels as labels,
-- since an index predicate takes no cast of an enum to text (enum_out is not immutable).
--
-- The CHECKs above hold the contracts' numbers and lists (packages/contracts/src/imports.ts), and
-- apps/api/test/integration/import-schema.test.ts holds each migrated one equal to its constant:
--   import_jobs_declared_bytes   IMPORT_RULES.maxBytes
--   import_jobs_failure          IMPORT_FAILURES
--   import_jobs_stop_reason      IMPORT_STOP_REASONS
--   import_jobs_refused_words    IMPORT_RULES.refusedWordsMax, in code points
--   import_jobs_scan             IMPORT_RULES.scanMaxBytes, the bytes of the jsonb's text form
--   import_jobs_choice           IMPORT_RULES.choiceMaxBytes, the same
--   import_jobs_seed             IMPORT_RULES.seedBytes
--   import_picks_alts            MEDIA_MAX_PER_POST descriptions in IMPORT_RULES.altsMaxBytes (Task 1's amendment: 16,384)
--   import_keys_key              IMPORT_RULES.keyBytes
--   import_jobs_one_active       IMPORT_ACTIVE_STATES, its predicate
--   import_source, import_status IMPORT_SOURCE_KINDS and ImportStatus, the two enums
--
-- 1. The grants (6.4). 0001's default privileges gave the API role every right on a new public table; each table loses
-- them all, then gets what 6.4 lists. import_jobs: read, insert, delete (under import_jobs_delete), and UPDATE of every
-- column but the five that never change (id, owner_id, source, declared_bytes, created_at), all under import_jobs_guard.
-- import_picks: read, insert, delete, and the two columns of a choice, under import_picks_guard. import_keys: read, insert
-- and delete (under import_keys_delete); never an update. korbat_auth and korbat_notify get nothing.
REVOKE ALL ON "public"."import_jobs", "public"."import_picks", "public"."import_keys" FROM korbat_api;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "public"."import_jobs" TO korbat_api;--> statement-breakpoint
GRANT UPDATE ("status", "received_bytes", "uploaded_at", "scanned_at", "confirmed_at", "ended_at", "failure", "stop_reason", "staff_ended_at", "staff_rule_id",
  "refused_at_original", "refused_words", "scan", "choice", "stated_at", "seed", "post_cursor", "image_cursor", "posts_published", "images_kept",
  "images_left_out", "posts_removed") ON "public"."import_jobs" TO korbat_api;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "public"."import_picks" TO korbat_api;--> statement-breakpoint
GRANT UPDATE ("left_out", "alts") ON "public"."import_picks" TO korbat_api;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "public"."import_keys" TO korbat_api;--> statement-breakpoint

-- 2. import_jobs_insert, plain, BEFORE INSERT, for every role but the migrator (6.1): an import is born uploading, at
-- clock_timestamp(), with no byte, count or cursor, and keeps nothing of the insert but its id, its owner, its source and
-- its declared size. An owner whose profile is deleted, or that has no profile, is not_found: the purge marks the profile
-- deleted before it deletes anything (4.7), so no import starts for an account on its way out. Whether the account is
-- live and not suspended is the creating statement's to judge, under 3e's predicate (8.5), not this trigger's.
CREATE FUNCTION "public"."import_jobs_insert"() RETURNS trigger
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
  NEW.posts_removed := 0;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."import_jobs_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "import_jobs_insert" BEFORE INSERT ON "public"."import_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."import_jobs_insert"();--> statement-breakpoint

-- 3. import_jobs_guard, plain, BEFORE UPDATE, for every role but the migrator (6.1). Every refusal is import_column.
--   - id, owner_id, source, declared_bytes and created_at never change.
--   - The state moves only along the eighteen arrows of 4.1, and into undoing from stopped only when posts_published is
--     above 0. An update that keeps the state is no move.
--   - ended_at changes only in a move into done, stopped, undone, failed, cancelled or expired, and is set after it. Every
--     way into undone passed through done or stopped, which set it: the move into undone may set it again (the undo's
--     end), every other move sets it once.
--   - uploaded_at changes only in the move into scanning, which sets it with received_bytes equal to declared_bytes.
--   - scanned_at changes only in the move out of scanning, which sets it.
--   - scan changes only in the move into ready, which sets it, and in the move out of ready (whichever it is), which
--     leaves it without its month table, its samples, its pages and its count of posts skipped as not_public, keeping
--     fromRef and the counts the result screen shows (decision 25).
--   - choice, stated_at, confirmed_at and the seed change only in the move out of ready into preparing or publishing (the
--     confirmation), which sets all four; the seed may later only become null, and the moves into done and stopped leave
--     it null (the import has ended, 6.6).
--   - failure changes only in the move into failed; stop_reason only in the move into stopped (the CHECKs say when each
--     is set).
--   - staff_ended_at and staff_rule_id are set once, in a move into stopped or undoing (8.7); a move into stopped sets
--     them exactly when its reason is by_staff.
--   - refused_at_original and refused_words are set once, in the move into stopped whose reason is refused_image (8.2).
--   - received_bytes, both cursors and the four counts never go down.
CREATE FUNCTION "public"."import_jobs_guard"() RETURNS trigger
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
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."import_jobs_guard"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "import_jobs_guard" BEFORE UPDATE ON "public"."import_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."import_jobs_guard"();--> statement-breakpoint

-- 4. import_jobs_delete, plain, BEFORE DELETE, for every role but the migrator (6.1): a row in an active state or in
-- undoing is deleted only once its owner's profile is deleted (the purge's own transaction marks the profile before it
-- deletes the rows, 4.7). A row a post still names fails on posts' foreign key, which has no on delete clause (6.2).
CREATE FUNCTION "public"."import_jobs_delete"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'korbat_migrate' THEN
    RETURN OLD;
  END IF;
  IF OLD.status::text IN ('uploading', 'scanning', 'ready', 'preparing', 'publishing', 'undoing')
     AND NOT EXISTS (SELECT 1 FROM public.profiles a WHERE a.id = OLD.owner_id AND a.deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."import_jobs_delete"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "import_jobs_delete" BEFORE DELETE ON "public"."import_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."import_jobs_delete"();--> statement-breakpoint

-- 5. import_picks_guard, plain, BEFORE INSERT OR UPDATE, for every role but the migrator (6.1): a pick is written only
-- while its import is ready. The job's row is taken FOR SHARE and read again in a statement of its own, so a pick that
-- meets a confirmation in flight waits for it and then sees the import gone from ready. A pick may be deleted in any
-- state: import-drive deletes them when the import ends, and the job row's cascade does in any case.
CREATE FUNCTION "public"."import_picks_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  job_status text;
BEGIN
  IF current_user = 'korbat_migrate' THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM public.import_jobs j WHERE j.id = NEW.import_job_id FOR SHARE;
  SELECT j.status::text INTO job_status FROM public.import_jobs j WHERE j.id = NEW.import_job_id;
  IF job_status IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."import_picks_guard"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "import_picks_guard" BEFORE INSERT OR UPDATE ON "public"."import_picks" FOR EACH ROW EXECUTE FUNCTION "public"."import_picks_guard"();--> statement-breakpoint

-- 6. import_keys_delete, plain, BEFORE DELETE, for every role but the migrator (6.1): an account's import key goes only
-- once its profile is deleted, so only the purge erases it. It is never updated: the API role holds no UPDATE on it.
CREATE FUNCTION "public"."import_keys_delete"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'korbat_migrate' THEN
    RETURN OLD;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles a WHERE a.id = OLD.owner_id AND a.deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'import_column' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."import_keys_delete"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "import_keys_delete" BEFORE DELETE ON "public"."import_keys" FOR EACH ROW EXECUTE FUNCTION "public"."import_keys_delete"();

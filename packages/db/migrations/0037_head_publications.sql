CREATE TABLE "head_publications" (
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"chain_seq" bigint,
	"value" text NOT NULL,
	"witness" text NOT NULL,
	"token" "bytea",
	"witnessed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"last_day" date,
	CONSTRAINT "head_publications_day_kind_pk" PRIMARY KEY("day","kind"),
	CONSTRAINT "head_publications_kind" CHECK ("head_publications"."kind" in ('head', 'restore')),
	CONSTRAINT "head_publications_witness" CHECK ("head_publications"."witness" in ('none', 'rfc3161', 'test')),
	CONSTRAINT "head_publications_value" CHECK ("head_publications"."value" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "head_publications_token" CHECK (("head_publications"."token" is null) = ("head_publications"."witnessed_at" is null) and ("head_publications"."token" is null or ("head_publications"."witness" <> 'none' and octet_length("head_publications"."token") between 1 and 16384))),
	CONSTRAINT "head_publications_place" CHECK (("head_publications"."chain_seq" is not null and "head_publications"."chain_seq" >= 0) or ("head_publications"."chain_seq" is null and "head_publications"."kind" = 'head' and "head_publications"."retired_at" is not null)),
	CONSTRAINT "head_publications_last_day" CHECK ("head_publications"."last_day" is null or "head_publications"."kind" = 'restore')
);
--> statement-breakpoint
ALTER TABLE "head_publications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alert_outbox" DROP CONSTRAINT "alert_outbox_kind";--> statement-breakpoint
ALTER TABLE "alert_outbox" ADD CONSTRAINT "alert_outbox_kind" CHECK ("alert_outbox"."kind" in ('contact_mail', 'contact_mail_escalated', 'order_due', 'order_opened', 'order_corrected', 'order_effected', 'order_reinstated', 'order_unverified', 'hold_ending', 'report_owed', 'handover_undestroyed', 'copy_overdue', 'copy_taken', 'alert_channel_down', 'mailbox_unreachable', 'alert_test', 'moderation_urgent', 'moderation_waiting', 'moderation_burst', 'moderation_reads', 'moderation_reveal', 'moderation_csam_lifted', 'quarantine_due', 'quarantine_lost', 'release_undestroyed', 'seal_released', 'edge_purge_failed', 'head_unwitnessed', 'head_missed'));--> statement-breakpoint
CREATE POLICY "head_publications_api_all" ON "head_publications" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
-- Everything below is written by hand (3d design, sections 6 and 6.5; Task 5). As in 0016 to 0036: every function is
-- owned by the migrator, pins its search path to public and pg_temp, names every object schema-qualified and has EXECUTE
-- taken from PUBLIC; a guard's refusal is moderation_column under SQLSTATE 42501, as 3c's guards answer.
--
-- 1. The grants. 0001's default privileges gave the API role every right on a new public table; head_publications loses
-- them all, then gets what section 6.5 lists: it reads the rows, inserts the day's row (whose every column but the
-- witness's name the trigger below forces), and sets the token with its time and the time of publication, each once. No
-- DELETE: a published value is public record, and the retention job erases none (7.14).
REVOKE ALL ON "public"."head_publications" FROM korbat_api;--> statement-breakpoint
GRANT SELECT, INSERT ON "public"."head_publications" TO korbat_api;--> statement-breakpoint
GRANT UPDATE ("token", "witnessed_at", "published_at") ON "public"."head_publications" TO korbat_api;--> statement-breakpoint

-- 2. head_value(day, seq, hash): the hex SHA-256 of the UTF-8 text "korbat.head.v2", a line feed, the day as YYYY-MM-DD,
-- a line feed, the place in decimal, a line feed and the hash (section 2, row 9). It shows neither the place nor a row's
-- hash, so nobody counts staff actions or tests a guessed row from it; and the day is in it, so the value differs every
-- day, also over days on which no audit row was written. The keeper, who holds the day, the place and the hash, computes
-- it again. to_char with an explicit pattern prints the day whatever DateStyle says; chr(10) is the line feed.
CREATE FUNCTION "public"."head_value"(day date, seq bigint, hash text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT encode(sha256(convert_to('korbat.head.v2' || chr(10) || to_char($1, 'YYYY-MM-DD') || chr(10) || $2::text || chr(10) || $3, 'UTF8')), 'hex')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."head_value"(date, bigint, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."head_value"(date, bigint, text) TO korbat_api;--> statement-breakpoint

-- 3. head_publications_insert, plain, BEFORE INSERT, for every role but the migrator: the row is a head of today in UTC,
-- its place and value come from audit_head as it stands in this statement, and nothing else is set but the witness's
-- name. So the API's role cannot publish a value of its own making, nor one of another day. The daily publication writes
-- no audit row: it would move the head it publishes (section 15, 3a). The migrator keeps what it supplied: a restore's
-- rows and a test's past days.
CREATE FUNCTION "public"."head_publications_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_seq bigint;
  v_hash text;
BEGIN
  IF current_user = 'korbat_migrate' THEN
    RETURN NEW;
  END IF;
  SELECT a.seq, a.hash INTO v_seq, v_hash FROM public.audit_head a WHERE a.id = 1;
  NEW.kind := 'head';
  NEW.day := (now() AT TIME ZONE 'UTC')::date;
  NEW.chain_seq := v_seq;
  NEW.value := public.head_value(NEW.day, v_seq, v_hash);
  NEW.token := NULL;
  NEW.witnessed_at := NULL;
  NEW.published_at := NULL;
  NEW.retired_at := NULL;
  NEW.last_day := NULL;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."head_publications_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "head_publications_insert" BEFORE INSERT ON "public"."head_publications" FOR EACH ROW EXECUTE FUNCTION "public"."head_publications_insert"();--> statement-breakpoint

-- 4. head_publications_guard, plain, BEFORE UPDATE, for every role but the migrator: the token, its time and the time of
-- publication each change only from null, and nothing else changes; a time set from null is the clock's, whatever the
-- update supplied, so no token and no publication is dated before it happened. The column grants already keep the API's
-- role off every other column; the guard says the same for every role but the migrator, whose updates are a restore's.
CREATE FUNCTION "public"."head_publications_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'korbat_migrate' THEN
    RETURN NEW;
  END IF;
  IF NEW.day IS DISTINCT FROM OLD.day OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.chain_seq IS DISTINCT FROM OLD.chain_seq
     OR NEW.value IS DISTINCT FROM OLD.value OR NEW.witness IS DISTINCT FROM OLD.witness OR NEW.retired_at IS DISTINCT FROM OLD.retired_at
     OR NEW.last_day IS DISTINCT FROM OLD.last_day
     OR (OLD.token IS NOT NULL AND NEW.token IS DISTINCT FROM OLD.token)
     OR (OLD.witnessed_at IS NOT NULL AND NEW.witnessed_at IS DISTINCT FROM OLD.witnessed_at)
     OR (OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at) THEN
    RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
  END IF;
  IF OLD.witnessed_at IS NULL AND NEW.witnessed_at IS NOT NULL THEN
    NEW.witnessed_at := now();
  END IF;
  IF OLD.published_at IS NULL AND NEW.published_at IS NOT NULL THEN
    NEW.published_at := now();
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."head_publications_guard"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "head_publications_guard" BEFORE UPDATE ON "public"."head_publications" FOR EACH ROW EXECUTE FUNCTION "public"."head_publications_guard"();

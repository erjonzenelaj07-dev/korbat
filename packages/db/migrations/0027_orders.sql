ALTER TYPE "public"."moderation_level" ADD VALUE 'disabled';--> statement-breakpoint
ALTER TYPE "public"."post_state" ADD VALUE 'disabled';--> statement-breakpoint
ALTER TYPE "public"."action_kind" ADD VALUE 'disable_by_order';--> statement-breakpoint
ALTER TYPE "public"."action_kind" ADD VALUE 'reinstate_by_order';--> statement-breakpoint
ALTER TYPE "public"."decision_kind" ADD VALUE 'order';--> statement-breakpoint
ALTER TYPE "public"."decision_source" ADD VALUE 'order';--> statement-breakpoint
ALTER TYPE "public"."intake_channel" ADD VALUE 'authority';--> statement-breakpoint
ALTER TYPE "public"."intake_kind" ADD VALUE 'order';--> statement-breakpoint
CREATE TABLE "legal_order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"item_id" uuid,
	"kind" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"effective_at" timestamp with time zone,
	"ground" text,
	"by_staff" uuid,
	"via" text NOT NULL,
	CONSTRAINT "legal_order_events_kind" CHECK ("legal_order_events"."kind" in ('opened', 'annex3_sent', 'grounds_ceased', 'clarification_received', 'annex2_sent', 'receipt_confirmed', 'closed_without_effect', 'reopened', 'hold_extended', 'corrected', 'effect_given', 'reinstated', 'notice_released', 'preservation_ended', 'verified', 'issued_at_set', 'texts_recorded', 'document_recorded', 'received_set', 'sent_at_set', 'due_set', 'hold_ended', 'hold_until_set', 'preservation_extended', 'scrutiny_requested', 'scrutiny_decided', 'tell_person_set', 'person_told', 'imported')),
	CONSTRAINT "legal_order_events_ground" CHECK ((kind = 'annex3_sent' and ground in ('force_majeure', 'manifest_error', 'insufficient_information')) or (kind = 'closed_without_effect' and ground in ('withdrawn', 'annulled', 'scrutiny', 'not_authentic', 'wrong_item', 'not_addressed')) or (kind = 'corrected' and ground in ('entry', 'caution', 'admin')) or (kind = 'reinstated' and ground in ('withdrawn', 'annulled', 'scrutiny', 'not_authentic', 'wrong_item')) or (kind = 'hold_ended' and ground in ('not_authentic', 'annulled', 'released_by_authority', 'not_ordered')) or (kind = 'scrutiny_decided' and ground in ('upheld', 'annulled')) or (kind not in ('annex3_sent', 'closed_without_effect', 'corrected', 'reinstated', 'hold_ended', 'scrutiny_decided') and ground is null)),
	CONSTRAINT "legal_order_events_via" CHECK ("legal_order_events"."via" in ('console', 'cli', 'system')),
	CONSTRAINT "legal_order_events_effective" CHECK ("legal_order_events"."effective_at" <= "legal_order_events"."at")
);
--> statement-breakpoint
ALTER TABLE "legal_order_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "legal_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"link" text NOT NULL,
	"post_id" uuid,
	"added_at" timestamp with time zone NOT NULL,
	"intake_item_id" uuid,
	"decision_id" uuid,
	"action_id" uuid,
	"disabled_at" timestamp with time zone,
	"preserve_until" timestamp with time zone,
	"preserve_ended_at" timestamp with time zone,
	"reinstated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_reason" text,
	CONSTRAINT "legal_order_items_position_key" UNIQUE("order_id","position"),
	CONSTRAINT "legal_order_items_position" CHECK ("legal_order_items"."position" between 1 and 50),
	CONSTRAINT "legal_order_items_link" CHECK (char_length("legal_order_items"."link") between 1 and 500),
	CONSTRAINT "legal_order_items_closed" CHECK (("legal_order_items"."closed_at" is null) = ("legal_order_items"."closed_reason" is null) and "legal_order_items"."closed_reason" in ('no_post', 'not_named', 'withdrawn') and ("legal_order_items"."closed_at" is null or "legal_order_items"."disabled_at" is null))
);
--> statement-breakpoint
ALTER TABLE "legal_order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "legal_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"member_state" text NOT NULL,
	"authority" text NOT NULL,
	"reference" text NOT NULL,
	"channel" text NOT NULL,
	"message_id" uuid,
	"received_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"issued_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"section_c" boolean NOT NULL,
	"emergency" boolean NOT NULL,
	"cross_border" boolean NOT NULL,
	"withhold_from_author" boolean NOT NULL,
	"preserve" boolean NOT NULL,
	"authority_hold_until" timestamp with time zone,
	"hold_basis" text,
	"hold_extended" boolean DEFAULT false NOT NULL,
	"hold_ended_at" timestamp with time zone,
	"hold_end_reason" text,
	"tell_person" text,
	"tell_person_at" timestamp with time zone,
	"opened_by" uuid,
	"opened_via" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_how" text,
	"reasons" text,
	"reasons_salt" text,
	"reasons_digest" text,
	"redress" text,
	"redress_salt" text,
	"redress_digest" text,
	"scope" text,
	"scope_salt" text,
	"scope_digest" text,
	"document_sha256" text,
	"document_bytes" bigint,
	"closed_at" timestamp with time zone,
	"imported_at" timestamp with time zone,
	CONSTRAINT "legal_orders_reference_key" UNIQUE("member_state","authority","reference"),
	CONSTRAINT "legal_orders_kind" CHECK ("legal_orders"."kind" in ('tco_removal', 'dsa_art9', 'dsa_art10')),
	CONSTRAINT "legal_orders_member_state" CHECK ("legal_orders"."member_state" ~ '^[A-Z]{2}$'),
	CONSTRAINT "legal_orders_names" CHECK (char_length("legal_orders"."authority") between 1 and 200 and char_length("legal_orders"."reference") between 1 and 200),
	CONSTRAINT "legal_orders_channel" CHECK ("legal_orders"."channel" in ('mailbox', 'portal', 'post', 'other')),
	CONSTRAINT "legal_orders_opened_via" CHECK ("legal_orders"."opened_via" in ('console', 'cli')),
	CONSTRAINT "legal_orders_received" CHECK ("legal_orders"."received_at" <= "legal_orders"."opened_at" and "legal_orders"."sent_at" <= "legal_orders"."opened_at"),
	CONSTRAINT "legal_orders_issued" CHECK ("legal_orders"."issued_at" <= coalesce("legal_orders"."received_at", "legal_orders"."opened_at")),
	CONSTRAINT "legal_orders_tco" CHECK ((("legal_orders"."kind" <> 'tco_removal' and not "legal_orders"."section_c") or "legal_orders"."withhold_from_author") and ("legal_orders"."kind" <> 'tco_removal' or "legal_orders"."preserve")),
	CONSTRAINT "legal_orders_tell" CHECK (("legal_orders"."tell_person" is null or ("legal_orders"."tell_person" in ('at_effect', 'at_instant', 'never') and "legal_orders"."kind" = 'dsa_art10')) and ("legal_orders"."tell_person_at" is not null) = ("legal_orders"."tell_person" is not distinct from 'at_instant')),
	CONSTRAINT "legal_orders_hold_end" CHECK (("legal_orders"."hold_ended_at" is null) = ("legal_orders"."hold_end_reason" is null) and "legal_orders"."hold_end_reason" in ('not_authentic', 'annulled', 'released_by_authority', 'not_ordered')),
	CONSTRAINT "legal_orders_texts_len" CHECK (char_length("legal_orders"."verified_how") <= 500 and char_length("legal_orders"."hold_basis") <= 500 and char_length("legal_orders"."scope") <= 500 and char_length("legal_orders"."reasons") <= 4000 and char_length("legal_orders"."redress") <= 4000),
	CONSTRAINT "legal_orders_document" CHECK ("legal_orders"."document_sha256" ~ '^[0-9a-f]{64}$' and "legal_orders"."document_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "legal_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "decisions" DROP CONSTRAINT "decisions_ground_law";--> statement-breakpoint
ALTER TABLE "decisions" DROP CONSTRAINT "decisions_restricted";--> statement-breakpoint
ALTER TABLE "decisions" ALTER COLUMN "informed_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "decision_actions" ADD COLUMN "withhold_author" boolean;--> statement-breakpoint
ALTER TABLE "decision_actions" ADD COLUMN "order_ground" text;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "order_item_id" uuid;--> statement-breakpoint
ALTER TABLE "legal_order_events" ADD CONSTRAINT "legal_order_events_order_id_legal_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."legal_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_order_events" ADD CONSTRAINT "legal_order_events_item_id_legal_order_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."legal_order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_order_events" ADD CONSTRAINT "legal_order_events_by_staff_profiles_id_fk" FOREIGN KEY ("by_staff") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_order_items" ADD CONSTRAINT "legal_order_items_order_id_legal_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."legal_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_order_items" ADD CONSTRAINT "legal_order_items_intake_item_id_intake_items_id_fk" FOREIGN KEY ("intake_item_id") REFERENCES "public"."intake_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_orders" ADD CONSTRAINT "legal_orders_message_id_contact_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."contact_messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_orders" ADD CONSTRAINT "legal_orders_opened_by_profiles_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legal_order_events_order_idx" ON "legal_order_events" USING btree ("order_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_order_events_opened_key" ON "legal_order_events" USING btree ("order_id") WHERE kind = 'opened';--> statement-breakpoint
CREATE UNIQUE INDEX "legal_order_items_post_key" ON "legal_order_items" USING btree ("order_id","post_id") WHERE post_id is not null;--> statement-breakpoint
CREATE INDEX "legal_order_items_preserved_idx" ON "legal_order_items" USING btree ("post_id") WHERE preserve_until is not null;--> statement-breakpoint
CREATE INDEX "legal_orders_opened_by_idx" ON "legal_orders" USING btree ("opened_by","opened_at");--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_order_item_id_legal_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."legal_order_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_actions" ADD CONSTRAINT "decision_actions_order_ground" CHECK ("decision_actions"."order_ground" in ('withdrawn', 'annulled', 'scrutiny', 'not_authentic', 'wrong_item'));--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_informed" CHECK ("decisions"."informed_at" is not null or "decisions"."author_mail"::text = 'none');--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_ground_law" CHECK ("decisions"."ground" is distinct from 'illegal' or "decisions"."legal_reference_digest" is not null or "decisions"."kind"::text = 'order');--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_restricted" CHECK ("decisions"."outcome" <> 'restricted' or ("decisions"."ground" is not null and "decisions"."facts_digest" is not null and "decisions"."reason_digest" is not null) or "decisions"."kind"::text = 'order');--> statement-breakpoint
CREATE POLICY "legal_order_events_api_all" ON "legal_order_events" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "legal_order_items_api_all" ON "legal_order_items" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "legal_orders_api_all" ON "legal_orders" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
-- Everything below is written by hand (3f design, section 6.2). As in 0016 to 0026: every function is owned by the
-- migrator, pins its search path to public and pg_temp (and names auth's objects in full), names every object
-- schema-qualified and has EXECUTE taken from PUBLIC; times the database writes are now(), the transaction's start, unless
-- clock_timestamp() is named; errors carry their code as the message under SQLSTATE P0001. "For every role but the
-- migrator" means current_user <> 'korbat_migrate'; inside a definer function the current role is the migrator. No
-- function here holds an interval literal or a number of order_rules(): each is read from there.
--
-- The rule for the eight new values (section 6): ALTER TYPE ... ADD VALUE cannot be used as a literal of the enum before
-- the migrating transaction commits, so they are named only inside PL/pgSQL bodies, which are parsed at their first call;
-- everywhere else a kind is compared as text. No statement of this migration runs a function that touches one.
--
-- 1. The grants. 0001's default privileges gave the API role every write on a new public table; each table loses them
-- all, then gets what section 6.2 lists. The order's row: read, and insert of the columns the console supplies (the
-- trigger forces the rest); no update, ever: a correction, a clock event and a reopening go through definer functions
-- bound to their audit rows. An item: read, insert of the link as named, and the intake item the effect writes. An event:
-- read and insert, of which the trigger lets the API role write `opened` alone.
REVOKE ALL ON "public"."legal_orders", "public"."legal_order_items", "public"."legal_order_events" FROM korbat_api;--> statement-breakpoint
GRANT SELECT ON "public"."legal_orders", "public"."legal_order_items", "public"."legal_order_events" TO korbat_api;--> statement-breakpoint
GRANT INSERT ("id", "kind", "member_state", "authority", "reference", "channel", "message_id", "section_c", "emergency", "cross_border", "withhold_from_author", "opened_by") ON "public"."legal_orders" TO korbat_api;--> statement-breakpoint
GRANT INSERT ("id", "order_id", "position", "link", "post_id") ON "public"."legal_order_items" TO korbat_api;--> statement-breakpoint
GRANT UPDATE ("intake_item_id") ON "public"."legal_order_items" TO korbat_api;--> statement-breakpoint
GRANT INSERT ON "public"."legal_order_events" TO korbat_api;--> statement-breakpoint
-- 2. A removal order's computed end of a hold (section 2, row 24; LAB E): the calendar date of the instant in UTC+3, the
-- easternmost EU seat in summer, plus hold_days (and hold_extension_days once extended), at 00:00 in UTC-1, the Azores in
-- winter. The POSIX names' signs are inverted: Etc/GMT-3 is UTC+3. It names no session time zone, so it gives the same
-- value in any, and is never earlier than the end of the same weekday six weeks later in any zone of the EU's European
-- territory.
CREATE FUNCTION "public"."order_hold_end"(from_instant timestamptz, extended boolean) RETURNS timestamptz
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT (((order_hold_end.from_instant AT TIME ZONE 'Etc/GMT-3')::date + r.hold_days
           + CASE WHEN order_hold_end.extended THEN r.hold_extension_days ELSE 0 END)::timestamp) AT TIME ZONE 'Etc/GMT+1'
    FROM public.order_rules() r
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."order_hold_end"(timestamptz, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."order_hold_end"(timestamptz, boolean) TO korbat_api;--> statement-breakpoint
-- An order's hold, by its kind (section 2, rows 24 and 46): null when the order has no Section C; the end recorded by the
-- command line or a correction when the hold was ended; for a removal order the lesser of the computed end, counted from
-- the order's own time stamp or, until that is recorded, from the receipt (never earlier), or from the opening, and the
-- authority's own written end; for a DSA order the end its authority states, of any length, and 'infinity' while none is
-- recorded. A notice is held while this is later than the clock.
CREATE FUNCTION "public"."order_hold_until"(order_id uuid) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
           WHEN NOT o.section_c THEN NULL
           WHEN o.hold_ended_at IS NOT NULL THEN o.hold_ended_at
           WHEN o.kind = 'tco_removal' THEN least(public.order_hold_end(coalesce(o.issued_at, o.received_at, o.opened_at), o.hold_extended), o.authority_hold_until)
           ELSE coalesce(o.authority_hold_until, 'infinity'::timestamptz) END
    FROM public.legal_orders o WHERE o.id = order_hold_until.order_id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."order_hold_until"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."order_hold_until"(uuid) TO korbat_api;--> statement-breakpoint
-- How long what a removal order disabled is preserved (section 2, row 28): six calendar months in UTC and a day, the form
-- of appeal_deadline, both numbers from order_rules().
CREATE FUNCTION "public"."order_preserve_until"(disabled timestamptz) RETURNS timestamptz
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT ((order_preserve_until.disabled AT TIME ZONE 'UTC') + make_interval(months => r.preserve_months, days => r.preserve_margin_days)) AT TIME ZONE 'UTC'
    FROM public.order_rules() r
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."order_preserve_until"(timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."order_preserve_until"(timestamptz) TO korbat_api;--> statement-breakpoint
-- 3. The clock of a removal order (section 2, row 10; LAB B), with its reader's rights. It starts at the earlier of the
-- receipt and the sending time, and again at the newest restart (a grounds_ceased or a clarification_received, at its
-- effective time); an Annex III newer than that restart stops it, with no deadline. The hour is the order's: items_open
-- counts the items neither disabled nor closed, and within_hour judges the hour only once none is open: whether the last
-- disabling came inside the hour, and true when it came while the clock was stopped. The database records times; it does
-- not judge an Annex III.
CREATE VIEW "public"."legal_order_clock" WITH (security_invoker = true) AS
SELECT o.id AS order_id,
       c.clock_start,
       c.stopped,
       CASE WHEN c.stopped THEN NULL ELSE c.clock_start + make_interval(mins => r.hour_minutes) END AS deadline_at,
       CASE WHEN c.stopped THEN NULL ELSE c.clock_start + make_interval(mins => r.target_minutes) END AS target_at,
       i.items_open,
       i.first_effect_at,
       i.last_effect_at,
       CASE
         WHEN i.items_open > 0 OR i.last_effect_at IS NULL THEN NULL
         WHEN EXISTS (SELECT 1 FROM public.legal_order_events a
                       WHERE a.order_id = o.id AND a.kind = 'annex3_sent' AND a.at <= i.last_effect_at
                         AND NOT EXISTS (SELECT 1 FROM public.legal_order_events x
                                          WHERE x.order_id = o.id AND x.kind IN ('grounds_ceased', 'clarification_received')
                                            AND coalesce(x.effective_at, x.at) >= a.at AND coalesce(x.effective_at, x.at) <= i.last_effect_at)) THEN true
         WHEN c.clock_start IS NULL THEN NULL
         ELSE i.last_effect_at <= c.clock_start + make_interval(mins => r.hour_minutes) END AS within_hour
  FROM public.legal_orders o
 CROSS JOIN public.order_rules() r
 CROSS JOIN LATERAL (
   SELECT max(coalesce(e.effective_at, e.at)) AS restart_at
     FROM public.legal_order_events e WHERE e.order_id = o.id AND e.kind IN ('grounds_ceased', 'clarification_received')) s
 CROSS JOIN LATERAL (
   SELECT greatest(least(o.received_at, o.sent_at), s.restart_at) AS clock_start,
          EXISTS (SELECT 1 FROM public.legal_order_events a
                   WHERE a.order_id = o.id AND a.kind = 'annex3_sent' AND (s.restart_at IS NULL OR a.at > s.restart_at)) AS stopped) c
 CROSS JOIN LATERAL (
   SELECT (count(*) FILTER (WHERE t.disabled_at IS NULL AND t.closed_at IS NULL))::integer AS items_open,
          min(t.disabled_at) AS first_effect_at,
          max(t.disabled_at) AS last_effect_at
     FROM public.legal_order_items t WHERE t.order_id = o.id) i
 WHERE o.kind = 'tco_removal';--> statement-breakpoint
REVOKE ALL ON "public"."legal_order_clock" FROM korbat_api;--> statement-breakpoint
GRANT SELECT ON "public"."legal_order_clock" TO korbat_api;--> statement-breakpoint
-- 4. legal_orders_insert. For every role but the migrator, in this order: the opening account's advisory lock, so two
-- requests at once cannot pass the day's limit together; rate_limited at records_per_day orders that account opened in
-- the last 24 hours, read after the lock; the message's test: a named message must exist (order_needs_message), and its
-- time of receipt becomes the order's, with the channel mailbox; an order that names none is accepted at any time,
-- whatever the watcher's state, with no time of receipt and the channel the person picked. Then it forces when and how
-- the order was opened, and nulls every column of the command line. For every role, the migrator's import included, a
-- removal order and an order whose author must not be told withhold the post from its author, and only a removal order
-- preserves. The migrator keeps what it supplied otherwise (order-open, the import), and its opening defaults to now and
-- `cli`.
CREATE FUNCTION "public"."legal_orders_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_limit integer;
  v_opened integer;
  v_received timestamptz;
BEGIN
  IF current_user <> 'korbat_migrate' THEN
    IF NEW.opened_by IS NULL THEN
      RAISE EXCEPTION 'invalid_request' USING DETAIL = 'opened_by: an order is opened by a staff account.';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('korbat.order_records:' || NEW.opened_by::text, 0));
    SELECT r.records_per_day INTO v_limit FROM public.order_rules() r;
    SELECT count(*) INTO v_opened FROM public.legal_orders o
     WHERE o.opened_by = NEW.opened_by AND o.opened_at > clock_timestamp() - make_interval(days => 1);
    IF v_opened >= v_limit THEN
      RAISE EXCEPTION 'rate_limited';
    END IF;
    IF NEW.message_id IS NOT NULL THEN
      SELECT m.received_at INTO v_received FROM public.contact_messages m WHERE m.id = NEW.message_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'order_needs_message';
      END IF;
      NEW.received_at := v_received;
      NEW.channel := 'mailbox';
    ELSE
      NEW.received_at := NULL;
    END IF;
    NEW.opened_at := clock_timestamp();
    NEW.opened_via := 'console';
    NEW.sent_at := NULL;
    NEW.issued_at := NULL;
    NEW.due_at := NULL;
    NEW.authority_hold_until := NULL;
    NEW.hold_basis := NULL;
    NEW.hold_extended := false;
    NEW.hold_ended_at := NULL;
    NEW.hold_end_reason := NULL;
    NEW.tell_person := NULL;
    NEW.tell_person_at := NULL;
    NEW.verified_at := NULL;
    NEW.verified_how := NULL;
    NEW.reasons := NULL;
    NEW.reasons_salt := NULL;
    NEW.reasons_digest := NULL;
    NEW.redress := NULL;
    NEW.redress_salt := NULL;
    NEW.redress_digest := NULL;
    NEW.scope := NULL;
    NEW.scope_salt := NULL;
    NEW.scope_digest := NULL;
    NEW.document_sha256 := NULL;
    NEW.document_bytes := NULL;
    NEW.closed_at := NULL;
    NEW.imported_at := NULL;
  ELSE
    IF NEW.message_id IS NOT NULL THEN
      SELECT m.received_at INTO v_received FROM public.contact_messages m WHERE m.id = NEW.message_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'order_needs_message';
      END IF;
      NEW.received_at := coalesce(NEW.received_at, v_received);
      NEW.channel := 'mailbox';
    END IF;
    NEW.opened_at := coalesce(NEW.opened_at, clock_timestamp());
    NEW.opened_via := coalesce(NEW.opened_via, 'cli');
  END IF;
  NEW.withhold_from_author := NEW.withhold_from_author OR NEW.kind = 'tco_removal' OR NEW.section_c;
  NEW.preserve := NEW.kind = 'tco_removal';
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."legal_orders_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "legal_orders_insert" BEFORE INSERT ON "public"."legal_orders" FOR EACH ROW EXECUTE FUNCTION "public"."legal_orders_insert"();--> statement-breakpoint
-- legal_order_items_insert: for every role but the migrator an item is added now (so an item added after the order's
-- verification reads as unverified), only to an order that is not closed (order_closed), and with nothing the ledger or a
-- correction writes: its intake item, decision, measure, disabling, preservation, reinstatement and closing are null. The
-- migrator (the import) keeps what it supplied, and an item's time defaults to now.
CREATE FUNCTION "public"."legal_order_items_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user <> 'korbat_migrate' THEN
    IF EXISTS (SELECT 1 FROM public.legal_orders o WHERE o.id = NEW.order_id AND o.closed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'order_closed';
    END IF;
    NEW.added_at := clock_timestamp();
    NEW.intake_item_id := NULL;
    NEW.decision_id := NULL;
    NEW.action_id := NULL;
    NEW.disabled_at := NULL;
    NEW.preserve_until := NULL;
    NEW.preserve_ended_at := NULL;
    NEW.reinstated_at := NULL;
    NEW.closed_at := NULL;
    NEW.closed_reason := NULL;
  ELSE
    NEW.added_at := coalesce(NEW.added_at, clock_timestamp());
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."legal_order_items_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "legal_order_items_insert" BEFORE INSERT ON "public"."legal_order_items" FOR EACH ROW EXECUTE FUNCTION "public"."legal_order_items_insert"();--> statement-breakpoint
-- legal_order_events_insert: for every role but the migrator only `opened` is taken (order_event_cli_only for a kind the
-- command line writes, order_event_refused for any other: a console's event has two writers, order_event_record and
-- order_correct, which run as their owner, so a state check the API could step around is none), at the clock's time, by
-- the console, by the account that opened the order, with no item, ground or effective time. The migrator supplies its
-- own time (the import), and a time left out is the clock's.
CREATE FUNCTION "public"."legal_order_events_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user <> 'korbat_migrate' THEN
    IF NEW.kind IN ('verified', 'issued_at_set', 'texts_recorded', 'document_recorded', 'received_set', 'sent_at_set', 'due_set', 'hold_extended',
                    'hold_ended', 'hold_until_set', 'preservation_extended', 'scrutiny_requested', 'scrutiny_decided', 'reopened', 'tell_person_set',
                    'person_told', 'imported') THEN
      RAISE EXCEPTION 'order_event_cli_only';
    END IF;
    IF NEW.kind IS DISTINCT FROM 'opened' THEN
      RAISE EXCEPTION 'order_event_refused' USING DETAIL = 'kind: the API role records only the opening of an order.';
    END IF;
    NEW.at := clock_timestamp();
    NEW.via := 'console';
    NEW.item_id := NULL;
    NEW.ground := NULL;
    NEW.effective_at := NULL;
    NEW.by_staff := (SELECT o.opened_by FROM public.legal_orders o WHERE o.id = NEW.order_id);
  ELSE
    NEW.at := coalesce(NEW.at, clock_timestamp());
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."legal_order_events_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "legal_order_events_insert" BEFORE INSERT ON "public"."legal_order_events" FOR EACH ROW EXECUTE FUNCTION "public"."legal_order_events_insert"();--> statement-breakpoint
-- legal_order_events_confirmed, deferred to the commit: a console's event other than the opening stands only with its
-- audit row, as a decision does (decision_holds). The transaction's head audit row must be the matching action on this
-- order (order_event_recorded for the events of order_event_record, order_corrected for a `corrected`), must name this
-- event (metadata.eventId) and must have been written by the event's account; it carries a step-up, except a correction
-- under the rules entry and caution. Otherwise the commit is refused (order_event_refused). It only reads, so the audit row
-- stays the transaction's last write; it runs as its owner, which reads the audit head whatever the caller holds.
CREATE FUNCTION "public"."legal_order_events_confirmed"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a public.audit_log;
  expected text;
BEGIN
  expected := CASE WHEN NEW.kind = 'corrected' THEN 'order_corrected' ELSE 'order_event_recorded' END;
  SELECT l.* INTO a FROM public.audit_head h JOIN public.audit_log l ON l.chain_seq = h.seq WHERE h.id = 1;
  IF NOT FOUND OR a.action IS DISTINCT FROM expected OR a.target_type IS DISTINCT FROM 'order' OR a.target_id IS DISTINCT FROM NEW.order_id::text THEN
    RAISE EXCEPTION 'order_event_refused' USING DETAIL = 'audit: the transaction''s last audit row is not this action on this order.';
  END IF;
  IF a.metadata ->> 'eventId' IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION 'order_event_refused' USING DETAIL = 'eventId: the audit row does not name this event.';
  END IF;
  IF a.actor_id IS DISTINCT FROM NEW.by_staff THEN
    RAISE EXCEPTION 'order_event_refused' USING DETAIL = 'actor: the audit row was written by another account than the event''s.';
  END IF;
  IF a.step_up IS NULL AND (NEW.kind <> 'corrected' OR NEW.ground = 'admin') THEN
    RAISE EXCEPTION 'order_event_refused' USING DETAIL = 'stepUp: the audit row carries no confirmation.';
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."legal_order_events_confirmed"() FROM PUBLIC;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "legal_order_events_confirmed" AFTER INSERT ON "public"."legal_order_events" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.via = 'console' AND NEW.kind <> 'opened') EXECUTE FUNCTION "public"."legal_order_events_confirmed"();--> statement-breakpoint
-- 5. order_event_record: the one writer of the six clock events (annex3_sent, grounds_ceased, clarification_received,
-- annex2_sent, receipt_confirmed, closed_without_effect) and of the console's reopened and hold_extended (section 6.2). It
-- runs as its owner, since the API role cannot update an order, and its fifth argument is the acting account, which
-- legal_order_events_confirmed holds to the audit row a key confirmed, so it is not taken on trust. In this order:
--   1. The order's row FOR UPDATE: a closing, a correction, a hold's end and the time stamp commit before it or wait.
--      order_closed when the order is closed, for every kind but reopened, which is refused unless it is.
--   2. In a statement of its own, the acting account's auth.users row FOR SHARE: live staff (staff_confirmation_ended
--      otherwise), and an admin for closed_without_effect, reopened and hold_extended (admin_required).
--   3. The kind fits the order, each refusal order_event_refused unless a code is named: the clock's events and the
--      extension on a removal order, receipt_confirmed on a DSA order; an Annex III with a ground of its list only while
--      the clock runs; a restart only while it is stopped, by the newest Annex III's ground (grounds_ceased after
--      force_majeure, clarification_received after the other two), so every Annex III has exactly one restart; Annex II
--      only once an item is disabled; a closing with a ground of its list only while no item's measure stands; the
--      extension only with Section C, once, with a message, and already_released once a notice of the order was released
--      or its hold ended. A clarification and an extension name their message (order_needs_message); a named message
--      must exist.
--   4. The effective time: the named message's time of receipt, or none (the event's own time). For a restart, the later
--      of that (or now) and the newest Annex III's time: an Annex III sent at 10:00 and recorded at 10:30, with the
--      clarification of 10:20, restarts the clock at 10:30, the cautious reading; nothing is refused for its time.
--   5. A named message without a disposition gets clarification, by the acting account, at now(): the function sets the
--      time itself, since contact_messages_guard forces nothing for its owner.
--   6. A closing sets closed_at, a reopening clears it, the extension sets hold_extended.
--   7. It inserts the event, by the console, and answers its id.
CREATE FUNCTION "public"."order_event_record"(order_id uuid, kind text, ground text, message_id uuid, by_staff uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  o public.legal_orders;
  v_role text;
  v_received timestamptz;
  v_annex_at timestamptz;
  v_annex_ground text;
  v_restart_at timestamptz;
  v_stopped boolean;
  v_effective timestamptz;
  v_now timestamptz;
  v_event uuid;
BEGIN
  SELECT x.* INTO o FROM public.legal_orders x WHERE x.id = order_event_record.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF order_event_record.kind = 'reopened' THEN
    IF o.closed_at IS NULL THEN
      RAISE EXCEPTION 'order_event_refused' USING DETAIL = 'reopened: the order is not closed.';
    END IF;
  ELSIF o.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'order_closed';
  END IF;

  SELECT u.role::text INTO v_role FROM auth.users u
   WHERE u.id = order_event_record.by_staff AND u.deleted_at IS NULL AND u.role <> 'user' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_confirmation_ended';
  END IF;
  IF order_event_record.kind IN ('closed_without_effect', 'reopened', 'hold_extended') AND v_role <> 'admin' THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF order_event_record.kind NOT IN ('annex3_sent', 'grounds_ceased', 'clarification_received', 'annex2_sent', 'receipt_confirmed', 'closed_without_effect', 'reopened', 'hold_extended') THEN
    RAISE EXCEPTION 'order_event_refused' USING DETAIL = 'kind: not an event the console records.';
  END IF;
  IF (order_event_record.kind = 'annex3_sent' AND coalesce(order_event_record.ground IN ('force_majeure', 'manifest_error', 'insufficient_information'), false) = false)
     OR (order_event_record.kind = 'closed_without_effect' AND coalesce(order_event_record.ground IN ('withdrawn', 'annulled', 'scrutiny', 'not_authentic', 'wrong_item', 'not_addressed'), false) = false)
     OR (order_event_record.kind NOT IN ('annex3_sent', 'closed_without_effect') AND order_event_record.ground IS NOT NULL) THEN
    RAISE EXCEPTION 'order_event_refused' USING DETAIL = 'ground: not one of this event''s grounds.';
  END IF;
  IF order_event_record.kind IN ('annex3_sent', 'grounds_ceased', 'clarification_received', 'annex2_sent', 'hold_extended') AND o.kind <> 'tco_removal' THEN
    RAISE EXCEPTION 'order_event_refused' USING DETAIL = 'kind: only a removal order has this event.';
  END IF;
  IF order_event_record.kind = 'receipt_confirmed' AND o.kind = 'tco_removal' THEN
    RAISE EXCEPTION 'order_event_refused' USING DETAIL = 'kind: only a DSA order has this event.';
  END IF;
  IF order_event_record.kind IN ('clarification_received', 'hold_extended') AND order_event_record.message_id IS NULL THEN
    RAISE EXCEPTION 'order_needs_message';
  END IF;
  IF order_event_record.message_id IS NOT NULL THEN
    IF order_event_record.kind NOT IN ('grounds_ceased', 'clarification_received', 'hold_extended') THEN
      RAISE EXCEPTION 'order_event_refused' USING DETAIL = 'messageId: this event names no message.';
    END IF;
    SELECT m.received_at INTO v_received FROM public.contact_messages m WHERE m.id = order_event_record.message_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'order_needs_message';
    END IF;
  END IF;

  -- The clock as it stands: the newest restart's effective time, and the newest Annex III with its ground.
  SELECT max(coalesce(e.effective_at, e.at)) INTO v_restart_at FROM public.legal_order_events e
   WHERE e.order_id = o.id AND e.kind IN ('grounds_ceased', 'clarification_received');
  SELECT e.at, e.ground INTO v_annex_at, v_annex_ground FROM public.legal_order_events e
   WHERE e.order_id = o.id AND e.kind = 'annex3_sent' ORDER BY e.at DESC, e.id DESC LIMIT 1;
  v_stopped := v_annex_at IS NOT NULL AND (v_restart_at IS NULL OR v_annex_at > v_restart_at);
  IF order_event_record.kind = 'annex3_sent' AND v_stopped THEN
    RAISE EXCEPTION 'order_event_refused' USING DETAIL = 'annex3_sent: the clock is stopped already.';
  END IF;
  IF order_event_record.kind = 'grounds_ceased' AND NOT (v_stopped AND v_annex_ground = 'force_majeure') THEN
    RAISE EXCEPTION 'order_event_refused' USING DETAIL = 'grounds_ceased: no Annex III for force majeure stops the clock.';
  END IF;
  IF order_event_record.kind = 'clarification_received' AND NOT (v_stopped AND v_annex_ground IN ('manifest_error', 'insufficient_information')) THEN
    RAISE EXCEPTION 'order_event_refused' USING DETAIL = 'clarification_received: no Annex III for an error or missing information stops the clock.';
  END IF;
  IF order_event_record.kind = 'annex2_sent' AND NOT EXISTS (SELECT 1 FROM public.legal_order_items i WHERE i.order_id = o.id AND i.disabled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'order_event_refused' USING DETAIL = 'annex2_sent: no item of the order is disabled.';
  END IF;
  IF order_event_record.kind = 'closed_without_effect'
     AND EXISTS (SELECT 1 FROM public.legal_order_items i JOIN public.measures_in_force m ON m.id = i.action_id WHERE i.order_id = o.id) THEN
    RAISE EXCEPTION 'order_event_refused' USING DETAIL = 'closed_without_effect: a measure of the order is in force.';
  END IF;
  IF order_event_record.kind = 'hold_extended' THEN
    IF NOT o.section_c OR o.hold_extended THEN
      RAISE EXCEPTION 'order_event_refused' USING DETAIL = 'hold_extended: the order holds no notice, or its hold was extended once.';
    END IF;
    IF o.hold_ended_at IS NOT NULL OR EXISTS (SELECT 1 FROM public.legal_order_events e WHERE e.order_id = o.id AND e.kind = 'notice_released') THEN
      RAISE EXCEPTION 'already_released';
    END IF;
  END IF;

  v_now := clock_timestamp();
  v_effective := v_received;
  IF order_event_record.kind IN ('grounds_ceased', 'clarification_received') THEN
    v_effective := greatest(coalesce(v_received, v_now), v_annex_at);
  END IF;

  IF order_event_record.message_id IS NOT NULL THEN
    UPDATE public.contact_messages m SET disposition = 'clarification', handled_by = order_event_record.by_staff, handled_at = now()
     WHERE m.id = order_event_record.message_id AND m.disposition IS NULL;
  END IF;

  IF order_event_record.kind = 'closed_without_effect' THEN
    UPDATE public.legal_orders x SET closed_at = now() WHERE x.id = o.id;
  ELSIF order_event_record.kind = 'reopened' THEN
    UPDATE public.legal_orders x SET closed_at = NULL WHERE x.id = o.id;
  ELSIF order_event_record.kind = 'hold_extended' THEN
    UPDATE public.legal_orders x SET hold_extended = true WHERE x.id = o.id;
  END IF;

  INSERT INTO public.legal_order_events (order_id, kind, at, effective_at, ground, by_staff, via)
  VALUES (o.id, order_event_record.kind, v_now, least(v_effective, v_now), order_event_record.ground, order_event_record.by_staff, 'console')
  RETURNING id INTO v_event;
  RETURN v_event;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."order_event_record"(uuid, text, text, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."order_event_record"(uuid, text, text, uuid, uuid) TO korbat_api;--> statement-breakpoint
-- 6. order_correct: the one writer of what a person entered, after the insert (section 6.2). A record typed wrongly at night
-- must never stand in the way of the hour, and a missed "must not be told" must never end in telling. `facts` holds only
-- the members to change, under the contracts' names (kind, memberState, authority, reference, channel, sectionC,
-- emergency, withholdFromAuthor, crossBorder, which the API sets with memberState, and closeItems, a list of
-- { itemId, reason }); any other member is invalid_request, and so is a channel for an order opened from a message. In
-- this order:
--   1. The order's row FOR UPDATE; order_closed when it is closed. In a statement of its own, the acting account's
--      auth.users row FOR SHARE: live staff.
--   2. Which rule allows it, the event's ground: entry while no item is disabled (anyone, anything); caution once one is,
--      for facts that set Section C and nothing else (anyone: whoever is on call sets it at once); admin once one is, for
--      anything else (an admin, admin_required otherwise; the route asks the key).
--   3. Each named item must be an open item of this order (invalid_request), and is closed now with its reason. An item
--      that was given effect is never closed: a wrong one is reinstated with wrong_item.
--   4. The row's columns, then the forced ones as at the insert: the withholding for a removal order and for Section C,
--      the preservation for a removal order. order_exists when the corrected state, authority and reference are another
--      order's.
--   5. What follows for an order that is given effect, each in a statement of its own (before the ledger's functions of
--      the migration orders_ledger no order is given effect, so nothing reaches this step until then):
--      - Section C became true: every decision about the order's disabled posts made since the first of the order's
--        decisions about that post (the order's decisions, their corrections, and korbat's own decisions told after
--        them, which decisions_record would have held) is untold again: informed_at null, no mail. The release tells
--        them at the hold's end.
--      - Section C became false while a decision of the order is untold: the hold ends now as not_ordered, with the
--        event hold_ended; the next dispatch round tells the author.
--      - The preservation became owed (the kind became a removal order): every item whose measure stands and is not
--        preserved gets order_preserve_until of its decision's time. It stopped being owed: every running preservation
--        ends now, with the event preservation_ended; nothing is erased.
--      - The withholding changed: the withhold_author of the order's measures in force follows it, and moderation_apply
--        derives their posts' level again.
--      These events are the system's.
--   6. It inserts the event corrected with the rule as its ground, by the console, and answers its id. The route then
--      writes the audit row order_corrected, which legal_order_events_confirmed holds to it at commit.
CREATE FUNCTION "public"."order_correct"(order_id uuid, facts jsonb, by_staff uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  o public.legal_orders;
  v_new public.legal_orders;
  v_role text;
  v_rule text;
  v_effect boolean;
  v_key text;
  v_item jsonb;
  v_items integer;
  v_posts uuid[];
  v_event uuid;
BEGIN
  SELECT x.* INTO o FROM public.legal_orders x WHERE x.id = order_correct.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF o.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'order_closed';
  END IF;
  SELECT u.role::text INTO v_role FROM auth.users u
   WHERE u.id = order_correct.by_staff AND u.deleted_at IS NULL AND u.role <> 'user' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_confirmation_ended';
  END IF;

  -- The members: only the list's, each of its type, at least one.
  IF order_correct.facts IS NULL OR jsonb_typeof(order_correct.facts) <> 'object' OR order_correct.facts = '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid_request' USING DETAIL = 'facts: an object with at least one member.';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(order_correct.facts) LOOP
    IF v_key NOT IN ('kind', 'memberState', 'authority', 'reference', 'channel', 'sectionC', 'emergency', 'withholdFromAuthor', 'crossBorder', 'closeItems') THEN
      RAISE EXCEPTION 'invalid_request' USING DETAIL = format('facts: %s is not a member a correction takes.', v_key);
    END IF;
    IF (v_key IN ('sectionC', 'emergency', 'withholdFromAuthor', 'crossBorder') AND jsonb_typeof(order_correct.facts -> v_key) <> 'boolean')
       OR (v_key IN ('kind', 'memberState', 'authority', 'reference', 'channel') AND jsonb_typeof(order_correct.facts -> v_key) <> 'string')
       OR (v_key = 'closeItems' AND jsonb_typeof(order_correct.facts -> v_key) <> 'array') THEN
      RAISE EXCEPTION 'invalid_request' USING DETAIL = format('facts: %s has the wrong type.', v_key);
    END IF;
  END LOOP;
  IF order_correct.facts ? 'channel' AND o.message_id IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_request' USING DETAIL = 'channel: an order opened from a message arrived in the mailbox.';
  END IF;

  v_effect := EXISTS (SELECT 1 FROM public.legal_order_items i WHERE i.order_id = o.id AND i.disabled_at IS NOT NULL);
  IF NOT v_effect THEN
    v_rule := 'entry';
  ELSIF order_correct.facts = '{"sectionC": true}'::jsonb THEN
    v_rule := 'caution';
  ELSE
    v_rule := 'admin';
    IF v_role <> 'admin' THEN
      RAISE EXCEPTION 'admin_required';
    END IF;
  END IF;

  IF order_correct.facts ? 'closeItems' THEN
    v_items := 0;
    FOR v_item IN SELECT jsonb_array_elements(order_correct.facts -> 'closeItems') LOOP
      IF jsonb_typeof(v_item) <> 'object' OR coalesce((v_item ->> 'reason') IN ('no_post', 'not_named', 'withdrawn'), false) = false THEN
        RAISE EXCEPTION 'invalid_request' USING DETAIL = 'closeItems: each is an item and one of the three reasons.';
      END IF;
      UPDATE public.legal_order_items i SET closed_at = now(), closed_reason = v_item ->> 'reason'
       WHERE i.id::text = v_item ->> 'itemId' AND i.order_id = o.id AND i.disabled_at IS NULL AND i.closed_at IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid_request' USING DETAIL = 'closeItems: not an open item of this order.';
      END IF;
      v_items := v_items + 1;
    END LOOP;
    IF v_items = 0 THEN
      RAISE EXCEPTION 'invalid_request' USING DETAIL = 'closeItems: at least one item.';
    END IF;
  END IF;

  BEGIN
    UPDATE public.legal_orders x SET
           kind = coalesce(order_correct.facts ->> 'kind', x.kind),
           member_state = coalesce(order_correct.facts ->> 'memberState', x.member_state),
           authority = coalesce(order_correct.facts ->> 'authority', x.authority),
           reference = coalesce(order_correct.facts ->> 'reference', x.reference),
           channel = coalesce(order_correct.facts ->> 'channel', x.channel),
           section_c = coalesce((order_correct.facts ->> 'sectionC')::boolean, x.section_c),
           emergency = coalesce((order_correct.facts ->> 'emergency')::boolean, x.emergency),
           cross_border = coalesce((order_correct.facts ->> 'crossBorder')::boolean, x.cross_border),
           -- The forced columns follow the corrected ones in the same statement, as at the insert: legal_orders_tco is
           -- checked at each row's update, so a kind made a removal order never stands a moment without them.
           withhold_from_author = coalesce((order_correct.facts ->> 'withholdFromAuthor')::boolean, x.withhold_from_author)
                                  OR coalesce(order_correct.facts ->> 'kind', x.kind) = 'tco_removal'
                                  OR coalesce((order_correct.facts ->> 'sectionC')::boolean, x.section_c),
           preserve = coalesce(order_correct.facts ->> 'kind', x.kind) = 'tco_removal'
     WHERE x.id = o.id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'order_exists';
  END;
  -- A statement of its own reads the row as it now stands.
  SELECT x.* INTO v_new FROM public.legal_orders x WHERE x.id = o.id;

  IF v_effect THEN
    -- The posts the order disabled, each with the time of the order's first decision about it.
    IF v_new.section_c AND NOT o.section_c THEN
      UPDATE public.decisions d SET informed_at = NULL, author_mail = 'none'
        FROM (SELECT i.post_id, min(od.decided_at) AS since
                FROM public.legal_order_items i JOIN public.decisions od ON od.order_item_id = i.id
               WHERE i.order_id = o.id AND i.post_id IS NOT NULL
               GROUP BY i.post_id) p, public.cases c
       WHERE c.id = d.case_id AND c.target_type = 'post' AND c.target_id = p.post_id AND d.decided_at >= p.since
         AND d.informed_at IS NOT NULL;
    END IF;
    IF o.section_c AND NOT v_new.section_c
       AND EXISTS (SELECT 1 FROM public.legal_order_items i JOIN public.decisions d ON d.order_item_id = i.id
                    WHERE i.order_id = o.id AND d.informed_at IS NULL) THEN
      UPDATE public.legal_orders x SET hold_ended_at = now(), hold_end_reason = 'not_ordered' WHERE x.id = o.id AND x.hold_ended_at IS NULL;
      INSERT INTO public.legal_order_events (order_id, kind, at, ground, by_staff, via)
      VALUES (o.id, 'hold_ended', clock_timestamp(), 'not_ordered', NULL, 'system');
    END IF;
    IF v_new.preserve AND NOT o.preserve THEN
      UPDATE public.legal_order_items i SET preserve_until = public.order_preserve_until(d.decided_at)
        FROM public.decisions d
       WHERE i.order_id = o.id AND d.id = i.decision_id AND i.preserve_until IS NULL
         AND EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.id = i.action_id);
    ELSIF o.preserve AND NOT v_new.preserve THEN
      INSERT INTO public.legal_order_events (order_id, item_id, kind, at, by_staff, via)
      SELECT o.id, i.id, 'preservation_ended', clock_timestamp(), NULL, 'system'
        FROM public.legal_order_items i
       WHERE i.order_id = o.id AND i.preserve_until IS NOT NULL AND i.preserve_ended_at IS NULL;
      UPDATE public.legal_order_items i SET preserve_ended_at = now()
       WHERE i.order_id = o.id AND i.preserve_until IS NOT NULL AND i.preserve_ended_at IS NULL;
    END IF;
    IF v_new.withhold_from_author IS DISTINCT FROM o.withhold_from_author THEN
      UPDATE public.decision_actions a SET withhold_author = v_new.withhold_from_author
        FROM public.legal_order_items i
       WHERE i.order_id = o.id AND a.id = i.action_id
         AND EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.id = a.id);
      SELECT array_agg(i.post_id ORDER BY i.post_id) INTO v_posts
        FROM public.legal_order_items i
       WHERE i.order_id = o.id AND i.post_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.id = i.action_id);
      IF v_posts IS NOT NULL THEN
        PERFORM public.moderation_apply(v_posts, true);
      END IF;
    END IF;
  END IF;

  INSERT INTO public.legal_order_events (order_id, kind, at, ground, by_staff, via)
  VALUES (o.id, 'corrected', clock_timestamp(), v_rule, order_correct.by_staff, 'console')
  RETURNING id INTO v_event;
  RETURN v_event;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."order_correct"(uuid, jsonb, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."order_correct"(uuid, jsonb, uuid) TO korbat_api;--> statement-breakpoint
-- 7. append_confirmed_audit, replaced from its one text (0016): its list of actions gains 3f's five, order_event_recorded and
-- order_corrected for this migration's events and corrections, order_effected for the effect of an order (Task 3), and
-- gap_closed and audit_exported for recovery (Task 6). Nothing else changes; CREATE OR REPLACE keeps its owner and grants.
CREATE OR REPLACE FUNCTION "public"."append_confirmed_audit"(actor_id uuid, key_id uuid, action text, target_type text, target_id text, metadata jsonb, staff_session uuid, action_hash text, step_up jsonb, request_id text, expires_ms bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  place bigint;
  stamped timestamptz;
BEGIN
  IF append_confirmed_audit.action IS NULL OR append_confirmed_audit.action NOT IN ('case_decided', 'appeals_reviewed', 'identity_revealed', 'order_event_recorded', 'order_corrected', 'order_effected', 'gap_closed', 'audit_exported') THEN
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
-- 8. alert_steps(), replaced from its text in 0026_messages_alerts with the rows of an order (3f design, section 6.1, the
-- rows marked 0025): a restart's contact_mail, an order's order_due, and the daily order_unverified. Every other line is
-- 0026's, unchanged, its search path public alone.
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

  RETURN v_written;
END $$;

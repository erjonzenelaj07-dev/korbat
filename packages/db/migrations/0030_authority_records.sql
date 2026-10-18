-- Records to authorities (3f design, section 6.5; Task 5, "Records to authorities"). The design numbers it 0028; 3e's
-- dry run ended at 0025 and Tasks 1 to 4 took 0026 to 0029, so it is the next free number. The tables above are
-- generated from packages/db/src/schema (safety.ts and auth.ts); everything below them is written by hand.
--
-- As in 0016 to 0029: every function is owned by the migrator, pins its search path to public and pg_temp (and names
-- every auth object in full), names every object schema-qualified and has EXECUTE taken from PUBLIC. Times the database
-- writes are now(), the transaction's start, unless clock_timestamp() is named; a read that must see what committed while
-- a lock waited is a statement of its own after that lock. Every number is read from order_rules(); the daily threshold
-- of alert_steps() is the rolling "24 hours ago" it already uses. Enum values are compared as text.
--
-- 1. Grants (6.5, 6.7). The three record tables: nothing for korbat_api (the default privileges of 0001 gave it all four),
--    whose one policy lets it see no row; only the command line, as the migrator, reads and writes them, and two definer
--    functions answer what the console and 3d may ask (reports_owed() and seal_report()). auth.report_holds: nothing for
--    korbat_auth, which reads it only through auth.address_held, auth.address_held_until and auth.address_hold_final.
-- 2. The forced times: a record's and a production's opened_at, an event's at. Every writer of these tables is the
--    migrator, so the forcing is unconditional but for one case: a row with imported_at (Task 6's import after a restore)
--    keeps a supplied time that is not after the clock, since a record forced to "opened today" would make report_owed
--    wait another 24 hours and start the three years again. An update keeps the forced times.
-- 3. report_close_unsealed(case): for the case's subject account, when no seal_media of the account is in force, every
--    owed record a seal opened becomes declined with the reason unsealed, and the account's hold is released (declined).
--    It takes the account's hold row FOR UPDATE first, as report_open does. Its callers: decisions_apply, for a final
--    decision that answered a suspect item, after it answered the items; and report_open, for an unseal_media row.
-- 4. report_open(), the trigger decision_actions_report, AFTER INSERT ON decision_actions. It fires after
--    decision_actions_apply, by name, so the image states are derived first. For a seal_media row, taken while deciding or
--    for good, it first takes the subject account's row of auth.report_holds FOR UPDATE, inserting it as released when
--    there is none, and reads the records in a statement of its own after that lock: so a second seal either sees the
--    record still owed, or sees it sent and opens a new one; it never reads owed while notification-sent commits sent.
--    Then the first of: (1) the account has an owed record a seal opened: the hold's seal_final becomes true for a seal
--    for good, and the record gains the admin's answer's time; (2) report_close_unsealed closed such a record in this
--    transaction (unsealed, closed_at = now()): it is owed again, and its hold unreleased, with their first times (the
--    seal for good that the admin's answer takes after it ended the seal taken while deciding); (3) a new owed record
--    (the case, the seal's row, the account, the first suspect report's time) and the account's hold set (set_at now,
--    seal_final by the seal). For an unseal_media row (a correction or a review lifting a seal) it calls
--    report_close_unsealed for the case. Nothing is mailed to anyone.
-- 5. decisions_apply, replaced from its text in 0028_orders_ledger for one call and nothing else: a final decision that
--    answered a suspect item calls report_close_unsealed(case) at the end of its final branch.
-- 6. reports_owed(): the owed records' case, kind (sealed_images for a seal's record, else its first duty) and since,
--    EXECUTE to korbat_api: everything the console learns. seal_report(action): for 3d's release, whether the seal's
--    record was sent, the authority's reference, its answer's word and day, and when the report was sent (3d's ruling
--    O1); EXECUTE to nobody yet.
-- 7. auth.address_held_until(account), auth.address_held(account) and auth.address_hold_final(account), EXECUTE to
--    korbat_auth: the instant the hold ends at the latest (set_at + report_hold_days, while it is not released and that
--    instant is ahead by clock_timestamp()), whether it is held, and the hold's seal_final. The auth module's finishPurge
--    and the deletion mail read them; after seven days a hold releases nothing by itself and simply reads as not held.
-- 8. erase_authority_records(), EXECUTE to korbat_api for the retention job: deletes a record with its events, and a
--    production, record_keep_years after its newest time, never while a record's seal is in force, a production's archive
--    is not recorded as destroyed, or an authority's "not to the person" still runs (on an event of the record, open or
--    ahead; on a production, ahead); and a hold that is released or expired once its account has no record left. It
--    answers a count and nothing else.
-- 9. alert_steps(), replaced from its text in 0028_orders_ledger with section 6.1's two rows marked 0028: report_owed and
--    handover_undestroyed. Every other line is 0028's, unchanged.
CREATE TABLE "auth"."report_holds" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"set_at" timestamp with time zone NOT NULL,
	"seal_final" boolean NOT NULL,
	"released_at" timestamp with time zone,
	"release_reason" text,
	CONSTRAINT "report_holds_release_reason" CHECK ("auth"."report_holds"."release_reason" in ('sent', 'declined', 'expired')),
	CONSTRAINT "report_holds_released" CHECK ("auth"."report_holds"."release_reason" is null or "auth"."report_holds"."released_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "auth"."report_holds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "authority_notification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"occurred_at" timestamp with time zone,
	"reference" text,
	"how" text NOT NULL,
	"not_to_person" boolean NOT NULL,
	"not_to_person_until" timestamp with time zone,
	CONSTRAINT "authority_notification_events_kind" CHECK ("authority_notification_events"."kind" in ('request', 'answer', 'note')),
	CONSTRAINT "authority_notification_events_until" CHECK ("authority_notification_events"."not_to_person" or "authority_notification_events"."not_to_person_until" is null),
	CONSTRAINT "authority_notification_events_texts" CHECK (char_length("authority_notification_events"."how") between 1 and 500 and char_length("authority_notification_events"."reference") <= 200)
);
--> statement-breakpoint
ALTER TABLE "authority_notification_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "authority_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" text NOT NULL,
	"duties" text[] DEFAULT '{}'::text[] NOT NULL,
	"case_id" uuid,
	"seal_action_id" uuid,
	"account_id" uuid,
	"opened_at" timestamp with time zone NOT NULL,
	"opened_via" text NOT NULL,
	"first_report_at" timestamp with time zone,
	"admin_answer_at" timestamp with time zone,
	"checked_by" text,
	"checked_at" timestamp with time zone,
	"check_result" boolean,
	"check_reason" text,
	"state_concerned" text,
	"state_basis" text,
	"authority" text,
	"channel" text,
	"sent_at" timestamp with time zone,
	"receipt" text,
	"sent_by" text,
	"own_reference" text,
	"their_reference" text,
	"sent_kinds" text[],
	"not_kept_version" smallint,
	"answer" text,
	"answered_at" timestamp with time zone,
	"declined_reason" text,
	"closed_at" timestamp with time zone,
	"imported_at" timestamp with time zone,
	CONSTRAINT "authority_notifications_state" CHECK ("authority_notifications"."state" in ('owed', 'sent', 'declined')),
	CONSTRAINT "authority_notifications_duties" CHECK ("authority_notifications"."duties" <@ array['dsa18_1', 'dsa18_2', 'tco14_5', 'voluntary']::text[]),
	CONSTRAINT "authority_notifications_sent_kinds" CHECK ("authority_notifications"."sent_kinds" <@ array['handle', 'address', 'created_at', 'post_ids', 'post_times', 'report_time', 'files']::text[]),
	CONSTRAINT "authority_notifications_answer" CHECK ("authority_notifications"."answer" in ('not_illegal', 'illegal', 'no_assessment', 'other')),
	CONSTRAINT "authority_notifications_opened_via" CHECK ("authority_notifications"."opened_via" in ('system', 'cli')),
	CONSTRAINT "authority_notifications_seal" CHECK (("authority_notifications"."opened_via" = 'system') = ("authority_notifications"."seal_action_id" is not null)),
	CONSTRAINT "authority_notifications_closed" CHECK (("authority_notifications"."state" = 'owed') = ("authority_notifications"."closed_at" is null)),
	CONSTRAINT "authority_notifications_declined" CHECK (("authority_notifications"."state" = 'declined') = ("authority_notifications"."declined_reason" is not null)),
	CONSTRAINT "authority_notifications_sent" CHECK ("authority_notifications"."state" <> 'sent' or ("authority_notifications"."sent_at" is not null and "authority_notifications"."authority" is not null and "authority_notifications"."channel" is not null and "authority_notifications"."sent_kinds" is not null and cardinality("authority_notifications"."duties") > 0 and "authority_notifications"."not_kept_version" is not null)),
	CONSTRAINT "authority_notifications_answered" CHECK ("authority_notifications"."answer" is null or "authority_notifications"."answered_at" is not null),
	CONSTRAINT "authority_notifications_texts" CHECK (char_length("authority_notifications"."check_reason") <= 500 and char_length("authority_notifications"."state_basis") <= 500 and char_length("authority_notifications"."declined_reason") <= 500 and char_length("authority_notifications"."checked_by") <= 200 and char_length("authority_notifications"."sent_by") <= 200 and char_length("authority_notifications"."authority") <= 200 and char_length("authority_notifications"."channel") <= 200 and char_length("authority_notifications"."receipt") <= 500 and char_length("authority_notifications"."own_reference") <= 200 and char_length("authority_notifications"."their_reference") <= 200)
);
--> statement-breakpoint
ALTER TABLE "authority_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "productions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument" text NOT NULL,
	"notification_id" uuid,
	"order_id" uuid,
	"order_item_id" uuid,
	"seal_action_id" uuid,
	"account_id" uuid,
	"purpose" text,
	"authority" text,
	"own_reference" text,
	"their_reference" text,
	"asked" text[],
	"produced" text[] NOT NULL,
	"not_held" text[],
	"files" jsonb,
	"archive_sha256" text,
	"channel" text,
	"receipt" text,
	"delivered_at" timestamp with time zone,
	"destroyed_at" timestamp with time zone,
	"destroyed_how" text,
	"not_to_person_until" timestamp with time zone,
	"opened_at" timestamp with time zone NOT NULL,
	"recorded_by" text,
	"imported_at" timestamp with time zone,
	CONSTRAINT "productions_instrument" CHECK ("productions"."instrument" in ('notification', 'demand', 'court_order', 'seizure', 'dsa_art10', 'preserved_access')),
	CONSTRAINT "productions_purpose" CHECK (("productions"."instrument" = 'preserved_access') = ("productions"."purpose" is not null)),
	CONSTRAINT "productions_purposes" CHECK ("productions"."purpose"::text in ('review', 'complaint', 'authority')),
	CONSTRAINT "productions_asked" CHECK ("productions"."asked" <@ array['handle', 'address', 'created_at', 'post_ids', 'post_times', 'report_time', 'files']::text[]),
	CONSTRAINT "productions_produced" CHECK ("productions"."produced" <@ array['handle', 'address', 'created_at', 'post_ids', 'post_times', 'report_time', 'files', 'content']::text[]),
	CONSTRAINT "productions_not_held" CHECK ("productions"."not_held" <@ array['name', 'postal_address', 'date_of_birth', 'phone_number', 'ip_address']::text[]),
	CONSTRAINT "productions_archive" CHECK ("productions"."archive_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "productions_files" CHECK (jsonb_typeof("productions"."files") = 'array'),
	CONSTRAINT "productions_destroyed" CHECK (("productions"."destroyed_at" is null) = ("productions"."destroyed_how" is null)),
	CONSTRAINT "productions_texts" CHECK (char_length("productions"."authority") <= 200 and char_length("productions"."own_reference") <= 200 and char_length("productions"."their_reference") <= 200 and char_length("productions"."channel") <= 200 and char_length("productions"."receipt") <= 500 and char_length("productions"."destroyed_how") <= 500 and char_length("productions"."recorded_by") <= 200)
);
--> statement-breakpoint
ALTER TABLE "productions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "authority_notification_events" ADD CONSTRAINT "authority_notification_events_notification_id_authority_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."authority_notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "authority_notification_events_notification_idx" ON "authority_notification_events" USING btree ("notification_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "authority_notifications_owed_seal_key" ON "authority_notifications" USING btree ("account_id") WHERE state = 'owed' and opened_via = 'system';--> statement-breakpoint
CREATE INDEX "authority_notifications_owed_idx" ON "authority_notifications" USING btree ("opened_at") WHERE state = 'owed';--> statement-breakpoint
CREATE INDEX "authority_notifications_account_idx" ON "authority_notifications" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "authority_notifications_case_idx" ON "authority_notifications" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "productions_undestroyed_idx" ON "productions" USING btree ("delivered_at") WHERE files is not null and destroyed_at is null;--> statement-breakpoint
CREATE INDEX "productions_account_idx" ON "productions" USING btree ("account_id");--> statement-breakpoint
CREATE POLICY "report_holds_auth_none" ON "auth"."report_holds" AS PERMISSIVE FOR SELECT TO "korbat_auth" USING (false);--> statement-breakpoint
CREATE POLICY "authority_notification_events_api_none" ON "authority_notification_events" AS PERMISSIVE FOR SELECT TO "korbat_api" USING (false);--> statement-breakpoint
CREATE POLICY "authority_notifications_api_none" ON "authority_notifications" AS PERMISSIVE FOR SELECT TO "korbat_api" USING (false);--> statement-breakpoint
CREATE POLICY "productions_api_none" ON "productions" AS PERMISSIVE FOR SELECT TO "korbat_api" USING (false);--> statement-breakpoint
-- 1. Grants.
REVOKE ALL ON "public"."authority_notifications", "public"."authority_notification_events", "public"."productions" FROM korbat_api;--> statement-breakpoint
REVOKE ALL ON "auth"."report_holds" FROM korbat_auth;--> statement-breakpoint

-- 2. The forced times. One function for the three tables, by the table's name.
CREATE FUNCTION "public"."authority_records_times"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  imported boolean;
BEGIN
  IF TG_TABLE_NAME = 'authority_notification_events' THEN
    IF TG_OP = 'UPDATE' THEN
      NEW.at := OLD.at;
      RETURN NEW;
    END IF;
    -- An event of an imported record keeps a supplied time that is not after the clock.
    imported := EXISTS (SELECT 1 FROM public.authority_notifications n WHERE n.id = NEW.notification_id AND n.imported_at IS NOT NULL);
    IF NOT imported OR NEW.at IS NULL OR NEW.at > clock_timestamp() THEN
      NEW.at := now();
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.opened_at := OLD.opened_at;
    NEW.imported_at := OLD.imported_at;
    RETURN NEW;
  END IF;
  IF NEW.imported_at IS NOT NULL THEN
    NEW.imported_at := now();
    IF NEW.opened_at IS NULL OR NEW.opened_at > clock_timestamp() THEN
      NEW.opened_at := now();
    END IF;
  ELSE
    NEW.opened_at := now();
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."authority_records_times"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "authority_notifications_times" BEFORE INSERT OR UPDATE ON "public"."authority_notifications" FOR EACH ROW EXECUTE FUNCTION "public"."authority_records_times"();--> statement-breakpoint
CREATE TRIGGER "authority_notification_events_times" BEFORE INSERT OR UPDATE ON "public"."authority_notification_events" FOR EACH ROW EXECUTE FUNCTION "public"."authority_records_times"();--> statement-breakpoint
CREATE TRIGGER "productions_times" BEFORE INSERT OR UPDATE ON "public"."productions" FOR EACH ROW EXECUTE FUNCTION "public"."authority_records_times"();--> statement-breakpoint

-- 3. report_close_unsealed(case). The case's subject is its account, or its post's author.
CREATE FUNCTION "public"."report_close_unsealed"(case_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_account uuid;
  v_closed integer;
BEGIN
  SELECT CASE WHEN c.target_type = 'account' THEN c.target_id ELSE (SELECT p.author_id FROM public.posts p WHERE p.id = c.target_id) END
    INTO v_account
    FROM public.cases c WHERE c.id = report_close_unsealed.case_id;
  IF v_account IS NULL THEN
    RETURN 0;
  END IF;
  -- The hold's row first, as report_open and the command line take it.
  PERFORM 1 FROM auth.report_holds h WHERE h.user_id = v_account FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.kind::text = 'seal_media' AND m.subject_account_id = v_account) THEN
    RETURN 0;
  END IF;
  UPDATE public.authority_notifications n
     SET state = 'declined', declined_reason = 'unsealed', closed_at = now()
   WHERE n.account_id = v_account AND n.state = 'owed' AND n.opened_via = 'system';
  GET DIAGNOSTICS v_closed = ROW_COUNT;
  UPDATE auth.report_holds h SET released_at = now(), release_reason = 'declined' WHERE h.user_id = v_account AND h.released_at IS NULL;
  RETURN v_closed;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."report_close_unsealed"(uuid) FROM PUBLIC;--> statement-breakpoint

-- 4. report_open(), the trigger decision_actions_report.
CREATE FUNCTION "public"."report_open"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d record;
  v_final boolean;
  v_record uuid;
BEGIN
  IF NEW.kind::text NOT IN ('seal_media', 'unseal_media') THEN
    RETURN NULL;
  END IF;
  SELECT x.case_id, x.kind::text AS kind, x.decided_at INTO d FROM public.decisions x WHERE x.id = NEW.decision_id;
  IF NEW.kind::text = 'unseal_media' THEN
    PERFORM public.report_close_unsealed(d.case_id);
    RETURN NULL;
  END IF;
  v_final := d.kind <> 'interim';

  -- The account's hold row, inserted as released when there is none, then locked.
  INSERT INTO auth.report_holds (user_id, set_at, seal_final, released_at)
  VALUES (NEW.subject_account_id, now(), false, now())
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM auth.report_holds h WHERE h.user_id = NEW.subject_account_id FOR UPDATE;

  -- (1) An owed record a seal opened: read in a statement of its own, after the lock.
  SELECT n.id INTO v_record FROM public.authority_notifications n
   WHERE n.account_id = NEW.subject_account_id AND n.state = 'owed' AND n.opened_via = 'system';
  IF FOUND THEN
    IF v_final THEN
      UPDATE auth.report_holds h SET seal_final = true WHERE h.user_id = NEW.subject_account_id;
      UPDATE public.authority_notifications n SET admin_answer_at = coalesce(n.admin_answer_at, d.decided_at) WHERE n.id = v_record;
    END IF;
    RETURN NULL;
  END IF;

  -- (2) A record report_close_unsealed closed in this transaction: owed again, with its first times.
  SELECT n.id INTO v_record FROM public.authority_notifications n
   WHERE n.account_id = NEW.subject_account_id AND n.opened_via = 'system' AND n.state = 'declined'
     AND n.declined_reason = 'unsealed' AND n.closed_at = now()
   ORDER BY n.opened_at DESC, n.id LIMIT 1;
  IF FOUND THEN
    UPDATE public.authority_notifications n
       SET state = 'owed', declined_reason = NULL, closed_at = NULL,
           admin_answer_at = CASE WHEN v_final THEN coalesce(n.admin_answer_at, d.decided_at) ELSE n.admin_answer_at END
     WHERE n.id = v_record;
    UPDATE auth.report_holds h SET released_at = NULL, release_reason = NULL, seal_final = v_final WHERE h.user_id = NEW.subject_account_id;
    RETURN NULL;
  END IF;

  -- (3) A new owed record, and the account's hold set.
  INSERT INTO public.authority_notifications (state, case_id, seal_action_id, account_id, opened_at, opened_via, first_report_at, admin_answer_at)
  VALUES ('owed', d.case_id, NEW.id, NEW.subject_account_id, now(), 'system',
          (SELECT min(i.created_at) FROM public.intake_items i WHERE i.case_id = d.case_id AND i.suspect),
          CASE WHEN v_final THEN d.decided_at END);
  UPDATE auth.report_holds h
     SET set_at = now(), seal_final = v_final, released_at = NULL, release_reason = NULL
   WHERE h.user_id = NEW.subject_account_id;
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."report_open"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "decision_actions_report" AFTER INSERT ON "public"."decision_actions" FOR EACH ROW EXECUTE FUNCTION "public"."report_open"();--> statement-breakpoint

-- 5. decisions_apply, replaced from its text in 0028_orders_ledger, unchanged but for the call of report_close_unsealed
-- at the end of the final branch.
CREATE OR REPLACE FUNCTION "public"."decisions_apply"() RETURNS trigger
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
  reply record;
  answered integer;
  held boolean;
BEGIN
  IF NEW.kind = 'order' THEN
    UPDATE public.intake_items i SET answered_by = NEW.id, outcome = 'restricted_legal'
     WHERE i.id = (SELECT x.intake_item_id FROM public.legal_order_items x WHERE x.id = NEW.order_item_id)
       AND i.case_id = NEW.case_id AND i.answered_by IS NULL;
    GET DIAGNOSTICS answered = ROW_COUNT;
    IF answered <> 1 THEN
      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'An order decision answers its own item.';
    END IF;
    SELECT count(*), min(i.lane), min(i.created_at) INTO open_items, open_lane, oldest
      FROM public.intake_items i WHERE i.case_id = NEW.case_id AND i.answered_by IS NULL;
    UPDATE public.cases k
       SET state_version = k.state_version + 1,
           last_decided_at = now(),
           lane = coalesce(open_lane, 2),
           oldest_open_at = oldest,
           answered_seq = CASE WHEN open_items = 0 THEN k.intake_seq ELSE k.answered_seq END,
           closed_at = CASE WHEN open_items = 0 THEN now() END
     WHERE k.id = NEW.case_id
    RETURNING k.* INTO c;
    IF c.closed_at IS NOT NULL THEN
      PERFORM public.moderation_apply(ARRAY[c.target_id], true);
    END IF;
  ELSIF NEW.kind = 'final' THEN
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
           answered_seq = CASE WHEN open_items = 0 THEN k.intake_seq ELSE NEW.through_seq END,
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
        -- 3f: a statement of its own; on a post whose order's notice is held the telling this makes owed is held too.
        held := c.target_type = 'post' AND public.order_notice_held(c.target_id);
        UPDATE public.decisions d
           SET ended_interim = true,
               author_mail = CASE WHEN d.author_mail = 'none' AND NOT held THEN 'pending'::public.delivery_state ELSE d.author_mail END,
               informed_at = CASE WHEN d.author_mail = 'none' AND held THEN NULL ELSE d.informed_at END
         WHERE d.id = NEW.id;
      END IF;
    END IF;
    -- 0030 (3f design, section 6.5): a final decision that answered a suspect item, after it answered the items, closes
    -- the account's owed records that a seal opened when no seal of the account is left in force, and releases its hold.
    IF EXISTS (SELECT 1 FROM public.intake_items i WHERE i.case_id = NEW.case_id AND i.answered_by = NEW.id AND i.suspect) THEN
      PERFORM public.report_close_unsealed(NEW.case_id);
    END IF;
  ELSE
    UPDATE public.cases k SET state_version = k.state_version + 1, last_decided_at = now() WHERE k.id = NEW.case_id;
  END IF;

  IF NEW.kind = 'review' THEN
    UPDATE public.appeals a
       SET answered_by = NEW.id, result = NEW.outcome::text::public.appeal_result, answered_at = now()
     WHERE a.id = NEW.appeal_id AND a.answered_by IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'case_changed';
    END IF;
  ELSIF NEW.kind = 'correction' AND NEW.outcome = 'reversed' THEN
    UPDATE public.appeals a
       SET answered_by = NEW.id, result = 'reversed', answered_at = now()
     WHERE a.decision_id = NEW.reviews_decision_id AND a.answered_by IS NULL;
  END IF;

  -- 3e: the answer to a reply.
  IF (NEW.kind IN ('review', 'correction') AND NEW.outcome = 'kept') OR (NEW.kind = 'review' AND NEW.outcome = 'partly_reversed') THEN
    FOR reply IN
      SELECT r.action_id, r.on_time, a.subject_account_id
        FROM public.decision_actions a JOIN public.suspension_replies r ON r.action_id = a.id
       WHERE a.decision_id = NEW.reviews_decision_id AND a.kind IN ('suspend', 'terminate') AND r.answered_by IS NULL
       ORDER BY r.action_id
    LOOP
      IF reply.on_time THEN
        PERFORM 1 FROM public.profiles p WHERE p.id = reply.subject_account_id FOR UPDATE;
      END IF;
      UPDATE public.suspension_replies r SET answered_by = NEW.id, answered_at = now() WHERE r.action_id = reply.action_id AND r.answered_by IS NULL;
      IF reply.on_time THEN
        PERFORM public.standing_apply(reply.subject_account_id);
      END IF;
    END LOOP;
  END IF;
  -- 3e: a kept correction of a decision that found no breach withdraws all of its marks together.
  IF NEW.kind = 'correction' AND NEW.outcome = 'kept' THEN
    UPDATE public.unfounded_marks m SET withdrawn_by = NEW.id, withdrawn_at = now()
     WHERE m.decision_id = NEW.reviews_decision_id AND m.withdrawn_by IS NULL;
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

-- 6. reports_owed() and seal_report(action).
CREATE FUNCTION "public"."reports_owed"() RETURNS TABLE (case_id uuid, kind text, since timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT n.case_id, CASE WHEN n.seal_action_id IS NOT NULL THEN 'sealed_images' ELSE n.duties[1] END, n.opened_at
    FROM public.authority_notifications n
   WHERE n.state = 'owed'
   ORDER BY n.opened_at, n.id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."reports_owed"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."reports_owed"() TO korbat_api;--> statement-breakpoint
-- The seal's record is the one it opened, or, for a seal that met its account's record already owed (report_open's first
-- case), the record a seal opened for the account that was open when this seal was taken. It always answers one row:
-- reported false and nulls when the seal has no record.
CREATE FUNCTION "public"."seal_report"(action uuid)
RETURNS TABLE (reported boolean, their_reference text, answer text, answered_at timestamptz, sent_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(f.state = 'sent', false), f.their_reference, f.answer, f.answered_at, f.sent_at
    FROM (SELECT 1) AS one
    LEFT JOIN LATERAL (
      SELECT n.state, n.their_reference, n.answer, n.answered_at, n.sent_at
        FROM public.decision_actions a
        JOIN public.authority_notifications n ON n.account_id = a.subject_account_id AND n.opened_via = 'system'
       WHERE a.id = seal_report.action AND a.kind::text = 'seal_media'
         AND (n.seal_action_id = a.id OR (n.opened_at <= a.created_at AND (n.closed_at IS NULL OR n.closed_at >= a.created_at)))
       ORDER BY (n.seal_action_id = a.id) DESC, n.opened_at DESC, n.id
       LIMIT 1) AS f ON true
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."seal_report"(uuid) FROM PUBLIC;--> statement-breakpoint

-- 7. The auth module's three reads of the hold.
CREATE FUNCTION "auth"."address_held_until"(account uuid) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT h.set_at + make_interval(days => r.report_hold_days)
    FROM auth.report_holds h CROSS JOIN public.order_rules() r
   WHERE h.user_id = address_held_until.account AND h.released_at IS NULL
     AND h.set_at + make_interval(days => r.report_hold_days) > clock_timestamp()
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth"."address_held_until"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth"."address_held_until"(uuid) TO korbat_auth;--> statement-breakpoint
CREATE FUNCTION "auth"."address_held"(account uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.address_held_until(address_held.account) IS NOT NULL
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth"."address_held"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth"."address_held"(uuid) TO korbat_auth;--> statement-breakpoint
CREATE FUNCTION "auth"."address_hold_final"(account uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT h.seal_final FROM auth.report_holds h WHERE h.user_id = address_hold_final.account), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth"."address_hold_final"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth"."address_hold_final"(uuid) TO korbat_auth;--> statement-breakpoint

-- 8. erase_authority_records(). Each delete reads its own rows; a hold goes only once its account has no record left,
-- so it runs last.
CREATE FUNCTION "public"."erase_authority_records"() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r record;
  v_cut timestamptz;
  v_rows integer;
  v_deleted integer := 0;
BEGIN
  SELECT * INTO r FROM public.order_rules();
  v_cut := now() - make_interval(years => r.record_keep_years);

  DELETE FROM public.authority_notifications n
   WHERE greatest(n.opened_at, n.sent_at, n.answered_at, n.closed_at,
                  (SELECT max(greatest(e.at, e.occurred_at)) FROM public.authority_notification_events e WHERE e.notification_id = n.id)) < v_cut
     AND NOT EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.id = n.seal_action_id)
     AND NOT EXISTS (SELECT 1 FROM public.authority_notification_events e
                      WHERE e.notification_id = n.id AND e.not_to_person AND (e.not_to_person_until IS NULL OR e.not_to_person_until > now()));
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_deleted := v_deleted + v_rows;

  DELETE FROM public.productions p
   WHERE greatest(p.opened_at, p.delivered_at, p.destroyed_at) < v_cut
     AND (p.files IS NULL OR p.destroyed_at IS NOT NULL)
     AND (p.not_to_person_until IS NULL OR p.not_to_person_until <= now());
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_deleted := v_deleted + v_rows;

  DELETE FROM auth.report_holds h
   WHERE (h.released_at IS NOT NULL OR h.set_at + make_interval(days => r.report_hold_days) <= now())
     AND NOT EXISTS (SELECT 1 FROM public.authority_notifications n WHERE n.account_id = h.user_id);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_deleted := v_deleted + v_rows;
  RETURN v_deleted;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."erase_authority_records"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."erase_authority_records"() TO korbat_api;--> statement-breakpoint

-- 9. alert_steps(), replaced from its text in 0028_orders_ledger with section 6.1's rows marked 0028: report_owed and
-- handover_undestroyed. Every other line is 0028's, unchanged.
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

  RETURN v_written;
END $$;

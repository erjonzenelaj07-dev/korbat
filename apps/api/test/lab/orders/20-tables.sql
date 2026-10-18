-- LAB 3f, part 1 of the prototype: enum values, tables, columns, relaxed CHECKs, views and plain functions.
-- Everything here is parsed or executed inside the migrating transaction, so no new enum value appears as a literal.
ALTER TYPE public.action_kind ADD VALUE 'disable_by_order';
ALTER TYPE public.action_kind ADD VALUE 'reinstate_by_order';
ALTER TYPE public.decision_kind ADD VALUE 'order';
ALTER TYPE public.decision_source ADD VALUE 'order';
ALTER TYPE public.intake_kind ADD VALUE 'order';
ALTER TYPE public.intake_channel ADD VALUE 'authority';
ALTER TYPE public.moderation_level ADD VALUE 'disabled';
ALTER TYPE public.post_state ADD VALUE 'disabled';

CREATE FUNCTION public.order_rules() RETURNS TABLE (hour interval, target interval, items_per_action integer, items_per_day integer,
  records_per_day integer, hold_east interval, hold_days integer, extension_days integer, preserve_months integer, preserve_margin interval, report_hold interval)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT interval '60 minutes', interval '55 minutes', 10, 50, 20, interval '3 hours', 43, 42, 6, interval '1 day', interval '7 days'
$$;

CREATE TABLE public.contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder text NOT NULL CHECK (folder IN ('inbox', 'junk')),
  uidvalidity bigint NOT NULL,
  uid bigint NOT NULL,
  received_at timestamptz NOT NULL,
  seen_at timestamptz NOT NULL,
  disposition text CHECK (disposition IN ('order', 'referral', 'first_order_notice', 'preservation_request', 'scrutiny_decision', 'clarification', 'not_an_order')),
  handled_by uuid,
  handled_at timestamptz,
  UNIQUE (folder, uidvalidity, uid)
);
CREATE TABLE public.legal_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('tco_removal', 'dsa_art9', 'dsa_art10')),
  member_state text NOT NULL CHECK (member_state ~ '^[A-Z]{2}$'),
  authority text NOT NULL CHECK (char_length(authority) BETWEEN 1 AND 200),
  reference text NOT NULL CHECK (char_length(reference) BETWEEN 1 AND 200),
  channel text NOT NULL CHECK (channel IN ('mailbox', 'portal', 'post', 'other')),
  message_id uuid REFERENCES public.contact_messages,
  received_at timestamptz,
  sent_at timestamptz,
  issued_at timestamptz,
  section_c boolean NOT NULL,
  emergency boolean NOT NULL,
  cross_border boolean NOT NULL,
  withhold_from_author boolean NOT NULL,
  preserve boolean NOT NULL,
  authority_hold_until timestamptz,
  hold_extended boolean NOT NULL DEFAULT false,
  hold_ended_at timestamptz,
  opened_by uuid,
  opened_via text NOT NULL CHECK (opened_via IN ('console', 'cli')),
  opened_at timestamptz NOT NULL,
  verified_at timestamptz,
  closed_at timestamptz,
  imported_at timestamptz,
  UNIQUE (member_state, authority, reference),
  CONSTRAINT legal_orders_received CHECK (received_at <= opened_at AND (sent_at IS NULL OR sent_at <= opened_at)),
  CONSTRAINT legal_orders_tco CHECK (kind <> 'tco_removal' OR (withhold_from_author AND preserve))
);
CREATE TABLE public.legal_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.legal_orders,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 50),
  link text NOT NULL CHECK (char_length(link) <= 500),
  post_id uuid,
  intake_item_id uuid REFERENCES public.intake_items,
  decision_id uuid REFERENCES public.decisions,
  action_id uuid REFERENCES public.decision_actions,
  disabled_at timestamptz,
  preserve_until timestamptz,
  preserve_ended_at timestamptz,
  reinstated_at timestamptz,
  UNIQUE (order_id, position)
);
CREATE INDEX legal_order_items_post_idx ON public.legal_order_items (post_id) WHERE preserve_until IS NOT NULL;
CREATE TABLE public.legal_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.legal_orders,
  item_id uuid REFERENCES public.legal_order_items,
  kind text NOT NULL CHECK (kind IN ('opened', 'annex3_sent', 'grounds_ceased', 'clarification_received', 'annex2_sent', 'receipt_confirmed',
    'effect_given', 'reinstated', 'closed_without_effect', 'verified', 'issued_at_set', 'texts_recorded', 'document_recorded', 'hold_extended',
    'hold_ended', 'notice_released', 'preservation_extended', 'preservation_ended', 'scrutiny_requested', 'scrutiny_decided', 'imported')),
  at timestamptz NOT NULL,
  effective_at timestamptz,
  ground text,
  by_staff uuid,
  via text NOT NULL CHECK (via IN ('console', 'cli', 'system')),
  CONSTRAINT legal_order_events_effective CHECK (effective_at IS NULL OR effective_at <= at)
);
CREATE INDEX legal_order_events_order_idx ON public.legal_order_events (order_id, at);
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_order_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY contact_messages_api ON public.contact_messages FOR ALL TO korbat_api USING (true) WITH CHECK (true);
CREATE POLICY legal_orders_api ON public.legal_orders FOR ALL TO korbat_api USING (true) WITH CHECK (true);
CREATE POLICY legal_order_items_api ON public.legal_order_items FOR ALL TO korbat_api USING (true) WITH CHECK (true);
CREATE POLICY legal_order_events_api ON public.legal_order_events FOR ALL TO korbat_api USING (true) WITH CHECK (true);
-- 0001's default privileges give the API role every write on a new table: take them back, then grant what it needs.
REVOKE ALL ON public.contact_messages, public.legal_orders, public.legal_order_items, public.legal_order_events FROM korbat_api;
GRANT SELECT ON public.contact_messages, public.legal_orders, public.legal_order_items, public.legal_order_events TO korbat_api;
GRANT UPDATE (disposition, handled_by) ON public.contact_messages TO korbat_api;
GRANT INSERT (id, kind, member_state, authority, reference, channel, message_id, section_c, emergency, cross_border, withhold_from_author, opened_by) ON public.legal_orders TO korbat_api;
GRANT INSERT (id, order_id, position, link, post_id) ON public.legal_order_items TO korbat_api;
GRANT UPDATE (intake_item_id) ON public.legal_order_items TO korbat_api;
GRANT INSERT (order_id, item_id, kind, effective_at, ground, by_staff) ON public.legal_order_events TO korbat_api;

-- Forced columns. The functions are plain, so current_user is the role that ran the statement: the migrator (the command
-- line, and the import after a restore) may supply what the API may not.
CREATE FUNCTION public.legal_orders_insert() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user <> 'korbat_migrate' THEN
    NEW.opened_at := clock_timestamp();
    NEW.opened_via := 'console';
    NEW.channel := 'mailbox';
    NEW.received_at := (SELECT m.received_at FROM public.contact_messages m WHERE m.id = NEW.message_id);
    NEW.sent_at := NULL; NEW.issued_at := NULL; NEW.authority_hold_until := NULL; NEW.hold_extended := false; NEW.hold_ended_at := NULL;
    NEW.verified_at := NULL; NEW.closed_at := NULL; NEW.imported_at := NULL;
    IF NEW.message_id IS NULL OR NEW.received_at IS NULL THEN
      RAISE EXCEPTION 'order_needs_message';
    END IF;
  END IF;
  IF NEW.kind = 'tco_removal' THEN
    NEW.withhold_from_author := true;
  END IF;
  NEW.preserve := NEW.kind = 'tco_removal';
  RETURN NEW;
END $$;
CREATE TRIGGER legal_orders_insert BEFORE INSERT ON public.legal_orders FOR EACH ROW EXECUTE FUNCTION public.legal_orders_insert();
CREATE FUNCTION public.legal_order_events_insert() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user <> 'korbat_migrate' THEN
    NEW.at := clock_timestamp();
    NEW.via := 'console';
    IF NEW.kind NOT IN ('opened', 'annex3_sent', 'grounds_ceased', 'clarification_received', 'annex2_sent', 'receipt_confirmed', 'closed_without_effect') THEN
      RAISE EXCEPTION 'order_event_cli_only' USING DETAIL = NEW.kind;
    END IF;
  ELSIF NEW.at IS NULL THEN
    NEW.at := clock_timestamp();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER legal_order_events_insert BEFORE INSERT ON public.legal_order_events FOR EACH ROW EXECUTE FUNCTION public.legal_order_events_insert();

-- The end of a non-disclosure period, never early: the calendar date of the instant in UTC+3 (POSIX 'Etc/GMT-3', the
-- easternmost EU seat in summer), plus 43 days (the day of the event is not counted; the period ends with the last hour
-- of the same weekday six weeks later), plus 42 when extended, at 00:00 in UTC-1 (POSIX 'Etc/GMT+1', the Azores in winter).
CREATE FUNCTION public.order_hold_end(from_instant timestamptz, extended boolean) RETURNS timestamptz
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT (((order_hold_end.from_instant AT TIME ZONE 'Etc/GMT-3')::date + 43 + CASE WHEN order_hold_end.extended THEN 42 ELSE 0 END)::timestamp) AT TIME ZONE 'Etc/GMT+1'
$$;
-- Until when an order's notice is held: null when nothing is held.
CREATE FUNCTION public.order_hold_until(order_id uuid) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN NOT o.section_c THEN NULL
              WHEN o.hold_ended_at IS NOT NULL THEN o.hold_ended_at
              ELSE least(public.order_hold_end(coalesce(o.issued_at, o.received_at, o.opened_at), o.hold_extended),
                         coalesce(o.authority_hold_until, 'infinity'::timestamptz)) END
    FROM public.legal_orders o WHERE o.id = order_hold_until.order_id
$$;
-- Six calendar months in UTC, as appeal_deadline counts them, plus a day.
CREATE FUNCTION public.order_preserve_until(disabled timestamptz) RETURNS timestamptz
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT ((order_preserve_until.disabled AT TIME ZONE 'UTC') + interval '6 months' + interval '1 day') AT TIME ZONE 'UTC'
$$;
-- The clock of a TCO removal order.
CREATE VIEW public.legal_order_clock WITH (security_invoker = true) AS
SELECT o.id AS order_id, s.clock_start, s.stopped,
       CASE WHEN NOT s.stopped THEN s.clock_start + interval '60 minutes' END AS deadline_at,
       CASE WHEN NOT s.stopped THEN s.clock_start + interval '55 minutes' END AS target_at,
       e.first_effect_at,
       e.first_effect_at <= s.clock_start + interval '60 minutes' AS within_hour
  FROM public.legal_orders o
  CROSS JOIN LATERAL (
    SELECT greatest(least(o.received_at, coalesce(o.sent_at, o.received_at)),
                    (SELECT max(coalesce(v.effective_at, v.at)) FROM public.legal_order_events v
                      WHERE v.order_id = o.id AND v.kind IN ('grounds_ceased', 'clarification_received'))) AS clock_start,
           EXISTS (SELECT 1 FROM public.legal_order_events a WHERE a.order_id = o.id AND a.kind = 'annex3_sent'
                    AND a.at > coalesce((SELECT max(coalesce(v.effective_at, v.at)) FROM public.legal_order_events v
                                          WHERE v.order_id = o.id AND v.kind IN ('grounds_ceased', 'clarification_received')), '-infinity')) AS stopped
  ) s
  CROSS JOIN LATERAL (SELECT min(i.disabled_at) AS first_effect_at FROM public.legal_order_items i WHERE i.order_id = o.id) e
 WHERE o.kind = 'tco_removal';
GRANT SELECT ON public.legal_order_clock TO korbat_api;

-- decisions: the order item, a notice that may be held, and the two CHECKs an order decision cannot meet.
ALTER TABLE public.decisions ADD COLUMN order_item_id uuid REFERENCES public.legal_order_items;
ALTER TABLE public.decisions ALTER COLUMN informed_at DROP NOT NULL;
ALTER TABLE public.decisions DROP CONSTRAINT decisions_restricted;
ALTER TABLE public.decisions ADD CONSTRAINT decisions_restricted CHECK (outcome <> 'restricted' OR (ground IS NOT NULL AND ((facts_digest IS NOT NULL AND reason_digest IS NOT NULL) OR kind::text = 'order')));
ALTER TABLE public.decisions DROP CONSTRAINT decisions_ground_law;
ALTER TABLE public.decisions ADD CONSTRAINT decisions_ground_law CHECK (ground IS DISTINCT FROM 'illegal' OR legal_reference_digest IS NOT NULL OR kind::text = 'order');
ALTER TABLE public.decisions ADD CONSTRAINT decisions_informed CHECK (informed_at IS NOT NULL OR order_item_id IS NOT NULL OR reviews_decision_id IS NOT NULL);
ALTER TABLE public.decision_actions ADD COLUMN withhold_author boolean;
ALTER TABLE public.decision_actions ADD COLUMN order_ground text CHECK (order_ground IN ('withdrawn', 'annulled', 'scrutiny', 'not_authentic', 'wrong_item'));

-- "In force" for the new measure: like any measure of a decision that is not interim, until a row reverses it.
CREATE OR REPLACE VIEW public.measures_in_force WITH (security_invoker = true) AS
SELECT a.id, a.kind, a.post_id, a.media_id, a.subject_account_id, d.id AS decision_id, d.kind AS decision_kind, d.case_id
  FROM public.decision_actions a
  JOIN public.decisions d ON d.id = a.decision_id
 WHERE (a.kind IN ('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio') OR a.kind::text = 'disable_by_order')
   AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = a.id)
   AND (d.kind <> 'interim'
     OR CASE WHEN a.kind = 'seal_media'
          THEN EXISTS (SELECT 1 FROM public.intake_items i
                        WHERE i.case_id = d.case_id AND i.suspect AND i.answered_by IS NULL AND i.created_at <= d.decided_at)
          ELSE EXISTS (SELECT 1 FROM public.cases c WHERE c.id = d.case_id AND c.closed_at IS NULL)
        END);

-- The release of held notices: the only writer of an order decision's informed_at after its insert.
CREATE FUNCTION public.order_notices_release() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n integer;
BEGIN
  WITH due AS (
    SELECT d.id, i.id AS item_id, i.order_id
      FROM public.decisions d JOIN public.legal_order_items i ON i.id = d.order_item_id
     WHERE d.informed_at IS NULL AND d.order_item_id IS NOT NULL AND coalesce(public.order_hold_until(i.order_id) <= clock_timestamp(), true)
     ORDER BY d.id FOR UPDATE OF d),
  told AS (
    UPDATE public.decisions d SET informed_at = now(), author_mail = 'pending' FROM due WHERE d.id = due.id RETURNING due.order_id, due.item_id)
  INSERT INTO public.legal_order_events (order_id, item_id, kind, via) SELECT t.order_id, t.item_id, 'notice_released', 'system' FROM told t;
  GET DIAGNOSTICS n = ROW_COUNT;
  -- Corrections (reinstatements) of a held order decision are told with it.
  UPDATE public.decisions r SET informed_at = now(), author_mail = 'pending'
    FROM public.decisions d WHERE r.reviews_decision_id = d.id AND r.informed_at IS NULL AND d.informed_at IS NOT NULL AND d.order_item_id IS NOT NULL;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.order_notices_release() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.order_notices_release() TO korbat_api;

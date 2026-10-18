-- Preservation and retention of authorities' orders (3f design, section 6.4; Task 4, "Preservation, retention and the page
-- status"). Written by hand: this migration changes no table and replaces no function. It adds the four functions the
-- retention job calls (section 7.18): the end of a preservation, the one erasure 3f makes; the orders whose records are
-- due; their erasure; and the deletion of handled contact messages and old outbox rows. The design numbers it 0027; 3e's
-- dry run ended at 0025 and Tasks 1 to 3 took 0026 to 0028, so it is the next free number.
--
-- As in 0016 to 0028: every function is owned by the migrator, pins its search path to public and pg_temp, names every
-- object schema-qualified and has EXECUTE taken from PUBLIC; the four are SECURITY DEFINER with EXECUTE to korbat_api
-- alone, and each checks its own rule again against values the API role cannot set, so an API that asks early, or names
-- the wrong row, changes nothing. Times the database writes are now(), the transaction's start, unless clock_timestamp()
-- is named; errors carry their code as the message under SQLSTATE P0001; a read that must see what committed while a
-- lock waited is a statement of its own after that lock. Every number is read from order_rules(); no interval literal.
--
-- 1. order_preservation_end: the end of a preservation (6.4, 7.11), and the only erasure 3f makes. It answers true when
-- the preservation ended (with or without an erasure) and false when the post is still frozen, which leaves everything
-- as it was for the next round, as redact_r4_body does. In this order:
--   1. The locks, in the order of section 5 (the lock order, item 3): the cases first, in id order in one statement (the
--      case of the item's decision, and every case that holds an unerased snapshot of the post, since step 5 erases
--      those, as redact_r4_body locks the cases of the snapshots it erases: a decision on one of them that had read its
--      snapshot unerased waits for this, and this for it); then the item's row; then the post; then its image rows in id
--      order. The item comes before the post because the effect transaction holds an item's row before it locks any
--      post. An imported item whose measure was never taken again has no decision, so no case of its own.
--   2. In statements of their own: read_committed_only outside READ COMMITTED (the freeze is read below, and gate K and E
--      need a fresh snapshot); not_due unless the item, read again, still has the decision whose case was locked, a
--      preserve_until at or before now() and no preserve_ended_at.
--   3. When the item's measure does not stand: preserve_ended_at = now() and the event preservation_ended. Nothing is
--      erased.
--   4. When post_frozen(post) is still true (an unanswered suspect item, a seal in force, or another order's item that
--      still preserves the post): nothing changes, and it answers false.
--   5. Otherwise, while the measure stands: preserve_ended_at = now(); the post's body blanked and posts.erased_at =
--      now(), the same instant as preserve_ended_at, which is how a reader tells an erasure from an end without one;
--      every image row of the post marked erased; every unerased snapshot of the post, in this case and any other,
--      through erase_snapshots; the case's holds on those images released; moderation_apply, by which an erased post is
--      removed for good; the event preservation_ended, by the system. The image files then go the way every erased
--      image's do: the retention job's disposal deletes the rows, and their files are requested after its commit.
CREATE FUNCTION "public"."order_preservation_end"(item_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_named public.legal_order_items;
  v_item public.legal_order_items;
  v_case uuid;
  v_stands boolean;
  v_frozen boolean;
  v_images uuid[];
BEGIN
  -- 1. What the locks need, read before them: the item's post never changes, and its decision changes only by a new
  -- disabling, which step 2 notices.
  SELECT x.* INTO v_named FROM public.legal_order_items x WHERE x.id = order_preservation_end.item_id;
  IF NOT FOUND OR v_named.post_id IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  SELECT d.case_id INTO v_case FROM public.decisions d WHERE d.id = v_named.decision_id;
  PERFORM 1 FROM public.cases k
    WHERE k.id = v_case
       OR k.id IN (SELECT s.case_id FROM public.evidence_snapshots s
                    WHERE s.target_type = 'post' AND s.target_id = v_named.post_id AND s.erased_at IS NULL)
    ORDER BY k.id FOR UPDATE;
  PERFORM 1 FROM public.legal_order_items x WHERE x.id = v_named.id FOR UPDATE;
  PERFORM 1 FROM public.posts p WHERE p.id = v_named.post_id FOR UPDATE;
  PERFORM 1 FROM public.post_media m WHERE m.post_id = v_named.post_id ORDER BY m.id FOR NO KEY UPDATE;

  -- 2.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'read_committed_only' USING ERRCODE = '25000';
  END IF;
  SELECT x.* INTO v_item FROM public.legal_order_items x WHERE x.id = v_named.id;
  IF v_item.decision_id IS DISTINCT FROM v_named.decision_id OR v_item.preserve_until IS NULL OR v_item.preserve_until > now()
     OR v_item.preserve_ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'not_due';
  END IF;

  -- 3.
  SELECT EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.id = v_item.action_id) INTO v_stands;
  IF NOT v_stands THEN
    UPDATE public.legal_order_items x SET preserve_ended_at = now() WHERE x.id = v_item.id;
    INSERT INTO public.legal_order_events (order_id, item_id, kind, at, by_staff, via)
    VALUES (v_item.order_id, v_item.id, 'preservation_ended', clock_timestamp(), NULL, 'system');
    RETURN true;
  END IF;

  -- 4.
  SELECT public.post_frozen(v_item.post_id) INTO v_frozen;
  IF v_frozen THEN
    RETURN false;
  END IF;

  -- 5.
  UPDATE public.legal_order_items x SET preserve_ended_at = now() WHERE x.id = v_item.id;
  UPDATE public.posts p SET body = '', erased_at = now() WHERE p.id = v_item.post_id;
  SELECT coalesce(array_agg(m.id ORDER BY m.id), '{}'::uuid[]) INTO v_images FROM public.post_media m WHERE m.post_id = v_item.post_id;
  UPDATE public.post_media m SET erased_at = now() WHERE m.post_id = v_item.post_id;
  PERFORM public.erase_snapshots(ARRAY(SELECT s.id FROM public.evidence_snapshots s
                                        WHERE s.target_type = 'post' AND s.target_id = v_item.post_id AND s.erased_at IS NULL));
  IF v_case IS NOT NULL THEN
    PERFORM public.release_case_holds(v_case, v_images);
  END IF;
  PERFORM public.moderation_apply(ARRAY[v_item.post_id], true);
  INSERT INTO public.legal_order_events (order_id, item_id, kind, at, by_staff, via)
  VALUES (v_item.order_id, v_item.id, 'preservation_ended', clock_timestamp(), NULL, 'system');
  RETURN true;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."order_preservation_end"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."order_preservation_end"(uuid) TO korbat_api;--> statement-breakpoint
-- 2. order_records_due(): the orders whose records are due (6.4, 6.8, row 42): the newest event of the order is older
-- than record_keep_years; no measure of any of its decisions is in force; no item of it has a preservation that has not
-- ended; and no decision about one of its items' posts is untold (informed_at null): the order's own decisions, their
-- corrections, and korbat's own decisions held with them (6.3), since the notice that tells them reads the order's row.
-- An order nothing acted on is due three years after its opening, like any other.
CREATE FUNCTION "public"."order_records_due"() RETURNS TABLE (order_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.id
    FROM public.legal_orders o
   CROSS JOIN public.order_rules() r
   WHERE (SELECT max(e.at) FROM public.legal_order_events e WHERE e.order_id = o.id) < now() - make_interval(years => r.record_keep_years)
     AND NOT EXISTS (SELECT 1 FROM public.legal_order_items i
                       JOIN public.decisions d ON d.order_item_id = i.id
                       JOIN public.measures_in_force m ON m.decision_id = d.id
                      WHERE i.order_id = o.id)
     AND NOT EXISTS (SELECT 1 FROM public.legal_order_items i
                      WHERE i.order_id = o.id AND i.preserve_until IS NOT NULL AND i.preserve_ended_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.legal_order_items i
                       JOIN public.cases c ON c.target_type = 'post' AND c.target_id = i.post_id
                       JOIN public.decisions d ON d.case_id = c.id
                      WHERE i.order_id = o.id AND d.informed_at IS NULL)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."order_records_due"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."order_records_due"() TO korbat_api;--> statement-breakpoint
-- 3. erase_order_records: the order's row FOR UPDATE, which an effect (decisions_record takes it FOR SHARE), a command and
-- a correction wait for or are waited for; then, in a statement of its own, not_due unless order_records_due() names
-- it. It deletes the order's events, its items (a decision's order_item_id becomes null: the foreign key is on delete
-- set null), the order's row with its texts, and its message when no other order names it, and answers how many rows
-- it deleted. The ledger's rows and the audit log's stay (3c 6.6): a decision of the kind order then says only that an
-- order was given effect, and when. Outbox rows that name the order have no key to it and go by delete_contact_messages.
CREATE FUNCTION "public"."erase_order_records"(order_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_message uuid;
  v_rows integer;
  v_deleted integer := 0;
BEGIN
  SELECT o.message_id INTO v_message FROM public.legal_orders o WHERE o.id = erase_order_records.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_records_due() d WHERE d.order_id = erase_order_records.order_id) THEN
    RAISE EXCEPTION 'not_due';
  END IF;

  DELETE FROM public.legal_order_events e WHERE e.order_id = erase_order_records.order_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_deleted := v_deleted + v_rows;
  DELETE FROM public.legal_order_items i WHERE i.order_id = erase_order_records.order_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_deleted := v_deleted + v_rows;
  DELETE FROM public.legal_orders o WHERE o.id = erase_order_records.order_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_deleted := v_deleted + v_rows;
  IF v_message IS NOT NULL THEN
    DELETE FROM public.contact_messages m
     WHERE m.id = v_message AND NOT EXISTS (SELECT 1 FROM public.legal_orders o WHERE o.message_id = m.id);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_deleted := v_deleted + v_rows;
  END IF;
  RETURN v_deleted;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."erase_order_records"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."erase_order_records"(uuid) TO korbat_api;--> statement-breakpoint
-- 4. delete_contact_messages: not_due unless older_than is at least message_keep_days back; then it deletes the messages
-- handled before older_than that no order names (an order's message goes with the order), and the outbox rows created
-- before older_than, except those whose subject is still open: a message without a disposition, or an order that is not
-- closed and has an item neither disabled nor closed. alert_steps() writes an escalation or a reminder only while no
-- row of it is newer than the step's threshold, so deleting those would let it meet an old threshold again and write a
-- new order_due at priority 5 every 30 days. An unhandled message is never deleted, a stale one included: the row is the
-- record that a message arrived and nobody looked at it. It answers how many rows it deleted.
CREATE FUNCTION "public"."delete_contact_messages"(older_than timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rows integer;
  v_deleted integer := 0;
BEGIN
  IF delete_contact_messages.older_than IS NULL
     OR delete_contact_messages.older_than > now() - make_interval(days => (SELECT r.message_keep_days FROM public.order_rules() r)) THEN
    RAISE EXCEPTION 'not_due';
  END IF;

  DELETE FROM public.contact_messages m
   WHERE m.disposition IS NOT NULL AND m.handled_at < delete_contact_messages.older_than
     AND NOT EXISTS (SELECT 1 FROM public.legal_orders o WHERE o.message_id = m.id);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_deleted := v_deleted + v_rows;

  DELETE FROM public.alert_outbox a
   WHERE a.created_at < delete_contact_messages.older_than
     AND NOT EXISTS (SELECT 1 FROM public.contact_messages m WHERE m.id = a.message_id AND m.disposition IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.legal_orders o
                      WHERE o.id = a.order_id AND o.closed_at IS NULL
                        AND EXISTS (SELECT 1 FROM public.legal_order_items i
                                     WHERE i.order_id = o.id AND i.disabled_at IS NULL AND i.closed_at IS NULL));
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_deleted + v_rows;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."delete_contact_messages"(timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."delete_contact_messages"(timestamptz) TO korbat_api;

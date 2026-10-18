"""Builds 20-proto.sql: the lab prototype of 3f's data model, run in ONE transaction on a database at migration 0016.

It copies eight objects of the scratch clone's 0016 and 0015 (decisions_record, decisions_apply, decision_actions_check,
decision_actions_apply, decision_holds, moderation_apply, append_confirmed_audit, frozen_for) and patches them by exact
text replacement, so the lab measures 3c's own trigger code with 3f's branches added. Everything parsed at creation
(views, SQL functions, CHECKs) names the new enum values only as text; PL/pgSQL bodies name them as literals.
Usage: python make_proto.py <0015.sql> <0016.sql> <20-tables.sql> > 20-proto.sql
"""
import re
import sys

src15 = open(sys.argv[1], encoding="utf-8").read().replace("--> statement-breakpoint", "")
src16 = open(sys.argv[2], encoding="utf-8").read().replace("--> statement-breakpoint", "")
tables = open(sys.argv[3], encoding="utf-8").read()


def fn(src: str, name: str) -> str:
    m = re.search(r'CREATE FUNCTION "public"\."' + name + r'"\(.*?(END \$\$;|\n\$\$;)', src, re.S)
    assert m, name
    return m.group(0).replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1)


def sub(text: str, old: str, new: str) -> str:
    assert text.count(old) == 1, (old, text.count(old))
    return text.replace(old, new)


M7 = "'withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio'"

# ---- decisions_record
rec = fn(src16, "decisions_record")
rec = sub(rec, "  target_deleted boolean;\nBEGIN", "  target_deleted boolean;\n  oi public.legal_order_items;\n  o public.legal_orders;\n  held boolean := false;\nBEGIN")
rec = sub(rec, "     WHERE d.id = NEW.reviews_decision_id AND d.case_id = NEW.case_id AND d.kind IN ('interim', 'final') AND d.outcome = 'restricted';",
          "     WHERE d.id = NEW.reviews_decision_id AND d.case_id = NEW.case_id AND d.kind IN ('interim', 'final', 'order') AND d.outcome = 'restricted';")
rec = sub(rec, "  ELSE\n    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A review waits for the migration that brings appeals.';\n  END IF;",
          "  ELSIF NEW.kind = 'order' THEN\n"
          "    SELECT x.* INTO oi FROM public.legal_order_items x WHERE x.id = NEW.order_item_id;\n"
          "    SELECT x.* INTO o FROM public.legal_orders x WHERE x.id = oi.order_id;\n"
          "    IF oi.id IS NULL OR NEW.outcome <> 'restricted' OR c.closed_at IS NOT NULL OR c.target_type <> 'post' OR c.target_id IS DISTINCT FROM oi.post_id\n"
          "       OR o.closed_at IS NOT NULL OR o.kind = 'dsa_art10' OR oi.intake_item_id IS NULL\n"
          "       OR NEW.ground IS DISTINCT FROM 'illegal' OR NEW.facts_digest IS NOT NULL OR NEW.reason_digest IS NOT NULL OR NEW.legal_reference_digest IS NOT NULL THEN\n"
          "      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'An order decision restricts the post its order item names, on the law, with no text of korbat''s.';\n"
          "    END IF;\n"
          "    IF EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.id = oi.action_id) THEN\n"
          "      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'The order item is already given effect.';\n"
          "    END IF;\n"
          "  ELSE\n    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A review waits for the migration that brings appeals.';\n  END IF;\n"
          "  IF (NEW.kind = 'order') <> (NEW.order_item_id IS NOT NULL) THEN\n"
          "    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'Only an order decision names an order item.';\n"
          "  END IF;")
rec = sub(rec, "     AND CASE WHEN NEW.kind = 'final' THEN i.seq BETWEEN NEW.answers_from_seq AND NEW.through_seq\n"
               "              WHEN NEW.kind = 'correction' AND corrected.kind = 'final' THEN i.answered_by = corrected.id\n"
               "              ELSE i.answered_by IS NULL END;",
          "     AND CASE WHEN NEW.kind = 'order' THEN i.id = oi.intake_item_id AND i.answered_by IS NULL\n"
          "              WHEN NEW.kind = 'final' THEN i.seq BETWEEN NEW.answers_from_seq AND NEW.through_seq AND n.kind <> 'order'\n"
          "              WHEN NEW.kind = 'correction' AND corrected.kind IN ('final', 'order') THEN i.answered_by = corrected.id\n"
          "              ELSE i.answered_by IS NULL AND n.kind <> 'order' END;")
rec = sub(rec, "  IF public.staff_party_conflict(NEW.decided_by,",
          "  IF NEW.kind <> 'order' AND NOT (NEW.kind = 'correction' AND corrected.kind = 'order') AND public.staff_party_conflict(NEW.decided_by,")
rec = sub(rec, "                       WHEN 'correction' THEN corrected.needs_admin\n",
          "                       WHEN 'correction' THEN corrected.needs_admin OR corrected.kind = 'order'\n")
rec = sub(rec, "    FROM public.decisions d WHERE d.decided_by = NEW.decided_by AND d.decided_at > now() - interval '1 day';\n"
               "  IF in_hour >= coalesce(per_hour, 60) OR in_day >= coalesce(per_day, 300) THEN\n    RAISE EXCEPTION 'decision_cap';\n  END IF;",
          "    FROM public.decisions d WHERE d.decided_by = NEW.decided_by AND d.decided_at > now() - interval '1 day' AND d.kind <> 'order';\n"
          "  IF NEW.kind <> 'order' AND (in_hour >= coalesce(per_hour, 60) OR in_day >= coalesce(per_day, 300)) THEN\n    RAISE EXCEPTION 'decision_cap';\n  END IF;\n"
          "  IF NEW.kind = 'order' AND (SELECT count(*) FROM public.decisions d WHERE d.decided_by = NEW.decided_by AND d.kind = 'order'\n"
          "                               AND d.decided_at > now() - interval '1 day') >= (SELECT r.items_per_day FROM public.order_rules() r) THEN\n"
          "    RAISE EXCEPTION 'order_cap';\n  END IF;")
rec = sub(rec, "  NEW.source := CASE WHEN NEW.kind = 'correction' THEN corrected.source\n",
          "  NEW.source := CASE WHEN NEW.kind = 'order' THEN 'order'::public.decision_source\n                     WHEN NEW.kind = 'correction' THEN corrected.source\n")
rec = sub(rec, "                       ELSE 'none' END::public.delivery_state;\n  RETURN NEW;",
          "                       ELSE 'none' END::public.delivery_state;\n"
          "  IF NEW.kind = 'order' THEN\n"
          "    NEW.needs_admin := false;\n"
          "    NEW.through_seq := 0;\n"
          "    IF o.kind = 'tco_removal' THEN\n"
          "      NEW.category := 'STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY';\n      NEW.category_keyword := 'KEYWORD_TERRORIST_CONTENT';\n"
          "    END IF;\n"
          "    held := coalesce(public.order_hold_until(o.id) > now(), false);\n"
          "    NEW.informed_at := CASE WHEN held THEN NULL ELSE NEW.decided_at END;\n"
          "    NEW.author_mail := CASE WHEN held THEN 'none' ELSE 'pending' END::public.delivery_state;\n"
          "  ELSIF NEW.kind = 'correction' AND corrected.kind = 'order' AND corrected.informed_at IS NULL THEN\n"
          "    -- A reinstatement while the notice is held tells nothing either.\n"
          "    NEW.informed_at := NULL;\n    NEW.author_mail := 'none';\n"
          "  END IF;\n  RETURN NEW;")

# ---- decisions_apply
app = fn(src16, "decisions_apply")
app = sub(app, "  confirmed integer;\nBEGIN\n  IF NEW.kind = 'final' THEN",
          "  confirmed integer;\n  answered integer;\nBEGIN\n"
          "  IF NEW.kind = 'order' THEN\n"
          "    UPDATE public.intake_items i SET answered_by = NEW.id, outcome = 'restricted_legal'\n"
          "     WHERE i.id = (SELECT x.intake_item_id FROM public.legal_order_items x WHERE x.id = NEW.order_item_id)\n"
          "       AND i.case_id = NEW.case_id AND i.answered_by IS NULL;\n"
          "    GET DIAGNOSTICS answered = ROW_COUNT;\n"
          "    IF answered <> 1 THEN\n      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'An order decision answers its own item.';\n    END IF;\n"
          "    SELECT count(*), min(i.lane), min(i.created_at) INTO open_items, open_lane, oldest\n"
          "      FROM public.intake_items i WHERE i.case_id = NEW.case_id AND i.answered_by IS NULL;\n"
          "    UPDATE public.cases k\n"
          "       SET state_version = k.state_version + 1, last_decided_at = now(), lane = coalesce(open_lane, 2), oldest_open_at = oldest,\n"
          "           answered_seq = CASE WHEN open_items = 0 THEN k.intake_seq ELSE k.answered_seq END,\n"
          "           closed_at = CASE WHEN open_items = 0 THEN now() END\n"
          "     WHERE k.id = NEW.case_id\n    RETURNING k.* INTO c;\n"
          "    IF c.closed_at IS NOT NULL THEN\n      PERFORM public.moderation_apply(ARRAY[c.target_id], true);\n    END IF;\n"
          "  ELSIF NEW.kind = 'final' THEN")
app = sub(app, "           answered_seq = NEW.through_seq,\n", "           answered_seq = CASE WHEN open_items = 0 THEN k.intake_seq ELSE NEW.through_seq END,\n")

# ---- decision_actions_check
chk = fn(src16, "decision_actions_check")
chk = sub(chk, "  profile public.profiles;\nBEGIN", "  profile public.profiles;\n  o public.legal_orders;\nBEGIN")
chk = sub(chk, "  NEW.created_at := now();", "  NEW.created_at := now();\n  NEW.withhold_author := NULL;\n  IF NEW.kind <> 'reinstate_by_order' THEN NEW.order_ground := NULL; END IF;")
chk = sub(chk, "  IF NEW.kind IN ('withhold', 'remove', 'restore', 'withhold_media', 'remove_media', 'restore_media') THEN\n    NEW.post_id := c.target_id;",
          "  IF NEW.kind IN ('withhold', 'remove', 'restore', 'withhold_media', 'remove_media', 'restore_media', 'disable_by_order', 'reinstate_by_order') THEN\n    NEW.post_id := c.target_id;")
chk = sub(chk, f"  is_measure := NEW.kind IN ({M7});", f"  is_measure := NEW.kind IN ({M7}, 'disable_by_order');")
chk = sub(chk, "            WHEN 'final' THEN NEW.kind IN ('remove', 'remove_media', 'reset_display_name', 'reset_bio', 'seal_media', 'restore', 'restore_media')\n",
          "            WHEN 'final' THEN NEW.kind IN ('remove', 'remove_media', 'reset_display_name', 'reset_bio', 'seal_media', 'restore', 'restore_media')\n"
          "            WHEN 'order' THEN NEW.kind = 'disable_by_order'\n")
chk = sub(chk, "                WHEN 'restore_display_name' THEN ARRAY['reset_display_name']\n",
          "                WHEN 'restore_display_name' THEN ARRAY['reset_display_name']\n                WHEN 'reinstate_by_order' THEN ARRAY['disable_by_order']\n")
chk = sub(chk, "  IF is_measure AND public.account_is_staff(subject) AND d.kind <> 'interim' THEN", "  IF is_measure AND public.account_is_staff(subject) AND d.kind NOT IN ('interim', 'order') THEN")
chk = sub(chk, "  IF NEW.kind = 'unseal_media' THEN\n    UPDATE public.decisions x SET needs_admin = true WHERE x.id = d.id;",
          "  IF NEW.kind = 'reinstate_by_order' AND (NEW.order_ground IS NULL OR d.kind <> 'correction') THEN\n"
          "    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'A reinstatement is a correction and names its ground.';\n  END IF;\n"
          "  IF NEW.kind = 'disable_by_order' THEN\n"
          "    SELECT x.* INTO o FROM public.legal_orders x JOIN public.legal_order_items i ON i.order_id = x.id WHERE i.id = d.order_item_id;\n"
          "    NEW.withhold_author := o.withhold_from_author;\n  END IF;\n"
          "  IF NEW.kind IN ('unseal_media', 'reinstate_by_order') THEN\n    UPDATE public.decisions x SET needs_admin = true WHERE x.id = d.id;")
chk = sub(chk, "      ELSIF NEW.kind = 'remove' THEN\n        NEW.no_effect := CASE WHEN post_level = 'removed' THEN 'already' END;",
          "      ELSIF NEW.kind = 'remove' THEN\n        NEW.no_effect := CASE WHEN post_level IN ('removed', 'disabled') THEN 'already' END;\n"
          "      ELSIF NEW.kind = 'disable_by_order' THEN\n        NEW.no_effect := CASE WHEN post_level = 'disabled' OR (post_level = 'removed' AND NOT NEW.withhold_author) THEN 'already' END;")

# ---- decision_actions_apply
aap = fn(src16, "decision_actions_apply")
aap = sub(aap, "  IF NEW.reverses_action_id IS NOT NULL AND d.kind IN ('review', 'correction') THEN",
          "  IF NEW.kind = 'disable_by_order' THEN\n"
          "    UPDATE public.legal_order_items i\n"
          "       SET decision_id = d.id, action_id = NEW.id, disabled_at = coalesce(i.disabled_at, now()), reinstated_at = NULL,\n"
          "           preserve_until = CASE WHEN (SELECT x.preserve FROM public.legal_orders x WHERE x.id = i.order_id)\n"
          "                                 THEN coalesce(i.preserve_until, public.order_preserve_until(now())) END,\n"
          "           preserve_ended_at = NULL\n"
          "     WHERE i.id = d.order_item_id;\n"
          "    INSERT INTO public.legal_order_events (order_id, item_id, kind, by_staff, via)\n"
          "    SELECT i.order_id, i.id, 'effect_given', d.decided_by, 'console' FROM public.legal_order_items i WHERE i.id = d.order_item_id;\n"
          "  ELSIF NEW.kind = 'reinstate_by_order' THEN\n"
          "    UPDATE public.legal_order_items i SET reinstated_at = now(), preserve_ended_at = now() WHERE i.action_id = NEW.reverses_action_id;\n"
          "    INSERT INTO public.legal_order_events (order_id, item_id, kind, ground, by_staff, via)\n"
          "    SELECT i.order_id, i.id, 'reinstated', NEW.order_ground, d.decided_by, 'console' FROM public.legal_order_items i WHERE i.action_id = NEW.reverses_action_id;\n"
          "  END IF;\n\n"
          "  IF NEW.reverses_action_id IS NOT NULL AND d.kind IN ('review', 'correction') THEN")

# ---- decision_holds
hol = fn(src16, "decision_holds")
hol = sub(hol, "  in_force integer;\nBEGIN", "  in_force integer;\n  oi public.legal_order_items;\n  o public.legal_orders;\n  c public.cases;\nBEGIN")
hol = sub(hol, "  IF NOT FOUND OR a.metadata ->> 'decisionId' IS DISTINCT FROM d.id::text THEN",
          "  IF d.kind = 'order' THEN\n"
          "    SELECT x.* INTO oi FROM public.legal_order_items x WHERE x.id = d.order_item_id;\n"
          "    SELECT x.* INTO o FROM public.legal_orders x WHERE x.id = oi.order_id;\n"
          "    SELECT k.* INTO c FROM public.cases k WHERE k.id = d.case_id;\n"
          "    IF a.id IS NULL OR a.step_up IS NULL OR a.actor_id IS DISTINCT FROM d.decided_by OR a.action IS DISTINCT FROM 'order_effected'\n"
          "       OR a.target_type IS DISTINCT FROM 'order' OR a.target_id IS DISTINCT FROM o.id::text THEN\n"
          "      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'target: the transaction''s last audit row is not a confirmed order_effected on this decision''s order.';\n"
          "    END IF;\n"
          "    IF a.metadata -> 'decisionIds' ->> oi.id::text IS DISTINCT FROM d.id::text THEN\n"
          "      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'decisionIds: the audit row does not name this decision for its item.';\n"
          "    END IF;\n"
          "    params := a.metadata -> 'params';\n"
          "    expected := jsonb_build_object('kind', o.kind, 'memberState', o.member_state, 'authority', o.authority, 'reference', o.reference,\n"
          "      'sectionC', o.section_c, 'emergency', o.emergency, 'withholdFromAuthor', o.withhold_from_author);\n"
          "    IF params IS NULL OR (params - 'items') IS DISTINCT FROM expected THEN\n"
          "      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'params: the confirmed order facts differ from the order.';\n"
          "    END IF;\n"
          "    IF NOT coalesce(params -> 'items' @> jsonb_build_array(jsonb_build_object('itemId', oi.id, 'postId', c.target_id)), false)\n"
          "       OR jsonb_array_length(params -> 'items') <> (SELECT count(*) FROM jsonb_object_keys(a.metadata -> 'decisionIds'))\n"
          "       OR jsonb_array_length(params -> 'items') > (SELECT r.items_per_action FROM public.order_rules() r) THEN\n"
          "      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'items: the confirmed list does not name this item, or names more than it gave effect to.';\n"
          "    END IF;\n"
          "    IF (SELECT count(*) FROM public.decision_actions x WHERE x.decision_id = d.id) <> 1\n"
          "       OR NOT EXISTS (SELECT 1 FROM public.decision_actions x WHERE x.decision_id = d.id AND x.kind = 'disable_by_order') THEN\n"
          "      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'actions: an order decision holds exactly one disable_by_order.';\n"
          "    END IF;\n"
          "    RETURN;\n"
          "  END IF;\n"
          "  IF NOT FOUND OR a.metadata ->> 'decisionId' IS DISTINCT FROM d.id::text THEN")
hol = sub(hol, "  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'mediaId', x.media_id)), '[]'::jsonb),",
          "  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'mediaId', x.media_id)\n"
          "           || CASE WHEN x.order_ground IS NOT NULL THEN jsonb_build_object('orderGround', x.order_ground) ELSE '{}'::jsonb END), '[]'::jsonb),")
assert hol.count(f"x.kind IN ({M7})") == 1 and hol.count(f"x.kind NOT IN ({M7})") == 1
hol = hol.replace(f"x.kind IN ({M7})", f"x.kind IN ({M7}, 'disable_by_order')").replace(f"x.kind NOT IN ({M7})", f"x.kind NOT IN ({M7}, 'disable_by_order')")
# decision_holds reads the head row in the statement before the order branch: keep FOUND's meaning for the old branch.
hol = sub(hol, "  SELECT l.* INTO a FROM public.audit_head h JOIN public.audit_log l ON l.chain_seq = h.seq WHERE h.id = 1;\n  IF d.kind = 'order' THEN",
          "  SELECT l.* INTO a FROM public.audit_head h JOIN public.audit_log l ON l.chain_seq = h.seq WHERE h.id = 1;\n  IF d.kind = 'order' THEN")

# ---- moderation_apply
mod = fn(src16, "moderation_apply")
mod = sub(mod, "           array_agg(CASE\n             WHEN p.erased_at IS NOT NULL OR EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.post_id = p.id AND m.kind = 'remove') THEN 'removed'",
          "           array_agg(CASE\n"
          "             WHEN p.erased_at IS NULL AND EXISTS (SELECT 1 FROM public.measures_in_force m JOIN public.decision_actions x ON x.id = m.id\n"
          "                                                   WHERE m.post_id = p.id AND m.kind = 'disable_by_order' AND x.withhold_author) THEN 'disabled'\n"
          "             WHEN p.erased_at IS NOT NULL OR EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.post_id = p.id AND m.kind IN ('remove', 'disable_by_order')) THEN 'removed'")

# ---- append_confirmed_audit
aud = fn(src16, "append_confirmed_audit")
aud = sub(aud, "NOT IN ('case_decided', 'appeals_reviewed', 'identity_revealed')", "NOT IN ('case_decided', 'appeals_reviewed', 'identity_revealed', 'order_effected', 'order_event_recorded')")

# ---- frozen_for (0015, an SQL function: it names no enum value)
fro = fn(src15, "frozen_for")
fro = sub(fro, "      WHERE s.post_id = frozen_for.post)\n$$;",
          "      WHERE s.post_id = frozen_for.post)\n"
          "    OR EXISTS (\n"
          "      SELECT 1 FROM public.legal_order_items oi\n"
          "      WHERE oi.post_id = frozen_for.post AND oi.preserve_until > now() AND oi.preserve_ended_at IS NULL)\n$$;")

print("-- GENERATED by make_proto.py: the lab prototype of 3f on a database at 0016. Run with psql -1.\n")
print(tables)
for text in (rec, app, chk, aap, hol, mod, aud, fro):
    print(text + "\n")

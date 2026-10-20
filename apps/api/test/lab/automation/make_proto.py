"""Builds 30-proto.sql: the lab prototype of 3d's automated decision, run in ONE transaction on a database at 0017.

It copies decisions_record (0017) and decision_holds (0016) of the scratch clone and patches them by exact text
replacement, so the lab measures 3c's own trigger code with 3d's branches. The two new enum values are named as
literals only inside PL/pgSQL bodies; CHECKs compare kind::text and channel::text.
Usage: python make_proto.py <0016.sql> <0017.sql> <30-tables.sql> > 30-proto.sql
"""
import re
import sys

src16 = open(sys.argv[1], encoding="utf-8").read().replace("--> statement-breakpoint", "")
src17 = open(sys.argv[2], encoding="utf-8").read().replace("--> statement-breakpoint", "")
tables = open(sys.argv[3], encoding="utf-8").read()


def fn(src, name):
    m = re.search(r'CREATE (OR REPLACE )?FUNCTION "public"\."' + name + r'"\(.*?(END \$\$;|\n\$\$;)', src, re.S)
    assert m, name
    t = m.group(0)
    return t if t.startswith("CREATE OR REPLACE") else t.replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1)


def sub(text, old, new):
    assert text.count(old) == 1, (old, text.count(old))
    return text.replace(old, new)


SYSTEM = "'00000000-0000-0000-0000-000000000000'::uuid"

# ---- decisions_record (0017)
rec = fn(src17, "decisions_record")
rec = sub(rec, "  target_deleted boolean;\nBEGIN",
          "  target_deleted boolean;\n  considers_automated boolean;\n  considers_match boolean;\n  automated_rule boolean;\nBEGIN")
rec = sub(rec, "  NEW.automated_detection := false;\n  NEW.automated_decision := 'not_automated';\n",
          "  NEW.automated_detection := NEW.decided_by IS NULL;\n"
          "  NEW.automated_decision := CASE WHEN NEW.decided_by IS NULL THEN 'fully' ELSE 'not_automated' END;\n")
rec = sub(rec, "  -- 2.\n  IF NEW.kind = 'interim' THEN",
          "  -- 2.\n  IF NEW.decided_by IS NULL AND (NEW.kind <> 'interim' OR NEW.ground IS DISTINCT FROM 'incompatible'\n"
          "       OR NEW.rule_id IS NULL OR NEW.rule_id NOT IN ('R1', 'R2')\n"
          "       OR NEW.facts_digest IS NOT NULL OR NEW.reason_digest IS NOT NULL OR NEW.legal_reference_digest IS NOT NULL) THEN\n"
          "    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'An automated decision is taken while deciding, under R1 or R2, with no text.';\n"
          "  END IF;\n"
          "  IF NEW.kind = 'interim' THEN")
rec = sub(rec, "         coalesce(bool_or(n.kind = 'user'), false)\n"
               "    INTO reporters, considers_suspect, considers_illegal, considers_r5, from_notice, from_user\n",
          "         coalesce(bool_or(n.kind = 'user'), false),\n"
          "         coalesce(bool_or(n.kind::text = 'automated'), false),\n"
          "         coalesce(bool_or(n.kind::text = 'automated' AND n.rule_id = 'R2'), false),\n"
          "         coalesce(bool_or(n.kind::text = 'automated' AND n.rule_id = NEW.rule_id), false)\n"
          "    INTO reporters, considers_suspect, considers_illegal, considers_r5, from_notice, from_user,\n"
          "         considers_automated, considers_match, automated_rule\n")
rec = sub(rec, "  IF public.staff_party_conflict(NEW.decided_by,",
          "  IF NEW.decided_by IS NULL AND NOT automated_rule THEN\n"
          "    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'An automated decision rests on an unanswered automated finding under its rule.';\n"
          "  END IF;\n"
          "  IF NEW.decided_by IS NOT NULL AND public.staff_party_conflict(NEW.decided_by,")
rec = sub(rec, "  IF NEW.needs_admin AND decider_role IS DISTINCT FROM 'admin' THEN\n    RAISE EXCEPTION 'admin_required';\n  END IF;\n",
          "  IF NEW.needs_admin AND decider_role IS DISTINCT FROM 'admin' THEN\n    RAISE EXCEPTION 'admin_required';\n  END IF;\n"
          "  IF NEW.decided_by IS NOT NULL AND NEW.kind IN ('interim', 'final') THEN\n"
          "    NEW.automated_detection := considers_automated;\n"
          "    NEW.automated_decision := CASE WHEN considers_match AND NEW.suspect AND NEW.outcome = 'restricted' THEN 'partially' ELSE 'not_automated' END;\n"
          "  ELSIF NEW.decided_by IS NOT NULL THEN\n"
          "    NEW.automated_detection := reviewed.automated_detection;\n"
          "  END IF;\n")
rec = sub(rec, "  PERFORM pg_advisory_xact_lock(hashtextextended('korbat.decision_cap:' || NEW.decided_by::text, 0));\n"
               "  SELECT l.decisions_per_hour, l.decisions_per_day INTO per_hour, per_day FROM public.moderation_limits l WHERE l.id = 1;\n",
          "  PERFORM pg_advisory_xact_lock(hashtextextended('korbat.decision_cap:' || coalesce(NEW.decided_by::text, 'system'), 0));\n"
          "  SELECT l.decisions_per_hour, l.decisions_per_day INTO per_hour, per_day FROM public.moderation_limits l WHERE l.id = 1;\n"
          "  IF NEW.decided_by IS NULL THEN\n"
          "    SELECT r.decisions_per_hour, r.decisions_per_day INTO per_hour, per_day FROM public.automation_rules() r;\n"
          "  END IF;\n")
rec = sub(rec, "    FROM public.decisions d WHERE d.decided_by = NEW.decided_by AND d.decided_at > now() - interval '1 day';\n"
               "  IF in_hour >= coalesce(per_hour, 60) OR in_day >= coalesce(per_day, 300) THEN\n"
               "    RAISE EXCEPTION 'decision_cap';\n",
          "    FROM public.decisions d WHERE d.decided_by IS NOT DISTINCT FROM NEW.decided_by AND d.decided_at > now() - interval '1 day';\n"
          "  IF in_hour >= coalesce(per_hour, 60) OR in_day >= coalesce(per_day, 300) THEN\n"
          "    IF NEW.decided_by IS NULL THEN RAISE EXCEPTION 'automation_capped'; END IF;\n"
          "    RAISE EXCEPTION 'decision_cap';\n")

# ---- decision_holds (0016)
hold = fn(src16, "decision_holds")
hold = sub(hold, "  in_force integer;\nBEGIN", "  in_force integer;\n  n_signals integer;\n  sig public.automated_signals;\nBEGIN")
hold = sub(hold,
           "  IF a.step_up IS NULL THEN\n"
           "    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'stepUp: the audit row carries no confirmation.';\n"
           "  END IF;\n"
           "  IF a.actor_id IS DISTINCT FROM d.decided_by THEN\n"
           "    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'actor: the audit row was written by another account than the decision''s.';\n"
           "  END IF;\n",
           "  IF d.decided_by IS NULL THEN\n"
           "    IF a.step_up IS NOT NULL OR a.key_id IS NOT NULL OR a.actor_id IS DISTINCT FROM " + SYSTEM + " OR a.action IS DISTINCT FROM 'automated_decided' THEN\n"
           "      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'system: an automated decision stands with the system actor''s row automated_decided and no confirmation.';\n"
           "    END IF;\n"
           "    SELECT count(*) INTO n_signals FROM public.automated_signals s WHERE s.decision_id = d.id;\n"
           "    SELECT s.* INTO sig FROM public.automated_signals s WHERE s.decision_id = d.id LIMIT 1;\n"
           "    IF n_signals <> 1 OR a.metadata ->> 'signalId' IS DISTINCT FROM sig.id::text\n"
           "       OR NOT EXISTS (SELECT 1 FROM public.post_media m JOIN public.cases k ON k.id = d.case_id\n"
           "                       WHERE m.id = sig.media_id AND k.target_type = 'post' AND m.post_id = k.target_id) THEN\n"
           "      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'signal: an automated decision rests on exactly one signal, about an image of its case''s post, that the audit row names.';\n"
           "    END IF;\n"
           "  ELSE\n"
           "    IF a.step_up IS NULL THEN\n"
           "      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'stepUp: the audit row carries no confirmation.';\n"
           "    END IF;\n"
           "    IF a.actor_id IS DISTINCT FROM d.decided_by THEN\n"
           "      RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'actor: the audit row was written by another account than the decision''s.';\n"
           "    END IF;\n"
           "  END IF;\n")
hold = sub(hold, "    IF a.action IS DISTINCT FROM 'case_decided' OR a.target_type IS DISTINCT FROM 'case' OR a.target_id IS DISTINCT FROM d.case_id::text THEN",
           "    IF a.action IS DISTINCT FROM (CASE WHEN d.decided_by IS NULL THEN 'automated_decided' ELSE 'case_decided' END)\n"
           "       OR a.target_type IS DISTINCT FROM 'case' OR a.target_id IS DISTINCT FROM d.case_id::text THEN")
hold = sub(hold, "  IF d.outcome = 'restricted' AND measures = 0 THEN",
           "  IF d.decided_by IS NULL AND (measures <> 1 OR reversals <> 0 OR NOT EXISTS (\n"
           "       SELECT 1 FROM public.decision_actions x\n"
           "        WHERE x.decision_id = d.id\n"
           "          AND ((sig.kind = 'r1_score' AND d.rule_id = 'R1' AND x.kind = 'withhold_media' AND x.media_id = sig.media_id)\n"
           "            OR (sig.kind = 'known_match' AND d.rule_id = 'R2' AND x.kind = 'seal_media')))) THEN\n"
           "    RAISE EXCEPTION 'invalid_decision' USING DETAIL = 'measure: an automated decision holds one measure: the scored image withheld, or the matched post''s images sealed.';\n"
           "  END IF;\n"
           "  IF d.outcome = 'restricted' AND measures = 0 THEN")

print("-- GENERATED by make_proto.py. Do not edit.")
print(tables)
print(rec)
print(hold)

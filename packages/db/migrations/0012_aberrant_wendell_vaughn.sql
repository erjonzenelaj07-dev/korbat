ALTER TYPE "auth"."auth_event_type" ADD VALUE 'staff_enrollment_issued';--> statement-breakpoint
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'staff_key_added';--> statement-breakpoint
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'staff_key_revoked';--> statement-breakpoint
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'staff_key_counter_regression';--> statement-breakpoint
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'staff_sign_in';--> statement-breakpoint
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'staff_signed_out';--> statement-breakpoint
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'staff_session_revoked';--> statement-breakpoint
CREATE TABLE "auth"."staff_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"origin" text NOT NULL,
	"rp_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "auth"."staff_enrollments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth"."staff_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text[] DEFAULT '{}'::text[] NOT NULL,
	"name" text NOT NULL,
	"aaguid" uuid,
	"origin" text NOT NULL,
	"rp_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"suspect_at" timestamp with time zone,
	CONSTRAINT "staff_keys_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "staff_keys_suspect_is_revoked" CHECK ("auth"."staff_keys"."suspect_at" is null or "auth"."staff_keys"."revoked_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "auth"."staff_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth"."staff_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"handle" uuid DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"browser" text NOT NULL,
	CONSTRAINT "staff_sessions_lifetime" CHECK ("auth"."staff_sessions"."absolute_expires_at" <= "auth"."staff_sessions"."created_at" + interval '12 hours' and "auth"."staff_sessions"."idle_expires_at" <= "auth"."staff_sessions"."absolute_expires_at")
);
--> statement-breakpoint
ALTER TABLE "auth"."staff_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_head" (
	"id" smallint PRIMARY KEY NOT NULL,
	"seq" bigint NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "audit_head_single_row" CHECK ("audit_head"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "audit_head" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "staff_session" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "key_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "action_hash" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "step_up" jsonb;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "chain_version" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "chain_seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "prev_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."staff_enrollments" ADD CONSTRAINT "staff_enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."staff_keys" ADD CONSTRAINT "staff_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."staff_sessions" ADD CONSTRAINT "staff_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."staff_sessions" ADD CONSTRAINT "staff_sessions_key_user_fk" FOREIGN KEY ("key_id","user_id") REFERENCES "auth"."staff_keys"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_enrollments_token_hash_idx" ON "auth"."staff_enrollments" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "staff_enrollments_user_idx" ON "auth"."staff_enrollments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_keys_credential_idx" ON "auth"."staff_keys" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "staff_keys_user_idx" ON "auth"."staff_keys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_sessions_handle_idx" ON "auth"."staff_sessions" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "staff_sessions_user_idx" ON "auth"."staff_sessions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_step_up_complete" CHECK (("audit_log"."action_hash" is null) = ("audit_log"."step_up" is null) and ("audit_log"."action_hash" is null or "audit_log"."key_id" is not null));--> statement-breakpoint
CREATE POLICY "staff_enrollments_auth_all" ON "auth"."staff_enrollments" AS PERMISSIVE FOR ALL TO "korbat_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "staff_keys_auth_all" ON "auth"."staff_keys" AS PERMISSIVE FOR ALL TO "korbat_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "staff_sessions_auth_all" ON "auth"."staff_sessions" AS PERMISSIVE FOR ALL TO "korbat_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "audit_head_api_select" ON "audit_head" AS PERMISSIVE FOR SELECT TO "korbat_api" USING (true);--> statement-breakpoint
-- Everything below is written by hand (3a design, section 6), in the order the design gives. drizzle's migrator runs every
-- pending migration in one transaction, so a failure anywhere leaves the audit log unchained and unchanged.
--
-- The audit chain's canonical text, version 1. It is implemented twice: here, for the trigger and the back-fill, and in
-- Node by the staff module's chain.ts, which audit-verify uses and which never asks the database for a text or a hash,
-- since the owner can replace this function. A JSON array without whitespace: chain_version, chain_seq and id as
-- integers; created_at in UTC to the millisecond; the actor, the action, the target's type and id, the request id, the
-- staff session's handle, the key and the action's hash, each a JSON string or null; then step_up and last metadata,
-- exactly as PostgreSQL prints the stored jsonb (its own key order and separators), step_up null when absent. Strings are
-- escaped by to_json, as JSON.stringify escapes them. Every name is schema-qualified and the search path pinned, so no
-- temporary object can stand in for one.
CREATE FUNCTION "public"."audit_chain_text"(r "public"."audit_log") RETURNS text
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
BEGIN
  -- A later sub-project that chains another column adds version 2 here and in chain.ts; every row keeps its version.
  IF r.chain_version IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'audit chain version % is not known', r.chain_version;
  END IF;
  RETURN '[' || r.chain_version::text || ',' || r.chain_seq::text || ',' || r.id::text || ','
    || to_json(to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text || ','
    || coalesce(to_json(r.actor_id::text)::text, 'null') || ','
    || coalesce(to_json(r.action)::text, 'null') || ','
    || coalesce(to_json(r.target_type)::text, 'null') || ','
    || coalesce(to_json(r.target_id)::text, 'null') || ','
    || coalesce(to_json(r.request_id)::text, 'null') || ','
    || coalesce(to_json(r.staff_session::text)::text, 'null') || ','
    || coalesce(to_json(r.key_id::text)::text, 'null') || ','
    || coalesce(to_json(r.action_hash)::text, 'null') || ','
    || coalesce(r.step_up::text, 'null') || ','
    || r.metadata::text || ']';
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."audit_chain_text"("public"."audit_log") FROM PUBLIC;--> statement-breakpoint
-- The chain records times to the millisecond, as JavaScript reads them; the rows written before it change by under 1 ms.
UPDATE "public"."audit_log" SET "created_at" = date_trunc('milliseconds', "created_at");--> statement-breakpoint
-- The back-fill: the rows written before the chain (grant-role's) are chained in id order, which was their only order.
-- The hash is the lower-case hex sha256 of the UTF-8 bytes of prev_hash followed by the text: convert_to, never a cast to
-- bytea, which would read the backslashes of JSON escapes as its own.
DO $$
DECLARE
  r public.audit_log;
  prev text := repeat('0', 64);
  place bigint := 0;
BEGIN
  FOR r IN SELECT * FROM public.audit_log ORDER BY id LOOP
    place := place + 1;
    r.chain_version := 1;
    r.chain_seq := place;
    r.prev_hash := prev;
    prev := encode(sha256(convert_to(r.prev_hash || public.audit_chain_text(r), 'UTF8')), 'hex');
    UPDATE public.audit_log SET chain_version = 1, chain_seq = place, prev_hash = r.prev_hash, hash = prev WHERE id = r.id;
  END LOOP;
END $$;--> statement-breakpoint
-- The head: the newest row's place and hash, or place 0 and 64 zeros for an empty log. The trigger never creates it.
INSERT INTO "public"."audit_head" ("id", "seq", "hash")
SELECT 1, coalesce(max("chain_seq"), 0), coalesce((SELECT "hash" FROM "public"."audit_log" ORDER BY "chain_seq" DESC LIMIT 1), repeat('0', 64))
FROM "public"."audit_log";--> statement-breakpoint
-- Generated from safety.ts, moved here: before the back-fill every row held the placeholder 0.
CREATE UNIQUE INDEX "audit_log_chain_seq_idx" ON "audit_log" USING btree ("chain_seq");--> statement-breakpoint
-- 0001's default privileges gave the API role every write on new public tables. It reads the head and nothing more: it can
-- neither move it nor lock its row, since SELECT ... FOR UPDATE needs UPDATE. On audit_log it keeps INSERT and SELECT
-- (0001 revoked UPDATE, DELETE and TRUNCATE).
REVOKE ALL ON "public"."audit_head" FROM korbat_api;--> statement-breakpoint
GRANT SELECT ON "public"."audit_head" TO korbat_api;--> statement-breakpoint
-- The chain's trigger. It runs as its owner, the migrator, and places every row whatever the insert supplied: it locks the
-- head's row until the inserting transaction ends (so an audit row is always the last statement of its transaction), draws
-- the id itself (so an insert naming an existing id with ON CONFLICT DO NOTHING cannot move the head without writing its
-- row), and sets the time the row joined the chain, its place after the head's and the hashes. A rolled-back insert rolls
-- the head back with it, so the places have no gaps.
CREATE FUNCTION "public"."audit_chain"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  head_seq bigint;
  head_hash text;
BEGIN
  SELECT h.seq, h.hash INTO head_seq, head_hash FROM public.audit_head h WHERE h.id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the audit head is missing';
  END IF;
  NEW.id := nextval('public.audit_log_id_seq');
  NEW.created_at := date_trunc('milliseconds', clock_timestamp());
  NEW.chain_version := 1;
  NEW.chain_seq := head_seq + 1;
  NEW.prev_hash := head_hash;
  NEW.hash := encode(sha256(convert_to(head_hash || public.audit_chain_text(NEW), 'UTF8')), 'hex');
  UPDATE public.audit_head SET seq = NEW.chain_seq, hash = NEW.hash WHERE id = 1;
  RETURN NEW;
END $$;--> statement-breakpoint
-- Nobody calls it; the trigger still fires for every role that inserts.
REVOKE ALL ON FUNCTION "public"."audit_chain"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "audit_chain" BEFORE INSERT ON "public"."audit_log" FOR EACH ROW EXECUTE FUNCTION "public"."audit_chain"();--> statement-breakpoint
-- The auth side. 0001's default privileges gave the auth role every write on new auth tables. A staff key is added only by
-- auth.add_staff_key below and an enrolment only by `staff.js enroll` as the migrator, so code running in the API can end
-- staff access but never grant it. On staff keys the auth role keeps reading and recording a key's use, revocation and
-- suspicion; on enrolments reading and deleting (a cancellation, or the janitor). Staff sessions keep the default grants:
-- the flows create, slide and revoke them, and the janitor deletes them.
REVOKE ALL ON "auth"."staff_keys" FROM korbat_auth;--> statement-breakpoint
GRANT SELECT ON "auth"."staff_keys" TO korbat_auth;--> statement-breakpoint
GRANT UPDATE ("counter", "last_used_at", "revoked_at", "suspect_at") ON "auth"."staff_keys" TO korbat_auth;--> statement-breakpoint
REVOKE ALL ON "auth"."staff_enrollments" FROM korbat_auth;--> statement-breakpoint
GRANT SELECT, DELETE ON "auth"."staff_enrollments" TO korbat_auth;--> statement-breakpoint
-- Revocation, suspicion and use are for good: a set revoked_at or suspect_at on a key, or used_at on an enrolment, is
-- never cleared or changed, by any role. A writer that revokes sets revoked_at only where it is still null.
CREATE FUNCTION "auth"."staff_never_cleared"() RETURNS trigger
LANGUAGE plpgsql SET search_path = auth, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'staff_keys' THEN
    IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
      RAISE EXCEPTION 'a staff key''s revoked_at is never cleared or changed';
    END IF;
    IF OLD.suspect_at IS NOT NULL AND NEW.suspect_at IS DISTINCT FROM OLD.suspect_at THEN
      RAISE EXCEPTION 'a staff key''s suspect_at is never cleared or changed';
    END IF;
  ELSIF OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at THEN
    RAISE EXCEPTION 'an enrolment''s used_at is never cleared or changed';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth"."staff_never_cleared"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "staff_keys_never_cleared" BEFORE UPDATE ON "auth"."staff_keys" FOR EACH ROW EXECUTE FUNCTION "auth"."staff_never_cleared"();--> statement-breakpoint
CREATE TRIGGER "staff_enrollments_never_cleared" BEFORE UPDATE ON "auth"."staff_enrollments" FOR EACH ROW EXECUTE FUNCTION "auth"."staff_never_cleared"();--> statement-breakpoint
-- The only way a staff key comes to exist: the enrolment flow's last statement, on the auth role, in its own transaction.
-- It hashes the link's token itself, so a token hash read from the table spends nothing. Under a lock on the account's row
-- (FOR NO KEY UPDATE, as every writer of staff rows takes it first, 3a design section 7) it re-checks that the enrolment
-- is unused and unexpired and that the account is live, staff, has a handle and holds fewer than five live keys; then it
-- spends the enrolment, stores the key with the origin and relying party ID the enrolment recorded, and writes the key's
-- audit row, last. It raises 'staff_enrollment_invalid' or 'staff_key_limit' as its message, which the flow answers with
-- the staff code of that name. Every column name is qualified: the parameters share several of them.
CREATE FUNCTION "auth"."add_staff_key"(token text, credential_id text, public_key text, counter bigint, transports text[], name text, aaguid uuid, request_id text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = auth, pg_temp AS $$
DECLARE
  enrolment auth.staff_enrollments;
  account auth.users;
  live_keys integer;
  new_key_id uuid;
BEGIN
  SELECT e.* INTO enrolment FROM auth.staff_enrollments e
   WHERE e.token_hash = encode(sha256(convert_to(add_staff_key.token, 'UTF8')), 'hex');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_enrollment_invalid' USING DETAIL = 'No enrolment was issued with this token.';
  END IF;
  -- The account's row before the enrolment's, the order every other writer takes them in. A revocation, role change or
  -- take-down that held it first has deleted the enrolment by now, so the re-read below finds nothing.
  SELECT u.* INTO account FROM auth.users u WHERE u.id = enrolment.user_id FOR NO KEY UPDATE;
  SELECT e.* INTO enrolment FROM auth.staff_enrollments e WHERE e.id = enrolment.id FOR UPDATE;
  IF NOT FOUND OR enrolment.used_at IS NOT NULL OR enrolment.expires_at <= now() THEN
    RAISE EXCEPTION 'staff_enrollment_invalid' USING DETAIL = 'The enrolment was used, has expired or was cancelled.';
  END IF;
  -- Live (not deleted), staff, and with a handle (onboarded: the console names staff by their handle).
  IF account.deleted_at IS NOT NULL OR account.role NOT IN ('moderator', 'admin') OR account.onboarded_at IS NULL THEN
    RAISE EXCEPTION 'staff_enrollment_invalid' USING DETAIL = 'The account is not a live staff account with a handle.';
  END IF;
  SELECT count(*) INTO live_keys FROM auth.staff_keys k WHERE k.user_id = account.id AND k.revoked_at IS NULL;
  IF live_keys >= 5 THEN
    RAISE EXCEPTION 'staff_key_limit' USING DETAIL = 'The account already holds 5 live staff keys.';
  END IF;
  UPDATE auth.staff_enrollments e SET used_at = now() WHERE e.id = enrolment.id;
  INSERT INTO auth.staff_keys (user_id, credential_id, public_key, counter, transports, name, aaguid, origin, rp_id)
  VALUES (account.id, add_staff_key.credential_id, add_staff_key.public_key, add_staff_key.counter,
          coalesce(add_staff_key.transports, '{}'::text[]), add_staff_key.name, add_staff_key.aaguid, enrolment.origin, enrolment.rp_id)
  RETURNING id INTO new_key_id;
  -- The metadata names the enrolment, never the key's name or AAGUID: the account's deletion blanks those on the key,
  -- and nothing can blank them in the log.
  INSERT INTO public.audit_log (actor_id, action, target_type, target_id, key_id, metadata, request_id)
  VALUES (account.id, 'staff_key_added', 'staff_key', new_key_id::text, new_key_id,
          jsonb_build_object('enrollmentId', enrolment.id), add_staff_key.request_id);
  RETURN new_key_id;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth"."add_staff_key"(text, text, text, bigint, text[], text, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth"."add_staff_key"(text, text, text, bigint, text[], text, uuid, text) TO korbat_auth;--> statement-breakpoint
-- The auth side's rows of the audit log, which the auth role cannot write itself (it holds nothing in public): each is
-- written in the same transaction as its change, as that transaction's last statement, so a fact is in the record exactly
-- when its change committed. Only the auth side's actions pass, so the auth role can never write a decision; the take-down's
-- revocations are staff_key_revoked rows. Returns the row's place in the chain.
CREATE FUNCTION "auth"."append_audit"(actor_id uuid, action text, target_type text, target_id text, metadata jsonb, staff_session uuid, key_id uuid, action_hash text, step_up jsonb, request_id text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = auth, pg_temp AS $$
DECLARE
  place bigint;
BEGIN
  IF append_audit.action IS NULL OR append_audit.action NOT IN (
    'staff_key_revoked', 'staff_key_counter_regression', 'staff_sign_in', 'staff_signed_out',
    'staff_session_revoked', 'staff_enrollments_cancelled', 'role_granted'
  ) THEN
    RAISE EXCEPTION '%', format('auth.append_audit does not write the action %L', append_audit.action);
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_type, target_id, metadata, staff_session, key_id, action_hash, step_up, request_id)
  VALUES (append_audit.actor_id, append_audit.action, append_audit.target_type, append_audit.target_id,
          coalesce(append_audit.metadata, '{}'::jsonb), append_audit.staff_session, append_audit.key_id,
          append_audit.action_hash, append_audit.step_up, append_audit.request_id)
  RETURNING chain_seq INTO place;
  RETURN place;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth"."append_audit"(uuid, text, text, text, jsonb, uuid, uuid, text, jsonb, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth"."append_audit"(uuid, text, text, text, jsonb, uuid, uuid, text, jsonb, text) TO korbat_auth;--> statement-breakpoint
-- The account take-down's last word on its staff keys, which are never deleted: for an account marked deleted, every key
-- keeps only what audit-verify needs (its id, owner, credential id, public key, origin and relying party ID), its counter
-- and its dates; its name, AAGUID and transports go. For a live account it changes nothing. Returns how many keys it blanked.
CREATE FUNCTION "auth"."forget_staff_keys"(user_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = auth, pg_temp AS $$
DECLARE
  forgotten integer;
BEGIN
  UPDATE auth.staff_keys k SET name = '', aaguid = NULL, transports = '{}'::text[]
   WHERE k.user_id = forget_staff_keys.user_id
     AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = forget_staff_keys.user_id AND u.deleted_at IS NOT NULL);
  GET DIAGNOSTICS forgotten = ROW_COUNT;
  RETURN forgotten;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth"."forget_staff_keys"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth"."forget_staff_keys"(uuid) TO korbat_auth;

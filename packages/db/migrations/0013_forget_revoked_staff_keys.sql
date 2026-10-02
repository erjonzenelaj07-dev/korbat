-- The take-down's last word on its staff keys (3a design, section 6), now blanking only keys that are already revoked.
-- korbat_auth may set and clear auth.users.deleted_at, so the account's mark alone let it blank a live account's keys
-- (mark it deleted, call this, clear the mark): the name, AAGUID and transports its column grants keep it from changing,
-- which staff.js keys and the runbook rely on. It can revoke a key but never undo that (the never-cleared trigger), so a
-- key it can blank is one it has already ended for good, which gives it nothing it cannot already do. The take-down
-- revokes every key earlier in the same transaction, so it still blanks them all. Every key keeps what audit-verify needs
-- (its id, owner, credential id, public key, origin and relying party ID), its counter and its dates. Returns how many
-- keys it blanked. CREATE OR REPLACE keeps the function's owner and its grants; they are stated again all the same.
CREATE OR REPLACE FUNCTION "auth"."forget_staff_keys"(user_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = auth, pg_temp AS $$
DECLARE
  forgotten integer;
BEGIN
  UPDATE auth.staff_keys k SET name = '', aaguid = NULL, transports = '{}'::text[]
   WHERE k.user_id = forget_staff_keys.user_id
     AND k.revoked_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = forget_staff_keys.user_id AND u.deleted_at IS NOT NULL);
  GET DIAGNOSTICS forgotten = ROW_COUNT;
  RETURN forgotten;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth"."forget_staff_keys"(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth"."forget_staff_keys"(uuid) TO korbat_auth;

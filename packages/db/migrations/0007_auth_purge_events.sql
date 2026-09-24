-- auth_events stays append-only for korbat_auth (migration 0003 revoked UPDATE and DELETE). Retention runs
-- through this function instead: it belongs to the migrator, which owns the table, so the API role can remove
-- rows older than a cut-off without ever holding DELETE itself.
CREATE OR REPLACE FUNCTION "auth"."purge_events"(older_than interval) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = auth, pg_temp AS $$
DECLARE removed integer;
BEGIN
  DELETE FROM auth.auth_events WHERE created_at < now() - older_than;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth"."purge_events"(interval) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth"."purge_events"(interval) TO korbat_auth;

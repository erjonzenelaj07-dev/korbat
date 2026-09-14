-- Schema access. Roles exist already (infra/postgres/init/01-roles.sh).
GRANT USAGE ON SCHEMA "auth" TO korbat_auth;
GRANT USAGE ON SCHEMA "public" TO korbat_api;
REVOKE ALL ON SCHEMA "auth" FROM korbat_api;
REVOKE ALL ON SCHEMA "public" FROM korbat_auth;

-- Tables that exist now.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "auth" TO korbat_auth;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "auth" TO korbat_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "public" TO korbat_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "public" TO korbat_api;

-- Tables created by future migrations (run as korbat_migrate).
ALTER DEFAULT PRIVILEGES IN SCHEMA "auth" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO korbat_auth;
ALTER DEFAULT PRIVILEGES IN SCHEMA "auth" GRANT USAGE, SELECT ON SEQUENCES TO korbat_auth;
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO korbat_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" GRANT USAGE, SELECT ON SEQUENCES TO korbat_api;

-- audit_log is append-only for the API role, at the grant level as well as via RLS.
REVOKE UPDATE, DELETE, TRUNCATE ON "public"."audit_log" FROM korbat_api;

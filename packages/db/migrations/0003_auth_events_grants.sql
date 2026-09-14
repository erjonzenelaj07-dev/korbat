-- auth_events is append-only: the auth role may insert and read, never change or remove rows.
-- Default privileges from 0001 granted UPDATE and DELETE on new auth tables, so revoke them here.
REVOKE UPDATE, DELETE, TRUNCATE ON "auth"."auth_events" FROM korbat_auth;
GRANT SELECT, INSERT ON "auth"."auth_events" TO korbat_auth;
GRANT USAGE, SELECT ON SEQUENCE "auth"."auth_events_id_seq" TO korbat_auth;

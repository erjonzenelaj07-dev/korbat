#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v db="$POSTGRES_DB" \
  -v migrate_pw="$KORBAT_MIGRATE_DB_PASSWORD" \
  -v api_pw="$KORBAT_API_DB_PASSWORD" \
  -v auth_pw="$KORBAT_AUTH_DB_PASSWORD" -v notify_pw="${KORBAT_NOTIFY_DB_PASSWORD:-}" <<'EOSQL'
CREATE ROLE korbat_migrate LOGIN PASSWORD :'migrate_pw';
CREATE ROLE korbat_api     LOGIN PASSWORD :'api_pw';
CREATE ROLE korbat_auth    LOGIN PASSWORD :'auth_pw';
-- The contact point's watcher (3f). Its password is empty on a server that has no mailbox yet: the role then cannot sign
-- in, and nothing needs it to.
CREATE ROLE korbat_notify  LOGIN PASSWORD :'notify_pw';

-- Nobody gets the public schema for free (PG15+ already removed CREATE; remove USAGE too).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE USAGE  ON SCHEMA public FROM PUBLIC;

-- Migrator owns all objects and may create schemas.
GRANT CREATE ON DATABASE :"db" TO korbat_migrate;
GRANT ALL ON SCHEMA public TO korbat_migrate;
GRANT USAGE ON SCHEMA public TO korbat_api;
-- Only the superuser can give the watcher the schema's USAGE: the migrator holds its privileges here without the grant
-- option. The first migration of 3f stops until it is given.
GRANT USAGE ON SCHEMA public TO korbat_notify;
EOSQL

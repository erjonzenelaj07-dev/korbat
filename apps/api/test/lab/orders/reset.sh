#!/bin/sh
# Rebuilds the lab database lab3f from the template lab (migrations 0000 to 0016): prototype in one transaction, helpers, seed.
set -eu
PGBIN="/c/Program Files/PostgreSQL/18/bin"; P="-h localhost -p 55441"
"$PGBIN/psql" $P -U postgres -q -c "DROP DATABASE IF EXISTS lab3f" -c "CREATE DATABASE lab3f TEMPLATE lab" 2>/dev/null
"$PGBIN/psql" $P -U korbat_migrate -d lab3f -v ON_ERROR_STOP=1 -q -1 -f 20-proto.sql
"$PGBIN/psql" $P -U korbat_migrate -d lab3f -v ON_ERROR_STOP=1 -q -1 -f 21-helpers.sql
"$PGBIN/psql" $P -U postgres -d lab3f -v ON_ERROR_STOP=1 -q -1 -f 22-seed.sql
echo RESET_OK

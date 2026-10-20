#!/bin/sh
# Rebuilds the lab database lab3d from the template lab (migrations 0000 to 0017): prototype in one transaction, helpers, seed.
set -eu
C=korbat3d-lab-1
cd "$(dirname "$0")"
docker exec $C psql -U postgres -q -c "DROP DATABASE IF EXISTS lab3d" -c "CREATE DATABASE lab3d TEMPLATE lab" 2>/dev/null
docker exec -i $C psql -U korbat_migrate -d lab3d -v ON_ERROR_STOP=1 -q -1 < 30-proto.sql
docker exec -i $C psql -U korbat_migrate -d lab3d -v ON_ERROR_STOP=1 -q -1 < 31-helpers.sql
docker exec -i $C psql -U postgres -d lab3d -v ON_ERROR_STOP=1 -q -1 < 32-seed.sql
echo RESET_OK

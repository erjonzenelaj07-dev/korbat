# korbat Foundation — Task 8 of 16: Compose data services, Postgres roles, first migration

You are executing one task of an approved implementation plan. Do this task completely, verify it, commit it, and report. Do nothing beyond it.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend, packaged as one Docker Compose stack so the same files run on a laptop, a VPS, and later the owner's home server. Data services: Postgres 16 (single source of truth), Redis 7 (rate-limit counters, job queue), MinIO (S3-compatible private bucket for images). Least privilege in Postgres is central to the security design: three login roles (`korbat_migrate` owns objects and runs migrations; `korbat_api` sees only the `public` schema; `korbat_auth` sees only the `auth` schema with all PII). The roles are created by an init script that runs once on an empty data volume; grants are a versioned migration (`0001_grants.sql`, from Task 7).

This task writes the Compose files for the data services and the `migrate` job, the env template, and the role bootstrap script, then proves in a live Postgres that migrations apply and the isolation actually holds. The API, worker, and Caddy services are added to Compose in Task 14.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. **Docker Desktop must be running** (Docker 29.x, Compose v5). Verify with `docker info >/dev/null && echo ok`.
- Compose notes: with `-f infra/compose.yml`, Compose loads `infra/.env` automatically for `${VAR}` substitution. Postgres official image runs `*.sh` files in `/docker-entrypoint-initdb.d` only on first initialisation of the data volume; to re-run them use `docker compose -f infra/compose.yml down -v`. Inside `docker compose exec postgres psql ...`, local socket connections are trusted, so no password is needed for any role.
- Full plan: `docs/superpowers/plans/2026-09-03-foundation.md` (Task 8).

## Preconditions

`git log --oneline -1` must show `feat(db): client, migrator and initial migrations with role grants`. `packages/db/migrations/0000_*.sql` and `0001_grants.sql` exist. If `infra/compose.yml` already exists, verify it matches this prompt, fix drift, then run the verification steps and skip to the report.

## Rules

1. Exact file contents below. The `migrate` service references `apps/api/Dockerfile`, which does not exist until Task 14; that is expected, and this task does not start that service.
2. `infra/.env` is gitignored and must never be committed. Only `infra/.env.example` is.
3. `01-roles.sh` must have LF endings and the executable bit (`chmod +x`), or Postgres will silently skip it.
4. Never lower an isolation check to make it pass. If a permission check does not produce "permission denied", stop and report; it is a real bug.
5. Verify before claiming; paste real output.
6. Commit exactly once with the given message and trailer.

## Files to create

### `infra/postgres/init/01-roles.sh`
```sh
#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v db="$POSTGRES_DB" \
  -v migrate_pw="$KORBAT_MIGRATE_DB_PASSWORD" \
  -v api_pw="$KORBAT_API_DB_PASSWORD" \
  -v auth_pw="$KORBAT_AUTH_DB_PASSWORD" <<'EOSQL'
CREATE ROLE korbat_migrate LOGIN PASSWORD :'migrate_pw';
CREATE ROLE korbat_api     LOGIN PASSWORD :'api_pw';
CREATE ROLE korbat_auth    LOGIN PASSWORD :'auth_pw';

-- Nobody gets the public schema for free (PG15+ already removed CREATE; remove USAGE too).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE USAGE  ON SCHEMA public FROM PUBLIC;

-- Migrator owns all objects and may create schemas.
GRANT CREATE ON DATABASE :"db" TO korbat_migrate;
GRANT ALL ON SCHEMA public TO korbat_migrate;
GRANT USAGE ON SCHEMA public TO korbat_api;
EOSQL
```
After writing it: `chmod +x infra/postgres/init/01-roles.sh` and confirm `file infra/postgres/init/01-roles.sh` does not say CRLF.

### `infra/.env.example`
```
# Copy to infra/.env and change every password. Never commit infra/.env.
POSTGRES_USER=postgres
POSTGRES_PASSWORD=change-me-superuser
POSTGRES_DB=korbat
KORBAT_MIGRATE_DB_PASSWORD=change-me-migrate
KORBAT_API_DB_PASSWORD=change-me-api
KORBAT_AUTH_DB_PASSWORD=change-me-auth

MINIO_ROOT_USER=korbat
MINIO_ROOT_PASSWORD=change-me-minio
MINIO_BUCKET=korbat-media

API_LOG_LEVEL=info
# Comma-separated browser origins allowed to call the API cross-origin. Empty in prod (same origin via Caddy).
API_TRUSTED_ORIGINS=http://localhost:8081

# Cloudflare Tunnel token (Zero Trust > Networks > Tunnels). Only needed with --profile tunnel.
TUNNEL_TOKEN=
```

### `infra/compose.yml`
```yaml
name: korbat

x-node-common: &node-common
  restart: unless-stopped
  read_only: true
  tmpfs: ["/tmp"]
  security_opt: ["no-new-privileges:true"]

services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
      KORBAT_MIGRATE_DB_PASSWORD: ${KORBAT_MIGRATE_DB_PASSWORD}
      KORBAT_API_DB_PASSWORD: ${KORBAT_API_DB_PASSWORD}
      KORBAT_AUTH_DB_PASSWORD: ${KORBAT_AUTH_DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./postgres/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--maxmemory", "256mb", "--maxmemory-policy", "noeviction"]
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 20

  minio:
    image: minio/minio:latest
    restart: unless-stopped
    command: ["server", "/data", "--console-address", ":9001"]
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
    volumes:
      - miniodata:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 3s
      retries: 20

  minio-init:
    image: minio/mc:latest
    depends_on:
      minio: { condition: service_healthy }
    entrypoint: ["/bin/sh", "-c"]
    command:
      - >
        mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" &&
        mc mb --ignore-existing "local/$MINIO_BUCKET" &&
        mc anonymous set none "local/$MINIO_BUCKET"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
      MINIO_BUCKET: ${MINIO_BUCKET}

  migrate:
    <<: *node-common
    restart: "no"
    build:
      context: ..
      dockerfile: apps/api/Dockerfile
    command: ["node", "dist/migrate.js"]
    environment:
      DATABASE_URL_MIGRATE: postgres://korbat_migrate:${KORBAT_MIGRATE_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      MIGRATIONS_DIR: /app/migrations
    depends_on:
      postgres: { condition: service_healthy }

volumes:
  pgdata:
  redisdata:
  miniodata:
```

### `infra/compose.dev.yml`
```yaml
services:
  postgres:
    ports: ["5432:5432"]
  redis:
    ports: ["6379:6379"]
  minio:
    ports: ["9000:9000", "9001:9001"]
```

## Steps

1. Create the four files; `chmod +x` the script.
2. `cp infra/.env.example infra/.env` (keep the example passwords for local dev; they are only reachable on localhost).
3. Validate: `docker compose -f infra/compose.yml config -q && echo "compose ok"`. Expected: `compose ok`. (A warning about the missing Dockerfile for `migrate` is acceptable for `config`; an error is not.)
4. Start the data services fresh:
   ```bash
   docker compose -f infra/compose.yml -f infra/compose.dev.yml down -v
   docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis minio minio-init
   docker compose -f infra/compose.yml ps
   ```
   Expected: `postgres`, `redis`, `minio` healthy; `minio-init` exited with code 0.
5. Check the roles were created:
   ```bash
   docker compose -f infra/compose.yml exec postgres psql -U postgres -d korbat -c "\du"
   ```
   Expected: `korbat_api`, `korbat_auth`, `korbat_migrate` listed. If they are missing, the init script did not run: check `docker compose -f infra/compose.yml logs postgres` for a CRLF or permission error, fix, and repeat step 4 (the `down -v` is what makes it re-run).
6. Apply migrations from the host as `korbat_migrate`:
   ```bash
   cd packages/db && DATABASE_URL_MIGRATE=postgres://korbat_migrate:change-me-migrate@localhost:5432/korbat npx tsx -e "import('./src/migrate.ts').then(m => m.runMigrations(process.env.DATABASE_URL_MIGRATE, './migrations'))" && cd ../..
   ```
   Expected: exits 0 with no error. Then confirm:
   ```bash
   docker compose -f infra/compose.yml exec postgres psql -U postgres -d korbat -c "select count(*) from drizzle.__drizzle_migrations"
   ```
   Expected: `2`.
7. Verify isolation. Run each and compare:
   ```bash
   docker compose -f infra/compose.yml exec postgres psql -U korbat_api -d korbat -c "select count(*) from auth.users"
   ```
   Expected: `ERROR:  permission denied for schema auth`
   ```bash
   docker compose -f infra/compose.yml exec postgres psql -U korbat_api -d korbat -c "insert into audit_log (actor_id, action) values (gen_random_uuid(), 'test'); update audit_log set action='x'"
   ```
   Expected: `INSERT 0 1` followed by `ERROR:  permission denied for table audit_log`
   ```bash
   docker compose -f infra/compose.yml exec postgres psql -U korbat_auth -d korbat -c "select count(*) from profiles"
   ```
   Expected: `ERROR:  permission denied for schema public`
   ```bash
   docker compose -f infra/compose.yml exec postgres psql -U korbat_api -d korbat -c "select count(*) from posts"
   ```
   Expected: a count of `0`
   ```bash
   docker compose -f infra/compose.yml exec postgres psql -U korbat_auth -d korbat -c "select count(*) from auth.sessions"
   ```
   Expected: a count of `0`
   ```bash
   docker compose -f infra/compose.yml exec postgres psql -U korbat_api -d korbat -c "select relname, relrowsecurity from pg_class where relname in ('posts','profiles','audit_log')"
   ```
   Expected: all three rows show `t`.
8. Leave the containers running (later tasks use them). Commit:
```bash
git add -A && git commit -m "feat(infra): compose data services, postgres roles bootstrap

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
   Confirm with `git status --short` that `infra/.env` is not tracked.

## Report format

- Files created
- Output of steps 3, 4 (`ps`), 5, 6 (count), and every command in step 7
- Deviations and why
- Anything blocked or uncertain (Docker not running is the usual one)

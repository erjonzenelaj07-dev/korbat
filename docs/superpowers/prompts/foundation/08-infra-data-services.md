# korbat Foundation — Task 8 of 16: Compose data services, Postgres roles, first migration

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-13 against real containers with the exact images named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend packaged as one Docker Compose stack. Data services: Postgres 16 (single source of truth), Redis 7 (rate-limit counters, job queue), MinIO (S3-compatible private bucket for images). Least privilege in Postgres is central: three login roles (`korbat_migrate` owns objects and runs migrations; `korbat_api` sees only `public`; `korbat_auth` sees only `auth`, which holds all PII). The roles are created by an init script that runs once on an empty data volume; grants are the versioned migration `0001_grants.sql` from Task 7.

This task writes the Compose files for the data services and the `migrate` job, the env template, and the role bootstrap script, then proves in a live Postgres that migrations apply and the isolation holds. The API, worker, and Caddy services are added in Task 14.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. **Docker Desktop must be running** (Docker 29.x, Compose v5). Verify first with `docker info >/dev/null && echo docker-ok`.
- Images (pinned; MinIO publishes to quay.io, not Docker Hub): `postgres:16-alpine`, `redis:7-alpine`, `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z`, `quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z`.
- Compose loads `infra/.env` automatically when invoked with `-f infra/compose.yml`. Postgres runs `/docker-entrypoint-initdb.d/*.sh` only on first initialisation of the data volume; `down -v` resets it. Inside `docker compose exec postgres psql`, local socket connections are trusted, so no password is needed for any role.
- Ports 5432, 6379, 9000, 9001 on localhost must be free.

## Preconditions

`git log --oneline -1` must show `feat(db): client, migrator and initial migrations with role grants`. `packages/db/migrations/0000_*.sql` and `0001_grants.sql` exist. If `infra/compose.yml` exists, compare with this prompt, fix drift, then run steps 3 to 8 and report.

## Rules (read twice)

1. Copy every file below byte for byte. The `migrate` service references `apps/api/Dockerfile`, which does not exist until Task 14; that is expected and this task never starts that service.
2. Run every command exactly as written, in order, from the repo root.
3. Compare each command's output with the **Expected** text. A container that is not `healthy`/`Exited (0)`, a missing role, a wrong migration count, or an isolation check that does not print the exact error shown is a **STOP condition**. Never weaken a check to make it pass.
4. On a STOP condition: stop, write the report with the exact output, and end the session. The one exception is step 5's note about re-running the init script.
5. `infra/.env` is gitignored and must never be committed. `01-roles.sh` must have LF line endings and the executable bit.
6. Commit exactly once, at the end, with the exact message given.
7. The report format at the bottom is mandatory.

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
    image: quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z
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
    image: quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z
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

1. Create the four files. Then run:
   ```bash
   chmod +x infra/postgres/init/01-roles.sh && file infra/postgres/init/01-roles.sh
   ```
   Expected: the `file` output does not contain `CRLF`.
2. Run:
   ```bash
   cp infra/.env.example infra/.env
   ```
3. Run:
   ```bash
   docker compose -f infra/compose.yml config -q && echo "compose ok"
   ```
   Expected: `compose ok` (warnings are fine; an error is a STOP).
4. Start fresh:
   ```bash
   docker compose -f infra/compose.yml -f infra/compose.dev.yml down -v
   docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis minio minio-init
   sleep 10
   docker compose -f infra/compose.yml ps -a --format "table {{.Name}}\t{{.Status}}"
   ```
   Expected:
   ```
   korbat-minio-1        Up ... (healthy)
   korbat-minio-init-1   Exited (0) ...
   korbat-postgres-1     Up ... (healthy)
   korbat-redis-1        Up ... (healthy)
   ```
5. Check the roles:
   ```bash
   docker compose -f infra/compose.yml exec -T postgres psql -U postgres -d korbat -c "\du" | grep korbat
   ```
   Expected: three lines, `korbat_api`, `korbat_auth`, `korbat_migrate`. If none appear, the init script did not run: run `docker compose -f infra/compose.yml logs postgres | grep -i -E "01-roles|error"`, paste it in the report, and STOP.
6. Apply migrations from the host as `korbat_migrate`:
   ```bash
   cd packages/db && DATABASE_URL_MIGRATE=postgres://korbat_migrate:change-me-migrate@localhost:5432/korbat npx tsx -e "import('./src/migrate.ts').then(m => m.runMigrations(process.env.DATABASE_URL_MIGRATE, './migrations')).then(() => console.log('migrated'))" && cd ../..
   docker compose -f infra/compose.yml exec -T postgres psql -U postgres -d korbat -tAc "select count(*) from drizzle.__drizzle_migrations"
   ```
   Expected: `migrated` then `2`.
7. Verify isolation. Run each line and compare with the line under it:
   ```bash
   docker compose -f infra/compose.yml exec -T postgres psql -U korbat_api -d korbat -c "select count(*) from auth.users"
   ```
   `ERROR:  permission denied for schema auth`
   ```bash
   docker compose -f infra/compose.yml exec -T postgres psql -U korbat_api -d korbat -c "insert into audit_log (actor_id, action) values (gen_random_uuid(), 'test'); update audit_log set action='x'"
   ```
   `INSERT 0 1` then `ERROR:  permission denied for table audit_log`
   ```bash
   docker compose -f infra/compose.yml exec -T postgres psql -U korbat_auth -d korbat -c "select count(*) from public.profiles"
   ```
   `ERROR:  permission denied for schema public`
   ```bash
   docker compose -f infra/compose.yml exec -T postgres psql -U korbat_api -d korbat -tAc "select count(*) from posts"
   ```
   `0`
   ```bash
   docker compose -f infra/compose.yml exec -T postgres psql -U korbat_auth -d korbat -tAc "select count(*) from auth.sessions"
   ```
   `0`
   ```bash
   docker compose -f infra/compose.yml exec -T postgres psql -U korbat_api -d korbat -tAc "select relname, relrowsecurity from pg_class where relname in ('posts','profiles','audit_log') order by 1"
   ```
   `audit_log|t`, `posts|t`, `profiles|t`
   ```bash
   docker compose -f infra/compose.yml logs minio-init | tail -2
   ```
   Contains `Bucket created successfully` and `is set to `private``.
8. Leave the containers running (later tasks use them). Confirm `git status --short` does not list `infra/.env`, then commit:
   ```bash
   git add -A && git commit -m "feat(infra): compose data services, postgres roles bootstrap

   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
   ```
9. Run `git log --oneline -1`. Expected subject: `feat(infra): compose data services, postgres roles bootstrap`.

## Report format (mandatory)

```
TASK 8 REPORT
Files created: <list>
Step 1 output: <paste>
Step 3 output: <paste>
Step 4 table: <paste>
Step 5 output: <paste>
Step 6 output: <paste>
Step 7 outputs (all seven, in order): <paste>
Step 9 output: <paste>
STOP condition hit: none | <exact output>
```

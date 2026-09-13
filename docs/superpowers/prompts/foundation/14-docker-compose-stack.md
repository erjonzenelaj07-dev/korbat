# korbat Foundation — Task 14 of 16: Dockerfiles, Caddy, and the full Compose stack

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-13 against real containers. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend packaged as one Docker Compose stack. Task 8 added the data services and the `migrate` job. This task adds the application containers:

- **api** (Task 11): bundled by tsup into `dist/index.js`; the same image runs `dist/migrate.js` for the `migrate` job. Non-root, read-only root filesystem, health-checked.
- **worker** (Task 12): the Redis list consumer, same hardening.
- **caddy**: a Caddy image with the Expo web export (Task 13) baked in. It serves the SPA at `/`, proxies `/api/*` to the API on the same origin, and sets the browser-facing security headers. Inside the box it speaks plain HTTP; Cloudflare terminates TLS at the edge and the tunnel is encrypted.
- **cloudflared** (behind a Compose profile so dev does not need it): the only ingress. No container publishes a port in the production configuration.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. **Docker Desktop running**. Ports 3000, 5432, 6379, 8080, 9000, 9001 free on localhost (stop any host-side dev API first).
- Images: `node:24-alpine`, `caddy:2-alpine`, `cloudflare/cloudflared:latest`, plus the Task 8 images.

## Preconditions

`git log --oneline -1` must show `feat(app): expo web shell with nativewind calling /api/health`. `infra/compose.yml` from Task 8 and `infra/.env` exist. If `apps/api/Dockerfile` exists, compare every file with this prompt, fix drift, run steps 3 to 7, and report.

## Rules (read twice)

1. Copy every file below byte for byte. `infra/compose.yml` and `infra/compose.dev.yml` are given in full and **replace** the Task 8 versions (the Task 8 services are unchanged inside them).
2. Run every command exactly as written, in order, from the repo root.
3. Compare each command's output with the **Expected** text. A container that is not healthy/running (or `Exited (0)` for the one-shot jobs), a missing header, a wrong HTTP status, or a browser console CSP violation is a **STOP condition**. Do not relax the CSP.
4. On a STOP condition: stop, write the report with the exact output (include `docker compose -f infra/compose.yml logs <service> | tail -30` for any failing service), and end the session.
5. No ports may be published in `infra/compose.yml`; only `infra/compose.dev.yml` publishes ports.
6. Commit exactly once, at the end, with the exact message given.
7. The report format at the bottom is mandatory.

## Files

### Create `.dockerignore` (repo root)
```
**/node_modules
**/dist
**/.expo
**/.env
**/.env.*
!**/.env.example
.git
docs
infra/.env
```

### Create `apps/api/Dockerfile`
```dockerfile
FROM node:24-alpine AS build
RUN npm install -g pnpm@10.30.0
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @korbat/api...
RUN pnpm --filter @korbat/api build

FROM node:24-alpine
ENV NODE_ENV=production
ARG KORBAT_VERSION=0.0.0
ENV KORBAT_VERSION=$KORBAT_VERSION
WORKDIR /app
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/packages/db/migrations ./migrations
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Create `apps/worker/Dockerfile`
```dockerfile
FROM node:24-alpine AS build
RUN npm install -g pnpm@10.30.0
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm install --frozen-lockfile --filter @korbat/worker...
RUN pnpm --filter @korbat/worker build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/worker/dist ./dist
USER node
CMD ["node", "dist/index.js"]
```

### Create `infra/caddy/Dockerfile`
```dockerfile
FROM node:24-alpine AS web
RUN npm install -g pnpm@10.30.0
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps/app ./apps/app
RUN pnpm install --frozen-lockfile --filter @korbat/app...
RUN cd apps/app && npx expo export --platform web

FROM caddy:2-alpine
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web /repo/apps/app/dist /srv
```

### Create `infra/caddy/Caddyfile`
```
{
  auto_https off
}

:80 {
  encode gzip

  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
    X-Frame-Options "DENY"
    Referrer-Policy "no-referrer"
    Permissions-Policy "camera=(), microphone=(), geolocation=()"
    Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    -Server
  }

  handle /api/* {
    reverse_proxy api:3000
  }

  handle {
    root * /srv
    try_files {path} /index.html
    file_server
  }
}
```

### Replace `infra/compose.yml` with this complete file
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

  api:
    <<: *node-common
    build:
      context: ..
      dockerfile: apps/api/Dockerfile
      args:
        KORBAT_VERSION: ${KORBAT_VERSION:-0.0.0}
    environment:
      NODE_ENV: production
      PORT: "3000"
      LOG_LEVEL: ${API_LOG_LEVEL:-info}
      DATABASE_URL_API: postgres://korbat_api:${KORBAT_API_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      DATABASE_URL_AUTH: postgres://korbat_auth:${KORBAT_AUTH_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      REDIS_URL: redis://redis:6379
      TRUSTED_ORIGINS: ${API_TRUSTED_ORIGINS:-}
    depends_on:
      migrate: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]
      interval: 10s
      timeout: 3s
      retries: 10

  worker:
    <<: *node-common
    build:
      context: ..
      dockerfile: apps/worker/Dockerfile
    environment:
      NODE_ENV: production
      LOG_LEVEL: ${API_LOG_LEVEL:-info}
      REDIS_URL: redis://redis:6379
    depends_on:
      redis: { condition: service_healthy }

  caddy:
    restart: unless-stopped
    build:
      context: ..
      dockerfile: infra/caddy/Dockerfile
    depends_on:
      api: { condition: service_healthy }
    volumes:
      - caddydata:/data
      - caddyconfig:/config

  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    profiles: ["tunnel"]
    command: ["tunnel", "--no-autoupdate", "run"]
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN}
    depends_on:
      - caddy

volumes:
  pgdata:
  redisdata:
  miniodata:
  caddydata:
  caddyconfig:
```

### Replace `infra/compose.dev.yml` with this complete file
```yaml
services:
  postgres:
    ports: ["5432:5432"]
  redis:
    ports: ["6379:6379"]
  minio:
    ports: ["9000:9000", "9001:9001"]
  api:
    ports: ["3000:3000"]
  caddy:
    ports: ["8080:80"]
```

## Steps

1. Create the five new files and replace the two compose files.
2. Run:
   ```bash
   docker compose -f infra/compose.yml config -q && echo "compose ok"
   ```
   Expected: `compose ok`.
3. Make sure nothing else listens on port 3000:
   ```bash
   for pid in $(netstat -ano | grep ":3000" | grep LISTENING | awk '{print $5}' | sort -u); do taskkill //PID $pid //F; done; echo "port 3000 free"
   ```
4. Bring everything up from clean (the first build takes several minutes):
   ```bash
   docker compose -f infra/compose.yml -f infra/compose.dev.yml down -v
   docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --build
   sleep 20
   docker compose -f infra/compose.yml ps -a --format "table {{.Name}}\t{{.Status}}"
   ```
   Expected:
   ```
   korbat-api-1          Up ... (healthy)
   korbat-caddy-1        Up ...
   korbat-migrate-1      Exited (0) ...
   korbat-minio-1        Up ... (healthy)
   korbat-minio-init-1   Exited (0) ...
   korbat-postgres-1     Up ... (healthy)
   korbat-redis-1        Up ... (healthy)
   korbat-worker-1       Up ...
   ```
5. Probe through Caddy:
   ```bash
   curl -s http://localhost:8080/api/health; echo
   curl -sI http://localhost:8080/ | grep -iE "content-security-policy|x-frame-options|^server"
   curl -s -o /dev/null -w "deep route: %{http_code}\n" http://localhost:8080/some/deep/route
   docker compose -f infra/compose.yml logs worker | tail -1 | cut -c1-100
   ```
   Expected:
   ```
   {"status":"ok","version":"0.0.0","checks":{"postgres_api":"ok","postgres_auth":"ok","redis":"ok"}}
   Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
   X-Frame-Options: DENY
   deep route: 200
   worker-1  | {"level":30,"time":<n>,"msg":"worker started"}
   ```
   (No `Server:` line must appear.)
6. Browser check: open http://localhost:8080 with this session's browser tool if it has one, otherwise ask the operator. Expected: near-black page with `korbat` and `api ok · v0.0.0`; the browser console shows no `Content-Security-Policy` error. Verified on 2026-09-13 with this exact Caddyfile and the Task 13 export: zero console errors.
7. Confirm `git status --short` lists no `.env` files. Commit:
   ```bash
   git add -A && git commit -m "feat(infra): api, worker and caddy images; full compose stack

   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
   ```
8. Run `git log --oneline -1`. Expected subject: `feat(infra): api, worker and caddy images; full compose stack`.

## Report format (mandatory)

```
TASK 14 REPORT
Files created/replaced: <list>
Step 2 output: <paste>
Step 4 table: <paste>
Step 5 output (all lines): <paste>
Step 6 result (what the page showed, console clean yes/no): <paste>
Step 8 output: <paste>
STOP condition hit: none | <exact output + logs>
```

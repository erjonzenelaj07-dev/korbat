# korbat Foundation — Task 14 of 16: Dockerfiles, Caddy, and the full Compose stack

You are executing one task of an approved implementation plan. Do this task completely, verify it, commit it, and report. Do nothing beyond it.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend packaged as one Docker Compose stack, so the same files run on a laptop, a cheap VPS at launch, and later the owner's home server. Task 8 added the data services (Postgres with three least-privilege roles, Redis, MinIO) and a `migrate` job. This task adds the application containers:

- **api** (Task 11): Hono API bundled by tsup into `dist/index.js`; the same image runs `dist/migrate.js` for the `migrate` job. Non-root, read-only root filesystem, health-checked on `/api/health`.
- **worker** (Task 12): the Redis list consumer, same hardening.
- **caddy**: a Caddy image that has the Expo web export (Task 13) baked in. It serves the SPA at `/`, proxies `/api/*` to the API on the same origin, and sets the browser-facing security headers (CSP, HSTS, framing, referrer). Inside the box it speaks plain HTTP; TLS is terminated by Cloudflare at the edge and the tunnel (Task 16) is encrypted.
- **cloudflared** (behind a Compose profile so dev does not need it): the only ingress. No container publishes a port in the production configuration; `compose.dev.yml` publishes localhost ports for development.

Done means: `docker compose up --build` from a clean state ends with every long-running service healthy and http://localhost:8080 shows the korbat shell reporting `api ok`.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. **Docker Desktop running** (Docker 29.x, Compose v5). Builds pull `node:24-alpine`, `caddy:2-alpine`, `cloudflare/cloudflared`.
- Notes: build contexts are the repo root (`context: ..` relative to `infra/`) so Dockerfiles can copy `packages/` and `pnpm-lock.yaml`. `pnpm install --filter @korbat/api...` installs only that package and its workspace dependencies. `node:24-alpine` includes busybox `wget` (used by the health check) and a `node` user. Caddy's `header` directive with `-Server` removes the Server header.
- Full plan: `docs/superpowers/plans/2026-09-03-foundation.md` (Task 14).

## Preconditions

`git log --oneline -1` must show `feat(app): expo web shell with nativewind calling /api/health`. `apps/api/tsup.config.ts`, `apps/worker/tsup.config.ts`, `apps/app/app.json` exist; `infra/compose.yml` from Task 8 exists; `infra/.env` exists. If `apps/api/Dockerfile` exists, verify against this prompt, fix drift, run the verification, skip to the report.

## Rules

1. Exact file contents below. Append the new services to the existing `infra/compose.yml`; do not rewrite the Task 8 services.
2. Do not publish ports in `infra/compose.yml`; only `infra/compose.dev.yml` may.
3. Do not relax the CSP to make the page load unless the browser console shows a specific violation; then add only the specific hash or source the console names, and report it.
4. LF line endings, 2-space indentation (Dockerfiles and Caddyfile: 2 spaces as shown).
5. Verify before claiming; paste real output.
6. Commit exactly once with the given message and trailer.

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

### Append to `infra/compose.yml` under `services:` (keep existing services unchanged)
```yaml
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
```
And add under the top-level `volumes:` block:
```yaml
  caddydata:
  caddyconfig:
```

### Append to `infra/compose.dev.yml` under `services:`
```yaml
  api:
    ports: ["3000:3000"]
  caddy:
    ports: ["8080:80"]
```

## Steps

1. Create the five files and make the two compose edits.
2. Validate: `docker compose -f infra/compose.yml config -q && echo "compose ok"`. Expected: `compose ok`.
3. Stop any host-side dev API still running on port 3000 (`kill %1` or close its terminal) so the published port is free.
4. Bring everything up from clean:
   ```bash
   docker compose -f infra/compose.yml -f infra/compose.dev.yml down -v
   docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --build
   docker compose -f infra/compose.yml ps
   ```
   Expected: `postgres`, `redis`, `minio`, `api`, `caddy` show `healthy` (or `running` for `worker`); `migrate` and `minio-init` show `exited (0)`. Builds take a few minutes the first time. If `api` restarts in a loop, read `docker compose -f infra/compose.yml logs api`; the usual cause is a wrong password in `infra/.env` (a `down -v` regenerated the roles with whatever is in `.env`, so they must match).
5. Probe through Caddy:
   ```bash
   curl -s http://localhost:8080/api/health
   curl -sI http://localhost:8080/ | grep -i -E "content-security-policy|x-frame-options|server"
   curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/some/deep/route
   ```
   Expected: health JSON with `"version":"0.0.0"` and all checks `ok`; CSP and `X-Frame-Options: DENY` present and no `Server` header; the deep route returns `200` (SPA fallback).
6. Open http://localhost:8080 in a browser. Expected: the dark korbat shell showing `api ok · v0.0.0`. Open the browser console: there must be no `Content-Security-Policy` violation. If there is one for an inline script, copy the `sha256-...` hash from the message, add it to `script-src` in the Caddyfile as `'sha256-...'`, rebuild caddy (`docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --build caddy`), and re-check.
7. Confirm the worker is alive: `docker compose -f infra/compose.yml logs worker | tail -2`. Expected: `worker started`.
8. Confirm `git status --short` shows no `.env` files. Commit:
```bash
git add -A && git commit -m "feat(infra): api, worker and caddy images; full compose stack

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Report format

- Files created/modified
- Output of steps 2, 4 (`ps`), 5, and 7
- What the browser showed and whether the console was clean (and any CSP hash added)
- Deviations and why
- Anything blocked or uncertain

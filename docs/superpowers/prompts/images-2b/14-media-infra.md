# korbat 2b — Task 14 of 17: Compose without MinIO: two media volumes, an image worker with no network, credentials or capabilities, a Caddy body limit, and dev scripts that load their env file

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-18 and 2026-09-19 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

The stack loses MinIO and gains two volumes and a hardened worker: no network, no capabilities, no credentials, a read-only root, 768 MiB of memory and no swap on top, one CPU, 64 processes, a small tmpfs, and `VIPS_BLOCK_UNTRUSTED`. The API writes only the uploads volume and reads the store; the worker the reverse. Caddy caps upload bodies at 25 MB, and the dev scripts load their env files themselves. The task proves the isolation on the built stack and sends a real image through the worker.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Ports 3000 and 8080 on localhost must be free. Stop any korbat API, worker or web process started from this repository first; never stop other Node processes on the machine.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `test(media): HTTP tests for upload, status, posting with images, public and author-only files, CSRF, refusals, the new-account tier and worker health`.
3. The previous task's integration run ended with `Tests  138 passed (138)`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the files

```bash
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/14-media-infra.md 1
```

Expected: 12 lines starting with `wrote`, one for each file below.

### Create `apps/worker/.env.example`

```text
NODE_ENV=development
LOG_LEVEL=debug
# The same two directories as in apps/api/.env. The worker only reads the first and only writes the second.
MEDIA_UPLOADS_DIR=../../.data/media/uploads
MEDIA_STORE_DIR=../../.data/media/store
MEDIA_FORMATS=jpeg,png,webp,gif,avif
# libvips reads this when it loads and blocks the loaders it marks as unsafe for untrusted input.
VIPS_BLOCK_UNTRUSTED=1
```

### Replace `infra/compose.yml` (whole file)

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
      # Auth settings. The stack refuses to start while any of these is missing from infra/.env.
      APP_ORIGIN: ${API_APP_ORIGIN:?set API_APP_ORIGIN in infra/.env}
      AUTH_HMAC_KEY: ${API_AUTH_HMAC_KEY:?set API_AUTH_HMAC_KEY in infra/.env}
      IP_HASH_KEY: ${API_IP_HASH_KEY:?set API_IP_HASH_KEY in infra/.env}
      TOTP_ENC_KEY: ${API_TOTP_ENC_KEY:?set API_TOTP_ENC_KEY in infra/.env}
      TURNSTILE_SECRET_KEY: ${API_TURNSTILE_SECRET_KEY:?set API_TURNSTILE_SECRET_KEY in infra/.env}
      SMTP_URL: ${API_SMTP_URL:?set API_SMTP_URL in infra/.env}
      MAIL_FROM: ${API_MAIL_FROM:?set API_MAIL_FROM in infra/.env}
      TERMS_VERSION: ${API_TERMS_VERSION:?set API_TERMS_VERSION in infra/.env}
      # Images. The API writes uploads and only reads what the worker stored.
      MEDIA_UPLOADS_DIR: /media/uploads
      MEDIA_STORE_DIR: /media/store
      MEDIA_FORMATS: ${MEDIA_FORMATS:-jpeg,png,webp,gif,avif}
      MEDIA_MIN_FREE_BYTES: ${MEDIA_MIN_FREE_BYTES:-2147483648}
    volumes:
      - media-uploads:/media/uploads
      - media-store:/media/store:ro
    depends_on:
      migrate: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]
      interval: 10s
      timeout: 3s
      retries: 10

  # The image worker runs the decoder, the most exploitable code in the stack. It has no network at
  # all, no credentials and no capabilities: it reads uploads and writes the store, and that is
  # everything it can reach. The memory limit was sized on worst-case images (2b design, Research).
  worker:
    <<: *node-common
    build:
      context: ..
      dockerfile: apps/worker/Dockerfile
    network_mode: none
    cap_drop: [ALL]
    mem_limit: 768m
    memswap_limit: 768m
    cpus: 1.0
    pids_limit: 64
    tmpfs: ["/tmp:size=64m"]
    environment:
      NODE_ENV: production
      LOG_LEVEL: ${API_LOG_LEVEL:-info}
      MEDIA_UPLOADS_DIR: /media/uploads
      MEDIA_STORE_DIR: /media/store
      MEDIA_FORMATS: ${MEDIA_FORMATS:-jpeg,png,webp,gif,avif}
    volumes:
      - media-uploads:/media/uploads:ro
      - media-store:/media/store
    healthcheck:
      test: ["CMD", "node", "-e", "process.exit(Date.now() - JSON.parse(require('fs').readFileSync('/media/store/heartbeat', 'utf8')).at < 60000 ? 0 : 1)"]
      interval: 15s
      timeout: 5s
      retries: 4

  caddy:
    restart: unless-stopped
    build:
      context: ..
      dockerfile: infra/caddy/Dockerfile
      args:
        EXPO_PUBLIC_TURNSTILE_SITE_KEY: ${WEB_TURNSTILE_SITE_KEY:?set WEB_TURNSTILE_SITE_KEY in infra/.env}
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
  # Uploads wait here for the worker and are deleted once processed. Nothing in it needs a backup.
  media-uploads:
  # The images korbat serves. Back it up together with the database.
  media-store:
  caddydata:
  caddyconfig:
```

### Replace `infra/compose.dev.yml` (whole file)

```yaml
services:
  postgres:
    ports: ["127.0.0.1:55432:5432"]
  redis:
    ports: ["127.0.0.1:56379:6379"]
  api:
    ports: ["127.0.0.1:3000:3000"]
  caddy:
    ports: ["127.0.0.1:8080:80"]
  # Development mail catcher: SMTP on 51025, web UI and HTTP API on 58025. Never used in production.
  mailpit:
    image: axllent/mailpit:v1.31.1
    restart: unless-stopped
    ports: ["127.0.0.1:51025:1025", "127.0.0.1:58025:8025"]
```

### Replace `infra/.env.example` (whole file)

```text
# Copy to infra/.env and change every password. Never commit infra/.env.
POSTGRES_USER=postgres
POSTGRES_PASSWORD=change-me-superuser
POSTGRES_DB=korbat
KORBAT_MIGRATE_DB_PASSWORD=change-me-migrate
KORBAT_API_DB_PASSWORD=change-me-api
KORBAT_AUTH_DB_PASSWORD=change-me-auth

# Images. The formats korbat accepts: remove one to refuse it and keep its decoder blocked, for
# example after a security advisory against that decoder, then restart api and worker.
MEDIA_FORMATS=jpeg,png,webp,gif,avif
# Uploads are refused while a media volume has less free space than this many bytes (2 GiB). The
# volumes share a disk with Postgres, and a full disk stops the database.
MEDIA_MIN_FREE_BYTES=2147483648

API_LOG_LEVEL=info
# Comma-separated browser origins allowed to call the API cross-origin. Empty in prod (same origin via Caddy).
API_TRUSTED_ORIGINS=http://localhost:8081

# Auth. `node scripts/gen-dev-env.mjs` fills the keys with random values and shares them with apps/api/.env.
# Origin the web app is served from (Caddy). Production: https://<your domain>.
API_APP_ORIGIN=http://localhost:8080
API_AUTH_HMAC_KEY=change-me-key-auth-hmac
API_IP_HASH_KEY=change-me-key-ip-hash
API_TOTP_ENC_KEY=v1:change-me-key-totp
# Cloudflare's documented always-pass test secret. Production uses the secret of your Turnstile widget.
API_TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
# Mailpit from compose.dev.yml. Production: the EU relay, e.g. smtps://user:pass@smtp-relay.example:465
API_SMTP_URL=smtp://mailpit:1025
API_MAIL_FROM="korbat <no-reply@korbat.local>"
API_TERMS_VERSION=draft-2026-09

# Public Turnstile site key baked into the web image. Cloudflare's always-pass test key for development;
# production uses the site key of the same widget as API_TURNSTILE_SECRET_KEY.
WEB_TURNSTILE_SITE_KEY=1x00000000000000000000AA

# Cloudflare Tunnel token (Zero Trust > Networks > Tunnels). Only needed with --profile tunnel.
TUNNEL_TOKEN=
```

### Replace `infra/caddy/Caddyfile` (whole file)

```text
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
    # challenges.cloudflare.com serves the Turnstile widget script and its iframe (sign-in screens).
    Content-Security-Policy "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    -Server
  }

  handle /api/* {
    # Image uploads. The API counts bytes itself and stops at 20 MiB; this is the second line behind it.
    @upload path /api/media
    request_body @upload {
      max_size 25MB
    }
    reverse_proxy api:3000
  }

  handle {
    root * /srv
    try_files {path} /index.html
    file_server
  }
}
```

### Replace `apps/api/Dockerfile` (whole file)

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
# argon2 is not bundled (native module). The install above ran on Alpine, so @node-rs holds the
# package and exactly the musl binary for this image's CPU architecture.
COPY --from=build /repo/node_modules/@node-rs ./node_modules/@node-rs
# The media volumes mount here. A new volume takes the owner of the path in the image, so both paths
# exist and belong to the user the process runs as, in this image and in the worker's.
RUN mkdir -p /media/uploads /media/store && chown node:node /media/uploads /media/store
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Replace `apps/api/.env.example` (whole file)

```text
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug
DATABASE_URL_API=postgres://korbat_api:change-me-api@localhost:55432/korbat
DATABASE_URL_AUTH=postgres://korbat_auth:change-me-auth@localhost:55432/korbat
DATABASE_URL_MIGRATE=postgres://korbat_migrate:change-me-migrate@localhost:55432/korbat
REDIS_URL=redis://localhost:56379
TRUSTED_ORIGINS=http://localhost:8081
APP_ORIGIN=http://localhost:8081
# Keys are generated by `node scripts/gen-dev-env.mjs`. Never reuse keys between environments.
AUTH_HMAC_KEY=change-me-key-auth-hmac
IP_HASH_KEY=change-me-key-ip-hash
TOTP_ENC_KEY=v1:change-me-key-totp
# Cloudflare's documented always-pass test secret. Production uses the real secret.
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
# Local Mailpit from infra/compose.dev.yml. Production points at the EU relay.
SMTP_URL=smtp://localhost:51025
MAIL_FROM="korbat <no-reply@korbat.local>"
TERMS_VERSION=draft-2026-09
# Mailpit HTTP API, read by integration tests only.
MAILPIT_URL=http://localhost:58025
# Images on the host: the API writes uploads, the worker (apps/worker) writes the store. Both
# directories are created on demand under the repository's ignored .data folder.
MEDIA_UPLOADS_DIR=../../.data/media/uploads
MEDIA_STORE_DIR=../../.data/media/store
MEDIA_FORMATS=jpeg,png,webp,gif,avif
MEDIA_MIN_FREE_BYTES=2147483648
```

### Replace `apps/api/package.json` (whole file)

```json
{
  "name": "@korbat/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file=.env src/index.ts",
    "build": "tsup",
    "start": "node dist/index.js",
    "typecheck": "tsc -p .",
    "test": "vitest run",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "update:disposable": "node scripts/update-disposable-domains.mjs"
  },
  "dependencies": {
    "@hono/node-server": "2.1.1",
    "@hono/zod-validator": "0.9.1",
    "@korbat/contracts": "workspace:*",
    "@korbat/db": "workspace:*",
    "@korbat/media-protocol": "workspace:*",
    "@korbat/rules": "workspace:*",
    "@node-rs/argon2": "2.2.0",
    "drizzle-orm": "0.45.2",
    "hono": "4.13.5",
    "ioredis": "5.11.1",
    "nodemailer": "10.0.0",
    "pino": "10.3.1",
    "pino-pretty": "13.1.3",
    "uqr": "0.1.3",
    "zod": "4.5.4"
  },
  "devDependencies": {
    "@types/node": "24.13.3",
    "@types/nodemailer": "6.4.24",
    "tsup": "8.5.1",
    "tsx": "4.23.13",
    "typescript": "5.9.3",
    "vitest": "4.1.11"
  }
}
```

### Replace `apps/worker/package.json` (whole file)

```json
{
  "name": "@korbat/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file=.env src/index.ts",
    "build": "tsup",
    "start": "node dist/index.js",
    "typecheck": "tsc -p .",
    "test": "vitest run"
  },
  "dependencies": {
    "@korbat/contracts": "workspace:*",
    "@korbat/media-protocol": "workspace:*",
    "blurhash": "2.0.5",
    "pino": "10.3.1",
    "sharp": "0.35.4",
    "zod": "4.5.4"
  },
  "devDependencies": {
    "@types/node": "24.13.3",
    "tsup": "8.5.1",
    "tsx": "4.23.13",
    "typescript": "5.9.3",
    "vitest": "4.1.11"
  }
}
```

### Replace `scripts/gen-dev-env.mjs` (whole file)

```js
#!/usr/bin/env node
/**
 * Creates or completes the local .env files from their committed examples: infra/.env,
 * apps/api/.env, apps/app/.env and apps/worker/.env.
 *
 * - `change-me-<word>`          -> 48 random hex characters (passwords)
 * - `change-me-key-<name>`      -> 32 random bytes, base64 (HMAC keys)
 * - `v1:change-me-key-<name>`   -> `v1:` + 32 random bytes, base64 (versioned encryption keys)
 * - `change-me-api|auth|migrate` inside apps/api/.env -> the matching password from infra/.env
 * - Keys used by both the API in Docker (`API_<NAME>` in infra/.env) and the API on the host
 *   (`<NAME>` in apps/api/.env) are generated once and copied to the other file, so both processes
 *   hash, sign and encrypt with the same keys.
 *
 * A value that already exists in a .env file is never changed. Keys that are new in an example
 * are appended. Values are never printed.
 *
 * It also writes apps/api/.env.test, the environment of the integration tests: apps/api/.env with
 * the database URLs pointing at `<database>_test` and the Redis URL at database 15. That file is
 * derived on every run, so it cannot drift from apps/api/.env. `node scripts/test-db.mjs` creates
 * the database it names.
 *
 * Usage: node scripts/gen-dev-env.mjs
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LINE = /^([A-Z0-9_]+)=(.*)$/;

function parse(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

function read(rel) {
  const path = resolve(root, rel);
  return existsSync(path) ? parse(readFileSync(path, "utf8")) : new Map();
}

/** `shared` holds key values that already exist in the other .env file, by this file's variable name. */
function generate(name, value, infra, shared) {
  if (value.includes("change-me-key-") && shared.has(name)) return shared.get(name);
  if (value.startsWith("v1:change-me-key-")) return `v1:${randomBytes(32).toString("base64")}`;
  if (value.startsWith("change-me-key-")) return randomBytes(32).toString("base64");
  return value
    .replace(/change-me-(api|auth|migrate)\b/g, (match, role) => infra.get(`KORBAT_${role.toUpperCase()}_DB_PASSWORD`) ?? match)
    .replace(/change-me-[a-z]+/g, () => randomBytes(24).toString("hex"));
}

function complete(relExample, relTarget, infra, shared) {
  const example = readFileSync(resolve(root, relExample), "utf8");
  const targetPath = resolve(root, relTarget);

  if (!existsSync(targetPath)) {
    const lines = example.split(/\r?\n/).map((line) => {
      const m = LINE.exec(line);
      return m ? `${m[1]}=${generate(m[1], m[2], infra, shared)}` : line;
    });
    writeFileSync(targetPath, lines.join("\n"), "utf8");
    console.log(`${relTarget}: created with ${parse(example).size} keys`);
    return;
  }

  const current = readFileSync(targetPath, "utf8");
  const existing = parse(current);
  const added = [];
  let out = current.replace(/\s*$/, "\n");
  for (const [name, value] of parse(example)) {
    if (existing.has(name)) continue;
    out += `${name}=${generate(name, value, infra, shared)}\n`;
    added.push(name);
  }
  if (added.length === 0) {
    console.log(`${relTarget}: nothing to add`);
    return;
  }
  writeFileSync(targetPath, out, "utf8");
  console.log(`${relTarget}: completed, added ${added.join(", ")}`);
}

const hostApi = read("apps/api/.env");
complete("infra/.env.example", "infra/.env", new Map(), new Map([...hostApi].map(([name, value]) => [`API_${name}`, value])));

const infra = read("infra/.env");
const dockerApi = new Map([...infra].filter(([name]) => name.startsWith("API_")).map(([name, value]) => [name.slice("API_".length), value]));
complete("apps/api/.env.example", "apps/api/.env", infra, dockerApi);

complete("apps/app/.env.example", "apps/app/.env", new Map(), new Map());
complete("apps/worker/.env.example", "apps/worker/.env", new Map(), new Map());

/** Rewrites apps/api/.env.test from apps/api/.env. Only where the data lives changes; every key stays the same. */
function deriveTestEnv() {
  const lines = readFileSync(resolve(root, "apps/api/.env"), "utf8")
    .split(/\r?\n/)
    .map((line) => {
      const m = LINE.exec(line);
      if (!m) return line;
      const [, name, value] = m;
      if (/^DATABASE_URL_(API|AUTH|MIGRATE)$/.test(name)) {
        const url = new URL(value);
        if (!url.pathname.endsWith("_test")) url.pathname = `${url.pathname}_test`;
        return `${name}=${url.href}`;
      }
      if (name === "REDIS_URL") {
        const url = new URL(value);
        url.pathname = "/15";
        return `${name}=${url.href}`;
      }
      return line;
    });
  const header = "# Derived from apps/api/.env by scripts/gen-dev-env.mjs. Do not edit this file: rerun the script.";
  writeFileSync(resolve(root, "apps/api/.env.test"), [header, ...lines].join("\n"), "utf8");
  console.log("apps/api/.env.test: derived from apps/api/.env (test database, Redis database 15)");
}

deriveTestEnv();
```

### Replace `.gitignore` (whole file)

```text
node_modules/
dist/
.expo/
.env
.env.*
!.env.example
*.log
.DS_Store
coverage/
infra/data/
.data/
.expo/
web-build/
apps/app/dist/
infra/.env
```

### Replace `README.md` (whole file)

````markdown
# korbat

Pseudonymous social platform with a narrow public rulebook and transparent moderation. Self-hosted.

- Design spec: `docs/superpowers/specs/2026-09-03-korbat-design.md`
- Accounts and sessions (sub-project 1a): `docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md`
- Posting and feed (sub-project 2a): `docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md`
- Plans: `docs/superpowers/plans/`

## Dev quick start
```bash
pnpm install
node scripts/gen-dev-env.mjs                # creates or completes infra/.env, apps/api/.env, apps/app/.env and apps/worker/.env, and derives apps/api/.env.test; values are random and never printed
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit   # dev host ports 55432, 56379, 51025, 58025
pnpm --filter @korbat/api dev               # http://localhost:3000/api/health; reads apps/api/.env
pnpm --filter @korbat/worker dev            # the image worker; reads apps/worker/.env and works on .data/media
pnpm --filter @korbat/app web               # http://localhost:8081
```

Emails sent in development (sign-in codes, new-device alerts, lockout notices) land in Mailpit at http://localhost:58025. Locally the web app uses Cloudflare's always-pass Turnstile test key, so the human check never blocks you.

korbat once ran MinIO and never used it. Images live on two Docker volumes instead, `media-uploads` and `media-store`. If an old stack left a `korbat_miniodata` volume behind, `docker volume rm korbat_miniodata` removes it.

## Tests
```bash
pnpm test                                     # unit tests of every package
node scripts/test-db.mjs                      # creates or migrates the korbat_test database; run it again after adding a migration
pnpm --filter @korbat/api test:integration    # needs postgres, redis and mailpit up
```

Integration tests have their own database, `korbat_test`, and their own Redis database, 15. Both are named in `apps/api/.env.test`, which `node scripts/gen-dev-env.mjs` derives from `apps/api/.env`. Every run starts by emptying them, and refuses to start if a URL points anywhere else, so tests never touch development data.

## Full stack
```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --build   # http://localhost:8080
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --mailpit http://localhost:58025 --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

The smoke test signs up a throwaway account through Caddy, reads its code from Mailpit, posts and reads the post back from the public Latest timeline, grants the account a staff role with the CLI and checks that its session was revoked.

## Posting and feed
Text posts up to 1000 characters, replies, quotes, likes, reposts and bookmarks; follows, blocks and mutes; a chronological Following timeline and a public Latest timeline; threads and profile pages. The web app's home is the timeline; sign-in lives at `/signin`.

- **Reading signed out:** Latest, threads and profiles are public. Following, bookmarks, likes, follower lists and privacy settings need a session.
- **Blocks** are enforced in every query, not just the interface: neither account sees the other while signed in, follows are removed both ways, and the blocked side gets `not_found` so nothing is revealed. Posts are public, so a block does not hide them from someone who signs out; the interface says so.
- **Mutes** are one-way and silent, and hide an account from your timelines only.
- **Liker lists are never exposed.** Counts are public; likes and bookmarks are private to their owner.
- **Write limits** per account, tiered by account age: in the first 24 hours 5 posts and 20 replies an hour and no reposts or quotes for 48 hours; afterwards 30 posts and 60 replies an hour. Everyone: 100 likes an hour, 50 follows an hour and 400 a day, 30 blocks or mutes an hour. Undo actions are never limited.
- **Deleting** blanks the text in the database and leaves a tombstone only where a thread or a quote needs it. There is no editing.

## Staff roles
No API endpoint changes roles. Run this on the server:
```bash
docker compose -f infra/compose.yml run --rm api node dist/grant-role.js <email> <user|moderator|admin>
```
Every session of the account is revoked and the change is written to the audit log. Staff tools refuse moderators and admins until they turn on two-factor authentication.

## Before going public
Set these in `infra/.env`:
- `API_APP_ORIGIN` to the public origin, for example `https://korbat.example`.
- `API_TURNSTILE_SECRET_KEY` and `WEB_TURNSTILE_SITE_KEY` to the keys of one Turnstile widget.
- `API_SMTP_URL` and `API_MAIL_FROM` to the EU mail relay.

Keep `API_AUTH_HMAC_KEY`, `API_IP_HASH_KEY` and `API_TOTP_ENC_KEY` secret and backed up. Losing `API_TOTP_ENC_KEY` breaks every enrolled authenticator.
````

## Step 2: verify: compose-config

```bash
docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo 'compose file valid'; grep -ci minio infra/compose.yml infra/compose.dev.yml infra/.env.example
```

Expected output contains:

- `compose file valid`
- `infra/compose.yml:0`
- `infra/compose.dev.yml:0`
- `infra/.env.example:0`

Allowed difference: `grep -c` exits with status 1 when it counts no match, and no match is what this step wants; the exit status is not a STOP condition here.

Observed on the dry run:

```text
compose file valid
infra/compose.yml:0
infra/compose.dev.yml:0
infra/.env.example:0
```

## Step 3: verify: dev-env

```bash
node scripts/gen-dev-env.mjs
```

Expected output contains:

- `infra/.env: completed, added MEDIA_FORMATS, MEDIA_MIN_FREE_BYTES`
- `apps/api/.env: completed, added MEDIA_UPLOADS_DIR, MEDIA_STORE_DIR, MEDIA_FORMATS, MEDIA_MIN_FREE_BYTES`
- `apps/worker/.env: created with 6 keys`

Observed on the dry run:

```text
infra/.env: completed, added MEDIA_FORMATS, MEDIA_MIN_FREE_BYTES
apps/api/.env: completed, added MEDIA_UPLOADS_DIR, MEDIA_STORE_DIR, MEDIA_FORMATS, MEDIA_MIN_FREE_BYTES
apps/worker/.env: created with 6 keys
```

## Step 4: verify: stack

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --build --remove-orphans >/dev/null 2>&1; s=000; for i in $(seq 1 120); do s=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/api/health); [ "$s" = 200 ] && break; sleep 2; done; echo "health through caddy: $s"; echo "services: $(docker compose -f infra/compose.yml -f infra/compose.dev.yml ps --format '{{.Service}}' | sort | tr '\n' ' ')"
```

Expected output contains:

- `health through caddy: 200`
- `services: api caddy mailpit postgres redis worker`

Must not contain:

- `minio`

Allowed difference: Rebuilding the API, worker and web images can take more than ten minutes. The step hides the build's output. If health stays at `000` or an expected line is missing, run `docker compose -f infra/compose.yml -f infra/compose.dev.yml build` to see why; `ECONNRESET` warnings from pnpm inside the build mean Docker's network is failing, which is a STOP condition to report, not to work around.

Observed on the dry run:

```text
health through caddy: 200
services: api caddy mailpit postgres redis worker
```

## Step 5: verify: caddyfile

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T caddy sh -c 'caddy validate --config /etc/caddy/Caddyfile 2>&1' | grep -o 'Valid configuration'
```

Expected output contains:

- `Valid configuration`

Observed on the dry run:

```text
Valid configuration
```

## Step 6: verify: worker-isolation

```bash
for i in $(seq 1 40); do s=$(docker compose -f infra/compose.yml -f infra/compose.dev.yml ps worker --format '{{.Status}}'); case "$s" in *healthy*) break;; esac; sleep 2; done; echo "worker: $(echo "$s" | grep -o '(healthy)' || echo "$s")"; echo "worker interfaces: $(docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T worker sh -c 'ls /sys/class/net | tr "\n" " "')"; echo "worker writing to uploads: $(docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T worker sh -c 'touch /media/uploads/x 2>&1 | grep -o "Read-only file system" || echo WRITABLE')"; echo "api writing to the store: $(docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T api sh -c 'touch /media/store/x 2>&1 | grep -o "Read-only file system" || echo WRITABLE')"; echo "credentials in the worker's environment: $(docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T worker sh -c 'env | grep -c -E "DATABASE_URL|REDIS_URL|_KEY=|PASSWORD|SMTP" || true')"; echo "worker runs as uid $(docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T worker sh -c 'id -u') with VIPS_BLOCK_UNTRUSTED=$(docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T worker sh -c 'echo $VIPS_BLOCK_UNTRUSTED')"; docker inspect "$(docker compose -f infra/compose.yml -f infra/compose.dev.yml ps -q worker)" --format 'limits: memory={{.HostConfig.Memory}} swap={{.HostConfig.MemorySwap}} pids={{.HostConfig.PidsLimit}} network={{.HostConfig.NetworkMode}} readonly={{.HostConfig.ReadonlyRootfs}} capdrop={{.HostConfig.CapDrop}}'
```

Expected output contains:

- `worker: (healthy)`
- `worker interfaces: lo`
- `worker writing to uploads: Read-only file system`
- `api writing to the store: Read-only file system`
- `credentials in the worker's environment: 0`
- `worker runs as uid 1000 with VIPS_BLOCK_UNTRUSTED=1`
- `limits: memory=805306368 swap=805306368 pids=64 network=none readonly=true capdrop=[ALL]`

Must not contain:

- `WRITABLE`

Observed on the dry run:

```text
worker: (healthy)
worker interfaces: lo
worker writing to uploads: Read-only file system
api writing to the store: Read-only file system
credentials in the worker's environment: 0
worker runs as uid 1000 with VIPS_BLOCK_UNTRUSTED=1
limits: memory=805306368 swap=805306368 pids=64 network=none readonly=true capdrop=[ALL]
```

## Step 7: verify: through-the-worker

```bash
id=$(node -e "console.log(require('crypto').randomUUID())"); shard=$(echo $id | cut -c1-2); node -e "require('sharp')({create:{width:640,height:480,channels:3,background:'#c81e1e'}}).jpeg().withMetadata({orientation:6}).toBuffer().then((b)=>process.stdout.write(b))" | docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T api sh -c "cat > /media/uploads/tmp/$id.part && mv /media/uploads/tmp/$id.part /media/uploads/incoming/$id"; r=''; for i in $(seq 1 40); do r=$(docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T api sh -c "cat /media/store/results/$id.json 2>/dev/null"); [ -n "$r" ] && break; sleep 1; done; echo "result: $(echo "$r" | sed -E "s/$id/ID/; s/\"blurhash\":\"[^\"]*\"/\"blurhash\":\"HASH\"/")"; echo "large.webp starts with: $(docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T api sh -c "head -c 4 /media/store/files/$shard/$id/large.webp; head -c 12 /media/store/files/$shard/$id/large.webp | tail -c 4")"; docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T api sh -c "touch /media/uploads/delete/$id && rm /media/uploads/incoming/$id"; left=1; for i in $(seq 1 30); do left=$(docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T api sh -c "ls /media/store/files/$shard 2>/dev/null | grep -c $id || true"); [ "$left" = 0 ] && break; sleep 1; done; echo "image folders left after the deletion request: $left"; docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T api sh -c "rm -f /media/uploads/delete/$id"
```

Expected output contains:

- `result: {"v":1,"id":"ID","status":"ready","width":480,"height":640,"blurhash":"HASH"}`
- `large.webp starts with: RIFFWEBP`
- `image folders left after the deletion request: 0`

Observed on the dry run:

```text
result: {"v":1,"id":"ID","status":"ready","width":480,"height":640,"blurhash":"HASH"}
large.webp starts with: RIFFWEBP
image folders left after the deletion request: 0
```

## Step 8: verify: health

```bash
curl -s http://localhost:8080/api/health
```

Expected output contains:

- `"status":"ok"`
- `"image_worker":"ok"`

Observed on the dry run:

```text
{"status":"ok","version":"0.0.0","checks":{"postgres_api":"ok","postgres_auth":"ok","redis":"ok","image_worker":"ok"}}
```

## Step 9: verify: stop-app-services

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml stop caddy api worker >/dev/null 2>&1; echo 'app services stopped'
```

Expected output contains:

- `app services stopped`

Observed on the dry run:

```text
app services stopped
```

## Step 10: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `.gitignore`
- `README.md`
- `apps/api/.env.example`
- `apps/api/Dockerfile`
- `apps/api/package.json`
- `apps/worker/.env.example`
- `apps/worker/package.json`
- `infra/.env.example`
- `infra/caddy/Caddyfile`
- `infra/compose.dev.yml`
- `infra/compose.yml`
- `scripts/gen-dev-env.mjs`

## Step 11: commit

```bash
git add -A
git commit -q -m "feat(infra): MinIO leaves the stack; media-uploads and media-store volumes; the worker runs without network, capabilities or credentials under memory, CPU and process limits; Caddy caps upload bodies; dev scripts load their env files" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(infra): MinIO leaves the stack; media-uploads and media-store volumes; the worker runs without network, capabilities or credentials under memory, CPU and process limits; Caddy caps upload bodies; dev scripts load their env files`.

## Report format (mandatory)

```text
TASK 14 REPORT
Files written: <count, expected 12>
Verify "compose-config": <paste the expected lines as printed>
Verify "dev-env": <paste the expected lines as printed>
Verify "stack": <paste the expected lines as printed>
Verify "caddyfile": <paste the expected lines as printed>
Verify "worker-isolation": <paste the expected lines as printed>
Verify "through-the-worker": <paste the expected lines as printed>
Verify "health": <paste the expected lines as printed>
Verify "stop-app-services": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```

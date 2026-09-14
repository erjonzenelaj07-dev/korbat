# korbat 1a — Task 21 of 21: Turnstile site key in the web image, CI lockfile-age and web export checks, dev env for the app, README

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-14 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Final wiring: the public Turnstile site key is a required build argument of the web image, CI checks new lockfile entries against the release-age floor and exports the web app, local development gets an app `.env`, and the README documents setup, the full stack, staff roles and production settings. Semgrep must still report zero findings.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Ports 3000 and 8080 on localhost must be free. Stop any korbat API or web process started from this repository first; never stop other Node processes on the machine.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. Only the exact `pnpm add` commands printed below may change dependencies. Never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(app): web sign-up and sign-in with Turnstile, onboarding, MFA challenge, security settings, terms and 'this wasn't me'`.
3. The previous task's last API unit run ended with `Tests  88 passed | 67 skipped (155)`.

## Rules (read twice)

1. Copy every file below byte for byte. Each block is the complete file: create it, or replace the existing file entirely.
2. Run every command exactly as written, in order, from the repo root.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the files

### Create `apps/app/.env.example`

```text
# Used by `pnpm --filter @korbat/app web`. `node scripts/gen-dev-env.mjs` copies this to apps/app/.env.
# Cloudflare's always-pass Turnstile test key; the API on the host uses the matching test secret.
EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
# The dev web server (8081) calls the API on the host directly. The Docker web image leaves this unset
# and calls the API on its own origin through Caddy.
EXPO_PUBLIC_API_URL=http://localhost:3000
```

### Replace `.github/workflows/ci.yml` (whole file)

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
        with: { version: 10.30.0 }
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: new lockfile entries are at least 7 days old
        env:
          BASE: ${{ github.event.pull_request.base.sha || github.event.before }}
        run: |
          if [ -z "$BASE" ] || [ "$BASE" = "0000000000000000000000000000000000000000" ]; then
            echo "no base commit to compare with"
          else
            node scripts/check-lockfile-age.mjs --base "$BASE"
          fi
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm audit --audit-level high
      - run: pnpm --filter @korbat/api build && pnpm --filter @korbat/worker build
      - run: pnpm --filter @korbat/app exec expo export --platform web
        env:
          EXPO_PUBLIC_TURNSTILE_SITE_KEY: 1x00000000000000000000AA
      - run: docker compose --env-file infra/.env.example -f infra/compose.yml config -q

  semgrep:
    runs-on: ubuntu-latest
    container: semgrep/semgrep
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - run: semgrep scan --config p/owasp-top-ten --config p/typescript --config p/secrets --error --exclude apps/app/dist --exclude node_modules
```

### Replace `infra/caddy/Dockerfile` (whole file)

```dockerfile
FROM node:24-alpine AS web
RUN npm install -g pnpm@10.30.0
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps/app ./apps/app
RUN pnpm install --frozen-lockfile --filter @korbat/app...
# The public Turnstile site key is inlined into the web bundle at export time. It is not a secret.
ARG EXPO_PUBLIC_TURNSTILE_SITE_KEY
RUN test -n "$EXPO_PUBLIC_TURNSTILE_SITE_KEY" || { echo "the EXPO_PUBLIC_TURNSTILE_SITE_KEY build argument is required" >&2; exit 1; }
RUN cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY="$EXPO_PUBLIC_TURNSTILE_SITE_KEY" npx expo export --platform web

FROM caddy:2-alpine
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web /repo/apps/app/dist /srv
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
      # Auth settings. The stack refuses to start while any of these is missing from infra/.env.
      APP_ORIGIN: ${API_APP_ORIGIN:?set API_APP_ORIGIN in infra/.env}
      AUTH_HMAC_KEY: ${API_AUTH_HMAC_KEY:?set API_AUTH_HMAC_KEY in infra/.env}
      IP_HASH_KEY: ${API_IP_HASH_KEY:?set API_IP_HASH_KEY in infra/.env}
      TOTP_ENC_KEY: ${API_TOTP_ENC_KEY:?set API_TOTP_ENC_KEY in infra/.env}
      TURNSTILE_SECRET_KEY: ${API_TURNSTILE_SECRET_KEY:?set API_TURNSTILE_SECRET_KEY in infra/.env}
      SMTP_URL: ${API_SMTP_URL:?set API_SMTP_URL in infra/.env}
      MAIL_FROM: ${API_MAIL_FROM:?set API_MAIL_FROM in infra/.env}
      TERMS_VERSION: ${API_TERMS_VERSION:?set API_TERMS_VERSION in infra/.env}
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
  miniodata:
  caddydata:
  caddyconfig:
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

MINIO_ROOT_USER=korbat
MINIO_ROOT_PASSWORD=change-me-minio
MINIO_BUCKET=korbat-media

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

### Replace `scripts/gen-dev-env.mjs` (whole file)

```js
#!/usr/bin/env node
/**
 * Creates or completes the local .env files from their committed examples: infra/.env,
 * apps/api/.env and apps/app/.env.
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
```

### Replace `README.md` (whole file)

````markdown
# korbat

Pseudonymous social platform with a narrow public rulebook and transparent moderation. Self-hosted.

- Design spec: `docs/superpowers/specs/2026-09-03-korbat-design.md`
- Accounts and sessions (sub-project 1a): `docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md`
- Plans: `docs/superpowers/plans/`

## Dev quick start
```bash
pnpm install
node scripts/gen-dev-env.mjs                # creates or completes infra/.env, apps/api/.env and apps/app/.env; values are random and never printed
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis minio minio-init mailpit   # dev host ports 55432, 56379, 59000, 59001, 51025, 58025
pnpm --filter @korbat/api dev               # http://localhost:3000/api/health
pnpm --filter @korbat/app web               # http://localhost:8081
```

Emails sent in development (sign-in codes, new-device alerts, lockout notices) land in Mailpit at http://localhost:58025. Locally the web app uses Cloudflare's always-pass Turnstile test key, so the human check never blocks you.

## Full stack
```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --build   # http://localhost:8080
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --mailpit http://localhost:58025 --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

The smoke test signs up a throwaway account through Caddy, reads its code from Mailpit, grants it a staff role with the CLI and checks that its session was revoked.

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

## Step 2: verify: env

```bash
node scripts/gen-dev-env.mjs
```

Expected output contains:

- `infra/.env: completed, added WEB_TURNSTILE_SITE_KEY`
- `apps/app/.env: created with 2 keys`

Observed on the dry run:

```text
infra/.env: completed, added WEB_TURNSTILE_SITE_KEY
apps/app/.env: created with 2 keys
```

## Step 3: verify: lockfile-age

```bash
node scripts/check-lockfile-age.mjs --base HEAD~1
```

Expected output contains:

- `all at least 7 days old`

Observed on the dry run:

```text
1 new package versions since HEAD~1; all at least 7 days old
```

## Step 4: verify: ci-shell-safety

```bash
echo "github expressions inside run blocks: $(awk '/^ *run: *\|/{inrun=1; next} /^ *- /{inrun=0} inrun && /\$\{\{/' .github/workflows/ci.yml | wc -l)"; grep -c 'check-lockfile-age.mjs --base "\$BASE"' .github/workflows/ci.yml
```

Expected output contains:

- `github expressions inside run blocks: 0`
- `1`

Observed on the dry run:

```text
github expressions inside run blocks: 0
1
```

## Step 5: verify: compose-config-example

```bash
docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo compose ok
```

Expected output contains:

- `compose ok`

Observed on the dry run:

```text
compose ok
```

## Step 6: verify: compose-requires-site-key

```bash
f=$(mktemp); grep -v '^WEB_TURNSTILE_SITE_KEY=' infra/.env.example > "$f"; docker compose --env-file "$f" -f infra/compose.yml config -q 2>&1 | tail -1; rm -f "$f"
```

Expected output contains:

- `set WEB_TURNSTILE_SITE_KEY in infra/.env`

Observed on the dry run:

```text
error while interpolating services.caddy.build.args.EXPO_PUBLIC_TURNSTILE_SITE_KEY: required variable WEB_TURNSTILE_SITE_KEY is missing a value: set WEB_TURNSTILE_SITE_KEY in infra/.env
```

## Step 7: verify: web-image

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --build caddy >/dev/null 2>&1; s=000; for i in $(seq 1 90); do s=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/api/health); [ "$s" = 200 ] && break; sleep 2; done; echo "health through caddy: $s"; js=$(curl -s http://localhost:8080/ | grep -o '/_expo/static/js/web/[^"]*\.js' | head -1); n=$(curl -s http://localhost:8080$js | grep -o 1x00000000000000000000AA | wc -l); echo "site key in web bundle: $([ "$n" -gt 0 ] && echo yes || echo no)"
```

Expected output contains:

- `health through caddy: 200`
- `site key in web bundle: yes`

Allowed difference: Rebuilding the web image runs a full Expo export and can take several minutes.

Observed on the dry run:

```text
health through caddy: 200
site key in web bundle: yes
```

## Step 8: verify: semgrep

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/src" semgrep/semgrep semgrep scan --config p/owasp-top-ten --config p/typescript --config p/secrets --error --exclude apps/app/dist --exclude node_modules 2>&1 | grep -E 'Findings:|Ran [0-9]+ rules'
```

Expected output contains:

- `Findings: 0 (0 blocking)`

Observed on the dry run:

```text
• Findings: 0 (0 blocking)
```

## Step 9: verify: api-unchanged

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  88 passed | 67 skipped (155)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  88 passed | 67 skipped (155)
```

## Step 10: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `.github/workflows/ci.yml`
- `README.md`
- `apps/app/.env.example`
- `infra/.env.example`
- `infra/caddy/Dockerfile`
- `infra/compose.yml`
- `scripts/gen-dev-env.mjs`

## Step 11: commit

```bash
git add -A
git commit -q -m "ci: lockfile age and web export checks; Turnstile site key in the web image; app dev env; README for auth" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `ci: lockfile age and web export checks; Turnstile site key in the web image; app dev env; README for auth`.

## Report format (mandatory)

```text
TASK 21 REPORT
Files written: <count, expected 7>
Verify "env": <paste the expected lines as printed>
Verify "lockfile-age": <paste the expected lines as printed>
Verify "ci-shell-safety": <paste the expected lines as printed>
Verify "compose-config-example": <paste the expected lines as printed>
Verify "compose-requires-site-key": <paste the expected lines as printed>
Verify "web-image": <paste the expected lines as printed>
Verify "semgrep": <paste the expected lines as printed>
Verify "api-unchanged": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```

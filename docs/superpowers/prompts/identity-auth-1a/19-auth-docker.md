# korbat 1a — Task 19 of 21: Auth in the Docker stack: argon2 beside the bundle, grant-role bundle, compose variables, Turnstile CSP, smoke test

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-14 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

The Docker stack now runs the auth module. argon2 is a native module, so it stays outside the bundle and the image ships the Alpine binary built for its own architecture. Compose passes every auth setting and refuses to start while one is missing. The web CSP allows the Turnstile widget. A smoke test signs up through Caddy, grants a role with the CLI and checks the session was revoked.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Ports 3000 and 8080 on localhost must be free. Stop any korbat API or web process started from this repository first; never stop other Node processes on the machine.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. Only the exact `pnpm add` commands printed below may change dependencies. Never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `test(auth): end-to-end HTTP tests with Redis and Mailpit (lockout, MFA, not-me, sessions, age gate) and response-timing checks`.
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

### Create `scripts/smoke-auth-stack.mjs`

```js
#!/usr/bin/env node
/**
 * Smoke test of the auth module in a running Compose stack, through Caddy.
 *
 * 1. The web page's CSP allows the Turnstile widget.
 * 2. Password sign-in for an unknown email returns invalid_credentials (argon2 runs inside the image).
 * 3. A throwaway native-app account signs up with an emailed code read from Mailpit and onboards.
 * 4. /api/me answers for it.
 * 5. The grant-role CLI makes it a moderator, and its session stops working.
 *
 * Needs API_TURNSTILE_SECRET_KEY set to Cloudflare's always-pass test secret and API_SMTP_URL pointing
 * at Mailpit. Prints no codes or tokens.
 *
 * Usage, from the repo root:
 *   node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --mailpit http://localhost:58025 \
 *     --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
 */
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const options = separator === -1 ? argv : argv.slice(0, separator);
const compose = separator === -1 ? [] : argv.slice(separator + 1);
const option = (name) => {
  const index = options.indexOf(`--${name}`);
  return index === -1 ? undefined : options[index + 1];
};
const base = option("base");
const mailpit = option("mailpit");
const terms = option("terms");
if (!base || !mailpit || !terms || compose.length === 0) {
  console.error("usage: node scripts/smoke-auth-stack.mjs --base <url> --mailpit <url> --terms <version> -- <docker compose command>");
  process.exit(2);
}

/** Cloudflare's test secret accepts any token. */
const TURNSTILE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const deviceId = randomBytes(32).toString("base64url");
const email = `smoke-${randomUUID()}@korbat.local`;
let failures = 0;

function check(label, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
  return ok;
}

async function api(path, { json, token } = {}) {
  const headers = {};
  if (json !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method: json === undefined ? "GET" : "POST", headers, body: json === undefined ? undefined : JSON.stringify(json) });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, summary: `HTTP ${res.status}${body?.error?.code ? ` ${body.error.code}` : ""}` };
}

async function signUpCode(to) {
  const query = encodeURIComponent(`to:"${to}"`);
  for (let attempt = 0; attempt < 40; attempt++) {
    const list = await (await fetch(`${mailpit}/api/v1/search?query=${query}`)).json();
    const newest = list.messages?.[0];
    if (newest) {
      const message = await (await fetch(`${mailpit}/api/v1/message/${newest.ID}`)).json();
      const code = /\b(\d{6})\b/.exec(message.Text)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no code email to ${to} arrived in Mailpit`);
}

async function main() {
  const page = await fetch(`${base}/`);
  const csp = page.headers.get("content-security-policy") ?? "";
  check("web CSP allows the Turnstile widget", csp.includes("script-src 'self' https://challenges.cloudflare.com") && csp.includes("frame-src https://challenges.cloudflare.com"));

  const unknown = await api("/api/auth/password/signin", {
    json: { email: `nobody-${randomUUID()}@korbat.local`, password: "not a real password", turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" },
  });
  check("password sign-in for an unknown email", unknown.body?.error?.code === "invalid_credentials", unknown.summary);

  const start = await api("/api/auth/email/start", { json: { email, turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" } });
  if (!check("email/start", start.status === 200, start.summary)) return;
  const { flowId } = start.body;
  const verify = await api("/api/auth/email/verify", { json: { flowId, code: await signUpCode(email) } });
  if (!check("sign-up code read from Mailpit", verify.body?.result === "signup_required", verify.summary)) return;
  const complete = await api("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-01-01", termsVersion: terms } });
  if (!check("sign-up returns a bearer token", typeof complete.body?.token === "string", complete.summary)) return;

  const onboarding = await api("/api/auth/onboarding/handle", {
    json: { handle: `smoke_${randomBytes(4).toString("hex")}`, displayName: "Smoke Test" },
    token: complete.body.token,
  });
  if (!check("onboarding rotates the token", typeof onboarding.body?.token === "string", onboarding.summary)) return;
  const token = onboarding.body.token;
  const me = await api("/api/me", { token });
  check("/api/me for the new account", me.status === 200 && me.body?.user?.email === email && me.body?.user?.role === "user", me.summary);

  const output = execFileSync(compose[0], [...compose.slice(1), "run", "--rm", "--no-deps", "-T", "api", "node", "dist/grant-role.js", email, "moderator"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  check("grant-role CLI", output.includes("role user -> moderator; every session revoked"), output.trim());
  const after = await api("/api/me", { token });
  check("the session stops working after the role change", after.status === 401, after.summary);
}

try {
  await main();
} catch (err) {
  check("smoke test ran to the end", false, err instanceof Error ? err.message : String(err));
}
console.log(failures === 0 ? "smoke test passed" : `smoke test FAILED: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
```

### Replace `apps/api/tsup.config.ts` (whole file)

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", migrate: "src/migrate.ts", "grant-role": "src/cli/grant-role.ts" },
  format: ["esm"],
  platform: "node",
  target: "node24",
  bundle: true,
  // Everything is bundled except @node-rs/argon2: it loads a platform-specific native binary at
  // runtime, so the Docker image ships it in node_modules next to the bundle.
  noExternal: [/^(?!@node-rs\/argon2(?:\/|$))/],
  external: ["@node-rs/argon2"],
  sourcemap: true,
  clean: true,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
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
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
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
    reverse_proxy api:3000
  }

  handle {
    root * /srv
    try_files {path} /index.html
    file_server
  }
}
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

# Cloudflare Tunnel token (Zero Trust > Networks > Tunnels). Only needed with --profile tunnel.
TUNNEL_TOKEN=
```

### Replace `scripts/gen-dev-env.mjs` (whole file)

```js
#!/usr/bin/env node
/**
 * Creates or completes the local .env files from their committed examples.
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
```

## Step 2: verify: build

```bash
pnpm --filter @korbat/api build 2>&1 | grep -E 'Build success|error' ; ls apps/api/dist | grep -E '^(index|migrate|grant-role)\.js$' ; echo "argon2 imports left external: $(cat apps/api/dist/*.js | grep -c 'from "@node-rs/argon2"')" ; echo "argon2 native loader bundled: $(cat apps/api/dist/*.js | grep -c nativeBinding)"
```

Expected output contains:

- `Build success`
- `grant-role.js`
- `index.js`
- `migrate.js`
- `argon2 imports left external: 1`
- `argon2 native loader bundled: 0`

Must not contain:

- `error`

Observed on the dry run:

```text
ESM ⚡️ Build success in 408ms
grant-role.js
index.js
migrate.js
argon2 imports left external: 1
argon2 native loader bundled: 0
```

## Step 3: verify: test

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

## Step 4: verify: env

```bash
node scripts/gen-dev-env.mjs && node -e "const fs=require('fs');const p=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split(/\r?\n/).map(l=>/^([A-Z0-9_]+)=(.*)$/.exec(l)).filter(Boolean).map(m=>[m[1],m[2]]));const i=p('infra/.env'),a=p('apps/api/.env');console.log('auth keys shared: '+['AUTH_HMAC_KEY','IP_HASH_KEY','TOTP_ENC_KEY'].filter(k=>a[k]&&i['API_'+k]===a[k]).length)"
```

Expected output contains:

- `auth keys shared: 3`

Observed on the dry run:

```text
auth keys shared: 3
```

## Step 5: verify: compose-config

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml config -q && echo compose ok
```

Expected output contains:

- `compose ok`

Observed on the dry run:

```text
compose ok
```

## Step 6: verify: stack

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --build >/dev/null 2>&1; s=000; for i in $(seq 1 90); do s=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/api/health); [ "$s" = 200 ] && break; sleep 2; done; echo "health through caddy: $s"; docker compose -f infra/compose.yml -f infra/compose.dev.yml ps -a --format '{{.Service}} {{.State}}' | sort
```

Expected output contains:

- `health through caddy: 200`
- `api running`
- `caddy running`
- `migrate exited`

Allowed difference: The first image build can take more than ten minutes.

Observed on the dry run:

```text
health through caddy: 200
api running
caddy running
migrate exited
```

## Step 7: verify: argon2-in-image

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml run --rm --no-deps -T --entrypoint node api -e "import('@node-rs/argon2').then(async (m) => console.log('image argon2: ' + (await m.hash('smoke')).slice(0, 10)))"
```

Expected output contains:

- `image argon2: $argon2id$`

Observed on the dry run:

```text
image argon2: $argon2id$
```

## Step 8: verify: smoke

```bash
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --mailpit http://localhost:58025 --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `smoke test passed`

Must not contain:

- `FAIL`

Observed on the dry run:

```text
smoke test passed
```

## Step 9: verify: stop-app-services

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml stop caddy api worker minio >/dev/null 2>&1; echo app services stopped
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

- `apps/api/Dockerfile`
- `apps/api/tsup.config.ts`
- `infra/.env.example`
- `infra/caddy/Caddyfile`
- `infra/compose.yml`
- `scripts/gen-dev-env.mjs`
- `scripts/smoke-auth-stack.mjs`

## Step 11: commit

```bash
git add -A
git commit -q -m "feat(infra): ship argon2 and the grant-role CLI in the API image; auth settings in compose; Turnstile in the CSP; auth smoke test" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(infra): ship argon2 and the grant-role CLI in the API image; auth settings in compose; Turnstile in the CSP; auth smoke test`.

## Report format (mandatory)

```text
TASK 19 REPORT
Files written: <count, expected 7>
Verify "build": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "env": <paste the expected lines as printed>
Verify "compose-config": <paste the expected lines as printed>
Verify "stack": <paste the expected lines as printed>
Verify "argon2-in-image": <paste the expected lines as printed>
Verify "smoke": <paste the expected lines as printed>
Verify "stop-app-services": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```

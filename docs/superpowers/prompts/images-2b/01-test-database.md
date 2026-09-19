# korbat 2b — Task 1 of 17: A separate database and Redis database for integration tests, loaded without sourcing a file

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-18 and 2026-09-19 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend. Sub-project 2b adds images to posts: up to four per post, each with a required description, processed by a worker container that has no network and no credentials, and served by the API after the same visibility check as the post. Before any of that, this task gives the integration tests a database of their own. `korbat_test` and Redis database 15 are named in `apps/api/.env.test`, which `gen-dev-env.mjs` derives from `apps/api/.env`; the integration config loads that file itself, a global setup refuses any other target and empties both, and `scripts/test-db.mjs` creates and migrates the database. Tests stop leaving fixtures in development data.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `docs: 2b implementation plan and verified execution prompts; spec amendments from the dry run`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/01-test-database.md 1
```

Expected: 1 line starting with `wrote`, one for each file below.

### Create `apps/api/test/test-env.test.ts`

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { TEST_REDIS_DATABASE, assertTestTargets, loadTestEnv } from "./integration/test-env";

const good = {
  DATABASE_URL_API: "postgres://korbat_api:s3cret-api@localhost:55432/korbat_test",
  DATABASE_URL_AUTH: "postgres://korbat_auth:s3cret-auth@localhost:55432/korbat_test",
  DATABASE_URL_MIGRATE: "postgres://korbat_migrate:s3cret-migrate@localhost:55432/korbat_test",
  REDIS_URL: "redis://localhost:56379/15",
};

describe("integration test targets", () => {
  test("a test database for every role and Redis database 15 are accepted", () => {
    expect(TEST_REDIS_DATABASE).toBe(15);
    expect(() => assertTestTargets(good)).not.toThrow();
  });

  test.each(["DATABASE_URL_API", "DATABASE_URL_AUTH", "DATABASE_URL_MIGRATE"] as const)("%s pointing at the development database is refused without leaking the password", (key) => {
    const env = { ...good, [key]: good[key].replace("/korbat_test", "/korbat") };
    let message = "";
    try {
      assertTestTargets(env);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain(key);
    expect(message).toContain('"korbat"');
    expect(message).toContain("_test");
    expect(message).not.toContain("s3cret");
  });

  test("a missing URL is refused", () => {
    const { DATABASE_URL_AUTH: _omitted, ...rest } = good;
    expect(() => assertTestTargets(rest)).toThrow(/DATABASE_URL_AUTH is not set/);
    const { REDIS_URL: _redis, ...noRedis } = good;
    expect(() => assertTestTargets(noRedis)).toThrow(/REDIS_URL is not set/);
  });

  test("Redis database 0, the development one, is refused", () => {
    expect(() => assertTestTargets({ ...good, REDIS_URL: "redis://localhost:56379" })).toThrow(/selects database "0", not 15/);
    expect(() => assertTestTargets({ ...good, REDIS_URL: "redis://localhost:56379/3" })).toThrow(/selects database "3", not 15/);
  });
});

describe("loading apps/api/.env.test", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "korbat-test-env-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("a missing file says how to create it", () => {
    expect(() => loadTestEnv(path.join(dir, "absent.env"))).toThrow(/gen-dev-env\.mjs.*test-db\.mjs/s);
  });

  test("values are parsed like a dotenv file: comments skipped, quotes removed", () => {
    const file = path.join(dir, ".env.test");
    writeFileSync(file, ['# a comment', 'MAIL_FROM="korbat <no-reply@korbat.local>"', "REDIS_URL=redis://localhost:56379/15", ""].join("\n"));
    expect(loadTestEnv(file)).toEqual({ MAIL_FROM: "korbat <no-reply@korbat.local>", REDIS_URL: "redis://localhost:56379/15" });
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Cannot find module './integration/test-env'`

Observed on the dry run:

```text
Error: Cannot find module './integration/test-env' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/test-env.test.ts
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/01-test-database.md 3
```

Expected: 7 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/integration/test-env.ts`

```ts
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const ENV_FILE = fileURLToPath(new URL("../../.env.test", import.meta.url));
const DATABASE_KEYS = ["DATABASE_URL_API", "DATABASE_URL_AUTH", "DATABASE_URL_MIGRATE"] as const;

/** The Redis database the integration tests own. Development uses database 0. */
export const TEST_REDIS_DATABASE = 15;

/** The integration test environment: apps/api/.env.test, which scripts/gen-dev-env.mjs derives from apps/api/.env. */
export function loadTestEnv(file: string = ENV_FILE): Record<string, string> {
  if (!existsSync(file)) {
    throw new Error("apps/api/.env.test is missing. Run `node scripts/gen-dev-env.mjs`, then `node scripts/test-db.mjs`.");
  }
  const parsed = parseEnv(readFileSync(file, "utf8"));
  return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

/**
 * The integration run truncates every table and flushes its Redis database, so it must never point
 * at development data. Messages name the key and the database, never the URL, which holds a password.
 */
export function assertTestTargets(env: Record<string, string | undefined>): void {
  for (const key of DATABASE_KEYS) {
    const value = env[key];
    if (!value) throw new Error(`Refusing to run integration tests: ${key} is not set.`);
    const database = decodeURIComponent(new URL(value).pathname.replace(/^\//, ""));
    if (!database.endsWith("_test")) {
      throw new Error(`Refusing to run integration tests: ${key} points at database "${database}", not at a database whose name ends in _test. Run \`node scripts/gen-dev-env.mjs\`.`);
    }
  }
  const redis = env.REDIS_URL;
  if (!redis) throw new Error("Refusing to run integration tests: REDIS_URL is not set.");
  const index = new URL(redis).pathname.replace(/^\//, "") || "0";
  if (index !== String(TEST_REDIS_DATABASE)) {
    throw new Error(`Refusing to run integration tests: REDIS_URL selects database "${index}", not ${TEST_REDIS_DATABASE}. Run \`node scripts/gen-dev-env.mjs\`.`);
  }
}
```

### Create `apps/api/test/integration/global-setup.ts`

```ts
import { sql } from "drizzle-orm";
import Redis from "ioredis";
import { closeDb, createDb } from "@korbat/db";
import { assertTestTargets, loadTestEnv } from "./test-env";

/**
 * Runs once before the integration suites. Every run starts from an empty test database and an
 * empty Redis database, so suites never depend on what an earlier run left behind.
 */
export default async function setup(): Promise<void> {
  const env = loadTestEnv();
  assertTestTargets(env);

  const redis = new Redis(env.REDIS_URL!, { maxRetriesPerRequest: 2 });
  try {
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }

  // The migrate role owns every table, so it may truncate them. Names come from the catalog, quoted.
  const db = createDb(env.DATABASE_URL_MIGRATE!, { max: 1 });
  try {
    const tables = await db.execute<{ name: string }>(
      sql`select quote_ident(schemaname) || '.' || quote_ident(tablename) as name from pg_tables where schemaname in ('public', 'auth') order by 1`,
    );
    if (tables.length === 0) throw new Error("The test database has no tables. Run `node scripts/test-db.mjs`.");
    await db.execute(sql.raw(`truncate table ${tables.map((table) => table.name).join(", ")} restart identity cascade`));
  } finally {
    await closeDb(db);
  }
}
```

### Create `apps/api/test/integration/setup.ts`

```ts
import { assertTestTargets } from "./test-env";

// Runs in every test worker before its suites. The environment a suite really sees is checked here,
// whatever the shell exported, so no suite can reach development data.
assertTestTargets(process.env);
```

### Create `scripts/test-db.mjs`

```js
#!/usr/bin/env node
/**
 * Creates and migrates the database the integration tests use. Safe to run again at any time, and
 * needed again after every new migration.
 *
 * 1. Reads the test database's name from DATABASE_URL_MIGRATE in apps/api/.env.test, which
 *    `node scripts/gen-dev-env.mjs` derives from apps/api/.env.
 * 2. Creates the database in the Compose Postgres if it is missing, and applies the per-database
 *    grants of infra/postgres/init/01-roles.sh. The roles themselves exist once per server.
 * 3. Runs the migrations with the migrate role.
 *
 * Passwords stay inside the processes that need them and are never printed.
 *
 * Usage, from the repo root:
 *   node scripts/test-db.mjs [-- <docker compose command>]
 * Without a command it uses `docker compose -f infra/compose.yml -f infra/compose.dev.yml`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const compose = separator === -1 ? ["docker", "compose", "-f", "infra/compose.yml", "-f", "infra/compose.dev.yml"] : argv.slice(separator + 1);
if (compose.length === 0) {
  console.error("usage: node scripts/test-db.mjs [-- <docker compose command>]");
  process.exit(2);
}

function stop(message) {
  console.error(message);
  process.exit(1);
}

/** Connection URLs hold passwords, so they never reach the terminal. */
const scrub = (text) => text.replace(/postgres(ql)?:\/\/\S+/g, "<database url>");

const envFile = resolve(root, "apps/api/.env.test");
if (!existsSync(envFile)) stop("apps/api/.env.test is missing. Run `node scripts/gen-dev-env.mjs` first.");
const migrateUrl = parseEnv(readFileSync(envFile, "utf8")).DATABASE_URL_MIGRATE;
if (!migrateUrl) stop("apps/api/.env.test has no DATABASE_URL_MIGRATE. Run `node scripts/gen-dev-env.mjs` again.");
const database = decodeURIComponent(new URL(migrateUrl).pathname.replace(/^\//, ""));
if (!/^[a-z][a-z0-9_]*_test$/.test(database)) stop(`The test database must have a plain name ending in _test, not "${database}".`);

// Runs inside the postgres container, where POSTGRES_USER and POSTGRES_DB are set. psql fills in
// :'db' and :"db" itself, so the name is never pasted into SQL by hand.
const script = `set -eu
run() { psql -v ON_ERROR_STOP=1 -q --username "$POSTGRES_USER" --dbname "$1" -v db="$TEST_DB" -tA; }
found=$(printf '%s\\n' "select 1 from pg_database where datname = :'db';" | run "$POSTGRES_DB")
if [ "$found" = "1" ]; then
  echo "database $TEST_DB: exists"
else
  printf '%s\\n' 'create database :"db";' | run "$POSTGRES_DB"
  echo "database $TEST_DB: created"
fi
run "$TEST_DB" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE USAGE  ON SCHEMA public FROM PUBLIC;
GRANT CREATE ON DATABASE :"db" TO korbat_migrate;
GRANT ALL ON SCHEMA public TO korbat_migrate;
GRANT USAGE ON SCHEMA public TO korbat_api;
SQL
echo "grants applied"
`;

const created = spawnSync(compose[0], [...compose.slice(1), "exec", "-T", "-e", `TEST_DB=${database}`, "postgres", "sh", "-s"], {
  cwd: root,
  input: script,
  encoding: "utf8",
});
if (created.error) stop(`Could not run ${compose[0]}: ${created.error.message}`);
process.stdout.write(scrub(created.stdout));
if (created.status !== 0) stop(`Creating ${database} failed. Is the postgres service up?\n${scrub(created.stderr)}`);

const migrated = spawnSync(process.execPath, ["--import", "tsx", "src/migrate.ts"], {
  cwd: resolve(root, "apps/api"),
  env: { ...process.env, DATABASE_URL_MIGRATE: migrateUrl, MIGRATIONS_DIR: resolve(root, "packages/db/migrations") },
  encoding: "utf8",
});
if (migrated.error) stop(`Could not run the migrations: ${migrated.error.message}`);
if (migrated.status !== 0) stop(`Migrating ${database} failed.\n${scrub(migrated.stderr)}`);
console.log("migrations applied");
console.log(`test database ready: ${database}`);
```

### Replace `apps/api/vitest.integration.config.ts` (whole file)

```ts
import { defineConfig } from "vitest/config";
import { loadTestEnv } from "./test/integration/test-env";

/**
 * Integration tests run against the Compose data services, in their own database (`korbat_test`)
 * and their own Redis database. The environment comes from apps/api/.env.test, which
 * `node scripts/gen-dev-env.mjs` derives from apps/api/.env, so nothing has to be sourced into the
 * shell first. The INTEGRATION flag is set here rather than in the npm script, because `VAR=1 cmd`
 * does not work in cmd.exe, which pnpm uses to run scripts on Windows.
 */
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    env: { ...loadTestEnv(), INTEGRATION: "1" },
    globalSetup: ["test/integration/global-setup.ts"],
    setupFiles: ["test/integration/setup.ts"],
  },
});
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
node scripts/gen-dev-env.mjs                # creates or completes infra/.env, apps/api/.env and apps/app/.env, and derives apps/api/.env.test; values are random and never printed
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis minio minio-init mailpit   # dev host ports 55432, 56379, 59000, 59001, 51025, 58025
pnpm --filter @korbat/api dev               # http://localhost:3000/api/health
pnpm --filter @korbat/app web               # http://localhost:8081
```

Emails sent in development (sign-in codes, new-device alerts, lockout notices) land in Mailpit at http://localhost:58025. Locally the web app uses Cloudflare's always-pass Turnstile test key, so the human check never blocks you.

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

## Step 4: verify: derive-test-env

```bash
node scripts/gen-dev-env.mjs
```

Expected output contains:

- `apps/api/.env.test: derived from apps/api/.env (test database, Redis database 15)`

Must not contain:

- `Error`

Observed on the dry run:

```text
apps/api/.env.test: derived from apps/api/.env (test database, Redis database 15)
```

## Step 5: verify: test-database

```bash
node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `grants applied`
- `migrations applied`
- `test database ready: korbat_test`

Must not contain:

- `failed`
- `postgres://`

Observed on the dry run:

```text
grants applied
migrations applied
test database ready: korbat_test
```

## Step 6: verify: test-database-again

```bash
node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `database korbat_test: exists`
- `test database ready: korbat_test`

Must not contain:

- `failed`
- `postgres://`

Observed on the dry run:

```text
database korbat_test: exists
test database ready: korbat_test
```

## Step 7: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  114 passed | 96 skipped (210)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  114 passed | 96 skipped (210)
```

## Step 8: verify: typecheck

```bash
pnpm --filter @korbat/api typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`

Observed on the dry run:

```text
(no output)
```

## Step 9: verify: integration

```bash
count() { docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U postgres -d korbat -tAc 'select (select count(*) from profiles) + (select count(*) from posts)'; }; before=$(count); pnpm --filter @korbat/api test:integration; after=$(count); echo "development rows before and after: $before $after"; [ -n "$before" ] && [ "$before" = "$after" ] && echo 'development database untouched'
```

Expected output contains:

- `Tests  96 passed (96)`
- `development database untouched`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  96 passed (96)
development database untouched
```

## Step 10: verify: env-test-ignored

```bash
git check-ignore -q apps/api/.env.test && echo 'apps/api/.env.test is ignored by git'
```

Expected output contains:

- `apps/api/.env.test is ignored by git`

Observed on the dry run:

```text
apps/api/.env.test is ignored by git
```

## Step 11: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `README.md`
- `apps/api/test/integration/global-setup.ts`
- `apps/api/test/integration/setup.ts`
- `apps/api/test/integration/test-env.ts`
- `apps/api/test/test-env.test.ts`
- `apps/api/vitest.integration.config.ts`
- `scripts/gen-dev-env.mjs`
- `scripts/test-db.mjs`

## Step 12: commit

```bash
git add -A
git commit -q -m "test(api): integration tests run in korbat_test and Redis database 15, load their own environment and refuse any other target" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `test(api): integration tests run in korbat_test and Redis database 15, load their own environment and refuse any other target`.

## Report format (mandatory)

```text
TASK 1 REPORT
Files written: <count, expected 8>
Failing-test step (the error line): <paste>
Verify "derive-test-env": <paste the expected lines as printed>
Verify "test-database": <paste the expected lines as printed>
Verify "test-database-again": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "env-test-ignored": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```

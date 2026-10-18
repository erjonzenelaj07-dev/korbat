#!/usr/bin/env node
/**
 * Creates and migrates the database the integration tests use. Safe to run again at any time, and
 * needed again after every new migration.
 *
 * 1. Reads the test database's name from DATABASE_URL_MIGRATE in apps/api/.env.test, which
 *    `node scripts/gen-dev-env.mjs` derives from apps/api/.env.
 * 2. Creates the database in the Compose Postgres if it is missing, and applies the per-database
 *    grants of infra/postgres/init/01-roles.sh. The roles themselves exist once per server, but for
 *    the contact point's watcher (3f): korbat_notify is created here when it is missing, with
 *    KORBAT_NOTIFY_DB_PASSWORD from infra/.env, since a data directory made before 3f has no such
 *    role and 01-roles.sh runs only on a new one. Its USAGE on the schema public is the superuser's to
 *    give, and the first migration of 3f stops without it.
 * 3. Runs the migrations with the migrate role.
 *
 * Two options rebuild the database from nothing, each the way a real database meets the migrations:
 *
 * --fresh drops the test database, creates it again with its grants and runs every migration in one
 *   batch, as a new installation does.
 * --upgrade-from <n> does the same drop and create, then migrates in two steps: first the migrations
 *   up to number <n> (0013 for `--upgrade-from 13`), which commits them, then every later one as one
 *   batch over the committed database, as an upgrade of production does. drizzle's migrator runs all
 *   pending migrations in one transaction, so a migration can behave differently over a committed
 *   database than on a fresh one (a value added to an existing enum cannot be used before the
 *   transaction that added it commits).
 *
 * Passwords stay inside the processes that need them and are never printed.
 *
 * Usage: node scripts/test-db.mjs [--fresh | --upgrade-from <n>] [-- <docker compose command>]
 * Run it from the repo root. Without a command it uses
 * `docker compose -f infra/compose.yml -f infra/compose.dev.yml`.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const USAGE = "Usage: node scripts/test-db.mjs [--fresh | --upgrade-from <n>] [-- <docker compose command>]";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = resolve(root, "packages/db/migrations");
const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
// Everything before the separator is an option of this script; everything after it is the compose command.
const options = separator === -1 ? argv : argv.slice(0, separator);
const compose = separator === -1 ? ["docker", "compose", "-f", "infra/compose.yml", "-f", "infra/compose.dev.yml"] : argv.slice(separator + 1);

function usage() {
  console.error(USAGE);
  process.exit(2);
}

function stop(message) {
  console.error(message);
  process.exit(1);
}

/** Connection URLs hold passwords, so they never reach the terminal. */
const scrub = (text) => text.replace(/postgres(ql)?:\/\/\S+/g, "<database url>");

let fresh = false;
/** The number of the last migration the first step applies, or null without --upgrade-from. */
let upgradeFrom = null;
for (let i = 0; i < options.length; i++) {
  if (options[i] === "--fresh") fresh = true;
  else if (options[i] === "--upgrade-from" && /^[0-9]{1,4}$/.test(options[i + 1] ?? "")) upgradeFrom = Number(options[++i]);
  else usage();
}
if (compose.length === 0 || (fresh && upgradeFrom !== null)) usage();

/** The journal drizzle's migrator reads: one entry for each migration, in order. */
const journal = JSON.parse(readFileSync(join(migrationsDir, "meta/_journal.json"), "utf8"));
if (upgradeFrom !== null && !journal.entries.some((entry) => entry.idx === upgradeFrom)) {
  stop(`There is no migration number ${upgradeFrom}: the newest is ${journal.entries.at(-1).idx}.`);
}

const envFile = resolve(root, "apps/api/.env.test");
if (!existsSync(envFile)) stop("apps/api/.env.test is missing. Run `node scripts/gen-dev-env.mjs` first.");
const migrateUrl = parseEnv(readFileSync(envFile, "utf8")).DATABASE_URL_MIGRATE;
if (!migrateUrl) stop("apps/api/.env.test has no DATABASE_URL_MIGRATE. Run `node scripts/gen-dev-env.mjs` again.");
const database = decodeURIComponent(new URL(migrateUrl).pathname.replace(/^\//, ""));
// The same rule guards the drop below: only a database whose name ends in _test is ever dropped.
if (!/^[a-z][a-z0-9_]*_test$/.test(database)) stop(`The test database must have a plain name ending in _test, not "${database}".`);

// The watcher's password, for the role when the server has none yet. It goes to the container in the environment of
// the compose command, by name only, and from there to psql as a variable: it is never in an argument or printed.
const infraEnvFile = resolve(root, "infra/.env");
const notifyPassword = existsSync(infraEnvFile) ? parseEnv(readFileSync(infraEnvFile, "utf8")).KORBAT_NOTIFY_DB_PASSWORD : undefined;
if (!notifyPassword) stop("infra/.env has no KORBAT_NOTIFY_DB_PASSWORD. Run `node scripts/gen-dev-env.mjs` first.");

// Runs inside the postgres container, where POSTGRES_USER and POSTGRES_DB are set. psql fills in
// :'db' and :"db" itself, so the name is never pasted into SQL by hand. With DROP_FIRST the database
// is dropped first; `with (force)` ends the sessions a stopped test run may have left open on it.
const script = `set -eu
run() { psql -v ON_ERROR_STOP=1 -q --username "$POSTGRES_USER" --dbname "$1" -v db="$TEST_DB" -v notify_pw="$NOTIFY_PW" -tA; }
if [ "$DROP_FIRST" = "yes" ]; then
  printf '%s\\n' 'drop database if exists :"db" with (force);' | run "$POSTGRES_DB"
  echo "database $TEST_DB: dropped"
fi
found=$(printf '%s\\n' "select 1 from pg_database where datname = :'db';" | run "$POSTGRES_DB")
if [ "$found" = "1" ]; then
  echo "database $TEST_DB: exists"
else
  printf '%s\\n' 'create database :"db";' | run "$POSTGRES_DB"
  echo "database $TEST_DB: created"
fi
# The watcher's role, once per server, when it is missing: a DO block on pg_roles, which reads the password from a
# setting of this session, since psql fills in no variable inside a DO block's body.
found_role=$(echo "select 1 from pg_roles where rolname = 'korbat_notify';" | run "$POSTGRES_DB")
run "$POSTGRES_DB" <<'SQL'
SET korbat.notify_pw = :'notify_pw';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'korbat_notify') THEN
    EXECUTE format('CREATE ROLE korbat_notify LOGIN PASSWORD %L', current_setting('korbat.notify_pw'));
  END IF;
END $$;
SQL
if [ "$found_role" = "1" ]; then echo "role korbat_notify: exists"; else echo "role korbat_notify: created"; fi
run "$TEST_DB" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE USAGE  ON SCHEMA public FROM PUBLIC;
GRANT CREATE ON DATABASE :"db" TO korbat_migrate;
GRANT ALL ON SCHEMA public TO korbat_migrate;
GRANT USAGE ON SCHEMA public TO korbat_api;
GRANT USAGE ON SCHEMA public TO korbat_notify;
SQL
echo "grants applied"
`;

const dropFirst = fresh || upgradeFrom !== null ? "yes" : "no";
const created = spawnSync(compose[0], [...compose.slice(1), "exec", "-T", "-e", `TEST_DB=${database}`, "-e", `DROP_FIRST=${dropFirst}`, "-e", "NOTIFY_PW", "postgres", "sh", "-s"], {
  cwd: root,
  input: script,
  encoding: "utf8",
  // NOTIFY_PW is named alone above: compose takes its value from this environment.
  env: { ...process.env, NOTIFY_PW: notifyPassword },
});
if (created.error) stop(`Could not run ${compose[0]}: ${created.error.message}`);
process.stdout.write(scrub(created.stdout));
if (created.status !== 0) stop(`Creating ${database} failed. Is the postgres service up?\n${scrub(created.stderr)}`);

/**
 * Runs every pending migration of a folder as one batch: the migrator opens one transaction for all of them. A failure
 * is thrown, never an exit from here: process.exit runs no `finally`, and the caller below has a temporary copy to remove.
 */
function migrate(folder) {
  const migrated = spawnSync(process.execPath, ["--import", "tsx", "src/migrate.ts"], {
    cwd: resolve(root, "apps/api"),
    env: { ...process.env, DATABASE_URL_MIGRATE: migrateUrl, MIGRATIONS_DIR: folder },
    encoding: "utf8",
  });
  if (migrated.error) throw new Error(`Could not run the migrations: ${migrated.error.message}`);
  if (migrated.status !== 0) throw new Error(`Migrating ${database} failed.\n${scrub(migrated.stderr)}`);
}

try {
  if (upgradeFrom !== null) {
    // A temporary copy of the migrations whose journal ends at the given number: the migrator applies what the journal
    // lists and commits. The second run below, with the real folder, then meets a committed database. The copy is
    // removed whether or not its migrations ran: the `finally` ends before the script exits on a failure.
    const copy = mkdtempSync(join(tmpdir(), "korbat-migrations-"));
    try {
      cpSync(migrationsDir, copy, { recursive: true });
      const entries = journal.entries.filter((entry) => entry.idx <= upgradeFrom);
      writeFileSync(join(copy, "meta/_journal.json"), JSON.stringify({ ...journal, entries }, null, 2));
      migrate(copy);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
    console.log(`migrations up to ${journal.entries.find((entry) => entry.idx === upgradeFrom).tag} applied and committed`);
  }
  migrate(migrationsDir);
} catch (err) {
  stop(err instanceof Error ? err.message : String(err));
}
console.log(upgradeFrom === null ? "migrations applied" : "later migrations applied as one batch");
console.log(`test database ready: ${database}`);

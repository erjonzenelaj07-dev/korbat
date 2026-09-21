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

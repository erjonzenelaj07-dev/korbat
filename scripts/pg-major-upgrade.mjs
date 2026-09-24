#!/usr/bin/env node
/**
 * Moves a database from the PostgreSQL 16 volume (`pgdata`, mounted at /var/lib/postgresql/data) to the
 * PostgreSQL 18 volume (`pgdata18`, mounted at /var/lib/postgresql) of the same Compose project:
 *
 * 1. stops the project's postgres service;
 * 2. starts the old server on the old volume in a throwaway container without network, prints the
 *    row counts of profiles, posts and applied migrations, and takes a pg_dump in custom format;
 * 3. starts the project's postgres service, which creates the new volume, the roles and the database;
 * 4. restores the dump as the superuser, so every object keeps its owner, and prints the counts again.
 *
 * The old volume is never changed or removed. The test database (`<name>_test`) is not moved; run
 * `node scripts/test-db.mjs` afterwards to create it again. Passwords stay inside the containers and
 * are never printed.
 *
 * Usage, from the repo root:
 *   node scripts/pg-major-upgrade.mjs [--old-image postgres:16.15-alpine] -- <docker compose command>
 */
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const options = separator === -1 ? argv : argv.slice(0, separator);
const compose = separator === -1 ? [] : argv.slice(separator + 1);
const option = (name) => {
  const index = options.indexOf(`--${name}`);
  return index === -1 ? undefined : options[index + 1];
};
const oldImage = option("old-image") ?? "postgres:16.15-alpine";
if (compose.length === 0) {
  console.error("usage: node scripts/pg-major-upgrade.mjs [--old-image <image>] -- <docker compose command>");
  process.exit(2);
}

function stop(message) {
  console.error(message);
  process.exit(1);
}

/** Runs a command and returns its result; a command that could not start stops the script. */
function run(cmd, args, extra = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1024 ** 3, ...extra });
  if (result.error) stop(`Could not run ${cmd}: ${result.error.message}`);
  return result;
}

const COUNTS = "select 'profiles=' || (select count(*) from profiles) || ' posts=' || (select count(*) from posts) || ' migrations=' || (select count(*) from drizzle.__drizzle_migrations)";

// 1. The project, its volumes and the database's name and superuser, from the resolved Compose file.
const configured = run(compose[0], [...compose.slice(1), "config", "--format", "json"]);
if (configured.status !== 0) stop(`docker compose config failed:${String.fromCharCode(10)}${configured.stderr}`);
const config = JSON.parse(configured.stdout);
const project = config.name;
const oldVolume = `${project}_pgdata`;
const newVolume = config.volumes?.pgdata18?.name ?? `${project}_pgdata18`;
const environment = config.services?.postgres?.environment ?? {};
const user = environment.POSTGRES_USER;
const database = environment.POSTGRES_DB;
if (!user || !database) stop("The postgres service has no POSTGRES_USER and POSTGRES_DB; is infra/.env complete?");

// 2. Nothing to move without the old volume; nothing to do when the new one already holds a cluster.
if (spawnSync("docker", ["volume", "inspect", oldVolume]).status !== 0) {
  console.log(`no ${oldVolume} volume: nothing to move, the stack starts on an empty PostgreSQL 18`);
  process.exit(0);
}
if (spawnSync("docker", ["volume", "inspect", newVolume]).status === 0) {
  const probe = run("docker", ["run", "--rm", "--network", "none", "-v", `${newVolume}:/var/lib/postgresql`, oldImage, "sh", "-c", "test -f /var/lib/postgresql/18/docker/PG_VERSION && echo cluster || echo empty"]);
  if (probe.stdout.trim() === "cluster") stop(`${newVolume} already holds a PostgreSQL 18 cluster. Remove it first if you really want to move ${oldVolume} again.`);
}

// 3. The old server, alone with its volume, dumps the database to stdout and reports its counts on stderr.
run(compose[0], [...compose.slice(1), "stop", "postgres"]);
const dumpScript = [
  "set -e",
  "docker-entrypoint.sh postgres >/tmp/pg.log 2>&1 &",
  "for i in $(seq 1 60); do pg_isready -q -U \"$POSTGRES_USER\" && break; sleep 1; done",
  "pg_isready -q -U \"$POSTGRES_USER\" || { cat /tmp/pg.log >&2; exit 1; }",
  "psql -tA -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" -c \"$COUNTS\" >&2",
  "pg_dump -U \"$POSTGRES_USER\" -Fc \"$POSTGRES_DB\"",
].join(String.fromCharCode(10)); // one command per line: the background "&" may not be followed by ";"
console.log(`dumping ${database} from ${oldVolume} with ${oldImage}`);
const dumped = run("docker", ["run", "--rm", "--network", "none", "-v", `${oldVolume}:/var/lib/postgresql/data`, "-e", `POSTGRES_USER=${user}`, "-e", `POSTGRES_DB=${database}`, "-e", `COUNTS=${COUNTS}`, oldImage, "sh", "-c", dumpScript], { encoding: "buffer" });
const before = dumped.stderr.toString("utf8").trim().split(/\r?\n/).pop() ?? "";
if (dumped.status !== 0 || !before.startsWith("profiles=")) stop(`The dump failed:${String.fromCharCode(10)}${dumped.stderr.toString("utf8")}`);
console.log(`before: ${before} (${dumped.stdout.length} bytes dumped)`);

// 4. The new server creates its cluster, the roles and the empty database; the dump goes in as the superuser.
const started = run(compose[0], [...compose.slice(1), "up", "-d", "--wait", "postgres"]);
if (started.status !== 0) stop(`postgres did not start:${String.fromCharCode(10)}${started.stderr}`);
const restored = run(compose[0], [...compose.slice(1), "exec", "-T", "postgres", "pg_restore", "-U", user, "-d", database, "--exit-on-error"], { input: dumped.stdout });
if (restored.status !== 0) stop(`pg_restore failed:${String.fromCharCode(10)}${restored.stderr}`);
const counted = run(compose[0], [...compose.slice(1), "exec", "-T", "postgres", "psql", "-tA", "-U", user, "-d", database, "-c", COUNTS]);
const after = counted.stdout.trim();
console.log(`after:  ${after}`);
if (after !== before) stop(`The counts differ after the restore. The old volume ${oldVolume} is untouched.`);
console.log(`upgrade complete: ${database} now runs on PostgreSQL 18 in ${newVolume}`);
console.log(`The old volume ${oldVolume} was left in place. Remove it once you are sure: docker volume rm ${oldVolume}`);
console.log("The test database was not moved; run `node scripts/test-db.mjs` to create it again.");

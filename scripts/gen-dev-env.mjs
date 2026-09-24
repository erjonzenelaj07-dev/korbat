#!/usr/bin/env node
/**
 * Creates or completes the local .env files from their committed examples: infra/.env,
 * apps/api/.env, apps/app/.env and apps/worker/.env.
 *
 * - `change-me-<word>`          -> 48 random hex characters (passwords)
 * - `change-me-key-<name>`      -> 32 random bytes, base64 (HMAC keys)
 * - `v1:change-me-key-<name>`   -> `v1:` + 32 random bytes, base64 (versioned encryption keys)
 * - `change-me-api|auth|migrate|redis` inside apps/api/.env -> the matching password from infra/.env
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
 * It only serves development: it refuses to run when infra/.env already names a public origin,
 * because production values are set by hand and never generated.
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
    .replace(/change-me-(api|auth|migrate|redis)\b/g, (match, role) => (role === "redis" ? infra.get("REDIS_PASSWORD") : infra.get(`KORBAT_${role.toUpperCase()}_DB_PASSWORD`)) ?? match)
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

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const existingOrigin = read("infra/.env").get("API_APP_ORIGIN");
if (existingOrigin !== undefined) {
  let host = "";
  try {
    host = new URL(existingOrigin).hostname;
  } catch {
    host = "";
  }
  if (!LOCAL_HOSTS.includes(host)) {
    console.error(`API_APP_ORIGIN in infra/.env is "${existingOrigin}", not a localhost origin. This script generates development values only; set production values by hand.`);
    process.exit(1);
  }
}

const hostApi = read("apps/api/.env");
complete("infra/.env.example", "infra/.env", new Map(), new Map([...hostApi].map(([name, value]) => [`API_${name}`, value])));

const infra = read("infra/.env");
const dockerApi = new Map([...infra].filter(([name]) => name.startsWith("API_")).map(([name, value]) => [name.slice("API_".length), value]));
complete("apps/api/.env.example", "apps/api/.env", infra, dockerApi);

/** A REDIS_URL written before Valkey required a password gains the one infra/.env holds. */
function addRedisPassword(relTarget, password) {
  if (!password) return;
  const path = resolve(root, relTarget);
  const current = readFileSync(path, "utf8");
  const line = current.split(/\r?\n/).find((l) => l.startsWith("REDIS_URL="));
  if (!line) return;
  const url = new URL(line.slice("REDIS_URL=".length));
  if (url.password) return;
  url.password = password;
  writeFileSync(path, current.replace(line, `REDIS_URL=${url.href}`), "utf8");
  console.log(`${relTarget}: REDIS_URL now carries the Valkey password`);
}
addRedisPassword("apps/api/.env", infra.get("REDIS_PASSWORD"));

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

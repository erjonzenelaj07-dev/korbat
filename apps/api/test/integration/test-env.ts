import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const ENV_FILE = fileURLToPath(new URL("../../.env.test", import.meta.url));
/** 3f: the watcher's role is the fourth, so that no test of the watcher can write into the development database. */
const DATABASE_KEYS = ["DATABASE_URL_API", "DATABASE_URL_AUTH", "DATABASE_URL_MIGRATE", "DATABASE_URL_NOTIFY"] as const;

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

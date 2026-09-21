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

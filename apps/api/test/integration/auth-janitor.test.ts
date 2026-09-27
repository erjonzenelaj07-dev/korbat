import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { randomToken } from "../../src/auth/crypto";
import { EMAIL_CODE_RETENTION_MS, SESSION_RETENTION_MS, janitor } from "../../src/auth/janitor";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { newUserWithDevice } from "./auth-fixtures";
import { flowHarness } from "./flow-harness";

const DAY = 24 * 60 * 60_000;

describe.skipIf(!process.env.INTEGRATION)("integration: the auth janitor", () => {
  let db: Db;
  let migrateDb: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    const config = loadConfig();
    db = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    // The migrate role is not part of the API configuration; the test environment carries it for setup.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await Promise.all([closeDb(db), closeDb(migrateDb)]);
  });

  test("dead codes, old sessions and stale device address hashes go; live ones stay", async () => {
    const h = flowHarness(repo);
    const { user, device } = await newUserWithDevice(repo);
    const now = h.clock.now();
    const code = (expiresAt: Date) =>
      repo.createEmailCode({ flowId: randomToken(), email: `janitor-${randomToken(6)}@korbat.local`, userId: user.id, purpose: "login", codeHash: "h", expiresAt, ipHash: "x" });
    await code(new Date(now.getTime() - EMAIL_CODE_RETENTION_MS - DAY));
    await code(new Date(now.getTime() + 600_000));

    const old = await h.deps.sessions.issue(user.id, device.id, { factors: { email: now.getTime() } });
    await repo.revokeSession(old.session.sessionId, user.id, new Date(now.getTime() - SESSION_RETENTION_MS - DAY));
    const live = await h.deps.sessions.issue(user.id, device.id, { factors: { email: now.getTime() } });

    await repo.touchDevice(device.id, "stale-hash", new Date(now.getTime() - 31 * DAY));
    const { device: recent } = await newUserWithDevice(repo);
    await repo.touchDevice(recent.id, "fresh-hash", now);

    const report = await janitor(h.deps, now);
    expect(report.emailCodes).toBeGreaterThanOrEqual(1);
    expect(report.sessions).toBeGreaterThanOrEqual(1);
    expect(report.deviceIpHashes).toBeGreaterThanOrEqual(1);
    expect(await repo.findActiveSession(live.session.sessionId, now)).toBeDefined();
    expect(await repo.listActiveSessions(user.id, now)).toHaveLength(1);
    const [stale] = (await db.execute(sql`select ip_hash from auth.devices where id = ${device.id}::uuid`)) as unknown as { ip_hash: string | null }[];
    expect(stale?.ip_hash).toBeNull();
    const [fresh] = (await db.execute(sql`select ip_hash from auth.devices where id = ${recent.id}::uuid`)) as unknown as { ip_hash: string | null }[];
    expect(fresh?.ip_hash).toBe("fresh-hash");
  });

  test("events older than 90 days are purged through the function; the role still cannot delete rows itself", async () => {
    const h = flowHarness(repo);
    const { user } = await newUserWithDevice(repo);
    await repo.appendEvent({ userId: user.id, type: "signin_success" });
    await repo.appendEvent({ userId: user.id, type: "signin_failure" });
    await migrateDb.execute(sql`update auth.auth_events set created_at = now() - interval '91 days' where user_id = ${user.id}::uuid and type = 'signin_success'`);

    // Drizzle wraps driver errors ("Failed query: ..."); the Postgres error is the cause.
    const failure = await db.execute(sql`delete from auth.auth_events where user_id = ${user.id}::uuid`).then(() => null, (err: unknown) => err);
    expect(String((failure as { cause?: unknown } | null)?.cause)).toMatch(/permission denied for table auth_events/);
    const report = await janitor(h.deps, h.clock.now());
    expect(report.events).toBeGreaterThanOrEqual(1);
    expect((await repo.recentEvents(user.id)).map((e) => e.type)).toEqual(["signin_failure"]);
  });
});

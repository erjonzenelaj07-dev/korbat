import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, staffEnrollments, staffSessions, type Db } from "@korbat/db";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { EMAIL_CODE_RETENTION_MS, SESSION_RETENTION_MS, STAFF_ENROLLMENT_RETENTION_MS, STAFF_SESSION_RETENTION_MS, janitor } from "../../src/auth/janitor";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { newUserWithDevice } from "./auth-fixtures";
import { flowHarness } from "./flow-harness";
import { TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, newStaffKey, newStaffSession } from "./staff-fixtures";

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
    await repo.revokeSession(old.session.handle, user.id, new Date(now.getTime() - SESSION_RETENTION_MS - DAY));
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

  test("staff sessions go 30 days after they were revoked or expired and enrolment links a day after use or expiry; live ones stay", async () => {
    expect(STAFF_SESSION_RETENTION_MS).toBe(30 * DAY);
    expect(STAFF_ENROLLMENT_RETENTION_MS).toBe(DAY);
    const h = flowHarness(repo);
    const now = h.clock.now();
    const ago = (ms: number) => new Date(now.getTime() - ms);
    const { user, key } = await newStaffKey(db, migrateDb, repo);

    // A session ended 30 days ago and more: it expired 15 minutes after it started, 31 days ago.
    const old = await newStaffSession(db, user.id, key.id, ago(31 * DAY));
    // One that expired 29 days ago, never revoked; one revoked an hour ago; and a live one.
    const expired = await newStaffSession(db, user.id, key.id, ago(29 * DAY));
    const revoked = await newStaffSession(db, user.id, key.id, ago(2 * 60 * 60_000));
    await db.update(staffSessions).set({ revokedAt: ago(60 * 60_000) }).where(eq(staffSessions.id, revoked.id));
    const live = await newStaffSession(db, user.id, key.id, ago(60_000));

    // Enrolments are written by the migrator alone, so it backdates them: a spent one's used_at is set as it is inserted.
    const link = (values: { usedAt?: Date; expiresAt: Date }) =>
      migrateDb
        .insert(staffEnrollments)
        .values({ userId: user.id, tokenHash: sha256Hex(randomToken()), origin: TEST_CONSOLE_ORIGIN, rpId: TEST_CONSOLE_RP_ID, ...values })
        .returning({ id: staffEnrollments.id })
        .then(([row]) => row!.id);
    const usedLongAgo = await link({ usedAt: ago(25 * 60 * 60_000), expiresAt: ago(24 * 60 * 60_000) });
    const expiredLongAgo = await link({ expiresAt: ago(25 * 60 * 60_000) });
    const usedRecently = await link({ usedAt: ago(23 * 60 * 60_000), expiresAt: new Date(now.getTime() + 60_000) });
    const expiredRecently = await link({ expiresAt: ago(23 * 60 * 60_000) });
    const open = await link({ expiresAt: new Date(now.getTime() + 30 * 60_000) });

    const report = await janitor(h.deps, now);
    expect(report.staffSessions).toBeGreaterThanOrEqual(1);
    expect(report.staffEnrollments).toBeGreaterThanOrEqual(2);
    const sessionsLeft = (await migrateDb.select({ id: staffSessions.id }).from(staffSessions).where(eq(staffSessions.userId, user.id))).map((s) => s.id);
    expect(sessionsLeft.sort()).toEqual([expired.id, revoked.id, live.id].sort());
    expect(sessionsLeft).not.toContain(old.id);
    const ids = [usedLongAgo, expiredLongAgo, usedRecently, expiredRecently, open];
    const linksLeft = (await migrateDb.select({ id: staffEnrollments.id }).from(staffEnrollments).where(inArray(staffEnrollments.id, ids))).map((e) => e.id);
    expect(linksLeft.sort()).toEqual([usedRecently, expiredRecently, open].sort());
    // The staff key itself is never the janitor's: audit rows name it.
    const [kept] = (await db.execute(sql`select id from auth.staff_keys where id = ${key.id}::uuid`)) as unknown as { id: string }[];
    expect(kept?.id).toBe(key.id);
  });
});

import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, staffEnrollments, staffSessions, type Db } from "@korbat/db";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { confirmNotifier, forgetNotifierAfter, mailNotifier, storeNotifierContact } from "../../src/auth/flows/notifiers";
import { emailHash } from "../../src/auth/identifiers";
import { EMAIL_CODE_RETENTION_MS, SESSION_RETENTION_MS, STAFF_ENROLLMENT_RETENTION_MS, STAFF_SESSION_RETENTION_MS, janitor } from "../../src/auth/janitor";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { newUserWithDevice } from "./auth-fixtures";
import { flowHarness, newTestEmail } from "./flow-harness";
import { TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, newStaffKey, newStaffSession } from "./staff-fixtures";

const DAY = 24 * 60 * 60_000;

describe.skipIf(!process.env.INTEGRATION)("integration: the auth janitor", () => {
  let db: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let notifierRowsBefore: Record<string, number>;

  /** How many rows the three notifier tables hold: what this file's last test holds them to. */
  async function notifierRows(): Promise<Record<string, number>> {
    const [row] = (await db.execute(
      sql`select (select count(*)::int from auth.notifier_contacts) as contacts, (select count(*)::int from auth.notifier_confirmations) as confirmations, (select count(*)::int from auth.notifier_suppressions) as suppressions`,
    )) as unknown as Record<string, number>[];
    return { ...row! };
  }

  beforeAll(async () => {
    const config = loadConfig();
    db = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    // The migrate role is not part of the API configuration; the test environment carries it for setup.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    repo = createAuthRepo(db);
    notifierRowsBefore = await notifierRows();
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

  /** A notifier's contact with an address of its own, stored through the flow. */
  async function contact(h: ReturnType<typeof flowHarness>) {
    const id = randomUUID();
    const email = newTestEmail("janitor-notifier");
    await storeNotifierContact(h.deps, id, { name: "Ada", email });
    return { id, email, hash: emailHash(h.deps.config.authHmacKey, email) };
  }
  const contactsLeft = async (ids: string[]) =>
    ((await db.execute(sql`select id from auth.notifier_contacts where id = any(${`{${ids.join(",")}}`}::uuid[])`)) as unknown as { id: string }[]).map((row) => row.id).sort();
  const confirmationsLeft = async (hashes: string[]) =>
    ((await db.execute(sql`select email_hash from auth.notifier_confirmations where email_hash = any(${`{${hashes.join(",")}}`}::text[])`)) as unknown as { email_hash: string }[]).map((row) => row.email_hash).sort();

  test("a notifier's contact goes once its day to be forgotten has passed, and a confirmation once its 30 days have; those not yet due stay (3c design, section 6.1)", async () => {
    const h = flowHarness(repo);
    const now = h.clock.now();
    const [due, later, fresh] = [await contact(h), await contact(h), await contact(h)];
    await forgetNotifierAfter(h.deps, [due.id], new Date(now.getTime() - 1000));
    await forgetNotifierAfter(h.deps, [later.id], new Date(now.getTime() + 60_000));
    // A confirmation made 31 days ago ran out yesterday; one made now has 30 days ahead of it.
    const past = flowHarness(repo);
    past.clock.advance(-31 * DAY);
    const old = await contact(past);
    for (const [harness, made] of [[past, old], [h, fresh]] as const) {
      expect(await mailNotifier(harness.deps, made.id, { template: "notice_received", ref: "N-ABCDEFGH23", receivedAt: now, items: ["http://localhost:8081/u/ada"] })).toBe("sent");
      const token = /#t=(.+)$/.exec(harness.mailer.sent.at(-1)!.data.pageUrl!)![1]!;
      expect(await confirmNotifier(harness.deps, made.id, token)).toBe(true);
    }
    try {
      const report = await janitor(h.deps, now);
      expect(report.notifierContacts).toBeGreaterThanOrEqual(1);
      expect(report.notifierConfirmations).toBeGreaterThanOrEqual(1);
      expect(await contactsLeft([due.id, later.id, fresh.id, old.id])).toEqual([later.id, fresh.id, old.id].sort());
      expect(await confirmationsLeft([old.hash, fresh.hash])).toEqual([fresh.hash]);
      // Nothing more is due: a second pass takes none of the rest.
      const again = await janitor(h.deps, now);
      expect([again.notifierContacts, again.notifierConfirmations]).toEqual([0, 0]);
    } finally {
      await db.execute(sql`delete from auth.notifier_contacts where id = any(${`{${[due.id, later.id, fresh.id, old.id].join(",")}}`}::uuid[])`);
      await db.execute(sql`delete from auth.notifier_confirmations where email_hash = any(${`{${[old.hash, fresh.hash].join(",")}}`}::text[])`);
    }
  });

  test("each purge runs in a try of its own: one that throws is logged with its name and counts 0, and the others still run", async () => {
    const h = flowHarness(repo);
    const now = h.clock.now();
    const { user } = await newUserWithDevice(repo);
    // Something for the purges around the failing one to take: a dead code, before it, and a contact that is due, after it.
    await repo.createEmailCode({ flowId: randomToken(), email: `janitor-${randomToken(6)}@korbat.local`, userId: user.id, purpose: "login", codeHash: "h", expiresAt: new Date(now.getTime() - EMAIL_CODE_RETENTION_MS - DAY), ipHash: "x" });
    const due = await contact(h);
    await forgetNotifierAfter(h.deps, [due.id], new Date(now.getTime() - 1000));
    const logged: { fields: Record<string, unknown>; message: string }[] = [];
    const log = { error: (fields: Record<string, unknown>, message: string) => logged.push({ fields, message }), info: () => undefined } as unknown as typeof h.deps.log;
    const failure = new Error("the sessions table cannot be reached");
    const failing = {
      ...repo,
      purgeSessions: async () => {
        throw failure;
      },
      purgeEvents: async () => {
        throw failure;
      },
    } as AuthRepo;
    try {
      const report = await janitor({ ...h.deps, repo: failing, log }, now);
      expect(report.sessions).toBe(0);
      expect(report.events).toBe(0);
      expect(report.emailCodes).toBeGreaterThanOrEqual(1);
      expect(report.notifierContacts).toBeGreaterThanOrEqual(1);
      expect(await contactsLeft([due.id])).toEqual([]);
      expect(logged).toEqual([
        { fields: { err: failure, purge: "sessions" }, message: "auth janitor: purge failed" },
        { fields: { err: failure, purge: "events" }, message: "auth janitor: purge failed" },
      ]);
      // Every purge has its place in the report, whatever became of it.
      expect(Object.keys(report).sort()).toEqual(["deviceIpHashes", "emailCodes", "events", "notifierConfirmations", "notifierContacts", "sessions", "staffEnrollments", "staffSessions"]);
    } finally {
      await db.execute(sql`delete from auth.notifier_contacts where id = ${due.id}::uuid`);
    }
  });

  test("this file left no notifier row behind: the three notifier tables hold what they held before it", async () => {
    // Every suite removes its own contacts, so none that was due stood here for the passes above to take.
    expect(await notifierRows()).toEqual(notifierRowsBefore);
  });
});

import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { auditHead, auditLog, authEvents, closeDb, createDb, staffEnrollments, staffKeys, staffSessions, users, type Db } from "@korbat/db";
import { AuthError } from "../../src/auth/context";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { enrollOptions, enrollVerify } from "../../src/auth/staff/enroll";
import { SYSTEM_ACTOR_ID } from "../../src/cli/grant-role";
import { checkAuditRecord, runStaffCommand } from "../../src/cli/staff";
import { loadConfig } from "../../src/config";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { flowHarness } from "./flow-harness";
import { inbox } from "./mailpit";
import {
  DEVICE_BOUND,
  TEST_CONSOLE,
  TEST_CONSOLE_ORIGIN,
  addStaffKey,
  issueEnrolment,
  newStaffAccount,
  newStaffSession,
  rolledBack,
  withLockTimeout,
} from "./staff-fixtures";

const REVOKED_SUBJECT = "Staff keys revoked on your korbat staff account";

/** The AuthError a flow rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the flow to reject");
}

/**
 * `staff.js revoke` against the real database and the real mail relay (3a design, section 7, Command line): one auth
 * transaction that locks the account's row first, revokes, records each key's revocation and, for `all`, the enrolment
 * links it cancelled, with the audit rows last; then the owner is mailed through Mailpit when a key was revoked.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff.js revoke", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    // The migrate role issues enrolments and reads every row back; the test environment carries its URL.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
  });
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  /** What revoke reads, as the api service holds it: the auth role's URL and the mail settings, nothing else. */
  const revokeEnv = (extra: Record<string, string> = {}) => ({
    DATABASE_URL_AUTH: process.env.DATABASE_URL_AUTH!,
    SMTP_URL: process.env.SMTP_URL!,
    MAIL_FROM: process.env.MAIL_FROM!,
    ...extra,
  });

  /** The command's printed lines, each marked with its stream, and its exit code, for a run that sees `env` alone. */
  async function cli(args: string[], env: Record<string, string>) {
    const lines: string[] = [];
    const code = await runStaffCommand(args, env, { log: (line) => lines.push(`out ${line}`), error: (line) => lines.push(`err ${line}`) });
    return { code, lines, text: lines.join("\n") };
  }

  const head = async () => (await migrateDb.select().from(auditHead))[0]!;
  const keysOf = (userId: string) => migrateDb.select().from(staffKeys).where(eq(staffKeys.userId, userId)).orderBy(asc(staffKeys.createdAt));
  const sessionsOf = (userId: string) => migrateDb.select().from(staffSessions).where(eq(staffSessions.userId, userId));
  const enrolmentsOf = (userId: string) => migrateDb.select().from(staffEnrollments).where(eq(staffEnrollments.userId, userId));
  const revokedEvents = (userId: string) =>
    migrateDb
      .select({ id: authEvents.id, metadata: authEvents.metadata })
      .from(authEvents)
      .where(and(eq(authEvents.userId, userId), eq(authEvents.type, "staff_key_revoked")))
      .orderBy(asc(authEvents.id));
  const rowsAfter = (seq: number) => migrateDb.select().from(auditLog).where(gt(auditLog.chainSeq, seq)).orderBy(asc(auditLog.chainSeq));

  /**
   * A staff account holding two live keys (Blue, then Red), with two live staff sessions on Blue, one on Red, one on Blue
   * that has already ended, the spent enrolments of its keys and one open enrolment link.
   */
  async function staffWithRows() {
    const { user } = await newStaffAccount(authDb, repo);
    const blue = await addStaffKey(authDb, (await issueEnrolment(migrateDb, user.id)).token, { name: "Blue key" });
    const red = await addStaffKey(authDb, (await issueEnrolment(migrateDb, user.id)).token, { name: "Red key" });
    const onBlue = [await newStaffSession(authDb, user.id, blue.id), await newStaffSession(authDb, user.id, blue.id)];
    const onRed = await newStaffSession(authDb, user.id, red.id);
    const endedAt = new Date(Date.now() - 60_000);
    const ended = await newStaffSession(authDb, user.id, blue.id);
    await authDb.update(staffSessions).set({ revokedAt: endedAt }).where(eq(staffSessions.id, ended.id));
    const open = await issueEnrolment(migrateDb, user.id);
    return { user, blue, red, onBlue, onRed, ended, endedAt, open };
  }

  test("revoke <email> <key id>: that key and every staff session it opened, in one auth transaction with staff_key_revoked and its audit row last; the rest stays; the owner is mailed after the commit", { timeout: 30_000 }, async () => {
    const rows = await staffWithRows();
    const mailbox = await inbox(rows.user.email);
    const before = await head();
    const run = await cli(["revoke", rows.user.email.toUpperCase(), rows.blue.id.toUpperCase()], revokeEnv());
    expect(run.code, run.text).toBe(0);
    expect(run.lines.every((line) => line.startsWith("out ")), run.text).toBe(true);
    expect(run.text).toContain(rows.blue.id);
    expect(run.text).toMatch(/1 staff key revoked/);
    expect(run.text).toMatch(/2 staff sessions revoked/);

    const [blue, red] = await keysOf(rows.user.id);
    expect(blue).toMatchObject({ id: rows.blue.id, suspectAt: null });
    expect(blue!.revokedAt).not.toBeNull();
    expect(red).toMatchObject({ id: rows.red.id, revokedAt: null });
    const revokedAt = blue!.revokedAt!;
    const sessions = new Map((await sessionsOf(rows.user.id)).map((s) => [s.id, s.revokedAt]));
    expect(rows.onBlue.map((s) => sessions.get(s.id))).toEqual([revokedAt, revokedAt]);
    expect(sessions.get(rows.onRed.id)).toBeNull();
    // A session that had already ended keeps the time it ended at.
    expect(sessions.get(rows.ended.id)).toEqual(rows.endedAt);
    // The open link stays: only `all` cancels links.
    expect((await enrolmentsOf(rows.user.id)).filter((e) => e.usedAt === null).map((e) => e.id)).toEqual([rows.open.id]);

    const events = await revokedEvents(rows.user.id);
    expect(events.map((e) => e.metadata)).toEqual([{ keyId: rows.blue.id, sessionsRevoked: 2, via: "cli" }]);
    const written = await rowsAfter(before.seq);
    expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.requestId, r.metadata])).toEqual([
      ["staff_key_revoked", SYSTEM_ACTOR_ID, "staff_key", rows.blue.id, null, { keyId: rows.blue.id, sessionsRevoked: 2, via: "cli" }],
    ]);
    // One transaction, whose last statement wrote the audit row. That it locks the account's row first shows below, where
    // a transaction holding that row makes it give up.
    const [ids] = await migrateDb.execute<{ key: string; sessions: string; event: string; audit: string; eventCmin: string; auditCmin: string }>(sql`select
      (select xmin::text from auth.staff_keys where id = ${rows.blue.id}) as key,
      (select string_agg(distinct xmin::text, ',') from auth.staff_sessions where id in (${rows.onBlue[0]!.id}, ${rows.onBlue[1]!.id})) as sessions,
      (select xmin::text from auth.auth_events where id = ${events[0]!.id}) as event,
      (select xmin::text from public.audit_log where id = ${written[0]!.id}) as audit,
      (select cmin::text from auth.auth_events where id = ${events[0]!.id}) as "eventCmin",
      (select cmin::text from public.audit_log where id = ${written[0]!.id}) as "auditCmin"`);
    expect(new Set([ids!.key, ids!.sessions, ids!.event, ids!.audit]).size).toBe(1);
    expect(Number(ids!.auditCmin)).toBeGreaterThan(Number(ids!.eventCmin));

    // After the commit: the key's name and the time, no link.
    const text = await mailbox.next(REVOKED_SUBJECT);
    expect(text).toContain('"Blue key"');
    expect(text).not.toContain("Red key");
    expect(text).toContain(`${revokedAt.toISOString().slice(0, 10)} ${revokedAt.toISOString().slice(11, 16)} UTC`);
    expect(text).not.toMatch(/https?:\/\//);
    // The record still verifies.
    await rolledBack(apiDb, async (tx) => {
      expect((await checkAuditRecord(tx, [], authDb)).problems).toEqual([]);
    });
  });

  test("revoke <email> all: every key and staff session revoked and every unused enrolment deleted, with one staff_enrollments_cancelled row after the keys' rows, and one mail naming every key", { timeout: 30_000 }, async () => {
    const rows = await staffWithRows();
    // A second open link, and a key revoked before, which stays as it was.
    const second = await issueEnrolment(migrateDb, rows.user.id);
    const old = await addStaffKey(authDb, (await issueEnrolment(migrateDb, rows.user.id)).token, { name: "Old key" });
    const oldRevokedAt = new Date(Date.now() - 120_000);
    await authDb.update(staffKeys).set({ revokedAt: oldRevokedAt }).where(eq(staffKeys.id, old.id));
    const mailbox = await inbox(rows.user.email);
    const before = await head();

    const run = await cli(["revoke", rows.user.email, "all"], revokeEnv());
    expect(run.code, run.text).toBe(0);
    expect(run.text).toMatch(/2 staff keys revoked/);
    expect(run.text).toMatch(/3 staff sessions revoked/);
    expect(run.text).toMatch(/2 unused enrolment links deleted/);

    const keys = await keysOf(rows.user.id);
    const revokedAt = keys.find((k) => k.id === rows.blue.id)!.revokedAt!;
    expect(keys.map((k) => [k.name, k.revokedAt, k.suspectAt])).toEqual([
      ["Blue key", revokedAt, null],
      ["Red key", revokedAt, null],
      ["Old key", oldRevokedAt, null],
    ]);
    expect((await sessionsOf(rows.user.id)).every((s) => s.revokedAt !== null)).toBe(true);
    // The spent links stay for the janitor; both open ones are gone.
    const enrolments = await enrolmentsOf(rows.user.id);
    expect(enrolments.every((e) => e.usedAt !== null)).toBe(true);
    expect(enrolments.map((e) => e.id)).not.toContain(rows.open.id);
    expect(enrolments.map((e) => e.id)).not.toContain(second.id);

    expect((await revokedEvents(rows.user.id)).map((e) => e.metadata)).toEqual([
      { keyId: rows.blue.id, sessionsRevoked: 2, via: "cli" },
      { keyId: rows.red.id, sessionsRevoked: 1, via: "cli" },
    ]);
    const written = await rowsAfter(before.seq);
    expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.metadata])).toEqual([
      ["staff_key_revoked", SYSTEM_ACTOR_ID, "staff_key", rows.blue.id, { keyId: rows.blue.id, sessionsRevoked: 2, via: "cli" }],
      ["staff_key_revoked", SYSTEM_ACTOR_ID, "staff_key", rows.red.id, { keyId: rows.red.id, sessionsRevoked: 1, via: "cli" }],
      ["staff_enrollments_cancelled", SYSTEM_ACTOR_ID, "user", rows.user.id, { count: 2, via: "cli" }],
    ]);
    expect(new Set(written.map((r) => r.id)).size).toBe(3);
    const [ids] = await migrateDb.execute<{ audit: string; keys: string }>(sql`select
      (select string_agg(distinct xmin::text, ',') from public.audit_log where id in (${written[0]!.id}, ${written[1]!.id}, ${written[2]!.id})) as audit,
      (select string_agg(distinct xmin::text, ',') from auth.staff_keys where id in (${rows.blue.id}, ${rows.red.id})) as keys`);
    expect(ids!.audit).toBe(ids!.keys);

    const text = await mailbox.next(REVOKED_SUBJECT);
    expect(text).toContain('"Blue key", "Red key"');
    expect(text).not.toContain("Old key");
  });

  test("revoke all on an account with only an unused enrolment link deletes it, writes staff_enrollments_cancelled and mails nothing", { timeout: 30_000 }, async () => {
    const { user } = await newStaffAccount(authDb, repo);
    const open = await issueEnrolment(migrateDb, user.id);
    const mailbox = await inbox(user.email);
    const before = await head();
    const run = await cli(["revoke", user.email, "all"], revokeEnv());
    expect(run.code, run.text).toBe(0);
    expect(run.text).toMatch(/0 staff keys revoked/);
    expect(run.text).toMatch(/1 unused enrolment link deleted/);
    expect(await enrolmentsOf(user.id)).toEqual([]);
    expect((await rowsAfter(before.seq)).map((r) => [r.action, r.targetId, r.metadata])).toEqual([["staff_enrollments_cancelled", user.id, { count: 1, via: "cli" }]]);
    expect(open.id).toBeDefined();
    // No mail: an enrolment cancelled alone is not a revocation of anything the person holds.
    await expect(mailbox.next(REVOKED_SUBJECT)).rejects.toThrow(/no new/);
  });

  test("an enrolment verified after revoke all enrols nothing: the ceremony begun on the link before the command finds it gone", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo, { console: TEST_CONSOLE });
    const { user } = await newStaffAccount(authDb, repo);
    const enrolment = await issueEnrolment(migrateDb, user.id);
    // The person opened the link and their key answered the options before the operator ran the command.
    const { options } = await enrollOptions(h.deps, { token: enrolment.token, name: "Blue key", kind: "security_key" });
    const response = new SoftAuthenticator().create({
      rpId: options.rp.id!,
      challenge: options.challenge,
      origin: TEST_CONSOLE_ORIGIN,
      userHandle: Buffer.from(options.user.id, "base64url"),
      flags: DEVICE_BOUND,
    });
    const run = await cli(["revoke", user.email, "all"], revokeEnv());
    expect(run.code, run.text).toBe(0);
    expect(run.text).toMatch(/1 unused enrolment link deleted/);
    const before = await head();

    // The same token and the same answer, which a live link would have accepted, now enrol nothing and write nothing.
    const err = await failure(enrollVerify(h.deps, { token: enrolment.token, name: "Blue key", response }, { ...h.ctx, requestId: `req-${randomUUID()}` }));
    expect([err.code, err.status]).toEqual(["staff_enrollment_invalid", 400]);
    expect(await keysOf(user.id)).toEqual([]);
    expect(await enrolmentsOf(user.id)).toEqual([]);
    expect(await head()).toEqual(before);
  });

  test("an unknown address, a key of another account and an unknown key change nothing and answer 1; a key already revoked, or an account with nothing to revoke, changes nothing and answers 0", { timeout: 60_000 }, async () => {
    const rows = await staffWithRows();
    const other = await staffWithRows();
    const before = await head();
    const failing: [string, string[], RegExp][] = [
      ["an unknown address", ["revoke", `nobody-${randomUUID()}@korbat.local`, "all"], /no live account/],
      ["another account's key", ["revoke", rows.user.email, other.blue.id], /no staff key .* on /],
      ["an unknown key", ["revoke", rows.user.email, randomUUID()], /no staff key .* on /],
    ];
    for (const [label, args, reason] of failing) {
      const run = await cli(args, revokeEnv());
      expect([label, run.code]).toEqual([label, 1]);
      expect(run.text, label).toMatch(reason);
    }
    // A deleted account is no live account either.
    await authDb.update(users).set({ deletedAt: new Date() }).where(eq(users.id, other.user.id));
    expect((await cli(["revoke", other.user.email, "all"], revokeEnv())).code).toBe(1);

    await authDb.update(staffKeys).set({ revokedAt: new Date() }).where(eq(staffKeys.id, rows.red.id));
    const already = await cli(["revoke", rows.user.email, rows.red.id], revokeEnv());
    expect(already.code, already.text).toBe(0);
    expect(already.text).toMatch(/already revoked/);
    const { user: empty } = await newStaffAccount(authDb, repo);
    const nothing = await cli(["revoke", empty.email, "all"], revokeEnv());
    expect(nothing.code, nothing.text).toBe(0);
    expect(nothing.text).toMatch(/nothing to revoke/);
    expect(await head()).toEqual(before);
    expect(await revokedEvents(rows.user.id)).toEqual([]);
    expect((await sessionsOf(rows.user.id)).filter((s) => s.revokedAt === null)).toHaveLength(3);
  });

  test("a mail that fails is printed as a warning and undoes nothing", { timeout: 30_000 }, async () => {
    const rows = await staffWithRows();
    // Nothing listens on port 1.
    const run = await cli(["revoke", rows.user.email, rows.red.id], revokeEnv({ SMTP_URL: "smtp://127.0.0.1:1" }));
    expect(run.code, run.text).toBe(0);
    expect(run.text).toMatch(/^err warning: the staff_keys_revoked mail .* could not be sent/m);
    expect(run.text).toMatch(/the revocation stands/);
    expect((await keysOf(rows.user.id)).find((k) => k.id === rows.red.id)!.revokedAt).not.toBeNull();
  });

  test("reads only its own settings: the auth role's URL and the mail settings, naming the one that is missing", async () => {
    const { user } = await newStaffAccount(authDb, repo);
    for (const [missing, env] of [
      ["SMTP_URL", { DATABASE_URL_AUTH: process.env.DATABASE_URL_AUTH!, MAIL_FROM: process.env.MAIL_FROM! }],
      ["MAIL_FROM", { DATABASE_URL_AUTH: process.env.DATABASE_URL_AUTH!, SMTP_URL: process.env.SMTP_URL! }],
      ["DATABASE_URL_AUTH", { SMTP_URL: process.env.SMTP_URL!, MAIL_FROM: process.env.MAIL_FROM! }],
    ] as const) {
      const run = await cli(["revoke", user.email, "all"], env);
      expect([missing, run.code]).toEqual([missing, 1]);
      expect(run.text).toMatch(/^err Invalid environment for revoke:/);
      expect(run.text).toContain(missing);
    }
    // Nothing of the API's own configuration is needed: neither its secrets nor the API role's URL.
    const run = await cli(["revoke", user.email, "all"], revokeEnv());
    expect(run.code, run.text).toBe(0);
  });

  test("while an open transaction holds the account's row, it gives up after 10 seconds having written nothing, and says why", { timeout: 30_000 }, async () => {
    const rows = await staffWithRows();
    const before = await head();
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let holding!: () => void;
    const held = new Promise<void>((resolve) => (holding = resolve));
    // What a stalled or hostile API could do: a transaction that took the account's row and stays open.
    const stall = withLockTimeout(authDb, async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, rows.user.id)).for("no key update");
      holding();
      await released;
    });
    try {
      await held;
      const started = Date.now();
      const run = await cli(["revoke", rows.user.email, "all"], revokeEnv());
      expect(run.code).toBe(1);
      expect(run.text).toMatch(/revoke: an open transaction holds the audit head or the account's row.*stop the api service/s);
      expect(Date.now() - started).toBeGreaterThanOrEqual(9_000);
    } finally {
      release();
      await stall;
    }
    expect((await keysOf(rows.user.id)).every((k) => k.revokedAt === null)).toBe(true);
    expect((await enrolmentsOf(rows.user.id)).some((e) => e.id === rows.open.id)).toBe(true);
    expect(await head()).toEqual(before);
  });
});

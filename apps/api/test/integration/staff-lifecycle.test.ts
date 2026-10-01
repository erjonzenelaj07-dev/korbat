import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { auditHead, auditLog, authEvents, closeDb, createDb, staffEnrollments, staffKeys, staffSessions, type Db } from "@korbat/db";
import { AuthError } from "../../src/auth/context";
import { confirmDeletion, startDeletion } from "../../src/auth/flows/deletion";
import { MemoryKv } from "../../src/auth/kv";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { enrollOptions, enrollVerify } from "../../src/auth/staff/enroll";
import { SYSTEM_ACTOR_ID, runGrantRole } from "../../src/cli/grant-role";
import { loadConfig } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { createProfileStore } from "../../src/profiles/store";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { flowHarness, onboardedUser, type FlowHarness } from "./flow-harness";
import { DEVICE_BOUND, TEST_CONSOLE, TEST_CONSOLE_ORIGIN, addStaffKey, issueEnrolment, newStaffAccount, newStaffSession } from "./staff-fixtures";

/** A time as the staff mails print it, as 1c's mails do: the date and the minute in UTC. */
const mailTime = (at: Date) => `${at.toISOString().slice(0, 10)} ${at.toISOString().slice(11, 16)} UTC`;

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
 * What happens to an account's staff keys, staff sessions and enrolments when its role changes or the account is taken
 * down (3a design, section 7, Role changes, deletion and retention), on the real database: every change and its auth
 * events in one transaction on the auth role, with the audit rows last, and the staff mails where section 7 says.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff rows through role changes and account deletion", () => {
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

  const head = async () => (await migrateDb.select().from(auditHead))[0]!;
  const keysOf = (userId: string) => migrateDb.select().from(staffKeys).where(eq(staffKeys.userId, userId)).orderBy(asc(staffKeys.createdAt));
  const sessionsOf = (userId: string) => migrateDb.select().from(staffSessions).where(eq(staffSessions.userId, userId));
  const enrolmentsOf = (userId: string) => migrateDb.select().from(staffEnrollments).where(eq(staffEnrollments.userId, userId));
  const revokedEvents = (userId: string) =>
    migrateDb
      .select({ metadata: authEvents.metadata })
      .from(authEvents)
      .where(and(eq(authEvents.userId, userId), eq(authEvents.type, "staff_key_revoked")))
      .orderBy(asc(authEvents.id));
  /** The rows written after place `seq`, in chain order. */
  const rowsAfter = (seq: number) => migrateDb.select().from(auditLog).where(gt(auditLog.chainSeq, seq)).orderBy(asc(auditLog.chainSeq));
  const xminOf = async (table: string, ids: string[]) =>
    (await migrateDb.execute<{ xmin: string }>(sql`select xmin::text as xmin from ${sql.raw(table)} where id::text in ${ids}`)).map((row) => row.xmin);
  /**
   * The command id (cmin) of the statement that wrote each row the query selects. One transaction numbers its statements in
   * the order they ran, so rows that share an xmin can be ordered by it from outside. Every row read here is the version
   * its transaction wrote last, never changed again in it, so the column holds that statement's own number rather than
   * the combined one PostgreSQL keeps for a version a transaction both wrote and replaced.
   */
  const cmins = async (query: SQL) => (await migrateDb.execute<{ cmin: string }>(query)).map((row) => Number(row.cmin));
  const eventCmins = (userId: string, type: string) => cmins(sql`select cmin::text as cmin from auth.auth_events where user_id = ${userId} and type = ${type}`);
  const auditCmins = (ids: string[]) => cmins(sql`select cmin::text as cmin from public.audit_log where id::text in ${ids}`);
  /** The statement that last wrote the account's staff keys: the take-down's blanking, the last statement of takeDownRows. */
  const keyCmins = (userId: string) => cmins(sql`select cmin::text as cmin from auth.staff_keys where user_id = ${userId}`);

  /**
   * A staff account holding two live keys (Blue, then Red) and one revoked a minute ago (Old), with two live staff sessions
   * on Blue and one on Red, the three spent enrolments of its keys and one open enrolment link.
   */
  async function staffWithRows(userId: string) {
    const enrol = async (name: string) => addStaffKey(authDb, (await issueEnrolment(migrateDb, userId)).token, { name });
    const blue = await enrol("Blue key");
    const red = await enrol("Red key");
    const old = await enrol("Old key");
    const oldRevokedAt = new Date(Date.now() - 60_000);
    await authDb.update(staffKeys).set({ revokedAt: oldRevokedAt }).where(eq(staffKeys.id, old.id));
    const sessions = [await newStaffSession(authDb, userId, blue.id), await newStaffSession(authDb, userId, blue.id), await newStaffSession(authDb, userId, red.id)];
    const open = await issueEnrolment(migrateDb, userId);
    return { blue, red, old, oldRevokedAt, sessions, open };
  }

  describe("grant-role", () => {
    test("to user: every staff key and staff session revoked and every unused enrolment deleted, each key's revocation recorded before the role change, in one transaction, then the owner mailed", { timeout: 30_000 }, async () => {
      const { user } = await newStaffAccount(authDb, repo, "moderator");
      const rows = await staffWithRows(user.id);
      const mailer = new MemoryMailer();
      const before = await head();

      const result = await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, user.email, "user");
      expect(result).toEqual({ userId: user.id, previousRole: "moderator", staffSessionsRevoked: 3, enrollmentsDeleted: 1, staffKeysRevoked: 2, mailError: null });

      // The two live keys are revoked at the change's time, never suspect; the old one keeps the time it was revoked at.
      const keys = await keysOf(user.id);
      const revokedAt = keys[0]!.revokedAt!;
      expect(keys.map((k) => [k.name, k.revokedAt, k.suspectAt])).toEqual([
        ["Blue key", revokedAt, null],
        ["Red key", revokedAt, null],
        ["Old key", rows.oldRevokedAt, null],
      ]);
      expect((await sessionsOf(user.id)).every((s) => s.revokedAt !== null)).toBe(true);
      // The spent enrolments stay for the janitor; the open link is gone.
      const enrolments = await enrolmentsOf(user.id);
      expect(enrolments).toHaveLength(3);
      expect(enrolments.every((e) => e.usedAt !== null)).toBe(true);

      expect((await revokedEvents(user.id)).map((e) => e.metadata)).toEqual([
        { keyId: rows.blue.id, sessionsRevoked: 2, via: "role_change" },
        { keyId: rows.red.id, sessionsRevoked: 1, via: "role_change" },
      ]);
      // Each revocation's row, then the role change's, last, all from the command line.
      const written = await rowsAfter(before.seq);
      expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.metadata])).toEqual([
        ["staff_key_revoked", SYSTEM_ACTOR_ID, "staff_key", rows.blue.id, { keyId: rows.blue.id, sessionsRevoked: 2, via: "role_change" }],
        ["staff_key_revoked", SYSTEM_ACTOR_ID, "staff_key", rows.red.id, { keyId: rows.red.id, sessionsRevoked: 1, via: "role_change" }],
        ["role_granted", SYSTEM_ACTOR_ID, "user", user.id, { from: "moderator", to: "user", via: "cli", staffSessionsRevoked: 3, enrollmentsDeleted: 1 }],
      ]);
      // One transaction: the account's row, the keys, the sessions and the audit rows carry one transaction id.
      const xmins = new Set([
        ...(await xminOf("auth.users", [user.id])),
        ...(await xminOf("auth.staff_keys", [rows.blue.id, rows.red.id])),
        ...(await xminOf("auth.staff_sessions", rows.sessions.map((s) => s.id))),
        ...(await xminOf("public.audit_log", written.map((r) => String(r.id)))),
      ]);
      expect(xmins.size).toBe(1);

      // After the commit, the owner learns which keys went and when; no link.
      expect(mailer.sent).toEqual([{ to: user.email, template: "staff_keys_revoked", data: { names: '"Blue key", "Red key"', time: mailTime(revokedAt) } }]);
    });

    test("back to staff revives no key; and between moderator and admin the staff sessions and open links end while the keys stay, with no mail", { timeout: 30_000 }, async () => {
      const { user } = await newStaffAccount(authDb, repo, "moderator");
      const mailer = new MemoryMailer();
      await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, user.email, "user");
      await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, user.email, "admin");
      expect(await keysOf(user.id)).toEqual([]);

      const rows = await staffWithRows(user.id);
      const before = await head();
      const result = await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, user.email, "moderator");
      expect(result).toEqual({ userId: user.id, previousRole: "admin", staffSessionsRevoked: 3, enrollmentsDeleted: 1, staffKeysRevoked: 0, mailError: null });
      const keys = await keysOf(user.id);
      expect(keys.map((k) => [k.name, k.revokedAt])).toEqual([
        ["Blue key", null],
        ["Red key", null],
        ["Old key", rows.oldRevokedAt],
      ]);
      expect((await sessionsOf(user.id)).every((s) => s.revokedAt !== null)).toBe(true);
      expect((await enrolmentsOf(user.id)).map((e) => e.id)).not.toContain(rows.open.id);
      expect(await revokedEvents(user.id)).toEqual([]);
      const written = await rowsAfter(before.seq);
      expect(written.map((r) => [r.action, r.metadata])).toEqual([["role_granted", { from: "admin", to: "moderator", via: "cli", staffSessionsRevoked: 3, enrollmentsDeleted: 1 }]]);
      // Demoting an account that holds no live key mails nothing, and nor does this change.
      expect(mailer.sent).toEqual([]);

      // Made a user again, then staff again: the keys revoked on the way stay revoked.
      await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, user.email, "user");
      await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, user.email, "moderator");
      expect((await keysOf(user.id)).every((k) => k.revokedAt !== null)).toBe(true);
      expect(mailer.sent.map((m) => m.template)).toEqual(["staff_keys_revoked"]);
    });

    test("a mail that fails is reported and undoes nothing", { timeout: 30_000 }, async () => {
      const { user } = await newStaffAccount(authDb, repo, "admin");
      await staffWithRows(user.id);
      const mailer = new MemoryMailer();
      mailer.failing = true;
      const result = await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, user.email, "user");
      expect(result).toMatchObject({ staffKeysRevoked: 2, mailError: expect.stringMatching(/fail/) });
      expect((await keysOf(user.id)).every((k) => k.revokedAt !== null)).toBe(true);
      expect((await repo.findUserById(user.id))!.role).toBe("user");
    });

    test("a link issued before a role change enrols nothing, even once the account is staff again", { timeout: 30_000 }, async () => {
      const h = flowHarness(repo, { console: TEST_CONSOLE });
      for (const [from, through, to] of [
        ["moderator", "user", "moderator"],
        ["moderator", "admin", "admin"],
      ] as const) {
        const { user } = await newStaffAccount(authDb, repo, from);
        const enrolment = await issueEnrolment(migrateDb, user.id);
        const { options } = await enrollOptions(h.deps, { token: enrolment.token, name: "Blue key", kind: "security_key" });
        const response = new SoftAuthenticator().create({
          rpId: options.rp.id!,
          challenge: options.challenge,
          origin: TEST_CONSOLE_ORIGIN,
          userHandle: Buffer.from(options.user.id, "base64url"),
          flags: DEVICE_BOUND,
        });
        await runGrantRole({ authDb, kv: new MemoryKv(), mailer: new MemoryMailer() }, user.email, through);
        if (to !== through) await runGrantRole({ authDb, kv: new MemoryKv(), mailer: new MemoryMailer() }, user.email, to);
        const err = await failure(enrollVerify(h.deps, { token: enrolment.token, name: "Blue key", response }, { ...h.ctx, requestId: `req-${randomUUID()}` }));
        expect([from, through, err.code]).toEqual([from, through, "staff_enrollment_invalid"]);
        expect(await keysOf(user.id)).toEqual([]);
      }
    });
  });

  describe("the account's take-down", () => {
    /** An onboarded account with a profile, made staff, through the deletion flow's own harness. */
    async function staffOwner(h: FlowHarness) {
      const owner = await onboardedUser(h, repo);
      const handle = `t_${randomUUID().slice(0, 8)}`;
      expect((await createProfileStore(apiDb).create({ id: owner.user.id, handle, displayName: "Owner" })).ok).toBe(true);
      await authDb.execute(sql`update auth.users set role = 'moderator' where id = ${owner.user.id}`);
      return { ...owner, handle };
    }

    test("revokes the staff keys and sessions, deletes the enrolments and blanks the keys in the take-down's transaction, records them after account_deleted, and mails only account_deleted", { timeout: 30_000 }, async () => {
      const h = flowHarness(repo, { profiles: createProfileStore(apiDb), console: TEST_CONSOLE });
      const owner = await staffOwner(h);
      const rows = await staffWithRows(owner.user.id);
      // A ceremony begun on the open link before the deletion.
      const { options } = await enrollOptions(h.deps, { token: rows.open.token, name: "Late key", kind: "this_device" });
      const late = new SoftAuthenticator().create({
        rpId: options.rp.id!,
        challenge: options.challenge,
        origin: TEST_CONSOLE_ORIGIN,
        userHandle: Buffer.from(options.user.id, "base64url"),
        flags: DEVICE_BOUND,
      });
      const { flowId } = await startDeletion(h.deps, owner.session, h.ctx);
      const code = h.mailer.lastCodeFor(owner.email)!;
      const before = await head();

      await confirmDeletion(h.deps, owner.session, { flowId, code, handle: owner.handle });

      // Every key revoked (the old one keeps its time), none left with a name, an AAGUID or transports, and every key
      // still there with what audit-verify needs.
      const keys = await keysOf(owner.user.id);
      expect(keys.map((k) => k.id)).toEqual([rows.blue.id, rows.red.id, rows.old.id]);
      expect(keys.map((k) => [k.name, k.aaguid, k.transports, k.revokedAt === null, k.suspectAt])).toEqual([
        ["", null, [], false, null],
        ["", null, [], false, null],
        ["", null, [], false, null],
      ]);
      expect(keys[2]!.revokedAt).toEqual(rows.oldRevokedAt);
      expect(keys.every((k) => k.publicKey === "cose-key" && k.origin === TEST_CONSOLE_ORIGIN)).toBe(true);
      expect((await sessionsOf(owner.user.id)).every((s) => s.revokedAt !== null)).toBe(true);
      expect(await enrolmentsOf(owner.user.id)).toEqual([]);
      expect((await revokedEvents(owner.user.id)).map((e) => e.metadata)).toEqual([
        { keyId: rows.blue.id, sessionsRevoked: 2, via: "take_down" },
        { keyId: rows.red.id, sessionsRevoked: 1, via: "take_down" },
      ]);

      // The audit rows of the person's own deletion: each key's revocation, then the one open link cancelled. The three spent
      // links went too, but they could enrol nothing, so cancelling is not what happened to them.
      const written = await rowsAfter(before.seq);
      expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.metadata])).toEqual([
        ["staff_key_revoked", owner.user.id, "staff_key", rows.blue.id, { keyId: rows.blue.id, sessionsRevoked: 2, via: "take_down" }],
        ["staff_key_revoked", owner.user.id, "staff_key", rows.red.id, { keyId: rows.red.id, sessionsRevoked: 1, via: "take_down" }],
        ["staff_enrollments_cancelled", owner.user.id, "user", owner.user.id, { count: 1, via: "take_down" }],
      ]);
      const xmins = new Set([
        ...(await xminOf("auth.users", [owner.user.id])),
        ...(await xminOf("auth.staff_keys", keys.map((k) => k.id))),
        ...(await xminOf("auth.staff_sessions", rows.sessions.map((s) => s.id))),
        ...(
          await migrateDb.execute<{ xmin: string }>(sql`select xmin::text as xmin from auth.auth_events where user_id = ${owner.user.id} and type in ('account_deleted', 'staff_key_revoked')`)
        ).map((row) => row.xmin),
        ...(await xminOf("public.audit_log", written.map((r) => String(r.id)))),
      ]);
      expect(xmins.size).toBe(1);
      // And in that transaction the audit rows come after account_deleted, as its last statements.
      const [deletedCmin] = await eventCmins(owner.user.id, "account_deleted");
      expect(Math.min(...(await auditCmins(written.map((r) => String(r.id)))))).toBeGreaterThan(deletedCmin!);

      // The ceremony begun before enrols nothing, and the account's only mails are its deletion's.
      const err = await failure(enrollVerify(h.deps, { token: rows.open.token, name: "Late key", response: late }, { ...h.ctx, requestId: `req-${randomUUID()}` }));
      expect(err.code).toBe("staff_enrollment_invalid");
      expect(h.mailer.sent.map((m) => m.template)).toEqual(["delete_account_code", "account_deleted"]);
    });

    test("the purge's finishTakeDown does the same for an account marked deleted, as the server, and a second run writes nothing", { timeout: 30_000 }, async () => {
      const { user } = await newStaffAccount(authDb, repo, "admin");
      const rows = await staffWithRows(user.id);
      await repo.markDeleted(user.id, new Date());
      const before = await head();

      await repo.finishTakeDown(user.id, new Date());

      expect((await keysOf(user.id)).map((k) => [k.name, k.revokedAt === null])).toEqual([
        ["", false],
        ["", false],
        ["", false],
      ]);
      expect((await sessionsOf(user.id)).every((s) => s.revokedAt !== null)).toBe(true);
      expect(await enrolmentsOf(user.id)).toEqual([]);
      const written = await rowsAfter(before.seq);
      expect(written.map((r) => [r.action, r.actorId, r.targetId, r.metadata])).toEqual([
        ["staff_key_revoked", SYSTEM_ACTOR_ID, rows.blue.id, { keyId: rows.blue.id, sessionsRevoked: 2, via: "take_down" }],
        ["staff_key_revoked", SYSTEM_ACTOR_ID, rows.red.id, { keyId: rows.red.id, sessionsRevoked: 1, via: "take_down" }],
        ["staff_enrollments_cancelled", SYSTEM_ACTOR_ID, user.id, { count: 1, via: "take_down" }],
      ]);
      // The audit rows come after every statement of takeDownRows: its staff_key_revoked events and, last, the keys' blanking.
      const takenCmins = [...(await eventCmins(user.id, "staff_key_revoked")), ...(await keyCmins(user.id))];
      expect(Math.min(...(await auditCmins(written.map((r) => String(r.id)))))).toBeGreaterThan(Math.max(...takenCmins));

      const after = await head();
      await repo.finishTakeDown(user.id, new Date());
      expect(await head()).toEqual(after);
      expect(await revokedEvents(user.id)).toHaveLength(2);
      expect(await migrateDb.select().from(auditLog).where(inArray(auditLog.targetId, [rows.blue.id, rows.red.id]))).toHaveLength(4);
    });

    test("spent links go with the take-down without counting as cancelled: with no open link, no staff_enrollments_cancelled row", { timeout: 30_000 }, async () => {
      const { user } = await newStaffAccount(authDb, repo, "moderator");
      const key = await addStaffKey(authDb, (await issueEnrolment(migrateDb, user.id)).token, { name: "Blue key" });
      const before = await head();

      await repo.takeDown(user.id, new Date(), null);

      // The key's spent enrolment is gone with the account's other rows, and the record names only the key's revocation.
      expect(await enrolmentsOf(user.id)).toEqual([]);
      const written = await rowsAfter(before.seq);
      expect(written.map((r) => [r.action, r.actorId, r.targetId, r.metadata])).toEqual([
        ["staff_key_revoked", user.id, key.id, { keyId: key.id, sessionsRevoked: 0, via: "take_down" }],
      ]);
    });
  });
});

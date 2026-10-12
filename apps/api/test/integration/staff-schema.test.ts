import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { auditHead, auditLog, closeDb, createDb, staffEnrollments, staffKeys, staffSessions, users, type Db } from "@korbat/db";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import {
  TEST_CONSOLE_ORIGIN,
  TEST_CONSOLE_RP_ID,
  addStaffKey,
  issueEnrolment,
  newStaffAccount,
  newStaffKey,
  pgError,
  rolledBack,
  withLockTimeout,
} from "./staff-fixtures";

const HOUR = 60 * 60_000;

/** The auth side's actions, the only ones auth.append_audit writes (3a design, section 6). */
const AUTH_SIDE_ACTIONS = [
  "staff_key_revoked",
  "staff_key_counter_regression",
  "staff_sign_in",
  "staff_signed_out",
  "staff_session_revoked",
  "staff_enrollments_cancelled",
  "role_granted",
];

/**
 * Migration 0012's staff tables and functions (3a design, section 6) against the real database, before any flow uses them.
 * Statements run as korbat_auth, the role the running API holds, unless a test says otherwise: what it cannot do is what a
 * compromised API cannot do. Keys are made only through auth.add_staff_key, from enrolments the migrator inserts, as
 * `staff.js enroll` will.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the staff tables and functions", () => {
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    const config = loadConfig();
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  const keyRow = async (id: string) => (await migrateDb.select().from(staffKeys).where(eq(staffKeys.id, id)))[0]!;
  const enrolmentRow = async (id: string) => (await migrateDb.select().from(staffEnrollments).where(eq(staffEnrollments.id, id)))[0]!;
  const keysOf = (userId: string) => migrateDb.$count(staffKeys, eq(staffKeys.userId, userId));
  const head = async () => (await apiDb.select().from(auditHead))[0]!;
  /** Runs one statement as the auth role, in a transaction with a lock timeout, and returns its error or null. */
  const asAuth = (statement: ReturnType<typeof sql>) => pgError(withLockTimeout(authDb, (tx) => tx.execute(statement)));

  describe("auth.add_staff_key", () => {
    test("spends a live enrolment of a live staff account with a handle, stores the key with the enrolment's origin and relying party ID, and writes its audit row", async () => {
      const { user } = await newStaffAccount(authDb, repo, "admin");
      const enrolment = await issueEnrolment(migrateDb, user.id, { origin: "http://localhost:8090", rpId: "localhost" });
      const key = await addStaffKey(authDb, enrolment.token, { transports: ["internal", "hybrid"], name: "Windows Hello", counter: 3 });

      expect(key.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(await keyRow(key.id)).toMatchObject({
        userId: user.id,
        credentialId: key.credentialId,
        publicKey: key.publicKey,
        counter: 3,
        transports: ["internal", "hybrid"],
        name: "Windows Hello",
        aaguid: key.aaguid,
        origin: "http://localhost:8090",
        rpId: "localhost",
        lastUsedAt: null,
        revokedAt: null,
        suspectAt: null,
      });
      expect((await enrolmentRow(enrolment.id)).usedAt).toBeInstanceOf(Date);

      // Its audit row is the newest row of the chain: the function's last statement.
      const rows = await apiDb.select().from(auditLog).where(eq(auditLog.keyId, key.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorId: user.id,
        action: "staff_key_added",
        targetType: "staff_key",
        targetId: key.id,
        keyId: key.id,
        requestId: key.requestId,
        metadata: { enrollmentId: enrolment.id },
        staffSession: null,
        actionHash: null,
        stepUp: null,
        chainVersion: 1,
      });
      expect(await head()).toMatchObject({ seq: rows[0]!.chainSeq, hash: rows[0]!.hash });
    });

    test("refuses an unknown token, a token hash given in place of the token, a spent token and an expired one", async () => {
      const { user } = await newStaffAccount(authDb, repo);
      const live = await issueEnrolment(migrateDb, user.id);
      // Expired ten minutes ago by Node's clock, so no gap between Node's clock and the database's, which the function
      // reads, can make it live again.
      const expired = await issueEnrolment(migrateDb, user.id, { expiresAt: new Date(Date.now() - 10 * 60_000) });
      const spent = await issueEnrolment(migrateDb, user.id);
      await addStaffKey(authDb, spent.token);
      const before = { keys: await keysOf(user.id), head: await head() };

      // The stored hash is hashed again by the function, so reading the table spends nothing.
      for (const token of [randomToken(), sha256Hex(live.token), spent.token, expired.token]) {
        const err = await pgError(addStaffKey(authDb, token));
        expect(err?.message, token).toBe("staff_enrollment_invalid");
      }
      expect(await keysOf(user.id)).toBe(before.keys);
      expect(await head()).toEqual(before.head);
      expect((await enrolmentRow(live.id)).usedAt).toBeNull();
      expect((await enrolmentRow(expired.id)).usedAt).toBeNull();
    });

    test("refuses an account that was demoted, deleted or has no handle, and leaves its enrolment unspent", async () => {
      const cases: [string, Partial<typeof users.$inferInsert>][] = [
        ["demoted", { role: "user" }],
        ["deleted", { deletedAt: new Date() }],
        ["without a handle", { onboardedAt: null }],
      ];
      for (const [label, change] of cases) {
        const { user } = await newStaffAccount(authDb, repo);
        const enrolment = await issueEnrolment(migrateDb, user.id);
        await authDb.update(users).set(change).where(eq(users.id, user.id));
        const err = await pgError(addStaffKey(authDb, enrolment.token));
        expect(err?.message, label).toBe("staff_enrollment_invalid");
        expect((await enrolmentRow(enrolment.id)).usedAt, label).toBeNull();
        expect(await keysOf(user.id), label).toBe(0);
      }
    });

    test("refuses a sixth live key with staff_key_limit; a revoked key does not count", async () => {
      const { user } = await newStaffAccount(authDb, repo);
      const keys = [];
      for (let i = 0; i < 5; i++) keys.push(await addStaffKey(authDb, (await issueEnrolment(migrateDb, user.id)).token));
      const sixth = await issueEnrolment(migrateDb, user.id);
      expect((await pgError(addStaffKey(authDb, sixth.token)))?.message).toBe("staff_key_limit");
      expect((await enrolmentRow(sixth.id)).usedAt).toBeNull();

      await authDb.update(staffKeys).set({ revokedAt: new Date() }).where(eq(staffKeys.id, keys[0]!.id));
      await addStaffKey(authDb, sixth.token);
      expect(await keysOf(user.id)).toBe(6);
    });

    test("refuses a credential id another key already has", async () => {
      const first = await newStaffKey(authDb, migrateDb, repo);
      const { user } = await newStaffAccount(authDb, repo);
      const enrolment = await issueEnrolment(migrateDb, user.id);
      expect((await pgError(addStaffKey(authDb, enrolment.token, { credentialId: first.key.credentialId })))?.code).toBe("23505");
      expect((await enrolmentRow(enrolment.id)).usedAt).toBeNull();
    });
  });

  describe("what the auth role cannot do", () => {
    test("it cannot insert a staff key or an enrolment, nor write the audit log itself", async () => {
      const { user, key } = await newStaffKey(authDb, migrateDb, repo);
      const refusals: [ReturnType<typeof sql>, RegExp][] = [
        [
          sql`insert into auth.staff_keys (user_id, credential_id, public_key, name, origin, rp_id) values (${user.id}::uuid, ${randomToken(16)}, 'cose-key', 'planted', ${TEST_CONSOLE_ORIGIN}, ${TEST_CONSOLE_RP_ID})`,
          /permission denied for table staff_keys/,
        ],
        [
          sql`insert into auth.staff_enrollments (user_id, token_hash, origin, rp_id, expires_at) values (${user.id}::uuid, ${sha256Hex(randomToken())}, ${TEST_CONSOLE_ORIGIN}, ${TEST_CONSOLE_RP_ID}, now() + interval '30 minutes')`,
          /permission denied for table staff_enrollments/,
        ],
        [sql`insert into public.audit_log (actor_id, action) values (${user.id}::uuid, 'role_granted')`, /permission denied for schema public/],
      ];
      for (const [statement, refusal] of refusals) expect((await asAuth(statement))?.message).toMatch(refusal);
      expect(await keysOf(user.id)).toBe(1);
      expect((await keyRow(key.id)).name).toBe(key.name);
    });

    test("it cannot delete a staff key, nor change its credential, public key, owner, name, AAGUID, origin, relying party ID or creation time", async () => {
      const { key } = await newStaffKey(authDb, migrateDb, repo);
      const other = await newStaffAccount(authDb, repo);
      const before = await keyRow(key.id);
      const refused = [
        sql`delete from auth.staff_keys where id = ${key.id}::uuid`,
        sql`update auth.staff_keys set public_key = 'attacker-key' where id = ${key.id}::uuid`,
        sql`update auth.staff_keys set credential_id = ${randomToken(16)} where id = ${key.id}::uuid`,
        sql`update auth.staff_keys set user_id = ${other.user.id}::uuid where id = ${key.id}::uuid`,
        sql`update auth.staff_keys set name = 'renamed' where id = ${key.id}::uuid`,
        sql`update auth.staff_keys set aaguid = null where id = ${key.id}::uuid`,
        sql`update auth.staff_keys set transports = '{}' where id = ${key.id}::uuid`,
        sql`update auth.staff_keys set origin = 'http://evil.localhost', rp_id = 'evil.localhost' where id = ${key.id}::uuid`,
        sql`update auth.staff_keys set created_at = now() where id = ${key.id}::uuid`,
      ];
      for (const statement of refused) expect((await asAuth(statement))?.message).toMatch(/permission denied for table staff_keys/);
      expect(await keyRow(key.id)).toEqual(before);
    });

    test("it records a key's use, revocation and suspicion", async () => {
      const { key } = await newStaffKey(authDb, migrateDb, repo);
      const now = new Date();
      await authDb.update(staffKeys).set({ counter: 7, lastUsedAt: now }).where(eq(staffKeys.id, key.id));
      await authDb.update(staffKeys).set({ suspectAt: now, revokedAt: now }).where(eq(staffKeys.id, key.id));
      expect(await keyRow(key.id)).toMatchObject({ counter: 7, lastUsedAt: now, revokedAt: now, suspectAt: now });
    });

    test("a set revoked_at or suspect_at is never cleared or changed, and a key is never suspect without being revoked", async () => {
      const { key } = await newStaffKey(authDb, migrateDb, repo);
      const where = sql`where id = ${key.id}::uuid`;
      expect((await asAuth(sql`update auth.staff_keys set suspect_at = now() ${where}`))?.message).toMatch(/staff_keys_suspect_is_revoked/);
      expect(await asAuth(sql`update auth.staff_keys set revoked_at = now() ${where}`)).toBeNull();
      const revoked = await keyRow(key.id);
      for (const statement of [
        sql`update auth.staff_keys set revoked_at = null ${where}`,
        sql`update auth.staff_keys set revoked_at = revoked_at + interval '1 second' ${where}`,
      ]) {
        expect((await asAuth(statement))?.message).toMatch(/revoked_at is never cleared or changed/);
      }
      expect(await asAuth(sql`update auth.staff_keys set suspect_at = now() ${where}`)).toBeNull();
      for (const statement of [sql`update auth.staff_keys set suspect_at = null ${where}`, sql`update auth.staff_keys set suspect_at = suspect_at - interval '1 hour' ${where}`]) {
        expect((await asAuth(statement))?.message).toMatch(/suspect_at is never cleared or changed/);
      }
      // Unchanged values pass, so a revocation that repeats itself leaves the time it first recorded.
      expect(await asAuth(sql`update auth.staff_keys set revoked_at = coalesce(revoked_at, now()), counter = counter + 1 ${where}`)).toBeNull();
      expect((await keyRow(key.id)).revokedAt).toEqual(revoked.revokedAt);
    });

    test("it reads and deletes enrolments, and changes none of them", async () => {
      const { user } = await newStaffAccount(authDb, repo);
      const open = await issueEnrolment(migrateDb, user.id);
      for (const statement of [
        sql`update auth.staff_enrollments set used_at = now() where id = ${open.id}::uuid`,
        sql`update auth.staff_enrollments set expires_at = now() + interval '1 year' where id = ${open.id}::uuid`,
      ]) {
        expect((await asAuth(statement))?.message).toMatch(/permission denied for table staff_enrollments/);
      }
      expect(await authDb.select({ id: staffEnrollments.id }).from(staffEnrollments).where(eq(staffEnrollments.id, open.id))).toEqual([{ id: open.id }]);
      await authDb.delete(staffEnrollments).where(eq(staffEnrollments.id, open.id));
      expect(await migrateDb.$count(staffEnrollments, eq(staffEnrollments.id, open.id))).toBe(0);
    });

    test("a set used_at is never cleared or changed, even by the migrator that owns the table", async () => {
      const { enrolment } = await newStaffKey(authDb, migrateDb, repo);
      await rolledBack(migrateDb, async (tx) => {
        const err = await pgError(tx.transaction((sp) => sp.execute(sql`update auth.staff_enrollments set used_at = null where id = ${enrolment.id}::uuid`)));
        expect(err?.message).toMatch(/used_at is never cleared or changed/);
      });
      expect((await enrolmentRow(enrolment.id)).usedAt).toBeInstanceOf(Date);
    });
  });

  describe("staff sessions", () => {
    const session = (userId: string, keyId: string, created: Date, idleMs: number, absoluteMs: number) => ({
      id: sha256Hex(randomToken()),
      userId,
      keyId,
      createdAt: created,
      lastUsedAt: created,
      idleExpiresAt: new Date(created.getTime() + idleMs),
      absoluteExpiresAt: new Date(created.getTime() + absoluteMs),
      browser: "Firefox on Linux",
    });

    test("a session opened with the account's own key, for at most 12 hours, is stored with a random handle", async () => {
      const { user, key } = await newStaffKey(authDb, migrateDb, repo);
      const [row] = await authDb.insert(staffSessions).values(session(user.id, key.id, new Date(), 15 * 60_000, 12 * HOUR)).returning();
      expect(row!.handle).toMatch(/^[0-9a-f-]{36}$/);
      expect(row).toMatchObject({ userId: user.id, keyId: key.id, revokedAt: null, browser: "Firefox on Linux" });
    });

    test("a session lasting beyond 12 hours, or idle past its absolute end, is refused", async () => {
      const { user, key } = await newStaffKey(authDb, migrateDb, repo);
      for (const [label, values] of [
        ["12 hours and 1 ms", session(user.id, key.id, new Date(), 15 * 60_000, 12 * HOUR + 1)],
        ["idle past the absolute end", session(user.id, key.id, new Date(), 2 * HOUR, HOUR)],
      ] as const) {
        const err = await pgError(authDb.insert(staffSessions).values(values));
        expect(err, label).toMatchObject({ code: "23514", message: expect.stringMatching(/staff_sessions_lifetime/) });
      }
    });

    test("a session pairing an account with another account's key is refused", async () => {
      const owner = await newStaffKey(authDb, migrateDb, repo);
      const other = await newStaffAccount(authDb, repo);
      const err = await pgError(authDb.insert(staffSessions).values(session(other.user.id, owner.key.id, new Date(), 15 * 60_000, 12 * HOUR)));
      expect(err).toMatchObject({ code: "23503", message: expect.stringMatching(/staff_sessions_key_user_fk/) });
    });
  });

  describe("auth.forget_staff_keys", () => {
    test("changes nothing for a live account", async () => {
      const { user, key } = await newStaffKey(authDb, migrateDb, repo);
      const before = await keyRow(key.id);
      const [result] = await authDb.execute<{ n: number }>(sql`select auth.forget_staff_keys(${user.id}::uuid) as n`);
      expect(result!.n).toBe(0);
      expect(await keyRow(key.id)).toEqual(before);
    });

    test("blanks a deleted account's revoked key names, AAGUIDs and transports, keeping what audit-verify needs", async () => {
      const { user, key } = await newStaffKey(authDb, migrateDb, repo);
      await addStaffKey(authDb, (await issueEnrolment(migrateDb, user.id)).token);
      // As the take-down leaves them before it calls the function: the account marked deleted, every key revoked.
      const revokedAt = new Date();
      await authDb.update(staffKeys).set({ revokedAt }).where(eq(staffKeys.userId, user.id));
      const before = await keyRow(key.id);
      await authDb.update(users).set({ deletedAt: new Date() }).where(eq(users.id, user.id));
      const [result] = await authDb.execute<{ n: number }>(sql`select auth.forget_staff_keys(${user.id}::uuid) as n`);
      expect(result!.n).toBe(2);
      expect(await keyRow(key.id)).toEqual({ ...before, name: "", aaguid: null, transports: [] });
    });

    test("never blanks a live key, even when the auth role marks the account deleted around the call", async () => {
      // The auth role may set deleted_at, so the account's mark alone cannot guard the keys the column grants keep it
      // from changing; a key it has not revoked (which it can never undo) is never blanked. It can no longer clear the
      // mark (migration 0018, users_deleted_mark), so the transaction that set it is rolled back instead.
      const { user, key } = await newStaffKey(authDb, migrateDb, repo);
      const before = await keyRow(key.id);
      let forgotten = -1;
      await rolledBack(authDb, async (tx) => {
        await tx.update(users).set({ deletedAt: new Date() }).where(eq(users.id, user.id));
        const [result] = await tx.execute<{ n: number }>(sql`select auth.forget_staff_keys(${user.id}::uuid) as n`);
        forgotten = result!.n;
      });
      expect(forgotten).toBe(0);
      expect(await keyRow(key.id)).toEqual(before);
      expect((await repo.findUserById(user.id))!.deletedAt).toBeNull();
    });
  });

  describe("auth.append_audit", () => {
    test("writes each of the auth side's actions, in the caller's transaction", async () => {
      const start = await head();
      await rolledBack(authDb, async (tx) => {
        for (const [i, action] of AUTH_SIDE_ACTIONS.entries()) {
          const [row] = await tx.execute<{ place: number }>(
            sql`select auth.append_audit(${randomUUID()}::uuid, ${action}, 'staff_session', ${randomUUID()}, '{"via":"test"}'::jsonb, null, null, null, null, 'req-1')::int as place`,
          );
          expect(row!.place, action).toBe(start.seq + i + 1);
        }
        // A confirmed action carries its hash, its assertion and the key.
        const stepUp = JSON.stringify({ authenticatorData: "AAAA", clientDataJSON: "BBBB", signature: "CCCC" });
        const [confirmed] = await tx.execute<{ place: number }>(
          sql`select auth.append_audit(${randomUUID()}::uuid, 'staff_session_revoked', 'staff_session', ${randomUUID()}, '{"params":{}}'::jsonb, ${randomUUID()}::uuid, ${randomUUID()}::uuid, ${"ab".repeat(32)}, ${stepUp}::jsonb, 'req-2')::int as place`,
        );
        expect(confirmed!.place).toBe(start.seq + AUTH_SIDE_ACTIONS.length + 1);
      });
      expect(await head()).toEqual(start);
    });

    test("stores every column it is given, and an absent metadata as an empty object", async () => {
      const actorId = randomUUID();
      const staffSession = randomUUID();
      const keyId = randomUUID();
      const [written] = await withLockTimeout(authDb, (tx) =>
        tx.execute<{ place: number }>(
          sql`select auth.append_audit(${actorId}::uuid, 'staff_signed_out', 'staff_session', ${staffSession}, null, ${staffSession}::uuid, ${keyId}::uuid, null, null, 'req-signout')::int as place`,
        ),
      );
      const [row] = await apiDb.select().from(auditLog).where(eq(auditLog.chainSeq, written!.place));
      expect(row).toMatchObject({ actorId, action: "staff_signed_out", targetType: "staff_session", targetId: staffSession, metadata: {}, staffSession, keyId, actionHash: null, stepUp: null, requestId: "req-signout", chainVersion: 1 });
    });

    test("refuses every action outside its list, and writes nothing", async () => {
      const start = await head();
      for (const action of ["staff_key_added", "staff_enrollment_issued", "case_decided", "role_granted ", "", null]) {
        const err = await asAuth(sql`select auth.append_audit(${randomUUID()}::uuid, ${action}::text, null, null, '{}'::jsonb, null, null, null, null, null)`);
        expect(err?.message, String(action)).toMatch(/^auth\.append_audit does not write the action /);
      }
      expect(await head()).toEqual(start);
    });

    test("does not write a step-up without its key, as the table's check refuses", async () => {
      const stepUp = JSON.stringify({ authenticatorData: "AAAA", clientDataJSON: "BBBB", signature: "CCCC" });
      const err = await asAuth(sql`select auth.append_audit(${randomUUID()}::uuid, 'staff_session_revoked', null, null, '{}'::jsonb, null, null, ${"ab".repeat(32)}, ${stepUp}::jsonb, null)`);
      expect(err).toMatchObject({ code: "23514", message: expect.stringMatching(/audit_log_step_up_complete/) });
    });
  });

  test("the migrator owns every staff and chain function, pins its search path, and grants EXECUTE to the auth role alone", async () => {
    const rows = await apiDb.execute<{ name: string; owner: string; definer: boolean; config: string[] | null; api: boolean; auth: boolean }>(sql`
      select p.pronamespace::regnamespace::text || '.' || p.proname as name, p.proowner::regrole::text as owner, p.prosecdef as definer,
             p.proconfig as config, has_function_privilege('korbat_api', p.oid, 'execute') as api,
             has_function_privilege('korbat_auth', p.oid, 'execute') as auth
        from pg_proc p
       where (p.pronamespace = 'auth'::regnamespace and p.proname in ('add_staff_key', 'append_audit', 'forget_staff_keys', 'staff_never_cleared'))
          or (p.pronamespace = 'public'::regnamespace and p.proname in ('audit_chain', 'audit_chain_text'))
       order by 1`);
    const auth = ["search_path=auth, pg_temp"];
    const pub = ["search_path=public, pg_temp"];
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { name: "auth.add_staff_key", owner: "korbat_migrate", definer: true, config: auth, api: false, auth: true },
      { name: "auth.append_audit", owner: "korbat_migrate", definer: true, config: auth, api: false, auth: true },
      { name: "auth.forget_staff_keys", owner: "korbat_migrate", definer: true, config: auth, api: false, auth: true },
      // A trigger function: it fires whoever writes the row, and nobody calls it.
      { name: "auth.staff_never_cleared", owner: "korbat_migrate", definer: false, config: auth, api: false, auth: false },
      { name: "public.audit_chain", owner: "korbat_migrate", definer: true, config: pub, api: false, auth: false },
      { name: "public.audit_chain_text", owner: "korbat_migrate", definer: false, config: pub, api: false, auth: false },
    ]);
  });
});

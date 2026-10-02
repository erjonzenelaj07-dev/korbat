import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { auditHead, auditLog, authEvents, closeDb, createDb, profiles, staffEnrollments, staffKeys, users, type Db } from "@korbat/db";
import { sha256Hex } from "../../src/auth/crypto";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { SYSTEM_ACTOR_ID } from "../../src/cli/grant-role";
import { checkAuditRecord, runStaffCommand } from "../../src/cli/staff";
import { loadConfig } from "../../src/config";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { flowHarness } from "./flow-harness";
import { enrolKey } from "./staff-enrolment";
import { TEST_CONSOLE, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, addStaffKey, issueEnrolment, newStaffAccount, rolledBack, withLockTimeout } from "./staff-fixtures";

/** A link as `staff.js enroll` prints it, on a line of its own: the console's enrolment page and the 43-character token. */
const LINK = new RegExp(`^${TEST_CONSOLE_ORIGIN.replace(/[.]/g, "[.]")}/enroll/([A-Za-z0-9_-]{43})$`, "m");

/**
 * The staff command line's enrolment and key listing against the real database (3a design, section 7): `staff.js enroll`
 * runs as the migrator in the migrate service with nothing but the migrator's URL and the console's origin and relying
 * party ID, and `staff.js keys` reads the keys on the auth role and the handles on the API role.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff.js enroll and keys", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
  });
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  /** What the migrate service holds for enroll, and nothing else (Compose gives it these three). */
  const enrollEnv = (extra: Record<string, string> = {}) => ({ DATABASE_URL_MIGRATE: process.env.DATABASE_URL_MIGRATE!, CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, ...extra });
  /** What keys needs: the two roles' URLs, as the api service holds them. */
  const keysEnv = () => ({ DATABASE_URL_API: process.env.DATABASE_URL_API!, DATABASE_URL_AUTH: process.env.DATABASE_URL_AUTH! });

  /** The command's printed lines, each marked with its stream, and its exit code, for a run that sees `env` alone. */
  async function cli(args: string[], env: Record<string, string>) {
    const lines: string[] = [];
    const code = await runStaffCommand(args, env, { log: (line) => lines.push(`out ${line}`), error: (line) => lines.push(`err ${line}`) });
    return { code, lines, text: lines.join("\n") };
  }

  const head = async () => (await migrateDb.select().from(auditHead))[0]!;
  const enrolmentsOf = (userId: string) => migrateDb.select().from(staffEnrollments).where(eq(staffEnrollments.userId, userId));
  const issuedEvents = (userId: string) =>
    migrateDb.select().from(authEvents).where(and(eq(authEvents.userId, userId), eq(authEvents.type, "staff_enrollment_issued")));

  /** A staff account with a handle that its profile shows, as onboarding leaves it. */
  async function staffWithHandle(role: "moderator" | "admin" = "moderator") {
    const account = await newStaffAccount(authDb, repo, role);
    const handle = `s_${randomUUID().slice(0, 8)}`;
    await apiDb.insert(profiles).values({ id: account.user.id, handle, displayName: "Staff" });
    return { ...account, handle };
  }

  describe("enroll", () => {
    test("prints a one-time link for 30 minutes and writes the enrolment, its auth event and its audit row in one transaction", { timeout: 30_000 }, async () => {
      const { user } = await staffWithHandle();
      const before = await head();
      // The address as an operator might type it: the command normalises it.
      const run = await cli(["enroll", user.email.toUpperCase()], enrollEnv());
      expect(run.code, run.text).toBe(0);
      expect(run.lines.every((line) => line.startsWith("out "))).toBe(true);
      const token = LINK.exec(run.lines.map((line) => line.slice(4)).join("\n"))?.[1];
      expect(token, run.text).toBeDefined();
      expect(run.text).toContain(user.email);
      expect(run.text).toMatch(/30 minutes/);

      // Only the token's sha256 is kept, with the console's origin and relying party ID, unused, for 30 minutes.
      const [enrolment, ...others] = await enrolmentsOf(user.id);
      expect(others).toEqual([]);
      expect(enrolment).toMatchObject({ tokenHash: sha256Hex(token!), origin: TEST_CONSOLE_ORIGIN, rpId: TEST_CONSOLE_RP_ID, usedAt: null });
      expect(enrolment!.expiresAt.getTime() - enrolment!.createdAt.getTime()).toBe(30 * 60_000);

      const [event] = await issuedEvents(user.id);
      expect(event).toMatchObject({ type: "staff_enrollment_issued", metadata: { enrollmentId: enrolment!.id, via: "cli" } });
      const rows = await migrateDb.select().from(auditLog).where(and(eq(auditLog.action, "staff_enrollment_issued"), eq(auditLog.targetId, user.id)));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorId: SYSTEM_ACTOR_ID, targetType: "user", metadata: { enrollmentId: enrolment!.id, via: "cli" }, requestId: null });
      // The audit row was the transaction's last statement: it holds the head, which names it.
      expect(rows[0]!.chainSeq).toBe(before.seq + 1);
      expect(await head()).toMatchObject({ seq: rows[0]!.chainSeq, hash: rows[0]!.hash });
      const [xmins] = await migrateDb.execute<{ enrolment: string; event: string; audit: string }>(sql`select
        (select xmin::text from auth.staff_enrollments where id = ${enrolment!.id}) as enrolment,
        (select xmin::text from auth.auth_events where id = ${event!.id}) as event,
        (select xmin::text from public.audit_log where id = ${rows[0]!.id}) as audit`);
      expect(new Set([xmins!.enrolment, xmins!.event, xmins!.audit]).size).toBe(1);

      // The link enrols a key through the console's flows, with the origin and relying party ID it was issued for.
      const h = flowHarness(repo, { console: TEST_CONSOLE });
      const { key } = await enrolKey(h, new SoftAuthenticator(), token!);
      const [stored] = await migrateDb.select().from(staffKeys).where(eq(staffKeys.id, key.id));
      expect(stored).toMatchObject({ userId: user.id, origin: TEST_CONSOLE_ORIGIN, rpId: TEST_CONSOLE_RP_ID });
      // Nothing it wrote breaks the record.
      await rolledBack(apiDb, async (tx) => {
        const report = await checkAuditRecord(tx, [], authDb);
        expect(report.problems).toEqual([]);
      });
    });

    test("records CONSOLE_RP_ID when it is given, and the console's hostname when it is blank", async () => {
      const { user } = await staffWithHandle("admin");
      expect((await cli(["enroll", user.email], enrollEnv({ CONSOLE_RP_ID: "" }))).code).toBe(0);
      expect((await cli(["enroll", user.email], enrollEnv({ CONSOLE_RP_ID: "Console.Localhost" }))).code).toBe(0);
      const rows = await enrolmentsOf(user.id);
      expect(rows.map((row) => [row.origin, row.rpId])).toEqual([
        [TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID],
        [TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID],
      ]);
    });

    test("refuses an account that is unknown, deleted, not staff, without a handle or with 5 live keys, and writes nothing", { timeout: 30_000 }, async () => {
      const unknown = `nobody-${randomUUID()}@korbat.local`;
      const deleted = await staffWithHandle();
      await authDb.update(users).set({ deletedAt: new Date() }).where(eq(users.id, deleted.user.id));
      const plain = await staffWithHandle();
      await authDb.update(users).set({ role: "user" }).where(eq(users.id, plain.user.id));
      const unnamed = await staffWithHandle();
      await authDb.update(users).set({ onboardedAt: null }).where(eq(users.id, unnamed.user.id));
      const full = await staffWithHandle();
      for (let i = 0; i < 5; i++) await addStaffKey(authDb, (await issueEnrolment(migrateDb, full.user.id)).token);
      const fullEnrolments = (await enrolmentsOf(full.user.id)).length;

      const before = await head();
      const cases: [string, string, RegExp][] = [
        ["unknown", unknown, /no live account/],
        ["deleted", deleted.user.email, /no live account/],
        ["not staff", plain.user.email, /not staff/],
        ["without a handle", unnamed.user.email, /no handle/],
        ["five live keys", full.user.email, /5 live staff keys/],
      ];
      for (const [label, email, reason] of cases) {
        const run = await cli(["enroll", email], enrollEnv());
        expect([label, run.code]).toEqual([label, 1]);
        expect(run.text, label).toMatch(reason);
        expect(run.text, label).not.toMatch(/\/enroll\//);
      }
      for (const account of [deleted, plain, unnamed]) {
        expect(await enrolmentsOf(account.user.id)).toEqual([]);
        expect(await issuedEvents(account.user.id)).toEqual([]);
      }
      expect(await enrolmentsOf(full.user.id)).toHaveLength(fullEnrolments);
      expect(await head()).toEqual(before);
    });

    test("a revoked key does not count towards the five", async () => {
      const { user } = await staffWithHandle();
      const keys = [];
      for (let i = 0; i < 5; i++) keys.push(await addStaffKey(authDb, (await issueEnrolment(migrateDb, user.id)).token));
      await authDb.update(staffKeys).set({ revokedAt: new Date() }).where(eq(staffKeys.id, keys[0]!.id));
      const run = await cli(["enroll", user.email], enrollEnv());
      expect(run.code, run.text).toBe(0);
    });

    test("while CONSOLE_ORIGIN is unset it says so, answers 1 and writes nothing", async () => {
      const { user } = await staffWithHandle();
      const before = await head();
      for (const env of [{ DATABASE_URL_MIGRATE: process.env.DATABASE_URL_MIGRATE! }, enrollEnv({ CONSOLE_ORIGIN: " " })]) {
        const run = await cli(["enroll", user.email], env);
        expect(run.code).toBe(1);
        expect(run.text).toMatch(/^err .*CONSOLE_ORIGIN is not set/);
      }
      expect(await enrolmentsOf(user.id)).toEqual([]);
      expect(await head()).toEqual(before);
    });

    test("while an open transaction holds the account's row, it gives up after 10 seconds having written nothing, and says why", { timeout: 30_000 }, async () => {
      const { user } = await staffWithHandle();
      const before = await head();
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let holding!: () => void;
      const held = new Promise<void>((resolve) => (holding = resolve));
      // What a stalled or hostile API could do: a transaction that took the account's row and stays open.
      const stall = withLockTimeout(authDb, async (tx) => {
        await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("no key update");
        holding();
        await released;
      });
      try {
        await held;
        const started = Date.now();
        const run = await cli(["enroll", user.email], enrollEnv());
        expect(run.code).toBe(1);
        expect(run.text).toMatch(/enroll: an open transaction holds the audit head or the account's row.*stop the api service/s);
        expect(Date.now() - started).toBeGreaterThanOrEqual(9_000);
      } finally {
        release();
        await stall;
      }
      expect(await enrolmentsOf(user.id)).toEqual([]);
      expect(await head()).toEqual(before);
    });
  });

  describe("keys", () => {
    test("lists one account's keys with their ids, names, reported AAGUIDs, dates and state", { timeout: 30_000 }, async () => {
      const { user, handle } = await staffWithHandle();
      const live = await addStaffKey(authDb, (await issueEnrolment(migrateDb, user.id)).token, { name: "Blue key", aaguid: "ee882879-721c-4913-9775-3dfcce97072a" });
      // A key whose authenticator withheld its make reports the zero AAGUID.
      const withheld = await addStaffKey(authDb, (await issueEnrolment(migrateDb, user.id)).token, { name: "Red key", aaguid: "00000000-0000-0000-0000-000000000000" });
      const revokedAt = new Date("2026-10-01T09:30:00.000Z");
      await authDb.update(staffKeys).set({ revokedAt, suspectAt: revokedAt, lastUsedAt: revokedAt }).where(eq(staffKeys.id, withheld.id));
      const [liveRow] = await migrateDb.select().from(staffKeys).where(eq(staffKeys.id, live.id));

      const run = await cli(["keys", user.email], keysEnv());
      expect(run.code, run.text).toBe(0);
      expect(run.lines[0]).toBe(`out moderator ${user.email} @${handle} (account ${user.id})`);
      expect(run.text).toContain(`key ${live.id} "Blue key": AAGUID ee882879-721c-4913-9775-3dfcce97072a, created ${liveRow!.createdAt.toISOString()}, last used never, live`);
      expect(run.text).toContain(
        `key ${withheld.id} "Red key": AAGUID 00000000-0000-0000-0000-000000000000, created`,
      );
      expect(run.text).toContain(`last used ${revokedAt.toISOString()}, revoked ${revokedAt.toISOString()}, suspect ${revokedAt.toISOString()}`);
      // Never a public key or a credential id.
      expect(run.text).not.toContain(live.credentialId);
      expect(run.text).not.toContain("cose-key");
    });

    test("without an email lists every staff account with its role, address and handle, and no other account", { timeout: 30_000 }, async () => {
      const moderator = await staffWithHandle("moderator");
      const admin = await staffWithHandle("admin");
      await addStaffKey(authDb, (await issueEnrolment(migrateDb, admin.user.id)).token, { name: "Desk key" });
      const plain = await staffWithHandle();
      await authDb.update(users).set({ role: "user" }).where(eq(users.id, plain.user.id));
      const unnamed = await newStaffAccount(authDb, repo, "admin");

      const run = await cli(["keys"], keysEnv());
      expect(run.code, run.text).toBe(0);
      expect(run.lines).toContain(`out moderator ${moderator.user.email} @${moderator.handle} (account ${moderator.user.id})`);
      expect(run.lines).toContain(`out admin ${admin.user.email} @${admin.handle} (account ${admin.user.id})`);
      expect(run.lines).toContain(`out admin ${unnamed.user.email} (no handle) (account ${unnamed.user.id})`);
      expect(run.text).not.toContain(plain.user.email);
      // Each account's keys follow it; one without keys says so.
      const at = run.lines.indexOf(`out admin ${admin.user.email} @${admin.handle} (account ${admin.user.id})`);
      expect(run.lines[at + 1]).toMatch(/^out {3}key [0-9a-f-]{36} "Desk key": /);
      const bare = run.lines.indexOf(`out moderator ${moderator.user.email} @${moderator.handle} (account ${moderator.user.id})`);
      expect(run.lines[bare + 1]).toBe("out   no staff keys");
    });

    test("while an open transaction holds a table it reads, it gives up after 10 seconds and says why, on either role", { timeout: 60_000 }, async () => {
      // What an API under an attacker's control could do: its roles may lock any table they can update, and keys is the
      // runbook's own check against such an API, so it must never wait without limit.
      const { user } = await staffWithHandle();
      for (const [db, table] of [
        [authDb, sql`auth.users`],
        [apiDb, sql`public.profiles`],
      ] as const) {
        let release!: () => void;
        const released = new Promise<void>((resolve) => (release = resolve));
        let holding!: () => void;
        const held = new Promise<void>((resolve) => (holding = resolve));
        const stall = withLockTimeout(db, async (tx) => {
          await tx.execute(sql`lock table ${table} in access exclusive mode`);
          holding();
          await released;
        });
        try {
          await held;
          const started = Date.now();
          const run = await cli(["keys", user.email], keysEnv());
          expect(run.code, run.text).toBe(1);
          expect(run.text).toMatch(/keys: an open transaction holds .*stop the api service/s);
          expect(Date.now() - started).toBeGreaterThanOrEqual(9_000);
        } finally {
          release();
          await stall;
        }
      }
    });

    test("an unknown address is an error, and keys needs both roles' URLs and nothing else", async () => {
      const run = await cli(["keys", `nobody-${randomUUID()}@korbat.local`], keysEnv());
      expect(run.code).toBe(1);
      expect(run.text).toMatch(/^err keys: no live account for nobody-/);
      const missing = await cli(["keys"], { DATABASE_URL_API: process.env.DATABASE_URL_API! });
      expect(missing.code).toBe(1);
      expect(missing.text).toMatch(/DATABASE_URL_AUTH/);
    });
  });
});

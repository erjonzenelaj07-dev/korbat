# korbat staff console (3a) — Task 4 of 9: Staff sign-in and sessions: the sign-in flow with one staff_key_invalid answer, the counter rule's revocation, the uncached session store with the activity mark, requireStaff with the staff CSRF check, the staff cookies, the me, sessions, keys and audit routes, sign-out, staff.js revoke, the janitor's staff retention, and requireStaffMfa removed

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-30 and 2026-10-01 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Tasks 1 to 3 laid the ground, built the staff module with the audit record, and added staff keys with their enrolment. This task signs staff in: the sign-in flow, the counter rule, the uncached staff session store with its activity mark, `requireStaff`, the staff cookies, the console's read routes and sign-out, `staff.js revoke`, the janitor's staff retention, and the removal of `requireStaffMfa`. The design is `docs/superpowers/specs/2026-09-28-staff-console-3a-design.md` (sections 2, 6 and 7).

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(api,infra): staff keys and enrolment: staff.js enroll, run in the migrate service as the migrator, issues a 30-minute single-use link for a live staff account with a handle and records the console's origin and relying party ID on it; the console's enrolment options require user verification and offer a security key or this device, and verify refuses a key that reported no UV or BE after the library has checked it, keeping the link, then stores the key through auth.add_staff_key under the account's lock with its auth event and audit row in one transaction and mails its owner; staff routes answer staff_key_refused, never a passkey code; while the two relying party IDs are equal each kind's options exclude the other's credentials; staff.js keys lists keys with their AAGUID; a role change revokes every session and staff session and cancels open links, and a demotion revokes staff keys and mails their owner; the take-down revokes staff keys and sessions, blanks the keys' names and writes its record after account_deleted`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/staff-console-3a/write_blocks.py docs/superpowers/prompts/staff-console-3a/04-staff-sign-in-sessions.md 1
```

Expected: 14 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/auth/staff-cookies.test.ts`

```ts
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import { clearStaffCookies, setStaffCookies } from "../../src/auth";
import { STAFF_COOKIE_MAX_AGE_SECONDS, checkStaffCsrf, readStaffCookie } from "../../src/auth/staff/cookies";

const token = "S".repeat(43);

function app() {
  const a = new Hono();
  a.post("/set", (c) => {
    setStaffCookies(c, token);
    return c.text("ok");
  });
  a.post("/clear", (c) => {
    clearStaffCookies(c);
    return c.text("ok");
  });
  a.get("/read", (c) => c.text(readStaffCookie(c) ?? "none"));
  a.post("/csrf", (c) => c.text(checkStaffCsrf(c) ? "pass" : "fail"));
  return a;
}

/** The staff console's cookies (3a design, section 7, Every staff request), apart from the app's in name and attributes. */
describe("staff cookies", () => {
  test("both are __Host-, Secure, Path=/, SameSite=Strict, with no Domain and a Max-Age of 12 hours; the session's is HttpOnly and the CSRF cookie readable by the page", async () => {
    expect(STAFF_COOKIE_MAX_AGE_SECONDS).toBe(12 * 60 * 60);
    const cookies = (await app().request("/set", { method: "POST" })).headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    const session = cookies.find((c) => c.startsWith("__Host-korbat_staff="))!;
    const csrf = cookies.find((c) => c.startsWith("__Host-korbat_staff_csrf="))!;
    expect(session).toContain(`__Host-korbat_staff=${token};`);
    for (const line of [session, csrf]) {
      for (const attribute of ["Max-Age=43200", "Path=/", "Secure", "SameSite=Strict"]) expect(line).toContain(attribute);
      expect(line).not.toContain("Domain=");
    }
    expect(session).toContain("HttpOnly");
    expect(csrf).toMatch(/^__Host-korbat_staff_csrf=[A-Za-z0-9_-]{43};/);
    expect(csrf).not.toContain("HttpOnly");
    // A new CSRF value at every sign-in.
    const again = (await app().request("/set", { method: "POST" })).headers.getSetCookie().find((c) => c.startsWith("__Host-korbat_staff_csrf="))!;
    expect(again.split(";")[0]).not.toBe(csrf.split(";")[0]);
  });

  test("clearing expires both, with the attributes they were set with", async () => {
    const cookies = (await app().request("/clear", { method: "POST" })).headers.getSetCookie();
    expect(cookies.map((c) => c.slice(0, c.indexOf("="))).sort()).toEqual(["__Host-korbat_staff", "__Host-korbat_staff_csrf"]);
    for (const cookie of cookies) {
      for (const attribute of ["Max-Age=0", "Path=/", "Secure"]) expect(cookie).toContain(attribute);
    }
  });

  test("only the prefixed staff cookie is read; the app's session cookie is not a staff cookie", async () => {
    const read = async (cookie: string) => (await app().request("/read", { headers: { cookie } })).text();
    expect(await read(`__Host-korbat_staff=${token}`)).toBe(token);
    expect(await read(`korbat_staff=${token}`)).toBe("none");
    expect(await read(`__Host-korbat_session=${token}`)).toBe("none");
    expect(await read(`__Host-korbat_staff_csrf=${token}`)).toBe("none");
  });

  test("CSRF: the x-staff-csrf header must equal the staff CSRF cookie; the app's cookie and header do not count", async () => {
    const value = "c".repeat(43);
    const run = async (headers: Record<string, string>) => (await app().request("/csrf", { method: "POST", headers })).text();
    expect(await run({ cookie: `__Host-korbat_staff_csrf=${value}`, "x-staff-csrf": value })).toBe("pass");
    expect(await run({ cookie: `__Host-korbat_staff_csrf=${value}`, "x-staff-csrf": "d".repeat(43) })).toBe("fail");
    expect(await run({ cookie: `__Host-korbat_staff_csrf=${value}` })).toBe("fail");
    expect(await run({ "x-staff-csrf": value })).toBe("fail");
    expect(await run({ cookie: `__Host-korbat_csrf=${value}`, "x-csrf-token": value })).toBe("fail");
    expect(await run({ cookie: `__Host-korbat_csrf=${value}`, "x-staff-csrf": value })).toBe("fail");
  });
});
```

### Create `apps/api/test/integration/cli-staff-revoke.test.ts`

```ts
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
```

### Create `apps/api/test/integration/http-staff-sessions.test.ts`

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, gt } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  AuditPage,
  ErrorEnvelope,
  StaffKeysResponse,
  StaffMe,
  StaffSessionsResponse,
  StaffSignInOptionsResponse,
  StaffSignInVerifyResponse,
  type AuthenticationResponseJSON,
} from "@korbat/contracts";
import { auditHead, auditLog, authEvents, closeDb, createDb, profiles, staffKeys, staffSessions, users, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, revokeStaffKeys, type Auth } from "../../src/auth";
import { decodeKey, randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { challengeKey, issueChallenge } from "../../src/auth/passkeys/challenge";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { runGrantRole } from "../../src/cli/grant-role";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createStaff } from "../../src/staff";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { fakeClock } from "./auth-fixtures";
import { Browser, randomIp } from "./http-client";
import { DEVICE_BOUND, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount } from "./staff-fixtures";
import { enrolKey } from "./staff-enrolment";

const CONSOLE_HOST = new URL(TEST_CONSOLE_ORIGIN).host;
const STAFF_COOKIE = "__Host-korbat_staff";
const STAFF_CSRF_COOKIE = "__Host-korbat_staff_csrf";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
/** The mark the console sends on a request its person's action started (3a design, section 7). */
const MARKED = { "x-staff-activity": "1" };

/** The Set-Cookie lines of an answer, by cookie name. */
function setCookies(res: Response): Map<string, string> {
  return new Map(res.headers.getSetCookie().map((line) => [line.slice(0, line.indexOf("=")), line]));
}

const accessControlHeaders = (res: Response) => [...res.headers.keys()].filter((name) => name.startsWith("access-control-"));

/** A response's signature with its last byte changed. */
function badSignature(response: AuthenticationResponseJSON): AuthenticationResponseJSON {
  const signature = Buffer.from(response.response.signature, "base64url");
  signature[signature.length - 1] = signature[signature.length - 1]! ^ 0xff;
  return { ...response, response: { ...response.response, signature: signature.toString("base64url") } };
}

/**
 * Staff sessions over HTTP (3a design, sections 7 and 12): the console's own browser on http://console.localhost:8090 signs
 * in with a staff key, and every staff request after it passes the staff gate and requireStaff, which reads the session
 * from the database each time. The auth module runs on a clock the tests move, so the idle and absolute ends are reached
 * without waiting.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff sessions over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let auth: Auth;
  let app: ReturnType<typeof createApp>;
  const mailer = new MemoryMailer();
  const clock = fakeClock();

  beforeAll(() => {
    // The test environment with the console switched on at the staff harness's address.
    config = loadConfig({ ...process.env, CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, CONSOLE_RP_ID: "" });
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    auth = createAuth({ config, logger, authDb, kv: new MemoryKv(clock.ms), mailer, profiles: createProfileStore(apiDb), now: clock.now });
    const staff = createStaff({ apiDb, auth: auth.forStaff });
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth, staff });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  /** The console's page: its own host and origin, echoing the staff CSRF cookie in the staff CSRF header. */
  const consoleBrowser = () => new Browser(app, TEST_CONSOLE_ORIGIN, { base: TEST_CONSOLE_ORIGIN, csrfCookie: STAFF_CSRF_COOKIE, csrfHeader: "x-staff-csrf" });
  /** A request to the console's host with exactly these headers, for what the browser above never sends. */
  const raw = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
    app.request(`${TEST_CONSOLE_ORIGIN}${path}`, { method: init.method ?? "GET", headers: { host: CONSOLE_HOST, "cf-connecting-ip": randomIp(), ...init.headers } });
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const sessionRow = async (token: string) => (await migrateDb.select().from(staffSessions).where(eq(staffSessions.id, sha256Hex(token))))[0]!;
  const head = async () => (await migrateDb.select().from(auditHead))[0]!;

  /** The 401 that ends a staff session in the console: staff_session_required, with both staff cookies cleared. */
  async function expectEnded(res: Response, label: string) {
    expect(res.status, label).toBe(401);
    const cookies = setCookies(res);
    expect([...cookies.keys()].sort(), label).toEqual([STAFF_COOKIE, STAFF_CSRF_COOKIE]);
    for (const line of cookies.values()) {
      expect(line, label).toContain("Max-Age=0");
      expect(line, label).toContain("Path=/");
      expect(line, label).toContain("Secure");
    }
    expect((await error(res)).code, label).toBe("staff_session_required");
  }

  /**
   * A live staff account with a handle and one key enrolled through the flow, signed in from the console's browser with
   * Firefox's user agent. `signIn` signs in again, from any browser, with the next counter unless told one.
   */
  async function staffBrowser(role: "moderator" | "admin" = "moderator") {
    const { user, device } = await newStaffAccount(authDb, repo, role);
    const handle = `s_${randomUUID().slice(0, 8)}`;
    await apiDb.insert(profiles).values({ id: user.id, handle, displayName: "Staff" });
    const soft = new SoftAuthenticator();
    // The flows run on the moved clock: the link is valid 30 minutes from it, which is never earlier than the database's.
    const link = await issueEnrolment(migrateDb, user.id, { expiresAt: new Date(clock.ms() + 30 * MINUTE) });
    const enrolled = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, soft, link.token);
    let counter = 0;
    async function signIn(browser: Browser, options: { counter?: number; headers?: Record<string, string> } = {}) {
      const answer = await browser.fetch("/api/staff/signin/options", { method: "POST" });
      expect(answer.status, await answer.clone().text()).toBe(200);
      const { options: request } = StaffSignInOptionsResponse.parse(await answer.json());
      counter = options.counter ?? counter + 1;
      const response = soft.get({ credentialId: enrolled.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge: request.challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter });
      const res = await browser.fetch("/api/staff/signin/verify", { json: { response }, headers: options.headers });
      return { res, response };
    }
    const b = consoleBrowser();
    const first = await signIn(b, { headers: { "user-agent": FIREFOX_LINUX } });
    expect(first.res.status, await first.res.clone().text()).toBe(200);
    return { user, device, handle, soft, keyId: enrolled.key.id, credentialId: enrolled.credentialId, b, token: b.cookie(STAFF_COOKIE)!, signIn, first };
  }

  describe("signing in", () => {
    test("sets both staff cookies, __Host-, Secure, Path=/, SameSite=Strict and 12 hours long, the session's HttpOnly; answers /me's body with no CORS header and no-store", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const res = s.first.res;
      const cookies = setCookies(res);
      expect([...cookies.keys()].sort()).toEqual([STAFF_COOKIE, STAFF_CSRF_COOKIE]);
      const session = cookies.get(STAFF_COOKIE)!;
      const csrf = cookies.get(STAFF_CSRF_COOKIE)!;
      expect(session).toMatch(/^__Host-korbat_staff=[A-Za-z0-9_-]{43};/);
      expect(csrf).toMatch(/^__Host-korbat_staff_csrf=[A-Za-z0-9_-]{43};/);
      for (const line of [session, csrf]) {
        for (const attribute of ["Max-Age=43200", "Path=/", "Secure", "SameSite=Strict"]) expect(line).toContain(attribute);
        expect(line).not.toContain("Domain=");
      }
      expect(session).toContain("HttpOnly");
      expect(csrf).not.toContain("HttpOnly");
      // No app cookie is set on the console.
      expect(res.headers.getSetCookie().some((line) => line.startsWith("__Host-korbat_session=") || line.startsWith("__Host-korbat_csrf="))).toBe(false);
      expect(accessControlHeaders(res)).toEqual([]);
      expect(res.headers.get("cache-control")).toBe("no-store");

      const me = StaffSignInVerifyResponse.parse(await res.json());
      const row = await sessionRow(s.token);
      expect(me).toMatchObject({ handle: s.handle, role: "moderator", sessionHandle: row.handle, idleSecondsLeft: 900, absoluteSecondsLeft: 43_200 });
      // The coarse label of the browser that signed in, never its user agent, as the session list and the mail show it.
      expect(row.browser).toBe("Firefox on Linux");
      expect(mailer.sent.filter((m) => m.to === s.user.email).map((m) => [m.template, m.data.browser])).toEqual([
        ["staff_key_added", undefined],
        ["staff_session_started", "Firefox on Linux"],
      ]);
    });

    test("one answer before the signature: a spent challenge, one of another purpose, one with another binding and a bad signature are staff_key_invalid, never a passkey code, and a bad signature on a live key reads as an unknown key", { timeout: 60_000 }, async () => {
      const s = await staffBrowser();
      const b = consoleBrowser();
      const key = challengeKey(decodeKey(config.AUTH_HMAC_KEY));
      const fresh = async () => StaffSignInOptionsResponse.parse(await (await b.fetch("/api/staff/signin/options", { method: "POST" })).json()).options.challenge;
      const assert = (challenge: string, counter: number) =>
        s.soft.get({ credentialId: s.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter });
      const spentChallenge = JSON.parse(Buffer.from(s.first.response.response.clientDataJSON, "base64url").toString()).challenge as string;
      const stranger = new SoftAuthenticator();
      const unknown = stranger.create({ rpId: TEST_CONSOLE_RP_ID, challenge: randomBytes(58).toString("base64url"), origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND });

      const cases: [string, AuthenticationResponseJSON][] = [
        ["a spent challenge", assert(spentChallenge, 20)],
        ["the app's sign-in challenge", assert(issueChallenge(key, "signin", clock.now()), 21)],
        ["a staff registration challenge", assert(issueChallenge(key, "staff_register", clock.now(), randomUUID()), 22)],
        ["a staff sign-in challenge with a binding", assert(issueChallenge(key, "staff_signin", clock.now(), randomUUID()), 23)],
        ["a bad signature on a live key", badSignature(assert(await fresh(), 24))],
        ["an unknown key", stranger.get({ credentialId: unknown.id, rpId: TEST_CONSOLE_RP_ID, challenge: await fresh(), origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter: 1 })],
      ];
      const answers: Record<string, { status: number; code: string; message: string }> = {};
      for (const [label, response] of cases) {
        const res = await b.fetch("/api/staff/signin/verify", { json: { response } });
        const { code, message } = await error(res);
        answers[label] = { status: res.status, code, message };
        expect([label, res.status, code]).toEqual([label, 401, "staff_key_invalid"]);
        expect(code, label).not.toMatch(/^passkey_/);
        expect(res.headers.getSetCookie(), label).toEqual([]);
      }
      expect(answers["a bad signature on a live key"]).toEqual(answers["an unknown key"]);
      expect((await migrateDb.select().from(staffSessions).where(eq(staffSessions.userId, s.user.id))).length).toBe(1);
    });
  });

  describe("the person's own reads", () => {
    test("/me with the seconds left, /sessions with every live session and this one marked, /keys with the live keys and never a public key; no answer sets a cookie", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      // Another account's session is never listed, nor a key the account no longer holds.
      await staffBrowser();
      const red = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, s.soft, (await issueEnrolment(migrateDb, s.user.id, { expiresAt: new Date(clock.ms() + 30 * MINUTE) })).token, { name: "Red key" });
      const old = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, s.soft, (await issueEnrolment(migrateDb, s.user.id, { expiresAt: new Date(clock.ms() + 30 * MINUTE) })).token, { name: "Old key" });
      await authDb.update(staffKeys).set({ revokedAt: clock.now() }).where(eq(staffKeys.id, old.key.id));
      clock.advance(MINUTE);

      for (const headers of [{}, MARKED]) {
        const me = await s.b.fetch("/api/staff/me", { headers });
        expect(me.status).toBe(200);
        expect(me.headers.getSetCookie()).toEqual([]);
        const body = StaffMe.parse(await me.json());
        expect(body.sessionHandle).toBe((await sessionRow(s.token)).handle);
        expect(body.absoluteSecondsLeft).toBe(12 * 60 * 60 - 60);
      }

      const sessions = await s.b.fetch("/api/staff/sessions");
      expect(sessions.headers.getSetCookie()).toEqual([]);
      const listed = StaffSessionsResponse.parse(await sessions.json()).sessions;
      const mine = await sessionRow(s.token);
      const theirs = await sessionRow(other.cookie(STAFF_COOKIE)!);
      expect(listed.map((x) => [x.handle, x.current, x.browser]).sort()).toEqual(
        [
          [mine.handle, true, "Firefox on Linux"],
          [theirs.handle, false, "Browser on unknown OS"],
        ].sort(),
      );
      // The other browser sees the same two, with its own marked.
      const fromOther = StaffSessionsResponse.parse(await (await other.fetch("/api/staff/sessions")).json()).sessions;
      expect(fromOther.find((x) => x.current)!.handle).toBe(theirs.handle);

      const keys = await s.b.fetch("/api/staff/keys");
      const text = await keys.clone().text();
      expect(StaffKeysResponse.parse(await keys.json()).keys.map((k) => [k.id, k.name])).toEqual([
        [s.keyId, "Blue key"],
        [red.key.id, "Red key"],
      ]);
      // The key that signed in shows when it was last used; nothing of any key's credential leaves the server.
      const [blue] = await migrateDb.select().from(staffKeys).where(eq(staffKeys.id, s.keyId));
      expect(text).toContain(blue!.lastUsedAt!.toISOString());
      for (const secret of [blue!.publicKey, blue!.credentialId]) expect(text).not.toContain(secret);
    });
  });

  describe("the idle and absolute limits", () => {
    test("only marked requests count: unmarked reads neither slide the idle end nor move last_used_at, so the session ends 15 minutes after the last marked one", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const t0 = (await sessionRow(s.token)).createdAt.getTime();
      clock.advance(10 * MINUTE);
      const unmarked = await s.b.fetch("/api/staff/me");
      expect(StaffMe.parse(await unmarked.json()).idleSecondsLeft).toBe(5 * 60);
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0), idleExpiresAt: new Date(t0 + 15 * MINUTE) });

      clock.advance(4 * MINUTE);
      const marked = await s.b.fetch("/api/staff/me", { headers: MARKED });
      expect(StaffMe.parse(await marked.json()).idleSecondsLeft).toBe(15 * 60);
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 14 * MINUTE), idleExpiresAt: new Date(t0 + 29 * MINUTE) });

      // Any other value of the header marks nothing.
      clock.advance(MINUTE);
      expect((await s.b.fetch("/api/staff/sessions", { headers: { "x-staff-activity": "true" } })).status).toBe(200);
      clock.advance(13 * MINUTE);
      expect((await s.b.fetch("/api/staff/keys")).status).toBe(200);
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 14 * MINUTE), idleExpiresAt: new Date(t0 + 29 * MINUTE) });

      // At the idle end, the next request is refused and the cookies cleared; a marked one revives nothing.
      clock.advance(MINUTE);
      await expectEnded(await s.b.fetch("/api/staff/me"), "at the idle end");
      expect(s.b.cookie(STAFF_COOKIE)).toBeUndefined();
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}`, ...MARKED } }), "marked, after the idle end");
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 14 * MINUTE), idleExpiresAt: new Date(t0 + 29 * MINUTE), revokedAt: null });
    });

    test("a marked request slides the idle end, never past the absolute end, which ends the session after 12 hours whatever its person does", { timeout: 60_000 }, async () => {
      const s = await staffBrowser();
      const row = await sessionRow(s.token);
      const t0 = row.createdAt.getTime();
      expect(row.absoluteExpiresAt).toEqual(new Date(t0 + 12 * HOUR));
      // A marked request every 14 minutes for 11 hours and 54 minutes.
      for (let i = 0; i < 51; i++) {
        clock.advance(14 * MINUTE);
        expect((await s.b.fetch("/api/staff/me", { headers: MARKED })).status, `request ${i}`).toBe(200);
      }
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 714 * MINUTE), idleExpiresAt: new Date(t0 + 12 * HOUR) });
      const me = StaffMe.parse(await (await s.b.fetch("/api/staff/me", { headers: MARKED })).json());
      expect([me.idleSecondsLeft, me.absoluteSecondsLeft]).toEqual([6 * 60, 6 * 60]);
      expect(me.idleExpiresAt).toBe(me.absoluteExpiresAt);
      clock.advance(6 * MINUTE);
      await expectEnded(await s.b.fetch("/api/staff/me", { headers: MARKED }), "at the absolute end");
    });
  });

  describe("every way a session ends, refused at its next request", () => {
    type Ender = [string, (s: Awaited<ReturnType<typeof staffBrowser>>) => Promise<void>];
    const enders: Ender[] = [
      ["a revocation by the command line", async (s) => void (await revokeStaffKeys({ repo, mailer }, s.user.email, s.keyId))],
      ["a revocation of every key by the command line", async (s) => void (await revokeStaffKeys({ repo, mailer }, s.user.email, "all"))],
      [
        "a counter that went backwards in another browser",
        async (s) => {
          const { res } = await s.signIn(consoleBrowser(), { counter: 1 });
          expect((await error(res)).code).toBe("staff_key_suspended");
        },
      ],
      ["a demotion by grant-role", async (s) => void (await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, s.user.email, "user"))],
      ["a change from moderator to admin", async (s) => void (await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, s.user.email, "admin"))],
      ["the account's take-down", async (s) => void (await repo.takeDown(s.user.id, clock.now(), null))],
      // Changes that revoke nothing: the session is read with its key and its account at every request, so no tombstone is needed.
      ["its key revoked in the database alone", async (s) => void (await authDb.update(staffKeys).set({ revokedAt: clock.now() }).where(eq(staffKeys.id, s.keyId)))],
      ["the account's role set to user in the database alone", async (s) => void (await authDb.update(users).set({ role: "user" }).where(eq(users.id, s.user.id)))],
      ["the account marked deleted in the database alone", async (s) => void (await authDb.update(users).set({ deletedAt: clock.now() }).where(eq(users.id, s.user.id)))],
      ["the session revoked in the database", async (s) => void (await authDb.update(staffSessions).set({ revokedAt: clock.now() }).where(eq(staffSessions.id, sha256Hex(s.token))))],
    ];
    for (const [label, end] of enders) {
      test(label, { timeout: 30_000 }, async () => {
        const s = await staffBrowser();
        expect((await s.b.fetch("/api/staff/me")).status).toBe(200);
        await end(s);
        await expectEnded(await s.b.fetch("/api/staff/me", { headers: MARKED }), label);
        expect(s.b.cookie(STAFF_COOKIE)).toBeUndefined();
        expect(s.b.cookie(STAFF_CSRF_COOKIE)).toBeUndefined();
      });
    }

    test("signing out: 204, both cookies cleared, the session revoked with staff_signed_out and its audit row, and no mail", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const row = await sessionRow(s.token);
      const sent = mailer.sent.length;
      const before = await head();
      clock.advance(MINUTE);
      const res = await s.b.fetch("/api/staff/signout", { method: "POST" });
      expect(res.status).toBe(204);
      const cookies = setCookies(res);
      expect([...cookies.keys()].sort()).toEqual([STAFF_COOKIE, STAFF_CSRF_COOKIE]);
      for (const line of cookies.values()) expect(line).toContain("Max-Age=0");
      expect((await sessionRow(s.token)).revokedAt).toEqual(clock.now());

      const [event] = await migrateDb
        .select({ metadata: authEvents.metadata })
        .from(authEvents)
        .where(and(eq(authEvents.userId, s.user.id), eq(authEvents.type, "staff_signed_out")));
      expect(event!.metadata).toEqual({ handle: row.handle });
      const written = await migrateDb.select().from(auditLog).where(gt(auditLog.chainSeq, before.seq)).orderBy(asc(auditLog.chainSeq));
      expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.staffSession, r.keyId, r.requestId, r.metadata])).toEqual([
        ["staff_signed_out", s.user.id, "staff_session", row.handle, row.handle, s.keyId, res.headers.get("x-request-id"), {}],
      ]);
      expect(mailer.sent.length).toBe(sent);
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}` } }), "after signing out");
      // Signing out again is a session that has ended.
      await expectEnded(await raw("/api/staff/signout", { method: "POST", headers: { origin: TEST_CONSOLE_ORIGIN, cookie: `${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=x`, "x-staff-csrf": "x" } }), "signing out twice");
    });
  });

  describe("what opens a staff route", () => {
    test("the staff cookie only: the app's session cookie and a bearer token are refused, a staff cookie opens no app route, and a session created after now is refused", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const app_ = await auth.deps.sessions.issue(s.user.id, s.device.id, { factors: { email: clock.ms() } });
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `__Host-korbat_session=${app_.token}` } }), "the app's session cookie");
      await expectEnded(await raw("/api/staff/me", { headers: { authorization: `Bearer ${app_.token}` } }), "a bearer token");
      await expectEnded(await raw("/api/staff/me", { headers: { authorization: `Bearer ${s.token}` } }), "the staff token as a bearer token");
      // The staff cookie under the app's name, and on the app's host, opens nothing there.
      const onApp = await app.request("/api/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}`, "cf-connecting-ip": randomIp() } });
      expect(onApp.status).toBe(401);
      expect((await error(onApp)).code).toBe("unauthenticated");
      const asApp = await app.request("/api/me", { headers: { cookie: `__Host-korbat_session=${s.token}`, "cf-connecting-ip": randomIp() } });
      expect(asApp.status).toBe(401);

      // A row written behind the flows' back that starts in the future, within the database's 12 hours.
      const token = randomToken();
      const start = new Date(clock.ms() + HOUR);
      await authDb.insert(staffSessions).values({
        id: sha256Hex(token),
        userId: s.user.id,
        keyId: s.keyId,
        createdAt: start,
        lastUsedAt: start,
        idleExpiresAt: new Date(start.getTime() + 15 * MINUTE),
        absoluteExpiresAt: new Date(start.getTime() + 12 * HOUR),
        browser: "Firefox on Linux",
      });
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${token}` } }), "a session created after now");
    });

    test("CSRF: a write needs x-staff-csrf equal to the staff CSRF cookie; the app's CSRF cookie and header do not count, and a refused write touches nothing", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const csrf = s.b.cookie(STAFF_CSRF_COOKIE)!;
      const before = await sessionRow(s.token);
      clock.advance(MINUTE);
      const post = (headers: Record<string, string>) => raw("/api/staff/signout", { method: "POST", headers: { origin: TEST_CONSOLE_ORIGIN, ...MARKED, ...headers } });
      const cases: [string, Record<string, string>][] = [
        ["no header", { cookie: `${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=${csrf}` }],
        ["another value", { cookie: `${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=${csrf}`, "x-staff-csrf": `${csrf.slice(1)}A` }],
        ["the header without its cookie", { cookie: `${STAFF_COOKIE}=${s.token}`, "x-staff-csrf": csrf }],
        ["the app's CSRF cookie and header", { cookie: `${STAFF_COOKIE}=${s.token}; __Host-korbat_csrf=${csrf}`, "x-csrf-token": csrf }],
      ];
      for (const [label, headers] of cases) {
        const res = await post(headers);
        expect([label, res.status, (await error(res)).code]).toEqual([label, 403, "csrf_failed"]);
        expect(res.headers.getSetCookie(), label).toEqual([]);
      }
      expect((await s.b.fetch("/api/staff/signout", { method: "POST", csrf: false })).status).toBe(403);
      expect(await sessionRow(s.token)).toEqual(before);
      expect((await s.b.fetch("/api/staff/signout", { method: "POST" })).status).toBe(204);
    });
  });

  describe("the staff gate over HTTP", () => {
    test("a console POST sent with the app's session and CSRF cookies present reaches its route and is not csrf_failed", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const app_ = await auth.deps.sessions.issue(s.user.id, s.device.id, { factors: { email: clock.ms() } });
      const csrf = s.b.cookie(STAFF_CSRF_COOKIE)!;
      const res = await raw("/api/staff/signout", {
        method: "POST",
        headers: {
          origin: TEST_CONSOLE_ORIGIN,
          "sec-fetch-site": "same-origin",
          cookie: `__Host-korbat_session=${app_.token}; __Host-korbat_csrf=app-csrf; ${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=${csrf}`,
          "x-csrf-token": "app-csrf",
          "x-staff-csrf": csrf,
        },
      });
      expect(res.status, await res.clone().text()).toBe(204);
      expect((await sessionRow(s.token)).revokedAt).not.toBeNull();
      // The app's session was neither read nor ended.
      expect(await repo.findActiveSession(app_.session.sessionId, clock.now())).toBeDefined();
    });

    test("no answer under /api/staff/ carries an Access-Control-* header, even to an Origin the app trusts", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const trusted = config.TRUSTED_ORIGINS[0]!;
      const cookie = `${STAFF_COOKIE}=${s.token}`;
      for (const [label, path, init] of [
        ["a read with the trusted Origin", "/api/staff/me", { headers: { cookie, origin: trusted } }],
        ["a preflight from the trusted Origin", "/api/staff/signout", { method: "OPTIONS", headers: { origin: trusted, "access-control-request-method": "POST" } }],
        ["a read of the audit log", "/api/staff/audit", { headers: { cookie } }],
        ["a read with the console's Origin", "/api/staff/sessions", { headers: { cookie, origin: TEST_CONSOLE_ORIGIN } }],
        ["the sign-in options", "/api/staff/signin/options", { method: "POST", headers: { origin: trusted } }],
      ] as const) {
        const res = await raw(path, init);
        expect(accessControlHeaders(res), label).toEqual([]);
      }
      expect(accessControlHeaders(s.first.res)).toEqual([]);
    });

    test("Sec-Fetch-Site other than same-origin, or another Origin, is refused and leaves the idle end and the last use unchanged; another Host is the unknown route", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const before = await sessionRow(s.token);
      clock.advance(5 * MINUTE);
      const cookie = `${STAFF_COOKIE}=${s.token}`;
      for (const [label, headers] of [
        ["same-site", { "sec-fetch-site": "same-site" }],
        ["cross-site", { "sec-fetch-site": "cross-site" }],
        ["the app's Origin", { origin: "http://localhost:8081" }],
        ["another localhost port", { origin: "http://localhost:8090" }],
      ] as const) {
        const res = await raw("/api/staff/me", { headers: { cookie, ...MARKED, ...headers } });
        expect([label, res.status, (await error(res)).code]).toEqual([label, 403, "csrf_failed"]);
        expect(res.headers.getSetCookie(), label).toEqual([]);
      }
      expect(await sessionRow(s.token)).toEqual(before);
      // Another Host, the console's cookie and mark notwithstanding: the 404 of an unknown route, the session untouched.
      for (const host of ["localhost:8080", "console.localhost", "localhost:8090"]) {
        const res = await app.request(`http://${host}/api/staff/me`, { headers: { host, cookie, ...MARKED, "cf-connecting-ip": randomIp() } });
        expect([host, res.status, (await error(res)).code]).toEqual([host, 404, "not_found"]);
      }
      expect(await sessionRow(s.token)).toEqual(before);
    });
  });

  describe("the audit log", () => {
    test("newest first by place, the sign-in's row naming its actor by handle; the staff_sign_in filter, cursor pages and ?at=; reading writes nothing", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const [signInRow] = await migrateDb
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "staff_sign_in"), eq(auditLog.actorId, s.user.id)));
      const before = await head();

      const page = AuditPage.parse(await (await s.b.fetch("/api/staff/audit")).json());
      expect(page.entries[0]!.seq).toBe(before.seq);
      expect(page.entries.map((e) => e.seq)).toEqual([...page.entries.map((e) => e.seq)].sort((a, b) => b - a));
      const mine = page.entries.find((e) => e.seq === signInRow!.chainSeq)!;
      expect(mine).toEqual({
        seq: signInRow!.chainSeq,
        hash: signInRow!.hash,
        createdAt: signInRow!.createdAt.toISOString(),
        actorHandle: s.handle,
        action: "staff_sign_in",
        targetType: "staff_session",
        targetId: signInRow!.targetId,
        actionHash: null,
      });

      const signIns = AuditPage.parse(await (await s.b.fetch("/api/staff/audit?action=staff_sign_in")).json());
      expect(signIns.entries.every((e) => e.action === "staff_sign_in")).toBe(true);
      expect(signIns.entries[0]!.seq).toBe(signInRow!.chainSeq);

      const at = AuditPage.parse(await (await s.b.fetch(`/api/staff/audit?at=${signInRow!.chainSeq}`)).json());
      expect(at.entries[0]!.seq).toBe(signInRow!.chainSeq);
      const older = AuditPage.parse(await (await s.b.fetch(`/api/staff/audit?cursor=${signInRow!.chainSeq}`)).json());
      expect(older.entries.every((e) => e.seq < signInRow!.chainSeq)).toBe(true);

      for (const query of ["?at=0", "?cursor=2&at=2", "?action=role_granted", "?cursor=abc"]) {
        const res = await s.b.fetch(`/api/staff/audit${query}`);
        expect([query, res.status, (await error(res)).code]).toEqual([query, 400, "invalid_request"]);
      }
      expect(await head()).toEqual(before);
      await expectEnded(await raw("/api/staff/audit"), "without a session");
    });
  });
});
```

### Create `apps/api/test/integration/staff-sign-in.ts`

```ts
import { randomUUID } from "node:crypto";
import type { AuthenticationResponseJSON } from "@korbat/contracts";
import { signInOptions, signInVerify } from "../../src/auth/staff/signin";
import type { SoftAuthenticator, SoftFlags } from "../auth/soft-authenticator";
import { DEVICE_BOUND } from "./staff-fixtures";
import type { StaffFlowHarness } from "./staff-enrolment";

// The staff sign-in through the auth module's flows, for the suites that sign in without HTTP; kept apart from
// staff-enrolment.ts, which the enrolment suites share.

export interface AssertOptions {
  flags?: SoftFlags;
  /** The signature counter the authenticator reports; 1 unless given, past the 0 a new key starts at. */
  counter?: number;
  /** As SoftGetInput's: absent, the handle given at creation; null, none; otherwise these bytes. */
  userHandle?: Uint8Array | null;
  /** The origin and relying party ID the browser signs for; the harness's console unless given. */
  origin?: string;
  rpId?: string;
  /** A challenge of the test's own, in place of fresh sign-in options. */
  challenge?: string;
}

/** The software authenticator's answer to fresh staff sign-in options, as the console's page gets it. */
export async function staffAssertion(h: StaffFlowHarness, auth: SoftAuthenticator, credentialId: string, options: AssertOptions = {}): Promise<AuthenticationResponseJSON> {
  const challenge = options.challenge ?? (await signInOptions(h.deps)).options.challenge;
  return auth.get({
    credentialId,
    rpId: options.rpId ?? h.deps.config.console!.rpId,
    challenge,
    origin: options.origin ?? h.deps.config.console!.origin,
    flags: options.flags ?? DEVICE_BOUND,
    counter: options.counter ?? 1,
    userHandle: options.userHandle,
  });
}

/** A whole staff sign-in: the options, the authenticator's answer and the verification, from the harness's address unless told another. */
export async function signInKey(h: StaffFlowHarness, auth: SoftAuthenticator, credentialId: string, options: AssertOptions & { ipHash?: string } = {}) {
  const response = await staffAssertion(h, auth, credentialId, options);
  const requestId = `req-${randomUUID()}`;
  const signedIn = await signInVerify(h.deps, { response }, { ...h.ctx, ...(options.ipHash ? { ipHash: options.ipHash } : {}), requestId });
  return { ...signedIn, requestId, response };
}
```

### Create `apps/api/test/integration/staff-signin.test.ts`

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { StaffMe, type AuthenticationResponseJSON } from "@korbat/contracts";
import { auditHead, auditLog, authEvents, closeDb, createDb, passkeys, staffKeys, staffSessions, users, type Db } from "@korbat/db";
import { AuthError } from "../../src/auth/context";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { challengeKey, issueChallenge, readChallenge } from "../../src/auth/passkeys/challenge";
import { registerOptions, registerVerify, signInOptions as passkeySignInOptions, signInVerify as passkeySignInVerify } from "../../src/auth/passkeys/flows";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { STAFF_ABSOLUTE_MS, STAFF_IDLE_MS } from "../../src/auth/staff/sessions";
import { STAFF_SIGNIN_PER_IP_PER_HOUR, STAFF_SIGNIN_PER_KEY_PER_HOUR, signInOptions, signInVerify } from "../../src/auth/staff/signin";
import { loadConfig } from "../../src/config";
import { SoftAuthenticator, type SoftFlags } from "../auth/soft-authenticator";
import { flowHarness, onboardedUser, type FlowHarness } from "./flow-harness";
import { DEVICE_BOUND, TEST_CONSOLE, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount } from "./staff-fixtures";
import { enrolKey } from "./staff-enrolment";
import { signInKey, staffAssertion } from "./staff-sign-in";

const APP_ORIGIN = "http://localhost:8081";
const NO_UV: SoftFlags = { up: true, uv: false, be: false, bs: false };
const SYNCABLE: SoftFlags = { up: true, uv: true, be: true, bs: false };
const SYNCED: SoftFlags = { up: true, uv: true, be: true, bs: true };
/** BS without BE: no authenticator may report it (WebAuthn L3, section 6.1.3), and the library refuses it with the signature. */
const BACKED_UP_ONLY: SoftFlags = { up: true, uv: true, be: false, bs: true };
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

/** A response's signature with its last byte changed: the library's check fails, and nothing else about it does. */
function badSignature(response: AuthenticationResponseJSON): AuthenticationResponseJSON {
  const signature = Buffer.from(response.response.signature, "base64url");
  signature[signature.length - 1] = signature[signature.length - 1]! ^ 0xff;
  return { ...response, response: { ...response.response, signature: signature.toString("base64url") } };
}

/**
 * The staff sign-in through the auth module's flows on the real database (3a design, section 7, Sign-in and A counter that
 * goes backwards): the console at http://console.localhost:8090 with the relying party console.localhost beside the app at
 * http://localhost:8081, the software authenticator, and keys enrolled through the enrolment flow.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff sign-in", () => {
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    authDb = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    // The migrate role reads every row back; the test environment carries its URL.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 4 });
    repo = createAuthRepo(authDb);
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(migrateDb)]);
  });

  const harness = () => flowHarness(repo, { console: TEST_CONSOLE });
  const head = async () => (await migrateDb.select().from(auditHead))[0]!;
  const keyRow = async (id: string) => (await migrateDb.select().from(staffKeys).where(eq(staffKeys.id, id)))[0]!;
  const sessionsOf = (userId: string) => migrateDb.select().from(staffSessions).where(eq(staffSessions.userId, userId)).orderBy(asc(staffSessions.createdAt));
  const staffEvents = (userId: string) =>
    migrateDb
      .select({ type: authEvents.type, metadata: authEvents.metadata, ipHash: authEvents.ipHash })
      .from(authEvents)
      .where(and(eq(authEvents.userId, userId), sql`${authEvents.type}::text in ('staff_sign_in', 'staff_key_counter_regression', 'staff_key_revoked')`))
      .orderBy(asc(authEvents.id));
  const rowsAfter = (seq: number) => migrateDb.select().from(auditLog).where(gt(auditLog.chainSeq, seq)).orderBy(asc(auditLog.chainSeq));

  /** A live staff account with a handle (in the harness's profiles) holding one key enrolled through the flow. */
  async function staffWithKey(h: FlowHarness, name = "Blue key") {
    const { user } = await newStaffAccount(authDb, repo);
    const handle = `s_${randomUUID().slice(0, 8)}`;
    await h.deps.profiles.create({ id: user.id, handle, displayName: "Staff" });
    const auth = new SoftAuthenticator();
    const enrolled = await enrolKey(h, auth, (await issueEnrolment(migrateDb, user.id)).token, { name });
    return { user, handle, auth, keyId: enrolled.key.id, credentialId: enrolled.credentialId };
  }

  describe("a sign-in with a live staff key", () => {
    test("the options ask for a discoverable, user-verified credential of the console's relying party with a staff sign-in challenge", async () => {
      const h = harness();
      const { options } = await signInOptions(h.deps);
      expect(options.rpId).toBe(TEST_CONSOLE_RP_ID);
      expect(options.allowCredentials ?? []).toEqual([]);
      expect(options.userVerification).toBe("required");
      expect(options.timeout).toBe(5 * MINUTE);
      const key = challengeKey(h.deps.config.authHmacKey);
      expect(() => readChallenge(key, options.challenge, "staff_signin", h.clock.now())).not.toThrow();
      // Only a staff sign-in: the app's sign-in, and every other purpose, refuse it.
      expect(() => readChallenge(key, options.challenge, "signin", h.clock.now())).toThrow();
      expect(() => readChallenge(key, options.challenge, "staff_register", h.clock.now())).toThrow();
    });

    test("opens a session with its browser label, records the key's use, writes staff_sign_in and its audit row last in the session's transaction, and mails the owner after the commit", { timeout: 30_000 }, async () => {
      const h = harness();
      const { user, handle, auth, keyId, credentialId } = await staffWithKey(h);
      h.mailer.sent.length = 0;
      const before = await head();
      const now = h.clock.now();
      const { token, me, requestId } = await signInKey(h, auth, credentialId, { counter: 7 });

      // The answer is /me's: the handle, the role, the session's handle and both ends with the seconds left.
      const [session] = await sessionsOf(user.id);
      expect(StaffMe.parse(me)).toEqual({
        handle,
        role: "moderator",
        sessionHandle: session!.handle,
        idleExpiresAt: new Date(now.getTime() + STAFF_IDLE_MS).toISOString(),
        idleSecondsLeft: 15 * 60,
        absoluteExpiresAt: new Date(now.getTime() + STAFF_ABSOLUTE_MS).toISOString(),
        absoluteSecondsLeft: 12 * 60 * 60,
      });
      // The token is the cookie's value; only its sha256 is stored. The label is deviceLabel's, never the user agent.
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(session).toMatchObject({
        id: sha256Hex(token),
        userId: user.id,
        keyId,
        createdAt: now,
        lastUsedAt: now,
        idleExpiresAt: new Date(now.getTime() + 15 * MINUTE),
        absoluteExpiresAt: new Date(now.getTime() + 12 * HOUR),
        revokedAt: null,
        browser: "Chrome on Windows",
      });
      expect(await keyRow(keyId)).toMatchObject({ counter: 7, lastUsedAt: now, revokedAt: null, suspectAt: null });

      // The event names the key and the session; the audit row the account, the session and the key, with the request's id.
      expect(await staffEvents(user.id)).toEqual([{ type: "staff_sign_in", metadata: { keyId, handle: session!.handle }, ipHash: h.ctx.ipHash }]);
      const written = await rowsAfter(before.seq);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        actorId: user.id,
        action: "staff_sign_in",
        targetType: "staff_session",
        targetId: session!.handle,
        staffSession: session!.handle,
        keyId,
        actionHash: null,
        stepUp: null,
        requestId,
        metadata: {},
      });
      // One transaction: the key's use, the session, the event and the audit row carry one transaction id, the audit row
      // written by its last statement.
      const [rows] = await migrateDb.execute<{ key: string; session: string; event: string; audit: string; keyCmin: string; sessionCmin: string; eventCmin: string; auditCmin: string }>(sql`select
        (select xmin::text from auth.staff_keys where id = ${keyId}) as key,
        (select xmin::text from auth.staff_sessions where user_id = ${user.id}) as session,
        (select xmin::text from auth.auth_events where user_id = ${user.id} and type = 'staff_sign_in') as event,
        (select xmin::text from public.audit_log where id = ${written[0]!.id}) as audit,
        (select cmin::text from auth.staff_keys where id = ${keyId}) as "keyCmin",
        (select cmin::text from auth.staff_sessions where user_id = ${user.id}) as "sessionCmin",
        (select cmin::text from auth.auth_events where user_id = ${user.id} and type = 'staff_sign_in') as "eventCmin",
        (select cmin::text from public.audit_log where id = ${written[0]!.id}) as "auditCmin"`);
      expect(new Set([rows!.key, rows!.session, rows!.event, rows!.audit]).size).toBe(1);
      expect(Number(rows!.auditCmin)).toBeGreaterThan(Math.max(Number(rows!.keyCmin), Number(rows!.sessionCmin), Number(rows!.eventCmin)));

      // The owner learns of every staff session: the key's name, the browser label and the time; no link.
      expect(h.mailer.sent).toEqual([{ to: user.email, template: "staff_session_started", data: { name: "Blue key", browser: "Chrome on Windows", time: mailTime(now) } }]);
    });

    test("each sign-in is a session of its own, with the label of the browser it came from", { timeout: 30_000 }, async () => {
      const h = harness();
      const { user, auth, credentialId } = await staffWithKey(h);
      await signInKey(h, auth, credentialId, { counter: 1 });
      h.ctx.userAgent = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
      await signInKey(h, auth, credentialId, { counter: 2 });
      h.ctx.userAgent = undefined;
      await signInKey(h, auth, credentialId, { counter: 3 });
      expect((await sessionsOf(user.id)).map((s) => s.browser)).toEqual(["Chrome on Windows", "Firefox on Linux", "Browser on unknown OS"]);
    });

    test("an authenticator that always reports a zero counter signs in again and again", { timeout: 30_000 }, async () => {
      const h = harness();
      const { user, auth, credentialId } = await staffWithKey(h);
      await signInKey(h, auth, credentialId, { counter: 0 });
      await signInKey(h, auth, credentialId, { counter: 0 });
      expect(await sessionsOf(user.id)).toHaveLength(2);
    });
  });

  describe("one answer before the signature", () => {
    test("an unknown key, a revoked key, a demoted or deleted account, and a missing or wrong user handle are all staff_key_invalid, with one message, and write nothing", { timeout: 60_000 }, async () => {
      const h = harness();
      const answers: [string, AuthError][] = [];
      const attempt = async (label: string, run: Promise<unknown>) => answers.push([label, await failure(run)]);

      // A credential the authenticator holds but korbat never stored.
      const stranger = new SoftAuthenticator();
      const unknown = stranger.create({ rpId: TEST_CONSOLE_RP_ID, challenge: randomBytes(58).toString("base64url"), origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND });
      await attempt("an unknown key", signInKey(h, stranger, unknown.id));

      const revoked = await staffWithKey(h);
      await authDb.update(staffKeys).set({ revokedAt: new Date() }).where(eq(staffKeys.id, revoked.keyId));
      await attempt("a revoked key", signInKey(h, revoked.auth, revoked.credentialId));

      const demoted = await staffWithKey(h);
      await authDb.update(users).set({ role: "user" }).where(eq(users.id, demoted.user.id));
      await attempt("a demoted account", signInKey(h, demoted.auth, demoted.credentialId));

      const deleted = await staffWithKey(h);
      await authDb.update(users).set({ deletedAt: new Date() }).where(eq(users.id, deleted.user.id));
      await attempt("a deleted account", signInKey(h, deleted.auth, deleted.credentialId));

      const live = await staffWithKey(h);
      await attempt("no user handle", signInKey(h, live.auth, live.credentialId, { userHandle: null }));
      await attempt("a random user handle", signInKey(h, live.auth, live.credentialId, { userHandle: randomBytes(32) }));
      const other = await staffWithKey(h);
      const otherHandle = (await repo.findUserById(other.user.id))!.webauthnUserId!;
      await attempt("another account's user handle", signInKey(h, live.auth, live.credentialId, { userHandle: otherHandle }));

      for (const [label, err] of answers) {
        expect([label, err.code, err.status, err.message]).toEqual([label, "staff_key_invalid", 401, answers[0]![1].message]);
      }
      for (const account of [revoked, demoted, deleted, live]) {
        expect(await sessionsOf(account.user.id)).toEqual([]);
        expect((await keyRow(account.keyId)).counter).toBe(0);
        expect((await keyRow(account.keyId)).lastUsedAt).toBeNull();
      }
      // The live key still opens the console with its own handle.
      expect((await signInKey(h, live.auth, live.credentialId)).me.handle).toBe(live.handle);
    });

    test("whatever the codec or the library refuses is staff_key_invalid, never a passkey code; an expired challenge is challenge_expired", { timeout: 60_000 }, async () => {
      const h = harness();
      const { user, keyId, auth, credentialId } = await staffWithKey(h);
      const key = challengeKey(h.deps.config.authHmacKey);
      const verify = (response: AuthenticationResponseJSON) => failure(signInVerify(h.deps, { response }, { ...h.ctx, requestId: `req-${randomUUID()}` }));
      const assert = (options: Parameters<typeof staffAssertion>[3] = {}) => staffAssertion(h, auth, credentialId, options);

      const used = await signInKey(h, auth, credentialId, { counter: 1 });
      const cases: [string, AuthenticationResponseJSON][] = [
        ["a spent challenge", auth.get({ credentialId, rpId: TEST_CONSOLE_RP_ID, challenge: JSON.parse(Buffer.from(used.response.response.clientDataJSON, "base64url").toString()).challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter: 2 })],
        ["the app's sign-in challenge", await assert({ challenge: issueChallenge(key, "signin", h.clock.now()), counter: 3 })],
        ["a staff registration challenge", await assert({ challenge: issueChallenge(key, "staff_register", h.clock.now(), randomUUID()), counter: 4 })],
        ["a staff sign-in challenge bound to something", await assert({ challenge: issueChallenge(key, "staff_signin", h.clock.now(), randomUUID()), counter: 5 })],
        ["a forged challenge", await assert({ challenge: randomBytes(58).toString("base64url"), counter: 6 })],
        ["not a challenge at all", await assert({ challenge: "x", counter: 7 })],
        ["the app's relying party", await assert({ rpId: "localhost", counter: 8 })],
        ["the app's origin", await assert({ origin: APP_ORIGIN, counter: 9 })],
        ["a bad signature", badSignature(await assert({ counter: 10 }))],
        ["a bad signature that also reports no UV", badSignature(await assert({ counter: 11, flags: NO_UV }))],
      ];
      for (const [label, response] of cases) {
        const err = await verify(response);
        expect([label, err.code, err.status]).toEqual([label, "staff_key_invalid", 401]);
        expect(err.code, label).not.toMatch(/^passkey_/);
      }
      // None of them touched the key or opened a session; the key's counter is the one good sign-in's.
      expect((await keyRow(keyId)).counter).toBe(1);
      expect(await sessionsOf(user.id)).toHaveLength(1);

      // An expired challenge is the shared code the console answers by starting over.
      const late = await assert({ counter: 12 });
      h.clock.advance(10 * MINUTE);
      expect((await verify(late)).code).toBe("challenge_expired");
      expect((await signInKey(h, auth, credentialId, { counter: 13 })).me.role).toBe("moderator");
    });
  });

  describe("user verification and device binding, after the signature", () => {
    test("an assertion without UV is staff_key_not_user_verified, one reporting BE, backed up or not, staff_key_not_device_bound; none moves the counter or opens a session", { timeout: 30_000 }, async () => {
      const h = harness();
      const { user, keyId, auth, credentialId } = await staffWithKey(h);
      const before = await head();
      const cases: [SoftFlags, string, number][] = [
        [NO_UV, "staff_key_not_user_verified", 403],
        [SYNCABLE, "staff_key_not_device_bound", 403],
        [SYNCED, "staff_key_not_device_bound", 403],
        [BACKED_UP_ONLY, "staff_key_invalid", 401],
      ];
      for (const [flags, code, status] of cases) {
        const err = await failure(signInKey(h, auth, credentialId, { flags, counter: 5 }));
        expect([JSON.stringify(flags), err.code, err.status]).toEqual([JSON.stringify(flags), code, status]);
      }
      expect(await keyRow(keyId)).toMatchObject({ counter: 0, lastUsedAt: null, revokedAt: null });
      expect(await sessionsOf(user.id)).toEqual([]);
      expect(await head()).toEqual(before);
      // The counter the refused assertions reported is still ahead of the stored one.
      await signInKey(h, auth, credentialId, { counter: 5 });
    });
  });

  describe("a counter that goes backwards", () => {
    test("revokes the key and marks it suspect, revokes every live staff session it opened, records it last in one transaction, mails staff_key_suspect and answers staff_key_suspended", { timeout: 60_000 }, async () => {
      const h = harness();
      const { user, keyId, auth, credentialId } = await staffWithKey(h);
      const red = await enrolKey(h, auth, (await issueEnrolment(migrateDb, user.id)).token, { name: "Red key" });
      const first = await signInKey(h, auth, credentialId, { counter: 5 });
      const second = await signInKey(h, auth, credentialId, { counter: 6 });
      const onRed = await signInKey(h, auth, red.credentialId, { counter: 1 });
      // A session the key opened that has already ended stays as it was.
      const ended = new Date(h.clock.ms() - MINUTE);
      await authDb.update(staffSessions).set({ revokedAt: ended }).where(eq(staffSessions.id, sha256Hex(first.token)));
      const third = await signInKey(h, auth, credentialId, { counter: 7 });
      h.mailer.sent.length = 0;
      const before = await head();
      const now = h.clock.now();

      const err = await failure(signInKey(h, auth, credentialId, { counter: 7 }));
      expect([err.code, err.status]).toEqual(["staff_key_suspended", 403]);

      expect(await keyRow(keyId)).toMatchObject({ revokedAt: now, suspectAt: now, counter: 7 });
      expect(await keyRow(red.key.id)).toMatchObject({ revokedAt: null, suspectAt: null });
      const byId = new Map((await sessionsOf(user.id)).map((s) => [s.id, s.revokedAt]));
      expect(byId.get(sha256Hex(first.token))).toEqual(ended);
      expect(byId.get(sha256Hex(second.token))).toEqual(now);
      expect(byId.get(sha256Hex(third.token))).toEqual(now);
      expect(byId.get(sha256Hex(onRed.token))).toBeNull();
      expect(byId.size).toBe(4);

      const regression = (await staffEvents(user.id)).filter((e) => e.type === "staff_key_counter_regression");
      expect(regression.map((e) => e.metadata)).toEqual([{ keyId, sessionsRevoked: 2, via: "sign_in" }]);
      const written = await rowsAfter(before.seq);
      expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.keyId, r.metadata])).toEqual([
        ["staff_key_counter_regression", user.id, "staff_key", keyId, null, { keyId, sessionsRevoked: 2, via: "sign_in" }],
      ]);
      // One transaction: the key, the revoked sessions, the event and the audit row, which its last statement wrote.
      const [rows] = await migrateDb.execute<{ key: string; sessions: string; event: string; audit: string; eventCmin: string; auditCmin: string }>(sql`select
        (select xmin::text from auth.staff_keys where id = ${keyId}) as key,
        (select string_agg(distinct xmin::text, ',') from auth.staff_sessions where id in (${sha256Hex(second.token)}, ${sha256Hex(third.token)})) as sessions,
        (select xmin::text from auth.auth_events where user_id = ${user.id} and type = 'staff_key_counter_regression') as event,
        (select xmin::text from public.audit_log where id = ${written[0]!.id}) as audit,
        (select cmin::text from auth.auth_events where user_id = ${user.id} and type = 'staff_key_counter_regression') as "eventCmin",
        (select cmin::text from public.audit_log where id = ${written[0]!.id}) as "auditCmin"`);
      expect(new Set([rows!.key, rows!.sessions, rows!.event, rows!.audit]).size).toBe(1);
      expect(Number(rows!.auditCmin)).toBeGreaterThan(Number(rows!.eventCmin));

      // Never passkey_suspect, whose remedy names the app's Security screen.
      expect(h.mailer.sent).toEqual([{ to: user.email, template: "staff_key_suspect", data: { name: "Blue key" } }]);
      // The key opens nothing more, whatever counter it reports; the account's other key still does.
      expect((await failure(signInKey(h, auth, credentialId, { counter: 100 }))).code).toBe("staff_key_invalid");
      expect((await signInKey(h, auth, red.credentialId, { counter: 2 })).me.role).toBe("moderator");
    });

    test("a counter that stays at a non-zero value is a regression too", { timeout: 30_000 }, async () => {
      const h = harness();
      const { keyId, auth, credentialId } = await staffWithKey(h);
      await signInKey(h, auth, credentialId, { counter: 3 });
      expect((await failure(signInKey(h, auth, credentialId, { counter: 2 }))).code).toBe("staff_key_suspended");
      expect((await keyRow(keyId)).suspectAt).not.toBeNull();
    });
  });

  describe("limits", () => {
    test("per IP, 20 attempts an hour, counted before anything else: the 21st is rate_limited and spends no challenge", { timeout: 60_000 }, async () => {
      const h = harness();
      const { auth, credentialId } = await staffWithKey(h);
      const stranger = new SoftAuthenticator();
      const junk = stranger.create({ rpId: TEST_CONSOLE_RP_ID, challenge: randomBytes(58).toString("base64url"), origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND });
      for (let i = 0; i < STAFF_SIGNIN_PER_IP_PER_HOUR; i++) expect((await failure(signInKey(h, stranger, junk.id))).code).toBe("staff_key_invalid");
      const response = await staffAssertion(h, auth, credentialId);
      const limited = await failure(signInVerify(h.deps, { response }, { ...h.ctx, requestId: "req-limited" }));
      expect([limited.code, limited.status, limited.retryAfterSeconds]).toEqual(["rate_limited", 429, 3600]);
      // The same answer from another address: its challenge was never spent.
      const signed = await signInVerify(h.deps, { response }, { ...h.ctx, ipHash: randomToken(), requestId: "req-other-ip" });
      expect(signed.me.role).toBe("moderator");
      // An hour later the address may try again.
      h.clock.advance(HOUR);
      expect((await signInKey(h, auth, credentialId, { counter: 2 })).me.role).toBe("moderator");
    });

    test("per key, 10 an hour, counted only after the signature and the flags: ten unsigned answers and refused flags leave the owner able to sign in", { timeout: 90_000 }, async () => {
      const h = harness();
      const { auth, credentialId } = await staffWithKey(h);
      const elsewhere = () => randomToken();
      // Someone who knows the key's credential id but not its private key, from as many addresses as they like.
      for (let i = 0; i < STAFF_SIGNIN_PER_KEY_PER_HOUR + 2; i++) {
        const forged = badSignature(await staffAssertion(h, auth, credentialId, { counter: 50 }));
        expect((await failure(signInVerify(h.deps, { response: forged }, { ...h.ctx, ipHash: elsewhere(), requestId: `req-forged-${i}` }))).code).toBe("staff_key_invalid");
      }
      // Assertions the key really signed but that the flags refuse are not counted either.
      for (let i = 0; i < 3; i++) expect((await failure(signInKey(h, auth, credentialId, { flags: NO_UV, ipHash: elsewhere() }))).code).toBe("staff_key_not_user_verified");
      // The owner signs in ten times within the hour; the eleventh is refused.
      for (let i = 1; i <= STAFF_SIGNIN_PER_KEY_PER_HOUR; i++) await signInKey(h, auth, credentialId, { counter: i, ipHash: elsewhere() });
      const limited = await failure(signInKey(h, auth, credentialId, { counter: 11, ipHash: elsewhere() }));
      expect([limited.code, limited.status]).toEqual(["rate_limited", 429]);
      h.clock.advance(HOUR);
      await signInKey(h, auth, credentialId, { counter: 12, ipHash: elsewhere() });
    });
  });

  describe("relying parties", () => {
    test("a personal passkey's assertion made for the console's relying party is refused at the app's sign-in on the relying-party check, leaving the passkey as it was", { timeout: 30_000 }, async () => {
      // The relying parties apart, as in production: the app's localhost, the console's console.localhost.
      const h = harness();
      const account = await onboardedUser(h, repo);
      const phone = new SoftAuthenticator();
      const registration = (await registerOptions(h.deps, account.session, { label: "ada" })).options;
      // Device-bound and user-verifying, so nothing but where the assertion was made for can refuse it.
      const personal = phone.create({ rpId: "localhost", challenge: registration.challenge, origin: APP_ORIGIN, userHandle: Buffer.from(registration.user.id, "base64url"), flags: DEVICE_BOUND });
      await registerVerify(h.deps, account.session, { response: personal });
      const stored = async () => (await migrateDb.select().from(passkeys).where(eq(passkeys.credentialId, personal.id)))[0]!;
      const before = await stored();
      expect(before).toMatchObject({ counter: 0, lastUsedAt: null, suspectAt: null });
      /** The app's passkey sign-in with an assertion the phone signs for this relying party ID from this origin. */
      const passkeySignIn = async (rpId: string, origin: string, counter: number) => {
        const { options } = await passkeySignInOptions(h.deps, h.ctx);
        const response = phone.get({ credentialId: personal.id, rpId, challenge: options.challenge, origin, flags: DEVICE_BOUND, counter });
        return passkeySignInVerify(h.deps, { deviceId: account.device.deviceId, platform: "web", response }, h.ctx);
      };

      // As a browser on the console's page makes it, carrying the console's origin too, which the library checks first; then
      // from the app's own origin, which passes, so that only the relying party ID in the authenticator data can refuse it.
      for (const [label, origin] of [
        ["from the console's origin", TEST_CONSOLE_ORIGIN],
        ["from the app's origin", APP_ORIGIN],
      ] as const) {
        const err = await failure(passkeySignIn(TEST_CONSOLE_RP_ID, origin, 5));
        expect([label, err.code, err.status]).toEqual([label, "passkey_invalid", 401]);
      }
      // Refused before the passkey's use is recorded: its counter, last use and suspect mark are untouched.
      expect(await stored()).toEqual(before);
      // The same passkey, origin and counter with the app's relying party ID sign in, so the ID alone refused the one above.
      expect((await passkeySignIn("localhost", APP_ORIGIN, 5)).kind).toBe("session");
      expect((await stored()).counter).toBe(5);
    });

    test("with both relying party IDs localhost (development), a personal passkey offered at the console's sign-in is refused by the tables alone", { timeout: 60_000 }, async () => {
      // The development configuration: the console at http://localhost:8090, its relying party ID the app's.
      const h = flowHarness(repo, { console: { origin: "http://localhost:8090", rpId: "localhost" } });
      const account = await onboardedUser(h, repo);
      await h.deps.profiles.create({ id: account.user.id, handle: `s_${randomUUID().slice(0, 8)}`, displayName: "Staff" });
      const phone = new SoftAuthenticator();
      const personalOptions = (await registerOptions(h.deps, account.session, { label: "ada" })).options;
      // A device-bound, user-verifying personal passkey: its flags would pass, so only the lookup can refuse it.
      const personal = phone.create({ rpId: "localhost", challenge: personalOptions.challenge, origin: APP_ORIGIN, userHandle: Buffer.from(personalOptions.user.id, "base64url"), flags: DEVICE_BOUND });
      await registerVerify(h.deps, account.session, { response: personal });
      await authDb.update(users).set({ role: "moderator" }).where(eq(users.id, account.user.id));
      const securityKey = new SoftAuthenticator();
      const staff = await enrolKey(h, securityKey, (await issueEnrolment(migrateDb, account.user.id, { origin: "http://localhost:8090", rpId: "localhost" })).token);

      // The browser offers the personal passkey on the console's page: the right relying party, origin and user handle.
      const offered = await staffAssertion(h, phone, personal.id, { counter: 1 });
      const err = await failure(signInVerify(h.deps, { response: offered }, { ...h.ctx, requestId: "req-personal" }));
      expect([err.code, err.status]).toEqual(["staff_key_invalid", 401]);
      expect(await sessionsOf(account.user.id)).toEqual([]);
      const [stored] = await migrateDb.select().from(passkeys).where(eq(passkeys.credentialId, personal.id));
      expect(stored).toMatchObject({ counter: 0, lastUsedAt: null, suspectAt: null });
      // The account's staff key opens the console there.
      expect((await signInKey(h, securityKey, staff.credentialId)).me.role).toBe("moderator");
    });
  });
});
```

### Replace `apps/api/test/cli-staff.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { STAFF_USAGE, enrollSettings, parseStaffArgs, revokeSettings, runStaffCommand, staffDatabaseUrls } from "../src/cli/staff";

const HASH_A = "ab".repeat(32);
const HASH_B = "0123456789abcdef".repeat(4);
const API_URL = "postgres://korbat_api:x@localhost:5432/korbat";
const AUTH_URL = "postgres://korbat_auth:x@localhost:5432/korbat";

/** The command's lines, each marked with the stream it went to. */
function capture() {
  const lines: string[] = [];
  return { lines, out: { log: (line: string) => lines.push(`out ${line}`), error: (line: string) => lines.push(`err ${line}`) } };
}

describe("staff.js arguments", () => {
  test("the usage lists the commands that exist", () => {
    expect(STAFF_USAGE).toMatch(/^usage: node dist\/staff\.js <command>/);
    expect(STAFF_USAGE).toContain("enroll <email>");
    expect(STAFF_USAGE).toContain("keys [<email>]");
    expect(STAFF_USAGE).toContain("audit-head");
    expect(STAFF_USAGE).toContain("audit-verify [<chain_seq>:<hash> ...]");
    expect(STAFF_USAGE).toContain("revoke <email> <key id>");
    expect(STAFF_USAGE).toContain("revoke <email> all");
    // enroll runs as the migrator, in the migrate service; the usage says where.
    expect(STAFF_USAGE).toMatch(/run --rm migrate node dist\/staff\.js enroll/);
  });

  test("reads revoke with an email address and a key id or all, normalising both", () => {
    const id = "0f7b3c2e-4a1d-4c6b-9e8f-1a2b3c4d5e6f";
    expect(parseStaffArgs(["revoke", " Mod@Korbat.Local ", "all"])).toEqual({ command: "revoke", email: "mod@korbat.local", key: "all" });
    expect(parseStaffArgs(["revoke", "mod@korbat.local", id.toUpperCase()])).toEqual({ command: "revoke", email: "mod@korbat.local", key: id });
    expect(() => parseStaffArgs(["revoke", "mod@korbat.local"])).toThrow(STAFF_USAGE);
    expect(() => parseStaffArgs(["revoke", "mod@korbat.local", id, "all"])).toThrow(STAFF_USAGE);
    expect(() => parseStaffArgs(["revoke", "moderator", "all"])).toThrow(`not an email address: moderator\n${STAFF_USAGE}`);
    for (const key of ["ALL", "every", "12", `${id}0`, id.replace(/-/g, "")]) {
      expect(() => parseStaffArgs(["revoke", "mod@korbat.local", key]), key).toThrow(`not a key id or all: ${key}`);
    }
  });

  test("reads enroll with one email address and keys with one or none, normalising the address", () => {
    expect(parseStaffArgs(["enroll", " Mod@Korbat.Local "])).toEqual({ command: "enroll", email: "mod@korbat.local" });
    expect(parseStaffArgs(["keys"])).toEqual({ command: "keys", email: null });
    expect(parseStaffArgs(["keys", "Mod@Korbat.Local"])).toEqual({ command: "keys", email: "mod@korbat.local" });
    expect(() => parseStaffArgs(["enroll"])).toThrow(STAFF_USAGE);
    expect(() => parseStaffArgs(["enroll", "a@b.io", "b@c.io"])).toThrow(STAFF_USAGE);
    expect(() => parseStaffArgs(["keys", "a@b.io", "b@c.io"])).toThrow(STAFF_USAGE);
    expect(() => parseStaffArgs(["enroll", "moderator"])).toThrow(`not an email address: moderator\n${STAFF_USAGE}`);
    expect(() => parseStaffArgs(["keys", "all"])).toThrow(`not an email address: all\n${STAFF_USAGE}`);
  });

  test("reads audit-head, and audit-verify with any number of kept places", () => {
    expect(parseStaffArgs(["audit-head"])).toEqual({ command: "audit-head" });
    expect(parseStaffArgs(["audit-verify"])).toEqual({ command: "audit-verify", kept: [] });
    expect(parseStaffArgs(["audit-verify", `12:${HASH_A}`, `3:${HASH_B}`])).toEqual({
      command: "audit-verify",
      kept: [
        { seq: 12, hash: HASH_A },
        { seq: 3, hash: HASH_B },
      ],
    });
    expect(parseStaffArgs(["audit-verify", `999999999999999:${HASH_A}`]).command).toBe("audit-verify");
  });

  test("prints the usage for no command, an unknown one or extra arguments", () => {
    expect(() => parseStaffArgs([])).toThrow(STAFF_USAGE);
    expect(() => parseStaffArgs(["audit-tail"])).toThrow(`unknown command: audit-tail\n${STAFF_USAGE}`);
    expect(() => parseStaffArgs(["audit-head", `1:${HASH_A}`])).toThrow(STAFF_USAGE);
  });

  test("refuses a kept place that is not <chain_seq>:<hash>, a positive place and a lower-case sha256", () => {
    for (const pair of [
      "12",
      `12 ${HASH_A}`,
      `0:${HASH_A}`,
      `-1:${HASH_A}`,
      `01:${HASH_A}`,
      `1.5:${HASH_A}`,
      `1e3:${HASH_A}`,
      `1000000000000000:${HASH_A}`,
      "12:abc",
      `12:${HASH_A.toUpperCase()}`,
      `12:${HASH_A}0`,
      `12:${HASH_A}:1`,
    ]) {
      expect(() => parseStaffArgs(["audit-verify", pair]), pair).toThrow(`not a kept place: ${pair}`);
    }
  });

  test("run without arguments, it prints its usage and answers 2 before reading any configuration", async () => {
    const { lines, out } = capture();
    expect(await runStaffCommand([], {}, out)).toBe(2);
    expect(lines).toEqual([`err ${STAFF_USAGE}`]);
  });
});

// audit-head and audit-verify need no server secret and no console configuration (3a design, section 7), so each reads
// only the database URLs it connects with, never the API's whole configuration.
describe("what each staff.js command reads of the environment", () => {
  test("audit-head reads DATABASE_URL_API alone, and audit-verify that and DATABASE_URL_AUTH", () => {
    expect(staffDatabaseUrls({ command: "audit-head" }, { DATABASE_URL_API: API_URL })).toEqual({ api: API_URL, auth: null });
    expect(staffDatabaseUrls({ command: "audit-verify", kept: [] }, { DATABASE_URL_API: API_URL, DATABASE_URL_AUTH: AUTH_URL })).toEqual({
      api: API_URL,
      auth: AUTH_URL,
    });
  });

  test("a setting the API's configuration would refuse, the console's included, changes nothing", () => {
    for (const extra of [
      // Not an origin as browsers send it (the final slash).
      { CONSOLE_ORIGIN: "https://console.example/" },
      // The console on the app's own origin.
      { APP_ORIGIN: "http://localhost:8081", CONSOLE_ORIGIN: "http://localhost:8081" },
      { CONSOLE_RP_ID: "not a domain" },
      // A secret too short, and production's rules over a development setup.
      { NODE_ENV: "production", AUTH_HMAC_KEY: "c2hvcnQ=", APP_ORIGIN: "http://localhost:8081" },
    ]) {
      const env = { DATABASE_URL_API: API_URL, DATABASE_URL_AUTH: AUTH_URL, ...extra };
      expect(staffDatabaseUrls({ command: "audit-verify", kept: [] }, env), JSON.stringify(extra)).toEqual({ api: API_URL, auth: AUTH_URL });
      expect(staffDatabaseUrls({ command: "audit-head" }, env), JSON.stringify(extra)).toEqual({ api: API_URL, auth: null });
    }
  });

  test("names the database URL that is missing or not a PostgreSQL URL, and no other setting", () => {
    const cases: [Parameters<typeof staffDatabaseUrls>[0], Record<string, string>, RegExp][] = [
      [{ command: "audit-head" }, {}, /DATABASE_URL_API/],
      [{ command: "audit-head" }, { DATABASE_URL_API: "mysql://korbat:x@localhost/korbat" }, /DATABASE_URL_API/],
      [{ command: "audit-verify", kept: [] }, { DATABASE_URL_API: API_URL }, /DATABASE_URL_AUTH/],
      [{ command: "audit-verify", kept: [] }, { DATABASE_URL_API: API_URL, DATABASE_URL_AUTH: "not a url" }, /DATABASE_URL_AUTH/],
    ];
    for (const [command, env, named] of cases) {
      let message = "";
      try {
        staffDatabaseUrls(command, env);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message, JSON.stringify(env)).toMatch(named);
      expect(message).toMatch(new RegExp(`^Invalid environment for ${command.command}:`));
      expect(message).not.toMatch(/APP_ORIGIN|REDIS_URL|AUTH_HMAC_KEY|SMTP_URL|CONSOLE_ORIGIN/);
    }
  });

  test("keys reads DATABASE_URL_AUTH for the keys and DATABASE_URL_API for the handles, and nothing else", () => {
    expect(staffDatabaseUrls({ command: "keys", email: null }, { DATABASE_URL_API: API_URL, DATABASE_URL_AUTH: AUTH_URL, CONSOLE_ORIGIN: "not an origin" })).toEqual({
      api: API_URL,
      auth: AUTH_URL,
    });
    expect(() => staffDatabaseUrls({ command: "keys", email: "a@b.io" }, { DATABASE_URL_API: API_URL })).toThrow(/^Invalid environment for keys:[\s\S]*DATABASE_URL_AUTH/);
  });

  test("run with a database URL missing, it names it and answers 1", async () => {
    const { lines, out } = capture();
    expect(await runStaffCommand(["audit-verify"], { DATABASE_URL_API: API_URL }, out)).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^err Invalid environment for audit-verify:/);
    expect(lines[0]).toContain("DATABASE_URL_AUTH");
    expect(lines[0]).not.toMatch(/APP_ORIGIN|REDIS_URL|AUTH_HMAC_KEY/);
  });
});

// enroll runs in the migrate service as the migrator (3a design, section 7): it reads the migrator's database URL and the
// console's origin and relying party ID, which Compose gives that service, and nothing of the API's configuration.
describe("what staff.js enroll reads of the environment", () => {
  const MIGRATE_URL = "postgres://korbat_migrate:x@localhost:5432/korbat";

  test("DATABASE_URL_MIGRATE, CONSOLE_ORIGIN and CONSOLE_RP_ID, the relying party ID defaulting to the console's hostname", () => {
    expect(enrollSettings({ DATABASE_URL_MIGRATE: MIGRATE_URL, CONSOLE_ORIGIN: "http://localhost:8090" })).toEqual({
      migrate: MIGRATE_URL,
      consoleOrigin: "http://localhost:8090",
      consoleRpId: "localhost",
    });
    // A blank relying party ID, as Compose passes an empty line of infra/.env, counts as unset.
    expect(enrollSettings({ DATABASE_URL_MIGRATE: MIGRATE_URL, CONSOLE_ORIGIN: "https://console.example", CONSOLE_RP_ID: " " }).consoleRpId).toBe("console.example");
    expect(enrollSettings({ DATABASE_URL_MIGRATE: MIGRATE_URL, CONSOLE_ORIGIN: "https://console.example", CONSOLE_RP_ID: "Console.Example" }).consoleRpId).toBe("console.example");
  });

  test("a setting only the API reads, or one the API's configuration would refuse, changes nothing", () => {
    const env = {
      DATABASE_URL_MIGRATE: MIGRATE_URL,
      CONSOLE_ORIGIN: "http://localhost:8090",
      // The console on the app's own hostname is refused by the API's rules in production, not here.
      APP_ORIGIN: "http://localhost:8081",
      NODE_ENV: "production",
      AUTH_HMAC_KEY: "c2hvcnQ=",
    };
    expect(enrollSettings(env)).toEqual({ migrate: MIGRATE_URL, consoleOrigin: "http://localhost:8090", consoleRpId: "localhost" });
  });

  test("while CONSOLE_ORIGIN is unset or blank it refuses, naming it", () => {
    for (const env of [{ DATABASE_URL_MIGRATE: MIGRATE_URL }, { DATABASE_URL_MIGRATE: MIGRATE_URL, CONSOLE_ORIGIN: "" }, { DATABASE_URL_MIGRATE: MIGRATE_URL, CONSOLE_ORIGIN: "  " }]) {
      expect(() => enrollSettings(env), JSON.stringify(env)).toThrow(/CONSOLE_ORIGIN is not set: the staff console is off, so no enrolment link can be issued/);
    }
  });

  test("names the setting that is wrong, and no other", () => {
    const cases: [Record<string, string>, RegExp][] = [
      [{ CONSOLE_ORIGIN: "http://localhost:8090" }, /DATABASE_URL_MIGRATE/],
      [{ DATABASE_URL_MIGRATE: "mysql://x@localhost/k", CONSOLE_ORIGIN: "http://localhost:8090" }, /DATABASE_URL_MIGRATE/],
      // Not an origin as browsers send it: the staff gate would refuse every write the console makes.
      [{ DATABASE_URL_MIGRATE: MIGRATE_URL, CONSOLE_ORIGIN: "http://localhost:8090/" }, /CONSOLE_ORIGIN/],
      [{ DATABASE_URL_MIGRATE: MIGRATE_URL, CONSOLE_ORIGIN: "http://localhost:8090", CONSOLE_RP_ID: "http://localhost" }, /CONSOLE_RP_ID/],
    ];
    for (const [env, named] of cases) {
      let message = "";
      try {
        enrollSettings(env);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message, JSON.stringify(env)).toMatch(named);
      expect(message).toMatch(/^Invalid environment for enroll:/);
      expect(message).not.toMatch(/APP_ORIGIN|REDIS_URL|AUTH_HMAC_KEY|SMTP_URL|DATABASE_URL_API|DATABASE_URL_AUTH/);
    }
  });

  test("run while CONSOLE_ORIGIN is unset, it says so, answers 1 and connects to nothing", async () => {
    const { lines, out } = capture();
    // Nothing listens on port 1: a connection attempt would fail with another message, or hang.
    const started = Date.now();
    expect(await runStaffCommand(["enroll", "mod@korbat.local"], { DATABASE_URL_MIGRATE: "postgres://korbat_migrate:x@127.0.0.1:1/korbat" }, out)).toBe(1);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^err .*CONSOLE_ORIGIN is not set/);
  });
});

// revoke runs like grant-role, in the api service (3a design, section 7): it revokes on the auth role and mails the key's
// owner, so it reads the auth role's URL and the mail settings, and nothing else of the API's configuration.
describe("what staff.js revoke reads of the environment", () => {
  const MAIL = { SMTP_URL: "smtp://localhost:1025", MAIL_FROM: "korbat <no-reply@korbat.local>" };

  test("DATABASE_URL_AUTH, SMTP_URL and MAIL_FROM, with TLS required from a plain relay in production as the API requires it", () => {
    expect(revokeSettings({ DATABASE_URL_AUTH: AUTH_URL, ...MAIL })).toEqual({ auth: AUTH_URL, mail: { smtpUrl: MAIL.SMTP_URL, mailFrom: MAIL.MAIL_FROM, requireTls: false } });
    expect(revokeSettings({ DATABASE_URL_AUTH: AUTH_URL, ...MAIL, NODE_ENV: "production" }).mail.requireTls).toBe(true);
  });

  test("a setting only the API reads, or one the API's configuration would refuse, changes nothing", () => {
    const env = { DATABASE_URL_AUTH: AUTH_URL, ...MAIL, CONSOLE_ORIGIN: "https://console.example/", APP_ORIGIN: "not a url", AUTH_HMAC_KEY: "c2hvcnQ=", DATABASE_URL_API: "nope" };
    expect(revokeSettings(env).auth).toBe(AUTH_URL);
  });

  test("names the setting that is missing or wrong, and no other", () => {
    const cases: [Record<string, string>, RegExp][] = [
      [{ ...MAIL }, /DATABASE_URL_AUTH/],
      [{ DATABASE_URL_AUTH: "mysql://x@localhost/k", ...MAIL }, /DATABASE_URL_AUTH/],
      [{ DATABASE_URL_AUTH: AUTH_URL, MAIL_FROM: MAIL.MAIL_FROM }, /SMTP_URL/],
      [{ DATABASE_URL_AUTH: AUTH_URL, SMTP_URL: "http://localhost:1025", MAIL_FROM: MAIL.MAIL_FROM }, /SMTP_URL/],
      [{ DATABASE_URL_AUTH: AUTH_URL, SMTP_URL: MAIL.SMTP_URL }, /MAIL_FROM/],
    ];
    for (const [env, named] of cases) {
      let message = "";
      try {
        revokeSettings(env);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message, JSON.stringify(env)).toMatch(named);
      expect(message).toMatch(/^Invalid environment for revoke:/);
      expect(message).not.toMatch(/APP_ORIGIN|REDIS_URL|AUTH_HMAC_KEY|CONSOLE_ORIGIN|DATABASE_URL_API|DATABASE_URL_MIGRATE/);
    }
  });

  test("run with a setting missing, it names it, answers 1 and connects to nothing", async () => {
    const { lines, out } = capture();
    const started = Date.now();
    expect(await runStaffCommand(["revoke", "mod@korbat.local", "all"], { DATABASE_URL_AUTH: "postgres://korbat_auth:x@127.0.0.1:1/korbat", ...MAIL, SMTP_URL: "" }, out)).toBe(1);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^err Invalid environment for revoke:/);
    expect(lines[0]).toContain("SMTP_URL");
  });
});
```

### Replace `apps/api/test/integration/auth-janitor.test.ts` (whole file)

```ts
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
```

### Replace `apps/api/test/integration/http-auth.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { EmailChangeResponse, ErrorEnvelope, FlowResponse, MeResponse, SessionResult, SessionsResponse } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { Browser, NativeClient } from "./http-client";

type App = ReturnType<typeof createApp>;

const newHandle = () => `h_${randomBytes(6).toString("hex")}`;

describe.skipIf(!process.env.INTEGRATION)("integration: auth over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let auth: Auth;
  let app: App;
  const mailer = new MemoryMailer();

  beforeAll(() => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async (token) => token !== "fail" },
      breachChecker: { isBreached: async (password) => password.includes("breached") },
    });
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  async function signUp(b: Browser, platform: "web" | "ios" = "web") {
    const email = `http-${randomUUID()}@korbat.local`;
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    const verify = await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } });
    expect(await verify.json()).toEqual({ result: "signup_required" });
    const complete = await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "2000-01-01", termsVersion: config.TERMS_VERSION } });
    expect(complete.status).toBe(200);
    return { email, complete };
  }

  test("web sign-up end to end: cookies only, CSRF on state changes, onboarding, me and sessions", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const { email, complete } = await signUp(b);
    expect(await complete.json()).toEqual({ result: "session", mustReenrollMfa: false });
    expect(complete.headers.getSetCookie().find((c) => c.startsWith("__Host-korbat_session="))).toContain("HttpOnly");

    const before = MeResponse.parse(await (await b.fetch("/api/me")).json());
    expect(before.user).toMatchObject({ email, onboarded: false, hasPassword: false });
    expect(before.profile).toBeNull();

    const firstToken = b.cookie("__Host-korbat_session");
    const handle = newHandle();
    const withoutCsrf = await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: "Web User" }, csrf: false });
    expect(withoutCsrf.status).toBe(403);
    expect(await withoutCsrf.json()).toMatchObject({ error: { code: "csrf_failed" } });

    const onboarded = await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: "Web User" } });
    expect(onboarded.status).toBe(200);
    expect(await onboarded.json()).toEqual({ profile: { id: before.user.id, handle, displayName: "Web User" } });
    expect(b.cookie("__Host-korbat_session")).not.toBe(firstToken);

    const after = MeResponse.parse(await (await b.fetch("/api/me")).json());
    expect(after.user.onboarded).toBe(true);
    expect(after.profile?.handle).toBe(handle);
    const { sessions } = SessionsResponse.parse(await (await b.fetch("/api/auth/sessions")).json());
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.current).toBe(true);
  });

  test("native clients get the token in the body and never cookies; bearer requests need no CSRF token", async () => {
    const native = new NativeClient(app);
    const email = `http-${randomUUID()}@korbat.local`;
    const start = await native.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "ios" } });
    const { flowId } = FlowResponse.parse(await start.json());
    await native.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } });
    const complete = await native.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "2000-01-01", termsVersion: config.TERMS_VERSION } });
    expect(complete.status).toBe(200);
    const body = SessionResult.parse(await complete.json());
    expect(body.token).toMatch(/^kb1_[A-Za-z0-9_-]{43}$/);
    expect(complete.headers.getSetCookie()).toHaveLength(0);

    const onboarded = await app.request("/api/auth/onboarding/handle", {
      method: "POST",
      headers: { authorization: `Bearer ${body.token}`, "content-type": "application/json" },
      body: JSON.stringify({ handle: newHandle(), displayName: "Phone User" }),
    });
    expect(onboarded.status).toBe(200);
    const { token: rotated } = (await onboarded.json()) as { token?: string };
    expect(rotated).toMatch(/^kb1_/);
    expect((await app.request("/api/me", { headers: { authorization: `Bearer ${body.token}` } })).status).toBe(401);
    expect((await app.request("/api/me", { headers: { authorization: `Bearer ${rotated}` } })).status).toBe(200);
  });

  test("a browser gets cookies and no token even when it claims a native platform", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const { complete } = await signUp(b, "ios");
    expect(await complete.json()).toEqual({ result: "session", mustReenrollMfa: false });
    expect(complete.headers.getSetCookie().some((c) => c.startsWith("__Host-korbat_session="))).toBe(true);
  });

  test("a script that sends only Sec-Fetch-Mode, as Node's fetch does, keeps its native platform", async () => {
    const headers = { "content-type": "application/json", "sec-fetch-mode": "cors", "cf-connecting-ip": "203.0.113.77" };
    const email = `http-${randomUUID()}@korbat.local`;
    const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
    const start = await post("/api/auth/email/start", { email, turnstileToken: "ok", deviceId: randomToken(), platform: "ios" });
    const { flowId } = FlowResponse.parse(await start.json());
    await post("/api/auth/email/verify", { flowId, code: mailer.lastCodeFor(email) });
    const complete = await post("/api/auth/signup/complete", { flowId, dateOfBirth: "2000-01-01", termsVersion: config.TERMS_VERSION });
    expect(complete.status).toBe(200);
    expect(SessionResult.parse(await complete.json()).token).toMatch(/^kb1_/);
    expect(complete.headers.getSetCookie()).toHaveLength(0);
  });

  test("malformed JSON is a 400 with the error envelope, not a 500", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const res = await b.fetch("/api/auth/email/verify", { raw: { type: "application/json", body: new TextEncoder().encode("{not json") } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_request" } });
  });

  test("revoking one session needs fresh re-authentication", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    await signUp(b);
    await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Fresh" } });
    const sessionId = sha256Hex(b.cookie("__Host-korbat_session")!);
    await auth.deps.repo.writeFactor(sessionId, "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:2:${sessionId}`);
    const revoke = await b.fetch(`/api/auth/sessions/${randomUUID()}`, { method: "DELETE" });
    expect(revoke.status).toBe(403);
    expect(await revoke.json()).toMatchObject({ error: { code: "reauth_required" } });
  });

  test("a session is revoked by its handle: an unknown one is 404, and anything that is not a uuid, a token's hash included, is 400", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    await signUp(b);
    await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Handles" } });
    const { sessions } = SessionsResponse.parse(await (await b.fetch("/api/auth/sessions")).json());
    const row = (await auth.deps.repo.findActiveSession(sha256Hex(b.cookie("__Host-korbat_session")!), new Date()))!;
    expect(sessions.map((s) => [s.id, s.current])).toEqual([[row.handle, true]]);

    const unknown = await b.fetch(`/api/auth/sessions/${randomUUID()}`, { method: "DELETE" });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "not_found" } });
    for (const id of [row.id, "0".repeat(64), "not-a-uuid"]) {
      const malformed = await b.fetch(`/api/auth/sessions/${id}`, { method: "DELETE" });
      expect(malformed.status, id).toBe(400);
      expect(await malformed.json()).toMatchObject({ error: { code: "invalid_request" } });
    }
    expect((await b.fetch("/api/me")).status).toBe(200);
    // Its own handle signs the session out.
    expect((await b.fetch(`/api/auth/sessions/${row.handle}`, { method: "DELETE" })).status).toBe(204);
    expect((await b.fetch("/api/me")).status).toBe(401);
  });

  test("other origins cannot change state; no session gets 401; unfinished onboarding gets 403", async () => {
    const evil = new Browser(app, "https://evil.example");
    const crossOrigin = await evil.fetch("/api/auth/email/start", { json: { email: "a@b.io", turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(crossOrigin.status).toBe(403);
    expect(await crossOrigin.json()).toMatchObject({ error: { code: "csrf_failed" } });

    const anonymous = await app.request("/api/me");
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ error: { code: "unauthenticated" } });

    const b = new Browser(app, config.APP_ORIGIN);
    await signUp(b);
    const sessions = await b.fetch("/api/auth/sessions");
    expect(sessions.status).toBe(403);
    expect(await sessions.json()).toMatchObject({ error: { code: "onboarding_required" } });
  });

  test("sensitive routes need fresh re-authentication, which an emailed code provides", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const { email } = await signUp(b);
    await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Fresh" } });
    const token = b.cookie("__Host-korbat_session")!;
    const sessionId = sha256Hex(token);
    await auth.deps.repo.writeFactor(sessionId, "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:2:${sessionId}`);

    const blocked = await b.fetch("/api/auth/password/set", { json: { password: "correct horse battery staple" } });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ error: { code: "reauth_required" } });

    const { flowId } = FlowResponse.parse(await (await b.fetch("/api/auth/reauth/email/start", { method: "POST" })).json());
    const reauth = await b.fetch("/api/auth/reauth", { json: { method: "email", flowId, code: mailer.lastCodeFor(email) } });
    expect(reauth.status).toBe(200);
    // The level reached; the token rotated into the cookies, never into a browser's body (1c design, section 7.2).
    expect(await reauth.json()).toEqual({ level: 1 });
    const rotated = b.cookie("__Host-korbat_session")!;
    expect(rotated).not.toBe(token);
    expect((await app.request("/api/me", { headers: { cookie: `__Host-korbat_session=${token}` } })).status).toBe(401);

    const set = await b.fetch("/api/auth/password/set", { json: { password: "correct horse battery staple" } });
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({});
    expect(b.cookie("__Host-korbat_session")).not.toBe(rotated);
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.hasPassword).toBe(true);
  });

  test("changing the email address needs an onboarded, fresh session on both routes; the new address is then verified by its code and shown by /me", async () => {
    const newAddress = `http-moved-${randomUUID()}@korbat.local`;
    const routes = [
      ["/api/auth/email/change/start", { email: newAddress }],
      ["/api/auth/email/change/verify", { flowId: randomToken(), code: "123456" }],
    ] as const;
    for (const [path, body] of routes) {
      const anonymous = await app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      expect(anonymous.status, path).toBe(401);
      expect(await anonymous.json()).toMatchObject({ error: { code: "unauthenticated" } });
    }

    const b = new Browser(app, config.APP_ORIGIN);
    const { email } = await signUp(b);
    for (const [path, body] of routes) {
      const early = await b.fetch(path, { json: body });
      expect(early.status, path).toBe(403);
      expect(await early.json()).toMatchObject({ error: { code: "onboarding_required" } });
    }

    await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Mover" } });
    const sessionId = sha256Hex(b.cookie("__Host-korbat_session")!);
    await auth.deps.repo.writeFactor(sessionId, "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:2:${sessionId}`);
    for (const [path, body] of routes) {
      const stale = await b.fetch(path, { json: body });
      expect(stale.status, path).toBe(403);
      expect(await stale.json()).toMatchObject({ error: { code: "reauth_required" } });
    }
    const { flowId: reauthFlow } = FlowResponse.parse(await (await b.fetch("/api/auth/reauth/email/start", { method: "POST" })).json());
    expect((await b.fetch("/api/auth/reauth", { json: { method: "email", flowId: reauthFlow, code: mailer.lastCodeFor(email) } })).status).toBe(200);

    const malformed = await b.fetch("/api/auth/email/change/start", { json: { email: "not an address" } });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "invalid_request" } });
    const started = await b.fetch("/api/auth/email/change/start", { json: { email: newAddress } });
    expect(started.status).toBe(200);
    const { flowId } = FlowResponse.parse(await started.json());
    const verified = await b.fetch("/api/auth/email/change/verify", { json: { flowId, code: mailer.lastCodeFor(newAddress) } });
    expect(verified.status).toBe(200);
    expect(EmailChangeResponse.parse(await verified.json())).toEqual({ email: newAddress });
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.email).toBe(newAddress);
    expect(mailer.sent.at(-1)).toMatchObject({ to: email, template: "email_changed", data: { email: newAddress } });
  });

  test("the undo link of an email change needs no session: a malformed token is 400, the right one 204 with every session signed out, a used one 400", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const { email } = await signUp(b);
    await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Undo" } });
    const newAddress = `http-undo-${randomUUID()}@korbat.local`;
    const { flowId } = FlowResponse.parse(await (await b.fetch("/api/auth/email/change/start", { json: { email: newAddress } })).json());
    expect((await b.fetch("/api/auth/email/change/verify", { json: { flowId, code: mailer.lastCodeFor(newAddress) } })).status).toBe(200);
    const notice = mailer.sent.at(-1)!;
    expect(notice).toMatchObject({ to: email, template: "email_changed" });
    const token = /\/email-revert\/([A-Za-z0-9_-]{43})$/.exec(notice.data.revertUrl ?? "")?.[1];
    expect(token).toBeDefined();

    // Opened in a browser that holds no session: the link is the only credential.
    const stranger = new Browser(app, config.APP_ORIGIN);
    for (const body of [{ token: "not-a-token" }, { token: `${token!.slice(1)}/` }, {}]) {
      const malformed = await stranger.fetch("/api/auth/email/revert", { json: body });
      expect(malformed.status, JSON.stringify(body)).toBe(400);
      expect(await malformed.json()).toMatchObject({ error: { code: "invalid_request" } });
    }
    const reverted = await stranger.fetch("/api/auth/email/revert", { json: { token } });
    expect(reverted.status).toBe(204);
    expect(await reverted.text()).toBe("");
    expect((await b.fetch("/api/me")).status).toBe(401);
    expect((await auth.deps.repo.findUserByEmail(email))?.email).toBe(email);
    expect(await auth.deps.repo.findUserByEmail(newAddress)).toBeUndefined();
    expect(mailer.sent.at(-1)).toMatchObject({ to: email, template: "email_change_reverted" });
    const used = await stranger.fetch("/api/auth/email/revert", { json: { token } });
    expect(used.status).toBe(400);
    expect(await used.json()).toMatchObject({ error: { code: "invalid_code" } });
  });

  test("signing out clears both cookies and ends the session", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    await signUp(b);
    const token = b.cookie("__Host-korbat_session")!;
    const signedOut = await b.fetch("/api/auth/signout", { method: "POST" });
    expect(signedOut.status).toBe(204);
    expect(signedOut.headers.getSetCookie().filter((c) => c.includes("Max-Age=0"))).toHaveLength(2);
    expect((await app.request("/api/me", { headers: { cookie: `__Host-korbat_session=${token}` } })).status).toBe(401);
  });

  test("validation and flow errors use the error envelope with the request id", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const invalid = await b.fetch("/api/auth/email/verify", { json: { flowId: "nope", code: "12" } });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "invalid_request" } });

    const unknown = await b.fetch("/api/auth/email/verify", { json: { flowId: randomToken(), code: "123456" } });
    expect(unknown.status).toBe(400);
    const body = ErrorEnvelope.parse(await unknown.json());
    expect(body.error.code).toBe("invalid_code");
    expect(body.error.requestId).toBe(unknown.headers.get("x-request-id"));
  });
});
```

### Replace `apps/api/test/integration/staff-audit.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { AuditPage, STAFF_AUDIT_PAGE_SIZE } from "@korbat/contracts";
import { auditHead, auditLog, closeDb, createDb, profiles, type Db, type DbTx } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { appendAuditRow, auditPage, type StaffAuditRow } from "../../src/staff/audit";
import { newProfile } from "./social-fixtures";
import { rolledBack, withLockTimeout } from "./staff-fixtures";

const SYSTEM = "00000000-0000-0000-0000-000000000000";
const STEP_UP = { authenticatorData: "AAAA", clientDataJSON: "BBBB", signature: "CCCC" };

/**
 * The staff module's side of the record (3a design, sections 5 and 7): the writer for actions on public tables, which 3c's
 * decisions will use, and the audit reader behind GET /api/staff/audit. The rows that only a test needs are
 * written in transactions that end in a rollback.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the staff module's audit writer and reader", () => {
  let apiDb: Db;

  beforeAll(() => {
    apiDb = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
  });
  afterAll(async () => {
    await closeDb(apiDb);
  });

  const readHead = async (db: Db | DbTx = apiDb) => (await db.select().from(auditHead))[0]!;
  const row = (overrides: Partial<StaffAuditRow> = {}): StaffAuditRow => ({
    actorId: SYSTEM,
    action: "probe",
    targetType: "post",
    targetId: randomUUID(),
    requestId: `req-${randomUUID()}`,
    ...overrides,
  });

  describe("the writer", () => {
    test("writes the row the trigger places, with every column it is given, and answers its place and hash", async () => {
      await rolledBack(apiDb, async (tx) => {
        const before = await readHead(tx);
        const staffSession = randomUUID();
        const keyId = randomUUID();
        const input = row({ actorId: randomUUID(), metadata: { params: { reason: "R2" } }, staffSession, keyId, actionHash: "ab".repeat(32), stepUp: STEP_UP });
        const place = await appendAuditRow(tx, input);
        expect(place).toEqual({ seq: before.seq + 1, hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
        expect(await readHead(tx)).toEqual({ id: 1, seq: place.seq, hash: place.hash });
        const [stored] = await tx.select().from(auditLog).where(eq(auditLog.chainSeq, place.seq));
        expect(stored).toMatchObject({ ...input, chainVersion: 1, prevHash: before.hash, hash: place.hash });
      });
    });

    test("an absent metadata is stored as an empty object, and absent step-up columns as null", async () => {
      await rolledBack(apiDb, async (tx) => {
        const place = await appendAuditRow(tx, row());
        const [stored] = await tx.select().from(auditLog).where(eq(auditLog.chainSeq, place.seq));
        expect(stored).toMatchObject({ metadata: {}, staffSession: null, keyId: null, actionHash: null, stepUp: null });
      });
    });

    test("the row commits with the action in the caller's transaction, and a rollback leaves neither", async () => {
      const profile = await newProfile(apiDb);
      const committed = await withLockTimeout(apiDb, async (tx) => {
        await tx.update(profiles).set({ bio: "withheld" }).where(eq(profiles.id, profile.id));
        // The audit row last: it holds the chain's head until the transaction ends.
        return appendAuditRow(tx, row({ action: "probe_withhold", targetType: "profile", targetId: profile.id }));
      });
      // Written by one transaction: the profile's new version and the audit row carry the same transaction id.
      const [changed] = await apiDb.execute<{ xmin: string }>(sql`select xmin::text as xmin from public.profiles where id = ${profile.id}`);
      const [recorded] = await apiDb.execute<{ xmin: string }>(sql`select xmin::text as xmin from public.audit_log where chain_seq = ${committed.seq}`);
      expect(recorded!.xmin).toBe(changed!.xmin);

      const before = await readHead();
      const failure = new Error("the action failed after its row");
      await expect(
        withLockTimeout(apiDb, async (tx) => {
          await tx.update(profiles).set({ bio: "never" }).where(eq(profiles.id, profile.id));
          await appendAuditRow(tx, row({ action: "probe_never", targetType: "profile", targetId: profile.id }));
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(await readHead()).toEqual(before);
      expect((await apiDb.select({ bio: profiles.bio }).from(profiles).where(eq(profiles.id, profile.id)))[0]!.bio).toBe("withheld");
    });
  });

  describe("the reader", () => {
    test("reads pages newest first by place, from the newest row, before a cursor or at a place, with the actor's handle and never the metadata", async () => {
      const staff = await newProfile(apiDb);
      const nobody = randomUUID();
      await rolledBack(apiDb, async (tx) => {
        const written: { seq: number; actor: string; action: string }[] = [];
        for (let i = 0; i < 60; i++) {
          const actor = [staff.id, SYSTEM, nobody][i % 3]!;
          const action = i % 5 === 0 ? "staff_sign_in" : "probe";
          // One row confirmed by a step-up, whose action's hash the reader shows.
          const confirmed = i === 58 ? { staffSession: randomUUID(), keyId: randomUUID(), actionHash: "cd".repeat(32), stepUp: STEP_UP } : {};
          const place = await appendAuditRow(tx, row({ actorId: actor, action, metadata: { email: "never-shown@korbat.local" }, ...confirmed }));
          written.push({ seq: place.seq, actor, action });
        }
        const newest = written[written.length - 1]!;

        const first = AuditPage.parse(await auditPage(tx, {}));
        expect(first.entries).toHaveLength(STAFF_AUDIT_PAGE_SIZE);
        expect(first.entries.map((e) => e.seq)).toEqual(Array.from({ length: STAFF_AUDIT_PAGE_SIZE }, (_, i) => newest.seq - i));
        expect(first.nextCursor).toBe(newest.seq - STAFF_AUDIT_PAGE_SIZE + 1);
        // Each entry: its place and hash, when it joined the chain, the actor's handle, the action, its target and hash.
        const [stored] = await tx.select().from(auditLog).where(eq(auditLog.chainSeq, newest.seq - 1));
        expect(first.entries[1]).toEqual({
          seq: stored!.chainSeq,
          hash: stored!.hash,
          createdAt: stored!.createdAt.toISOString(),
          actorHandle: written[58]!.actor === staff.id ? staff.handle : null,
          action: stored!.action,
          targetType: stored!.targetType,
          targetId: stored!.targetId,
          actionHash: "cd".repeat(32),
        });
        expect(JSON.stringify(first)).not.toContain("never-shown");
        for (const [index, entry] of first.entries.entries()) {
          const source = written[written.length - 1 - index]!;
          expect(entry.actorHandle, `place ${entry.seq}`).toBe(source.actor === staff.id ? staff.handle : null);
        }

        const second = AuditPage.parse(await auditPage(tx, { cursor: first.nextCursor! }));
        expect(second.entries[0]!.seq).toBe(first.nextCursor! - 1);
        expect(second.entries.map((e) => e.seq)).toEqual(second.entries.map((_, i) => first.nextCursor! - 1 - i));

        // "Go to place": the page whose newest row is at that place.
        const at = written[20]!.seq;
        const kept = AuditPage.parse(await auditPage(tx, { at }));
        expect(kept.entries[0]!.seq).toBe(at);
        expect(kept.entries.length).toBe(Math.min(STAFF_AUDIT_PAGE_SIZE, at));

        // The home screen's sign-ins: only that action, newest first.
        const signIns = AuditPage.parse(await auditPage(tx, { action: "staff_sign_in" }));
        const mine = written.filter((w) => w.action === "staff_sign_in").reverse();
        expect(signIns.entries.slice(0, mine.length).map((e) => e.seq)).toEqual(mine.map((w) => w.seq));
        expect(signIns.entries.every((e) => e.action === "staff_sign_in")).toBe(true);
        const signInsAt = AuditPage.parse(await auditPage(tx, { action: "staff_sign_in", at: mine[1]!.seq }));
        expect(signInsAt.entries[0]!.seq).toBe(mine[1]!.seq);
      });
    });

    test("the last page has no cursor, and a cursor before the first place answers an empty page", async () => {
      await rolledBack(apiDb, async (tx) => {
        await appendAuditRow(tx, row());
        await appendAuditRow(tx, row());
        expect(await auditPage(tx, { cursor: 2 })).toMatchObject({ entries: [{ seq: 1 }], nextCursor: null });
        expect(await auditPage(tx, { cursor: 1 })).toEqual({ entries: [], nextCursor: null });
      });
    });
  });
});
```

### Replace `apps/api/test/integration/staff-enrolment.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import type { StaffKeyKind } from "@korbat/contracts";
import { enrollOptions, enrollVerify } from "../../src/auth/staff/enroll";
import type { SoftAuthenticator, SoftFlags } from "../auth/soft-authenticator";
import type { FlowHarness } from "./flow-harness";
import { DEVICE_BOUND } from "./staff-fixtures";

// Kept apart from staff-fixtures.ts, which the suites of the audit record and the schema share: only the suites of the
// enrolment flow need the flow itself.

/** What the staff flows need of a harness: the auth module's dependencies and a request's facts. The HTTP suites pass createAuth's. */
export type StaffFlowHarness = Pick<FlowHarness, "deps" | "ctx">;

export interface EnrolOptions {
  name?: string;
  kind?: StaffKeyKind;
  flags?: SoftFlags;
  aaguid?: string;
  transports?: string[];
}

/**
 * A whole enrolment through the auth module's flows, as the console runs it on the harness's console: the options for
 * the link's token, the software authenticator's answer from the console's origin, and the verification. A device-bound,
 * user-verified security key unless told otherwise.
 */
export async function enrolKey(h: StaffFlowHarness, auth: SoftAuthenticator, token: string, options: EnrolOptions = {}) {
  const name = options.name ?? "Blue key";
  const { options: creation } = await enrollOptions(h.deps, { token, name, kind: options.kind ?? "security_key" });
  const response = auth.create({
    rpId: creation.rp.id!,
    challenge: creation.challenge,
    origin: h.deps.config.console!.origin,
    userHandle: Buffer.from(creation.user.id, "base64url"),
    flags: options.flags ?? DEVICE_BOUND,
    aaguid: options.aaguid,
    transports: options.transports ?? ["usb", "nfc"],
  });
  const requestId = `req-${randomUUID()}`;
  const { key } = await enrollVerify(h.deps, { token, name, response }, { ...h.ctx, requestId });
  return { key, credentialId: response.id, requestId };
}
```

### Replace `apps/api/test/integration/staff-fixtures.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { staffEnrollments, staffSessions, users, type Db, type DbTx } from "@korbat/db";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import type { AuthRepo } from "../../src/auth/repo";
import type { SoftFlags } from "../auth/soft-authenticator";
import { newUserWithDevice } from "./auth-fixtures";

/** The first row's prev_hash, and the hash of an empty log's head. */
export const ZERO_HASH = "0".repeat(64);

/** The console the staff harness runs, beside the app at http://localhost:8081 (3a design, section 12). */
export const TEST_CONSOLE_ORIGIN = "http://console.localhost:8090";
export const TEST_CONSOLE_RP_ID = "console.localhost";
/** The console as the flow harness takes it. */
export const TEST_CONSOLE = { origin: TEST_CONSOLE_ORIGIN, rpId: TEST_CONSOLE_RP_ID };

/** What a staff key's authenticator must report (3a design, section 2): user present and verified, neither backup eligible nor backed up. */
export const DEVICE_BOUND: SoftFlags = { up: true, uv: true, be: false, bs: false };

/** The PostgreSQL error a statement ended with (drizzle wraps it as the cause), or null when it succeeded. */
export async function pgError(statement: PromiseLike<unknown>): Promise<{ message: string; code: string } | null> {
  try {
    await statement;
    return null;
  } catch (err) {
    const cause = ((err as { cause?: unknown }).cause ?? err) as { message?: unknown; code?: unknown };
    return { message: String(cause.message ?? cause), code: String(cause.code ?? "") };
  }
}

/**
 * Runs fn in a transaction whose lock waits give up after 10 seconds. An audit insert holds the chain's head until its
 * transaction ends, so a test that holds a lock must never be able to hang the run on another one.
 */
export function withLockTimeout<T>(db: Db, fn: (tx: DbTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    return fn(tx);
  });
}

/** The same, always rolled back: for rows no later test may see, such as a chain broken on purpose. */
export async function rolledBack(db: Db, fn: (tx: DbTx) => Promise<void>): Promise<void> {
  const rollback = new Error("rolled back on purpose");
  const outcome = await withLockTimeout(db, async (tx) => {
    await fn(tx);
    throw rollback;
  }).then(
    () => null,
    (err: unknown) => err,
  );
  if (outcome !== rollback) throw outcome;
}

/** A live staff account with a handle (onboarded), as grant-role and onboarding leave it. */
export async function newStaffAccount(authDb: Db, repo: AuthRepo, role: "moderator" | "admin" = "moderator") {
  const { user, device } = await newUserWithDevice(repo);
  await authDb.update(users).set({ role, onboardedAt: new Date() }).where(eq(users.id, user.id));
  return { user: { ...user, role }, device };
}

/**
 * An enrolment as `staff.js enroll` issues it: inserted by the migrator, the only role that may, with only the sha256 of its
 * token kept. Valid 30 minutes unless told otherwise.
 */
export async function issueEnrolment(migrateDb: Db, userId: string, options: { expiresAt?: Date; origin?: string; rpId?: string } = {}) {
  const token = randomToken();
  const [row] = await migrateDb
    .insert(staffEnrollments)
    .values({
      userId,
      tokenHash: sha256Hex(token),
      origin: options.origin ?? TEST_CONSOLE_ORIGIN,
      rpId: options.rpId ?? TEST_CONSOLE_RP_ID,
      expiresAt: options.expiresAt ?? new Date(Date.now() + 30 * 60_000),
    })
    .returning({ id: staffEnrollments.id });
  return { id: row!.id, token };
}

export type TestStaffKey = { credentialId: string; publicKey: string; counter: number; transports: string[]; name: string; aaguid: string | null; requestId: string };

/**
 * Stores a staff key through auth.add_staff_key, as the enrolment flow's last statement will: the function spends the
 * enrolment the token names and writes the key's audit row, so it runs under a lock timeout. Its public key is a
 * placeholder; no test signs with it.
 */
export async function addStaffKey(db: Db, token: string, key: Partial<TestStaffKey> = {}) {
  const k: TestStaffKey = {
    credentialId: randomToken(16),
    publicKey: "cose-key",
    counter: 0,
    transports: ["usb", "nfc"],
    name: "Blue key",
    aaguid: randomUUID(),
    requestId: `req-${randomUUID()}`,
    ...key,
  };
  // A text[] literal such as {"usb","nfc"}: the transports are plain words, which JSON quotes as the array syntax wants.
  const transports = `{${k.transports.map((t) => JSON.stringify(t)).join(",")}}`;
  const [row] = await withLockTimeout(db, (tx) =>
    tx.execute<{ id: string }>(
      sql`select auth.add_staff_key(${token}::text, ${k.credentialId}::text, ${k.publicKey}::text, ${k.counter}::bigint, ${transports}::text[], ${k.name}::text, ${k.aaguid}::uuid, ${k.requestId}::text) as id`,
    ),
  );
  return { id: row!.id, ...k };
}

/** A staff account holding one live key, enrolled for the test console. */
export async function newStaffKey(authDb: Db, migrateDb: Db, repo: AuthRepo, role: "moderator" | "admin" = "moderator") {
  const account = await newStaffAccount(authDb, repo, role);
  const enrolment = await issueEnrolment(migrateDb, account.user.id);
  const key = await addStaffKey(authDb, enrolment.token);
  return { ...account, enrolment, key };
}

/**
 * A staff session row as the session store writes it at sign-in, opened with the account's own key for 12 hours and idle
 * after 15 minutes, written directly for suites that need a session without a sign-in. Inserted as the auth role, which
 * the running API holds and which may create staff sessions.
 */
export async function newStaffSession(authDb: Db, userId: string, keyId: string, now: Date = new Date()) {
  const [row] = await authDb
    .insert(staffSessions)
    .values({
      id: sha256Hex(randomToken()),
      userId,
      keyId,
      createdAt: now,
      lastUsedAt: now,
      idleExpiresAt: new Date(now.getTime() + 15 * 60_000),
      absoluteExpiresAt: new Date(now.getTime() + 12 * 60 * 60_000),
      browser: "Firefox on Linux",
    })
    .returning({ id: staffSessions.id, handle: staffSessions.handle });
  return row!;
}
```

### Replace `apps/api/test/staff/app-mount.test.ts` (whole file)

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { createDb } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createStaff } from "../../src/staff";

const key = Buffer.alloc(32, 7).toString("base64");
const APP_ORIGIN = "http://localhost:8081";
const TRUSTED = "http://localhost:8080";
const CONSOLE_ORIGIN = "http://console.localhost:8090";
const CONSOLE_HOST = "console.localhost:8090";
/** The staff prefix itself, with and without its final slash (distinct paths to Hono's router), and a path under it. */
const PROBE_PATHS = ["/api/staff", "/api/staff/", "/api/staff/probe"];

/**
 * createApp with the staff module (3a design, section 5), the console on or off. The pools are created but never connect:
 * nothing here reaches a flow. `probe` adds a stub route at each of PROBE_PATHS before the first request builds the router,
 * standing in for a route that needs no session, so a request that passes the gate can be told from one that does not: without a route
 * there, a wrong Host and a missing route both end in the same unknown-route 404, gate or no gate.
 */
function build(consoleOrigin: string | undefined, probe = false) {
  const config = loadConfig({
    DATABASE_URL_API: "postgres://a:b@localhost:55432/k",
    DATABASE_URL_AUTH: "postgres://a:b@localhost:55432/k",
    REDIS_URL: "redis://localhost:56379",
    APP_ORIGIN,
    TRUSTED_ORIGINS: TRUSTED,
    AUTH_HMAC_KEY: key,
    IP_HASH_KEY: key,
    TOTP_ENC_KEY: `v1:${key}`,
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    SMTP_URL: "smtp://localhost:1025",
    MAIL_FROM: "korbat <no-reply@korbat.local>",
    TERMS_VERSION: "draft-2026-09",
    ...(consoleOrigin === undefined ? {} : { CONSOLE_ORIGIN: consoleOrigin }),
  });
  const logger = pino({ level: "silent" });
  const auth = createAuth({
    config,
    logger,
    authDb: createDb(config.DATABASE_URL_AUTH, { max: 1 }),
    kv: new MemoryKv(),
    mailer: new MemoryMailer(),
    profiles: { create: async () => ({ ok: false, reason: "handle_taken" }), find: async () => null, setVerified: async () => undefined },
  });
  const staff = createStaff({ apiDb: createDb(config.DATABASE_URL_API, { max: 1 }), auth: auth.forStaff });
  const app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth, staff });
  const seen: { session: unknown; method: string; path: string }[] = [];
  if (probe) {
    app.on(["GET", "POST"], PROBE_PATHS, (c) => {
      seen.push({ session: c.get("session"), method: c.req.method, path: c.req.path });
      return c.json({ ok: true });
    });
  }
  return { app, seen, auth };
}

type ErrorBody = { error: { code: string; message: string; requestId?: string } };

const accessControlHeaders = (res: Response) => [...res.headers.keys()].filter((name) => name.startsWith("access-control-"));

describe("the staff module in createApp", () => {
  test("with CONSOLE_ORIGIN unset, every path under /api/staff is the unknown route, whatever the request carries", async () => {
    const { app } = build(undefined);
    const unknown = (await (await app.request("/api/nope")).json()) as ErrorBody;
    for (const [method, path, headers] of [
      ["GET", "/api/staff", { host: CONSOLE_HOST }],
      ["GET", "/api/staff/me", { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN }],
      // A write from a foreign origin would meet resolveSession's csrf_failed on any other path.
      ["POST", "/api/staff/signout", { host: CONSOLE_HOST, origin: "https://evil.example" }],
      // A preflight from an origin the app trusts would meet the app's CORS on any other path.
      ["OPTIONS", "/api/staff/me", { origin: TRUSTED, "access-control-request-method": "POST" }],
    ] as const) {
      const res = await app.request(path, { method, headers });
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(accessControlHeaders(res), `${method} ${path}`).toEqual([]);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(((await res.json()) as ErrorBody).error).toEqual({ ...unknown.error, requestId: res.headers.get("x-request-id") });
    }
  });

  test("with CONSOLE_ORIGIN set, the staff gate stands before every staff path, the prefix itself included", async () => {
    const { app, seen } = build(CONSOLE_ORIGIN, true);
    const unknown = (await (await app.request("/api/nope")).json()) as ErrorBody;
    // Another Host: the same 404 as an unknown route, so the console cannot tell a wrong address from a console that is off.
    // Each of these paths has a route, so the 404 is the gate's: for another host, the console's host without its port, and
    // no Host at all.
    for (const path of PROBE_PATHS) {
      for (const headers of [{ host: "localhost:8080" }, { host: "console.localhost" }, {}]) {
        const res = await app.request(path, { headers });
        expect(res.status, `${path} ${JSON.stringify(headers)}`).toBe(404);
        expect(((await res.json()) as ErrorBody).error).toEqual({ ...unknown.error, requestId: res.headers.get("x-request-id") });
      }
    }
    // The console's Host with another Origin: refused by the gate before any route runs.
    const foreign = await app.request("/api/staff/probe", { headers: { host: CONSOLE_HOST, origin: APP_ORIGIN } });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({ error: { code: "csrf_failed" } });
    expect(seen).toEqual([]);
    // Through the gate, a path no route answers is still the unknown route.
    expect((await app.request("/api/staff/nothing-here", { headers: { host: CONSOLE_HOST } })).status).toBe(404);
    // The console's Host reaches the route at every one of them, the prefix itself included.
    for (const path of PROBE_PATHS) expect((await app.request(path, { headers: { host: CONSOLE_HOST } })).status, path).toBe(200);
    expect(seen.map((request) => request.path)).toEqual(PROBE_PATHS);
  });

  test("a console write carrying the app's session and CSRF cookies reaches the staff route: the app's session is never resolved there", async () => {
    const { app, seen } = build(CONSOLE_ORIGIN, true);
    const res = await app.request("/api/staff/probe", {
      method: "POST",
      headers: {
        host: CONSOLE_HOST,
        origin: CONSOLE_ORIGIN,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        cookie: "__Host-korbat_session=not-a-session; __Host-korbat_csrf=abc",
        authorization: "Bearer not-a-token",
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(seen).toEqual([{ session: undefined, method: "POST", path: "/api/staff/probe" }]);
  });

  test("no staff answer carries CORS headers, even to an origin the app trusts; the app's other paths keep them", async () => {
    const { app } = build(CONSOLE_ORIGIN, true);
    for (const [method, headers] of [
      ["GET", { host: CONSOLE_HOST, origin: TRUSTED }],
      ["OPTIONS", { host: CONSOLE_HOST, origin: TRUSTED, "access-control-request-method": "POST" }],
      ["GET", { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN }],
    ] as const) {
      const res = await app.request("/api/staff/probe", { method, headers });
      expect(accessControlHeaders(res), `${method} ${headers.origin}`).toEqual([]);
    }
    // The one path test: /api/staff and what begins with /api/staff/, never a path that merely starts with the letters.
    const neighbour = await app.request("/api/staffing", { headers: { origin: TRUSTED } });
    expect(neighbour.status).toBe(404);
    expect(neighbour.headers.get("access-control-allow-origin")).toBe(TRUSTED);
    const health = await app.request("/api/health", { headers: { origin: TRUSTED } });
    expect(health.headers.get("access-control-allow-origin")).toBe(TRUSTED);
  });

  test("the enrolment routes stand behind the gate and validate their bodies before any flow runs", async () => {
    const { app } = build(CONSOLE_ORIGIN);
    for (const path of ["/api/staff/enroll/options", "/api/staff/enroll/verify"]) {
      const post = (headers: Record<string, string>, body: unknown) =>
        app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
      // Another Host is the unknown route, another Origin the gate's refusal, a write without an Origin too.
      expect((await post({ host: "localhost:8080", origin: CONSOLE_ORIGIN }, {})).status, path).toBe(404);
      const foreign = await post({ host: CONSOLE_HOST, origin: APP_ORIGIN }, {});
      expect([path, foreign.status, ((await foreign.json()) as ErrorBody).error.code]).toEqual([path, 403, "csrf_failed"]);
      expect((await post({ host: CONSOLE_HOST }, {})).status, path).toBe(403);
      // Through the gate, a body the contracts refuse is invalid_request; the pools behind the flows are never reached.
      const invalid = await post({ host: CONSOLE_HOST, origin: CONSOLE_ORIGIN }, { token: "short", name: "", kind: "phone" });
      expect([path, invalid.status, ((await invalid.json()) as ErrorBody).error.code]).toEqual([path, 400, "invalid_request"]);
    }
  });

  test("the session routes stand behind the gate and requireStaff: without a staff cookie each is staff_session_required with both staff cookies cleared, before any database read", async () => {
    // The pools point at a port nothing listens on: a route that read the database would fail with another answer.
    const { app } = build(CONSOLE_ORIGIN);
    const routes = [
      ["GET", "/api/staff/me"],
      ["GET", "/api/staff/sessions"],
      ["GET", "/api/staff/keys"],
      ["GET", "/api/staff/audit"],
      ["POST", "/api/staff/signout"],
    ] as const;
    for (const [method, path] of routes) {
      // Another Host is still the unknown route, before any session is looked for.
      expect((await app.request(path, { method, headers: { host: "localhost:8080", origin: CONSOLE_ORIGIN } })).status, path).toBe(404);
      // The app's session cookie and a bearer token are not staff sessions.
      const res = await app.request(path, {
        method,
        headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, cookie: "__Host-korbat_session=kb1_x; __Host-korbat_csrf=c", "x-csrf-token": "c", authorization: `Bearer kb1_${"A".repeat(43)}` },
      });
      expect([path, res.status, ((await res.json()) as ErrorBody).error.code]).toEqual([path, 401, "staff_session_required"]);
      const cleared = res.headers.getSetCookie();
      expect(cleared.map((line) => line.slice(0, line.indexOf("="))).sort(), path).toEqual(["__Host-korbat_staff", "__Host-korbat_staff_csrf"]);
      for (const line of cleared) expect(line, path).toContain("Max-Age=0");
      expect(accessControlHeaders(res), path).toEqual([]);
    }
  });

  test("a staff write with the staff cookie but without the staff CSRF header is csrf_failed, before any database read", async () => {
    const { app } = build(CONSOLE_ORIGIN);
    const res = await app.request("/api/staff/signout", { method: "POST", headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, cookie: "__Host-korbat_staff=x; __Host-korbat_staff_csrf=y" } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorBody).error.code).toBe("csrf_failed");
    // A refused write ends nothing: the cookies stay.
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  test("the sign-in options need no session and read no database: a staff sign-in challenge for discoverable, user-verified credentials of the console", async () => {
    const { app } = build(CONSOLE_ORIGIN);
    const res = await app.request("/api/staff/signin/options", { method: "POST", headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN } });
    expect(res.status).toBe(200);
    const { options } = (await res.json()) as { options: { rpId: string; challenge: string; allowCredentials?: unknown[]; userVerification: string } };
    expect(options.rpId).toBe("console.localhost");
    expect(options.allowCredentials ?? []).toEqual([]);
    expect(options.userVerification).toBe("required");
    expect(Buffer.from(options.challenge, "base64url")).toHaveLength(58);
    expect(res.headers.getSetCookie()).toEqual([]);
    // The verification validates its body before any flow runs.
    const invalid = await app.request("/api/staff/signin/verify", {
      method: "POST",
      headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ response: { id: "x" } }),
    });
    expect([invalid.status, ((await invalid.json()) as ErrorBody).error.code]).toEqual([400, "invalid_request"]);
  });

  test("no staff power remains in the app: the auth module offers no requireStaffMfa, and no source names it", () => {
    const { auth } = build(CONSOLE_ORIGIN);
    expect(Object.keys(auth)).not.toContain("requireStaffMfa");
    expect(Object.keys(auth)).toContain("requireStaff");
    const src = fileURLToPath(new URL("../../src", import.meta.url));
    const mentions = readdirSync(src, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".ts") && readFileSync(join(src, file), "utf8").includes("requireStaffMfa"));
    expect(mentions).toEqual([]);
  });

  test("staff paths keep the JSON body limit and the API's headers", async () => {
    const { app } = build(CONSOLE_ORIGIN, true);
    const res = await app.request("/api/staff/probe", {
      method: "POST",
      headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ x: "x".repeat(70_000) }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: "payload_too_large" } });
    const ok = await app.request("/api/staff/probe", { headers: { host: CONSOLE_HOST } });
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ok.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
```

### Replace `apps/api/test/staff/gate.test.ts` (whole file)

```ts
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth";
import type { AppEnv } from "../../src/env";
import { errorBody } from "../../src/lib/errors";
import { staffGate } from "../../src/staff/gate";

const CONSOLE_ORIGIN = "http://console.localhost:8090";
const CONSOLE_HOST = "console.localhost:8090";

/**
 * The staff gate (3a design, section 7) as a unit: a Hono app with one stub route behind it, answering an unknown route
 * and an AuthError as createApp does. The HTTP tests (http-staff-sessions.test.ts) take the gate through the app and its routes.
 */
function gated() {
  const app = new Hono<AppEnv>();
  const reached: string[] = [];
  app.use("/api/staff/*", staffGate(CONSOLE_ORIGIN));
  app.all("/api/staff/stub", (c) => {
    reached.push(c.req.method);
    return c.json({ ok: true });
  });
  app.notFound((c) => c.json(errorBody("not_found", "No such route"), 404));
  app.onError((err, c) => (err instanceof AuthError ? c.json(errorBody(err.code, err.message), err.status) : c.json(errorBody("internal", "Internal error"), 500)));
  const send = (method: string, headers: Record<string, string>) => app.request("/api/staff/stub", { method, headers });
  return { send, reached };
}

async function code(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe("the staff gate", () => {
  test("lets through a read from the console's host, with or without its Origin, and a write that carries it", async () => {
    const { send, reached } = gated();
    // Node's fetch, which the smoke test uses, sends neither Origin on a GET nor Sec-Fetch-Site.
    expect((await send("GET", { host: CONSOLE_HOST })).status).toBe(200);
    expect((await send("HEAD", { host: CONSOLE_HOST })).status).toBe(200);
    expect((await send("GET", { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, "sec-fetch-site": "same-origin" })).status).toBe(200);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect((await send(method, { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, "sec-fetch-site": "same-origin" })).status, method).toBe(200);
      expect((await send(method, { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN })).status, method).toBe(200);
    }
    expect(reached).toEqual(["GET", "HEAD", "GET", "POST", "POST", "PUT", "PUT", "PATCH", "PATCH", "DELETE", "DELETE"]);
  });

  test("answers another Host, port included, with the 404 of an unknown route, whatever else the request says", async () => {
    const { send, reached } = gated();
    const hosts = ["localhost:8090", "console.localhost", "console.localhost:8091", "localhost:8081", "evil.example", "console.localhost:8090.evil.example"];
    for (const host of hosts) {
      for (const method of ["GET", "POST"]) {
        const res = await send(method, { host, origin: CONSOLE_ORIGIN, "sec-fetch-site": "same-origin" });
        expect(res.status, `${method} ${host}`).toBe(404);
        expect(await code(res)).toBe("not_found");
      }
    }
    // No Host at all (an in-process request sets none), and the forwarded host a proxy might add, which is never read.
    expect((await send("GET", {})).status).toBe(404);
    expect((await send("GET", { host: "localhost:8081", "x-forwarded-host": CONSOLE_HOST })).status).toBe(404);
    // The Host test comes first: a foreign Host with a foreign Origin is still the unknown route, not a CSRF refusal.
    expect((await send("POST", { host: "evil.example", origin: "https://evil.example" })).status).toBe(404);
    expect(reached).toEqual([]);
  });

  test("refuses an Origin other than exactly the console's with csrf_failed, on every method", async () => {
    const { send, reached } = gated();
    const origins = ["http://localhost:8081", "http://localhost:8090", "http://console.localhost:8091", "https://console.localhost:8090", `${CONSOLE_ORIGIN}/`, "null"];
    for (const origin of origins) {
      for (const method of ["GET", "HEAD", "POST", "DELETE"]) {
        const res = await send(method, { host: CONSOLE_HOST, origin });
        expect(res.status, `${method} ${origin}`).toBe(403);
        if (method !== "HEAD") expect(await code(res)).toBe("csrf_failed");
      }
    }
    expect(reached).toEqual([]);
  });

  test("refuses a write without an Origin", async () => {
    const { send, reached } = gated();
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const res = await send(method, { host: CONSOLE_HOST, "sec-fetch-site": "same-origin" });
      expect(res.status, method).toBe(403);
      expect(await code(res)).toBe("csrf_failed");
    }
    expect(reached).toEqual([]);
  });

  test("refuses fetch metadata other than same-origin, even on a read with the console's Origin", async () => {
    const { send, reached } = gated();
    for (const site of ["same-site", "cross-site", "none", "SAME-ORIGIN"]) {
      for (const [method, headers] of [
        ["GET", {}],
        ["GET", { origin: CONSOLE_ORIGIN }],
        ["POST", { origin: CONSOLE_ORIGIN }],
      ] as const) {
        const res = await send(method, { host: CONSOLE_HOST, "sec-fetch-site": site, ...headers });
        expect(res.status, `${method} ${site}`).toBe(403);
        expect(await code(res)).toBe("csrf_failed");
      }
    }
    expect(reached).toEqual([]);
  });
});
```

### Replace `apps/app/test/passkeys.test.tsx` (whole file)

```tsx
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ReauthResponse, type MeResponse, type PasskeyView } from "@korbat/contracts";
import EmailRevert from "../src/app/email-revert/[token]";
import NotMe from "../src/app/not-me/[token]";
import PasskeyRemove from "../src/app/passkey-remove/[token]";
import { AddPasskeyDialog, PasskeyItem } from "../src/components/security/PasskeysSection";
import { methodsForLevel, panelStart, REENROLL_HINT, ReauthPanel, reauthNeeded, recoveryCodeSpent, ReenrollNotice, type Method } from "../src/components/security/ReauthPanel";
import { ApiError, apiResponse, messageFor } from "../src/lib/api";
import { AUTOFILL_RESTART_MS, createAutofillScheduler, SUGGESTION_SNOOZE_MS, suggestPasskey, type AutofillEffects } from "../src/lib/passkeys";
import { TERMS_SECTIONS } from "../src/lib/terms";

/**
 * The passkey screens (1c design, section 9): the sign-in autofill's schedule, the level-2 panel's choice, the home
 * card's rule and the messages are pure helpers and are called; the Security list's rows, the Add dialog and the
 * re-authentication panel are server-rendered as lifecycle.test.tsx renders the email-revert page; what a static
 * render cannot show (the sign-in screen's field and button, the pages' calls, the absence of the Signal API) is
 * read from the source, as a11y.test.tsx does.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");

/** The route parameters the page under test reads; each test sets them. */
const route = vi.hoisted(() => ({ params: {} as Record<string, string> }));

// expo-router cannot load in Node (it reaches React Native's own modules); Link with `asChild` hands the child its
// href, a page reads its route parameters, and nothing navigates in a static render.
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  router: { replace: () => undefined, push: () => undefined, setParams: () => undefined },
  useLocalSearchParams: () => route.params,
  useFocusEffect: () => undefined,
}));
// The panel and the pages read the session only to refresh it after their call; a static render never makes one.
vi.mock("@/lib/session", () => ({ useSession: () => ({ refresh: async () => undefined }) }));

const html = (element: ReactElement): string => renderToStaticMarkup(element);

const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

/** Every source line matching `pattern`, as `file:line`. */
function findInSource(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of readdirSync(SRC, { recursive: true, encoding: "utf8" })) {
    if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
    const lines = readFileSync(path.join(SRC, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      if (pattern.test(line)) found.push(`${file.split(path.sep).join("/")}:${index + 1}`);
    });
  }
  return found.sort();
}

const noop = async () => undefined;
const TOKEN = "A".repeat(20) + "b_-".repeat(7) + "z".repeat(2);

/** Effects the scheduler drives, recorded: the runs it started, the aborts it asked for, and the timers it set. */
function fakeEffects() {
  const started: number[] = [];
  let aborts = 0;
  const timers: { callback: () => void; ms: number; cancelled: boolean }[] = [];
  const effects: AutofillEffects = {
    start: (run) => started.push(run),
    abort: () => {
      aborts += 1;
    },
    after: (callback, ms) => {
      const timer = { callback, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  };
  return { effects, started, aborts: () => aborts, timers };
}

describe("the sign-in autofill's schedule", () => {
  test("starts one conditional request when the screen is focused, and never a second while it runs", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.focus();
    scheduler.focus();
    expect(fx.started).toEqual([1]);
    expect(scheduler.isCurrent(1)).toBe(true);
    // A challenge lives 10 minutes and conditional mediation ignores the ceremony's timeout, so the request is renewed before its challenge expires.
    expect(AUTOFILL_RESTART_MS).toBe(9 * 60 * 1000);
    expect(fx.timers.map((timer) => timer.ms)).toEqual([AUTOFILL_RESTART_MS]);
  });

  test("renews the request after 9 minutes: aborts it and starts another, and the old one's late ending changes nothing", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.focus();
    fx.timers[0]!.callback();
    expect(fx.aborts()).toBe(1);
    expect(fx.started).toEqual([1, 2]);
    expect(scheduler.isCurrent(1)).toBe(false);
    expect(scheduler.isCurrent(2)).toBe(true);
    scheduler.ended(1, "expired");
    scheduler.ended(1, "failed");
    expect(fx.started).toEqual([1, 2]);
    expect(scheduler.isCurrent(2)).toBe(true);
  });

  test("starts over after the API said the challenge expired, and stops after any other failure or a sign-in until the next focus", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.focus();
    scheduler.ended(1, "expired");
    expect(fx.started).toEqual([1, 2]);
    expect(fx.timers[0]!.cancelled).toBe(true);
    scheduler.ended(2, "failed");
    expect(fx.started).toEqual([1, 2]);
    expect(scheduler.isCurrent(2)).toBe(false);
    scheduler.focus();
    expect(fx.started).toEqual([1, 2, 3]);
    scheduler.ended(3, "done");
    expect(fx.started).toEqual([1, 2, 3]);
    expect(fx.timers.every((timer) => timer.cancelled)).toBe(true);
    expect(fx.aborts()).toBe(0);
  });

  test("aborts the request when the screen loses focus, and starts a new one when it is focused again", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.blur();
    expect(fx.aborts()).toBe(0);
    scheduler.focus();
    scheduler.blur();
    expect(fx.aborts()).toBe(1);
    expect(scheduler.isCurrent(1)).toBe(false);
    expect(fx.timers[0]!.cancelled).toBe(true);
    // The aborted request's own ending arrives later and starts nothing while the screen is away.
    scheduler.ended(1, "expired");
    expect(fx.started).toEqual([1]);
    scheduler.focus();
    expect(fx.started).toEqual([1, 2]);
  });

  test("holds while the button's own request runs: options fetched meanwhile start no ceremony, and it resumes afterwards if still focused", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.focus();
    scheduler.hold();
    expect(fx.aborts()).toBe(1);
    expect(scheduler.isCurrent(1)).toBe(false);
    scheduler.release();
    expect(fx.started).toEqual([1, 2]);
    scheduler.hold();
    scheduler.blur();
    scheduler.release();
    expect(fx.started).toEqual([1, 2]);
    scheduler.focus();
    expect(fx.started).toEqual([1, 2, 3]);
    // A hold with nothing running aborts nothing.
    scheduler.ended(3, "failed");
    scheduler.hold();
    expect(fx.aborts()).toBe(2);
  });

  test("does nothing once it is disposed, whatever comes after", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.focus();
    scheduler.dispose();
    expect(fx.aborts()).toBe(1);
    scheduler.focus();
    scheduler.release();
    scheduler.ended(1, "expired");
    expect(fx.started).toEqual([1]);
    expect(scheduler.isCurrent(1)).toBe(false);
  });
});

describe("the level-2 panel's choice from the factors the session proved", () => {
  const ALL: Method[] = ["password", "passkey", "totp", "email", "recovery"];

  test("level 1 offers every method the account has", () => {
    expect(methodsForLevel({ level: 1, have: [] }, ALL)).toEqual({ methods: ALL, missing: null });
    expect(methodsForLevel({ level: 1, have: ["email"] }, ["email"])).toEqual({ methods: ["email"], missing: null });
  });

  test("after a first factor, only a second one is offered: a passkey, an authenticator code or a recovery code", () => {
    for (const first of ["email", "password", "passkey"] as const) {
      expect(methodsForLevel({ level: 2, have: [first] }, ALL), first).toEqual({ methods: ["passkey", "totp", "recovery"], missing: "second" });
    }
  });

  test("with only a second factor, a first one is offered: the password, a passkey or an email code", () => {
    for (const second of ["totp", "recovery"] as const) {
      expect(methodsForLevel({ level: 2, have: [second] }, ALL), second).toEqual({ methods: ["password", "passkey", "email"], missing: "first" });
    }
  });

  test("with nothing proved in time, everything is offered", () => {
    expect(methodsForLevel({ level: 2, have: [] }, ALL)).toEqual({ methods: ALL, missing: null });
  });

  test("the account's own methods bound the choice, and a choice that would be empty falls back to all of them", () => {
    expect(methodsForLevel({ level: 2, have: ["password"] }, ["password", "totp", "email"])).toEqual({ methods: ["totp"], missing: "second" });
    expect(methodsForLevel({ level: 2, have: ["email"] }, ["password", "email"])).toEqual({ methods: ["password", "email"], missing: null });
  });

  test("the details of a refusal are read as the level and the factors, and anything else means level 1 with nothing proved", () => {
    expect(reauthNeeded(new ApiError(403, "reauth_required", "Confirm it's you to continue.", undefined, { level: 2, have: ["email", "totp"] }))).toEqual({ level: 2, have: ["email", "totp"] });
    expect(reauthNeeded(new ApiError(403, "reauth_required", "Confirm it's you to continue."))).toEqual({ level: 1, have: [] });
    expect(reauthNeeded(new ApiError(403, "reauth_required", "Confirm it's you to continue.", undefined, { level: 3, have: "email" }))).toEqual({ level: 1, have: [] });
  });
});

describe("the home screen's passkey suggestion", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.parse("2026-09-25T12:00:00Z");

  test("shows for an account without passkeys on a device with a built-in authenticator, unless Not now was chosen in the last 30 days", () => {
    expect(SUGGESTION_SNOOZE_MS).toBe(30 * DAY);
    expect(suggestPasskey({ passkeys: 0, platformAuthenticator: true, dismissedAt: null, now })).toBe(true);
    expect(suggestPasskey({ passkeys: 1, platformAuthenticator: true, dismissedAt: null, now })).toBe(false);
    expect(suggestPasskey({ passkeys: 0, platformAuthenticator: false, dismissedAt: null, now })).toBe(false);
    expect(suggestPasskey({ passkeys: 0, platformAuthenticator: true, dismissedAt: now - 29 * DAY, now })).toBe(false);
    expect(suggestPasskey({ passkeys: 0, platformAuthenticator: true, dismissedAt: now - 31 * DAY, now })).toBe(true);
    // A dismissal from the future (the clock moved) still counts as recent.
    expect(suggestPasskey({ passkeys: 0, platformAuthenticator: true, dismissedAt: now + DAY, now })).toBe(false);
  });
});

describe("the passkey messages", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("every new code has its sentence, and the daily bound says its wait in hours from the details", () => {
    expect(messageFor("passkey_invalid")).toBe("That passkey did not work. Try again or use your email.");
    expect(messageFor("passkey_unsupported")).toBe("This passkey provider is not supported. Try another one.");
    expect(messageFor("passkey_limit")).toBe("You have 10 passkeys. Remove one to add another.");
    expect(messageFor("passkey_limit", undefined, { reason: "cap" })).toBe("You have 10 passkeys. Remove one to add another.");
    expect(messageFor("passkey_limit", undefined, { reason: "daily", retryAfter: 7200 })).toBe("You added 5 passkeys today. You can add another in about 2 hours.");
    expect(messageFor("passkey_limit", undefined, { reason: "daily", retryAfter: 7201 })).toBe("You added 5 passkeys today. You can add another in about 3 hours.");
    expect(messageFor("passkey_limit", undefined, { reason: "daily", retryAfter: 1 })).toBe("You added 5 passkeys today. You can add another in about 1 hour.");
    expect(messageFor("passkey_suspended")).toBe("This passkey was switched off because a copy of it may exist. Remove it and add a new one.");
    expect(messageFor("challenge_expired")).toBe("That took too long. Try again.");
    expect(messageFor("passkey_not_found")).toBe("That passkey is gone.");
  });

  test("a refusal's details reach the error, and the daily bound is worded here from them rather than by the server", async () => {
    const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", answer(409, { error: { code: "passkey_limit", message: "server wording", details: { reason: "daily", retryAfter: 7200 } } }));
    await expect(apiResponse("/api/auth/passkeys/register/options", { json: { label: "alice" } })).rejects.toMatchObject({
      status: 409,
      code: "passkey_limit",
      message: "You added 5 passkeys today. You can add another in about 2 hours.",
      details: { reason: "daily", retryAfter: 7200 },
    });
    vi.stubGlobal("fetch", answer(403, { error: { code: "reauth_required", message: "Confirm it's you to continue.", details: { level: 2, have: ["password"] } } }));
    const refused = await apiResponse("/api/auth/passkeys/register/options", { json: { label: "alice" } }).catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(ApiError);
    expect(reauthNeeded(refused as ApiError)).toEqual({ level: 2, have: ["password"] });
    // The server's own wording still stands for every other code.
    vi.stubGlobal("fetch", answer(401, { error: { code: "passkey_invalid", message: "server wording" } }));
    await expect(apiResponse("/api/auth/passkey/signin/verify", { json: {} })).rejects.toMatchObject({ code: "passkey_invalid", message: "server wording", details: undefined });
  });
});

describe("the Security screen's passkeys", () => {
  const view = (extra: Partial<PasskeyView> = {}): PasskeyView => ({
    id: "0f7b3c2e-4a1d-4c6b-9e8f-1a2b3c4d5e6f",
    name: "Laptop",
    createdAt: "2026-09-20T10:00:00.000Z",
    lastUsedAt: null,
    synced: false,
    createdOn: "Chrome on Windows",
    current: false,
    isNew: false,
    suspended: false,
    ...extra,
  });
  const row = (passkey: PasskeyView) => html(<PasskeyItem passkey={passkey} busy={false} onRename={async () => true} onRemove={() => undefined} onNotMine={() => undefined} />);

  test("a row shows the name, when it was added and last used, and the device that added it", () => {
    const out = row(view());
    expect(out).toContain("Laptop");
    expect(out).toContain("added ");
    expect(out).toContain("never used");
    expect(out).toContain("added on Chrome on Windows");
    expect(out).toContain("Rename");
    expect(out).toContain("Remove");
    expect(out).not.toMatch(/This wasn(&#x27;|')t me/);
    expect(out).not.toContain('role="img"');
    const gone = row(view({ createdOn: null, lastUsedAt: "2026-09-25T10:00:00.000Z" }));
    expect(gone).toContain("last used ");
    expect(gone).not.toContain("never used");
    expect(gone).not.toContain("added on");
  });

  test("each tag names itself for a screen reader as an image, since ARIA lets no generic element carry a name", () => {
    const out = row(view({ current: true, isNew: true, suspended: true, synced: true }));
    for (const label of [
      "used for this session: it signed you in here",
      "new: added in the last 7 days",
      "suspended: switched off because a copy of it may exist",
      "synced: backed up by your password manager to your other devices",
    ]) {
      const tag = new RegExp(`<div[^>]*aria-label="${label}"[^>]*>`).exec(out)?.[0] ?? "";
      expect(tag, label).toContain('role="img"');
    }
    expect(out).toMatch(/This wasn(&#x27;|')t me/);
  });

  test("the Add dialog labels both fields, prefills the password manager's name with the handle and says what that name reveals", () => {
    const out = html(<AddPasskeyDialog handle="alice" busy={false} error={null} onCreate={noop} onCancel={() => undefined} />);
    expect(out).toContain('role="dialog"');
    expect(out).toMatch(/<input[^>]*aria-label="Name"[^>]*>/);
    const label = /<input[^>]*aria-label="Name in your password manager"[^>]*>/.exec(out)?.[0] ?? "";
    expect(label).toContain('value="alice"');
    expect(out).toContain("Your password manager shows this name to anyone who can see this device.");
    expect(out).toContain("Create passkey");
    expect(out).toContain("Cancel");
  });

  test("the screen shows the section, opens the Add dialog from the home card's link, and turns two-factor off without a code", () => {
    const security = read("app", "settings", "security.tsx");
    expect(security).toContain('<Section title="Passkeys">');
    expect(security).toContain('openAdd={add === "1"}');
    const mfa = read("components", "security", "MfaSection.tsx");
    expect(mfa).toContain('api("/api/auth/mfa/totp/disable", { json: {} })');
    expect(mfa).not.toMatch(/totp\/disable", \{ json: \{ code/);
    const home = read("app", "index.tsx");
    expect(home).toContain("<PasskeySuggestion");
    expect(home).toContain('router.push("/settings/security?add=1")');
  });

  test("a staff account without two-factor is told what it protects in the app, and that staff tools open only on the console with a staff key", () => {
    // 3a design, section 13, Task 4: two-factor in the app gives no staff power, so the sentence promises none.
    const mfa = read("components", "security", "MfaSection.tsx");
    expect(mfa).toContain(
      "Two-factor authentication is off. Turn it on so a leaked password or email alone can't open your account; on a staff account it then stays on. Staff tools are on the staff console and open only with a staff key.",
    );
    expect(mfa).not.toContain("before using staff tools");
  });
});

describe("the re-authentication panel", () => {
  const me: MeResponse = {
    user: { id: "0f7b3c2e-4a1d-4c6b-9e8f-1a2b3c4d5e6f", email: "alice@example.org", role: "user", onboarded: true, mfaEnabled: true, hasPassword: true, passkeys: 1 },
    profile: null,
  };
  /** The method chips, in order: each is a pressed or unpressed native button. */
  const chips = (out: string): string[] => [...out.matchAll(/<button[^>]*aria-pressed="(?:true|false)"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1] ?? "");

  test("offers the recovery code beside the other methods, and the passkey only in a browser that supports it, which Node is not", () => {
    const out = html(<ReauthPanel me={me} pending={{ action: noop, needed: { level: 1, have: [] } }} onClose={() => undefined} />);
    expect(chips(out)).toEqual(["Password", "Authenticator code", "Email code", "Recovery code"]);
    expect(out).not.toContain("This change needs two factors");
    const source = read("components", "security", "ReauthPanel.tsx");
    expect(source).toContain('label="Use a passkey"');
    expect(source).toContain('method: "passkey"');
    expect(source).toContain('method: "recovery"');
    expect(source).toContain("me.user.passkeys > 0 && passkeysSupported()");
  });

  test("at level 2 it says why and asks only for what is missing", () => {
    const out = html(<ReauthPanel me={me} pending={{ action: noop, needed: { level: 2, have: ["password"] } }} onClose={() => undefined} />);
    expect(out).toContain("This change needs two factors because two-factor authentication is on.");
    expect(chips(out)).toEqual(["Authenticator code", "Recovery code"]);
    const first = html(<ReauthPanel me={me} pending={{ action: noop, needed: { level: 2, have: ["totp"] } }} onClose={() => undefined} />);
    expect(chips(first)).toEqual(["Password", "Email code"]);
  });

  test("closing the panel never replaces the route, which would mount the screen anew and lose what the action just showed: the hint is a parameter set on the route the screen is on", () => {
    const source = read("components", "security", "ReauthPanel.tsx");
    // A replace builds a route with a new key: the new recovery codes, a setup's QR code and the flow id of a mailed code would go with the old one.
    expect(source).not.toMatch(/router\.(replace|push|navigate)\(/);
    expect(source.match(/router\.setParams\(\{ reenroll: "1" \}\)/g)).toHaveLength(1);
    // Security reads the parameter where it stands and hands it to the two-factor section; Account and Profile show the notice.
    const security = read("app", "settings", "security.tsx");
    expect(security).toContain("useLocalSearchParams<{ reenroll?: string; add?: string }>()");
    expect(security).toContain('reenroll={reenroll === "1"}');
    for (const screen of ["account.tsx", "profile.tsx"]) expect(read("app", "settings", screen), screen).toContain("<ReenrollNotice me={me} />");
  });

  test("on a screen without a two-factor section the hint is a notice with a link to Security, shown when the parameter is set and two-factor is on", () => {
    route.params = { reenroll: "1" };
    const out = html(<ReenrollNotice me={me} />);
    expect(out).toContain(REENROLL_HINT);
    expect(out).toMatch(/<a[^>]*href="\/settings\/security\?reenroll=1"[^>]*>/);
    // One sentence on the three screens: Security's own, which its two-factor section shows.
    expect(REENROLL_HINT).toBe("You used a recovery code. Set up two-factor again to get a fresh set of codes.");
    expect(read("components", "security", "MfaSection.tsx")).toContain(REENROLL_HINT);
    route.params = {};
    expect(html(<ReenrollNotice me={me} />)).toBe("");
    route.params = { reenroll: "0" };
    expect(html(<ReenrollNotice me={me} />)).toBe("");
    // Without two-factor there is nothing to set up again, as on Security.
    route.params = { reenroll: "1" };
    expect(html(<ReenrollNotice me={{ ...me, user: { ...me.user, mfaEnabled: false } }} />)).toBe("");
    route.params = {};
  });

  test("a spent recovery code is remembered for the panel's life: whichever answer carried it, and whether or not the action then went through, the panel closes with the hint", () => {
    const spent = (answers: unknown[]): boolean => answers.map((answer) => ReauthResponse.parse(answer)).reduce(recoveryCodeSpent, false);
    // At level 2 with nothing proved in time: the recovery code first, after which the action is refused again, then the password.
    expect(spent([{ level: 1, mustReenrollMfa: true }, { level: 2 }])).toBe(true);
    // The password first, then the recovery code.
    expect(spent([{ level: 1 }, { level: 2, mustReenrollMfa: true }])).toBe(true);
    // A recovery code, after which the action fails for a reason of its own: the panel stays open with the error and closes by Cancel.
    expect(spent([{ level: 2, mustReenrollMfa: true }])).toBe(true);
    // No recovery code, no hint.
    expect(spent([{ level: 1 }, { level: 2 }])).toBe(false);
    expect(spent([{ level: 2, mustReenrollMfa: false }])).toBe(false);
    expect(spent([])).toBe(false);

    const source = read("components", "security", "ReauthPanel.tsx");
    // Held in a ref, which outlives one answer, and read from every answer before the action runs.
    expect(source).toContain("const recoveryUsed = useRef(false);");
    expect(source).toContain("recoveryUsed.current = recoveryCodeSpent(recoveryUsed.current, result);");
    expect(source.indexOf("recoveryUsed.current = recoveryCodeSpent(")).toBeLessThan(source.indexOf("await pending.action();"));
    // Acted on in one place, which both ways out of the panel go through: the action that went through, and Cancel.
    expect(source).toMatch(/function close\(\) \{\s*onClose\(\);\s*if \(recoveryUsed\.current\) router\.setParams\(\{ reenroll: "1" \}\);\s*\}/);
    expect(source).toContain('<Button label="Cancel" onPress={close} tone="secondary" />');
    expect(source.match(/^\s*close\(\);$/gm)).toHaveLength(1);
    expect(source).not.toMatch(/onPress=\{onClose\}/);
    expect(source.match(/\bonClose\(\)/g)).toHaveLength(1);
  });

  test("the panel follows the refusal it is answering: when another action's refusal replaces the one it shows, it starts over from what that one needs", () => {
    const available: Method[] = ["password", "totp", "email", "recovery"];
    // A level-2 action refused after the password: the two-factor sentence, and second factors only.
    expect(methodsForLevel({ level: 2, have: ["password"] }, available)).toEqual({ methods: ["totp", "recovery"], missing: "second" });
    expect(panelStart({ level: 2, have: ["password"] }, available)).toEqual({ needed: { level: 2, have: ["password"] }, method: "totp", value: "", flowId: null, error: null });
    // "This wasn't me" or "Sign out everywhere" refused while that panel is open: level 1 with nothing proved in time, so
    // every method the account has, the password and the email code among them, and nothing typed, mailed or refused yet.
    expect(methodsForLevel({ level: 1, have: [] }, available)).toEqual({ methods: available, missing: null });
    expect(panelStart({ level: 1, have: [] }, available)).toEqual({ needed: { level: 1, have: [] }, method: "password", value: "", flowId: null, error: null });

    const source = read("components", "security", "ReauthPanel.tsx");
    // The panel is one instance whatever refusal it shows (the screens give it no key), so it compares the refusal it
    // started from with the one it is given, and starts over when they differ.
    expect(source).toContain("const [asked, setAsked] = useState(pending);");
    const reset = /if \(asked !== pending\) \{([^}]*)\}/.exec(source)?.[1] ?? "";
    for (const line of ["const next = panelStart(pending.needed, available);", "setAsked(pending);", "setNeeded(next.needed);", "setMethod(next.method);", "setValue(next.value);", "setFlowId(next.flowId);", "setError(next.error);"]) {
      expect(reset, line).toContain(line);
    }
    // The focus moves to the panel for every refusal, not only the first.
    expect(source).toMatch(/\.focus\?\.\(\);\s*\}, \[pending\]\);/);
    for (const screen of ["security.tsx", "account.tsx", "profile.tsx"]) {
      expect(read("app", "settings", screen), screen).toContain("{reauth.pending ? <ReauthPanel me={me} pending={reauth.pending} onClose={reauth.clear} /> : null}");
    }
  });
});

describe("the sign-in screen", () => {
  const signin = read("app", "(auth)", "signin.tsx");

  test("the email field carries the autofill pair, and the passkey button sends the response with the device fields the password sign-in sends", () => {
    expect(signin).toContain('const EMAIL_AUTOFILL = "email webauthn" as unknown as TextInputProps["autoComplete"];');
    expect(signin).toMatch(/<Field label="Email" autoComplete=\{EMAIL_AUTOFILL\}/);
    expect(signin).toContain('label="Sign in with a passkey"');
    expect(signin).toContain('api("/api/auth/passkey/signin/verify", { json: { response, deviceId: deviceId(), platform }, schema: SignInResponse })');
    expect(signin).toContain('router.replace("/mfa")');
  });

  test("one controller owns the conditional request: focus and blur drive it, and unmounting disposes of it", () => {
    expect(signin).toContain("createAutofillScheduler(");
    expect(signin).toContain("useFocusEffect(");
    expect(signin).toMatch(/scheduler\.blur\(\)/);
    expect(signin).toMatch(/scheduler\.dispose\(\)/);
    expect(signin).toMatch(/scheduler\.hold\(\)/);
  });

  test("no screen calls the Signal API, which deletes other accounts' passkeys on Safari", () => {
    expect(findInSource(/signalUnknownCredential|signalAllAcceptedCredentials|signalCurrentUserDetails|sendSignal\(/)).toEqual([]);
  });
});

describe("the pages behind the links", () => {
  /** The opening tag of the button whose text is `label`, or "" when there is none. */
  const buttonTag = (markup: string, label: string): string => {
    const at = markup.indexOf(label);
    const role = at === -1 ? -1 : markup.lastIndexOf('role="button"', at);
    return role === -1 ? "" : markup.slice(markup.lastIndexOf("<", role), markup.indexOf(">", role) + 1);
  };
  // The lockdown reaches from the day before its anchor to the moment it runs, which can be a week later: "since", never "in".
  const LOCKDOWN = /passkeys and two-factor authentication set up since the day before/;
  /** A page before the confirmation and after it: the second render starts from the state the confirmation leaves. */
  const sentences = (source: string): string[] => source.replace(/\s+/g, " ").match(/[^.]*set up (?:since|in) the day before[^.;]*/g) ?? [];

  test("the passkey-remove page explains the lockdown, confirms, and offers the button only with the link's token", () => {
    route.params = { token: TOKEN };
    const out = html(<PasskeyRemove />);
    const label = "Remove the passkey and lock down my account";
    expect(out).toContain(label);
    expect(out).toMatch(/sign(s|ed)? out every session/i);
    expect(out).toMatch(LOCKDOWN);
    expect(buttonTag(out, label)).not.toBe("");
    expect(buttonTag(out, label)).not.toContain('aria-disabled="true"');
    expect(out).not.toContain('role="alert"');
    for (const token of ["", "short", "A".repeat(42) + "/"]) {
      route.params = { token };
      const bad = html(<PasskeyRemove />);
      expect(bad, token).toContain('role="alert"');
      expect(bad, token).toMatch(/link is incomplete/);
      expect(buttonTag(bad, label), token).toContain('aria-disabled="true"');
    }
    const source = read("app", "passkey-remove", "[token].tsx");
    expect(source).toContain('api("/api/auth/passkeys/remove-link", { json: { token } })');
    expect(source).toMatch(/router\.replace\("\/signin"\)/);
  });

  test("the not-me and email-undo pages describe the lockdown: every session out, the password removed, and what was set up since the day before", () => {
    route.params = { token: TOKEN };
    for (const [name, page] of [
      ["not-me", <NotMe />],
      ["email-revert", <EmailRevert />],
    ] as const) {
      const out = html(page);
      expect(out, name).toMatch(/sign(s|ed)? out every session/i);
      expect(out, name).toMatch(/remove (your|any) password/i);
      expect(out, name).toMatch(LOCKDOWN);
    }
  });

  test("every explanation of the lockdown names its reach as it is, before the confirmation and after it: what was set up since the day before, the person's own later additions included", () => {
    const anchors = { "passkey-remove": "it was added", "not-me": "that sign-in", "email-revert": "the change" };
    for (const [page, anchor] of Object.entries(anchors)) {
      const found = sentences(read("app", page, "[token].tsx"));
      // Twice on each page: what confirming will do, and what it did.
      expect(found, page).toHaveLength(2);
      for (const sentence of found) expect(sentence, page).toContain(`passkeys and two-factor authentication set up since the day before ${anchor}`);
    }
    // The dialog behind "This wasn't me", whose passkey can be a week old by then.
    const dialog = sentences(read("components", "security", "PasskeysSection.tsx"));
    expect(dialog).toHaveLength(1);
    expect(dialog[0]).toContain("every passkey and two-factor authentication set up since the day before this passkey was added is removed, including any you set up yourself after it");
    // Nowhere does the app say "in the day before", which names one day of what can be eight.
    expect(findInSource(/in the day before/)).toEqual([]);
  });
});

describe("the terms", () => {
  test("say what a passkey keeps on the server and that nothing about fingerprints or faces leaves the device", () => {
    const body = TERMS_SECTIONS.find((section) => section.title === "Your data")?.body ?? "";
    expect(body).toMatch(/passkey/);
    expect(body).toMatch(/public key/);
    expect(body).toMatch(/the device that added it/);
    expect(body).toMatch(/fingerprint/);
    expect(body).toMatch(/face/);
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
packages/rules test:       Tests  4 passed (4)
packages/contracts test:       Tests  131 passed (131)
packages/db test:       Tests  40 passed (40)
packages/media-protocol test:       Tests  21 passed (21)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/staff-console-3a/write_blocks.py docs/superpowers/prompts/staff-console-3a/04-staff-sign-in-sessions.md 3
```

Expected: 16 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/auth/staff/cookies.ts`

```ts
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomToken, safeEqual } from "../crypto";

/**
 * The staff console's cookies (3a design, sections 2 and 7), sent as `__Host-korbat_staff` and `__Host-korbat_staff_csrf`:
 * names of their own, so neither is ever read as the app's, and SameSite=Strict, so no other site's page sends them. In
 * development the app and the console share the host localhost and so each other's cookies; the names, the staff gate
 * and the staff CSRF header keep them apart there. requireStaff is the only reader of the session cookie.
 */
export const STAFF_SESSION_COOKIE = "korbat_staff";
export const STAFF_CSRF_COOKIE = "korbat_staff_csrf";
/** The header the console echoes the staff CSRF cookie in; never the app's x-csrf-token. */
export const STAFF_CSRF_HEADER = "x-staff-csrf";

/**
 * Both cookies last the session's absolute limit, 12 hours, and are never refreshed: the server holds the idle limit, and a
 * cookie that outlived its session would only be refused at its next request.
 */
export const STAFF_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

const staffCookie = { path: "/", secure: true, sameSite: "Strict", prefix: "host" } as const;

/** Issues the HttpOnly session cookie and a fresh CSRF cookie the console's page can read, at sign-in only. */
export function setStaffCookies(c: Context, token: string): void {
  setCookie(c, STAFF_SESSION_COOKIE, token, { ...staffCookie, httpOnly: true, maxAge: STAFF_COOKIE_MAX_AGE_SECONDS });
  setCookie(c, STAFF_CSRF_COOKIE, randomToken(32), { ...staffCookie, httpOnly: false, maxAge: STAFF_COOKIE_MAX_AGE_SECONDS });
}

/** Expires both, at sign-out and whenever a staff session is refused, so the console shows its sign-in. */
export function clearStaffCookies(c: Context): void {
  deleteCookie(c, STAFF_SESSION_COOKIE, staffCookie);
  deleteCookie(c, STAFF_CSRF_COOKIE, staffCookie);
}

/** The staff session's token from its `__Host-` cookie; never a bearer token, never the app's session cookie. */
export function readStaffCookie(c: Context): string | undefined {
  return getCookie(c, STAFF_SESSION_COOKIE, "host");
}

/**
 * The double submit for a staff write: the x-staff-csrf header must equal the staff CSRF cookie. The Origin was checked by
 * the staff gate before this runs, so only the console's own page, which can read the cookie, passes.
 */
export function checkStaffCsrf(c: Context): boolean {
  const cookie = getCookie(c, STAFF_CSRF_COOKIE, "host");
  const header = c.req.header(STAFF_CSRF_HEADER);
  return Boolean(cookie && header && safeEqual(cookie, header));
}
```

### Create `apps/api/src/auth/staff/middleware.ts`

```ts
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../../env";
import { errorBody } from "../../lib/errors";
import { authErrorMessage, type AuthDeps } from "../context";
import { checkStaffCsrf, clearStaffCookies, readStaffCookie } from "./cookies";
import { resolveStaffSession } from "./sessions";

/**
 * The mark the console sends on a request its person's action started (a click, a submitted form, opening a screen), and
 * on no other: only such a request moves the idle end. It governs the console's own requests; it is no defence against a
 * script in the page, which the console's policy and the step-up answer.
 */
export const STAFF_ACTIVITY_HEADER = "x-staff-activity";

const SAFE_METHODS = new Set(["GET", "HEAD"]);

/**
 * Every staff route that needs a session stands behind this, after the staff gate (3a design, section 7, Every staff
 * request). It reads the staff cookie only, never a bearer token or the app's session cookie. A write (anything but GET
 * and HEAD) must carry the x-staff-csrf header equal to the staff CSRF cookie, checked before the session is read, so a
 * refused write moves nothing. The session is then read from the database, joined to its key and its account, and a
 * marked request slides its idle end in the same statement. Without a live session the answer is 401
 * staff_session_required with both staff cookies cleared, which the console answers with its sign-in.
 */
export function requireStaff(deps: AuthDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const ended = () => {
      clearStaffCookies(c);
      return c.json(errorBody("staff_session_required", authErrorMessage("staff_session_required"), c.get("requestId")), 401);
    };
    const token = readStaffCookie(c);
    if (!token) return ended();
    if (!SAFE_METHODS.has(c.req.method) && !checkStaffCsrf(c)) {
      return c.json(errorBody("csrf_failed", authErrorMessage("csrf_failed"), c.get("requestId")), 403);
    }
    const session = await resolveStaffSession(deps, token, c.req.header(STAFF_ACTIVITY_HEADER) === "1");
    if (!session) return ended();
    c.set("staffSession", session);
    await next();
  });
}
```

### Create `apps/api/src/auth/staff/revoke.ts`

```ts
import type { Mailer } from "../../mail/mailer";
import { SYSTEM_ACTOR_ID } from "../admin";
import { AuthError, type AuthDeps, type StaffRequestContext } from "../context";
import { noticeTime, notifyAccount } from "../flows/notify";
import type { AuthRepo, StaffKeysRevoked } from "../repo";

/**
 * Revoking staff keys (3a design, section 7). The command line's `staff.js revoke` and the counter rule share one routine,
 * repo.revokeStaffKeys: the account's row locked first, the keys and every staff session they opened revoked, an event per
 * key and the audit rows last, all in one auth transaction. The counter rule also marks the key suspect and records the
 * regression as such. Only the command line enrols a replacement.
 */

/**
 * A staff key's counter went backwards after its signature verified: the key is revoked and marked suspect, every live
 * staff session it opened revoked, staff_key_counter_regression recorded with its audit row, then its owner is mailed
 * staff_key_suspect (never 1c's passkey_suspect, whose remedy names the app's Security screen) and the attempt refused with
 * staff_key_suspended. A key that another revocation reached first, or whose account went meanwhile, is refused as any
 * revoked key is, with staff_key_invalid.
 */
export async function revokeForCounterRegression(deps: AuthDeps, key: { id: string; userId: string; name: string }, ctx: StaffRequestContext): Promise<never> {
  const revoked = await deps.repo.revokeStaffKeys({
    account: { id: key.userId },
    key: key.id,
    suspect: true,
    via: "sign_in",
    // The key's holder presented it, so the row is the account's; the request's id ties it to the access log.
    actorId: key.userId,
    now: deps.now(),
    requestId: ctx.requestId,
  });
  if (!revoked.ok || revoked.keys.length === 0) throw new AuthError("staff_key_invalid", 401);
  // After the commit, and best effort as every notice is: a failed mail never undoes the revocation.
  await notifyAccount(deps, revoked.email, "staff_key_suspect", { name: key.name });
  throw new AuthError("staff_key_suspended", 403);
}

/** What `staff.js revoke` did, or why it found nothing to act on, and why its mail failed when it did. */
export type StaffKeysRevokedReport = (StaffKeysRevoked & { ok: false }) | (Extract<StaffKeysRevoked, { ok: true }> & { mailError: string | null });

/**
 * `staff.js revoke <email> <key id>` and `revoke <email> all`, from the server's command line only: the routine above with
 * the server as the actor, then, after the commit and only when a key was revoked, the owner is mailed the names of the
 * keys revoked (an enrolment link cancelled alone sends nothing, as with grant-role). The mail is best effort: one that
 * fails is reported to the caller and undoes nothing.
 */
export async function revokeStaffKeys(deps: { repo: AuthRepo; mailer: Mailer }, email: string, key: string | "all"): Promise<StaffKeysRevokedReport> {
  const now = new Date();
  const revoked = await deps.repo.revokeStaffKeys({ account: { email }, key, suspect: false, via: "cli", actorId: SYSTEM_ACTOR_ID, now });
  if (!revoked.ok) return revoked;
  let mailError: string | null = null;
  if (revoked.keys.length > 0) {
    try {
      await deps.mailer.send({
        to: revoked.email,
        template: "staff_keys_revoked",
        data: { names: revoked.keys.map((k) => `"${k.name}"`).join(", "), time: noticeTime(now) },
      });
    } catch (err) {
      mailError = err instanceof Error ? err.message : String(err);
    }
  }
  return { ...revoked, mailError };
}
```

### Create `apps/api/src/auth/staff/sessions.ts`

```ts
import type { StaffKeysResponse, StaffMe, StaffRole, StaffSessionsResponse } from "@korbat/contracts";
import type { AuthDeps, StaffRequestContext } from "../context";
import { randomToken, sha256Hex } from "../crypto";
import { HOUR, MINUTE } from "../limits";
import type { StaffSessionRow } from "../repo";

/**
 * The staff session store (3a design, sections 2 and 7). Staff sessions live in auth.staff_sessions, apart from the app's
 * sessions, and are read from the database on every request: nothing here caches them, so nothing needs a tombstone, and a
 * revocation, a demotion, a deletion or a suspect key ends a session at its next request. A session lasts 12 hours at most
 * and ends 15 minutes after its person's last action in the console, never after a request the page sent by itself.
 */

/** The idle limit, counted from the last request a person's action started (X-Staff-Activity: 1). */
export const STAFF_IDLE_MS = 15 * MINUTE;
/** The absolute limit, which nothing moves; the database also keeps a row within 12 hours of its creation. */
export const STAFF_ABSOLUTE_MS = 12 * HOUR;

/** A live staff session as requireStaff hands it to the staff routes. Its token is never kept; `sessionId` is its sha256. */
export interface ActiveStaffSession {
  sessionId: string;
  /** The session's random id for life: the console lists and revokes sessions by it, and the audit rows name it. */
  handle: string;
  userId: string;
  /** The staff key that opened the session. */
  keyId: string;
  role: StaffRole;
  createdAt: Date;
  lastUsedAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  /** The coarse label deviceLabel gave the browser that signed in. */
  browser: string;
}

// The read answers only an account whose role is not user, so the role is a staff role.
const fromRow = (row: StaffSessionRow): ActiveStaffSession => ({
  sessionId: row.id,
  handle: row.handle,
  userId: row.userId,
  keyId: row.keyId,
  role: row.role as StaffRole,
  createdAt: row.createdAt,
  lastUsedAt: row.lastUsedAt,
  idleExpiresAt: row.idleExpiresAt,
  absoluteExpiresAt: row.absoluteExpiresAt,
  browser: row.browser,
});

/** What a sign-in that verified hands the session: the key that signed, its account's role and the counter it reported. */
export interface StaffSessionOpening {
  userId: string;
  keyId: string;
  role: StaffRole;
  newCounter: number;
  browser: string;
}

/**
 * Opens a staff session for a verified sign-in: a new opaque token, whose sha256 alone is stored, 15 minutes idle and
 * 12 hours absolute from the flows' clock. The key's counter rule, the session, its event and its audit row are one
 * transaction (repo.openStaffSession). Null when the key's counter did not move forward or the key was revoked
 * meanwhile, which the sign-in tells apart.
 */
export async function openStaffSession(deps: AuthDeps, opening: StaffSessionOpening, ctx: StaffRequestContext): Promise<{ token: string; session: ActiveStaffSession } | null> {
  const now = deps.now();
  const token = randomToken(32);
  const id = sha256Hex(token);
  const idleExpiresAt = new Date(now.getTime() + STAFF_IDLE_MS);
  const absoluteExpiresAt = new Date(now.getTime() + STAFF_ABSOLUTE_MS);
  const opened = await deps.repo.openStaffSession({
    id,
    userId: opening.userId,
    keyId: opening.keyId,
    newCounter: opening.newCounter,
    now,
    idleExpiresAt,
    absoluteExpiresAt,
    browser: opening.browser,
    ipHash: ctx.ipHash,
    requestId: ctx.requestId,
  });
  if (!opened) return null;
  const session: ActiveStaffSession = {
    sessionId: id,
    handle: opened.handle,
    userId: opening.userId,
    keyId: opening.keyId,
    role: opening.role,
    createdAt: now,
    lastUsedAt: now,
    idleExpiresAt,
    absoluteExpiresAt,
    browser: opening.browser,
  };
  return { token, session };
}

/**
 * The live session a staff cookie's token names, or null. `activity` is true for a request its person's action started:
 * only then does the same statement that reads the session move its last use to now and its idle end to 15 minutes from
 * now, never past its absolute end.
 */
export async function resolveStaffSession(deps: AuthDeps, token: string, activity: boolean): Promise<ActiveStaffSession | null> {
  const now = deps.now();
  const row = await deps.repo.resolveStaffSession(sha256Hex(token), now, activity ? new Date(now.getTime() + STAFF_IDLE_MS) : null);
  return row ? fromRow(row) : null;
}

/** Whole seconds until `at` by the flows' clock, never below zero, so the console's idle timer needs no clock of its own. */
function secondsUntil(deps: AuthDeps, at: Date): number {
  return Math.max(0, Math.floor((at.getTime() - deps.now().getTime()) / 1000));
}

/**
 * GET /api/staff/me, and the sign-in's answer: the account's public handle (the console names staff by it), its role, the
 * session's handle (step-up challenges bind to it) and both ends with the seconds left. The handle comes from the profile
 * store, which the API supplies; a staff account always has one, since enrolment needs it, so a missing profile reads as
 * an empty handle rather than an error that would lock its person out.
 */
export async function staffMe(deps: AuthDeps, session: ActiveStaffSession): Promise<StaffMe> {
  const profile = await deps.profiles.find(session.userId);
  return {
    handle: profile?.handle ?? "",
    role: session.role,
    sessionHandle: session.handle,
    idleExpiresAt: session.idleExpiresAt.toISOString(),
    idleSecondsLeft: secondsUntil(deps, session.idleExpiresAt),
    absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
    absoluteSecondsLeft: secondsUntil(deps, session.absoluteExpiresAt),
  };
}

/** GET /api/staff/sessions: the person's own live staff sessions, the asking one marked; never another account's. */
export async function listStaffSessions(deps: AuthDeps, session: ActiveStaffSession): Promise<StaffSessionsResponse> {
  const rows = await deps.repo.listStaffSessions(session.userId, deps.now());
  return {
    sessions: rows.map((row) => ({
      handle: row.handle,
      browser: row.browser,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
      current: row.handle === session.handle,
    })),
  };
}

/** GET /api/staff/keys: the person's own live staff keys, by name and dates only. */
export async function listStaffKeys(deps: AuthDeps, session: ActiveStaffSession): Promise<StaffKeysResponse> {
  const rows = await deps.repo.listStaffKeyViews(session.userId);
  return { keys: rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.createdAt.toISOString(), lastUsedAt: row.lastUsedAt?.toISOString() ?? null })) };
}

/**
 * POST /api/staff/signout: ends this session with its staff_signed_out event and audit row, in one transaction. No mail:
 * the person did it themselves. A session another request ended first is gone all the same, so that is no error.
 */
export async function signOutStaff(deps: AuthDeps, session: ActiveStaffSession, ctx: StaffRequestContext): Promise<void> {
  await deps.repo.endStaffSession({ id: session.sessionId, userId: session.userId, keyId: session.keyId, now: deps.now(), ipHash: ctx.ipHash, requestId: ctx.requestId });
}
```

### Create `apps/api/src/auth/staff/signin.ts`

```ts
import type { StaffMe, StaffRole, StaffSignInVerifyRequest } from "@korbat/contracts";
import { AuthError, type AuthDeps, type StaffRequestContext } from "../context";
import { deviceLabel } from "../devices";
import { noticeTime, notifyAccount } from "../flows/notify";
import { HOUR, enforceLimit } from "../limits";
import { challengeKey, issueChallenge, readChallenge, spendChallenge } from "../passkeys/challenge";
import { authenticationOptions, readResponseChallenge, verifyAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "../passkeys/webauthn";
import { consoleOf } from "./enroll";
import { revokeForCounterRegression } from "./revoke";
import { openStaffSession, staffMe } from "./sessions";

/**
 * The staff sign-in (3a design, section 7, Sign-in). The console asks for options, the browser offers the staff keys it
 * holds for the console's relying party, and the answer opens a staff session. Only a live staff key of a live staff
 * account opens one, and only when its authenticator reported user verification and neither backup eligibility nor a
 * backup at this use. The routes live in the staff module, behind the staff gate; the credential work is here.
 */

/** Sign-in attempts per client address an hour, counted before anything else. */
export const STAFF_SIGNIN_PER_IP_PER_HOUR = 20;
/** Sign-ins per staff key an hour, counted only once its signature and flags have checked, so only its holder spends them. */
export const STAFF_SIGNIN_PER_KEY_PER_HOUR = 10;

/** The one answer for every failure up to and including the signature, so no answer tells a live key from a revoked or unknown one. */
const keyInvalid = () => new AuthError("staff_key_invalid", 401);

/** Runs one step of the codec or the wrapper, answering its passkey_* refusals with staff_key_invalid; challenge_expired stays, and the console starts over on it. */
async function invalidAsStaff<T>(step: () => T | Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (err) {
    if (err instanceof AuthError && (err.code === "passkey_invalid" || err.code === "passkey_unsupported")) throw keyInvalid();
    throw err;
  }
}

/** What a sign-in hands the staff route: the session's token, for the cookie, and the answer /me would give. */
export interface StaffSignedIn {
  token: string;
  me: StaffMe;
}

/**
 * Options for a staff sign-in: an empty allow list, so the options name no account and the browser offers every
 * discoverable credential it holds for the console's relying party; user verification required; and a staff sign-in
 * challenge bound to nothing, which no other ceremony accepts. Handing them out stores nothing.
 */
export async function signInOptions(deps: AuthDeps): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }> {
  const staffConsole = consoleOf(deps);
  const challenge = issueChallenge(challengeKey(deps.config.authHmacKey), "staff_signin", deps.now());
  const options = await authenticationOptions({ rpId: staffConsole.rpId, allow: [], challenge, userVerification: "required" });
  return { options };
}

/**
 * Verifies a staff sign-in. The per-address limit is counted first. The challenge is read from the response and spent
 * before anything else runs, so a forged, foreign or spent one never reaches the library. Then the key must be a live
 * staff key of a live staff account, and the response must carry that account's user handle, since the allow list named
 * no one (as 1c's sign-in requires). Every failure so far, and a response the library refuses on its signature, its origin
 * (CONSOLE_ORIGIN alone) or its relying party (CONSOLE_RP_ID alone), is staff_key_invalid. Only after the signature are the
 * flags read, each refusal with its own code; then the per-key limit is counted, so an unsigned response naming a key's
 * credential id cannot lock its owner out; then 1c's counter rule, in the session's own transaction, where a regression
 * revokes the key. The session is mailed to its owner after the commit.
 */
export async function signInVerify(deps: AuthDeps, input: StaffSignInVerifyRequest, ctx: StaffRequestContext): Promise<StaffSignedIn> {
  await enforceLimit(deps.kv, `staff-signin:ip:${ctx.ipHash}`, STAFF_SIGNIN_PER_IP_PER_HOUR, HOUR);
  const staffConsole = consoleOf(deps);
  const now = deps.now();
  const challenge = await invalidAsStaff(() => readResponseChallenge(input.response));
  await invalidAsStaff(() => readChallenge(challengeKey(deps.config.authHmacKey), challenge, "staff_signin", now));
  await invalidAsStaff(() => spendChallenge(deps.kv, challenge, now));

  const key = await deps.repo.findStaffKeyForSignIn(input.response.id);
  // An unknown or revoked key, and an account that is deleted or no longer staff, are one answer. In development, where
  // the console's relying party ID is the app's, a personal passkey the browser offers here is refused by this lookup alone.
  if (!key || key.revokedAt !== null || key.deletedAt !== null || key.role === "user") throw keyInvalid();
  const userHandle = input.response.response.userHandle;
  if (userHandle === undefined || key.webauthnUserId === null || !Buffer.from(userHandle, "base64url").equals(key.webauthnUserId)) throw keyInvalid();

  const verified = await invalidAsStaff(() =>
    verifyAuthentication({
      response: input.response,
      expectedChallenge: challenge,
      origins: [staffConsole.origin],
      rpId: staffConsole.rpId,
      credential: { id: key.credentialId, publicKey: key.publicKey, transports: key.transports },
    }),
  );
  // After the signature only, so each refusal is a claim the key itself signed. WebAuthn L3 asks a relying party that uses
  // BE in its policy to check it on every assertion, and BS as well, since a key can be synced after it was registered.
  if (!verified.userVerified) throw new AuthError("staff_key_not_user_verified", 403);
  if (verified.backupEligible || verified.backedUp) throw new AuthError("staff_key_not_device_bound", 403);
  await enforceLimit(deps.kv, `staff-signin:key:${key.id}`, STAFF_SIGNIN_PER_KEY_PER_HOUR, HOUR);

  const browser = deviceLabel(ctx.userAgent, "web");
  const role = key.role as StaffRole;
  const opened = await openStaffSession(deps, { userId: key.userId, keyId: key.id, role, newCounter: verified.newCounter, browser }, ctx);
  // Null when the key's counter did not move forward (or another revocation reached the key first): it is revoked now.
  if (!opened) return revokeForCounterRegression(deps, key, ctx);
  const { token, session } = opened;
  // After the commit, and best effort as every notice is: a failed mail never undoes a sign-in.
  await notifyAccount(deps, key.email, "staff_session_started", { name: key.name, browser, time: noticeTime(session.createdAt) });
  return { token, me: await staffMe(deps, session) };
}
```

### Replace `apps/api/src/auth/index.ts` (whole file)

```ts
/**
 * The only file outside `src/auth/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type {
  DeleteConfirmRequest,
  DeleteStartResponse,
  StaffEnrollOptionsRequest,
  StaffEnrollVerifyRequest,
  StaffEnrollVerifyResponse,
  StaffKeysResponse,
  StaffMe,
  StaffSessionsResponse,
  StaffSignInVerifyRequest,
} from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type { MiddlewareHandler } from "hono";
import type Redis from "ioredis";
import type { Logger } from "pino";
import type { Config } from "../config";
import type { AppEnv } from "../env";
import type { Mailer } from "../mail/mailer";
import { clientIdentity } from "./client-ip";
import { authConfigFrom, type AuthDeps, type ProfileStore, type RequestContext, type StaffRequestContext } from "./context";
import { confirmDeletion, finishPurge, startDeletion } from "./flows/deletion";
import { exportAccount, type AccountExport } from "./flows/export";
import { redisKv, type KeyValueStore } from "./kv";
import { createLockout } from "./lockout";
import { requireFreshAuth, requireOnboarding, requireSession, requireStrongFreshAuth, resolveSession } from "./middleware";
import type { JobLock } from "../lib/jobs";
import { createJanitor } from "./janitor";
import { hibpChecker, type BreachChecker } from "./passwords";
import { createAuthRepo, type AuthEventType } from "./repo";
import { authRoutes, meHandler } from "./routes";
import { createSessions, type Session } from "./sessions";
import type { PublicKeyCredentialRequestOptionsJSON } from "./passkeys/webauthn";
import { enrollOptions, enrollVerify, type StaffEnrollOptions } from "./staff/enroll";
import { requireStaff } from "./staff/middleware";
import { listStaffKeys, listStaffSessions, signOutStaff, staffMe, type ActiveStaffSession } from "./staff/sessions";
import { signInOptions, signInVerify, type StaffSignedIn } from "./staff/signin";
import { cloudflareTurnstile, type TurnstileVerifier } from "./turnstile";
import { devProvider } from "./verify/dev";
import type { VerificationProvider } from "./verify/provider";
import { vonageProvider } from "./verify/vonage";

export type { ProfileStore, RequestContext, StaffRequestContext } from "./context";
export type { AccountExport } from "./flows/export";
export type { AuthEventType, UserRole } from "./repo";
export type { ProxyTrust } from "./client-ip";
export type { Session } from "./sessions";
export type { ActiveStaffSession } from "./staff/sessions";
export type { StaffSignedIn } from "./staff/signin";
export type { StaffKeysRevokedReport } from "./staff/revoke";
export type { VerificationProvider } from "./verify/provider";
export { AuthError, isUniqueViolation } from "./context";
export { SYSTEM_ACTOR_ID, grantRole } from "./admin";
/** The account module clears a web session's cookies after a deletion; the cookie names and attributes stay this module's. */
export { clearSessionCookies } from "./cookies";
/**
 * The staff module's sign-in and sign-out routes set and clear the staff cookies (3a design, section 5); their names and
 * attributes stay this module's, and requireStaff is their only reader.
 */
export { clearStaffCookies, setStaffCookies } from "./staff/cookies";
/** `staff.js revoke`, from the server's command line only, as grant-role's grantRole is. */
export { revokeStaffKeys } from "./staff/revoke";
export { checkHandle } from "./handles";
export { redisKv, type KeyValueStore } from "./kv";
export { createAuthRepo } from "./repo";
export { createSessions } from "./sessions";

/**
 * What the account module needs from this one (1b design, section 5): the auth side of a deletion
 * (the code, the confirmation that takes the account down, the purge's list and its last step), the
 * auth side of the data export, and the event log for what the account module does.
 */
export interface AuthForAccount {
  /** Mails the deletion code to the account's own address and answers the flow id. */
  startDeletion(session: Session, ctx: RequestContext): Promise<DeleteStartResponse>;
  /** Checks the typed handle and the code, then marks the account deleted and revokes every session, in one transaction: from here the account is gone. */
  confirmDeletion(session: Session, input: DeleteConfirmRequest): Promise<void>;
  /** Deleted accounts whose auth row is not anonymised yet, oldest deletion first. */
  pendingPurges(): Promise<string[]>;
  /** Finishes step 1's rows if a take-down stopped after the mark, then anonymises the auth row and marks it purged; a no-op when it already is. */
  finishPurge(userId: string): Promise<void>;
  /** The account's facts, its passkeys (without their keys), its live sessions, its devices and its own events. */
  exportAccount(userId: string): Promise<AccountExport>;
  appendEvent(userId: string, type: AuthEventType, metadata?: Record<string, unknown>): Promise<void>;
}

/**
 * What the staff module needs from this one (3a design, section 5): the credential side of the staff routes, which the
 * staff module mounts behind its gate. Staff keys, staff sessions and enrolments are credentials, so their flows and
 * tables stay here, and the staff module reaches them only through this interface.
 */
export interface AuthForStaff {
  /** Registration options for the key an enrolment link's holder is about to create. */
  enrollOptions(input: StaffEnrollOptionsRequest): Promise<StaffEnrollOptions>;
  /** Checks the browser's answer and stores the staff key, spending the link; the owner is mailed. */
  enrollVerify(input: StaffEnrollVerifyRequest, ctx: StaffRequestContext): Promise<StaffEnrollVerifyResponse>;
  /** Discoverable-credential options for a staff sign-in. */
  signInOptions(): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }>;
  /** Checks a staff key's assertion and opens a staff session; the route sets its cookies with setStaffCookies. */
  signInVerify(input: StaffSignInVerifyRequest, ctx: StaffRequestContext): Promise<StaffSignedIn>;
  /** Stands before every staff route that needs a session: reads it and sets `staffSession` on the context. */
  requireStaff: MiddlewareHandler<AppEnv>;
  /** The session's account and both its ends, with the seconds left. */
  me(session: ActiveStaffSession): Promise<StaffMe>;
  /** The person's own live staff sessions. */
  sessions(session: ActiveStaffSession): Promise<StaffSessionsResponse>;
  /** The person's own live staff keys. */
  keys(session: ActiveStaffSession): Promise<StaffKeysResponse>;
  /** Ends the session, on the record; the route clears its cookies with clearStaffCookies. */
  signOut(session: ActiveStaffSession, ctx: StaffRequestContext): Promise<void>;
}

export interface CreateAuthOptions {
  config: Config;
  logger: Logger;
  /** The korbat_auth pool. The auth module never receives the API pool. */
  authDb: Db;
  mailer: Mailer;
  profiles: ProfileStore;
  /** Either a Redis client or a ready key-value store (tests use an in-memory store). */
  redis?: Redis;
  kv?: KeyValueStore;
  turnstile?: TurnstileVerifier;
  breachChecker?: BreachChecker;
  /**
   * The phone verification provider behind the verified badge. Absent or null, the badge routes answer
   * badge_unavailable; the server passes verificationProviderFrom(config), tests the development provider.
   */
  verify?: VerificationProvider | null;
  now?: () => Date;
}

/**
 * The provider VERIFY_PROVIDER names: none for `off` (the badge is hidden), the fixed-code one for `dev`,
 * Vonage Verify with the configured credentials and brand for `vonage`. `fetchFn` is for tests only.
 */
export function verificationProviderFrom(config: Config, fetchFn?: typeof fetch): VerificationProvider | null {
  switch (config.VERIFY_PROVIDER) {
    case "off":
      return null;
    case "dev":
      return devProvider();
    case "vonage":
      // Production refuses this configuration in config.ts; development gets the same refusal here, at start-up, rather than a failing first request.
      if (!config.VONAGE_API_KEY || !config.VONAGE_API_SECRET) throw new Error("VERIFY_PROVIDER=vonage needs VONAGE_API_KEY and VONAGE_API_SECRET");
      return vonageProvider({ apiKey: config.VONAGE_API_KEY, apiSecret: config.VONAGE_API_SECRET, brand: config.VERIFY_BRAND, fetch: fetchFn });
  }
}

export function createAuth(options: CreateAuthOptions) {
  const kv = options.kv ?? (options.redis ? redisKv(options.redis) : undefined);
  if (!kv) throw new Error("createAuth needs a Redis client or a key-value store");
  const now = options.now ?? (() => new Date());
  const repo = createAuthRepo(options.authDb);
  const sessions = createSessions({ repo, kv, now });
  const deps: AuthDeps = {
    repo,
    kv,
    sessions,
    lockout: createLockout({ repo, kv, now }),
    mailer: options.mailer,
    turnstile: options.turnstile ?? cloudflareTurnstile(options.config.TURNSTILE_SECRET_KEY),
    breachChecker: options.breachChecker ?? hibpChecker(),
    profiles: options.profiles,
    verify: options.verify ?? null,
    config: authConfigFrom(options.config),
    log: options.logger,
    now,
  };
  /** A security event about an account, for the modules that own no auth table (the social module's profile and handle changes, the account module's export). */
  const appendEvent = (userId: string, type: AuthEventType, metadata?: Record<string, unknown>) => repo.appendEvent({ userId, type, metadata });
  const forAccount: AuthForAccount = {
    startDeletion: (session, ctx) => startDeletion(deps, session, ctx),
    confirmDeletion: (session, input) => confirmDeletion(deps, session, input),
    pendingPurges: () => repo.pendingPurges(),
    finishPurge: (userId) => finishPurge(deps, userId),
    exportAccount: (userId) => exportAccount(deps, userId),
    appendEvent,
  };
  const staffGuard = requireStaff(deps);
  const forStaff: AuthForStaff = {
    enrollOptions: (input) => enrollOptions(deps, input),
    enrollVerify: (input, ctx) => enrollVerify(deps, input, ctx),
    signInOptions: () => signInOptions(deps),
    signInVerify: (input, ctx) => signInVerify(deps, input, ctx),
    requireStaff: staffGuard,
    me: (session) => staffMe(deps, session),
    sessions: (session) => listStaffSessions(deps, session),
    keys: (session) => listStaffKeys(deps, session),
    signOut: (session, ctx) => signOutStaff(deps, session, ctx),
  };
  return {
    deps,
    routes: authRoutes(deps),
    me: meHandler(deps),
    appendEvent,
    /** The interface the account module uses. */
    forAccount,
    /** The interface the staff module uses. */
    forStaff,
    /** Runs first on every request: resolves the client address the way TRUST_PROXY says and hashes it. */
    clientIdentity: clientIdentity({ trust: deps.config.trustProxy, ipHashKey: deps.config.ipHashKey }),
    resolveSession: resolveSession(deps),
    requireSession,
    requireOnboarding,
    requireFreshAuth: (maxAgeSeconds?: number) => requireFreshAuth(deps, maxAgeSeconds),
    /** Level 2 within the window on an account with TOTP, level 1 otherwise: for the routes of the 1c design's section 10. */
    requireStrongFreshAuth: (maxAgeSeconds?: number) => requireStrongFreshAuth(deps, maxAgeSeconds),
    /** A staff session from the staff cookie, read from the database at every request (3a design, section 7). */
    requireStaff: staffGuard,
    /** Starts the retention pass (dead codes, old sessions and staff sessions, spent enrolment links, device address hashes, old events) and returns the function that stops it. */
    startJanitor: (lock: JobLock) => createJanitor(deps, lock).start(),
  };
}

export type Auth = ReturnType<typeof createAuth>;
```

### Replace `apps/api/src/auth/janitor.ts` (whole file)

```ts
import { createJob, type JobLock } from "../lib/jobs";
import type { AuthDeps } from "./context";
import { HOUR, MINUTE } from "./limits";

const DAY = 24 * HOUR;

export const JANITOR_INTERVAL_MS = 10 * MINUTE;
/** A code is dead ten minutes after it was sent; the row goes a day later. */
export const EMAIL_CODE_RETENTION_MS = 24 * HOUR;
/** Revoked and expired sessions stay listed nowhere; the rows go after a month. */
export const SESSION_RETENTION_MS = 30 * DAY;
/** The design's IP-hash purge (section 3b): a device keeps its address hash for 30 days after it was last seen. */
export const DEVICE_IP_RETENTION_DAYS = 30;
/** The security log is kept for 90 days. */
export const EVENT_RETENTION_DAYS = 90;
/** Staff sessions go as the app's sessions do, a month after they were revoked or expired (3a design, section 7). */
export const STAFF_SESSION_RETENTION_MS = 30 * DAY;
/** Enrolment links go as email codes do, a day after they were used or expired; one that can still enrol is never the janitor's. */
export const STAFF_ENROLLMENT_RETENTION_MS = 24 * HOUR;

export interface JanitorReport {
  emailCodes: number;
  sessions: number;
  staffSessions: number;
  staffEnrollments: number;
  deviceIpHashes: number;
  events: number;
}

/** One pass of retention. A plain function of the clock, so tests call it with whatever time they need. */
export async function janitor(deps: AuthDeps, now: Date): Promise<JanitorReport> {
  const report: JanitorReport = {
    emailCodes: await deps.repo.purgeEmailCodes(new Date(now.getTime() - EMAIL_CODE_RETENTION_MS)),
    sessions: await deps.repo.purgeSessions(new Date(now.getTime() - SESSION_RETENTION_MS)),
    // Staff keys are never deleted: audit-verify checks old confirmations against them, and audit rows name them.
    staffSessions: await deps.repo.purgeStaffSessions(new Date(now.getTime() - STAFF_SESSION_RETENTION_MS)),
    staffEnrollments: await deps.repo.purgeStaffEnrollments(new Date(now.getTime() - STAFF_ENROLLMENT_RETENTION_MS)),
    deviceIpHashes: await deps.repo.purgeDeviceIpHashes(new Date(now.getTime() - DEVICE_IP_RETENTION_DAYS * DAY)),
    events: await deps.repo.purgeEvents(EVENT_RETENTION_DAYS),
  };
  if (Object.values(report).some((n) => n > 0)) deps.log.info(report, "auth janitor: rows purged");
  return report;
}

/** Runs the pass every ten minutes under the shared lock. */
export function createJanitor(deps: AuthDeps, lock: JobLock) {
  return createJob({ name: "auth-janitor", intervalMs: JANITOR_INTERVAL_MS, lockTtlMs: JANITOR_INTERVAL_MS, lock, log: deps.log, run: () => janitor(deps, deps.now()) });
}
```

### Replace `apps/api/src/auth/middleware.ts` (whole file)

```ts
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";
import { authErrorMessage, type AuthDeps } from "./context";
import { bearerToken, checkCsrf, readSessionCookie, refreshSessionCookies } from "./cookies";
import { SESSION_IDLE_MS, type ReauthNeeded } from "./sessions";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Runs on every request. Refuses state-changing requests whose Origin is not allowed, resolves the
 * session from a bearer token (native) or the `__Host-` cookie (web), and requires the CSRF token on
 * cookie-authenticated state changes. Sets `session` and `authVia` on the context.
 */
export function resolveSession(deps: AuthDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    c.set("session", null);
    c.set("authVia", null);
    const stateChanging = !SAFE_METHODS.has(c.req.method);
    const origin = c.req.header("origin");
    if (stateChanging && origin && !deps.config.allowedOrigins.includes(origin)) {
      return c.json(errorBody("csrf_failed", authErrorMessage("csrf_failed"), c.get("requestId")), 403);
    }

    const bearer = bearerToken(c);
    const token = bearer ?? readSessionCookie(c);
    if (token) {
      const resolved = await deps.sessions.resolve(token);
      if (resolved) {
        if (!bearer && stateChanging && !checkCsrf(c, deps.config.allowedOrigins)) {
          return c.json(errorBody("csrf_failed", authErrorMessage("csrf_failed"), c.get("requestId")), 403);
        }
        c.set("session", resolved.session);
        c.set("authVia", bearer ? "bearer" : "cookie");
        if (resolved.slid && !bearer) refreshSessionCookies(c, token, Math.floor(SESSION_IDLE_MS / 1000));
      }
    }
    await next();
  });
}

/** Any signed-in session, including one whose account has not chosen a handle yet. */
export const requireOnboarding = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("session")) return c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);
  await next();
});

/** A signed-in session whose account has finished onboarding. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = c.get("session");
  if (!session) return c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);
  if (!session.onboarded) return c.json(errorBody("onboarding_required", authErrorMessage("onboarding_required"), c.get("requestId")), 403);
  await next();
});

/** The refusal both freshness guards answer: the level the route asks for and the factors proven in time, so the app can ask for what is missing. */
const reauthRequired = (c: Context<AppEnv>, needed: ReauthNeeded) => c.json(errorBody("reauth_required", authErrorMessage("reauth_required"), c.get("requestId"), needed), 403);

/** The session proved a factor within the last `maxAgeSeconds` (300, five minutes, by default): level 1. */
export function requireFreshAuth(deps: AuthDeps, maxAgeSeconds?: number) {
  const windowMs = maxAgeSeconds === undefined ? undefined : maxAgeSeconds * 1000;
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = c.get("session");
    if (!session) return c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);
    const needed = deps.sessions.reauthNeeded(session, 1, windowMs);
    if (needed) return reauthRequired(c, needed);
    await next();
  });
}

/**
 * Level 2 within the window when the account has TOTP (a second factor beside a first, or a user-verified passkey), and
 * level 1 otherwise: what the routes of the 1c design's section 10 ask for.
 */
export function requireStrongFreshAuth(deps: AuthDeps, maxAgeSeconds?: number) {
  const windowMs = maxAgeSeconds === undefined ? undefined : maxAgeSeconds * 1000;
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = c.get("session");
    if (!session) return c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);
    const needed = deps.sessions.reauthNeeded(session, deps.sessions.requiredLevel(session), windowMs);
    if (needed) return reauthRequired(c, needed);
    await next();
  });
}
```

### Replace `apps/api/src/auth/repo.ts` (whole file)

```ts
import { and, asc, desc, eq, getTableColumns, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import {
  authEventType,
  authEvents,
  devices,
  emailCodePurpose,
  emailCodes,
  passkeys,
  sessions,
  staffEnrollments,
  staffKeys,
  staffSessions,
  userRole,
  users,
  type Db,
} from "@korbat/db";
import { SYSTEM_ACTOR_ID } from "./admin";

/**
 * Every SQL statement the auth module runs. It receives only the korbat_auth pool and touches only
 * tables in the `auth` schema. Single-use and replay rules are enforced with conditional updates so
 * two concurrent requests cannot both succeed.
 */

export type UserRow = typeof users.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type EmailCodeRow = typeof emailCodes.$inferSelect;
export type AuthEventType = (typeof authEventType.enumValues)[number];
export type EmailCodePurpose = (typeof emailCodePurpose.enumValues)[number];
export type UserRole = (typeof userRole.enumValues)[number];
export type PasskeyRow = typeof passkeys.$inferSelect;
/** A passkey with the label of the device that added it, null once that device is gone. */
export type PasskeyListRow = PasskeyRow & { createdOn: string | null };
/** What a registration stores of a verified passkey; the id, the last use and the suspicion are the row's own. */
export type NewPasskey = Omit<PasskeyRow, "id" | "lastUsedAt" | "suspectAt">;

/** The per-account bounds a registration checks in its transaction (1c design, section 2): at most `passkeys` at a time, and `additions` within `windowMs`. */
export interface PasskeyLimits {
  passkeys: number;
  additions: number;
  windowMs: number;
}

/** What addPasskey answers: the row it inserted; which bound refused it, with the seconds until the day has a slot again; or that the account is gone. */
export type AddPasskeyOutcome =
  | { ok: true; passkey: PasskeyRow }
  | { ok: false; reason: "gone" }
  | { ok: false; reason: "cap" }
  | { ok: false; reason: "daily"; retryAfterSeconds: number };

/** What the lockdown's transaction is told (1c design, sections 2 and 7.6); the flow works it out from the caller's anchor. */
export interface LockDownInput {
  /** The flows' clock, for the revocations and the password's change time. */
  now: Date;
  /** How far back the lockdown reaches: passkeys created at or after this go, and two-factor enabled at or after it is turned off. */
  since: Date;
  /** Passkeys to remove whatever their age: the one that signed in, or the one a link is about. */
  passkeyIds: readonly string[];
  /** The caller's event, recorded in the same transaction with what the lockdown did added to its metadata. */
  event: { type: AuthEventType; deviceId: string | null; ipHash: string | null; metadata: Record<string, unknown> };
}

/** What a lockdown did: the ids of the sessions it revoked, for the cache tombstones, the passkeys it removed, and whether it turned two-factor off. */
export interface LockDownOutcome {
  sessionIds: string[];
  passkeysRemoved: string[];
  totpCleared: boolean;
}

export interface ActiveSessionRow {
  id: string;
  userId: string;
  deviceId: string;
  role: UserRole;
  onboardedAt: Date | null;
  totpEnabledAt: Date | null;
  reauthAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  /** The session's id for life, which a rotation keeps. */
  handle: string;
  /** The factors proven, kind to epoch milliseconds; empty for a session from before migration 0010. */
  factors: Record<string, number>;
  passkeyId: string | null;
}

/** A staff enrolment found by its token, with what the enrolment flow checks of its account (3a design, section 7). */
export interface StaffEnrollmentRow {
  id: string;
  userId: string;
  origin: string;
  rpId: string;
  expiresAt: Date;
  usedAt: Date | null;
  email: string;
  role: UserRole;
  deletedAt: Date | null;
  onboardedAt: Date | null;
  webauthnUserId: Buffer | null;
}

/** What the enrolment flow stores of a verified staff key; auth.add_staff_key copies the origin and relying party ID from the enrolment. */
export interface NewStaffKey {
  userId: string;
  enrollmentId: string;
  /** The link's token itself: the function hashes it, so a hash read from the table spends nothing. */
  token: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  name: string;
  aaguid: string;
  requestId: string;
}

/** What addStaffKey answers: the new key's id, or which of auth.add_staff_key's re-checks refused it. */
export type AddStaffKeyOutcome = { ok: true; keyId: string } | { ok: false; reason: "enrollment_invalid" | "limit" };

/** A staff key as the console's sign-in finds it by its credential id, with what the flow checks of its account. */
export interface StaffKeyForSignIn {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  transports: string[];
  name: string;
  revokedAt: Date | null;
  email: string;
  role: UserRole;
  deletedAt: Date | null;
  webauthnUserId: Buffer | null;
}

/** What a staff sign-in's transaction writes (3a design, section 7, Sign-in): the key's use, the session, its event and its audit row. */
export interface NewStaffSession {
  /** sha256 of the token; the token itself is never stored. */
  id: string;
  userId: string;
  keyId: string;
  /** The counter the verified assertion reported, which the key's row takes only if it moved forward. */
  newCounter: number;
  now: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  browser: string;
  ipHash: string | null;
  requestId: string;
}

/** A live staff session as requireStaff reads it, with its account's role, in one statement joined to its key and its account. */
export interface StaffSessionRow {
  id: string;
  handle: string;
  userId: string;
  keyId: string;
  role: UserRole;
  createdAt: Date;
  lastUsedAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  browser: string;
}

/**
 * A revocation of staff keys in one auth transaction (3a design, section 7): `staff.js revoke` with one key or `all`, and the
 * counter rule's revocation of the key that went backwards, which also marks it suspect and records its own event. The
 * account is named by its id (the counter rule knows it) or by its address (the command line).
 */
export interface StaffKeyRevocation {
  account: { id: string } | { email: string };
  key: string | "all";
  suspect: boolean;
  /** Where it came from, as the events and audit rows record it. The command line also waits at most 10 seconds for a lock. */
  via: "cli" | "sign_in";
  actorId: string;
  now: Date;
  requestId?: string | null;
}

/** What a revocation did, for the command line's report and the mail; or why it found nothing to act on. */
export type StaffKeysRevoked =
  | {
      ok: true;
      userId: string;
      /** The account's address as stored, which the mail goes to. */
      email: string;
      /** The keys revoked now, oldest first, each with how many of its staff sessions were revoked now. */
      keys: { id: string; name: string; sessionsRevoked: number }[];
      staffSessionsRevoked: number;
      enrollmentsCancelled: number;
      /** For one key named by the command line: when it was revoked before, in which case nothing changed. */
      alreadyRevokedAt: Date | null;
    }
  | { ok: false; reason: "no_account" | "no_key" };

/** A role change as it committed: what it revoked and deleted, for the cache tombstones, the command's report and the mail. */
export interface RoleChange {
  userId: string;
  /** The account's address as stored, which the staff_keys_revoked mail goes to. */
  email: string;
  previousRole: UserRole;
  /** The revoked app sessions' ids, for the cache tombstones. */
  sessionIds: string[];
  staffSessionsRevoked: number;
  enrollmentsDeleted: number;
  /** The staff keys revoked by a change to user, oldest first. */
  keysRevoked: { id: string; name: string }[];
}

export interface SessionListRow {
  /** The hash of the session's token, which its cached copy is keyed by; it changes when the token rotates and is never shown to a client. */
  id: string;
  /** The session's id for life: what the list shows, and what the targeted revoke takes. */
  handle: string;
  deviceLabel: string | null;
  platform: string;
  createdAt: Date;
  lastUsedAt: Date;
}

export function createAuthRepo(db: Db) {
  return {
    // ------------------------------------------------------------ users

    async findUserByEmail(email: string): Promise<UserRow | undefined> {
      const [row] = await db
        .select()
        .from(users)
        .where(and(sql`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)))
        .limit(1);
      return row;
    },

    async findUserById(id: string): Promise<UserRow | undefined> {
      const [row] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .limit(1);
      return row;
    },

    /** The email is already verified (the user proved it with a code) and the age check has passed. */
    async createUser(input: { email: string; termsVersion: string; now: Date }): Promise<UserRow> {
      const [row] = await db
        .insert(users)
        .values({
          email: input.email,
          emailVerifiedAt: input.now,
          ageConfirmedAt: input.now,
          termsVersion: input.termsVersion,
          termsAcceptedAt: input.now,
        })
        .returning();
      return row!;
    },

    async markOnboarded(userId: string, now: Date): Promise<void> {
      await db.update(users).set({ onboardedAt: now }).where(eq(users.id, userId));
    },

    /**
     * Moves the account to an address its owner just proved with a code, so it is verified as of now.
     * When another row holds the address, in any case, the unique index on lower(email) raises the
     * driver's unique violation; the flow reports that as email_in_use.
     */
    async changeEmail(userId: string, email: string, now: Date): Promise<void> {
      await db.update(users).set({ email, emailVerifiedAt: now }).where(eq(users.id, userId));
    },

    /**
     * The keyed hash of the phone number behind the verified badge, or null to drop it. When another row
     * holds the same hash, the partial unique index on phone_hash raises the driver's unique violation;
     * the flow reports that as phone_in_use.
     */
    async setPhoneHash(userId: string, phoneHash: string | null): Promise<void> {
      await db.update(users).set({ phoneHash }).where(eq(users.id, userId));
    },

    /** Setting or clearing a password also clears any password lockout. */
    async setPasswordHash(userId: string, passwordHash: string | null, now: Date): Promise<void> {
      await db
        .update(users)
        .set({ passwordHash, passwordChangedAt: now, failedLogins: 0, lockedUntil: null })
        .where(eq(users.id, userId));
    },

    /** Replaces the hash only, after a sign-in verified the password against older parameters. */
    async replacePasswordHash(userId: string, passwordHash: string): Promise<void> {
      await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    },

    async setPasswordFailures(userId: string, failedLogins: number, lockedUntil: Date | null): Promise<void> {
      await db.update(users).set({ failedLogins, lockedUntil }).where(eq(users.id, userId));
    },

    async enableTotp(userId: string, input: { secretEnc: string; recoveryCodesHash: string[]; now: Date }): Promise<void> {
      await db
        .update(users)
        .set({ totpSecretEnc: input.secretEnc, totpEnabledAt: input.now, totpLastStep: null, recoveryCodesHash: input.recoveryCodesHash })
        .where(eq(users.id, userId));
    },

    async disableTotp(userId: string): Promise<void> {
      await db
        .update(users)
        .set({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] })
        .where(eq(users.id, userId));
    },

    /** The same secret re-encrypted with the current key; nothing else about MFA changes. */
    async setTotpSecretEnc(userId: string, totpSecretEnc: string): Promise<void> {
      await db.update(users).set({ totpSecretEnc }).where(eq(users.id, userId));
    },

    async setRecoveryCodes(userId: string, recoveryCodesHash: string[]): Promise<void> {
      await db.update(users).set({ recoveryCodesHash }).where(eq(users.id, userId));
    },

    /** Claims a TOTP time step. False when this step or a later one was already used. */
    async claimTotpStep(userId: string, step: number): Promise<boolean> {
      const rows = await db
        .update(users)
        .set({ totpLastStep: step })
        .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
        .returning({ id: users.id });
      return rows.length === 1;
    },

    /** Removes one recovery-code hash. False when it is not (or no longer) present. */
    async consumeRecoveryCodeHash(userId: string, codeHash: string): Promise<boolean> {
      const rows = await db
        .update(users)
        .set({ recoveryCodesHash: sql`array_remove(${users.recoveryCodesHash}, ${codeHash})` })
        .where(and(eq(users.id, userId), sql`${codeHash} = ANY(${users.recoveryCodesHash})`))
        .returning({ id: users.id });
      return rows.length === 1;
    },

    async setRole(userId: string, role: UserRole): Promise<void> {
      await db.update(users).set({ role }).where(eq(users.id, userId));
    },

    /**
     * A role change (3a design, section 7) in one transaction: the account's row is locked first, FOR NO KEY UPDATE (the
     * lock the role's update would take, and the one every writer of staff rows takes first, so none of them can wait on
     * another in a circle); the role is set, every session and every staff session revoked and every unused enrolment link
     * deleted, so the new role applies at once and no link issued before enrols anything. A change to user also revokes
     * every staff key, with a staff_key_revoked event each: a person made staff again enrols new keys. Last, through
     * auth.append_audit, each revocation's audit row and then the role_granted row, which hold the audit chain's head until
     * the commit, so the change and its record commit together or not at all. Only the command line calls this, and it
     * waits at most 10 seconds for a lock: an API that holds the head or the row open cannot stall it for longer, and one
     * that times out has changed nothing. The cache tombstones and the mail are not the database's to write, so the caller
     * does them after the commit with what this answers; undefined when no live account has the address.
     */
    async changeRole(email: string, role: UserRole, audit: { actorId: string; now: Date }): Promise<RoleChange | undefined> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '10s'`);
        const [account] = await tx
          .select({ id: users.id, email: users.email, role: users.role })
          .from(users)
          .where(and(sql`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)))
          .limit(1)
          .for("no key update");
        if (!account) return undefined;
        await tx.update(users).set({ role }).where(eq(users.id, account.id));
        const revoked = await tx
          .update(sessions)
          .set({ revokedAt: audit.now })
          .where(and(eq(sessions.userId, account.id), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id });
        const staff = await revokeStaffAccess(tx, account.id, audit.now, { keys: role === "user", enrollments: "unused", via: "role_change" });
        await appendKeyRevocations(tx, audit.actorId, staff, "role_change");
        await appendAudit(tx, {
          actorId: audit.actorId,
          action: "role_granted",
          targetType: "user",
          targetId: account.id,
          // A role change deletes open links only, so every link it deleted was one it cancelled.
          metadata: { from: account.role, to: role, via: "cli", staffSessionsRevoked: staff.staffSessionsRevoked, enrollmentsDeleted: staff.enrollmentsCancelled },
        });
        return {
          userId: account.id,
          email: account.email,
          previousRole: account.role,
          sessionIds: revoked.map((row) => row.id),
          staffSessionsRevoked: staff.staffSessionsRevoked,
          enrollmentsDeleted: staff.enrollmentsCancelled,
          keysRevoked: staff.keys.map(({ id, name }) => ({ id, name })),
        };
      });
    },

    // ------------------------------------------------------------ deletion

    /**
     * Marks the row deleted and nothing else: from now on every lookup above treats it as absent. Once only; a
     * later call changes nothing. A deletion goes through takeDown; this is the state a take-down that stopped
     * after the mark would leave, which finishTakeDown completes.
     */
    async markDeleted(userId: string, now: Date): Promise<void> {
      await db.update(users).set({ deletedAt: now }).where(and(eq(users.id, userId), isNull(users.deletedAt)));
    },

    /**
     * Step 1 of a deletion (1b design, section 7.6) in one transaction: the row is marked deleted, every live
     * session revoked, every device, code and passkey deleted, the WebAuthn user handle cleared, the account's staff
     * keys and staff sessions revoked, its enrolment links deleted and its keys blanked (3a design, section 7), and the
     * account_deleted event appended; last, the audit rows of the staff side, with the account as their actor, since its
     * owner asked for the deletion. Either all of it lands or none of it does, so a failure leaves a live account with its
     * sessions, never a deleted one with sessions, devices, passkeys or staff keys that nothing would remove. Answers the
     * ids of the sessions it revoked, for the cache tombstones, which are not the database's to write.
     */
    async takeDown(userId: string, now: Date, deviceId: string | null): Promise<string[]> {
      return db.transaction(async (tx) => {
        await tx.update(users).set({ deletedAt: now }).where(and(eq(users.id, userId), isNull(users.deletedAt)));
        const taken = await takeDownRows(tx, userId, now);
        await tx.insert(authEvents).values({ userId, type: "account_deleted", deviceId, metadata: {} });
        await appendTakeDownAudit(tx, userId, userId, taken.staff);
        return taken.sessionIds;
      });
    },

    /**
     * The rows of step 1 again (the sessions, devices, codes and passkeys, the WebAuthn user handle and the staff rows), for
     * a row marked deleted and not purged yet: a take-down that stopped after the mark, or a session that a sign-in already
     * past its lookup created after it. Nothing for a live or a purged row. The account_deleted event is not appended
     * again: the confirmation that recorded it is the only one there was. The staff side's audit rows are written, last,
     * for what this run revoked, with the server as their actor: the purge job finishes the take-down, no person.
     */
    async finishTakeDown(userId: string, now: Date): Promise<string[]> {
      return db.transaction(async (tx) => {
        // The account's row first, as every writer of staff rows takes it (3a design, section 7).
        const [row] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, userId), isNotNull(users.deletedAt), isNull(users.purgedAt)))
          .for("no key update");
        if (!row) return [];
        const taken = await takeDownRows(tx, userId, now);
        await appendTakeDownAudit(tx, SYSTEM_ACTOR_ID, userId, taken.staff);
        return taken.sessionIds;
      });
    },

    /** Deleted accounts whose row the purge has not anonymised yet, oldest deletion first, at most 100 a round. */
    async pendingPurges(): Promise<string[]> {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(isNotNull(users.deletedAt), isNull(users.purgedAt)))
        .orderBy(users.deletedAt, users.id)
        .limit(100);
      return rows.map((r) => r.id);
    },

    /**
     * The last step of a deletion: the address becomes deleted:<id> (unique, and never a real address),
     * every credential and personal fact is cleared, and purged_at says it is done. Only a deleted row
     * not purged yet is written, so a second call, or a call for a live account, changes nothing.
     */
    async finishPurge(userId: string, now: Date): Promise<void> {
      await db
        .update(users)
        .set({
          email: `deleted:${userId}`,
          emailVerifiedAt: null,
          passwordHash: null,
          totpSecretEnc: null,
          totpEnabledAt: null,
          recoveryCodesHash: [],
          phoneHash: null,
          ageConfirmedAt: null,
          termsVersion: null,
          termsAcceptedAt: null,
          purgedAt: now,
        })
        .where(and(eq(users.id, userId), isNotNull(users.deletedAt), isNull(users.purgedAt)));
    },

    // ------------------------------------------------------------ lockdown

    /**
     * The lockdown (1c design, sections 2 and 7.6) in one transaction, as takeDown is one: every live session
     * revoked, every device revoked (so the next sign-in on any of them counts as a new device), the password
     * cleared as setPasswordHash clears it, the passkeys in reach removed, two-factor turned off as disableTotp
     * does when it was enabled at or after `since`, and the caller's event appended with what was done. Either
     * all of it lands or none of it does: the link that started it is spent by then, so a lockdown that stopped
     * halfway could not be asked for again, and would be on no record. The user row is locked first, as takeDown
     * and a registration take it first, so none of the three can wait on another in a circle, and two-factor is
     * read from the locked row. Answers the ids of the sessions it revoked, for the cache tombstones, which are
     * not the database's to write.
     */
    async lockDown(userId: string, input: LockDownInput): Promise<LockDownOutcome> {
      return db.transaction(async (tx) => {
        // An account that is gone has no two-factor to clear; its rows, if any are left, are still locked down below.
        const [locked] = await tx
          .select({ totpEnabledAt: users.totpEnabledAt })
          .from(users)
          .where(and(eq(users.id, userId), isNull(users.deletedAt)))
          .for("update");
        const revoked = await tx
          .update(sessions)
          .set({ revokedAt: input.now })
          .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id });
        await tx.update(devices).set({ revokedAt: input.now }).where(and(eq(devices.userId, userId), isNull(devices.revokedAt)));
        // The user's passkeys from `since` on, plus any of theirs the caller names; a named passkey of another account is not the caller's to remove and stays.
        const reach = input.passkeyIds.length > 0 ? or(gte(passkeys.createdAt, input.since), inArray(passkeys.id, [...input.passkeyIds])) : gte(passkeys.createdAt, input.since);
        const removed = await tx
          .delete(passkeys)
          .where(and(eq(passkeys.userId, userId), reach))
          .returning({ id: passkeys.id });
        const totpCleared = locked !== undefined && locked.totpEnabledAt !== null && locked.totpEnabledAt.getTime() >= input.since.getTime();
        await tx
          .update(users)
          .set({
            passwordHash: null,
            passwordChangedAt: input.now,
            failedLogins: 0,
            lockedUntil: null,
            ...(totpCleared ? { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] } : {}),
          })
          .where(eq(users.id, userId));
        const passkeysRemoved = removed.map((row) => row.id);
        await tx.insert(authEvents).values({
          userId,
          type: input.event.type,
          deviceId: input.event.deviceId,
          ipHash: input.event.ipHash,
          metadata: { ...input.event.metadata, passkeysRemoved, totpCleared, passwordCleared: true },
        });
        return { sessionIds: revoked.map((row) => row.id), passkeysRemoved, totpCleared };
      });
    },

    // ------------------------------------------------------------ email codes

    async createEmailCode(input: {
      flowId: string;
      email: string;
      userId: string | null;
      purpose: EmailCodePurpose;
      codeHash: string;
      expiresAt: Date;
      ipHash: string | null;
    }): Promise<void> {
      await db.insert(emailCodes).values(input);
    },

    async findEmailCode(flowId: string): Promise<EmailCodeRow | undefined> {
      const [row] = await db.select().from(emailCodes).where(eq(emailCodes.flowId, flowId)).limit(1);
      return row;
    },

    /** Increments the attempt counter atomically and returns the new value. */
    async addCodeAttempt(id: string): Promise<number> {
      const [row] = await db
        .update(emailCodes)
        .set({ attempts: sql`${emailCodes.attempts} + 1` })
        .where(eq(emailCodes.id, id))
        .returning({ attempts: emailCodes.attempts });
      return row?.attempts ?? Number.MAX_SAFE_INTEGER;
    },

    /** Marks a code used. False when it was already used, so a code works exactly once. */
    async consumeEmailCode(id: string, now: Date): Promise<boolean> {
      const rows = await db
        .update(emailCodes)
        .set({ consumedAt: now })
        .where(and(eq(emailCodes.id, id), isNull(emailCodes.consumedAt)))
        .returning({ id: emailCodes.id });
      return rows.length === 1;
    },

    // ------------------------------------------------------------ devices

    async findDevice(userId: string, deviceHash: string): Promise<DeviceRow | undefined> {
      const [row] = await db
        .select()
        .from(devices)
        .where(and(eq(devices.userId, userId), eq(devices.deviceHash, deviceHash), isNull(devices.revokedAt)))
        .limit(1);
      return row;
    },

    /** The device by its row id, revoked or not: a session's device, whose platform names a passkey and whose label the passkey notices carry. */
    async findDeviceById(id: string): Promise<DeviceRow | undefined> {
      const [row] = await db.select().from(devices).where(eq(devices.id, id)).limit(1);
      return row;
    },

    async createDevice(input: { userId: string; deviceHash: string; label: string; platform: string; ipHash: string | null }): Promise<DeviceRow> {
      const [row] = await db.insert(devices).values(input).returning();
      return row!;
    },

    async touchDevice(id: string, ipHash: string | null, now: Date): Promise<void> {
      await db.update(devices).set({ lastSeenAt: now, ipHash }).where(eq(devices.id, id));
    },

    /** A revoked device no longer carries live sessions and counts as new at its next sign-in. */
    async revokeDevice(id: string, now: Date): Promise<void> {
      await db.update(devices).set({ revokedAt: now }).where(and(eq(devices.id, id), isNull(devices.revokedAt)));
    },

    /** The user's devices that are not revoked, oldest first, for the data export; a revoked one stands for nothing of the account's any more. */
    async listDevices(userId: string): Promise<{ label: string | null; platform: string; firstSeenAt: Date; lastSeenAt: Date }[]> {
      return db
        .select({ label: devices.label, platform: devices.platform, firstSeenAt: devices.firstSeenAt, lastSeenAt: devices.lastSeenAt })
        .from(devices)
        .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
        .orderBy(devices.firstSeenAt, devices.id);
    },

    // ------------------------------------------------------------ sessions

    /**
     * A new session with the factors its sign-in proved (kind to epoch milliseconds from the flows' clock) and the passkey
     * that started it, if one did. The reauth time is the latest of the factors, which is what freshness is read from. A row
     * without factors, as migration 0010 left the sessions from before it, re-authenticates before its next sensitive action.
     */
    async createSession(input: {
      id: string;
      userId: string;
      deviceId: string;
      now: Date;
      expiresAt: Date;
      absoluteExpiresAt: Date;
      factors?: Record<string, number>;
      passkeyId?: string | null;
    }): Promise<void> {
      const factors = input.factors ?? {};
      const times = Object.values(factors);
      await db.insert(sessions).values({
        id: input.id,
        userId: input.userId,
        deviceId: input.deviceId,
        createdAt: input.now,
        lastUsedAt: input.now,
        reauthAt: times.length > 0 ? new Date(Math.max(...times)) : input.now,
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
        factors,
        passkeyId: input.passkeyId ?? null,
      });
    },

    /** A session counts only when neither it, its device nor its user is revoked, deleted or expired. */
    async findActiveSession(id: string, now: Date): Promise<ActiveSessionRow | undefined> {
      const [row] = await db
        .select({
          id: sessions.id,
          userId: sessions.userId,
          deviceId: sessions.deviceId,
          role: users.role,
          onboardedAt: users.onboardedAt,
          totpEnabledAt: users.totpEnabledAt,
          reauthAt: sessions.reauthAt,
          lastUsedAt: sessions.lastUsedAt,
          expiresAt: sessions.expiresAt,
          absoluteExpiresAt: sessions.absoluteExpiresAt,
          handle: sessions.handle,
          factors: sessions.factors,
          passkeyId: sessions.passkeyId,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .innerJoin(devices, eq(devices.id, sessions.deviceId))
        .where(
          and(
            eq(sessions.id, id),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, now),
            gt(sessions.absoluteExpiresAt, now),
            isNull(users.deletedAt),
            isNull(devices.revokedAt),
          ),
        )
        .limit(1);
      return row;
    },

    async slideSession(id: string, expiresAt: Date, now: Date): Promise<void> {
      await db.update(sessions).set({ expiresAt, lastUsedAt: now }).where(eq(sessions.id, id));
    },

    /**
     * Records a factor the session proved at `at`: the kind's time is set or replaced, and reauth_at, the latest of
     * them, follows the write. The flows always pass their clock's now.
     */
    async writeFactor(id: string, kind: string, at: Date): Promise<void> {
      await db
        .update(sessions)
        .set({ factors: sql`${sessions.factors} || ${JSON.stringify({ [kind]: at.getTime() })}::jsonb`, reauthAt: at })
        .where(eq(sessions.id, id));
    },

    /**
     * Replaces the session's id, the token's hash, and nothing else, for a live session only: the handle, factors, reauth
     * time, passkey, device and expiries stay. False when the session is revoked or gone, so a rotation never revives one.
     * Nothing references sessions.id, so the primary key changes in place.
     */
    async rotateSession(id: string, newId: string): Promise<boolean> {
      const rows = await db
        .update(sessions)
        .set({ id: newId })
        .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.length === 1;
    },

    /**
     * Revokes one session of this user, named by its handle: the id a rotation keeps, so a session listed before its
     * token rotated is still found. Answers the row's id as it is now, which its cached copy is keyed by; undefined
     * when the session does not belong to the user or is already revoked.
     */
    async revokeSession(handle: string, userId: string, now: Date): Promise<string | undefined> {
      const [row] = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.handle, handle), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return row?.id;
    },

    /** Revokes every live session of the user and returns their ids (for cache invalidation). */
    async revokeAllSessions(userId: string, now: Date): Promise<string[]> {
      const rows = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.map((r) => r.id);
    },

    async listActiveSessions(userId: string, now: Date): Promise<SessionListRow[]> {
      return db
        .select({
          id: sessions.id,
          handle: sessions.handle,
          deviceLabel: devices.label,
          platform: devices.platform,
          createdAt: sessions.createdAt,
          lastUsedAt: sessions.lastUsedAt,
        })
        .from(sessions)
        .innerJoin(devices, eq(devices.id, sessions.deviceId))
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now), gt(sessions.absoluteExpiresAt, now)))
        .orderBy(desc(sessions.lastUsedAt));
    },

    // ------------------------------------------------------------ passkeys

    /**
     * The account's WebAuthn user handle, set to `candidate` when there is none yet (1c design, section 6): a
     * compare-and-set in one statement, so two registrations at once end with the same handle, whichever wrote it.
     * Undefined for an account that is gone.
     */
    async ensureWebauthnUserId(userId: string, candidate: Buffer): Promise<Buffer | undefined> {
      const [row] = await db
        .update(users)
        .set({ webauthnUserId: sql`coalesce(${users.webauthnUserId}, ${candidate})` })
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .returning({ webauthnUserId: users.webauthnUserId });
      return row?.webauthnUserId ?? undefined;
    },

    async countPasskeys(userId: string): Promise<number> {
      const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(passkeys).where(eq(passkeys.userId, userId));
      return row?.count ?? 0;
    },

    /** The account's passkeys newest first, each with the label of the device that added it, for the Security list and the options' exclusions. */
    async listPasskeys(userId: string): Promise<PasskeyListRow[]> {
      return db
        .select({ ...getTableColumns(passkeys), createdOn: devices.label })
        .from(passkeys)
        .leftJoin(devices, eq(devices.id, passkeys.createdDeviceId))
        .where(eq(passkeys.userId, userId))
        .orderBy(desc(passkeys.createdAt), desc(passkeys.id));
    },

    /** One passkey of the account, with its device's label. Undefined when it is another account's or gone, which the flows do not tell apart. */
    async findPasskey(id: string, userId: string): Promise<PasskeyListRow | undefined> {
      const [row] = await db
        .select({ ...getTableColumns(passkeys), createdOn: devices.label })
        .from(passkeys)
        .leftJoin(devices, eq(devices.id, passkeys.createdDeviceId))
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .limit(1);
      return row;
    },

    /**
     * The passkey a sign-in's credential id names, whichever account it belongs to (1c design, section 7.4): the assertion
     * says nothing about the account, so the flow finds the owner from here. Undefined for an unknown credential; the flow
     * then reads the owner and refuses a deleted one, so a gone account never signs in.
     */
    async findPasskeyByCredentialId(credentialId: string): Promise<PasskeyRow | undefined> {
      const [row] = await db.select().from(passkeys).where(eq(passkeys.credentialId, credentialId)).limit(1);
      return row;
    },

    /**
     * A passkey the session's account holds, by credential id (1c design, section 7.2): the re-authentication looks it up
     * with the session's user, so another account's passkey and an unknown one are alike undefined and never re-authenticate.
     */
    async findPasskeyByCredential(credentialId: string, userId: string): Promise<PasskeyRow | undefined> {
      const [row] = await db
        .select()
        .from(passkeys)
        .where(and(eq(passkeys.credentialId, credentialId), eq(passkeys.userId, userId)))
        .limit(1);
      return row;
    },

    /**
     * Writes a verified passkey's use in one conditional update (1c design, section 2), in the pattern of claimTotpStep: the
     * new counter, the use time and the current backup state, only for a passkey that is not suspect and whose counter moved
     * forward (two zeros, as synced passkeys always send, pass repeatedly). False when it matched no row, which the flow
     * reads, after a verified signature, as a counter regression or a race lost to one.
     */
    async claimPasskeyUse(id: string, newCounter: number, backedUp: boolean, now: Date): Promise<boolean> {
      const rows = await db
        .update(passkeys)
        .set({ counter: newCounter, lastUsedAt: now, backedUp })
        .where(and(eq(passkeys.id, id), isNull(passkeys.suspectAt), sql`((${newCounter} = 0 and ${passkeys.counter} = 0) or ${newCounter} > ${passkeys.counter})`))
        .returning({ id: passkeys.id });
      return rows.length === 1;
    },

    /** Marks a passkey suspect once (1c design, section 2), so a later sign-in with it is refused; a second call changes nothing. */
    async suspectPasskey(id: string, now: Date): Promise<void> {
      await db.update(passkeys).set({ suspectAt: now }).where(and(eq(passkeys.id, id), isNull(passkeys.suspectAt)));
    },

    /** The daily bound's reading for the options step; the registration's transaction reads it again. */
    async recentPasskeyAdditions(userId: string, withinMs: number, limit: number): Promise<{ count: number; retryAfterSeconds: number }> {
      return recentPasskeyAdditions(db, userId, withinMs, limit);
    },

    /**
     * A registration's transaction (1c design, section 7.3): the user row locked `for update`, so two registrations of one
     * account run one after the other and the later one sees what the earlier committed; both bounds checked again there;
     * then the passkey and its passkey_added event, or neither. A credential id already held raises the driver's unique
     * violation, which the flow reports as passkey_invalid.
     */
    async addPasskey(input: NewPasskey, limits: PasskeyLimits): Promise<AddPasskeyOutcome> {
      return db.transaction(async (tx): Promise<AddPasskeyOutcome> => {
        const [locked] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
          .for("update");
        if (!locked) return { ok: false, reason: "gone" };
        const [held] = await tx.select({ count: sql<number>`count(*)::int` }).from(passkeys).where(eq(passkeys.userId, input.userId));
        if ((held?.count ?? 0) >= limits.passkeys) return { ok: false, reason: "cap" };
        const additions = await recentPasskeyAdditions(tx, input.userId, limits.windowMs, limits.additions);
        if (additions.count >= limits.additions) return { ok: false, reason: "daily", retryAfterSeconds: additions.retryAfterSeconds };
        const [passkey] = await tx.insert(passkeys).values(input).returning();
        await tx.insert(authEvents).values({ userId: input.userId, type: "passkey_added", deviceId: input.createdDeviceId, metadata: { passkeyId: passkey!.id } });
        return { ok: true, passkey: passkey! };
      });
    },

    /** Renames one passkey of the account. False when it is another account's or gone. */
    async renamePasskey(id: string, userId: string, name: string): Promise<boolean> {
      const rows = await db
        .update(passkeys)
        .set({ name })
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .returning({ id: passkeys.id });
      return rows.length === 1;
    },

    /**
     * Removes one passkey of the account and answers its name, for the notice; undefined when it is another account's or
     * gone. The sessions it started keep running without it: the foreign key sets their passkey_id to null.
     */
    async deletePasskey(id: string, userId: string): Promise<{ name: string } | undefined> {
      const [row] = await db
        .delete(passkeys)
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .returning({ name: passkeys.name });
      return row;
    },

    // ------------------------------------------------------------ staff keys and enrolments (3a design, section 7)

    /**
     * The enrolment whose token hashes to `tokenHash`, used or not, expired or not, with what the enrolment flow checks of
     * its account: whether it is live, staff and has a handle, and its WebAuthn user handle. Undefined for an unknown
     * token. The flow decides; auth.add_staff_key decides again under the account's lock.
     */
    async findStaffEnrollment(tokenHash: string): Promise<StaffEnrollmentRow | undefined> {
      const [row] = await db
        .select({
          id: staffEnrollments.id,
          userId: staffEnrollments.userId,
          origin: staffEnrollments.origin,
          rpId: staffEnrollments.rpId,
          expiresAt: staffEnrollments.expiresAt,
          usedAt: staffEnrollments.usedAt,
          email: users.email,
          role: users.role,
          deletedAt: users.deletedAt,
          onboardedAt: users.onboardedAt,
          webauthnUserId: users.webauthnUserId,
        })
        .from(staffEnrollments)
        .innerJoin(users, eq(users.id, staffEnrollments.userId))
        .where(eq(staffEnrollments.tokenHash, tokenHash))
        .limit(1);
      return row;
    },

    /**
     * The account's live staff keys as an options list excludes them: an authenticator keeps one discoverable credential
     * per relying party and user handle, so a revoked key is left out and the same security key can be enrolled again.
     */
    async listLiveStaffKeys(userId: string): Promise<{ credentialId: string; transports: string[] }[]> {
      return db
        .select({ credentialId: staffKeys.credentialId, transports: staffKeys.transports })
        .from(staffKeys)
        .where(and(eq(staffKeys.userId, userId), isNull(staffKeys.revokedAt)))
        .orderBy(staffKeys.createdAt, staffKeys.id);
    },

    /** One staff key as the console shows it: never its public key, credential id or AAGUID. */
    async findStaffKey(id: string): Promise<{ id: string; name: string; createdAt: Date; lastUsedAt: Date | null } | undefined> {
      const [row] = await db
        .select({ id: staffKeys.id, name: staffKeys.name, createdAt: staffKeys.createdAt, lastUsedAt: staffKeys.lastUsedAt })
        .from(staffKeys)
        .where(eq(staffKeys.id, id))
        .limit(1);
      return row;
    },

    /**
     * The enrolment's write, in one transaction on the auth role (3a design, section 7): the account's row locked first,
     * FOR NO KEY UPDATE, so a role change or take-down that holds it either committed before (and deleted the link, which
     * the function then does not find) or waits until this commits; the staff_key_added event; and last
     * auth.add_staff_key, which re-checks under that lock that the link is unused and unexpired and the account live,
     * staff, with a handle and fewer than five live keys, then spends the link, stores the key with the origin and relying
     * party ID the link recorded and writes its audit row, which holds the chain's head until the commit. A refusal by the
     * function rolls the event back with it. A credential id already held raises the driver's unique violation, which the
     * flow reports.
     */
    async addStaffKey(input: NewStaffKey): Promise<AddStaffKeyOutcome> {
      try {
        return await db.transaction(async (tx) => {
          await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).for("no key update");
          await tx.insert(authEvents).values({ userId: input.userId, type: "staff_key_added", metadata: { enrollmentId: input.enrollmentId } });
          // Each transport as its own parameter: an empty list is an empty array.
          const transports = sql`array[${sql.join(input.transports.map((t) => sql`${t}`), sql`, `)}]::text[]`;
          const [row] = await tx.execute<{ id: string }>(
            sql`select auth.add_staff_key(${input.token}::text, ${input.credentialId}::text, ${input.publicKey}::text, ${input.counter}::bigint,
              ${transports}, ${input.name}::text, ${input.aaguid}::uuid, ${input.requestId}::text) as id`,
          );
          return { ok: true as const, keyId: row!.id };
        });
      } catch (err) {
        // The function raises its refusal's staff code as the message.
        const refusal = raisedMessage(err);
        if (refusal === "staff_enrollment_invalid") return { ok: false, reason: "enrollment_invalid" };
        if (refusal === "staff_key_limit") return { ok: false, reason: "limit" };
        throw err;
      }
    },

    // ------------------------------------------------------------ staff sessions

    /** A staff key by its credential id, revoked or not, with its account's address, role, deletion and user handle; the sign-in decides. */
    async findStaffKeyForSignIn(credentialId: string): Promise<StaffKeyForSignIn | undefined> {
      const [row] = await db
        .select({
          id: staffKeys.id,
          userId: staffKeys.userId,
          credentialId: staffKeys.credentialId,
          publicKey: staffKeys.publicKey,
          transports: staffKeys.transports,
          name: staffKeys.name,
          revokedAt: staffKeys.revokedAt,
          email: users.email,
          role: users.role,
          deletedAt: users.deletedAt,
          webauthnUserId: users.webauthnUserId,
        })
        .from(staffKeys)
        .innerJoin(users, eq(users.id, staffKeys.userId))
        .where(eq(staffKeys.credentialId, credentialId))
        .limit(1);
      return row;
    },

    /**
     * A staff sign-in's write, in one transaction (3a design, section 7): first 1c's counter rule as one conditional update
     * of the key, which records its use only while it is live and its counter moved forward (two zeros pass, as some
     * authenticators always report 0); then the session, its staff_sign_in event and last its audit row, which holds the
     * chain's head until the commit. Null when the update matched no row: a counter that went backwards, or a key revoked
     * since the flow read it, which the caller tells apart. The update holds the key's row until the commit, so a
     * revocation waiting for it then also finds the session this opened.
     */
    async openStaffSession(input: NewStaffSession): Promise<{ handle: string } | null> {
      return db.transaction(async (tx) => {
        const claimed = await tx
          .update(staffKeys)
          .set({ counter: input.newCounter, lastUsedAt: input.now })
          .where(
            and(
              eq(staffKeys.id, input.keyId),
              eq(staffKeys.userId, input.userId),
              isNull(staffKeys.revokedAt),
              sql`((${input.newCounter} = 0 and ${staffKeys.counter} = 0) or ${input.newCounter} > ${staffKeys.counter})`,
            ),
          )
          .returning({ id: staffKeys.id });
        if (claimed.length === 0) return null;
        const [session] = await tx
          .insert(staffSessions)
          .values({
            id: input.id,
            userId: input.userId,
            keyId: input.keyId,
            createdAt: input.now,
            lastUsedAt: input.now,
            idleExpiresAt: input.idleExpiresAt,
            absoluteExpiresAt: input.absoluteExpiresAt,
            browser: input.browser,
          })
          .returning({ handle: staffSessions.handle });
        const handle = session!.handle;
        await tx.insert(authEvents).values({ userId: input.userId, type: "staff_sign_in", ipHash: input.ipHash, metadata: { keyId: input.keyId, handle } });
        await appendAudit(tx, {
          actorId: input.userId,
          action: "staff_sign_in",
          targetType: "staff_session",
          targetId: handle,
          staffSession: handle,
          keyId: input.keyId,
          metadata: {},
          requestId: input.requestId,
        });
        return { handle };
      });
    },

    /**
     * A staff session by its token's hash, read from the database on every request, never cached (3a design, section 7):
     * one indexed read joined to its key and its account. It counts only while it is unrevoked, has started (a created_at
     * later than now is a row written behind the flows' back) and is before both its ends, its key unrevoked and its account
     * live and still staff, so a revocation, a demotion, a deletion or a suspect key ends it at its next request with no
     * tombstone. With `slideTo` (a request its person's action started) the same statement moves last_used_at to now and the
     * idle end to `slideTo`, never past the absolute end; without, nothing moves.
     */
    async resolveStaffSession(id: string, now: Date, slideTo: Date | null): Promise<StaffSessionRow | undefined> {
      const live = and(
        eq(staffSessions.id, id),
        isNull(staffSessions.revokedAt),
        lte(staffSessions.createdAt, now),
        gt(staffSessions.idleExpiresAt, now),
        gt(staffSessions.absoluteExpiresAt, now),
        isNull(staffKeys.revokedAt),
        isNull(users.deletedAt),
        ne(users.role, "user"),
      );
      const columns = {
        id: staffSessions.id,
        handle: staffSessions.handle,
        userId: staffSessions.userId,
        keyId: staffSessions.keyId,
        role: users.role,
        createdAt: staffSessions.createdAt,
        lastUsedAt: staffSessions.lastUsedAt,
        idleExpiresAt: staffSessions.idleExpiresAt,
        absoluteExpiresAt: staffSessions.absoluteExpiresAt,
        browser: staffSessions.browser,
      };
      if (slideTo === null) {
        const [row] = await db
          .select(columns)
          .from(staffSessions)
          .innerJoin(staffKeys, eq(staffKeys.id, staffSessions.keyId))
          .innerJoin(users, eq(users.id, staffSessions.userId))
          .where(live)
          .limit(1);
        return row;
      }
      const [row] = await db
        .update(staffSessions)
        // least() on the row's own absolute end, so the idle end never passes it, as the table's check also requires.
        .set({ lastUsedAt: now, idleExpiresAt: sql`least(${slideTo.toISOString()}::timestamptz, ${staffSessions.absoluteExpiresAt})` })
        .from(staffKeys)
        // A join in UPDATE ... FROM cannot name the updated table, so the account is reached through the key, whose owner
        // the sessions' foreign key on (key_id, user_id) makes the session's account.
        .innerJoin(users, eq(users.id, staffKeys.userId))
        .where(and(eq(staffKeys.id, staffSessions.keyId), live))
        .returning(columns);
      return row;
    },

    /** The account's live staff sessions, the same tests as resolveStaffSession's, most recently used first. */
    async listStaffSessions(userId: string, now: Date): Promise<{ handle: string; browser: string; createdAt: Date; lastUsedAt: Date }[]> {
      return db
        .select({ handle: staffSessions.handle, browser: staffSessions.browser, createdAt: staffSessions.createdAt, lastUsedAt: staffSessions.lastUsedAt })
        .from(staffSessions)
        .innerJoin(staffKeys, eq(staffKeys.id, staffSessions.keyId))
        .where(
          and(
            eq(staffSessions.userId, userId),
            isNull(staffSessions.revokedAt),
            lte(staffSessions.createdAt, now),
            gt(staffSessions.idleExpiresAt, now),
            gt(staffSessions.absoluteExpiresAt, now),
            isNull(staffKeys.revokedAt),
          ),
        )
        .orderBy(desc(staffSessions.lastUsedAt), desc(staffSessions.createdAt));
    },

    /** The account's live staff keys as the console lists them, oldest first: never a public key, a credential id or an AAGUID. */
    async listStaffKeyViews(userId: string): Promise<{ id: string; name: string; createdAt: Date; lastUsedAt: Date | null }[]> {
      return db
        .select({ id: staffKeys.id, name: staffKeys.name, createdAt: staffKeys.createdAt, lastUsedAt: staffKeys.lastUsedAt })
        .from(staffKeys)
        .where(and(eq(staffKeys.userId, userId), isNull(staffKeys.revokedAt)))
        .orderBy(asc(staffKeys.createdAt), asc(staffKeys.id));
    },

    /**
     * A sign-out (3a design, section 7) in one transaction: the session revoked, if it still is live, then its
     * staff_signed_out event and last its audit row. False when another request ended it first, which writes nothing.
     */
    async endStaffSession(input: { id: string; userId: string; keyId: string; now: Date; ipHash: string | null; requestId: string }): Promise<boolean> {
      return db.transaction(async (tx) => {
        const [ended] = await tx
          .update(staffSessions)
          .set({ revokedAt: input.now })
          .where(and(eq(staffSessions.id, input.id), eq(staffSessions.userId, input.userId), isNull(staffSessions.revokedAt)))
          .returning({ handle: staffSessions.handle });
        if (!ended) return false;
        await tx.insert(authEvents).values({ userId: input.userId, type: "staff_signed_out", ipHash: input.ipHash, metadata: { handle: ended.handle } });
        await appendAudit(tx, {
          actorId: input.userId,
          action: "staff_signed_out",
          targetType: "staff_session",
          targetId: ended.handle,
          staffSession: ended.handle,
          keyId: input.keyId,
          metadata: {},
          requestId: input.requestId,
        });
        return true;
      });
    },

    /**
     * Revokes staff keys in one transaction on the auth role (3a design, section 7): `staff.js revoke <email> <key id>` and
     * `revoke <email> all`, and the counter rule's revocation, which is the same routine with suspect_at set as well and the
     * regression's own event. The account's row is locked first, FOR NO KEY UPDATE, as every writer of staff rows takes it.
     * Then the keys (one, or every live one), each only where revoked_at is still null, since a set one is never changed;
     * then every staff session they opened (for `all`, every staff session of the account), after the keys, so a session a
     * sign-in opened while this waited for a key's row is found too; for `all`, the unused enrolment links; an event per key;
     * and last the audit rows, a key's revocation each and, when a link went, one staff_enrollments_cancelled row, so it
     * never changes the database without a row. The command line waits at most 10 seconds for a lock.
     */
    async revokeStaffKeys(input: StaffKeyRevocation): Promise<StaffKeysRevoked> {
      return db.transaction(async (tx): Promise<StaffKeysRevoked> => {
        if (input.via === "cli") await tx.execute(sql`set local lock_timeout = '10s'`);
        const [account] = await tx
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(and("id" in input.account ? eq(users.id, input.account.id) : sql`lower(${users.email}) = lower(${input.account.email})`, isNull(users.deletedAt)))
          .limit(1)
          .for("no key update");
        if (!account) return { ok: false, reason: "no_account" };
        let alreadyRevokedAt: Date | null = null;
        if (input.key !== "all") {
          // Another account's key and an unknown one are alike: neither is this account's to revoke.
          const [key] = await tx
            .select({ revokedAt: staffKeys.revokedAt })
            .from(staffKeys)
            .where(and(eq(staffKeys.id, input.key), eq(staffKeys.userId, account.id)));
          if (!key) return { ok: false, reason: "no_key" };
          alreadyRevokedAt = key.revokedAt;
        }
        const revoked = await tx
          .update(staffKeys)
          .set(input.suspect ? { revokedAt: input.now, suspectAt: input.now } : { revokedAt: input.now })
          .where(and(eq(staffKeys.userId, account.id), input.key === "all" ? undefined : eq(staffKeys.id, input.key), isNull(staffKeys.revokedAt)))
          .returning({ id: staffKeys.id, name: staffKeys.name, createdAt: staffKeys.createdAt });
        // An update answers in no set order; the events, rows and mail list the keys oldest first.
        revoked.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
        const keyIds = revoked.map((key) => key.id);
        const sessionsOf = input.key === "all" ? eq(staffSessions.userId, account.id) : keyIds.length > 0 ? inArray(staffSessions.keyId, keyIds) : null;
        const ended =
          sessionsOf === null
            ? []
            : await tx
                .update(staffSessions)
                .set({ revokedAt: input.now })
                .where(and(sessionsOf, isNull(staffSessions.revokedAt)))
                .returning({ keyId: staffSessions.keyId });
        const enrollmentsCancelled =
          input.key === "all"
            ? (
                await tx
                  .delete(staffEnrollments)
                  .where(and(eq(staffEnrollments.userId, account.id), isNull(staffEnrollments.usedAt)))
                  .returning({ id: staffEnrollments.id })
              ).length
            : 0;
        const action = input.suspect ? "staff_key_counter_regression" : "staff_key_revoked";
        const keys = revoked.map((key) => ({ id: key.id, name: key.name, sessionsRevoked: ended.filter((session) => session.keyId === key.id).length }));
        for (const key of keys) {
          // The key's id and no name: the take-down blanks names, and nothing can blank them in an event.
          await tx.insert(authEvents).values({ userId: account.id, type: action, metadata: { keyId: key.id, sessionsRevoked: key.sessionsRevoked, via: input.via } });
        }
        for (const key of keys) {
          await appendAudit(tx, {
            actorId: input.actorId,
            action,
            targetType: "staff_key",
            targetId: key.id,
            metadata: { keyId: key.id, sessionsRevoked: key.sessionsRevoked, via: input.via },
            requestId: input.requestId ?? null,
          });
        }
        if (enrollmentsCancelled > 0) {
          await appendAudit(tx, {
            actorId: input.actorId,
            action: "staff_enrollments_cancelled",
            targetType: "user",
            targetId: account.id,
            metadata: { count: enrollmentsCancelled, via: input.via },
            requestId: input.requestId ?? null,
          });
        }
        return { ok: true, userId: account.id, email: account.email, keys, staffSessionsRevoked: ended.length, enrollmentsCancelled, alreadyRevokedAt };
      });
    },

    // ------------------------------------------------------------ events

    async appendEvent(input: {
      userId: string | null;
      type: AuthEventType;
      deviceId?: string | null;
      ipHash?: string | null;
      metadata?: Record<string, unknown>;
    }): Promise<void> {
      await db.insert(authEvents).values({
        userId: input.userId,
        type: input.type,
        deviceId: input.deviceId ?? null,
        ipHash: input.ipHash ?? null,
        metadata: input.metadata ?? {},
      });
    },

    // ------------------------------------------------------------ retention

    /** Codes consumed or expired before `before` are of no use to anyone; they still hold an email and an ip hash. */
    async purgeEmailCodes(before: Date): Promise<number> {
      const rows = await db
        .delete(emailCodes)
        .where(or(and(sql`${emailCodes.consumedAt} is not null`, lt(emailCodes.consumedAt, before)), lt(emailCodes.expiresAt, before)))
        .returning({ id: emailCodes.id });
      return rows.length;
    },

    /** Sessions revoked or expired before `before`. Live ones are never touched. */
    async purgeSessions(before: Date): Promise<number> {
      const rows = await db
        .delete(sessions)
        .where(or(and(sql`${sessions.revokedAt} is not null`, lt(sessions.revokedAt, before)), lt(sessions.expiresAt, before), lt(sessions.absoluteExpiresAt, before)))
        .returning({ id: sessions.id });
      return rows.length;
    },

    /**
     * Staff sessions revoked or expired before `before` (3a design, section 7). A live one is never touched: both its ends
     * lie ahead. The audit rows that name a session keep its handle, which needs no row.
     */
    async purgeStaffSessions(before: Date): Promise<number> {
      const rows = await db
        .delete(staffSessions)
        .where(
          or(
            and(isNotNull(staffSessions.revokedAt), lt(staffSessions.revokedAt, before)),
            lt(staffSessions.idleExpiresAt, before),
            lt(staffSessions.absoluteExpiresAt, before),
          ),
        )
        .returning({ id: staffSessions.id });
      return rows.length;
    },

    /** Enrolment links used or expired before `before`, which can enrol nothing more; one that still can is cancelled only by name. */
    async purgeStaffEnrollments(before: Date): Promise<number> {
      const rows = await db
        .delete(staffEnrollments)
        .where(or(and(isNotNull(staffEnrollments.usedAt), lt(staffEnrollments.usedAt, before)), lt(staffEnrollments.expiresAt, before)))
        .returning({ id: staffEnrollments.id });
      return rows.length;
    },

    /** The design's IP-hash purge: a device not seen since `before` keeps no address hash. */
    async purgeDeviceIpHashes(before: Date): Promise<number> {
      const rows = await db
        .update(devices)
        .set({ ipHash: null })
        .where(and(sql`${devices.ipHash} is not null`, lt(devices.lastSeenAt, before)))
        .returning({ id: devices.id });
      return rows.length;
    },

    /**
     * Events older than `days` days, through auth.purge_events (migration 0007): the table stays
     * append-only for this role, which holds no DELETE on it; the function is owned by the migrator.
     */
    async purgeEvents(days: number): Promise<number> {
      const [row] = (await db.execute(sql`select auth.purge_events(make_interval(days => ${days}::int)) as removed`)) as unknown as { removed: number }[];
      return Number(row?.removed ?? 0);
    },

    async recentEvents(userId: string, limit = 20) {
      return db
        .select({ type: authEvents.type, deviceId: authEvents.deviceId, createdAt: authEvents.createdAt })
        .from(authEvents)
        .where(eq(authEvents.userId, userId))
        .orderBy(desc(authEvents.createdAt), desc(authEvents.id))
        .limit(limit);
    },

    /** The user's own events since `since`, newest first, for the data export: their kind and time, never the metadata. */
    async eventsSince(userId: string, since: Date): Promise<{ type: AuthEventType; createdAt: Date }[]> {
      return db
        .select({ type: authEvents.type, createdAt: authEvents.createdAt })
        .from(authEvents)
        .where(and(eq(authEvents.userId, userId), gte(authEvents.createdAt, since)))
        .orderBy(desc(authEvents.createdAt), desc(authEvents.id));
    },
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** What a read runs through: the pool, or a transaction that needs the read to see its own lock. */
type Querier = Pick<Db, "select">;

/** The auth side's actions in the audit log: the only ones auth.append_audit writes (migration 0012). */
type AuthAuditAction =
  | "staff_key_revoked"
  | "staff_key_counter_regression"
  | "staff_sign_in"
  | "staff_signed_out"
  | "staff_session_revoked"
  | "staff_enrollments_cancelled"
  | "role_granted";

/** One auth-side row of the audit log. The trigger sets its id, time, place and hashes. */
interface AuthAuditRow {
  actorId: string;
  action: AuthAuditAction;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  staffSession?: string | null;
  keyId?: string | null;
  actionHash?: string | null;
  stepUp?: { authenticatorData: string; clientDataJSON: string; signature: string } | null;
  requestId?: string | null;
}

/**
 * Writes an auth-side row of the audit log in the caller's transaction, through auth.append_audit: the auth role holds
 * nothing in the public schema, and the function, which the migrator owns, writes only the auth side's actions (3a design,
 * section 6). It must be the transaction's last statement: the row holds the chain's head until the commit, so nothing that
 * can wait may run after it. Answers the row's place in the chain.
 */
async function appendAudit(tx: Tx, row: AuthAuditRow): Promise<number> {
  // The jsonb arguments go as text and are cast, so postgres.js sends them exactly as serialised here.
  const stepUp = row.stepUp ? JSON.stringify(row.stepUp) : null;
  const [written] = await tx.execute<{ place: string }>(
    sql`select auth.append_audit(${row.actorId}::uuid, ${row.action}::text, ${row.targetType}::text, ${row.targetId}::text,
      ${JSON.stringify(row.metadata)}::text::jsonb, ${row.staffSession ?? null}::uuid, ${row.keyId ?? null}::uuid,
      ${row.actionHash ?? null}::text, ${stepUp}::text::jsonb, ${row.requestId ?? null}::text)::text as place`,
  );
  return Number(written!.place);
}

/**
 * The daily bound's reading (1c design, section 2): how many passkey_added events the account has within the window, at
 * most `limit` of them, and the seconds until the oldest of those is out of the window, when the day has a slot again.
 * Counted from the events, so a removal frees nothing, and by the database clock, which wrote them.
 */
async function recentPasskeyAdditions(q: Querier, userId: string, withinMs: number, limit: number): Promise<{ count: number; retryAfterSeconds: number }> {
  const window = sql`make_interval(secs => ${withinMs / 1000}::float8)`;
  const recent = q
    .select({ createdAt: authEvents.createdAt })
    .from(authEvents)
    .where(and(eq(authEvents.userId, userId), eq(authEvents.type, "passkey_added"), gt(authEvents.createdAt, sql`now() - ${window}`)))
    .orderBy(desc(authEvents.createdAt))
    .limit(limit)
    .as("recent");
  const [row] = await q
    .select({
      count: sql<number>`count(*)::int`,
      retryAfterSeconds: sql<number>`coalesce(ceil(extract(epoch from (min(${recent.createdAt}) + ${window} - now())))::int, 0)`,
    })
    .from(recent);
  return { count: row?.count ?? 0, retryAfterSeconds: row?.retryAfterSeconds ?? 0 };
}

/** The message of an exception a PL/pgSQL function raised (SQLSTATE P0001), however deeply the driver wrapped it; null for anything else. */
function raisedMessage(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && (current as { code?: unknown }).code === "P0001") {
      const message = (current as { message?: unknown }).message;
      return typeof message === "string" ? message : null;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** What revoking an account's staff access did, for the auth events already written, the audit rows and the mail. */
interface StaffRevocation {
  /** Each key revoked now, oldest first, with how many of its staff sessions were revoked now. */
  keys: { id: string; name: string; sessionsRevoked: number }[];
  staffSessionsRevoked: number;
  /**
   * The open enrolment links (never used) deleted now: the deletions that end something, and the count the record carries.
   * A spent link deleted with them at a take-down is not counted, since it could enrol nothing more and nothing was cancelled.
   */
  enrollmentsCancelled: number;
}

/**
 * Ends an account's staff access inside the caller's transaction, which has locked the account's row first (3a design,
 * section 7): every staff session not yet revoked is revoked, the enrolment links deleted (the unused ones, or every one
 * at a take-down), and when `keys` is set every live staff key revoked, with a staff_key_revoked event each. A revocation
 * sets revoked_at only where it is still null, since a set one is never changed. Writes no audit row: the caller writes
 * those last, after its own statements.
 */
async function revokeStaffAccess(
  tx: Tx,
  userId: string,
  now: Date,
  options: { keys: boolean; enrollments: "unused" | "all"; via: "role_change" | "take_down" },
): Promise<StaffRevocation> {
  const ended = await tx
    .update(staffSessions)
    .set({ revokedAt: now })
    .where(and(eq(staffSessions.userId, userId), isNull(staffSessions.revokedAt)))
    .returning({ keyId: staffSessions.keyId });
  const deleted = await tx
    .delete(staffEnrollments)
    .where(and(eq(staffEnrollments.userId, userId), options.enrollments === "unused" ? isNull(staffEnrollments.usedAt) : undefined))
    .returning({ usedAt: staffEnrollments.usedAt });
  const keys: StaffRevocation["keys"] = [];
  if (options.keys) {
    const revoked = await tx
      .update(staffKeys)
      .set({ revokedAt: now })
      .where(and(eq(staffKeys.userId, userId), isNull(staffKeys.revokedAt)))
      .returning({ id: staffKeys.id, name: staffKeys.name, createdAt: staffKeys.createdAt });
    // An update answers in no set order; the events, rows and mail list the keys oldest first.
    revoked.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    for (const key of revoked) {
      const sessionsRevoked = ended.filter((session) => session.keyId === key.id).length;
      keys.push({ id: key.id, name: key.name, sessionsRevoked });
      // The key's id and no name: the take-down blanks names, and nothing can blank them in an event.
      await tx.insert(authEvents).values({ userId, type: "staff_key_revoked", metadata: { keyId: key.id, sessionsRevoked, via: options.via } });
    }
  }
  return { keys, staffSessionsRevoked: ended.length, enrollmentsCancelled: deleted.filter((link) => link.usedAt === null).length };
}

/** The audit row of each staff key a revocation revoked, in the order of its events; among the caller's last statements. */
async function appendKeyRevocations(tx: Tx, actorId: string, revocation: StaffRevocation, via: "role_change" | "take_down"): Promise<void> {
  for (const key of revocation.keys) {
    await appendAudit(tx, {
      actorId,
      action: "staff_key_revoked",
      targetType: "staff_key",
      targetId: key.id,
      metadata: { keyId: key.id, sessionsRevoked: key.sessionsRevoked, via },
    });
  }
}

/**
 * A take-down's audit rows, its transaction's last statements (3a design, section 7): each staff key's revocation and,
 * when an open enrolment link went, one staff_enrollments_cancelled row with their count, so the take-down never ends
 * any staff access without a row on the record. The spent links it deletes too are no cancellation, and like the
 * janitor's deletions of them they get no row. Nothing when the account had no staff access left to take.
 */
async function appendTakeDownAudit(tx: Tx, actorId: string, userId: string, revocation: StaffRevocation): Promise<void> {
  await appendKeyRevocations(tx, actorId, revocation, "take_down");
  if (revocation.enrollmentsCancelled > 0) {
    await appendAudit(tx, {
      actorId,
      action: "staff_enrollments_cancelled",
      targetType: "user",
      targetId: userId,
      metadata: { count: revocation.enrollmentsCancelled, via: "take_down" },
    });
  }
}

/**
 * The rows step 1 of a deletion takes down, inside the caller's transaction: every live session is revoked
 * (its id answered, for the cache tombstones), every device is deleted, and with it by cascade every session
 * row, every code out for the user goes, whatever its purpose, so none can complete a flow for an account
 * that is gone, and every passkey goes with the WebAuthn user handle (1c design, section 7.7), so a deleted
 * account keeps no credential of any kind and no assertion can name it again. Its staff access ends too (3a design,
 * section 7): its live staff keys and staff sessions are revoked, with a staff_key_revoked event per key, and its
 * enrolment links deleted. The keys themselves are never deleted, since audit-verify checks old confirmations against
 * them, so auth.forget_staff_keys blanks their names, AAGUIDs and transports and keeps what audit-verify needs. It writes
 * no audit row: the caller writes those last, from what this answers. Run again by finishTakeDown, each statement finds
 * nothing more to do.
 */
async function takeDownRows(tx: Tx, userId: string, now: Date): Promise<{ sessionIds: string[]; staff: StaffRevocation }> {
  const revoked = await tx
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  await tx.delete(devices).where(eq(devices.userId, userId));
  await tx.delete(emailCodes).where(eq(emailCodes.userId, userId));
  await tx.delete(passkeys).where(eq(passkeys.userId, userId));
  // The handle only ever named the account to its passkeys and staff keys; cleared here rather than by finishPurge, so the
  // take-down leaves nothing of the ceremony behind.
  await tx.update(users).set({ webauthnUserId: null }).where(eq(users.id, userId));
  const staff = await revokeStaffAccess(tx, userId, now, { keys: true, enrollments: "all", via: "take_down" });
  // The account is marked deleted by now, which the function checks: for a live account it would change nothing.
  await tx.execute(sql`select auth.forget_staff_keys(${userId}::uuid)`);
  return { sessionIds: revoked.map((row) => row.id), staff };
}

export type AuthRepo = ReturnType<typeof createAuthRepo>;
```

### Replace `apps/api/src/auth/staff/enroll.ts` (whole file)

```ts
import { randomBytes } from "node:crypto";
import type { StaffEnrollOptionsRequest, StaffEnrollVerifyRequest, StaffEnrollVerifyResponse } from "@korbat/contracts";
import { AuthError, isUniqueViolation, type AuthDeps, type StaffRequestContext } from "../context";
import { sha256Hex } from "../crypto";
import { noticeTime, notifyAccount } from "../flows/notify";
import { challengeKey, issueChallenge, readChallenge, spendChallenge } from "../passkeys/challenge";
import {
  readResponseChallenge,
  registrationOptions,
  verifyRegistration,
  type CredentialDescriptor,
  type PublicKeyCredentialCreationOptionsJSON,
} from "../passkeys/webauthn";
import type { StaffEnrollmentRow } from "../repo";

/**
 * Staff key enrolment (3a design, section 7, Enrolment). The link `staff.js enroll` printed carries a one-time token; the
 * console's enrolment page asks for the key's options with it, then hands the browser's answer back with it. The routes
 * live in the staff module, behind the staff gate; the credential work is here.
 */

/** The options as the library wrote them, which the contracts' StaffEnrollOptionsResponse passes through to the browser. */
export interface StaffEnrollOptions {
  options: PublicKeyCredentialCreationOptionsJSON;
  rpShared: boolean;
}

const enrollmentInvalid = () => new AuthError("staff_enrollment_invalid", 400);
/** Every refusal of the codec or the wrapper at enrolment: no staff answer carries a passkey_* code (3a design, section 10). */
const keyRefused = () => new AuthError("staff_key_refused", 400);

/** The console as the configuration sets it; the staff routes are mounted only while it is on, so its absence is a wiring fault. */
export function consoleOf(deps: AuthDeps): { origin: string; rpId: string } {
  if (!deps.config.console) throw new Error("the staff console is off: CONSOLE_ORIGIN is not set");
  return deps.config.console;
}

/** Whether staff keys and personal passkeys share a relying party ID, as both are localhost in development (3a design, section 2). */
function sharedRelyingParty(deps: AuthDeps): boolean {
  return deps.config.console !== null && deps.config.console.rpId === deps.config.webauthn.rpId;
}

/**
 * The enrolment a link's token names, while it can still enrol a key: unused, unexpired by the flows' clock, issued for
 * the console as it is configured now (a link issued before the console moved would bind a key to the old address), and
 * for an account that is live, staff and has a handle. Anything else, an unknown token included, is one answer.
 * auth.add_staff_key checks all of it again under the account's lock, by the database's clock.
 */
async function liveEnrollment(deps: AuthDeps, token: string): Promise<StaffEnrollmentRow> {
  const staffConsole = consoleOf(deps);
  const enrollment = await deps.repo.findStaffEnrollment(sha256Hex(token));
  if (!enrollment) throw enrollmentInvalid();
  if (enrollment.usedAt !== null || enrollment.expiresAt.getTime() <= deps.now().getTime()) throw enrollmentInvalid();
  if (enrollment.origin !== staffConsole.origin || enrollment.rpId !== staffConsole.rpId) throw enrollmentInvalid();
  if (enrollment.deletedAt !== null || enrollment.role === "user" || enrollment.onboardedAt === null) throw enrollmentInvalid();
  return enrollment;
}

/** Runs one step of the codec or the wrapper, answering its passkey_* refusals with staff_key_refused; challenge_expired stays, and the console starts over on it. */
async function refusedAsStaff<T>(step: () => T | Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (err) {
    if (err instanceof AuthError && (err.code === "passkey_invalid" || err.code === "passkey_unsupported")) throw keyRefused();
    throw err;
  }
}

/**
 * Registration options for a staff key: the console's relying party, the account's 1c user handle (set now with 1c's
 * compare-and-set when the account has none), the key's name as the only label the authenticator shows, user
 * verification and a resident key required, the pinned algorithms, and a staff registration challenge bound to the
 * enrolment's id. The account's live staff keys are excluded, and while the two relying party IDs are equal its personal
 * passkeys too, so an authenticator refuses rather than replacing one kind with the other under the same user handle. The
 * "Register a security key" button sends the security-key hint; "Use Windows Hello on this computer" sends none, since the
 * hint would hide Windows Hello. `rpShared` tells the page whether it may ask a password manager to drop a refused key.
 */
export async function enrollOptions(deps: AuthDeps, input: StaffEnrollOptionsRequest): Promise<StaffEnrollOptions> {
  const staffConsole = consoleOf(deps);
  const enrollment = await liveEnrollment(deps, input.token);
  // 32 random bytes, never the account id, set once: a passkey registration racing this one reads the same bytes back.
  const userHandle = enrollment.webauthnUserId ?? (await deps.repo.ensureWebauthnUserId(enrollment.userId, randomBytes(32)));
  if (!userHandle) throw enrollmentInvalid();
  const shared = sharedRelyingParty(deps);
  const exclude: CredentialDescriptor[] = (await deps.repo.listLiveStaffKeys(enrollment.userId)).map((k) => ({ id: k.credentialId, transports: k.transports }));
  if (shared) exclude.push(...(await deps.repo.listPasskeys(enrollment.userId)).map((p) => ({ id: p.credentialId, transports: p.transports })));
  const challenge = issueChallenge(challengeKey(deps.config.authHmacKey), "staff_register", deps.now(), enrollment.id);
  const options = await registrationOptions({
    rp: { id: staffConsole.rpId, name: deps.config.webauthn.rpName },
    // Never the email, the handle or the account id: the authenticator shows this name, and so does anyone who sees it.
    user: { id: userHandle, name: input.name, displayName: input.name },
    exclude,
    challenge,
    userVerification: "required",
    hint: input.kind === "security_key" ? "securityKey" : undefined,
  });
  return { options, rpShared: shared };
}

/**
 * Stores the staff key the browser created. The link is checked first, then the challenge is read from the response,
 * checked against the enrolment's id and spent before anything else runs, and the response verified against
 * CONSOLE_ORIGIN and CONSOLE_RP_ID alone; whatever the codec or the wrapper refuses is staff_key_refused. Only then are
 * the flags read, each refusal with its own code: a key that did not verify the user, or that reported backup
 * eligibility (it can be synced) or a backup. A refusal never spends the link, so the person can try another key until
 * it expires. The write is one transaction that ends in auth.add_staff_key; after the commit the owner is mailed.
 */
export async function enrollVerify(deps: AuthDeps, input: StaffEnrollVerifyRequest, ctx: StaffRequestContext): Promise<StaffEnrollVerifyResponse> {
  const staffConsole = consoleOf(deps);
  const enrollment = await liveEnrollment(deps, input.token);
  const now = deps.now();
  const key = challengeKey(deps.config.authHmacKey);
  const challenge = await refusedAsStaff(() => readResponseChallenge(input.response));
  await refusedAsStaff(() => readChallenge(key, challenge, "staff_register", now, enrollment.id));
  await refusedAsStaff(() => spendChallenge(deps.kv, challenge, now));
  const verified = await refusedAsStaff(() => verifyRegistration({ response: input.response, expectedChallenge: challenge, origins: [staffConsole.origin], rpId: staffConsole.rpId }));
  // After the library has verified, so each refusal is the authenticator's own claim about a key it really created.
  if (!verified.userVerified) throw new AuthError("staff_key_not_user_verified", 403);
  if (verified.backupEligible || verified.backedUp) throw new AuthError("staff_key_not_device_bound", 403);

  let outcome;
  try {
    outcome = await deps.repo.addStaffKey({
      userId: enrollment.userId,
      enrollmentId: enrollment.id,
      token: input.token,
      credentialId: verified.credentialId,
      publicKey: verified.publicKey,
      counter: verified.counter,
      transports: verified.transports,
      name: input.name,
      // Zeros when the authenticator or the browser withheld its model, which `staff.js keys` prints as such.
      aaguid: verified.aaguid,
      requestId: ctx.requestId,
    });
  } catch (err) {
    // A credential id korbat already holds as a staff key: the authenticator answered for a key that is not new.
    if (isUniqueViolation(err)) throw keyRefused();
    throw err;
  }
  if (!outcome.ok) throw outcome.reason === "limit" ? new AuthError("staff_key_limit", 409) : enrollmentInvalid();

  const stored = await deps.repo.findStaffKey(outcome.keyId);
  if (!stored) throw new Error(`the staff key ${outcome.keyId} was stored but cannot be read back`);
  // After the commit, and best effort as every notice is: a failed mail never undoes an enrolment.
  await notifyAccount(deps, enrollment.email, "staff_key_added", { name: stored.name, time: noticeTime(stored.createdAt) });
  return { key: { id: stored.id, name: stored.name, createdAt: stored.createdAt.toISOString(), lastUsedAt: stored.lastUsedAt?.toISOString() ?? null } };
}
```

### Replace `apps/api/src/cli/mail.ts` (whole file)

```ts
/**
 * The command line's mailer (3a design, section 7): grant-role's demotion and the staff command line's revocations mail
 * the key's owner. It is built as the API builds its mailer, from SMTP_URL and MAIL_FROM alone, so a command that mails
 * needs nothing else of the API's configuration. This file has no entry point of its own, so both bundles can include
 * it (build.mjs says why that matters).
 */
import { z } from "zod";
import { mailFrom, smtpUrl } from "../config";
import type { Mailer } from "../mail/mailer";
import { smtpMailer } from "../mail/smtp";

const MAIL_ENV = z.object({ SMTP_URL: smtpUrl, MAIL_FROM: mailFrom, NODE_ENV: z.string().optional() });

export interface CommandLineMailSettings {
  smtpUrl: string;
  mailFrom: string;
  /** Production refuses a plain relay that does not upgrade with STARTTLS, as the API does. */
  requireTls: boolean;
}

/** The mail settings a command that mails reads, naming the one that is missing or wrong and nothing else. */
export function commandLineMailSettings(env: Record<string, string | undefined>): CommandLineMailSettings {
  const result = MAIL_ENV.safeParse(env);
  if (!result.success) throw new Error(`Invalid mail settings:\n${z.prettifyError(result.error)}`);
  return { smtpUrl: result.data.SMTP_URL, mailFrom: result.data.MAIL_FROM, requireTls: result.data.NODE_ENV === "production" };
}

/** The mailer itself. A send that fails throws MailUnavailable; the commands report it as a warning that undoes nothing. */
export function commandLineMailer(env: Record<string, string | undefined>): Mailer {
  return mailerFor(commandLineMailSettings(env));
}

/** The same mailer from settings a command read with its own schema, as staff.js revoke reads them beside its database URL. */
export function mailerFor(settings: CommandLineMailSettings): Mailer {
  return smtpMailer(settings.smtpUrl, settings.mailFrom, { requireTls: settings.requireTls });
}
```

### Replace `apps/api/src/cli/staff.ts` (whole file)

```ts
/**
 * The staff command line (3a design, section 7). Run on the server only. enroll runs in the migrate service, as the
 * migrator, the one application role the running API never holds; the others run like grant-role:
 *
 *   docker compose -f infra/compose.yml run --rm migrate node dist/staff.js enroll <email>
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js keys [<email>]
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js revoke <email> <key id>|all
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js audit-head
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js audit-verify [<chain_seq>:<hash> ...]
 *
 * enroll prints a one-time link that registers one staff key for a live staff account with a handle; the database lets
 * only the migrator issue one. keys lists an account's staff keys, or every staff account with its keys, for the
 * runbook's comparison with the operator's own list. revoke revokes one key and every staff session it opened, or with
 * `all` every key and staff session of the account and its unused enrolment links, and mails the owner; it is the only way
 * to revoke a key by hand, since no console route does.
 *
 * audit-head prints the audit log's newest place and hash, which the keeper holds off the server. audit-verify recomputes
 * the whole chain in its own code (the staff module's chain.ts), never asking the database for a text or a hash, since
 * whoever owns the database can replace its functions, and checks it against the places kept before: a rewrite that
 * recomputed every later hash still fails against a place kept before it. Neither needs a server secret or the console's
 * configuration, so both run the same with the console off or moved: each reads only the database URLs it connects with
 * (staffDatabaseUrls), never the API's whole configuration.
 */
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { Email } from "@korbat/contracts";
import { auditHead, auditLog, authEvents, closeDb, createDb, profiles, staffEnrollments, staffKeys, users, type Db, type DbTx } from "@korbat/db";
import { SYSTEM_ACTOR_ID, createAuthRepo, revokeStaffKeys, type StaffKeysRevokedReport } from "../auth";
import { consoleHostOf, consoleOriginSetting, consoleRpIdSetting, databaseUrl, mailFrom, smtpUrl } from "../config";
import { CHAIN_ZERO_HASH, canonicalText, chainHash } from "../staff";
import { LOCK_TIMEOUT_ADVICE, isLockTimeout } from "./lock-timeout";
import { mailerFor, type CommandLineMailSettings } from "./mail";

export const STAFF_USAGE = [
  "usage: node dist/staff.js <command>",
  "  enroll <email>                         print a one-time link, valid 30 minutes, that registers one staff key for the account;",
  "                                         run it in the migrate service: docker compose -f infra/compose.yml run --rm migrate node dist/staff.js enroll <email>",
  "  keys [<email>]                         list the account's staff keys, or every staff account with its role, address, handle and keys",
  "  audit-head                             print the audit log's newest place, its hash and its time, to keep off the server",
  "  audit-verify [<chain_seq>:<hash> ...]  recompute the audit chain and check it against places kept before",
  "  revoke <email> <key id>                revoke that staff key and every staff session it opened, and mail its owner",
  "  revoke <email> all                     revoke every staff key and staff session of the account, delete its unused",
  "                                         enrolment links, and mail its owner",
].join("\n");

/** A place in the chain and the hash it had when someone kept it, as audit-head printed it. */
export interface KeptPlace {
  seq: number;
  hash: string;
}

export type StaffCommand =
  | { command: "enroll"; email: string }
  | { command: "keys"; email: string | null }
  | { command: "audit-head" }
  | { command: "audit-verify"; kept: KeptPlace[] }
  | { command: "revoke"; email: string; key: string | "all" };

/** A place as the keeper copies it: at most 15 digits, so it is always a safe integer, and a lower-case hex sha256. */
const KEPT_PLACE = /^([1-9][0-9]{0,14}):([0-9a-f]{64})$/;
/** A staff key's id as `keys` prints it: a uuid, read in any case and kept in PostgreSQL's lower-case form. */
const KEY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** An address as the account was registered with it: trimmed and lower-cased, as the contracts read it. */
function emailArg(arg: string): string {
  const email = Email.safeParse(arg);
  if (!email.success) throw new Error(`not an email address: ${arg}\n${STAFF_USAGE}`);
  return email.data;
}

export function parseStaffArgs(args: readonly string[]): StaffCommand {
  const [command, ...rest] = args;
  switch (command) {
    case "enroll":
      if (rest.length !== 1) throw new Error(STAFF_USAGE);
      return { command, email: emailArg(rest[0]!) };
    case "keys":
      if (rest.length > 1) throw new Error(STAFF_USAGE);
      return { command, email: rest.length === 1 ? emailArg(rest[0]!) : null };
    case "audit-head":
      if (rest.length > 0) throw new Error(STAFF_USAGE);
      return { command };
    case "revoke": {
      if (rest.length !== 2) throw new Error(STAFF_USAGE);
      const email = emailArg(rest[0]!);
      // Exactly "all"; anything else must be a key's id, so a typo never revokes every key.
      if (rest[1] === "all") return { command, email, key: "all" };
      const key = rest[1]!.toLowerCase();
      if (!KEY_ID.test(key)) throw new Error(`not a key id or all: ${rest[1]} (staff.js keys prints each key's id)\n${STAFF_USAGE}`);
      return { command, email, key };
    }
    case "audit-verify":
      return {
        command,
        kept: rest.map((arg) => {
          const match = KEPT_PLACE.exec(arg);
          if (!match) throw new Error(`not a kept place: ${arg} (a kept place is <chain_seq>:<hash>, as audit-head prints it)\n${STAFF_USAGE}`);
          return { seq: Number(match[1]), hash: match[2]! };
        }),
      };
    case undefined:
      throw new Error(STAFF_USAGE);
    default:
      throw new Error(`unknown command: ${command}\n${STAFF_USAGE}`);
  }
}

// ---------------------------------------------------------------- the environment

/**
 * What each command reads of the environment, after its arguments are known, and nothing more. The API's configuration
 * (loadConfig) would also require its secrets, Valkey, the mail settings and APP_ORIGIN, and would refuse a CONSOLE_ORIGIN
 * its rules reject, none of which these commands use. audit-head reads the record on the API's role; audit-verify also
 * reads the staff keys on the auth role's.
 */
const AUDIT_HEAD_ENV = z.object({ DATABASE_URL_API: databaseUrl });
const AUDIT_VERIFY_ENV = AUDIT_HEAD_ENV.extend({ DATABASE_URL_AUTH: databaseUrl });

function readEnv<T extends z.ZodType>(schema: T, env: Record<string, string | undefined>, command: string): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) throw new Error(`Invalid environment for ${command}:\n${z.prettifyError(result.error)}`);
  return result.data;
}

/**
 * The database URLs a command connects with: the API role's, and the auth role's for audit-verify and keys, which read the
 * staff keys there. enroll connects as the migrator alone and reads its settings with enrollSettings.
 */
export function staffDatabaseUrls(command: Exclude<StaffCommand, { command: "enroll" | "revoke" }>, env: Record<string, string | undefined>): { api: string; auth: string | null } {
  if (command.command === "audit-verify" || command.command === "keys") {
    const urls = readEnv(AUDIT_VERIFY_ENV, env, command.command);
    return { api: urls.DATABASE_URL_API, auth: urls.DATABASE_URL_AUTH };
  }
  return { api: readEnv(AUDIT_HEAD_ENV, env, command.command).DATABASE_URL_API, auth: null };
}

/**
 * What enroll reads: the migrator's URL, which only the migrate service holds, and the console's origin and relying party
 * ID, which Compose gives that service, each by the API's own rule for it. The relying party ID defaults to the console's
 * hostname, as the API's does. Nothing else of the API's configuration is read: the migrate service holds none of it.
 */
const ENROLL_ENV = z.object({ DATABASE_URL_MIGRATE: databaseUrl, CONSOLE_ORIGIN: consoleOriginSetting, CONSOLE_RP_ID: consoleRpIdSetting });

export interface EnrollSettings {
  migrate: string;
  consoleOrigin: string;
  consoleRpId: string;
}

/** enroll's settings, refusing while the console is off: a link to a console that does not run would enrol nothing. */
export function enrollSettings(env: Record<string, string | undefined>): EnrollSettings {
  // Blank counts as unset, as Compose passes an empty line of infra/.env.
  if (!env.CONSOLE_ORIGIN?.trim()) {
    throw new Error(
      "CONSOLE_ORIGIN is not set: the staff console is off, so no enrolment link can be issued. " +
        "Set API_CONSOLE_ORIGIN in infra/.env to the console's address (the migrate service reads it as CONSOLE_ORIGIN) and run the command again.",
    );
  }
  const settings = readEnv(ENROLL_ENV, env, "enroll");
  const consoleOrigin = settings.CONSOLE_ORIGIN!;
  return { migrate: settings.DATABASE_URL_MIGRATE, consoleOrigin, consoleRpId: settings.CONSOLE_RP_ID ?? consoleHostOf(consoleOrigin) };
}

/**
 * What revoke reads: the auth role's URL, on which it revokes, and the mail settings, with which it tells the key's owner,
 * each by the API's own rule for it. The API role's URL and the API's secrets are not read: revoke needs neither.
 */
const REVOKE_ENV = z.object({ DATABASE_URL_AUTH: databaseUrl, SMTP_URL: smtpUrl, MAIL_FROM: mailFrom, NODE_ENV: z.string().optional() });

export interface RevokeSettings {
  auth: string;
  mail: CommandLineMailSettings;
}

/** revoke's settings; production refuses a plain relay that does not upgrade with STARTTLS, as the API does. */
export function revokeSettings(env: Record<string, string | undefined>): RevokeSettings {
  const settings = readEnv(REVOKE_ENV, env, "revoke");
  return { auth: settings.DATABASE_URL_AUTH, mail: { smtpUrl: settings.SMTP_URL, mailFrom: settings.MAIL_FROM, requireTls: settings.NODE_ENV === "production" } };
}

// ---------------------------------------------------------------- reading the record

/** What the record is read through: the command line's own connection, or a transaction a test hands in. */
type Reader = Pick<Db, "select" | "execute">;

/** How many rows audit-verify reads at a time. */
const PAGE_SIZE = 1000;

/**
 * Sets the transaction up to read the record as the canonical text needs it. Times come as ISO text in UTC, which is what
 * the rows' Date values are parsed from (a session in 'SQL, DMY' would print another form), and a lock is waited on for
 * at most 10 seconds, as every staff command waits.
 */
async function readingSettings(q: Reader): Promise<void> {
  await q.execute(sql`set local datestyle = 'ISO'`);
  await q.execute(sql`set local timezone = 'UTC'`);
  await q.execute(sql`set local lock_timeout = '10s'`);
}

/**
 * The next page of rows after place `after` (from the lowest place when null) up to place `upto` (to the end when null),
 * in chain order. The jsonb columns come as PostgreSQL prints them, which the canonical text embeds as it is.
 */
function chainRows(q: Reader, after: number | null, upto: number | null) {
  return q
    .select({
      id: auditLog.id,
      chainVersion: auditLog.chainVersion,
      chainSeq: auditLog.chainSeq,
      createdAt: auditLog.createdAt,
      actorId: auditLog.actorId,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      requestId: auditLog.requestId,
      staffSession: auditLog.staffSession,
      keyId: auditLog.keyId,
      actionHash: auditLog.actionHash,
      stepUpText: sql<string | null>`${auditLog.stepUp}::text`,
      metadataText: sql<string>`${auditLog.metadata}::text`,
      prevHash: auditLog.prevHash,
      hash: auditLog.hash,
    })
    .from(auditLog)
    .where(and(after === null ? undefined : gt(auditLog.chainSeq, after), upto === null ? undefined : lte(auditLog.chainSeq, upto)))
    .orderBy(asc(auditLog.chainSeq))
    .limit(PAGE_SIZE);
}

// ---------------------------------------------------------------- audit-verify

/** One thing audit-verify found wrong: the place it is at, or null for the head or a staff key. */
export interface AuditProblem {
  place: number | null;
  message: string;
}

export interface AuditReport {
  ok: boolean;
  /** The rows read: every row up to the head's place, and any other row the table holds at or below it. */
  rows: number;
  /** The head as audit_head held it, or null when the row is missing. */
  head: KeptPlace | null;
  keptChecked: number;
  /** How many rows follow the newest kept place, which no kept place anchors yet; every row when none was given. */
  unanchored: number;
  keysChecked: number;
  /** Keys whose staff_key_added row was written after the head this run read: the next run checks them. */
  keysLeftToNextRun: number;
  /** The first problems, in chain order, then the head's, the kept places' and the keys'. */
  problems: AuditProblem[];
  problemCount: number;
}

/** How many problems a report keeps: enough to name the first rows at fault. */
const PROBLEMS_KEPT = 100;

/** What one snapshot of the record showed, before the keys missing from it are looked up again. */
interface Walk {
  head: KeptPlace | null;
  rows: number;
  newest: KeptPlace | null;
  keptChecked: number;
  unanchored: number;
  keys: string[];
  /** The places of the staff_key_added rows read, by the key their key_id names. */
  keyRows: Map<string, number[]>;
  problems: AuditProblem[];
  problemCount: number;
}

/**
 * Everything audit-verify checks inside one view of the record: the head, then every row up to the head's place in chain
 * order, a page at a time. Run in a REPEATABLE READ transaction, a row written meanwhile is neither read nor missed. The
 * staff keys are read from `keysFrom` after the head, so each key listed either has its staff_key_added row among the
 * rows read or was added after the head.
 */
async function walkRecord(q: Reader, kept: readonly KeptPlace[], keysFrom: Pick<Db, "select">): Promise<Walk> {
  const problems: AuditProblem[] = [];
  let problemCount = 0;
  const problem = (place: number | null, message: string) => {
    problemCount++;
    if (problems.length < PROBLEMS_KEPT) problems.push({ place, message });
  };

  await readingSettings(q);
  const [headRow] = await q.select({ seq: auditHead.seq, hash: auditHead.hash }).from(auditHead).where(eq(auditHead.id, 1));
  const head = headRow ?? null;
  if (!head) problem(null, "the audit head is missing");
  const keys = (await keysFrom.select({ id: staffKeys.id }).from(staffKeys)).map((key) => key.id);

  const keptAt = new Map<number, string[]>();
  for (const place of kept) keptAt.set(place.seq, [...(keptAt.get(place.seq) ?? []), place.hash]);
  const keptSeen = new Set<number>();
  const keyRows = new Map<string, number[]>();
  let rows = 0;
  let previous: KeptPlace | null = null;
  // Without a head the whole table is read, so the other problems are still named.
  for (let after: number | null = null; ; ) {
    const page = await chainRows(q, after, head ? head.seq : null);
    for (const row of page) {
      rows++;
      const expected = previous ? previous.seq + 1 : 1;
      if (row.chainSeq < expected) {
        problem(row.chainSeq, "its place is not in the chain, which runs from place 1");
      } else if (row.chainSeq > expected) {
        problem(expected, row.chainSeq - expected === 1 ? `place ${expected} is missing` : `places ${expected} to ${row.chainSeq - 1} are missing`);
      }
      if (row.prevHash !== (previous ? previous.hash : CHAIN_ZERO_HASH)) {
        problem(row.chainSeq, previous ? `its prev_hash is not the hash of place ${previous.seq}` : "its prev_hash is not 64 zeros, as the first row's must be");
      }
      // The row's own hash, over its stored prev_hash: a changed row fails here, and a changed hash fails the next link.
      let text: string | null = null;
      try {
        text = canonicalText(row);
      } catch (err) {
        problem(row.chainSeq, (err as Error).message);
      }
      if (text !== null && chainHash(row.prevHash, text) !== row.hash) problem(row.chainSeq, "its hash does not match its content");
      for (const hash of keptAt.get(row.chainSeq) ?? []) {
        keptSeen.add(row.chainSeq);
        if (hash !== row.hash) problem(row.chainSeq, `the kept place ${row.chainSeq}:${hash} no longer matches: the row there has the hash ${row.hash}`);
      }
      if (row.action === "staff_key_added" && row.keyId !== null) keyRows.set(row.keyId, [...(keyRows.get(row.keyId) ?? []), row.chainSeq]);
      previous = { seq: row.chainSeq, hash: row.hash };
    }
    if (page.length < PAGE_SIZE) break;
    after = page[page.length - 1]!.chainSeq;
  }

  if (head) {
    const [beyond] = await q
      .select({ seq: auditLog.chainSeq })
      .from(auditLog)
      .where(gt(auditLog.chainSeq, head.seq))
      .orderBy(asc(auditLog.chainSeq))
      .limit(1);
    if (beyond) problem(beyond.seq, `rows lie beyond the head's place ${head.seq}, from place ${beyond.seq}`);
    if (!previous) {
      if (head.seq !== 0 || head.hash !== CHAIN_ZERO_HASH) problem(null, `the head names place ${head.seq}, but no row is at or before it`);
    } else if (previous.seq !== head.seq) {
      problem(null, `the head names place ${head.seq}, but the newest row up to it is at place ${previous.seq}`);
    } else if (previous.hash !== head.hash) {
      problem(head.seq, "the head's hash is not the hash of the row at its place");
    }
  }
  for (const place of kept) {
    if (!keptSeen.has(place.seq)) problem(place.seq, `the kept place ${place.seq}:${place.hash} no longer matches: no row is at that place`);
  }
  const newestSeq = previous?.seq ?? 0;
  const newestKept = kept.length > 0 ? Math.max(...kept.map((place) => place.seq)) : 0;
  return {
    head,
    rows,
    newest: previous,
    keptChecked: kept.length,
    unanchored: Math.max(0, newestSeq - newestKept),
    keys,
    keyRows,
    problems,
    problemCount,
  };
}

/**
 * The staff keys' check, outside the snapshot: every staff key has exactly one staff_key_added row, which names it in
 * key_id. A key with none among the rows read is looked up again through `fresh`; one whose row was written after the
 * head is left to the next run, and one with no row at all is a problem.
 */
async function finishReport(walk: Walk, fresh: Pick<Db, "select">): Promise<AuditReport> {
  const problems = [...walk.problems];
  let problemCount = walk.problemCount;
  const problem = (message: string) => {
    problemCount++;
    if (problems.length < PROBLEMS_KEPT) problems.push({ place: null, message });
  };
  const missing: string[] = [];
  for (const key of walk.keys) {
    const places = walk.keyRows.get(key) ?? [];
    if (places.length === 0) missing.push(key);
    else if (places.length > 1) problem(`staff key ${key} has ${places.length} staff_key_added rows (places ${places.join(", ")})`);
  }
  let keysLeftToNextRun = 0;
  if (missing.length > 0) {
    const read = walk.head ? walk.head.seq : (walk.newest?.seq ?? 0);
    const later = await fresh
      .select({ keyId: auditLog.keyId })
      .from(auditLog)
      .where(and(eq(auditLog.action, "staff_key_added"), inArray(auditLog.keyId, missing), gt(auditLog.chainSeq, read)));
    const addedLater = new Set(later.map((row) => row.keyId));
    for (const key of missing) {
      if (addedLater.has(key)) keysLeftToNextRun++;
      else problem(`staff key ${key} has no staff_key_added row`);
    }
  }
  return {
    ok: problemCount === 0,
    rows: walk.rows,
    head: walk.head,
    keptChecked: walk.keptChecked,
    unanchored: walk.unanchored,
    keysChecked: walk.keys.length,
    keysLeftToNextRun,
    problems,
    problemCount,
  };
}

/**
 * audit-verify on the command line's own connections: the record read on the API's role in one REPEATABLE READ READ ONLY
 * transaction, the staff keys on the auth role's.
 */
export async function auditVerify(db: { api: Db; auth: Db }, kept: readonly KeptPlace[]): Promise<AuditReport> {
  const walk = await db.api.transaction((tx) => walkRecord(tx, kept, db.auth), { isolationLevel: "repeatable read", accessMode: "read only" });
  return finishReport(walk, db.api);
}

/**
 * The same check through a transaction the caller holds, so a test can verify rows it wrote, or rewrote as the owner, and
 * then roll back: no later test sees a chain broken on purpose. The staff keys are read through the transaction too,
 * unless its role cannot read them (the API's), when `keysFrom` names the auth role's pool.
 */
export async function checkAuditRecord(tx: DbTx, kept: readonly KeptPlace[], keysFrom: Pick<Db, "select"> = tx): Promise<AuditReport> {
  return finishReport(await walkRecord(tx, kept, keysFrom), tx);
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** How audit-verify reports: what holds, or the first problems; and the rows no kept place anchors yet. */
export function describeReport(report: AuditReport): string[] {
  const lines: string[] = [];
  if (report.ok) {
    lines.push(
      report.rows === 0
        ? "audit-verify: the chain holds: the audit log is empty"
        : `audit-verify: the chain holds: ${plural(report.rows, "row", "rows")}, from place 1 to the head ${report.head!.seq}:${report.head!.hash}`,
    );
  } else {
    lines.push(`audit-verify: FAILED, ${plural(report.problemCount, "problem", "problems")}; the first rows at fault:`);
    const shown = report.problems.slice(0, 20);
    for (const p of shown) lines.push(p.place === null ? `  ${p.message}` : `  place ${p.place}: ${p.message}`);
    if (report.problemCount > shown.length) lines.push(`  and ${report.problemCount - shown.length} more`);
  }
  lines.push(
    report.keptChecked === 0
      ? `no kept place given: ${plural(report.unanchored, "row is", "rows are")} not yet anchored by a kept place`
      :`${plural(report.keptChecked, "kept place", "kept places")} checked; ${plural(report.unanchored, "row", "rows")} after the newest kept place ${report.unanchored === 1 ? "is" : "are"} not yet anchored`,
  );
  lines.push(
    `${plural(report.keysChecked, "staff key", "staff keys")} checked` +
      (report.keysLeftToNextRun > 0 ? `; ${plural(report.keysLeftToNextRun, "key was", "keys were")} added after this run's head and are left to the next run` : ""),
  );
  return lines;
}

// ---------------------------------------------------------------- enroll

/** How long an enrolment link works (3a design, section 2). */
const ENROLMENT_MINUTES = 30;
/** At most this many live staff keys per account; auth.add_staff_key refuses a sixth too. */
const LIVE_KEYS_MAX = 5;

/** What enroll issued, or why it refused. */
export type IssuedEnrolment =
  | { ok: true; token: string; email: string; role: string; expiresAt: Date }
  | { ok: false; problem: string };

/**
 * Issues an enrolment link as the migrator (3a design, section 7), in one transaction that first locks the account's row
 * FOR NO KEY UPDATE, as every writer of staff rows takes it, and waits for it at most 10 seconds. It refuses, writing
 * nothing, unless the account is live, staff and has a handle (the console names staff by their handle) and holds fewer
 * than five live keys. It writes the enrolment with only the token's sha256 and the console's origin and relying party ID,
 * its staff_enrollment_issued event, and last its audit row, which holds the chain's head until the commit. The token is
 * 32 random bytes; it is printed once and kept nowhere.
 */
export async function issueEnrolment(db: Db, email: string, settings: Pick<EnrollSettings, "consoleOrigin" | "consoleRpId">): Promise<IssuedEnrolment> {
  return db.transaction(async (tx): Promise<IssuedEnrolment> => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    const [account] = await tx
      .select({ id: users.id, email: users.email, role: users.role, onboardedAt: users.onboardedAt })
      .from(users)
      .where(and(sql`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)))
      .limit(1)
      .for("no key update");
    if (!account) return { ok: false, problem: `no live account for ${email}` };
    if (account.role === "user") return { ok: false, problem: `${email} is not staff (its role is user): make it staff with grant-role first` };
    if (account.onboardedAt === null) {
      return { ok: false, problem: `${email} has no handle yet: the console names staff by their handle, so the account chooses one in the app first` };
    }
    const [held] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(staffKeys)
      .where(and(eq(staffKeys.userId, account.id), isNull(staffKeys.revokedAt)));
    if ((held?.count ?? 0) >= LIVE_KEYS_MAX) {
      return { ok: false, problem: `${email} already holds ${LIVE_KEYS_MAX} live staff keys, the most an account may hold: revoke one before enrolling another` };
    }
    const token = randomBytes(32).toString("base64url");
    // The database's clock, which auth.add_staff_key checks the expiry against; the creation time is the same now().
    const [enrolment] = await tx
      .insert(staffEnrollments)
      .values({
        userId: account.id,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        origin: settings.consoleOrigin,
        rpId: settings.consoleRpId,
        expiresAt: sql`now() + make_interval(mins => ${ENROLMENT_MINUTES}::int)`,
      })
      .returning({ id: staffEnrollments.id, expiresAt: staffEnrollments.expiresAt });
    await tx.insert(authEvents).values({ userId: account.id, type: "staff_enrollment_issued", metadata: { enrollmentId: enrolment!.id, via: "cli" } });
    // As the migrator the row is written directly: auth.append_audit is the auth role's way, and does not take this action.
    await tx.insert(auditLog).values({
      actorId: SYSTEM_ACTOR_ID,
      action: "staff_enrollment_issued",
      targetType: "user",
      targetId: account.id,
      metadata: { enrollmentId: enrolment!.id, via: "cli" },
    });
    return { ok: true, token, email: account.email, role: account.role, expiresAt: enrolment!.expiresAt };
  });
}

/** What enroll prints: the link on a line of its own, so it can be copied whole, and how to hand it over. */
export function describeEnrolment(issued: Extract<IssuedEnrolment, { ok: true }>, consoleOrigin: string): string[] {
  return [
    `Enrolment link for ${issued.email} (${issued.role}), valid for ${ENROLMENT_MINUTES} minutes, until ${issued.expiresAt.toISOString()}, and once:`,
    `${consoleOrigin}/enroll/${issued.token}`,
    "Hand it over by a channel you trust: whoever holds it can register a staff key for this account. The person opens it on the device that holds the key, then signs in once with the new key.",
  ];
}

// ---------------------------------------------------------------- keys

/** One account as keys lists it, with its keys oldest first. */
export interface StaffKeysListing {
  id: string;
  email: string;
  role: string;
  handle: string | null;
  keys: {
    id: string;
    name: string;
    aaguid: string | null;
    createdAt: Date;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    suspectAt: Date | null;
  }[];
}

/**
 * The staff keys of the live account at `email`, or of every live account whose role is not user; null when no live
 * account has that address. Keys and accounts are read on the auth role, the handles on the API role, which holds the
 * profiles. A key's public key and credential id are never read.
 */
export async function listStaffKeys(db: { api: Pick<Db, "select">; auth: Pick<Db, "select"> }, email: string | null): Promise<StaffKeysListing[] | null> {
  const accounts = await db.auth
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(and(isNull(users.deletedAt), email === null ? ne(users.role, "user") : sql`lower(${users.email}) = lower(${email})`))
    .orderBy(asc(users.email));
  if (email !== null && accounts.length === 0) return null;
  if (accounts.length === 0) return [];
  const ids = accounts.map((account) => account.id);
  const keys = await db.auth
    .select({
      id: staffKeys.id,
      userId: staffKeys.userId,
      name: staffKeys.name,
      aaguid: staffKeys.aaguid,
      createdAt: staffKeys.createdAt,
      lastUsedAt: staffKeys.lastUsedAt,
      revokedAt: staffKeys.revokedAt,
      suspectAt: staffKeys.suspectAt,
    })
    .from(staffKeys)
    .where(inArray(staffKeys.userId, ids))
    .orderBy(asc(staffKeys.createdAt), asc(staffKeys.id));
  const handles = new Map((await db.api.select({ id: profiles.id, handle: profiles.handle }).from(profiles).where(inArray(profiles.id, ids))).map((p) => [p.id, p.handle]));
  return accounts.map((account) => ({
    ...account,
    handle: handles.get(account.id) ?? null,
    keys: keys.filter((key) => key.userId === account.id).map(({ userId: _owner, ...key }) => key),
  }));
}

/**
 * How keys prints: each account on a line, its keys indented below it. A name is printed as a JSON string, so a quote or
 * a character a terminal would act on is shown escaped, never acted on. A zero AAGUID means the browser or the
 * authenticator withheld its model; none, that the account's deletion blanked it.
 */
export function describeStaffKeys(listing: StaffKeysListing[]): string[] {
  if (listing.length === 0) return ["no staff account"];
  const lines: string[] = [];
  for (const account of listing) {
    lines.push(`${account.role} ${account.email} ${account.handle === null ? "(no handle)" : `@${account.handle}`} (account ${account.id})`);
    if (account.keys.length === 0) lines.push("  no staff keys");
    for (const key of account.keys) {
      const state = key.revokedAt === null ? "live" : `revoked ${key.revokedAt.toISOString()}${key.suspectAt ? `, suspect ${key.suspectAt.toISOString()}` : ""}`;
      lines.push(
        `  key ${key.id} ${JSON.stringify(key.name)}: AAGUID ${key.aaguid ?? "none"}, created ${key.createdAt.toISOString()}, ` +
          `last used ${key.lastUsedAt ? key.lastUsedAt.toISOString() : "never"}, ${state}`,
      );
    }
  }
  return lines;
}

// ---------------------------------------------------------------- audit-head

/**
 * The newest row's place, hash and time, read with audit_head in one statement, and whether the head names that row. An
 * empty log's head is place 0 with 64 zeros.
 */
export async function readAuditHead(db: Db): Promise<{ ok: true; place: KeptPlace; createdAt: Date | null } | { ok: false; problem: string }> {
  return db.transaction(
    async (tx) => {
      await readingSettings(tx);
      const newest = tx
        .select({ seq: auditLog.chainSeq, hash: auditLog.hash, createdAt: auditLog.createdAt })
        .from(auditLog)
        .orderBy(desc(auditLog.chainSeq))
        .limit(1)
        .as("newest");
      const [row] = await tx
        .select({ headSeq: auditHead.seq, headHash: auditHead.hash, seq: newest.seq, hash: newest.hash, createdAt: newest.createdAt })
        .from(auditHead)
        .leftJoin(newest, sql`true`)
        .where(eq(auditHead.id, 1));
      if (!row) return { ok: false as const, problem: "the audit head is missing" };
      const head = { seq: row.headSeq, hash: row.headHash };
      if (row.seq === null || row.hash === null) {
        if (head.seq === 0 && head.hash === CHAIN_ZERO_HASH) return { ok: true as const, place: head, createdAt: null };
        return { ok: false as const, problem: `the head names ${head.seq}:${head.hash}, but the audit log holds no row` };
      }
      if (row.seq !== head.seq || row.hash !== head.hash) {
        return { ok: false as const, problem: `the head names ${head.seq}:${head.hash}, but the newest row is ${row.seq}:${row.hash}` };
      }
      return { ok: true as const, place: head, createdAt: row.createdAt };
    },
    { accessMode: "read only" },
  );
}

// ---------------------------------------------------------------- the command

export interface Output {
  log(line: string): void;
  error(line: string): void;
}

/** Runs one command and answers its exit code: 0 when it holds, 1 when it found a problem or failed, 2 for the usage. */
export async function runStaffCommand(args: readonly string[], env: Record<string, string | undefined> = process.env, out: Output = console): Promise<number> {
  let command: StaffCommand;
  try {
    command = parseStaffArgs(args);
  } catch (err) {
    out.error((err as Error).message);
    return 2;
  }
  if (command.command === "enroll") return runEnroll(command.email, env, out);
  if (command.command === "revoke") return runRevoke(command.email, command.key, env, out);
  let urls: { api: string; auth: string | null };
  try {
    urls = staffDatabaseUrls(command, env);
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  // The command line's own connections: the record on the API's role, which may only read it, and the staff keys on the
  // auth role's, which audit-verify checks the record against.
  const apiDb = createDb(urls.api, { max: 1 });
  const authDb = urls.auth === null ? null : createDb(urls.auth, { max: 1 });
  try {
    if (command.command === "audit-head") {
      const head = await readAuditHead(apiDb);
      if (!head.ok) {
        out.error(`audit-head: ${head.problem}; run audit-verify`);
        return 1;
      }
      out.log(`${head.place.seq}:${head.place.hash} ${head.createdAt ? head.createdAt.toISOString() : "(the audit log is empty)"}`);
      return 0;
    }
    if (command.command === "keys") {
      const listing = await listStaffKeys({ api: apiDb, auth: authDb! }, command.email);
      if (listing === null) {
        out.error(`keys: no live account for ${command.email}`);
        return 1;
      }
      for (const line of describeStaffKeys(listing)) out.log(line);
      return 0;
    }
    const report = await auditVerify({ api: apiDb, auth: authDb! }, command.kept);
    for (const line of describeReport(report)) {
      if (report.ok) out.log(line);
      else out.error(line);
    }
    return report.ok ? 0 : 1;
  } catch (err) {
    out.error(isLockTimeout(err) ? `${command.command}: ${LOCK_TIMEOUT_ADVICE}` : err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await Promise.allSettled([closeDb(apiDb), ...(authDb ? [closeDb(authDb)] : [])]);
  }
}

/** enroll, on the migrator's own connection: its settings first, so a console that is off connects to nothing. */
async function runEnroll(email: string, env: Record<string, string | undefined>, out: Output): Promise<number> {
  let settings: EnrollSettings;
  try {
    settings = enrollSettings(env);
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  const migrateDb = createDb(settings.migrate, { max: 1 });
  try {
    const issued = await issueEnrolment(migrateDb, email, settings);
    if (!issued.ok) {
      out.error(`enroll: ${issued.problem}; no link was issued`);
      return 1;
    }
    for (const line of describeEnrolment(issued, settings.consoleOrigin)) out.log(line);
    return 0;
  } catch (err) {
    out.error(isLockTimeout(err) ? `enroll: ${LOCK_TIMEOUT_ADVICE}` : err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await closeDb(migrateDb);
  }
}

// ---------------------------------------------------------------- revoke

/** What revoke prints of what it did. */
export function describeRevocation(report: Extract<StaffKeysRevokedReport, { ok: true }>, email: string, key: string | "all"): string[] {
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (key !== "all" && report.alreadyRevokedAt !== null) {
    return [`revoke: staff key ${key} of ${email} was already revoked at ${report.alreadyRevokedAt.toISOString()}; nothing changed`];
  }
  if (report.keys.length === 0 && report.staffSessionsRevoked === 0 && report.enrollmentsCancelled === 0) {
    return [`revoke: ${email} has nothing to revoke: no live staff key, staff session or unused enrolment link; nothing changed`];
  }
  const lines = [
    `revoke: ${email}: ${count(report.keys.length, "staff key", "staff keys")} revoked, ${count(report.staffSessionsRevoked, "staff session", "staff sessions")} revoked` +
      (key === "all" ? `, ${count(report.enrollmentsCancelled, "unused enrolment link", "unused enrolment links")} deleted` : ""),
  ];
  // A name is printed as a JSON string, as keys prints it, so a character a terminal would act on is shown escaped.
  for (const revoked of report.keys) lines.push(`  key ${revoked.id} ${JSON.stringify(revoked.name)}: ${count(revoked.sessionsRevoked, "staff session", "staff sessions")} revoked`);
  return lines;
}

/** revoke, on the command line's own connection on the auth role: its settings first, so a missing one connects to nothing. */
async function runRevoke(email: string, key: string | "all", env: Record<string, string | undefined>, out: Output): Promise<number> {
  let settings: RevokeSettings;
  try {
    settings = revokeSettings(env);
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  const authDb = createDb(settings.auth, { max: 1 });
  try {
    const report = await revokeStaffKeys({ repo: createAuthRepo(authDb), mailer: mailerFor(settings.mail) }, email, key);
    if (!report.ok) {
      out.error(report.reason === "no_account" ? `revoke: no live account for ${email}; nothing changed` : `revoke: no staff key ${key} on ${email}; nothing changed`);
      return 1;
    }
    for (const line of describeRevocation(report, email, key)) out.log(line);
    // The revocation stands whatever the mail does; the operator tells the person another way.
    if (report.mailError !== null) out.error(`warning: the staff_keys_revoked mail to the account could not be sent (${report.mailError}); the revocation stands`);
    return 0;
  } catch (err) {
    out.error(isLockTimeout(err) ? `revoke: ${LOCK_TIMEOUT_ADVICE}` : err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await closeDb(authDb);
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void runStaffCommand(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
```

### Replace `apps/api/src/env.ts` (whole file)

```ts
import type { Logger } from "pino";
import type { ActiveStaffSession, Session } from "./auth";

export type { Session };

export type AppEnv = {
  Variables: {
    requestId: string;
    log: Logger;
    session: Session | null;
    /** How the session was presented: the HttpOnly cookie (web) or a bearer token (native). */
    authVia: "cookie" | "bearer" | null;
    /** The staff session requireStaff read on a staff route (3a design, section 7); never set elsewhere. */
    staffSession: ActiveStaffSession | null;
    /** The client address as TRUST_PROXY says to read it, and its keyed hash: the only form limits and audit rows hold. */
    clientIp: string;
    clientIpHash: string;
  };
};
```

### Replace `apps/api/src/staff/index.ts` (whole file)

```ts
/**
 * The only file outside `src/staff/` may import. Everything else in the module is private and the architecture test fails
 * the build if another file reaches into it.
 *
 * The staff module (3a design, section 5) runs on the API's role: it owns the audit log's reader, the chain's canonical
 * text in Node (chain.ts, which audit-verify recomputes the record with) and the writer for staff actions on public tables,
 * and it mounts the staff routes behind the staff gate. Staff keys, staff sessions and enrolments are credentials, the auth
 * module's alone: this module reaches them only through the auth module's interface.
 */
import type { AuditPageQuery } from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type { AuthForStaff } from "../auth";
import { auditPage } from "./audit";
import { staffRoutes } from "./routes";

export { CHAIN_ZERO_HASH, canonicalText, chainHash, type ChainRow } from "./chain";
export { appendAuditRow, type AuditPlace, type StaffAuditRow } from "./audit";

export interface CreateStaffOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** The auth module's staff interface: the credential side of the routes, which only the auth module may touch. */
  auth: AuthForStaff;
}

export function createStaff(options: CreateStaffOptions) {
  return {
    /** The routes under /api/staff, behind the staff gate for the console at `consoleOrigin`. */
    routes: (consoleOrigin: string) => staffRoutes(consoleOrigin, options.auth, (query) => auditPage(options.apiDb, query)),
    /** One page of the audit log, newest first, as GET /api/staff/audit answers it. */
    readAudit: (query: AuditPageQuery) => auditPage(options.apiDb, query),
  };
}

export type Staff = ReturnType<typeof createStaff>;
```

### Replace `apps/api/src/staff/routes.ts` (whole file)

```ts
import { AuditPageQuery, StaffEnrollOptionsRequest, StaffEnrollVerifyRequest, StaffSignInVerifyRequest, type AuditPage } from "@korbat/contracts";
import { Hono, type Context } from "hono";
import { clearStaffCookies, setStaffCookies, type ActiveStaffSession, type AuthForStaff, type StaffRequestContext } from "../auth";
import type { AppEnv } from "../env";
import { validate } from "../lib/validate";
import { staffGate } from "./gate";

/**
 * The staff routes (3a design, section 7), which createApp mounts at /api/staff only while CONSOLE_ORIGIN is set. The gate
 * stands in front of every path under it, /api/staff itself and the paths no route answers included, so a wrong Host is
 * the 404 of an unknown route there too. Behind it, every route but enrolment and sign-in stands behind requireStaff.
 * Handlers only validate, call the auth module's staff interface or the audit reader, and shape the answer; step-up and
 * the session revocation it confirms join them with their flow.
 */
export function staffRoutes(consoleOrigin: string, auth: AuthForStaff, readAudit: (query: AuditPageQuery) => Promise<AuditPage>) {
  const routes = new Hono<AppEnv>();
  routes.use("*", staffGate(consoleOrigin));

  // The client's address is hashed before any flow sees it, and the request's id goes to the audit rows it writes.
  const requestContext = (c: Context<AppEnv>): StaffRequestContext => ({
    ipHash: c.get("clientIpHash") ?? "direct",
    userAgent: c.req.header("user-agent"),
    requestId: c.get("requestId"),
  });

  /** The session requireStaff read; a route without it in front is a wiring fault, not a refusal. */
  const staffSession = (c: Context<AppEnv>): ActiveStaffSession => {
    const session = c.get("staffSession");
    if (!session) throw new Error("a staff route ran without requireStaff");
    return session;
  };

  // Enrolment needs no session: the link's one-time token is the credential, until a key is stored with it.
  routes.post("/enroll/options", validate("json", StaffEnrollOptionsRequest), async (c) => c.json(await auth.enrollOptions(c.req.valid("json"))));
  routes.post("/enroll/verify", validate("json", StaffEnrollVerifyRequest), async (c) => c.json(await auth.enrollVerify(c.req.valid("json"), requestContext(c))));

  // Sign-in needs no session either: the staff key's assertion is the credential. The options take no body.
  routes.post("/signin/options", async (c) => c.json(await auth.signInOptions()));
  routes.post("/signin/verify", validate("json", StaffSignInVerifyRequest), async (c) => {
    const { token, me } = await auth.signInVerify(c.req.valid("json"), requestContext(c));
    // Both staff cookies, set once and never refreshed: they last the session's 12 hours.
    setStaffCookies(c, token);
    return c.json(me);
  });

  routes.get("/me", auth.requireStaff, async (c) => c.json(await auth.me(staffSession(c))));
  routes.get("/sessions", auth.requireStaff, async (c) => c.json(await auth.sessions(staffSession(c))));
  routes.get("/keys", auth.requireStaff, async (c) => c.json(await auth.keys(staffSession(c))));
  // Any staff member reads the whole record; reading is not itself recorded.
  routes.get("/audit", auth.requireStaff, validate("query", AuditPageQuery), async (c) => c.json(await readAudit(c.req.valid("query"))));
  routes.post("/signout", auth.requireStaff, async (c) => {
    await auth.signOut(staffSession(c), requestContext(c));
    clearStaffCookies(c);
    return c.body(null, 204);
  });

  return routes;
}
```

### Replace `apps/app/src/components/security/MfaSection.tsx` (whole file)

```tsx
import { useState } from "react";
import { Text, View } from "react-native";
import { RecoveryCodesResponse, TotpConfirmResponse, TotpSetupResponse, type MeResponse } from "@korbat/contracts";
import { QrCode } from "@/components/security/QrCode";
import { Body, Button, ErrorText, Field } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

type Stage = { kind: "idle" } | { kind: "setup"; otpauthUri: string; qrSvg: string } | { kind: "codes"; recoveryCodes: string[] } | { kind: "disable" };

const clipboard = (globalThis as unknown as { navigator?: { clipboard?: { writeText(text: string): Promise<void> } } }).navigator?.clipboard;

export function MfaSection({
  me,
  run,
  refresh,
  reenroll,
}: {
  me: MeResponse;
  run: (action: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<unknown>;
  reenroll: boolean;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await run(action);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const startSetup = () =>
    act(async () => {
      const setup = await api("/api/auth/mfa/totp/setup", { method: "POST", schema: TotpSetupResponse });
      setCode("");
      setStage({ kind: "setup", ...setup });
    });

  const confirmSetup = () =>
    act(async () => {
      const { recoveryCodes } = await api("/api/auth/mfa/totp/confirm", { json: { code: code.trim() }, schema: TotpConfirmResponse });
      setCode("");
      setStage({ kind: "codes", recoveryCodes });
      await refresh();
    });

  const regenerate = () =>
    act(async () => {
      const { recoveryCodes } = await api("/api/auth/mfa/recovery-codes/regenerate", { method: "POST", schema: RecoveryCodesResponse });
      setStage({ kind: "codes", recoveryCodes });
    });

  // No code of its own (1c design, section 2): the route needs a level-2 re-authentication, which the panel provides, and the authenticator code given there already spent the current step.
  const disable = () =>
    act(async () => {
      await api("/api/auth/mfa/totp/disable", { json: {} });
      setStage({ kind: "idle" });
      await refresh();
    });

  if (stage.kind === "setup") {
    const secret = new URL(stage.otpauthUri).searchParams.get("secret") ?? "";
    return (
      <View>
        <Body>Scan this QR code with an authenticator app, then enter the 6-digit code it shows.</Body>
        <View className="mt-4 items-center rounded-lg bg-white p-3">
          <QrCode svg={stage.qrSvg} size={200} />
        </View>
        <Text className="mt-3 text-xs text-zinc-400">Can't scan it? Enter this key: </Text>
        <Text selectable className="mt-1 font-mono text-sm text-zinc-200">
          {secret.replace(/(.{4})/g, "$1 ").trim()}
        </Text>
        <Field label="Code from the app" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} onSubmitEditing={confirmSetup} />
        <ErrorText message={error} />
        <Button label="Turn on two-factor" onPress={confirmSetup} busy={busy} disabled={!/^\d{6}$/.test(code.trim())} />
        <Button label="Cancel" onPress={() => setStage({ kind: "idle" })} tone="secondary" />
      </View>
    );
  }

  if (stage.kind === "codes") {
    return (
      <View>
        <Body>Save these recovery codes somewhere safe. Each works once, and they are the only way back into your account if you lose your authenticator. They won't be shown again.</Body>
        <View className="mt-4 flex-row flex-wrap gap-2 rounded-lg bg-zinc-900 p-4">
          {stage.recoveryCodes.map((c) => (
            <Text key={c} selectable className="w-[46%] font-mono text-base text-zinc-100">
              {c}
            </Text>
          ))}
        </View>
        {clipboard ? (
          <Button
            label={copied ? "Copied" : "Copy codes"}
            tone="secondary"
            onPress={() => {
              clipboard
                .writeText(stage.recoveryCodes.join("\n"))
                .then(() => setCopied(true))
                .catch(() => setError("Copying is not allowed here. Select the codes and copy them by hand."));
            }}
          />
        ) : null}
        <Button label="I saved my recovery codes" onPress={() => setStage({ kind: "idle" })} />
      </View>
    );
  }

  if (stage.kind === "disable") {
    return (
      <View>
        <Body>Two-factor authentication will be turned off, and your recovery codes stop working. You will be asked to confirm it's you first.</Body>
        <ErrorText message={error} />
        <Button label="Turn off two-factor" onPress={disable} busy={busy} tone="danger" />
        <Button label="Cancel" onPress={() => setStage({ kind: "idle" })} tone="secondary" />
      </View>
    );
  }

  return (
    <View>
      {reenroll && me.user.mfaEnabled ? (
        <Text className="mt-3 rounded-lg bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          You used a recovery code. Set up two-factor again to get a fresh set of codes.
        </Text>
      ) : null}
      <Body>
        {me.user.mfaEnabled
          ? "Two-factor authentication is on. Signing in needs a code from your authenticator app."
          : me.user.role === "user"
            ? "Two-factor authentication is off. Turn it on so a leaked password or email alone can't open your account."
            : "Two-factor authentication is off. Turn it on so a leaked password or email alone can't open your account; on a staff account it then stays on. Staff tools are on the staff console and open only with a staff key."}
      </Body>
      <ErrorText message={error} />
      {me.user.mfaEnabled ? (
        <>
          <Button label="Set up a new authenticator" onPress={() => void startSetup()} busy={busy} tone={reenroll ? "primary" : "secondary"} />
          <Button label="New recovery codes" onPress={() => void regenerate()} busy={busy} tone="secondary" />
          {me.user.role === "user" ? <Button label="Turn off two-factor" onPress={() => setStage({ kind: "disable" })} tone="danger" /> : null}
        </>
      ) : (
        <Button label="Turn on two-factor" onPress={() => void startSetup()} busy={busy} />
      )}
    </View>
  );
}
```

## Step 4: verify: typecheck

```bash
pnpm typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`
- `ERR_PNPM`

Observed on the dry run:

```text
(no output)
```

## Step 5: verify: test

```bash
pnpm test
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
packages/rules test:       Tests  4 passed (4)
packages/db test:       Tests  40 passed (40)
packages/contracts test:       Tests  131 passed (131)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  108 passed (108)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  533 passed | 413 skipped (946)
```

## Step 6: verify: integration

```bash
cd apps/api && set -a && . ./.env && set +a && pnpm test:integration
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  411 passed (411)
```

## Step 7: verify: api-bundle

```bash
pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && echo bundle-ok
```

Expected output contains:

- `Build success`
- `bundle-ok`

Must not contain:

- `SyntaxError`

Observed on the dry run:

```text
Build success
bundle-ok
```

## Step 8: verify: staff-cli

```bash
node --check apps/api/dist/staff.js && node apps/api/dist/staff.js 2>&1 | grep -v -e ExperimentalWarning -e trace-warnings; echo staff-exit=${PIPESTATUS[0]}
```

Expected output contains:

- `usage: node dist/staff.js <command>`
- `enroll <email>`
- `keys [<email>]`
- `revoke <email> <key id>`
- `revoke <email> all`
- `audit-verify [<chain_seq>:<hash> ...]`
- `staff-exit=2`

Observed on the dry run:

```text
usage: node dist/staff.js <command>
enroll <email>                         print a one-time link, valid 30 minutes, that registers one staff key for the account;
run it in the migrate service: docker compose -f infra/compose.yml run --rm migrate node dist/staff.js enroll <email>
keys [<email>]                         list the account's staff keys, or every staff account with its role, address, handle and keys
audit-verify [<chain_seq>:<hash> ...]  recompute the audit chain and check it against places kept before
revoke <email> <key id>                revoke that staff key and every staff session it opened, and mail its owner
revoke <email> all                     revoke every staff key and staff session of the account, delete its unused
staff-exit=2
```

## Step 9: verify: audit-verify-dev

```bash
cd apps/api && set -a && . ./.env && set +a && node dist/staff.js audit-verify 2>&1 | grep -v -e ExperimentalWarning -e trace-warnings; echo verify-exit=${PIPESTATUS[0]}
```

Expected output contains:

- `audit-verify: the chain holds:`
- `staff keys checked`
- `verify-exit=0`

Observed on the dry run:

```text
audit-verify: the chain holds: 19 rows, from place 1 to the head 19:ef0af91506352cd1a9fac887d777baace7a2acd0f41f9b43dc0399849efde0fc
0 staff keys checked
verify-exit=0
```

## Step 10: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/auth/index.ts`
- `apps/api/src/auth/janitor.ts`
- `apps/api/src/auth/middleware.ts`
- `apps/api/src/auth/repo.ts`
- `apps/api/src/auth/staff/cookies.ts`
- `apps/api/src/auth/staff/enroll.ts`
- `apps/api/src/auth/staff/middleware.ts`
- `apps/api/src/auth/staff/revoke.ts`
- `apps/api/src/auth/staff/sessions.ts`
- `apps/api/src/auth/staff/signin.ts`
- `apps/api/src/cli/mail.ts`
- `apps/api/src/cli/staff.ts`
- `apps/api/src/env.ts`
- `apps/api/src/staff/index.ts`
- `apps/api/src/staff/routes.ts`
- `apps/api/test/auth/staff-cookies.test.ts`
- `apps/api/test/cli-staff.test.ts`
- `apps/api/test/integration/auth-janitor.test.ts`
- `apps/api/test/integration/cli-staff-revoke.test.ts`
- `apps/api/test/integration/http-auth.test.ts`
- `apps/api/test/integration/http-staff-sessions.test.ts`
- `apps/api/test/integration/staff-audit.test.ts`
- `apps/api/test/integration/staff-enrolment.ts`
- `apps/api/test/integration/staff-fixtures.ts`
- `apps/api/test/integration/staff-sign-in.ts`
- `apps/api/test/integration/staff-signin.test.ts`
- `apps/api/test/staff/app-mount.test.ts`
- `apps/api/test/staff/gate.test.ts`
- `apps/app/src/components/security/MfaSection.tsx`
- `apps/app/test/passkeys.test.tsx`

## Step 11: commit

```bash
git add -A
git commit -q -m "feat(api,app): staff sign-in and sessions: a staff key signs in on the console with user verification, its flags checked after the signature and every earlier failure one staff_key_invalid answer, limited per IP first and per key only after the signature; a counter that goes backwards revokes the key and every staff session it opened and mails its owner; staff sessions are read from the database on every request, never cached, their idle end moved only by requests the console marks as its person's own and never past 12 hours, behind a staff cookie with a staff CSRF header; the console reads its session, sessions, keys and the audit log, and signs out; staff.js revoke revokes one key or all of an account's with its sessions and open links, in one transaction with its record, and mails the owner when a key went; the janitor deletes ended staff sessions after 30 days and spent links after a day; requireStaffMfa is gone and the Security screen says staff tools open only with a staff key" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(api,app): staff sign-in and sessions: a staff key signs in on the console with user verification, its flags checked after the signature and every earlier failure one staff_key_invalid answer, limited per IP first and per key only after the signature; a counter that goes backwards revokes the key and every staff session it opened and mails its owner; staff sessions are read from the database on every request, never cached, their idle end moved only by requests the console marks as its person's own and never past 12 hours, behind a staff cookie with a staff CSRF header; the console reads its session, sessions, keys and the audit log, and signs out; staff.js revoke revokes one key or all of an account's with its sessions and open links, in one transaction with its record, and mails the owner when a key went; the janitor deletes ended staff sessions after 30 days and spent links after a day; requireStaffMfa is gone and the Security screen says staff tools open only with a staff key`.

## Report format (mandatory)

```text
TASK 4 REPORT
Files written: <count, expected 30>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Verify "staff-cli": <paste the expected lines as printed>
Verify "audit-verify-dev": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```

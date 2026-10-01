# korbat staff console (3a) — Task 3 of 9: Staff keys and enrolment: the codec's staff purposes and any-string binding, the wrapper's user verification, security-key hint and BE report, the enrolment flow and its routes through auth.add_staff_key, staff.js enroll in the migrate service and staff.js keys, grant-role's and the take-down's staff rows, and the four staff mails

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-30 and 2026-10-01 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Tasks 1 and 2 laid the ground and built the staff module with the audit record. This task adds staff keys: the codec's `staff_signin` and `staff_register` purposes, the wrapper's user verification and hint, the enrolment flow and its routes, `staff.js enroll` in the migrate service and `staff.js keys`, the staff rows of grant-role and of the take-down, and the four staff mail templates. The design is `docs/superpowers/specs/2026-09-28-staff-console-3a-design.md` (sections 2, 5, 6 and 7).

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(api): the staff module and the audit record: chain.ts recomputes the canonical text and the hash in Node, byte for byte with the trigger's, against shared test vectors; the staff module is mounted only while CONSOLE_ORIGIN is set, never meets the app's CORS or session, and stands behind a gate that answers another Host 404 and another Origin or Sec-Fetch-Site 403; staff.js audit-head prints the newest place and hash, and audit-verify reads the head and the rows in one snapshot, recomputes every hash in its own code, checks places kept off the server and that every staff key was added on the record, with only the database URLs it needs; grant-role changes the role and writes its record in one auth transaction through auth.append_audit, giving up after 10 seconds on a held head; the integration client speaks to the console's host with the staff CSRF header`.

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
python docs/superpowers/prompts/staff-console-3a/write_blocks.py docs/superpowers/prompts/staff-console-3a/03-staff-keys-enrolment.md 1
```

Expected: 17 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/cli-mail.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { commandLineMailSettings } from "../src/cli/mail";

// The command line's mailer (3a design, section 7): grant-role's demotion and the staff command line's revocations mail
// the key's owner, built as the API builds its mailer, from SMTP_URL and MAIL_FROM alone.
describe("the command line's mail settings", () => {
  test("reads SMTP_URL and MAIL_FROM, and requires TLS from a plain relay in production as the API does", () => {
    const env = { SMTP_URL: "smtp://localhost:1025", MAIL_FROM: "korbat <no-reply@korbat.local>" };
    expect(commandLineMailSettings(env)).toEqual({ smtpUrl: "smtp://localhost:1025", mailFrom: "korbat <no-reply@korbat.local>", requireTls: false });
    expect(commandLineMailSettings({ ...env, NODE_ENV: "production" }).requireTls).toBe(true);
    expect(commandLineMailSettings({ ...env, NODE_ENV: "development" }).requireTls).toBe(false);
  });

  test("a setting only the API reads changes nothing", () => {
    const env = { SMTP_URL: "smtps://u:p@relay.example:465", MAIL_FROM: "korbat <no-reply@korbat.example>", APP_ORIGIN: "not a url", CONSOLE_ORIGIN: "http://x/" };
    expect(commandLineMailSettings(env).smtpUrl).toBe("smtps://u:p@relay.example:465");
  });

  test("names the mail setting that is missing or wrong, and no other", () => {
    for (const [env, named] of [
      [{ MAIL_FROM: "korbat <no-reply@korbat.local>" }, /SMTP_URL/],
      [{ SMTP_URL: "http://localhost:1025", MAIL_FROM: "korbat <no-reply@korbat.local>" }, /SMTP_URL/],
      [{ SMTP_URL: "smtp://localhost:1025" }, /MAIL_FROM/],
    ] as const) {
      let message = "";
      try {
        commandLineMailSettings(env);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message, JSON.stringify(env)).toMatch(named);
      expect(message).toMatch(/^Invalid mail settings:/);
      expect(message).not.toMatch(/APP_ORIGIN|DATABASE_URL|AUTH_HMAC_KEY|CONSOLE_ORIGIN/);
    }
  });
});
```

### Create `apps/api/test/integration/cli-staff-enroll.test.ts`

```ts
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
```

### Create `apps/api/test/integration/http-staff-enroll.test.ts`

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ErrorEnvelope, StaffEnrollOptionsResponse, StaffEnrollVerifyResponse, type RegistrationResponseJSON } from "@korbat/contracts";
import { auditLog, closeDb, createDb, staffKeys, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { challengeKey, issueChallenge } from "../../src/auth/passkeys/challenge";
import type { PublicKeyCredentialCreationOptionsJSON } from "../../src/auth/passkeys/webauthn";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { decodeKey } from "../../src/auth/crypto";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createStaff } from "../../src/staff";
import { SoftAuthenticator, type CborValue, type SoftCreateInput } from "../auth/soft-authenticator";
import { Browser } from "./http-client";
import { DEVICE_BOUND, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount } from "./staff-fixtures";

/**
 * The enrolment routes over HTTP (3a design, sections 7 and 12): the console's own browser on http://console.localhost:8090,
 * through the staff gate to the auth module's flows. Every refusal answers a staff code, never a passkey_* one, and no
 * answer carries CORS headers.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the enrolment routes over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let mailer: MemoryMailer;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    // The test environment with the console switched on at the staff harness's address.
    config = loadConfig({ ...process.env, CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, CONSOLE_RP_ID: "" });
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    mailer = new MemoryMailer();
    const auth = createAuth({ config, logger, authDb, kv: new MemoryKv(), mailer, profiles: createProfileStore(apiDb) });
    const staff = createStaff({ apiDb, auth: auth.forStaff });
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth, staff });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  /** The console's page: its own host and origin, echoing the staff CSRF cookie in the staff CSRF header. */
  const consoleBrowser = () => new Browser(app, TEST_CONSOLE_ORIGIN, { base: TEST_CONSOLE_ORIGIN, csrfCookie: "__Host-korbat_staff_csrf", csrfHeader: "x-staff-csrf" });
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;

  /** The options for a link over HTTP, parsed as the console parses them. */
  async function options(b: Browser, token: string, kind: "security_key" | "this_device" = "security_key") {
    const res = await b.fetch("/api/staff/enroll/options", { json: { token, name: "Blue key", kind } });
    expect(res.status, await res.clone().text()).toBe(200);
    const answer = StaffEnrollOptionsResponse.parse(await res.json());
    // The contract checks the challenge alone and passes the rest to the browser's library, which knows its shape.
    return { rpShared: answer.rpShared, options: answer.options as unknown as PublicKeyCredentialCreationOptionsJSON };
  }

  const verify = (b: Browser, token: string, response: RegistrationResponseJSON) => b.fetch("/api/staff/enroll/verify", { json: { token, name: "Blue key", response } });

  test("a whole enrolment from the console's page: the options, the verification, the stored key and its mail", { timeout: 30_000 }, async () => {
    const { user } = await newStaffAccount(authDb, repo);
    const enrolment = await issueEnrolment(migrateDb, user.id);
    const b = consoleBrowser();
    const answer = await options(b, enrolment.token);
    expect(answer.rpShared).toBe(false);
    expect(answer.options.rp.id).toBe(TEST_CONSOLE_RP_ID);
    const response = new SoftAuthenticator().create({
      rpId: TEST_CONSOLE_RP_ID,
      challenge: answer.options.challenge,
      origin: TEST_CONSOLE_ORIGIN,
      userHandle: Buffer.from(answer.options.user.id, "base64url"),
      flags: DEVICE_BOUND,
      transports: ["usb"],
    });
    const res = await verify(b, enrolment.token, response);
    expect(res.status, await res.clone().text()).toBe(200);
    expect([...res.headers.keys()].filter((name) => name.startsWith("access-control-"))).toEqual([]);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { key } = StaffEnrollVerifyResponse.parse(await res.json());
    const [stored] = await migrateDb.select().from(staffKeys).where(eq(staffKeys.id, key.id));
    expect(stored).toMatchObject({ userId: user.id, name: "Blue key", credentialId: response.id, origin: TEST_CONSOLE_ORIGIN, rpId: TEST_CONSOLE_RP_ID });
    // The key's audit row carries the request's id, which the access log carries too.
    const [row] = await migrateDb.select().from(auditLog).where(eq(auditLog.keyId, key.id));
    expect(row!.requestId).toBe(res.headers.get("x-request-id"));
    expect(mailer.sent.filter((m) => m.to === user.email).map((m) => m.template)).toEqual(["staff_key_added"]);
  });

  test("a spent challenge, one of another purpose, one bound to another enrolment and a bad signature are each staff_key_refused, never a passkey code, and the link still works", { timeout: 60_000 }, async () => {
    const { user } = await newStaffAccount(authDb, repo);
    const enrolment = await issueEnrolment(migrateDb, user.id);
    const other = await newStaffAccount(authDb, repo);
    const otherEnrolment = await issueEnrolment(migrateDb, other.user.id);
    const b = consoleBrowser();
    const auth = new SoftAuthenticator();
    const key = challengeKey(decodeKey(config.AUTH_HMAC_KEY));
    const create = (challenge: string, overrides: Partial<SoftCreateInput> = {}) =>
      auth.create({ rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND, ...overrides });

    // The first answer is refused on its flags, after its challenge was spent.
    const spent = create((await options(b, enrolment.token)).options.challenge, { flags: { up: true, uv: false, be: false, bs: false } });
    const first = await verify(b, enrolment.token, spent);
    expect([first.status, (await error(first)).code]).toEqual([403, "staff_key_not_user_verified"]);

    const cases: [string, RegistrationResponseJSON][] = [
      ["a spent challenge", spent],
      ["a staff sign-in challenge", create(issueChallenge(key, "staff_signin", new Date()))],
      ["a personal passkey's registration challenge", create(issueChallenge(key, "register", new Date(), enrolment.id))],
      ["a challenge bound to another enrolment", create((await options(b, otherEnrolment.token)).options.challenge)],
      [
        "a self attestation with a bad signature",
        create((await options(b, enrolment.token)).options.challenge, { fmt: "packed", attStmt: new Map<string | number, CborValue>([["alg", -7], ["sig", randomBytes(70)]]) }),
      ],
    ];
    for (const [label, response] of cases) {
      const res = await verify(b, enrolment.token, response);
      const { code, message } = await error(res);
      expect([label, res.status, code]).toEqual([label, 400, "staff_key_refused"]);
      expect(message, label).toContain("this link still works");
      expect(code, label).not.toMatch(/^passkey_/);
    }
    // Then a good answer on the same link.
    const good = create((await options(b, enrolment.token)).options.challenge);
    expect((await verify(b, enrolment.token, good)).status).toBe(200);
  });

  test("an unknown link and a spent one are each staff_enrollment_invalid at both steps", { timeout: 30_000 }, async () => {
    const b = consoleBrowser();
    const auth = new SoftAuthenticator();
    const unknown = await b.fetch("/api/staff/enroll/options", { json: { token: randomBytes(32).toString("base64url"), name: "Blue key", kind: "this_device" } });
    expect([unknown.status, (await error(unknown)).code]).toEqual([400, "staff_enrollment_invalid"]);
    const response = auth.create({ rpId: TEST_CONSOLE_RP_ID, challenge: randomBytes(58).toString("base64url"), origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND });
    const late = await verify(b, `${randomUUID().replace(/-/g, "")}${"a".repeat(11)}`, response);
    expect([late.status, (await error(late)).code]).toEqual([400, "staff_enrollment_invalid"]);

    // A link that has enrolled a key. The second answer was made on it before the first was sent, on a challenge of its own
    // that nothing spent, so only the link being spent can refuse it.
    const { user } = await newStaffAccount(authDb, repo);
    const enrolment = await issueEnrolment(migrateDb, user.id);
    const answer = async () => {
      const { options: creation } = await options(b, enrolment.token);
      return auth.create({ rpId: TEST_CONSOLE_RP_ID, challenge: creation.challenge, origin: TEST_CONSOLE_ORIGIN, userHandle: Buffer.from(creation.user.id, "base64url"), flags: DEVICE_BOUND });
    };
    const first = await answer();
    const second = await answer();
    const enrolled = await verify(b, enrolment.token, first);
    expect(enrolled.status, await enrolled.clone().text()).toBe(200);
    const again = await b.fetch("/api/staff/enroll/options", { json: { token: enrolment.token, name: "Blue key", kind: "security_key" } });
    expect([again.status, (await error(again)).code]).toEqual([400, "staff_enrollment_invalid"]);
    const spent = await verify(b, enrolment.token, second);
    expect([spent.status, (await error(spent)).code]).toEqual([400, "staff_enrollment_invalid"]);
    expect(await migrateDb.select({ id: staffKeys.id }).from(staffKeys).where(eq(staffKeys.userId, user.id))).toHaveLength(1);
  });
});
```

### Create `apps/api/test/integration/staff-enroll.test.ts`

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { StaffEnrollOptionsResponse, StaffEnrollVerifyResponse } from "@korbat/contracts";
import { auditHead, auditLog, authEvents, closeDb, createDb, passkeys, staffEnrollments, staffKeys, users, type Db } from "@korbat/db";
import { AuthError } from "../../src/auth/context";
import { randomToken } from "../../src/auth/crypto";
import { MINUTE } from "../../src/auth/limits";
import { challengeKey, issueChallenge, readChallenge } from "../../src/auth/passkeys/challenge";
import { registerOptions, registerVerify, signInOptions, signInVerify } from "../../src/auth/passkeys/flows";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { enrollOptions, enrollVerify } from "../../src/auth/staff/enroll";
import { loadConfig } from "../../src/config";
import { SoftAuthenticator, type CborValue, type SoftCreateInput, type SoftFlags } from "../auth/soft-authenticator";
import { flowHarness, onboardedUser, type FlowHarness } from "./flow-harness";
import {
  DEVICE_BOUND,
  TEST_CONSOLE,
  TEST_CONSOLE_ORIGIN,
  TEST_CONSOLE_RP_ID,
  addStaffKey,
  issueEnrolment,
  newStaffAccount,
  withLockTimeout,
} from "./staff-fixtures";
import { enrolKey } from "./staff-enrolment";

const APP_ORIGIN = "http://localhost:8081";
const AAGUID = "ee882879-721c-4913-9775-3dfcce97072a";
const NO_UV: SoftFlags = { up: true, uv: false, be: false, bs: false };
const SYNCED: SoftFlags = { up: true, uv: true, be: true, bs: true };
const SYNCABLE: SoftFlags = { up: true, uv: true, be: true, bs: false };
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
 * Staff key enrolment through the auth module's flows on the real database (3a design, section 7, Enrolment): the console
 * at http://console.localhost:8090 with the relying party console.localhost beside the app at http://localhost:8081, the
 * software authenticator, and enrolments the migrator inserts as `staff.js enroll` does.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff key enrolment", () => {
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    authDb = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    // The migrate role issues enrolments and reads every row back; the test environment carries its URL.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 4 });
    repo = createAuthRepo(authDb);
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(migrateDb)]);
  });

  const harness = () => flowHarness(repo, { console: TEST_CONSOLE });
  const requestContext = (h: FlowHarness) => ({ ...h.ctx, requestId: `req-${randomUUID()}` });
  const keysOf = (userId: string) => migrateDb.select().from(staffKeys).where(eq(staffKeys.userId, userId)).orderBy(staffKeys.createdAt);
  const enrolmentRow = async (id: string) => (await migrateDb.select().from(staffEnrollments).where(eq(staffEnrollments.id, id)))[0];
  const head = async () => (await migrateDb.select().from(auditHead))[0]!;
  const staffEvents = (userId: string) =>
    migrateDb
      .select({ type: authEvents.type, metadata: authEvents.metadata })
      .from(authEvents)
      .where(and(eq(authEvents.userId, userId), sql`${authEvents.type}::text like 'staff_%'`))
      .orderBy(authEvents.id);

  /** The options for a link and the software authenticator's answer to them, from the console's origin unless told otherwise. */
  async function ceremony(h: FlowHarness, token: string, auth: SoftAuthenticator, overrides: Partial<SoftCreateInput> = {}, name = "Blue key") {
    const answer = await enrollOptions(h.deps, { token, name, kind: "security_key" });
    const response = auth.create({
      rpId: answer.options.rp.id!,
      challenge: answer.options.challenge,
      origin: TEST_CONSOLE_ORIGIN,
      userHandle: Buffer.from(answer.options.user.id, "base64url"),
      flags: DEVICE_BOUND,
      transports: ["usb", "nfc"],
      ...overrides,
    });
    return { answer, response };
  }

  /** A live staff account with a handle and one open enrolment link. */
  async function staffWithLink(role: "moderator" | "admin" = "moderator") {
    const account = await newStaffAccount(authDb, repo, role);
    const enrolment = await issueEnrolment(migrateDb, account.user.id);
    return { ...account, enrolment };
  }

  describe("the whole enrolment", () => {
    test("stores a user-verified, device-bound key with its enrolment's origin and relying party ID, spends the link, records it and mails the owner", { timeout: 30_000 }, async () => {
      const h = harness();
      const { user, enrolment } = await staffWithLink();
      expect((await repo.findUserById(user.id))!.webauthnUserId).toBeNull();
      const auth = new SoftAuthenticator();
      const { answer, response } = await ceremony(h, enrolment.token, auth, { aaguid: AAGUID });

      // The options (3a design, section 7): the console's relying party, the account's user handle set now and labelled with
      // the key's name, user verification and a resident key required, the pinned algorithms, no attestation, the
      // security-key hint, and a staff registration challenge bound to the enrolment.
      expect(StaffEnrollOptionsResponse.parse(answer)).toBeTruthy();
      expect(answer.rpShared).toBe(false);
      const { options } = answer;
      expect(options.rp).toEqual({ id: TEST_CONSOLE_RP_ID, name: "korbat" });
      const handle = (await repo.findUserById(user.id))!.webauthnUserId!;
      expect(handle).toHaveLength(32);
      expect(options.user).toEqual({ id: handle.toString("base64url"), name: "Blue key", displayName: "Blue key" });
      expect(options.authenticatorSelection).toEqual({ residentKey: "required", requireResidentKey: true, userVerification: "required", authenticatorAttachment: "cross-platform" });
      expect(options.hints).toEqual(["security-key"]);
      expect(options.attestation).toBe("none");
      expect(options.pubKeyCredParams!.map((p) => p.alg)).toEqual([-8, -7, -257]);
      expect(options.excludeCredentials).toEqual([]);
      expect(() => readChallenge(challengeKey(h.deps.config.authHmacKey), options.challenge, "staff_register", h.clock.now(), enrolment.id)).not.toThrow();

      const before = await head();
      const ctx = requestContext(h);
      const result = await enrollVerify(h.deps, { token: enrolment.token, name: "Blue key", response }, ctx);
      expect(StaffEnrollVerifyResponse.parse(result)).toBeTruthy();
      const [stored] = await keysOf(user.id);
      expect(result).toEqual({ key: { id: stored!.id, name: "Blue key", createdAt: stored!.createdAt.toISOString(), lastUsedAt: null } });
      expect(stored).toMatchObject({
        credentialId: response.id,
        counter: 0,
        transports: ["usb", "nfc"],
        name: "Blue key",
        aaguid: AAGUID,
        origin: TEST_CONSOLE_ORIGIN,
        rpId: TEST_CONSOLE_RP_ID,
        lastUsedAt: null,
        revokedAt: null,
        suspectAt: null,
      });
      expect((await enrolmentRow(enrolment.id))!.usedAt).not.toBeNull();

      // The auth event and the key's audit row, written by auth.add_staff_key as the transaction's last statement.
      expect(await staffEvents(user.id)).toEqual([{ type: "staff_key_added", metadata: { enrollmentId: enrolment.id } }]);
      const rows = await migrateDb.select().from(auditLog).where(and(eq(auditLog.action, "staff_key_added"), eq(auditLog.keyId, stored!.id)));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorId: user.id, targetType: "staff_key", targetId: stored!.id, requestId: ctx.requestId, metadata: { enrollmentId: enrolment.id } });
      expect(rows[0]!.chainSeq).toBeGreaterThan(before.seq);
      // One transaction wrote the event, the key, the spent enrolment and the audit row: each carries its id in xmin.
      const [xmins] = await migrateDb.execute<{ event: string; key: string; enrolment: string; audit: string }>(sql`select
        (select xmin::text from auth.auth_events where user_id = ${user.id} and type = 'staff_key_added') as event,
        (select xmin::text from auth.staff_keys where id = ${stored!.id}) as key,
        (select xmin::text from auth.staff_enrollments where id = ${enrolment.id}) as enrolment,
        (select xmin::text from public.audit_log where id = ${rows[0]!.id}) as audit`);
      expect(new Set([xmins!.event, xmins!.key, xmins!.enrolment, xmins!.audit]).size).toBe(1);

      // The owner is told after the commit, with the key's name and the time it was registered; no link.
      expect(h.mailer.sent).toEqual([{ to: user.email, template: "staff_key_added", data: { name: "Blue key", time: mailTime(stored!.createdAt) } }]);
    });

    test("the link works once: the options and the verification both refuse it afterwards", { timeout: 30_000 }, async () => {
      const h = harness();
      const { enrolment } = await staffWithLink();
      const auth = new SoftAuthenticator();
      await enrolKey(h, auth, enrolment.token);
      const again = await failure(enrollOptions(h.deps, { token: enrolment.token, name: "Red key", kind: "security_key" }));
      expect([again.code, again.status]).toEqual(["staff_enrollment_invalid", 400]);
      // A ceremony prepared before the link was spent fails too.
      const late = issueChallenge(challengeKey(h.deps.config.authHmacKey), "staff_register", h.clock.now(), enrolment.id);
      const response = auth.create({ rpId: TEST_CONSOLE_RP_ID, challenge: late, origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND });
      expect((await failure(enrollVerify(h.deps, { token: enrolment.token, name: "Red key", response }, requestContext(h)))).code).toBe("staff_enrollment_invalid");
    });

    test("the account's user handle is kept when it has one, and \"Use Windows Hello on this computer\" sends no hint", async () => {
      const h = harness();
      const { user, enrolment } = await staffWithLink();
      const existing = randomBytes(32);
      expect(await repo.ensureWebauthnUserId(user.id, existing)).toEqual(existing);
      const { options } = await enrollOptions(h.deps, { token: enrolment.token, name: "Laptop", kind: "this_device" });
      expect(options.user).toEqual({ id: existing.toString("base64url"), name: "Laptop", displayName: "Laptop" });
      expect(options.hints).toEqual([]);
      expect(options.authenticatorSelection).toEqual({ residentKey: "required", requireResidentKey: true, userVerification: "required" });
    });
  });

  describe("keys the console refuses, the link staying usable", () => {
    test("a key that did not verify the user is staff_key_not_user_verified, and the same link then enrols a key that did", { timeout: 30_000 }, async () => {
      const h = harness();
      const { user, enrolment } = await staffWithLink();
      const before = await head();
      const { response } = await ceremony(h, enrolment.token, new SoftAuthenticator(), { flags: NO_UV });
      const err = await failure(enrollVerify(h.deps, { token: enrolment.token, name: "Blue key", response }, requestContext(h)));
      expect([err.code, err.status]).toEqual(["staff_key_not_user_verified", 403]);
      expect(await keysOf(user.id)).toEqual([]);
      expect((await enrolmentRow(enrolment.id))!.usedAt).toBeNull();
      expect(await staffEvents(user.id)).toEqual([]);
      expect(await head()).toEqual(before);
      expect(h.mailer.sent).toEqual([]);
      await enrolKey(h, new SoftAuthenticator(), enrolment.token);
      expect(await keysOf(user.id)).toHaveLength(1);
    });

    test("a backup-eligible key is staff_key_not_device_bound, backed up or not, and the same link then enrols a device-bound key", { timeout: 30_000 }, async () => {
      const h = harness();
      const { user, enrolment } = await staffWithLink();
      for (const flags of [SYNCABLE, SYNCED]) {
        const { response } = await ceremony(h, enrolment.token, new SoftAuthenticator(), { flags });
        const err = await failure(enrollVerify(h.deps, { token: enrolment.token, name: "Blue key", response }, requestContext(h)));
        expect([JSON.stringify(flags), err.code, err.status]).toEqual([JSON.stringify(flags), "staff_key_not_device_bound", 403]);
      }
      expect(await keysOf(user.id)).toEqual([]);
      await enrolKey(h, new SoftAuthenticator(), enrolment.token);
      expect(await keysOf(user.id)).toHaveLength(1);
    });

    test("whatever the codec or the wrapper refuses is staff_key_refused, never a passkey code, and the link still works", { timeout: 60_000 }, async () => {
      const h = harness();
      const { user, enrolment } = await staffWithLink();
      const other = await staffWithLink();
      const auth = new SoftAuthenticator();
      const key = challengeKey(h.deps.config.authHmacKey);
      const verify = (response: Parameters<typeof enrollVerify>[1]["response"]) => failure(enrollVerify(h.deps, { token: enrolment.token, name: "Blue key", response }, requestContext(h)));
      const create = (challenge: string, overrides: Partial<SoftCreateInput> = {}) =>
        auth.create({ rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND, ...overrides });
      const fresh = async () => (await enrollOptions(h.deps, { token: enrolment.token, name: "Blue key", kind: "security_key" })).options.challenge;

      // A spent challenge: the first answer is refused on its flags, after its challenge was spent.
      const spent = create(await fresh(), { flags: NO_UV });
      expect((await verify(spent)).code).toBe("staff_key_not_user_verified");
      const cases: [string, Parameters<typeof verify>[0]][] = [
        ["a spent challenge", spent],
        ["a personal passkey's registration challenge", create(issueChallenge(key, "register", h.clock.now(), enrolment.id))],
        ["a staff sign-in challenge", create(issueChallenge(key, "staff_signin", h.clock.now()))],
        ["a challenge bound to another enrolment", create((await enrollOptions(h.deps, { token: other.enrolment.token, name: "Blue key", kind: "security_key" })).options.challenge)],
        ["a forged challenge", create(randomBytes(58).toString("base64url"))],
        ["the app's origin", create(await fresh(), { origin: APP_ORIGIN })],
        ["the app's relying party", create(await fresh(), { rpId: "localhost" })],
        ["a self attestation whose signature does not verify", create(await fresh(), { fmt: "packed", attStmt: new Map<string | number, CborValue>([["alg", -7], ["sig", randomBytes(70)]]) })],
        ["an attestation format the wrapper does not accept", create(await fresh(), { fmt: "tpm", attStmt: new Map<string | number, CborValue>([["ver", "2.0"], ["alg", -257], ["x5c", [randomBytes(300)]], ["sig", randomBytes(70)]]) })],
      ];
      for (const [label, response] of cases) {
        const err = await verify(response);
        expect([label, err.code, err.status]).toEqual([label, "staff_key_refused", 400]);
      }
      // Client data that is not JSON never reaches the codec.
      const garbled = create(await fresh());
      expect((await verify({ ...garbled, response: { ...garbled.response, clientDataJSON: Buffer.from("not json").toString("base64url") } })).code).toBe("staff_key_refused");
      // An expired challenge keeps the shared code, which the console answers by starting over.
      const slow = create(await fresh());
      h.clock.advance(10 * MINUTE);
      expect((await verify(slow)).code).toBe("challenge_expired");

      expect(await keysOf(user.id)).toEqual([]);
      expect(h.mailer.sent).toEqual([]);
      await enrolKey(h, auth, enrolment.token);
      expect(await keysOf(user.id)).toHaveLength(1);
    });

    test("a credential id korbat already holds as a staff key is staff_key_refused, and writes nothing", { timeout: 30_000 }, async () => {
      const h = harness();
      const first = await staffWithLink();
      const auth = new SoftAuthenticator();
      const { credentialId } = await enrolKey(h, auth, first.enrolment.token);
      const second = await staffWithLink();
      const before = await head();
      const { response } = await ceremony(h, second.enrolment.token, auth, { credentialId: Buffer.from(credentialId, "base64url") });
      const err = await failure(enrollVerify(h.deps, { token: second.enrolment.token, name: "Blue key", response }, requestContext(h)));
      expect([err.code, err.status]).toEqual(["staff_key_refused", 400]);
      expect(await keysOf(second.user.id)).toEqual([]);
      expect(await staffEvents(second.user.id)).toEqual([]);
      expect(await head()).toEqual(before);
    });
  });

  describe("links that enrol nothing", () => {
    test("an unknown token, an expired link and a link recorded for another console origin or relying party are staff_enrollment_invalid at both steps", async () => {
      const h = harness();
      const account = await newStaffAccount(authDb, repo);
      const tokens = [
        ["an unknown token", randomToken()],
        ["an expired link", (await issueEnrolment(migrateDb, account.user.id, { expiresAt: new Date(Date.now() - MINUTE) })).token],
        // The console moved after the link was issued: its keys would be bound to the old address.
        ["another origin", (await issueEnrolment(migrateDb, account.user.id, { origin: "http://console.localhost:8091" })).token],
        ["another relying party", (await issueEnrolment(migrateDb, account.user.id, { rpId: "localhost" })).token],
      ] as const;
      const response = new SoftAuthenticator().create({ rpId: TEST_CONSOLE_RP_ID, challenge: randomToken(58), origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND });
      for (const [label, token] of tokens) {
        const options = await failure(enrollOptions(h.deps, { token, name: "Blue key", kind: "security_key" }));
        expect([label, options.code, options.status]).toEqual([label, "staff_enrollment_invalid", 400]);
        const verify = await failure(enrollVerify(h.deps, { token, name: "Blue key", response }, requestContext(h)));
        expect([label, verify.code]).toEqual([label, "staff_enrollment_invalid"]);
      }
    });

    test("an account that is not staff, has no handle or is deleted is staff_enrollment_invalid, and its link is left unspent", async () => {
      const h = harness();
      for (const [label, change] of [
        ["demoted", { role: "user" as const }],
        ["without a handle", { onboardedAt: null }],
        ["deleted", { deletedAt: new Date() }],
      ] as const) {
        const { user, enrolment } = await staffWithLink();
        await authDb.update(users).set(change).where(eq(users.id, user.id));
        const err = await failure(enrollOptions(h.deps, { token: enrolment.token, name: "Blue key", kind: "security_key" }));
        expect([label, err.code]).toEqual([label, "staff_enrollment_invalid"]);
        expect((await enrolmentRow(enrolment.id))!.usedAt, label).toBeNull();
      }
    });

    test("the database decides last: a link that expired after the flow read it enrols nothing, as staff_enrollment_invalid", { timeout: 30_000 }, async () => {
      const h = harness();
      const account = await newStaffAccount(authDb, repo);
      // Expired by the database's clock a minute ago, still open by the flows' clock, ten minutes behind it.
      const enrolment = await issueEnrolment(migrateDb, account.user.id, { expiresAt: new Date(Date.now() - MINUTE) });
      h.clock.advance(-10 * MINUTE);
      const before = await head();
      const { response } = await ceremony(h, enrolment.token, new SoftAuthenticator());
      const err = await failure(enrollVerify(h.deps, { token: enrolment.token, name: "Blue key", response }, requestContext(h)));
      expect([err.code, err.status]).toEqual(["staff_enrollment_invalid", 400]);
      expect(await keysOf(account.user.id)).toEqual([]);
      expect(await staffEvents(account.user.id)).toEqual([]);
      expect(await head()).toEqual(before);
      expect(h.mailer.sent).toEqual([]);
    });

    test("a demotion that commits while the enrolment waits for the account's row enrols nothing", { timeout: 30_000 }, async () => {
      const h = harness();
      const { user, enrolment } = await staffWithLink();
      const { response } = await ceremony(h, enrolment.token, new SoftAuthenticator());
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let holding!: () => void;
      const held = new Promise<void>((resolve) => (holding = resolve));
      // What grant-role does: the account's row locked first, then the role changed, in a transaction that ends in a commit.
      const demotion = withLockTimeout(authDb, async (tx) => {
        await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("no key update");
        holding();
        await released;
        await tx.update(users).set({ role: "user" }).where(eq(users.id, user.id));
      });
      await held;
      const verifying = failure(enrollVerify(h.deps, { token: enrolment.token, name: "Blue key", response }, requestContext(h)));
      // Long enough for the verification to reach the account's row and wait there.
      await new Promise((resolve) => setTimeout(resolve, 500));
      release();
      await demotion;
      expect((await verifying).code).toBe("staff_enrollment_invalid");
      expect(await keysOf(user.id)).toEqual([]);
      expect((await enrolmentRow(enrolment.id))!.usedAt).toBeNull();
    });

    test("at most five live keys: a sixth from a link issued while the account held four is staff_key_limit, and a revocation frees a slot", { timeout: 60_000 }, async () => {
      const h = harness();
      const account = await newStaffAccount(authDb, repo);
      for (let i = 0; i < 4; i++) await addStaffKey(authDb, (await issueEnrolment(migrateDb, account.user.id)).token);
      // Two links issued at once, as staff.js enroll allows while the account holds four.
      const fifth = await issueEnrolment(migrateDb, account.user.id);
      const sixth = await issueEnrolment(migrateDb, account.user.id);
      const auth = new SoftAuthenticator();
      await enrolKey(h, auth, fifth.token);
      const before = await head();
      const { response } = await ceremony(h, sixth.token, auth);
      const err = await failure(enrollVerify(h.deps, { token: sixth.token, name: "Blue key", response }, requestContext(h)));
      expect([err.code, err.status]).toEqual(["staff_key_limit", 409]);
      expect(await keysOf(account.user.id)).toHaveLength(5);
      expect((await enrolmentRow(sixth.id))!.usedAt).toBeNull();
      expect(await head()).toEqual(before);
      // One key revoked, the same link enrols the fifth live key.
      const [oldest] = await keysOf(account.user.id);
      await authDb.update(staffKeys).set({ revokedAt: new Date() }).where(eq(staffKeys.id, oldest!.id));
      await enrolKey(h, auth, sixth.token);
      expect((await keysOf(account.user.id)).filter((k) => k.revokedAt === null)).toHaveLength(5);
    });
  });

  describe("relying parties", () => {
    test("while the two relying party IDs differ, the options exclude the account's live staff keys and nothing else, and 1c's options exclude no staff key", { timeout: 30_000 }, async () => {
      const h = harness();
      const account = await onboardedUser(h, repo);
      await authDb.update(users).set({ role: "moderator" }).where(eq(users.id, account.user.id));
      const [personal] = await authDb.insert(passkeys).values({ userId: account.user.id, credentialId: randomToken(), publicKey: "cose-key", name: "Phone" }).returning();
      const auth = new SoftAuthenticator();
      const live = await enrolKey(h, auth, (await issueEnrolment(migrateDb, account.user.id)).token, { transports: ["usb"] });
      const revoked = await enrolKey(h, auth, (await issueEnrolment(migrateDb, account.user.id)).token);
      await authDb.update(staffKeys).set({ revokedAt: new Date() }).where(eq(staffKeys.id, revoked.key.id));

      const answer = await enrollOptions(h.deps, { token: (await issueEnrolment(migrateDb, account.user.id)).token, name: "Red key", kind: "security_key" });
      expect(answer.rpShared).toBe(false);
      expect(answer.options.excludeCredentials).toEqual([{ id: live.credentialId, transports: ["usb"], type: "public-key" }]);
      const { options } = await registerOptions(h.deps, account.session, { label: "ada" });
      expect(options.excludeCredentials!.map((c) => c.id)).toEqual([personal!.credentialId]);
    });

    test("with both relying party IDs localhost (development), each kind's registration options exclude the other kind, and a staff key does not sign into the app", { timeout: 60_000 }, async () => {
      // The development configuration: the console at http://localhost:8090, its relying party ID the app's.
      const h = flowHarness(repo, { console: { origin: "http://localhost:8090", rpId: "localhost" } });
      const account = await onboardedUser(h, repo);
      const phone = new SoftAuthenticator();
      const personalOptions = (await registerOptions(h.deps, account.session, { label: "ada" })).options;
      const personal = phone.create({ rpId: "localhost", challenge: personalOptions.challenge, origin: APP_ORIGIN, userHandle: Buffer.from(personalOptions.user.id, "base64url"), flags: SYNCED });
      await registerVerify(h.deps, account.session, { response: personal });
      await authDb.update(users).set({ role: "moderator" }).where(eq(users.id, account.user.id));

      const enrolment = await issueEnrolment(migrateDb, account.user.id, { origin: "http://localhost:8090", rpId: "localhost" });
      const answer = await enrollOptions(h.deps, { token: enrolment.token, name: "Blue key", kind: "security_key" });
      expect(answer.rpShared).toBe(true);
      expect(answer.options.rp.id).toBe("localhost");
      // The same user handle as the personal passkey's: excluded, so the authenticator refuses rather than replacing it.
      expect(answer.options.user.id).toBe(personalOptions.user.id);
      expect(answer.options.excludeCredentials!.map((c) => c.id)).toEqual([personal.id]);
      const securityKey = new SoftAuthenticator();
      const staff = securityKey.create({ rpId: "localhost", challenge: answer.options.challenge, origin: "http://localhost:8090", userHandle: Buffer.from(answer.options.user.id, "base64url"), flags: DEVICE_BOUND });
      await enrollVerify(h.deps, { token: enrolment.token, name: "Blue key", response: staff }, requestContext(h));

      // 1c's registration options now exclude the live staff key as well.
      const again = (await registerOptions(h.deps, account.session, { label: "ada" })).options;
      expect(again.excludeCredentials!.map((c) => c.id).sort()).toEqual([personal.id, staff.id].sort());

      // The app's passkey sign-in, on the same relying party ID: only the tables refuse the staff key.
      const signin = (await signInOptions(h.deps, h.ctx)).options;
      const assertion = securityKey.get({ credentialId: staff.id, rpId: "localhost", challenge: signin.challenge, origin: APP_ORIGIN, flags: DEVICE_BOUND, counter: 1 });
      const err = await failure(signInVerify(h.deps, { deviceId: account.device.deviceId, platform: "web", response: assertion }, h.ctx));
      expect(err.code).toBe("passkey_invalid");
    });
  });
});
```

### Create `apps/api/test/integration/staff-enrolment.ts`

```ts
import { randomUUID } from "node:crypto";
import type { StaffKeyKind } from "@korbat/contracts";
import { enrollOptions, enrollVerify } from "../../src/auth/staff/enroll";
import type { SoftAuthenticator, SoftFlags } from "../auth/soft-authenticator";
import type { FlowHarness } from "./flow-harness";
import { DEVICE_BOUND } from "./staff-fixtures";

// Kept apart from staff-fixtures.ts, which the suites of the audit record and the schema share: only the suites of the
// enrolment flow need the flow itself.

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
export async function enrolKey(h: FlowHarness, auth: SoftAuthenticator, token: string, options: EnrolOptions = {}) {
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

### Create `apps/api/test/integration/staff-lifecycle.test.ts`

```ts
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
```

### Replace `apps/api/test/auth/flow-harness.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import type { Platform } from "@korbat/contracts";
import pino from "pino";
import type { AuthConfig, AuthDeps, RequestContext } from "../../src/auth/context";
import { parseVersionedKey, randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createLockout } from "../../src/auth/lockout";
import type {
  ActiveSessionRow,
  AddPasskeyOutcome,
  AuthEventType,
  AuthRepo,
  DeviceRow,
  EmailCodeRow,
  LockDownInput,
  LockDownOutcome,
  NewPasskey,
  PasskeyLimits,
  PasskeyListRow,
  PasskeyRow,
  SessionListRow,
  UserRow,
} from "../../src/auth/repo";
import { createSessions, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, type Factors, type Session } from "../../src/auth/sessions";
import { devProvider } from "../../src/auth/verify/dev";
import { MemoryMailer } from "../../src/mail/memory";

export interface RecordedEvent {
  userId: string | null;
  type: AuthEventType;
  deviceId: string | null;
  metadata: Record<string, unknown>;
}

export const TEST_TERMS = "draft-test";

/**
 * A session of a user, as the deletion and lockdown flows revoke it and, since Task 5, as the sign-in and re-authentication
 * flows issue, resolve and rotate it. The first three fields are all those older flows read; the rest let findActiveSession
 * answer a full row.
 */
export interface RecordedSession {
  id: string;
  userId: string;
  revokedAt: Date | null;
  deviceId: string;
  handle: string;
  factors: Record<string, number>;
  passkeyId: string | null;
  reauthAt: Date;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface RecordedDevice {
  id: string;
  userId: string;
  revokedAt: Date | null;
  /** What the passkey flows read of the row: the platform for a passkey's default name and the label for the Security list. */
  platform: Platform;
  label: string | null;
  /** The keyed hash a sign-in looks a device up by; absent on the devices h.session and h.user seed, which no lookup finds. */
  deviceHash?: string;
}

/** A passkey of a user, as the registration writes it and the lockdown and the management flows read it. */
export type RecordedPasskey = PasskeyRow;

/**
 * The auth flows without a database: users, email codes, sessions, devices and passkeys live in memory, and the
 * repository fake holds only the methods the email-change (with its undo link), badge, deletion, not-me,
 * lockdown and TOTP confirmation flows call (and the lookups the sign-in starts make), checked against the real signatures. The key-value store and the
 * mailer are the in-memory ones; the clock moves only when a test says so, so expiries and timestamps
 * compare exactly; and events are kept as the server would write them to auth_events. The integration
 * harness (test/integration/flow-harness.ts) runs flows against the real repository instead.
 */
export function memoryFlowHarness(start = 1_789_000_000_000) {
  let t = start;
  const now = () => new Date(t);
  const users = new Map<string, UserRow>();
  const codes: EmailCodeRow[] = [];
  const events: RecordedEvent[] = [];
  const sessions: RecordedSession[] = [];
  const devices: RecordedDevice[] = [];
  const passkeys: RecordedPasskey[] = [];
  /**
   * When each event was recorded, at the harness clock, kept beside the events rather than on them: the tests compare
   * the events with the exact objects the flows write, and the daily passkey bound is the only reader of the times.
   */
  const eventTimes = new WeakMap<RecordedEvent, number>();
  const recordEvent = (event: RecordedEvent) => {
    events.push(event);
    eventTimes.set(event, t);
  };
  /** The handle of each account's profile, which the deletion flow compares the typed handle with. */
  const handles = new Map<string, string>();
  /** Repository methods told to fail: "takeDown" and "lockDown" each fail as a transaction that breaks off midway, after staging its writes and before any lands. */
  const faults = new Set<"takeDown" | "lockDown">();
  /** A device as the real row reads, from what the harness keeps of it; the hash and the times are placeholders no flow reads here. */
  const deviceRow = (device: RecordedDevice): DeviceRow => ({
    id: device.id,
    userId: device.userId,
    deviceHash: device.deviceHash ?? `hash-${device.id}`,
    label: device.label,
    platform: device.platform,
    firstSeenAt: now(),
    lastSeenAt: now(),
    ipHash: null,
    revokedAt: device.revokedAt,
  });
  /** A passkey with the label of the device that added it, as the real join answers it: null once that device is gone. */
  const withDevice = (passkey: RecordedPasskey): PasskeyListRow => ({ ...passkey, createdOn: devices.find((d) => d.id === passkey.createdDeviceId)?.label ?? null });
  /**
   * The daily bound's reading, as the real statement makes it: the times of the account's latest passkey_added events within
   * the window, at most `limit` of them, and the seconds until the oldest of those leaves the window.
   */
  const recentPasskeyAdditions = (userId: string, withinMs: number, limit: number) => {
    const recent = events
      .filter((e) => e.userId === userId && e.type === "passkey_added")
      .map((e) => eventTimes.get(e)!)
      .filter((at) => at > t - withinMs)
      .sort((a, b) => b - a)
      .slice(0, limit);
    const oldest = recent.at(-1);
    return { count: recent.length, retryAfterSeconds: oldest === undefined ? 0 : Math.ceil((oldest + withinMs - t) / 1000) };
  };
  /**
   * Step 1's rows for a user, as the real repository's takeDownRows writes them: live sessions revoked (their ids
   * returned), devices, codes and passkeys gone, and the WebAuthn user handle cleared (1c design, section 7.7).
   */
  const takeDownRows = (userId: string, at: Date): string[] => {
    const live = sessions.filter((s) => s.userId === userId && s.revokedAt === null);
    for (const s of live) s.revokedAt = at;
    for (let i = devices.length - 1; i >= 0; i--) if (devices[i]!.userId === userId) devices.splice(i, 1);
    for (let i = codes.length - 1; i >= 0; i--) if (codes[i]!.userId === userId) codes.splice(i, 1);
    for (let i = passkeys.length - 1; i >= 0; i--) if (passkeys[i]!.userId === userId) passkeys.splice(i, 1);
    const row = users.get(userId);
    if (row) row.webauthnUserId = null;
    return live.map((s) => s.id);
  };
  const repo = {
    async findUserById(id: string): Promise<UserRow | undefined> {
      const row = users.get(id);
      return row && row.deletedAt === null ? { ...row } : undefined;
    },
    async findUserByEmail(email: string): Promise<UserRow | undefined> {
      // As the real lookup: the address in any case, and never a deleted row.
      const row = [...users.values()].find((u) => u.email.toLowerCase() === email.toLowerCase());
      return row && row.deletedAt === null ? { ...row } : undefined;
    },
    async setPasswordFailures(userId: string, failedLogins: number, lockedUntil: Date | null): Promise<void> {
      const row = users.get(userId);
      if (row) {
        row.failedLogins = failedLogins;
        row.lockedUntil = lockedUntil;
      }
    },
    async createEmailCode(input: Parameters<AuthRepo["createEmailCode"]>[0]): Promise<void> {
      codes.push({ id: randomUUID(), ...input, attempts: 0, consumedAt: null, createdAt: now() });
    },
    async findEmailCode(flowId: string): Promise<EmailCodeRow | undefined> {
      const row = codes.find((c) => c.flowId === flowId);
      return row ? { ...row } : undefined;
    },
    async addCodeAttempt(id: string): Promise<number> {
      const row = codes.find((c) => c.id === id);
      if (!row) return Number.MAX_SAFE_INTEGER;
      row.attempts += 1;
      return row.attempts;
    },
    async consumeEmailCode(id: string, at: Date): Promise<boolean> {
      const row = codes.find((c) => c.id === id);
      if (!row || row.consumedAt !== null) return false;
      row.consumedAt = at;
      return true;
    },
    async changeEmail(userId: string, email: string, at: Date): Promise<void> {
      // As the real unique index on lower(email), deleted rows included: the driver error that the flow recognises through isUniqueViolation.
      for (const other of users.values()) {
        if (other.id !== userId && other.email.toLowerCase() === email.toLowerCase()) {
          throw Object.assign(new Error('duplicate key value violates unique constraint "users_email_lower_idx"'), { code: "23505" });
        }
      }
      const row = users.get(userId);
      if (!row) return;
      row.email = email;
      row.emailVerifiedAt = at;
    },
    async setPasswordHash(userId: string, passwordHash: string | null, at: Date): Promise<void> {
      // As the real statement: setting or clearing a password also clears any lockout, and records when.
      const row = users.get(userId);
      if (row) Object.assign(row, { passwordHash, passwordChangedAt: at, failedLogins: 0, lockedUntil: null });
    },
    async enableTotp(userId: string, input: { secretEnc: string; recoveryCodesHash: string[]; now: Date }): Promise<void> {
      // As the real statement: unconditional, whatever the row held, and the last accepted step starts over.
      const row = users.get(userId);
      if (row) Object.assign(row, { totpSecretEnc: input.secretEnc, totpEnabledAt: input.now, totpLastStep: null, recoveryCodesHash: input.recoveryCodesHash });
    },
    async disableTotp(userId: string): Promise<void> {
      const row = users.get(userId);
      if (row) Object.assign(row, { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] });
    },
    async lockDown(userId: string, input: LockDownInput): Promise<LockDownOutcome> {
      // One transaction, as the real one: when it fails midway nothing it would have written lands.
      if (faults.has("lockDown")) throw new Error("the lockdown transaction failed midway and was rolled back");
      const live = sessions.filter((s) => s.userId === userId && s.revokedAt === null);
      for (const s of live) s.revokedAt = input.now;
      for (const device of devices) if (device.userId === userId && device.revokedAt === null) device.revokedAt = input.now;
      // As the real statement: the user's passkeys created at or after `since`, plus any of theirs the caller names.
      const passkeysRemoved: string[] = [];
      for (let i = passkeys.length - 1; i >= 0; i--) {
        const passkey = passkeys[i]!;
        if (passkey.userId !== userId) continue;
        if (passkey.createdAt.getTime() >= input.since.getTime() || input.passkeyIds.includes(passkey.id)) {
          passkeysRemoved.push(passkey.id);
          passkeys.splice(i, 1);
        }
      }
      const row = users.get(userId);
      // As the real read of the locked row: an account that is gone has no two-factor to clear.
      const totpCleared = row !== undefined && row.deletedAt === null && row.totpEnabledAt !== null && row.totpEnabledAt.getTime() >= input.since.getTime();
      if (row) {
        // The password as setPasswordHash clears it, and two-factor as disableTotp turns it off.
        Object.assign(row, { passwordHash: null, passwordChangedAt: input.now, failedLogins: 0, lockedUntil: null });
        if (totpCleared) Object.assign(row, { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] });
      }
      recordEvent({ userId, type: input.event.type, deviceId: input.event.deviceId, metadata: { ...input.event.metadata, passkeysRemoved, totpCleared, passwordCleared: true } });
      return { sessionIds: live.map((s) => s.id), passkeysRemoved, totpCleared };
    },
    async setPhoneHash(userId: string, phoneHash: string | null): Promise<void> {
      // As the real partial unique index on phone_hash, deleted rows included: the driver error that the flow recognises through isUniqueViolation.
      if (phoneHash !== null) {
        for (const other of users.values()) {
          if (other.id !== userId && other.phoneHash === phoneHash) {
            throw Object.assign(new Error('duplicate key value violates unique constraint "users_phone_hash_idx"'), { code: "23505" });
          }
        }
      }
      const row = users.get(userId);
      if (row) row.phoneHash = phoneHash;
    },
    async appendEvent(input: Parameters<AuthRepo["appendEvent"]>[0]): Promise<void> {
      recordEvent({ userId: input.userId, type: input.type, deviceId: input.deviceId ?? null, metadata: input.metadata ?? {} });
    },
    async findDeviceById(id: string): Promise<DeviceRow | undefined> {
      const device = devices.find((d) => d.id === id);
      return device ? deviceRow(device) : undefined;
    },
    async ensureWebauthnUserId(userId: string, candidate: Buffer): Promise<Buffer | undefined> {
      // As the real compare-and-set: the first candidate sticks, every later call reads it back.
      const row = users.get(userId);
      if (!row || row.deletedAt !== null) return undefined;
      row.webauthnUserId ??= candidate;
      return row.webauthnUserId;
    },
    async countPasskeys(userId: string): Promise<number> {
      return passkeys.filter((p) => p.userId === userId).length;
    },
    async listPasskeys(userId: string): Promise<PasskeyListRow[]> {
      // Newest first, as the real statement orders them.
      return passkeys
        .filter((p) => p.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(withDevice);
    },
    async findPasskey(id: string, userId: string): Promise<PasskeyListRow | undefined> {
      const passkey = passkeys.find((p) => p.id === id && p.userId === userId);
      return passkey ? withDevice(passkey) : undefined;
    },
    async recentPasskeyAdditions(userId: string, withinMs: number, limit: number): Promise<{ count: number; retryAfterSeconds: number }> {
      return recentPasskeyAdditions(userId, withinMs, limit);
    },
    async addPasskey(input: NewPasskey, limits: PasskeyLimits): Promise<AddPasskeyOutcome> {
      // As the real transaction: the account locked, both bounds checked again, then the row and its event, or nothing.
      const row = users.get(input.userId);
      if (!row || row.deletedAt !== null) return { ok: false, reason: "gone" };
      if (passkeys.filter((p) => p.userId === input.userId).length >= limits.passkeys) return { ok: false, reason: "cap" };
      const additions = recentPasskeyAdditions(input.userId, limits.windowMs, limits.additions);
      if (additions.count >= limits.additions) return { ok: false, reason: "daily", retryAfterSeconds: additions.retryAfterSeconds };
      // As the real unique index on credential_id: the driver error that the flow recognises through isUniqueViolation.
      if (passkeys.some((p) => p.credentialId === input.credentialId)) {
        throw Object.assign(new Error('duplicate key value violates unique constraint "passkeys_credential_idx"'), { code: "23505" });
      }
      const passkey: RecordedPasskey = { id: randomUUID(), lastUsedAt: null, suspectAt: null, ...input };
      passkeys.push(passkey);
      recordEvent({ userId: input.userId, type: "passkey_added", deviceId: input.createdDeviceId, metadata: { passkeyId: passkey.id } });
      return { ok: true, passkey: { ...passkey } };
    },
    async renamePasskey(id: string, userId: string, name: string): Promise<boolean> {
      const passkey = passkeys.find((p) => p.id === id && p.userId === userId);
      if (!passkey) return false;
      passkey.name = name;
      return true;
    },
    async deletePasskey(id: string, userId: string): Promise<{ name: string } | undefined> {
      const index = passkeys.findIndex((p) => p.id === id && p.userId === userId);
      if (index === -1) return undefined;
      const [removed] = passkeys.splice(index, 1);
      return { name: removed!.name };
    },
    async findPasskeyByCredentialId(credentialId: string): Promise<PasskeyRow | undefined> {
      // As the real lookup: any account's, and the flow refuses a deleted owner through findUserById.
      const passkey = passkeys.find((p) => p.credentialId === credentialId);
      return passkey ? { ...passkey } : undefined;
    },
    async findPasskeyByCredential(credentialId: string, userId: string): Promise<PasskeyRow | undefined> {
      const passkey = passkeys.find((p) => p.credentialId === credentialId && p.userId === userId);
      return passkey ? { ...passkey } : undefined;
    },
    async claimPasskeyUse(id: string, newCounter: number, backedUp: boolean, at: Date): Promise<boolean> {
      // As the real conditional update: a suspect passkey never matches, and the counter must move forward unless both are zero.
      const passkey = passkeys.find((p) => p.id === id);
      if (!passkey || passkey.suspectAt !== null) return false;
      if (!((newCounter === 0 && passkey.counter === 0) || newCounter > passkey.counter)) return false;
      passkey.counter = newCounter;
      passkey.lastUsedAt = at;
      passkey.backedUp = backedUp;
      return true;
    },
    async suspectPasskey(id: string, at: Date): Promise<void> {
      const passkey = passkeys.find((p) => p.id === id);
      if (passkey && passkey.suspectAt === null) passkey.suspectAt = at;
    },
    async findDevice(userId: string, deviceHashValue: string): Promise<DeviceRow | undefined> {
      const device = devices.find((d) => d.userId === userId && d.deviceHash === deviceHashValue && d.revokedAt === null);
      return device ? deviceRow(device) : undefined;
    },
    async createDevice(input: { userId: string; deviceHash: string; label: string; platform: string; ipHash: string | null }): Promise<DeviceRow> {
      const device: RecordedDevice = { id: randomUUID(), userId: input.userId, revokedAt: null, platform: input.platform as Platform, label: input.label, deviceHash: input.deviceHash };
      devices.push(device);
      return deviceRow(device);
    },
    async touchDevice(): Promise<void> {
      // The row's last-seen and ip are placeholders no flow reads here, so touching it changes nothing observable.
    },
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
      // As the real insert: the reauth time is the latest of the factors, and a fresh handle stands in for the column's default.
      const factors = input.factors ?? {};
      const times = Object.values(factors);
      sessions.push({
        id: input.id,
        userId: input.userId,
        revokedAt: null,
        deviceId: input.deviceId,
        handle: randomUUID(),
        factors,
        passkeyId: input.passkeyId ?? null,
        reauthAt: times.length > 0 ? new Date(Math.max(...times)) : input.now,
        createdAt: input.now,
        lastUsedAt: input.now,
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
      });
    },
    async findActiveSession(id: string, at: Date): Promise<ActiveSessionRow | undefined> {
      // As the real joins: the session, its account and its device must all be live.
      const row = sessions.find((s) => s.id === id && s.revokedAt === null && s.expiresAt > at && s.absoluteExpiresAt > at);
      if (!row) return undefined;
      const user = users.get(row.userId);
      if (!user || user.deletedAt !== null) return undefined;
      const device = devices.find((d) => d.id === row.deviceId && d.revokedAt === null);
      if (!device) return undefined;
      return {
        id: row.id,
        userId: row.userId,
        deviceId: row.deviceId,
        role: user.role,
        onboardedAt: user.onboardedAt,
        totpEnabledAt: user.totpEnabledAt,
        reauthAt: row.reauthAt,
        lastUsedAt: row.lastUsedAt,
        expiresAt: row.expiresAt,
        absoluteExpiresAt: row.absoluteExpiresAt,
        handle: row.handle,
        factors: row.factors,
        passkeyId: row.passkeyId,
      };
    },
    async rotateSession(id: string, newId: string): Promise<boolean> {
      // As the real statement: the primary key changes in place for a live row, and everything else stays.
      const row = sessions.find((s) => s.id === id && s.revokedAt === null);
      if (!row) return false;
      row.id = newId;
      return true;
    },
    async writeFactor(id: string, kind: string, at: Date): Promise<void> {
      // As the real statement: the kind's time is set or replaced and the reauth time follows it.
      const row = sessions.find((s) => s.id === id);
      if (!row) return;
      row.factors = { ...row.factors, [kind]: at.getTime() };
      row.reauthAt = at;
    },
    async claimTotpStep(userId: string, step: number): Promise<boolean> {
      // As the real conditional update: a step no later than the last accepted one is refused, so a code cannot be reused.
      const row = users.get(userId);
      if (!row || (row.totpLastStep !== null && row.totpLastStep >= step)) return false;
      row.totpLastStep = step;
      return true;
    },
    async revokeAllSessions(userId: string, at: Date): Promise<string[]> {
      const live = sessions.filter((s) => s.userId === userId && s.revokedAt === null);
      for (const s of live) s.revokedAt = at;
      return live.map((s) => s.id);
    },
    async listActiveSessions(userId: string, at: Date): Promise<SessionListRow[]> {
      // As the real statement: the user's sessions that are neither revoked nor expired, most recently used first, each with its device's label.
      return sessions
        .filter((s) => s.userId === userId && s.revokedAt === null && s.expiresAt > at && s.absoluteExpiresAt > at)
        .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime())
        .map((s) => {
          const device = devices.find((d) => d.id === s.deviceId);
          return { id: s.id, handle: s.handle, deviceLabel: device?.label ?? null, platform: device?.platform ?? "web", createdAt: s.createdAt, lastUsedAt: s.lastUsedAt };
        });
    },
    async markDeleted(userId: string, at: Date): Promise<void> {
      const row = users.get(userId);
      if (row && row.deletedAt === null) row.deletedAt = at;
    },
    async takeDown(userId: string, at: Date, deviceId: string | null): Promise<string[]> {
      // One transaction, as the real one: when it fails midway nothing it would have written lands.
      if (faults.has("takeDown")) throw new Error("the take-down transaction failed midway and was rolled back");
      const row = users.get(userId);
      if (row && row.deletedAt === null) row.deletedAt = at;
      const revoked = takeDownRows(userId, at);
      recordEvent({ userId, type: "account_deleted", deviceId, metadata: {} });
      return revoked;
    },
    async finishTakeDown(userId: string, at: Date): Promise<string[]> {
      // As the real statement: only a row marked deleted and not purged yet.
      const row = users.get(userId);
      if (!row || row.deletedAt === null || row.purgedAt !== null) return [];
      return takeDownRows(userId, at);
    },
    async finishPurge(userId: string, at: Date): Promise<void> {
      const row = users.get(userId);
      if (!row || row.deletedAt === null || row.purgedAt !== null) return;
      Object.assign(row, {
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
        purgedAt: at,
      });
    },
  } satisfies Pick<
    AuthRepo,
    | "findUserById"
    | "findUserByEmail"
    | "setPasswordFailures"
    | "createEmailCode"
    | "findEmailCode"
    | "addCodeAttempt"
    | "consumeEmailCode"
    | "changeEmail"
    | "setPasswordHash"
    | "enableTotp"
    | "disableTotp"
    | "lockDown"
    | "setPhoneHash"
    | "appendEvent"
    | "findDeviceById"
    | "ensureWebauthnUserId"
    | "countPasskeys"
    | "listPasskeys"
    | "findPasskey"
    | "recentPasskeyAdditions"
    | "addPasskey"
    | "renamePasskey"
    | "deletePasskey"
    | "findPasskeyByCredentialId"
    | "findPasskeyByCredential"
    | "claimPasskeyUse"
    | "suspectPasskey"
    | "findDevice"
    | "createDevice"
    | "touchDevice"
    | "createSession"
    | "findActiveSession"
    | "rotateSession"
    | "writeFactor"
    | "claimTotpStep"
    | "revokeAllSessions"
    | "listActiveSessions"
    | "markDeleted"
    | "takeDown"
    | "finishTakeDown"
    | "finishPurge"
  >;
  const authRepo = repo as unknown as AuthRepo;
  const kv = new MemoryKv(() => t);
  const mailer = new MemoryMailer();
  /** profiles.verified_at by account, as the badge flows set and clear it through the profile store. */
  const verified = new Map<string, Date | null>();
  const config: AuthConfig = {
    appOrigin: "http://localhost:8081",
    allowedOrigins: ["http://localhost:8081"],
    authHmacKey: Buffer.alloc(32, 3),
    ipHashKey: Buffer.alloc(32, 4),
    totpKey: parseVersionedKey(`v1:${Buffer.alloc(32, 5).toString("base64")}`),
    totpPreviousKeys: [],
    termsVersion: TEST_TERMS,
    trustProxy: "none",
    verifyProvider: "dev",
    webauthn: { rpId: "localhost", rpName: "korbat", origins: ["http://localhost:8081"] },
    // The staff console is off: no flow this harness runs reaches it.
    console: null,
  };
  const deps: AuthDeps = {
    repo: authRepo,
    kv,
    sessions: createSessions({ repo: authRepo, kv, now }),
    lockout: createLockout({ repo: authRepo, kv, now }),
    mailer,
    turnstile: { verify: async () => true },
    breachChecker: { isBreached: async () => false },
    // The flows this harness runs create no profile; the badge flows only set and clear verified_at, kept above by
    // account, and the deletion flow reads the handle, kept by account as `user` registers it. No flow here changes the
    // Explore switch, which reads as the column's default.
    profiles: {
      create: async () => {
        throw new Error("the memory harness has no profile store");
      },
      find: async (id) => {
        const handle = handles.get(id);
        return handle === undefined ? null : { id, handle, displayName: handle, handleChangedAt: null, verified: (verified.get(id) ?? null) !== null, showInExplore: true };
      },
      setVerified: async (id, at) => {
        verified.set(id, at);
      },
    },
    // The development provider, which accepts exactly 000000; a test swaps it for null or a scripted one.
    verify: devProvider(),
    config,
    log: pino({ level: "silent" }),
    now,
  };
  const ctx: RequestContext = { ipHash: randomToken(), userAgent: undefined };
  /**
   * A live session on a device of its own, both recorded as the deletion flow will find them. It proved an email code
   * just now unless given other factors, as a session behind requireFreshAuth has, and started from no passkey unless told so.
   * The device is a web browser labelled as the sign-in labels one, unless the test says otherwise.
   */
  const session = (userId: string, options: { factors?: Factors; passkeyId?: string | null; platform?: Platform; label?: string | null } = {}): Session => {
    const s: Session = {
      sessionId: sha256Hex(randomToken()),
      userId,
      deviceId: randomUUID(),
      role: "user",
      onboarded: true,
      mfaEnabled: false,
      reauthAt: now(),
      handle: randomUUID(),
      factors: options.factors ?? { email: t },
      passkeyId: options.passkeyId ?? null,
    };
    sessions.push({
      id: s.sessionId,
      userId,
      revokedAt: null,
      deviceId: s.deviceId,
      handle: s.handle,
      factors: s.factors,
      passkeyId: s.passkeyId,
      reauthAt: s.reauthAt,
      createdAt: now(),
      lastUsedAt: now(),
      expiresAt: new Date(t + SESSION_IDLE_MS),
      absoluteExpiresAt: new Date(t + SESSION_ABSOLUTE_MS),
    });
    devices.push({ id: s.deviceId, userId, revokedAt: null, platform: options.platform ?? "web", label: options.label === undefined ? "Chrome on Windows" : options.label });
    return s;
  };
  return {
    deps,
    kv,
    mailer,
    ctx,
    users,
    codes,
    events,
    sessions,
    devices,
    passkeys,
    verified,
    faults,
    now,
    advance(ms: number) {
      t += ms;
    },
    /** Another session of an existing account, on another device. */
    session,
    /**
     * A passkey of an existing account, created at `createdAt` (now unless given) with the row's defaults (a plain,
     * unnamed synced key added from no device) unless overridden; answers its id.
     */
    passkey(userId: string, createdAt: Date = now(), overrides: Partial<Omit<RecordedPasskey, "id" | "userId" | "createdAt">> = {}): string {
      const id = randomUUID();
      passkeys.push({
        id,
        userId,
        createdAt,
        credentialId: randomToken(),
        publicKey: "cose-key",
        counter: 0,
        transports: [],
        backedUp: false,
        name: "Passkey",
        lastUsedAt: null,
        aaguid: null,
        backupEligible: false,
        uvInitialized: false,
        createdDeviceId: null,
        suspectAt: null,
        ...overrides,
      });
      return id;
    },
    /**
     * An onboarded account holding a verified address, with a session that just proved a credential, as a route
     * behind requireFreshAuth passes it on. Its profile's handle is the address's local part unless given.
     */
    user(email: string, handle: string = email.split("@")[0]!.toLowerCase().replace(/[^a-z0-9_]/g, "_")): { user: UserRow; session: Session } {
      const id = randomUUID();
      const user: UserRow = {
        id,
        email,
        emailVerifiedAt: now(),
        phoneHash: null,
        passwordHash: null,
        totpSecretEnc: null,
        totpEnabledAt: null,
        recoveryCodesHash: [],
        failedLogins: 0,
        lockedUntil: null,
        createdAt: now(),
        deletedAt: null,
        role: "user",
        ageConfirmedAt: now(),
        termsVersion: TEST_TERMS,
        termsAcceptedAt: now(),
        onboardedAt: now(),
        passwordChangedAt: null,
        totpLastStep: null,
        purgedAt: null,
        webauthnUserId: null,
      };
      users.set(id, user);
      handles.set(id, handle);
      return { user, session: session(id) };
    },
  };
}

export type MemoryFlowHarness = ReturnType<typeof memoryFlowHarness>;
```

### Replace `apps/api/test/auth/messages.test.ts` (whole file)

```ts
import { AuthErrorCode, StaffErrorCode } from "@korbat/contracts";
import { describe, expect, test } from "vitest";
import { AuthError, authErrorMessage } from "../../src/auth/context";

describe("auth error messages", () => {
  test("every code the contracts list has a message", () => {
    for (const code of AuthErrorCode.options) expect(authErrorMessage(code).length, code).toBeGreaterThan(10);
  });

  test("the passkey codes answer with the wording of the 1c design (section 9)", () => {
    expect(authErrorMessage("passkey_invalid")).toBe("That passkey did not work. Try again or use your email.");
    expect(authErrorMessage("passkey_unsupported")).toBe("This passkey provider is not supported. Try another one.");
    // The cap; the daily bound passes its own message with the hours left (1c design, section 9).
    expect(authErrorMessage("passkey_limit")).toBe("You have 10 passkeys. Remove one to add another.");
    expect(authErrorMessage("passkey_suspended")).toBe("This passkey was switched off because a copy of it may exist. Remove it and add a new one.");
    expect(authErrorMessage("passkey_not_found")).toBe("That passkey is gone.");
    expect(authErrorMessage("challenge_expired")).toBe("That took too long. Try again.");
  });

  test("every staff code has the wording of the 3a design (section 10), which the module raises as an AuthError", () => {
    const expected: Record<StaffErrorCode, string> = {
      staff_session_required: "Your staff session ended. Sign in with your staff key.",
      staff_key_invalid: "This key does not open the staff console. If it should, ask the operator to check your staff keys.",
      staff_key_suspended: "This staff key was switched off because a copy of it may exist. Ask the operator for a link to enrol a new one.",
      staff_key_limit: "This account has 5 staff keys. Ask the operator to revoke one before enrolling another.",
      staff_key_not_device_bound: "This key can be synced or copied, so it cannot be a staff key. Use a security key or a device-bound authenticator.",
      staff_key_not_user_verified: "This key did not ask for a PIN or fingerprint, so it cannot be a staff key. Set a PIN on it, or use another key.",
      staff_key_refused: "The browser's answer for this key could not be checked. Try again, or use another key; this link still works.",
      staff_enrollment_invalid: "This enrolment link has expired or was already used. Ask the operator for a new one.",
      staff_step_up_required: "Confirm this with your staff key.",
      staff_step_up_invalid: "That confirmation was for another action, was already used or could not be checked. Try again.",
    };
    for (const code of StaffErrorCode.options) {
      expect(authErrorMessage(code), code).toBe(expected[code]);
      expect(new AuthError(code, 403).message, code).toBe(expected[code]);
    }
  });

  test("an AuthError carries the message of its code unless the flow gives its own", () => {
    expect(new AuthError("passkey_not_found", 404).message).toBe("That passkey is gone.");
    const daily = new AuthError("passkey_limit", 409, "You added 5 passkeys today. You can add another in about 3 hours.");
    expect(daily).toMatchObject({ code: "passkey_limit", status: 409, message: "You added 5 passkeys today. You can add another in about 3 hours." });
  });

  test("an AuthError can carry details for the app, such as the level a refusal asks for and the factors proven in time", () => {
    const refusal = new AuthError("reauth_required", 403, undefined, undefined, { level: 2, have: ["email"] });
    expect(refusal).toMatchObject({ code: "reauth_required", status: 403, message: "Confirm it's you to continue.", details: { level: 2, have: ["email"] } });
    expect(refusal.retryAfterSeconds).toBeUndefined();
    expect(new AuthError("rate_limited", 429, undefined, 60).details).toBeUndefined();
  });
});
```

### Replace `apps/api/test/auth/passkey-challenge.test.ts` (whole file)

```ts
import { createHash, createHmac, hkdfSync } from "node:crypto";
import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth/context";
import { sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { CHALLENGE_TTL_MS, challengeKey, issueChallenge, readChallenge, spendChallenge, type ChallengePurpose } from "../../src/auth/passkeys/challenge";

const AUTH_HMAC_KEY = Buffer.alloc(32, 3);
const KEY = challengeKey(AUTH_HMAC_KEY);
const T0 = 1_789_000_000_000;
const at = (ms: number) => new Date(T0 + ms);
const HANDLE = "0b7f3c4e-2a51-4c8e-9d7a-5b1e6f2c3d4a";
const OTHER_HANDLE = "7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36";
/** A staff enrolment's id, which a staff registration challenge is bound to (3a design, section 5). */
const ENROLMENT = "5d0c8e2f-9a41-4b7e-8c3d-2f6a1e9b7c05";
const OTHER_ENROLMENT = "a83f1c62-0e5d-4f9b-b217-6d4e9c0a3b18";
const PURPOSES: ChallengePurpose[] = ["signin", "register", "reauth", "staff_signin", "staff_register"];
/** The purposes whose challenge binds nothing: the two sign-ins, which run before any session or enrolment is known. */
const UNBOUND: ChallengePurpose[] = ["signin", "staff_signin"];
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const bytesOf = (challenge: string) => Buffer.from(challenge, "base64url");
const mac = (first42: Buffer) => createHmac("sha256", KEY).update(first42).digest().subarray(0, 16);
/** Seals 42 bytes as the codec does, so a test can build a challenge whose MAC holds while a field inside it is wrong. */
const sealed = (first42: Buffer) => Buffer.concat([first42, mac(first42)]).toString("base64url");
const spentKey = (challenge: string) => `webauthn-used:${sha256Hex(challenge)}`;

/** The AuthError a synchronous call throws; anything else fails the test. */
function refusal(read: () => unknown): AuthError {
  try {
    read();
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the challenge to be refused");
}

/** The AuthError a promise rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the challenge to be refused");
}

function expectInvalid(read: () => unknown) {
  const err = refusal(read);
  expect([err.code, err.status]).toEqual(["passkey_invalid", 401]);
}

describe("passkey challenges: the key", () => {
  test("is HKDF-SHA256 of AUTH_HMAC_KEY with an empty salt and the korbat-webauthn-challenge label, derived once per key", () => {
    expect(KEY.equals(Buffer.from(hkdfSync("sha256", AUTH_HMAC_KEY, "", "korbat-webauthn-challenge", 32)))).toBe(true);
    expect(KEY).toHaveLength(32);
    expect(KEY.equals(AUTH_HMAC_KEY)).toBe(false);
    // The same buffer comes back, so the flows can ask for it on every request without deriving it again.
    expect(challengeKey(AUTH_HMAC_KEY)).toBe(KEY);
    expect(challengeKey(Buffer.alloc(32, 4)).equals(KEY)).toBe(false);
  });
});

describe("passkey challenges: issuing and reading", () => {
  test("lays out 58 bytes: version, purpose, expiry, nonce, binding and an HMAC over the first 42, as unpadded base64url", () => {
    const cases: [ChallengePurpose, number, string | undefined][] = [
      ["signin", 1, undefined],
      ["register", 2, HANDLE],
      ["reauth", 3, HANDLE],
      // The staff console's two purposes share the layout, the key, the lifetime and the used-challenge markers.
      ["staff_signin", 4, undefined],
      ["staff_register", 5, ENROLMENT],
    ];
    for (const [purpose, code, bind] of cases) {
      const challenge = issueChallenge(KEY, purpose, at(0), bind);
      expect(challenge).toMatch(/^[A-Za-z0-9_-]{78}$/);
      const bytes = bytesOf(challenge);
      expect(bytes).toHaveLength(58);
      expect(bytes[0]).toBe(1);
      expect(bytes[1]).toBe(code);
      expect(Number(bytes.readBigUInt64BE(2))).toBe(T0 + 10 * MINUTE);
      const binding = bind === undefined ? Buffer.alloc(16) : createHash("sha256").update(bind).digest().subarray(0, 16);
      expect(bytes.subarray(26, 42).equals(binding)).toBe(true);
      expect(bytes.subarray(42).equals(mac(bytes.subarray(0, 42)))).toBe(true);
      expect(() => readChallenge(KEY, challenge, purpose, at(0), bind)).not.toThrow();
    }
    expect(CHALLENGE_TTL_MS).toBe(10 * MINUTE);
  });

  test("draws a fresh 16-byte nonce for every challenge", () => {
    const a = bytesOf(issueChallenge(KEY, "signin", at(0)));
    const b = bytesOf(issueChallenge(KEY, "signin", at(0)));
    expect(a.subarray(0, 10).equals(b.subarray(0, 10))).toBe(true);
    expect(a.subarray(10, 26).equals(b.subarray(10, 26))).toBe(false);
    expect(a.subarray(26, 42).equals(b.subarray(26, 42))).toBe(true);
  });

  test("refuses every tampered byte, the expiry and the MAC included, as passkey_invalid", () => {
    const challenge = issueChallenge(KEY, "reauth", at(0), HANDLE);
    for (let i = 0; i < 58; i++) {
      const bytes = bytesOf(challenge);
      bytes[i] = bytes[i]! ^ 0x01;
      expectInvalid(() => readChallenge(KEY, bytes.toString("base64url"), "reauth", at(0), HANDLE));
    }
  });

  test("refuses a challenge sealed with another key", () => {
    const foreign = issueChallenge(challengeKey(Buffer.alloc(32, 4)), "signin", at(0));
    expectInvalid(() => readChallenge(KEY, foreign, "signin", at(0)));
  });

  test("refuses anything that is not exactly 58 bytes of canonical, unpadded base64url", () => {
    const challenge = issueChallenge(KEY, "signin", at(0));
    const bytes = bytesOf(challenge);
    // Node's decoder ignores the 4 spare bits of the last character: this other string names the very same 58 bytes.
    const last = BASE64URL_ALPHABET.indexOf(challenge.at(-1)!);
    const nonCanonical = challenge.slice(0, -1) + BASE64URL_ALPHABET[last | 1];
    expect(nonCanonical).not.toBe(challenge);
    expect(bytesOf(nonCanonical).equals(bytes)).toBe(true);
    const malformed = [
      "",
      bytes.subarray(0, 57).toString("base64url"),
      Buffer.concat([bytes, Buffer.from([0])]).toString("base64url"),
      `${challenge}==`,
      bytes.toString("base64"),
      `+${challenge.slice(1)}`,
      ` ${challenge.slice(1)}`,
      nonCanonical,
      "A".repeat(10_000),
    ];
    for (const candidate of malformed) expectInvalid(() => readChallenge(KEY, candidate, "signin", at(0)));
  });

  test("refuses a sealed challenge of another version or with an unknown purpose byte", () => {
    const first42 = bytesOf(issueChallenge(KEY, "signin", at(0))).subarray(0, 42);
    const version2 = Buffer.from(first42);
    version2[0] = 2;
    expectInvalid(() => readChallenge(KEY, sealed(version2), "signin", at(0)));
    // 4 and 5 are the staff console's purposes, which the purpose tests below cover.
    for (const purpose of [0, 99, 255]) {
      const unknown = Buffer.from(first42);
      unknown[1] = purpose;
      expectInvalid(() => readChallenge(KEY, sealed(unknown), "signin", at(0)));
    }
    // The helper seals exactly as the codec does: with the right fields its output reads.
    expect(() => readChallenge(KEY, sealed(Buffer.from(first42)), "signin", at(0))).not.toThrow();
  });

  test("refuses a challenge issued for another purpose", () => {
    for (const issued of PURPOSES) {
      const bind = UNBOUND.includes(issued) ? undefined : HANDLE;
      const challenge = issueChallenge(KEY, issued, at(0), bind);
      for (const expected of PURPOSES.filter((p) => p !== issued)) expectInvalid(() => readChallenge(KEY, challenge, expected, at(0), bind));
    }
  });

  test("refuses a challenge bound to another session's handle, and a bound one where none is expected", () => {
    const challenge = issueChallenge(KEY, "reauth", at(0), HANDLE);
    expectInvalid(() => readChallenge(KEY, challenge, "reauth", at(0), OTHER_HANDLE));
    expectInvalid(() => readChallenge(KEY, challenge, "reauth", at(0)));
    expect(() => readChallenge(KEY, challenge, "reauth", at(0), HANDLE)).not.toThrow();
  });

  test("refuses a sign-in challenge, whose binding is zeros, where a binding is expected", () => {
    const signin = issueChallenge(KEY, "signin", at(0));
    expectInvalid(() => readChallenge(KEY, signin, "signin", at(0), HANDLE));
    expectInvalid(() => readChallenge(KEY, signin, "reauth", at(0), HANDLE));
    expectInvalid(() => readChallenge(KEY, signin, "register", at(0), HANDLE));
    // An unbound challenge of the right purpose is refused on its binding alone.
    const unbound = issueChallenge(KEY, "register", at(0));
    expectInvalid(() => readChallenge(KEY, unbound, "register", at(0), HANDLE));
  });

  test("expires exactly ten minutes after it was issued, as challenge_expired", () => {
    const challenge = issueChallenge(KEY, "register", at(0), HANDLE);
    expect(() => readChallenge(KEY, challenge, "register", at(CHALLENGE_TTL_MS - 1), HANDLE)).not.toThrow();
    for (const when of [CHALLENGE_TTL_MS, CHALLENGE_TTL_MS + 1, HOUR]) {
      const err = refusal(() => readChallenge(KEY, challenge, "register", at(when), HANDLE));
      expect([err.code, err.status]).toEqual(["challenge_expired", 400]);
    }
  });

  test("checks the seal, the purpose and the binding before the expiry, so an expired forgery is still passkey_invalid", () => {
    const challenge = issueChallenge(KEY, "register", at(0), HANDLE);
    const late = at(HOUR);
    const tampered = bytesOf(challenge);
    tampered[20] = tampered[20]! ^ 0x80;
    expectInvalid(() => readChallenge(KEY, tampered.toString("base64url"), "register", late, HANDLE));
    expectInvalid(() => readChallenge(KEY, challenge, "reauth", late, HANDLE));
    expectInvalid(() => readChallenge(KEY, challenge, "register", late, OTHER_HANDLE));
  });
});

describe("passkey challenges: the staff console's purposes", () => {
  test("an app sign-in challenge does not open the console's sign-in, and a console sign-in challenge does not sign into the app", () => {
    const app = issueChallenge(KEY, "signin", at(0));
    const staff = issueChallenge(KEY, "staff_signin", at(0));
    expectInvalid(() => readChallenge(KEY, app, "staff_signin", at(0)));
    expectInvalid(() => readChallenge(KEY, staff, "signin", at(0)));
    expect(() => readChallenge(KEY, app, "signin", at(0))).not.toThrow();
    expect(() => readChallenge(KEY, staff, "staff_signin", at(0))).not.toThrow();
  });

  test("a personal passkey's registration challenge does not enrol a staff key, nor the reverse, whatever they are bound to", () => {
    const personal = issueChallenge(KEY, "register", at(0), ENROLMENT);
    const staff = issueChallenge(KEY, "staff_register", at(0), HANDLE);
    expectInvalid(() => readChallenge(KEY, personal, "staff_register", at(0), ENROLMENT));
    expectInvalid(() => readChallenge(KEY, staff, "register", at(0), HANDLE));
  });

  test("a staff registration challenge is bound to its enrolment's id, and refused for another enrolment or none", () => {
    const challenge = issueChallenge(KEY, "staff_register", at(0), ENROLMENT);
    // The binding takes any string: the first 16 bytes of the sha256 of the enrolment's id, as of a session's handle.
    expect(bytesOf(challenge).subarray(26, 42).equals(createHash("sha256").update(ENROLMENT).digest().subarray(0, 16))).toBe(true);
    expect(() => readChallenge(KEY, challenge, "staff_register", at(0), ENROLMENT)).not.toThrow();
    expectInvalid(() => readChallenge(KEY, challenge, "staff_register", at(0), OTHER_ENROLMENT));
    expectInvalid(() => readChallenge(KEY, challenge, "staff_register", at(0)));
    // An unbound one of the right purpose names no enrolment.
    expectInvalid(() => readChallenge(KEY, issueChallenge(KEY, "staff_register", at(0)), "staff_register", at(0), ENROLMENT));
  });

  test("a staff sign-in challenge binds nothing, and is refused where a binding is expected", () => {
    const challenge = issueChallenge(KEY, "staff_signin", at(0));
    expect(bytesOf(challenge).subarray(26, 42).equals(Buffer.alloc(16))).toBe(true);
    expectInvalid(() => readChallenge(KEY, challenge, "staff_signin", at(0), HANDLE));
  });

  test("the staff purposes expire after ten minutes as challenge_expired, and are spent once", async () => {
    const challenge = issueChallenge(KEY, "staff_register", at(0), ENROLMENT);
    expect(() => readChallenge(KEY, challenge, "staff_register", at(CHALLENGE_TTL_MS - 1), ENROLMENT)).not.toThrow();
    expect(refusal(() => readChallenge(KEY, challenge, "staff_register", at(CHALLENGE_TTL_MS), ENROLMENT)).code).toBe("challenge_expired");
    const kv = new MemoryKv(() => T0);
    await spendChallenge(kv, challenge, at(0));
    expect((await failure(spendChallenge(kv, challenge, at(0)))).code).toBe("passkey_invalid");
  });
});

describe("passkey challenges: single use", () => {
  test("a challenge is spent once, and its marker lives exactly as long as the challenge", async () => {
    let clock = T0;
    const kv = new MemoryKv(() => clock);
    const challenge = issueChallenge(KEY, "signin", at(0));
    clock = T0 + MINUTE;
    await spendChallenge(kv, challenge, at(MINUTE));
    expect(await kv.get(spentKey(challenge))).toBe("1");
    const second = await failure(spendChallenge(kv, challenge, at(MINUTE)));
    expect([second.code, second.status]).toEqual(["passkey_invalid", 401]);
    clock = T0 + CHALLENGE_TTL_MS - 1;
    expect(await kv.get(spentKey(challenge))).toBe("1");
    expect((await failure(spendChallenge(kv, challenge, at(CHALLENGE_TTL_MS - 1)))).code).toBe("passkey_invalid");
    // Past its expiry the challenge is refused by readChallenge, so the marker has nothing left to guard.
    clock = T0 + CHALLENGE_TTL_MS;
    expect(await kv.get(spentKey(challenge))).toBeNull();
  });

  test("two concurrent spends of the same challenge: exactly one wins", async () => {
    const kv = new MemoryKv(() => T0);
    const challenge = issueChallenge(KEY, "reauth", at(0), HANDLE);
    const results = await Promise.allSettled([spendChallenge(kv, challenge, at(0)), spendChallenge(kv, challenge, at(0))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(AuthError);
    expect((rejected[0]!.reason as AuthError).code).toBe("passkey_invalid");
  });

  test("spending at or after the expiry is challenge_expired and writes no marker", async () => {
    const kv = new MemoryKv(() => T0 + CHALLENGE_TTL_MS);
    const challenge = issueChallenge(KEY, "signin", at(0));
    const err = await failure(spendChallenge(kv, challenge, at(CHALLENGE_TTL_MS)));
    expect([err.code, err.status]).toEqual(["challenge_expired", 400]);
    expect(await kv.get(spentKey(challenge))).toBeNull();
  });

  test("a malformed or non-canonical string cannot be spent, so it can never mark a second copy of a challenge", async () => {
    const kv = new MemoryKv(() => T0);
    const challenge = issueChallenge(KEY, "signin", at(0));
    const last = BASE64URL_ALPHABET.indexOf(challenge.at(-1)!);
    const nonCanonical = challenge.slice(0, -1) + BASE64URL_ALPHABET[last | 1];
    for (const candidate of [nonCanonical, "", "not a challenge", challenge.slice(0, -2)]) {
      expect((await failure(spendChallenge(kv, candidate, at(0)))).code).toBe("passkey_invalid");
      expect(await kv.get(spentKey(candidate))).toBeNull();
    }
    await spendChallenge(kv, challenge, at(0));
  });

  test("spending one challenge leaves every other one spendable", async () => {
    const kv = new MemoryKv(() => T0);
    const a = issueChallenge(KEY, "signin", at(0));
    const b = issueChallenge(KEY, "signin", at(0));
    await spendChallenge(kv, a, at(0));
    await spendChallenge(kv, b, at(0));
    expect((await failure(spendChallenge(kv, a, at(0)))).code).toBe("passkey_invalid");
  });
});
```

### Replace `apps/api/test/auth/passkey-webauthn.test.ts` (whole file)

```ts
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from "vitest";
import { AuthError } from "../../src/auth/context";
import { MemoryKv } from "../../src/auth/kv";
import { challengeKey, issueChallenge, readChallenge, spendChallenge } from "../../src/auth/passkeys/challenge";
import {
  CEREMONY_TIMEOUT_MS,
  MAX_CREDENTIAL_ID_BYTES,
  SUPPORTED_ALGORITHMS,
  authenticationOptions,
  isCounterRegression,
  readResponseChallenge,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from "../../src/auth/passkeys/webauthn";
import { SoftAuthenticator, type CborValue, type SoftCreateInput, type SoftFlags } from "./soft-authenticator";

// The library's two verification calls, wrapped so a test can prove when korbat never reached them. They still run the
// real code.
vi.mock("@simplewebauthn/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@simplewebauthn/server")>();
  return {
    ...actual,
    verifyRegistrationResponse: vi.fn(actual.verifyRegistrationResponse),
    verifyAuthenticationResponse: vi.fn(actual.verifyAuthenticationResponse),
  };
});

const RP_ID = "localhost";
const RP_NAME = "korbat";
const ORIGIN = "http://localhost:8081";
const ORIGINS = [ORIGIN];
const KEY = challengeKey(Buffer.alloc(32, 3));
const NOW = new Date(1_789_000_000_000);
const HANDLE = "0b7f3c4e-2a51-4c8e-9d7a-5b1e6f2c3d4a";
const USER_HANDLE = Buffer.alloc(32, 7);
const AAGUID = "fbfc3007-154e-4ecc-8c0b-6e020557d7bd";
const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const BARE: SoftFlags = { up: true, uv: false, be: false, bs: false };
const libraryRegistration = vi.mocked(verifyRegistrationResponse);
const libraryAuthentication = vi.mocked(verifyAuthenticationResponse);

let fetchSpy: MockInstance<typeof fetch>;
beforeEach(() => {
  libraryRegistration.mockClear();
  libraryAuthentication.mockClear();
  // Certificate-carrying formats make the library fetch revocation lists; nothing here may reach the network.
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in unit tests"));
});
afterEach(() => {
  fetchSpy.mockRestore();
});

/** The AuthError a promise rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the passkey step to be refused");
}

/** The AuthError a synchronous call throws; anything else fails the test. */
function refusal(read: () => unknown): AuthError {
  try {
    read();
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the passkey step to be refused");
}

async function expectInvalid(promise: Promise<unknown>) {
  const err = await failure(promise);
  expect([err.code, err.status]).toEqual(["passkey_invalid", 401]);
}

/** A registration response to a fresh registration challenge bound to HANDLE, and that challenge. */
function registrationResponse(auth: SoftAuthenticator, overrides: Partial<SoftCreateInput> = {}) {
  const challenge = issueChallenge(KEY, "register", NOW, HANDLE);
  const response = auth.create({ rpId: RP_ID, challenge, origin: ORIGIN, userHandle: USER_HANDLE, flags: ALL, ...overrides });
  return { challenge, response };
}

/** A passkey korbat accepted, with the response it came from. */
async function registered(auth: SoftAuthenticator, overrides: Partial<SoftCreateInput> = {}) {
  const { challenge, response } = registrationResponse(auth, overrides);
  const passkey = await verifyRegistration({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID });
  return { response, passkey };
}

/** An assertion by a registered passkey to a fresh re-authentication challenge, and that challenge. */
function assertion(auth: SoftAuthenticator, credentialId: string, flags: SoftFlags, counter: number, at: { rpId?: string; origin?: string } = {}) {
  const challenge = issueChallenge(KEY, "reauth", NOW, HANDLE);
  const response = auth.get({ credentialId, rpId: at.rpId ?? RP_ID, challenge, origin: at.origin ?? ORIGIN, flags, counter });
  return { challenge, response };
}

describe("passkey options", () => {
  test("registration options carry korbat's challenge unchanged, the user handle, the label, the pinned algorithms and discoverable credentials", async () => {
    const challenge = issueChallenge(KEY, "register", NOW, HANDLE);
    const options = await registrationOptions({
      rp: { id: RP_ID, name: RP_NAME },
      user: { id: USER_HANDLE, name: "ada on the laptop", displayName: "ada on the laptop" },
      exclude: [{ id: "AAECAw", transports: ["internal", "hybrid"] }],
      challenge,
    });
    // The exact string korbat issued, so the browser signs it and readChallenge can read it back.
    expect(options.challenge).toBe(challenge);
    expect(() => readChallenge(KEY, options.challenge, "register", NOW, HANDLE)).not.toThrow();
    expect(options.rp).toEqual({ name: RP_NAME, id: RP_ID });
    expect(options.user).toEqual({ id: USER_HANDLE.toString("base64url"), name: "ada on the laptop", displayName: "ada on the laptop" });
    // Ed25519, ES256, RS256 in that order; never the runtime default, which adds ML-DSA on Node 24.
    expect(SUPPORTED_ALGORITHMS).toEqual([-8, -7, -257]);
    expect(options.pubKeyCredParams).toEqual([
      { alg: -8, type: "public-key" },
      { alg: -7, type: "public-key" },
      { alg: -257, type: "public-key" },
    ]);
    expect(CEREMONY_TIMEOUT_MS).toBe(300_000);
    expect(options.timeout).toBe(300_000);
    expect(options.attestation).toBe("none");
    expect(options.authenticatorSelection).toEqual({ residentKey: "required", requireResidentKey: true, userVerification: "preferred" });
    // No hint unless a caller asks for one: 1c's registration names no kind of authenticator.
    expect(options.hints).toEqual([]);
    expect(options.excludeCredentials).toEqual([{ id: "AAECAw", transports: ["internal", "hybrid"], type: "public-key" }]);
  });

  test("registration options require user verification only when asked, and carry the security-key hint only when asked", async () => {
    const input = () => ({
      rp: { id: "console.localhost", name: RP_NAME },
      user: { id: USER_HANDLE, name: "Blue key", displayName: "Blue key" },
      exclude: [],
      challenge: issueChallenge(KEY, "staff_register", NOW, HANDLE),
    });
    // What every staff ceremony asks for (3a design, section 5); 1c's callers name nothing and keep "preferred".
    const required = await registrationOptions({ ...input(), userVerification: "required" });
    expect(required.authenticatorSelection).toEqual({ residentKey: "required", requireResidentKey: true, userVerification: "required" });
    expect(required.hints).toEqual([]);
    expect((await registrationOptions({ ...input(), userVerification: "preferred" })).authenticatorSelection!.userVerification).toBe("preferred");
    expect((await registrationOptions(input())).authenticatorSelection!.userVerification).toBe("preferred");
    // The enrolment's "Register a security key" button: the library sends the hint only with cross-platform attachment,
    // which is why "Use Windows Hello on this computer" sends none.
    const securityKey = await registrationOptions({ ...input(), userVerification: "required", hint: "securityKey" });
    expect(securityKey.hints).toEqual(["security-key"]);
    expect(securityKey.authenticatorSelection).toEqual({ residentKey: "required", requireResidentKey: true, userVerification: "required", authenticatorAttachment: "cross-platform" });
    // The library writes the attachment into the object it is given: the next call without a hint has none.
    expect((await registrationOptions({ ...input(), userVerification: "required" })).authenticatorSelection).toEqual({ residentKey: "required", requireResidentKey: true, userVerification: "required" });
  });

  test("authentication options require user verification only when asked", async () => {
    const challenge = () => issueChallenge(KEY, "staff_signin", NOW);
    expect((await authenticationOptions({ rpId: "console.localhost", allow: [], challenge: challenge(), userVerification: "required" })).userVerification).toBe("required");
    expect((await authenticationOptions({ rpId: RP_ID, allow: [], challenge: challenge(), userVerification: "preferred" })).userVerification).toBe("preferred");
    expect((await authenticationOptions({ rpId: RP_ID, allow: [], challenge: challenge() })).userVerification).toBe("preferred");
  });

  test("two calls never share an authenticatorSelection object, which the library writes into", async () => {
    const input = () => ({
      rp: { id: RP_ID, name: RP_NAME },
      user: { id: USER_HANDLE, name: "ada", displayName: "ada" },
      exclude: [],
      challenge: issueChallenge(KEY, "register", NOW, HANDLE),
    });
    const first = await registrationOptions(input());
    const second = await registrationOptions(input());
    expect(first.authenticatorSelection).not.toBe(second.authenticatorSelection);
    first.authenticatorSelection!.residentKey = "discouraged";
    first.authenticatorSelection!.userVerification = "discouraged";
    expect(second.authenticatorSelection).toEqual({ residentKey: "required", requireResidentKey: true, userVerification: "preferred" });
    expect((await registrationOptions(input())).authenticatorSelection).toEqual({ residentKey: "required", requireResidentKey: true, userVerification: "preferred" });
  });

  test("sign-in options list no credentials, so they say nothing about any account", async () => {
    const challenge = issueChallenge(KEY, "signin", NOW);
    const options = await authenticationOptions({ rpId: RP_ID, allow: [], challenge });
    expect(options.challenge).toBe(challenge);
    expect(options.allowCredentials).toEqual([]);
    expect(options.rpId).toBe(RP_ID);
    expect(options.timeout).toBe(300_000);
    expect(options.userVerification).toBe("preferred");
    expect(() => readChallenge(KEY, options.challenge, "signin", NOW)).not.toThrow();
  });

  test("re-authentication options list the account's passkeys with their transports", async () => {
    const challenge = issueChallenge(KEY, "reauth", NOW, HANDLE);
    const options = await authenticationOptions({ rpId: RP_ID, allow: [{ id: "AAECAw", transports: ["usb"] }, { id: "BAUG", transports: [] }], challenge });
    expect(options.challenge).toBe(challenge);
    expect(options.allowCredentials).toEqual([
      { id: "AAECAw", transports: ["usb"], type: "public-key" },
      { id: "BAUG", transports: [], type: "public-key" },
    ]);
  });
});

describe("passkey registration", () => {
  test("verifies a registration and returns what korbat stores, with the flags", async () => {
    const auth = new SoftAuthenticator();
    const { challenge, response } = registrationResponse(auth, { counter: 4, aaguid: AAGUID });
    const passkey = await verifyRegistration({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID });
    expect(passkey).toEqual({
      credentialId: response.id,
      publicKey: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
      counter: 4,
      transports: ["internal", "hybrid"],
      aaguid: AAGUID,
      backupEligible: true,
      backedUp: true,
      userVerified: true,
    });
    // The public key is the COSE key from the authenticator data, as base64url: an ES256 key on P-256.
    const cose = isoCBOR.decodeFirst<Map<number, unknown>>(Uint8Array.from(Buffer.from(passkey.publicKey, "base64url")));
    expect([cose.get(1), cose.get(3), cose.get(-1)]).toEqual([2, -7, 1]);
    // The library ran once, with korbat's settings: the checked challenge string, every allowed origin, the RP ID,
    // user verification not required and the algorithms pinned.
    expect(libraryRegistration).toHaveBeenCalledTimes(1);
    expect(libraryRegistration.mock.calls[0]![0]).toMatchObject({
      expectedChallenge: challenge,
      expectedOrigin: ORIGINS,
      expectedRPID: RP_ID,
      requireUserVerification: false,
      supportedAlgorithmIDs: [-8, -7, -257],
    });
  });

  test("a registration without user verification still verifies, and says so", async () => {
    const { passkey } = await registered(new SoftAuthenticator(), { flags: BARE });
    expect(passkey).toMatchObject({ userVerified: false, backupEligible: false, backedUp: false, counter: 0, aaguid: "00000000-0000-0000-0000-000000000000" });
  });

  test("a registration without user presence is refused", async () => {
    const { challenge, response } = registrationResponse(new SoftAuthenticator(), { flags: { up: false, uv: true, be: false, bs: false } });
    await expectInvalid(verifyRegistration({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID }));
  });

  test("packed without x5c passes the format check and verifies as a self attestation", async () => {
    const { passkey } = await registered(new SoftAuthenticator(), { fmt: "packed" });
    expect(passkey.userVerified).toBe(true);
    expect(libraryRegistration).toHaveBeenCalledTimes(1);
  });

  test("packed with an x5c chain, tpm, android-key, apple, fido-u2f and any other format are refused before the library runs", async () => {
    const certificate = randomBytes(300);
    const signature = randomBytes(70);
    const statements: [string, Map<string | number, CborValue>][] = [
      ["packed", new Map<string | number, CborValue>([["alg", -7], ["sig", signature], ["x5c", [certificate]]])],
      // An empty chain is still a chain: the library tests x5c for truthiness, and an empty array passes that test.
      ["packed", new Map<string | number, CborValue>([["alg", -7], ["sig", signature], ["x5c", []]])],
      ["tpm", new Map<string | number, CborValue>([["ver", "2.0"], ["alg", -257], ["x5c", [certificate]], ["sig", signature], ["certInfo", randomBytes(100)], ["pubArea", randomBytes(100)]])],
      ["android-key", new Map<string | number, CborValue>([["alg", -7], ["sig", signature], ["x5c", [certificate]]])],
      ["apple", new Map<string | number, CborValue>([["x5c", [certificate]]])],
      ["fido-u2f", new Map<string | number, CborValue>([["sig", signature], ["x5c", [certificate]]])],
      ["android-safetynet", new Map<string | number, CborValue>([["ver", "1"], ["response", randomBytes(100)]])],
      ["a-format-nobody-registered", new Map<string | number, CborValue>()],
    ];
    const auth = new SoftAuthenticator();
    for (const [fmt, attStmt] of statements) {
      const { challenge, response } = registrationResponse(auth, { fmt, attStmt });
      const err = await failure(verifyRegistration({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID }));
      expect([fmt, err.code, err.status]).toEqual([fmt, "passkey_unsupported", 400]);
    }
    expect(libraryRegistration).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("an attestation object that is not a CBOR map of the expected members is passkey_invalid, and the library never sees it", async () => {
    const auth = new SoftAuthenticator();
    const encode = (value: CborValue) => Buffer.from(isoCBOR.encode(value)).toString("base64url");
    const broken = [
      encode(5),
      encode("none"),
      encode(new Map<string | number, CborValue>([["fmt", "none"], ["authData", randomBytes(37)]])),
      encode(new Map<string | number, CborValue>([["fmt", 1], ["attStmt", new Map()], ["authData", randomBytes(37)]])),
      encode(new Map<string | number, CborValue>([["fmt", "none"], ["attStmt", [1, 2]], ["authData", randomBytes(37)]])),
      Buffer.from([0xff, 0x00, 0x13]).toString("base64url"),
    ];
    for (const attestationObject of broken) {
      const { challenge, response } = registrationResponse(auth);
      await expectInvalid(verifyRegistration({ response: { ...response, response: { ...response.response, attestationObject } }, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID }));
    }
    expect(libraryRegistration).not.toHaveBeenCalled();
  });

  test("a credential id of 1024 bytes is refused; 1023 bytes are kept", async () => {
    expect(MAX_CREDENTIAL_ID_BYTES).toBe(1023);
    const auth = new SoftAuthenticator();
    const { challenge, response } = registrationResponse(auth, { credentialId: randomBytes(1024) });
    await expectInvalid(verifyRegistration({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID }));
    const longest = randomBytes(1023);
    const { passkey } = await registered(auth, { credentialId: longest });
    expect(Buffer.from(passkey.credentialId, "base64url").equals(longest)).toBe(true);
  });

  test("transports keep only the known values, without repeats, five at most", async () => {
    const auth = new SoftAuthenticator();
    const mixed = await registered(auth, { transports: ["internal", "carrier-pigeon", "hybrid", "internal", "", "usb", "INTERNAL"] });
    expect(mixed.passkey.transports).toEqual(["internal", "hybrid", "usb"]);
    const excess = await registered(auth, { transports: ["usb", "nfc", "ble", "smart-card", "hybrid", "internal", "cable"] });
    expect(excess.passkey.transports).toEqual(["usb", "nfc", "ble", "smart-card", "hybrid"]);
    const late = await registered(auth, { transports: ["cable", "internal"] });
    expect(late.passkey.transports).toEqual(["cable", "internal"]);
    const { challenge, response } = registrationResponse(auth);
    const { transports: _dropped, ...withoutTransports } = response.response;
    const none = await verifyRegistration({ response: { ...response, response: withoutTransports }, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID });
    expect(none.transports).toEqual([]);
  });

  test("a wrong origin, a wrong RP ID and a wrong challenge are passkey_invalid", async () => {
    const auth = new SoftAuthenticator();
    const wrongOrigin = registrationResponse(auth, { origin: "https://korbat.example.net" });
    await expectInvalid(verifyRegistration({ response: wrongOrigin.response, expectedChallenge: wrongOrigin.challenge, origins: ORIGINS, rpId: RP_ID }));
    const wrongRp = registrationResponse(auth, { rpId: "example.net" });
    await expectInvalid(verifyRegistration({ response: wrongRp.response, expectedChallenge: wrongRp.challenge, origins: ORIGINS, rpId: RP_ID }));
    const { response } = registrationResponse(auth);
    await expectInvalid(verifyRegistration({ response, expectedChallenge: issueChallenge(KEY, "register", NOW, HANDLE), origins: ORIGINS, rpId: RP_ID }));
    // A sign-in response is not a registration, whatever it carries.
    const passkey = await registered(auth);
    const signin = assertion(auth, passkey.response.id, ALL, 1);
    const asRegistration = { ...passkey.response, response: { ...passkey.response.response, clientDataJSON: signin.response.response.clientDataJSON } };
    await expectInvalid(verifyRegistration({ response: asRegistration, expectedChallenge: signin.challenge, origins: ORIGINS, rpId: RP_ID }));
  });

  test("every allowed origin is accepted", async () => {
    const auth = new SoftAuthenticator();
    const { challenge, response } = registrationResponse(auth, { origin: "http://localhost:19006" });
    const passkey = await verifyRegistration({ response, expectedChallenge: challenge, origins: [ORIGIN, "http://localhost:19006"], rpId: RP_ID });
    expect(passkey.credentialId).toBe(response.id);
  });
});

describe("passkey assertions", () => {
  test("an assertion verifies against the stored key with a counter of 0 given to the library, and reports the new counter and flags", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth);
    const { challenge, response } = assertion(auth, passkey.credentialId, { up: true, uv: true, be: true, bs: false }, 7);
    const result = await verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential: { id: passkey.credentialId, publicKey: passkey.publicKey, transports: passkey.transports } });
    // BE as this assertion reported it: the staff flows refuse a key that reports it at any use (3a design, section 2).
    expect(result).toEqual({ newCounter: 7, userVerified: true, backedUp: false, backupEligible: true });
    expect(libraryAuthentication).toHaveBeenCalledTimes(1);
    const call = libraryAuthentication.mock.calls[0]![0];
    expect(call).toMatchObject({ expectedChallenge: challenge, expectedOrigin: ORIGINS, expectedRPID: RP_ID, requireUserVerification: false });
    expect(call.credential.id).toBe(passkey.credentialId);
    expect(call.credential.counter).toBe(0);
    expect(Buffer.from(call.credential.publicKey).toString("base64url")).toBe(passkey.publicKey);
  });

  test("the library never decides on counters: a counter of 0, as Apple passkeys send, and any other counter verify", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth, { counter: 12 });
    const credential = { id: passkey.credentialId, publicKey: passkey.publicKey, transports: passkey.transports };
    for (const counter of [0, 3, 12, 13]) {
      const { challenge, response } = assertion(auth, passkey.credentialId, ALL, counter);
      expect((await verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential })).newCounter).toBe(counter);
    }
  });

  test("an assertion without user verification still verifies, and says so", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth, { flags: BARE });
    const { challenge, response } = assertion(auth, passkey.credentialId, BARE, 1);
    const result = await verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential: { id: passkey.credentialId, publicKey: passkey.publicKey, transports: [] } });
    expect(result).toEqual({ newCounter: 1, userVerified: false, backedUp: false, backupEligible: false });
  });

  test("the BE and BS flags are reported as each assertion carries them, whatever the registration said", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth, { flags: { up: true, uv: true, be: false, bs: false } });
    const credential = { id: passkey.credentialId, publicKey: passkey.publicKey, transports: passkey.transports };
    for (const [flags, expected] of [
      [{ up: true, uv: true, be: false, bs: false }, { backupEligible: false, backedUp: false }],
      [{ up: true, uv: true, be: true, bs: false }, { backupEligible: true, backedUp: false }],
      [{ up: true, uv: true, be: true, bs: true }, { backupEligible: true, backedUp: true }],
    ] as const) {
      const { challenge, response } = assertion(auth, passkey.credentialId, flags, 1);
      expect(await verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential })).toMatchObject(expected);
    }
    // BS without BE is impossible, and the library refuses it.
    const { challenge, response } = assertion(auth, passkey.credentialId, { up: true, uv: true, be: false, bs: true }, 1);
    await expectInvalid(verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential }));
  });

  test("an assertion without user presence is refused", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth);
    const { challenge, response } = assertion(auth, passkey.credentialId, { up: false, uv: true, be: true, bs: true }, 1);
    await expectInvalid(verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential: { id: passkey.credentialId, publicKey: passkey.publicKey, transports: [] } }));
  });

  test("a signature by another passkey's key is refused", async () => {
    const auth = new SoftAuthenticator();
    const mine = await registered(auth);
    const theirs = await registered(auth);
    const { challenge, response } = assertion(auth, theirs.passkey.credentialId, ALL, 1);
    await expectInvalid(verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential: { id: mine.passkey.credentialId, publicKey: mine.passkey.publicKey, transports: [] } }));
  });

  test("authenticator data changed after signing is refused", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth);
    const { challenge, response } = assertion(auth, passkey.credentialId, ALL, 1);
    const authData = Buffer.from(response.response.authenticatorData, "base64url");
    // The last byte of the counter: 1 becomes 2.
    authData[36] = 2;
    const tampered = { ...response, response: { ...response.response, authenticatorData: authData.toString("base64url") } };
    await expectInvalid(verifyAuthentication({ response: tampered, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential: { id: passkey.credentialId, publicKey: passkey.publicKey, transports: [] } }));
  });

  test("a wrong origin, a wrong RP ID and a wrong challenge are passkey_invalid", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth);
    const credential = { id: passkey.credentialId, publicKey: passkey.publicKey, transports: passkey.transports };
    const wrongOrigin = assertion(auth, passkey.credentialId, ALL, 1, { origin: "https://korbat.example.net" });
    await expectInvalid(verifyAuthentication({ response: wrongOrigin.response, expectedChallenge: wrongOrigin.challenge, origins: ORIGINS, rpId: RP_ID, credential }));
    const wrongRp = assertion(auth, passkey.credentialId, ALL, 1, { rpId: "example.net" });
    await expectInvalid(verifyAuthentication({ response: wrongRp.response, expectedChallenge: wrongRp.challenge, origins: ORIGINS, rpId: RP_ID, credential }));
    const { response } = assertion(auth, passkey.credentialId, ALL, 1);
    await expectInvalid(verifyAuthentication({ response, expectedChallenge: issueChallenge(KEY, "reauth", NOW, HANDLE), origins: ORIGINS, rpId: RP_ID, credential }));
  });

  test("a stored key that is not a COSE key is passkey_invalid", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth);
    const { challenge, response } = assertion(auth, passkey.credentialId, ALL, 1);
    await expectInvalid(verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential: { id: passkey.credentialId, publicKey: "AAAA", transports: [] } }));
  });
});

describe("the counter rule", () => {
  test("a counter that does not move past the stored one is a regression, unless both are 0", () => {
    expect(isCounterRegression(0, 0)).toBe(false);
    expect(isCounterRegression(5, 5)).toBe(true);
    expect(isCounterRegression(5, 6)).toBe(false);
    expect(isCounterRegression(5, 4)).toBe(true);
    expect(isCounterRegression(5, 0)).toBe(true);
    expect(isCounterRegression(0, 1)).toBe(false);
  });
});

describe("the response's challenge", () => {
  test("is read from the client data, then checked and spent before the library runs", async () => {
    const auth = new SoftAuthenticator();
    const kv = new MemoryKv(() => NOW.getTime());
    const challenge = issueChallenge(KEY, "register", NOW, HANDLE);
    const options = await registrationOptions({ rp: { id: RP_ID, name: RP_NAME }, user: { id: USER_HANDLE, name: "ada", displayName: "ada" }, exclude: [], challenge });
    const response = auth.create({ rpId: options.rp.id!, challenge: options.challenge, origin: ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags: ALL });
    const read = readResponseChallenge(response);
    expect(read).toBe(challenge);
    readChallenge(KEY, read, "register", NOW, HANDLE);
    await spendChallenge(kv, read, NOW);
    const passkey = await verifyRegistration({ response, expectedChallenge: read, origins: ORIGINS, rpId: RP_ID });
    // The same response again: its challenge is spent.
    expect((await failure(spendChallenge(kv, readResponseChallenge(response), NOW))).code).toBe("passkey_invalid");

    const signin = issueChallenge(KEY, "signin", NOW);
    const signinOptions = await authenticationOptions({ rpId: RP_ID, allow: [], challenge: signin });
    const assertionResponse = auth.get({ credentialId: passkey.credentialId, rpId: RP_ID, challenge: signinOptions.challenge, origin: ORIGIN, flags: ALL, counter: 1 });
    expect(readResponseChallenge(assertionResponse)).toBe(signin);
  });

  test("client data that is not JSON, names no string challenge, or is oversized is passkey_invalid", () => {
    const challenge = issueChallenge(KEY, "signin", NOW);
    const encoded = (text: string) => Buffer.from(text).toString("base64url");
    const json = (value: unknown) => encoded(JSON.stringify(value));
    const cases = [
      encoded("not json"),
      json(null),
      json("a string"),
      json([challenge]),
      json({ type: "webauthn.get", origin: ORIGIN }),
      json({ type: "webauthn.get", challenge: 42, origin: ORIGIN }),
      json({ type: "webauthn.get", challenge: "A".repeat(129), origin: ORIGIN }),
      json({ type: "webauthn.get", challenge, origin: ORIGIN, padding: "x".repeat(3000) }),
      "",
    ];
    for (const clientDataJSON of cases) {
      const err = refusal(() => readResponseChallenge({ response: { clientDataJSON } }));
      expect([err.code, err.status]).toEqual(["passkey_invalid", 401]);
    }
    expect(readResponseChallenge({ response: { clientDataJSON: json({ type: "webauthn.get", challenge, origin: ORIGIN }) } })).toBe(challenge);
  });
});

describe("the library boundary", () => {
  test("webauthn.ts is the only source file that imports @simplewebauthn/server", () => {
    const root = fileURLToPath(new URL("../../src", import.meta.url));
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return entry.name.endsWith(".ts") ? [full] : [];
      });
    const importers = walk(root)
      .filter((file) => /["']@simplewebauthn\/server(\/[^"']*)?["']/.test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file).split(sep).join("/"));
    expect(importers).toEqual(["auth/passkeys/webauthn.ts"]);
  });
});
```

### Replace `apps/api/test/cli-staff.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { STAFF_USAGE, enrollSettings, parseStaffArgs, runStaffCommand, staffDatabaseUrls } from "../src/cli/staff";

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
    // enroll runs as the migrator, in the migrate service; the usage says where.
    expect(STAFF_USAGE).toMatch(/run --rm migrate node dist\/staff\.js enroll/);
    // revoke arrives with the task that builds it.
    expect(STAFF_USAGE).not.toMatch(/revoke/);
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
    expect(() => parseStaffArgs(["revoke", "a@b.io", "all"])).toThrow("unknown command: revoke");
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
```

### Replace `apps/api/test/integration/auth-flows-account.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { authEvents, closeDb, createDb, type Db } from "@korbat/db";
import { grantRole } from "../../src/auth/admin";
import { encrypt, randomToken } from "../../src/auth/crypto";
import { listSessions, me, revokeAllSessions, revokeSession, signOut } from "../../src/auth/flows/account";
import { startEmail } from "../../src/auth/flows/email";
import { notMe } from "../../src/auth/flows/not-me";
import { reauthenticate, startReauthEmail } from "../../src/auth/flows/reauth";
import { notMeKey, type NotMeToken } from "../../src/auth/flows/signin";
import { emailHash } from "../../src/auth/identifiers";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { hashRecoveryCode, newRecoveryCodes } from "../../src/auth/recovery-codes";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { REAUTH_WINDOW_MS, type Session } from "../../src/auth/sessions";
import { newTotpSecret } from "../../src/auth/totp";
import { loadConfig } from "../../src/config";
import { currentTotpCode, flowHarness, newTestDevice, newTestEmail, onboardedUser, wrongCode, type FlowHarness } from "./flow-harness";

const PASSWORD = "correct horse battery staple";
const LINK_GONE = "This link has expired or was already used.";

describe.skipIf(!process.env.INTEGRATION)("integration: re-authentication, account and session flows", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  /** Turns TOTP on for an account as the confirm step leaves it, with recovery codes, and answers the codes in the clear. */
  async function enableTotp(h: FlowHarness, userId: string): Promise<string[]> {
    const codes = newRecoveryCodes();
    await repo.enableTotp(userId, {
      secretEnc: encrypt(Buffer.from(newTotpSecret()), h.deps.config.totpKey),
      recoveryCodesHash: codes.map((code) => hashRecoveryCode(h.deps.config.authHmacKey, code)),
      now: h.clock.now(),
    });
    await h.deps.sessions.forgetUser(userId);
    return codes;
  }

  /** The account's events oldest first, with the metadata the flows wrote. */
  const eventsOf = (userId: string) =>
    db
      .select({ type: authEvents.type, deviceId: authEvents.deviceId, ipHash: authEvents.ipHash, metadata: authEvents.metadata })
      .from(authEvents)
      .where(eq(authEvents.userId, userId))
      .orderBy(authEvents.id);

  test("re-authenticating with the password or a TOTP code writes the factor, rotates the token and answers the level reached; wrong credentials do not", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    await enableTotp(h, account.user.id);
    let token = account.token;
    const current = async () => (await h.deps.sessions.resolve(token))!.session;
    const stale = async () => {
      h.clock.advance(REAUTH_WINDOW_MS + 1_000);
      const session = await current();
      expect(h.deps.sessions.isFresh(session)).toBe(false);
      return session;
    };

    let session = await stale();
    await expect(reauthenticate(h.deps, session, { method: "password", password: "wrong password entirely" }, h.ctx)).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(h.deps.sessions.isFresh(await current())).toBe(false);
    const byPassword = await reauthenticate(h.deps, session, { method: "password", password: PASSWORD }, h.ctx);
    expect(byPassword).toMatchObject({ level: 1, mustReenrollMfa: false });
    // The factor is written with the flows' clock, the reauth time follows it, and the token rotates in place: same handle, same device.
    expect(byPassword.issued.session).toMatchObject({ handle: session.handle, deviceId: session.deviceId, factors: { ...session.factors, password: h.clock.ms() }, reauthAt: h.clock.now() });
    expect(await h.deps.sessions.resolve(token)).toBeNull();
    token = byPassword.issued.token;
    expect(h.deps.sessions.isFresh(await current())).toBe(true);

    session = await current();
    const code = await currentTotpCode(h, repo, account.user.id);
    await expect(reauthenticate(h.deps, session, { method: "totp", code: wrongCode(code) }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });
    const byTotp = await reauthenticate(h.deps, session, { method: "totp", code }, h.ctx);
    // With the password still in the window, the code makes level 2.
    expect(byTotp).toMatchObject({ level: 2, mustReenrollMfa: false });
    expect(byTotp.issued.session.factors).toEqual({ ...session.factors, totp: h.clock.ms() });
    expect(await h.deps.sessions.resolve(token)).toBeNull();
    token = byTotp.issued.token;

    // Five minutes later a code alone is level 1 again: the first factor must be as recent as the second.
    session = await stale();
    const alone = await reauthenticate(h.deps, session, { method: "totp", code: await currentTotpCode(h, repo, account.user.id) }, h.ctx);
    expect(alone.level).toBe(1);
    expect(h.deps.sessions.level((await h.deps.sessions.resolve(alone.issued.token))!.session)).toBe(1);
  });

  test("re-authenticating by email accepts only a re-auth code for this account, once, and sends three codes an hour per session", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const other = await onboardedUser(h, repo);
    h.clock.advance(REAUTH_WINDOW_MS + 1_000);
    const session = (await h.deps.sessions.resolve(account.token))!.session;

    const { flowId } = await startReauthEmail(h.deps, session, h.ctx);
    const reauthMail = h.mailer.sent.at(-1)!;
    expect(reauthMail).toMatchObject({ to: account.email, template: "reauth_code" });
    const reauthCode = reauthMail.data.code!;

    const otherSession = (await h.deps.sessions.resolve(other.token))!.session;
    const otherFlow = await startReauthEmail(h.deps, otherSession, h.ctx);
    await expect(reauthenticate(h.deps, session, { method: "email", flowId: otherFlow.flowId, code: h.mailer.lastCodeFor(other.email)! }, h.ctx)).rejects.toMatchObject({
      code: "invalid_code",
    });

    const signInFlow = await startEmail(h.deps, { email: account.email, turnstileToken: "ok", ...newTestDevice() }, h.ctx);
    await expect(reauthenticate(h.deps, session, { method: "email", flowId: signInFlow.flowId, code: h.mailer.lastCodeFor(account.email)! }, h.ctx)).rejects.toMatchObject({
      code: "invalid_code",
    });

    const byEmail = await reauthenticate(h.deps, session, { method: "email", flowId, code: reauthCode }, h.ctx);
    expect(byEmail).toMatchObject({ level: 1, mustReenrollMfa: false });
    expect(byEmail.issued.session).toMatchObject({ handle: session.handle, factors: { email: h.clock.ms() } });
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(h.deps.sessions.isFresh((await h.deps.sessions.resolve(byEmail.issued.token))!.session)).toBe(true);
    await expect(reauthenticate(h.deps, byEmail.issued.session, { method: "email", flowId, code: reauthCode }, h.ctx)).rejects.toMatchObject({ code: "invalid_code" });

    // Three codes an hour, counted by the session's handle, which the rotation kept; another session of the account has three of its own.
    for (let i = 0; i < 2; i++) await startReauthEmail(h.deps, byEmail.issued.session, h.ctx);
    await expect(startReauthEmail(h.deps, byEmail.issued.session, h.ctx)).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: HOUR / 1000 });
    const second = await h.deps.sessions.issue(account.user.id, session.deviceId, { factors: { email: h.clock.ms() } });
    expect((await startReauthEmail(h.deps, second.session, h.ctx)).flowId).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("re-authentication allows five tries per session every 15 minutes, counted by the handle so two sessions of one account share nothing and a rotation resets nothing", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const wrong = (session: Session) => reauthenticate(h.deps, session, { method: "email", flowId: randomToken(), code: "000000" }, h.ctx);
    for (let i = 0; i < 5; i++) await expect(wrong(account.session)).rejects.toMatchObject({ code: "invalid_code" });
    await expect(reauthenticate(h.deps, account.session, { method: "password", password: PASSWORD }, h.ctx)).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: (15 * MINUTE) / 1000 });

    const second = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const ok = await reauthenticate(h.deps, second.session, { method: "password", password: PASSWORD }, h.ctx);
    expect(ok.level).toBe(1);
    // The success counted as one of the five, and the rotated session carries the count on: four more tries, then the limit.
    for (let i = 0; i < 4; i++) await expect(wrong(ok.issued.session)).rejects.toMatchObject({ code: "invalid_code" });
    await expect(wrong(ok.issued.session)).rejects.toMatchObject({ code: "rate_limited" });
  });

  test("re-authentication allows thirty tries per address every 15 minutes, whichever sessions try", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const ctx = { ...h.ctx, ipHash: randomToken() };
    const newSession = async () => (await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } })).session;
    const wrong = (session: Session) => reauthenticate(h.deps, session, { method: "email", flowId: randomToken(), code: "000000" }, ctx);
    // Six sessions, five tries each: none reaches its own limit, together they reach the address's.
    for (let s = 0; s < 6; s++) {
      const session = await newSession();
      for (let i = 0; i < 5; i++) await expect(wrong(session)).rejects.toMatchObject({ code: "invalid_code" });
    }
    await expect(wrong(await newSession())).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: (15 * MINUTE) / 1000 });
    // Another address is not affected.
    await expect(reauthenticate(h.deps, await newSession(), { method: "email", flowId: randomToken(), code: "000000" }, h.ctx)).rejects.toMatchObject({ code: "invalid_code" });
  });

  test("a recovery code re-authenticates an account with TOTP once, makes level 2 after a password, and is recorded and announced", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const without = await onboardedUser(h, repo, { password: PASSWORD });
    await expect(reauthenticate(h.deps, without.session, { method: "recovery", recoveryCode: "abcd-ef23-gh45" }, h.ctx)).rejects.toMatchObject({ code: "mfa_required", status: 400 });

    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const codes = await enableTotp(h, account.user.id);
    h.clock.advance(REAUTH_WINDOW_MS + 1_000);
    const session = (await h.deps.sessions.resolve(account.token))!.session;
    // A wrong code is refused, recorded as a failed sign-in by recovery code, and rotates nothing.
    await expect(reauthenticate(h.deps, session, { method: "recovery", recoveryCode: "abcd-ef23-gh45" }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code", status: 401 });
    expect(await h.deps.sessions.resolve(account.token)).not.toBeNull();

    const byPassword = await reauthenticate(h.deps, session, { method: "password", password: PASSWORD }, h.ctx);
    expect(byPassword.level).toBe(1);
    const byCode = await reauthenticate(h.deps, byPassword.issued.session, { method: "recovery", recoveryCode: codes[0]! }, h.ctx);
    expect(byCode).toMatchObject({ level: 2, mustReenrollMfa: true });
    expect(byCode.issued.session).toMatchObject({ handle: session.handle, factors: { ...byPassword.issued.session.factors, recovery: h.clock.ms() } });
    expect(await h.deps.sessions.resolve(byPassword.issued.token)).toBeNull();
    expect(h.deps.sessions.level((await h.deps.sessions.resolve(byCode.issued.token))!.session)).toBe(2);
    // The code is spent.
    expect((await repo.findUserById(account.user.id))!.recoveryCodesHash).toHaveLength(9);
    await expect(reauthenticate(h.deps, byCode.issued.session, { method: "recovery", recoveryCode: codes[0]! }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });

    const events = await eventsOf(account.user.id);
    expect(events.filter((e) => e.type === "signin_failure").map((e) => [e.ipHash, e.metadata])).toEqual([
      [h.ctx.ipHash, { method: "recovery_code" }],
      [h.ctx.ipHash, { method: "recovery_code" }],
    ]);
    expect(events.filter((e) => e.type === "recovery_code_used").map((e) => [e.deviceId, e.ipHash])).toEqual([[account.session.deviceId, h.ctx.ipHash]]);
    expect(h.mailer.sent.filter((m) => m.template === "recovery_code_used").map((m) => m.to)).toEqual([account.email]);
  });

  test("me describes the signed-in account and its profile", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    await h.deps.profiles.create({ id: account.user.id, handle: "me_test", displayName: "Me Test" });
    expect(await me(h.deps, account.session)).toEqual({
      user: { id: account.user.id, email: account.email, role: "user", onboarded: true, mfaEnabled: false, hasPassword: true, passkeys: 0 },
      profile: { id: account.user.id, handle: "me_test", displayName: "Me Test", handleChangedAt: null, verified: false, showInExplore: true },
    });
  });

  test("sessions can be listed, revoked one at a time, signed out, and revoked all at once", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const second = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const third = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });

    // Each session is listed under its handle, the id a rotation keeps; the hash of a token is never listed.
    const { sessions } = await listSessions(h.deps, account.session);
    expect(sessions.map((s) => s.id).sort()).toEqual([account.session.handle, second.session.handle, third.session.handle].sort());
    expect(sessions.filter((s) => s.current).map((s) => s.id)).toEqual([account.session.handle]);

    // The listed session re-authenticates before the revoke lands, so its token rotates: the listed id still names it.
    const rotated = await reauthenticate(h.deps, second.session, { method: "password", password: PASSWORD }, h.ctx);
    expect(await h.deps.sessions.resolve(second.token)).toBeNull();
    expect(await h.deps.sessions.resolve(rotated.issued.token)).not.toBeNull();
    expect(await revokeSession(h.deps, account.session, second.session.handle)).toBe(true);
    expect(await h.deps.sessions.resolve(rotated.issued.token)).toBeNull();
    expect(await revokeSession(h.deps, account.session, second.session.handle)).toBe(false);
    expect(await revokeSession(h.deps, account.session, randomUUID())).toBe(false);
    // Another account's session is not this one's to revoke.
    const stranger = await onboardedUser(h, repo);
    expect(await revokeSession(h.deps, account.session, stranger.session.handle)).toBe(false);
    expect(await h.deps.sessions.resolve(stranger.token)).not.toBeNull();
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "session_revoked")).toEqual([
      { type: "session_revoked", deviceId: account.session.deviceId, ipHash: null, metadata: { handle: second.session.handle } },
    ]);

    // Signing out after a rotation ends the session under its new token.
    const thirdRotated = await h.deps.sessions.rotate(third.session);
    await signOut(h.deps, thirdRotated.session);
    expect(await h.deps.sessions.resolve(thirdRotated.token)).toBeNull();

    const fourth = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    expect(await revokeAllSessions(h.deps, account.session)).toBe(2);
    expect(h.mailer.sent.filter((m) => m.template === "sessions_revoked_all").map((m) => m.data.count)).toEqual(["2"]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(fourth.token)).toBeNull();
    expect((await repo.recentEvents(account.user.id)).map((e) => e.type)).toEqual(expect.arrayContaining(["session_revoked", "sessions_revoked_all"]));
  });

  test("'This wasn't me' locks the account down (every session and device, the password) once, and only for the address it was sent to", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const other = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const link = async (stored: NotMeToken) => {
      const token = randomToken();
      await h.kv.set(notMeKey(token), JSON.stringify(stored), 60_000);
      return token;
    };
    const key = h.deps.config.authHmacKey;
    const token = await link({ userId: account.user.id, deviceId: account.session.deviceId, signedInAt: h.clock.ms(), passkeyId: null, sentTo: emailHash(key, account.email) });

    await notMe(h.deps, { token }, h.ctx);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(other.token)).toBeNull();
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    expect((await repo.findUserById(account.user.id))!.passwordHash).toBeNull();
    const events = await eventsOf(account.user.id);
    expect(events.filter((e) => e.type === "not_me").map((e) => [e.deviceId, e.ipHash, e.metadata])).toEqual([
      [account.session.deviceId, h.ctx.ipHash, { passkeysRemoved: [], totpCleared: false, passwordCleared: true }],
    ]);
    await expect(notMe(h.deps, { token }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", message: LINK_GONE });

    // A link sent to an address the account has since left does nothing but refuse, and is not spent by the refusal.
    const moved = await onboardedUser(h, repo, { password: PASSWORD });
    const stale = await link({ userId: moved.user.id, deviceId: moved.session.deviceId, signedInAt: h.clock.ms(), passkeyId: null, sentTo: emailHash(key, moved.email) });
    await repo.changeEmail(moved.user.id, newTestEmail("moved"), h.clock.now());
    for (let i = 0; i < 2; i++) await expect(notMe(h.deps, { token: stale }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(await h.deps.sessions.resolve(moved.token)).not.toBeNull();
    expect((await repo.findUserById(moved.user.id))!.passwordHash).not.toBeNull();
    expect((await repo.recentEvents(moved.user.id)).map((e) => e.type)).not.toContain("not_me");
    // Once the account is back at the address the alert went to, as the email undo puts it, the link works, once.
    await repo.changeEmail(moved.user.id, moved.email, h.clock.now());
    await notMe(h.deps, { token: stale }, h.ctx);
    expect(await h.deps.sessions.resolve(moved.token)).toBeNull();
    expect((await repo.findUserById(moved.user.id))!.passwordHash).toBeNull();
    expect((await repo.recentEvents(moved.user.id)).map((e) => e.type).filter((type) => type === "not_me")).toHaveLength(1);
    await expect(notMe(h.deps, { token: stale }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", message: LINK_GONE });
  });

  test("granting a role signs the account out everywhere so the new role applies at once", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    // The account held no staff session, link or key, so the change ends none and mails nothing (3a design, section 7).
    expect(await grantRole(h.deps, account.email.toUpperCase(), "moderator")).toEqual({
      userId: account.user.id,
      previousRole: "user",
      staffSessionsRevoked: 0,
      enrollmentsDeleted: 0,
      staffKeysRevoked: 0,
      mailError: null,
    });
    expect(h.mailer.sent).toEqual([]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    const again = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    expect(again.session).toMatchObject({ role: "moderator", mfaEnabled: false });
    await expect(grantRole(h.deps, "nobody-at-all@korbat.local", "admin")).rejects.toThrow(/no account/);
  });
});
```

### Replace `apps/api/test/integration/cli-grant-role.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { auditHead, auditLog, closeDb, createDb, type Db } from "@korbat/db";
import { createAuthRepo, createSessions } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { SYSTEM_ACTOR_ID, runGrantRole } from "../../src/cli/grant-role";
import { loadConfig } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { newUserWithDevice } from "./auth-fixtures";

describe.skipIf(!process.env.INTEGRATION)("integration: grant-role CLI", () => {
  let authDb: Db;
  let apiDb: Db;

  beforeAll(() => {
    const config = loadConfig();
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    // Only for reading the record back: grant-role itself no longer opens the API's pool.
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  const readHead = async () => (await apiDb.select().from(auditHead))[0]!;

  test("grants a staff role, revokes every session and writes an audit entry", async () => {
    const repo = createAuthRepo(authDb);
    const kv = new MemoryKv();
    const sessions = createSessions({ repo, kv });
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id, { factors: { email: Date.now() } });
    expect(await sessions.resolve(issued.token)).not.toBeNull();

    const result = await runGrantRole({ authDb, kv, mailer: new MemoryMailer() }, user.email, "moderator");

    // An account without staff rows: nothing of the console to end, and no staff mail.
    expect(result).toEqual({ userId: user.id, previousRole: "user", staffSessionsRevoked: 0, enrollmentsDeleted: 0, staffKeysRevoked: 0, mailError: null });
    expect((await repo.findUserById(user.id))!.role).toBe("moderator");
    expect(await sessions.resolve(issued.token)).toBeNull();
    const entries = await apiDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.targetId, user.id), eq(auditLog.action, "role_granted")));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorId: SYSTEM_ACTOR_ID, targetType: "user", metadata: { from: "user", to: "moderator", via: "cli", staffSessionsRevoked: 0, enrollmentsDeleted: 0 }, chainVersion: 1 });
    expect(await readHead()).toMatchObject({ seq: entries[0]!.chainSeq, hash: entries[0]!.hash });
  });

  test("the role change, the sessions it revokes and its audit row are one transaction", async () => {
    const repo = createAuthRepo(authDb);
    const kv = new MemoryKv();
    const sessions = createSessions({ repo, kv });
    const { user, device } = await newUserWithDevice(repo);
    await sessions.issue(user.id, device.id, { factors: { email: Date.now() } });

    await runGrantRole({ authDb, kv, mailer: new MemoryMailer() }, user.email, "admin");

    // Every row a transaction writes carries its transaction id in xmin: one id means one transaction, which committed
    // the role, the revocation and the row together or not at all.
    const [account] = await authDb.execute<{ xmin: string }>(sql`select xmin::text as xmin from auth.users where id = ${user.id}`);
    const revoked = await authDb.execute<{ xmin: string }>(sql`select xmin::text as xmin from auth.sessions where user_id = ${user.id}`);
    const [row] = await apiDb.execute<{ xmin: string }>(
      sql`select xmin::text as xmin from public.audit_log where target_id = ${user.id} and action = 'role_granted'`,
    );
    expect(revoked.length).toBe(1);
    expect(revoked[0]!.xmin).toBe(account!.xmin);
    expect(row!.xmin).toBe(account!.xmin);
  });

  test("an unknown email fails without writing an audit entry", async () => {
    const before = await apiDb.$count(auditLog);
    await expect(runGrantRole({ authDb, kv: new MemoryKv(), mailer: new MemoryMailer() }, `nobody-${randomUUID()}@korbat.local`, "admin")).rejects.toThrow("no account for");
    expect(await apiDb.$count(auditLog)).toBe(before);
  });

  test("while an open transaction holds the audit head, it gives up after 10 seconds having changed nothing, and says why", { timeout: 30_000 }, async () => {
    const repo = createAuthRepo(authDb);
    const kv = new MemoryKv();
    const sessions = createSessions({ repo, kv });
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id, { factors: { email: Date.now() } });
    const head = await readHead();

    // What a stalled or hostile API could do: an audit insert whose transaction stays open holds the head until it ends.
    const holder = createDb(loadConfig().DATABASE_URL_API, { max: 1 });
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let holding!: () => void;
    const held = new Promise<void>((resolve) => (holding = resolve));
    const stall = holder
      .transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '10s'`);
        await tx.insert(auditLog).values({ actorId: SYSTEM_ACTOR_ID, action: "probe_stall" });
        holding();
        await released;
        throw new Error("rolled back on purpose");
      })
      .catch(() => undefined);
    try {
      await held;
      const started = Date.now();
      await expect(runGrantRole({ authDb, kv, mailer: new MemoryMailer() }, user.email, "moderator")).rejects.toThrow(
        /changed nothing: an open transaction holds the audit head or the account's row.*stop the api service/s,
      );
      expect(Date.now() - started).toBeGreaterThanOrEqual(9_000);
    } finally {
      release();
      await stall;
      await closeDb(holder);
    }
    expect((await repo.findUserById(user.id))!.role).toBe("user");
    expect(await sessions.resolve(issued.token)).not.toBeNull();
    expect(await readHead()).toEqual(head);
  });
});
```

### Replace `apps/api/test/integration/flow-harness.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import type { MeProfile } from "@korbat/contracts";
import pino from "pino";
import type { AuthConfig, AuthDeps, ProfileStore, RequestContext } from "../../src/auth/context";
import { decrypt, parseVersionedKey, randomToken } from "../../src/auth/crypto";
import { signIn } from "../../src/auth/flows/signin";
import { MemoryKv } from "../../src/auth/kv";
import { createLockout } from "../../src/auth/lockout";
import { hashPassword } from "../../src/auth/passwords";
import type { AuthRepo } from "../../src/auth/repo";
import { createSessions } from "../../src/auth/sessions";
import { currentStep, hotp } from "../../src/auth/totp";
import { devProvider } from "../../src/auth/verify/dev";
import { MemoryMailer } from "../../src/mail/memory";
import { fakeClock } from "./auth-fixtures";

/**
 * Handles unique per store, like the real public.profiles index. A new profile has never changed its handle, holds no
 * badge and shows its posts in Explore, as the column's default has it.
 */
export function memoryProfiles(): ProfileStore {
  const byHandle = new Map<string, MeProfile>();
  const byId = new Map<string, MeProfile>();
  return {
    async create({ id, handle, displayName }) {
      if (byHandle.has(handle) || byId.has(id)) return { ok: false, reason: "handle_taken" };
      const profile = { id, handle, displayName, handleChangedAt: null, verified: false, showInExplore: true };
      byHandle.set(handle, profile);
      byId.set(id, profile);
      return { ok: true, profile: { id, handle, displayName } };
    },
    async find(id) {
      return byId.get(id) ?? null;
    },
    async setVerified(id, at) {
      const profile = byId.get(id);
      if (profile) profile.verified = at !== null;
    },
  };
}

export const TEST_TERMS = "draft-test";
export const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

/**
 * Real auth repository (Postgres) with an in-memory key-value store, mailer and profile store, a fake
 * clock shared by all of them, Turnstile that fails only for the token "fail", and a breach checker
 * that flags passwords containing "breached". A suite whose profiles live in the public schema (the
 * deletion flow compares the typed handle with the profile's) passes the real profile store instead. The staff
 * console is off unless a suite names its origin and relying party ID, as the staff suites do (3a design, section 12).
 */
export function flowHarness(repo: AuthRepo, options: { profiles?: ProfileStore; console?: { origin: string; rpId: string } } = {}) {
  const clock = fakeClock();
  const kv = new MemoryKv(clock.ms);
  const mailer = new MemoryMailer();
  const config: AuthConfig = {
    appOrigin: "http://localhost:8081",
    allowedOrigins: ["http://localhost:8081"],
    authHmacKey: Buffer.alloc(32, 3),
    ipHashKey: Buffer.alloc(32, 4),
    totpKey: parseVersionedKey(`v1:${Buffer.alloc(32, 5).toString("base64")}`),
    totpPreviousKeys: [],
    termsVersion: TEST_TERMS,
    trustProxy: "none",
    verifyProvider: "dev",
    webauthn: { rpId: "localhost", rpName: "korbat", origins: ["http://localhost:8081"] },
    console: options.console ?? null,
  };
  const deps: AuthDeps = {
    repo,
    kv,
    mailer,
    config,
    now: clock.now,
    sessions: createSessions({ repo, kv, now: clock.now }),
    lockout: createLockout({ repo, kv, now: clock.now }),
    turnstile: { verify: async (token) => token !== "fail" },
    breachChecker: { isBreached: async (password) => password.includes("breached") },
    profiles: options.profiles ?? memoryProfiles(),
    verify: devProvider(),
    log: pino({ level: "silent" }),
  };
  const ctx: RequestContext = { ipHash: randomToken(), userAgent: CHROME_WINDOWS };
  return { deps, clock, kv, mailer, ctx };
}

export type FlowHarness = ReturnType<typeof flowHarness>;

export const newTestEmail = (prefix = "flow") => `${prefix}-${randomUUID()}@korbat.local`;
export const newTestDevice = () => ({ deviceId: randomToken(), platform: "web" as const });
export const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

/** An onboarded account, optionally with a password, signed in on one web device. */
export async function onboardedUser(h: FlowHarness, repo: AuthRepo, options: { password?: string } = {}) {
  const email = newTestEmail("account");
  const created = await repo.createUser({ email, termsVersion: TEST_TERMS, now: new Date() });
  await repo.markOnboarded(created.id, new Date());
  if (options.password) await repo.setPasswordHash(created.id, await hashPassword(options.password), new Date());
  const user = (await repo.findUserById(created.id))!;
  const device = newTestDevice();
  const signed = await signIn(h.deps, user, device, h.ctx, { alertNewDevice: false, factors: { email: h.clock.ms() }, method: "email" });
  return { email, user, device, session: signed.issued.session, token: signed.issued.token };
}

export type OnboardedUser = Awaited<ReturnType<typeof onboardedUser>>;

/** The TOTP code for a user's stored secret at the harness clock. */
export async function currentTotpCode(h: FlowHarness, repo: AuthRepo, userId: string): Promise<string> {
  const user = (await repo.findUserById(userId))!;
  const secret = new Uint8Array(decrypt(user.totpSecretEnc!, [h.deps.config.totpKey]));
  return hotp(secret, currentStep(h.clock.ms()));
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
 * A staff session row as Task 4's session store will write it, opened with the account's own key for 12 hours and idle
 * after 15 minutes. Inserted as the auth role, which the running API holds and which may create staff sessions.
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

### Replace `apps/api/test/mail/templates.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { MemoryMailer } from "../../src/mail/memory";
import { renderTemplate } from "../../src/mail/templates";

describe("mail templates", () => {
  test("code emails carry the code and expiry, and no links or images", () => {
    const r = renderTemplate("sign_in_code", { code: "123456" });
    expect(r.subject).toBe("Your korbat sign-in code");
    expect(r.text).toContain("123456");
    expect(r.text).toContain("10 minutes");
    expect(r.html).toContain("123456");
    expect(r.html).not.toMatch(/<img|<a |https?:\/\//);
  });
  test("every template renders and HTML escapes its data", () => {
    const data = {
      code: "123456",
      deviceLabel: "<b>Chrome</b> on Windows",
      notMeUrl: "http://localhost:8081/not-me/abc",
      revertUrl: "http://localhost:8081/email-revert/def",
      minutes: "15",
      count: "3",
      email: "new<address>@example.com",
      name: "<i>Work</i> laptop",
      time: "2026-09-25 10:00 UTC",
      removeUrl: "http://localhost:8081/passkey-remove/ghi",
      browser: "Firefox on Linux",
      names: '"Blue key", "Red key"',
    };
    for (const template of [
      "sign_in_code",
      "sign_up_code",
      "reauth_code",
      "new_device",
      "account_locked",
      "mfa_enabled",
      "mfa_disabled",
      "password_changed",
      "recovery_codes_regenerated",
      "sessions_revoked_all",
      "email_change_code",
      "email_changed",
      "email_change_reverted",
      "badge_verified",
      "badge_removed",
      "delete_account_code",
      "account_deleted",
      "passkey_added",
      "passkey_removed",
      "passkey_suspect",
      "recovery_code_used",
      "staff_key_added",
      "staff_session_started",
      "staff_key_suspect",
      "staff_keys_revoked",
    ] as const) {
      const r = renderTemplate(template, data);
      expect(r.subject.length, template).toBeGreaterThan(5);
      expect(r.text.length, template).toBeGreaterThan(20);
      // Links stay plain text (new_device carries the not-me URL that way); nothing is ever an anchor or an image.
      expect(r.html, template).not.toMatch(/<img|<a /);
    }
    const newDevice = renderTemplate("new_device", data);
    expect(newDevice.html).toContain("&lt;b&gt;Chrome&lt;/b&gt;");
    expect(newDevice.text).toContain("http://localhost:8081/not-me/abc");
    const emailChanged = renderTemplate("email_changed", data);
    expect(emailChanged.html).toContain("new&lt;address&gt;@example.com");
    expect(emailChanged.text).toContain("new<address>@example.com");
    expect(emailChanged.text).toContain("http://localhost:8081/email-revert/def");
  });
  test("the mails that carry a lockdown link, and the note after one ran, say what the lockdown does (1c design, section 7.6)", () => {
    // The link's page says the same before the owner opens it (Task 7); the mail is where they first read it.
    const lockdownWording = (text: string) => {
      expect(text).toMatch(/signs out every session|every session was signed out/);
      expect(text).toMatch(/removes (your|the) password|password was removed/);
      expect(text).toMatch(/passkey/);
      expect(text).toMatch(/two-factor authentication/);
      expect(text).toMatch(/the day before/);
    };
    const newDevice = renderTemplate("new_device", { deviceLabel: "Chrome on Windows", notMeUrl: "http://localhost:8081/not-me/abc" });
    expect(newDevice.text).toContain("Chrome on Windows");
    expect(newDevice.text).toContain("24 hours");
    expect(newDevice.text).toContain("http://localhost:8081/not-me/abc");
    lockdownWording(newDevice.text);
    const changed = renderTemplate("email_changed", { email: "new@example.com", revertUrl: "http://localhost:8081/email-revert/abc" });
    expect(changed.text).toContain("24 hours");
    expect(changed.text).toMatch(/back to this address/);
    expect(changed.text).toContain("http://localhost:8081/email-revert/abc");
    lockdownWording(changed.text);
    const reverted = renderTemplate("email_change_reverted", {});
    expect(reverted.text).toMatch(/back at this address/);
    expect(reverted.text).not.toMatch(/https?:\/\//);
    lockdownWording(reverted.text);
  });
  test("a recovery code spent at re-authentication is announced, without a link", () => {
    const used = renderTemplate("recovery_code_used", {});
    expect(used.subject).toBe("A recovery code was used on your korbat account");
    expect(used.text).toMatch(/recovery code/);
    expect(used.text).toMatch(/once/);
    expect(used.text).toMatch(/If this was not you/);
    expect(used.text).not.toMatch(/https?:\/\//);
  });
  test("the account lifecycle templates say what happened and what to do if it was not the owner", () => {
    const changeCode = renderTemplate("email_change_code", { code: "654321" });
    expect(changeCode.text).toContain("654321");
    expect(changeCode.text).toContain("10 minutes");
    const changed = renderTemplate("email_changed", { email: "new@example.com", revertUrl: "http://localhost:8081/email-revert/abc" });
    expect(changed.text).toContain("new@example.com");
    expect(changed.text).toMatch(/stays? signed in/);
    expect(changed.text).toMatch(/If this was not you, open this link within 24 hours\./);
    expect(changed.text).toMatch(/: http:\/\/localhost:8081\/email-revert\/abc$/m);
    // A change while an earlier change's link is still out sends no link of its own, and says where the one that works went.
    const again = renderTemplate("email_changed", { email: "new@example.com" });
    expect(again.text).toContain("new@example.com");
    expect(again.text).not.toMatch(/https?:\/\//);
    expect(again.text).toMatch(/less than a day ago/);
    const reverted = renderTemplate("email_change_reverted", {});
    expect(reverted.text).toMatch(/back at this address/);
    expect(reverted.text).toMatch(/every session/i);
    const deleteCode = renderTemplate("delete_account_code", { code: "111222" });
    expect(deleteCode.text).toContain("111222");
    expect(deleteCode.text).toMatch(/delete/i);
    expect(deleteCode.text).toMatch(/revoke|sign out/i);
    expect(renderTemplate("account_deleted", {}).text).toMatch(/cannot be undone/);
    expect(renderTemplate("badge_verified", {}).text).toMatch(/verified/i);
    expect(renderTemplate("badge_removed", {}).text).toMatch(/removed/i);
  });
  test("the passkey templates name the passkey, say what happened and what to do, and never let the name become HTML", () => {
    const name = `<img src=x onerror=alert(1)> "Work" laptop`;
    const removeUrl = "http://localhost:8081/passkey-remove/abc";
    const added = renderTemplate("passkey_added", { name, deviceLabel: "Chrome on Windows", time: "2026-09-25 10:00 UTC", removeUrl });
    expect(added.subject).toBe("A passkey was added to your korbat account");
    expect(added.text).toContain(name);
    expect(added.text).toContain("Chrome on Windows");
    expect(added.text).toContain("2026-09-25 10:00 UTC");
    expect(added.text).toContain(removeUrl);
    expect(added.text).toContain("7 days");
    // What the link does (the lockdown of the 1c design, section 7.6), before the owner opens it.
    expect(added.text).toMatch(/removes? (this|the) passkey/);
    expect(added.text).toMatch(/sign(s)? out every session/);
    expect(added.text).toMatch(/password/);
    expect(added.text).toMatch(/two-factor authentication/);
    expect(added.text).toMatch(/the day before/);
    expect(added.html).toContain("&lt;img src=x onerror=alert(1)&gt; &quot;Work&quot; laptop");
    expect(added.html).not.toMatch(/<img|<a /);
    expect(added.html).toContain(removeUrl);

    const removed = renderTemplate("passkey_removed", { name, time: "2026-09-25 11:00 UTC" });
    expect(removed.subject).toBe("A passkey was removed from your korbat account");
    expect(removed.text).toContain(name);
    expect(removed.text).toContain("2026-09-25 11:00 UTC");
    expect(removed.text).not.toMatch(/https?:\/\//);
    expect(removed.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(removed.html).not.toMatch(/<img|<a /);

    const suspect = renderTemplate("passkey_suspect", { name });
    expect(suspect.subject).toBe("A passkey on your korbat account was switched off");
    expect(suspect.text).toContain(name);
    expect(suspect.text).toMatch(/copy/);
    expect(suspect.text).toMatch(/switched (it|that passkey) off/);
    expect(suspect.text).toMatch(/remove it/i);
    expect(suspect.text).toMatch(/add a new one/);
    expect(suspect.text).not.toMatch(/https?:\/\//);
    expect(suspect.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(suspect.html).not.toMatch(/<img|<a /);
  });
  describe("the staff mails (3a design, section 7)", () => {
    const LAST = "korbat never puts a link in a staff email.";
    const name = `<img src=x onerror=alert(1)> "Blue" key`;

    /** Plain paragraphs with no link of any kind, the last one saying so; and a user-written name never becomes HTML. */
    function linkless(template: string, r: { text: string; html: string }) {
      expect(r.text, template).not.toMatch(/https?:|www\.|:\/\//);
      expect(r.html, template).not.toMatch(/<img|<a |href=|https?:/);
      expect(r.text.trimEnd().split("\n\n").at(-1), template).toBe(LAST);
    }

    test("staff_key_added names the key and the time, and tells the person to go to the operator if it was not them", () => {
      const r = renderTemplate("staff_key_added", { name, time: "2026-10-01 09:30 UTC" });
      expect(r.subject).toBe("A staff key was added to your korbat staff account");
      expect(r.text).toBe(
        [
          `A staff key named "${name}" was registered for your korbat staff account at 2026-10-01 09:30 UTC. It can open the staff console.`,
          "If this was you, there is nothing to do. If not, tell the operator at once; they revoke the key with the staff command line.",
          LAST,
        ].join("\n\n") + "\n",
      );
      expect(r.html).toContain("&lt;img src=x onerror=alert(1)&gt; &quot;Blue&quot; key");
      linkless("staff_key_added", r);
    });

    test("staff_session_started names the key, the browser and the time", () => {
      const r = renderTemplate("staff_session_started", { name, browser: "Firefox on Linux", time: "2026-10-01 09:31 UTC" });
      expect(r.subject).toBe("A staff session started on the korbat console");
      expect(r.text).toBe(
        [
          `A staff session was started on the korbat console at 2026-10-01 09:31 UTC with your staff key "${name}", from Firefox on Linux.`,
          "If this was you, there is nothing to do. If not, someone holds that key: tell the operator at once; they revoke it and every session it opened with the staff command line.",
          LAST,
        ].join("\n\n") + "\n",
      );
      linkless("staff_session_started", r);
    });

    test("staff_key_suspect says the key was switched off as a likely copy, and never sends the person to the app's Security screen", () => {
      const r = renderTemplate("staff_key_suspect", { name });
      expect(r.subject).toBe("A staff key on your korbat staff account was switched off");
      expect(r.text).toBe(
        [
          `A use of your staff key "${name}" on the korbat console (a sign-in or a confirmation) looked like a copy of it, so korbat switched that key off and ended every staff session it opened. It can no longer open the console.`,
          "Ask the operator for a link to register a new key. If you did not use it just now, tell them so: someone else holds a copy of the key.",
          LAST,
        ].join("\n\n") + "\n",
      );
      expect(r.text).not.toMatch(/Security/);
      linkless("staff_key_suspect", r);
    });

    test("staff_keys_revoked lists the keys and the time", () => {
      const r = renderTemplate("staff_keys_revoked", { names: `"${name}", "Red key"`, time: "2026-10-01 09:32 UTC" });
      expect(r.subject).toBe("Staff keys revoked on your korbat staff account");
      expect(r.text).toBe(
        [
          `These staff keys of your korbat staff account were revoked at 2026-10-01 09:32 UTC: "${name}", "Red key". They can no longer open the console, and every staff session they opened has ended.`,
          "If you expected this, there is nothing to do. If not, ask the operator why.",
          LAST,
        ].join("\n\n") + "\n",
      );
      linkless("staff_keys_revoked", r);
    });

    test("each staff mail needs its data", () => {
      expect(() => renderTemplate("staff_key_added", { name: "Blue key" })).toThrow(/time/);
      expect(() => renderTemplate("staff_key_added", { time: "2026-10-01 09:30 UTC" })).toThrow(/name/);
      expect(() => renderTemplate("staff_session_started", { name: "Blue key", time: "2026-10-01 09:31 UTC" })).toThrow(/browser/);
      expect(() => renderTemplate("staff_key_suspect", {})).toThrow(/name/);
      expect(() => renderTemplate("staff_keys_revoked", { time: "2026-10-01 09:32 UTC" })).toThrow(/names/);
    });
  });

  test("missing template data is a programming error", () => {
    expect(() => renderTemplate("sign_in_code", {})).toThrow(/code/);
    expect(() => renderTemplate("passkey_added", { name: "Phone", deviceLabel: "Chrome on Windows", time: "2026-09-25 10:00 UTC" })).toThrow(/removeUrl/);
    expect(() => renderTemplate("passkey_added", { deviceLabel: "Chrome on Windows", time: "2026-09-25 10:00 UTC", removeUrl: "http://localhost:8081/passkey-remove/abc" })).toThrow(/name/);
    expect(() => renderTemplate("passkey_removed", { name: "Phone" })).toThrow(/time/);
    expect(() => renderTemplate("passkey_suspect", {})).toThrow(/name/);
  });
  test("the memory mailer records messages and finds the latest code per address", async () => {
    const mailer = new MemoryMailer();
    await mailer.send({ to: "a@b.io", template: "sign_in_code", data: { code: "111111" } });
    await mailer.send({ to: "a@b.io", template: "sign_in_code", data: { code: "222222" } });
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.lastCodeFor("a@b.io")).toBe("222222");
    expect(mailer.lastCodeFor("c@d.io")).toBeUndefined();
  });
});
```

### Replace `apps/api/test/staff/app-mount.test.ts` (whole file)

```ts
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
 * standing in for Task 4's routes, so a request that passes the gate can be told from one that does not: without a route
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
  return { app, seen };
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

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
❯ test/auth/passkey-webauthn.test.ts (29 tests | 5 failed) 289ms
❯ test/auth/passkey-challenge.test.ts (22 tests | 4 failed) 57ms
❯ test/staff/app-mount.test.ts (6 tests | 1 failed) 181ms
❯ test/mail/templates.test.ts (13 tests | 6 failed) 40ms
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/staff-console-3a/write_blocks.py docs/superpowers/prompts/staff-console-3a/03-staff-keys-enrolment.md 3
```

Expected: 19 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/auth/staff/enroll.ts`

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
function consoleOf(deps: AuthDeps): { origin: string; rpId: string } {
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

### Create `apps/api/src/cli/mail.ts`

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
  const settings = commandLineMailSettings(env);
  return smtpMailer(settings.smtpUrl, settings.mailFrom, { requireTls: settings.requireTls });
}
```

### Replace `apps/api/src/auth/admin.ts` (whole file)

```ts
import type { Mailer } from "../mail/mailer";
import { noticeTime } from "./flows/notify";
import type { AuthRepo, UserRole } from "./repo";
import type { Sessions } from "./sessions";

/** The audit log's actor for changes made from the server's command line rather than by a signed-in person. */
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

/** What a role change did, for the command line's report. */
export interface RoleGranted {
  userId: string;
  previousRole: UserRole;
  staffSessionsRevoked: number;
  /** Unused enrolment links deleted, so none issued before the change enrols anything. */
  enrollmentsDeleted: number;
  /** Staff keys revoked: every live one on a change to user, none otherwise. */
  staffKeysRevoked: number;
  /** Why the staff_keys_revoked mail could not be sent, or null when it was sent or none was due. The change stands either way. */
  mailError: string | null;
}

/**
 * Changes an account's role. Used only by the server-side CLI; there is no API endpoint for it.
 * Every session and staff session of the account is revoked and every unused enrolment link deleted, so the new role (and
 * its MFA requirement) applies at once; a change to user also revokes every staff key (3a design, section 7). The change,
 * the revocations and their audit rows are one transaction on the auth role; after it commits, the cached sessions get
 * their tombstones and, when a staff key was revoked, the owner is mailed the keys' names. The mail is best effort: one
 * that fails is reported to the caller and undoes nothing.
 */
export async function grantRole(deps: { repo: AuthRepo; sessions: Sessions; mailer: Mailer }, email: string, role: UserRole): Promise<RoleGranted> {
  const now = new Date();
  const changed = await deps.repo.changeRole(email, role, { actorId: SYSTEM_ACTOR_ID, now });
  if (!changed) throw new Error(`no account for ${email}`);
  await deps.sessions.tombstone(changed.sessionIds);
  let mailError: string | null = null;
  if (changed.keysRevoked.length > 0) {
    try {
      await deps.mailer.send({
        to: changed.email,
        template: "staff_keys_revoked",
        data: { names: changed.keysRevoked.map((key) => `"${key.name}"`).join(", "), time: noticeTime(now) },
      });
    } catch (err) {
      mailError = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    userId: changed.userId,
    previousRole: changed.previousRole,
    staffSessionsRevoked: changed.staffSessionsRevoked,
    enrollmentsDeleted: changed.enrollmentsDeleted,
    staffKeysRevoked: changed.keysRevoked.length,
    mailError,
  };
}
```

### Replace `apps/api/src/auth/context.ts` (whole file)

```ts
import type { AuthErrorCode, MeProfile, Profile, StaffErrorCode } from "@korbat/contracts";
import type { Logger } from "pino";
import type { Config } from "../config";
import type { Mailer } from "../mail/mailer";
import { decodeKey, parseVersionedKey, type VersionedKey } from "./crypto";
import type { KeyValueStore } from "./kv";
import type { Lockout } from "./lockout";
import type { BreachChecker } from "./passwords";
import type { AuthRepo } from "./repo";
import type { Sessions } from "./sessions";
import type { TurnstileVerifier } from "./turnstile";
import type { VerificationProvider } from "./verify/provider";

export interface AuthConfig {
  appOrigin: string;
  /** Origins allowed to send cookie-authenticated state-changing requests. */
  allowedOrigins: string[];
  authHmacKey: Buffer;
  ipHashKey: Buffer;
  totpKey: VersionedKey;
  /** Keys TOTP_ENC_KEY replaced; still accepted for decryption. */
  totpPreviousKeys: VersionedKey[];
  termsVersion: string;
  /** How the client address is read; see TRUST_PROXY in config.ts. */
  trustProxy: "cloudflare" | "caddy" | "none";
  /** Who checks the phone number behind the verified badge; see VERIFY_PROVIDER in config.ts. With `off` the badge routes answer badge_unavailable. */
  verifyProvider: "off" | "dev" | "vonage";
  /** The relying party passkeys are bound to; see WEBAUTHN_RP_ID and WEBAUTHN_RP_NAME in config.ts. */
  webauthn: {
    rpId: string;
    rpName: string;
    /** The origins a ceremony's clientDataJSON may name. */
    origins: string[];
  };
  /**
   * The staff console (3a design, section 8): the only origin a staff ceremony's clientDataJSON may name and the relying
   * party staff keys are bound to, CONSOLE_ORIGIN and CONSOLE_RP_ID. Null while CONSOLE_ORIGIN is unset: the console is
   * off and no staff route is mounted.
   */
  console: { origin: string; rpId: string } | null;
}

export function authConfigFrom(config: Config): AuthConfig {
  return {
    appOrigin: config.APP_ORIGIN,
    allowedOrigins: [config.APP_ORIGIN, ...config.TRUSTED_ORIGINS],
    authHmacKey: decodeKey(config.AUTH_HMAC_KEY),
    ipHashKey: decodeKey(config.IP_HASH_KEY),
    totpKey: parseVersionedKey(config.TOTP_ENC_KEY),
    totpPreviousKeys: config.TOTP_ENC_KEYS_PREVIOUS.map(parseVersionedKey),
    termsVersion: config.TERMS_VERSION,
    trustProxy: config.TRUST_PROXY,
    verifyProvider: config.VERIFY_PROVIDER,
    webauthn: {
      rpId: config.WEBAUTHN_RP_ID,
      rpName: config.WEBAUTHN_RP_NAME,
      // A passkey ceremony run from a development origin (Expo's dev server, say) is accepted outside production only:
      // in production the web app is served from APP_ORIGIN, and no other origin may use its passkeys.
      origins: config.NODE_ENV === "production" ? [config.APP_ORIGIN] : [config.APP_ORIGIN, ...config.TRUSTED_ORIGINS],
    },
    // The configuration fills CONSOLE_RP_ID with the console's hostname whenever CONSOLE_ORIGIN is set.
    console: config.CONSOLE_ORIGIN === undefined ? null : { origin: config.CONSOLE_ORIGIN, rpId: config.CONSOLE_RP_ID! },
  };
}

/** Public profiles live in the public schema, which the auth module cannot reach; the API supplies this. */
export interface ProfileStore {
  create(input: { id: string; handle: string; displayName: string }): Promise<{ ok: true; profile: Profile } | { ok: false; reason: "handle_taken" }>;
  /** The owner's view of their profile, which /me returns: the public facts plus the handle-change date, the badge and the Explore switch. */
  find(id: string): Promise<MeProfile | null>;
  /** Sets or clears the badge (profiles.verified_at), which the auth module decides but cannot write itself. */
  setVerified(id: string, at: Date | null): Promise<void>;
}

export interface AuthDeps {
  repo: AuthRepo;
  kv: KeyValueStore;
  sessions: Sessions;
  lockout: Lockout;
  mailer: Mailer;
  turnstile: TurnstileVerifier;
  breachChecker: BreachChecker;
  profiles: ProfileStore;
  /** The phone verification provider behind the badge, or null when VERIFY_PROVIDER is off. */
  verify: VerificationProvider | null;
  config: AuthConfig;
  log: Logger;
  now: () => Date;
}

/** Per-request facts the flows need. The IP is already hashed; the raw address never enters a flow. */
export interface RequestContext {
  ipHash: string;
  userAgent: string | undefined;
}

/** A staff request's facts: those of any request, and its id, which the audit rows it writes carry (3a design, section 6). */
export interface StaffRequestContext extends RequestContext {
  requestId: string;
}

export type AuthErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 503;

/**
 * The auth codes, the staff console's (the module owns staff keys and sessions, and the staff routes raise its codes as
 * AuthErrors, 3a design section 10), plus the shared one the module also raises, as the social and media modules do: a
 * well-formed request that asks for nothing, such as the current address as the new one.
 */
export type AuthErrorKind = AuthErrorCode | StaffErrorCode | "invalid_request";

const MESSAGES: Record<AuthErrorKind, string> = {
  invalid_code: "That code is not valid. Check the latest email or request a new code.",
  code_expired: "That code has expired. Request a new one.",
  too_many_attempts: "Too many attempts. Request a new code.",
  invalid_credentials: "Email or password is incorrect.",
  mfa_required: "Two-factor authentication must be turned on first.",
  invalid_mfa_code: "That authentication code is not valid.",
  reauth_required: "Confirm it's you to continue.",
  csrf_failed: "This request could not be verified. Reload the page and try again.",
  turnstile_failed: "We could not verify that you are human. Try again.",
  disposable_email: "Disposable email addresses cannot be used.",
  age_requirement: "You must be at least 16 to use korbat.",
  terms_required: "Accept the current terms to continue.",
  handle_taken: "That handle is taken.",
  handle_invalid: "Handles are 3 to 20 characters: lowercase letters, numbers and underscores.",
  handle_reserved: "That handle is reserved.",
  password_too_short: "Passwords need at least 12 characters.",
  password_too_long: "Passwords can have at most 128 characters.",
  password_breached: "That password appears in known data breaches. Choose a different one.",
  password_check_unavailable: "We could not check that password right now. Try again in a moment.",
  staff_mfa_required: "Staff accounts must keep two-factor authentication on.",
  onboarding_required: "Choose a handle to finish setting up your account.",
  mail_unavailable: "We could not send the email. Try again in a moment.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  handle_cooldown: "Handles can change once every 30 days.",
  email_in_use: "That email address already belongs to an account.",
  phone_in_use: "That phone number is already verified on another account.",
  badge_unavailable: "Verification is not available on this korbat.",
  verify_unavailable: "We could not reach the verification service. Try again in a moment.",
  passkey_invalid: "That passkey did not work. Try again or use your email.",
  passkey_unsupported: "This passkey provider is not supported. Try another one.",
  // The cap of 10; the flow passes its own message, with the hours left, for the bound of 5 a day.
  passkey_limit: "You have 10 passkeys. Remove one to add another.",
  passkey_suspended: "This passkey was switched off because a copy of it may exist. Remove it and add a new one.",
  passkey_not_found: "That passkey is gone.",
  challenge_expired: "That took too long. Try again.",
  invalid_request: "Some details are missing or invalid.",
  // The staff console's (3a design, section 10). Where only the operator can help, they say so; none sends the person to
  // a remedy the console does not have, which is why the staff flows never answer a passkey_* code.
  staff_session_required: "Your staff session ended. Sign in with your staff key.",
  staff_key_invalid: "This key does not open the staff console. If it should, ask the operator to check your staff keys.",
  staff_key_suspended: "This staff key was switched off because a copy of it may exist. Ask the operator for a link to enrol a new one.",
  staff_key_limit: "This account has 5 staff keys. Ask the operator to revoke one before enrolling another.",
  staff_key_not_device_bound: "This key can be synced or copied, so it cannot be a staff key. Use a security key or a device-bound authenticator.",
  staff_key_not_user_verified: "This key did not ask for a PIN or fingerprint, so it cannot be a staff key. Set a PIN on it, or use another key.",
  staff_key_refused: "The browser's answer for this key could not be checked. Try again, or use another key; this link still works.",
  staff_enrollment_invalid: "This enrolment link has expired or was already used. Ask the operator for a new one.",
  staff_step_up_required: "Confirm this with your staff key.",
  staff_step_up_invalid: "That confirmation was for another action, was already used or could not be checked. Try again.",
};

export function authErrorMessage(code: AuthErrorKind): string {
  return MESSAGES[code];
}

/** An expected, user-facing failure. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorKind,
    readonly status: AuthErrorStatus,
    message: string = MESSAGES[code],
    /** For rate limits: seconds until the window resets, sent as Retry-After. */
    readonly retryAfterSeconds?: number,
    /**
     * What the app needs beyond the code, sent as the envelope's `details`: for reauth_required, the level the action
     * asks for and the factor kinds the session proved in time (1c design, section 7.1).
     */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** True for a Postgres unique-constraint violation, however deeply the driver error is wrapped. */
export function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && (current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
```

### Replace `apps/api/src/auth/flows/notify.ts` (whole file)

```ts
import type { TemplateName } from "../../mail/mailer";
import type { AuthDeps } from "../context";

/** A notice about a security-relevant change. Best effort: a failed send is logged and never undoes the change. */
export async function notifyAccount(deps: AuthDeps, to: string, template: TemplateName, data: Record<string, string> = {}): Promise<void> {
  try {
    await deps.mailer.send({ to, template, data });
  } catch (err) {
    deps.log.error({ err, template }, "security notice email failed");
  }
}

/**
 * A time as the notices print it: the date and the minute in UTC, since the reader's zone is unknown. The staff mails use
 * it (3a design, section 7), printing times as 1c's passkey notices do.
 */
export function noticeTime(at: Date): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
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
} from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type Redis from "ioredis";
import type { Logger } from "pino";
import type { Config } from "../config";
import type { Mailer } from "../mail/mailer";
import { clientIdentity } from "./client-ip";
import { authConfigFrom, type AuthDeps, type ProfileStore, type RequestContext, type StaffRequestContext } from "./context";
import { confirmDeletion, finishPurge, startDeletion } from "./flows/deletion";
import { exportAccount, type AccountExport } from "./flows/export";
import { redisKv, type KeyValueStore } from "./kv";
import { createLockout } from "./lockout";
import { requireFreshAuth, requireOnboarding, requireSession, requireStaffMfa, requireStrongFreshAuth, resolveSession } from "./middleware";
import type { JobLock } from "../lib/jobs";
import { createJanitor } from "./janitor";
import { hibpChecker, type BreachChecker } from "./passwords";
import { createAuthRepo, type AuthEventType } from "./repo";
import { authRoutes, meHandler } from "./routes";
import { createSessions, type Session } from "./sessions";
import { enrollOptions, enrollVerify, type StaffEnrollOptions } from "./staff/enroll";
import { cloudflareTurnstile, type TurnstileVerifier } from "./turnstile";
import { devProvider } from "./verify/dev";
import type { VerificationProvider } from "./verify/provider";
import { vonageProvider } from "./verify/vonage";

export type { ProfileStore, RequestContext, StaffRequestContext } from "./context";
export type { AccountExport } from "./flows/export";
export type { AuthEventType, UserRole } from "./repo";
export type { ProxyTrust } from "./client-ip";
export type { Session } from "./sessions";
export type { VerificationProvider } from "./verify/provider";
export { AuthError, isUniqueViolation } from "./context";
export { SYSTEM_ACTOR_ID, grantRole } from "./admin";
/** The account module clears a web session's cookies after a deletion; the cookie names and attributes stay this module's. */
export { clearSessionCookies } from "./cookies";
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
  const forStaff: AuthForStaff = {
    enrollOptions: (input) => enrollOptions(deps, input),
    enrollVerify: (input, ctx) => enrollVerify(deps, input, ctx),
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
    requireStaffMfa,
    /** Starts the retention pass (dead codes, old sessions, device address hashes, old events) and returns the function that stops it. */
    startJanitor: (lock: JobLock) => createJanitor(deps, lock).start(),
  };
}

export type Auth = ReturnType<typeof createAuth>;
```

### Replace `apps/api/src/auth/passkeys/challenge.ts` (whole file)

```ts
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { AuthError } from "../context";
import { sha256Hex } from "../crypto";
import type { KeyValueStore } from "../kv";
import { MINUTE } from "../limits";

/**
 * Which ceremony a challenge was issued for; a challenge answers only the ceremony it names. The staff console's two
 * (3a design, section 5) share the layout, the key, the lifetime and the used-challenge markers, so an app sign-in
 * challenge never opens the console's sign-in and a personal passkey's registration challenge never enrols a staff key.
 */
export type ChallengePurpose = "signin" | "register" | "reauth" | "staff_signin" | "staff_register";

/** How long a challenge is valid: the top of WebAuthn L3's recommended range for a ceremony. */
export const CHALLENGE_TTL_MS = 10 * MINUTE;

const VERSION = 1;
const PURPOSE_CODES: Record<ChallengePurpose, number> = { signin: 1, register: 2, reauth: 3, staff_signin: 4, staff_register: 5 };

// The layout: version (1 byte), purpose (1), expiry in epoch milliseconds (8, big-endian), nonce (16), binding (16), then
// the first 16 bytes of HMAC-SHA256 over the 42 before them.
const PURPOSE_AT = 1;
const EXPIRY_AT = 2;
const NONCE_AT = 10;
const BINDING_AT = 26;
const MAC_AT = 42;
const NONCE_BYTES = 16;
const BINDING_BYTES = 16;
const MAC_BYTES = 16;
const CHALLENGE_BYTES = 58;
/** 58 bytes as unpadded base64url. */
const ENCODED_LENGTH = 78;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** The used-challenge markers in the key-value store, keyed by the challenge's hash rather than the challenge itself. */
const USED_PREFIX = "webauthn-used:";

const derivedKeys = new WeakMap<Buffer, Buffer>();

/**
 * The key challenges are sealed with: HKDF-SHA256 of AUTH_HMAC_KEY under its own label, so no other use of that key can
 * produce a valid seal. It is derived once per key buffer; the flows can ask for it on every request.
 */
export function challengeKey(authHmacKey: Buffer): Buffer {
  let key = derivedKeys.get(authHmacKey);
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", authHmacKey, "", "korbat-webauthn-challenge", 32));
    derivedKeys.set(authHmacKey, key);
  }
  return key;
}

const invalid = () => new AuthError("passkey_invalid", 401);
const expired = () => new AuthError("challenge_expired", 400);

/**
 * The first 16 bytes of sha256 of what the challenge is bound to (a session's handle, or a staff enrolment's id), zeros
 * for one bound to nothing (the two sign-ins).
 */
function binding(boundTo: string | undefined): Buffer {
  if (boundTo === undefined) return Buffer.alloc(BINDING_BYTES);
  return createHash("sha256").update(boundTo).digest().subarray(0, BINDING_BYTES);
}

function seal(key: Buffer, signed: Buffer): Buffer {
  return createHmac("sha256", key).update(signed).digest().subarray(0, MAC_BYTES);
}

/**
 * The challenge's 58 bytes, or null for anything else. Only the canonical encoding is accepted: Node's decoder ignores
 * the spare bits of the last character, so without this check several strings would name the same challenge, and each
 * would get its own used-challenge marker.
 */
function decode(challenge: string): Buffer | null {
  if (typeof challenge !== "string" || challenge.length !== ENCODED_LENGTH || !BASE64URL.test(challenge)) return null;
  const bytes = Buffer.from(challenge, "base64url");
  if (bytes.length !== CHALLENGE_BYTES || bytes.toString("base64url") !== challenge) return null;
  return bytes;
}

/**
 * A stateless WebAuthn challenge: its purpose, its expiry (10 minutes from now), a random nonce and a binding, sealed with
 * an HMAC. Registration and re-authentication bind it to the session's handle, a staff registration to its enrolment's id,
 * and the two sign-ins to nothing. Handing one out stores nothing, so the unauthenticated sign-in options cannot fill the
 * key-value store.
 */
export function issueChallenge(key: Buffer, purpose: ChallengePurpose, now: Date, boundTo?: string): string {
  const bytes = Buffer.alloc(CHALLENGE_BYTES);
  bytes[0] = VERSION;
  bytes[PURPOSE_AT] = PURPOSE_CODES[purpose];
  bytes.writeBigUInt64BE(BigInt(now.getTime() + CHALLENGE_TTL_MS), EXPIRY_AT);
  randomBytes(NONCE_BYTES).copy(bytes, NONCE_AT);
  binding(boundTo).copy(bytes, BINDING_AT);
  seal(key, bytes.subarray(0, MAC_AT)).copy(bytes, MAC_AT);
  return bytes.toString("base64url");
}

/**
 * Checks a challenge a ceremony's client data names before any WebAuthn verification runs: the seal first, in constant
 * time, so a forged challenge says nothing about which field failed; then the version, the purpose and the binding
 * (`passkey_invalid`), and only then the expiry (`challenge_expired`), which the app answers by starting over. Pass what
 * the challenge was issued bound to: the session's handle for registration and re-authentication, the enrolment's id for
 * a staff registration, nothing for the sign-ins. The staff flows answer this function's passkey_invalid with a staff code.
 */
export function readChallenge(key: Buffer, challenge: string, purpose: ChallengePurpose, now: Date, boundTo?: string): void {
  const bytes = decode(challenge);
  if (!bytes) throw invalid();
  if (!timingSafeEqual(bytes.subarray(MAC_AT), seal(key, bytes.subarray(0, MAC_AT)))) throw invalid();
  if (bytes[0] !== VERSION || bytes[PURPOSE_AT] !== PURPOSE_CODES[purpose]) throw invalid();
  if (!bytes.subarray(BINDING_AT, MAC_AT).equals(binding(boundTo))) throw invalid();
  if (now.getTime() >= Number(bytes.readBigUInt64BE(EXPIRY_AT))) throw expired();
}

/**
 * Makes a challenge single-use; call it right after readChallenge, before the WebAuthn verification, so a challenge stays
 * spent whatever happens next. The marker lives for the rest of the challenge's lifetime: after that readChallenge
 * refuses the challenge anyway. A second spend is `passkey_invalid`.
 */
export async function spendChallenge(kv: KeyValueStore, challenge: string, now: Date): Promise<void> {
  const bytes = decode(challenge);
  if (!bytes) throw invalid();
  const remaining = Number(bytes.readBigUInt64BE(EXPIRY_AT)) - now.getTime();
  // Refused as readChallenge refuses it, which also keeps the store from being handed a TTL of zero or less (Redis refuses one).
  if (remaining <= 0) throw expired();
  if (!(await kv.setIfAbsent(USED_PREFIX + sha256Hex(challenge), "1", remaining))) throw invalid();
}
```

### Replace `apps/api/src/auth/passkeys/flows.ts` (whole file)

```ts
import { randomBytes } from "node:crypto";
import type {
  AuthenticationResponseJSON,
  PasskeyListResponse,
  PasskeyRegisterOptionsRequest,
  PasskeyRegisterVerifyRequest,
  PasskeyRemoveLinkRequest,
  PasskeyRenameRequest,
  PasskeySignInVerifyRequest,
  PasskeyView,
} from "@korbat/contracts";
import { AuthError, isUniqueViolation, type AuthDeps, type RequestContext } from "../context";
import { randomToken, sha256Hex } from "../crypto";
import { MFA_TICKET_TTL_MS, mfaTicketKey, signIn, type DeviceInput, type MfaPending, type MfaTicket, type SignedIn } from "../flows/signin";
import { lockdown } from "../flows/lockdown";
import { notifyAccount } from "../flows/notify";
import { deviceHash, emailHash } from "../identifiers";
import { HOUR, MINUTE, enforceLimit } from "../limits";
import type { AddPasskeyOutcome, PasskeyLimits, PasskeyRow, UserRow } from "../repo";
import type { FactorKind, Session } from "../sessions";
import { challengeKey, issueChallenge, readChallenge, spendChallenge } from "./challenge";
import {
  authenticationOptions,
  readResponseChallenge,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type VerifiedAuthentication,
} from "./webauthn";

const DAY = 24 * HOUR;

/** At most this many passkeys on an account at a time (1c design, section 2). */
export const PASSKEY_CAP = 10;
/** At most this many added in any 24 hours, counted from the passkey_added events, so removing one frees no slot of the day. */
export const PASSKEY_ADDITIONS_PER_DAY = 5;
export const PASSKEY_ADDITIONS_WINDOW_MS = DAY;
/** A passkey counts as new for this long: the Security list marks it and offers "This wasn't me" on it. */
export const NEW_PASSKEY_MS = 7 * DAY;
/** How long the remove link in the passkey_added notice works. */
export const PASSKEY_REMOVE_TTL_MS = 7 * DAY;
export const REGISTER_OPTIONS_PER_HOUR = 10;
export const RENAMES_PER_HOUR = 30;
export const REMOVALS_PER_HOUR = 10;
export const NOT_MINE_PER_DAY = 5;
export const REMOVE_LINKS_PER_IP_PER_HOUR = 10;
/** The window the two unauthenticated sign-in limits count over. */
export const SIGNIN_WINDOW_MS = 15 * MINUTE;
export const SIGNIN_OPTIONS_PER_IP = 30;
export const SIGNIN_VERIFY_PER_IP = 20;
/** A passkey sign-in from a device the account has not used: bounded per account, since the assertion carries no session to key by. */
export const SIGNIN_NEW_DEVICE_PER_HOUR = 5;
export const SIGNIN_NEW_DEVICE_PER_DAY = 20;

const LIMITS: PasskeyLimits = { passkeys: PASSKEY_CAP, additions: PASSKEY_ADDITIONS_PER_DAY, windowMs: PASSKEY_ADDITIONS_WINDOW_MS };
const LINK_GONE = "This link has expired or was already used.";

/** The remove link is a bearer credential for 7 days, so the store holds only its hash. */
export const passkeyRemoveKey = (token: string) => `passkey-remove:${sha256Hex(token)}`;

/**
 * What a remove link acts on: the account, the passkey, its creation (epoch milliseconds from the flows' clock, the
 * lockdown's anchor, which holds whether or not the passkey is still there) and the keyed hash of the address the link
 * went to, which the link checks against the account's current address.
 */
export interface PasskeyRemoveToken {
  userId: string;
  passkeyId: string;
  createdAt: number;
  sentTo: string;
}

/** Refuses a session that has not proven enough within the window: level 2 on an account with TOTP unless told level 1, as the route's guard does. */
function requireFresh(deps: AuthDeps, session: Session, level: 1 | 2 = deps.sessions.requiredLevel(session)): void {
  const needed = deps.sessions.reauthNeeded(session, level);
  if (needed) throw new AuthError("reauth_required", 403, undefined, undefined, needed);
}

/**
 * A bound refused, as the app reads it: the reason in the details, and for the daily bound the seconds until the day has
 * a slot again, said in hours in the message (the cap keeps the code's own message).
 */
function limitReached(bound: { reason: "cap" } | { reason: "daily"; retryAfterSeconds: number }): AuthError {
  if (bound.reason === "cap") return new AuthError("passkey_limit", 409, undefined, undefined, { reason: "cap" });
  const hours = Math.max(1, Math.ceil(bound.retryAfterSeconds / 3600));
  const wait = hours === 1 ? "1 hour" : `${hours} hours`;
  return new AuthError("passkey_limit", 409, `You added ${PASSKEY_ADDITIONS_PER_DAY} passkeys today. You can add another in about ${wait}.`, undefined, {
    reason: "daily",
    retryAfter: bound.retryAfterSeconds,
  });
}

/** Both bounds before the options are handed out, so a full account is told at once; the registration's transaction checks them again. */
async function checkBounds(deps: AuthDeps, userId: string): Promise<void> {
  if ((await deps.repo.countPasskeys(userId)) >= PASSKEY_CAP) throw limitReached({ reason: "cap" });
  const additions = await deps.repo.recentPasskeyAdditions(userId, PASSKEY_ADDITIONS_WINDOW_MS, PASSKEY_ADDITIONS_PER_DAY);
  if (additions.count >= PASSKEY_ADDITIONS_PER_DAY) throw limitReached({ reason: "daily", retryAfterSeconds: additions.retryAfterSeconds });
}

const isNew = (createdAt: Date, now: Date) => now.getTime() - createdAt.getTime() < NEW_PASSKEY_MS;

/** A passkey as the Security list shows it: nothing of the key itself. */
function view(row: PasskeyRow, createdOn: string | null, session: Session, now: Date): PasskeyView {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    synced: row.backedUp,
    createdOn,
    current: session.passkeyId === row.id,
    isNew: isNew(row.createdAt, now),
    suspended: row.suspectAt !== null,
  };
}

/** The name a passkey gets when the owner gives none: after the platform of the device whose session added it. */
function defaultName(platform: string | undefined): string {
  const where = platform === "ios" ? "iOS" : platform === "android" ? "Android" : "the web";
  return `Passkey on ${where}`;
}

/** A time as the passkey notices print it: the date and the minute in UTC, since the reader's zone is unknown. */
function mailTime(at: Date): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * Options for adding a passkey (1c design, section 7.3): the account's user handle (set now if it never had one), the
 * label the password manager will show, the account's passkeys excluded so an authenticator does not add a second copy,
 * and a registration challenge bound to this session's handle. Needs level 2 on an account with TOTP (the route checks as
 * well): adding a credential is the first thing a stolen session would do.
 */
export async function registerOptions(deps: AuthDeps, session: Session, input: PasskeyRegisterOptionsRequest): Promise<{ options: PublicKeyCredentialCreationOptionsJSON }> {
  requireFresh(deps, session);
  // Counted by the handle: a rotation keeps it, and no other session of the account can spend it.
  await enforceLimit(deps.kv, `passkey-register:${session.handle}`, REGISTER_OPTIONS_PER_HOUR, HOUR);
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  await checkBounds(deps, user.id);
  // 32 random bytes, never the account id, set once: a registration racing this one reads the same bytes back.
  const userId = user.webauthnUserId ?? (await deps.repo.ensureWebauthnUserId(user.id, randomBytes(32)));
  if (!userId) throw new AuthError("invalid_credentials", 401);
  const held = await deps.repo.listPasskeys(user.id);
  // While the staff console's relying party ID is the app's (development), an authenticator could replace a staff key with
  // a passkey under the same user handle: its live staff keys are excluded too, and it refuses instead (3a design, section 2).
  const staffKeys = deps.config.console?.rpId === deps.config.webauthn.rpId ? await deps.repo.listLiveStaffKeys(user.id) : [];
  const challenge = issueChallenge(challengeKey(deps.config.authHmacKey), "register", deps.now(), session.handle);
  const options = await registrationOptions({
    rp: { id: deps.config.webauthn.rpId, name: deps.config.webauthn.rpName },
    // The label goes to the password manager and nowhere else: korbat keeps nothing of it.
    user: { id: userId, name: input.label, displayName: input.label },
    exclude: [...held, ...staffKeys].map((p) => ({ id: p.credentialId, transports: p.transports })),
    challenge,
  });
  return { options };
}

/**
 * Stores the passkey the browser created (1c design, section 7.3). The challenge is read from the response, checked
 * against this session's handle and spent before anything else runs, so it stays spent whatever happens next; it was
 * issued to a strong-fresh session and bound to it, so no second freshness check is needed and a ceremony that outlasts
 * the window still completes. The row and its passkey_added event land in one transaction that checks both bounds
 * again. The session's factors do not change: adding a passkey proves nothing about the session. Then the owner is told,
 * with a one-shot link that runs the lockdown for 7 days, tied to the address it goes to.
 */
export async function registerVerify(deps: AuthDeps, session: Session, input: PasskeyRegisterVerifyRequest): Promise<{ passkey: PasskeyView }> {
  const now = deps.now();
  const challenge = readResponseChallenge(input.response);
  readChallenge(challengeKey(deps.config.authHmacKey), challenge, "register", now, session.handle);
  await spendChallenge(deps.kv, challenge, now);
  const verified = await verifyRegistration({ response: input.response, expectedChallenge: challenge, origins: deps.config.webauthn.origins, rpId: deps.config.webauthn.rpId });
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  const device = await deps.repo.findDeviceById(session.deviceId);
  const name = input.name ?? defaultName(device?.platform);
  let outcome: AddPasskeyOutcome;
  try {
    outcome = await deps.repo.addPasskey(
      {
        userId: user.id,
        credentialId: verified.credentialId,
        publicKey: verified.publicKey,
        counter: verified.counter,
        transports: verified.transports,
        aaguid: verified.aaguid,
        backupEligible: verified.backupEligible,
        backedUp: verified.backedUp,
        uvInitialized: verified.userVerified,
        createdDeviceId: session.deviceId,
        // From the flows' clock, like password_changed_at: the lockdown compares it with flow times.
        createdAt: now,
        name,
      },
      LIMITS,
    );
  } catch (err) {
    // A credential id korbat already holds, whoever's it is: the authenticator answered for a key that is not new.
    if (isUniqueViolation(err)) throw new AuthError("passkey_invalid", 401);
    throw err;
  }
  if (!outcome.ok) {
    if (outcome.reason === "gone") throw new AuthError("invalid_credentials", 401);
    throw limitReached(outcome);
  }
  const passkey = outcome.passkey;
  // After the commit, and best effort as every notice is: a failed mail never undoes a registration.
  const token = randomToken();
  const link: PasskeyRemoveToken = { userId: user.id, passkeyId: passkey.id, createdAt: passkey.createdAt.getTime(), sentTo: emailHash(deps.config.authHmacKey, user.email) };
  await deps.kv.set(passkeyRemoveKey(token), JSON.stringify(link), PASSKEY_REMOVE_TTL_MS);
  await notifyAccount(deps, user.email, "passkey_added", {
    name,
    deviceLabel: device?.label ?? "Unknown device",
    time: mailTime(now),
    removeUrl: `${deps.config.appOrigin}/passkey-remove/${token}`,
  });
  return { passkey: view(passkey, device?.label ?? null, session, now) };
}

/** The account's passkeys for the Security screen, newest first (1c design, section 7.5). */
export async function listPasskeys(deps: AuthDeps, session: Session): Promise<PasskeyListResponse> {
  const now = deps.now();
  const rows = await deps.repo.listPasskeys(session.userId);
  return { passkeys: rows.map((row) => view(row, row.createdOn, session, now)) };
}

/** Renames one passkey of the session's account; another account's and an unknown one are not told apart. Thirty an hour per account. */
export async function renamePasskey(deps: AuthDeps, session: Session, id: string, input: PasskeyRenameRequest): Promise<{ passkey: PasskeyView }> {
  await enforceLimit(deps.kv, `passkey-rename:${session.userId}`, RENAMES_PER_HOUR, HOUR);
  if (!(await deps.repo.renamePasskey(id, session.userId, input.name))) throw new AuthError("passkey_not_found", 404);
  const row = await deps.repo.findPasskey(id, session.userId);
  if (!row) throw new AuthError("passkey_not_found", 404);
  return { passkey: view(row, row.createdOn, session, deps.now()) };
}

/**
 * Removes one passkey of the session's account, the last one too (email stays the recovery root), records it and tells
 * the owner. Needs level 2 on an account with TOTP (the route checks as well). The sessions the passkey started keep
 * running: the owner removed a credential, nothing more.
 */
export async function removePasskey(deps: AuthDeps, session: Session, id: string): Promise<void> {
  requireFresh(deps, session);
  await enforceLimit(deps.kv, `passkey-remove:${session.userId}`, REMOVALS_PER_HOUR, HOUR);
  const removed = await deps.repo.deletePasskey(id, session.userId);
  if (!removed) throw new AuthError("passkey_not_found", 404);
  await deps.repo.appendEvent({ userId: session.userId, type: "passkey_removed", deviceId: session.deviceId, metadata: { passkeyId: id, via: "settings" } });
  const user = await deps.repo.findUserById(session.userId);
  if (user) await notifyAccount(deps, user.email, "passkey_removed", { name: removed.name, time: mailTime(deps.now()) });
}

/**
 * "This wasn't me" on a passkey of the last 7 days, the ones the Security list offers it on (1c design, section 7.5):
 * the lockdown anchored at the passkey's creation, naming it, recorded with this session's device. Level 1 is enough,
 * on an account with TOTP too: whoever re-enrolled it from a stolen session holds level 2, and the owner may not.
 * Five a day per account, counted only for a call that will run the lockdown: the bucket is the account's, so were a
 * miss to count, any session of the account, a stolen one too, could spend the owner's five with unknown ids and keep
 * its access. A call that does count signs its own session out with every other.
 */
export async function notMine(deps: AuthDeps, session: Session, id: string, ctx: RequestContext): Promise<void> {
  requireFresh(deps, session, 1);
  // The lookup is by the session's account, so a miss tells the caller nothing about anyone else's passkeys.
  const passkey = await deps.repo.findPasskey(id, session.userId);
  // An older passkey, another account's and an unknown one are not told apart.
  if (!passkey || !isNew(passkey.createdAt, deps.now())) throw new AuthError("passkey_not_found", 404);
  await enforceLimit(deps.kv, `passkey-not-mine:${session.userId}`, NOT_MINE_PER_DAY, DAY);
  await lockdown(deps, {
    userId: session.userId,
    anchor: passkey.createdAt,
    passkeyIds: [passkey.id],
    caller: { type: "passkey_removed", deviceId: session.deviceId, metadata: { passkeyId: passkey.id, via: "not_mine" } },
    ctx,
  });
}

/**
 * The remove link from the passkey_added notice, which needs no session: the link is the credential, and works once.
 * The lockdown runs anchored at the passkey's creation and names it, so the link works whether or not the passkey is
 * still there (1c design, section 7.6). It does nothing but refuse when the account is gone or its address is no longer
 * the one the notice went to: a link mailed to an attacker's address dies when the owner's is restored. A refusal does
 * not spend the link. The owner may open it while an attacker's address change stands, and once the email undo has
 * restored the address this link is the one whose lockdown reaches the day before the passkey, which the undo's may not.
 */
export async function removeByLink(deps: AuthDeps, input: PasskeyRemoveLinkRequest, ctx: RequestContext): Promise<void> {
  await enforceLimit(deps.kv, `passkey-remove-link:ip:${ctx.ipHash}`, REMOVE_LINKS_PER_IP_PER_HOUR, HOUR);
  const key = passkeyRemoveKey(input.token);
  // Read first, so that a refusal leaves the link as it was.
  const raw = await deps.kv.get(key);
  if (!raw) throw new AuthError("invalid_code", 400, LINK_GONE);
  const link = JSON.parse(raw) as PasskeyRemoveToken;
  const user = await deps.repo.findUserById(link.userId);
  if (!user) throw new AuthError("invalid_code", 400, LINK_GONE);
  if (link.sentTo !== emailHash(deps.config.authHmacKey, user.email)) throw new AuthError("invalid_code", 400, LINK_GONE);
  // Taken only now, just before it acts: of two requests with the same link, one gets it and the other is refused.
  if (!(await deps.kv.take(key))) throw new AuthError("invalid_code", 400, LINK_GONE);
  await lockdown(deps, {
    userId: user.id,
    anchor: new Date(link.createdAt),
    passkeyIds: [link.passkeyId],
    caller: { type: "passkey_removed", metadata: { passkeyId: link.passkeyId, via: "link" } },
    ctx,
  });
}

/**
 * Records a verified passkey's use (1c design, sections 2, 7.2 and 7.4): the counter, the use time and the current backup
 * state in one conditional update. When it matches no row after a signature has checked, the counter did not move forward,
 * or a concurrent use took the same step: the passkey is marked suspect, the regression recorded, the owner told best
 * effort, and the attempt refused. A passkey already suspect is caught by the caller before this runs, so this only ever
 * suspends a fresh regression.
 */
async function recordPasskeyUse(deps: AuthDeps, passkey: Pick<PasskeyRow, "id" | "userId" | "name">, email: string, verified: VerifiedAuthentication, now: Date): Promise<void> {
  if (await deps.repo.claimPasskeyUse(passkey.id, verified.newCounter, verified.backedUp, now)) return;
  await deps.repo.suspectPasskey(passkey.id, now);
  await deps.repo.appendEvent({ userId: passkey.userId, type: "passkey_counter_regression", metadata: { passkeyId: passkey.id } });
  await notifyAccount(deps, email, "passkey_suspect", { name: passkey.name });
  throw new AuthError("passkey_invalid", 401);
}

/** The factor a verified assertion proves: two factors only when the authenticator verified the user and the passkey was registered with UV. */
function passkeyFactor(verified: VerifiedAuthentication, passkey: Pick<PasskeyRow, "uvInitialized">): FactorKind {
  return verified.userVerified && passkey.uvInitialized ? "passkey_uv" : "passkey";
}

/**
 * Options for a passkey sign-in (1c design, section 7.4): an empty allow list, so the options name no account and the
 * browser offers every passkey it holds for the relying party, and a sign-in challenge with no session binding. Handing
 * them out stores nothing beyond the per-IP counter, so it cannot fill the key-value store. Thirty per IP per 15 minutes.
 */
export async function signInOptions(deps: AuthDeps, ctx: RequestContext): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }> {
  await enforceLimit(deps.kv, `passkey-signin-options:ip:${ctx.ipHash}`, SIGNIN_OPTIONS_PER_IP, SIGNIN_WINDOW_MS);
  const challenge = issueChallenge(challengeKey(deps.config.authHmacKey), "signin", deps.now());
  const options = await authenticationOptions({ rpId: deps.config.webauthn.rpId, allow: [], challenge });
  return { options };
}

/**
 * Verifies a passkey sign-in (1c design, section 7.4). The challenge is read from the response, checked with no session
 * binding and spent before anything else runs, so a forged, foreign or spent one never reaches the library. The passkey is
 * found by its credential id and its account read: an unknown credential, and a deleted or purged account, are alike
 * passkey_invalid, as is a response without a user handle, or with one that is not this account's: the options named no
 * account, so the response has to (WebAuthn L3, section 7.2, step 6). Only after the signature checks is
 * a suspect passkey passkey_suspended, and only then does the counter write run (a counter that did not move forward
 * suspends the passkey and refuses); the factor is passkey_uv only when the authenticator verified the user and the passkey
 * was registered with UV. A sign-in from a device the account has not used is counted, and only after a verified signature,
 * so nobody but the passkey's holder can spend the new-device allowance. Then, on an account with TOTP, a one-factor
 * passkey (and every staff sign-in) goes to the TOTP step with an MFA ticket; otherwise a session is issued directly, with
 * the new-device alert whose not-me link names the passkey. There is no account lockout.
 */
export async function signInVerify(deps: AuthDeps, input: PasskeySignInVerifyRequest, ctx: RequestContext): Promise<SignedIn | MfaPending> {
  await enforceLimit(deps.kv, `passkey-signin:ip:${ctx.ipHash}`, SIGNIN_VERIFY_PER_IP, SIGNIN_WINDOW_MS);
  const now = deps.now();
  const challenge = readResponseChallenge(input.response);
  readChallenge(challengeKey(deps.config.authHmacKey), challenge, "signin", now);
  await spendChallenge(deps.kv, challenge, now);

  const passkey = await deps.repo.findPasskeyByCredentialId(input.response.id);
  if (!passkey) throw new AuthError("passkey_invalid", 401);
  const user = await deps.repo.findUserById(passkey.userId);
  // A deleted or purged account's row is gone from findUserById: its passkey signs nobody in.
  if (!user) throw new AuthError("passkey_invalid", 401);
  // The allow list was empty, so nothing named an account before the ceremony: the response must carry the account's user
  // handle, which every passkey korbat registers returns (they are discoverable). Without one, or on an account that has
  // none, or with another's, the answer is the one every failure before the signature gets. The field stays optional in
  // the contract, which re-authentication shares: there the session names the account and the handle may be absent.
  const userHandle = input.response.response.userHandle;
  if (userHandle === undefined || user.webauthnUserId === null || !Buffer.from(userHandle, "base64url").equals(user.webauthnUserId)) {
    throw new AuthError("passkey_invalid", 401);
  }

  const verified = await verifyAuthentication({
    response: input.response,
    expectedChallenge: challenge,
    origins: deps.config.webauthn.origins,
    rpId: deps.config.webauthn.rpId,
    credential: { id: passkey.credentialId, publicKey: passkey.publicKey, transports: passkey.transports },
  });
  // After the signature only: an unsigned response can never switch a passkey off or tell one from another.
  if (passkey.suspectAt !== null) throw new AuthError("passkey_suspended", 403);
  await recordPasskeyUse(deps, passkey, user.email, verified, now);

  const factor = passkeyFactor(verified, passkey);
  const device: DeviceInput = { deviceId: input.deviceId, platform: input.platform };
  if (!(await deps.repo.findDevice(user.id, deviceHash(deps.config.authHmacKey, device.deviceId)))) {
    await enforceLimit(deps.kv, `passkey-signin-new-device:hour:${user.id}`, SIGNIN_NEW_DEVICE_PER_HOUR, HOUR);
    await enforceLimit(deps.kv, `passkey-signin-new-device:day:${user.id}`, SIGNIN_NEW_DEVICE_PER_DAY, DAY);
  }

  const proof = { factors: { [factor]: now.getTime() }, method: "passkey" as const, passkeyId: passkey.id };
  // On an account with TOTP, a one-factor passkey still needs the second factor, and staff always do (1c design, section 2).
  if (user.totpEnabledAt && (factor === "passkey" || user.role !== "user")) {
    const mfaTicket = randomToken();
    const ticket: MfaTicket = { userId: user.id, deviceId: device.deviceId, platform: device.platform, ...proof };
    await deps.kv.set(mfaTicketKey(mfaTicket), JSON.stringify(ticket), MFA_TICKET_TTL_MS);
    return { kind: "mfa", mfaTicket };
  }
  return signIn(deps, user, device, ctx, { alertNewDevice: true, ...proof });
}

/**
 * Options for re-authenticating with a passkey (1c design, section 7.2): the account's passkeys that are not suspect in the
 * allow list, so the browser offers only ones that still work, and a re-authentication challenge bound to this session's
 * handle, which no other session of the account can answer.
 */
export async function reauthOptions(deps: AuthDeps, session: Session): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }> {
  const held = await deps.repo.listPasskeys(session.userId);
  const allow = held.filter((p) => p.suspectAt === null).map((p) => ({ id: p.credentialId, transports: p.transports }));
  const challenge = issueChallenge(challengeKey(deps.config.authHmacKey), "reauth", deps.now(), session.handle);
  const options = await authenticationOptions({ rpId: deps.config.webauthn.rpId, allow, challenge });
  return { options };
}

/**
 * The passkey method of the re-authentication flow (1c design, section 7.2), run from flows/reauth.ts so the buckets,
 * reauth_at, the rotation and the answer stay that flow's. The challenge is read from the response, checked against this
 * session's handle and spent first; the passkey is looked up with the session's user, so another account's and an unknown
 * one are alike passkey_invalid and neither touches a passkey's counter; after the signature checks, a suspect passkey is
 * passkey_suspended, and the counter write applies. Answers the factor proven, passkey_uv or passkey.
 */
export async function reauthenticatePasskey(deps: AuthDeps, session: Session, user: UserRow, response: AuthenticationResponseJSON, now: Date): Promise<FactorKind> {
  const challenge = readResponseChallenge(response);
  readChallenge(challengeKey(deps.config.authHmacKey), challenge, "reauth", now, session.handle);
  await spendChallenge(deps.kv, challenge, now);
  const passkey = await deps.repo.findPasskeyByCredential(response.id, session.userId);
  if (!passkey) throw new AuthError("passkey_invalid", 401);
  const verified = await verifyAuthentication({
    response,
    expectedChallenge: challenge,
    origins: deps.config.webauthn.origins,
    rpId: deps.config.webauthn.rpId,
    credential: { id: passkey.credentialId, publicKey: passkey.publicKey, transports: passkey.transports },
  });
  if (passkey.suspectAt !== null) throw new AuthError("passkey_suspended", 403);
  await recordPasskeyUse(deps, passkey, user.email, verified, now);
  return passkeyFactor(verified, passkey);
}
```

### Replace `apps/api/src/auth/passkeys/webauthn.ts` (whole file)

```ts
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@korbat/contracts";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
} from "@simplewebauthn/server";
import { decodeAttestationObject, decodeClientDataJSON, isoBase64URL } from "@simplewebauthn/server/helpers";
import { AuthError } from "../context";
import { MINUTE } from "../limits";

// This is the only file that imports @simplewebauthn/server: everything the library decides passes through here, with
// korbat's settings pinned, and every library failure leaves as passkey_invalid.

export type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON };

/**
 * How long the browser's prompt may stay open: half the challenge's lifetime, so a modal prompt ends before its challenge
 * expires. Conditional mediation (autofill) ignores it; the app restarts that request itself.
 */
export const CEREMONY_TIMEOUT_MS = 5 * MINUTE;

/**
 * Ed25519, ES256 and RS256, pinned on the options and on the verification alike. The library's runtime default adds
 * ML-DSA (-48) on Node 24, which Node still marks experimental.
 */
export const SUPPORTED_ALGORITHMS: readonly number[] = [-8, -7, -257];

/** WebAuthn L3 caps credential ids at this many bytes and has the relying party refuse a longer one at registration; the library does not. */
export const MAX_CREDENTIAL_ID_BYTES = 1023;

/** The transports WebAuthn L3 defines, plus "cable", the older name of hybrid that some browsers still report. */
const KNOWN_TRANSPORTS = new Set(["usb", "nfc", "ble", "smart-card", "hybrid", "internal", "cable"]);
const MAX_TRANSPORTS = 5;

/** The contracts' bound on clientDataJSON, applied again here for callers that did not come through them. */
const MAX_CLIENT_DATA_CHARS = 4 * 1024;
/** Well above the 78 characters of a korbat challenge; anything longer is not one, and is not worth hashing. */
const MAX_CHALLENGE_CHARS = 128;

const invalid = () => new AuthError("passkey_invalid", 401);

/** A credential in an options list: its id as base64url and the transports it was registered with. */
export interface CredentialDescriptor {
  id: string;
  transports: string[];
}

/**
 * What a ceremony asks of user verification: "preferred" for 1c's passkeys, so security keys without a PIN still work,
 * and "required" for every staff ceremony (3a design, section 5). Verification itself never requires it: the flows read
 * the UV flag the authenticator reported, and the staff flows refuse a key without it with a code of its own.
 */
export type UserVerification = "preferred" | "required";

/** Only these two members reach the options JSON, whatever else the caller's objects carry. */
const descriptor = ({ id, transports }: CredentialDescriptor) => ({ id, transports });

/**
 * The challenge's own bytes. Given a string, the library would encode its UTF-8 text again, and the options (and so the
 * browser's client data) would carry a different string from the one korbat issued and checks.
 */
function challengeBytes(challenge: string): Uint8Array<ArrayBuffer> {
  const bytes = Uint8Array.from(Buffer.from(challenge, "base64url"));
  if (Buffer.from(bytes).toString("base64url") !== challenge) throw new Error("a WebAuthn challenge must be canonical base64url, as issueChallenge writes it");
  return bytes;
}

/**
 * Options for navigator.credentials.create: a discoverable credential (the passkey signs in without an email), user
 * verification as the caller asks (preferred unless told otherwise), no attestation, the pinned algorithms, and the
 * account's credentials listed so an authenticator that already holds one of them does not add another.
 */
export async function registrationOptions(input: {
  rp: { id: string; name: string };
  /** The account's WebAuthn user handle (never its account id), and the label the password manager shows. */
  user: { id: Uint8Array; name: string; displayName: string };
  exclude: CredentialDescriptor[];
  challenge: string;
  userVerification?: UserVerification;
  /**
   * The security-key hint, for the enrolment's "Register a security key" button only. 14.0.2 sends a hint only through
   * preferredAuthenticatorType, which also sets cross-platform attachment and so hides Windows Hello: without it, no hint.
   */
  hint?: "securityKey";
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: input.rp.name,
    rpID: input.rp.id,
    userName: input.user.name,
    userDisplayName: input.user.displayName,
    // 14.0.2 takes the user handle as bytes only; it refuses a string.
    userID: Uint8Array.from(input.user.id),
    challenge: challengeBytes(input.challenge),
    timeout: CEREMONY_TIMEOUT_MS,
    attestationType: "none",
    excludeCredentials: input.exclude.map(descriptor),
    // A new object on every call: the library writes requireResidentKey, and with a hint the attachment, into the object it is given.
    authenticatorSelection: { residentKey: "required", userVerification: input.userVerification ?? "preferred" },
    supportedAlgorithmIDs: [...SUPPORTED_ALGORITHMS],
    ...(input.hint ? { preferredAuthenticatorType: input.hint } : {}),
  });
}

/**
 * Options for navigator.credentials.get. Sign-in passes an empty allow list, so the options say nothing about any account
 * and the browser offers every passkey it holds for the RP; re-authentication lists the account's usable passkeys.
 */
export async function authenticationOptions(input: {
  rpId: string;
  allow: CredentialDescriptor[];
  challenge: string;
  userVerification?: UserVerification;
}): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: input.rpId,
    allowCredentials: input.allow.map(descriptor),
    challenge: challengeBytes(input.challenge),
    timeout: CEREMONY_TIMEOUT_MS,
    userVerification: input.userVerification ?? "preferred",
  });
}

/** The format and statement of an attestation object, or null when it is not a CBOR map holding a text format and a statement map. */
function attestationFormat(attestationObject: string): { fmt: string; attStmt: Map<unknown, unknown> } | null {
  try {
    const decoded: unknown = decodeAttestationObject(isoBase64URL.toBuffer(attestationObject));
    if (!(decoded instanceof Map)) return null;
    const fmt: unknown = decoded.get("fmt");
    const attStmt: unknown = decoded.get("attStmt");
    return typeof fmt === "string" && attStmt instanceof Map ? { fmt, attStmt } : null;
  } catch {
    return null;
  }
}

/** Known values only, each once, five at most: the library hands back whatever the client sent. */
function knownTransports(reported: unknown): string[] {
  if (!Array.isArray(reported)) return [];
  const kept: string[] = [];
  for (const transport of reported) {
    if (kept.length === MAX_TRANSPORTS) break;
    if (typeof transport === "string" && KNOWN_TRANSPORTS.has(transport) && !kept.includes(transport)) kept.push(transport);
  }
  return kept;
}

/** What korbat stores of a verified registration. */
export interface VerifiedRegistration {
  /** From the authenticator data, base64url; the library never compares it with the response's id, so the response's id is not used. */
  credentialId: string;
  /** The COSE public key as base64url, as auth.passkeys.public_key holds it. */
  publicKey: string;
  counter: number;
  transports: string[];
  aaguid: string;
  /** The BE flag: the key may be synced to the owner's other devices. */
  backupEligible: boolean;
  /** The BS flag: the key is backed up now. */
  backedUp: boolean;
  /** The UV flag. Only a passkey registered with it counts as two factors when a later sign-in is verified too. */
  userVerified: boolean;
}

/**
 * Verifies a registration response whose challenge the caller has already read and spent. The attestation format is
 * checked before the library sees the response: only `none`, or `packed` with no x5c chain (a self attestation), pass;
 * anything else is passkey_unsupported. The format comes from the client whatever the options asked for, and the library
 * fetches revocation lists, with no timeout or size limit, for the formats that carry certificates.
 */
export async function verifyRegistration(input: { response: RegistrationResponseJSON; expectedChallenge: string; origins: string[]; rpId: string }): Promise<VerifiedRegistration> {
  const format = attestationFormat(input.response.response.attestationObject);
  if (!format) throw invalid();
  if (!(format.fmt === "none" || (format.fmt === "packed" && !format.attStmt.has("x5c")))) throw new AuthError("passkey_unsupported", 400);

  let result: VerifiedRegistrationResponse;
  try {
    result = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.origins,
      expectedRPID: input.rpId,
      // User verification is never required here, so security keys without a PIN still work for passkeys; the flows read
      // the UV flag instead to decide what the passkey proves, and the staff flows refuse a key without it by its own code.
      requireUserVerification: false,
      supportedAlgorithmIDs: [...SUPPORTED_ALGORITHMS],
    });
  } catch {
    throw invalid();
  }
  if (!result.verified) throw invalid();
  const { credential, aaguid, credentialDeviceType, credentialBackedUp, userVerified } = result.registrationInfo;
  if (Buffer.from(credential.id, "base64url").length > MAX_CREDENTIAL_ID_BYTES) throw invalid();
  return {
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: knownTransports(credential.transports),
    aaguid,
    backupEligible: credentialDeviceType === "multiDevice",
    backedUp: credentialBackedUp,
    userVerified,
  };
}

/** What an assertion proved: the counter to compare with the stored one, and the flags. */
export interface VerifiedAuthentication {
  newCounter: number;
  userVerified: boolean;
  backedUp: boolean;
  /** The BE flag as this assertion reported it: the staff flows refuse a key that reports it at any use (3a design, section 2). */
  backupEligible: boolean;
}

/**
 * Verifies an assertion against a stored passkey, whose challenge the caller has already read and spent. The library is
 * given a stored counter of 0, so it never refuses on a counter: it would do that before checking the signature, and an
 * unsigned response could then pass for a clone. The caller applies isCounterRegression once the signature has checked.
 */
export async function verifyAuthentication(input: {
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
  origins: string[];
  rpId: string;
  /** The stored passkey: its credential id and COSE public key as base64url, and its transports. */
  credential: { id: string; publicKey: string; transports: string[] };
}): Promise<VerifiedAuthentication> {
  let result: VerifiedAuthenticationResponse;
  try {
    result = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.origins,
      expectedRPID: input.rpId,
      credential: { id: input.credential.id, publicKey: isoBase64URL.toBuffer(input.credential.publicKey), counter: 0, transports: input.credential.transports },
      requireUserVerification: false,
    });
  } catch {
    throw invalid();
  }
  if (!result.verified) throw invalid();
  const info = result.authenticationInfo;
  return { newCounter: info.newCounter, userVerified: info.userVerified, backedUp: info.credentialBackedUp, backupEligible: info.credentialDeviceType === "multiDevice" };
}

/**
 * WebAuthn L3, section 6.1.1: a signature counter that did not move past the stored one suggests a copy of the key.
 * Two zeros are not a regression: Apple passkeys, like other synced ones, always report 0.
 */
export function isCounterRegression(stored: number, next: number): boolean {
  return (next > 0 || stored > 0) && next <= stored;
}

/**
 * The challenge a ceremony's client data names. The flows run readChallenge and spendChallenge on it before any
 * verification, so a response to a forged, foreign or spent challenge never reaches the library.
 */
export function readResponseChallenge(response: { response: { clientDataJSON: string } }): string {
  const { clientDataJSON } = response.response;
  if (typeof clientDataJSON !== "string" || clientDataJSON.length > MAX_CLIENT_DATA_CHARS) throw invalid();
  let challenge: unknown;
  try {
    const clientData: unknown = decodeClientDataJSON(clientDataJSON);
    challenge = typeof clientData === "object" && clientData !== null ? (clientData as { challenge?: unknown }).challenge : undefined;
  } catch {
    throw invalid();
  }
  if (typeof challenge !== "string" || challenge.length === 0 || challenge.length > MAX_CHALLENGE_CHARS) throw invalid();
  return challenge;
}
```

### Replace `apps/api/src/auth/repo.ts` (whole file)

```ts
import { and, desc, eq, getTableColumns, gt, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
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

### Replace `apps/api/src/cli/grant-role.ts` (whole file)

```ts
/**
 * Changes an account's role. Run on the server only; there is no API endpoint for this.
 *
 *   docker compose -f infra/compose.yml run --rm api node dist/grant-role.js <email> <user|moderator|admin>
 *
 * Every session and staff session of the account is revoked and every unused staff enrolment link deleted; a change to
 * user also revokes every staff key, and the owner is mailed their names (3a design, section 7). The change is written to
 * public.audit_log in the same transaction. A mail that fails is printed as a warning and undoes nothing.
 */
import { pathToFileURL } from "node:url";
import Redis from "ioredis";
import { Email, Role } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createAuthRepo, createSessions, grantRole, redisKv, type KeyValueStore, type UserRole } from "../auth";
import { loadConfig } from "../config";
import type { Mailer } from "../mail/mailer";
import { LOCK_TIMEOUT_ADVICE, isLockTimeout } from "./lock-timeout";
import { commandLineMailer } from "./mail";

/** Audit-log actor for changes made from the server console rather than by a signed-in person; the auth module writes the row. */
export { SYSTEM_ACTOR_ID } from "../auth";
export const GRANT_ROLE_USAGE = "usage: node dist/grant-role.js <email> <user|moderator|admin>";

export function parseGrantRoleArgs(args: readonly string[]): { email: string; role: UserRole } {
  if (args.length !== 2) throw new Error(GRANT_ROLE_USAGE);
  const email = Email.safeParse(args[0]);
  if (!email.success) throw new Error(`not an email address: ${args[0]}\n${GRANT_ROLE_USAGE}`);
  const role = Role.safeParse(args[1]);
  if (!role.success) throw new Error(`unknown role: ${args[1]}\n${GRANT_ROLE_USAGE}`);
  return { email: email.data, role: role.data };
}

/**
 * The role change and its audit rows in one transaction on the auth role, then the tombstones and the mail; grant-role
 * opens no pool on the API's role.
 */
export async function runGrantRole(deps: { authDb: Db; kv: KeyValueStore; mailer: Mailer }, email: string, role: UserRole) {
  const repo = createAuthRepo(deps.authDb);
  const sessions = createSessions({ repo, kv: deps.kv });
  try {
    return await grantRole({ repo, sessions, mailer: deps.mailer }, email, role);
  } catch (err) {
    if (isLockTimeout(err)) throw new Error(`grant-role changed nothing: ${LOCK_TIMEOUT_ADVICE}`, { cause: err });
    throw err;
  }
}

async function main(): Promise<number> {
  let parsed: { email: string; role: UserRole };
  try {
    parsed = parseGrantRoleArgs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }
  const config = loadConfig();
  const authDb = createDb(config.DATABASE_URL_AUTH, { max: 1 });
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
  try {
    // The same mailer as the staff command line's, built as the API builds its own.
    const granted = await runGrantRole({ authDb, kv: redisKv(redis), mailer: commandLineMailer(process.env) }, parsed.email, parsed.role);
    console.log(
      `user ${granted.userId}: role ${granted.previousRole} -> ${parsed.role}; every session revoked; ` +
        `${granted.staffSessionsRevoked} staff sessions and ${granted.staffKeysRevoked} staff keys revoked, ${granted.enrollmentsDeleted} unused enrolment links deleted`,
    );
    if (granted.mailError !== null) console.error(`warning: the staff_keys_revoked mail to the account could not be sent (${granted.mailError}); the change stands`);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await Promise.allSettled([closeDb(authDb), redis.quit()]);
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void main().then((code) => {
    process.exitCode = code;
  });
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
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js audit-head
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js audit-verify [<chain_seq>:<hash> ...]
 *
 * enroll prints a one-time link that registers one staff key for a live staff account with a handle; the database lets
 * only the migrator issue one. keys lists an account's staff keys, or every staff account with its keys, for the
 * runbook's comparison with the operator's own list.
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
import { SYSTEM_ACTOR_ID } from "../auth";
import { consoleHostOf, consoleOriginSetting, consoleRpIdSetting, databaseUrl } from "../config";
import { CHAIN_ZERO_HASH, canonicalText, chainHash } from "../staff";
import { LOCK_TIMEOUT_ADVICE, isLockTimeout } from "./lock-timeout";

export const STAFF_USAGE = [
  "usage: node dist/staff.js <command>",
  "  enroll <email>                         print a one-time link, valid 30 minutes, that registers one staff key for the account;",
  "                                         run it in the migrate service: docker compose -f infra/compose.yml run --rm migrate node dist/staff.js enroll <email>",
  "  keys [<email>]                         list the account's staff keys, or every staff account with its role, address, handle and keys",
  "  audit-head                             print the audit log's newest place, its hash and its time, to keep off the server",
  "  audit-verify [<chain_seq>:<hash> ...]  recompute the audit chain and check it against places kept before",
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
  | { command: "audit-verify"; kept: KeptPlace[] };

/** A place as the keeper copies it: at most 15 digits, so it is always a safe integer, and a lower-case hex sha256. */
const KEPT_PLACE = /^([1-9][0-9]{0,14}):([0-9a-f]{64})$/;

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
export function staffDatabaseUrls(command: Exclude<StaffCommand, { command: "enroll" }>, env: Record<string, string | undefined>): { api: string; auth: string | null } {
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

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void runStaffCommand(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
```

### Replace `apps/api/src/config.ts` (whole file)

```ts
import { isIP } from "node:net";
import { z } from "zod";
import { parseFormats } from "@korbat/media-protocol";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** A base64 secret that decodes to at least 32 bytes. */
const base64Key = z
  .string()
  .regex(BASE64, "must be base64")
  .refine((s) => Buffer.from(s, "base64").length >= 32, "must decode to at least 32 bytes");

/** `v<N>:<base64>` decoding to exactly 32 bytes (AES-256). The version lets keys rotate. */
const versionedKey = z
  .string()
  .regex(/^v\d+:[A-Za-z0-9+/]+={0,2}$/, "must look like v1:<base64>")
  .refine((s) => Buffer.from(s.slice(s.indexOf(":") + 1), "base64").length === 32, "must decode to exactly 32 bytes");

/** Cloudflare's documented Turnstile test secrets: always pass, always fail, token spent. */
const TURNSTILE_TEST_SECRET = /^[123]x0+AA$/;

/** A secret that may be absent. Compose passes a blank line of infra/.env as an empty string, which counts as absent too. */
const optionalSecret = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined));

/** A setting whose blank value means "use the default": compose passes a variable infra/.env leaves empty as an empty string. */
const blankAsUnset = z
  .string()
  .optional()
  .transform((value) => (value?.trim() ? value.trim() : undefined));

/**
 * A domain name as WebAuthn takes an RP ID: dot-separated labels of letters, digits and hyphens, each at most 63
 * characters and neither starting nor ending with a hyphen; no scheme, port, path or final dot.
 */
const RP_ID = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** Printable text: no control, format, private-use or unassigned characters, and no line or paragraph separators. */
const PRINTABLE = /^[^\p{C}\p{Zl}\p{Zp}]+$/u;

/** The host of an origin as an RP ID would name it: lowercase, without the port or the brackets of an IPv6 address. */
function hostOf(origin: string): string {
  return new URL(origin).hostname.replace(/^\[(.*)\]$/, "$1");
}

/** localhost and its subdomains (RFC 6761): names that only ever mean this machine. */
function isLocalhost(name: string): boolean {
  return name === "localhost" || name.endsWith(".localhost");
}

/** Whether two values name the same origin, so `http://a.test/` and `http://a.test` count as one. An unparsable value is compared as written. */
function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return a === b;
  }
}

/**
 * The staff console's origin (3a design, section 8), written exactly as a browser sends it in the Origin header: http or
 * https, a host and a port only when it is not the default, lowercase, with no path, not even a final slash. The staff gate
 * compares the Origin header with it as a string, so any other spelling would refuse every write the console makes.
 */
const consoleOrigin = z
  .url({ protocol: /^https?$/ })
  .refine((value) => URL.canParse(value) && new URL(value).origin === value, "must be an origin as browsers send it, such as https://console.example: scheme, lowercase host and port only, with no path or final slash");

/** A PostgreSQL connection URL. The staff command line reads the database URLs it needs with the same rule (cli/staff.ts). */
export const databaseUrl = z.url({ protocol: /^postgres(ql)?$/ });

/** The mail relay and the sender, which the command line's mailer reads with the same rules (cli/mail.ts). */
export const smtpUrl = z.url({ protocol: /^smtps?$/ });
export const mailFrom = z.string().min(3);

/**
 * CONSOLE_ORIGIN and CONSOLE_RP_ID as `staff.js enroll` reads them, by the API's own rules for each value (cli/staff.ts),
 * so a link is issued only for a console the API would run.
 */
export const consoleOriginSetting = blankAsUnset.pipe(consoleOrigin.optional());
export const consoleRpIdSetting = blankAsUnset.pipe(z.string().toLowerCase().regex(RP_ID, "must be a bare domain name such as console.example: no scheme, port or path").optional());

/** The console's hostname, which CONSOLE_RP_ID defaults to. */
export const consoleHostOf = (origin: string): string => hostOf(origin);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL_API: databaseUrl,
  DATABASE_URL_AUTH: databaseUrl,
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  TRUSTED_ORIGINS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  KORBAT_VERSION: z.string().default("0.0.0-dev"),
  /**
   * Which header names the client: `cloudflare` behind the tunnel (cf-connecting-ip), `caddy` behind Caddy
   * alone (the first X-Forwarded-For entry, which Caddy sets itself), `none` for the socket address only.
   * A header the mode does not trust is ignored, so a client cannot choose its own rate-limit bucket.
   */
  TRUST_PROXY: z.enum(["cloudflare", "caddy", "none"]).default("none"),
  /** Origin of the web app; state-changing cookie requests must come from here (or TRUSTED_ORIGINS). */
  APP_ORIGIN: z.url({ protocol: /^https?$/ }),
  /** Keys email codes, recovery codes, device ids and email rate-limit buckets. */
  AUTH_HMAC_KEY: base64Key,
  /** Keys IP addresses before they are stored or used as rate-limit buckets. */
  IP_HASH_KEY: base64Key,
  /** Encrypts TOTP secrets at rest. */
  TOTP_ENC_KEY: versionedKey,
  /** Earlier TOTP keys, comma-separated, still accepted for decryption; a secret read with one is re-encrypted with TOTP_ENC_KEY. */
  TOTP_ENC_KEYS_PREVIOUS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(versionedKey)),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  SMTP_URL: smtpUrl,
  MAIL_FROM: mailFrom,
  TERMS_VERSION: z.string().min(1).max(64),
  /** The uploads volume, which the API writes and the image worker only reads. The default suits `pnpm dev` from apps/api. */
  MEDIA_UPLOADS_DIR: z.string().min(1).default("../../.data/media/uploads"),
  /** The store volume, which the image worker writes and the API only reads. */
  MEDIA_STORE_DIR: z.string().min(1).default("../../.data/media/store"),
  /** A comma-separated subset of jpeg, png, webp, gif, avif; unset enables all. The worker reads the same variable. */
  MEDIA_FORMATS: z
    .string()
    .optional()
    .transform((value, ctx) => {
      try {
        return parseFormats(value);
      } catch (err) {
        ctx.addIssue({ code: "custom", message: (err as Error).message });
        return z.NEVER;
      }
    }),
  /** Uploads are refused while either media volume has less free space than this. The volumes share a disk with Postgres. */
  MEDIA_MIN_FREE_BYTES: z.coerce.number().int().nonnegative().default(2 * 1024 ** 3),
  /**
   * The sweeper's reconcile pass deletes images that have no row. `on` refuses when there are many of them
   * (a database restored from an older snapshot looks like that); `force` deletes anyway; `off` skips the pass,
   * for the restore window.
   */
  MEDIA_RECONCILE: z.enum(["on", "off", "force"]).default("on"),
  /**
   * Who checks the phone number behind the verified badge: `off` hides the badge, `dev` accepts the code
   * 000000 and nothing else (development only), `vonage` texts a real code through Vonage Verify with the
   * two credentials below.
   */
  VERIFY_PROVIDER: z.enum(["off", "dev", "vonage"]).default("off"),
  VONAGE_API_KEY: optionalSecret,
  VONAGE_API_SECRET: optionalSecret,
  /** The sender name in the verification text. Vonage allows 1 to 18 characters and none of / { } : $. */
  VERIFY_BRAND: z.string().min(1).max(18).regex(/^[^\/{}:$]*$/, "must not contain / { } : or $").default("korbat"),
  /**
   * The relying party ID every passkey is bound to (1c design, section 11): the host of APP_ORIGIN when unset, or a
   * parent domain of it, which subdomains can then share. Changing it later strands every passkey already added.
   */
  WEBAUTHN_RP_ID: blankAsUnset.pipe(z.string().toLowerCase().regex(RP_ID, "must be a bare domain name such as korbat.example: no scheme, port or path").optional()),
  /** The site name password managers show next to a korbat passkey. */
  WEBAUTHN_RP_NAME: blankAsUnset.pipe(z.string().max(64).regex(PRINTABLE, "must be printable: no control or invisible characters").default("korbat")),
  /**
   * The staff console's own origin (3a design, section 8). Unset, the console is off: no staff route is mounted and the
   * command line issues no enrolment. A blank value, as compose passes it, counts as unset.
   */
  CONSOLE_ORIGIN: consoleOriginSetting,
  /**
   * The relying party ID staff keys are bound to: the console's hostname when unset. Production requires exactly that
   * hostname, so staff keys work on the console and nowhere else; a parent domain was declined (3a design, section 2).
   */
  CONSOLE_RP_ID: consoleRpIdSetting,
}).superRefine((c, ctx) => {
  const refuse = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  // In every environment: an origin the app trusts is an allowed Origin for the app's cookie writes, a credentialed CORS
  // origin of the app's API and, outside production, an accepted origin for personal passkeys (3a design, section 8).
  if (c.CONSOLE_ORIGIN !== undefined) {
    if (sameOrigin(c.CONSOLE_ORIGIN, c.APP_ORIGIN)) refuse("CONSOLE_ORIGIN", "CONSOLE_ORIGIN must not be APP_ORIGIN: the staff console needs an origin of its own");
    if (c.TRUSTED_ORIGINS.some((origin) => sameOrigin(origin, c.CONSOLE_ORIGIN!))) {
      refuse("CONSOLE_ORIGIN", "CONSOLE_ORIGIN must not be listed in TRUSTED_ORIGINS: the app would accept the console's requests as its own");
    }
  }
  if (c.NODE_ENV !== "production") return;
  if (TURNSTILE_TEST_SECRET.test(c.TURNSTILE_SECRET_KEY)) refuse("TURNSTILE_SECRET_KEY", "is a Turnstile test secret; production needs the secret of your own widget");
  if (!c.APP_ORIGIN.startsWith("https://")) refuse("APP_ORIGIN", "must be an https origin in production");
  for (const origin of c.TRUSTED_ORIGINS) if (!origin.startsWith("https://")) refuse("TRUSTED_ORIGINS", `${origin} is not an https origin`);
  // The development provider would hand the badge to anyone who types 000000.
  if (c.VERIFY_PROVIDER === "dev") refuse("VERIFY_PROVIDER", "VERIFY_PROVIDER=dev is for development only");
  if (c.VERIFY_PROVIDER === "vonage") {
    if (!c.VONAGE_API_KEY) refuse("VONAGE_API_KEY", "is required when VERIFY_PROVIDER is vonage");
    if (!c.VONAGE_API_SECRET) refuse("VONAGE_API_SECRET", "is required when VERIFY_PROVIDER is vonage");
  }
  // Browsers accept an RP ID only on its own host or a subdomain of it, and never an address; localhost would
  // bind every passkey to one machine. The dot keeps a bare top-level name out (browsers refuse public suffixes
  // such as co.uk themselves).
  const host = hostOf(c.APP_ORIGIN);
  const rpId = c.WEBAUTHN_RP_ID ?? host;
  if (isIP(rpId) || isIP(host)) {
    refuse("WEBAUTHN_RP_ID", "WEBAUTHN_RP_ID cannot be an IP address, nor can APP_ORIGIN name one: WebAuthn refuses them, so production needs a domain name");
  } else if (isLocalhost(rpId) || isLocalhost(host)) {
    refuse("WEBAUTHN_RP_ID", "WEBAUTHN_RP_ID cannot be localhost in production, nor can APP_ORIGIN name it");
  } else if (rpId !== host && !(host.endsWith(`.${rpId}`) && rpId.includes("."))) {
    refuse("WEBAUTHN_RP_ID", `WEBAUTHN_RP_ID must be the host of APP_ORIGIN (${host}) or a parent domain of it that has a dot`);
  }
  if (c.CONSOLE_ORIGIN === undefined) return;
  if (!c.CONSOLE_ORIGIN.startsWith("https://")) refuse("CONSOLE_ORIGIN", "CONSOLE_ORIGIN must be an https origin in production");
  const consoleHost = hostOf(c.CONSOLE_ORIGIN);
  // Ports separate neither sites nor cookies, so the console needs a hostname of its own. On a parent domain of the app's
  // hostname, the app's pages could ask for staff keys, whose relying party ID would then cover the app.
  if (consoleHost === host) refuse("CONSOLE_ORIGIN", `CONSOLE_ORIGIN must not be on the hostname of APP_ORIGIN (${host}), whatever its port`);
  if (host.endsWith(`.${consoleHost}`)) refuse("CONSOLE_ORIGIN", `APP_ORIGIN's hostname must not be a subdomain of the console's (${consoleHost})`);
  // The relying-party rules, like the app's above, bind staff keys to the console alone.
  const consoleRpId = c.CONSOLE_RP_ID ?? consoleHost;
  if (isIP(consoleHost) || isLocalhost(consoleHost)) {
    refuse("CONSOLE_RP_ID", "CONSOLE_RP_ID cannot be an IP address or localhost in production, nor can CONSOLE_ORIGIN name one: production needs a domain name");
  } else if (consoleRpId !== consoleHost) {
    refuse("CONSOLE_RP_ID", `CONSOLE_RP_ID must be the hostname of CONSOLE_ORIGIN (${consoleHost}) in production`);
  }
  if (consoleRpId === rpId) refuse("CONSOLE_RP_ID", `CONSOLE_RP_ID must differ from the app's relying party ID (${rpId}), so staff keys never work in the app`);
}).transform((c) => ({
  ...c,
  WEBAUTHN_RP_ID: c.WEBAUTHN_RP_ID ?? hostOf(c.APP_ORIGIN),
  CONSOLE_RP_ID: c.CONSOLE_RP_ID ?? (c.CONSOLE_ORIGIN === undefined ? undefined : hostOf(c.CONSOLE_ORIGIN)),
}));

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
```

### Replace `apps/api/src/index.ts` (whole file)

```ts
import { serve } from "@hono/node-server";
import Redis from "ioredis";
import { closeDb, createDb, ping } from "@korbat/db";
import { createAccount } from "./account";
import { createApp } from "./app";
import { createAuth, verificationProviderFrom } from "./auth";
import { loadConfig } from "./config";
import { redisJobLock } from "./lib/jobs";
import { createLogger } from "./lib/logger";
import { smtpMailer } from "./mail/smtp";
import { createMedia } from "./media";
import { RedisStore } from "./middleware/rate-limit";
import { createProfileStore } from "./profiles/store";
import { createSocial, enforceWriteLimit } from "./social";
import { createStaff } from "./staff";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === "development");

const apiDb = createDb(config.DATABASE_URL_API);
const authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
redis.on("error", (err) => logger.error({ err }, "redis error"));
const rateLimitStore = new RedisStore(redis);

const auth = createAuth({
  config,
  logger,
  authDb,
  redis,
  mailer: smtpMailer(config.SMTP_URL, config.MAIL_FROM, { requireTls: config.NODE_ENV === "production" }),
  profiles: createProfileStore(apiDb),
  // Null when VERIFY_PROVIDER is off: the badge routes then answer badge_unavailable and the app hides the section.
  verify: verificationProviderFrom(config),
});

const media = createMedia({
  apiDb,
  uploadsDir: config.MEDIA_UPLOADS_DIR,
  storeDir: config.MEDIA_STORE_DIR,
  formats: config.MEDIA_FORMATS,
  minFreeBytes: config.MEDIA_MIN_FREE_BYTES,
  reconcile: config.MEDIA_RECONCILE,
  logger,
  requireSession: auth.requireSession,
  resolveSession: auth.resolveSession,
  rateLimitStore,
  enforceUploadLimit: (userId, accountCreatedAt, now) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, now),
});
await media.prepare();
// Background work runs on one API instance at a time, under locks in Redis that are refreshed while a round runs.
const jobLock = redisJobLock(redis);
const stopSweeper = media.startSweeper(jobLock);
const stopJanitor = auth.startJanitor(jobLock);

const social = createSocial({
  apiDb,
  rateLimitStore,
  logger,
  requireSession: auth.requireSession,
  requireFreshAuth: auth.requireFreshAuth(),
  media: media.forPosts,
  // Profile and handle changes are security events; the social module hands them to the auth module, which owns the table.
  events: { append: auth.appendEvent },
});
// Explore's ranking: a round at once, so Explore is filled on a new database or after downtime, then one every five minutes.
const stopExplore = social.startExplore(jobLock);

// The account module owns no table: it reaches the three modules above only through the interfaces their index files export.
const account = createAccount({
  auth: auth.forAccount,
  social: social.forAccount,
  media: media.forAccount,
  requireSession: auth.requireSession,
  requireFreshAuth: auth.requireFreshAuth(),
  requireStrongFreshAuth: auth.requireStrongFreshAuth(),
  rateLimitStore,
  logger,
});
// Deletions the process did not finish (a crash after the auth step, a failed purge) are completed within five minutes.
const stopPurge = account.startPurge(jobLock);

// The staff console's API; createApp mounts it only while CONSOLE_ORIGIN is set. Its credential work is the auth module's.
const staff = createStaff({ apiDb, auth: auth.forStaff });

const app = createApp({
  config,
  logger,
  rateLimitStore,
  healthChecks: {
    postgres_api: () => ping(apiDb),
    postgres_auth: () => ping(authDb),
    redis: async () => { await redis.ping(); },
  },
  advisoryChecks: { image_worker: media.healthCheck },
  auth,
  social,
  media,
  account,
  staff,
});

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0" }, (info) => {
  logger.info({ port: info.port, version: config.KORBAT_VERSION }, "api listening");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  stopSweeper();
  stopJanitor();
  stopExplore();
  stopPurge();
  server.close();
  await Promise.allSettled([closeDb(apiDb), closeDb(authDb), redis.quit()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
```

### Replace `apps/api/src/mail/mailer.ts` (whole file)

```ts
export type TemplateName =
  | "sign_in_code"
  | "sign_up_code"
  | "reauth_code"
  | "new_device"
  | "account_locked"
  | "mfa_enabled"
  | "mfa_disabled"
  | "password_changed"
  | "recovery_codes_regenerated"
  | "sessions_revoked_all"
  | "email_change_code"
  | "email_changed"
  | "email_change_reverted"
  | "badge_verified"
  | "badge_removed"
  | "delete_account_code"
  | "account_deleted"
  | "passkey_added"
  | "passkey_removed"
  | "passkey_suspect"
  | "recovery_code_used"
  // The staff console's mails (3a design, section 7): to the staff account's own address, and never with a link.
  | "staff_key_added"
  | "staff_session_started"
  | "staff_key_suspect"
  | "staff_keys_revoked";

export interface MailMessage {
  to: string;
  template: TemplateName;
  data: Record<string, string>;
}

export interface Mailer {
  /** Throws MailUnavailable when the message could not be handed to the relay. */
  send(message: MailMessage): Promise<void>;
}

export class MailUnavailable extends Error {}
```

### Replace `apps/api/src/mail/templates.ts` (whole file)

```ts
import type { TemplateName } from "./mailer";

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
}

function need(data: Record<string, string>, key: string): string {
  const value = data[key];
  if (value === undefined || value === "") throw new Error(`mail template data is missing "${key}"`);
  return value;
}

/** Plain paragraphs only: no images, no tracking, no anchor tags. URLs appear as text. */
function build(subject: string, paragraphs: string[]): RenderedMail {
  return {
    subject,
    text: `${paragraphs.join("\n\n")}\n`,
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">${paragraphs
      .map((p) => `<p>${escapeHtml(p)}</p>`)
      .join("")}</body></html>`,
  };
}

export function renderTemplate(template: TemplateName, data: Record<string, string>): RenderedMail {
  switch (template) {
    case "sign_in_code":
      return build("Your korbat sign-in code", [
        `Your sign-in code is ${need(data, "code")}.`,
        "It expires in 10 minutes. If you did not try to sign in, you can ignore this email; nobody can sign in without the code.",
      ]);
    case "sign_up_code":
      return build("Your korbat sign-up code", [
        `Your sign-up code is ${need(data, "code")}.`,
        "It expires in 10 minutes. If you did not try to create a korbat account, you can ignore this email.",
      ]);
    case "reauth_code":
      return build("Confirm it's you on korbat", [
        `Your confirmation code is ${need(data, "code")}.`,
        "It expires in 10 minutes. korbat asks for it before sensitive account changes.",
      ]);
    case "new_device":
      // The link runs the lockdown anchored at this sign-in (1c design, section 7.6): it reaches back a day, so a
      // passkey or two-factor set up just before, from the same stolen session, goes with it.
      return build("New sign-in to your korbat account", [
        `Your account was just signed in from a new device: ${need(data, "deviceLabel")}.`,
        "If this was you, there is nothing to do.",
        `If this was not you, open this link within 24 hours. It signs out every session, removes your password, and turns off every passkey and two-factor authentication set up since the day before this sign-in; then you sign in with a code sent to this address: ${need(data, "notMeUrl")}`,
      ]);
    case "account_locked":
      return build("Password sign-in paused on your korbat account", [
        `After several wrong passwords, password sign-in is paused for ${need(data, "minutes")} minutes.`,
        "You can still sign in with an emailed code. If you did not try to sign in, consider turning on two-factor authentication.",
      ]);
    case "mfa_enabled":
      return build("Two-factor authentication is on for your korbat account", [
        "Two-factor authentication was just turned on for your korbat account, and a new set of recovery codes was issued.",
        "If this was you, there is nothing to do. If not, sign in, open Security, and review your sessions and devices.",
      ]);
    case "mfa_disabled":
      return build("Two-factor authentication is off for your korbat account", [
        "Two-factor authentication was just turned off for your korbat account.",
        "If this was you, there is nothing to do. If not, sign in, open Security, turn it back on and sign out everywhere.",
      ]);
    case "password_changed":
      return build("Your korbat password changed", [
        "The password of your korbat account was just set or changed.",
        "If this was you, there is nothing to do. If not, sign in with an emailed code, open Security, set a new password and sign out everywhere.",
      ]);
    case "recovery_codes_regenerated":
      return build("New recovery codes for your korbat account", [
        "A new set of recovery codes was just issued for your korbat account. The old codes no longer work.",
        "If this was you, there is nothing to do. If not, sign in, open Security, and review your sessions and devices.",
      ]);
    case "sessions_revoked_all":
      return build("Signed out everywhere on korbat", [
        `Every session of your korbat account was just signed out (${need(data, "count")} in total).`,
        "If this was you, there is nothing to do. If not, sign in and set a new password.",
      ]);
    case "email_change_code":
      return build("Confirm your new korbat email address", [
        `Your confirmation code is ${need(data, "code")}.`,
        "It expires in 10 minutes. If you did not ask to move a korbat account to this address, you can ignore this email; nothing changes without the code.",
      ]);
    case "email_changed":
      // The undo link goes with the first change in a day only (flows/email-change.ts); a later change in that day
      // says where the link that works went, because signing in here is no longer possible.
      return build("Your korbat email address changed", [
        `The email address of your korbat account was just changed to ${need(data, "email")}. This address no longer belongs to the account.`,
        "Every session stays signed in. If this was you, there is nothing to do.",
        data.revertUrl
          ? `If this was not you, open this link within 24 hours. It moves the account back to this address, signs out every session, removes the password, and turns off every passkey and two-factor authentication set up since the day before the change; then you sign in with a code sent to this address: ${data.revertUrl}`
          : "If this was not you: the address had already changed less than a day ago, and the link sent then, to the address the account had before, can still move the account back there and sign out every session.",
      ]);
    case "email_change_reverted":
      return build("Your korbat account is back at this address", [
        "Your korbat account is back at this address, moved back from the link sent when its address changed, and every session was signed out.",
        "Sign in with a code sent to this address. The password was removed, and every passkey and two-factor authentication set up since the day before the change was turned off; set them up again from Security.",
      ]);
    case "badge_verified":
      return build("Your korbat account is verified", [
        "Your phone number was just confirmed, and your korbat account now shows the verified badge.",
        "korbat keeps only a keyed hash of the number, never the number itself. If this was not you, sign in, open Account, and remove the badge.",
      ]);
    case "badge_removed":
      return build("The verified badge was removed from your korbat account", [
        "The verified badge was just removed from your korbat account, and the phone number behind it was forgotten.",
        "If this was you, there is nothing to do. If not, sign in, open Security, and review your sessions and devices.",
      ]);
    case "delete_account_code":
      return build("Confirm deleting your korbat account", [
        `Someone asked to delete your korbat account. The confirmation code is ${need(data, "code")}.`,
        "It expires in 10 minutes. Deleting the account removes your posts, images and profile for good; nothing happens without the code.",
        "If this was not you, do not enter the code: sign in, open Security, and revoke your other sessions.",
      ]);
    case "account_deleted":
      return build("Your korbat account was deleted", [
        "Your korbat account was deleted as you asked. Your posts, images and profile are gone, and your handle stays reserved so nobody can take it.",
        "This cannot be undone. Thank you for having been part of korbat; you are welcome back with a new account any time.",
      ]);
    case "passkey_added":
      // The link runs the lockdown anchored at the passkey's creation (1c design, section 7.6): it reaches back a day,
      // so a password or two-factor set up just before the passkey, from the same stolen session, goes with it.
      return build("A passkey was added to your korbat account", [
        `A passkey named "${need(data, "name")}" was added to your korbat account from ${need(data, "deviceLabel")} at ${need(data, "time")}.`,
        "If this was you, there is nothing to do.",
        `If this was not you, open this link within 7 days. It removes this passkey, signs out every session, removes your password, and turns off every passkey and two-factor authentication set up since the day before this one was added; then you sign in with a code sent to this address: ${need(data, "removeUrl")}`,
      ]);
    case "passkey_removed":
      return build("A passkey was removed from your korbat account", [
        `The passkey named "${need(data, "name")}" was removed from your korbat account at ${need(data, "time")}. It can no longer sign in.`,
        "If this was you, there is nothing to do. If not, sign in, open Security, and review your passkeys, sessions and devices.",
      ]);
    case "passkey_suspect":
      // A counter that went backwards (1c design, section 2): the signature was right, so someone holds the key, and
      // either the authenticator was cloned or a backup was restored. Only the owner can tell, so the key stays off.
      return build("A passkey on your korbat account was switched off", [
        `A sign-in just used what looks like a copy of your passkey named "${need(data, "name")}", so korbat switched that passkey off. It can no longer sign in.`,
        "Sign in with a code sent to this address, open Security, remove it and add a new one. If you did not try to sign in just now, also review your sessions and devices.",
      ]);
    case "recovery_code_used":
      // A code spent at re-authentication (1c design, section 7.2): each of the ten works once, so the owner should know the count is down.
      return build("A recovery code was used on your korbat account", [
        "A recovery code was just used to confirm it's you on your korbat account. Each code works once; set up two-factor authentication again from Security to get a new set.",
        "If this was not you, sign in, open Security, sign out everywhere and set up two-factor authentication again.",
      ]);
    case "staff_key_added":
      return staffMail("A staff key was added to your korbat staff account", [
        `A staff key named "${need(data, "name")}" was registered for your korbat staff account at ${need(data, "time")}. It can open the staff console.`,
        "If this was you, there is nothing to do. If not, tell the operator at once; they revoke the key with the staff command line.",
      ]);
    case "staff_session_started":
      return staffMail("A staff session started on the korbat console", [
        `A staff session was started on the korbat console at ${need(data, "time")} with your staff key "${need(data, "name")}", from ${need(data, "browser")}.`,
        "If this was you, there is nothing to do. If not, someone holds that key: tell the operator at once; they revoke it and every session it opened with the staff command line.",
      ]);
    case "staff_key_suspect":
      // A counter that went backwards on a staff key (3a design, section 7): never passkey_suspect, whose remedy is the
      // app's Security screen; only the operator can enrol a replacement.
      return staffMail("A staff key on your korbat staff account was switched off", [
        `A use of your staff key "${need(data, "name")}" on the korbat console (a sign-in or a confirmation) looked like a copy of it, so korbat switched that key off and ended every staff session it opened. It can no longer open the console.`,
        "Ask the operator for a link to register a new key. If you did not use it just now, tell them so: someone else holds a copy of the key.",
      ]);
    case "staff_keys_revoked":
      // `names` is the list of the revoked keys' names, each in quotes, as the sender joins them.
      return staffMail("Staff keys revoked on your korbat staff account", [
        `These staff keys of your korbat staff account were revoked at ${need(data, "time")}: ${need(data, "names")}. They can no longer open the console, and every staff session they opened has ended.`,
        "If you expected this, there is nothing to do. If not, ask the operator why.",
      ]);
  }
}

/**
 * A staff mail: plain paragraphs as every mail, closed by the sentence that no staff mail carries a link, so a message
 * that does carry one is known for a fake (3a design, section 7).
 */
function staffMail(subject: string, paragraphs: string[]): RenderedMail {
  return build(subject, [...paragraphs, "korbat never puts a link in a staff email."]);
}
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
    routes: (consoleOrigin: string) => staffRoutes(consoleOrigin, options.auth),
    /** One page of the audit log, newest first, as GET /api/staff/audit answers it. */
    readAudit: (query: AuditPageQuery) => auditPage(options.apiDb, query),
  };
}

export type Staff = ReturnType<typeof createStaff>;
```

### Replace `apps/api/src/staff/routes.ts` (whole file)

```ts
import { StaffEnrollOptionsRequest, StaffEnrollVerifyRequest } from "@korbat/contracts";
import { Hono, type Context } from "hono";
import type { AuthForStaff, StaffRequestContext } from "../auth";
import type { AppEnv } from "../env";
import { validate } from "../lib/validate";
import { staffGate } from "./gate";

/**
 * The staff routes (3a design, section 7), which createApp mounts at /api/staff only while CONSOLE_ORIGIN is set. The gate
 * stands in front of every path under it, /api/staff itself and the paths no route answers included, so a wrong Host is
 * the 404 of an unknown route there too. Handlers only validate, call the auth module's staff interface and shape the
 * answer. Enrolment is here so far; sign-in, sessions, the audit log and step-up join it with their flows.
 */
export function staffRoutes(consoleOrigin: string, auth: AuthForStaff) {
  const routes = new Hono<AppEnv>();
  routes.use("*", staffGate(consoleOrigin));

  // The client's address is hashed before any flow sees it, and the request's id goes to the audit rows it writes.
  const requestContext = (c: Context<AppEnv>): StaffRequestContext => ({
    ipHash: c.get("clientIpHash") ?? "direct",
    userAgent: c.req.header("user-agent"),
    requestId: c.get("requestId"),
  });

  // Enrolment needs no session: the link's one-time token is the credential, until a key is stored with it.
  routes.post("/enroll/options", validate("json", StaffEnrollOptionsRequest), async (c) => c.json(await auth.enrollOptions(c.req.valid("json"))));
  routes.post("/enroll/verify", validate("json", StaffEnrollVerifyRequest), async (c) => c.json(await auth.enrollVerify(c.req.valid("json"), requestContext(c))));

  return routes;
}
```

### Replace `infra/compose.yml` (whole file)

```yaml
name: korbat

x-logging: &logging
  driver: json-file
  options: { max-size: "20m", max-file: "5" }

x-node-common: &node-common
  restart: unless-stopped
  read_only: true
  tmpfs: ["/tmp"]
  security_opt: ["no-new-privileges:true"]
  logging: *logging

services:
  postgres:
    # PostgreSQL 18. From 18 on the image keeps the cluster under /var/lib/postgresql/<major>/docker, so
    # the volume is mounted one level up and a later major can pg_upgrade inside it. A cluster from the
    # earlier pgdata volume (PostgreSQL 16) is moved over by scripts/pg-major-upgrade.mjs.
    image: postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
    restart: unless-stopped
    logging: *logging
    mem_limit: 1g
    memswap_limit: 1g
    pids_limit: 256
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
      KORBAT_MIGRATE_DB_PASSWORD: ${KORBAT_MIGRATE_DB_PASSWORD}
      KORBAT_API_DB_PASSWORD: ${KORBAT_API_DB_PASSWORD}
      KORBAT_AUTH_DB_PASSWORD: ${KORBAT_AUTH_DB_PASSWORD}
    volumes:
      - pgdata18:/var/lib/postgresql
      - ./postgres/init:/docker-entrypoint-initdb.d:ro
    networks: [data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    # Valkey, the BSD-licensed fork of Redis, under the service name the URLs already use. A password
    # is required: nothing on the data network may read the session cache without it.
    image: valkey/valkey:9.1.2-alpine@sha256:48332870af354a799964c0012ae1194a0bf2bf894eb508f945810596dc2d8d11
    restart: unless-stopped
    logging: *logging
    mem_limit: 384m
    memswap_limit: 384m
    pids_limit: 64
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD:?set REDIS_PASSWORD in infra/.env}
    command: ["sh", "-c", "exec valkey-server --appendonly yes --maxmemory 256mb --maxmemory-policy noeviction --requirepass $$REDIS_PASSWORD"]
    volumes:
    # A fresh volume: Valkey 9 cannot read the RDB format 12 that Redis 7.4 wrote into `redisdata`, and that
    # volume held only transient state (limits, codes in flight, cached sessions, queued image jobs).
      - valkeydata:/data
    networks: [data]
    healthcheck:
      test: ["CMD-SHELL", "VALKEYCLI_AUTH=$$REDIS_PASSWORD valkey-cli ping | grep -q PONG"]
      interval: 5s
      timeout: 3s
      retries: 20

  migrate:
    <<: *node-common
    restart: "no"
    build:
      context: ..
      dockerfile: apps/api/Dockerfile
    command: ["node", "dist/migrate.js"]
    environment:
      DATABASE_URL_MIGRATE: postgres://korbat_migrate:${KORBAT_MIGRATE_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      MIGRATIONS_DIR: /app/migrations
      # `staff.js enroll` runs here, as the migrator, the one role the running API never holds, and records on each link
      # the console's origin and relying party ID it is issued for. Empty, the console is off and enroll refuses.
      CONSOLE_ORIGIN: ${API_CONSOLE_ORIGIN:-}
      CONSOLE_RP_ID: ${API_CONSOLE_RP_ID:-}
    networks: [data]
    depends_on:
      postgres: { condition: service_healthy }

  api:
    <<: *node-common
    build:
      context: ..
      dockerfile: apps/api/Dockerfile
      args:
        KORBAT_VERSION: ${KORBAT_VERSION:-0.0.0}
    mem_limit: 512m
    memswap_limit: 512m
    pids_limit: 256
    environment:
      # development or production, from infra/.env; production turns on the guards against test keys, plain-http
      # origins and a relay without TLS. The worker below always runs as production.
      NODE_ENV: ${KORBAT_ENV:?set KORBAT_ENV to development or production in infra/.env}
      PORT: "3000"
      LOG_LEVEL: ${API_LOG_LEVEL:-info}
      DATABASE_URL_API: postgres://korbat_api:${KORBAT_API_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      DATABASE_URL_AUTH: postgres://korbat_auth:${KORBAT_AUTH_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      TRUSTED_ORIGINS: ${API_TRUSTED_ORIGINS:-}
      # Which header names the client: the stack refuses to start without a choice.
      TRUST_PROXY: ${API_TRUST_PROXY:?set API_TRUST_PROXY in infra/.env}
      # Auth settings. The stack refuses to start while any of these is missing from infra/.env.
      APP_ORIGIN: ${API_APP_ORIGIN:?set API_APP_ORIGIN in infra/.env}
      AUTH_HMAC_KEY: ${API_AUTH_HMAC_KEY:?set API_AUTH_HMAC_KEY in infra/.env}
      IP_HASH_KEY: ${API_IP_HASH_KEY:?set API_IP_HASH_KEY in infra/.env}
      TOTP_ENC_KEY: ${API_TOTP_ENC_KEY:?set API_TOTP_ENC_KEY in infra/.env}
      TOTP_ENC_KEYS_PREVIOUS: ${API_TOTP_ENC_KEYS_PREVIOUS:-}
      TURNSTILE_SECRET_KEY: ${API_TURNSTILE_SECRET_KEY:?set API_TURNSTILE_SECRET_KEY in infra/.env}
      SMTP_URL: ${API_SMTP_URL:?set API_SMTP_URL in infra/.env}
      MAIL_FROM: ${API_MAIL_FROM:?set API_MAIL_FROM in infra/.env}
      TERMS_VERSION: ${API_TERMS_VERSION:?set API_TERMS_VERSION in infra/.env}
      # The verified badge's phone check. off (the default) hides the badge; vonage needs the two credentials.
      VERIFY_PROVIDER: ${API_VERIFY_PROVIDER:-off}
      VONAGE_API_KEY: ${API_VONAGE_API_KEY:-}
      VONAGE_API_SECRET: ${API_VONAGE_API_SECRET:-}
      VERIFY_BRAND: ${API_VERIFY_BRAND:-korbat}
      # Passkeys. Empty values leave the API's defaults: the host of APP_ORIGIN as the RP ID and korbat as the name.
      WEBAUTHN_RP_ID: ${API_WEBAUTHN_RP_ID:-}
      WEBAUTHN_RP_NAME: ${API_WEBAUTHN_RP_NAME:-}
      # Images. The API writes uploads and only reads what the worker stored.
      MEDIA_UPLOADS_DIR: /media/uploads
      MEDIA_STORE_DIR: /media/store
      MEDIA_FORMATS: ${MEDIA_FORMATS:-jpeg,png,webp,gif,avif}
      MEDIA_MIN_FREE_BYTES: ${MEDIA_MIN_FREE_BYTES:-2147483648}
      MEDIA_RECONCILE: ${MEDIA_RECONCILE:-on}
    volumes:
      - media-uploads:/media/uploads
      - media-store:/media/store:ro
    networks: [app, data]
    depends_on:
      migrate: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]
      interval: 10s
      timeout: 3s
      retries: 10

  # The image worker runs the decoder, the most exploitable code in the stack. It has no network at
  # all, no credentials and no capabilities: it reads uploads and writes the store, and that is
  # everything it can reach. The memory limit was sized on worst-case images (2b design, Research).
  worker:
    <<: *node-common
    build:
      context: ..
      dockerfile: apps/worker/Dockerfile
    network_mode: none
    cap_drop: [ALL]
    mem_limit: 768m
    memswap_limit: 768m
    cpus: 1.0
    pids_limit: 64
    tmpfs: ["/tmp:size=64m"]
    environment:
      NODE_ENV: production
      LOG_LEVEL: ${API_LOG_LEVEL:-info}
      MEDIA_UPLOADS_DIR: /media/uploads
      MEDIA_STORE_DIR: /media/store
      MEDIA_FORMATS: ${MEDIA_FORMATS:-jpeg,png,webp,gif,avif}
    volumes:
      - media-uploads:/media/uploads:ro
      - media-store:/media/store
    healthcheck:
      test: ["CMD", "node", "-e", "process.exit(Date.now() - JSON.parse(require('fs').readFileSync('/media/store/heartbeat', 'utf8')).at < 60000 ? 0 : 1)"]
      interval: 15s
      timeout: 5s
      retries: 4

  # Caddy serves the web app and proxies /api. It runs as its own user on port 8080, sees only the
  # API, and is the only thing cloudflared can reach.
  caddy:
    restart: unless-stopped
    read_only: true
    tmpfs: ["/tmp"]
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    logging: *logging
    mem_limit: 128m
    memswap_limit: 128m
    pids_limit: 64
    build:
      context: ..
      dockerfile: infra/caddy/Dockerfile
      args:
        EXPO_PUBLIC_TURNSTILE_SITE_KEY: ${WEB_TURNSTILE_SITE_KEY:?set WEB_TURNSTILE_SITE_KEY in infra/.env}
        KORBAT_ENV: ${KORBAT_ENV:?set KORBAT_ENV to development or production in infra/.env}
        TUNNEL: ${TUNNEL:-off}
        EXPO_PUBLIC_BADGE: ${WEB_BADGE:-off}
    depends_on:
      api: { condition: service_healthy }
    volumes:
      - caddy-data:/data
      - caddy-config:/config
    networks: [edge, app]

  cloudflared:
    image: cloudflare/cloudflared:2026.9.1@sha256:b269e8abd07a5bf6f3f4be65d5050b2174eca89c56a0241a8ff32a16aec454e4
    restart: unless-stopped
    read_only: true
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    logging: *logging
    profiles: ["tunnel"]
    command: ["tunnel", "--no-autoupdate", "run"]
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN}
    networks: [edge]
    depends_on:
      - caddy

# cloudflared reaches only Caddy, Caddy reaches only the API, and the API alone reaches the data services.
networks:
  edge:
  app:
  data:

volumes:
  # PostgreSQL 18. The earlier pgdata volume (PostgreSQL 16) stays until scripts/pg-major-upgrade.mjs has
  # moved it and you remove it by hand.
  pgdata18:
  valkeydata:
  # Uploads wait here for the worker and are deleted once processed. Nothing in it needs a backup.
  media-uploads:
  # The images korbat serves. Back it up together with the database.
  media-store:
  # Caddy's state, owned by its own user; the earlier root-owned caddydata and caddyconfig volumes can go.
  caddy-data:
  caddy-config:
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
apps/app test:       Tests  107 passed (107)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  520 passed | 370 skipped (890)
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
Tests  368 passed (368)
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

## Step 8: verify: compose-config

```bash
docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo config-ok
```

Expected output contains:

- `config-ok`

Observed on the dry run:

```text
config-ok
```

## Step 9: verify: staff-cli

```bash
node --check apps/api/dist/staff.js && node apps/api/dist/staff.js 2>&1 | grep -v -e ExperimentalWarning -e trace-warnings; echo staff-exit=${PIPESTATUS[0]}
```

Expected output contains:

- `usage: node dist/staff.js <command>`
- `enroll <email>`
- `keys [<email>]`
- `audit-verify [<chain_seq>:<hash> ...]`
- `staff-exit=2`

Observed on the dry run:

```text
usage: node dist/staff.js <command>
enroll <email>                         print a one-time link, valid 30 minutes, that registers one staff key for the account;
run it in the migrate service: docker compose -f infra/compose.yml run --rm migrate node dist/staff.js enroll <email>
keys [<email>]                         list the account's staff keys, or every staff account with its role, address, handle and keys
audit-verify [<chain_seq>:<hash> ...]  recompute the audit chain and check it against places kept before
staff-exit=2
```

## Step 10: verify: enroll-console-off

```bash
env -i PATH="$PATH" SYSTEMROOT="$SYSTEMROOT" node apps/api/dist/staff.js enroll someone@korbat.invalid 2>&1 | grep -v -e ExperimentalWarning -e trace-warnings; echo enroll-exit=${PIPESTATUS[0]}
```

Expected output contains:

- `CONSOLE_ORIGIN is not set: the staff console is off`
- `enroll-exit=1`

Observed on the dry run:

```text
CONSOLE_ORIGIN is not set: the staff console is off, so no enrolment link can be issued. Set API_CONSOLE_ORIGIN in infra/.env to the console's address (the migrate service reads it as CONSOLE_ORIGIN) and run the command 
enroll-exit=1
```

## Step 11: verify: audit-verify-dev

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

## Step 12: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/auth/admin.ts`
- `apps/api/src/auth/context.ts`
- `apps/api/src/auth/flows/notify.ts`
- `apps/api/src/auth/index.ts`
- `apps/api/src/auth/passkeys/challenge.ts`
- `apps/api/src/auth/passkeys/flows.ts`
- `apps/api/src/auth/passkeys/webauthn.ts`
- `apps/api/src/auth/repo.ts`
- `apps/api/src/auth/staff/enroll.ts`
- `apps/api/src/cli/grant-role.ts`
- `apps/api/src/cli/mail.ts`
- `apps/api/src/cli/staff.ts`
- `apps/api/src/config.ts`
- `apps/api/src/index.ts`
- `apps/api/src/mail/mailer.ts`
- `apps/api/src/mail/templates.ts`
- `apps/api/src/staff/index.ts`
- `apps/api/src/staff/routes.ts`
- `apps/api/test/auth/flow-harness.ts`
- `apps/api/test/auth/messages.test.ts`
- `apps/api/test/auth/passkey-challenge.test.ts`
- `apps/api/test/auth/passkey-webauthn.test.ts`
- `apps/api/test/cli-mail.test.ts`
- `apps/api/test/cli-staff.test.ts`
- `apps/api/test/integration/auth-flows-account.test.ts`
- `apps/api/test/integration/cli-grant-role.test.ts`
- `apps/api/test/integration/cli-staff-enroll.test.ts`
- `apps/api/test/integration/flow-harness.ts`
- `apps/api/test/integration/http-staff-enroll.test.ts`
- `apps/api/test/integration/staff-enroll.test.ts`
- `apps/api/test/integration/staff-enrolment.ts`
- `apps/api/test/integration/staff-fixtures.ts`
- `apps/api/test/integration/staff-lifecycle.test.ts`
- `apps/api/test/mail/templates.test.ts`
- `apps/api/test/staff/app-mount.test.ts`
- `infra/compose.yml`

## Step 13: commit

```bash
git add -A
git commit -q -m "feat(api,infra): staff keys and enrolment: staff.js enroll, run in the migrate service as the migrator, issues a 30-minute single-use link for a live staff account with a handle and records the console's origin and relying party ID on it; the console's enrolment options require user verification and offer a security key or this device, and verify refuses a key that reported no UV or BE after the library has checked it, keeping the link, then stores the key through auth.add_staff_key under the account's lock with its auth event and audit row in one transaction and mails its owner; staff routes answer staff_key_refused, never a passkey code; while the two relying party IDs are equal each kind's options exclude the other's credentials; staff.js keys lists keys with their AAGUID; a role change revokes every session and staff session and cancels open links, and a demotion revokes staff keys and mails their owner; the take-down revokes staff keys and sessions, blanks the keys' names and writes its record after account_deleted" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(api,infra): staff keys and enrolment: staff.js enroll, run in the migrate service as the migrator, issues a 30-minute single-use link for a live staff account with a handle and records the console's origin and relying party ID on it; the console's enrolment options require user verification and offer a security key or this device, and verify refuses a key that reported no UV or BE after the library has checked it, keeping the link, then stores the key through auth.add_staff_key under the account's lock with its auth event and audit row in one transaction and mails its owner; staff routes answer staff_key_refused, never a passkey code; while the two relying party IDs are equal each kind's options exclude the other's credentials; staff.js keys lists keys with their AAGUID; a role change revokes every session and staff session and cancels open links, and a demotion revokes staff keys and mails their owner; the take-down revokes staff keys and sessions, blanks the keys' names and writes its record after account_deleted`.

## Report format (mandatory)

```text
TASK 3 REPORT
Files written: <count, expected 36>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Verify "compose-config": <paste the expected lines as printed>
Verify "staff-cli": <paste the expected lines as printed>
Verify "enroll-console-off": <paste the expected lines as printed>
Verify "audit-verify-dev": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```

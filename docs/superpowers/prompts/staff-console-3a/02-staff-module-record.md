# korbat staff console (3a) — Task 2 of 9: The staff module and the audit record: chain.ts (the canonical text in Node with its test vectors), the audit writer and reader, the module mounted only while CONSOLE_ORIGIN is set and passed over the app's CORS and session, the staff gate, the architecture rules, staff.js audit-head and audit-verify with kept places, grant-role's change and record in one auth transaction, and the integration client's console mode

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-30 and 2026-10-01 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Task 1 laid the ground: the console's settings, the staff contracts and migration 0012 with the audit chain, its head and trigger and the migrator-owned functions. This task builds the staff module (`apps/api/src/staff/`): `chain.ts`, the audit writer and reader, its mounting in `createApp` behind the staff gate, `staff.js audit-head` and `audit-verify`, grant-role's single auth transaction, and the integration client's console mode. The design is `docs/superpowers/specs/2026-09-28-staff-console-3a-design.md` (sections 5, 6, 7 and 12).

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(contracts,db,api): the ground for the staff console: CONSOLE_ORIGIN and CONSOLE_RP_ID with their rules; the staff contracts and error codes; migration 0012 adds auth.staff_keys, staff_enrollments and staff_sessions, which korbat_auth can revoke but never create or revive, and seven staff event types, and turns the audit log into a hash chain: a migrator-owned trigger places every row under the head's lock, choosing its place, id and time itself, over the canonical text version 1, and the rows written before are chained in id order; auth.add_staff_key, auth.append_audit and auth.forget_staff_keys are the only ways the auth role writes them; the test harness writes the head row and the development cleaner keeps accounts that hold staff keys`.

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
python docs/superpowers/prompts/staff-console-3a/write_blocks.py docs/superpowers/prompts/staff-console-3a/02-staff-module-record.md 1
```

Expected: 11 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/cli-staff.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { STAFF_USAGE, parseStaffArgs, runStaffCommand, staffDatabaseUrls } from "../src/cli/staff";

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
    expect(STAFF_USAGE).toContain("audit-head");
    expect(STAFF_USAGE).toContain("audit-verify [<chain_seq>:<hash> ...]");
    // enroll, keys and revoke arrive with the tasks that build them.
    expect(STAFF_USAGE).not.toMatch(/enroll|revoke|\bkeys\b/);
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
    expect(() => parseStaffArgs(["enroll", "a@b.io"])).toThrow("unknown command: enroll");
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

  test("run with a database URL missing, it names it and answers 1", async () => {
    const { lines, out } = capture();
    expect(await runStaffCommand(["audit-verify"], { DATABASE_URL_API: API_URL }, out)).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^err Invalid environment for audit-verify:/);
    expect(lines[0]).toContain("DATABASE_URL_AUTH");
    expect(lines[0]).not.toMatch(/APP_ORIGIN|REDIS_URL|AUTH_HMAC_KEY/);
  });
});
```

### Create `apps/api/test/http-client.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { Browser, type RequestApp } from "./integration/http-client";

/** A stand-in for the app: records what the client sends and answers with the Set-Cookie lines it is given. */
function recorder(setCookies: string[] = []) {
  const requests: { url: string; headers: Record<string, string>; method: string }[] = [];
  const app: RequestApp = {
    request(url, init) {
      requests.push({ url, method: init?.method ?? "GET", headers: { ...(init?.headers as Record<string, string>) } });
      const headers = new Headers();
      for (const line of setCookies) headers.append("set-cookie", line);
      return new Response("{}", { headers });
    },
  };
  return { app, requests };
}

describe("the integration client's Browser", () => {
  test("by default it is the app's browser: http://localhost, echoing __Host-korbat_csrf in x-csrf-token", async () => {
    const { app, requests } = recorder(["__Host-korbat_csrf=app-csrf; Path=/; Secure; SameSite=Lax"]);
    const b = new Browser(app, "http://localhost:8081");
    await b.fetch("/api/auth/sessions");
    await b.fetch("/api/auth/signout", { json: {} });
    expect(requests[0]).toMatchObject({ url: "http://localhost/api/auth/sessions", method: "GET" });
    expect(requests[0]!.headers.host).toBe("localhost");
    expect(requests[0]!.headers.origin).toBeUndefined();
    expect(requests[1]).toMatchObject({ url: "http://localhost/api/auth/signout", method: "POST" });
    expect(requests[1]!.headers).toMatchObject({ host: "localhost", origin: "http://localhost:8081", "x-csrf-token": "app-csrf" });
  });

  test("in console mode it requests the console's base, sends its host as Host, and echoes the named cookie in the named header", async () => {
    const { app, requests } = recorder([
      "__Host-korbat_staff_csrf=staff-csrf; Path=/; Secure; SameSite=Strict",
      "__Host-korbat_csrf=app-csrf; Path=/; Secure; SameSite=Lax",
    ]);
    const b = new Browser(app, "http://console.localhost:8090", {
      base: "http://console.localhost:8090",
      csrfCookie: "__Host-korbat_staff_csrf",
      csrfHeader: "x-staff-csrf",
    });
    await b.fetch("/api/staff/me");
    await b.fetch("/api/staff/signout", { json: {} });
    await b.fetch("/api/staff/signout", { json: {}, csrf: false });
    expect(requests.map((r) => r.url)).toEqual([
      "http://console.localhost:8090/api/staff/me",
      "http://console.localhost:8090/api/staff/signout",
      "http://console.localhost:8090/api/staff/signout",
    ]);
    for (const r of requests) expect(r.headers.host).toBe("console.localhost:8090");
    expect(requests[1]!.headers).toMatchObject({ origin: "http://console.localhost:8090", "x-staff-csrf": "staff-csrf" });
    // Only the named header carries the named cookie: the app's CSRF cookie, which the browser also holds, is never echoed.
    expect(requests[1]!.headers["x-csrf-token"]).toBeUndefined();
    expect(requests[2]!.headers["x-staff-csrf"]).toBeUndefined();
    // Both cookies still travel, as a browser sends every cookie of localhost to every port.
    expect(requests[1]!.headers.cookie).toBe("__Host-korbat_staff_csrf=staff-csrf; __Host-korbat_csrf=app-csrf");
  });
});
```

### Create `apps/api/test/integration/audit-verify.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { auditHead, auditLog, closeDb, createDb, staffKeys, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { auditVerify, checkAuditRecord, runStaffCommand, type AuditReport } from "../../src/cli/staff";
import { loadConfig } from "../../src/config";
import { CHAIN_VECTORS } from "../staff/chain-vectors";
import { TEST_CONSOLE_ORIGIN, newStaffAccount, newStaffKey, rolledBack, withLockTimeout } from "./staff-fixtures";

/**
 * audit-verify (3a design, sections 7 and 12) against the real database: the canonical text in Node against the trigger's
 * in SQL, the chain under concurrent writers, rewrites by the owner detected against kept places, and every staff key's
 * one staff_key_added row. Every test that writes a row audit-verify must refuse does it in a transaction that ends in a
 * rollback and hands that transaction to the verifier's check, so no later suite sees a broken chain.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: audit-verify", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  const actorId = "00000000-0000-0000-0000-000000000000";

  /** One ordinary row, as a writer on the API role inserts it: no id, time or chain column supplied. */
  const insertRow = (db: Db | DbTx, action = `probe-${randomUUID()}`) =>
    db.insert(auditLog).values({ actorId, action, targetType: "user", targetId: randomUUID(), metadata: { via: "test" } }).returning();

  const readHead = async (db: Db | DbTx = apiDb) => (await db.select().from(auditHead))[0]!;
  const hashAt = async (seq: number) => (await apiDb.select({ hash: auditLog.hash }).from(auditLog).where(eq(auditLog.chainSeq, seq)))[0]!.hash;

  /** The verifier's own connections, as the command line opens them: one on each role. */
  const ownConnections = () => ({ api: createDb(loadConfig().DATABASE_URL_API, { max: 1 }), auth: createDb(loadConfig().DATABASE_URL_AUTH, { max: 1 }) });

  /**
   * What the command line printed, and its exit code, for a run with the given environment changes; with `inherit` false,
   * the run sees `env` alone and nothing of the test environment.
   */
  async function cli(args: string[], env: Record<string, string> = {}, inherit = true) {
    const lines: string[] = [];
    const code = await runStaffCommand(args, inherit ? { ...process.env, ...env } : env, { log: (line) => lines.push(line), error: (line) => lines.push(line) });
    return { code, text: lines.join("\n") };
  }

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    // A few committed rows, so the log is never empty whatever order the suites run in.
    for (let i = 0; i < 3; i++) await withLockTimeout(apiDb, (tx) => insertRow(tx));
  });
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  test("a whole chain passes, with the head, and every kept place it is given", async () => {
    const head = await readHead();
    const connections = ownConnections();
    try {
      const plain = await auditVerify(connections, []);
      expect(plain).toMatchObject({ ok: true, rows: head.seq, head: { seq: head.seq, hash: head.hash }, keptChecked: 0, unanchored: head.seq, problems: [], problemCount: 0 });
      const kept = await auditVerify(connections, [
        { seq: 1, hash: await hashAt(1) },
        { seq: head.seq - 1, hash: await hashAt(head.seq - 1) },
      ]);
      expect(kept).toMatchObject({ ok: true, keptChecked: 2, unanchored: 1, problems: [] });
    } finally {
      await Promise.all([closeDb(connections.api), closeDb(connections.auth)]);
    }
  });

  describe("parity: the canonical text in Node and in SQL", () => {
    test("the vectors' rows, written through the trigger from a session in another time zone and date style, recompute to their stored hashes", async () => {
      // One connection, so the session's settings hold for the transaction below.
      const odd = createDb(loadConfig().DATABASE_URL_API, { max: 1 });
      try {
        await odd.execute(sql`set timezone = 'Asia/Kathmandu'`);
        await odd.execute(sql`set datestyle = 'SQL, DMY'`);
        // Rolled back: the step-up row carries an assertion no stored key made, which audit-verify's step-up checks refuse.
        await rolledBack(odd, async (tx) => {
          const [settings] = await tx.execute<{ tz: string; ds: string }>(sql`select current_setting('TimeZone') as tz, current_setting('DateStyle') as ds`);
          expect(settings).toEqual({ tz: "Asia/Kathmandu", ds: "SQL, DMY" });
          const before = await readHead(tx);
          const written: number[] = [];
          for (const vector of CHAIN_VECTORS) {
            const [row] = await tx.insert(auditLog).values(vector.insert).returning({ id: auditLog.id });
            written.push(row!.id);
          }
          // The stored jsonb prints as the vectors say, so the unit vectors hold chain.ts to what the database embeds.
          const texts = await tx
            .select({ id: auditLog.id, metadata: sql<string>`${auditLog.metadata}::text`, stepUp: sql<string | null>`${auditLog.stepUp}::text` })
            .from(auditLog)
            .where(inArray(auditLog.id, written))
            .orderBy(auditLog.chainSeq);
          expect(texts.map((t) => [t.metadata, t.stepUp])).toEqual(CHAIN_VECTORS.map((v) => [v.metadataText, v.stepUpText]));

          // The API role cannot read the staff keys: they come from the auth role's pool, as the command line reads them.
          const report = await checkAuditRecord(tx, [], authDb);
          expect(report.problems).toEqual([]);
          expect(report.rows).toBe(before.seq + CHAIN_VECTORS.length);
        });
      } finally {
        await closeDb(odd);
      }
    });
  });

  describe("concurrency", () => {
    test("several sessions insert at once, some inside transactions, while keys are enrolled: every run passes, during and after", async () => {
      const WRITERS = 6;
      const EACH = 10;
      const config = loadConfig();
      // One connection per writer, each with a lock timeout for the whole session.
      const writers = Array.from({ length: WRITERS }, () => createDb(config.DATABASE_URL_API, { max: 1 }));
      const connections = ownConnections();
      const reports: AuditReport[] = [];
      let writing = true;
      try {
        await Promise.all(writers.map((db) => db.execute(sql`set lock_timeout = '10s'`)));
        const verifying = (async () => {
          while (writing) reports.push(await auditVerify(connections, []));
        })();
        await Promise.all([
          ...writers.map(async (db, w) => {
            for (let i = 0; i < EACH; i++) {
              const action = `concurrent-verify-${w}-${i}`;
              if (i % 2 === 0) {
                await insertRow(db, action);
              } else {
                // A transaction that waits a moment before its insert, which is its last statement, as every audit write's.
                await db.transaction(async (tx) => {
                  await tx.execute(sql`select pg_sleep(${Math.random() * 0.01})`);
                  await insertRow(tx, action);
                });
              }
            }
          }),
          // Keys enrolled meanwhile: a key whose staff_key_added row lies beyond the head a run read is left to the next run.
          (async () => {
            for (let i = 0; i < 3; i++) await newStaffKey(authDb, migrateDb, repo);
          })(),
        ]);
        writing = false;
        await verifying;
        const final = await auditVerify(connections, []);
        const head = await readHead();

        expect(reports.length).toBeGreaterThan(0);
        for (const report of reports) expect(report.problems).toEqual([]);
        expect(final).toMatchObject({ ok: true, rows: head.seq, head: { seq: head.seq, hash: head.hash }, keysLeftToNextRun: 0, problems: [] });
        expect(final.keysChecked).toBe(await migrateDb.$count(staffKeys));
      } finally {
        writing = false;
        await Promise.all([...writers.map((db) => closeDb(db)), closeDb(connections.api), closeDb(connections.auth)]);
      }
    });
  });

  describe("rewrites by the owner", () => {
    test("a row changed alone fails a plain run, naming its place", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const [row] = await insertRow(tx, "rewrite-alone");
        await insertRow(tx, "rewrite-alone-after");
        await tx.update(auditLog).set({ metadata: { via: "edited" } }).where(eq(auditLog.id, row!.id));
        const report = await checkAuditRecord(tx, []);
        expect(report.ok).toBe(false);
        expect(report.problems).toEqual([{ place: row!.chainSeq, message: "its hash does not match its content" }]);
      });
      // Nothing of it outlives the rollback.
      const connections = ownConnections();
      try {
        expect((await auditVerify(connections, [])).ok).toBe(true);
      } finally {
        await Promise.all([closeDb(connections.api), closeDb(connections.auth)]);
      }
    });

    test("a row changed with every later hash and the head recomputed passes a plain run, and fails against a place kept before the change", async () => {
      const head = await readHead();
      const target = head.seq - 1;
      const keptBefore = { seq: target - 1, hash: await hashAt(target - 1) };
      const keptAfter = { seq: head.seq, hash: head.hash };
      await rolledBack(migrateDb, async (tx) => {
        await tx.update(auditLog).set({ action: "rewritten" }).where(eq(auditLog.chainSeq, target));
        // What the owner can do: chain every row from the changed one again with the database's own text function, as
        // migration 0012's back-fill does, and move the head.
        await tx.execute(
          sql.raw(`DO $$
            DECLARE r public.audit_log; prev text;
            BEGIN
              SELECT hash INTO prev FROM public.audit_log WHERE chain_seq = ${target - 1};
              FOR r IN SELECT * FROM public.audit_log WHERE chain_seq >= ${target} ORDER BY chain_seq LOOP
                prev := encode(sha256(convert_to(prev || public.audit_chain_text(r), 'UTF8')), 'hex');
                UPDATE public.audit_log SET prev_hash = (SELECT hash FROM public.audit_log WHERE chain_seq = r.chain_seq - 1), hash = prev WHERE id = r.id;
              END LOOP;
              UPDATE public.audit_head SET hash = prev WHERE id = 1;
            END $$`),
        );
        expect((await readHead(tx)).hash).not.toBe(head.hash);

        const plain = await checkAuditRecord(tx, []);
        expect(plain.problems).toEqual([]);
        // A place kept before the changed row still holds; the one kept at or after it no longer does.
        expect((await checkAuditRecord(tx, [keptBefore])).problems).toEqual([]);
        const anchored = await checkAuditRecord(tx, [keptBefore, keptAfter]);
        expect(anchored.ok).toBe(false);
        expect(anchored.problems).toEqual([{ place: head.seq, message: expect.stringMatching(new RegExp(`^the kept place ${head.seq}:${head.hash} no longer matches`)) }]);
      });
    });
  });

  describe("staff keys", () => {
    test("a key without its staff_key_added row fails, naming the key", async () => {
      const { user } = await newStaffAccount(authDb, repo);
      await rolledBack(migrateDb, async (tx) => {
        // Only the owner can plant one: the auth role cannot insert a key, and add_staff_key writes the row with it.
        const [key] = await tx
          .insert(staffKeys)
          .values({ userId: user.id, credentialId: randomUUID(), publicKey: "cose-key", name: "planted", origin: TEST_CONSOLE_ORIGIN, rpId: "console.localhost" })
          .returning({ id: staffKeys.id });
        const report = await checkAuditRecord(tx, []);
        expect(report.problems).toEqual([{ place: null, message: `staff key ${key!.id} has no staff_key_added row` }]);
      });
    });

    test("a key with a second staff_key_added row fails, naming both places", async () => {
      const { key } = await newStaffKey(authDb, migrateDb, repo);
      const [first] = await apiDb.select({ seq: auditLog.chainSeq }).from(auditLog).where(eq(auditLog.keyId, key.id));
      // The API role can insert any action; a second row claiming the key's addition is refused by audit-verify.
      await rolledBack(apiDb, async (tx) => {
        const [second] = await tx.insert(auditLog).values({ actorId, action: "staff_key_added", targetType: "staff_key", targetId: key.id, keyId: key.id }).returning();
        const report = await checkAuditRecord(tx, [], authDb);
        expect(report.problems).toEqual([{ place: null, message: `staff key ${key.id} has 2 staff_key_added rows (places ${first!.seq}, ${second!.chainSeq})` }]);
      });
    });
  });

  describe("the command line", () => {
    test("audit-verify passes the same with the console off and on, and needs nothing of the console's configuration", async () => {
      const head = await readHead();
      const envs: Record<string, string>[] = [{ CONSOLE_ORIGIN: "" }, { CONSOLE_ORIGIN: "", CONSOLE_RP_ID: "" }, { CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN }];
      for (const env of envs) {
        const run = await cli(["audit-verify", `${head.seq}:${head.hash}`], env);
        expect(run.code, JSON.stringify(env)).toBe(0);
        expect(run.text).toContain(`the chain holds: ${head.seq} rows, from place 1 to the head ${head.seq}:${head.hash}`);
        expect(run.text).toContain("1 kept place checked; 0 rows after the newest kept place are not yet anchored");
      }
    });

    test("audit-verify and audit-head run given the database URLs alone: no secret, no other setting, and a console setting the API refuses changes nothing", async () => {
      const head = await readHead();
      const urls = { DATABASE_URL_API: process.env.DATABASE_URL_API!, DATABASE_URL_AUTH: process.env.DATABASE_URL_AUTH! };
      const envs: Record<string, string>[] = [
        urls,
        // A final slash, which the API's configuration refuses in CONSOLE_ORIGIN.
        { ...urls, CONSOLE_ORIGIN: "https://console.example/" },
        // The console on the app's origin, which it refuses too.
        { ...urls, APP_ORIGIN: process.env.APP_ORIGIN!, CONSOLE_ORIGIN: process.env.APP_ORIGIN! },
      ];
      for (const env of envs) {
        const run = await cli(["audit-verify", `${head.seq}:${head.hash}`], env, false);
        expect(run.code, JSON.stringify(Object.keys(env))).toBe(0);
        expect(run.text).toContain(`the chain holds: ${head.seq} rows, from place 1 to the head ${head.seq}:${head.hash}`);
      }
      const headRun = await cli(["audit-head"], { DATABASE_URL_API: urls.DATABASE_URL_API }, false);
      expect(headRun.code).toBe(0);
      expect(headRun.text).toMatch(new RegExp(`^${head.seq}:${head.hash} `));
    });

    test("audit-verify exits 1 and names the place at fault when a kept place does not match", async () => {
      const head = await readHead();
      const run = await cli(["audit-verify", `1:${await hashAt(1)}`, `${head.seq}:${"f".repeat(64)}`]);
      expect(run.code).toBe(1);
      expect(run.text).toContain("audit-verify: FAILED");
      expect(run.text).toContain(`place ${head.seq}: the kept place ${head.seq}:${"f".repeat(64)} no longer matches`);
    });

    test("audit-head prints the newest place, its hash and its time, and they are what audit_head holds", async () => {
      const head = await readHead();
      const [newest] = await apiDb.select().from(auditLog).where(eq(auditLog.chainSeq, head.seq));
      const run = await cli(["audit-head"], { CONSOLE_ORIGIN: "" });
      expect(run.code).toBe(0);
      expect(run.text).toBe(`${head.seq}:${head.hash} ${newest!.createdAt.toISOString()}`);
    });
  });
});
```

### Create `apps/api/test/integration/staff-audit.test.ts`

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
 * decisions will use, and the audit reader behind Task 4's GET /api/staff/audit. The rows that only a test needs are
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

### Create `apps/api/test/staff/app-mount.test.ts`

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
  const staff = createStaff({ apiDb: createDb(config.DATABASE_URL_API, { max: 1 }) });
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

### Create `apps/api/test/staff/chain-vectors.ts`

```ts
import type { ChainRow } from "../../src/staff/chain";

/**
 * The audit chain's canonical text, version 1 (3a design, section 6), as fixed test vectors: rows with nulls, empty
 * strings, quotes, backslashes, control characters, non-ASCII text, nested metadata and a step-up. Each gives what an
 * insert supplies, the metadata and step-up as PostgreSQL prints the stored jsonb, the expected canonical text and the
 * expected hash. The texts were checked against migration 0012's `public.audit_chain_text` and the hashes computed by
 * PostgreSQL's own sha256 when the vectors were written; the unit test holds chain.ts to them, and the integration parity
 * test writes the same contents through the trigger and recomputes the stored hashes.
 *
 * Every backslash, control character and non-ASCII character is built here in code, never typed as a literal, so the
 * file stays plain printable ASCII. The vectors form a chain of their own: each prev_hash is the hash of the one before.
 */

/** A backslash, as JSON escapes begin with. */
const BS = String.fromCharCode(92);
/** JSON's escape of a control character, as to_json and JSON.stringify write it: a backslash, u, four lower-case hex digits. */
const esc = (code: number) => `${BS}u${code.toString(16).padStart(4, "0")}`;
const chars = (...codes: number[]) => String.fromCodePoint(...codes);

const TAB = chars(9);
const LF = chars(10);
const CR = chars(13);
const DEL = chars(127);
/** The characters 1 to 31, every control character PostgreSQL text can hold below the space (it cannot hold 0). */
const CONTROLS = chars(...Array.from({ length: 31 }, (_, i) => i + 1));
/** The same as JSON writes them: the five short escapes, and the others as esc(). */
const CONTROLS_JSON = Array.from({ length: 31 }, (_, i) => {
  const code = i + 1;
  const short: Record<number, string> = { 8: "b", 9: "t", 10: "n", 12: "f", 13: "r" };
  return short[code] === undefined ? esc(code) : `${BS}${short[code]}`;
}).join("");

const E_ACUTE = chars(0xe9);
const C_CEDILLA = chars(0xe7);
const OMEGA = chars(0x3a9);
const ZHONGWEN = chars(0x4e2d, 0x6587);
const GRINNING = chars(0x1f600);
/** A person at a computer: two astral characters joined by a zero-width joiner. */
const TECHNOLOGIST = chars(0x1f9d1, 0x200d, 0x1f4bb);
const BOM = chars(0xfeff);
const LINE_SEPARATOR = chars(0x2028);
const PARAGRAPH_SEPARATOR = chars(0x2029);

const ZERO_HASH = "0".repeat(64);
const SYSTEM = "00000000-0000-0000-0000-000000000000";
const STAFF = "5b0e7c1a-2d34-4f56-8a9b-0c1d2e3f4a5b";

/** What an insert supplies for a row; the trigger chooses its id, time, place and hashes itself. */
export interface ChainVectorInsert {
  actorId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  staffSession: string | null;
  keyId: string | null;
  actionHash: string | null;
  stepUp: { authenticatorData: string; clientDataJSON: string; signature: string } | null;
  metadata: Record<string, unknown>;
}

export interface ChainVector {
  name: string;
  insert: ChainVectorInsert;
  /** The row as chain.ts reads it, with the place, id and time this vector fixes. */
  row: ChainRow;
  prevHash: string;
  /** The stored metadata and step-up exactly as PostgreSQL prints them (`::text`): its key order and separators. */
  metadataText: string;
  stepUpText: string | null;
  canonical: string;
  hash: string;
}

type Spec = Omit<ChainVector, "row" | "prevHash"> & { seq: number; id: number; createdAt: string };

const SPECS: Spec[] = [
  {
    name: "grant-role's row, every optional column null",
    seq: 1,
    id: 1,
    createdAt: "2026-09-30T08:15:42.007Z",
    insert: {
      actorId: SYSTEM,
      action: "role_granted",
      targetType: "user",
      targetId: "3f2a9c1e-8b7d-4e6f-a5c4-0123456789ab",
      requestId: null,
      staffSession: null,
      keyId: null,
      actionHash: null,
      stepUp: null,
      metadata: { from: "user", to: "moderator", via: "cli" },
    },
    // jsonb keeps its own key order (shorter keys first), which the text embeds as printed, never re-serialised.
    metadataText: '{"to": "moderator", "via": "cli", "from": "user"}',
    stepUpText: null,
    canonical:
      '[1,1,1,"2026-09-30T08:15:42.007Z","00000000-0000-0000-0000-000000000000","role_granted","user","3f2a9c1e-8b7d-4e6f-a5c4-0123456789ab",null,null,null,null,null,{"to": "moderator", "via": "cli", "from": "user"}]',
    hash: "ce7bdf45f85f04d846cfc331f8563114f8cf9547724d6ff3b744d9b9477010e7",
  },
  {
    name: "empty strings",
    seq: 2,
    id: 3,
    createdAt: "2026-09-30T08:15:43.000Z",
    insert: {
      actorId: STAFF,
      action: "",
      targetType: "",
      targetId: "",
      requestId: "",
      staffSession: null,
      keyId: null,
      actionHash: null,
      stepUp: null,
      metadata: { "": "" },
    },
    metadataText: '{"": ""}',
    stepUpText: null,
    canonical: '[1,2,3,"2026-09-30T08:15:43.000Z","5b0e7c1a-2d34-4f56-8a9b-0c1d2e3f4a5b","","","","",null,null,null,null,{"": ""}]',
    hash: "519818d9cfab73737a086d419800de97ca5f82294db37d979cfa5600577218e3",
  },
  {
    name: "quotes and backslashes",
    seq: 3,
    id: 5,
    createdAt: "2026-09-30T08:15:43.999Z",
    insert: {
      actorId: STAFF,
      action: `say "hi" ${BS} bye`,
      targetType: '"',
      targetId: `C:${BS}staff${BS}"x"`,
      requestId: "a/b",
      staffSession: null,
      keyId: null,
      actionHash: null,
      stepUp: null,
      metadata: { q: 'a"b', b: `c${BS}d`, 'k"ey': "v" },
    },
    metadataText: `{"b": "c${BS}${BS}d", "q": "a${BS}"b", "k${BS}"ey": "v"}`,
    stepUpText: null,
    canonical:
      `[1,3,5,"2026-09-30T08:15:43.999Z","5b0e7c1a-2d34-4f56-8a9b-0c1d2e3f4a5b","say ${BS}"hi${BS}" ${BS}${BS} bye","${BS}"",` +
      `"C:${BS}${BS}staff${BS}${BS}${BS}"x${BS}"","a/b",null,null,null,null,{"b": "c${BS}${BS}d", "q": "a${BS}"b", "k${BS}"ey": "v"}]`,
    hash: "9a9e47b64c87ac1def6f82c6012ec9604eca8f450a4a887e6595039796c0178d",
  },
  {
    name: "control characters",
    seq: 4,
    id: 7,
    createdAt: "2026-09-30T23:59:59.500Z",
    insert: {
      actorId: STAFF,
      action: CONTROLS + DEL,
      targetType: null,
      targetId: `tab${TAB}end`,
      requestId: `line1${LF}line2${CR}`,
      staffSession: null,
      keyId: null,
      actionHash: null,
      stepUp: null,
      metadata: { c: chars(1, 31, 127), t: TAB + LF },
    },
    // DEL is not a JSON control character: both escapers leave it as it is.
    metadataText: `{"c": "${esc(1)}${esc(31)}${DEL}", "t": "${BS}t${BS}n"}`,
    stepUpText: null,
    canonical:
      `[1,4,7,"2026-09-30T23:59:59.500Z","5b0e7c1a-2d34-4f56-8a9b-0c1d2e3f4a5b","${CONTROLS_JSON}${DEL}",null,"tab${BS}tend",` +
      `"line1${BS}nline2${BS}r",null,null,null,null,{"c": "${esc(1)}${esc(31)}${DEL}", "t": "${BS}t${BS}n"}]`,
    hash: "38a8e4be3f4aeb2f502c7086940a59765428c1d283a4c141bd0acd2f64cc9593",
  },
  {
    name: "non-ASCII text",
    seq: 5,
    id: 9,
    createdAt: "2027-01-01T00:00:00.001Z",
    insert: {
      actorId: STAFF,
      action: `moderation ${E_ACUTE}${C_CEDILLA} ${OMEGA} ${ZHONGWEN}`,
      targetType: "post",
      targetId: GRINNING + TECHNOLOGIST,
      requestId: `${BOM}req${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}`,
      staffSession: null,
      keyId: null,
      actionHash: null,
      stepUp: null,
      metadata: { [E_ACUTE]: OMEGA, [GRINNING]: ZHONGWEN, note: LINE_SEPARATOR },
    },
    // Keys of equal length in UTF-8 bytes ("note" and the emoji, 4 each) are ordered bytewise; neither escaper touches
    // non-ASCII text, the line and paragraph separators included.
    metadataText: `{"${E_ACUTE}": "${OMEGA}", "note": "${LINE_SEPARATOR}", "${GRINNING}": "${ZHONGWEN}"}`,
    stepUpText: null,
    canonical:
      `[1,5,9,"2027-01-01T00:00:00.001Z","5b0e7c1a-2d34-4f56-8a9b-0c1d2e3f4a5b","moderation ${E_ACUTE}${C_CEDILLA} ${OMEGA} ${ZHONGWEN}",` +
      `"post","${GRINNING}${TECHNOLOGIST}","${BOM}req${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}",null,null,null,null,` +
      `{"${E_ACUTE}": "${OMEGA}", "note": "${LINE_SEPARATOR}", "${GRINNING}": "${ZHONGWEN}"}]`,
    hash: "d12e85713d582acc9f2b4efb018b807af54a28131dcea9442e0536b136cce840",
  },
  {
    name: "nested metadata",
    seq: 6,
    id: 11,
    createdAt: "2026-10-01T12:00:00.250Z",
    insert: {
      actorId: STAFF,
      action: "case_decided",
      targetType: "post",
      targetId: "9c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5",
      requestId: "req-7",
      staffSession: null,
      keyId: null,
      actionHash: null,
      stepUp: null,
      metadata: {
        params: { reason: "R2", items: [{ id: 1, ok: true }, { id: 2, ok: false, note: null }], empty: {}, list: [] },
        count: 2,
        ratio: 0.25,
        small: 1e-7,
        neg: -3,
      },
    },
    // At every level shorter keys come first; numbers are printed as PostgreSQL's numeric prints them (1e-7 in full).
    metadataText:
      '{"neg": -3, "count": 2, "ratio": 0.25, "small": 0.0000001, "params": {"list": [], "empty": {}, "items": [{"id": 1, "ok": true}, {"id": 2, "ok": false, "note": null}], "reason": "R2"}}',
    stepUpText: null,
    canonical:
      '[1,6,11,"2026-10-01T12:00:00.250Z","5b0e7c1a-2d34-4f56-8a9b-0c1d2e3f4a5b","case_decided","post","9c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5","req-7",null,null,null,null,' +
      '{"neg": -3, "count": 2, "ratio": 0.25, "small": 0.0000001, "params": {"list": [], "empty": {}, "items": [{"id": 1, "ok": true}, {"id": 2, "ok": false, "note": null}], "reason": "R2"}}]',
    hash: "1ff30301d442f8d4c8ccc9d7d2870009ef58587f1073e605c2943d220cf9e508",
  },
  {
    name: "a step-up",
    seq: 7,
    id: 13,
    createdAt: "2026-10-01T12:00:01.000Z",
    insert: {
      actorId: STAFF,
      action: "staff_session_revoked",
      targetType: "staff_session",
      targetId: "c0ffee00-1234-4abc-8def-0123456789ab",
      requestId: "req-8",
      staffSession: "8a3c7f0e-1111-4222-8333-944445555666",
      keyId: "01234567-89ab-4cde-8f01-23456789abcd",
      actionHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      stepUp: {
        authenticatorData: "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MFAAAABQ",
        clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiQUFBQSIsIm9yaWdpbiI6Imh0dHA6Ly9jb25zb2xlLmxvY2FsaG9zdDo4MDkwIn0",
        signature: "MEUCIQDx-signature-placeholder_AiEA",
      },
      metadata: { params: {} },
    },
    metadataText: '{"params": {}}',
    stepUpText:
      '{"signature": "MEUCIQDx-signature-placeholder_AiEA", "clientDataJSON": "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiQUFBQSIsIm9yaWdpbiI6Imh0dHA6Ly9jb25zb2xlLmxvY2FsaG9zdDo4MDkwIn0", "authenticatorData": "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MFAAAABQ"}',
    canonical:
      '[1,7,13,"2026-10-01T12:00:01.000Z","5b0e7c1a-2d34-4f56-8a9b-0c1d2e3f4a5b","staff_session_revoked","staff_session","c0ffee00-1234-4abc-8def-0123456789ab","req-8",' +
      '"8a3c7f0e-1111-4222-8333-944445555666","01234567-89ab-4cde-8f01-23456789abcd","e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",' +
      '{"signature": "MEUCIQDx-signature-placeholder_AiEA", "clientDataJSON": "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiQUFBQSIsIm9yaWdpbiI6Imh0dHA6Ly9jb25zb2xlLmxvY2FsaG9zdDo4MDkwIn0", "authenticatorData": "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MFAAAABQ"},' +
      '{"params": {}}]',
    hash: "92cc0e0d99eb38cd494f55891edf8b10bf8f73ca07630b5a663cfabd33e5a612",
  },
];

export const CHAIN_VECTORS: ChainVector[] = SPECS.map((spec, index) => {
  const { seq, id, createdAt, ...vector } = spec;
  const { stepUp: _stepUp, metadata: _metadata, ...columns } = vector.insert;
  return {
    ...vector,
    prevHash: index === 0 ? ZERO_HASH : SPECS[index - 1]!.hash,
    row: {
      chainVersion: 1,
      chainSeq: seq,
      id,
      createdAt: new Date(createdAt),
      ...columns,
      stepUpText: vector.stepUpText,
      metadataText: vector.metadataText,
    },
  };
});
```

### Create `apps/api/test/staff/chain.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { CHAIN_ZERO_HASH, canonicalText, chainHash } from "../../src/staff/chain";
import { CHAIN_VECTORS } from "./chain-vectors";

describe("the audit chain's canonical text, version 1", () => {
  test("the vectors cover what the design lists, and form a chain from 64 zeros", () => {
    expect(CHAIN_VECTORS.map((v) => v.name)).toEqual([
      "grant-role's row, every optional column null",
      "empty strings",
      "quotes and backslashes",
      "control characters",
      "non-ASCII text",
      "nested metadata",
      "a step-up",
    ]);
    expect(CHAIN_ZERO_HASH).toBe("0".repeat(64));
    expect(CHAIN_VECTORS[0]!.prevHash).toBe(CHAIN_ZERO_HASH);
    for (let i = 1; i < CHAIN_VECTORS.length; i++) expect(CHAIN_VECTORS[i]!.prevHash).toBe(CHAIN_VECTORS[i - 1]!.hash);
  });

  for (const vector of CHAIN_VECTORS) {
    test(`${vector.name}: the text and the hash`, () => {
      expect(canonicalText(vector.row)).toBe(vector.canonical);
      expect(chainHash(vector.prevHash, vector.canonical)).toBe(vector.hash);
    });
  }

  test("the stored jsonb is embedded as PostgreSQL printed it, never re-serialised", () => {
    const row = { ...CHAIN_VECTORS[0]!.row, metadataText: '{"b":1,  "a" : 2}', stepUpText: '{ "x": [ ] }' };
    expect(canonicalText(row)).toBe(
      '[1,1,1,"2026-09-30T08:15:42.007Z","00000000-0000-0000-0000-000000000000","role_granted","user","3f2a9c1e-8b7d-4e6f-a5c4-0123456789ab",null,null,null,null,{ "x": [ ] },{"b":1,  "a" : 2}]',
    );
  });

  test("the time is written in UTC to the millisecond", () => {
    const row = { ...CHAIN_VECTORS[0]!.row, createdAt: new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6)) };
    expect(canonicalText(row)).toContain(',"2026-01-02T03:04:05.006Z",');
  });

  test("the hash is taken over the UTF-8 bytes of prev_hash followed by the text", () => {
    // e-acute is two bytes in UTF-8 (the digest below, computed by Python's hashlib) and one in Latin-1 (de2e33...).
    expect(chainHash("", String.fromCharCode(0xe9))).toBe("4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c");
    expect(chainHash("ab", "cd")).toBe(chainHash("", "abcd"));
    expect(chainHash("", "")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  test("a version it does not know is refused, never hashed as version 1", () => {
    const row = CHAIN_VECTORS[0]!.row;
    expect(() => canonicalText({ ...row, chainVersion: 2 })).toThrow("audit chain version 2 is not known");
    expect(() => canonicalText({ ...row, chainVersion: 0 })).toThrow("audit chain version 0 is not known");
  });
});
```

### Create `apps/api/test/staff/gate.test.ts`

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
 * and an AuthError as createApp does. No staff route exists before Task 4, whose HTTP tests take the gate through the app.
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

### Replace `apps/api/test/architecture.test.ts` (whole file)

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Module boundaries (1a spec section 2.2, 2a spec section 2.2, 3a design section 5). Paths are relative to apps/api/src
 * with forward slashes. The rules are plain functions so the tests below can prove each one catches
 * a deliberate violation.
 */
interface SourceFile {
  path: string;
  source: string;
}

const SRC_ROOT = fileURLToPath(new URL("../src", import.meta.url));
const SCHEMA_ROOT = fileURLToPath(new URL("../../../packages/db/src/schema", import.meta.url));

/** Schema files that define auth-schema objects or shared helpers; every other schema file is public. */
const NON_PUBLIC_SCHEMA_FILES = new Set(["auth.ts", "helpers.ts", "index.ts"]);
const AUTH_SCHEMA_FILE = "auth.ts";
// The command lines open both pools: grant-role changes a role on the auth pool, and staff.js reads there the staff keys
// that audit-verify checks the record against.
const AUTH_POOL_ALLOWED = new Set(["config.ts", "index.ts", "cli/grant-role.ts", "cli/staff.ts"]);
const AUTH_KEYS_ALLOWED = new Set(["config.ts"]);

/** Modules that may only be entered through their index file. */
const MODULES = ["auth", "social", "media", "account", "staff"] as const;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

function loadSources(): SourceFile[] {
  return walk(SRC_ROOT).map((full) => ({ path: relative(SRC_ROOT, full).split(sep).join("/"), source: readFileSync(full, "utf8") }));
}

function exportedNames(file: string): string[] {
  const source = readFileSync(join(SCHEMA_ROOT, file), "utf8");
  return [...source.matchAll(/^export (?:const|function|type|interface|enum) ([A-Za-z0-9_]+)/gm)].map((m) => m[1]!);
}

/** Names exported by the public-schema files of @korbat/db (tables and enums the auth module must not touch). */
function publicSchemaNames(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(SCHEMA_ROOT)) {
    if (!file.endsWith(".ts") || NON_PUBLIC_SCHEMA_FILES.has(file)) continue;
    for (const name of exportedNames(file)) names.add(name);
  }
  return names;
}

/** Names exported by the auth-schema file of @korbat/db (tables and enums the social module must not touch). */
function authSchemaNames(): Set<string> {
  return new Set(exportedNames(AUTH_SCHEMA_FILE));
}

/** Every module specifier in static imports, re-exports, side-effect imports and dynamic imports. */
function specifiers(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)].map((m) => m[1]!);
}

/** Named bindings of every `import { ... } from "@korbat/db"`; a namespace import yields the marker "*". */
function dbImports(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/\bimport\s+(type\s+)?(\*\s+as\s+\w+|\{[^}]*\})\s+from\s+["'](@korbat\/db(?:\/[^"']*)?)["']/g)) {
    const bindings = match[2]!;
    if (bindings.startsWith("*")) {
      names.push("*");
      continue;
    }
    for (const part of bindings.slice(1, -1).split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

const insideAuth = (path: string) => path.startsWith("auth/");
const insideSocial = (path: string) => path.startsWith("social/");
const insideMedia = (path: string) => path.startsWith("media/");
const insideAccount = (path: string) => path.startsWith("account/");
const insideStaff = (path: string) => path.startsWith("staff/");

function findViolations(files: SourceFile[], publicNames: Set<string>, authNames: Set<string>): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    for (const spec of specifiers(source)) {
      if (!spec.startsWith(".")) continue;
      const target = posix.normalize(posix.join(posix.dirname(path), spec)).replace(/\.ts$/, "");
      for (const module of MODULES) {
        if (path.startsWith(`${module}/`)) continue;
        if (target.startsWith(`${module}/`) && target !== `${module}/index`) {
          violations.push(`${path}: imports ${spec}, which is inside the ${module} module (use ./${module})`);
        }
      }
    }
    if (!insideAuth(path) && !AUTH_POOL_ALLOWED.has(path) && /\b(DATABASE_URL_AUTH|authDb)\b/.test(source)) {
      violations.push(`${path}: references the auth database pool`);
    }
    if (!insideAuth(path) && !AUTH_KEYS_ALLOWED.has(path) && /\b(TOTP_ENC_KEY|AUTH_HMAC_KEY|IP_HASH_KEY)\b/.test(source)) {
      violations.push(`${path}: references an auth key`);
    }
    if (insideAuth(path)) {
      for (const name of dbImports(source)) {
        if (name === "*") violations.push(`${path}: namespace import of @korbat/db (import auth-schema names explicitly)`);
        else if (publicNames.has(name)) violations.push(`${path}: imports public-schema ${name} from @korbat/db`);
      }
    }
    if (!insideMedia(path) && /\b(postMedia|post_media)\b/.test(source)) {
      violations.push(`${path}: references post_media, which only the media module may touch`);
    }
    // The staff module (role korbat_api) reads and writes the public audit log; staff keys, staff sessions and enrolments
    // are credentials, the auth module's alone (3a design, section 5).
    if (insideSocial(path) || insideMedia(path) || insideStaff(path)) {
      for (const name of dbImports(source)) {
        if (name === "*") violations.push(`${path}: namespace import of @korbat/db (import public-schema names explicitly)`);
        else if (authNames.has(name)) violations.push(`${path}: imports auth-schema ${name} from @korbat/db`);
      }
    }
    // The account module sequences the other three through their index files and holds no table access of its own
    // (1b spec, section 5): no table or enum of either schema may be named in it. Db and DbTx, which are not schema
    // names, stay allowed, since a transaction is passed through it.
    if (insideAccount(path)) {
      for (const name of dbImports(source)) {
        if (name === "*") violations.push(`${path}: namespace import of @korbat/db (the account module holds no table access)`);
        else if (publicNames.has(name)) violations.push(`${path}: imports public-schema ${name} from @korbat/db (the account module holds no table access)`);
        else if (authNames.has(name)) violations.push(`${path}: imports auth-schema ${name} from @korbat/db (the account module holds no table access)`);
      }
    }
    // The staff module uses the auth module's interface as the other modules do, never its repository or its session
    // store, which would hand it the auth tables. Any mention counts, so a renamed, namespace or dynamic import is caught
    // as surely as a named one.
    if (insideStaff(path)) {
      for (const name of new Set([...source.matchAll(/\b(createAuthRepo|createSessions)\b/g)].map((m) => m[1]!))) {
        violations.push(`${path}: uses the auth module's ${name} (the staff module goes through the auth module's interface)`);
      }
    }
  }
  return violations;
}

describe("module boundaries", () => {
  test("walks the real source tree", () => {
    const paths = loadSources().map((f) => f.path);
    expect(paths).toContain("auth/index.ts");
    expect(paths).toContain("social/index.ts");
    expect(paths).toContain("media/index.ts");
    expect(paths).toContain("account/index.ts");
    expect(paths).toContain("staff/index.ts");
    expect(paths).toContain("cli/staff.ts");
    expect(paths).toContain("app.ts");
    expect(publicSchemaNames()).toContain("profiles");
    expect(publicSchemaNames()).not.toContain("users");
    expect(authSchemaNames()).toContain("users");
    expect(authSchemaNames()).not.toContain("posts");
  });

  test("apps/api/src has no boundary violations", () => {
    expect(findViolations(loadSources(), publicSchemaNames(), authSchemaNames())).toEqual([]);
  });

  test("allows the module indexes, the permitted pool owners and each module's own schema", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createAuth } from "./auth";\nimport type { Auth } from "./auth/index";\nimport { createSocial } from "./social";` },
      { path: "profiles/store.ts", source: `import { isUniqueViolation } from "../auth";` },
      { path: "cli/grant-role.ts", source: `const authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "index.ts", source: `const authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "config.ts", source: `AUTH_HMAC_KEY: base64Key, IP_HASH_KEY: base64Key, TOTP_ENC_KEY: versionedKey, DATABASE_URL_AUTH: url` },
      { path: "auth/repo.ts", source: `import { users, sessions, type Db } from "@korbat/db";\nconst k = config.TOTP_ENC_KEY;` },
      { path: "social/repo.ts", source: `import { posts, profiles, type Db } from "@korbat/db";\nimport { SocialError } from "./context";` },
      { path: "social/routes.ts", source: `import type { Auth } from "../auth";` },
      { path: "index.ts", source: `import { createAccount } from "./account";\nimport { createMedia } from "./media";` },
      { path: "account/routes.ts", source: `import type { AuthForAccount } from "../auth";\nimport type { SocialForAccount } from "../social";\nimport { buildExport } from "./flows/export";` },
      { path: "account/flows/deletion.ts", source: `import type { DbTx } from "@korbat/db";\nimport type { MediaForAccount } from "../../media";` },
      { path: "cli/staff.ts", source: `import { createStaff } from "../staff";\nconst authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "staff/audit.ts", source: `import { auditHead, auditLog, profiles, type Db, type DbTx } from "@korbat/db";` },
      { path: "staff/routes.ts", source: `import { AuthError, type Auth } from "../auth";\nimport { staffGate } from "./gate";` },
    ];
    expect(findViolations(files, new Set(["profiles", "posts", "auditLog", "auditHead"]), new Set(["users", "sessions"]))).toEqual([]);
  });

  test("catches a deep import into the auth module", () => {
    const files: SourceFile[] = [
      { path: "routes/posts.ts", source: `import { hashPassword } from "../auth/passwords";` },
      { path: "app.ts", source: `export { createSessions } from "./auth/sessions.ts";\nconst m = await import("./auth/repo");` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "routes/posts.ts: imports ../auth/passwords, which is inside the auth module (use ./auth)",
      "app.ts: imports ./auth/sessions.ts, which is inside the auth module (use ./auth)",
      "app.ts: imports ./auth/repo, which is inside the auth module (use ./auth)",
    ]);
  });

  test("catches a deep import into the social module, from outside it and from the auth module", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createSocialRepo } from "./social/repo";` },
      { path: "auth/flows/signup.ts", source: `import { createPost } from "../../social/flows/posts";` },
      { path: "social/flows/graph.ts", source: `import { ownProfile } from "./posts";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "app.ts: imports ./social/repo, which is inside the social module (use ./social)",
      "auth/flows/signup.ts: imports ../../social/flows/posts, which is inside the social module (use ./social)",
    ]);
  });

  test("catches a deep import into the media module, post_media outside it, and the auth schema inside it", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createMediaRepo } from "./media/repo";\nimport { createMedia } from "./media";` },
      { path: "social/repo.ts", source: `import { postMedia, posts } from "@korbat/db";` },
      { path: "social/views.ts", source: "const rows = await db.execute(sql`select * from post_media`);" },
      { path: "media/repo.ts", source: `import { postMedia, posts, users, type Db } from "@korbat/db";` },
      { path: "media/flows/serve.ts", source: `import type { MediaDeps } from "../context";` },
    ];
    expect(findViolations(files, new Set(["posts", "postMedia"]), new Set(["users"]))).toEqual([
      "app.ts: imports ./media/repo, which is inside the media module (use ./media)",
      "social/repo.ts: references post_media, which only the media module may touch",
      "social/views.ts: references post_media, which only the media module may touch",
      "media/repo.ts: imports auth-schema users from @korbat/db",
    ]);
  });

  test("catches a deep import into the account module, and a table or enum of either schema inside it", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createZipWriter } from "./account/zip";\nimport { createAccount } from "./account";` },
      { path: "social/flows/graph.ts", source: `import { buildExport } from "../../account/flows/export";` },
      { path: "account/flows/export.ts", source: `import { posts, users, type DbTx } from "@korbat/db";` },
      { path: "account/purge.ts", source: `import * as db from "@korbat/db";` },
      { path: "account/zip.ts", source: `import type { Db } from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["posts"]), new Set(["users"]))).toEqual([
      "app.ts: imports ./account/zip, which is inside the account module (use ./account)",
      "social/flows/graph.ts: imports ../../account/flows/export, which is inside the account module (use ./account)",
      "account/flows/export.ts: imports public-schema posts from @korbat/db (the account module holds no table access)",
      "account/flows/export.ts: imports auth-schema users from @korbat/db (the account module holds no table access)",
      "account/purge.ts: namespace import of @korbat/db (the account module holds no table access)",
    ]);
  });

  test("catches auth pool and auth key references outside their owners", () => {
    const files: SourceFile[] = [
      { path: "routes/posts.ts", source: `const url = config.DATABASE_URL_AUTH;` },
      { path: "profiles/store.ts", source: `export function f(authDb: Db) {}` },
      { path: "lib/hash.ts", source: `const key = config.IP_HASH_KEY;` },
      { path: "index.ts", source: `const k = config.AUTH_HMAC_KEY;` },
      // The staff command line may open the auth pool; another command line, or the staff module itself, may not.
      { path: "cli/other.ts", source: `const authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "staff/audit.ts", source: `export function readKeys(authDb: Db) {}` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "routes/posts.ts: references the auth database pool",
      "profiles/store.ts: references the auth database pool",
      "lib/hash.ts: references an auth key",
      "index.ts: references an auth key",
      "cli/other.ts: references the auth database pool",
      "staff/audit.ts: references the auth database pool",
    ]);
  });

  test("catches a deep import into the staff module, from outside it and from the auth module", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { staffGate } from "./staff/gate";\nimport { createStaff } from "./staff";` },
      { path: "cli/staff.ts", source: `import { canonicalText } from "../staff/chain";` },
      { path: "auth/staff/flows.ts", source: `import { appendAuditRow } from "../../staff/audit";` },
      { path: "staff/routes.ts", source: `import { staffGate } from "./gate";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "app.ts: imports ./staff/gate, which is inside the staff module (use ./staff)",
      "cli/staff.ts: imports ../staff/chain, which is inside the staff module (use ./staff)",
      "auth/staff/flows.ts: imports ../../staff/audit, which is inside the staff module (use ./staff)",
    ]);
  });

  test("catches auth-schema imports inside the staff module", () => {
    const files: SourceFile[] = [
      { path: "staff/audit.ts", source: `import { auditLog, staffKeys, type Db } from "@korbat/db";` },
      { path: "staff/reader.ts", source: `import type { staffSessions as s } from "@korbat/db";` },
      { path: "staff/writer.ts", source: `import * as db from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["auditLog"]), new Set(["staffKeys", "staffSessions"]))).toEqual([
      "staff/audit.ts: imports auth-schema staffKeys from @korbat/db",
      "staff/reader.ts: imports auth-schema staffSessions from @korbat/db",
      "staff/writer.ts: namespace import of @korbat/db (import public-schema names explicitly)",
    ]);
  });

  test("catches the auth module's repository or session store inside the staff module, however it is imported", () => {
    const files: SourceFile[] = [
      { path: "staff/audit.ts", source: `import { AuthError, createAuthRepo } from "../auth";` },
      { path: "staff/routes.ts", source: `import { createSessions as sessionsOf } from "../auth";` },
      { path: "staff/flows/x.ts", source: `import * as auth from "../../auth";\nconst repo = auth.createAuthRepo(db);\nconst s = auth.createSessions(deps);` },
      { path: "staff/flows/y.ts", source: `const { createSessions } = await import("../../auth");` },
      // Outside the staff module the rule does not apply: the command lines build the auth module's parts themselves.
      { path: "cli/grant-role.ts", source: `import { createAuthRepo, createSessions } from "../auth";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "staff/audit.ts: uses the auth module's createAuthRepo (the staff module goes through the auth module's interface)",
      "staff/routes.ts: uses the auth module's createSessions (the staff module goes through the auth module's interface)",
      "staff/flows/x.ts: uses the auth module's createAuthRepo (the staff module goes through the auth module's interface)",
      "staff/flows/x.ts: uses the auth module's createSessions (the staff module goes through the auth module's interface)",
      "staff/flows/y.ts: uses the auth module's createSessions (the staff module goes through the auth module's interface)",
    ]);
  });

  test("catches public-schema imports inside the auth module", () => {
    const files: SourceFile[] = [
      { path: "auth/repo.ts", source: `import { users, profiles as p, type Db } from "@korbat/db";` },
      { path: "auth/flows/x.ts", source: `import type { posts } from "@korbat/db";` },
      { path: "auth/flows/y.ts", source: `import * as db from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["profiles", "posts"]), new Set())).toEqual([
      "auth/repo.ts: imports public-schema profiles from @korbat/db",
      "auth/flows/x.ts: imports public-schema posts from @korbat/db",
      "auth/flows/y.ts: namespace import of @korbat/db (import auth-schema names explicitly)",
    ]);
  });

  test("catches auth-schema imports inside the social module", () => {
    const files: SourceFile[] = [
      { path: "social/repo.ts", source: `import { posts, users as u, type Db } from "@korbat/db";` },
      { path: "social/flows/x.ts", source: `import type { sessions } from "@korbat/db";` },
      { path: "social/flows/y.ts", source: `import * as db from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["posts"]), new Set(["users", "sessions"]))).toEqual([
      "social/repo.ts: imports auth-schema users from @korbat/db",
      "social/flows/x.ts: imports auth-schema sessions from @korbat/db",
      "social/flows/y.ts: namespace import of @korbat/db (import public-schema names explicitly)",
    ]);
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

    const result = await runGrantRole({ authDb, kv }, user.email, "moderator");

    expect(result).toEqual({ userId: user.id, previousRole: "user" });
    expect((await repo.findUserById(user.id))!.role).toBe("moderator");
    expect(await sessions.resolve(issued.token)).toBeNull();
    const entries = await apiDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.targetId, user.id), eq(auditLog.action, "role_granted")));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorId: SYSTEM_ACTOR_ID, targetType: "user", metadata: { from: "user", to: "moderator", via: "cli" }, chainVersion: 1 });
    expect(await readHead()).toMatchObject({ seq: entries[0]!.chainSeq, hash: entries[0]!.hash });
  });

  test("the role change, the sessions it revokes and its audit row are one transaction", async () => {
    const repo = createAuthRepo(authDb);
    const kv = new MemoryKv();
    const sessions = createSessions({ repo, kv });
    const { user, device } = await newUserWithDevice(repo);
    await sessions.issue(user.id, device.id, { factors: { email: Date.now() } });

    await runGrantRole({ authDb, kv }, user.email, "admin");

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
    await expect(runGrantRole({ authDb, kv: new MemoryKv() }, `nobody-${randomUUID()}@korbat.local`, "admin")).rejects.toThrow("no account for");
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
      await expect(runGrantRole({ authDb, kv }, user.email, "moderator")).rejects.toThrow(
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

### Replace `apps/api/test/integration/http-client.ts` (whole file)

```ts
import { randomInt } from "node:crypto";

/** Anything with Hono's `app.request`. */
export interface RequestApp {
  request(path: string, init?: RequestInit): Response | Promise<Response>;
}

interface FetchInit {
  method?: string;
  json?: unknown;
  /** A raw body with its declared type, which is how an image is uploaded. */
  raw?: { type: string; body: Uint8Array };
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** Web only: send the CSRF header (default true). */
  csrf?: boolean;
}

/**
 * A distinct client address per test client, sent as cf-connecting-ip, so per-IP rate limits in one
 * test never affect another.
 */
export const randomIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

export interface BrowserOptions {
  /**
   * Where the requests go: each path is appended to it, and its host is sent as Host, since behind Caddy
   * @hono/node-server builds the request's URL from the Host header and the staff gate reads it. The app's
   * browser keeps http://localhost; the console's browser uses the console's origin (3a design, section 12).
   */
  base?: string;
  /** The cookie whose value the browser echoes on its requests, and the header it echoes it in. */
  csrfCookie?: string;
  csrfHeader?: string;
  ip?: string;
}

/** A minimal browser: keeps cookies, sends Origin on state changes and echoes the CSRF cookie in the CSRF header. */
export class Browser {
  private readonly cookies = new Map<string, string>();
  private readonly base: string;
  private readonly host: string;
  private readonly csrfCookie: string;
  private readonly csrfHeader: string;
  private readonly ip: string;

  constructor(
    private readonly app: RequestApp,
    private readonly origin: string,
    options: BrowserOptions = {},
  ) {
    this.base = options.base ?? "http://localhost";
    this.host = new URL(this.base).host;
    this.csrfCookie = options.csrfCookie ?? "__Host-korbat_csrf";
    this.csrfHeader = options.csrfHeader ?? "x-csrf-token";
    this.ip = options.ip ?? randomIp();
  }

  async fetch(path: string, init: FetchInit = {}): Promise<Response> {
    const method = init.method ?? (init.json === undefined && init.raw === undefined ? "GET" : "POST");
    const headers: Record<string, string> = { host: this.host, "cf-connecting-ip": this.ip, ...init.headers };
    if (this.cookies.size > 0) headers.cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    if (method !== "GET") headers.origin = this.origin;
    const csrf = this.cookies.get(this.csrfCookie);
    if (init.csrf !== false && csrf) headers[this.csrfHeader] = csrf;
    if (init.json !== undefined) headers["content-type"] = "application/json";
    if (init.raw) headers["content-type"] = init.raw.type;
    const body = init.raw ? init.raw.body : init.json === undefined ? undefined : JSON.stringify(init.json);
    const res = await this.app.request(`${this.base}${path}`, { method, headers, body });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split("; ");
      const separator = pair!.indexOf("=");
      const name = pair!.slice(0, separator);
      if (attributes.includes("Max-Age=0")) this.cookies.delete(name);
      else this.cookies.set(name, pair!.slice(separator + 1));
    }
    return res;
  }

  cookie(name: string): string | undefined {
    return this.cookies.get(name);
  }
}

/** A native app: no cookies and no Origin header; sends the bearer token once it has one. */
export class NativeClient {
  token: string | undefined;

  constructor(
    private readonly app: RequestApp,
    private readonly ip: string = randomIp(),
  ) {}

  fetch(path: string, init: Omit<FetchInit, "csrf"> = {}): Response | Promise<Response> {
    const method = init.method ?? (init.json === undefined ? "GET" : "POST");
    const headers: Record<string, string> = { "cf-connecting-ip": this.ip };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (init.json !== undefined) headers["content-type"] = "application/json";
    return this.app.request(path, { method, headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
  }
}
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
❯ test/architecture.test.ts (13 tests | 1 failed) 123ms
Test Files  7 failed | 45 passed | 43 skipped (95)
Tests  1 failed | 455 passed | 319 skipped (775)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/staff-console-3a/write_blocks.py docs/superpowers/prompts/staff-console-3a/02-staff-module-record.md 3
```

Expected: 15 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/cli/lock-timeout.ts`

```ts
/**
 * The command lines' lock timeout (3a design, section 7). grant-role and staff.js wait at most 10 seconds for a lock,
 * since an API under an attacker's control could hold the audit head or an account's row open and so stall every
 * revocation; the transaction that gave up has changed nothing. This file has no entry point of its own, so both
 * bundles can include it: a bundled module's import.meta.url is the bundle's, and an entry's check that it was run
 * directly would pass in the other bundle too.
 */

/** What a command that gave up waiting for a lock says. */
export const LOCK_TIMEOUT_ADVICE =
  "an open transaction holds the audit head or the account's row, and 10 seconds passed waiting for it: " +
  "stop the api service (docker compose -f infra/compose.yml stop api) before running this command again, then start it.";

/** True for PostgreSQL's lock_not_available (a lock_timeout ran out), however deeply the driver wrapped it. */
export function isLockTimeout(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && (current as { code?: unknown }).code === "55P03") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
```

### Create `apps/api/src/cli/staff.ts`

```ts
/**
 * The staff command line (3a design, section 7). Run on the server only, like grant-role:
 *
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js audit-head
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js audit-verify [<chain_seq>:<hash> ...]
 *
 * audit-head prints the audit log's newest place and hash, which the keeper holds off the server. audit-verify recomputes
 * the whole chain in its own code (the staff module's chain.ts), never asking the database for a text or a hash, since
 * whoever owns the database can replace its functions, and checks it against the places kept before: a rewrite that
 * recomputed every later hash still fails against a place kept before it. Neither needs a server secret or the console's
 * configuration, so both run the same with the console off or moved: each reads only the database URLs it connects with
 * (staffDatabaseUrls), never the API's whole configuration.
 */
import { pathToFileURL } from "node:url";
import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { auditHead, auditLog, closeDb, createDb, staffKeys, type Db, type DbTx } from "@korbat/db";
import { databaseUrl } from "../config";
import { CHAIN_ZERO_HASH, canonicalText, chainHash } from "../staff";
import { LOCK_TIMEOUT_ADVICE, isLockTimeout } from "./lock-timeout";

export const STAFF_USAGE = [
  "usage: node dist/staff.js <command>",
  "  audit-head                             print the audit log's newest place, its hash and its time, to keep off the server",
  "  audit-verify [<chain_seq>:<hash> ...]  recompute the audit chain and check it against places kept before",
].join("\n");

/** A place in the chain and the hash it had when someone kept it, as audit-head printed it. */
export interface KeptPlace {
  seq: number;
  hash: string;
}

export type StaffCommand = { command: "audit-head" } | { command: "audit-verify"; kept: KeptPlace[] };

/** A place as the keeper copies it: at most 15 digits, so it is always a safe integer, and a lower-case hex sha256. */
const KEPT_PLACE = /^([1-9][0-9]{0,14}):([0-9a-f]{64})$/;

export function parseStaffArgs(args: readonly string[]): StaffCommand {
  const [command, ...rest] = args;
  switch (command) {
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

/** The database URLs a command connects with: the API role's, and the auth role's for audit-verify alone. */
export function staffDatabaseUrls(command: StaffCommand, env: Record<string, string | undefined>): { api: string; auth: string | null } {
  if (command.command === "audit-verify") {
    const urls = readEnv(AUDIT_VERIFY_ENV, env, command.command);
    return { api: urls.DATABASE_URL_API, auth: urls.DATABASE_URL_AUTH };
  }
  return { api: readEnv(AUDIT_HEAD_ENV, env, command.command).DATABASE_URL_API, auth: null };
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

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void runStaffCommand(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
```

### Create `apps/api/src/staff/audit.ts`

```ts
import { and, desc, eq, lt, lte, type SQL } from "drizzle-orm";
import { STAFF_AUDIT_PAGE_SIZE, type AuditPage, type AuditPageQuery, type StaffStoredAssertion } from "@korbat/contracts";
import { auditLog, profiles, type Db, type DbTx } from "@korbat/db";

/** What a read runs through: the pool, or a transaction that should see its own writes. */
type Querier = Pick<Db, "select">;

/**
 * One staff action's row on the record, as the staff module writes it for actions on public tables (3c's decisions are
 * the first). The auth side's rows (sign-ins, revocations, role changes) are not written here: the auth module writes them
 * through auth.append_audit in the transaction of their change. The trigger sets the id, the time, the place and the
 * hashes, whatever an insert supplies, so none is taken here.
 */
export interface StaffAuditRow {
  /** The staff account that acted; 00000000-0000-0000-0000-000000000000 for the server itself. */
  actorId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  /** What the action was, never an email, IP, device or phone: the reader never shows it, but the record keeps it for good. */
  metadata?: Record<string, unknown>;
  /** The handle of the staff session the action came from. */
  staffSession?: string | null;
  /** A step-up's key, action hash and assertion go together, as the table's check requires. */
  keyId?: string | null;
  actionHash?: string | null;
  stepUp?: StaffStoredAssertion | null;
}

/** A row's place in the chain and its hash. */
export interface AuditPlace {
  seq: number;
  hash: string;
}

/**
 * Writes a staff action's row in the caller's transaction, which also holds the action's change, so the fact is in the
 * record exactly when its change commits. The insert takes the chain's head and holds it until that transaction ends, so
 * it must be the transaction's last statement: nothing that can wait (another row lock, Valkey, a mail) may run between
 * it and the commit, or every other audit write waits too.
 */
export async function appendAuditRow(tx: DbTx, row: StaffAuditRow): Promise<AuditPlace> {
  const [written] = await tx
    .insert(auditLog)
    .values({
      actorId: row.actorId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      requestId: row.requestId,
      metadata: row.metadata ?? {},
      staffSession: row.staffSession ?? null,
      keyId: row.keyId ?? null,
      actionHash: row.actionHash ?? null,
      stepUp: row.stepUp ?? null,
    })
    .returning({ seq: auditLog.chainSeq, hash: auditLog.hash });
  return written!;
}

/**
 * One page of the record, newest first by place (3a design, section 7): from the newest row, from before `cursor`, or the
 * page whose newest row is at place `at` (the keeper's "Go to place"), optionally only one action (the home screen's
 * sign-ins). Each entry names its actor by the actor's public handle, null for the server or an account without one, and
 * never carries the metadata. Reading is not itself recorded.
 */
export async function auditPage(q: Querier, query: AuditPageQuery): Promise<AuditPage> {
  const conditions: SQL[] = [];
  if (query.cursor !== undefined) conditions.push(lt(auditLog.chainSeq, query.cursor));
  if (query.at !== undefined) conditions.push(lte(auditLog.chainSeq, query.at));
  if (query.action !== undefined) conditions.push(eq(auditLog.action, query.action));
  // One row more than a page, to know whether another page follows.
  const rows = await q
    .select({
      seq: auditLog.chainSeq,
      hash: auditLog.hash,
      createdAt: auditLog.createdAt,
      actorHandle: profiles.handle,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      actionHash: auditLog.actionHash,
    })
    .from(auditLog)
    // A profile's id is its account's id; the system actor and an account that never chose a handle have none.
    .leftJoin(profiles, eq(profiles.id, auditLog.actorId))
    .where(and(...conditions))
    .orderBy(desc(auditLog.chainSeq))
    .limit(STAFF_AUDIT_PAGE_SIZE + 1);
  const entries = rows.slice(0, STAFF_AUDIT_PAGE_SIZE).map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  return { entries, nextCursor: rows.length > STAFF_AUDIT_PAGE_SIZE ? entries[entries.length - 1]!.seq : null };
}
```

### Create `apps/api/src/staff/chain.ts`

```ts
import { createHash } from "node:crypto";

/**
 * The audit chain's canonical text in Node (3a design, section 6). The text is defined once, in the design, and written
 * twice: in SQL by migration 0012's public.audit_chain_text, which the trigger hashes every row with, and here, which
 * audit-verify recomputes every row with. Nothing here asks the database for a text or a hash, since whoever owns the
 * database can replace its functions.
 */

/** The first row's prev_hash, and the hash of an empty log's head: 64 zeros. */
export const CHAIN_ZERO_HASH = "0".repeat(64);

/**
 * A row of the audit log as the chain covers it. `metadataText` and `stepUpText` are the stored jsonb exactly as
 * PostgreSQL prints it (a `::text` cast: jsonb's own key order, ", " and ": " between items), which the text embeds as it
 * is and never re-serialises. `createdAt` is the row's time, which the trigger truncated to the millisecond.
 */
export interface ChainRow {
  chainVersion: number;
  chainSeq: number;
  id: number;
  createdAt: Date;
  actorId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  staffSession: string | null;
  keyId: string | null;
  actionHash: string | null;
  stepUpText: string | null;
  metadataText: string;
}

/** A column as a JSON string, escaped as JSON.stringify escapes it (which to_json(text) agrees with), or null. */
const jsonString = (value: string | null): string => (value === null ? "null" : JSON.stringify(value));

/**
 * The canonical text of a row: a JSON array without whitespace between its elements. chain_version, chain_seq and id as
 * decimal integers; created_at in UTC as "YYYY-MM-DDTHH:MM:SS.mmmZ"; the actor, the action, the target's type and id, the
 * request id, the staff session's handle, the key and the action's hash, each a JSON string or null (uuids as PostgreSQL
 * prints them, in lower case); then step_up and last metadata, as stored. Only version 1 exists: a version this code does
 * not know is refused rather than hashed as another, and a later version is added here and in SQL together.
 */
export function canonicalText(row: ChainRow): string {
  if (row.chainVersion !== 1) throw new Error(`audit chain version ${row.chainVersion} is not known`);
  return `[${[
    String(row.chainVersion),
    String(row.chainSeq),
    String(row.id),
    jsonString(row.createdAt.toISOString()),
    jsonString(row.actorId),
    jsonString(row.action),
    jsonString(row.targetType),
    jsonString(row.targetId),
    jsonString(row.requestId),
    jsonString(row.staffSession),
    jsonString(row.keyId),
    jsonString(row.actionHash),
    row.stepUpText ?? "null",
    row.metadataText,
  ].join(",")}]`;
}

/**
 * A row's hash: the lower-case hex sha256 of the UTF-8 bytes of the previous row's hash followed by the row's text, as
 * the trigger computes it with convert_to(..., 'UTF8').
 */
export function chainHash(prevHash: string, text: string): string {
  return createHash("sha256").update(prevHash + text, "utf8").digest("hex");
}
```

### Create `apps/api/src/staff/gate.ts`

```ts
import { createMiddleware } from "hono/factory";
import { AuthError } from "../auth";
import type { AppEnv } from "../env";

const SAFE_METHODS = new Set(["GET", "HEAD"]);

/**
 * The staff gate (3a design, section 7): every request under /api/staff, with or without a session, passes it before any
 * flow runs or any session is read.
 *
 * - Its Host header, port included, must be the console's host; any other is answered with the 404 of an unknown route,
 *   the same as a console that is off, so a page cannot tell the two apart. The header itself is read, never
 *   X-Forwarded-Host: Caddy and cloudflared pass Host on unchanged.
 * - An Origin, when present, must be exactly CONSOLE_ORIGIN, and anything but GET and HEAD must carry one.
 * - A Sec-Fetch-Site, when present, must be same-origin. Browsers send it; Node's fetch and old browsers send none, and
 *   fall back on the Origin test, the staff CSRF header and the absence of CORS.
 *
 * A request that fails the Origin or fetch-metadata test is refused with csrf_failed and touches no session, so a page on
 * another origin of the same site (the app on a subdomain, any localhost port in development) can neither act nor keep a
 * staff session from going idle.
 */
export function staffGate(consoleOrigin: string) {
  // CONSOLE_ORIGIN is stored exactly as browsers send Origin (config.ts), so both tests below compare strings.
  const host = new URL(consoleOrigin).host;
  return createMiddleware<AppEnv>(async (c, next) => {
    if (c.req.header("host") !== host) return c.notFound();
    const origin = c.req.header("origin");
    if (origin === undefined ? !SAFE_METHODS.has(c.req.method) : origin !== consoleOrigin) throw new AuthError("csrf_failed", 403);
    const site = c.req.header("sec-fetch-site");
    if (site !== undefined && site !== "same-origin") throw new AuthError("csrf_failed", 403);
    await next();
  });
}
```

### Create `apps/api/src/staff/index.ts`

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
import { auditPage } from "./audit";
import { staffRoutes } from "./routes";

export { CHAIN_ZERO_HASH, canonicalText, chainHash, type ChainRow } from "./chain";
export { appendAuditRow, type AuditPlace, type StaffAuditRow } from "./audit";

export interface CreateStaffOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
}

export function createStaff(options: CreateStaffOptions) {
  return {
    /** The routes under /api/staff, behind the staff gate for the console at `consoleOrigin`. */
    routes: (consoleOrigin: string) => staffRoutes(consoleOrigin),
    /** One page of the audit log, newest first, as GET /api/staff/audit answers it. */
    readAudit: (query: AuditPageQuery) => auditPage(options.apiDb, query),
  };
}

export type Staff = ReturnType<typeof createStaff>;
```

### Create `apps/api/src/staff/routes.ts`

```ts
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { staffGate } from "./gate";

/**
 * The staff routes (3a design, section 7), which createApp mounts at /api/staff only while CONSOLE_ORIGIN is set. The gate
 * stands in front of every path under it, /api/staff itself and the paths no route answers included, so a wrong Host is
 * the 404 of an unknown route there too. The routes themselves (sign-in, sessions, the audit log, step-up) come with the
 * auth module's staff flows.
 */
export function staffRoutes(consoleOrigin: string) {
  const routes = new Hono<AppEnv>();
  routes.use("*", staffGate(consoleOrigin));
  return routes;
}
```

### Replace `apps/api/build.mjs` (whole file)

```js
// Bundles the API for the Docker image. esbuild is called directly: the whole configuration fits here.
import { rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await build({
  // Each entry is a bundle of its own. The command lines check that they were run directly by comparing import.meta.url,
  // which in a bundle is the bundle's, so no entry may import another entry's file.
  entryPoints: { index: "src/index.ts", migrate: "src/migrate.ts", "grant-role": "src/cli/grant-role.ts", staff: "src/cli/staff.ts" },
  outdir: "dist",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  sourcemap: true,
  // Everything is bundled except @node-rs/argon2: it loads a platform-specific native binary at
  // runtime, so the Docker image ships it in node_modules next to the bundle.
  packages: "bundle",
  external: ["@node-rs/argon2", "@node-rs/argon2/*"],
  // Bundled CommonJS dependencies call require(); an ES module bundle has to provide it. The import is
  // aliased because esbuild cannot rename a banner's names, and a bundled ES module (fflate) imports
  // createRequire itself at top level: with the plain name the bundle declares it twice and Node refuses to load it.
  banner: { js: "import { createRequire as createRequireForBundle } from 'node:module'; const require = createRequireForBundle(import.meta.url);" },
  logLevel: "info",
});
console.log("Build success");
```

### Replace `apps/api/src/app.ts` (whole file)

```ts
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { Logger } from "pino";
import { AccountError, type Account } from "./account";
import { AuthError, type Auth } from "./auth";
import type { Config } from "./config";
import type { AppEnv } from "./env";
import { errorBody } from "./lib/errors";
import { MediaError, type Media } from "./media";
import { observability } from "./middleware/observability";
import { clientIpKey, rateLimit, type RateLimitStore } from "./middleware/rate-limit";
import { noStore, securityHeaders } from "./middleware/security-headers";
import { healthRoutes, type HealthChecks } from "./routes/health";
import { SocialError, type Social } from "./social";
import type { Staff } from "./staff";

/** JSON requests are small; the one raw upload route counts its own bytes and is exempt. */
export const JSON_BODY_LIMIT_BYTES = 64 * 1024;

/**
 * The staff console's paths (3a design, section 5): /api/staff and everything under it, never a path that merely begins
 * with the same letters. The app's CORS and session resolution pass over them, so a staff route never meets the app's
 * credentialed CORS, its Origin allow-list, its session or its CSRF check: the staff gate and the staff session are the
 * only origin and session logic there. Everything else in the chain (request id, access log, client identity, security
 * headers, no-store, the body limit, the global rate limit) applies to them as to any path.
 */
const isStaffPath = (path: string) => path === "/api/staff" || path.startsWith("/api/staff/");

export interface AppDeps {
  config: Config;
  logger: Logger;
  rateLimitStore: RateLimitStore;
  healthChecks: HealthChecks;
  auth: Auth;
  /** Posting and feed. Optional so auth-only tests need no database for it; the server always wires it. */
  social?: Social;
  /** Image uploads. Optional for the same reason; the server always wires it. */
  media?: Media;
  /** The account lifecycle (the data export). Optional for the same reason; the server always wires it. */
  account?: Account;
  /** The staff console's API. Mounted only while CONSOLE_ORIGIN is set; optional as the other modules are. */
  staff?: Staff;
  /** Checks that report a part being down without marking the API unhealthy, the image worker for one. */
  advisoryChecks?: HealthChecks;
}

export function createApp({ config, logger, rateLimitStore, healthChecks, auth, social, media, account, staff, advisoryChecks }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use(observability(logger));
  app.use(auth.clientIdentity);
  app.use(securityHeaders, noStore);
  const appCors = cors({ origin: config.TRUSTED_ORIGINS, credentials: true });
  app.use((c, next) => (isStaffPath(c.req.path) ? next() : appCors(c, next)));
  const jsonBodies = bodyLimit({
    maxSize: JSON_BODY_LIMIT_BYTES,
    onError: (c) => c.json(errorBody("payload_too_large", "The request body is too large", (c as typeof c & { get(key: "requestId"): string }).get("requestId")), 413),
  });
  app.use((c, next) => (c.req.method === "POST" && c.req.path === "/api/media" ? next() : jsonBodies(c, next)));
  // Image files come before the global limit and session resolution: they have their own bucket,
  // and a public image needs no session. Everything else under /api/media falls through to below.
  if (media) app.route("/api/media", media.fileRoutes);
  app.use(rateLimit({ name: "global", store: rateLimitStore, limit: 300, windowMs: 60_000, key: clientIpKey }));
  app.use((c, next) => (isStaffPath(c.req.path) ? next() : auth.resolveSession(c, next)));

  app.route("/api/health", healthRoutes(healthChecks, config.KORBAT_VERSION, advisoryChecks));
  app.route("/api/auth", auth.routes);
  app.get("/api/me", auth.requireOnboarding, auth.me);
  if (media) app.route("/api/media", media.routes);
  if (account) app.route("/api/account", account.routes);
  // The console is off while CONSOLE_ORIGIN is unset: nothing is mounted, and every staff path is the unknown route below.
  if (staff && config.CONSOLE_ORIGIN !== undefined) app.route("/api/staff", staff.routes(config.CONSOLE_ORIGIN));
  if (social) app.route("/api", social.routes);

  app.notFound((c) => c.json(errorBody("not_found", "No such route", c.get("requestId")), 404));
  app.onError((err, c) => {
    if (err instanceof AuthError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId"), err.details), err.status);
    }
    if (err instanceof HTTPException) return c.json(errorBody("invalid_request", err.message, c.get("requestId")), err.status);
    if (err instanceof MediaError) return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    if (err instanceof SocialError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    }
    // The account routes render nothing themselves: their own errors and those of the three modules they call all land here.
    if (err instanceof AccountError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    }
    c.get("log").error({ err }, "unhandled error");
    return c.json(errorBody("internal", "Internal error", c.get("requestId")), 500);
  });

  return app;
}
```

### Replace `apps/api/src/auth/admin.ts` (whole file)

```ts
import type { AuthRepo, UserRole } from "./repo";
import type { Sessions } from "./sessions";

/** The audit log's actor for changes made from the server's command line rather than by a signed-in person. */
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Changes an account's role. Used only by the server-side CLI; there is no API endpoint for it.
 * Every session of the account is revoked so the new role (and its MFA requirement) applies at once. The change, the
 * revocations and the role_granted row of the audit log are one transaction on the auth role (3a design, section 7); the
 * cached sessions get their tombstones after it commits.
 */
export async function grantRole(
  deps: { repo: AuthRepo; sessions: Sessions },
  email: string,
  role: UserRole,
): Promise<{ userId: string; previousRole: UserRole }> {
  const changed = await deps.repo.changeRole(email, role, { actorId: SYSTEM_ACTOR_ID, now: new Date() });
  if (!changed) throw new Error(`no account for ${email}`);
  await deps.sessions.tombstone(changed.sessionIds);
  return { userId: changed.userId, previousRole: changed.previousRole };
}
```

### Replace `apps/api/src/auth/index.ts` (whole file)

```ts
/**
 * The only file outside `src/auth/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { DeleteConfirmRequest, DeleteStartResponse } from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type Redis from "ioredis";
import type { Logger } from "pino";
import type { Config } from "../config";
import type { Mailer } from "../mail/mailer";
import { clientIdentity } from "./client-ip";
import { authConfigFrom, type AuthDeps, type ProfileStore, type RequestContext } from "./context";
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
import { cloudflareTurnstile, type TurnstileVerifier } from "./turnstile";
import { devProvider } from "./verify/dev";
import type { VerificationProvider } from "./verify/provider";
import { vonageProvider } from "./verify/vonage";

export type { ProfileStore, RequestContext } from "./context";
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
  return {
    deps,
    routes: authRoutes(deps),
    me: meHandler(deps),
    appendEvent,
    /** The interface the account module uses. */
    forAccount,
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

### Replace `apps/api/src/auth/repo.ts` (whole file)

```ts
import { and, desc, eq, getTableColumns, gt, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { authEventType, authEvents, devices, emailCodePurpose, emailCodes, passkeys, sessions, userRole, users, type Db } from "@korbat/db";

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
     * another in a circle); the role is set, every session revoked, and last, through auth.append_audit, the role_granted
     * row. The row holds the audit chain's head until the
     * commit, so the change and its record commit together or not at all. Only the command line calls this, and it waits
     * at most 10 seconds for a lock: an API that holds the head or the row open cannot stall it for longer, and one that
     * times out has changed nothing. Answers the ids of the revoked sessions, for the cache tombstones, which are not the
     * database's to write; undefined when no live account has the address.
     */
    async changeRole(email: string, role: UserRole, audit: { actorId: string; now: Date }): Promise<{ userId: string; previousRole: UserRole; sessionIds: string[] } | undefined> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '10s'`);
        const [account] = await tx
          .select({ id: users.id, role: users.role })
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
        await appendAudit(tx, {
          actorId: audit.actorId,
          action: "role_granted",
          targetType: "user",
          targetId: account.id,
          metadata: { from: account.role, to: role, via: "cli" },
        });
        return { userId: account.id, previousRole: account.role, sessionIds: revoked.map((row) => row.id) };
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
     * session revoked, every device, code and passkey deleted, the WebAuthn user handle cleared, and the
     * account_deleted event appended. Either all of it lands or none of it does, so a failure leaves a live
     * account with its sessions, never a deleted one with sessions, devices and passkeys that nothing would
     * remove. Answers the ids of the sessions it revoked, for the cache tombstones, which are not the database's
     * to write.
     */
    async takeDown(userId: string, now: Date, deviceId: string | null): Promise<string[]> {
      return db.transaction(async (tx) => {
        await tx.update(users).set({ deletedAt: now }).where(and(eq(users.id, userId), isNull(users.deletedAt)));
        const revoked = await takeDownRows(tx, userId, now);
        await tx.insert(authEvents).values({ userId, type: "account_deleted", deviceId, metadata: {} });
        return revoked;
      });
    },

    /**
     * The rows of step 1 again (the sessions, devices, codes and passkeys, and the WebAuthn user handle), for a row
     * marked deleted and not purged yet: a take-down that stopped after the mark, or a session that a sign-in already
     * past its lookup created after it. Nothing for a live or a purged row. The event is not appended again: the
     * confirmation that recorded it is the only one there was.
     */
    async finishTakeDown(userId: string, now: Date): Promise<string[]> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, userId), isNotNull(users.deletedAt), isNull(users.purgedAt)));
        return row ? takeDownRows(tx, userId, now) : [];
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

/**
 * The rows step 1 of a deletion takes down, inside the caller's transaction: every live session is revoked
 * (its id answered, for the cache tombstones), every device is deleted, and with it by cascade every session
 * row, every code out for the user goes, whatever its purpose, so none can complete a flow for an account
 * that is gone, and every passkey goes with the WebAuthn user handle (1c design, section 7.7), so a deleted
 * account keeps no credential of any kind and no assertion can name it again. Run again by finishTakeDown,
 * each statement finds nothing more to do.
 */
async function takeDownRows(tx: Tx, userId: string, now: Date): Promise<string[]> {
  const revoked = await tx
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  await tx.delete(devices).where(eq(devices.userId, userId));
  await tx.delete(emailCodes).where(eq(emailCodes.userId, userId));
  await tx.delete(passkeys).where(eq(passkeys.userId, userId));
  // The handle only ever named the account to its passkeys; cleared here rather than by finishPurge, so the take-down leaves nothing of the ceremony behind.
  await tx.update(users).set({ webauthnUserId: null }).where(eq(users.id, userId));
  return revoked.map((row) => row.id);
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
 * Every session of the account is revoked, and the change is written to public.audit_log in the same transaction.
 */
import { pathToFileURL } from "node:url";
import Redis from "ioredis";
import { Email, Role } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createAuthRepo, createSessions, grantRole, redisKv, type KeyValueStore, type UserRole } from "../auth";
import { loadConfig } from "../config";
import { LOCK_TIMEOUT_ADVICE, isLockTimeout } from "./lock-timeout";

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

/** The role change and its audit row in one transaction on the auth role; grant-role opens no pool on the API's role. */
export async function runGrantRole(deps: { authDb: Db; kv: KeyValueStore }, email: string, role: UserRole) {
  const repo = createAuthRepo(deps.authDb);
  const sessions = createSessions({ repo, kv: deps.kv });
  try {
    return await grantRole({ repo, sessions }, email, role);
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
    const { userId, previousRole } = await runGrantRole({ authDb, kv: redisKv(redis) }, parsed.email, parsed.role);
    console.log(`user ${userId}: role ${previousRole} -> ${parsed.role}; every session revoked`);
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
  SMTP_URL: z.url({ protocol: /^smtps?$/ }),
  MAIL_FROM: z.string().min(3),
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
  CONSOLE_ORIGIN: blankAsUnset.pipe(consoleOrigin.optional()),
  /**
   * The relying party ID staff keys are bound to: the console's hostname when unset. Production requires exactly that
   * hostname, so staff keys work on the console and nowhere else; a parent domain was declined (3a design, section 2).
   */
  CONSOLE_RP_ID: blankAsUnset.pipe(z.string().toLowerCase().regex(RP_ID, "must be a bare domain name such as console.example: no scheme, port or path").optional()),
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

// The staff console's API; createApp mounts it only while CONSOLE_ORIGIN is set.
const staff = createStaff({ apiDb });

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
packages/contracts test:       Tests  131 passed (131)
packages/db test:       Tests  40 passed (40)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  107 passed (107)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  495 passed | 337 skipped (832)
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
Tests  335 passed (335)
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
- `audit-verify [<chain_seq>:<hash> ...]`
- `staff-exit=2`

Observed on the dry run:

```text
usage: node dist/staff.js <command>
audit-verify [<chain_seq>:<hash> ...]  recompute the audit chain and check it against places kept before
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

- `apps/api/build.mjs`
- `apps/api/src/app.ts`
- `apps/api/src/auth/admin.ts`
- `apps/api/src/auth/index.ts`
- `apps/api/src/auth/repo.ts`
- `apps/api/src/cli/grant-role.ts`
- `apps/api/src/cli/lock-timeout.ts`
- `apps/api/src/cli/staff.ts`
- `apps/api/src/config.ts`
- `apps/api/src/index.ts`
- `apps/api/src/staff/audit.ts`
- `apps/api/src/staff/chain.ts`
- `apps/api/src/staff/gate.ts`
- `apps/api/src/staff/index.ts`
- `apps/api/src/staff/routes.ts`
- `apps/api/test/architecture.test.ts`
- `apps/api/test/cli-staff.test.ts`
- `apps/api/test/http-client.test.ts`
- `apps/api/test/integration/audit-verify.test.ts`
- `apps/api/test/integration/cli-grant-role.test.ts`
- `apps/api/test/integration/http-client.ts`
- `apps/api/test/integration/staff-audit.test.ts`
- `apps/api/test/staff/app-mount.test.ts`
- `apps/api/test/staff/chain-vectors.ts`
- `apps/api/test/staff/chain.test.ts`
- `apps/api/test/staff/gate.test.ts`

## Step 11: commit

```bash
git add -A
git commit -q -m "feat(api): the staff module and the audit record: chain.ts recomputes the canonical text and the hash in Node, byte for byte with the trigger's, against shared test vectors; the staff module is mounted only while CONSOLE_ORIGIN is set, never meets the app's CORS or session, and stands behind a gate that answers another Host 404 and another Origin or Sec-Fetch-Site 403; staff.js audit-head prints the newest place and hash, and audit-verify reads the head and the rows in one snapshot, recomputes every hash in its own code, checks places kept off the server and that every staff key was added on the record, with only the database URLs it needs; grant-role changes the role and writes its record in one auth transaction through auth.append_audit, giving up after 10 seconds on a held head; the integration client speaks to the console's host with the staff CSRF header" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(api): the staff module and the audit record: chain.ts recomputes the canonical text and the hash in Node, byte for byte with the trigger's, against shared test vectors; the staff module is mounted only while CONSOLE_ORIGIN is set, never meets the app's CORS or session, and stands behind a gate that answers another Host 404 and another Origin or Sec-Fetch-Site 403; staff.js audit-head prints the newest place and hash, and audit-verify reads the head and the rows in one snapshot, recomputes every hash in its own code, checks places kept off the server and that every staff key was added on the record, with only the database URLs it needs; grant-role changes the role and writes its record in one auth transaction through auth.append_audit, giving up after 10 seconds on a held head; the integration client speaks to the console's host with the staff CSRF header`.

## Report format (mandatory)

```text
TASK 2 REPORT
Files written: <count, expected 26>
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

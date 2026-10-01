# korbat staff console (3a) — Task 1 of 9: The ground for the staff console: the console's origin and relying party settings, the staff contracts, migration 0012 (staff keys, enrolments and staff sessions guarded by the database; the audit log as a hash chain with its head, trigger and back-fill; the migrator-owned functions that add a staff key, append the auth side's audit rows and forget a deleted account's keys), the schema test, the harness's head row and the development cleaner's skip

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-30 and 2026-10-01 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend: a Hono API on Node 24, an Expo web app, PostgreSQL 18 and Valkey in Docker Compose. Sub-project 3a gives staff a console of its own: staff keys (WebAuthn credentials that report user verification and no backup eligibility, on the console's own relying party) enrolled only through links the command line issues as the migrator, staff sessions apart from user sessions, a per-action step-up whose assertion is stored in the record, and the audit log as a hash chain that `audit-verify` checks against heads kept off the server. This task lays the ground: the settings, the contracts, migration 0012 with the database's own guards and the chain, and the tests that need no flow. The design is `docs/superpowers/specs/2026-09-28-staff-console-3a-design.md` (sections 6, 8, 10 and 13).

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `docs: staff console (3a) plan and verified execution prompts`.

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
python docs/superpowers/prompts/staff-console-3a/write_blocks.py docs/superpowers/prompts/staff-console-3a/01-ground.md 1
```

Expected: 7 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/integration/audit-chain-schema.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { auditHead, auditLog, closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { ZERO_HASH, pgError, rolledBack, withLockTimeout } from "./staff-fixtures";

type ChainRow = { id: number; chain_seq: number; prev_hash: string; hash: string; chain_version: number };

/**
 * Migration 0012's audit chain (3a design, section 6) against the real database, before any flow writes through it: what
 * the API role cannot do to audit_log and audit_head, and that the trigger alone places every row. audit-verify arrives with
 * Task 2; until then the chain is walked here, and each row's hash is recomputed by the database's own text function as
 * the migrator, which owns it.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the audit chain in the database", () => {
  let apiDb: Db;
  let migrateDb: Db;
  const actorId = "00000000-0000-0000-0000-000000000000";

  beforeAll(() => {
    apiDb = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
  });
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(migrateDb)]);
  });

  /** One ordinary row, as the staff module's writer will insert it: no id, time or chain column supplied. */
  const insertRow = (db: Db | DbTx, action = `probe-${randomUUID()}`) =>
    db.insert(auditLog).values({ actorId, action, targetType: "user", targetId: randomUUID(), metadata: { via: "test" } }).returning();

  /** The same row written in a transaction of its own under a lock timeout: an audit insert holds the head until it ends. */
  const writeRow = (db: Db, action?: string) => withLockTimeout(db, (tx) => insertRow(tx, action));

  const readHead = async (db: Db | DbTx = apiDb) => (await db.select().from(auditHead))[0];

  /** Whether the database's text function, run as the owner, gives each row the hash it stores. */
  async function hashesHold(db: Db | DbTx, ids: number[]): Promise<boolean> {
    // The ids go as one bigint[] literal such as {1,3,5}.
    const rows = await db.execute<{ ok: boolean; n: number }>(
      sql`select bool_and(a.hash = encode(sha256(convert_to(a.prev_hash || public.audit_chain_text(a), 'UTF8')), 'hex')) as ok, count(*)::int as n
            from public.audit_log a where a.id = any(${`{${ids.join(",")}}`}::bigint[])`,
    );
    return rows[0]!.n === ids.length && rows[0]!.ok === true;
  }

  describe("what the API role cannot do", () => {
    test("it cannot change, remove or truncate an audit row", async () => {
      const [row] = await writeRow(apiDb);
      for (const statement of [
        sql`update public.audit_log set action = 'edited' where id = ${row!.id}`,
        sql`update public.audit_log set hash = ${ZERO_HASH} where id = ${row!.id}`,
        sql`delete from public.audit_log where id = ${row!.id}`,
        sql`truncate public.audit_log`,
      ]) {
        const err = await pgError(withLockTimeout(apiDb, (tx) => tx.execute(statement)));
        expect(err?.message).toMatch(/permission denied for table audit_log/);
      }
      const [after] = await apiDb.select().from(auditLog).where(eq(auditLog.id, row!.id));
      expect(after).toEqual(row);
    });

    test("it reads the head, but can neither write it nor lock it", async () => {
      expect(await readHead()).toMatchObject({ id: 1 });
      for (const statement of [
        sql`insert into public.audit_head (id, seq, hash) values (1, 0, ${ZERO_HASH})`,
        sql`update public.audit_head set seq = seq + 1`,
        sql`delete from public.audit_head`,
        sql`truncate public.audit_head`,
        // Holding the head's row would stall every audit write: every row lock needs UPDATE.
        sql`select * from public.audit_head for update`,
        sql`select * from public.audit_head for no key update`,
        sql`select * from public.audit_head for share`,
        sql`select * from public.audit_head for key share`,
        // Of the table locks, SELECT allows only ACCESS SHARE, which conflicts with nothing the trigger takes.
        sql`lock table public.audit_head in row share mode`,
        sql`lock table public.audit_head in exclusive mode`,
        sql`lock table public.audit_head in access exclusive mode`,
      ]) {
        const err = await pgError(withLockTimeout(apiDb, (tx) => tx.execute(statement)));
        expect(err?.message, JSON.stringify(statement.queryChunks[0])).toMatch(/permission denied for table audit_head/);
      }
    });

    test("it can neither switch triggers off for its session nor disable, replace or add a trigger on the log", async () => {
      const refusals: [ReturnType<typeof sql>, RegExp][] = [
        [sql`set session_replication_role = replica`, /permission denied to set parameter "session_replication_role"/],
        [sql`set local session_replication_role = replica`, /permission denied to set parameter "session_replication_role"/],
        [sql`alter table public.audit_log disable trigger audit_chain`, /must be owner of table audit_log/],
        [sql`alter table public.audit_log disable trigger all`, /must be owner of table audit_log/],
        [sql`drop trigger audit_chain on public.audit_log`, /must be owner of (table|relation) audit_log/],
        [sql`create trigger probe before insert on public.audit_log for each row execute function public.audit_chain()`, /permission denied/],
        [sql`create or replace function public.audit_chain_text(r public.audit_log) returns text language sql as 'select 1::text'`, /permission denied|must be owner/],
        // Nor move the id sequence under the rows, nor run the chain's functions itself.
        [sql`select setval('public.audit_log_id_seq', 1)`, /permission denied for sequence audit_log_id_seq/],
        [sql`select public.audit_chain_text(a) from public.audit_log a limit 1`, /permission denied for function audit_chain_text/],
      ];
      for (const [statement, refusal] of refusals) {
        const err = await pgError(withLockTimeout(apiDb, (tx) => tx.execute(statement)));
        expect(err?.message, JSON.stringify(statement.queryChunks[0])).toMatch(refusal);
      }
    });
  });

  describe("the trigger places every row", () => {
    test("supplied id, time and chain columns are overwritten", async () => {
      const head = (await readHead())!;
      const forged = {
        id: 999_999_999,
        actorId,
        action: `forged-${randomUUID()}`,
        createdAt: new Date("2001-01-01T00:00:00.000Z"),
        chainVersion: 9,
        chainSeq: 1,
        prevHash: ZERO_HASH,
        hash: "f".repeat(64),
      };
      const [row] = await withLockTimeout(apiDb, (tx) => tx.insert(auditLog).values(forged).returning());
      expect(row!.id).not.toBe(999_999_999);
      expect(row).toMatchObject({ chainVersion: 1, chainSeq: head.seq + 1, prevHash: head.hash });
      expect(row!.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(Math.abs(row!.createdAt.getTime() - Date.now())).toBeLessThan(60_000);
      // The time the row joined the chain, in whole milliseconds.
      const [truncated] = await apiDb.execute<{ ok: boolean }>(sql`select created_at = date_trunc('milliseconds', created_at) as ok from public.audit_log where id = ${row!.id}`);
      expect(truncated!.ok).toBe(true);
      expect(await readHead()).toEqual({ id: 1, seq: row!.chainSeq, hash: row!.hash });
      expect(await hashesHold(migrateDb, [row!.id])).toBe(true);
    });

    test("an insert naming an existing id with ON CONFLICT DO NOTHING is written under a new id and chained", async () => {
      const [first] = await writeRow(apiDb);
      const count = await apiDb.$count(auditLog);
      const written = await withLockTimeout(apiDb, (tx) =>
        tx.insert(auditLog).values({ id: first!.id, actorId, action: `conflict-${randomUUID()}` }).onConflictDoNothing().returning(),
      );
      expect(written).toHaveLength(1);
      expect(written[0]!.id).toBeGreaterThan(first!.id);
      expect(written[0]).toMatchObject({ chainSeq: first!.chainSeq + 1, prevHash: first!.hash });
      expect(await apiDb.$count(auditLog)).toBe(count + 1);
      expect(await readHead()).toEqual({ id: 1, seq: written[0]!.chainSeq, hash: written[0]!.hash });
    });

    test("a temporary audit_head the API role creates changes nothing", async () => {
      // One connection, so the temporary table and the insert share the session.
      const session = createDb(loadConfig().DATABASE_URL_API, { max: 1 });
      try {
        await session.execute(sql`set lock_timeout = '10s'`);
        const real = (await readHead())!;
        await session.execute(sql`create temporary table audit_head (id smallint, seq bigint, hash text)`);
        await session.execute(sql`insert into pg_temp.audit_head values (1, 999999, ${"f".repeat(64)})`);
        // Even readable by the trigger's owner, the stand-in is never consulted: every name the trigger uses is qualified.
        await session.execute(sql`grant all on pg_temp.audit_head to korbat_migrate`);
        const [row] = await insertRow(session);
        expect(row).toMatchObject({ chainSeq: real.seq + 1, prevHash: real.hash });
        expect(await readHead()).toEqual({ id: 1, seq: row!.chainSeq, hash: row!.hash });
        const [stand] = await session.execute<{ seq: string; hash: string }>(sql`select seq::text, hash from pg_temp.audit_head`);
        expect(stand).toEqual({ seq: "999999", hash: "f".repeat(64) });
      } finally {
        await closeDb(session);
      }
    });

    test("the step-up columns go together: the action's hash with its assertion, and both with the key", async () => {
      const stepUp = { authenticatorData: "AAAA", clientDataJSON: "BBBB", signature: "CCCC" };
      const keyId = randomUUID();
      const incomplete = [
        { actionHash: "ab".repeat(32), keyId },
        { stepUp, keyId },
        { actionHash: "ab".repeat(32), stepUp },
      ];
      for (const columns of incomplete) {
        const err = await pgError(withLockTimeout(apiDb, (tx) => tx.insert(auditLog).values({ actorId, action: "staff_session_revoked", ...columns })));
        expect(err, JSON.stringify(Object.keys(columns))).toMatchObject({ code: "23514", message: expect.stringMatching(/audit_log_step_up_complete/) });
      }
      // A complete one is accepted; rolled back, since its assertion was signed by no key audit-verify could find.
      await rolledBack(apiDb, async (tx) => {
        const [row] = await tx.insert(auditLog).values({ actorId, action: "staff_session_revoked", staffSession: randomUUID(), keyId, actionHash: "ab".repeat(32), stepUp }).returning();
        expect(row).toMatchObject({ keyId, actionHash: "ab".repeat(32), stepUp, chainVersion: 1 });
      });
    });

    test("with the head row missing, an insert fails and creates no head", async () => {
      const before = await readHead();
      await rolledBack(migrateDb, async (tx) => {
        await tx.delete(auditHead);
        // In a savepoint, so the transaction can still be read after the failure.
        const err = await pgError(tx.transaction((sp) => insertRow(sp)));
        expect(err?.message).toBe("the audit head is missing");
        expect(await tx.select().from(auditHead)).toEqual([]);
      });
      expect(await readHead()).toEqual(before);
    });

    test("concurrent inserts, some inside transactions, keep one chain walked in chain_seq order", async () => {
      const WRITERS = 8;
      const EACH = 10;
      // One connection per writer, each with a lock timeout for the whole session.
      const writers = Array.from({ length: WRITERS }, () => createDb(loadConfig().DATABASE_URL_API, { max: 1 }));
      const run = randomUUID();
      try {
        await Promise.all(writers.map((db) => db.execute(sql`set lock_timeout = '10s'`)));
        await Promise.all(
          writers.map(async (db, w) => {
            for (let i = 0; i < EACH; i++) {
              const action = `concurrent-${run}-${w}-${i}`;
              if (i % 2 === 0) {
                await insertRow(db, action);
              } else {
                // A transaction that waits a moment before its insert, which is its last statement, as every audit write's.
                await db.transaction(async (tx) => {
                  await tx.execute(sql`select pg_sleep(${Math.random() * 0.005})`);
                  await insertRow(tx, action);
                });
              }
            }
          }),
        );
      } finally {
        await Promise.all(writers.map((db) => closeDb(db)));
      }

      // The whole chain, from the first row of this run's database.
      const rows = await apiDb.execute<ChainRow>(
        sql`select id::int as id, chain_seq::int as chain_seq, prev_hash, hash, chain_version from public.audit_log order by chain_seq`,
      );
      const mine = await apiDb.$count(auditLog, sql`${auditLog.action} like ${`concurrent-${run}-%`}`);
      expect(mine).toBe(WRITERS * EACH);
      let previous: ChainRow | undefined;
      for (const [index, row] of rows.entries()) {
        expect(row.chain_seq, `row ${row.id}`).toBe(index + 1);
        expect(row.chain_version, `row ${row.id}`).toBe(1);
        expect(row.prev_hash, `row ${row.id}`).toBe(previous ? previous.hash : ZERO_HASH);
        // The trigger draws the id under the head's lock, so ids rise in the chain's order.
        if (previous) expect(row.id, `row ${row.id}`).toBeGreaterThan(previous.id);
        previous = row;
      }
      expect(await readHead()).toEqual({ id: 1, seq: previous!.chain_seq, hash: previous!.hash });
      expect(await hashesHold(migrateDb, rows.map((row) => row.id))).toBe(true);
    });
  });
});
```

### Create `apps/api/test/integration/staff-fixtures.ts`

```ts
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { staffEnrollments, users, type Db, type DbTx } from "@korbat/db";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import type { AuthRepo } from "../../src/auth/repo";
import { newUserWithDevice } from "./auth-fixtures";

/** The first row's prev_hash, and the hash of an empty log's head. */
export const ZERO_HASH = "0".repeat(64);

/** The console the staff harness runs, beside the app at http://localhost:8081 (3a design, section 12). */
export const TEST_CONSOLE_ORIGIN = "http://console.localhost:8090";
export const TEST_CONSOLE_RP_ID = "console.localhost";

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
```

### Create `apps/api/test/integration/staff-schema.test.ts`

```ts
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
      const expired = await issueEnrolment(migrateDb, user.id, { expiresAt: new Date(Date.now() - 1000) });
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

    test("blanks a deleted account's key names, AAGUIDs and transports, keeping what audit-verify needs", async () => {
      const { user, key } = await newStaffKey(authDb, migrateDb, repo);
      await addStaffKey(authDb, (await issueEnrolment(migrateDb, user.id)).token);
      const before = await keyRow(key.id);
      await authDb.update(users).set({ deletedAt: new Date() }).where(eq(users.id, user.id));
      const [result] = await authDb.execute<{ n: number }>(sql`select auth.forget_staff_keys(${user.id}::uuid) as n`);
      expect(result!.n).toBe(2);
      expect(await keyRow(key.id)).toEqual({ ...before, name: "", aaguid: null, transports: [] });
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
```

### Create `packages/contracts/test/staff.test.ts`

```ts
import { describe, expect, test } from "vitest";
import {
  AuditEntry,
  AuditPage,
  AuditPageQuery,
  AuthenticationResponseJSON,
  DisplayName,
  PasskeyOptionsResponse,
  STAFF_AUDIT_PAGE_SIZE,
  STAFF_STEP_UP_ACTIONS,
  StaffEnrollOptionsRequest,
  StaffEnrollOptionsResponse,
  StaffEnrollVerifyRequest,
  StaffEnrollVerifyResponse,
  StaffErrorCode,
  StaffKey,
  StaffKeyKind,
  StaffKeyName,
  StaffKeysResponse,
  StaffMe,
  StaffRole,
  StaffSession,
  StaffSessionRevokeRequest,
  StaffSessionsResponse,
  StaffSignInOptionsResponse,
  StaffSignInVerifyRequest,
  StaffSignInVerifyResponse,
  StaffStepUpActionName,
  StaffStepUpOptionsRequest,
  StaffStepUpOptionsResponse,
  StaffStoredAssertion,
} from "../src/index";

const BELL = String.fromCharCode(7);
/** U+202E, the right-to-left override: invisible, and refused by the display-name rules. */
const RLO = String.fromCharCode(0x202e);

/** A base64url string of exactly n characters. */
const b64 = (n: number) => "A".repeat(n);

const at = "2026-09-30T10:00:00.000Z";
const later = "2026-09-30T22:00:00.000Z";
const token = "a".repeat(43);
const uuid = "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";
const hex = "ab".repeat(32);

/** What @simplewebauthn/browser's startRegistration returns for a security key. */
const registration = {
  id: "q2Xx0w8bRk6nV8yQ0f2mUg",
  rawId: "q2Xx0w8bRk6nV8yQ0f2mUg",
  type: "public-key",
  response: { clientDataJSON: b64(200), attestationObject: b64(400), transports: ["usb", "nfc"] },
  clientExtensionResults: {},
  authenticatorAttachment: "cross-platform",
};

/** What startAuthentication returns for a discoverable staff key: the user handle is there. */
const assertion = {
  id: "q2Xx0w8bRk6nV8yQ0f2mUg",
  rawId: "q2Xx0w8bRk6nV8yQ0f2mUg",
  type: "public-key",
  response: { clientDataJSON: b64(200), authenticatorData: b64(50), signature: b64(96), userHandle: b64(43) },
  clientExtensionResults: {},
  authenticatorAttachment: "cross-platform",
};

const options = { challenge: b64(78), rpId: "console.korbat.example", allowCredentials: [], userVerification: "required", timeout: 300000 };

/** Every key of an object removed in turn must make the schema refuse it. */
function everyFieldRequired(schema: { safeParse: (value: unknown) => { success: boolean } }, value: Record<string, unknown>) {
  for (const key of Object.keys(value)) {
    const partial: Record<string, unknown> = { ...value };
    delete partial[key];
    expect(schema.safeParse(partial).success, key).toBe(false);
  }
}

describe("staff error codes", () => {
  test("are exactly the ten codes of the staff flows", () => {
    expect(StaffErrorCode.options).toEqual([
      "staff_session_required",
      "staff_key_invalid",
      "staff_key_suspended",
      "staff_key_limit",
      "staff_key_not_device_bound",
      "staff_key_not_user_verified",
      "staff_key_refused",
      "staff_enrollment_invalid",
      "staff_step_up_required",
      "staff_step_up_invalid",
    ]);
    expect(StaffErrorCode.safeParse("passkey_invalid").success).toBe(false);
  });
});

describe("staff roles, key names and kinds", () => {
  test("a staff role is moderator or admin, never user", () => {
    expect(StaffRole.options).toEqual(["moderator", "admin"]);
    expect(StaffRole.safeParse("user").success).toBe(false);
  });

  test("a key's name follows the display-name rules", () => {
    expect(StaffKeyName).toBe(DisplayName);
    expect(StaffKeyName.parse("  Blue key ")).toBe("Blue key");
    expect(StaffKeyName.safeParse("x".repeat(51)).success).toBe(false);
    expect(StaffKeyName.safeParse(`Blue${BELL}key`).success).toBe(false);
    expect(StaffKeyName.safeParse(`Blue${RLO}key`).success).toBe(false);
  });

  test("a key is a security key or this device", () => {
    expect(StaffKeyKind.options).toEqual(["security_key", "this_device"]);
    expect(StaffKeyKind.safeParse("platform").success).toBe(false);
  });
});

describe("enrolment", () => {
  test("options are asked for with the link's token, the key's name and its kind", () => {
    const request = { token, name: " Blue key ", kind: "security_key" };
    expect(StaffEnrollOptionsRequest.parse(request)).toEqual({ token, name: "Blue key", kind: "security_key" });
    expect(StaffEnrollOptionsRequest.parse({ ...request, kind: "this_device" }).kind).toBe("this_device");
    everyFieldRequired(StaffEnrollOptionsRequest, request);
    expect(StaffEnrollOptionsRequest.safeParse({ ...request, token: "a".repeat(42) }).success).toBe(false);
    expect(StaffEnrollOptionsRequest.safeParse({ ...request, token: `${"a".repeat(42)}=` }).success).toBe(false);
    expect(StaffEnrollOptionsRequest.safeParse({ ...request, name: "" }).success).toBe(false);
    expect(StaffEnrollOptionsRequest.safeParse({ ...request, kind: "passkey" }).success).toBe(false);
  });

  test("the options answer says whether the console's relying party ID is the app's", () => {
    const answer = { options: { ...options, rp: { id: "localhost", name: "korbat" } }, rpShared: true };
    expect(StaffEnrollOptionsResponse.parse(answer)).toEqual(answer);
    expect(StaffEnrollOptionsResponse.parse({ ...answer, rpShared: false }).rpShared).toBe(false);
    expect(StaffEnrollOptionsResponse.safeParse({ options: answer.options }).success).toBe(false);
    expect(StaffEnrollOptionsResponse.safeParse({ ...answer, rpShared: "no" }).success).toBe(false);
    expect(StaffEnrollOptionsResponse.safeParse({ ...answer, options: { challenge: "abc+/" } }).success).toBe(false);
  });

  test("verify takes the token, the name and a registration response, never an assertion", () => {
    const request = { token, name: "Blue key", response: registration };
    expect(StaffEnrollVerifyRequest.parse(request)).toEqual(request);
    everyFieldRequired(StaffEnrollVerifyRequest, request);
    expect(StaffEnrollVerifyRequest.safeParse({ ...request, response: assertion }).success).toBe(false);
    expect(StaffEnrollVerifyRequest.safeParse({ ...request, name: "x".repeat(51) }).success).toBe(false);
  });

  test("verify answers with the key it stored", () => {
    const key = { id: uuid, name: "Blue key", createdAt: at, lastUsedAt: null };
    expect(StaffEnrollVerifyResponse.parse({ key })).toEqual({ key });
    expect(StaffEnrollVerifyResponse.safeParse({}).success).toBe(false);
  });
});

describe("sign-in", () => {
  test("the options answer is the library's options with a base64url challenge", () => {
    expect(StaffSignInOptionsResponse).toBe(PasskeyOptionsResponse);
    expect(StaffSignInOptionsResponse.parse({ options })).toEqual({ options });
  });

  test("verify takes an assertion, never a registration", () => {
    expect(StaffSignInVerifyRequest.parse({ response: assertion })).toEqual({ response: assertion });
    expect(StaffSignInVerifyRequest.safeParse({ response: registration }).success).toBe(false);
    expect(StaffSignInVerifyRequest.safeParse({}).success).toBe(false);
  });

  test("verify answers with the new session, as /me describes it", () => {
    expect(StaffSignInVerifyResponse).toBe(StaffMe);
  });
});

describe("the staff account and its session", () => {
  const me = {
    handle: "mod_ada",
    role: "moderator",
    sessionHandle: uuid,
    idleExpiresAt: at,
    idleSecondsLeft: 900,
    absoluteExpiresAt: later,
    absoluteSecondsLeft: 43_200,
  };

  test("/me carries the handle, the role, the session's handle and both expiries with the seconds left", () => {
    expect(StaffMe.parse(me)).toEqual(me);
    expect(StaffMe.parse({ ...me, role: "admin", idleSecondsLeft: 0, absoluteSecondsLeft: 0 }).role).toBe("admin");
    everyFieldRequired(StaffMe, me);
  });

  test("/me refuses a user's role, a session handle that is not a uuid, and seconds that are negative or fractional", () => {
    expect(StaffMe.safeParse({ ...me, role: "user" }).success).toBe(false);
    expect(StaffMe.safeParse({ ...me, sessionHandle: "nope" }).success).toBe(false);
    expect(StaffMe.safeParse({ ...me, idleSecondsLeft: -1 }).success).toBe(false);
    expect(StaffMe.safeParse({ ...me, absoluteSecondsLeft: 1.5 }).success).toBe(false);
    expect(StaffMe.safeParse({ ...me, idleExpiresAt: "tonight" }).success).toBe(false);
  });

  test("the idle end never lies beyond the absolute end", () => {
    expect(StaffMe.safeParse({ ...me, idleSecondsLeft: 43_201 }).success).toBe(false);
    expect(StaffMe.safeParse({ ...me, idleSecondsLeft: 43_200 }).success).toBe(true);
  });

  test("a staff session is listed with its handle, browser, dates and whether it is this one", () => {
    const session = { handle: uuid, browser: "Firefox on Linux", createdAt: at, lastUsedAt: at, current: true };
    expect(StaffSession.parse(session)).toEqual(session);
    everyFieldRequired(StaffSession, session);
    expect(StaffSession.safeParse({ ...session, handle: "abc" }).success).toBe(false);
    expect(StaffSessionsResponse.parse({ sessions: [session] })).toEqual({ sessions: [session] });
    expect(StaffSessionsResponse.parse({ sessions: [] })).toEqual({ sessions: [] });
    expect(StaffSessionsResponse.safeParse({}).success).toBe(false);
  });

  test("a staff key is listed with its id, name and dates, never its public key", () => {
    const key = { id: uuid, name: "Blue key", createdAt: at, lastUsedAt: at };
    expect(StaffKey.parse(key)).toEqual(key);
    expect(StaffKey.parse({ ...key, lastUsedAt: null }).lastUsedAt).toBeNull();
    // A member the reader never sends is dropped, not passed on to the page.
    expect(StaffKey.parse({ ...key, publicKey: b64(100) })).toEqual(key);
    everyFieldRequired(StaffKey, key);
    expect(StaffKeysResponse.parse({ keys: [key] })).toEqual({ keys: [key] });
    expect(StaffKeysResponse.safeParse({ keys: [{ ...key, id: 7 }] }).success).toBe(false);
  });
});

describe("step-up actions", () => {
  test("3a has one: revoking a staff session, whose target is a staff session and whose params are empty", () => {
    expect(Object.keys(STAFF_STEP_UP_ACTIONS)).toEqual(["staff_session_revoked"]);
    expect(StaffStepUpActionName.options).toEqual(Object.keys(STAFF_STEP_UP_ACTIONS));
    const spec = STAFF_STEP_UP_ACTIONS.staff_session_revoked;
    expect(spec.targetType).toBe("staff_session");
    expect(spec.targetId.safeParse(uuid).success).toBe(true);
    expect(spec.targetId.safeParse("abc").success).toBe(false);
    expect(spec.params.parse({})).toEqual({});
    // Params are hashed as they are sent, so a member the schema does not know is refused, never dropped.
    expect(spec.params.safeParse({ all: true }).success).toBe(false);
  });

  test("the options request names the action, its target and its params, each checked by that action's own schema", () => {
    const request = { action: "staff_session_revoked", target: { type: "staff_session", id: uuid }, params: {} };
    expect(StaffStepUpOptionsRequest.parse(request)).toEqual(request);
    everyFieldRequired(StaffStepUpOptionsRequest, request);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, action: "role_granted" }).success).toBe(false);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, target: { type: "staff_key", id: uuid } }).success).toBe(false);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, target: { type: "staff_session", id: "abc" } }).success).toBe(false);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, target: { type: "staff_session", id: uuid, extra: 1 } }).success).toBe(false);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, params: { all: true } }).success).toBe(false);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, stepUp: assertion }).success).toBe(false);
  });

  test("the options answer is the library's options", () => {
    expect(StaffStepUpOptionsResponse).toBe(PasskeyOptionsResponse);
    expect(StaffStepUpOptionsResponse.parse({ options: { ...options, allowCredentials: [{ id: b64(22), type: "public-key" }] } }).options.challenge).toBe(options.challenge);
  });

  test("revoking a session takes its params with the step-up assertion added", () => {
    expect(StaffSessionRevokeRequest.parse({ stepUp: assertion })).toEqual({ stepUp: assertion });
    expect(StaffSessionRevokeRequest.safeParse({}).success).toBe(false);
    expect(StaffSessionRevokeRequest.safeParse({ stepUp: registration }).success).toBe(false);
    expect(StaffSessionRevokeRequest.safeParse({ stepUp: assertion, all: true }).success).toBe(false);
  });

  test("the stored assertion is the authenticator data, client data and signature, bounded as the browser's answer is", () => {
    const stored = { authenticatorData: b64(50), clientDataJSON: b64(200), signature: b64(96) };
    expect(StaffStoredAssertion.parse(stored)).toEqual(stored);
    everyFieldRequired(StaffStoredAssertion, stored);
    expect(StaffStoredAssertion.shape.signature).toBe(AuthenticationResponseJSON.shape.response.shape.signature);
    expect(StaffStoredAssertion.safeParse({ ...stored, signature: b64(1025) }).success).toBe(false);
    expect(StaffStoredAssertion.safeParse({ ...stored, clientDataJSON: "ab/cd" }).success).toBe(false);
    expect(StaffStoredAssertion.safeParse({ ...stored, userHandle: b64(43) }).success).toBe(false);
  });
});

describe("the audit log", () => {
  const entry = {
    seq: 42,
    hash: hex,
    createdAt: at,
    actorHandle: "mod_ada",
    action: "staff_session_revoked",
    targetType: "staff_session",
    targetId: uuid,
    actionHash: "cd".repeat(32),
  };

  test("an entry carries its place and hash, time, actor handle, action, target and the action's hash", () => {
    expect(AuditEntry.parse(entry)).toEqual(entry);
    // The system actor has no handle; most rows have no step-up, some no target.
    const bare = { ...entry, actorHandle: null, targetType: null, targetId: null, actionHash: null };
    expect(AuditEntry.parse(bare)).toEqual(bare);
    everyFieldRequired(AuditEntry, entry);
  });

  test("an entry never carries metadata, and its place and hashes have their exact forms", () => {
    expect(AuditEntry.parse({ ...entry, metadata: { email: "a@b.c" } })).toEqual(entry);
    for (const seq of [0, -1, 1.5, "42"]) expect(AuditEntry.safeParse({ ...entry, seq }).success, String(seq)).toBe(false);
    for (const hash of ["AB".repeat(32), "ab".repeat(31), `${"ab".repeat(31)}zz`]) {
      expect(AuditEntry.safeParse({ ...entry, hash }).success, hash).toBe(false);
      expect(AuditEntry.safeParse({ ...entry, actionHash: hash }).success, hash).toBe(false);
    }
  });

  test("a page holds at most 50 entries and the cursor of the next one, null at the end", () => {
    expect(STAFF_AUDIT_PAGE_SIZE).toBe(50);
    expect(AuditPage.parse({ entries: [entry], nextCursor: 42 })).toEqual({ entries: [entry], nextCursor: 42 });
    expect(AuditPage.parse({ entries: [], nextCursor: null })).toEqual({ entries: [], nextCursor: null });
    expect(AuditPage.safeParse({ entries: Array(51).fill(entry), nextCursor: null }).success).toBe(false);
    expect(AuditPage.safeParse({ entries: Array(50).fill(entry), nextCursor: 1 }).success).toBe(true);
    expect(AuditPage.safeParse({ entries: [entry] }).success).toBe(false);
    expect(AuditPage.safeParse({ entries: [entry], nextCursor: 0 }).success).toBe(false);
  });

  test("a page is asked for by cursor, by place (at) or from the newest, with sign-ins as the one filter", () => {
    expect(AuditPageQuery.parse({})).toEqual({});
    expect(AuditPageQuery.parse({ cursor: "42" })).toEqual({ cursor: 42 });
    expect(AuditPageQuery.parse({ at: "7", action: "staff_sign_in" })).toEqual({ at: 7, action: "staff_sign_in" });
    expect(AuditPageQuery.parse({ cursor: "999999999999999" }).cursor).toBe(999_999_999_999_999);
    for (const value of ["0", "-1", "1.5", "01", "1e3", "", " 4", "abc", "1000000000000000"]) {
      expect(AuditPageQuery.safeParse({ cursor: value }).success, value).toBe(false);
      expect(AuditPageQuery.safeParse({ at: value }).success, value).toBe(false);
    }
    expect(AuditPageQuery.safeParse({ action: "role_granted" }).success).toBe(false);
    // A cursor reads older rows and at reads from a place: both at once name no page.
    expect(AuditPageQuery.safeParse({ cursor: "4", at: "7" }).success).toBe(false);
  });
});
```

### Replace `apps/api/test/config.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { authConfigFrom } from "../src/auth/context";
import { loadConfig } from "../src/config";

const key = Buffer.alloc(32, 7).toString("base64");

const good = {
  DATABASE_URL_API: "postgres://korbat_api:x@localhost:5432/korbat",
  DATABASE_URL_AUTH: "postgres://korbat_auth:x@localhost:5432/korbat",
  REDIS_URL: "redis://localhost:6379",
  APP_ORIGIN: "http://localhost:8081",
  AUTH_HMAC_KEY: key,
  IP_HASH_KEY: key,
  TOTP_ENC_KEY: `v1:${key}`,
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  SMTP_URL: "smtp://localhost:1025",
  MAIL_FROM: "korbat <no-reply@korbat.local>",
  TERMS_VERSION: "draft-2026-09",
};

describe("loadConfig", () => {
  test("applies defaults", () => {
    const c = loadConfig(good);
    expect(c.PORT).toBe(3000);
    expect(c.NODE_ENV).toBe("development");
    expect(c.TRUSTED_ORIGINS).toEqual([]);
  });
  test("parses trusted origins list", () => {
    expect(loadConfig({ ...good, TRUSTED_ORIGINS: "http://a.test, http://b.test" }).TRUSTED_ORIGINS).toEqual(["http://a.test", "http://b.test"]);
  });
  test("fails loudly on a missing database url", () => {
    expect(() => loadConfig({ REDIS_URL: good.REDIS_URL })).toThrow(/DATABASE_URL_API/);
  });
  test("rejects keys shorter than 32 bytes", () => {
    expect(() => loadConfig({ ...good, AUTH_HMAC_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/AUTH_HMAC_KEY/);
  });
  test("TOTP key must be versioned and exactly 32 bytes", () => {
    expect(() => loadConfig({ ...good, TOTP_ENC_KEY: key })).toThrow(/TOTP_ENC_KEY/);
    expect(() => loadConfig({ ...good, TOTP_ENC_KEY: `v1:${Buffer.alloc(33).toString("base64")}` })).toThrow(/TOTP_ENC_KEY/);
  });
  test("SMTP_URL must be smtp or smtps", () => {
    expect(() => loadConfig({ ...good, SMTP_URL: "http://relay.example" })).toThrow(/SMTP_URL/);
    expect(loadConfig({ ...good, SMTP_URL: "smtps://user:pass@relay.example:465" }).SMTP_URL).toMatch(/^smtps:/);
  });
  test("every auth variable is required", () => {
    for (const name of ["APP_ORIGIN", "AUTH_HMAC_KEY", "IP_HASH_KEY", "TOTP_ENC_KEY", "TURNSTILE_SECRET_KEY", "SMTP_URL", "MAIL_FROM", "TERMS_VERSION"]) {
      const env: Record<string, string | undefined> = { ...good };
      delete env[name];
      expect(() => loadConfig(env), name).toThrow(new RegExp(name));
    }
  });
  test("TRUST_PROXY defaults to none and accepts the three modes", () => {
    expect(loadConfig(good).TRUST_PROXY).toBe("none");
    for (const mode of ["cloudflare", "caddy", "none"]) expect(loadConfig({ ...good, TRUST_PROXY: mode }).TRUST_PROXY).toBe(mode);
    expect(() => loadConfig({ ...good, TRUST_PROXY: "nginx" })).toThrow(/TRUST_PROXY/);
  });
  describe("production refuses development values", () => {
    const prod = { ...good, NODE_ENV: "production", APP_ORIGIN: "https://korbat.example", TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-widget-secret" };
    test("accepts a production configuration", () => {
      expect(loadConfig(prod).NODE_ENV).toBe("production");
    });
    test("refuses Cloudflare's test secrets", () => {
      for (const secret of ["1x0000000000000000000000000000000AA", "2x0000000000000000000000000000000AA", "3x0000000000000000000000000000000AA"]) {
        expect(() => loadConfig({ ...prod, TURNSTILE_SECRET_KEY: secret }), secret).toThrow(/TURNSTILE_SECRET_KEY/);
      }
    });
    test("requires https for the app origin and every trusted origin", () => {
      expect(() => loadConfig({ ...prod, APP_ORIGIN: "http://korbat.example" })).toThrow(/APP_ORIGIN/);
      expect(() => loadConfig({ ...prod, TRUSTED_ORIGINS: "https://a.example, http://b.example" })).toThrow(/TRUSTED_ORIGINS/);
    });
    test("development keeps accepting them", () => {
      expect(loadConfig(good).TURNSTILE_SECRET_KEY).toBe("1x0000000000000000000000000000000AA");
    });
  });
  test("previous TOTP keys are optional, comma-separated and each versioned", () => {
    expect(loadConfig(good).TOTP_ENC_KEYS_PREVIOUS).toEqual([]);
    expect(loadConfig({ ...good, TOTP_ENC_KEYS_PREVIOUS: `v0:${key}, v1:${key}` }).TOTP_ENC_KEYS_PREVIOUS).toEqual([`v0:${key}`, `v1:${key}`]);
    expect(() => loadConfig({ ...good, TOTP_ENC_KEYS_PREVIOUS: key })).toThrow(/TOTP_ENC_KEYS_PREVIOUS/);
  });
  test("media settings default to the development directories, every format and a 2 GiB free-space floor", () => {
    const c = loadConfig(good);
    expect(c.MEDIA_UPLOADS_DIR).toBe("../../.data/media/uploads");
    expect(c.MEDIA_STORE_DIR).toBe("../../.data/media/store");
    expect(c.MEDIA_FORMATS).toEqual(["jpeg", "png", "webp", "gif", "avif"]);
    expect(c.MEDIA_MIN_FREE_BYTES).toBe(2_147_483_648);
  });
  test("MEDIA_RECONCILE is on by default and takes off or force", () => {
    expect(loadConfig(good).MEDIA_RECONCILE).toBe("on");
    expect(loadConfig({ ...good, MEDIA_RECONCILE: "force" }).MEDIA_RECONCILE).toBe("force");
    expect(() => loadConfig({ ...good, MEDIA_RECONCILE: "maybe" })).toThrow(/MEDIA_RECONCILE/);
  });
  test("MEDIA_FORMATS enables a subset, and a typo stops the process instead of changing what is accepted", () => {
    expect(loadConfig({ ...good, MEDIA_FORMATS: "png, jpeg" }).MEDIA_FORMATS).toEqual(["jpeg", "png"]);
    expect(() => loadConfig({ ...good, MEDIA_FORMATS: "jpeg,tiff" })).toThrow(/unknown formats: tiff/);
    expect(loadConfig({ ...good, MEDIA_MIN_FREE_BYTES: "0", MEDIA_STORE_DIR: "/media/store" })).toMatchObject({ MEDIA_MIN_FREE_BYTES: 0, MEDIA_STORE_DIR: "/media/store" });
  });
  describe("the verification provider behind the badge", () => {
    test("is off by default, with the brand korbat and no Vonage credentials", () => {
      const c = loadConfig(good);
      expect(c.VERIFY_PROVIDER).toBe("off");
      expect(c.VERIFY_BRAND).toBe("korbat");
      expect(c.VONAGE_API_KEY).toBeUndefined();
      expect(c.VONAGE_API_SECRET).toBeUndefined();
    });
    test("is off, dev or vonage", () => {
      for (const provider of ["off", "dev", "vonage"]) expect(loadConfig({ ...good, VERIFY_PROVIDER: provider }).VERIFY_PROVIDER).toBe(provider);
      expect(() => loadConfig({ ...good, VERIFY_PROVIDER: "twilio" })).toThrow(/VERIFY_PROVIDER/);
      expect(loadConfig({ ...good, VONAGE_API_KEY: "abcd1234", VONAGE_API_SECRET: "s3cret" })).toMatchObject({ VONAGE_API_KEY: "abcd1234", VONAGE_API_SECRET: "s3cret" });
    });
    test("the brand is 1 to 18 characters without the characters Vonage refuses", () => {
      expect(loadConfig({ ...good, VERIFY_BRAND: "x".repeat(18) }).VERIFY_BRAND).toBe("x".repeat(18));
      expect(loadConfig({ ...good, VERIFY_BRAND: "My korbat 1" }).VERIFY_BRAND).toBe("My korbat 1");
      for (const brand of ["", "x".repeat(19), "kor/bat", "{korbat}", "kor:bat", "$korbat"]) {
        expect(() => loadConfig({ ...good, VERIFY_BRAND: brand }), JSON.stringify(brand)).toThrow(/VERIFY_BRAND/);
      }
    });
    describe("in production", () => {
      const prod = { ...good, NODE_ENV: "production", APP_ORIGIN: "https://korbat.example", TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-widget-secret" };
      test("the development provider is refused, like the Turnstile test secret", () => {
        expect(() => loadConfig({ ...prod, VERIFY_PROVIDER: "dev" })).toThrow(/VERIFY_PROVIDER=dev is for development only/);
        expect(loadConfig({ ...good, VERIFY_PROVIDER: "dev" }).VERIFY_PROVIDER).toBe("dev");
      });
      test("vonage needs both the key and the secret; off needs nothing", () => {
        expect(() => loadConfig({ ...prod, VERIFY_PROVIDER: "vonage" })).toThrow(/VONAGE_API_KEY/);
        expect(() => loadConfig({ ...prod, VERIFY_PROVIDER: "vonage", VONAGE_API_KEY: "abcd1234" })).toThrow(/VONAGE_API_SECRET/);
        expect(() => loadConfig({ ...prod, VERIFY_PROVIDER: "vonage", VONAGE_API_SECRET: "s3cret" })).toThrow(/VONAGE_API_KEY/);
        expect(loadConfig({ ...prod, VERIFY_PROVIDER: "vonage", VONAGE_API_KEY: "abcd1234", VONAGE_API_SECRET: "s3cret" }).VERIFY_PROVIDER).toBe("vonage");
        expect(loadConfig({ ...prod, VERIFY_PROVIDER: "off" }).VERIFY_PROVIDER).toBe("off");
      });
    });
  });
  describe("the WebAuthn relying party", () => {
    test("defaults to the host of APP_ORIGIN and the name korbat; an empty value, as compose passes it, counts as unset", () => {
      expect(loadConfig(good)).toMatchObject({ WEBAUTHN_RP_ID: "localhost", WEBAUTHN_RP_NAME: "korbat" });
      expect(loadConfig({ ...good, WEBAUTHN_RP_ID: "", WEBAUTHN_RP_NAME: "" })).toMatchObject({ WEBAUTHN_RP_ID: "localhost", WEBAUTHN_RP_NAME: "korbat" });
      expect(loadConfig({ ...good, APP_ORIGIN: "http://127.0.0.1:8380" }).WEBAUTHN_RP_ID).toBe("127.0.0.1");
    });
    test("takes an explicit RP ID in lowercase, and only a bare domain name", () => {
      expect(loadConfig({ ...good, WEBAUTHN_RP_ID: "Korbat.Example" }).WEBAUTHN_RP_ID).toBe("korbat.example");
      expect(loadConfig({ ...good, WEBAUTHN_RP_ID: "localhost" }).WEBAUTHN_RP_ID).toBe("localhost");
      for (const rpId of ["https://korbat.example", "korbat.example:443", "korbat.example/path", "-korbat.example", "korbat..example", "korbat.example.", "kor bat.example", `${"a".repeat(64)}.example`]) {
        expect(() => loadConfig({ ...good, WEBAUTHN_RP_ID: rpId }), rpId).toThrow(/WEBAUTHN_RP_ID/);
      }
    });
    test("the name is 1 to 64 printable characters", () => {
      expect(loadConfig({ ...good, WEBAUTHN_RP_NAME: "My korbat" }).WEBAUTHN_RP_NAME).toBe("My korbat");
      expect(loadConfig({ ...good, WEBAUTHN_RP_NAME: "x".repeat(64) }).WEBAUTHN_RP_NAME).toBe("x".repeat(64));
      // A control character, a tab, and U+202E (the invisible right-to-left override).
      for (const name of ["x".repeat(65), `kor${String.fromCharCode(7)}bat`, `kor${String.fromCharCode(9)}bat`, `kor${String.fromCharCode(0x202e)}bat`]) {
        expect(() => loadConfig({ ...good, WEBAUTHN_RP_NAME: name }), JSON.stringify(name)).toThrow(/WEBAUTHN_RP_NAME/);
      }
    });
    test("the auth configuration exposes it, with APP_ORIGIN and TRUSTED_ORIGINS as the expected origins outside production", () => {
      expect(authConfigFrom(loadConfig({ ...good, TRUSTED_ORIGINS: "http://localhost:19006" })).webauthn).toEqual({
        rpId: "localhost",
        rpName: "korbat",
        origins: ["http://localhost:8081", "http://localhost:19006"],
      });
      expect(authConfigFrom(loadConfig({ ...good, WEBAUTHN_RP_NAME: "My korbat" })).webauthn).toEqual({ rpId: "localhost", rpName: "My korbat", origins: ["http://localhost:8081"] });
    });
    describe("in production", () => {
      const prod = { ...good, NODE_ENV: "production", APP_ORIGIN: "https://korbat.example", TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-widget-secret" };
      test("the expected origin is APP_ORIGIN alone", () => {
        expect(authConfigFrom(loadConfig({ ...prod, TRUSTED_ORIGINS: "https://admin.korbat.example" })).webauthn).toEqual({
          rpId: "korbat.example",
          rpName: "korbat",
          origins: ["https://korbat.example"],
        });
      });
      test("the RP ID may be the host of APP_ORIGIN", () => {
        expect(loadConfig(prod).WEBAUTHN_RP_ID).toBe("korbat.example");
        expect(loadConfig({ ...prod, WEBAUTHN_RP_ID: "korbat.example" }).WEBAUTHN_RP_ID).toBe("korbat.example");
      });
      test("or a parent domain of that host, when it has a dot", () => {
        const app = { ...prod, APP_ORIGIN: "https://app.korbat.example" };
        expect(loadConfig({ ...app, WEBAUTHN_RP_ID: "korbat.example" }).WEBAUTHN_RP_ID).toBe("korbat.example");
        expect(loadConfig({ ...prod, APP_ORIGIN: "https://a.b.korbat.example", WEBAUTHN_RP_ID: "korbat.example" }).WEBAUTHN_RP_ID).toBe("korbat.example");
        expect(() => loadConfig({ ...app, WEBAUTHN_RP_ID: "example" })).toThrow(/WEBAUTHN_RP_ID must be the host of APP_ORIGIN/);
      });
      test("any other domain is refused: another site, a child of the host, or a suffix that is not a parent", () => {
        const app = { ...prod, APP_ORIGIN: "https://app.korbat.example" };
        for (const rpId of ["other.example", "sub.app.korbat.example", "pp.korbat.example", "korbat.example.net"]) {
          expect(() => loadConfig({ ...app, WEBAUTHN_RP_ID: rpId }), rpId).toThrow(/WEBAUTHN_RP_ID must be the host of APP_ORIGIN/);
        }
      });
      test("never an IP address or localhost", () => {
        for (const origin of ["https://203.0.113.7", "https://[2001:db8::1]", "https://localhost", "https://app.localhost"]) {
          expect(() => loadConfig({ ...prod, APP_ORIGIN: origin }), origin).toThrow(/WEBAUTHN_RP_ID/);
        }
        expect(() => loadConfig({ ...prod, APP_ORIGIN: "https://203.0.113.7", WEBAUTHN_RP_ID: "203.0.113.7" })).toThrow(/WEBAUTHN_RP_ID cannot be an IP address/);
        // A parent of an address is no domain either.
        expect(() => loadConfig({ ...prod, APP_ORIGIN: "https://10.0.0.1", WEBAUTHN_RP_ID: "0.0.1" })).toThrow(/WEBAUTHN_RP_ID cannot be an IP address/);
        expect(() => loadConfig({ ...prod, APP_ORIGIN: "https://localhost", WEBAUTHN_RP_ID: "localhost" })).toThrow(/WEBAUTHN_RP_ID cannot be localhost/);
        expect(() => loadConfig({ ...prod, APP_ORIGIN: "https://app.localhost", WEBAUTHN_RP_ID: "localhost" })).toThrow(/WEBAUTHN_RP_ID cannot be localhost/);
      });
      test("development accepts all of them, since browsers treat localhost as secure", () => {
        expect(loadConfig({ ...good, APP_ORIGIN: "http://localhost:8081", WEBAUTHN_RP_ID: "localhost" }).WEBAUTHN_RP_ID).toBe("localhost");
        expect(loadConfig({ ...good, APP_ORIGIN: "http://app.localhost:8081", WEBAUTHN_RP_ID: "other.example" }).WEBAUTHN_RP_ID).toBe("other.example");
      });
    });
  });
  describe("the staff console (3a design, section 8)", () => {
    const consoleOrigin = "http://localhost:8090";
    test("is off unless CONSOLE_ORIGIN is set; a blank value, as compose passes it, counts as unset", () => {
      for (const blank of [undefined, "", "   "]) {
        const c = loadConfig({ ...good, CONSOLE_ORIGIN: blank, CONSOLE_RP_ID: blank });
        expect(c.CONSOLE_ORIGIN, JSON.stringify(blank)).toBeUndefined();
        expect(c.CONSOLE_RP_ID, JSON.stringify(blank)).toBeUndefined();
      }
    });
    test("takes the console's origin, and its relying party ID defaults to the console's hostname", () => {
      expect(loadConfig({ ...good, CONSOLE_ORIGIN: consoleOrigin })).toMatchObject({ CONSOLE_ORIGIN: consoleOrigin, CONSOLE_RP_ID: "localhost" });
      expect(loadConfig({ ...good, CONSOLE_ORIGIN: " http://console.localhost:8090 ", CONSOLE_RP_ID: "" })).toMatchObject({
        CONSOLE_ORIGIN: "http://console.localhost:8090",
        CONSOLE_RP_ID: "console.localhost",
      });
      // The app's relying party is untouched by the console's.
      expect(loadConfig({ ...good, CONSOLE_ORIGIN: "http://console.localhost:8090" }).WEBAUTHN_RP_ID).toBe("localhost");
    });
    test("takes an explicit relying party ID in lowercase, and only a bare domain name", () => {
      expect(loadConfig({ ...good, CONSOLE_ORIGIN: "http://console.localhost:8090", CONSOLE_RP_ID: "Console.Localhost" }).CONSOLE_RP_ID).toBe("console.localhost");
      for (const rpId of ["http://console.localhost", "console.localhost:8090", "console.localhost/", "-console.localhost", "console..localhost"]) {
        expect(() => loadConfig({ ...good, CONSOLE_ORIGIN: consoleOrigin, CONSOLE_RP_ID: rpId }), rpId).toThrow(/CONSOLE_RP_ID/);
      }
    });
    test("must be an origin exactly as a browser sends it: http or https, a host, a port only when it is not the default", () => {
      // The staff gate compares the Origin header with this value as a string.
      for (const origin of ["localhost:8090", "ftp://localhost:8090", "http://localhost:8090/", "http://localhost:8090/console", "http://localhost:8090?x=1", "http://user@localhost:8090", "https://console.example:443", "http://Console.Localhost:8090"]) {
        expect(() => loadConfig({ ...good, CONSOLE_ORIGIN: origin }), origin).toThrow(/CONSOLE_ORIGIN/);
      }
    });
    test("is refused in every environment when it is the app's origin or one of the trusted origins", () => {
      expect(() => loadConfig({ ...good, CONSOLE_ORIGIN: good.APP_ORIGIN })).toThrow(/CONSOLE_ORIGIN must not be APP_ORIGIN/);
      // The same origin written with a final slash is still the same origin.
      expect(() => loadConfig({ ...good, APP_ORIGIN: "http://localhost:8090/", CONSOLE_ORIGIN: consoleOrigin })).toThrow(/CONSOLE_ORIGIN must not be APP_ORIGIN/);
      expect(() => loadConfig({ ...good, TRUSTED_ORIGINS: `http://localhost:19006, ${consoleOrigin}`, CONSOLE_ORIGIN: consoleOrigin })).toThrow(/CONSOLE_ORIGIN must not be listed in TRUSTED_ORIGINS/);
      expect(() => loadConfig({ ...good, TRUSTED_ORIGINS: `${consoleOrigin}/`, CONSOLE_ORIGIN: consoleOrigin })).toThrow(/CONSOLE_ORIGIN must not be listed in TRUSTED_ORIGINS/);
      expect(loadConfig({ ...good, TRUSTED_ORIGINS: "http://localhost:19006", CONSOLE_ORIGIN: consoleOrigin }).CONSOLE_ORIGIN).toBe(consoleOrigin);
    });
    describe("in production", () => {
      const prod = {
        ...good,
        NODE_ENV: "production",
        APP_ORIGIN: "https://korbat.example",
        TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-widget-secret",
        CONSOLE_ORIGIN: "https://staff-korbat.example",
      };
      test("accepts a console on a domain of its own or on a subdomain of the app's, with its hostname as the relying party ID", () => {
        expect(loadConfig(prod)).toMatchObject({ CONSOLE_ORIGIN: "https://staff-korbat.example", CONSOLE_RP_ID: "staff-korbat.example", WEBAUTHN_RP_ID: "korbat.example" });
        expect(loadConfig({ ...prod, CONSOLE_ORIGIN: "https://console.korbat.example", CONSOLE_RP_ID: "console.korbat.example" }).CONSOLE_RP_ID).toBe("console.korbat.example");
        // A name that merely ends like the app's is not a parent of it.
        expect(loadConfig({ ...prod, APP_ORIGIN: "https://mykorbat.example", CONSOLE_ORIGIN: "https://korbat.example" }).CONSOLE_RP_ID).toBe("korbat.example");
      });
      test("the console is still off when CONSOLE_ORIGIN is unset", () => {
        const c = loadConfig({ ...prod, CONSOLE_ORIGIN: "" });
        expect(c.CONSOLE_ORIGIN).toBeUndefined();
        expect(c.CONSOLE_RP_ID).toBeUndefined();
      });
      test("requires https", () => {
        expect(() => loadConfig({ ...prod, CONSOLE_ORIGIN: "http://staff-korbat.example" })).toThrow(/CONSOLE_ORIGIN must be an https origin in production/);
      });
      test("refuses the app's origin and the trusted origins, as everywhere", () => {
        expect(() => loadConfig({ ...prod, CONSOLE_ORIGIN: "https://korbat.example" })).toThrow(/CONSOLE_ORIGIN must not be APP_ORIGIN/);
        expect(() => loadConfig({ ...prod, TRUSTED_ORIGINS: "https://staff-korbat.example" })).toThrow(/CONSOLE_ORIGIN must not be listed in TRUSTED_ORIGINS/);
      });
      test("refuses the app's hostname with another port, since ports separate neither sites nor cookies", () => {
        expect(() => loadConfig({ ...prod, CONSOLE_ORIGIN: "https://korbat.example:8443" })).toThrow(/CONSOLE_ORIGIN must not be on the hostname of APP_ORIGIN/);
      });
      test("refuses a console on a parent domain of the app's hostname", () => {
        const app = { ...prod, APP_ORIGIN: "https://app.korbat.example" };
        expect(() => loadConfig({ ...app, CONSOLE_ORIGIN: "https://korbat.example" })).toThrow(/APP_ORIGIN's hostname must not be a subdomain of the console's/);
        expect(() => loadConfig({ ...prod, APP_ORIGIN: "https://a.b.korbat.example", CONSOLE_ORIGIN: "https://b.korbat.example" })).toThrow(/must not be a subdomain of the console's/);
      });
      test("the relying party ID must be the console's hostname, never a parent domain of it", () => {
        const sub = { ...prod, CONSOLE_ORIGIN: "https://console.korbat-staff.example" };
        expect(loadConfig({ ...sub, CONSOLE_RP_ID: "console.korbat-staff.example" }).CONSOLE_RP_ID).toBe("console.korbat-staff.example");
        for (const rpId of ["korbat-staff.example", "other.example", "sub.console.korbat-staff.example"]) {
          expect(() => loadConfig({ ...sub, CONSOLE_RP_ID: rpId }), rpId).toThrow(/CONSOLE_RP_ID must be the hostname of CONSOLE_ORIGIN/);
        }
      });
      test("the relying party ID must differ from the app's", () => {
        // The app's passkeys on the parent domain korbat.example, the console on that domain itself: both rules refuse it.
        const shared = { ...prod, APP_ORIGIN: "https://app.korbat.example", WEBAUTHN_RP_ID: "korbat.example", CONSOLE_ORIGIN: "https://korbat.example" };
        expect(() => loadConfig(shared)).toThrow(/CONSOLE_RP_ID must differ from the app's relying party ID \(korbat\.example\)/);
      });
      test("never an IP address or localhost", () => {
        for (const origin of ["https://203.0.113.9", "https://[2001:db8::2]", "https://localhost:8090", "https://console.localhost"]) {
          expect(() => loadConfig({ ...prod, CONSOLE_ORIGIN: origin }), origin).toThrow(/CONSOLE_RP_ID cannot be an IP address or localhost in production/);
        }
      });
    });
    test("development accepts what only production refuses: http, the app's hostname, a shared or foreign relying party ID", () => {
      // Both relying party IDs are localhost in development; only the tables keep staff keys and passkeys apart there.
      expect(loadConfig({ ...good, CONSOLE_ORIGIN: consoleOrigin })).toMatchObject({ CONSOLE_RP_ID: "localhost", WEBAUTHN_RP_ID: "localhost" });
      expect(loadConfig({ ...good, APP_ORIGIN: "http://app.localhost:8081", CONSOLE_ORIGIN: "http://localhost:8090" }).CONSOLE_RP_ID).toBe("localhost");
      expect(loadConfig({ ...good, CONSOLE_ORIGIN: consoleOrigin, CONSOLE_RP_ID: "other.example" }).CONSOLE_RP_ID).toBe("other.example");
      expect(loadConfig({ ...good, CONSOLE_ORIGIN: "http://127.0.0.1:8090" }).CONSOLE_RP_ID).toBe("127.0.0.1");
    });
  });
});
```

### Replace `apps/api/test/integration/global-setup.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import Redis from "ioredis";
import { closeDb, createDb } from "@korbat/db";
import { assertTestTargets, loadTestEnv } from "./test-env";

/**
 * Runs once before the integration suites. Every run starts from an empty test database and an
 * empty Redis database, so suites never depend on what an earlier run left behind.
 */
export default async function setup(): Promise<void> {
  const env = loadTestEnv();
  assertTestTargets(env);

  const redis = new Redis(env.REDIS_URL!, { maxRetriesPerRequest: 2 });
  try {
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }

  // The migrate role owns every table, so it may truncate them. Names come from the catalog, quoted.
  const db = createDb(env.DATABASE_URL_MIGRATE!, { max: 1 });
  try {
    const tables = await db.execute<{ name: string }>(
      sql`select quote_ident(schemaname) || '.' || quote_ident(tablename) as name from pg_tables where schemaname in ('public', 'auth') order by 1`,
    );
    if (tables.length === 0) throw new Error("The test database has no tables. Run `node scripts/test-db.mjs`.");
    await db.execute(sql.raw(`truncate table ${tables.map((table) => table.name).join(", ")} restart identity cascade`));
    // The truncate emptied audit_head too. The chain's trigger never creates the head (an insert without one fails), so the
    // run starts from the head of an empty log: place 0 and 64 zeros, as migration 0012 leaves it on a database without rows.
    await db.execute(sql`insert into public.audit_head (id, seq, hash) values (1, 0, repeat('0', 64))`);
  } finally {
    await closeDb(db);
  }
}
```

### Replace `packages/db/test/schema.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig, pgTable } from "drizzle-orm/pg-core";
import { apiRole, authRole, bytea } from "../src/schema/helpers";
import * as schema from "../src/schema/index";

const tables = Object.values(schema).filter((v) => is(v, PgTable)) as PgTable[];
const byName = new Map(tables.map((t) => [getTableConfig(t).name, getTableConfig(t)]));

describe("auth schema", () => {
  test("auth tables live in the auth schema", () => {
    for (const name of ["users", "devices", "sessions", "email_codes", "passkeys", "auth_events"]) {
      expect(byName.get(name)?.schema, name).toBe("auth");
    }
  });
  test("sessions store only a hash id and carry both expiries", () => {
    const cols = byName.get("sessions")!.columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["id", "user_id", "device_id", "expires_at", "absolute_expires_at", "reauth_at", "revoked_at"]));
  });
});

describe("row level security", () => {
  test("every table has RLS enabled and at least one policy", () => {
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      const cfg = getTableConfig(t);
      expect(cfg.enableRLS, cfg.name).toBe(true);
      expect(cfg.policies.length, cfg.name).toBeGreaterThan(0);
    }
  });
});

describe("content schema", () => {
  test("posts carry a state enum and a body length check", () => {
    const cfg = byName.get("posts")!;
    expect(cfg.schema).toBeUndefined(); // public
    expect(cfg.columns.find((c) => c.name === "state")?.notNull).toBe(true);
    expect(cfg.checks.map((c) => c.name)).toContain("posts_body_len");
  });
  test("join tables have composite primary keys", () => {
    for (const name of ["follows", "likes", "reposts", "bookmarks", "blocks", "mutes"]) {
      expect(byName.get(name)!.primaryKeys.length, name).toBe(1);
      expect(byName.get(name)!.primaryKeys[0]!.columns.length, name).toBe(2);
    }
  });
});

describe("trust and safety schema", () => {
  test("there are 28 tables in total", () => {
    expect(tables.length).toBe(28);
  });
  test("transparency_log carries no user identifiers", () => {
    const cols = byName.get("transparency_log")!.columns.map((c) => c.name);
    for (const c of cols) expect(c, c).not.toMatch(/user|author|moderator|reporter/);
  });
  test("audit_log policies allow only insert and select", () => {
    const kinds = byName.get("audit_log")!.policies.map((p) => p.for).sort();
    expect(kinds).toEqual(["insert", "select"]);
  });
  test("one appeal per case", () => {
    const idx = byName.get("appeals")!.indexes.find((i) => i.config.name === "appeals_case_idx");
    expect(idx?.config.unique).toBe(true);
  });
});

describe("identity and auth 1a", () => {
  test("users carry role, age, terms, onboarding and TOTP replay columns", () => {
    const cols = byName.get("users")!.columns;
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(["role", "age_confirmed_at", "terms_version", "terms_accepted_at", "onboarded_at", "password_changed_at", "totp_last_step"]),
    );
    expect(cols.find((c) => c.name === "role")?.notNull).toBe(true);
  });
  test("email codes are bound to a unique flow id", () => {
    const cfg = byName.get("email_codes")!;
    expect(cfg.columns.find((c) => c.name === "flow_id")?.notNull).toBe(true);
    expect(cfg.indexes.find((i) => i.config.name === "email_codes_flow_idx")?.config.unique).toBe(true);
  });
  test("auth_events policies allow only insert and select", () => {
    expect(byName.get("auth_events")?.policies.map((p) => p.for).sort()).toEqual(["insert", "select"]);
  });
  test("email code purposes include reauth", () => {
    expect(schema.emailCodePurpose.enumValues).toContain("reauth");
  });
});

describe("posting and feed 2a", () => {
  test("posts and profiles carry non-negative counters, and posts a deletion time", () => {
    const posts = byName.get("posts")!;
    const postCols = posts.columns.map((c) => c.name);
    expect(postCols).toEqual(expect.arrayContaining(["like_count", "repost_count", "reply_count", "quote_count", "deleted_at"]));
    for (const name of ["like_count", "repost_count", "reply_count", "quote_count"]) {
      expect(posts.columns.find((c) => c.name === name)?.notNull, name).toBe(true);
    }
    expect(posts.checks.map((c) => c.name)).toContain("posts_counts_nonnegative");
    const profiles = byName.get("profiles")!;
    expect(profiles.columns.map((c) => c.name)).toEqual(expect.arrayContaining(["follower_count", "following_count", "post_count"]));
    expect(profiles.checks.map((c) => c.name)).toContain("profiles_counts_nonnegative");
  });
  test("per-account engagement lists and quote lookups have indexes", () => {
    for (const name of ["likes", "reposts", "bookmarks"]) {
      const idx = byName.get(name)!.indexes.find((i) => i.config.name === `${name}_user_created_idx`);
      expect(idx?.config.columns.length, name).toBe(2);
    }
    expect(byName.get("posts")!.indexes.map((i) => i.config.name)).toContain("posts_quote_of_idx");
  });
});

describe("images 2b", () => {
  test("post_media has no path column, and its attachment and dimension columns are optional", () => {
    const cols = byName.get("post_media")!.columns;
    expect(cols.map((c) => c.name)).not.toContain("path");
    for (const name of ["post_id", "position", "width", "height", "blurhash"]) {
      expect(cols.find((c) => c.name === name)?.notNull, name).toBe(false);
    }
  });
  test("every upload has an owner, a status and a creation time; a failure has a reason", () => {
    const cols = byName.get("post_media")!.columns;
    for (const name of ["owner_id", "status", "created_at"]) expect(cols.find((c) => c.name === name)?.notNull, name).toBe(true);
    expect(cols.find((c) => c.name === "error")?.notNull).toBe(false);
    expect(cols.find((c) => c.name === "status")?.default).toBe("processing");
    expect(schema.mediaStatus.enumValues).toEqual(["processing", "ready", "failed"]);
  });
  test("the database itself refuses a ready image without dimensions and an attached image that is incomplete", () => {
    const cfg = byName.get("post_media")!;
    expect(cfg.checks.map((c) => c.name).sort()).toEqual(["post_media_alt_len", "post_media_attached_is_complete", "post_media_ready_has_dims"]);
    expect(cfg.indexes.map((i) => i.config.name).sort()).toEqual(["post_media_owner_created_idx", "post_media_post_position_idx", "post_media_status_created_idx"]);
    expect(cfg.indexes.find((i) => i.config.name === "post_media_post_position_idx")?.config.unique).toBe(true);
  });
});

describe("account lifecycle 1b", () => {
  test("handle_history reserves every lowercase handle a profile ever had, and goes with the profile", () => {
    const cfg = byName.get("handle_history")!;
    expect(cfg.schema).toBeUndefined(); // public
    expect(cfg.columns.map((c) => c.name)).toEqual(["handle_lower", "profile_id", "changed_at"]);
    expect(cfg.columns.find((c) => c.name === "handle_lower")?.primary).toBe(true);
    expect(cfg.columns.find((c) => c.name === "profile_id")?.notNull).toBe(true);
    expect(cfg.columns.find((c) => c.name === "changed_at")?.notNull).toBe(true);
    expect(cfg.columns.find((c) => c.name === "changed_at")?.hasDefault).toBe(true);
    const fk = cfg.foreignKeys.map((k) => ({ table: getTableConfig(k.reference().foreignTable).name, columns: k.reference().foreignColumns.map((c) => c.name), onDelete: k.onDelete }));
    expect(fk).toEqual([{ table: "profiles", columns: ["id"], onDelete: "cascade" }]);
    expect(cfg.policies.map((p) => [p.name, p.for])).toEqual([["handle_history_api_all", "all"]]);
  });
  test("profiles record when the handle last changed; users record when their purge finished", () => {
    const handleChangedAt = byName.get("profiles")!.columns.find((c) => c.name === "handle_changed_at");
    expect(handleChangedAt).toBeDefined();
    expect(handleChangedAt?.notNull).toBe(false);
    const purgedAt = byName.get("users")!.columns.find((c) => c.name === "purged_at");
    expect(purgedAt).toBeDefined();
    expect(purgedAt?.notNull).toBe(false);
  });
  test("one phone per account: a unique index on phone_hash that leaves out the accounts without one", () => {
    const idx = byName.get("users")!.indexes.find((i) => i.config.name === "users_phone_hash_idx");
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.columns.map((c) => (c as { name?: string }).name)).toEqual(["phone_hash"]);
    expect(idx?.config.where).toBeDefined();
  });
  test("email codes can be for deleting the account, and every account event of 1b has a type", () => {
    expect(schema.emailCodePurpose.enumValues).toContain("delete_account");
    const values = schema.authEventType.enumValues;
    expect(values.slice(values.indexOf("not_me"), values.indexOf("account_deleted") + 1)).toEqual([
      "not_me",
      "profile_updated",
      "handle_changed",
      "email_changed",
      "badge_verified",
      "badge_removed",
      "export_created",
      "account_deleted",
    ]);
  });
});

describe("passkeys 1c", () => {
  const column = (table: string, name: string) => byName.get(table)!.columns.find((c) => c.name === name);
  /** The foreign keys of one local column: the table and columns they point at and what a delete there does. */
  const foreignKeys = (table: string, name: string) =>
    byName
      .get(table)!
      .foreignKeys.filter((k) => k.reference().columns.some((c) => c.name === name))
      .map((k) => ({ table: getTableConfig(k.reference().foreignTable).name, columns: k.reference().foreignColumns.map((c) => c.name), onDelete: k.onDelete }));

  test("bytea is the bytea SQL type and hands Buffers both ways", () => {
    const table = pgTable("bytea_probe", { value: bytea("value") });
    const probe = getTableConfig(table).columns[0]!;
    expect(probe.getSQLType()).toBe("bytea");
    const bytes = Buffer.from([0, 1, 254, 255]);
    expect(probe.mapToDriverValue(bytes)).toEqual(bytes);
    // postgres.js already parses bytea into a Buffer; a driver that answers a plain Uint8Array gets one too.
    const read = probe.mapFromDriverValue(new Uint8Array([0, 1, 254, 255]));
    expect(Buffer.isBuffer(read)).toBe(true);
    expect(read).toEqual(bytes);
    expect(probe.mapFromDriverValue(bytes)).toEqual(bytes);
  });

  test("users carry an optional WebAuthn user handle in bytea, unique among the accounts that have one", () => {
    const handle = column("users", "webauthn_user_id");
    expect(handle?.getSQLType()).toBe("bytea");
    expect(handle?.notNull).toBe(false);
    expect(handle?.hasDefault).toBe(false);
    const idx = byName.get("users")!.indexes.find((i) => i.config.name === "users_webauthn_user_id_idx");
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.columns.map((c) => (c as { name?: string }).name)).toEqual(["webauthn_user_id"]);
    expect(idx?.config.where).toBeDefined();
  });

  test("passkeys record the AAGUID, the backup and verification flags, the creating device and a suspected copy", () => {
    expect(column("passkeys", "aaguid")?.getSQLType()).toBe("uuid");
    expect(column("passkeys", "aaguid")?.notNull).toBe(false);
    for (const name of ["backup_eligible", "uv_initialized"]) {
      expect(column("passkeys", name)?.getSQLType(), name).toBe("boolean");
      expect(column("passkeys", name)?.notNull, name).toBe(true);
      expect(column("passkeys", name)?.default, name).toBe(false);
    }
    expect(column("passkeys", "created_device_id")?.getSQLType()).toBe("uuid");
    expect(column("passkeys", "created_device_id")?.notNull).toBe(false);
    expect(foreignKeys("passkeys", "created_device_id")).toEqual([{ table: "devices", columns: ["id"], onDelete: "set null" }]);
    expect(column("passkeys", "suspect_at")?.getSQLType()).toBe("timestamp with time zone");
    expect(column("passkeys", "suspect_at")?.notNull).toBe(false);
    // One row per credential: the index the foundation created stays.
    const idx = byName.get("passkeys")!.indexes.find((i) => i.config.name === "passkeys_credential_idx");
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.columns.map((c) => (c as { name?: string }).name)).toEqual(["credential_id"]);
  });

  test("sessions carry a random handle that is unique, the factors they proved and the passkey that started them", () => {
    const handle = column("sessions", "handle");
    expect(handle?.getSQLType()).toBe("uuid");
    expect(handle?.notNull).toBe(true);
    expect(handle?.hasDefault).toBe(true);
    const idx = byName.get("sessions")!.indexes.find((i) => i.config.name === "sessions_handle_idx");
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.columns.map((c) => (c as { name?: string }).name)).toEqual(["handle"]);
    const factors = column("sessions", "factors");
    expect(factors?.getSQLType()).toBe("jsonb");
    expect(factors?.notNull).toBe(true);
    expect(factors?.hasDefault).toBe(true);
    expect(column("sessions", "passkey_id")?.notNull).toBe(false);
    expect(foreignKeys("sessions", "passkey_id")).toEqual([{ table: "passkeys", columns: ["id"], onDelete: "set null" }]);
  });

  test("adding, removing and a counter regression of a passkey are security events", () => {
    const values = schema.authEventType.enumValues;
    // The slice ends at 1c's last value: 3a appends the staff events after it.
    expect(values.slice(values.indexOf("account_deleted"), values.indexOf("passkey_counter_regression") + 1)).toEqual([
      "account_deleted",
      "passkey_added",
      "passkey_removed",
      "passkey_counter_regression",
    ]);
  });
});

describe("explore 2c", () => {
  const column = (table: string, name: string) => byName.get(table)!.columns.find((c) => c.name === name);
  /** Name, SQL type and not-null of every column, in order. */
  const shape = (table: string) => byName.get(table)!.columns.map((c) => [c.name, c.getSQLType(), c.notNull]);
  /** Every foreign key of a table by its local column: the table and columns it points at and what a delete there does. */
  const foreignKeys = (table: string) =>
    Object.fromEntries(
      byName.get(table)!.foreignKeys.map((k) => {
        const ref = k.reference();
        return [ref.columns.map((c) => c.name).join(","), { table: getTableConfig(ref.foreignTable).name, columns: ref.foreignColumns.map((c) => c.name), onDelete: k.onDelete }];
      }),
    );
  const indexColumns = (config: { columns: unknown[] }) => config.columns.map((c) => (c as { name?: string }).name);

  test("profiles carry the author's Explore switch, on by default", () => {
    const flag = column("profiles", "show_in_explore");
    expect(flag?.getSQLType()).toBe("boolean");
    expect(flag?.notNull).toBe(true);
    expect(flag?.default).toBe(true);
  });

  test("explore_runs numbers each ranking with an identity and records its time, formula, counts and duration", () => {
    const cfg = byName.get("explore_runs")!;
    expect(cfg.schema).toBeUndefined(); // public
    expect(shape("explore_runs")).toEqual([
      ["generation", "integer", true],
      ["as_of", "timestamp with time zone", true],
      ["formula", "smallint", true],
      ["candidates", "integer", true],
      ["items", "integer", true],
      ["took_ms", "integer", true],
    ]);
    const generation = column("explore_runs", "generation");
    expect(generation?.primary).toBe(true);
    // Always generated: an insert cannot choose its generation, so the numbers come from the sequence alone.
    expect(generation?.generatedIdentity?.type).toBe("always");
    // The refresh writes every other value itself, the refresh time included, which tests move.
    expect(cfg.columns.filter((c) => c.hasDefault).map((c) => c.name)).toEqual(["generation"]);
    expect(cfg.foreignKeys).toEqual([]);
  });

  test("explore_items holds a ranking's posts by position, each post once, and goes with its ranking, its post or its author", () => {
    const cfg = byName.get("explore_items")!;
    expect(cfg.schema).toBeUndefined(); // public
    // No score or count is stored: the position is the order.
    expect(shape("explore_items")).toEqual([
      ["generation", "integer", true],
      ["position", "integer", true],
      ["post_id", "uuid", true],
      ["author_id", "uuid", true],
    ]);
    expect(cfg.primaryKeys.map((k) => k.columns.map((c) => c.name))).toEqual([["generation", "position"]]);
    expect(cfg.indexes.map((i) => [i.config.name, indexColumns(i.config), i.config.unique])).toEqual([["explore_items_generation_post_idx", ["generation", "post_id"], true]]);
    expect(foreignKeys("explore_items")).toEqual({
      generation: { table: "explore_runs", columns: ["generation"], onDelete: "cascade" },
      post_id: { table: "posts", columns: ["id"], onDelete: "cascade" },
      author_id: { table: "profiles", columns: ["id"], onDelete: "cascade" },
    });
  });

  test("both tables have row level security and one full-access policy for the API role", () => {
    // The loop under "row level security" covers them too; this pins the policy each one has.
    for (const name of ["explore_runs", "explore_items"]) {
      const cfg = byName.get(name)!;
      expect(cfg.enableRLS, name).toBe(true);
      expect(cfg.policies.map((p) => [p.name, p.for, p.to]), name).toEqual([[`${name}_api_all`, "all", apiRole]]);
    }
  });

  test("likes and reposts have a BRIN index on created_at for the refresh's window; bookmarks, which Explore never reads, has none", () => {
    for (const name of ["likes", "reposts"]) {
      const brin = byName.get(name)!.indexes.filter((i) => i.config.method === "brin");
      expect(brin.map((i) => [i.config.name, indexColumns(i.config), i.config.unique, i.config.where]), name).toEqual([[`${name}_created_brin`, ["created_at"], false, undefined]]);
    }
    expect(byName.get("bookmarks")!.indexes.filter((i) => i.config.method === "brin")).toEqual([]);
    // The factory's other indexes stay the same on all three tables.
    for (const name of ["likes", "reposts", "bookmarks"]) {
      const others = byName.get(name)!.indexes.filter((i) => i.config.method !== "brin");
      expect(others.map((i) => [i.config.name, i.config.method]).sort(), name).toEqual([
        [`${name}_post_idx`, "btree"],
        [`${name}_user_created_idx`, "btree"],
      ]);
    }
  });
});

describe("staff console 3a", () => {
  const column = (table: string, name: string) => byName.get(table)!.columns.find((c) => c.name === name);
  /** Name, SQL type and not-null of every column, in order. */
  const shape = (table: string) => byName.get(table)!.columns.map((c) => [c.name, c.getSQLType(), c.notNull]);
  /** Every foreign key of a table by its local columns: the table and columns it points at and what a delete there does. */
  const foreignKeys = (table: string) =>
    Object.fromEntries(
      byName.get(table)!.foreignKeys.map((k) => {
        const ref = k.reference();
        return [ref.columns.map((c) => c.name).join(","), { table: getTableConfig(ref.foreignTable).name, columns: ref.foreignColumns.map((c) => c.name), onDelete: k.onDelete }];
      }),
    );
  /** Every index as its name, its columns and whether it is unique, by name. */
  const indexes = (table: string) =>
    byName
      .get(table)!
      .indexes.map((i) => [i.config.name, i.config.columns.map((c) => (c as { name?: string }).name), i.config.unique])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const uniques = (table: string) => byName.get(table)!.uniqueConstraints.map((u) => [u.getName(), u.columns.map((c) => c.name)]);
  const checks = (table: string) => byName.get(table)!.checks.map((c) => c.name).sort();
  const policies = (table: string) => byName.get(table)!.policies.map((p) => [p.name, p.for, p.to]);

  test("the seven staff events close the auth event type, after 1c's passkey events", () => {
    const values = schema.authEventType.enumValues;
    expect(values.slice(values.indexOf("passkey_counter_regression") + 1)).toEqual([
      "staff_enrollment_issued",
      "staff_key_added",
      "staff_key_revoked",
      "staff_key_counter_regression",
      "staff_sign_in",
      "staff_signed_out",
      "staff_session_revoked",
    ]);
  });

  test("the three staff tables live in the auth schema, with row level security and one policy for the auth role", () => {
    for (const name of ["staff_keys", "staff_enrollments", "staff_sessions"]) {
      const cfg = byName.get(name)!;
      expect(cfg.schema, name).toBe("auth");
      expect(cfg.enableRLS, name).toBe(true);
      expect(policies(name), name).toEqual([[`${name}_auth_all`, "all", authRole]]);
    }
  });

  test("a staff key records its credential, its origin and relying party ID, its dates and whether it was revoked or suspect", () => {
    expect(shape("staff_keys")).toEqual([
      ["id", "uuid", true],
      ["user_id", "uuid", true],
      ["credential_id", "text", true],
      ["public_key", "text", true],
      ["counter", "bigint", true],
      ["transports", "text[]", true],
      ["name", "text", true],
      ["aaguid", "uuid", false],
      ["origin", "text", true],
      ["rp_id", "text", true],
      ["created_at", "timestamp with time zone", true],
      ["last_used_at", "timestamp with time zone", false],
      ["revoked_at", "timestamp with time zone", false],
      ["suspect_at", "timestamp with time zone", false],
    ]);
    // No user handle of its own: staff registrations use the account's webauthn_user_id.
    expect(column("staff_keys", "user_handle")).toBeUndefined();
    // The development cleaner deletes accounts as the superuser; a key must stop that delete, never go with it.
    expect(foreignKeys("staff_keys")).toEqual({ user_id: { table: "users", columns: ["id"], onDelete: "restrict" } });
    expect(indexes("staff_keys")).toEqual([
      ["staff_keys_credential_idx", ["credential_id"], true],
      ["staff_keys_user_idx", ["user_id"], false],
    ]);
    // The pair the staff sessions' foreign key names.
    expect(uniques("staff_keys")).toEqual([["staff_keys_id_user_id_unique", ["id", "user_id"]]]);
    expect(checks("staff_keys")).toEqual(["staff_keys_suspect_is_revoked"]);
  });

  test("an enrolment keeps only its token's hash, the console it was issued for, its expiry and when it was used", () => {
    expect(shape("staff_enrollments")).toEqual([
      ["id", "uuid", true],
      ["user_id", "uuid", true],
      ["token_hash", "text", true],
      ["origin", "text", true],
      ["rp_id", "text", true],
      ["created_at", "timestamp with time zone", true],
      ["expires_at", "timestamp with time zone", true],
      ["used_at", "timestamp with time zone", false],
    ]);
    expect(foreignKeys("staff_enrollments")).toEqual({ user_id: { table: "users", columns: ["id"], onDelete: "cascade" } });
    expect(indexes("staff_enrollments")).toEqual([
      ["staff_enrollments_token_hash_idx", ["token_hash"], true],
      ["staff_enrollments_user_idx", ["user_id"], false],
    ]);
  });

  test("a staff session keeps its token's hash, a unique handle, its key and account together, both expiries and the browser label", () => {
    expect(shape("staff_sessions")).toEqual([
      ["id", "text", true],
      ["handle", "uuid", true],
      ["user_id", "uuid", true],
      ["key_id", "uuid", true],
      ["created_at", "timestamp with time zone", true],
      ["last_used_at", "timestamp with time zone", true],
      ["idle_expires_at", "timestamp with time zone", true],
      ["absolute_expires_at", "timestamp with time zone", true],
      ["revoked_at", "timestamp with time zone", false],
      ["browser", "text", true],
    ]);
    expect(column("staff_sessions", "id")?.primary).toBe(true);
    expect(column("staff_sessions", "handle")?.hasDefault).toBe(true);
    // The key's foreign key names the account as well, so a session's key always belongs to its account.
    expect(foreignKeys("staff_sessions")).toEqual({
      user_id: { table: "users", columns: ["id"], onDelete: "cascade" },
      "key_id,user_id": { table: "staff_keys", columns: ["id", "user_id"], onDelete: "cascade" },
    });
    expect(indexes("staff_sessions")).toEqual([
      ["staff_sessions_handle_idx", ["handle"], true],
      ["staff_sessions_user_idx", ["user_id"], false],
    ]);
    expect(checks("staff_sessions")).toEqual(["staff_sessions_lifetime"]);
  });

  test("audit_log gains the staff session's handle, the key, the action's hash and the step-up, all optional", () => {
    const added = [
      ["staff_session", "uuid"],
      ["key_id", "uuid"],
      ["action_hash", "text"],
      ["step_up", "jsonb"],
    ] as const;
    for (const [name, type] of added) {
      expect(column("audit_log", name)?.getSQLType(), name).toBe(type);
      expect(column("audit_log", name)?.notNull, name).toBe(false);
      expect(column("audit_log", name)?.hasDefault, name).toBe(false);
    }
    expect(checks("audit_log")).toEqual(["audit_log_step_up_complete"]);
  });

  test("audit_log's chain columns are not null, with placeholder defaults that the trigger always overwrites", () => {
    const chain = [
      ["chain_version", "smallint", 0],
      ["chain_seq", "bigint", 0],
      ["prev_hash", "text", ""],
      ["hash", "text", ""],
    ] as const;
    for (const [name, type, placeholder] of chain) {
      expect(column("audit_log", name)?.getSQLType(), name).toBe(type);
      expect(column("audit_log", name)?.notNull, name).toBe(true);
      expect(column("audit_log", name)?.default, name).toBe(placeholder);
    }
    // One index serves the viewer and audit-verify; there is none on (created_at, id).
    expect(indexes("audit_log")).toEqual([["audit_log_chain_seq_idx", ["chain_seq"], true]]);
  });

  test("audit_head holds one row, the newest place and hash, which the API role may only read", () => {
    const cfg = byName.get("audit_head")!;
    expect(cfg.schema).toBeUndefined(); // public
    expect(shape("audit_head")).toEqual([
      ["id", "smallint", true],
      ["seq", "bigint", true],
      ["hash", "text", true],
    ]);
    expect(column("audit_head", "id")?.primary).toBe(true);
    expect(cfg.columns.filter((c) => c.hasDefault)).toEqual([]);
    expect(checks("audit_head")).toEqual(["audit_head_single_row"]);
    expect(cfg.enableRLS).toBe(true);
    expect(policies("audit_head")).toEqual([["audit_head_api_select", "select", apiRole]]);
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
packages/contracts test:  ❯ test/staff.test.ts (25 tests | 24 failed) 49ms
packages/contracts test:  Test Files  1 failed | 7 passed (8)
packages/contracts test:       Tests  24 failed | 107 passed (131)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/staff-console-3a/write_blocks.py docs/superpowers/prompts/staff-console-3a/01-ground.md 3
```

Expected: 9 lines starting with `wrote`, one for each file below.

### Create `packages/contracts/src/staff.ts`

```ts
import { z } from "zod";
import { DisplayName, OpaqueId, Role } from "./auth";
import { AuthenticationResponseJSON, PasskeyOptionsResponse, RegistrationResponseJSON } from "./passkeys";

// The staff console (3a design, section 10). The console talks only to /api/staff/* on its own origin, and parses every
// answer with these schemas; the API validates every request with them.

/**
 * Every code the staff flows put in ErrorEnvelope.error.code. Staff routes may also answer the shared challenge_expired,
 * rate_limited and invalid_request, and the staff gate's not_found and csrf_failed, but never a passkey_* code.
 */
export const StaffErrorCode = z.enum([
  "staff_session_required",
  "staff_key_invalid",
  "staff_key_suspended",
  "staff_key_limit",
  "staff_key_not_device_bound",
  "staff_key_not_user_verified",
  "staff_key_refused",
  "staff_enrollment_invalid",
  "staff_step_up_required",
  "staff_step_up_invalid",
]);
export type StaffErrorCode = z.infer<typeof StaffErrorCode>;

/** The roles that open the console: an account whose role is user holds no staff key. */
export const StaffRole = Role.exclude(["user"]);
export type StaffRole = z.infer<typeof StaffRole>;

/**
 * The name a staff key's holder gives it at enrolment, under the display-name rules. The authenticator shows it (it is the
 * registration's user name), so the console asks for neither an email nor a real name.
 */
export const StaffKeyName = DisplayName;

/** Which button the enrolment page offered: a roaming security key (sent with the security-key hint) or this computer's Windows Hello (no hint). */
export const StaffKeyKind = z.enum(["security_key", "this_device"]);
export type StaffKeyKind = z.infer<typeof StaffKeyKind>;

/** A lowercase hex sha256: chain hashes and action hashes. */
const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "must be a lowercase hex sha256");

/** A row's place in the audit chain (chain_seq): 1 for the first row. */
const ChainSeq = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/**
 * A place as a query string names it: a decimal without a sign, a leading zero or an exponent, and at most 15 digits, so
 * it always converts to a safe integer.
 */
const ChainSeqParam = z
  .string()
  .regex(/^[1-9][0-9]{0,14}$/, "must be a place in the audit chain: a positive whole number")
  .transform(Number);

// ---------------------------------------------------------------- keys, sessions and the account

/** One of the person's staff keys as the console lists them: never the public key, the credential id or the AAGUID. */
export const StaffKey = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});
export type StaffKey = z.infer<typeof StaffKey>;

export const StaffKeysResponse = z.object({ keys: z.array(StaffKey) });
export type StaffKeysResponse = z.infer<typeof StaffKeysResponse>;

/**
 * One of the person's live staff sessions. `handle` is the session's random handle, which the revocation route takes;
 * `browser` is the coarse label ("Firefox on Linux"), never the user agent or an address.
 */
export const StaffSession = z.object({
  handle: z.uuid(),
  browser: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  /** The session this request came from. */
  current: z.boolean(),
});
export type StaffSession = z.infer<typeof StaffSession>;

export const StaffSessionsResponse = z.object({ sessions: z.array(StaffSession) });
export type StaffSessionsResponse = z.infer<typeof StaffSessionsResponse>;

/**
 * GET /api/staff/me: the account's handle and role, the session's handle (the console binds step-up challenges to it) and
 * both expiries with the seconds left, counted on the server, so the console's idle timer needs no clock of its own.
 */
export const StaffMe = z
  .object({
    handle: z.string(),
    role: StaffRole,
    sessionHandle: z.uuid(),
    idleExpiresAt: z.iso.datetime(),
    idleSecondsLeft: z.number().int().nonnegative(),
    absoluteExpiresAt: z.iso.datetime(),
    absoluteSecondsLeft: z.number().int().nonnegative(),
  })
  // The idle expiry never moves past the absolute one (the database checks it too).
  .refine((me) => me.idleSecondsLeft <= me.absoluteSecondsLeft, { message: "the idle end cannot lie beyond the absolute end", path: ["idleSecondsLeft"] });
export type StaffMe = z.infer<typeof StaffMe>;

// ---------------------------------------------------------------- enrolment

/** POST /api/staff/enroll/options: the token of the link `staff.js enroll` printed, the key's name and its kind. */
export const StaffEnrollOptionsRequest = z.object({ token: OpaqueId, name: StaffKeyName, kind: StaffKeyKind });
export type StaffEnrollOptionsRequest = z.infer<typeof StaffEnrollOptionsRequest>;

/**
 * The registration options, and whether the console's relying party ID is the app's (`rpShared`, true in development).
 * Only when it is not does the page ask the password manager to drop a refused credential through the Signal API.
 */
export const StaffEnrollOptionsResponse = PasskeyOptionsResponse.extend({ rpShared: z.boolean() });
export type StaffEnrollOptionsResponse = z.infer<typeof StaffEnrollOptionsResponse>;

/** POST /api/staff/enroll/verify: the same token and name with the browser's registration response. */
export const StaffEnrollVerifyRequest = z.object({ token: OpaqueId, name: StaffKeyName, response: RegistrationResponseJSON });
export type StaffEnrollVerifyRequest = z.infer<typeof StaffEnrollVerifyRequest>;

/** The key the enrolment stored; the person then signs in with it once. */
export const StaffEnrollVerifyResponse = z.object({ key: StaffKey });
export type StaffEnrollVerifyResponse = z.infer<typeof StaffEnrollVerifyResponse>;

// ---------------------------------------------------------------- sign-in

/** POST /api/staff/signin/options takes no body and answers with discoverable-credential options. */
export const StaffSignInOptionsResponse = PasskeyOptionsResponse;
export type StaffSignInOptionsResponse = z.infer<typeof StaffSignInOptionsResponse>;

/** POST /api/staff/signin/verify: the browser's assertion. There is no device id: a staff session is its own record. */
export const StaffSignInVerifyRequest = z.object({ response: AuthenticationResponseJSON });
export type StaffSignInVerifyRequest = z.infer<typeof StaffSignInVerifyRequest>;

/** A sign-in answers with the new session as /me describes it, beside the two staff cookies. */
export const StaffSignInVerifyResponse = StaffMe;
export type StaffSignInVerifyResponse = z.infer<typeof StaffSignInVerifyResponse>;

// ---------------------------------------------------------------- step-up

/**
 * Every action a staff key confirms, one at a time (3a design, section 7): the type of its target, the schema of the
 * target's id and the schema of its params. The step-up options, requireStaffStepUp, audit-verify and the console read it.
 * The params are hashed exactly as sent, so their schemas are strict: a member they do not know is refused, never dropped.
 */
export const STAFF_STEP_UP_ACTIONS = {
  /** DELETE /api/staff/sessions/:handle: one of the person's own staff sessions, by its handle. */
  staff_session_revoked: { targetType: "staff_session", targetId: z.uuid(), params: z.strictObject({}) },
} as const;
export type StaffStepUpAction = keyof typeof STAFF_STEP_UP_ACTIONS;

export const StaffStepUpActionName = z.enum(Object.keys(STAFF_STEP_UP_ACTIONS) as [StaffStepUpAction, ...StaffStepUpAction[]]);

/** The `{ action, target, params }` of one step-up action, each part checked by that action's own schemas. */
function stepUpRequest<A extends StaffStepUpAction>(action: A) {
  const spec = STAFF_STEP_UP_ACTIONS[action];
  return z.strictObject({
    action: z.literal(action),
    target: z.strictObject({ type: z.literal(spec.targetType), id: spec.targetId }),
    params: spec.params,
  });
}

/** POST /api/staff/step-up/options: the action the route will execute, as it will execute it. */
export const StaffStepUpOptionsRequest = z.discriminatedUnion("action", [stepUpRequest("staff_session_revoked")]);
export type StaffStepUpOptionsRequest = z.infer<typeof StaffStepUpOptionsRequest>;

/** The options: a challenge bound to the session and the action, and an allow list holding only the session's key. */
export const StaffStepUpOptionsResponse = PasskeyOptionsResponse;
export type StaffStepUpOptionsResponse = z.infer<typeof StaffStepUpOptionsResponse>;

/** DELETE /api/staff/sessions/:handle: the action's params (none) with the step-up assertion added as `stepUp`. */
export const StaffSessionRevokeRequest = STAFF_STEP_UP_ACTIONS.staff_session_revoked.params.extend({ stepUp: AuthenticationResponseJSON });
export type StaffSessionRevokeRequest = z.infer<typeof StaffSessionRevokeRequest>;

/**
 * A step-up assertion as the audit row stores it in `step_up`: the three members `audit-verify` checks, base64url exactly
 * as the browser sent them, under the same bounds as the browser's answer.
 */
export const StaffStoredAssertion = z.strictObject(
  AuthenticationResponseJSON.shape.response.pick({ authenticatorData: true, clientDataJSON: true, signature: true }).shape,
);
export type StaffStoredAssertion = z.infer<typeof StaffStoredAssertion>;

// ---------------------------------------------------------------- the audit log

/** How many rows one page of the audit log holds. */
export const STAFF_AUDIT_PAGE_SIZE = 50;

/**
 * One row of the audit log as the console shows it: its place and hash in the chain, when it joined the chain, the actor's
 * handle (null for the system actor or an account without one), the action, its target and the action's hash when a
 * step-up confirmed it. Never its metadata.
 */
export const AuditEntry = z.object({
  seq: ChainSeq,
  hash: Sha256Hex,
  createdAt: z.iso.datetime(),
  actorHandle: z.string().nullable(),
  action: z.string().min(1),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  actionHash: Sha256Hex.nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

/** Newest first by place. `nextCursor` asks for the rows before this page's last one; null when there are none. */
export const AuditPage = z.object({ entries: z.array(AuditEntry).max(STAFF_AUDIT_PAGE_SIZE), nextCursor: ChainSeq.nullable() });
export type AuditPage = z.infer<typeof AuditPage>;

/**
 * GET /api/staff/audit: from the newest row, from before `cursor`, or the page whose newest row is at place `at` (the
 * keeper's "Go to place"); `action=staff_sign_in` is the reader's one filter, which the home screen's list of sign-ins reads.
 */
export const AuditPageQuery = z
  .object({ cursor: ChainSeqParam.optional(), at: ChainSeqParam.optional(), action: z.enum(["staff_sign_in"]).optional() })
  .refine((query) => query.cursor === undefined || query.at === undefined, { message: "ask for a cursor or a place, not both", path: ["at"] });
export type AuditPageQuery = z.infer<typeof AuditPageQuery>;
```

### Create `packages/db/migrations/0012_aberrant_wendell_vaughn.sql`

```sql
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'staff_enrollment_issued';--> statement-breakpoint
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'staff_key_added';--> statement-breakpoint
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'staff_key_revoked';--> statement-breakpoint
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'staff_key_counter_regression';--> statement-breakpoint
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'staff_sign_in';--> statement-breakpoint
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'staff_signed_out';--> statement-breakpoint
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'staff_session_revoked';--> statement-breakpoint
CREATE TABLE "auth"."staff_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"origin" text NOT NULL,
	"rp_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "auth"."staff_enrollments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth"."staff_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text[] DEFAULT '{}'::text[] NOT NULL,
	"name" text NOT NULL,
	"aaguid" uuid,
	"origin" text NOT NULL,
	"rp_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"suspect_at" timestamp with time zone,
	CONSTRAINT "staff_keys_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "staff_keys_suspect_is_revoked" CHECK ("auth"."staff_keys"."suspect_at" is null or "auth"."staff_keys"."revoked_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "auth"."staff_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth"."staff_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"handle" uuid DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"browser" text NOT NULL,
	CONSTRAINT "staff_sessions_lifetime" CHECK ("auth"."staff_sessions"."absolute_expires_at" <= "auth"."staff_sessions"."created_at" + interval '12 hours' and "auth"."staff_sessions"."idle_expires_at" <= "auth"."staff_sessions"."absolute_expires_at")
);
--> statement-breakpoint
ALTER TABLE "auth"."staff_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_head" (
	"id" smallint PRIMARY KEY NOT NULL,
	"seq" bigint NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "audit_head_single_row" CHECK ("audit_head"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "audit_head" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "staff_session" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "key_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "action_hash" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "step_up" jsonb;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "chain_version" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "chain_seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "prev_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."staff_enrollments" ADD CONSTRAINT "staff_enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."staff_keys" ADD CONSTRAINT "staff_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."staff_sessions" ADD CONSTRAINT "staff_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."staff_sessions" ADD CONSTRAINT "staff_sessions_key_user_fk" FOREIGN KEY ("key_id","user_id") REFERENCES "auth"."staff_keys"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_enrollments_token_hash_idx" ON "auth"."staff_enrollments" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "staff_enrollments_user_idx" ON "auth"."staff_enrollments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_keys_credential_idx" ON "auth"."staff_keys" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "staff_keys_user_idx" ON "auth"."staff_keys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_sessions_handle_idx" ON "auth"."staff_sessions" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "staff_sessions_user_idx" ON "auth"."staff_sessions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_step_up_complete" CHECK (("audit_log"."action_hash" is null) = ("audit_log"."step_up" is null) and ("audit_log"."action_hash" is null or "audit_log"."key_id" is not null));--> statement-breakpoint
CREATE POLICY "staff_enrollments_auth_all" ON "auth"."staff_enrollments" AS PERMISSIVE FOR ALL TO "korbat_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "staff_keys_auth_all" ON "auth"."staff_keys" AS PERMISSIVE FOR ALL TO "korbat_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "staff_sessions_auth_all" ON "auth"."staff_sessions" AS PERMISSIVE FOR ALL TO "korbat_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "audit_head_api_select" ON "audit_head" AS PERMISSIVE FOR SELECT TO "korbat_api" USING (true);--> statement-breakpoint
-- Everything below is written by hand (3a design, section 6), in the order the design gives. drizzle's migrator runs every
-- pending migration in one transaction, so a failure anywhere leaves the audit log unchained and unchanged.
--
-- The audit chain's canonical text, version 1. It is implemented twice: here, for the trigger and the back-fill, and in
-- Node by the staff module's chain.ts, which audit-verify uses and which never asks the database for a text or a hash,
-- since the owner can replace this function. A JSON array without whitespace: chain_version, chain_seq and id as
-- integers; created_at in UTC to the millisecond; the actor, the action, the target's type and id, the request id, the
-- staff session's handle, the key and the action's hash, each a JSON string or null; then step_up and last metadata,
-- exactly as PostgreSQL prints the stored jsonb (its own key order and separators), step_up null when absent. Strings are
-- escaped by to_json, as JSON.stringify escapes them. Every name is schema-qualified and the search path pinned, so no
-- temporary object can stand in for one.
CREATE FUNCTION "public"."audit_chain_text"(r "public"."audit_log") RETURNS text
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
BEGIN
  -- A later sub-project that chains another column adds version 2 here and in chain.ts; every row keeps its version.
  IF r.chain_version IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'audit chain version % is not known', r.chain_version;
  END IF;
  RETURN '[' || r.chain_version::text || ',' || r.chain_seq::text || ',' || r.id::text || ','
    || to_json(to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text || ','
    || coalesce(to_json(r.actor_id::text)::text, 'null') || ','
    || coalesce(to_json(r.action)::text, 'null') || ','
    || coalesce(to_json(r.target_type)::text, 'null') || ','
    || coalesce(to_json(r.target_id)::text, 'null') || ','
    || coalesce(to_json(r.request_id)::text, 'null') || ','
    || coalesce(to_json(r.staff_session::text)::text, 'null') || ','
    || coalesce(to_json(r.key_id::text)::text, 'null') || ','
    || coalesce(to_json(r.action_hash)::text, 'null') || ','
    || coalesce(r.step_up::text, 'null') || ','
    || r.metadata::text || ']';
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."audit_chain_text"("public"."audit_log") FROM PUBLIC;--> statement-breakpoint
-- The chain records times to the millisecond, as JavaScript reads them; the rows written before it change by under 1 ms.
UPDATE "public"."audit_log" SET "created_at" = date_trunc('milliseconds', "created_at");--> statement-breakpoint
-- The back-fill: the rows written before the chain (grant-role's) are chained in id order, which was their only order.
-- The hash is the lower-case hex sha256 of the UTF-8 bytes of prev_hash followed by the text: convert_to, never a cast to
-- bytea, which would read the backslashes of JSON escapes as its own.
DO $$
DECLARE
  r public.audit_log;
  prev text := repeat('0', 64);
  place bigint := 0;
BEGIN
  FOR r IN SELECT * FROM public.audit_log ORDER BY id LOOP
    place := place + 1;
    r.chain_version := 1;
    r.chain_seq := place;
    r.prev_hash := prev;
    prev := encode(sha256(convert_to(r.prev_hash || public.audit_chain_text(r), 'UTF8')), 'hex');
    UPDATE public.audit_log SET chain_version = 1, chain_seq = place, prev_hash = r.prev_hash, hash = prev WHERE id = r.id;
  END LOOP;
END $$;--> statement-breakpoint
-- The head: the newest row's place and hash, or place 0 and 64 zeros for an empty log. The trigger never creates it.
INSERT INTO "public"."audit_head" ("id", "seq", "hash")
SELECT 1, coalesce(max("chain_seq"), 0), coalesce((SELECT "hash" FROM "public"."audit_log" ORDER BY "chain_seq" DESC LIMIT 1), repeat('0', 64))
FROM "public"."audit_log";--> statement-breakpoint
-- Generated from safety.ts, moved here: before the back-fill every row held the placeholder 0.
CREATE UNIQUE INDEX "audit_log_chain_seq_idx" ON "audit_log" USING btree ("chain_seq");--> statement-breakpoint
-- 0001's default privileges gave the API role every write on new public tables. It reads the head and nothing more: it can
-- neither move it nor lock its row, since SELECT ... FOR UPDATE needs UPDATE. On audit_log it keeps INSERT and SELECT
-- (0001 revoked UPDATE, DELETE and TRUNCATE).
REVOKE ALL ON "public"."audit_head" FROM korbat_api;--> statement-breakpoint
GRANT SELECT ON "public"."audit_head" TO korbat_api;--> statement-breakpoint
-- The chain's trigger. It runs as its owner, the migrator, and places every row whatever the insert supplied: it locks the
-- head's row until the inserting transaction ends (so an audit row is always the last statement of its transaction), draws
-- the id itself (so an insert naming an existing id with ON CONFLICT DO NOTHING cannot move the head without writing its
-- row), and sets the time the row joined the chain, its place after the head's and the hashes. A rolled-back insert rolls
-- the head back with it, so the places have no gaps.
CREATE FUNCTION "public"."audit_chain"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  head_seq bigint;
  head_hash text;
BEGIN
  SELECT h.seq, h.hash INTO head_seq, head_hash FROM public.audit_head h WHERE h.id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the audit head is missing';
  END IF;
  NEW.id := nextval('public.audit_log_id_seq');
  NEW.created_at := date_trunc('milliseconds', clock_timestamp());
  NEW.chain_version := 1;
  NEW.chain_seq := head_seq + 1;
  NEW.prev_hash := head_hash;
  NEW.hash := encode(sha256(convert_to(head_hash || public.audit_chain_text(NEW), 'UTF8')), 'hex');
  UPDATE public.audit_head SET seq = NEW.chain_seq, hash = NEW.hash WHERE id = 1;
  RETURN NEW;
END $$;--> statement-breakpoint
-- Nobody calls it; the trigger still fires for every role that inserts.
REVOKE ALL ON FUNCTION "public"."audit_chain"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "audit_chain" BEFORE INSERT ON "public"."audit_log" FOR EACH ROW EXECUTE FUNCTION "public"."audit_chain"();--> statement-breakpoint
-- The auth side. 0001's default privileges gave the auth role every write on new auth tables. A staff key is added only by
-- auth.add_staff_key below and an enrolment only by `staff.js enroll` as the migrator, so code running in the API can end
-- staff access but never grant it. On staff keys the auth role keeps reading and recording a key's use, revocation and
-- suspicion; on enrolments reading and deleting (a cancellation, or the janitor). Staff sessions keep the default grants:
-- the flows create, slide and revoke them, and the janitor deletes them.
REVOKE ALL ON "auth"."staff_keys" FROM korbat_auth;--> statement-breakpoint
GRANT SELECT ON "auth"."staff_keys" TO korbat_auth;--> statement-breakpoint
GRANT UPDATE ("counter", "last_used_at", "revoked_at", "suspect_at") ON "auth"."staff_keys" TO korbat_auth;--> statement-breakpoint
REVOKE ALL ON "auth"."staff_enrollments" FROM korbat_auth;--> statement-breakpoint
GRANT SELECT, DELETE ON "auth"."staff_enrollments" TO korbat_auth;--> statement-breakpoint
-- Revocation, suspicion and use are for good: a set revoked_at or suspect_at on a key, or used_at on an enrolment, is
-- never cleared or changed, by any role. A writer that revokes sets revoked_at only where it is still null.
CREATE FUNCTION "auth"."staff_never_cleared"() RETURNS trigger
LANGUAGE plpgsql SET search_path = auth, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'staff_keys' THEN
    IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
      RAISE EXCEPTION 'a staff key''s revoked_at is never cleared or changed';
    END IF;
    IF OLD.suspect_at IS NOT NULL AND NEW.suspect_at IS DISTINCT FROM OLD.suspect_at THEN
      RAISE EXCEPTION 'a staff key''s suspect_at is never cleared or changed';
    END IF;
  ELSIF OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at THEN
    RAISE EXCEPTION 'an enrolment''s used_at is never cleared or changed';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth"."staff_never_cleared"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "staff_keys_never_cleared" BEFORE UPDATE ON "auth"."staff_keys" FOR EACH ROW EXECUTE FUNCTION "auth"."staff_never_cleared"();--> statement-breakpoint
CREATE TRIGGER "staff_enrollments_never_cleared" BEFORE UPDATE ON "auth"."staff_enrollments" FOR EACH ROW EXECUTE FUNCTION "auth"."staff_never_cleared"();--> statement-breakpoint
-- The only way a staff key comes to exist: the enrolment flow's last statement, on the auth role, in its own transaction.
-- It hashes the link's token itself, so a token hash read from the table spends nothing. Under a lock on the account's row
-- (FOR NO KEY UPDATE, as every writer of staff rows takes it first, 3a design section 7) it re-checks that the enrolment
-- is unused and unexpired and that the account is live, staff, has a handle and holds fewer than five live keys; then it
-- spends the enrolment, stores the key with the origin and relying party ID the enrolment recorded, and writes the key's
-- audit row, last. It raises 'staff_enrollment_invalid' or 'staff_key_limit' as its message, which the flow answers with
-- the staff code of that name. Every column name is qualified: the parameters share several of them.
CREATE FUNCTION "auth"."add_staff_key"(token text, credential_id text, public_key text, counter bigint, transports text[], name text, aaguid uuid, request_id text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = auth, pg_temp AS $$
DECLARE
  enrolment auth.staff_enrollments;
  account auth.users;
  live_keys integer;
  new_key_id uuid;
BEGIN
  SELECT e.* INTO enrolment FROM auth.staff_enrollments e
   WHERE e.token_hash = encode(sha256(convert_to(add_staff_key.token, 'UTF8')), 'hex');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_enrollment_invalid' USING DETAIL = 'No enrolment was issued with this token.';
  END IF;
  -- The account's row before the enrolment's, the order every other writer takes them in. A revocation, role change or
  -- take-down that held it first has deleted the enrolment by now, so the re-read below finds nothing.
  SELECT u.* INTO account FROM auth.users u WHERE u.id = enrolment.user_id FOR NO KEY UPDATE;
  SELECT e.* INTO enrolment FROM auth.staff_enrollments e WHERE e.id = enrolment.id FOR UPDATE;
  IF NOT FOUND OR enrolment.used_at IS NOT NULL OR enrolment.expires_at <= now() THEN
    RAISE EXCEPTION 'staff_enrollment_invalid' USING DETAIL = 'The enrolment was used, has expired or was cancelled.';
  END IF;
  -- Live (not deleted), staff, and with a handle (onboarded: the console names staff by their handle).
  IF account.deleted_at IS NOT NULL OR account.role NOT IN ('moderator', 'admin') OR account.onboarded_at IS NULL THEN
    RAISE EXCEPTION 'staff_enrollment_invalid' USING DETAIL = 'The account is not a live staff account with a handle.';
  END IF;
  SELECT count(*) INTO live_keys FROM auth.staff_keys k WHERE k.user_id = account.id AND k.revoked_at IS NULL;
  IF live_keys >= 5 THEN
    RAISE EXCEPTION 'staff_key_limit' USING DETAIL = 'The account already holds 5 live staff keys.';
  END IF;
  UPDATE auth.staff_enrollments e SET used_at = now() WHERE e.id = enrolment.id;
  INSERT INTO auth.staff_keys (user_id, credential_id, public_key, counter, transports, name, aaguid, origin, rp_id)
  VALUES (account.id, add_staff_key.credential_id, add_staff_key.public_key, add_staff_key.counter,
          coalesce(add_staff_key.transports, '{}'::text[]), add_staff_key.name, add_staff_key.aaguid, enrolment.origin, enrolment.rp_id)
  RETURNING id INTO new_key_id;
  -- The metadata names the enrolment, never the key's name or AAGUID: the account's deletion blanks those on the key,
  -- and nothing can blank them in the log.
  INSERT INTO public.audit_log (actor_id, action, target_type, target_id, key_id, metadata, request_id)
  VALUES (account.id, 'staff_key_added', 'staff_key', new_key_id::text, new_key_id,
          jsonb_build_object('enrollmentId', enrolment.id), add_staff_key.request_id);
  RETURN new_key_id;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth"."add_staff_key"(text, text, text, bigint, text[], text, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth"."add_staff_key"(text, text, text, bigint, text[], text, uuid, text) TO korbat_auth;--> statement-breakpoint
-- The auth side's rows of the audit log, which the auth role cannot write itself (it holds nothing in public): each is
-- written in the same transaction as its change, as that transaction's last statement, so a fact is in the record exactly
-- when its change committed. Only the auth side's actions pass, so the auth role can never write a decision; the take-down's
-- revocations are staff_key_revoked rows. Returns the row's place in the chain.
CREATE FUNCTION "auth"."append_audit"(actor_id uuid, action text, target_type text, target_id text, metadata jsonb, staff_session uuid, key_id uuid, action_hash text, step_up jsonb, request_id text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = auth, pg_temp AS $$
DECLARE
  place bigint;
BEGIN
  IF append_audit.action IS NULL OR append_audit.action NOT IN (
    'staff_key_revoked', 'staff_key_counter_regression', 'staff_sign_in', 'staff_signed_out',
    'staff_session_revoked', 'staff_enrollments_cancelled', 'role_granted'
  ) THEN
    RAISE EXCEPTION '%', format('auth.append_audit does not write the action %L', append_audit.action);
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_type, target_id, metadata, staff_session, key_id, action_hash, step_up, request_id)
  VALUES (append_audit.actor_id, append_audit.action, append_audit.target_type, append_audit.target_id,
          coalesce(append_audit.metadata, '{}'::jsonb), append_audit.staff_session, append_audit.key_id,
          append_audit.action_hash, append_audit.step_up, append_audit.request_id)
  RETURNING chain_seq INTO place;
  RETURN place;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth"."append_audit"(uuid, text, text, text, jsonb, uuid, uuid, text, jsonb, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth"."append_audit"(uuid, text, text, text, jsonb, uuid, uuid, text, jsonb, text) TO korbat_auth;--> statement-breakpoint
-- The account take-down's last word on its staff keys, which are never deleted: for an account marked deleted, every key
-- keeps only what audit-verify needs (its id, owner, credential id, public key, origin and relying party ID), its counter
-- and its dates; its name, AAGUID and transports go. For a live account it changes nothing. Returns how many keys it blanked.
CREATE FUNCTION "auth"."forget_staff_keys"(user_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = auth, pg_temp AS $$
DECLARE
  forgotten integer;
BEGIN
  UPDATE auth.staff_keys k SET name = '', aaguid = NULL, transports = '{}'::text[]
   WHERE k.user_id = forget_staff_keys.user_id
     AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = forget_staff_keys.user_id AND u.deleted_at IS NOT NULL);
  GET DIAGNOSTICS forgotten = ROW_COUNT;
  RETURN forgotten;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth"."forget_staff_keys"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth"."forget_staff_keys"(uuid) TO korbat_auth;
```

### Create `packages/db/migrations/meta/0012_snapshot.json`

```json
{
  "id": "dfae6382-75f0-4044-9a2e-deb6e3fb9f7e",
  "prevId": "1079a2cc-3f37-4a19-ad86-dffe4ca3f94c",
  "version": "7",
  "dialect": "postgresql",
  "tables": {
    "auth.auth_events": {
      "name": "auth_events",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "bigserial",
          "primaryKey": true,
          "notNull": true
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "type": {
          "name": "type",
          "type": "auth_event_type",
          "typeSchema": "auth",
          "primaryKey": false,
          "notNull": true
        },
        "device_id": {
          "name": "device_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "ip_hash": {
          "name": "ip_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "metadata": {
          "name": "metadata",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::jsonb"
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "auth_events_user_created_idx": {
          "name": "auth_events_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "auth_events_user_id_users_id_fk": {
          "name": "auth_events_user_id_users_id_fk",
          "tableFrom": "auth_events",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "auth_events_auth_insert": {
          "name": "auth_events_auth_insert",
          "as": "PERMISSIVE",
          "for": "INSERT",
          "to": [
            "korbat_auth"
          ],
          "withCheck": "true"
        },
        "auth_events_auth_select": {
          "name": "auth_events_auth_select",
          "as": "PERMISSIVE",
          "for": "SELECT",
          "to": [
            "korbat_auth"
          ],
          "using": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.devices": {
      "name": "devices",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "device_hash": {
          "name": "device_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "label": {
          "name": "label",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "platform": {
          "name": "platform",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "first_seen_at": {
          "name": "first_seen_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "last_seen_at": {
          "name": "last_seen_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "ip_hash": {
          "name": "ip_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "revoked_at": {
          "name": "revoked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "devices_user_idx": {
          "name": "devices_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "devices_ip_hash_idx": {
          "name": "devices_ip_hash_idx",
          "columns": [
            {
              "expression": "ip_hash",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "devices_user_id_users_id_fk": {
          "name": "devices_user_id_users_id_fk",
          "tableFrom": "devices",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "devices_auth_all": {
          "name": "devices_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.email_codes": {
      "name": "email_codes",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "email": {
          "name": "email",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "code_hash": {
          "name": "code_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "purpose": {
          "name": "purpose",
          "type": "email_code_purpose",
          "typeSchema": "auth",
          "primaryKey": false,
          "notNull": true
        },
        "expires_at": {
          "name": "expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "attempts": {
          "name": "attempts",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "consumed_at": {
          "name": "consumed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "flow_id": {
          "name": "flow_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "ip_hash": {
          "name": "ip_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "email_codes_email_idx": {
          "name": "email_codes_email_idx",
          "columns": [
            {
              "expression": "email",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "email_codes_flow_idx": {
          "name": "email_codes_flow_idx",
          "columns": [
            {
              "expression": "flow_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "email_codes_user_id_users_id_fk": {
          "name": "email_codes_user_id_users_id_fk",
          "tableFrom": "email_codes",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "email_codes_auth_all": {
          "name": "email_codes_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.passkeys": {
      "name": "passkeys",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "credential_id": {
          "name": "credential_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "public_key": {
          "name": "public_key",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "counter": {
          "name": "counter",
          "type": "bigint",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "transports": {
          "name": "transports",
          "type": "text[]",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::text[]"
        },
        "backed_up": {
          "name": "backed_up",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "name": {
          "name": "name",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "last_used_at": {
          "name": "last_used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "aaguid": {
          "name": "aaguid",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "backup_eligible": {
          "name": "backup_eligible",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "uv_initialized": {
          "name": "uv_initialized",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "created_device_id": {
          "name": "created_device_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "suspect_at": {
          "name": "suspect_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "passkeys_credential_idx": {
          "name": "passkeys_credential_idx",
          "columns": [
            {
              "expression": "credential_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "passkeys_user_idx": {
          "name": "passkeys_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "passkeys_user_id_users_id_fk": {
          "name": "passkeys_user_id_users_id_fk",
          "tableFrom": "passkeys",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "passkeys_created_device_id_devices_id_fk": {
          "name": "passkeys_created_device_id_devices_id_fk",
          "tableFrom": "passkeys",
          "tableTo": "devices",
          "schemaTo": "auth",
          "columnsFrom": [
            "created_device_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "passkeys_auth_all": {
          "name": "passkeys_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.sessions": {
      "name": "sessions",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "text",
          "primaryKey": true,
          "notNull": true
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "device_id": {
          "name": "device_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "expires_at": {
          "name": "expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "absolute_expires_at": {
          "name": "absolute_expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "last_used_at": {
          "name": "last_used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "revoked_at": {
          "name": "revoked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "reauth_at": {
          "name": "reauth_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "handle": {
          "name": "handle",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "factors": {
          "name": "factors",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::jsonb"
        },
        "passkey_id": {
          "name": "passkey_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "sessions_user_idx": {
          "name": "sessions_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "sessions_handle_idx": {
          "name": "sessions_handle_idx",
          "columns": [
            {
              "expression": "handle",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "sessions_user_id_users_id_fk": {
          "name": "sessions_user_id_users_id_fk",
          "tableFrom": "sessions",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "sessions_device_id_devices_id_fk": {
          "name": "sessions_device_id_devices_id_fk",
          "tableFrom": "sessions",
          "tableTo": "devices",
          "schemaTo": "auth",
          "columnsFrom": [
            "device_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "sessions_passkey_id_passkeys_id_fk": {
          "name": "sessions_passkey_id_passkeys_id_fk",
          "tableFrom": "sessions",
          "tableTo": "passkeys",
          "schemaTo": "auth",
          "columnsFrom": [
            "passkey_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "sessions_auth_all": {
          "name": "sessions_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.staff_enrollments": {
      "name": "staff_enrollments",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "token_hash": {
          "name": "token_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "origin": {
          "name": "origin",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "rp_id": {
          "name": "rp_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "expires_at": {
          "name": "expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "used_at": {
          "name": "used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "staff_enrollments_token_hash_idx": {
          "name": "staff_enrollments_token_hash_idx",
          "columns": [
            {
              "expression": "token_hash",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "staff_enrollments_user_idx": {
          "name": "staff_enrollments_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "staff_enrollments_user_id_users_id_fk": {
          "name": "staff_enrollments_user_id_users_id_fk",
          "tableFrom": "staff_enrollments",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "staff_enrollments_auth_all": {
          "name": "staff_enrollments_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.staff_keys": {
      "name": "staff_keys",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "credential_id": {
          "name": "credential_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "public_key": {
          "name": "public_key",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "counter": {
          "name": "counter",
          "type": "bigint",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "transports": {
          "name": "transports",
          "type": "text[]",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::text[]"
        },
        "name": {
          "name": "name",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "aaguid": {
          "name": "aaguid",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "origin": {
          "name": "origin",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "rp_id": {
          "name": "rp_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "last_used_at": {
          "name": "last_used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "revoked_at": {
          "name": "revoked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "suspect_at": {
          "name": "suspect_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "staff_keys_credential_idx": {
          "name": "staff_keys_credential_idx",
          "columns": [
            {
              "expression": "credential_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "staff_keys_user_idx": {
          "name": "staff_keys_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "staff_keys_user_id_users_id_fk": {
          "name": "staff_keys_user_id_users_id_fk",
          "tableFrom": "staff_keys",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "restrict",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {
        "staff_keys_id_user_id_unique": {
          "name": "staff_keys_id_user_id_unique",
          "nullsNotDistinct": false,
          "columns": [
            "id",
            "user_id"
          ]
        }
      },
      "policies": {
        "staff_keys_auth_all": {
          "name": "staff_keys_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "staff_keys_suspect_is_revoked": {
          "name": "staff_keys_suspect_is_revoked",
          "value": "\"auth\".\"staff_keys\".\"suspect_at\" is null or \"auth\".\"staff_keys\".\"revoked_at\" is not null"
        }
      },
      "isRLSEnabled": true
    },
    "auth.staff_sessions": {
      "name": "staff_sessions",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "text",
          "primaryKey": true,
          "notNull": true
        },
        "handle": {
          "name": "handle",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "key_id": {
          "name": "key_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "last_used_at": {
          "name": "last_used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "idle_expires_at": {
          "name": "idle_expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "absolute_expires_at": {
          "name": "absolute_expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "revoked_at": {
          "name": "revoked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "browser": {
          "name": "browser",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {
        "staff_sessions_handle_idx": {
          "name": "staff_sessions_handle_idx",
          "columns": [
            {
              "expression": "handle",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "staff_sessions_user_idx": {
          "name": "staff_sessions_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "staff_sessions_user_id_users_id_fk": {
          "name": "staff_sessions_user_id_users_id_fk",
          "tableFrom": "staff_sessions",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "staff_sessions_key_user_fk": {
          "name": "staff_sessions_key_user_fk",
          "tableFrom": "staff_sessions",
          "tableTo": "staff_keys",
          "schemaTo": "auth",
          "columnsFrom": [
            "key_id",
            "user_id"
          ],
          "columnsTo": [
            "id",
            "user_id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "staff_sessions_auth_all": {
          "name": "staff_sessions_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "staff_sessions_lifetime": {
          "name": "staff_sessions_lifetime",
          "value": "\"auth\".\"staff_sessions\".\"absolute_expires_at\" <= \"auth\".\"staff_sessions\".\"created_at\" + interval '12 hours' and \"auth\".\"staff_sessions\".\"idle_expires_at\" <= \"auth\".\"staff_sessions\".\"absolute_expires_at\""
        }
      },
      "isRLSEnabled": true
    },
    "auth.users": {
      "name": "users",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "email": {
          "name": "email",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "email_verified_at": {
          "name": "email_verified_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "phone_hash": {
          "name": "phone_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "password_hash": {
          "name": "password_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "totp_secret_enc": {
          "name": "totp_secret_enc",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "totp_enabled_at": {
          "name": "totp_enabled_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "recovery_codes_hash": {
          "name": "recovery_codes_hash",
          "type": "text[]",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::text[]"
        },
        "failed_logins": {
          "name": "failed_logins",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "locked_until": {
          "name": "locked_until",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "deleted_at": {
          "name": "deleted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "role": {
          "name": "role",
          "type": "user_role",
          "typeSchema": "auth",
          "primaryKey": false,
          "notNull": true,
          "default": "'user'"
        },
        "age_confirmed_at": {
          "name": "age_confirmed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "terms_version": {
          "name": "terms_version",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "terms_accepted_at": {
          "name": "terms_accepted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "onboarded_at": {
          "name": "onboarded_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "password_changed_at": {
          "name": "password_changed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "totp_last_step": {
          "name": "totp_last_step",
          "type": "bigint",
          "primaryKey": false,
          "notNull": false
        },
        "purged_at": {
          "name": "purged_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "webauthn_user_id": {
          "name": "webauthn_user_id",
          "type": "bytea",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "users_email_lower_idx": {
          "name": "users_email_lower_idx",
          "columns": [
            {
              "expression": "lower(\"email\")",
              "asc": true,
              "isExpression": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "users_phone_hash_idx": {
          "name": "users_phone_hash_idx",
          "columns": [
            {
              "expression": "phone_hash",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "where": "phone_hash is not null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "users_webauthn_user_id_idx": {
          "name": "users_webauthn_user_id_idx",
          "columns": [
            {
              "expression": "webauthn_user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "where": "webauthn_user_id is not null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "users_auth_all": {
          "name": "users_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.handle_history": {
      "name": "handle_history",
      "schema": "",
      "columns": {
        "handle_lower": {
          "name": "handle_lower",
          "type": "text",
          "primaryKey": true,
          "notNull": true
        },
        "profile_id": {
          "name": "profile_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "changed_at": {
          "name": "changed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {},
      "foreignKeys": {
        "handle_history_profile_id_profiles_id_fk": {
          "name": "handle_history_profile_id_profiles_id_fk",
          "tableFrom": "handle_history",
          "tableTo": "profiles",
          "columnsFrom": [
            "profile_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "handle_history_api_all": {
          "name": "handle_history_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.profiles": {
      "name": "profiles",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true
        },
        "handle": {
          "name": "handle",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "display_name": {
          "name": "display_name",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "bio": {
          "name": "bio",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "''"
        },
        "avatar_path": {
          "name": "avatar_path",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "verified_at": {
          "name": "verified_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "reputation": {
          "name": "reputation",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "follower_count": {
          "name": "follower_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "following_count": {
          "name": "following_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "post_count": {
          "name": "post_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "deleted_at": {
          "name": "deleted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "handle_changed_at": {
          "name": "handle_changed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "show_in_explore": {
          "name": "show_in_explore",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": true
        }
      },
      "indexes": {
        "profiles_handle_lower_idx": {
          "name": "profiles_handle_lower_idx",
          "columns": [
            {
              "expression": "lower(\"handle\")",
              "asc": true,
              "isExpression": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "profiles_api_all": {
          "name": "profiles_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "profiles_counts_nonnegative": {
          "name": "profiles_counts_nonnegative",
          "value": "\"profiles\".\"follower_count\" >= 0 and \"profiles\".\"following_count\" >= 0 and \"profiles\".\"post_count\" >= 0"
        }
      },
      "isRLSEnabled": true
    },
    "public.blocks": {
      "name": "blocks",
      "schema": "",
      "columns": {
        "blocker_id": {
          "name": "blocker_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "blocked_id": {
          "name": "blocked_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "blocks_to_created_idx": {
          "name": "blocks_to_created_idx",
          "columns": [
            {
              "expression": "blocked_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "blocker_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "blocks_from_created_idx": {
          "name": "blocks_from_created_idx",
          "columns": [
            {
              "expression": "blocker_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "blocked_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "blocks_blocker_id_profiles_id_fk": {
          "name": "blocks_blocker_id_profiles_id_fk",
          "tableFrom": "blocks",
          "tableTo": "profiles",
          "columnsFrom": [
            "blocker_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "blocks_blocked_id_profiles_id_fk": {
          "name": "blocks_blocked_id_profiles_id_fk",
          "tableFrom": "blocks",
          "tableTo": "profiles",
          "columnsFrom": [
            "blocked_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "blocks_blocker_id_blocked_id_pk": {
          "name": "blocks_blocker_id_blocked_id_pk",
          "columns": [
            "blocker_id",
            "blocked_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "blocks_api_all": {
          "name": "blocks_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "blocks_not_self": {
          "name": "blocks_not_self",
          "value": "\"blocks\".\"blocker_id\" <> \"blocks\".\"blocked_id\""
        }
      },
      "isRLSEnabled": true
    },
    "public.bookmarks": {
      "name": "bookmarks",
      "schema": "",
      "columns": {
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "bookmarks_post_idx": {
          "name": "bookmarks_post_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "bookmarks_user_created_idx": {
          "name": "bookmarks_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "bookmarks_user_id_profiles_id_fk": {
          "name": "bookmarks_user_id_profiles_id_fk",
          "tableFrom": "bookmarks",
          "tableTo": "profiles",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "bookmarks_post_id_posts_id_fk": {
          "name": "bookmarks_post_id_posts_id_fk",
          "tableFrom": "bookmarks",
          "tableTo": "posts",
          "columnsFrom": [
            "post_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "bookmarks_user_id_post_id_pk": {
          "name": "bookmarks_user_id_post_id_pk",
          "columns": [
            "user_id",
            "post_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "bookmarks_api_all": {
          "name": "bookmarks_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.explore_items": {
      "name": "explore_items",
      "schema": "",
      "columns": {
        "generation": {
          "name": "generation",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "position": {
          "name": "position",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "author_id": {
          "name": "author_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {
        "explore_items_generation_post_idx": {
          "name": "explore_items_generation_post_idx",
          "columns": [
            {
              "expression": "generation",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "explore_items_generation_explore_runs_generation_fk": {
          "name": "explore_items_generation_explore_runs_generation_fk",
          "tableFrom": "explore_items",
          "tableTo": "explore_runs",
          "columnsFrom": [
            "generation"
          ],
          "columnsTo": [
            "generation"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "explore_items_post_id_posts_id_fk": {
          "name": "explore_items_post_id_posts_id_fk",
          "tableFrom": "explore_items",
          "tableTo": "posts",
          "columnsFrom": [
            "post_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "explore_items_author_id_profiles_id_fk": {
          "name": "explore_items_author_id_profiles_id_fk",
          "tableFrom": "explore_items",
          "tableTo": "profiles",
          "columnsFrom": [
            "author_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "explore_items_generation_position_pk": {
          "name": "explore_items_generation_position_pk",
          "columns": [
            "generation",
            "position"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "explore_items_api_all": {
          "name": "explore_items_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.explore_runs": {
      "name": "explore_runs",
      "schema": "",
      "columns": {
        "generation": {
          "name": "generation",
          "type": "integer",
          "primaryKey": true,
          "notNull": true,
          "identity": {
            "type": "always",
            "name": "explore_runs_generation_seq",
            "schema": "public",
            "increment": "1",
            "startWith": "1",
            "minValue": "1",
            "maxValue": "2147483647",
            "cache": "1",
            "cycle": false
          }
        },
        "as_of": {
          "name": "as_of",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "formula": {
          "name": "formula",
          "type": "smallint",
          "primaryKey": false,
          "notNull": true
        },
        "candidates": {
          "name": "candidates",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "items": {
          "name": "items",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "took_ms": {
          "name": "took_ms",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "explore_runs_api_all": {
          "name": "explore_runs_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.follows": {
      "name": "follows",
      "schema": "",
      "columns": {
        "follower_id": {
          "name": "follower_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "followee_id": {
          "name": "followee_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "follows_to_created_idx": {
          "name": "follows_to_created_idx",
          "columns": [
            {
              "expression": "followee_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "follower_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "follows_from_created_idx": {
          "name": "follows_from_created_idx",
          "columns": [
            {
              "expression": "follower_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "followee_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "follows_follower_id_profiles_id_fk": {
          "name": "follows_follower_id_profiles_id_fk",
          "tableFrom": "follows",
          "tableTo": "profiles",
          "columnsFrom": [
            "follower_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "follows_followee_id_profiles_id_fk": {
          "name": "follows_followee_id_profiles_id_fk",
          "tableFrom": "follows",
          "tableTo": "profiles",
          "columnsFrom": [
            "followee_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "follows_follower_id_followee_id_pk": {
          "name": "follows_follower_id_followee_id_pk",
          "columns": [
            "follower_id",
            "followee_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "follows_api_all": {
          "name": "follows_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "follows_not_self": {
          "name": "follows_not_self",
          "value": "\"follows\".\"follower_id\" <> \"follows\".\"followee_id\""
        }
      },
      "isRLSEnabled": true
    },
    "public.likes": {
      "name": "likes",
      "schema": "",
      "columns": {
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "likes_post_idx": {
          "name": "likes_post_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "likes_user_created_idx": {
          "name": "likes_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "likes_created_brin": {
          "name": "likes_created_brin",
          "columns": [
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "brin",
          "with": {}
        }
      },
      "foreignKeys": {
        "likes_user_id_profiles_id_fk": {
          "name": "likes_user_id_profiles_id_fk",
          "tableFrom": "likes",
          "tableTo": "profiles",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "likes_post_id_posts_id_fk": {
          "name": "likes_post_id_posts_id_fk",
          "tableFrom": "likes",
          "tableTo": "posts",
          "columnsFrom": [
            "post_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "likes_user_id_post_id_pk": {
          "name": "likes_user_id_post_id_pk",
          "columns": [
            "user_id",
            "post_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "likes_api_all": {
          "name": "likes_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.mutes": {
      "name": "mutes",
      "schema": "",
      "columns": {
        "muter_id": {
          "name": "muter_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "muted_id": {
          "name": "muted_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "mutes_to_created_idx": {
          "name": "mutes_to_created_idx",
          "columns": [
            {
              "expression": "muted_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "muter_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "mutes_from_created_idx": {
          "name": "mutes_from_created_idx",
          "columns": [
            {
              "expression": "muter_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "muted_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "mutes_muter_id_profiles_id_fk": {
          "name": "mutes_muter_id_profiles_id_fk",
          "tableFrom": "mutes",
          "tableTo": "profiles",
          "columnsFrom": [
            "muter_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "mutes_muted_id_profiles_id_fk": {
          "name": "mutes_muted_id_profiles_id_fk",
          "tableFrom": "mutes",
          "tableTo": "profiles",
          "columnsFrom": [
            "muted_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "mutes_muter_id_muted_id_pk": {
          "name": "mutes_muter_id_muted_id_pk",
          "columns": [
            "muter_id",
            "muted_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "mutes_api_all": {
          "name": "mutes_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "mutes_not_self": {
          "name": "mutes_not_self",
          "value": "\"mutes\".\"muter_id\" <> \"mutes\".\"muted_id\""
        }
      },
      "isRLSEnabled": true
    },
    "public.post_media": {
      "name": "post_media",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "owner_id": {
          "name": "owner_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "status": {
          "name": "status",
          "type": "media_status",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'processing'"
        },
        "error": {
          "name": "error",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "position": {
          "name": "position",
          "type": "integer",
          "primaryKey": false,
          "notNull": false
        },
        "width": {
          "name": "width",
          "type": "integer",
          "primaryKey": false,
          "notNull": false
        },
        "height": {
          "name": "height",
          "type": "integer",
          "primaryKey": false,
          "notNull": false
        },
        "blurhash": {
          "name": "blurhash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "alt_text": {
          "name": "alt_text",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "nsfw_score": {
          "name": "nsfw_score",
          "type": "real",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "post_media_post_position_idx": {
          "name": "post_media_post_position_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "position",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "post_media_owner_created_idx": {
          "name": "post_media_owner_created_idx",
          "columns": [
            {
              "expression": "owner_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "post_media_status_created_idx": {
          "name": "post_media_status_created_idx",
          "columns": [
            {
              "expression": "status",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "post_media_owner_id_profiles_id_fk": {
          "name": "post_media_owner_id_profiles_id_fk",
          "tableFrom": "post_media",
          "tableTo": "profiles",
          "columnsFrom": [
            "owner_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "post_media_post_id_posts_id_fk": {
          "name": "post_media_post_id_posts_id_fk",
          "tableFrom": "post_media",
          "tableTo": "posts",
          "columnsFrom": [
            "post_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "post_media_api_all": {
          "name": "post_media_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "post_media_ready_has_dims": {
          "name": "post_media_ready_has_dims",
          "value": "\"post_media\".\"status\" <> 'ready' or (\"post_media\".\"width\" is not null and \"post_media\".\"height\" is not null and \"post_media\".\"blurhash\" is not null)"
        },
        "post_media_attached_is_complete": {
          "name": "post_media_attached_is_complete",
          "value": "\"post_media\".\"post_id\" is null or (\"post_media\".\"status\" = 'ready' and \"post_media\".\"position\" between 0 and 3 and \"post_media\".\"alt_text\" is not null)"
        },
        "post_media_alt_len": {
          "name": "post_media_alt_len",
          "value": "char_length(\"post_media\".\"alt_text\") <= 1000"
        }
      },
      "isRLSEnabled": true
    },
    "public.posts": {
      "name": "posts",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "author_id": {
          "name": "author_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "body": {
          "name": "body",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "reply_to_id": {
          "name": "reply_to_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "quote_of_id": {
          "name": "quote_of_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "state": {
          "name": "state",
          "type": "post_state",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'visible'"
        },
        "like_count": {
          "name": "like_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "repost_count": {
          "name": "repost_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "reply_count": {
          "name": "reply_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "quote_count": {
          "name": "quote_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "deleted_at": {
          "name": "deleted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "posts_author_created_idx": {
          "name": "posts_author_created_idx",
          "columns": [
            {
              "expression": "author_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "posts_created_id_idx": {
          "name": "posts_created_id_idx",
          "columns": [
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "posts_reply_to_created_idx": {
          "name": "posts_reply_to_created_idx",
          "columns": [
            {
              "expression": "reply_to_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "posts_latest_idx": {
          "name": "posts_latest_idx",
          "columns": [
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "where": "reply_to_id is null and state = 'visible'",
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "posts_quote_of_idx": {
          "name": "posts_quote_of_idx",
          "columns": [
            {
              "expression": "quote_of_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "posts_author_id_profiles_id_fk": {
          "name": "posts_author_id_profiles_id_fk",
          "tableFrom": "posts",
          "tableTo": "profiles",
          "columnsFrom": [
            "author_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "posts_reply_to_id_posts_id_fk": {
          "name": "posts_reply_to_id_posts_id_fk",
          "tableFrom": "posts",
          "tableTo": "posts",
          "columnsFrom": [
            "reply_to_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        },
        "posts_quote_of_id_posts_id_fk": {
          "name": "posts_quote_of_id_posts_id_fk",
          "tableFrom": "posts",
          "tableTo": "posts",
          "columnsFrom": [
            "quote_of_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "posts_api_all": {
          "name": "posts_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "posts_body_len": {
          "name": "posts_body_len",
          "value": "char_length(\"posts\".\"body\") <= 1000"
        },
        "posts_counts_nonnegative": {
          "name": "posts_counts_nonnegative",
          "value": "\"posts\".\"like_count\" >= 0 and \"posts\".\"repost_count\" >= 0 and \"posts\".\"reply_count\" >= 0 and \"posts\".\"quote_count\" >= 0"
        }
      },
      "isRLSEnabled": true
    },
    "public.reposts": {
      "name": "reposts",
      "schema": "",
      "columns": {
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "reposts_post_idx": {
          "name": "reposts_post_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "reposts_user_created_idx": {
          "name": "reposts_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "reposts_created_brin": {
          "name": "reposts_created_brin",
          "columns": [
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "brin",
          "with": {}
        }
      },
      "foreignKeys": {
        "reposts_user_id_profiles_id_fk": {
          "name": "reposts_user_id_profiles_id_fk",
          "tableFrom": "reposts",
          "tableTo": "profiles",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "reposts_post_id_posts_id_fk": {
          "name": "reposts_post_id_posts_id_fk",
          "tableFrom": "reposts",
          "tableTo": "posts",
          "columnsFrom": [
            "post_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "reposts_user_id_post_id_pk": {
          "name": "reposts_user_id_post_id_pk",
          "columns": [
            "user_id",
            "post_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "reposts_api_all": {
          "name": "reposts_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.appeals": {
      "name": "appeals",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "case_id": {
          "name": "case_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "statement": {
          "name": "statement",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "status": {
          "name": "status",
          "type": "appeal_status",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'open'"
        },
        "reviewer_id": {
          "name": "reviewer_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "decision_reason": {
          "name": "decision_reason",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "decided_at": {
          "name": "decided_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "appeals_case_idx": {
          "name": "appeals_case_idx",
          "columns": [
            {
              "expression": "case_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "appeals_case_id_cases_id_fk": {
          "name": "appeals_case_id_cases_id_fk",
          "tableFrom": "appeals",
          "tableTo": "cases",
          "columnsFrom": [
            "case_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "appeals_reviewer_id_profiles_id_fk": {
          "name": "appeals_reviewer_id_profiles_id_fk",
          "tableFrom": "appeals",
          "tableTo": "profiles",
          "columnsFrom": [
            "reviewer_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "appeals_api_all": {
          "name": "appeals_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.audit_head": {
      "name": "audit_head",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "smallint",
          "primaryKey": true,
          "notNull": true
        },
        "seq": {
          "name": "seq",
          "type": "bigint",
          "primaryKey": false,
          "notNull": true
        },
        "hash": {
          "name": "hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "audit_head_api_select": {
          "name": "audit_head_api_select",
          "as": "PERMISSIVE",
          "for": "SELECT",
          "to": [
            "korbat_api"
          ],
          "using": "true"
        }
      },
      "checkConstraints": {
        "audit_head_single_row": {
          "name": "audit_head_single_row",
          "value": "\"audit_head\".\"id\" = 1"
        }
      },
      "isRLSEnabled": true
    },
    "public.audit_log": {
      "name": "audit_log",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "bigserial",
          "primaryKey": true,
          "notNull": true
        },
        "actor_id": {
          "name": "actor_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "action": {
          "name": "action",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "target_type": {
          "name": "target_type",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "target_id": {
          "name": "target_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "metadata": {
          "name": "metadata",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::jsonb"
        },
        "request_id": {
          "name": "request_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "staff_session": {
          "name": "staff_session",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "key_id": {
          "name": "key_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "action_hash": {
          "name": "action_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "step_up": {
          "name": "step_up",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": false
        },
        "chain_version": {
          "name": "chain_version",
          "type": "smallint",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "chain_seq": {
          "name": "chain_seq",
          "type": "bigint",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "prev_hash": {
          "name": "prev_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "''"
        },
        "hash": {
          "name": "hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "''"
        }
      },
      "indexes": {
        "audit_log_chain_seq_idx": {
          "name": "audit_log_chain_seq_idx",
          "columns": [
            {
              "expression": "chain_seq",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "audit_log_api_insert": {
          "name": "audit_log_api_insert",
          "as": "PERMISSIVE",
          "for": "INSERT",
          "to": [
            "korbat_api"
          ],
          "withCheck": "true"
        },
        "audit_log_api_select": {
          "name": "audit_log_api_select",
          "as": "PERMISSIVE",
          "for": "SELECT",
          "to": [
            "korbat_api"
          ],
          "using": "true"
        }
      },
      "checkConstraints": {
        "audit_log_step_up_complete": {
          "name": "audit_log_step_up_complete",
          "value": "(\"audit_log\".\"action_hash\" is null) = (\"audit_log\".\"step_up\" is null) and (\"audit_log\".\"action_hash\" is null or \"audit_log\".\"key_id\" is not null)"
        }
      },
      "isRLSEnabled": true
    },
    "public.cases": {
      "name": "cases",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "target_type": {
          "name": "target_type",
          "type": "target_type",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "target_id": {
          "name": "target_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "rule_id": {
          "name": "rule_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "action": {
          "name": "action",
          "type": "case_action",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'none'"
        },
        "public_reason": {
          "name": "public_reason",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "''"
        },
        "moderator_id": {
          "name": "moderator_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "senior": {
          "name": "senior",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "brigading_flag": {
          "name": "brigading_flag",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "weight": {
          "name": "weight",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "closed_at": {
          "name": "closed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "cases_open_idx": {
          "name": "cases_open_idx",
          "columns": [
            {
              "expression": "closed_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "weight",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "cases_target_idx": {
          "name": "cases_target_idx",
          "columns": [
            {
              "expression": "target_type",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "target_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "cases_moderator_id_profiles_id_fk": {
          "name": "cases_moderator_id_profiles_id_fk",
          "tableFrom": "cases",
          "tableTo": "profiles",
          "columnsFrom": [
            "moderator_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "cases_api_all": {
          "name": "cases_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.reports": {
      "name": "reports",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "reporter_id": {
          "name": "reporter_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "target_type": {
          "name": "target_type",
          "type": "target_type",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "target_id": {
          "name": "target_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "rule_id": {
          "name": "rule_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "details": {
          "name": "details",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "''"
        },
        "weight": {
          "name": "weight",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 1
        },
        "status": {
          "name": "status",
          "type": "report_status",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'open'"
        },
        "case_id": {
          "name": "case_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "reports_reporter_target_idx": {
          "name": "reports_reporter_target_idx",
          "columns": [
            {
              "expression": "reporter_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "target_type",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "target_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "reports_target_idx": {
          "name": "reports_target_idx",
          "columns": [
            {
              "expression": "target_type",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "target_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "reports_reporter_id_profiles_id_fk": {
          "name": "reports_reporter_id_profiles_id_fk",
          "tableFrom": "reports",
          "tableTo": "profiles",
          "columnsFrom": [
            "reporter_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "reports_case_id_cases_id_fk": {
          "name": "reports_case_id_cases_id_fk",
          "tableFrom": "reports",
          "tableTo": "cases",
          "columnsFrom": [
            "case_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "reports_api_all": {
          "name": "reports_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.strikes": {
      "name": "strikes",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "case_id": {
          "name": "case_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "expires_at": {
          "name": "expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {
        "strikes_user_active_idx": {
          "name": "strikes_user_active_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "expires_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "strikes_user_id_profiles_id_fk": {
          "name": "strikes_user_id_profiles_id_fk",
          "tableFrom": "strikes",
          "tableTo": "profiles",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "strikes_case_id_cases_id_fk": {
          "name": "strikes_case_id_cases_id_fk",
          "tableFrom": "strikes",
          "tableTo": "cases",
          "columnsFrom": [
            "case_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "strikes_api_all": {
          "name": "strikes_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.transparency_log": {
      "name": "transparency_log",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "rule_id": {
          "name": "rule_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "action": {
          "name": "action",
          "type": "case_action",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "target_type": {
          "name": "target_type",
          "type": "target_type",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "decided_at": {
          "name": "decided_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "appealed": {
          "name": "appealed",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "appeal_outcome": {
          "name": "appeal_outcome",
          "type": "appeal_status",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "transparency_decided_idx": {
          "name": "transparency_decided_idx",
          "columns": [
            {
              "expression": "decided_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "transparency_api_all": {
          "name": "transparency_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    }
  },
  "enums": {
    "auth.auth_event_type": {
      "name": "auth_event_type",
      "schema": "auth",
      "values": [
        "signup",
        "signin_success",
        "signin_failure",
        "mfa_enabled",
        "mfa_disabled",
        "recovery_code_used",
        "recovery_codes_regenerated",
        "password_set",
        "password_changed",
        "session_revoked",
        "sessions_revoked_all",
        "account_locked",
        "new_device",
        "not_me",
        "profile_updated",
        "handle_changed",
        "email_changed",
        "badge_verified",
        "badge_removed",
        "export_created",
        "account_deleted",
        "passkey_added",
        "passkey_removed",
        "passkey_counter_regression",
        "staff_enrollment_issued",
        "staff_key_added",
        "staff_key_revoked",
        "staff_key_counter_regression",
        "staff_sign_in",
        "staff_signed_out",
        "staff_session_revoked"
      ]
    },
    "auth.email_code_purpose": {
      "name": "email_code_purpose",
      "schema": "auth",
      "values": [
        "signup",
        "login",
        "change_email",
        "recovery",
        "reauth",
        "delete_account"
      ]
    },
    "auth.user_role": {
      "name": "user_role",
      "schema": "auth",
      "values": [
        "user",
        "moderator",
        "admin"
      ]
    },
    "public.media_status": {
      "name": "media_status",
      "schema": "public",
      "values": [
        "processing",
        "ready",
        "failed"
      ]
    },
    "public.post_state": {
      "name": "post_state",
      "schema": "public",
      "values": [
        "visible",
        "withheld",
        "removed",
        "deleted_by_author"
      ]
    },
    "public.appeal_status": {
      "name": "appeal_status",
      "schema": "public",
      "values": [
        "open",
        "upheld",
        "denied"
      ]
    },
    "public.case_action": {
      "name": "case_action",
      "schema": "public",
      "values": [
        "none",
        "withhold",
        "remove",
        "strike",
        "suspend"
      ]
    },
    "public.report_status": {
      "name": "report_status",
      "schema": "public",
      "values": [
        "open",
        "merged",
        "closed"
      ]
    },
    "public.target_type": {
      "name": "target_type",
      "schema": "public",
      "values": [
        "post",
        "profile"
      ]
    }
  },
  "schemas": {
    "auth": "auth"
  },
  "sequences": {},
  "roles": {},
  "policies": {},
  "views": {},
  "_meta": {
    "columns": {},
    "schemas": {},
    "tables": {}
  }
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

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL_API: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_URL_AUTH: z.url({ protocol: /^postgres(ql)?$/ }),
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

### Replace `packages/contracts/src/index.ts` (whole file)

```ts
import { z } from "zod";

/** Every non-2xx response from the API has this shape. */
export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

export const CheckState = z.enum(["ok", "fail"]);

export const HealthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
  checks: z.record(z.string(), CheckState),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** Keyset pagination query params shared by every list endpoint. */
export const Pagination = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type Pagination = z.infer<typeof Pagination>;

export * from "./account";
export * from "./auth";
export * from "./explore";
export * from "./media";
export * from "./passkeys";
export * from "./social";
export * from "./staff";
export * from "./text";
```

### Replace `packages/db/migrations/meta/_journal.json` (whole file)

```json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    {
      "idx": 0,
      "version": "7",
      "when": 1789374373025,
      "tag": "0000_parallel_umar",
      "breakpoints": true
    },
    {
      "idx": 1,
      "version": "7",
      "when": 1789374374757,
      "tag": "0001_grants",
      "breakpoints": true
    },
    {
      "idx": 2,
      "version": "7",
      "when": 1789388768464,
      "tag": "0002_aspiring_prism",
      "breakpoints": true
    },
    {
      "idx": 3,
      "version": "7",
      "when": 1789388790249,
      "tag": "0003_auth_events_grants",
      "breakpoints": true
    },
    {
      "idx": 4,
      "version": "7",
      "when": 1789639555282,
      "tag": "0004_young_bloodscream",
      "breakpoints": true
    },
    {
      "idx": 5,
      "version": "7",
      "when": 1789976535081,
      "tag": "0005_huge_scarlet_spider",
      "breakpoints": true
    },
    {
      "idx": 6,
      "version": "7",
      "when": 1789976685374,
      "tag": "0006_nifty_blue_shield",
      "breakpoints": true
    },
    {
      "idx": 7,
      "version": "7",
      "when": 1790237989056,
      "tag": "0007_auth_purge_events",
      "breakpoints": true
    },
    {
      "idx": 8,
      "version": "7",
      "when": 1790238603639,
      "tag": "0008_careless_shadowcat",
      "breakpoints": true
    },
    {
      "idx": 9,
      "version": "7",
      "when": 1790241720737,
      "tag": "0009_clever_ezekiel",
      "breakpoints": true
    },
    {
      "idx": 10,
      "version": "7",
      "when": 1790332470171,
      "tag": "0010_free_thunderbolt",
      "breakpoints": true
    },
    {
      "idx": 11,
      "version": "7",
      "when": 1790586983460,
      "tag": "0011_magical_iceman",
      "breakpoints": true
    },
    {
      "idx": 12,
      "version": "7",
      "when": 1790769406818,
      "tag": "0012_aberrant_wendell_vaughn",
      "breakpoints": true
    }
  ]
}
```

### Replace `packages/db/src/schema/auth.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, check, foreignKey, index, integer, jsonb, pgPolicy, pgSchema, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authRole, bytea, emptyTextArray, fullAccess, ts } from "./helpers";

export const auth = pgSchema("auth");

export const emailCodePurpose = auth.enum("email_code_purpose", ["signup", "login", "change_email", "recovery", "reauth", "delete_account"]);

export const userRole = auth.enum("user_role", ["user", "moderator", "admin"]);

export const authEventType = auth.enum("auth_event_type", [
  "signup",
  "signin_success",
  "signin_failure",
  "mfa_enabled",
  "mfa_disabled",
  "recovery_code_used",
  "recovery_codes_regenerated",
  "password_set",
  "password_changed",
  "session_revoked",
  "sessions_revoked_all",
  "account_locked",
  "new_device",
  "not_me",
  "profile_updated",
  "handle_changed",
  "email_changed",
  "badge_verified",
  "badge_removed",
  "export_created",
  "account_deleted",
  "passkey_added",
  "passkey_removed",
  "passkey_counter_regression",
  // The staff console (3a design, section 6).
  "staff_enrollment_issued",
  "staff_key_added",
  "staff_key_revoked",
  "staff_key_counter_regression",
  "staff_sign_in",
  "staff_signed_out",
  "staff_session_revoked",
]);

export const users = auth.table(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    emailVerifiedAt: ts("email_verified_at"),
    /** Salted hash; the raw phone number is discarded after OTP verification. */
    phoneHash: text("phone_hash"),
    /** argon2id encoded string, null for passkey-only accounts. */
    passwordHash: text("password_hash"),
    /** Encrypted with the server-side key; never stored in clear. */
    totpSecretEnc: text("totp_secret_enc"),
    totpEnabledAt: ts("totp_enabled_at"),
    recoveryCodesHash: text("recovery_codes_hash").array().notNull().default(emptyTextArray),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: ts("locked_until"),
    createdAt: ts("created_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
    role: userRole("role").notNull().default("user"),
    /** When the 16+ check passed. Date of birth itself is never stored. */
    ageConfirmedAt: ts("age_confirmed_at"),
    termsVersion: text("terms_version"),
    termsAcceptedAt: ts("terms_accepted_at"),
    /** Set once the public profile (handle) exists. */
    onboardedAt: ts("onboarded_at"),
    passwordChangedAt: ts("password_changed_at"),
    /** Last accepted TOTP time step; a code for this step or earlier is rejected (replay protection). */
    totpLastStep: bigint("totp_last_step", { mode: "number" }),
    /**
     * When the purge after deletion finished anonymising this row. deleted_at means the owner confirmed
     * deletion and the account is gone for every purpose; purged_at null with deleted_at set means the purge
     * job still has work to do.
     */
    purgedAt: ts("purged_at"),
    /**
     * The WebAuthn user handle: 32 random bytes that every passkey of the account carries and a discoverable passkey
     * returns at sign-in. Never the account id, so a password manager's records say nothing about the account. Null
     * until the first passkey is added; the passkey flows set it once with a compare-and-set, and the account's
     * deletion clears it (1c design, sections 6 and 7.7).
     */
    webauthnUserId: bytea("webauthn_user_id"),
  },
  (t) => [
    uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`),
    /** One phone number per account, as a database fact; accounts without a number stay out of the index. */
    uniqueIndex("users_phone_hash_idx").on(t.phoneHash).where(sql`phone_hash is not null`),
    /** A user handle names one account; accounts without passkeys stay out of the index. */
    uniqueIndex("users_webauthn_user_id_idx").on(t.webauthnUserId).where(sql`webauthn_user_id is not null`),
    fullAccess("users_auth_all", authRole),
  ],
).enableRLS();

export const devices = auth.table(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    deviceHash: text("device_hash").notNull(),
    label: text("label"),
    /** 'web' | 'ios' | 'android' */
    platform: text("platform").notNull(),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    /** Salted hash; purged by the 30-day job. Raw IPs are never stored. */
    ipHash: text("ip_hash"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("devices_user_idx").on(t.userId), index("devices_ip_hash_idx").on(t.ipHash), fullAccess("devices_auth_all", authRole)],
).enableRLS();

export const sessions = auth.table(
  "sessions",
  {
    /** sha256 hex of the opaque token handed to the client. The token itself is never stored. */
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** Sliding expiry, extended on use. */
    expiresAt: ts("expires_at").notNull(),
    /** Hard cap, never extended. */
    absoluteExpiresAt: ts("absolute_expires_at").notNull(),
    lastUsedAt: ts("last_used_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
    /** Last time the user proved possession of a credential on this session: the latest of `factors`. */
    reauthAt: ts("reauth_at").notNull().defaultNow(),
    /**
     * A random id the session keeps for its whole life, while the token and with it `id` rotate. The re-authentication
     * limits and the passkey challenges are keyed by it, so a rotation cannot reset them and no other session can
     * spend them.
     */
    handle: uuid("handle").notNull().defaultRandom(),
    /**
     * The factors this session has proven and when: kind (email, password, totp, recovery, passkey, passkey_uv) to
     * epoch milliseconds. Sessions from before migration 0010 have none and re-authenticate before a sensitive action.
     */
    factors: jsonb("factors").$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
    /** The passkey that started this session, for the lockdown and the Security list; it outlives the passkey. */
    passkeyId: uuid("passkey_id").references(() => passkeys.id, { onDelete: "set null" }),
  },
  (t) => [index("sessions_user_idx").on(t.userId), uniqueIndex("sessions_handle_idx").on(t.handle), fullAccess("sessions_auth_all", authRole)],
).enableRLS();

export const emailCodes = auth.table(
  "email_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    purpose: emailCodePurpose("purpose").notNull(),
    expiresAt: ts("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: ts("consumed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** Random id returned to the client; a code can only complete the flow that requested it. */
    flowId: text("flow_id").notNull(),
    ipHash: text("ip_hash"),
  },
  (t) => [
    index("email_codes_email_idx").on(t.email),
    uniqueIndex("email_codes_flow_idx").on(t.flowId),
    fullAccess("email_codes_auth_all", authRole),
  ],
).enableRLS();

export const passkeys = auth.table(
  "passkeys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull(),
    /** base64url COSE public key */
    publicKey: text("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: text("transports").array().notNull().default(emptyTextArray),
    backedUp: boolean("backed_up").notNull().default(false),
    name: text("name").notNull(),
    /** Written from the flows' clock, like password_changed_at, because the lockdown compares it with flow times. */
    createdAt: ts("created_at").notNull().defaultNow(),
    lastUsedAt: ts("last_used_at"),
    /** The authenticator model the registration reported (all zeros for most synced passkeys); null when none was given. */
    aaguid: uuid("aaguid"),
    /** The BE flag at registration: the key may be synced to other devices. backed_up is the BS flag, which can change. */
    backupEligible: boolean("backup_eligible").notNull().default(false),
    /** The registration verified the user (UV flag); only then does a verified sign-in with it count as two factors. */
    uvInitialized: boolean("uv_initialized").notNull().default(false),
    /** The device whose session added it, for the Security list; it outlives the device. */
    createdDeviceId: uuid("created_device_id").references(() => devices.id, { onDelete: "set null" }),
    /** When a sign-in showed a signature counter that went backwards (a copy of the key may exist); refused from then on. */
    suspectAt: ts("suspect_at"),
  },
  (t) => [uniqueIndex("passkeys_credential_idx").on(t.credentialId), index("passkeys_user_idx").on(t.userId), fullAccess("passkeys_auth_all", authRole)],
).enableRLS();

/** Append-only security log. UPDATE, DELETE and TRUNCATE are also revoked at the grant level (migration 0003). */
export const authEvents = auth.table(
  "auth_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    type: authEventType("type").notNull(),
    deviceId: uuid("device_id"),
    ipHash: text("ip_hash"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("auth_events_user_created_idx").on(t.userId, t.createdAt),
    pgPolicy("auth_events_auth_insert", { for: "insert", to: authRole, withCheck: sql`true` }),
    pgPolicy("auth_events_auth_select", { for: "select", to: authRole, using: sql`true` }),
  ],
).enableRLS();

/**
 * Staff keys (3a design, section 6): WebAuthn credentials on the staff console's relying party, which alone open it. Only
 * keys whose registration reported user verification and no backup eligibility exist. They are added only by the
 * migrator-owned function auth.add_staff_key, which spends an enrolment the command line issued; migration 0012 leaves the
 * auth role SELECT and UPDATE of counter, last_used_at, revoked_at and suspect_at, and a trigger refuses to clear or change a
 * set revoked_at or suspect_at. A row is never deleted: audit-verify checks old confirmations against its public key,
 * owner, origin and relying party ID, so revocation and an account's take-down only set revoked_at.
 */
export const staffKeys = auth.table(
  "staff_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** On delete restrict: the development cleaner, which deletes accounts, must never take a key with them. */
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    credentialId: text("credential_id").notNull(),
    /** base64url COSE public key */
    publicKey: text("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: text("transports").array().notNull().default(emptyTextArray),
    /** What the key's holder called it at enrolment; blanked with the AAGUID and transports when the account is deleted. */
    name: text("name").notNull(),
    /** The authenticator model the registration reported; null when none was given, and after the account's deletion. */
    aaguid: uuid("aaguid"),
    /** The console's origin and relying party ID when the key was enrolled, copied from its enrolment. */
    origin: text("origin").notNull(),
    rpId: text("rp_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastUsedAt: ts("last_used_at"),
    /** Set once and never cleared: the key opens and confirms nothing more. A key is live while this is null. */
    revokedAt: ts("revoked_at"),
    /** Set together with revoked_at when a signature counter went backwards: a revoked key whose record says why. */
    suspectAt: ts("suspect_at"),
  },
  (t) => [
    uniqueIndex("staff_keys_credential_idx").on(t.credentialId),
    index("staff_keys_user_idx").on(t.userId),
    // The pair the staff sessions' foreign key names, so a session's key always belongs to its account.
    unique("staff_keys_id_user_id_unique").on(t.id, t.userId),
    check("staff_keys_suspect_is_revoked", sql`${t.suspectAt} is null or ${t.revokedAt} is not null`),
    fullAccess("staff_keys_auth_all", authRole),
  ],
).enableRLS();

/**
 * One-time enrolment links (3a design, section 6), issued only by `staff.js enroll` as the migrator and spent only by
 * auth.add_staff_key. Only the sha256 of the link's token is kept. The auth role may read them and delete them (cancelling an
 * open one, or the janitor removing a spent one), nothing else; a set used_at is never cleared.
 */
export const staffEnrollments = auth.table(
  "staff_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    /** CONSOLE_ORIGIN and the console's relying party ID when the link was issued; a link for a moved console enrols nothing. */
    origin: text("origin").notNull(),
    rpId: text("rp_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
  },
  (t) => [
    uniqueIndex("staff_enrollments_token_hash_idx").on(t.tokenHash),
    index("staff_enrollments_user_idx").on(t.userId),
    fullAccess("staff_enrollments_auth_all", authRole),
  ],
).enableRLS();

/**
 * Staff sessions (3a design, section 6), apart from the app's sessions: 12 hours absolute and 15 minutes idle, read from the
 * database on every request. The database keeps a row within 12 hours of its creation whoever writes it.
 */
export const staffSessions = auth.table(
  "staff_sessions",
  {
    /** sha256 hex of the opaque token in the staff cookie. The token itself is never stored. */
    id: text("id").primaryKey(),
    /** A random id for the session's whole life: the console lists and revokes sessions by it, and step-up binds to it. */
    handle: uuid("handle").notNull().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** The staff key that opened the session; its foreign key below also names the account. */
    keyId: uuid("key_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** The person's last action in the console, never a request the page sent by itself. */
    lastUsedAt: ts("last_used_at").notNull().defaultNow(),
    idleExpiresAt: ts("idle_expires_at").notNull(),
    absoluteExpiresAt: ts("absolute_expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    /** The coarse label deviceLabel gives ("Firefox on Linux"); never the user agent itself, never an address. */
    browser: text("browser").notNull(),
  },
  (t) => [
    uniqueIndex("staff_sessions_handle_idx").on(t.handle),
    index("staff_sessions_user_idx").on(t.userId),
    foreignKey({ name: "staff_sessions_key_user_fk", columns: [t.keyId, t.userId], foreignColumns: [staffKeys.id, staffKeys.userId] }).onDelete("cascade"),
    check(
      "staff_sessions_lifetime",
      sql`${t.absoluteExpiresAt} <= ${t.createdAt} + interval '12 hours' and ${t.idleExpiresAt} <= ${t.absoluteExpiresAt}`,
    ),
    fullAccess("staff_sessions_auth_all", authRole),
  ],
).enableRLS();
```

### Replace `packages/db/src/schema/safety.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, check, index, integer, jsonb, pgEnum, pgPolicy, pgTable, smallint, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { apiRole, fullAccess, ts } from "./helpers";
import { profiles } from "./identity";

export const targetType = pgEnum("target_type", ["post", "profile"]);
export const reportStatus = pgEnum("report_status", ["open", "merged", "closed"]);
export const caseAction = pgEnum("case_action", ["none", "withhold", "remove", "strike", "suspend"]);
export const appealStatus = pgEnum("appeal_status", ["open", "upheld", "denied"]);

export const cases = pgTable(
  "cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetType: targetType("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    ruleId: text("rule_id").notNull(),
    action: caseAction("action").notNull().default("none"),
    /** Shown verbatim to the author. Required for any action other than none. */
    publicReason: text("public_reason").notNull().default(""),
    moderatorId: uuid("moderator_id").references(() => profiles.id, { onDelete: "set null" }),
    senior: boolean("senior").notNull().default(false),
    brigadingFlag: boolean("brigading_flag").notNull().default(false),
    /** Sum of reporter weights, used for queue ordering. */
    weight: integer("weight").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    closedAt: ts("closed_at"),
  },
  (t) => [index("cases_open_idx").on(t.closedAt, t.weight, t.createdAt), index("cases_target_idx").on(t.targetType, t.targetId), fullAccess("cases_api_all", apiRole)],
).enableRLS();

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterId: uuid("reporter_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    targetType: targetType("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    ruleId: text("rule_id").notNull(),
    details: text("details").notNull().default(""),
    /** Derived from reporter reputation at report time. */
    weight: integer("weight").notNull().default(1),
    status: reportStatus("status").notNull().default("open"),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reports_reporter_target_idx").on(t.reporterId, t.targetType, t.targetId),
    index("reports_target_idx").on(t.targetType, t.targetId),
    fullAccess("reports_api_all", apiRole),
  ],
).enableRLS();

export const appeals = pgTable(
  "appeals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    statement: text("statement").notNull(),
    status: appealStatus("status").notNull().default("open"),
    /** Must differ from cases.moderator_id; enforced in the API and covered by an integration test. */
    reviewerId: uuid("reviewer_id").references(() => profiles.id, { onDelete: "set null" }),
    decisionReason: text("decision_reason"),
    createdAt: ts("created_at").notNull().defaultNow(),
    decidedAt: ts("decided_at"),
  },
  (t) => [uniqueIndex("appeals_case_idx").on(t.caseId), fullAccess("appeals_api_all", apiRole)],
).enableRLS();

export const strikes = pgTable(
  "strikes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("strikes_user_active_idx").on(t.userId, t.expiresAt), fullAccess("strikes_api_all", apiRole)],
).enableRLS();

/** Public, anonymised copy of every closed case. No user ids by design. */
export const transparencyLog = pgTable(
  "transparency_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: text("rule_id").notNull(),
    action: caseAction("action").notNull(),
    targetType: targetType("target_type").notNull(),
    decidedAt: ts("decided_at").notNull(),
    appealed: boolean("appealed").notNull().default(false),
    appealOutcome: appealStatus("appeal_outcome"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("transparency_decided_idx").on(t.decidedAt), fullAccess("transparency_api_all", apiRole)],
).enableRLS();

/**
 * Append-only, and since 3a a hash chain (3a design, section 6): the record of every staff action. UPDATE, DELETE and
 * TRUNCATE are revoked from the API role at the grant level (migration 0001). The trigger audit_chain, which migration 0012
 * installs and the migrator owns, sets id, created_at and the four chain columns of every inserted row, whatever the insert
 * supplied, under a lock on audit_head that lasts until the inserting transaction ends: an audit row is always the last
 * statement of its transaction.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: uuid("actor_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    requestId: text("request_id"),
    /** When the row joined the chain, in milliseconds: the trigger sets it. */
    createdAt: ts("created_at").notNull().defaultNow(),
    /** The handle of the staff session the action came from. */
    staffSession: uuid("staff_session"),
    /** The staff key: the one a step-up confirmed with, or the key a key's row is about. */
    keyId: uuid("key_id"),
    /** The lower-case hex sha256 of the confirmed action's sorted JSON, when a step-up confirmed it. */
    actionHash: text("action_hash"),
    /** The step-up assertion (authenticatorData, clientDataJSON, signature), base64url exactly as the browser sent them. */
    stepUp: jsonb("step_up").$type<{ authenticatorData: string; clientDataJSON: string; signature: string }>(),
    // The chain. The defaults are placeholders the trigger always overwrites: they keep drizzle's insert type from asking
    // for these columns and let migration 0012 add them over existing rows.
    /** The canonical text's version the row was hashed with. */
    chainVersion: smallint("chain_version").notNull().default(0),
    /** The row's place: the order in which inserts took the head's lock, from 1, with no gap. */
    chainSeq: bigint("chain_seq", { mode: "number" }).notNull().default(0),
    /** The hash of the row before it; 64 zeros for the first. */
    prevHash: text("prev_hash").notNull().default(""),
    /** sha256 hex of prev_hash followed by the row's canonical text. */
    hash: text("hash").notNull().default(""),
  },
  (t) => [
    // Serves the viewer and audit-verify. Migration 0012 creates it after the back-fill, which the placeholders would fail.
    uniqueIndex("audit_log_chain_seq_idx").on(t.chainSeq),
    // A step-up leaves its action's hash and its assertion together, with the key that made it.
    check("audit_log_step_up_complete", sql`(${t.actionHash} is null) = (${t.stepUp} is null) and (${t.actionHash} is null or ${t.keyId} is not null)`),
    pgPolicy("audit_log_api_insert", { for: "insert", to: apiRole, withCheck: sql`true` }),
    pgPolicy("audit_log_api_select", { for: "select", to: apiRole, using: sql`true` }),
  ],
).enableRLS();

/**
 * The newest row of the audit chain: its place and hash, or (1, 0, 64 zeros) for an empty log. One row, which only the
 * trigger moves. The API role may read it (audit-head and audit-verify check that it names the newest row) but neither write
 * nor lock it: migration 0012 revokes every other privilege, and SELECT ... FOR UPDATE needs UPDATE.
 */
export const auditHead = pgTable(
  "audit_head",
  {
    id: smallint("id").primaryKey(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [check("audit_head_single_row", sql`${t.id} = 1`), pgPolicy("audit_head_api_select", { for: "select", to: apiRole, using: sql`true` })],
).enableRLS();
```

### Replace `scripts/clean-dev-fixtures.mjs` (whole file)

```js
#!/usr/bin/env node
/**
 * Lists, and with --yes deletes, what tests left in the development database:
 *
 * - accounts whose email has the tests' shape, `<word>-<uuid>@korbat.local` (the integration, HTTP and
 *   smoke tests all make them), with their profiles;
 * - profiles without an account behind them, which the integration suites inserted directly while they
 *   still ran against this database.
 *
 * An account that holds a staff key is kept, whatever its email: staff keys are never deleted, because audit-verify
 * checks old confirmations against their public keys, and the database refuses to delete an account that has one.
 *
 * Deleting a profile removes its posts, image rows, follows, likes, reposts, bookmarks, blocks and mutes.
 * Where those rows counted towards a kept profile or post (a follow of a real account, a like of a real
 * post), that counter is recomputed from the rows, the way the app keeps it. The API's sweeper removes
 * the image files within about an hour, as it does for any image without a row.
 *
 * Refuses to run unless Docker's context is this machine and API_APP_ORIGIN in infra/.env is a localhost origin, so it never touches a
 * deployed database. Runs psql inside the postgres container as its superuser: no password is read or
 * printed here.
 *
 * Usage, from the repo root:
 *   node scripts/clean-dev-fixtures.mjs [--yes] [-- <docker compose command>]
 * Without a command it uses `docker compose -f infra/compose.yml -f infra/compose.dev.yml`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const options = separator === -1 ? argv : argv.slice(0, separator);
const compose = separator === -1 ? ["docker", "compose", "-f", "infra/compose.yml", "-f", "infra/compose.dev.yml"] : argv.slice(separator + 1);
const unknown = options.filter((option) => option !== "--yes");
if (compose.length === 0 || unknown.length > 0) {
  console.error("usage: node scripts/clean-dev-fixtures.mjs [--yes] [-- <docker compose command>]");
  process.exit(2);
}
const yes = options.includes("--yes");

/** The only emails tests create: a lowercase word or words, a UUID, and the korbat.local domain. */
const TEST_EMAIL = "^[a-z]+(-[a-z]+)*-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@korbat[.]local$";
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
/** How many of each kind are printed; the counts are always complete. */
const LISTED = 25;
const NL = String.fromCharCode(10);
/** psql meta-commands start with a backslash; spelled this way, the file holds none that could be lost in copying. */
const META = String.fromCharCode(92);

function stop(message) {
  console.error(message);
  process.exit(1);
}

/** Docker's current context must be this machine: a remote context would point these commands at another host. */
function requireLocalDocker() {
  const inspected = spawnSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8" });
  const host = inspected.status === 0 ? inspected.stdout.trim() : "";
  if (!/^(unix:|npipe:)/.test(host)) stop(`Docker's current context points at "${host || "an unknown endpoint"}", not this machine. This script only runs against a local stack.`);
}
requireLocalDocker();

const envFile = resolve(root, "infra/.env");
if (!existsSync(envFile)) stop("infra/.env is missing. Run `node scripts/gen-dev-env.mjs` first.");
const origin = parseEnv(readFileSync(envFile, "utf8")).API_APP_ORIGIN ?? "";
let host = "";
try {
  host = new URL(origin).hostname;
} catch {
  host = "";
}
if (!LOCAL_HOSTS.includes(host)) stop(`API_APP_ORIGIN in infra/.env is "${origin}", not a localhost origin. This script only cleans a development database.`);

// Runs inside the postgres container, where POSTGRES_USER and POSTGRES_DB are set. psql fills in
// :'pattern' itself, so the pattern is never pasted into SQL by hand. Everything happens in one
// transaction, which only commits with --yes.
const script = `set -eu
psql -v ON_ERROR_STOP=1 -q -tA --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v pattern="$PATTERN" -v delete="$DELETE" <<'SQL'
begin;
create temp table doomed on commit drop as
  select u.id, 'account' as kind, u.email || coalesce(' (@' || p.handle || ')', '') as label
    from auth.users u left join public.profiles p on p.id = u.id
    where u.email ~ :'pattern'
      and not exists (select 1 from auth.staff_keys k where k.user_id = u.id)
  union all
  select p.id, 'profile', '@' || p.handle
    from public.profiles p
    where not exists (select 1 from auth.users u where u.id = p.id);
create temp table touched_profiles on commit drop as
  select f.followee_id as id from public.follows f
    where f.follower_id in (select id from doomed) and f.followee_id not in (select id from doomed)
  union
  select f.follower_id from public.follows f
    where f.followee_id in (select id from doomed) and f.follower_id not in (select id from doomed);
create temp table touched_posts on commit drop as
  select distinct x.post_id as id
    from (
      select user_id as by_id, post_id from public.likes
      union all select user_id, post_id from public.reposts
      union all select author_id, reply_to_id from public.posts where reply_to_id is not null
      union all select author_id, quote_of_id from public.posts where quote_of_id is not null
    ) x
    join public.posts p on p.id = x.post_id
    where x.by_id in (select id from doomed) and p.author_id not in (select id from doomed);
select 'database|' || current_database();
select 'accounts|' || count(*) from doomed where kind = 'account';
select 'staff_kept|' || count(*) from auth.users u
  where u.email ~ :'pattern' and exists (select 1 from auth.staff_keys k where k.user_id = u.id);
select 'profiles|' || count(*) from doomed where kind = 'profile';
select 'posts|' || count(*) from public.posts where author_id in (select id from doomed);
select 'images|' || count(*) from public.post_media where owner_id in (select id from doomed);
select 'touched_profiles|' || count(*) from touched_profiles;
select 'touched_posts|' || count(*) from touched_posts;
select kind || '-item|' || label from doomed order by kind, label;
${META}if :delete
delete from public.profiles where id in (select id from doomed);
delete from auth.users where id in (select id from doomed);
update public.profiles p set
    follower_count = (select count(*) from public.follows f where f.followee_id = p.id),
    following_count = (select count(*) from public.follows f where f.follower_id = p.id)
  where p.id in (select id from touched_profiles);
update public.posts p set
    like_count = (select count(*) from public.likes l where l.post_id = p.id),
    repost_count = (select count(*) from public.reposts r where r.post_id = p.id),
    reply_count = (select count(*) from public.posts c where c.reply_to_id = p.id and c.state <> 'deleted_by_author'),
    quote_count = (select count(*) from public.posts c where c.quote_of_id = p.id and c.state <> 'deleted_by_author')
  where p.id in (select id from touched_posts);
commit;
select 'deleted|yes';
${META}else
rollback;
${META}endif
SQL
`;

const run = spawnSync(compose[0], [...compose.slice(1), "exec", "-T", "-e", `PATTERN=${TEST_EMAIL}`, "-e", `DELETE=${yes ? "on" : "off"}`, "postgres", "sh", "-s"], {
  cwd: root,
  input: script,
  encoding: "utf8",
});
if (run.error) stop(`Could not run ${compose[0]}: ${run.error.message}`);
if (run.status !== 0) stop(`The database could not be read. Is the postgres service up?${NL}${run.stderr}`);

const report = new Map();
const listed = { account: [], profile: [] };
for (const line of run.stdout.split(NL).map((text) => text.trim())) {
  const bar = line.indexOf("|");
  if (bar === -1) continue;
  const key = line.slice(0, bar);
  if (key === "account-item") listed.account.push(line.slice(bar + 1));
  else if (key === "profile-item") listed.profile.push(line.slice(bar + 1));
  else report.set(key, line.slice(bar + 1));
}
const count = (key) => Number(report.get(key) ?? 0);

function show(title, key, labels) {
  console.log(`${title}: ${count(key)}`);
  for (const label of labels.slice(0, LISTED)) console.log(`  ${label}`);
  if (labels.length > LISTED) console.log(`  ... and ${labels.length - LISTED} more`);
}

console.log(`database ${report.get("database")}`);
show("accounts with a test email", "accounts", listed.account);
if (count("staff_kept") > 0) console.log(`accounts with a test email kept because they hold a staff key: ${count("staff_kept")}`);
show("profiles without an account", "profiles", listed.profile);
if (count("accounts") + count("profiles") === 0) {
  console.log("Nothing to clean.");
  process.exit(0);
}
console.log(`their posts: ${count("posts")}, image rows: ${count("images")}`);
console.log(`kept profiles and posts whose counters include them: ${count("touched_profiles")} and ${count("touched_posts")}`);
if (report.get("deleted") === "yes") {
  console.log(`Deleted ${count("accounts")} accounts and ${count("profiles")} profiles with everything they made; recomputed the counters of ${count("touched_profiles")} profiles and ${count("touched_posts")} posts.`);
  console.log("Their image files leave the store when the API's sweeper next finds them without a row, within about an hour.");
} else {
  console.log("Nothing was deleted. Run again with --yes to delete these.");
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
packages/contracts test:       Tests  131 passed (131)
packages/db test:       Tests  40 passed (40)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  107 passed (107)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  459 passed | 319 skipped (778)
```

## Step 6: verify: generate

```bash
pnpm --filter @korbat/db generate
```

Expected output contains:

- `No schema changes`

Observed on the dry run:

```text
No schema changes, nothing to migrate 😴
```

## Step 7: verify: apply-migrations

```bash
(cd apps/api && set -a && . ./.env && set +a && node --import tsx src/migrate.ts | sed -E 's#from .*#from packages/db/migrations#') && echo count=$(docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U postgres -d korbat -tAc 'select count(*) from drizzle.__drizzle_migrations')
```

Expected output contains:

- `migrations applied`
- `count=13`

Observed on the dry run:

```text
migrations applied from packages/db/migrations
count=13
```

## Step 8: verify: chain

```bash
echo chain=$(docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U postgres -d korbat -tAc "select coalesce(min(chain_seq), 1) = 1 and count(*) = coalesce(max(chain_seq), 0) and not exists (select 1 from (select prev_hash, lag(hash) over (order by chain_seq) as p from public.audit_log) x where x.prev_hash <> coalesce(x.p, repeat('0', 64))) and not exists (select 1 from public.audit_log a where a.hash <> encode(sha256(convert_to(a.prev_hash || public.audit_chain_text(a), 'UTF8')), 'hex')) and (select hash from public.audit_head) = coalesce((select hash from public.audit_log order by chain_seq desc limit 1), repeat('0', 64)) from public.audit_log")
```

Expected output contains:

- `chain=t`

Observed on the dry run:

```text
chain=t
```

## Step 9: verify: test-database

```bash
node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `migrations applied`
- `test database ready: korbat_test`

Observed on the dry run:

```text
migrations applied
test database ready: korbat_test
```

## Step 10: verify: integration

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
Tests  317 passed (317)
```

## Step 11: verify: api-bundle

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

## Step 12: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/config.ts`
- `apps/api/test/config.test.ts`
- `apps/api/test/integration/audit-chain-schema.test.ts`
- `apps/api/test/integration/global-setup.ts`
- `apps/api/test/integration/staff-fixtures.ts`
- `apps/api/test/integration/staff-schema.test.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/staff.ts`
- `packages/contracts/test/staff.test.ts`
- `packages/db/migrations/0012_aberrant_wendell_vaughn.sql`
- `packages/db/migrations/meta/0012_snapshot.json`
- `packages/db/migrations/meta/_journal.json`
- `packages/db/src/schema/auth.ts`
- `packages/db/src/schema/safety.ts`
- `packages/db/test/schema.test.ts`
- `scripts/clean-dev-fixtures.mjs`

## Step 13: commit

```bash
git add -A
git commit -q -m "feat(contracts,db,api): the ground for the staff console: CONSOLE_ORIGIN and CONSOLE_RP_ID with their rules; the staff contracts and error codes; migration 0012 adds auth.staff_keys, staff_enrollments and staff_sessions, which korbat_auth can revoke but never create or revive, and seven staff event types, and turns the audit log into a hash chain: a migrator-owned trigger places every row under the head's lock, choosing its place, id and time itself, over the canonical text version 1, and the rows written before are chained in id order; auth.add_staff_key, auth.append_audit and auth.forget_staff_keys are the only ways the auth role writes them; the test harness writes the head row and the development cleaner keeps accounts that hold staff keys" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(contracts,db,api): the ground for the staff console: CONSOLE_ORIGIN and CONSOLE_RP_ID with their rules; the staff contracts and error codes; migration 0012 adds auth.staff_keys, staff_enrollments and staff_sessions, which korbat_auth can revoke but never create or revive, and seven staff event types, and turns the audit log into a hash chain: a migrator-owned trigger places every row under the head's lock, choosing its place, id and time itself, over the canonical text version 1, and the rows written before are chained in id order; auth.add_staff_key, auth.append_audit and auth.forget_staff_keys are the only ways the auth role writes them; the test harness writes the head row and the development cleaner keeps accounts that hold staff keys`.

## Report format (mandatory)

```text
TASK 1 REPORT
Files written: <count, expected 16>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "generate": <paste the expected lines as printed>
Verify "apply-migrations": <paste the expected lines as printed>
Verify "chain": <paste the expected lines as printed>
Verify "test-database": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```

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

import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { stepUpActionHash } from "@korbat/contracts";
import { auditHead, auditLog, closeDb, createDb, staffKeys, users, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { AUDIT_VERIFY_PAGE_SIZE, auditVerify, checkAuditRecord, runStaffCommand, type AuditReport } from "../../src/cli/staff";
import { loadConfig } from "../../src/config";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { CHAIN_VECTORS } from "../staff/chain-vectors";
import { flowHarness } from "./flow-harness";
import { enrolKey } from "./staff-enrolment";
import { TEST_CONSOLE, TEST_CONSOLE_ORIGIN, issueEnrolment, newStaffAccount, newStaffKey, rolledBack, withLockTimeout } from "./staff-fixtures";
import { revokeConfirmed, signedIn } from "./staff-step-up";

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

  /**
   * What the owner can do: chain every row from place `from` again with the database's own text function, as migration
   * 0012's back-fill does, and move the head, so a plain recompute of the chain passes over the changed rows.
   */
  const rechainFrom = (tx: DbTx, from: number) =>
    tx.execute(
      sql.raw(`DO $$
        DECLARE r public.audit_log; prev text;
        BEGIN
          SELECT hash INTO prev FROM public.audit_log WHERE chain_seq = ${from - 1};
          FOR r IN SELECT * FROM public.audit_log WHERE chain_seq >= ${from} ORDER BY chain_seq LOOP
            prev := encode(sha256(convert_to(prev || public.audit_chain_text(r), 'UTF8')), 'hex');
            UPDATE public.audit_log SET prev_hash = (SELECT hash FROM public.audit_log WHERE chain_seq = r.chain_seq - 1), hash = prev WHERE id = r.id;
          END LOOP;
          UPDATE public.audit_head SET hash = prev WHERE id = 1;
        END $$`),
    );

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
          // Every hash recomputes. Two rows are refused for what they are: the step-up vector, whose assertion no stored
          // key made, and which is the last vector; and the vector that records a decision on a case with no step-up at
          // all, an action that only a staff key's confirmation may leave in the record.
          const report = await checkAuditRecord(tx, [], authDb);
          expect(CHAIN_VECTORS.at(-1)!.insert.stepUp).not.toBeNull();
          expect(CHAIN_VECTORS.filter((vector) => vector.insert.stepUp !== null)).toHaveLength(1);
          const unconfirmed = CHAIN_VECTORS.findIndex((vector) => vector.insert.action === "case_decided" && vector.insert.stepUp === null);
          expect(unconfirmed).toBeGreaterThanOrEqual(0);
          expect(report.problems).toEqual([
            { place: before.seq + unconfirmed + 1, message: "its action, case_decided, needs a step-up, and it carries none" },
            { place: before.seq + CHAIN_VECTORS.length, message: expect.stringMatching(/^its step-up/) },
          ]);
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
        await rechainFrom(tx, target);
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

  describe("rewrites by the owner that each check of the chain catches", () => {
    /** Three new rows, as a writer inserts them, in the transaction `tx`; the newest is the head. */
    const threeRows = async (tx: DbTx) => {
      const first = (await insertRow(tx, "probe-a"))[0]!;
      const middle = (await insertRow(tx, "probe-b"))[0]!;
      const last = (await insertRow(tx, "probe-c"))[0]!;
      return [first, middle, last] as const;
    };

    test("a row changed with only its own hash recomputed breaks its link to the next row, which a later kept place does not see", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const [, middle, last] = await threeRows(tx);
        await tx.update(auditLog).set({ metadata: { via: "edited" } }).where(eq(auditLog.id, middle.id));
        // The owner recomputes the changed row's own hash over its stored prev_hash, with the database's own text.
        await tx.execute(sql`update public.audit_log a set hash = encode(sha256(convert_to(a.prev_hash || public.audit_chain_text(a), 'UTF8')), 'hex') where a.id = ${middle.id}`);
        const link = { place: last.chainSeq, message: `its prev_hash is not the hash of place ${middle.chainSeq}` };
        expect((await checkAuditRecord(tx, [])).problems).toEqual([link]);
        // The place kept after it still holds its hash: only the link check catches the change.
        expect((await checkAuditRecord(tx, [{ seq: last.chainSeq, hash: last.hash }])).problems).toEqual([link]);
      });
    });

    test("a row deleted from the middle leaves its place missing and the next row's link broken", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const [first, middle, last] = await threeRows(tx);
        await tx.delete(auditLog).where(eq(auditLog.id, middle.id));
        expect((await checkAuditRecord(tx, [])).problems).toEqual([
          { place: middle.chainSeq, message: `place ${middle.chainSeq} is missing` },
          { place: last.chainSeq, message: `its prev_hash is not the hash of place ${first.chainSeq}` },
        ]);
      });
    });

    test("the newest rows deleted and the head moved back pass a plain run, and fail against a place kept before", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const [first, , last] = await threeRows(tx);
        const kept = { seq: last.chainSeq, hash: last.hash };
        await tx.delete(auditLog).where(gt(auditLog.chainSeq, first.chainSeq));
        await tx.update(auditHead).set({ seq: first.chainSeq, hash: first.hash }).where(eq(auditHead.id, 1));
        expect((await checkAuditRecord(tx, [])).problems).toEqual([]);
        expect((await checkAuditRecord(tx, [kept])).problems).toEqual([{ place: kept.seq, message: `the kept place ${kept.seq}:${kept.hash} no longer matches: no row is at that place` }]);
      });
    });

    test("the head: missing, behind the newest row, beyond it, or with another hash", async () => {
      await rolledBack(migrateDb, async (tx) => {
        await threeRows(tx);
        await tx.delete(auditHead);
        expect((await checkAuditRecord(tx, [])).problems).toEqual([{ place: null, message: "the audit head is missing" }]);
      });
      await rolledBack(migrateDb, async (tx) => {
        const [first, middle] = await threeRows(tx);
        await tx.update(auditHead).set({ seq: first.chainSeq, hash: first.hash }).where(eq(auditHead.id, 1));
        expect((await checkAuditRecord(tx, [])).problems).toEqual([{ place: middle.chainSeq, message: `rows lie beyond the head's place ${first.chainSeq}, from place ${middle.chainSeq}` }]);
      });
      await rolledBack(migrateDb, async (tx) => {
        const [, , last] = await threeRows(tx);
        await tx.update(auditHead).set({ seq: last.chainSeq + 5 }).where(eq(auditHead.id, 1));
        expect((await checkAuditRecord(tx, [])).problems).toEqual([{ place: null, message: `the head names place ${last.chainSeq + 5}, but the newest row up to it is at place ${last.chainSeq}` }]);
      });
      await rolledBack(migrateDb, async (tx) => {
        const [, , last] = await threeRows(tx);
        await tx.update(auditHead).set({ hash: "e".repeat(64) }).where(eq(auditHead.id, 1));
        expect((await checkAuditRecord(tx, [])).problems).toEqual([{ place: last.chainSeq, message: "the head's hash is not the hash of the row at its place" }]);
      });
    });

    test("a row moved to place 0, or beyond the head, is named", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const [, middle] = await threeRows(tx);
        await tx.update(auditLog).set({ chainSeq: 0 }).where(eq(auditLog.id, middle.id));
        const report = await checkAuditRecord(tx, []);
        expect(report.problems).toContainEqual({ place: 0, message: "its place is not in the chain, which runs from place 1" });
        expect(report.problems).toContainEqual({ place: middle.chainSeq, message: `place ${middle.chainSeq} is missing` });
      });
      await rolledBack(migrateDb, async (tx) => {
        const [, middle, last] = await threeRows(tx);
        await tx.update(auditLog).set({ chainSeq: last.chainSeq + 10 }).where(eq(auditLog.id, middle.id));
        const report = await checkAuditRecord(tx, []);
        expect(report.problems).toContainEqual({ place: last.chainSeq + 10, message: `rows lie beyond the head's place ${last.chainSeq}, from place ${last.chainSeq + 10}` });
        expect(report.problems).toContainEqual({ place: middle.chainSeq, message: `place ${middle.chainSeq} is missing` });
      });
    });

    /**
     * What the owner can do to plant a row the walk by place never reaches: turn the trigger off and drop the unique index
     * on chain_seq (or its NOT NULL), then insert. The planted row is a step-up action's with no confirmation, which a walk
     * that read it would refuse; it repeats the genuine row's prev_hash and hash, so no other row or the head changes.
     */
    const plant = (tx: DbTx, place: number | null, copy: { prevHash: string; hash: string }) =>
      tx.execute(sql`insert into public.audit_log (actor_id, action, target_type, target_id, metadata, chain_version, chain_seq, prev_hash, hash)
        values (${actorId}::uuid, 'staff_session_revoked', 'staff_session', ${randomUUID()}, '{"params": {}}'::jsonb, 1, ${place}::bigint, ${copy.prevHash}, ${copy.hash})`);

    test("a second row at a place that ends a page of the walk is read and refused", { timeout: 60_000 }, async () => {
      await rolledBack(migrateDb, async (tx) => {
        // Enough rows that a page of the walk ends at a place, with rows after it.
        const page = AUDIT_VERIFY_PAGE_SIZE;
        const short = page + 5 - (await readHead(tx)).seq;
        if (short > 0) {
          await tx.execute(sql`insert into public.audit_log (actor_id, action, target_type, target_id, metadata)
            select ${actorId}::uuid, 'probe-page', 'user', gen_random_uuid()::text, '{"via": "test"}'::jsonb from generate_series(1, ${short})`);
        }
        const [genuine] = await tx.select().from(auditLog).where(eq(auditLog.chainSeq, page));
        await tx.execute(sql`alter table public.audit_log disable trigger audit_chain`);
        await tx.execute(sql`drop index public.audit_log_chain_seq_idx`);
        // A plain index in its place, as the owner might leave it: equal places come back oldest row first, so a walk by
        // place alone reads the genuine row and never the second.
        await tx.execute(sql`create index audit_log_chain_seq_plain on public.audit_log (chain_seq)`);
        await plant(tx, page, genuine!);
        const report = await checkAuditRecord(tx, []);
        expect(report.ok).toBe(false);
        expect(report.problems).toContainEqual({ place: page, message: "another row is already at this place" });
        expect(report.problems).toContainEqual({ place: page, message: "its action, staff_session_revoked, needs a step-up, and it carries none" });
        expect(report.problems).toContainEqual({ place: null, message: "1 row is at a place another row already holds" });
      });
    });

    test("3f: a correction of an order's record under the rule entry or caution carries no step-up and is accepted; one under admin needs it", { timeout: 30_000 }, async () => {
      await rolledBack(migrateDb, async (tx) => {
        const before = (await readHead(tx)).seq;
        for (const rule of ["entry", "caution", "admin"]) {
          await tx.execute(sql`insert into public.audit_log (actor_id, action, target_type, target_id, metadata)
            values (${actorId}::uuid, 'order_corrected', 'order', ${randomUUID()}, ${JSON.stringify({ rule, changed: [] })}::jsonb)`);
        }
        const report = await checkAuditRecord(tx, []);
        expect(report.problems.filter((problem) => problem.place !== null && problem.place > before)).toEqual([
          { place: before + 3, message: "its action, order_corrected, needs a step-up, and it carries none" },
        ]);
      });
    });

    test("a row with no place at all is counted and refused", { timeout: 30_000 }, async () => {
      await rolledBack(migrateDb, async (tx) => {
        const head = await readHead(tx);
        const [newest] = await tx.select().from(auditLog).where(eq(auditLog.chainSeq, head.seq));
        await tx.execute(sql`alter table public.audit_log disable trigger audit_chain`);
        await tx.execute(sql`alter table public.audit_log alter column chain_seq drop not null`);
        await plant(tx, null, newest!);
        const total = (await tx.select({ n: sql<string>`count(*)::text` }).from(auditLog))[0]!.n;
        const report = await checkAuditRecord(tx, []);
        expect(report.ok).toBe(false);
        expect(report.problems).toEqual([
          { place: null, message: "1 row of the audit log has no place in the chain" },
          { place: null, message: `the audit log holds ${total} rows, but ${head.seq} were read up to the head and 0 lie beyond it` },
        ]);
      });
    });
  });

  describe("step-up confirmations", () => {
    const harness = () => flowHarness(repo, { console: TEST_CONSOLE });

    /**
     * A staff account with a key enrolled through the flow and three sessions; from the first it revokes the other two,
     * each confirmed with the key through the step-up flow: two genuine step-up rows, committed, as only the flow writes them.
     */
    async function confirmedRevocations() {
      const h = harness();
      const { user } = await newStaffAccount(authDb, repo);
      const soft = new SoftAuthenticator();
      const enrolled = await enrolKey(h, soft, (await issueEnrolment(migrateDb, user.id)).token);
      const [a, b, c] = [await signedIn(h, soft, enrolled.credentialId, 1), await signedIn(h, soft, enrolled.credentialId, 2), await signedIn(h, soft, enrolled.credentialId, 3)];
      expect((await revokeConfirmed(h, soft, enrolled.credentialId, a.session, b.session.handle, 4)).revoked).toBe(true);
      expect((await revokeConfirmed(h, soft, enrolled.credentialId, a.session, c.session.handle, 5)).revoked).toBe(true);
      const rowOf = async (handle: string) => (await apiDb.select().from(auditLog).where(and(eq(auditLog.action, "staff_session_revoked"), eq(auditLog.targetId, handle))))[0]!;
      return { user, keyId: enrolled.key.id, a: a.session, b: b.session, c: c.session, first: await rowOf(b.session.handle), second: await rowOf(c.session.handle) };
    }

    /** The problems a check found, as place and message, each expected to name the step-up check. */
    const stepUpProblems = (report: AuditReport) => report.problems.map((p) => ({ place: p.place, stepUp: /step-up/.test(p.message) }));

    test("genuine confirmations pass: on the command line's own connections, with the console off, and with nothing but the database URLs", { timeout: 60_000 }, async () => {
      const s = await confirmedRevocations();
      expect(s.first).toMatchObject({ staffSession: s.a.handle, keyId: s.keyId, actorId: s.user.id });
      expect(s.first.stepUp).not.toBeNull();
      const connections = ownConnections();
      try {
        const report = await auditVerify(connections, []);
        expect(report.problems).toEqual([]);
        expect(report.ok).toBe(true);
      } finally {
        await Promise.all([closeDb(connections.api), closeDb(connections.auth)]);
      }
      const off = await cli(["audit-verify"], { CONSOLE_ORIGIN: "", CONSOLE_RP_ID: "" });
      expect(off.code, off.text).toBe(0);
      const bare = await cli(["audit-verify"], { DATABASE_URL_API: process.env.DATABASE_URL_API!, DATABASE_URL_AUTH: process.env.DATABASE_URL_AUTH! }, false);
      expect(bare.code, bare.text).toBe(0);
    });

    test("a confirmed row changed by the owner with the chain and the head recomputed fails on its step-up alone: its params, its target, its session, its hash with its params, or its time past the challenge's expiry", { timeout: 60_000 }, async () => {
      const s = await confirmedRevocations();
      const otherParams = { params: { all: true } };
      const changes: [string, Record<string, unknown>, RegExp][] = [
        ["its params", { metadata: otherParams }, /^its step-up's action hash is not the hash of its action, target and params$/],
        ["its target", { targetId: s.c.handle }, /^its step-up's action hash is not the hash of its action, target and params$/],
        ["its session", { staffSession: s.b.handle }, /^its step-up's challenge was not issued for this action in this session$/],
        [
          "its params and its action hash together",
          { metadata: otherParams, actionHash: await stepUpActionHash({ action: "staff_session_revoked", target: { type: "staff_session", id: s.b.handle }, params: otherParams.params }) },
          /^its step-up's challenge was not issued for this action in this session$/,
        ],
        ["its time, past the challenge's expiry", { createdAt: new Date(s.first.createdAt.getTime() + 11 * 60_000) }, /^its step-up's challenge had expired when the row was written$/],
      ];
      for (const [label, change, message] of changes) {
        await rolledBack(migrateDb, async (tx) => {
          await tx.update(auditLog).set(change).where(eq(auditLog.id, s.first.id));
          await rechainFrom(tx, s.first.chainSeq);
          const report = await checkAuditRecord(tx, []);
          expect(report.problems, label).toEqual([{ place: s.first.chainSeq, message: expect.stringMatching(message) }]);
        });
      }
      // Nothing of it outlives the rollbacks.
      const connections = ownConnections();
      try {
        expect((await auditVerify(connections, [])).problems).toEqual([]);
      } finally {
        await Promise.all([closeDb(connections.api), closeDb(connections.auth)]);
      }
    });

    test("an assertion moved to another row fails there, on its binding and as a challenge used twice", { timeout: 60_000 }, async () => {
      const s = await confirmedRevocations();
      await rolledBack(migrateDb, async (tx) => {
        // The first row's assertion, signed by the same key in the same session, on the second row: only the binding of
        // its target, and the challenge's second use, give it away.
        await tx.update(auditLog).set({ stepUp: s.first.stepUp }).where(eq(auditLog.id, s.second.id));
        await rechainFrom(tx, s.second.chainSeq);
        const report = await checkAuditRecord(tx, []);
        expect(report.problems).toEqual([
          { place: s.second.chainSeq, message: "its step-up's challenge was not issued for this action in this session" },
          { place: s.second.chainSeq, message: `its step-up's challenge was already used at place ${s.first.chainSeq}` },
        ]);
      });
    });

    test("a row of a step-up action without a confirmation fails, whatever its actor: a staff account, a demoted one, the system", { timeout: 60_000 }, async () => {
      const s = await confirmedRevocations();
      const { user: demoted } = await newStaffAccount(authDb, repo);
      await authDb.update(users).set({ role: "user" }).where(eq(users.id, demoted.id));
      await rolledBack(migrateDb, async (tx) => {
        const places: number[] = [];
        for (const actor of [s.user.id, demoted.id, actorId]) {
          const [row] = await tx
            .insert(auditLog)
            .values({ actorId: actor, action: "staff_session_revoked", targetType: "staff_session", targetId: randomUUID(), staffSession: randomUUID(), metadata: { params: {} } })
            .returning({ chainSeq: auditLog.chainSeq });
          places.push(row!.chainSeq);
        }
        const report = await checkAuditRecord(tx, []);
        expect(report.problems).toEqual(places.map((place) => ({ place, message: "its action, staff_session_revoked, needs a step-up, and it carries none" })));
      });
    });

    test("a confirmation whose key belongs to another account than the row's actor fails, as one whose key records another origin or relying party ID", { timeout: 60_000 }, async () => {
      const s = await confirmedRevocations();
      const { user: other } = await newStaffAccount(authDb, repo);
      await rolledBack(migrateDb, async (tx) => {
        await tx.update(auditLog).set({ actorId: other.id }).where(eq(auditLog.id, s.first.id));
        await rechainFrom(tx, s.first.chainSeq);
        const report = await checkAuditRecord(tx, []);
        expect(report.problems).toEqual([{ place: s.first.chainSeq, message: `its step-up's key ${s.keyId} belongs to another account than its actor` }]);
      });
      // The key's recorded origin and relying party ID, which the owner can change too: the confirmation was made for
      // the ones the key was enrolled with, never checked against the console's configuration.
      for (const [label, change, message] of [
        ["origin", { origin: "http://console.example:8090" }, "its step-up's client data is not a webauthn.get from the origin recorded on its key"],
        ["relying party ID", { rpId: "console.example" }, "its step-up's authenticator data does not name the relying party ID recorded on its key"],
      ] as const) {
        await rolledBack(migrateDb, async (tx) => {
          await tx.update(staffKeys).set(change).where(eq(staffKeys.id, s.keyId));
          const report = await checkAuditRecord(tx, []);
          expect(report.problems, label).toEqual([
            { place: s.first.chainSeq, message },
            { place: s.second.chainSeq, message },
          ]);
        });
      }
    });

    test("a signature that does not verify with the key's public key fails", { timeout: 60_000 }, async () => {
      const s = await confirmedRevocations();
      await rolledBack(migrateDb, async (tx) => {
        const stepUp = s.first.stepUp as { authenticatorData: string; clientDataJSON: string; signature: string };
        const signature = Buffer.from(stepUp.signature, "base64url");
        signature[signature.length - 1] = signature[signature.length - 1]! ^ 0xff;
        await tx.update(auditLog).set({ stepUp: { ...stepUp, signature: signature.toString("base64url") } }).where(eq(auditLog.id, s.first.id));
        await rechainFrom(tx, s.first.chainSeq);
        const report = await checkAuditRecord(tx, []);
        expect(report.problems).toEqual([{ place: s.first.chainSeq, message: `its step-up's signature does not verify with the public key of key ${s.keyId}` }]);
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

    test("a key enrolled after the head a run read, before it read the keys, is left to the next run, which checks it", { timeout: 30_000 }, async () => {
      const connections = ownConnections();
      try {
        // The keys are read on the auth role right after the head; a key enrolled between the two has its staff_key_added
        // row beyond the head this run read, so the run leaves it to the next instead of calling it a problem.
        let enrolled: string | undefined;
        const between = {
          select: (fields: Parameters<Db["select"]>[0]) => ({
            from: (table: typeof staffKeys) => ({
              then: (resolve: (rows: unknown) => unknown, reject: (err: unknown) => unknown) =>
                newStaffKey(authDb, migrateDb, repo)
                  .then((added) => {
                    enrolled = added.key.id;
                    return connections.auth.select(fields!).from(table);
                  })
                  .then(resolve, reject),
            }),
          }),
        } as unknown as Db;
        const report = await auditVerify({ api: connections.api, auth: between }, []);
        expect(enrolled).toBeDefined();
        expect(report).toMatchObject({ ok: true, keysLeftToNextRun: 1, problems: [] });
        // The next run reads a head beyond the key's row, and checks the key.
        const next = await auditVerify(connections, []);
        expect(next).toMatchObject({ ok: true, keysLeftToNextRun: 0, problems: [] });
        expect(next.keysChecked).toBe(report.keysChecked);
      } finally {
        await Promise.all([closeDb(connections.api), closeDb(connections.auth)]);
      }
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

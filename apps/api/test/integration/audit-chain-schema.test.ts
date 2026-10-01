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

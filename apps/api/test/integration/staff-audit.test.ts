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

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { imageModerationStates } from "../../src/media";
import { aPost, act, decideIn, imagePost, newImageRow, newTestStaff, report, rowCounts, staffProfile, type TestStaff } from "./moderation-fixtures";
import { ageCase } from "./retention-fixtures";
import { rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 60_000 });

/**
 * imageModerationStates (3c design, section 5): the one read of image rows that `staff.js text-verify` makes, through
 * the media module, since no file outside it may name the image table. It answers the rows that are on a post, in id
 * order after an id, a page at a time: each one's id, its post, its stored state and when its content was erased.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: imageModerationStates", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let mod: TestStaff;
  let before: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    mod = await newTestStaff(authDb, migrateDb, repo, "moderator");
    before = await rowCounts(apiDb);
  }, 60_000);
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  /** Every row the function answers, read a page of `size` at a time, as text-verify reads them. */
  async function all(tx: DbTx, size: number) {
    const found: Awaited<ReturnType<typeof imageModerationStates>> = [];
    for (let after: string | null = null; ; ) {
      const page = await imageModerationStates(tx as unknown as Db, after, size);
      expect(page.length).toBeLessThanOrEqual(size);
      found.push(...page);
      if (page.length < size) return found;
      after = page[page.length - 1]!.id;
    }
  }

  test("it answers every image that is on a post, once, in id order, whatever the page size, and never an upload on no post", async () => {
    await rolledBack(migrateDb, async (tx) => {
      const a = await imagePost(tx, 3);
      const b = await imagePost(tx, 2);
      const upload = await newImageRow(tx, a.authorId, null);
      const mine = new Set([...a.mediaIds, ...b.mediaIds, upload]);
      for (const size of [1, 2, 1000]) {
        const rows = (await all(tx, size)).filter((row) => mine.has(row.id));
        expect(rows.map((row) => row.id), `pages of ${size}`).toEqual([...a.mediaIds, ...b.mediaIds].sort());
        expect(rows.every((row) => row.moderationState === "visible" && row.erasedAt === null)).toBe(true);
        expect(new Map(rows.map((row) => [row.id, row.postId]))).toEqual(new Map([...a.mediaIds.map((id) => [id, a.postId] as const), ...b.mediaIds.map((id) => [id, b.postId] as const)]));
      }
      // The whole answer is in id order, the other suites' rows included.
      const ids = (await all(tx, 3)).map((row) => row.id);
      expect(ids).toEqual([...ids].sort());
      expect(new Set(ids).size).toBe(ids.length);
      // After the last id there is nothing, and a page of none is none.
      expect(await imageModerationStates(tx as unknown as Db, "ffffffff-ffff-ffff-ffff-ffffffffffff", 10)).toEqual([]);
    });
  });

  test("it answers the stored state and the erasure time as the database's own functions left them", async () => {
    await rolledBack(migrateDb, async (tx) => {
      await staffProfile(tx, mod);
      const p = await imagePost(tx, 3);
      const { caseId } = await report(tx, aPost(p.postId));
      const decision = await decideIn(tx, mod, caseId, { kind: "final", ruleId: "R4", actions: [act("remove_media", p.mediaIds[0]!)] });
      await ageCase(tx, caseId, "7 months");
      await tx.execute(sql`select public.redact_r4_body(${decision}::uuid)`);
      const again = await report(tx, aPost(p.postId));
      await decideIn(tx, mod, again.caseId, { kind: "interim", actions: [act("withhold_media", p.mediaIds[1]!)] });
      const rows = new Map((await all(tx, 1000)).filter((row) => p.mediaIds.includes(row.id)).map((row) => [row.id, row]));
      expect(rows.get(p.mediaIds[0]!)).toMatchObject({ postId: p.postId, moderationState: "removed", erasedAt: expect.any(Date) });
      expect(rows.get(p.mediaIds[1]!)).toMatchObject({ postId: p.postId, moderationState: "withheld", erasedAt: null });
      expect(rows.get(p.mediaIds[2]!)).toMatchObject({ postId: p.postId, moderationState: "visible", erasedAt: null });
      // Exactly these four members, and nothing of the image itself.
      expect(Object.keys(rows.get(p.mediaIds[0]!)!).sort()).toEqual(["erasedAt", "id", "moderationState", "postId"]);
    });
  });

  test("this file left no row behind", async () => {
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});

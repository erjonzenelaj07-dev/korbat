import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ACTIVITY_KEEP_DAYS } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createActivityRepo } from "../../src/activity/repo";
import { RETENTION_BATCH, RETENTION_JOB, createRetentionJob } from "../../src/activity/retention";
import { loadConfig } from "../../src/config";
import { MemoryJobLock } from "../../src/lib/jobs";
import { ACTIVITY_TABLES } from "./activity-harness";
import { newPostRow, removeFixtures, rowCounts } from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";

vi.setConfig({ testTimeout: 60_000 });

/**
 * The job activity-retention (2d design, sections 5.10 and 11.1; decision 11; section 12.3): entries written more than
 * ACTIVITY_KEEP_DAYS ago go, in batches by id until a batch comes back short; younger ones stay; the round runs under the
 * job's lock, and logs only how many went.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: activity-retention", () => {
  let apiDb: Db;
  let migrateDb: Db;
  let before: Record<string, number>;
  const made: string[] = [];
  let recipient: string;
  /** Entries of the recipient by age in days, as the migrator wrote them (it alone may date an entry). */
  const ids: Record<number, string[]> = {};

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    before = await rowCounts(apiDb, ACTIVITY_TABLES);
    const [r, actor] = [await newProfile(migrateDb), await newProfile(migrateDb)];
    made.push(r.id, actor.id);
    recipient = r.id;
    // Five entries 91 days old, two 89 days old and one of today, each a mention in a post of its own.
    for (const [days, n] of [
      [91, 5],
      [89, 2],
      [0, 1],
    ] as const) {
      ids[days] = [];
      for (let k = 0; k < n; k++) {
        const post = await newPostRow(migrateDb, actor.id);
        const [row] = await migrateDb.execute<{ id: string }>(sql`
          insert into activity_items (recipient_id, kind, actor_id, post_id, created_at)
          values (${recipient}::uuid, 'mention', ${actor.id}::uuid, ${post}::uuid, now() - make_interval(days => ${days}::int))
          returning id`);
        ids[days]!.push(row!.id);
      }
    }
  }, 120_000);
  afterAll(async () => {
    try {
      await removeFixtures(migrateDb, made);
    } finally {
      await Promise.all([closeDb(apiDb), closeDb(migrateDb)]);
    }
  });

  const kept = async () =>
    (await migrateDb.execute<{ id: string }>(sql`select id from activity_items where recipient_id = ${recipient}::uuid order by id`)).map((row) => row.id);
  /** A logger that keeps what the job logs. */
  function recorder() {
    const lines: { level: string; fields: Record<string, unknown>; message: string }[] = [];
    const log = pino({ level: "silent" });
    for (const level of ["info", "warn", "error"] as const) {
      log[level] = ((fields: Record<string, unknown>, message: string) => {
        lines.push({ level, fields, message });
      }) as never;
    }
    return { log, lines };
  }

  test("the batch is 5,000 entries, the keep 90 days, and the job is named activity-retention", () => {
    expect(RETENTION_BATCH).toBe(5_000);
    expect(ACTIVITY_KEEP_DAYS).toBe(90);
    expect(RETENTION_JOB).toBe("activity-retention");
  });

  test("while another instance holds the job's lock, a round is skipped and deletes nothing", async () => {
    const lock = new MemoryJobLock();
    expect(await lock.acquire(`job:${RETENTION_JOB}`, "another instance", 60_000)).toBe(true);
    const { log } = recorder();
    expect(await createRetentionJob({ repo: createActivityRepo(apiDb), log }, lock, 2).round()).toBe("skipped");
    expect((await kept()).length).toBe(8);
  });

  test("a round deletes the entries older than 90 days in batches until one comes back short, keeps those of 89 days and today, and logs only the count", async () => {
    // Nothing older than the keep but this file's own entries, so the batches below are this file's to count.
    const [others] = await migrateDb.execute<{ n: number }>(
      sql`select count(*)::int as n from activity_items where created_at < now() - make_interval(days => ${ACTIVITY_KEEP_DAYS}::int) and recipient_id <> ${recipient}::uuid`,
    );
    expect(others!.n).toBe(0);
    const repo = createActivityRepo(apiDb);
    const batches: number[] = [];
    const counted = { ...repo, deleteExpired: async (batch: number) => {
      const gone = await repo.deleteExpired(batch);
      batches.push(gone);
      return gone;
    } };
    const { log, lines } = recorder();
    expect(await createRetentionJob({ repo: counted, log }, new MemoryJobLock(), 2).round()).toBe("ran");
    expect(batches).toEqual([2, 2, 1]);
    expect(await kept()).toEqual([...ids[89]!, ...ids[0]!].sort());
    expect(lines).toEqual([{ level: "info", fields: { job: RETENTION_JOB, deleted: 5 }, message: "activity: old entries deleted" }]);
    // A round with nothing to delete logs nothing.
    const quiet = recorder();
    expect(await createRetentionJob({ repo, log: quiet.log }, new MemoryJobLock(), 2).round()).toBe("ran");
    expect(quiet.lines).toEqual([]);
    expect((await kept()).length).toBe(3);
  });

  test("this file left no row behind: 2d's tables hold what they held before it", async () => {
    await removeFixtures(migrateDb, made.splice(0));
    expect(await rowCounts(apiDb, ACTIVITY_TABLES)).toEqual(before);
  });
});

import { Writable } from "node:stream";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { EDGE_RULES } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { MemoryJobLock } from "../../src/lib/jobs";
import { edgeAdapterFrom, type EdgeAdapter } from "../../src/media/edge-adapter";
import { EDGE_JOB, EDGE_ROUND_MS, createEdgeJob, edgeRound } from "../../src/media/edge";
import { createMediaRepo } from "../../src/media/repo";
import { fakeEdge } from "../media/fake-edge";
import { aPost, act, decideIn, imagePost, newTestStaff, report, rowCounts, staffProfile, uuids, type Runner, type TestStaff } from "./moderation-fixtures";
import { rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 120_000 });

/**
 * The outbox's job, edge-purge (3d design, sections 7.4 and 7.14; 12.1 row 20; Task 3), against the `test` adapter and
 * fakeEdge(): one request a round with at most EDGE_RULES.prefixes prefixes, each `<host>/api/media/<id>/`; a failed
 * purge backs off from 30 seconds, doubled a failure, to an hour; after 24 hours a row is failed and edge_purge_failed is
 * written once in 24 hours; a row written while the request was out stays open; a round that throws leaves its rows; a
 * measure stands while the edge is down; the token is in no log line and no audit row. Every test runs in a transaction
 * that is rolled back; the `test` adapter is built in the process on a site this test has closed.
 */
const silent = pino({ level: "silent" });
const TOKEN = "edge_token_that_must_never_be_seen_9876";
const ZONE = "fedcba9876543210fedcba9876543210";
const testAdapter = (host = "edge.test") => {
  const adapter = edgeAdapterFrom({ EDGE_PURGE: "test", APP_SITE: "closed", EDGE_HOST: host });
  if (adapter.mode !== "test") throw new Error("not the test adapter");
  return adapter;
};

type Row = {
  id: string;
  media_id: string;
  attempts: number;
  outcome: string | null;
  done: boolean;
  wait: number | null;
};
/** The outbox rows of these images, oldest first, with the seconds from the transaction's start to when each is due again. */
const rowsOf = (q: Runner, mediaIds: readonly string[]) =>
  q.execute<Row>(sql`
    select id::text as id, media_id, attempts, outcome, done_at is not null as done, extract(epoch from next_at - now())::int as wait
      from public.edge_purges e where e.media_id = any(${uuids(mediaIds)}) order by e.id`);

describe.skipIf(!process.env.INTEGRATION)("integration: the edge's job (3d Task 3)", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let mod: TestStaff;
  let before: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    mod = await newTestStaff(authDb, migrateDb, createAuthRepo(authDb), "moderator");
    before = await rowCounts(apiDb, ["edge_purges", "alert_outbox"]);
  }, 120_000);
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  /**
   * `n` images, each of its own post, that stopped being public by their author's deletion, in id order of their rows; and
   * every other row still open in the database closed as off inside the transaction, so a round sees these alone.
   */
  async function hidden(tx: DbTx, n: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const p = await imagePost(tx, 1);
      await tx.execute(sql`update posts set state = 'deleted_by_author' where id = ${p.postId}::uuid`);
      ids.push(p.mediaIds[0]!);
    }
    await tx.execute(sql`update public.edge_purges set outcome = 'off', done_at = now() where done_at is null and media_id <> all(${uuids(ids)})`);
    return ids;
  }
  const deps = (tx: DbTx, adapter: EdgeAdapter, log = silent) => ({ repo: createMediaRepo(tx as unknown as Db), adapter, log });
  /** Makes every open row of these images due again now, as the next round's time would. */
  const dueNow = (tx: DbTx, ids: readonly string[]) => tx.execute(sql`update public.edge_purges set next_at = now() where done_at is null and media_id = any(${uuids(ids)})`);

  test("one request a round with at most 30 prefixes, the oldest images first, each prefix the host, the image route and the id; the next round sends the rest", async () => {
    // A round EDGE_RULES.roundSeconds after the last ended, one request each: at most four a minute.
    expect(EDGE_ROUND_MS).toBe(EDGE_RULES.roundSeconds * 1000);
    await rolledBack(apiDb, async (tx) => {
      const ids = await hidden(tx, EDGE_RULES.prefixes + 5);
      const adapter = testAdapter();
      const first = await edgeRound(deps(tx, adapter));
      expect(first).toMatchObject({ off: 0, sent: 1, prefixes: EDGE_RULES.prefixes, outcome: "accepted", closed: EDGE_RULES.prefixes, gaveUp: 0, alerted: false });
      expect(adapter.sent).toEqual([ids.slice(0, EDGE_RULES.prefixes).map((id) => `edge.test/api/media/${id}/`)]);
      expect((await rowsOf(tx, ids)).map((row) => row.outcome)).toEqual([...Array(EDGE_RULES.prefixes).fill("accepted"), ...Array(5).fill(null)]);
      const second = await edgeRound(deps(tx, adapter));
      expect(second).toMatchObject({ sent: 1, prefixes: 5, outcome: "accepted", closed: 5 });
      expect(adapter.sent[1]).toEqual(ids.slice(EDGE_RULES.prefixes).map((id) => `edge.test/api/media/${id}/`));
      // Nothing is left: a round reads nothing and sends nothing.
      expect(await edgeRound(deps(tx, adapter))).toMatchObject({ sent: 0, prefixes: 0, outcome: null, closed: 0 });
      expect(adapter.sent).toHaveLength(2);
    });
  });

  test("two rows of one image are one prefix; a failed purge backs off from 30 seconds, doubled a failure, to one hour, and leaves its rows open", async () => {
    await rolledBack(apiDb, async (tx) => {
      const p = await imagePost(tx, 1);
      // The post's state, then the image's own delete: two rows for one image.
      await tx.execute(sql`update posts set state = 'deleted_by_author' where id = ${p.postId}::uuid`);
      await tx.execute(sql`delete from post_media where id = ${p.mediaIds[0]!}::uuid`);
      await tx.execute(sql`update public.edge_purges set outcome = 'off', done_at = now() where done_at is null and media_id <> ${p.mediaIds[0]!}::uuid`);
      const failing = testAdapter("fail.edge.test");
      const waits: number[] = [];
      for (let attempt = 1; attempt <= 9; attempt++) {
        const round = await edgeRound(deps(tx, failing));
        expect(round, `attempt ${attempt}`).toMatchObject({ sent: 1, prefixes: 1, outcome: "failed", closed: 0, gaveUp: 0, alerted: false });
        const rows = await rowsOf(tx, p.mediaIds);
        expect(rows.map((row) => [row.attempts, row.outcome, row.done])).toEqual([
          [attempt, null, false],
          [attempt, null, false],
        ]);
        waits.push(rows[0]!.wait!);
        await dueNow(tx, p.mediaIds);
      }
      expect(waits).toEqual([30, 60, 120, 240, 480, 960, 1920, 3600, 3600]);
      expect(failing.sent.every((prefixes) => prefixes.length === 1)).toBe(true);
      // Backing off, a row is not due, and a round leaves it alone.
      await edgeRound(deps(tx, failing));
      expect(await edgeRound(deps(tx, failing))).toMatchObject({ sent: 0, outcome: null });
    });
  });

  test("a row written 24 hours ago that fails again is failed, and the job writes edge_purge_failed with the count and the oldest time, once in 24 hours", async () => {
    // As the migrator, who alone moves a row's created_at back, in a transaction rolled back.
    await rolledBack(migrateDb, async (tx) => {
      const ids = await hidden(tx, 3);
      await tx.execute(sql`delete from public.alert_outbox where kind = 'edge_purge_failed'`);
      // The first two were written a day and a minute ago; the third now.
      await tx.execute(sql`update public.edge_purges set created_at = now() - make_interval(hours => ${EDGE_RULES.giveUpHours}, mins => 1) where media_id = any(${uuids(ids.slice(0, 2))})`);
      const failing = testAdapter("fail.edge.test");
      const round = await edgeRound(deps(tx, failing));
      expect(round).toMatchObject({ sent: 1, prefixes: 3, outcome: "failed", closed: 0, gaveUp: 2, alerted: true });
      expect((await rowsOf(tx, ids)).map((row) => [row.outcome, row.done, row.attempts])).toEqual([
        ["failed", true, 1],
        ["failed", true, 1],
        [null, false, 1],
      ]);
      const [oldest] = await tx.execute<{ at: string }>(sql`select to_char(min(created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at from public.edge_purges where media_id = any(${uuids(ids)})`);
      const alerts = await tx.execute<{ priority: number; scope: string; facts: Record<string, unknown>; step: number | null }>(sql`select priority, scope, facts, step from public.alert_outbox where kind = 'edge_purge_failed'`);
      expect(alerts.map((a) => ({ ...a }))).toEqual([{ priority: 3, scope: "all", facts: { count: 2, oldestAt: oldest!.at }, step: null }]);
      // The third gives up too, a round later, with no second alert within 24 hours.
      await tx.execute(sql`update public.edge_purges set created_at = now() - make_interval(hours => ${EDGE_RULES.giveUpHours}) where media_id = ${ids[2]!}::uuid`);
      await dueNow(tx, ids);
      expect(await edgeRound(deps(tx, failing))).toMatchObject({ gaveUp: 1, alerted: false });
      expect(await tx.execute(sql`select 1 from public.alert_outbox where kind = 'edge_purge_failed'`)).toHaveLength(1);
    });
  });

  test("a row written while the request was out stays open for the next round: it may stand for a hiding the purge did not cover", async () => {
    await rolledBack(migrateDb, async (tx) => {
      const [image] = await hidden(tx, 1);
      const inner = testAdapter();
      // An adapter that, while its request is out, sees the image hidden once more: the trigger's row, as the migrator writes it here.
      const racing: EdgeAdapter = {
        mode: "test",
        prefix: (id) => inner.prefix(id),
        purge: async (prefixes) => {
          await tx.execute(sql`insert into public.edge_purges (media_id, cause) values (${image!}::uuid, 'state')`);
          return inner.purge(prefixes);
        },
      };
      expect(await edgeRound(deps(tx, racing))).toMatchObject({ outcome: "accepted", closed: 1 });
      expect((await rowsOf(tx, [image!])).map((row) => row.outcome)).toEqual(["accepted", null]);
      expect(await edgeRound(deps(tx, inner))).toMatchObject({ outcome: "accepted", closed: 1, prefixes: 1 });
      expect((await rowsOf(tx, [image!])).map((row) => row.outcome)).toEqual(["accepted", "accepted"]);
    });
  });

  test("a round that throws leaves its rows as they were", async () => {
    await rolledBack(apiDb, async (tx) => {
      const ids = await hidden(tx, 2);
      const broken: EdgeAdapter = { mode: "test", prefix: (id) => `edge.test/api/media/${id}/`, purge: async () => Promise.reject(new Error("the adapter broke")) };
      await expect(edgeRound(deps(tx, broken))).rejects.toThrow(/the adapter broke/);
      expect((await rowsOf(tx, ids)).map((row) => [row.attempts, row.outcome, row.wait])).toEqual([
        [0, null, 0],
        [0, null, 0],
      ]);
    });
  });

  test("a measure stands while the edge is down; the bearer token reaches the provider and no log line or audit row", async () => {
    const edge = await fakeEdge();
    const lines: string[] = [];
    const log = pino({ level: "trace" }, new Writable({ write: (chunk: Buffer, _encoding, done) => void (lines.push(chunk.toString("utf8")), done()) }));
    try {
      await rolledBack(apiDb, async (tx) => {
        await staffProfile(tx, mod);
        const p = await imagePost(tx, 2);
        const { caseId } = await report(tx, aPost(p.postId));
        await decideIn(tx, mod, caseId, { kind: "interim", actions: [act("withhold")] });
        await tx.execute(sql`update public.edge_purges set outcome = 'off', done_at = now() where done_at is null and media_id <> all(${uuids(p.mediaIds)})`);
        const [audit] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from audit_log`);
        const adapter = edgeAdapterFrom({ EDGE_PURGE: "cloudflare", APP_SITE: "open", EDGE_ZONE_ID: ZONE, EDGE_API_TOKEN: TOKEN, EDGE_HOST: "korbat.example" }, { apiBase: edge.apiBase });
        edge.answer("forbidden");
        expect(await edgeRound(deps(tx, adapter, log))).toMatchObject({ sent: 1, prefixes: 2, outcome: "failed" });
        // The measure stood from its commit: the post is withheld whatever the edge answered.
        const [post] = await tx.execute<{ level: string }>(sql`select moderation_level::text as level from posts where id = ${p.postId}::uuid`);
        expect(post!.level).toBe("withheld");
        edge.answer("ok");
        await dueNow(tx, p.mediaIds);
        expect(await edgeRound(deps(tx, adapter, log))).toMatchObject({ sent: 1, prefixes: 2, outcome: "accepted", closed: 4 });
        // The trigger writes a post's images in id order: the prefixes are compared as a set.
        const prefixes = [...p.mediaIds].sort().map((id) => `korbat.example/api/media/${id}/`);
        expect(edge.requests.map((r) => [r.path, r.bearer, [...(r.prefixes ?? [])].sort()])).toEqual([
          [`/client/v4/zones/${ZONE}/purge_cache`, true, prefixes],
          [`/client/v4/zones/${ZONE}/purge_cache`, true, prefixes],
        ]);
        // The job wrote no audit row, and no row of the log holds the token.
        const [after] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from audit_log`);
        expect(after!.n).toBe(audit!.n);
        expect(await tx.execute(sql`select 1 from audit_log where metadata::text like ${`%${TOKEN}%`}`)).toHaveLength(0);
      });
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join("")).not.toContain(TOKEN);
    } finally {
      await edge.close();
    }
  });

  test("the job runs under the shared lock: while another instance holds job:edge-purge a round is skipped", async () => {
    await rolledBack(apiDb, async (tx) => {
      const lock = new MemoryJobLock();
      const job = createEdgeJob(deps(tx, testAdapter()), lock);
      expect(await lock.acquire(`job:${EDGE_JOB}`, "another instance", 60_000)).toBe(true);
      expect(await job.round()).toBe("skipped");
      await lock.release(`job:${EDGE_JOB}`, "another instance");
      expect(await job.round()).toBe("ran");
    });
  });

  test("this file left no row behind", async () => {
    expect(await rowCounts(apiDb, ["edge_purges", "alert_outbox"])).toEqual(before);
  });
});

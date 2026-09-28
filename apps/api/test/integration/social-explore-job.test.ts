import { sql } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { EXPLORE_V1 } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import type { AppEnv } from "../../src/env";
import { MemoryJobLock } from "../../src/lib/jobs";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createSocial } from "../../src/social";
import { createExploreJob } from "../../src/social/explore";
import { newPost, newProfile, ticker } from "./social-fixtures";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * As in the ranking suite, the clocks run in a past of their own (2021 here, each test in a span of ten days), so no
 * other suite's rows are ever candidates or engagement for these rounds, and no two tests share a window.
 */
const EPOCH = Date.UTC(2021, 0, 1);
const SPAN = 10 * DAY;

interface LogLine {
  level: number;
  msg: string;
  [field: string]: unknown;
}

interface RunRow {
  generation: number;
  candidates: number;
  items: number;
  tookMs: number;
}

/** The session middleware the job never passes through. */
const pass: MiddlewareHandler<AppEnv> = async (_c, next) => {
  await next();
};

/** Polls until `done` holds, for at most `ms`. */
async function until(done: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`still waiting after ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe.skipIf(!process.env.INTEGRATION)("integration: the Explore job", () => {
  let db: Db;
  let spans = 0;

  beforeAll(() => {
    // Startup parameters in the URL become every connection's settings: a lock wait gives up after 20 seconds, four
    // times the refresh's own limit, so a test sees which of the two ended it; a transaction left idle ends after 30.
    const url = new URL(loadConfig().DATABASE_URL_API);
    url.searchParams.set("lock_timeout", "20s");
    url.searchParams.set("idle_in_transaction_session_timeout", "30s");
    db = createDb(url.toString(), { max: 4 });
  });
  afterAll(async () => {
    // With a deadline, so a connection some failed test left in a transaction cannot keep the suite open.
    await db.$client.end({ timeout: 5 });
  });
  beforeEach(async () => {
    await db.execute(sql`delete from explore_runs`);
  });

  /**
   * The social module as the server builds it, on this database, with a clock that starts in a span of its own and a
   * logger that keeps every line without the time, pid and hostname.
   */
  function socialModule() {
    const clock = ticker(EPOCH + spans++ * SPAN);
    const lines: LogLine[] = [];
    const logger = pino({ level: "info", base: null, timestamp: false }, { write: (line: string) => void lines.push(JSON.parse(line) as LogLine) });
    const social = createSocial({ apiDb: db, rateLimitStore: new MemoryStore(() => clock.now().getTime()), logger, requireSession: pass, requireFreshAuth: pass, now: clock.next });
    return { social, clock, lines };
  }

  /** A post three accounts of a month liked, with the clock moved on past the likes' 10 minutes of standing. */
  async function approvedPost(m: ReturnType<typeof socialModule>): Promise<string> {
    const monthAgo = new Date(m.clock.now().getTime() - 30 * DAY);
    const [author, ...fans] = await Promise.all(Array.from({ length: 4 }, () => newProfile(db, { createdAt: monthAgo })));
    const id = await newPost(m.social.deps.repo, author!.id, m.clock.next());
    for (const fan of fans) expect(await m.social.deps.repo.like(fan.id, id, m.clock.next())).toBe(true);
    m.clock.jump(20 * MINUTE);
    return id;
  }

  async function runs(): Promise<RunRow[]> {
    return (await db.execute(sql`select generation, candidates, items, took_ms as "tookMs" from explore_runs order by generation`)) as unknown as RunRow[];
  }

  async function listed(generation: number): Promise<string[]> {
    const rows = (await db.execute(sql`select post_id from explore_items where generation = ${generation} order by position`)) as unknown as { post_id: string }[];
    return rows.map((row) => row.post_id);
  }

  const failures = (lines: LogLine[]) => lines.filter((line) => line.level >= 50);

  test("startExplore ranks at once, without waiting for the interval, and logs exactly the round's generation, candidates, items and milliseconds", async () => {
    const m = socialModule();
    const target = await approvedPost(m);
    const stop = m.social.startExplore(new MemoryJobLock());
    try {
      await until(() => m.lines.length > 0, 10_000);
    } finally {
      stop();
    }
    const [run, ...others] = await runs();
    expect(others).toEqual([]);
    expect(run).toEqual({ generation: expect.any(Number), candidates: 1, items: 1, tookMs: expect.any(Number) });
    expect(m.lines).toEqual([{ level: 30, msg: "explore: ranking refreshed", generation: run!.generation, candidates: 1, items: 1, tookMs: run!.tookMs }]);
    expect(await listed(run!.generation)).toEqual([target]);
  });

  test("the job's rounds follow the minimum gap: one inside it writes and logs nothing, the next one past it ranks again", async () => {
    const m = socialModule();
    const target = await approvedPost(m);
    const job = createExploreJob(m.social.deps, new MemoryJobLock());
    expect(await job.round()).toBe("ran");
    const first = await runs();
    expect(first).toHaveLength(1);

    m.clock.jump(EXPLORE_V1.minGapMinutes * MINUTE - 1_000);
    expect(await job.round()).toBe("ran");
    expect(await runs()).toEqual(first);
    expect(m.lines).toHaveLength(1);

    m.clock.jump(EXPLORE_V1.refreshMinutes * MINUTE);
    expect(await job.round()).toBe("ran");
    const [, second] = await runs();
    expect(second!.generation).toBeGreaterThan(first[0]!.generation);
    expect(await listed(second!.generation)).toEqual([target]);
    expect(m.lines).toHaveLength(2);
    expect(m.lines[1]).toEqual({ level: 30, msg: "explore: ranking refreshed", generation: second!.generation, candidates: 1, items: 1, tookMs: second!.tookMs });
  });

  test(
    "a round that fails keeps the previous ranking: at start it gives up after the refresh's own 5-second lock timeout and its failure is logged as the timer logs one",
    { timeout: 60_000 },
    async () => {
      const m = socialModule();
      const target = await approvedPost(m);
      const lock = new MemoryJobLock();
      expect(await createExploreJob(m.social.deps, lock).round()).toBe("ran");
      const previous = await runs();
      expect(previous).toHaveLength(1);
      m.clock.jump(EXPLORE_V1.refreshMinutes * MINUTE);

      // A transaction holds the listed post's row for update, as a write to it would: the next ranking cannot insert an
      // item referencing that post until it ends, and gives up on its own lock timeout instead.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let taken!: () => void;
      const locked = new Promise<void>((resolve) => (taken = resolve));
      const holder = db.transaction(async (tx) => {
        await tx.execute(sql`select 1 from posts where id = ${target}::uuid for update`);
        taken();
        await gate;
      });
      // A holder that failed to take its lock must not leave the test waiting for it.
      holder.catch(() => taken());
      let stop: () => void = () => undefined;
      let waited = 0;
      try {
        await locked;
        const started = Date.now();
        stop = m.social.startExplore(lock);
        await until(() => failures(m.lines).length > 0, 25_000);
        waited = Date.now() - started;
      } finally {
        stop();
        release();
        await holder.catch(() => undefined);
      }
      // Its own limit of 5 seconds ended the wait, not the connection's 20.
      expect(waited).toBeLessThan(15_000);
      expect(failures(m.lines)).toEqual([
        expect.objectContaining({ level: 50, msg: "job: round failed", job: "explore-refresh", err: expect.objectContaining({ message: expect.stringContaining("lock timeout") }) }),
      ]);
      expect(m.lines.filter((line) => line.level < 50)).toEqual([expect.objectContaining({ msg: "explore: ranking refreshed", generation: previous[0]!.generation })]);
      // Nothing of the failed round remains: its run row went with its transaction.
      expect(await runs()).toEqual(previous);
      expect(await listed(previous[0]!.generation)).toEqual([target]);

      // The next round, with nothing in its way, replaces the ranking.
      expect(await createExploreJob(m.social.deps, lock).round()).toBe("ran");
      const [kept, current] = await runs();
      expect(kept).toEqual(previous[0]);
      expect(current!.generation).toBeGreaterThan(previous[0]!.generation);
      expect(await listed(current!.generation)).toEqual([target]);
    },
  );
});

# korbat explore (2c) — Task 2 of 6: The Explore ranking and its job: refreshExplore writes a ranking as of the clock's time in one bounded transaction with every number of the formula as a parameter, the skip rule and the retention of two generations; the explore-refresh job runs a round at start and one every five minutes

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-28 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend: a Hono API on Node 24, an Expo web app, PostgreSQL 18 and Valkey in Docker Compose. Sub-project 2c adds Explore, a ranked list of recent original posts. Task 1 laid the ground (EXPLORE_V1, the Explore contracts, migration 0011 with `profiles.show_in_explore`, `explore_runs`, `explore_items` and the BRIN indexes). This task writes the ranking: `refreshExplore(asOf, formula)` in the social repository, one bounded statement per round into a new generation, and the `explore-refresh` job that runs it at start and every five minutes. The design is `docs/superpowers/specs/2026-09-28-explore-2c-design.md` (sections 7 and 9).

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(contracts,db): the ground for Explore: EXPLORE_V1 with every constant of the published formula, the Explore page, status and switch contracts, the explore_refreshed error; migration 0011 adds profiles.show_in_explore, the explore_runs and explore_items generations tables with RLS, and BRIN indexes on the likes' and reposts' created_at`.

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
python docs/superpowers/prompts/explore-2c/write_blocks.py docs/superpowers/prompts/explore-2c/02-ranking.md 1
```

Expected: 3 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/integration/social-explore-job.test.ts`

```ts
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
```

### Create `apps/api/test/integration/social-explore-ranking.test.ts`

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { EXPLORE_V1, type ExploreFormula } from "@korbat/contracts";
import { closeDb, createDb, likes, posts, profiles, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { createSocialRepo, type SocialRepo } from "../../src/social/repo";
import { newPost, newProfile } from "./social-fixtures";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The integration suites share one database, so these rankings are computed as of times in 2020: every row the other
 * suites write is dated around the time they run, after every refresh here, and never enters. Each test ranks in a span
 * of ten days of its own, so no test's posts or engagement fall in another test's 48-hour window either.
 */
const EPOCH = Date.UTC(2020, 0, 1);
const SPAN = 10 * DAY;

/** The published formula without its minimum gap, for a test that ranks the same rows again at the same time. */
const AGAIN: ExploreFormula = { ...EXPLORE_V1, minGapMinutes: 0 };

/** The score as the published formula states it, for the orders the tests expect. */
const score = (approvers: number, hours: number): number => approvers / Math.pow(Math.max(0, hours) + EXPLORE_V1.offsetHours, EXPLORE_V1.gravity);

interface RunRow {
  generation: number;
  asOf: string;
  formula: number;
  candidates: number;
  items: number;
  tookMs: number;
}

describe.skipIf(!process.env.INTEGRATION)("integration: the Explore ranking", () => {
  let db: Db;
  let repo: SocialRepo;
  let spans = 0;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    repo = createSocialRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });
  // Every test starts without any ranking (the cascade empties explore_items) and reads the generations its rounds answer.
  beforeEach(async () => {
    await db.execute(sql`delete from explore_runs`);
  });

  /** The refresh time of a test: three days into a span of its own. */
  const nextAsOf = () => new Date(EPOCH + spans++ * SPAN + 3 * DAY);
  const before = (asOf: Date, ms: number) => new Date(asOf.getTime() - ms);
  const after = (asOf: Date, ms: number) => new Date(asOf.getTime() + ms);

  /** Accounts created a month before the refresh: old enough for everything they do in a test to count. */
  const accounts = (asOf: Date, n: number) => Promise.all(Array.from({ length: n }, () => newProfile(db, { createdAt: before(asOf, 30 * DAY) })));

  /** A top-level post, written through the repository at the time given. */
  const post = (author: { id: string }, at: Date) => newPost(repo, author.id, at);

  async function likedBy(postId: string, users: { id: string }[], at: Date): Promise<void> {
    for (const user of users) expect(await repo.like(user.id, postId, at)).toBe(true);
  }

  /** A round that must rank; its answer, whose generation the test reads. */
  async function rank(asOf: Date, formula?: ExploreFormula) {
    const result = await repo.refreshExplore(asOf, formula);
    if (result.skipped) throw new Error("the round skipped");
    return result;
  }

  /** The posts of a ranking in order; its positions must run from 1 without gaps. */
  async function listed(generation: number): Promise<string[]> {
    const rows = (await db.execute(sql`select position, post_id from explore_items where generation = ${generation} order by position`)) as unknown as { position: number; post_id: string }[];
    expect(rows.map((row) => row.position)).toEqual(rows.map((_, i) => i + 1));
    return rows.map((row) => row.post_id);
  }

  async function runs(): Promise<RunRow[]> {
    return (await db.execute(sql`
      select generation, to_char(as_of at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "asOf", formula, candidates, items, took_ms as "tookMs"
      from explore_runs order by generation`)) as unknown as RunRow[];
  }

  test("a round writes a ranking under a new generation with its time, its formula's version and its counts, and answers the same", async () => {
    const asOf = nextAsOf();
    const [author, ...fans] = await accounts(asOf, 4);
    const approved = await post(author!, before(asOf, 2 * HOUR));
    // A candidate nobody approved of: counted among the candidates, never ranked.
    await post(author!, before(asOf, HOUR));
    await likedBy(approved, fans, before(asOf, HOUR));

    const result = await rank(asOf);
    expect(result).toEqual({ skipped: false, generation: expect.any(Number), candidates: 2, items: 1, tookMs: expect.any(Number) });
    expect(Number.isInteger(result.tookMs) && result.tookMs >= 0).toBe(true);
    expect(await runs()).toEqual([{ generation: result.generation, asOf: asOf.toISOString(), formula: EXPLORE_V1.version, candidates: 2, items: 1, tookMs: result.tookMs }]);
    expect(await listed(result.generation)).toEqual([approved]);
    const [item] = (await db.execute(sql`select author_id from explore_items where generation = ${result.generation}`)) as unknown as { author_id: string }[];
    expect(item?.author_id).toBe(author!.id);
  });

  test("the window's edges: a post enters from a millisecond after 48 hours before the refresh up to the refresh's own millisecond", async () => {
    const asOf = nextAsOf();
    const [a, b, c, ...fans] = await accounts(asOf, 6);
    const window = EXPLORE_V1.windowHours * HOUR;
    const tooOld = await post(a!, before(asOf, window));
    const oldest = await post(b!, before(asOf, window - 1));
    const newest = await post(c!, asOf);
    await likedBy(tooOld, fans, before(asOf, window - HOUR));
    await likedBy(oldest, fans, before(asOf, window - HOUR));
    // Likes dated before the post, as instances whose clocks disagree may date them, so that only the post's own time decides.
    await likedBy(newest, fans, before(asOf, HOUR));

    const result = await rank(asOf);
    expect(await listed(result.generation)).toEqual([newest, oldest]);
    expect(result.candidates).toBe(2);
  });

  test("a post dated after the refresh never enters", async () => {
    const asOf = nextAsOf();
    const [a, b, ...fans] = await accounts(asOf, 5);
    // Dated a millisecond after the refresh by an instance whose clock runs ahead; its likes carry earlier times, so only the post's own time keeps it out.
    const ahead = await post(a!, after(asOf, 1));
    const onTime = await post(b!, before(asOf, 2 * HOUR));
    await likedBy(ahead, fans, before(asOf, HOUR));
    await likedBy(onTime, fans, before(asOf, HOUR));

    const result = await rank(asOf);
    expect(await listed(result.generation)).toEqual([onTime]);
    expect(result.candidates).toBe(1);
  });

  test("replies, quotes, withheld, removed and deleted posts, deleted authors and authors who switched Explore off never enter", async () => {
    const asOf = nextAsOf();
    const [author, gone, shy, ...fans] = await accounts(asOf, 6);
    const at = before(asOf, 3 * HOUR);
    const shown = await post(author!, at);
    const reply = await newPost(repo, author!.id, at, "a reply", { replyToId: shown });
    const quote = await newPost(repo, author!.id, at, "a quote", { quoteOfId: shown });
    const withheld = await post(author!, at);
    const removed = await post(author!, at);
    const deleted = await post(author!, at);
    const byGone = await post(gone!, at);
    const byShy = await post(shy!, at);
    for (const id of [shown, reply, quote, withheld, removed, deleted, byGone, byShy]) await likedBy(id, fans, before(asOf, 2 * HOUR));
    await db.execute(sql`update posts set state = 'withheld' where id = ${withheld}::uuid`);
    await db.execute(sql`update posts set state = 'removed' where id = ${removed}::uuid`);
    expect(await repo.deletePost(deleted, author!.id, before(asOf, HOUR))).toBe(true);
    // Marked deleted as the purge's last statement marks it, with the post left visible, so only the author's deletion keeps it out.
    await db.execute(sql`update profiles set deleted_at = ${before(asOf, HOUR).toISOString()}::timestamptz where id = ${gone!.id}::uuid`);
    await db.execute(sql`update profiles set show_in_explore = false where id = ${shy!.id}::uuid`);

    const result = await rank(asOf);
    expect(await listed(result.generation)).toEqual([shown]);
    expect(result.candidates).toBe(1);
  });

  test("the author's own likes and reposts do not count", async () => {
    const asOf = nextAsOf();
    const [author, other, ...fans] = await accounts(asOf, 4);
    const at = before(asOf, 2 * HOUR);
    const selfish = await post(author!, before(asOf, 3 * HOUR));
    const control = await post(other!, before(asOf, 3 * HOUR));
    await likedBy(selfish, fans, at);
    expect(await repo.like(author!.id, selfish, at)).toBe(true);
    expect(await repo.repost(author!.id, selfish, at)).toBe(true);
    // The same two accounts and the first author, who is someone else here.
    await likedBy(control, [...fans, author!], at);

    const result = await rank(asOf);
    expect(await listed(result.generation)).toEqual([control]);
  });

  test("likes and reposts from accounts under 48 hours old at the time do not count, even once the account is older", async () => {
    const asOf = nextAsOf();
    const [a, b, c, ...fans] = await accounts(asOf, 5);
    const minAge = EXPLORE_V1.engagerMinAgeHours * HOUR;
    const at = before(asOf, 2 * HOUR);
    // A millisecond short of 48 hours old when it liked, and past 49 hours at the refresh.
    const youngLiker = await newProfile(db, { createdAt: new Date(at.getTime() - minAge + 1) });
    // A day old; its repost is written through the repository, which does not apply the 48-hour gate the flow applies.
    const youngReposter = await newProfile(db, { createdAt: before(asOf, DAY) });
    // Exactly 48 hours old when it liked.
    const justOldEnough = await newProfile(db, { createdAt: new Date(at.getTime() - minAge) });
    const liked = await post(a!, before(asOf, 3 * HOUR));
    const reposted = await post(b!, before(asOf, 3 * HOUR));
    const control = await post(c!, before(asOf, 3 * HOUR));
    await likedBy(liked, [...fans, youngLiker], at);
    await likedBy(reposted, fans, at);
    expect(await repo.repost(youngReposter.id, reposted, at)).toBe(true);
    await likedBy(control, [...fans, justOldEnough], at);

    const result = await rank(asOf);
    expect(await listed(result.generation)).toEqual([control]);
  });

  test("likes and reposts from deleted accounts do not count", async () => {
    const asOf = nextAsOf();
    const [author, liker, reposter, ...fans] = await accounts(asOf, 5);
    const at = before(asOf, 2 * HOUR);
    const target = await post(author!, before(asOf, 3 * HOUR));
    await likedBy(target, fans, at);
    expect(await repo.like(liker!.id, target, at)).toBe(true);
    expect(await repo.repost(reposter!.id, target, at)).toBe(true);
    expect(await listed((await rank(asOf, AGAIN)).generation)).toEqual([target]);

    // Marked deleted as the purge's last statement marks them, with their like and repost left in place, so only the deletion keeps them from counting.
    await db.execute(sql`update profiles set deleted_at = ${before(asOf, HOUR).toISOString()}::timestamptz where id in (${liker!.id}::uuid, ${reposter!.id}::uuid)`);
    expect(await listed((await rank(asOf, AGAIN)).generation)).toEqual([]);
  });

  test("likes and reposts younger than 10 minutes do not count, and ones exactly 10 minutes old do", async () => {
    const asOf = nextAsOf();
    const [a, b, c, d, late, ...fans] = await accounts(asOf, 7);
    const standing = EXPLORE_V1.standingMinutes * MINUTE;
    const likedInTime = await post(a!, before(asOf, HOUR));
    const repostedInTime = await post(b!, before(asOf, 2 * HOUR));
    const likedLate = await post(c!, before(asOf, HOUR));
    const repostedLate = await post(d!, before(asOf, HOUR));
    for (const id of [likedInTime, repostedInTime, likedLate, repostedLate]) await likedBy(id, fans, before(asOf, 30 * MINUTE));
    expect(await repo.like(late!.id, likedInTime, before(asOf, standing))).toBe(true);
    expect(await repo.repost(late!.id, repostedInTime, before(asOf, standing))).toBe(true);
    expect(await repo.like(late!.id, likedLate, before(asOf, standing - 1))).toBe(true);
    expect(await repo.repost(late!.id, repostedLate, before(asOf, standing - 1))).toBe(true);

    const result = await rank(asOf);
    expect(await listed(result.generation)).toEqual([likedInTime, repostedInTime]);
  });

  test("an account that liked and reposted a post counts once", async () => {
    const asOf = nextAsOf();
    const [author, ada, bob, cyd] = await accounts(asOf, 4);
    const at = before(asOf, 2 * HOUR);
    const target = await post(author!, before(asOf, 3 * HOUR));
    for (const user of [ada!, bob!]) {
      expect(await repo.like(user.id, target, at)).toBe(true);
      expect(await repo.repost(user.id, target, at)).toBe(true);
    }
    expect(await listed((await rank(asOf, AGAIN)).generation)).toEqual([]);

    expect(await repo.repost(cyd!.id, target, at)).toBe(true);
    expect(await listed((await rank(asOf, AGAIN)).generation)).toEqual([target]);
  });

  test("three eligible repliers, three eligible quoters and two approving accounts keep a post out", async () => {
    const asOf = nextAsOf();
    const [author, ...others] = await accounts(asOf, 9);
    const [repliers, quoters, approvers] = [others.slice(0, 3), others.slice(3, 6), others.slice(6, 8)];
    const at = before(asOf, 2 * HOUR);
    const target = await post(author!, before(asOf, 3 * HOUR));
    for (const user of repliers) await newPost(repo, user.id, at, "a reply", { replyToId: target });
    for (const user of quoters) await newPost(repo, user.id, at, "a quote", { quoteOfId: target });
    await likedBy(target, approvers, at);

    const first = await rank(asOf, AGAIN);
    expect(await listed(first.generation)).toEqual([]);
    // The replies and quotes are posts in the window too, but never candidates.
    expect(first.candidates).toBe(1);

    // A replier who also likes the post is an approving account like any other: the third.
    expect(await repo.like(repliers[0]!.id, target, at)).toBe(true);
    expect(await listed((await rank(asOf, AGAIN)).generation)).toEqual([target]);
  });

  test("the threshold: three approving accounts put a post in, two do not", async () => {
    const asOf = nextAsOf();
    const [a, b, ...fans] = await accounts(asOf, 5);
    const three = await post(a!, before(asOf, 2 * HOUR));
    const two = await post(b!, before(asOf, 2 * HOUR));
    await likedBy(three, fans, before(asOf, HOUR));
    await likedBy(two, fans.slice(0, 2), before(asOf, HOUR));

    const result = await rank(asOf);
    expect(await listed(result.generation)).toEqual([three]);
    expect(result).toMatchObject({ candidates: 2, items: 1 });
  });

  test("the order is by score, approving accounts over (hours since posted + 2) ^ 1.8, across posts older than 24 hours, a tie going to the higher post id", async () => {
    const asOf = nextAsOf();
    const fans = await accounts(asOf, 20);
    const shapes = [
      { approvers: 3, hours: 1 },
      { approvers: 5, hours: 12 },
      // Older than a day, yet above the 12-hour-old post: it has four times its approving accounts.
      { approvers: 20, hours: 25 },
      // Older than a day, and below it.
      { approvers: 8, hours: 30 },
      // These two tie: as many approving accounts, posted at the same millisecond.
      { approvers: 4, hours: 6 },
      { approvers: 4, hours: 6 },
    ];
    const made: { id: string; score: number }[] = [];
    for (const shape of shapes) {
      const [author] = await accounts(asOf, 1);
      const id = await post(author!, before(asOf, shape.hours * HOUR));
      await likedBy(id, fans.slice(0, shape.approvers), before(asOf, 30 * MINUTE));
      made.push({ id, score: score(shape.approvers, shape.hours) });
    }
    const expected = [...made].sort((x, y) => y.score - x.score || (x.id < y.id ? 1 : -1)).map((p) => p.id);
    expect(expected.indexOf(made[2]!.id)).toBeLessThan(expected.indexOf(made[1]!.id));
    expect(expected.indexOf(made[3]!.id)).toBeGreaterThan(expected.indexOf(made[1]!.id));
    const [tieLow, tieHigh] = [made[4]!.id, made[5]!.id].sort();
    expect(expected.indexOf(tieHigh!)).toBe(expected.indexOf(tieLow!) - 1);

    const result = await rank(asOf);
    expect(await listed(result.generation)).toEqual(expected);
  });

  test("an author with three qualifying posts keeps the best two by score, and the positions close up behind the one left out", async () => {
    const asOf = nextAsOf();
    const [a, b, c] = await accounts(asOf, 3);
    const fans = await accounts(asOf, 12);
    const approved = async (author: { id: string }, approvers: number, hours: number) => {
      const id = await post(author, before(asOf, hours * HOUR));
      await likedBy(id, fans.slice(0, approvers), before(asOf, 30 * MINUTE));
      return id;
    };
    const a1 = await approved(a!, 5, 1);
    const a2 = await approved(a!, 4, 1);
    // The author's most approved post, but their third by score: 20 hours old.
    await approved(a!, 12, 20);
    const c1 = await approved(c!, 3, 1);
    // Below the author's third post, so it moves up a place when that one is left out.
    const b1 = await approved(b!, 3, 30);

    const result = await rank(asOf);
    expect(await listed(result.generation)).toEqual([a1, a2, c1, b1]);
    expect(result).toMatchObject({ candidates: 5, items: 4 });
  });

  test("a ranking holds at most 300 posts: of 301 qualifying posts, the lowest scoring is left out", async () => {
    const asOf = nextAsOf();
    const fans = await accounts(asOf, 3);
    const n = EXPLORE_V1.listLength + 1;
    // One post by each of 301 authors, so the per-author cap plays no part, written in bulk; each is a second older than
    // the one before, so the scores fall in the order the posts were written.
    const authors = Array.from({ length: n }, () => ({ id: randomUUID(), handle: `x_${randomBytes(6).toString("hex")}`, displayName: "An author", createdAt: before(asOf, 30 * DAY) }));
    await db.insert(profiles).values(authors);
    const written = await db
      .insert(posts)
      .values(authors.map((author, i) => ({ authorId: author.id, body: `post ${i}`, createdAt: before(asOf, HOUR + i * 1000) })))
      .returning({ id: posts.id, authorId: posts.authorId });
    const byAuthor = new Map(written.map((row) => [row.authorId, row.id]));
    const order = authors.map((author) => byAuthor.get(author.id)!);
    await db.insert(likes).values(fans.flatMap((fan) => order.map((postId) => ({ userId: fan.id, postId, createdAt: before(asOf, 30 * MINUTE) }))));

    const result = await rank(asOf);
    expect(result).toMatchObject({ candidates: n, items: EXPLORE_V1.listLength });
    expect(await listed(result.generation)).toEqual(order.slice(0, EXPLORE_V1.listLength));
  });

  test("a round less than 4.5 minutes after the newest ranking writes nothing, and one 4.5 minutes after it ranks", async () => {
    const asOf = nextAsOf();
    const [author, ...fans] = await accounts(asOf, 4);
    const target = await post(author!, before(asOf, 2 * HOUR));
    await likedBy(target, fans, before(asOf, HOUR));
    const gap = EXPLORE_V1.minGapMinutes * MINUTE;
    const first = await rank(asOf);
    const written = await runs();

    expect(await repo.refreshExplore(after(asOf, gap - 1))).toEqual({ skipped: true });
    // So does a round of an instance whose clock runs behind: the newest ranking is later than its time.
    expect(await repo.refreshExplore(before(asOf, MINUTE))).toEqual({ skipped: true });
    expect(await runs()).toEqual(written);
    expect(await listed(first.generation)).toEqual([target]);

    const second = await rank(after(asOf, gap));
    expect(second.generation).toBeGreaterThan(first.generation);
    expect((await runs()).map((run) => run.generation)).toEqual([first.generation, second.generation]);
    expect(await listed(second.generation)).toEqual([target]);
  });

  test("only the two newest rankings are kept, the items of an older one going with it", async () => {
    const asOf = nextAsOf();
    const [author, ...fans] = await accounts(asOf, 4);
    const target = await post(author!, before(asOf, 2 * HOUR));
    await likedBy(target, fans, before(asOf, HOUR));
    const itemCounts = async () =>
      (await db.execute(sql`select generation, count(*)::int as n from explore_items group by generation order by generation`)) as unknown as { generation: number; n: number }[];
    const generations = async () => (await runs()).map((run) => run.generation);

    const g1 = (await rank(asOf)).generation;
    const g2 = (await rank(after(asOf, 5 * MINUTE))).generation;
    expect(await generations()).toEqual([g1, g2]);
    const g3 = (await rank(after(asOf, 10 * MINUTE))).generation;
    expect(await generations()).toEqual([g2, g3]);
    expect(await itemCounts()).toEqual([
      { generation: g2, n: 1 },
      { generation: g3, n: 1 },
    ]);

    // A formula that keeps one ranking leaves only the newest.
    const g4 = (await rank(after(asOf, 15 * MINUTE), { ...EXPLORE_V1, kept: 1 })).generation;
    expect(await generations()).toEqual([g4]);
    expect(await itemCounts()).toEqual([{ generation: g4, n: 1 }]);
  });

  test("a round with another threshold, per-author cap and list length follows them, and records its formula's version", async () => {
    const asOf = nextAsOf();
    const [a, b, c] = await accounts(asOf, 3);
    const fans = await accounts(asOf, 4);
    const approved = async (author: { id: string }, approvers: number, hours: number) => {
      const id = await post(author, before(asOf, hours * HOUR));
      await likedBy(id, fans.slice(0, approvers), before(asOf, 30 * MINUTE));
      return id;
    };
    const a1 = await approved(a!, 4, 2);
    const a2 = await approved(a!, 3, 2);
    const b1 = await approved(b!, 2, 2);
    await approved(c!, 2, 5);
    expect(await listed((await rank(asOf, AGAIN)).generation)).toEqual([a1, a2]);

    // Two approving accounts are enough, one post per author, two posts in all: the author's best, then the better of the other two.
    const result = await rank(asOf, { ...AGAIN, version: 9, threshold: 2, perAuthor: 1, listLength: 2 });
    expect(await listed(result.generation)).toEqual([a1, b1]);
    expect((await runs()).at(-1)).toMatchObject({ generation: result.generation, formula: 9, candidates: 4, items: 2 });
  });

  test("a round with another window, engager age, standing, gravity and offset follows them", async () => {
    const asOf = nextAsOf();
    const [a, b, c, d] = await accounts(asOf, 4);
    const fans = await accounts(asOf, 6);
    const old = await post(a!, before(asOf, 30 * HOUR));
    await likedBy(old, fans, before(asOf, 29 * HOUR));
    const fresh = await post(b!, before(asOf, HOUR));
    await likedBy(fresh, fans.slice(0, 3), before(asOf, 30 * MINUTE));
    // Two approving accounts, and a like by an account three hours old when it liked, too young for v1.
    const youngFan = await newProfile(db, { createdAt: before(asOf, 4 * HOUR) });
    const byYoung = await post(c!, before(asOf, 2 * HOUR));
    await likedBy(byYoung, [...fans.slice(0, 2), youngFan], before(asOf, HOUR));
    // Two approving accounts, and a like a minute old, too recent for v1.
    const late = await post(d!, before(asOf, 3 * HOUR));
    await likedBy(late, fans.slice(0, 2), before(asOf, HOUR));
    expect(await repo.like(fans[2]!.id, late, before(asOf, MINUTE))).toBe(true);

    const order = async (changes: Partial<ExploreFormula>) => listed((await rank(asOf, { ...AGAIN, ...changes })).generation);
    expect(await order({})).toEqual([fresh, old]);
    expect(await order({ windowHours: 24 })).toEqual([fresh]);
    expect(await order({ engagerMinAgeHours: 2 })).toEqual([fresh, byYoung, old]);
    expect(await order({ standingMinutes: 0 })).toEqual([fresh, late, old]);
    // Without decay the score is the count of approving accounts; with a large offset, age matters little next to it.
    expect(await order({ gravity: 0 })).toEqual([old, fresh]);
    expect(await order({ gravity: 1, offsetHours: 100 })).toEqual([old, fresh]);
    expect(await order({ gravity: 1 })).toEqual([fresh, old]);
  });
});
```

### Create `apps/api/test/social/explore-job.test.ts`

```ts
import pino from "pino";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EXPLORE_V1 } from "@korbat/contracts";
import { MemoryJobLock, type JobLock } from "../../src/lib/jobs";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { WITHOUT_MEDIA, type SocialDeps } from "../../src/social/context";
import { createExploreJob, startExplore } from "../../src/social/explore";
import type { ExploreRefresh, SocialRepo } from "../../src/social/repo";

const MINUTE = 60_000;
/** The refresh interval of the published formula: five minutes. */
const INTERVAL = EXPLORE_V1.refreshMinutes * MINUTE;

interface LogLine {
  level: number;
  msg: string;
  [field: string]: unknown;
}

/**
 * The Explore job on a fake repository, under fake timers: each round takes the next answer from a queue (an Error is
 * thrown, an empty queue answers skipped) and records the time it was asked to rank as of. The logger keeps every line
 * without the time, pid and hostname, so a line holds only its level, its message and what the job logged. The lock
 * records the key and hold time of every acquisition.
 */
function harness() {
  const answers: (ExploreRefresh | Error)[] = [];
  const asked: number[] = [];
  const lines: LogLine[] = [];
  const holds: { key: string; ttlMs: number }[] = [];
  const repo = {
    async refreshExplore(asOf: Date): Promise<ExploreRefresh> {
      asked.push(asOf.getTime());
      const answer = answers.shift() ?? { skipped: true };
      if (answer instanceof Error) throw answer;
      return answer;
    },
  } satisfies Pick<SocialRepo, "refreshExplore">;
  const deps: SocialDeps = {
    repo: repo as unknown as SocialRepo,
    media: WITHOUT_MEDIA,
    limits: new MemoryStore(() => Date.now()),
    log: pino({ level: "info", base: null, timestamp: false }, { write: (line: string) => void lines.push(JSON.parse(line) as LogLine) }),
    now: () => new Date(),
  };
  const memory = new MemoryJobLock(() => Date.now());
  const lock: JobLock = {
    acquire: (key, token, ttlMs) => (holds.push({ key, ttlMs }), memory.acquire(key, token, ttlMs)),
    refresh: (key, token, ttlMs) => memory.refresh(key, token, ttlMs),
    release: (key, token) => memory.release(key, token),
  };
  return { deps, answers, asked, lines, holds, lock };
}

const ranked = (generation: number): ExploreRefresh => ({ skipped: false, generation, candidates: 10 + generation, items: generation, tookMs: 100 + generation });

describe("the Explore job", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("starts with a round at once, then runs one every five minutes, each ranking as of its own time, until stopped", async () => {
    const h = harness();
    const start = Date.now();
    const stop = startExplore(h.deps, h.lock);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.asked).toEqual([start]);
    await vi.advanceTimersByTimeAsync(INTERVAL - 1);
    expect(h.asked).toEqual([start]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.asked).toEqual([start, start + INTERVAL]);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(h.asked).toEqual([start, start + INTERVAL, start + 2 * INTERVAL]);
    stop();
    await vi.advanceTimersByTimeAsync(3 * INTERVAL);
    expect(h.asked).toHaveLength(3);
  });

  test("every round holds the shared lock job:explore-refresh for five minutes, and skips while another instance holds it", async () => {
    const h = harness();
    const job = createExploreJob(h.deps, h.lock);
    expect(await job.round()).toBe("ran");
    expect(h.holds).toEqual([{ key: "job:explore-refresh", ttlMs: INTERVAL }]);
    await h.lock.acquire("job:explore-refresh", "another instance", INTERVAL);
    expect(await job.round()).toBe("skipped");
    expect(h.asked).toHaveLength(1);
    await h.lock.release("job:explore-refresh", "another instance");
    expect(await job.round()).toBe("ran");
    expect(h.asked).toHaveLength(2);
  });

  test("a round that ranks logs one line with exactly its generation, candidates, items and milliseconds; a skipped round logs nothing", async () => {
    const h = harness();
    h.answers.push(ranked(7), { skipped: true });
    const job = createExploreJob(h.deps, h.lock);
    expect(await job.round()).toBe("ran");
    expect(h.lines).toEqual([{ level: 30, msg: "explore: ranking refreshed", generation: 7, candidates: 17, items: 7, tookMs: 107 }]);
    expect(await job.round()).toBe("ran");
    expect(h.asked).toHaveLength(2);
    expect(h.lines).toHaveLength(1);
  });

  test("a failed round at start is logged as the timer logs one, and the timer runs on; so does a failed timer round", async () => {
    const h = harness();
    h.answers.push(new Error("the database is unreachable"), ranked(1), new Error("the statement timed out"), ranked(2));
    const stop = startExplore(h.deps, h.lock);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.asked).toHaveLength(1);
    expect(h.lines).toEqual([
      expect.objectContaining({ level: 50, msg: "job: round failed", job: "explore-refresh", err: expect.objectContaining({ message: "the database is unreachable" }) }),
    ]);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(h.asked).toHaveLength(2);
    expect(h.lines.slice(1)).toEqual([{ level: 30, msg: "explore: ranking refreshed", generation: 1, candidates: 11, items: 1, tookMs: 101 }]);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(h.lines.slice(2)).toEqual([
      expect.objectContaining({ level: 50, msg: "job: round failed", job: "explore-refresh", err: expect.objectContaining({ message: "the statement timed out" }) }),
    ]);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(h.asked).toHaveLength(4);
    expect(h.lines.slice(3)).toEqual([{ level: 30, msg: "explore: ranking refreshed", generation: 2, candidates: 12, items: 2, tookMs: 102 }]);
    stop();
  });
});
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
Test Files  2 failed | 45 passed | 39 skipped (86)
Tests  436 passed | 267 skipped (703)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/explore-2c/write_blocks.py docs/superpowers/prompts/explore-2c/02-ranking.md 3
```

Expected: 4 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/social/explore.ts`

```ts
import { EXPLORE_V1 } from "@korbat/contracts";
import { createJob, type JobLock } from "../lib/jobs";
import type { SocialDeps } from "./context";

/** The job's name; its rounds run under the shared lock job:explore-refresh. */
const NAME = "explore-refresh";

/** A round every refresh interval of the published formula (5 minutes); the lock outlives a crash by as long. */
const INTERVAL_MS = EXPLORE_V1.refreshMinutes * 60_000;

/**
 * The Explore refresh as a job (2c design, section 9): one instance at a time, a round every five minutes, each ranking
 * as of the clock's time. A round that writes a ranking logs one line with its generation, candidates, items and
 * milliseconds, and nothing about any post; a round that skipped, because the newest ranking is younger than the
 * formula's minimum gap, logs nothing.
 */
export function createExploreJob(deps: SocialDeps, lock: JobLock) {
  return createJob({
    name: NAME,
    intervalMs: INTERVAL_MS,
    lockTtlMs: INTERVAL_MS,
    lock,
    log: deps.log,
    run: async () => {
      const result = await deps.repo.refreshExplore(deps.now());
      if (!result.skipped) {
        deps.log.info({ generation: result.generation, candidates: result.candidates, items: result.items, tookMs: result.tookMs }, "explore: ranking refreshed");
      }
    },
  });
}

/**
 * Runs a round at once, so Explore is filled on a new database or after downtime without waiting an interval, then
 * starts the timer, and returns the function that stops it. The timer catches and logs the failures of its own rounds;
 * this first one is caught here and logged the same way, so a failure at start never crashes the process and the timer
 * runs on. A failed round leaves the previous ranking in place.
 */
export function startExplore(deps: SocialDeps, lock: JobLock): () => void {
  const job = createExploreJob(deps, lock);
  void job.round().catch((err: unknown) => deps.log.error({ err, job: NAME }, "job: round failed"));
  return job.start();
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

### Replace `apps/api/src/social/index.ts` (whole file)

```ts
/**
 * The only file outside `src/social/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { Db, DbTx } from "@korbat/db";
import type { AppEnv } from "../env";
import type { JobLock } from "../lib/jobs";
import type { MediaForPosts } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import { WITHOUT_MEDIA, type SocialDeps, type SocialEvents } from "./context";
import { startExplore } from "./explore";
import { exportProfile, type ProfileExport } from "./flows/export";
import { createSocialRepo } from "./repo";
import { socialRoutes } from "./routes";

export { SocialError } from "./context";
export { enforceWriteLimit } from "./limits";
export type { SocialDeps, SocialEvents, ViewerId } from "./context";
export type { ExportedMedia, ExportedPost, ProfileExport } from "./flows/export";

/** What the account module needs from this one (1b design, section 5): the purge of a deleted account, and the data export. */
export interface SocialForAccount {
  /**
   * One transaction that tombstones every post, removes the engagement and graph rows with their
   * counters and anonymises the profile row, keeping its handle; `within` runs inside it, for the
   * media rows. Safe to repeat: a second run changes nothing.
   */
  purgeProfile(userId: string, now: Date, within: (tx: DbTx) => Promise<void>): Promise<void>;
  /**
   * The profile, read at once, and its posts with their images, its engagement and its side of the graph,
   * each read in keyset pages of `pageSize` rows (1,000 unless a test says otherwise) as it is iterated.
   */
  exportProfile(userId: string, pageSize?: number): Promise<ProfileExport>;
}

export interface CreateSocialOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** Per-account write limits share the store the per-IP middleware uses. */
  rateLimitStore: RateLimitStore;
  logger: Logger;
  /** The auth module's requireSession: an onboarded account with CSRF and Origin checked. */
  requireSession: MiddlewareHandler<AppEnv>;
  /** The auth module's requireFreshAuth: a credential proven in the last five minutes, which a handle change needs on top. */
  requireFreshAuth: MiddlewareHandler<AppEnv>;
  /** The auth module's appendEvent, so profile and handle changes land in auth_events. Without it nothing is recorded (the 2a tests). */
  events?: SocialEvents;
  /** The media module's interface for posts. Without it posts carry no images. */
  media?: MediaForPosts;
  now?: () => Date;
}

export function createSocial(options: CreateSocialOptions) {
  const deps: SocialDeps = {
    repo: createSocialRepo(options.apiDb),
    media: options.media ?? WITHOUT_MEDIA,
    limits: options.rateLimitStore,
    log: options.logger,
    now: options.now ?? (() => new Date()),
    events: options.events,
  };
  const forAccount: SocialForAccount = {
    purgeProfile: (userId, now, within) => deps.repo.purgeProfile(userId, now, within),
    exportProfile: (userId, pageSize) => exportProfile(deps, userId, pageSize),
  };
  return {
    deps,
    /** The interface the account module uses. */
    forAccount,
    routes: socialRoutes(deps, options.requireSession, options.requireFreshAuth),
    /**
     * Starts the Explore refresh under the shared job lock: a round at once, then one every five minutes. Returns the
     * function that stops the timer.
     */
    startExplore: (lock: JobLock) => startExplore(deps, lock),
  };
}

export type Social = ReturnType<typeof createSocial>;
```

### Replace `apps/api/src/social/repo.ts` (whole file)

```ts
import { and, eq, isNull, ne, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { EXPLORE_V1, type ExploreFormula } from "@korbat/contracts";
import { blocks, bookmarks, follows, handleHistory, likes, mutes, posts, profiles, reposts, type Db, type DbTx } from "@korbat/db";
import { isUniqueViolation } from "../auth";
import { SocialError } from "./context";
import type { Cursor } from "./cursor";
import type { StoredPostState } from "./visibility";

/**
 * Every SQL statement of the social module, through the korbat_api pool.
 *
 * Two rules keep the counters and the pagination exact:
 * - every counter changes in the same transaction as the action, by the number of rows the action
 *   really inserted or deleted, so repeating an action never double-counts;
 * - every timestamp is passed in from the clock (millisecond precision) instead of the database
 *   default, so a keyset cursor built from a row round-trips exactly.
 *
 * Reads take the viewer (or null when signed out) and apply the visibility rule in SQL: others see
 * only visible posts, the author also sees their own withheld and removed posts, a block in either
 * direction hides an author entirely, and mutes apply to timelines only.
 *
 * Reads are raw SQL through `db.execute`, which returns timestamps as text and expands a JavaScript
 * array into a parameter list. So timestamps are formatted as ISO text in SQL and parsed once in
 * the row mappers, and id lists travel as one comma-joined parameter split back into a uuid array.
 */

export interface AuthorRow {
  id: string;
  handle: string;
  displayName: string;
  verified: boolean;
}

export interface PostRow {
  id: string;
  authorId: string;
  body: string;
  replyToId: string | null;
  quoteOfId: string | null;
  state: StoredPostState;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  quoteCount: number;
  createdAt: Date;
  deletedAt: Date | null;
  author: AuthorRow;
  replyToHandle: string | null;
  /** The parent's author and state, so a view can decide whether the viewer may learn the handle. */
  replyToAuthorId: string | null;
  replyToState: StoredPostState | null;
}

/** One line of a list: which post, when it sorts, and who reposted it (timelines only). */
export interface ListRow {
  postId: string;
  sortAt: Date;
  reposterId: string | null;
}

export interface ProfileRow {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  verified: boolean;
  followerCount: number;
  followingCount: number;
  postCount: number;
  createdAt: Date;
  /** When the handle last changed after onboarding, null until then; the next change waits 30 days. */
  handleChangedAt: Date | null;
}

/** How a handle change ended: the handle the profile had before, or why nothing was written. */
export type HandleChangeResult = { ok: true; from: string } | { ok: false; reason: "not_found" | "unchanged" | "handle_taken" };

/** A post as its author wrote it, for the data export; a deleted one keeps its row with an empty body and its deletion time. */
export interface ExportedPostRow {
  id: string;
  body: string;
  createdAt: Date;
  replyToId: string | null;
  quoteOfId: string | null;
  state: StoredPostState;
  deletedAt: Date | null;
}

/** Something the account did to a post (a like, a repost, a bookmark), and when. */
export interface PostRefRow {
  postId: string;
  at: Date;
}

/** The other side of a graph relation by the handle it has now (nothing else about them), and since when. */
export interface HandleRefRow {
  handle: string;
  since: Date;
}

/**
 * Where a page of the data export ends: the last row's created_at to the microsecond, as ISO text, and its
 * id (the post's, or the other account's). The next page starts after it. The microseconds matter: a row
 * written by a database default carries them, and a key cut to the millisecond would read such rows twice
 * or skip them.
 */
export interface ExportKey {
  at: string;
  id: string;
}

/** One page of a list for the data export, and the key to read the next one after, or null when this page was the last. */
export interface ExportPage<T> {
  rows: T[];
  next: ExportKey | null;
}

export interface Relation {
  following: boolean;
  followedBy: boolean;
  /** The viewer blocks the other account. */
  blocked: boolean;
  /** The other account blocks the viewer. */
  blockedBy: boolean;
  muted: boolean;
}

export interface ViewerPostRow {
  liked: boolean;
  reposted: boolean;
  bookmarked: boolean;
}

export interface ProfileListRow {
  profileId: string;
  sortAt: Date;
}

/**
 * What a round of the Explore refresh did: nothing, because the newest ranking is younger than the formula's minimum
 * gap, or a new ranking under `generation` with the posts that passed the candidate predicate, the posts it holds and
 * the milliseconds it took.
 */
export type ExploreRefresh = { skipped: true } | { skipped: false; generation: number; candidates: number; items: number; tookMs: number };

export const MAX_ANCESTORS = 50;
const NO_REPOSTER = "00000000-0000-0000-0000-000000000000";

interface RawPost {
  id: string;
  author_id: string;
  body: string;
  reply_to_id: string | null;
  quote_of_id: string | null;
  state: StoredPostState;
  like_count: number;
  repost_count: number;
  reply_count: number;
  quote_count: number;
  created_at: string;
  deleted_at: string | null;
  author_handle: string;
  author_display_name: string;
  author_verified: boolean;
  reply_to_handle: string | null;
  reply_to_author_id: string | null;
  reply_to_state: StoredPostState | null;
}

interface RawListRow {
  post_id: string;
  sort_at: string;
  reposter_id: string | null;
}

interface RawProfileListRow {
  profile_id: string;
  sort_at: string;
}

interface RawProfile {
  id: string;
  handle: string;
  display_name: string;
  bio: string;
  verified: boolean;
  follower_count: number;
  following_count: number;
  post_count: number;
  created_at: string;
  handle_changed_at: string | null;
}

/** A timestamptz expression as ISO text with milliseconds, in UTC. The expression is a column reference written here, never input. */
const iso = (column: string): SQL => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

/** The same with the microseconds a timestamp column holds, for the export's page keys, which must round-trip exactly. */
const isoMicro = (column: string): SQL => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

/** Rows after `after` in (created_at, id) order: the keyset condition of an export page. Always true for the first page. */
const exportAfter = (after: ExportKey | null, at: SQL, id: SQL): SQL => (after ? sql`(${at}, ${id}) > (${after.at}::timestamptz, ${after.id}::uuid)` : sql`true`);

/** The page a query answered, with its next key when the page is full (a full page may be followed by more). */
function exportPage<R extends { key_at: string; key_id: string }, T>(raw: R[], limit: number, map: (row: R) => T): ExportPage<T> {
  const last = raw.at(-1);
  return { rows: raw.map(map), next: raw.length === limit && last ? { at: last.key_at, id: last.key_id } : null };
}

/** A list of ids as one parameter, split into a uuid array in SQL. */
const uuidArray = (ids: string[]): SQL => sql`string_to_array(${ids.join(",")}, ',')::uuid[]`;

const toPost = (r: RawPost): PostRow => ({
  id: r.id,
  authorId: r.author_id,
  body: r.body,
  replyToId: r.reply_to_id,
  quoteOfId: r.quote_of_id,
  state: r.state,
  likeCount: r.like_count,
  repostCount: r.repost_count,
  replyCount: r.reply_count,
  quoteCount: r.quote_count,
  createdAt: new Date(r.created_at),
  deletedAt: r.deleted_at ? new Date(r.deleted_at) : null,
  author: { id: r.author_id, handle: r.author_handle, displayName: r.author_display_name, verified: r.author_verified },
  replyToHandle: r.reply_to_handle,
  replyToAuthorId: r.reply_to_author_id,
  replyToState: r.reply_to_state,
});

const toListRow = (r: RawListRow): ListRow => ({ postId: r.post_id, sortAt: new Date(r.sort_at), reposterId: r.reposter_id });

const toProfileListRow = (r: RawProfileListRow): ProfileListRow => ({ profileId: r.profile_id, sortAt: new Date(r.sort_at) });

const toProfile = (r: RawProfile): ProfileRow => ({
  id: r.id,
  handle: r.handle,
  displayName: r.display_name,
  bio: r.bio,
  verified: r.verified,
  followerCount: r.follower_count,
  followingCount: r.following_count,
  postCount: r.post_count,
  createdAt: new Date(r.created_at),
  handleChangedAt: r.handle_changed_at ? new Date(r.handle_changed_at) : null,
});

/** `p` is the posts alias in every read below. */
const visibleTo = (viewer: string | null): SQL =>
  viewer === null
    ? sql`p.state = 'visible'`
    : sql`(p.state = 'visible' or (p.author_id = ${viewer}::uuid and p.state in ('withheld', 'removed')))`;

/** No block in either direction between the viewer and the author of `p`. */
const authorNotBlocked = (viewer: string | null): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id = p.author_id) or (b.blocked_id = ${viewer}::uuid and b.blocker_id = p.author_id))`;

/** No block in either direction with the author or the reposter of a timeline item `i`. */
const itemNotBlocked = (viewer: string | null): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id in (i.author_id, i.reposter_id)) or (b.blocked_id = ${viewer}::uuid and b.blocker_id in (i.author_id, i.reposter_id)))`;

const itemNotMuted = (viewer: string | null): SQL =>
  viewer === null ? sql`true` : sql`not exists (select 1 from mutes m where m.muter_id = ${viewer}::uuid and m.muted_id in (i.author_id, i.reposter_id))`;

/** Raw queries take timestamps as ISO text, never as Date objects. */
const at = (cursor: Cursor): string => new Date(cursor.t).toISOString();

const before = (cursor: Cursor | undefined, sortAt: SQL, id: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid)` : sql`true`;

const after = (cursor: Cursor | undefined, sortAt: SQL, id: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}) > (${at(cursor)}::timestamptz, ${cursor.id}::uuid)` : sql`true`;

const beforeItem = (cursor: Cursor | undefined): SQL =>
  cursor
    ? sql`(i.sort_at, i.post_id, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid)) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid, ${cursor.r ?? NO_REPOSTER}::uuid)`
    : sql`true`;

const POST_COLUMNS = sql`p.id, p.author_id, p.body, p.reply_to_id, p.quote_of_id, p.state, p.like_count, p.repost_count, p.reply_count, p.quote_count,
  ${iso("p.created_at")} as created_at, ${iso("p.deleted_at")} as deleted_at,
  a.handle as author_handle, a.display_name as author_display_name, (a.verified_at is not null) as author_verified,
  rp.handle as reply_to_handle, pp.author_id as reply_to_author_id, pp.state as reply_to_state`;
const POST_JOINS = sql`from posts p join profiles a on a.id = p.author_id left join posts pp on pp.id = p.reply_to_id left join profiles rp on rp.id = pp.author_id`;
const PROFILE_SELECT = sql`select id, handle, display_name, bio, (verified_at is not null) as verified, follower_count, following_count, post_count, ${iso("created_at")} as created_at, ${iso("handle_changed_at")} as handle_changed_at from profiles`;

/** No block in either direction between the viewer and the account `other` names (a column reference). */
const otherNotBlocked = (viewer: string | null, other: SQL): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id = ${other}) or (b.blocked_id = ${viewer}::uuid and b.blocker_id = ${other}))`;

/** The viewer neither blocks, is blocked by, nor mutes the account `other` names. */
const otherWelcome = (viewer: string, other: SQL): SQL =>
  sql`${otherNotBlocked(viewer, other)} and not exists (select 1 from mutes m where m.muter_id = ${viewer}::uuid and m.muted_id = ${other})`;

/** A keyset bound on the three sort columns of a timeline branch. */
const beforeTriple = (cursor: Cursor | undefined, sortAt: SQL, id: SQL, reposter: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}, ${reposter}) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid, ${cursor.r ?? NO_REPOSTER}::uuid)` : sql`true`;

/** The outer select of a list query whose inner query `i` carries post_id, sort_at and reposter_id. */
const LIST_COLUMNS = sql`i.post_id, ${iso("i.sort_at")} as sort_at, i.reposter_id`;

export function createSocialRepo(db: Db) {
  const rows = async <T>(query: SQL): Promise<T[]> => (await db.execute(query)) as unknown as T[];

  const bump = (column: SQLWrapper, delta: 1 | -1): SQL => (delta === 1 ? sql`${column} + 1` : sql`greatest(0, ${column} - 1)`);

  const profileList = async (query: SQL): Promise<ProfileListRow[]> => (await rows<RawProfileListRow>(query)).map(toProfileListRow);

  return {
    // ------------------------------------------------------------ posts

    /**
     * `within` runs in the same transaction once the post exists, which is how its images are attached.
     * `lockWith` names the author of the post replied to or quoted: the pair is locked and a block
     * between them refused inside the transaction, so a reply cannot land across a concurrent block.
     * The author's profile row is locked and a deleted one refused (not_found), and so is the row of the
     * author of the post replied to or quoted (post_unavailable, as for a post that is gone), so no post
     * lands behind a concurrent purge of either account (lockLive).
     */
    async createPost(input: {
      authorId: string;
      body: string;
      replyToId: string | null;
      quoteOfId: string | null;
      now: Date;
      lockWith?: string | null;
      within?: (tx: DbTx, postId: string) => Promise<void>;
    }): Promise<string> {
      return db.transaction(async (tx) => {
        if (input.lockWith) await guardPair(tx, input.authorId, input.lockWith, "post_unavailable");
        await lockLive(tx, sql`id = ${input.authorId}::uuid`);
        if (input.replyToId || input.quoteOfId) {
          await lockLive(tx, sql`id in (select author_id from posts where id in (${input.replyToId}::uuid, ${input.quoteOfId}::uuid))`, "post_unavailable");
        }
        const [row] = await tx
          .insert(posts)
          .values({ authorId: input.authorId, body: input.body, replyToId: input.replyToId, quoteOfId: input.quoteOfId, createdAt: input.now })
          .returning({ id: posts.id });
        if (input.replyToId) {
          await tx.update(posts).set({ replyCount: bump(posts.replyCount, 1) }).where(eq(posts.id, input.replyToId));
        } else {
          await tx.update(profiles).set({ postCount: bump(profiles.postCount, 1) }).where(eq(profiles.id, input.authorId));
        }
        if (input.quoteOfId) await tx.update(posts).set({ quoteCount: bump(posts.quoteCount, 1) }).where(eq(posts.id, input.quoteOfId));
        await input.within?.(tx, row!.id);
        return row!.id;
      });
    },

    /** Blanks the body and marks the post deleted; adjusts the counters it contributed to. False when there was nothing to delete. `within` runs in the same transaction. */
    async deletePost(id: string, authorId: string, now: Date, within?: (tx: DbTx) => Promise<void>): Promise<boolean> {
      return db.transaction(async (tx) => {
        const [old] = await tx
          .update(posts)
          .set({ state: "deleted_by_author", deletedAt: now, body: "" })
          .where(and(eq(posts.id, id), eq(posts.authorId, authorId), ne(posts.state, "deleted_by_author")))
          .returning({ replyToId: posts.replyToId, quoteOfId: posts.quoteOfId });
        if (!old) return false;
        if (old.replyToId) {
          await tx.update(posts).set({ replyCount: bump(posts.replyCount, -1) }).where(eq(posts.id, old.replyToId));
        } else {
          await tx.update(profiles).set({ postCount: bump(profiles.postCount, -1) }).where(eq(profiles.id, authorId));
        }
        if (old.quoteOfId) await tx.update(posts).set({ quoteCount: bump(posts.quoteCount, -1) }).where(eq(posts.id, old.quoteOfId));
        await within?.(tx);
        return true;
      });
    },

    /** Posts by id with their author and the handle they reply to, in no particular order. Includes deleted and hidden posts; callers apply visibility. */
    async findPosts(ids: string[]): Promise<Map<string, PostRow>> {
      if (ids.length === 0) return new Map();
      const raw = await rows<RawPost>(sql`select ${POST_COLUMNS} ${POST_JOINS} where p.id = any(${uuidArray(ids)})`);
      return new Map(raw.map((r) => [r.id, toPost(r)]));
    },

    /** Ids of the reply chain above a post, root first, at most MAX_ANCESTORS long. */
    async ancestorIds(postId: string): Promise<string[]> {
      const raw = await rows<{ id: string }>(sql`
        with recursive chain as (
          select p.id, p.reply_to_id, 1 as depth from posts p where p.id = (select reply_to_id from posts where id = ${postId}::uuid)
          union all
          select p.id, p.reply_to_id, c.depth + 1 from posts p join chain c on p.id = c.reply_to_id where c.depth < ${MAX_ANCESTORS}
        )
        select id from chain order by depth desc`);
      return raw.map((r) => r.id);
    },

    /** Direct replies visible to the viewer, oldest first. */
    async replies(postId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("p.created_at")} as sort_at, null::uuid as reposter_id from posts p
        where p.reply_to_id = ${postId}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${after(cursor, sql`p.created_at`, sql`p.id`)}
        order by p.created_at asc, p.id asc limit ${limit}`);
      return raw.map(toListRow);
    },

    // ------------------------------------------------------------ engagement

    /**
     * `other` is the post's author when that is someone else: the pair is locked and a block refused inside the
     * transaction. The liker's and the author's profile rows are locked too and a deleted one refused, so a like
     * cannot land on an account a concurrent purge is removing (lockLive); the same goes for reposts and bookmarks.
     */
    async like(userId: string, postId: string, now: Date, other?: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (other) await guardPair(tx, userId, other, "not_found");
        await lockLive(tx, actorAndAuthor(userId, postId));
        const inserted = await tx.insert(likes).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: likes.postId });
        if (inserted.length > 0) await tx.update(posts).set({ likeCount: bump(posts.likeCount, 1) }).where(eq(posts.id, postId));
        return inserted.length > 0;
      });
    },
    async unlike(userId: string, postId: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        const deleted = await tx.delete(likes).where(and(eq(likes.userId, userId), eq(likes.postId, postId))).returning({ postId: likes.postId });
        if (deleted.length > 0) await tx.update(posts).set({ likeCount: bump(posts.likeCount, -1) }).where(eq(posts.id, postId));
        return deleted.length > 0;
      });
    },
    async repost(userId: string, postId: string, now: Date, other?: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (other) await guardPair(tx, userId, other, "not_found");
        await lockLive(tx, actorAndAuthor(userId, postId));
        const inserted = await tx.insert(reposts).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: reposts.postId });
        if (inserted.length > 0) await tx.update(posts).set({ repostCount: bump(posts.repostCount, 1) }).where(eq(posts.id, postId));
        return inserted.length > 0;
      });
    },
    async unrepost(userId: string, postId: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        const deleted = await tx.delete(reposts).where(and(eq(reposts.userId, userId), eq(reposts.postId, postId))).returning({ postId: reposts.postId });
        if (deleted.length > 0) await tx.update(posts).set({ repostCount: bump(posts.repostCount, -1) }).where(eq(posts.id, postId));
        return deleted.length > 0;
      });
    },
    async bookmark(userId: string, postId: string, now: Date): Promise<boolean> {
      // A transaction of its own only for the lock: a bookmark counts nothing, but it must not outlive a purge of either account.
      return db.transaction(async (tx) => {
        await lockLive(tx, actorAndAuthor(userId, postId));
        const inserted = await tx.insert(bookmarks).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: bookmarks.postId });
        return inserted.length > 0;
      });
    },
    async unbookmark(userId: string, postId: string): Promise<boolean> {
      const deleted = await db.delete(bookmarks).where(and(eq(bookmarks.userId, userId), eq(bookmarks.postId, postId))).returning({ postId: bookmarks.postId });
      return deleted.length > 0;
    },

    /** Whether the viewer liked, reposted or bookmarked each post. Missing ids are all false. */
    async viewerPostStates(viewer: string, postIds: string[]): Promise<Map<string, ViewerPostRow>> {
      const states = new Map(postIds.map((id) => [id, { liked: false, reposted: false, bookmarked: false }]));
      if (postIds.length === 0) return states;
      const raw = await rows<{ post_id: string; kind: "l" | "r" | "b" }>(sql`
        select post_id, 'l' as kind from likes where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})
        union all select post_id, 'r' from reposts where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})
        union all select post_id, 'b' from bookmarks where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})`);
      for (const r of raw) {
        const state = states.get(r.post_id)!;
        if (r.kind === "l") state.liked = true;
        else if (r.kind === "r") state.reposted = true;
        else state.bookmarked = true;
      }
      return states;
    },

    // ------------------------------------------------------------ graph

    /**
     * With `guard`, the pair is locked and a block refused inside the transaction, so a follow cannot land across a
     * concurrent block. Both profile rows are locked and a deleted one refused either way, so a follow cannot land
     * on an account a concurrent purge is removing and stay behind it (lockLive).
     */
    async follow(followerId: string, followeeId: string, now: Date, guard = false): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (guard) await guardPair(tx, followerId, followeeId, "not_found");
        await lockLive(tx, sql`id in (${followerId}::uuid, ${followeeId}::uuid)`);
        const inserted = await tx.insert(follows).values({ fromId: followerId, toId: followeeId, createdAt: now }).onConflictDoNothing().returning({ toId: follows.toId });
        if (inserted.length > 0) {
          await tx.update(profiles).set({ followerCount: bump(profiles.followerCount, 1) }).where(eq(profiles.id, followeeId));
          await tx.update(profiles).set({ followingCount: bump(profiles.followingCount, 1) }).where(eq(profiles.id, followerId));
        }
        return inserted.length > 0;
      });
    },
    async unfollow(followerId: string, followeeId: string): Promise<boolean> {
      return db.transaction(async (tx) => removeFollow(tx, followerId, followeeId));
    },

    /**
     * Blocks and, in the same transaction, removes follows, reposts and likes in both directions, so
     * neither account keeps amplifying or counting on the other. False when the block already existed.
     * Both profile rows are locked and a deleted one refused, so a block cannot land behind a concurrent
     * purge of either account (lockLive).
     */
    async block(blockerId: string, blockedId: string, now: Date): Promise<boolean> {
      return db.transaction(async (tx) => {
        await pairLock(tx, blockerId, blockedId);
        await lockLive(tx, sql`id in (${blockerId}::uuid, ${blockedId}::uuid)`);
        const inserted = await tx.insert(blocks).values({ fromId: blockerId, toId: blockedId, createdAt: now }).onConflictDoNothing().returning({ toId: blocks.toId });
        await removeFollow(tx, blockerId, blockedId);
        await removeFollow(tx, blockedId, blockerId);
        await retractEngagement(tx, blockedId, blockerId);
        await retractEngagement(tx, blockerId, blockedId);
        return inserted.length > 0;
      });
    },
    async unblock(blockerId: string, blockedId: string): Promise<boolean> {
      const deleted = await db.delete(blocks).where(and(eq(blocks.fromId, blockerId), eq(blocks.toId, blockedId))).returning({ toId: blocks.toId });
      return deleted.length > 0;
    },
    /** A transaction of its own only for the lock: a mute counts nothing, but it must not outlive a purge of either account (lockLive). */
    async mute(muterId: string, mutedId: string, now: Date): Promise<boolean> {
      return db.transaction(async (tx) => {
        await lockLive(tx, sql`id in (${muterId}::uuid, ${mutedId}::uuid)`);
        const inserted = await tx.insert(mutes).values({ fromId: muterId, toId: mutedId, createdAt: now }).onConflictDoNothing().returning({ toId: mutes.toId });
        return inserted.length > 0;
      });
    },
    async unmute(muterId: string, mutedId: string): Promise<boolean> {
      const deleted = await db.delete(mutes).where(and(eq(mutes.fromId, muterId), eq(mutes.toId, mutedId))).returning({ toId: mutes.toId });
      return deleted.length > 0;
    },

    async relation(viewer: string, other: string): Promise<Relation> {
      const [r] = await rows<Relation>(sql`select
        exists(select 1 from follows where follower_id = ${viewer}::uuid and followee_id = ${other}::uuid) as "following",
        exists(select 1 from follows where follower_id = ${other}::uuid and followee_id = ${viewer}::uuid) as "followedBy",
        exists(select 1 from blocks where blocker_id = ${viewer}::uuid and blocked_id = ${other}::uuid) as "blocked",
        exists(select 1 from blocks where blocker_id = ${other}::uuid and blocked_id = ${viewer}::uuid) as "blockedBy",
        exists(select 1 from mutes where muter_id = ${viewer}::uuid and muted_id = ${other}::uuid) as "muted"`);
      return r!;
    },

    /** Of the given accounts, those with a block in either direction with the viewer. */
    async blockedEitherWay(viewer: string, otherIds: string[]): Promise<Set<string>> {
      if (otherIds.length === 0) return new Set();
      const raw = await rows<{ other: string }>(sql`
        select blocked_id as other from blocks where blocker_id = ${viewer}::uuid and blocked_id = any(${uuidArray(otherIds)})
        union select blocker_id from blocks where blocked_id = ${viewer}::uuid and blocker_id = any(${uuidArray(otherIds)})`);
      return new Set(raw.map((r) => r.other));
    },

    /** Accounts with a block in either direction with the viewer are left out before the page is cut, so pages stay full. */
    followers(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select f.follower_id as profile_id, ${iso("f.created_at")} as sort_at from follows f
        where f.followee_id = ${profileId}::uuid and ${otherNotBlocked(viewer, sql`f.follower_id`)} and ${before(cursor, sql`f.created_at`, sql`f.follower_id`)}
        order by f.created_at desc, f.follower_id desc limit ${limit}`);
    },
    following(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select f.followee_id as profile_id, ${iso("f.created_at")} as sort_at from follows f
        where f.follower_id = ${profileId}::uuid and ${otherNotBlocked(viewer, sql`f.followee_id`)} and ${before(cursor, sql`f.created_at`, sql`f.followee_id`)}
        order by f.created_at desc, f.followee_id desc limit ${limit}`);
    },
    blockedList(userId: string, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select b.blocked_id as profile_id, ${iso("b.created_at")} as sort_at from blocks b
        where b.blocker_id = ${userId}::uuid and ${before(cursor, sql`b.created_at`, sql`b.blocked_id`)}
        order by b.created_at desc, b.blocked_id desc limit ${limit}`);
    },
    mutedList(userId: string, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select m.muted_id as profile_id, ${iso("m.created_at")} as sort_at from mutes m
        where m.muter_id = ${userId}::uuid and ${before(cursor, sql`m.created_at`, sql`m.muted_id`)}
        order by m.created_at desc, m.muted_id desc limit ${limit}`);
    },
    /** Of the given accounts, those the viewer follows. */
    async followedBy(viewer: string, ids: string[]): Promise<Set<string>> {
      if (ids.length === 0) return new Set();
      const raw = await rows<{ id: string }>(sql`select followee_id as id from follows where follower_id = ${viewer}::uuid and followee_id = any(${uuidArray(ids)})`);
      return new Set(raw.map((r) => r.id));
    },

    // ------------------------------------------------------------ timelines and lists

    /**
     * Top-level posts and quotes by followed accounts and the viewer, plus their reposts; blocks and mutes
     * apply to author and reposter. Each branch applies the cursor, the filters and the limit itself, so
     * only two small sorted sets meet in the union instead of everything the followed accounts ever wrote.
     */
    async followingTimeline(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        with f as (select followee_id as id from follows where follower_id = ${viewer}::uuid union select ${viewer}::uuid),
        own as (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.author_id in (select id from f) and p.reply_to_id is null and ${visibleTo(viewer)}
            and ${otherWelcome(viewer, sql`p.author_id`)} and ${beforeTriple(cursor, sql`p.created_at`, sql`p.id`, sql`${NO_REPOSTER}::uuid`)}
          order by p.created_at desc, p.id desc limit ${limit}
        ),
        shared as (
          select r.post_id, r.created_at as sort_at, r.user_id as reposter_id, p.author_id
          from reposts r join posts p on p.id = r.post_id where r.user_id in (select id from f) and p.state = 'visible'
            and ${otherWelcome(viewer, sql`p.author_id`)} and ${otherWelcome(viewer, sql`r.user_id`)}
            and ${beforeTriple(cursor, sql`r.created_at`, sql`r.post_id`, sql`r.user_id`)}
          order by r.created_at desc, r.post_id desc, r.user_id desc limit ${limit}
        ),
        i as (select * from own union all select * from shared)
        select ${LIST_COLUMNS} from i
        order by i.sort_at desc, i.post_id desc, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid) desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** Every visible top-level post and quote, newest first; a signed-in viewer's blocks and mutes apply. */
    async latestTimeline(viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select ${LIST_COLUMNS} from (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.reply_to_id is null and ${visibleTo(viewer)}
        ) i
        where ${itemNotBlocked(viewer)} and ${itemNotMuted(viewer)} and ${beforeItem(cursor)}
        order by i.sort_at desc, i.post_id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** An account's top-level posts, quotes and reposts. The caller has already checked the viewer may see the account. */
    async profilePosts(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        with i as (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.author_id = ${profileId}::uuid and p.reply_to_id is null and ${visibleTo(viewer)}
          union all
          select r.post_id, r.created_at, r.user_id, p.author_id
          from reposts r join posts p on p.id = r.post_id where r.user_id = ${profileId}::uuid and p.state = 'visible'
        )
        select ${LIST_COLUMNS} from i
        where ${itemNotBlocked(viewer)} and ${beforeItem(cursor)}
        order by i.sort_at desc, i.post_id desc, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid) desc limit ${limit}`);
      return raw.map(toListRow);
    },

    async profileReplies(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("p.created_at")} as sort_at, null::uuid as reposter_id from posts p
        where p.author_id = ${profileId}::uuid and p.reply_to_id is not null and ${visibleTo(viewer)} and ${before(cursor, sql`p.created_at`, sql`p.id`)}
        order by p.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** The viewer's likes, newest like first; posts they may no longer see are omitted. */
    async likedPosts(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("l.created_at")} as sort_at, null::uuid as reposter_id from likes l join posts p on p.id = l.post_id
        where l.user_id = ${viewer}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${before(cursor, sql`l.created_at`, sql`p.id`)}
        order by l.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },
    async bookmarkedPosts(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("b.created_at")} as sort_at, null::uuid as reposter_id from bookmarks b join posts p on p.id = b.post_id
        where b.user_id = ${viewer}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${before(cursor, sql`b.created_at`, sql`p.id`)}
        order by b.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    // ------------------------------------------------------------ explore

    /**
     * One round of the Explore refresh (2c design, section 7): a new ranking as of `asOf`, written by one statement that
     * takes every number of the formula as a parameter, in a transaction that gives up after 30 seconds of work or 5 of
     * waiting on a lock. The round writes nothing while the newest ranking is younger than the formula's minimum gap, so
     * at most one ranking lands per interval however many instances run the job or restart. The newest `kept` rankings
     * stay, so a reader paging through the one before the current one can finish; older ones go with their items.
     *
     * The statement's CTEs: `c` the candidates (visible top-level posts that are not quotes, by live authors who have not
     * switched Explore off, created in the window up to `asOf`), the one candidate predicate, where later rules about
     * imports, suspension and restoration belong; `e` the engagement that counts (likes and reposts in the window that
     * have stood long enough, by live accounts other than the author that were old enough when they engaged); `ap` the
     * approving accounts per post, each counted once however it engaged, keeping the posts that reach the threshold; `s`
     * the score, approvers over (hours since posted, never negative, + offset) ^ gravity; `r` each author's posts
     * numbered by score, a level of its own because a window cannot order by an alias of its own select; `k` the posts
     * within the per-author cap, numbered by score from 1 and cut at the list length, a tie going to the higher post id;
     * `ins` the items. Nothing about a post but its place is stored, and nothing about any post is answered or logged.
     */
    async refreshExplore(asOf: Date, formula: ExploreFormula = EXPLORE_V1): Promise<ExploreRefresh> {
      const started = performance.now();
      const at = sql`${asOf.toISOString()}::timestamptz`;
      // Durations built in SQL from the formula's numbers, so each number travels as a parameter.
      const hours = (n: number): SQL => sql`(${n}::float8 * interval '1 hour')`;
      const minutes = (n: number): SQL => sql`(${n}::float8 * interval '1 minute')`;
      const since = sql`${at} - ${hours(formula.windowHours)}`;
      const settled = sql`${at} - ${minutes(formula.standingMinutes)}`;
      return db.transaction(async (tx): Promise<ExploreRefresh> => {
        // Settings of this transaction only: every statement below runs on the connection the transaction holds.
        await tx.execute(sql`set local statement_timeout = '30s'`);
        await tx.execute(sql`set local lock_timeout = '5s'`);
        // A ranking later than the minimum gap before `asOf` (one from an instance whose clock runs ahead included) is fresh: the round ends having written nothing.
        const [recent] = (await tx.execute(sql`select exists (select 1 from explore_runs where as_of > ${at} - ${minutes(formula.minGapMinutes)}) as fresh`)) as unknown as { fresh: boolean }[];
        if (recent!.fresh) return { skipped: true };
        // The counts are written once the statement below has them; until the commit nobody sees this row.
        const [run] = (await tx.execute(sql`
          insert into explore_runs (as_of, formula, candidates, items, took_ms) values (${at}, ${formula.version}, 0, 0, 0) returning generation`)) as unknown as { generation: number }[];
        const generation = run!.generation;
        const [counts] = (await tx.execute(sql`
          with c as (
            select p.id, p.author_id, p.created_at from posts p join profiles a on a.id = p.author_id
            where p.reply_to_id is null and p.quote_of_id is null and p.state = 'visible' and p.created_at > ${since} and p.created_at <= ${at}
              and a.deleted_at is null and a.show_in_explore
          ),
          e as (
            select x.post_id, x.user_id from (
              select post_id, user_id, created_at from likes where created_at > ${since} and created_at <= ${settled}
              union all
              select post_id, user_id, created_at from reposts where created_at > ${since} and created_at <= ${settled}
            ) x
            join c on c.id = x.post_id
            join profiles u on u.id = x.user_id
            where x.user_id <> c.author_id and u.deleted_at is null and u.created_at <= x.created_at - ${hours(formula.engagerMinAgeHours)}
          ),
          ap as (select post_id, count(distinct user_id)::int as approvers from e group by post_id having count(distinct user_id) >= ${formula.threshold}),
          s as (
            select c.id as post_id, c.author_id,
              ap.approvers / power(greatest(0, extract(epoch from (${at} - c.created_at))::float8 / 3600) + ${formula.offsetHours}::float8, ${formula.gravity}::float8) as score
            from ap join c on c.id = ap.post_id
          ),
          r as (select s.post_id, s.author_id, s.score, row_number() over (partition by s.author_id order by s.score desc, s.post_id desc) as author_rank from s),
          k as (
            select r.post_id, r.author_id, row_number() over (order by r.score desc, r.post_id desc) as position
            from r where r.author_rank <= ${formula.perAuthor} order by position limit ${formula.listLength}
          ),
          ins as (insert into explore_items (generation, position, post_id, author_id) select ${generation}::int, k.position, k.post_id, k.author_id from k returning 1)
          select (select count(*) from c)::int as candidates, (select count(*) from ins)::int as items`)) as unknown as { candidates: number; items: number }[];
        // From the start of the round to the end of the ranking statement, the part that grows with the data.
        const tookMs = Math.round(performance.now() - started);
        await tx.execute(sql`update explore_runs set candidates = ${counts!.candidates}, items = ${counts!.items}, took_ms = ${tookMs} where generation = ${generation}`);
        // The newest `kept` rankings stay, this one among them; the cascade takes the items of the others.
        await tx.execute(sql`delete from explore_runs where generation < (select min(generation) from (select generation from explore_runs order by generation desc limit ${formula.kept}) g)`);
        return { skipped: false, generation, candidates: counts!.candidates, items: counts!.items, tookMs };
      });
    },

    // ------------------------------------------------------------ profiles

    async findProfileByHandle(handle: string): Promise<ProfileRow | null> {
      const [r] = await rows<RawProfile>(sql`${PROFILE_SELECT} where lower(handle) = ${handle.toLowerCase()} and deleted_at is null`);
      return r ? toProfile(r) : null;
    },
    async findProfiles(ids: string[]): Promise<Map<string, ProfileRow>> {
      if (ids.length === 0) return new Map();
      const raw = await rows<RawProfile>(sql`${PROFILE_SELECT} where id = any(${uuidArray(ids)})`);
      return new Map(raw.map((r) => [r.id, toProfile(r)]));
    },

    // ------------------------------------------------------------ the owner's own profile

    /** The owner's own row, which the profile edits start from. A deleted profile is gone for its owner too. */
    async findProfileById(id: string): Promise<ProfileRow | null> {
      const [r] = await rows<RawProfile>(sql`${PROFILE_SELECT} where id = ${id}::uuid and deleted_at is null`);
      return r ? toProfile(r) : null;
    },

    /**
     * The data export's head: the live profile row and every handle in handle_history for it, in the order they
     * were recorded. Null when there is no live profile. The lists come page by page from the reads below.
     */
    async exportHead(id: string): Promise<{ profile: ProfileRow; handleHistory: string[] } | null> {
      const [r] = await rows<RawProfile>(sql`${PROFILE_SELECT} where id = ${id}::uuid and deleted_at is null`);
      if (!r) return null;
      const history = await rows<{ handle_lower: string }>(sql`select handle_lower from handle_history where profile_id = ${id}::uuid order by changed_at, handle_lower`);
      return { profile: toProfile(r), handleHistory: history.map((row) => row.handle_lower) };
    },

    /**
     * A page of every post the account wrote, whatever its state, in (created_at, id) order after `after`, for the
     * data export; a deleted one keeps its row with an empty body and its deletion time. The images of the posts
     * belong to the media module; the flow adds them.
     */
    async exportPosts(id: string, after: ExportKey | null, limit: number): Promise<ExportPage<ExportedPostRow>> {
      const raw = await rows<{ id: string; body: string; created_at: string; reply_to_id: string | null; quote_of_id: string | null; state: StoredPostState; deleted_at: string | null; key_at: string; key_id: string }>(sql`
        select id, body, ${iso("created_at")} as created_at, reply_to_id, quote_of_id, state, ${iso("deleted_at")} as deleted_at, ${isoMicro("created_at")} as key_at, id as key_id
        from posts where author_id = ${id}::uuid and ${exportAfter(after, sql`created_at`, sql`id`)} order by created_at, id limit ${limit}`);
      return exportPage(raw, limit, (row) => ({
        id: row.id,
        body: row.body,
        createdAt: new Date(row.created_at),
        replyToId: row.reply_to_id,
        quoteOfId: row.quote_of_id,
        state: row.state,
        deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
      }));
    },

    /**
     * A page of what the account liked, reposted or bookmarked, in (created_at, post id) order after `after`, for the
     * data export. The table name is one of three fixed literals, never input.
     */
    async exportPostRefs(id: string, table: "likes" | "reposts" | "bookmarks", after: ExportKey | null, limit: number): Promise<ExportPage<PostRefRow>> {
      const raw = await rows<{ post_id: string; at: string; key_at: string; key_id: string }>(sql`
        select post_id, ${iso("created_at")} as at, ${isoMicro("created_at")} as key_at, post_id as key_id from ${sql.raw(table)}
        where user_id = ${id}::uuid and ${exportAfter(after, sql`created_at`, sql`post_id`)} order by created_at, post_id limit ${limit}`);
      return exportPage(raw, limit, (row) => ({ postId: row.post_id, at: new Date(row.at) }));
    },

    /**
     * A page of the accounts the account follows, blocks or mutes, by the handle they have now (a deleted account
     * keeps its handle), in (created_at, other id) order after `after`, for the data export. The table and column
     * names are fixed literals of this function, never input.
     */
    async exportHandleRefs(id: string, table: "follows" | "blocks" | "mutes", after: ExportKey | null, limit: number): Promise<ExportPage<HandleRefRow>> {
      const [from, to] = { follows: ["follower_id", "followee_id"], blocks: ["blocker_id", "blocked_id"], mutes: ["muter_id", "muted_id"] }[table];
      const raw = await rows<{ handle: string; since: string; key_at: string; key_id: string }>(sql`
        select p.handle, ${iso("r.created_at")} as since, ${isoMicro("r.created_at")} as key_at, r.${sql.raw(to!)} as key_id
        from ${sql.raw(table)} r join profiles p on p.id = r.${sql.raw(to!)}
        where r.${sql.raw(from!)} = ${id}::uuid and ${exportAfter(after, sql`r.created_at`, sql.raw(`r.${to!}`))}
        order by r.created_at, r.${sql.raw(to!)} limit ${limit}`);
      return exportPage(raw, limit, (row) => ({ handle: row.handle, since: new Date(row.since) }));
    },

    /** Sets the display name, the bio, or both (`patch` names at least one). False when there is no such live profile. */
    async updateProfile(id: string, patch: { displayName?: string; bio?: string }): Promise<boolean> {
      const updated = await db
        .update(profiles)
        .set({ ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}), ...(patch.bio !== undefined ? { bio: patch.bio } : {}) })
        .where(and(eq(profiles.id, id), isNull(profiles.deletedAt)))
        .returning({ id: profiles.id });
      return updated.length === 1;
    },

    /**
     * Renames the profile in one transaction. Its row is locked first, so two changes by the same
     * account run one after the other and the second leaves behind the handle the first chose. The
     * new handle must be nobody else's, in profiles (any case) or in handle_history; that check is
     * one statement, so one snapshot: an account leaving a handle moves it from profiles to
     * handle_history in one transaction, and either place shows it as theirs. The handle left behind
     * is reserved in handle_history (it may be there already, from an earlier stint), then the row
     * gets the new handle and the change time. Two accounts racing for a free handle are decided by
     * the unique index on lower(handle): the loser's transaction is rolled back and answers handle_taken.
     */
    async changeHandle(id: string, to: string, now: Date): Promise<HandleChangeResult> {
      try {
        return await db.transaction(async (tx): Promise<HandleChangeResult> => {
          const [current] = (await tx.execute(sql`select handle from profiles where id = ${id}::uuid and deleted_at is null for update`)) as unknown as { handle: string }[];
          if (!current) return { ok: false, reason: "not_found" };
          if (current.handle.toLowerCase() === to) return { ok: false, reason: "unchanged" };
          const [claim] = (await tx.execute(sql`
            select exists (select 1 from profiles where lower(handle) = ${to} and id <> ${id}::uuid)
              or exists (select 1 from handle_history where handle_lower = ${to} and profile_id <> ${id}::uuid) as taken`)) as unknown as { taken: boolean }[];
          if (claim!.taken) return { ok: false, reason: "handle_taken" };
          await tx.insert(handleHistory).values({ handleLower: current.handle.toLowerCase(), profileId: id, changedAt: now }).onConflictDoNothing();
          await tx.update(profiles).set({ handle: to, handleChangedAt: now }).where(eq(profiles.id, id));
          return { ok: true, from: current.handle };
        });
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: false, reason: "handle_taken" };
        throw err;
      }
    },

    // ------------------------------------------------------------ deletion

    /**
     * Everything the account owns or is part of in this module goes in one transaction (1b design,
     * section 7.6): its posts become tombstones as after a deletion by the author, with the reply
     * counters of their parents and the quote counters of what they quoted adjusted for those not
     * tombstoned already; its likes, reposts and bookmarks go with the counters of their posts; its
     * follows go in both directions with the other side's counters; its blocks and mutes go in both
     * directions; the profile row stays, anonymised, with its handle, so the handle is never reused.
     * `within` runs in the same transaction, for the media rows. The profile row is locked first, so a
     * second purge of the same account (the request's and the job's) waits for the first and then finds
     * nothing left: every statement below changes only what is still there, so a repeat changes nothing.
     * The same lock orders the purge against every write by or about the account (a follow, like, repost,
     * bookmark, block, mute, post, reply or quote), which takes a shared lock on the row (lockLive): one that
     * comes second waits for the purge and is refused, one that comes first makes the purge wait and has what
     * it wrote removed or tombstoned here (a reply or a quote by another account stays, as one written before
     * the deletion would).
     */
    async purgeProfile(id: string, now: Date, within: (tx: DbTx) => Promise<void>): Promise<void> {
      await db.transaction(async (tx) => {
        const [row] = (await tx.execute(sql`select handle from profiles where id = ${id}::uuid for update`)) as unknown as { handle: string }[];
        // The counters come off first, from the posts about to go, in one statement each: a self-reply's parent is a post of the author's too, and a row may be written once per statement.
        await tx.execute(sql`
          update posts set reply_count = greatest(0, reply_count - c.n)
          from (select reply_to_id, count(*)::int as n from posts where author_id = ${id}::uuid and state <> 'deleted_by_author' and reply_to_id is not null group by reply_to_id) c
          where posts.id = c.reply_to_id`);
        await tx.execute(sql`
          update posts set quote_count = greatest(0, quote_count - c.n)
          from (select quote_of_id, count(*)::int as n from posts where author_id = ${id}::uuid and state <> 'deleted_by_author' and quote_of_id is not null group by quote_of_id) c
          where posts.id = c.quote_of_id`);
        await tx
          .update(posts)
          .set({ state: "deleted_by_author", deletedAt: now, body: "" })
          .where(and(eq(posts.authorId, id), ne(posts.state, "deleted_by_author")));
        await within(tx);
        // The account's own engagement, with the counters of the posts it was on; bookmarks count nothing.
        await tx.execute(sql`
          with gone as (delete from likes where user_id = ${id}::uuid returning post_id)
          update posts set like_count = greatest(0, like_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
        await tx.execute(sql`
          with gone as (delete from reposts where user_id = ${id}::uuid returning post_id)
          update posts set repost_count = greatest(0, repost_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
        await tx.delete(bookmarks).where(eq(bookmarks.userId, id));
        // The graph, both ways, with the other side's counters; the account's own counters are zeroed with the row below.
        await tx.execute(sql`
          with gone as (delete from follows where follower_id = ${id}::uuid returning followee_id)
          update profiles set follower_count = greatest(0, follower_count - c.n) from (select followee_id, count(*)::int as n from gone group by followee_id) c where profiles.id = c.followee_id`);
        await tx.execute(sql`
          with gone as (delete from follows where followee_id = ${id}::uuid returning follower_id)
          update profiles set following_count = greatest(0, following_count - c.n) from (select follower_id, count(*)::int as n from gone group by follower_id) c where profiles.id = c.follower_id`);
        await tx.delete(blocks).where(or(eq(blocks.fromId, id), eq(blocks.toId, id)));
        await tx.delete(mutes).where(or(eq(mutes.fromId, id), eq(mutes.toId, id)));
        // The handle stays on the row and is reserved in handle_history like one left behind, so nobody can take it whatever becomes of the row; it may be there already, from an earlier stint.
        if (row) await tx.insert(handleHistory).values({ handleLower: row.handle.toLowerCase(), profileId: id, changedAt: now }).onConflictDoNothing();
        // The row stays with its handle; everything else about the person goes. Only a live row is written, so a repeat leaves the deletion time alone.
        await tx
          .update(profiles)
          .set({ displayName: "Deleted account", bio: "", avatarPath: null, verifiedAt: null, followerCount: 0, followingCount: 0, postCount: 0, deletedAt: now })
          .where(and(eq(profiles.id, id), isNull(profiles.deletedAt)));
      });
    },
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Serializes the writes between two accounts for the rest of the transaction: follow, block, like,
 * repost, reply and quote all take it, so none of them can land while a block between the pair is
 * being written. The key is the unordered pair, hashed; a collision only means extra waiting.
 */
async function pairLock(tx: Tx, a: string, b: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(least(${a}, ${b})), hashtext(greatest(${a}, ${b})))`);
}

/** Takes the pair lock and refuses, with `code`, when a block exists between the two in either direction. */
async function guardPair(tx: Tx, me: string, other: string, code: "not_found" | "post_unavailable"): Promise<void> {
  if (me === other) return;
  await pairLock(tx, me, other);
  const found = await tx.execute(
    sql`select 1 from blocks where (blocker_id = ${me}::uuid and blocked_id = ${other}::uuid) or (blocker_id = ${other}::uuid and blocked_id = ${me}::uuid) limit 1`,
  );
  if (found.length > 0) throw new SocialError(code, code === "not_found" ? 404 : 400);
}

/** The profile rows an engagement is about, for lockLive: the account acting and the author of the post (one row when they are the same). */
function actorAndAuthor(userId: string, postId: string): SQL {
  return sql`id = ${userId}::uuid or id = (select author_id from posts where id = ${postId}::uuid)`;
}

/**
 * Locks the profile rows `accounts` selects for the rest of the transaction and refuses the write, with the
 * guard's `code` (not_found unless said), when one of them is deleted. The account purge holds its row `for
 * update` for its whole transaction, so a write that comes second waits and then sees the deletion, and a
 * purge that comes second waits for the write and then removes what it wrote. The lock is `for key share`,
 * the weakest that conflicts with `for update`: `for share` would also conflict with the counter updates
 * these same transactions make on the row (an update takes `for no key update`), so two follows of one
 * account at once would each hold the lock the other's update waits for, and deadlock.
 */
async function lockLive(tx: Tx, accounts: SQL, code: "not_found" | "post_unavailable" = "not_found"): Promise<void> {
  const found = (await tx.execute(sql`select deleted_at from profiles where ${accounts} for key share`)) as unknown as { deleted_at: string | null }[];
  if (found.some((row) => row.deleted_at !== null)) throw new SocialError(code, code === "not_found" ? 404 : 400);
}

/** Removes `userId`'s reposts and likes of `authorId`'s posts and takes them off the counters, in the same transaction. */
async function retractEngagement(tx: Tx, userId: string, authorId: string): Promise<void> {
  await tx.execute(sql`
    with gone as (delete from reposts r using posts p where r.post_id = p.id and r.user_id = ${userId}::uuid and p.author_id = ${authorId}::uuid returning r.post_id)
    update posts set repost_count = greatest(0, repost_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
  await tx.execute(sql`
    with gone as (delete from likes l using posts p where l.post_id = p.id and l.user_id = ${userId}::uuid and p.author_id = ${authorId}::uuid returning l.post_id)
    update posts set like_count = greatest(0, like_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
}

async function removeFollow(tx: Tx, followerId: string, followeeId: string): Promise<boolean> {
  const deleted = await tx.delete(follows).where(and(eq(follows.fromId, followerId), eq(follows.toId, followeeId))).returning({ toId: follows.toId });
  if (deleted.length > 0) {
    await tx.update(profiles).set({ followerCount: sql`greatest(0, ${profiles.followerCount} - 1)` }).where(eq(profiles.id, followeeId));
    await tx.update(profiles).set({ followingCount: sql`greatest(0, ${profiles.followingCount} - 1)` }).where(eq(profiles.id, followerId));
  }
  return deleted.length > 0;
}

export type SocialRepo = ReturnType<typeof createSocialRepo>;
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
packages/contracts test:       Tests  104 passed (104)
packages/db test:       Tests  32 passed (32)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  64 passed (64)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  440 passed | 270 skipped (710)
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
Tests  268 passed (268)
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

## Step 8: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/index.ts`
- `apps/api/src/social/explore.ts`
- `apps/api/src/social/index.ts`
- `apps/api/src/social/repo.ts`
- `apps/api/test/integration/social-explore-job.test.ts`
- `apps/api/test/integration/social-explore-ranking.test.ts`
- `apps/api/test/social/explore-job.test.ts`

## Step 9: commit

```bash
git add -A
git commit -q -m "feat(api): the Explore ranking and its job: refreshExplore ranks, in one transaction with statement and lock timeouts, the visible top-level original posts of live authors who show in Explore from the last 48 hours by their distinct eligible approving accounts with gravity decay, at most two per author and 300 places, every number of the formula a parameter; a round within 4.5 minutes of the last writes nothing and only the two newest generations stay; the explore-refresh job runs a round at start, caught, then one every five minutes, and logs only the generation, the counts and the milliseconds" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(api): the Explore ranking and its job: refreshExplore ranks, in one transaction with statement and lock timeouts, the visible top-level original posts of live authors who show in Explore from the last 48 hours by their distinct eligible approving accounts with gravity decay, at most two per author and 300 places, every number of the formula a parameter; a round within 4.5 minutes of the last writes nothing and only the two newest generations stay; the explore-refresh job runs a round at start, caught, then one every five minutes, and logs only the generation, the counts and the milliseconds`.

## Report format (mandatory)

```text
TASK 2 REPORT
Files written: <count, expected 7>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```

import { randomBytes, randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { boundLockWaits, isBoundReached } from "../../src/lib/lock-bounds";
import { createMediaRepo } from "../../src/media/repo";
import { recordIntake } from "../../src/moderation/intake";
import { boundWaits } from "../../src/moderation/standing-repo";
import { createProfileStore } from "../../src/profiles/store";
import { createSocialRepo } from "../../src/social/repo";
import { aPost, ground, moderationDeps, removeFixtures, rowCounts, suspendRowForTest, uuids } from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";

// Each wave waits for its holders to pass a start fixed a second and a half ahead, and the bound's test lets sixteen
// accounts like for some seconds: slow on a loaded machine.
vi.setConfig({ testTimeout: 180_000 });

/**
 * The closing judgment and the bound of a starved lock (3e design, section 7.2 as the review of the built code amended
 * it; review rulings database1 and database2).
 *
 * A write of an account is judged by the clock when it gets its rows, and once more by the last statement of its
 * transaction, after every lock, insert and counter update: a write that waited anywhere (for its own profile row held
 * by a decision that only locks it, for the other party's row that another transaction changes, for the post it engages
 * with held FOR UPDATE by a decision) and got through after the account's suspension started is refused and writes
 * nothing. Each scene fixes the start of a fresh account a second and a half ahead (as the migrator writes it, as
 * standing_apply would once a notice's outcome fixed it), starts a holder that keeps the row the write will wait for
 * until 300 ms after the start, and sends the write while the start is still ahead: every write of 7.3 that a suspension
 * refuses, behind each holder that can make it wait.
 *
 * A bound that lock_timeout alone sets can be outlived: a FOR UPDATE on a profile waits behind every key-share lock that
 * others' likes of the account's posts take, and a new one joins the holders without queueing behind it, while
 * lock_timeout is armed again at each wait. With a statement_timeout of the same length the statement ends at the bound.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the closing judgment of a write, and the bound of a starved lock", () => {
  let apiDb: Db;
  let writersDb: Db;
  let holdersDb: Db;
  let migrateDb: Db;
  let before: Record<string, number>;
  const made: string[] = [];

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    writersDb = createDb(config.DATABASE_URL_API, { max: 24 });
    holdersDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 10 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    before = await rowCounts(apiDb);
  });
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(writersDb), closeDb(holdersDb), closeDb(migrateDb)]);
  });

  /** How far ahead of the database's clock each scene's start is fixed. */
  const LEAD_MS = 1500;
  /** How long after the start each holder keeps its row. */
  const PAST_MS = 300;

  const profile = async () => {
    const created = await newProfile(apiDb);
    made.push(created.id);
    return created;
  };
  /** The database's clock, in epoch milliseconds. */
  const dbNow = async () => Number((await apiDb.execute<{ ms: number }>(sql`select extract(epoch from clock_timestamp()) * 1000 as ms`))[0]!.ms);

  /** Fixes the account's start LEAD_MS ahead of the database's clock, for a day: answers the start in epoch milliseconds. */
  async function startSoon(accountId: string): Promise<number> {
    await suspendRowForTest(migrateDb, accountId, { from: `${LEAD_MS} milliseconds`, until: "1 day" });
    return Number((await migrateDb.execute<{ ms: number }>(sql`select extract(epoch from suspended_from) * 1000 as ms from profiles where id = ${accountId}::uuid`))[0]!.ms);
  }

  /** A holder of one row: `lock` (and `change`, a new version of the row, when given) until the database's clock reads `untilMs`. */
  function hold(lock: SQL, change: SQL | null, untilMs: number): { locked: Promise<void>; released: Promise<void> } {
    let signal: () => void = () => undefined;
    const locked = new Promise<void>((resolve) => (signal = resolve));
    const released = holdersDb.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      await tx.execute(lock);
      if (change !== null) await tx.execute(change);
      signal();
      await tx.execute(sql`select pg_sleep(greatest(0, ${untilMs / 1000}::float8 - extract(epoch from clock_timestamp())))`);
    });
    return { locked, released };
  }

  /** What a write answered: its refusal's code, "refused" for a write that answers false, or "committed". */
  async function outcome(write: () => Promise<unknown>): Promise<string> {
    try {
      const answer = await write();
      if (answer === false) return "refused";
      const refused = answer as { ok?: boolean; reason?: string } | null;
      if (typeof refused === "object" && refused !== null && refused.ok === false) return refused.reason ?? "refused";
      return "committed";
    } catch (err) {
      return String((err as { code?: unknown }).code ?? err);
    }
  }

  type Holder = "own row, locked only" | "the other party's row, changed" | "the post, FOR UPDATE";
  type Route = "post" | "reply" | "quote" | "like" | "repost" | "bookmark" | "follow" | "profile" | "handle" | "upload" | "badge" | "rule report";
  /** The other parties of a scene: an account with a post, and an account to follow. */
  interface Parties {
    actor: { id: string; handle: string };
    other: { id: string; handle: string };
    post: string;
    followee: { id: string; handle: string };
  }

  /** One write of the route by the scene's account, through the code its route runs. */
  function writeOf(route: Route, p: Parties): () => Promise<unknown> {
    const social = createSocialRepo(writersDb);
    const now = new Date();
    switch (route) {
      case "post":
        return () => social.createPost({ authorId: p.actor.id, body: "a post", replyToId: null, quoteOfId: null, now });
      case "reply":
        return () => social.createPost({ authorId: p.actor.id, body: "a reply", replyToId: p.post, quoteOfId: null, now, lockWith: p.other.id });
      case "quote":
        return () => social.createPost({ authorId: p.actor.id, body: "a quote", replyToId: null, quoteOfId: p.post, now, lockWith: p.other.id });
      case "like":
        return () => social.like(p.actor.id, p.post, now, p.other.id);
      case "repost":
        return () => social.repost(p.actor.id, p.post, now, p.other.id);
      case "bookmark":
        return () => social.bookmark(p.actor.id, p.post, now);
      case "follow":
        return () => social.follow(p.actor.id, p.followee.id, now, true);
      case "profile":
        return () => social.updateProfile(p.actor.id, { bio: "a new bio" });
      case "handle":
        return () => social.changeHandle(p.actor.id, `h_${randomBytes(5).toString("hex")}`, now);
      case "upload":
        return () => createMediaRepo(writersDb).insertProcessing({ id: randomUUID(), ownerId: p.actor.id, now });
      case "badge":
        return () => createProfileStore(writersDb).setVerified(p.actor.id, now);
      case "rule report":
        return () => recordIntake(moderationDeps(writersDb), { ground: ground.rule(p.actor.id, "R1"), live: [aPost(p.post)] });
    }
  }

  /** The row the holder takes, and the change it makes. */
  function holderOf(holder: Holder, p: Parties, route: Route): { lock: SQL; change: SQL | null } {
    if (holder === "own row, locked only") return { lock: sql`select 1 from profiles where id = ${p.actor.id}::uuid for update`, change: null };
    if (holder === "the post, FOR UPDATE") return { lock: sql`select 1 from posts where id = ${p.post}::uuid for update`, change: null };
    const other = route === "follow" ? p.followee.id : p.other.id;
    return { lock: sql`select 1 from profiles where id = ${other}::uuid for update`, change: sql`update profiles set bio = bio where id = ${other}::uuid` };
  }

  /**
   * One scene: a fresh account and its other parties, the account's start fixed LEAD_MS ahead, the holder, and the write
   * sent while the holder has its row. Answers what the write answered, and whether it was sent before the start.
   */
  async function scene(holder: Holder, route: Route): Promise<{ scene: string; result: string; sentBeforeStart: boolean; actor: string }> {
    const [actor, other, followee] = [await profile(), await profile(), await profile()];
    const post = await createSocialRepo(apiDb).createPost({ authorId: other.id, body: "a post of the other account", replyToId: null, quoteOfId: null, now: new Date() });
    const parties: Parties = { actor, other, post, followee };
    const write = writeOf(route, parties);
    const { lock, change } = holderOf(holder, parties, route);
    const start = await startSoon(actor.id);
    const held = hold(lock, change, start + PAST_MS);
    await held.locked;
    const sent = await dbNow();
    const result = await outcome(write);
    await held.released;
    return { scene: `${route}, behind ${holder}`, result, sentBeforeStart: sent < start, actor: actor.id };
  }

  /** The scenes, BATCH at a time, each on accounts of its own. */
  async function scenes(list: readonly [Holder, Route][]) {
    const BATCH = 8;
    const results: Awaited<ReturnType<typeof scene>>[] = [];
    for (let from = 0; from < list.length; from += BATCH) results.push(...(await Promise.all(list.slice(from, from + BATCH).map(([holder, route]) => scene(holder, route)))));
    return results;
  }

  /** What a scene's account wrote: none of it may be there. */
  async function written(accountIds: readonly string[]) {
    const ids = uuids(accountIds);
    const [row] = await migrateDb.execute<Record<string, number>>(
      sql`select (select count(*)::int from posts where author_id = any(${ids})) as posts,
                 (select count(*)::int from likes where user_id = any(${ids})) as likes,
                 (select count(*)::int from reposts where user_id = any(${ids})) as reposts,
                 (select count(*)::int from bookmarks where user_id = any(${ids})) as bookmarks,
                 (select count(*)::int from follows where follower_id = any(${ids})) as follows,
                 (select count(*)::int from post_media where owner_id = any(${ids})) as uploads,
                 (select count(*)::int from intakes where reporter_id = any(${ids})) as reports,
                 (select count(*)::int from profiles where id = any(${ids}) and (bio <> '' or verified_at is not null or left(handle, 2) <> 's_')) as profiles`,
    );
    return { ...row! };
  }

  const NOTHING = { posts: 0, likes: 0, reposts: 0, bookmarks: 0, follows: 0, uploads: 0, reports: 0, profiles: 0 };
  const EVERY_ROUTE: Route[] = ["post", "reply", "quote", "like", "repost", "bookmark", "follow", "profile", "handle", "upload", "badge", "rule report"];

  test("behind a holder that only locks the account's own row (a decision about it, a refused handle change), every refused write of 7.3 that gets through after the start is refused and writes nothing", async () => {
    const results = await scenes(EVERY_ROUTE.map((route) => ["own row, locked only", route] as [Holder, Route]));
    // Each write was sent while the start was ahead, and judged then by its first statement.
    expect(results.filter((r) => !r.sentBeforeStart).map((r) => r.scene)).toEqual([]);
    // A write that answers false (the profile's edit, the badge) is refused as its route refuses it: account_suspended.
    expect(results.filter((r) => r.result !== "account_suspended" && r.result !== "refused").map((r) => `${r.scene}: ${r.result}`)).toEqual([]);
    expect(results.filter((r) => r.result === "refused").map((r) => r.scene)).toEqual(["profile, behind own row, locked only", "badge, behind own row, locked only"]);
    expect(await written(results.map((r) => r.actor))).toEqual(NOTHING);
  });

  test("behind a holder that changes the other party's row (another account's follow of it, the purge), a follow, a like, a repost, a bookmark, a reply and a quote are refused and write nothing", async () => {
    const routes: Route[] = ["follow", "like", "repost", "bookmark", "reply", "quote"];
    const results = await scenes(routes.map((route) => ["the other party's row, changed", route] as [Holder, Route]));
    expect(results.filter((r) => !r.sentBeforeStart).map((r) => r.scene)).toEqual([]);
    expect(results.filter((r) => r.result !== "account_suspended").map((r) => `${r.scene}: ${r.result}`)).toEqual([]);
    expect(await written(results.map((r) => r.actor))).toEqual(NOTHING);
  });

  test("behind a decision that holds the post FOR UPDATE, a reply, a quote, a like, a repost, a bookmark and a report under a rule are refused and write nothing", async () => {
    const routes: Route[] = ["reply", "quote", "like", "repost", "bookmark", "rule report"];
    const results = await scenes(routes.map((route) => ["the post, FOR UPDATE", route] as [Holder, Route]));
    expect(results.filter((r) => !r.sentBeforeStart).map((r) => r.scene)).toEqual([]);
    expect(results.filter((r) => r.result !== "account_suspended").map((r) => `${r.scene}: ${r.result}`)).toEqual([]);
    expect(await written(results.map((r) => r.actor))).toEqual(NOTHING);
  });

  test("a write whose start is not reached by its end commits: the closing judgment refuses nothing before a start", async () => {
    const actor = await profile();
    const other = await profile();
    const social = createSocialRepo(writersDb);
    await suspendRowForTest(migrateDb, actor.id, { from: "1 hour", until: "1 day" });
    const post = await social.createPost({ authorId: actor.id, body: "before the start", replyToId: null, quoteOfId: null, now: new Date() });
    expect(await social.follow(actor.id, other.id, new Date(), true)).toBe(true);
    expect(await social.like(actor.id, post, new Date())).toBe(true);
    expect(await social.updateProfile(actor.id, { bio: "still mine" })).toBe(true);
    expect(await createProfileStore(writersDb).setVerified(actor.id, new Date())).toBe(true);
    await createMediaRepo(writersDb).insertProcessing({ id: randomUUID(), ownerId: actor.id, now: new Date() });
    expect((await recordIntake(moderationDeps(writersDb), { ground: ground.rule(actor.id, "R1"), live: [aPost(await social.createPost({ authorId: other.id, body: "reported", replyToId: null, quoteOfId: null, now: new Date() }))] })).items).toHaveLength(1);
  });

  // ---------------------------------------------------------------- the bound

  /**
   * Sixteen accounts like and unlike a post of the subject back to back, each holding the subject's profile FOR KEY SHARE
   * while it waits for the post's counter, until `stop` is set or the cap passes. Answers the loops.
   */
  async function likers(subject: string, post: string, stop: { now: boolean }, capMs: number) {
    const pool = createDb(loadConfig().DATABASE_URL_API, { max: 17 });
    const social = createSocialRepo(pool);
    const people = [];
    for (let i = 0; i < 16; i++) people.push((await profile()).id);
    const until = Date.now() + capMs;
    const loops = people.map(async (liker) => {
      while (!stop.now && Date.now() < until) {
        // A like that fails (a deadlock with a sibling's unlike) is simply tried again: only the stream of locks matters.
        await social.like(liker, post, new Date(), subject).catch(() => false);
        await social.unlike(liker, post).catch(() => false);
      }
    });
    return { done: () => Promise.all(loops).finally(() => closeDb(pool)) };
  }

  /** A FOR UPDATE of the subject's profile under the bound `bounded` sets: how long it took, and how it ended. */
  async function boundedLock(subject: string, bounded: (tx: DbTx) => Promise<void>) {
    const started = performance.now();
    let boundMs = 0;
    let ended: unknown = null;
    try {
      await apiDb.transaction(async (tx) => {
        await bounded(tx);
        // pg_settings gives statement_timeout in milliseconds, whatever unit it was set in.
        boundMs = Number((await tx.execute<{ ms: string }>(sql`select setting as ms from pg_settings where name = 'statement_timeout'`))[0]!.ms);
        await createSocialRepo(apiDb).lockAccounts(tx, [subject], "update");
      });
    } catch (err) {
      ended = err;
    }
    return { ms: performance.now() - started, boundMs, ended };
  }

  test("a FOR UPDATE that sixteen accounts' likes of the subject's post keep starving ends at the bound a confirmed action sets (boundLockWaits), and at the reply's and the take-down's (boundWaits)", async () => {
    const subject = await profile();
    const post = await createSocialRepo(apiDb).createPost({ authorId: subject.id, body: "a post many like", replyToId: null, quoteOfId: null, now: new Date() });
    const stop = { now: false };
    // The likers stop when both locks have ended, or after a minute: the bound must end each lock long before that.
    const loops = await likers(subject.id, post, stop, 60_000);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      // A challenge with 60 seconds left and 15 waits: a bound of 4 seconds.
      const confirmed = await boundedLock(subject.id, async (tx) => {
        expect(await boundLockWaits(tx, new Date(Date.now() + 60_000), 15)).toBe(true);
      });
      const reply = await boundedLock(subject.id, (tx) => boundWaits(tx, 3000));
      for (const [name, run] of [["boundLockWaits", confirmed], ["boundWaits", reply]] as const) {
        // The bound is set on both limits, and the lock either came within it or the statement ended at it.
        expect(run.boundMs, name).toBeGreaterThan(0);
        expect(run.ms, name).toBeLessThan(run.boundMs + 1500);
        if (run.ended !== null) expect(isBoundReached(run.ended), `${name}: ${String(run.ended)}`).toBe(true);
      }
    } finally {
      stop.now = true;
      await loops.done();
    }
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    await removeFixtures(migrateDb, made.splice(0));
    // What the scenes followed, liked, reposted and bookmarked goes with the accounts; their reports' rows went with removeFixtures.
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});

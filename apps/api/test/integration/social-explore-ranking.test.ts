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

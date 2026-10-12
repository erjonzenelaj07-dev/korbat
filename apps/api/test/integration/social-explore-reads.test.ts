import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { EXPLORE_V1, ExplorePage, ExploreStatus, type ExploreFormula, type ExploreStatusKind } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { createProfileStore } from "../../src/profiles/store";
import { SocialError, type SocialDeps } from "../../src/social/context";
import { encodeExploreCursor } from "../../src/social/cursor";
import { setEngagement } from "../../src/social/flows/engagement";
import { explorePage, exploreStatus, setShowInExplore } from "../../src/social/flows/explore";
import { getPost } from "../../src/social/flows/posts";
import { profilePosts } from "../../src/social/flows/timelines";
import type { SocialRepo } from "../../src/social/repo";
import { DAY, HOUR, MINUTE, accounts, after, approvedPost, before, exploreDeps, likedBy, listed, pageIds, rank, spans } from "./explore-fixtures";
import { closeDecisions, decideForTest, leavesNoModerationRows } from "./moderation-decide";
import { newPost, newProfile } from "./social-fixtures";
import { rejection } from "./social-harness";

// Several tests here put posts into a moderation state, each through a real, confirmed decision (a staff key's enrolment
// and sign-in once, then a step-up for each): on a loaded machine that takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 30_000 });

/** This suite's past (see explore-fixtures.ts): its rankings are computed as of times in 2022, each test in a span of its own. */
const EPOCH = Date.UTC(2022, 0, 1);

describe.skipIf(!process.env.INTEGRATION)("integration: reading Explore", () => {
  let db: Db;
  let deps: SocialDeps;
  let repo: SocialRepo;
  let setNow: (at: Date) => void;
  const nextAsOf = spans(EPOCH);

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    ({ deps, repo, setNow } = exploreDeps(db));
  });
  afterAll(async () => {
    await closeDecisions();
    await closeDb(db);
  });
  // Every test starts without any ranking (the cascade empties explore_items) and reads the generations its own rounds answer.
  beforeEach(async () => {
    await db.execute(sql`delete from explore_runs`);
  });

  /** A page as a reader asks for it: twenty posts unless the test says otherwise. */
  const read = (viewer: string | null, query: { limit?: number; cursor?: string } = {}) => explorePage(deps, viewer, { limit: 20, ...query });
  const status = (viewer: string, postId: string, formula?: ExploreFormula) => exploreStatus(deps, viewer, postId, formula);
  /** A moderation state comes about only through a decision: a real, confirmed one, since the posts' guard refuses the API role any other write. */
  const setState = (postId: string, state: "withheld" | "removed") => decideForTest(db, postId, state);

  test("before the first round the page is empty, with no cursor, no time and no sign-in prompt, a cursor is not valid, and the author's status is no_ranking", async () => {
    const asOf = nextAsOf();
    const [author, reader, ...fans] = await accounts(db, asOf, 5);
    // A post that would rank, so only the missing ranking keeps the page empty.
    const id = await approvedPost(repo, author!, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
    setNow(asOf);
    const empty = { items: [], nextCursor: null, computedAt: null, signInForMore: false };
    expect(ExplorePage.parse(await read(null))).toEqual(empty);
    expect(await read(reader!.id)).toEqual(empty);
    // No ranking has been written, so no cursor this server made can name one: whatever ranking and post a cursor names,
    // it is not valid (400), never a ranking since pruned (409), which would send the reader to a current one that does not exist.
    for (const cursor of [{ g: 1, id: randomUUID() }, { g: 1, id }, { g: 2_147_483_647, id: randomUUID() }]) {
      const err = await read(reader!.id, { cursor: encodeExploreCursor(cursor) }).catch((caught: unknown) => caught);
      expect(err, JSON.stringify(cursor)).toBeInstanceOf(SocialError);
      expect(err, JSON.stringify(cursor)).toMatchObject({ code: "invalid_request", status: 400 });
    }
    expect(await status(author!.id, id)).toEqual({ status: "no_ranking", computedAt: null });
  });

  test("blocks in either direction and mutes, written after the ranking, leave a signed-in reader's pages before the limit", async () => {
    const asOf = nextAsOf();
    const [reader, blocked, blocker, muted, d, e] = await accounts(db, asOf, 6);
    const fans = await accounts(db, asOf, 6);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    // The authors the reader will not see lead the ranking: their posts are as old as the others, with more approving accounts.
    const b1 = await approvedPost(repo, blocked!, at, fans.slice(0, 6), likedAt);
    const r1 = await approvedPost(repo, blocker!, at, fans.slice(0, 5), likedAt);
    const m1 = await approvedPost(repo, muted!, at, fans.slice(0, 4), likedAt);
    const d1 = await approvedPost(repo, d!, at, fans.slice(0, 3), likedAt);
    const e1 = await approvedPost(repo, e!, at, fans.slice(0, 3), likedAt);
    const order = await listed(db, (await rank(repo, asOf)).generation);
    expect(order.slice(0, 3)).toEqual([b1, r1, m1]);
    expect(new Set(order.slice(3))).toEqual(new Set([d1, e1]));
    setNow(after(asOf, MINUTE));

    await repo.block(reader!.id, blocked!.id, deps.now());
    await repo.block(blocker!.id, reader!.id, deps.now());
    await repo.mute(reader!.id, muted!.id, deps.now());
    // A mute whose muter has a post in the ranking: d mutes muted too, which must leave d1 in muted's Explore.
    await repo.mute(d!.id, muted!.id, deps.now());
    // Two posts are left for the reader, and a page of two holds both: the filters come before the limit.
    const first = await read(reader!.id, { limit: 2 });
    expect(pageIds(first)).toEqual(order.slice(3));
    expect(first.nextCursor).not.toBeNull();
    expect(await read(reader!.id, { limit: 2, cursor: first.nextCursor! })).toEqual({ items: [], nextCursor: null, computedAt: asOf.toISOString(), signInForMore: false });
    // Only the reader's own relations count: signed out, and for the accounts on the other side, the ranking is whole. A
    // mute is its muter's alone, so the muted account still reads the posts of the accounts that mute it, d1 among them,
    // and cannot tell from Explore that it was muted.
    expect(pageIds(await read(null))).toEqual(order);
    expect(pageIds(await read(blocked!.id))).toEqual(order);
    expect(pageIds(await read(blocker!.id))).toEqual(order);
    expect(pageIds(await read(muted!.id))).toEqual(order);
  });

  test("a listed post withheld, removed or deleted after the ranking is gone from the next read, for every reader, its author included", async () => {
    const asOf = nextAsOf();
    const [a, b, c, d, ...fans] = await accounts(db, asOf, 7);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    const a1 = await approvedPost(repo, a!, at, fans, likedAt);
    const b1 = await approvedPost(repo, b!, at, fans, likedAt);
    const c1 = await approvedPost(repo, c!, at, fans, likedAt);
    const d1 = await approvedPost(repo, d!, at, fans, likedAt);
    const g = (await rank(repo, asOf)).generation;
    expect(new Set(await listed(db, g))).toEqual(new Set([a1, b1, c1, d1]));
    setNow(after(asOf, MINUTE));

    await setState(a1, "withheld");
    await setState(b1, "removed");
    expect(await repo.deletePost(c1, c!.id, deps.now())).toBe(true);
    expect(pageIds(await read(null))).toEqual([d1]);
    // Unlike Latest, where an author still sees their own withheld post, Explore leaves it out for its author as well.
    for (const reader of [a!, b!, c!, d!]) expect(pageIds(await read(reader.id)), reader.handle).toEqual([d1]);
    // Only the read changed: the ranking holds the four until the next round.
    expect(new Set(await listed(db, g))).toEqual(new Set([a1, b1, c1, d1]));
  });

  test("an author who switches Explore off, or whose account is deleted, leaves the next read, before any further round", async () => {
    const asOf = nextAsOf();
    const [a, b, c, ...fans] = await accounts(db, asOf, 6);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    const a1 = await approvedPost(repo, a!, at, fans, likedAt);
    const b1 = await approvedPost(repo, b!, at, fans, likedAt);
    const c1 = await approvedPost(repo, c!, at, fans, likedAt);
    const g = (await rank(repo, asOf)).generation;
    setNow(after(asOf, MINUTE));

    expect(await setShowInExplore(deps, a!.id, false)).toEqual({ showInExplore: false });
    // Marked deleted as the purge's last statement marks it, with the post left visible, so only the deletion keeps it out.
    await db.execute(sql`update profiles set deleted_at = ${deps.now().toISOString()}::timestamptz where id = ${b!.id}::uuid`);
    expect(pageIds(await read(null))).toEqual([c1]);
    expect(pageIds(await read(a!.id))).toEqual([c1]);
    expect(pageIds(await read(c!.id))).toEqual([c1]);
    expect(new Set(await listed(db, g))).toEqual(new Set([a1, b1, c1]));

    // The switch answers as it now stands and is what /me's profile store reads; turning it twice changes nothing more,
    // and an account that is gone, or never was, has no switch to turn.
    expect(await setShowInExplore(deps, a!.id, false)).toEqual({ showInExplore: false });
    expect((await createProfileStore(db).find(a!.id))!.showInExplore).toBe(false);
    expect(await setShowInExplore(deps, a!.id, true)).toEqual({ showInExplore: true });
    expect((await createProfileStore(db).find(a!.id))!.showInExplore).toBe(true);
    expect(await rejection(setShowInExplore(deps, b!.id, false))).toBe("not_found");
    expect(await rejection(setShowInExplore(deps, randomUUID(), true))).toBe("not_found");
  });

  test("a reader paging through a ranking while a new one lands finishes the one they started, with no repeats and no gaps", async () => {
    const asOf = nextAsOf();
    const [reader, a, b, c, d, e, f] = await accounts(db, asOf, 7);
    const fans = await accounts(db, asOf, 8);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    // Five posts of one age, in the order of their approving accounts: 7, 6, 5, 4 and 3.
    const five: string[] = [];
    for (const [i, author] of [a!, b!, c!, d!, e!].entries()) five.push(await approvedPost(repo, author, at, fans.slice(0, 7 - i), likedAt));
    // Liked by all eight seven minutes before the first round: too recent for it, counted by the next, five minutes later.
    const f1 = await approvedPost(repo, f!, at, fans, before(asOf, 7 * MINUTE));
    expect(await listed(db, (await rank(repo, asOf)).generation)).toEqual(five);
    setNow(after(asOf, MINUTE));

    const page1 = await read(reader!.id, { limit: 2 });
    expect(pageIds(page1)).toEqual(five.slice(0, 2));
    expect(page1.computedAt).toBe(asOf.toISOString());

    const next = after(asOf, 5 * MINUTE);
    expect(await listed(db, (await rank(repo, next)).generation)).toEqual([f1, ...five]);

    // The pages after the first come from the ranking the reader started, with its time; the newcomer does not break in.
    const page2 = await read(reader!.id, { limit: 2, cursor: page1.nextCursor! });
    const page3 = await read(reader!.id, { limit: 2, cursor: page2.nextCursor! });
    expect([...pageIds(page1), ...pageIds(page2), ...pageIds(page3)]).toEqual(five);
    expect([page2.computedAt, page3.computedAt]).toEqual([asOf.toISOString(), asOf.toISOString()]);
    expect(page3.nextCursor).toBeNull();
    // A reader who starts now gets the new ranking, with its time.
    const fresh = await read(reader!.id);
    expect(pageIds(fresh)).toEqual([f1, ...five]);
    expect(fresh.computedAt).toBe(next.toISOString());
  });

  test("a cursor of a ranking no longer kept is 409 explore_refreshed; one naming a ranking not yet written, or a post outside its ranking, is 400", async () => {
    const asOf = nextAsOf();
    const [reader, a, b, c, quiet, ...fans] = await accounts(db, asOf, 8);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    const first = await approvedPost(repo, a!, at, fans, likedAt);
    await approvedPost(repo, b!, at, fans, likedAt);
    await approvedPost(repo, c!, at, fans, likedAt);
    // A post in the window that no ranking holds: nobody approved of it.
    const outside = await newPost(repo, quiet!.id, at);
    await rank(repo, asOf);
    setNow(after(asOf, MINUTE));
    const started = await read(reader!.id, { limit: 1 });
    expect(started.nextCursor).not.toBeNull();

    const g2 = (await rank(repo, after(asOf, 5 * MINUTE))).generation;
    // The ranking before the current one is still kept, so the reader reads on in it.
    expect(pageIds(await read(reader!.id, { limit: 1, cursor: started.nextCursor! }))).toHaveLength(1);
    const g3 = (await rank(repo, after(asOf, 10 * MINUTE))).generation;
    // Now it is gone, and the reader is told so rather than handed another ranking's posts.
    const refreshed = await read(reader!.id, { limit: 1, cursor: started.nextCursor! }).catch((err: unknown) => err);
    expect(refreshed).toBeInstanceOf(SocialError);
    expect(refreshed).toMatchObject({ code: "explore_refreshed", status: 409, message: "Explore was refreshed." });

    const refusedAsInvalid = async (cursor: string, what: string) => {
      const err = await read(reader!.id, { limit: 1, cursor }).catch((caught: unknown) => caught);
      expect(err, what).toBeInstanceOf(SocialError);
      expect(err, what).toMatchObject({ code: "invalid_request", status: 400 });
    };
    // A ranking after the current one has not been written: no cursor this server made can name it.
    await refusedAsInvalid(encodeExploreCursor({ g: g3 + 1, id: first }), "a ranking not yet written");
    // A post the ranking does not hold, whether the post exists or not.
    await refusedAsInvalid(encodeExploreCursor({ g: g3, id: outside }), "a post outside the ranking");
    await refusedAsInvalid(encodeExploreCursor({ g: g3, id: randomUUID() }), "no such post");
    await refusedAsInvalid("not-a-cursor", "not a cursor");
    // Both rankings kept are read on after any post they hold.
    for (const g of [g2, g3]) {
      const order = await listed(db, g);
      expect(pageIds(await read(reader!.id, { cursor: encodeExploreCursor({ g, id: order[0]! }) }))).toEqual(order.slice(1));
    }
  });

  test("a page cut exactly at the limit carries a cursor naming the ranking and the last post read, and the page after it is empty with no cursor", async () => {
    const asOf = nextAsOf();
    const [reader, a, b, ...fans] = await accounts(db, asOf, 6);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    await approvedPost(repo, a!, at, fans, likedAt);
    await approvedPost(repo, b!, at, fans, likedAt);
    const g = (await rank(repo, asOf)).generation;
    const order = await listed(db, g);
    setNow(after(asOf, MINUTE));

    const full = await read(reader!.id, { limit: 2 });
    expect(ExplorePage.parse(full)).toEqual(full);
    expect(pageIds(full)).toEqual(order);
    // Ordinary post views with their public counts and the reader's own state; nothing but the order tells their place.
    expect(full.items.map((item) => [item.kind, item.post.counts.likes, item.post.viewer])).toEqual(order.map(() => ["post", 3, { liked: false, reposted: false, bookmarked: false }]));
    // The cursor names the ranking and the post read last, and nothing else: no position, no score.
    expect(JSON.parse(Buffer.from(full.nextCursor!, "base64url").toString("utf8"))).toEqual({ g, id: order[1] });
    expect(await read(reader!.id, { limit: 2, cursor: full.nextCursor! })).toEqual({ items: [], nextCursor: null, computedAt: asOf.toISOString(), signInForMore: false });
    // A page shorter than its limit is the last one: no cursor.
    const short = await read(reader!.id, { limit: 3 });
    expect(pageIds(short)).toEqual(order);
    expect(short.nextCursor).toBeNull();
  });

  test("the status answers the post's author only, with the first reason that applies: reply, quote, not_visible, hidden_by_author, then listed", async () => {
    const asOf = nextAsOf();
    const [author, other, ...fans] = await accounts(db, asOf, 5);
    const at = before(asOf, 2 * HOUR);
    const root = await approvedPost(repo, author!, at, fans, before(asOf, HOUR));
    const reply = await newPost(repo, author!.id, at, "a reply", { replyToId: root });
    const quote = await newPost(repo, author!.id, at, "a quote", { quoteOfId: root });
    // A withheld reply is a reply first: replies never enter, whatever their state.
    const withheldReply = await newPost(repo, author!.id, at, "a withheld reply", { replyToId: root });
    const withheld = await newPost(repo, author!.id, at);
    const removed = await newPost(repo, author!.id, at);
    const deleted = await newPost(repo, author!.id, at);
    await setState(withheldReply, "withheld");
    await setState(withheld, "withheld");
    await setState(removed, "removed");
    expect(await repo.deletePost(deleted, author!.id, before(asOf, 30 * MINUTE))).toBe(true);
    expect(await listed(db, (await rank(repo, asOf)).generation)).toEqual([root]);
    setNow(after(asOf, MINUTE));
    const computedAt = asOf.toISOString();

    const expected: [string, ExploreStatusKind][] = [
      [reply, "reply"],
      [withheldReply, "reply"],
      [quote, "quote"],
      [withheld, "not_visible"],
      [removed, "not_visible"],
      [deleted, "not_visible"],
      [root, "listed"],
    ];
    for (const [id, kind] of expected) {
      const answer = await status(author!.id, id);
      expect(answer, kind).toEqual({ status: kind, computedAt });
      // No count and no score: the reason and the ranking's time are all there is.
      expect(Object.keys(ExploreStatus.parse(answer)).sort(), kind).toEqual(["computedAt", "status"]);
    }
    // With the switch off, a post that is visible, even a listed one, says so; the reasons before it still come first.
    await setShowInExplore(deps, author!.id, false);
    expect(await status(author!.id, root)).toEqual({ status: "hidden_by_author", computedAt });
    expect(await status(author!.id, withheld)).toEqual({ status: "not_visible", computedAt });
    expect(await status(author!.id, quote)).toEqual({ status: "quote", computedAt });
    // Anyone but the author, and a post that does not exist, get not_found: nothing tells them what the post is.
    for (const id of [root, reply, quote, withheld, deleted]) expect(await rejection(status(other!.id, id)), id).toBe("not_found");
    expect(await rejection(status(author!.id, randomUUID()))).toBe("not_found");
  });

  test("outside_window comes before the ranking is asked about; no_ranking before the first round; new_since_ranking for a post written after it", async () => {
    const asOf = nextAsOf();
    const [author, ...fans] = await accounts(db, asOf, 4);
    const window = EXPLORE_V1.windowHours * HOUR;
    // Exactly 48 hours old at the request time, which is outside: the window takes posts younger than that.
    const old = await approvedPost(repo, author!, before(asOf, window), fans, before(asOf, window - HOUR));
    const recent = await approvedPost(repo, author!, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
    setNow(asOf);
    expect(await status(author!.id, old)).toEqual({ status: "outside_window", computedAt: null });
    expect(await status(author!.id, recent)).toEqual({ status: "no_ranking", computedAt: null });

    expect(await listed(db, (await rank(repo, asOf)).generation)).toEqual([recent]);
    // Written a minute after the ranking and approved of at once.
    const later = await approvedPost(repo, author!, after(asOf, MINUTE), fans, after(asOf, MINUTE));
    setNow(after(asOf, 15 * MINUTE));
    const computedAt = asOf.toISOString();
    expect(await status(author!.id, recent)).toEqual({ status: "listed", computedAt });
    expect(await status(author!.id, later)).toEqual({ status: "new_since_ranking", computedAt });
    expect(await status(author!.id, old)).toEqual({ status: "outside_window", computedAt });
  });

  test("below_threshold and pending apply every rule of the ranking, now and at the ranking's time, the 10 minutes of standing included", async () => {
    const asOf = nextAsOf();
    const [author, fan1, fan2, fan3] = await accounts(db, asOf, 4);
    // A day old when it likes: short of the 48 hours an engaging account needs.
    const young = await newProfile(db, { createdAt: before(asOf, DAY) });
    const id = await newPost(repo, author!.id, before(asOf, 2 * HOUR));
    // Two approving accounts, and two likes that never count: the author's own and the young account's.
    await likedBy(repo, id, [fan1!, fan2!, author!, young], before(asOf, HOUR));
    expect(await listed(db, (await rank(repo, asOf)).generation)).toEqual([]);
    const computedAt = asOf.toISOString();
    setNow(after(asOf, MINUTE));
    expect(await status(author!.id, id)).toEqual({ status: "below_threshold", computedAt });

    // A third approving account likes it now: a like counts once it has stood 10 minutes, for the status as for the refresh.
    await likedBy(repo, id, [fan3!], deps.now());
    expect(await status(author!.id, id)).toEqual({ status: "below_threshold", computedAt });
    // Ten minutes on it counts now, but not at the ranking's time, which came before it: the next refresh considers the post.
    setNow(after(asOf, 11 * MINUTE));
    expect(await status(author!.id, id)).toEqual({ status: "pending", computedAt });
  });

  test("author_cap and below_cutoff: every rule met at the ranking's time, but the author's other posts, or the list's length, kept the post out", async () => {
    const asOf = nextAsOf();
    const [a, b, c] = await accounts(db, asOf, 3);
    const fans = await accounts(db, asOf, 6);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    // One age, in the order of their approving accounts: b1 6, a1 5, a2 4, then a3 and c1 with 3 each.
    const b1 = await approvedPost(repo, b!, at, fans.slice(0, 6), likedAt);
    const a1 = await approvedPost(repo, a!, at, fans.slice(0, 5), likedAt);
    const a2 = await approvedPost(repo, a!, at, fans.slice(0, 4), likedAt);
    const a3 = await approvedPost(repo, a!, at, fans.slice(0, 3), likedAt);
    const c1 = await approvedPost(repo, c!, at, fans.slice(0, 3), likedAt);
    // Written before the ranking, approved of only after it.
    const a4 = await newPost(repo, a!.id, at);
    expect(await listed(db, (await rank(repo, asOf)).generation)).toEqual([b1, a1, a2, c1]);
    await likedBy(repo, a4, fans.slice(0, 3), after(asOf, MINUTE));
    setNow(after(asOf, 11 * MINUTE));
    const computedAt = asOf.toISOString();
    // With the published formula the author's two better posts hold their two places.
    expect(await status(a!.id, a3)).toEqual({ status: "author_cap", computedAt });
    // Met now but not at the ranking's time: pending, whatever places the author holds, since the next refresh decides.
    expect(await status(a!.id, a4)).toEqual({ status: "pending", computedAt });
    expect(await status(c!.id, c1)).toEqual({ status: "listed", computedAt });

    // A formula whose list holds three posts, ranking and judging alike: c1 meets every rule, but the list was full.
    const short: ExploreFormula = { ...EXPLORE_V1, minGapMinutes: 0, listLength: 3 };
    expect(await listed(db, (await rank(repo, asOf, short)).generation)).toEqual([b1, a1, a2]);
    expect(await status(c!.id, c1, short)).toEqual({ status: "below_cutoff", computedAt });
    expect(await status(a!.id, a3, short)).toEqual({ status: "author_cap", computedAt });
    expect(await status(a!.id, a1, short)).toEqual({ status: "listed", computedAt });
  });

  test("a post listed at the ranking's time stays listed until the next round, even once its 48 hours have passed; then it is outside_window", async () => {
    const asOf = nextAsOf();
    const [a, b, ...fans] = await accounts(db, asOf, 5);
    const window = EXPLORE_V1.windowHours * HOUR;
    // Five minutes short of 48 hours old at the ranking.
    const at = before(asOf, window - 5 * MINUTE);
    const kept = await approvedPost(repo, a!, at, fans, before(asOf, window - HOUR));
    const quiet = await approvedPost(repo, b!, at, fans.slice(0, 2), before(asOf, window - HOUR));
    const first = (await rank(repo, asOf)).generation;
    expect(await listed(db, first)).toEqual([kept]);
    // Ten minutes on, both are past their 48 hours.
    const later = after(asOf, 10 * MINUTE);
    setNow(later);
    expect(await status(a!.id, kept)).toEqual({ status: "listed", computedAt: asOf.toISOString() });
    expect(await status(b!.id, quiet)).toEqual({ status: "outside_window", computedAt: asOf.toISOString() });
    expect(pageIds(await read(null))).toEqual([kept]);
    expect((await getPost(deps, a!.id, kept)).inExplore).toBe(true);

    // The next round leaves it out, and the status, the page and the chip follow, though the ranking before still holds it.
    expect(await listed(db, (await rank(repo, later)).generation)).toEqual([]);
    expect(await listed(db, first)).toEqual([kept]);
    expect(await status(a!.id, kept)).toEqual({ status: "outside_window", computedAt: later.toISOString() });
    expect(pageIds(await read(null))).toEqual([]);
    expect(await getPost(deps, a!.id, kept)).not.toHaveProperty("inExplore");
  });

  test("a post left out because its author had switched Explore off is pending once the switch is back on, and listed after the next round", async () => {
    const asOf = nextAsOf();
    const [author, ...fans] = await accounts(db, asOf, 4);
    const id = await approvedPost(repo, author!, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
    setNow(before(asOf, MINUTE));
    await setShowInExplore(deps, author!.id, false);
    expect(await listed(db, (await rank(repo, asOf)).generation)).toEqual([]);
    setNow(after(asOf, MINUTE));
    expect(await status(author!.id, id)).toEqual({ status: "hidden_by_author", computedAt: asOf.toISOString() });

    await setShowInExplore(deps, author!.id, true);
    // Every rule is met now and was met at the ranking's time; what kept the post out has gone, so the next refresh considers it.
    expect(await status(author!.id, id)).toEqual({ status: "pending", computedAt: asOf.toISOString() });
    expect(pageIds(await read(null))).toEqual([]);
    const next = after(asOf, 5 * MINUTE);
    await rank(repo, next);
    expect(await status(author!.id, id)).toEqual({ status: "listed", computedAt: next.toISOString() });
    expect(pageIds(await read(null))).toEqual([id]);
  });

  test("the author's own listed posts carry inExplore wherever they are read, nobody else's view does, and it goes at once when the post is withheld or the switch is turned off", async () => {
    const asOf = nextAsOf();
    const [a, b, c, ...fans] = await accounts(db, asOf, 6);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    const a1 = await approvedPost(repo, a!, at, fans, likedAt);
    // Two approving accounts: not listed.
    const a2 = await approvedPost(repo, a!, at, fans.slice(0, 2), likedAt);
    const b1 = await approvedPost(repo, b!, at, fans, likedAt);
    // c quotes a1: its embed is a1 as its author sees it, but not a card of its own.
    const quote = await newPost(repo, c!.id, at, "a quote", { quoteOfId: a1 });
    const g = (await rank(repo, asOf)).generation;
    expect(new Set(await listed(db, g))).toEqual(new Set([a1, b1]));
    setNow(after(asOf, MINUTE));
    const chipped = (items: { post: { id: string; inExplore?: true } }[]) => items.filter((item) => item.post.inExplore === true).map((item) => item.post.id);

    // On the author's own views: the post itself, Explore and their profile's posts.
    expect((await getPost(deps, a!.id, a1)).inExplore).toBe(true);
    expect(await getPost(deps, a!.id, a2)).not.toHaveProperty("inExplore");
    expect(chipped((await read(a!.id)).items)).toEqual([a1]);
    expect(chipped((await profilePosts(deps, a!.id, a!.handle, { limit: 20 })).items)).toEqual([a1]);
    // Nobody else's: another account's, a signed-out reader's, or the author's own post embedded in someone's quote.
    expect(await getPost(deps, b!.id, a1)).not.toHaveProperty("inExplore");
    expect(await getPost(deps, null, a1)).not.toHaveProperty("inExplore");
    expect((await read(null)).items.filter((item) => "inExplore" in item.post)).toEqual([]);
    expect(chipped((await read(b!.id)).items)).toEqual([b1]);
    expect((await getPost(deps, a!.id, quote)).quoteOf).not.toHaveProperty("inExplore");

    // An engagement answer carries the counts and the viewer's own state, not the post: the card keeps its chip through it.
    const liked = await setEngagement(deps, a!.id, a1, "like", true);
    expect(Object.keys(liked).sort()).toEqual(["counts", "viewer"]);
    expect(Object.keys(liked.viewer).sort()).toEqual(["bookmarked", "liked", "reposted"]);
    expect((await getPost(deps, a!.id, a1)).inExplore).toBe(true);

    // Gone at once, before any further round: from a withheld post, and from every post of an author who switched Explore off.
    await setState(a1, "withheld");
    const withheld = await getPost(deps, a!.id, a1);
    expect(withheld.state).toBe("withheld");
    expect(withheld).not.toHaveProperty("inExplore");
    await setShowInExplore(deps, b!.id, false);
    expect(await getPost(deps, b!.id, b1)).not.toHaveProperty("inExplore");
    expect(new Set(await listed(db, g))).toEqual(new Set([a1, b1]));
  });

  leavesNoModerationRows(() => db);
});

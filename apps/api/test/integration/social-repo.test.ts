import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { SocialError } from "../../src/social/context";
import { createSocialRepo, type ListRow, type SocialRepo } from "../../src/social/repo";
import { closeDecisions, decideForTest, leavesNoModerationRows } from "./moderation-decide";
import { liftRowForTest, suspendRowForTest } from "./moderation-fixtures";
import { newPost, newProfile, ticker } from "./social-fixtures";

const ids = (rowsList: ListRow[]) => rowsList.map((r) => r.postId);

describe.skipIf(!process.env.INTEGRATION)("integration: social repository", () => {
  let db: Db;
  let repo: SocialRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    repo = createSocialRepo(db);
  });
  afterAll(async () => {
    await closeDecisions();
    await closeDb(db);
  });

  test("counters stay exact when actions repeat and undo", async () => {
    const clock = ticker();
    const [ada, bob] = await Promise.all([newProfile(db), newProfile(db)]);
    const post = await newPost(repo, ada.id, clock.next());

    expect(await repo.like(bob.id, post, clock.next())).toBe(true);
    expect(await repo.like(bob.id, post, clock.next())).toBe(false);
    expect(await repo.repost(bob.id, post, clock.next())).toBe(true);
    expect(await repo.bookmark(bob.id, post, clock.next())).toBe(true);
    expect(await repo.bookmark(bob.id, post, clock.next())).toBe(false);
    let row = (await repo.findPosts([post])).get(post)!;
    expect([row.likeCount, row.repostCount]).toEqual([1, 1]);
    expect(await repo.viewerPostStates(bob.id, [post])).toEqual(new Map([[post, { liked: true, reposted: true, bookmarked: true }]]));

    expect(await repo.unlike(bob.id, post)).toBe(true);
    expect(await repo.unlike(bob.id, post)).toBe(false);
    expect(await repo.unrepost(bob.id, post)).toBe(true);
    expect(await repo.unbookmark(bob.id, post)).toBe(true);
    row = (await repo.findPosts([post])).get(post)!;
    expect([row.likeCount, row.repostCount]).toEqual([0, 0]);
    expect((await repo.viewerPostStates(bob.id, [post])).get(post)).toEqual({ liked: false, reposted: false, bookmarked: false });
  });

  test("replies and quotes count on their target, top-level posts on the author", async () => {
    const clock = ticker();
    const ada = await newProfile(db);
    const root = await newPost(repo, ada.id, clock.next());
    const reply = await newPost(repo, ada.id, clock.next(), "reply", { replyToId: root });
    await newPost(repo, ada.id, clock.next(), "quote", { quoteOfId: root });
    const rootRow = (await repo.findPosts([root])).get(root)!;
    expect([rootRow.replyCount, rootRow.quoteCount]).toEqual([1, 1]);
    expect((await repo.findProfiles([ada.id])).get(ada.id)!.postCount).toBe(2);
    expect((await repo.findPosts([reply])).get(reply)!.replyToHandle).toBe(ada.handle);

    expect(await repo.deletePost(reply, ada.id, clock.next())).toBe(true);
    expect(await repo.deletePost(reply, ada.id, clock.next())).toBe(false);
    expect((await repo.findPosts([root])).get(root)!.replyCount).toBe(0);
    const deleted = (await repo.findPosts([reply])).get(reply)!;
    expect(deleted.state).toBe("deleted_by_author");
    expect(deleted.body).toBe("");
    expect(deleted.deletedAt).not.toBeNull();
  });

  test("blocking removes follows in both directions in one transaction and keeps counts exact", async () => {
    const clock = ticker();
    const [ada, bob] = await Promise.all([newProfile(db), newProfile(db)]);
    expect(await repo.follow(ada.id, bob.id, clock.next())).toBe(true);
    expect(await repo.follow(ada.id, bob.id, clock.next())).toBe(false);
    expect(await repo.follow(bob.id, ada.id, clock.next())).toBe(true);
    let profilesById = await repo.findProfiles([ada.id, bob.id]);
    expect([profilesById.get(ada.id)!.followerCount, profilesById.get(ada.id)!.followingCount]).toEqual([1, 1]);

    expect(await repo.block(ada.id, bob.id, clock.next())).toBe(true);
    expect(await repo.block(ada.id, bob.id, clock.next())).toBe(false);
    expect(await repo.relation(ada.id, bob.id)).toEqual({ following: false, followedBy: false, blocked: true, blockedBy: false, muted: false });
    expect(await repo.relation(bob.id, ada.id)).toEqual({ following: false, followedBy: false, blocked: false, blockedBy: true, muted: false });
    profilesById = await repo.findProfiles([ada.id, bob.id]);
    for (const p of profilesById.values()) expect([p.followerCount, p.followingCount]).toEqual([0, 0]);
    expect(await repo.blockedEitherWay(bob.id, [ada.id])).toEqual(new Set([ada.id]));
    expect(await repo.unblock(ada.id, bob.id)).toBe(true);
    expect(await repo.blockedEitherWay(bob.id, [ada.id])).toEqual(new Set());
  });

  test("the following timeline pages stably across posts and reposts, and a post reposted twice appears twice", async () => {
    const clock = ticker();
    const [viewer, ada, bob, carol] = await Promise.all([newProfile(db), newProfile(db), newProfile(db), newProfile(db)]);
    await repo.follow(viewer.id, ada.id, clock.next());
    await repo.follow(viewer.id, bob.id, clock.next());
    const a1 = await newPost(repo, ada.id, clock.next());
    const own = await newPost(repo, viewer.id, clock.next());
    const c1 = await newPost(repo, carol.id, clock.next()); // not followed: appears only through reposts
    await newPost(repo, ada.id, clock.next(), "a reply", { replyToId: a1 });
    await repo.repost(ada.id, c1, clock.next());
    await repo.repost(bob.id, c1, clock.next());
    const b1 = await newPost(repo, bob.id, clock.next());

    const all = await repo.followingTimeline(viewer.id, undefined, 10);
    expect(all.map((r) => [r.postId, r.reposterId])).toEqual([
      [b1, null],
      [c1, bob.id],
      [c1, ada.id],
      [own, null],
      [a1, null],
    ]);

    const seen: [string, string | null][] = [];
    let cursor: { t: number; id: string; r?: string } | undefined;
    for (let page = 0; page < 5; page++) {
      const rowsPage = await repo.followingTimeline(viewer.id, cursor, 2);
      if (rowsPage.length === 0) break;
      seen.push(...rowsPage.map((r): [string, string | null] => [r.postId, r.reposterId]));
      const last = rowsPage[rowsPage.length - 1]!;
      cursor = { t: last.sortAt.getTime(), id: last.postId, ...(last.reposterId ? { r: last.reposterId } : {}) };
    }
    expect(seen).toEqual(all.map((r) => [r.postId, r.reposterId]));
  });

  test("blocks hide an author in both directions; mutes hide timelines only", async () => {
    const clock = ticker();
    const [viewer, ada, bob] = await Promise.all([newProfile(db), newProfile(db), newProfile(db)]);
    await repo.follow(viewer.id, ada.id, clock.next());
    await repo.follow(viewer.id, bob.id, clock.next());
    const a1 = await newPost(repo, ada.id, clock.next());
    const b1 = await newPost(repo, bob.id, clock.next());
    const reply = await newPost(repo, ada.id, clock.next(), "reply", { replyToId: b1 });

    expect(ids(await repo.followingTimeline(viewer.id, undefined, 10))).toEqual([b1, a1]);
    expect(ids(await repo.replies(b1, viewer.id, undefined, 10))).toEqual([reply]);

    await repo.mute(viewer.id, ada.id, clock.next());
    expect(ids(await repo.followingTimeline(viewer.id, undefined, 10))).toEqual([b1]);
    expect(ids(await repo.latestTimeline(viewer.id, undefined, 200))).not.toContain(a1);
    expect(ids(await repo.replies(b1, viewer.id, undefined, 10))).toEqual([reply]);
    expect(ids(await repo.profilePosts(ada.id, viewer.id, undefined, 10))).toEqual([a1]);
    await repo.unmute(viewer.id, ada.id);

    // ada blocks the viewer: the viewer no longer sees ada anywhere, and ada no longer sees the viewer.
    await repo.block(ada.id, viewer.id, clock.next());
    expect(ids(await repo.followingTimeline(viewer.id, undefined, 10))).toEqual([b1]);
    expect(ids(await repo.replies(b1, viewer.id, undefined, 10))).toEqual([]);
    expect(ids(await repo.latestTimeline(viewer.id, undefined, 200))).not.toContain(a1);
    const v1 = await newPost(repo, viewer.id, clock.next());
    expect(ids(await repo.latestTimeline(ada.id, undefined, 200))).not.toContain(v1);
    expect(ids(await repo.latestTimeline(null, undefined, 200))).toEqual(expect.arrayContaining([a1, v1]));
  });

  test("withheld and removed posts appear only to their author; replies never enter timelines", async () => {
    const clock = ticker();
    const [ada, bob] = await Promise.all([newProfile(db), newProfile(db)]);
    await repo.follow(bob.id, ada.id, clock.next());
    const shown = await newPost(repo, ada.id, clock.next());
    const withheld = await newPost(repo, ada.id, clock.next());
    const removed = await newPost(repo, ada.id, clock.next());
    await decideForTest(db, withheld, "withheld");
    await decideForTest(db, removed, "removed");
    await newPost(repo, ada.id, clock.next(), "reply", { replyToId: shown });

    expect(ids(await repo.profilePosts(ada.id, ada.id, undefined, 10))).toEqual([removed, withheld, shown]);
    expect(ids(await repo.profilePosts(ada.id, bob.id, undefined, 10))).toEqual([shown]);
    expect(ids(await repo.profilePosts(ada.id, null, undefined, 10))).toEqual([shown]);
    expect(ids(await repo.followingTimeline(bob.id, undefined, 10))).toEqual([shown]);
    expect(ids(await repo.followingTimeline(ada.id, undefined, 10))).toEqual([removed, withheld, shown]);
    expect(ids(await repo.latestTimeline(null, undefined, 500))).not.toContain(withheld);
    // The withheld and removed states come from real, confirmed decisions: a staff key's enrolment, a sign-in, and a step-up for each.
  }, 30_000);

  test("threads: ancestors come root first and stop at the cap, replies page oldest first", async () => {
    const clock = ticker();
    const ada = await newProfile(db);
    const root = await newPost(repo, ada.id, clock.next(), "root");
    let parent = root;
    const chain = [root];
    for (let depth = 1; depth <= 55; depth++) {
      parent = await newPost(repo, ada.id, clock.next(), `level ${depth}`, { replyToId: parent });
      chain.push(parent);
    }
    const leaf = chain[chain.length - 1]!;
    const ancestors = await repo.ancestorIds(leaf);
    expect(ancestors).toHaveLength(50);
    expect(ancestors).toEqual(chain.slice(-51, -1));
    expect(await repo.ancestorIds(chain[3]!)).toEqual(chain.slice(0, 3));

    const replies = await Promise.all([1, 2, 3].map((n) => newPost(repo, ada.id, clock.next(), `r${n}`, { replyToId: root })));
    const first = await repo.replies(root, null, undefined, 2);
    expect(ids(first)).toEqual([chain[1], replies[0]]);
    const last = first[first.length - 1]!;
    const second = await repo.replies(root, null, { t: last.sortAt.getTime(), id: last.postId }, 2);
    expect(ids(second)).toEqual([replies[1], replies[2]]);
  });

  test("likes and bookmarks list newest first and drop posts the viewer may no longer see", async () => {
    const clock = ticker();
    const [viewer, ada, bob] = await Promise.all([newProfile(db), newProfile(db), newProfile(db)]);
    const a1 = await newPost(repo, ada.id, clock.next());
    const b1 = await newPost(repo, bob.id, clock.next());
    await repo.like(viewer.id, a1, clock.next());
    await repo.like(viewer.id, b1, clock.next());
    await repo.bookmark(viewer.id, a1, clock.next());
    expect(ids(await repo.likedPosts(viewer.id, undefined, 10))).toEqual([b1, a1]);
    expect(ids(await repo.bookmarkedPosts(viewer.id, undefined, 10))).toEqual([a1]);
    await repo.block(bob.id, viewer.id, clock.next());
    expect(ids(await repo.likedPosts(viewer.id, undefined, 10))).toEqual([a1]);
    await repo.deletePost(a1, ada.id, clock.next());
    expect(ids(await repo.likedPosts(viewer.id, undefined, 10))).toEqual([]);
    expect(ids(await repo.bookmarkedPosts(viewer.id, undefined, 10))).toEqual([]);
  });

  test("follower and blocked lists page newest first, and profile lookups are case-insensitive", async () => {
    const clock = ticker();
    const [ada, bob, carol] = await Promise.all([newProfile(db), newProfile(db), newProfile(db)]);
    await repo.follow(bob.id, ada.id, clock.next());
    await repo.follow(carol.id, ada.id, clock.next());
    const firstPage = await repo.followers(ada.id, null, undefined, 1);
    expect(firstPage.map((r) => r.profileId)).toEqual([carol.id]);
    const secondPage = await repo.followers(ada.id, null, { t: firstPage[0]!.sortAt.getTime(), id: firstPage[0]!.profileId }, 1);
    expect(secondPage.map((r) => r.profileId)).toEqual([bob.id]);
    expect((await repo.following(bob.id, null, undefined, 10)).map((r) => r.profileId)).toEqual([ada.id]);
    expect(await repo.followedBy(bob.id, [ada.id, carol.id])).toEqual(new Set([ada.id]));

    await repo.block(ada.id, carol.id, clock.next());
    await repo.mute(ada.id, bob.id, clock.next());
    expect((await repo.blockedList(ada.id, undefined, 10)).map((r) => r.profileId)).toEqual([carol.id]);
    expect((await repo.mutedList(ada.id, undefined, 10)).map((r) => r.profileId)).toEqual([bob.id]);

    const found = await repo.findProfileByHandle(ada.handle.toUpperCase());
    expect(found?.id).toBe(ada.id);
    expect([found?.followerCount, found?.followingCount, found?.postCount]).toEqual([1, 0, 0]);
    expect(await repo.findProfileByHandle("no_such_handle_here")).toBeNull();
  });

  leavesNoModerationRows(() => db);
});

/**
 * The account purge locks the deleted account's profile row `for update` for its whole transaction; a
 * follow, like, repost or bookmark takes a shared lock on the profile rows it writes about first and
 * refuses a deleted one. These tests hold the locks from a transaction of their own and watch this
 * database's sessions to know when the write under test is waiting, so the interleaving is the same on
 * every run. Nothing here can wait for ever: every connection of the pool gives up a lock wait after 5
 * seconds and a statement after 15, the server ends a transaction left idle for 30 seconds, every lock
 * holder is released in a `finally`, and every test has a time limit.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: social writes racing an account purge", () => {
  let db: Db;
  let repo: SocialRepo;
  const LIMIT = { timeout: 30_000 };

  beforeAll(() => {
    // Startup parameters in the URL become the session's settings on every connection of this pool.
    const url = new URL(loadConfig().DATABASE_URL_API);
    url.searchParams.set("lock_timeout", "5s");
    url.searchParams.set("statement_timeout", "15s");
    url.searchParams.set("idle_in_transaction_session_timeout", "30s");
    // Room for a lock holder, the writes it blocks, a purge and the polling connection at the same time.
    db = createDb(url.toString(), { max: 8 });
    repo = createSocialRepo(db);
  });
  afterAll(async () => {
    // With a deadline, so a connection some failed test left in a transaction cannot keep the suite open.
    await db.$client.end({ timeout: 5 });
  });

  /** Resolves once `n` sessions of this database wait on a lock, or as soon as `watched` settles (a write that never waited). */
  async function untilWaiting(n: number, watched: Promise<unknown>): Promise<void> {
    let settled = false;
    void watched.then(
      () => (settled = true),
      () => (settled = true),
    );
    for (let i = 0; i < 250; i++) {
      const [row] = (await db.execute(
        sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
      )) as unknown as { n: number }[];
      if (row!.n >= n || settled) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`fewer than ${n} sessions waited on a lock`);
  }

  /**
   * A transaction that locks a profile row and holds the lock until `release`. With `purge`, it locks the
   * row as the purge does and marks the profile deleted before it commits, as the purge's last statement
   * does; otherwise it holds a plain shared lock and changes nothing. `finish` releases it and waits for
   * the transaction to end, whichever way it ends; the tests call it in a `finally`.
   */
  function hold(profileId: string, mode: "purge" | "share") {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let taken!: () => void;
    const locked = new Promise<void>((resolve) => (taken = resolve));
    const done = db.transaction(async (tx) => {
      await tx.execute(mode === "purge" ? sql`select 1 from profiles where id = ${profileId}::uuid for update` : sql`select 1 from profiles where id = ${profileId}::uuid for share`);
      taken();
      await gate;
      if (mode === "purge") await tx.execute(sql`update profiles set deleted_at = now() where id = ${profileId}::uuid`);
    });
    // A holder that failed to take its lock must not leave `locked` waiting.
    done.catch(() => taken());
    const finish = async () => {
      release();
      await done.catch(() => undefined);
    };
    return { locked, release, done, finish };
  }

  /** What a write came to: true or false as the repository answered, or the error code it was refused with. */
  const outcome = (write: Promise<boolean>): Promise<boolean | string> => write.catch((err: unknown) => (err instanceof SocialError ? err.code : Promise.reject(err)));
  const counts = async (id: string) =>
    ((await db.execute(sql`select follower_count, following_count from profiles where id = ${id}::uuid`)) as unknown as { follower_count: number; following_count: number }[])[0]!;
  const followRows = async (from: string, to: string) =>
    ((await db.execute(sql`select count(*)::int as n from follows where follower_id = ${from}::uuid and followee_id = ${to}::uuid`)) as unknown as { n: number }[])[0]!.n;

  test("a follow that waits on a purge holding the followee's row sees the deletion once the purge commits, and is refused", LIMIT, async () => {
    const clock = ticker();
    const [ada, gone] = await Promise.all([newProfile(db), newProfile(db)]);
    const purge = hold(gone.id, "purge");
    try {
      await purge.locked;
      const follow = outcome(repo.follow(ada.id, gone.id, clock.next(), true));
      await untilWaiting(1, follow);
      purge.release();
      await purge.done;
      expect(await follow).toBe("not_found");
    } finally {
      await purge.finish();
    }
    expect(await followRows(ada.id, gone.id)).toBe(0);
    expect(await counts(gone.id)).toEqual({ follower_count: 0, following_count: 0 });
    expect(await counts(ada.id)).toEqual({ follower_count: 0, following_count: 0 });
  });

  test("a like, a repost or a bookmark of a post whose author a purge holds waits, sees the deletion and is refused", LIMIT, async () => {
    for (const kind of ["like", "repost", "bookmark"] as const) {
      const clock = ticker();
      const [ada, gone] = await Promise.all([newProfile(db), newProfile(db)]);
      const post = await newPost(repo, gone.id, clock.next());
      const purge = hold(gone.id, "purge");
      try {
        await purge.locked;
        const write = outcome(
          kind === "like" ? repo.like(ada.id, post, clock.next(), gone.id) : kind === "repost" ? repo.repost(ada.id, post, clock.next(), gone.id) : repo.bookmark(ada.id, post, clock.next()),
        );
        await untilWaiting(1, write);
        purge.release();
        await purge.done;
        expect(await write, kind).toBe("not_found");
      } finally {
        await purge.finish();
      }
      const row = (await repo.findPosts([post])).get(post)!;
      expect([row.likeCount, row.repostCount], kind).toEqual([0, 0]);
      expect((await repo.viewerPostStates(ada.id, [post])).get(post), kind).toEqual({ liked: false, reposted: false, bookmarked: false });
    }
  });

  test("a follow or a like by an account a purge holds waits, sees the deletion and is refused", LIMIT, async () => {
    const clock = ticker();
    const [gone, bob] = await Promise.all([newProfile(db), newProfile(db)]);
    const post = await newPost(repo, bob.id, clock.next());
    const purge = hold(gone.id, "purge");
    try {
      await purge.locked;
      const follow = outcome(repo.follow(gone.id, bob.id, clock.next(), true));
      const like = outcome(repo.like(gone.id, post, clock.next(), bob.id));
      await untilWaiting(2, Promise.all([follow, like]));
      purge.release();
      await purge.done;
      expect([await follow, await like]).toEqual(["not_found", "not_found"]);
    } finally {
      await purge.finish();
    }
    expect(await followRows(gone.id, bob.id)).toBe(0);
    expect(await counts(bob.id)).toEqual({ follower_count: 0, following_count: 0 });
    expect((await repo.findPosts([post])).get(post)!.likeCount).toBe(0);
  });

  test("a follow that holds the followee's row makes the purge wait, and the purge then removes the follow with its counters", LIMIT, async () => {
    const clock = ticker();
    const [ada, gone] = await Promise.all([newProfile(db), newProfile(db)]);
    // 3e (design, section 5, the lock order): a follow takes both profile rows in one statement before it writes, so it
    // is paused after that statement: an uncommitted insert of the same follow row makes its own insert wait. The follow
    // is then in flight, holding the followee's row, when the purge starts.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let taken!: () => void;
    const inserted = new Promise<void>((resolve) => (taken = resolve));
    const pause = db.transaction(async (tx) => {
      await tx.execute(sql`insert into follows (follower_id, followee_id, created_at) values (${ada.id}::uuid, ${gone.id}::uuid, now())`);
      taken();
      await gate;
      // Rolled back, so the follow's own insert lands.
      tx.rollback();
    });
    pause.catch(() => taken());
    let purge: Promise<void> | undefined;
    try {
      await inserted;
      const follow = outcome(repo.follow(ada.id, gone.id, clock.next(), true));
      await untilWaiting(1, follow);
      purge = repo.purgeProfile(gone.id, clock.next(), async () => undefined);
      await untilWaiting(2, purge);
      release();
      await pause.catch(() => undefined);
      expect(await follow).toBe(true);
      await purge;
    } finally {
      release();
      await pause.catch(() => undefined);
      await purge?.catch(() => undefined);
    }
    expect(await followRows(ada.id, gone.id)).toBe(0);
    expect(await counts(ada.id)).toEqual({ follower_count: 0, following_count: 0 });
    expect(await counts(gone.id)).toEqual({ follower_count: 0, following_count: 0 });
    const [row] = (await db.execute(sql`select display_name, deleted_at from profiles where id = ${gone.id}::uuid`)) as unknown as { display_name: string; deleted_at: string | null }[];
    expect(row!.display_name).toBe("Deleted account");
    expect(row!.deleted_at).not.toBeNull();
  });

  test("ten accounts following one account at the same moment all land, with the counters exact", LIMIT, async () => {
    const clock = ticker();
    const star = await newProfile(db);
    const fans = await Promise.all(Array.from({ length: 10 }, () => newProfile(db)));
    // Every follow locks the followee's row and then updates its counter; a lock that conflicted with that update would deadlock these.
    const results = await Promise.all(fans.map((fan) => outcome(repo.follow(fan.id, star.id, clock.next(), true))));
    expect(results).toEqual(fans.map(() => true));
    expect(await counts(star.id)).toEqual({ follower_count: 10, following_count: 0 });
  });

  const pairRows = async (table: "blocks" | "mutes", from: string, to: string) =>
    (
      (await db.execute(
        table === "blocks"
          ? sql`select count(*)::int as n from blocks where blocker_id = ${from}::uuid and blocked_id = ${to}::uuid`
          : sql`select count(*)::int as n from mutes where muter_id = ${from}::uuid and muted_id = ${to}::uuid`,
      )) as unknown as { n: number }[]
    )[0]!.n;
  const postsBy = async (author: string) => ((await db.execute(sql`select count(*)::int as n from posts where author_id = ${author}::uuid`)) as unknown as { n: number }[])[0]!.n;

  test("a block or a mute of, or by, an account a purge holds waits, sees the deletion and is refused", LIMIT, async () => {
    for (const kind of ["block", "mute"] as const) {
      for (const direction of ["of", "by"] as const) {
        const clock = ticker();
        const [ada, gone] = await Promise.all([newProfile(db), newProfile(db)]);
        const [from, to] = direction === "of" ? [ada.id, gone.id] : [gone.id, ada.id];
        const purge = hold(gone.id, "purge");
        try {
          await purge.locked;
          const write = outcome(kind === "block" ? repo.block(from, to, clock.next()) : repo.mute(from, to, clock.next()));
          await untilWaiting(1, write);
          purge.release();
          await purge.done;
          expect(await write, `${kind} ${direction}`).toBe("not_found");
        } finally {
          await purge.finish();
        }
        expect(await pairRows(kind === "block" ? "blocks" : "mutes", from, to), `${kind} ${direction}`).toBe(0);
      }
    }
  });

  test("a post by an account a purge holds waits, sees the deletion and is refused", LIMIT, async () => {
    const clock = ticker();
    const gone = await newProfile(db);
    const purge = hold(gone.id, "purge");
    try {
      await purge.locked;
      const write = outcome(newPost(repo, gone.id, clock.next(), "written while the account is purged").then(() => true));
      await untilWaiting(1, write);
      purge.release();
      await purge.done;
      expect(await write).toBe("not_found");
    } finally {
      await purge.finish();
    }
    // No live post is left behind by an account whose purge has already tombstoned everything it had.
    expect(await postsBy(gone.id)).toBe(0);
  });

  test("a reply to or a quote of a post whose author a purge holds waits, sees the deletion and is refused", LIMIT, async () => {
    for (const kind of ["reply", "quote"] as const) {
      const clock = ticker();
      const [ada, gone] = await Promise.all([newProfile(db), newProfile(db)]);
      const target = await newPost(repo, gone.id, clock.next());
      const purge = hold(gone.id, "purge");
      try {
        await purge.locked;
        const write = outcome(
          repo
            .createPost({ authorId: ada.id, body: kind, replyToId: kind === "reply" ? target : null, quoteOfId: kind === "quote" ? target : null, now: clock.next(), lockWith: gone.id })
            .then(() => true),
        );
        await untilWaiting(1, write);
        purge.release();
        await purge.done;
        expect(await write, kind).toBe("post_unavailable");
      } finally {
        await purge.finish();
      }
      expect(await postsBy(ada.id), kind).toBe(0);
      const row = (await repo.findPosts([target])).get(target)!;
      expect([row.replyCount, row.quoteCount], kind).toEqual([0, 0]);
    }
  });

  test("blocks, mutes and replies aimed at one account at the same moment all land, without a deadlock, with the counters exact", LIMIT, async () => {
    const clock = ticker();
    const star = await newProfile(db);
    const post = await newPost(repo, star.id, clock.next());
    const fans = await Promise.all(Array.from({ length: 12 }, () => newProfile(db)));
    // Every fan follows the star and likes the post first, so each block takes a follow and a like off the star's
    // counters while the other writes lock the same rows and write the same counters.
    for (const fan of fans) {
      expect(await repo.follow(fan.id, star.id, clock.next())).toBe(true);
      expect(await repo.like(fan.id, post, clock.next(), star.id)).toBe(true);
    }
    const kinds = fans.map((_, i) => (["block", "mute", "reply"] as const)[i % 3]!);
    const writes = fans.map((fan, i) =>
      kinds[i] === "block"
        ? outcome(repo.block(fan.id, star.id, clock.next()))
        : kinds[i] === "mute"
          ? outcome(repo.mute(fan.id, star.id, clock.next()))
          : outcome(repo.createPost({ authorId: fan.id, body: "a reply", replyToId: post, quoteOfId: null, now: clock.next(), lockWith: star.id }).then(() => true)),
    );
    expect(await Promise.all(writes)).toEqual(fans.map(() => true));
    const blocks = kinds.filter((kind) => kind === "block").length;
    expect(await counts(star.id)).toEqual({ follower_count: fans.length - blocks, following_count: 0 });
    const row = (await repo.findPosts([post])).get(post)!;
    expect([row.likeCount, row.replyCount]).toEqual([fans.length - blocks, kinds.filter((kind) => kind === "reply").length]);
  });
});

/**
 * 3e (design, sections 5 and 7.2): the one predicate on every write of the acting account. A suspension is written into
 * the profile row as the migrator (suspendRowForTest), as standing_apply derives one; the decisions that take one are
 * standing-at-once.test.ts's. The account acting is refused account_suspended while the interval runs; what others do
 * toward it is unchanged, and so is everything that withdraws or protects.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the writes of a suspended account (3e)", () => {
  let db: Db;
  let migrateDb: Db;
  let repo: SocialRepo;
  const LIMIT = { timeout: 30_000 };

  beforeAll(() => {
    const url = new URL(loadConfig().DATABASE_URL_API);
    url.searchParams.set("lock_timeout", "5s");
    url.searchParams.set("idle_in_transaction_session_timeout", "30s");
    db = createDb(url.toString(), { max: 6 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    repo = createSocialRepo(db);
  });
  afterAll(async () => {
    await Promise.all([db.$client.end({ timeout: 5 }), closeDb(migrateDb)]);
  });

  const outcome = (write: Promise<unknown>): Promise<unknown> => write.catch((err: unknown) => (err instanceof SocialError ? err.code : Promise.reject(err)));

  test("a suspended account's like, repost, bookmark, post, reply, quote and follow are refused account_suspended; its undos, blocks and mutes are not", async () => {
    const clock = ticker();
    const [ada, bob] = await Promise.all([newProfile(db), newProfile(db)]);
    const post = await newPost(repo, bob.id, clock.next());
    const liked = await newPost(repo, bob.id, clock.next());
    expect(await repo.like(ada.id, liked, clock.next(), bob.id)).toBe(true);
    expect(await repo.follow(ada.id, bob.id, clock.next(), true)).toBe(true);
    await suspendRowForTest(migrateDb, ada.id);
    expect(await outcome(repo.like(ada.id, post, clock.next(), bob.id))).toBe("account_suspended");
    expect(await outcome(repo.repost(ada.id, post, clock.next(), bob.id))).toBe("account_suspended");
    expect(await outcome(repo.bookmark(ada.id, post, clock.next()))).toBe("account_suspended");
    expect(await outcome(newPost(repo, ada.id, clock.next()))).toBe("account_suspended");
    expect(await outcome(newPost(repo, ada.id, clock.next(), "reply", { replyToId: post }))).toBe("account_suspended");
    expect(await outcome(newPost(repo, ada.id, clock.next(), "quote", { quoteOfId: post }))).toBe("account_suspended");
    const carol = await newProfile(db);
    expect(await outcome(repo.follow(ada.id, carol.id, clock.next(), true))).toBe("account_suspended");
    // Withdrawing and protecting oneself stay open.
    expect(await repo.unlike(ada.id, liked)).toBe(true);
    expect(await repo.unfollow(ada.id, bob.id)).toBe(true);
    expect(await repo.block(ada.id, carol.id, clock.next())).toBe(true);
    expect(await repo.mute(ada.id, bob.id, clock.next())).toBe(true);
    expect((await repo.findProfiles([ada.id])).get(ada.id)!.postCount).toBe(0);
  });

  test("what others do toward a suspended account is unchanged: they follow it and like, repost, reply to and quote its posts", async () => {
    const clock = ticker();
    const [ada, bob] = await Promise.all([newProfile(db), newProfile(db)]);
    const post = await newPost(repo, ada.id, clock.next());
    await suspendRowForTest(migrateDb, ada.id);
    expect(await repo.follow(bob.id, ada.id, clock.next(), true)).toBe(true);
    expect(await repo.like(bob.id, post, clock.next(), ada.id)).toBe(true);
    expect(await repo.repost(bob.id, post, clock.next(), ada.id)).toBe(true);
    expect(await repo.bookmark(bob.id, post, clock.next())).toBe(true);
    await newPost(repo, bob.id, clock.next(), "reply", { replyToId: post });
    await newPost(repo, bob.id, clock.next(), "quote", { quoteOfId: post });
    const row = (await repo.findPosts([post])).get(post)!;
    expect([row.likeCount, row.repostCount, row.replyCount, row.quoteCount]).toEqual([1, 1, 1, 1]);
  });

  test("the profile's edit and the handle change are refused while it runs; an interval that has not begun or has ended refuses nothing", async () => {
    const clock = ticker();
    const ada = await newProfile(db);
    await suspendRowForTest(migrateDb, ada.id);
    expect(await repo.updateProfile(ada.id, { bio: "" })).toBe(false);
    expect(await repo.changeHandle(ada.id, `s_${clock.next().getTime().toString(36)}`, clock.next())).toEqual({ ok: false, reason: "account_suspended" });
    // Not begun yet, and ended: the predicate compares the columns with the clock, and nothing is written at either moment.
    await suspendRowForTest(migrateDb, ada.id, { from: "1 hour", until: "2 hours" });
    expect(await repo.updateProfile(ada.id, { bio: "later" })).toBe(true);
    expect(await outcome(newPost(repo, ada.id, clock.next()).then(() => "posted"))).toBe("posted");
    await suspendRowForTest(migrateDb, ada.id, { from: "-2 hours", until: "-1 hour" });
    expect(await repo.updateProfile(ada.id, { bio: "after" })).toBe(true);
    expect(await outcome(repo.follow(ada.id, (await newProfile(db)).id, clock.next()))).toBe(true);
    await liftRowForTest(migrateDb, ada.id);
  });

  test("lockAccounts answers, from its own statement, whether each account is deleted, suspended and restricted in its reports; the mode update takes the row FOR UPDATE", LIMIT, async () => {
    const [ada, bob, carol] = await Promise.all([newProfile(db), newProfile(db), newProfile(db)]);
    await suspendRowForTest(migrateDb, ada.id, { reportsUntil: "1 day" });
    await suspendRowForTest(migrateDb, bob.id, { from: "-2 hours", until: "-1 hour", reportsUntil: "-1 minute" });
    const rows = await db.transaction((tx) => repo.lockAccounts(tx, [ada.id, bob.id, carol.id], "key share"));
    const by = new Map(rows.map((row) => [row.id, row]));
    expect(by.get(ada.id)).toEqual({ id: ada.id, deleted: false, suspended: true, reportsRestricted: true });
    expect(by.get(bob.id)).toEqual({ id: bob.id, deleted: false, suspended: false, reportsRestricted: false });
    expect(by.get(carol.id)).toEqual({ id: carol.id, deleted: false, suspended: false, reportsRestricted: false });
    // FOR UPDATE conflicts with the shared lock every write about the account takes; FOR NO KEY UPDATE does not.
    for (const mode of ["update", "no key update"] as const) {
      const blocked = await db.transaction(async (tx) => {
        await repo.lockAccounts(tx, [carol.id], mode);
        return db
          .execute(sql`select 1 from profiles where id = ${carol.id}::uuid for key share nowait`)
          .then(() => false)
          .catch(() => true);
      });
      expect(blocked, mode).toBe(mode === "update");
    }
  });

  test("a purge takes the rows of the accounts whose counters it writes before it takes any post of the account", LIMIT, async () => {
    const clock = ticker();
    const [gone, fan] = await Promise.all([newProfile(db), newProfile(db)]);
    const post = await newPost(repo, gone.id, clock.next());
    expect(await repo.follow(fan.id, gone.id, clock.next())).toBe(true);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let taken!: () => void;
    const locked = new Promise<void>((resolve) => (taken = resolve));
    // A shared lock on the follower's row: the purge's FOR NO KEY UPDATE on it waits.
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from profiles where id = ${fan.id}::uuid for share`);
      taken();
      await gate;
    });
    let purge: Promise<void> | undefined;
    try {
      await locked;
      purge = repo.purgeProfile(gone.id, clock.next(), async () => undefined);
      for (let i = 0; i < 250; i++) {
        const [row] = (await db.execute(sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`)) as unknown as { n: number }[];
        if (row!.n >= 1) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      // While the purge waits for the follower's row, it holds no post of the account yet.
      const free = await db
        .execute(sql`select 1 from posts where id = ${post}::uuid for update nowait`)
        .then(() => true)
        .catch(() => false);
      expect(free).toBe(true);
    } finally {
      release();
      await holder.catch(() => undefined);
      await purge?.catch(() => undefined);
    }
    const [row] = (await db.execute(sql`select following_count from profiles where id = ${fan.id}::uuid`)) as unknown as { following_count: number }[];
    expect(row!.following_count).toBe(0);
  });
});

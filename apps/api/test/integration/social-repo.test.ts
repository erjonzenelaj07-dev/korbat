import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { createSocialRepo, type ListRow, type SocialRepo } from "../../src/social/repo";
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
    await db.execute(sql`update posts set state = 'withheld' where id = ${withheld}::uuid`);
    await db.execute(sql`update posts set state = 'removed' where id = ${removed}::uuid`);
    await newPost(repo, ada.id, clock.next(), "reply", { replyToId: shown });

    expect(ids(await repo.profilePosts(ada.id, ada.id, undefined, 10))).toEqual([removed, withheld, shown]);
    expect(ids(await repo.profilePosts(ada.id, bob.id, undefined, 10))).toEqual([shown]);
    expect(ids(await repo.profilePosts(ada.id, null, undefined, 10))).toEqual([shown]);
    expect(ids(await repo.followingTimeline(bob.id, undefined, 10))).toEqual([shown]);
    expect(ids(await repo.followingTimeline(ada.id, undefined, 10))).toEqual([removed, withheld, shown]);
    expect(ids(await repo.latestTimeline(null, undefined, 500))).not.toContain(withheld);
  });

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
    const firstPage = await repo.followers(ada.id, undefined, 1);
    expect(firstPage.map((r) => r.profileId)).toEqual([carol.id]);
    const secondPage = await repo.followers(ada.id, { t: firstPage[0]!.sortAt.getTime(), id: firstPage[0]!.profileId }, 1);
    expect(secondPage.map((r) => r.profileId)).toEqual([bob.id]);
    expect((await repo.following(bob.id, undefined, 10)).map((r) => r.profileId)).toEqual([ada.id]);
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
});

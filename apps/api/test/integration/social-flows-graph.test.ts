import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ProfilePage, ProfileView, TimelinePage } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { setEngagement } from "../../src/social/flows/engagement";
import { blockedList, mutedList, setBlock, setFollow, setMute } from "../../src/social/flows/graph";
import { createPost, getPost } from "../../src/social/flows/posts";
import { followers, following, profile } from "../../src/social/flows/profiles";
import { bookmarkedPosts, followingTimeline, latestTimeline, likedPosts, profilePosts, profileReplies } from "../../src/social/flows/timelines";
import { liftRowForTest, suspendRowForTest } from "./moderation-fixtures";
import { rejection, socialHarness, type SocialHarness } from "./social-harness";

/** An error as PostgreSQL's deadlock reaches a flow, for the tests of the one retry (3e design, section 5): SQLSTATE 40P01. */
function deadlock(): Error {
  return Object.assign(new Error("deadlock detected"), { code: "40P01" });
}


describe.skipIf(!process.env.INTEGRATION)("integration: graph, profile and timeline flows", () => {
  let db: Db;
  let migrateDb: Db;
  let h: SocialHarness;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    // 3e: only the migrator writes a suspension into a profile row, as the ledger's standing_apply does.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    h = socialHarness(db);
  });
  afterAll(async () => {
    await Promise.all([closeDb(db), closeDb(migrateDb)]);
  });

  test("3e: a suspended account's follow is refused account_suspended; it may still unfollow, block and mute, and others may follow it", async () => {
    const [ada, bob, carol] = await Promise.all([h.established(), h.established(), h.established()]);
    await setFollow(h.deps, ada.id, bob.handle, true);
    await suspendRowForTest(migrateDb, ada.id);
    expect(await rejection(setFollow(h.deps, ada.id, carol.handle, true))).toBe("account_suspended");
    expect(await setFollow(h.deps, ada.id, bob.handle, false)).toEqual({ following: false, followerCount: 0 });
    expect(await setFollow(h.deps, carol.id, ada.handle, true)).toEqual({ following: true, followerCount: 1 });
    expect(await setMute(h.deps, ada.id, carol.handle, true)).toEqual({ muted: true });
    expect(await setBlock(h.deps, ada.id, carol.handle, true)).toEqual({ blocked: true });
    await liftRowForTest(migrateDb, ada.id);
    expect(await setFollow(h.deps, ada.id, bob.handle, true)).toEqual({ following: true, followerCount: 1 });
  });

  test("3e: a follow and an unfollow that meet one deadlock are tried once more and answer as the second try does; a second deadlock is the caller's", async () => {
    const [ada, bob] = await Promise.all([h.established(), h.established()]);
    const { follow, unfollow } = h.deps.repo;
    let failures = 1;
    const once = <A extends unknown[], R>(real: (...args: A) => Promise<R>) =>
      (...args: A): Promise<R> => (failures-- > 0 ? Promise.reject(deadlock()) : real(...args));
    try {
      h.deps.repo.follow = once(follow);
      expect(await setFollow(h.deps, ada.id, bob.handle, true)).toEqual({ following: true, followerCount: 1 });
      failures = 1;
      h.deps.repo.unfollow = once(unfollow);
      expect(await setFollow(h.deps, ada.id, bob.handle, false)).toEqual({ following: false, followerCount: 0 });
      failures = 2;
      h.deps.repo.follow = once(follow);
      expect(await rejection(setFollow(h.deps, ada.id, bob.handle, true).catch((err: unknown) => Promise.reject({ code: (err as { code?: string }).code })))).toBe("40P01");
    } finally {
      h.deps.repo.follow = follow;
      h.deps.repo.unfollow = unfollow;
    }
  });

  const post = (viewer: string, body: string, extra: { replyToId?: string; quoteOfId?: string } = {}) => {
    h.clock.next();
    return createPost(h.deps, viewer, { body, media: [], ...extra });
  };
  const page = { limit: 20 };

  test("follow and unfollow keep counts, refuse yourself, and are directional across a block", async () => {
    const [ada, bob, carol] = await Promise.all([h.established(), h.established(), h.established()]);
    expect(await setFollow(h.deps, ada.id, bob.handle, true)).toEqual({ following: true, followerCount: 1 });
    expect(await setFollow(h.deps, ada.id, `@${bob.handle.toUpperCase()}`, true)).toEqual({ following: true, followerCount: 1 });
    expect(await rejection(setFollow(h.deps, ada.id, ada.handle, true))).toBe("self_target");
    expect(await rejection(setFollow(h.deps, ada.id, "nobody_here_404", true))).toBe("not_found");

    const view = ProfileView.parse(await profile(h.deps, ada.id, bob.handle));
    expect(view.counts).toEqual({ posts: 0, followers: 1, following: 0 });
    expect(view.viewer).toEqual({ following: true, followedBy: false, blocked: false, muted: false });
    expect((await profile(h.deps, null, bob.handle)).viewer).toBeUndefined();
    expect((await profile(h.deps, bob.id, bob.handle)).viewer).toBeUndefined();

    await setBlock(h.deps, carol.id, ada.handle, true);
    expect(await rejection(setFollow(h.deps, ada.id, carol.handle, true))).toBe("not_found");
    expect(await rejection(setFollow(h.deps, carol.id, ada.handle, true))).toBe("blocked");
    expect(await setFollow(h.deps, ada.id, bob.handle, false)).toEqual({ following: false, followerCount: 0 });
  });

  test("blocking hides the profile both ways, removes follows, and unblocking restores visibility only", async () => {
    const [ada, bob] = await Promise.all([h.established(), h.established()]);
    await setFollow(h.deps, ada.id, bob.handle, true);
    await setFollow(h.deps, bob.id, ada.handle, true);
    expect(await setBlock(h.deps, ada.id, bob.handle, true)).toEqual({ blocked: true });
    expect(await rejection(profile(h.deps, ada.id, bob.handle))).toBe("not_found");
    expect(await rejection(profile(h.deps, bob.id, ada.handle))).toBe("not_found");
    expect((await profile(h.deps, null, ada.handle)).counts.followers).toBe(0);
    expect((await blockedList(h.deps, ada.id, page)).items.map((i) => i.handle)).toEqual([bob.handle]);
    expect(await rejection(setBlock(h.deps, ada.id, ada.handle, true))).toBe("self_target");

    expect(await setBlock(h.deps, ada.id, bob.handle, false)).toEqual({ blocked: false });
    expect((await profile(h.deps, bob.id, ada.handle)).viewer).toEqual({ following: false, followedBy: false, blocked: false, muted: false });
    expect((await blockedList(h.deps, ada.id, page)).items).toEqual([]);
  });

  test("blocking retracts the pair's reposts and likes of each other's posts, both ways; a third account's stay", async () => {
    const [ada, bob, carol] = await Promise.all([h.established(), h.established(), h.established()]);
    const a1 = await post(ada.id, "by ada");
    const b1 = await post(bob.id, "by bob");
    for (const [who, target, kind] of [[bob, a1, "repost"], [bob, a1, "like"], [ada, b1, "like"], [carol, a1, "like"]] as const) {
      h.clock.next();
      await setEngagement(h.deps, who.id, target.id, kind, true);
    }
    await setBlock(h.deps, ada.id, bob.handle, true);
    expect((await getPost(h.deps, null, a1.id)).counts).toMatchObject({ reposts: 0, likes: 1 });
    expect((await getPost(h.deps, null, b1.id)).counts.likes).toBe(0);
    expect((await profilePosts(h.deps, carol.id, bob.handle, page)).items.map((i) => i.kind)).toEqual(["post"]);
    expect((await getPost(h.deps, carol.id, a1.id)).viewer?.liked).toBe(true);
  });

  test("block and mute towards an account that blocks you are not_found; your own mute or block can still be undone", async () => {
    const [viewer, carol] = await Promise.all([h.established(), h.established()]);
    await setMute(h.deps, viewer.id, carol.handle, true);
    await setBlock(h.deps, carol.id, viewer.handle, true);
    expect(await rejection(setBlock(h.deps, viewer.id, carol.handle, true))).toBe("not_found");
    expect(await rejection(setMute(h.deps, viewer.id, carol.handle, true))).toBe("not_found");
    expect(await setMute(h.deps, viewer.id, carol.handle, false)).toEqual({ muted: false });
    await setBlock(h.deps, carol.id, viewer.handle, false);
    await setBlock(h.deps, viewer.id, carol.handle, true);
    // The rule cuts both ways: once the viewer blocks carol, carol's block towards the viewer is not_found too.
    expect(await rejection(setBlock(h.deps, carol.id, viewer.handle, true))).toBe("not_found");
    expect(await setBlock(h.deps, viewer.id, carol.handle, false)).toEqual({ blocked: false });
  });

  test("a follow cannot land across a concurrent block", async () => {
    for (let i = 0; i < 8; i++) {
      const [ada, bob] = await Promise.all([h.established(), h.established()]);
      const [followed, blocked] = await Promise.allSettled([setFollow(h.deps, bob.id, ada.handle, true), setBlock(h.deps, ada.id, bob.handle, true)]);
      expect(blocked.status).toBe("fulfilled");
      expect(followed.status === "fulfilled" || (followed.reason as { code: string }).code === "not_found").toBe(true);
      expect((await h.repo.relation(bob.id, ada.id)).following).toBe(false);
      expect((await h.repo.findProfiles([ada.id])).get(ada.id)!.followerCount).toBe(0);
    }
  });

  test("mutes are silent, listed for their owner, and hide timelines only", async () => {
    const [viewer, ada] = await Promise.all([h.established(), h.established()]);
    await setFollow(h.deps, viewer.id, ada.handle, true);
    const a1 = await post(ada.id, "muted soon");
    expect(await setMute(h.deps, viewer.id, ada.handle, true)).toEqual({ muted: true });
    expect((await profile(h.deps, viewer.id, ada.handle)).viewer?.muted).toBe(true);
    expect((await profile(h.deps, ada.id, viewer.handle)).viewer).toEqual({ following: false, followedBy: true, blocked: false, muted: false });
    expect((await mutedList(h.deps, viewer.id, page)).items.map((i) => i.id)).toEqual([ada.id]);
    expect((await followingTimeline(h.deps, viewer.id, page)).items).toEqual([]);
    expect((await profilePosts(h.deps, viewer.id, ada.handle, page)).items.map((i) => i.post.id)).toEqual([a1.id]);
    expect(await setMute(h.deps, viewer.id, ada.handle, false)).toEqual({ muted: false });
    expect((await followingTimeline(h.deps, viewer.id, page)).items.map((i) => i.post.id)).toEqual([a1.id]);
  });

  test("follower and following lists need a viewer, mark who the viewer follows, and hide blocked accounts", async () => {
    const [viewer, ada, bob, carol] = await Promise.all([h.established(), h.established(), h.established(), h.established()]);
    await setFollow(h.deps, bob.id, ada.handle, true);
    await setFollow(h.deps, carol.id, ada.handle, true);
    await setFollow(h.deps, viewer.id, bob.handle, true);
    const list = ProfilePage.parse(await followers(h.deps, viewer.id, ada.handle, page));
    expect(list.items.map((i) => [i.handle, i.viewerFollows])).toEqual([
      [carol.handle, false],
      [bob.handle, true],
    ]);
    expect((await following(h.deps, viewer.id, bob.handle, page)).items.map((i) => i.handle)).toEqual([ada.handle]);

    await setBlock(h.deps, carol.id, viewer.handle, true);
    expect((await followers(h.deps, viewer.id, ada.handle, page)).items.map((i) => i.handle)).toEqual([bob.handle]);
    // The blocked account is left out before the page is cut, so a page of one is bob, not an empty page with a cursor.
    expect((await followers(h.deps, viewer.id, ada.handle, { limit: 1 })).items.map((i) => i.handle)).toEqual([bob.handle]);
    const one = await followers(h.deps, ada.id, ada.handle, { limit: 1 });
    expect(one.items).toHaveLength(1);
    expect(one.nextCursor).not.toBeNull();
    expect((await followers(h.deps, ada.id, ada.handle, { limit: 1, cursor: one.nextCursor! })).items.map((i) => i.handle)).toEqual([bob.handle]);
  });

  test("timelines: following carries reposts with the reposter, latest is public, profiles split posts and replies", async () => {
    const [viewer, ada, bob] = await Promise.all([h.established(), h.established(), h.established()]);
    await setFollow(h.deps, viewer.id, ada.handle, true);
    const b1 = await post(bob.id, "from bob");
    const a1 = await post(ada.id, "from ada");
    await post(ada.id, "a reply", { replyToId: b1.id });
    h.clock.next();
    await setEngagement(h.deps, ada.id, b1.id, "repost", true);

    const feed = TimelinePage.parse(await followingTimeline(h.deps, viewer.id, page));
    expect(feed.items.map((i) => (i.kind === "repost" ? ["repost", i.post.id, i.repostedBy.handle] : ["post", i.post.id]))).toEqual([
      ["repost", b1.id, ada.handle],
      ["post", a1.id],
    ]);
    expect(feed.items[0]!.post.viewer).toEqual({ liked: false, reposted: false, bookmarked: false });

    const latest = TimelinePage.parse(await latestTimeline(h.deps, null, { limit: 50 }));
    expect(latest.items.map((i) => i.post.id)).toEqual(expect.arrayContaining([a1.id, b1.id]));
    expect(latest.items.every((i) => i.kind === "post" && i.post.viewer === undefined)).toBe(true);

    expect((await profilePosts(h.deps, null, ada.handle, page)).items.map((i) => i.kind)).toEqual(["repost", "post"]);
    expect((await profileReplies(h.deps, null, ada.handle, page)).items.map((i) => i.body)).toEqual(["a reply"]);
    await setBlock(h.deps, bob.id, viewer.handle, true);
    expect(await rejection(profilePosts(h.deps, viewer.id, bob.handle, page))).toBe("not_found");
    expect((await followingTimeline(h.deps, viewer.id, page)).items.map((i) => i.post.id)).toEqual([a1.id]);
  });

  test("likes and bookmarks are private pages, newest first, with cursors", async () => {
    const [viewer, ada] = await Promise.all([h.established(), h.established()]);
    const posts = [];
    for (let i = 0; i < 3; i++) posts.push(await post(ada.id, `p${i}`));
    for (const p of posts) {
      h.clock.next();
      await setEngagement(h.deps, viewer.id, p.id, "like", true);
    }
    h.clock.next();
    await setEngagement(h.deps, viewer.id, posts[1]!.id, "bookmark", true);
    const first = await likedPosts(h.deps, viewer.id, { limit: 2 });
    expect(first.items.map((p) => p.body)).toEqual(["p2", "p1"]);
    const second = await likedPosts(h.deps, viewer.id, { limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((p) => p.body)).toEqual(["p0"]);
    expect(second.nextCursor).toBeNull();
    expect((await bookmarkedPosts(h.deps, viewer.id, page)).items.map((p) => p.body)).toEqual(["p1"]);
    expect(await rejection(likedPosts(h.deps, viewer.id, { limit: 2, cursor: "not-a-cursor" }))).toBe("invalid_request");
  });
});

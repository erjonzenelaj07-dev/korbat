import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ProfilePage, ProfileView, TimelinePage } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { setEngagement } from "../../src/social/flows/engagement";
import { blockedList, mutedList, setBlock, setFollow, setMute } from "../../src/social/flows/graph";
import { createPost } from "../../src/social/flows/posts";
import { followers, following, profile } from "../../src/social/flows/profiles";
import { bookmarkedPosts, followingTimeline, latestTimeline, likedPosts, profilePosts, profileReplies } from "../../src/social/flows/timelines";
import { rejection, socialHarness, type SocialHarness } from "./social-harness";

describe.skipIf(!process.env.INTEGRATION)("integration: graph, profile and timeline flows", () => {
  let db: Db;
  let h: SocialHarness;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    h = socialHarness(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  const post = (viewer: string, body: string, extra: { replyToId?: string; quoteOfId?: string } = {}) => {
    h.clock.next();
    return createPost(h.deps, viewer, { body, ...extra });
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

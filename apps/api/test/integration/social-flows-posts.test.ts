import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
import { PostView, ThreadResponse } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { setEngagement } from "../../src/social/flows/engagement";
import { createPost, deletePost, getPost, thread } from "../../src/social/flows/posts";
import { closeDecisions, decideForTest, leavesNoModerationRows } from "./moderation-decide";
import { rejection, socialHarness, type SocialHarness } from "./social-harness";

// Several tests here put posts into a moderation state, each through a real, confirmed decision (a staff key's enrolment
// and sign-in once, then a step-up for each): on a loaded machine that takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 30_000 });

describe.skipIf(!process.env.INTEGRATION)("integration: post and engagement flows", () => {
  let db: Db;
  let h: SocialHarness;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    h = socialHarness(db);
  });
  afterAll(async () => {
    await closeDecisions();
    await closeDb(db);
  });

  const post = (viewer: string, body: string, extra: { replyToId?: string; quoteOfId?: string } = {}) => {
    h.clock.next();
    return createPost(h.deps, viewer, { body, media: [], ...extra });
  };

  test("posts, replies and quotes come back as views that pass the contract", async () => {
    const ada = await h.established();
    const root = await post(ada.id, "first");
    expect(PostView.parse(root)).toMatchObject({ body: "first", replyTo: null, quoteOf: null, counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 }, viewer: { liked: false, reposted: false, bookmarked: false } });
    expect(root.author).toEqual({ id: ada.id, handle: ada.handle, displayName: expect.any(String), verified: false });

    const reply = await post(ada.id, "second", { replyToId: root.id });
    expect(reply.replyTo).toEqual({ id: root.id, authorHandle: ada.handle });
    const quote = await post(ada.id, "third", { quoteOfId: root.id });
    expect(quote.quoteOf).toMatchObject({ id: root.id, body: "first", quoteOf: null });
    const quoteOfQuote = await post(ada.id, "fourth", { quoteOfId: quote.id });
    expect(quoteOfQuote.quoteOf).toMatchObject({ id: quote.id, quoteOf: null });
    expect(PostView.parse(quoteOfQuote).quoteOf).not.toHaveProperty("author.email");
    expect((await getPost(h.deps, null, root.id)).viewer).toBeUndefined();
    expect((await getPost(h.deps, ada.id, root.id)).counts).toEqual({ likes: 0, reposts: 0, replies: 1, quotes: 1 });
  });

  test("replying to or quoting a post you may not see is post_unavailable, and blocked when you blocked its author", async () => {
    const [ada, bob, carol] = await Promise.all([h.established(), h.established(), h.established()]);
    const target = await post(ada.id, "target");
    await h.repo.deletePost(target.id, ada.id, h.clock.next());
    expect(await rejection(post(bob.id, "late", { replyToId: target.id }))).toBe("post_unavailable");

    const withheld = await post(ada.id, "withheld");
    await decideForTest(db, withheld.id, "withheld");
    expect(await rejection(post(bob.id, "reply", { quoteOfId: withheld.id }))).toBe("post_unavailable");
    expect(await rejection(post(ada.id, "own reply", { replyToId: withheld.id }))).toBeNull();

    const visible = await post(ada.id, "visible");
    await h.repo.block(ada.id, bob.id, h.clock.next());
    expect(await rejection(post(bob.id, "reply", { replyToId: visible.id }))).toBe("post_unavailable");
    await h.repo.block(carol.id, ada.id, h.clock.next());
    expect(await rejection(post(carol.id, "quote", { quoteOfId: visible.id }))).toBe("blocked");
  });

  test("write limits: a new account gets five posts an hour and no quotes before 48 hours", async () => {
    const [young, ada] = await Promise.all([h.fresh(), h.established()]);
    const target = await post(ada.id, "quotable");
    for (let i = 0; i < 5; i++) expect(await rejection(post(young.id, `post ${i}`))).toBeNull();
    expect(await rejection(post(young.id, "one too many"))).toBe("rate_limited");
    expect(await rejection(post(young.id, "reply still fine", { replyToId: target.id }))).toBeNull();
    expect(await rejection(post(young.id, "quote", { quoteOfId: target.id }))).toBe("account_too_new");
    expect(await rejection(setEngagement(h.deps, young.id, target.id, "repost", true))).toBe("account_too_new");
    expect(await rejection(setEngagement(h.deps, young.id, target.id, "like", true))).toBeNull();
  });

  test("deletion: author only, blanks the body, and leaves tombstones as ancestor and quote", async () => {
    const [ada, bob, carol] = await Promise.all([h.established(), h.established(), h.established()]);
    const root = await post(ada.id, "root");
    const reply = await post(bob.id, "reply", { replyToId: root.id });
    const quote = await post(bob.id, "quote", { quoteOfId: root.id });
    expect(await rejection(deletePost(h.deps, bob.id, root.id))).toBe("not_author");
    await h.repo.block(ada.id, carol.id, h.clock.next());
    expect(await rejection(deletePost(h.deps, carol.id, root.id))).toBe("not_found");

    await deletePost(h.deps, ada.id, root.id);
    await deletePost(h.deps, ada.id, root.id);
    expect(await rejection(getPost(h.deps, ada.id, root.id))).toBe("not_found");
    const viewed = await thread(h.deps, null, reply.id, { limit: 20 });
    expect(viewed.ancestors).toEqual([{ id: root.id, deleted: true }]);
    expect((await getPost(h.deps, null, quote.id)).quoteOf).toEqual({ id: root.id, deleted: true });
    const [row] = (await db.execute(sql`select body, state from posts where id = ${root.id}::uuid`)) as unknown as { body: string; state: string }[];
    expect(row).toEqual({ body: "", state: "deleted_by_author" });
  });

  test("threads: ancestors root first with unavailable tombstones, replies page oldest first", async () => {
    const [ada, bob, viewer] = await Promise.all([h.established(), h.established(), h.established()]);
    const root = await post(ada.id, "root");
    const mid = await post(bob.id, "mid", { replyToId: root.id });
    const leaf = await post(ada.id, "leaf", { replyToId: mid.id });
    const replies = [];
    for (let i = 0; i < 3; i++) replies.push(await post(bob.id, `r${i}`, { replyToId: leaf.id }));
    const hidden = await post(ada.id, "hidden reply", { replyToId: leaf.id });
    await decideForTest(db, hidden.id, "removed");

    const first = ThreadResponse.parse(await thread(h.deps, viewer.id, leaf.id, { limit: 2 }));
    expect(first.ancestors.map((a) => a.id)).toEqual([root.id, mid.id]);
    expect(first.replies.items.map((r) => r.body)).toEqual(["r0", "r1"]);
    expect(first.replies.nextCursor).not.toBeNull();
    const second = await thread(h.deps, viewer.id, leaf.id, { limit: 2, cursor: first.replies.nextCursor! });
    expect(second.replies.items.map((r) => r.body)).toEqual(["r2"]);
    expect(second.replies.nextCursor).toBeNull();

    await h.repo.block(bob.id, viewer.id, h.clock.next());
    const blockedView = await thread(h.deps, viewer.id, leaf.id, { limit: 20 });
    expect(blockedView.ancestors).toEqual([expect.objectContaining({ id: root.id, body: "root" }), { id: mid.id, unavailable: true }]);
    expect(blockedView.replies.items).toEqual([]);
    expect((await thread(h.deps, ada.id, leaf.id, { limit: 20 })).replies.items.map((r) => r.body)).toEqual(["r0", "r1", "r2", "hidden reply"]);
  });

  test("a reply names its parent's author only to viewers who could open the parent", async () => {
    const [ada, bob, carol] = await Promise.all([h.established(), h.established(), h.established()]);
    const root = await post(ada.id, "root");
    const reply = await post(carol.id, "reply", { replyToId: root.id });
    expect((await getPost(h.deps, bob.id, reply.id)).replyTo).toEqual({ id: root.id, authorHandle: ada.handle });
    await h.repo.block(ada.id, bob.id, h.clock.next());
    expect((await getPost(h.deps, bob.id, reply.id)).replyTo).toEqual({ id: root.id, authorHandle: null });
    expect((await getPost(h.deps, carol.id, reply.id)).replyTo?.authorHandle).toBe(ada.handle);
    await decideForTest(db, root.id, "removed");
    expect((await getPost(h.deps, null, reply.id)).replyTo).toEqual({ id: root.id, authorHandle: null });
    expect((await getPost(h.deps, ada.id, reply.id)).replyTo?.authorHandle).toBe(ada.handle);
  });

  test("a hidden post answers with its state before revealing a block, and an undo works across a block", async () => {
    const [ada, viewer] = await Promise.all([h.established(), h.established()]);
    const target = await post(ada.id, "engage");
    await setEngagement(h.deps, viewer.id, target.id, "bookmark", true);
    const withheld = await post(ada.id, "withheld");
    await decideForTest(db, withheld.id, "withheld");
    await h.repo.block(viewer.id, ada.id, h.clock.next());
    expect(await rejection(setEngagement(h.deps, viewer.id, withheld.id, "like", true))).toBe("not_found");
    expect(await rejection(setEngagement(h.deps, viewer.id, target.id, "like", true))).toBe("blocked");
    expect((await setEngagement(h.deps, viewer.id, target.id, "bookmark", false)).viewer.bookmarked).toBe(false);
  });

  test("likes, reposts and bookmarks are idempotent, honour blocks in both directions, and undo without limits", async () => {
    const [ada, bob, carol] = await Promise.all([h.established(), h.established(), h.established()]);
    const target = await post(ada.id, "engage");
    expect(await setEngagement(h.deps, bob.id, target.id, "like", true)).toEqual({ counts: { likes: 1, reposts: 0, replies: 0, quotes: 0 }, viewer: { liked: true, reposted: false, bookmarked: false } });
    expect((await setEngagement(h.deps, bob.id, target.id, "like", true)).counts.likes).toBe(1);
    expect((await setEngagement(h.deps, bob.id, target.id, "bookmark", true)).counts).toEqual({ likes: 1, reposts: 0, replies: 0, quotes: 0 });
    expect((await setEngagement(h.deps, bob.id, target.id, "repost", true)).viewer).toEqual({ liked: true, reposted: true, bookmarked: true });
    expect((await setEngagement(h.deps, bob.id, target.id, "like", false)).counts.likes).toBe(0);
    expect((await setEngagement(h.deps, bob.id, target.id, "like", false)).viewer.liked).toBe(false);

    await h.repo.block(ada.id, carol.id, h.clock.next());
    expect(await rejection(setEngagement(h.deps, carol.id, target.id, "like", true))).toBe("not_found");
    await h.repo.block(bob.id, ada.id, h.clock.next());
    expect(await rejection(setEngagement(h.deps, bob.id, target.id, "like", true))).toBe("blocked");
    expect((await setEngagement(h.deps, bob.id, target.id, "repost", false)).viewer.reposted).toBe(false);
  });

  leavesNoModerationRows(() => db);
});

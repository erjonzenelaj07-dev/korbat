import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { CountsResponse, EngagementResponse, PostView, ThreadResponse, TimelinePage, type PostCounts } from "@korbat/contracts";
import { activityHarness, type ActivityHarness, type Member } from "./activity-harness";
import { liftRowForTest, suspendRowForTest } from "./moderation-fixtures";

vi.setConfig({ testTimeout: 180_000 });

/**
 * The author's hidden counts (2d design, decision 26, sections 9.2, 9.3 and 10.6; section 12.3): set in the composer or by
 * PATCH /api/posts/:id/counts, after which everyone but the author reads the post's likes and reposts as null in every
 * answer that carries counts, the answer to their own like and unlike included; replies and quotes stay numbers. The
 * author keeps the numbers. Refused for a post that is not the caller's, deleted or disabled; a suspended author may hide
 * them and is refused showing them.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: hidden counts over HTTP", () => {
  let h: ActivityHarness;

  beforeAll(async () => {
    h = await activityHarness();
  }, 120_000);
  afterAll(async () => {
    await h?.close();
  }, 120_000);

  const signUp = () => h.signUp();
  const hide = (m: Member, postId: string, hidden: boolean) => m.b.fetch(`/api/posts/${postId}/counts`, { method: "PATCH", json: { hidden } });
  const view = async (postId: string, reader?: Member) => PostView.parse(await (reader ? await reader.b.fetch(`/api/posts/${postId}`) : await h.app.request(`/api/posts/${postId}`)).json());
  const engage = async (m: Member, postId: string, kind: "like" | "repost", on: boolean) => {
    const res = await m.b.fetch(`/api/posts/${postId}/${kind}`, { method: on ? "POST" : "DELETE" });
    expect(res.status, await res.clone().text()).toBe(200);
    return EngagementResponse.parse(await res.json());
  };
  const hidden = (counts: Omit<PostCounts, "likes" | "reposts">): PostCounts => ({ likes: null, reposts: null, ...counts });

  test("hidden in the composer: the author reads the numbers, everyone else null likes and reposts in every view, the quoted embed and the answer to their own like and unlike; replies and quotes stay numbers", async () => {
    const [ada, bob, cat] = [await signUp(), await signUp(), await signUp()];
    const post = await h.post(ada, "a post whose counts are hidden", { hideCounts: true });
    expect(post).toMatchObject({ countsHidden: true, counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 } });
    // Bob likes and reposts it: his own answers carry null, never the number his act moved.
    expect((await engage(bob, post.id, "like", true)).counts).toEqual(hidden({ replies: 0, quotes: 0 }));
    expect((await engage(bob, post.id, "repost", true)).counts).toEqual(hidden({ replies: 0, quotes: 0 }));
    expect((await engage(cat, post.id, "like", true)).counts.likes).toBeNull();
    await h.post(cat, "a reply", { replyToId: post.id });
    const quote = await h.post(cat, "a quote", { quoteOfId: post.id });
    const expectedHidden = hidden({ replies: 1, quotes: 1 });
    for (const reader of [bob, cat, undefined]) {
      const got = await view(post.id, reader);
      expect(got.counts, reader?.handle ?? "signed out").toEqual(expectedHidden);
      expect(got.countsHidden).toBe(true);
    }
    // The author's numbers, in the view and in the author's own engagement answer.
    expect((await view(post.id, ada)).counts).toEqual({ likes: 2, reposts: 1, replies: 1, quotes: 1 });
    expect((await engage(ada, post.id, "like", true)).counts).toEqual({ likes: 3, reposts: 1, replies: 1, quotes: 1 });
    // The quoted embed follows the same rule, for the quote's author and for a reader of it.
    expect(((await view(quote.id, cat)).quoteOf as PostView).counts).toEqual({ ...expectedHidden, likes: null });
    expect(((await view(quote.id, ada)).quoteOf as PostView).counts).toMatchObject({ likes: 3, reposts: 1 });
    // The thread, the profile's posts, Latest and the reposter's timeline read the same.
    const thread = ThreadResponse.parse(await (await bob.b.fetch(`/api/posts/${post.id}/thread`)).json());
    expect(thread.post.counts).toEqual(expectedHidden);
    const tab = TimelinePage.parse(await (await bob.b.fetch(`/api/profiles/${ada.handle}/posts`)).json());
    expect(tab.items.find((item) => item.post.id === post.id)?.post.counts).toEqual(expectedHidden);
    const reposted = TimelinePage.parse(await (await bob.b.fetch(`/api/profiles/${bob.handle}/posts`)).json());
    expect(reposted.items.find((item) => item.kind === "repost" && item.post.id === post.id)?.post.counts).toEqual(expectedHidden);
    // Unliking tells nothing either.
    expect((await engage(bob, post.id, "like", false)).counts).toEqual(hidden({ replies: 1, quotes: 1 }));
    expect((await view(post.id, ada)).counts.likes).toBe(2);
  });

  test("the route hides and shows them on the author's own post, a withheld or removed one included; another's post, a deleted one and a disabled one are not found; a body that is not { hidden } is refused", async () => {
    const [ada, bob] = [await signUp(), await signUp()];
    const post = await h.post(ada, "counts shown, then hidden");
    expect(post.countsHidden).toBe(false);
    expect((await engage(bob, post.id, "like", true)).counts.likes).toBe(1);
    const res = await hide(ada, post.id, true);
    expect(res.status).toBe(200);
    expect(CountsResponse.parse(await res.json())).toEqual({ countsHidden: true });
    expect((await view(post.id, bob)).counts.likes).toBeNull();
    expect(CountsResponse.parse(await (await hide(ada, post.id, false)).json())).toEqual({ countsHidden: false });
    expect((await view(post.id, bob)).counts.likes).toBe(1);
    // Another account's post, as for a post that does not exist.
    const refused = await hide(bob, post.id, true);
    expect(refused.status).toBe(404);
    expect(await h.code(refused)).toBe("not_found");
    // A withheld post, which its author still sees, changes; a disabled one and a deleted one are not found.
    const [withheld, disabled, deleted] = [await h.post(ada, "withheld"), await h.post(ada, "disabled"), await h.post(ada, "deleted")];
    await h.migrateDb.execute(sql`update posts set state = 'withheld', moderation_level = 'withheld' where id = ${withheld.id}::uuid`);
    await h.migrateDb.execute(sql`update posts set state = 'disabled', moderation_level = 'disabled' where id = ${disabled.id}::uuid`);
    expect((await ada.b.fetch(`/api/posts/${deleted.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await hide(ada, withheld.id, true)).status).toBe(200);
    expect((await hide(ada, disabled.id, true)).status).toBe(404);
    expect((await hide(ada, deleted.id, true)).status).toBe(404);
    const [row] = await h.migrateDb.execute<{ hidden: boolean }>(sql`select hide_counts as hidden from posts where id = ${withheld.id}::uuid`);
    expect(row!.hidden).toBe(true);
    for (const body of [{}, { hidden: "yes" }]) expect((await ada.b.fetch(`/api/posts/${post.id}/counts`, { method: "PATCH", json: body })).status).toBe(400);
    // Signed out, nothing.
    expect((await h.app.request(`/api/posts/${post.id}/counts`, { method: "PATCH" })).status).toBe(401);
  });

  test("a suspended author may hide a post's counts, which only reduces what others see, and is refused showing them", async () => {
    const ada = await signUp();
    const post = await h.post(ada, "a post of a suspended author");
    await suspendRowForTest(h.migrateDb, ada.id);
    try {
      expect((await hide(ada, post.id, true)).status).toBe(200);
      const refused = await hide(ada, post.id, false);
      expect(refused.status).toBe(403);
      expect(await h.code(refused)).toBe("account_suspended");
    } finally {
      await liftRowForTest(h.migrateDb, ada.id);
    }
    expect((await view(post.id)).countsHidden).toBe(true);
    expect((await hide(ada, post.id, false)).status).toBe(200);
  });

  test("this file left no row behind: the accounts it made go with what hangs on them, and 2d's tables hold what they held before it", async () => {
    await h.removeMade();
    expect(await h.counts()).toEqual(h.before);
  });
});

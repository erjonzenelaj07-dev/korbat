import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { PostView, TimelineItem } from "@korbat/contracts";
import { clearFeedCache, feedCacheKey, insertPosted, readFeedCache, writeFeedCache, type FeedSnapshot } from "../src/lib/feed-cache";

/**
 * The feeds kept for the session (UI design, section 7.5; Task 5): Following's and Latest's rows, cursor and place in
 * memory, per reader, so switching Home's tabs, opening a post and coming back return to the same row without asking
 * for page one again. Nothing is written to the browser, another reader never gets them, and Explore is never kept
 * here (explore.test.tsx holds its callers to component state).
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADA = { id: id(1), handle: "ada", displayName: "Ada", verified: false };

function post(n: number): PostView {
  return { id: id(100 + n), author: ADA, body: `post ${n}`, createdAt: new Date(Date.UTC(2026, 9, 21, 9, n)).toISOString(), state: "visible", replyTo: null, counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 }, media: [], quoteOf: null, imported: null, mentions: [], countsHidden: false };
}
const item = (n: number): TimelineItem => ({ kind: "post", post: post(n) });
const snapshot = (posts: number[], extra: Partial<FeedSnapshot> = {}): FeedSnapshot => ({
  items: posts.map(item),
  cursor: "c2",
  ends: [[id(100 + posts.at(-1)!), "c2"]],
  gap: null,
  marker: null,
  unread: [],
  view: { key: id(100 + posts[1]!), offset: -12 },
  ...extra,
});

afterEach(() => clearFeedCache());

describe("the feed cache", () => {
  test("keeps a feed's rows, cursor and place for its reader, and gives them back", () => {
    expect(readFeedCache(ADA.id, "latest")).toBeNull();
    writeFeedCache(ADA.id, "latest", snapshot([5, 4, 3]));
    expect(readFeedCache(ADA.id, "latest")).toEqual(snapshot([5, 4, 3]));
    // The other feed, another reader and a signed-out reader each have their own.
    expect(readFeedCache(ADA.id, "following")).toBeNull();
    expect(readFeedCache(id(2), "latest")).toBeNull();
    expect(readFeedCache(null, "latest")).toBeNull();
    writeFeedCache(null, "latest", snapshot([9]));
    expect(readFeedCache(null, "latest")?.items).toEqual([item(9)]);
    expect(feedCacheKey(ADA.id, "latest")).not.toBe(feedCacheKey(null, "latest"));
    expect(feedCacheKey(ADA.id, "latest")).not.toBe(feedCacheKey(ADA.id, "following"));
  });

  test("the reader's own new post goes on top of both feeds kept for them, once", () => {
    writeFeedCache(ADA.id, "latest", snapshot([5, 4]));
    writeFeedCache(ADA.id, "following", snapshot([3]));
    writeFeedCache(id(2), "latest", snapshot([5, 4]));
    insertPosted(ADA.id, post(6));
    insertPosted(ADA.id, post(6));
    expect(readFeedCache(ADA.id, "latest")?.items).toEqual([item(6), item(5), item(4)]);
    expect(readFeedCache(ADA.id, "following")?.items).toEqual([item(6), item(3)]);
    // Another reader's feeds are theirs.
    expect(readFeedCache(id(2), "latest")?.items).toEqual([item(5), item(4)]);
    // A feed not kept yet reads page one when it opens, with the post in it.
    insertPosted(id(3), post(7));
    expect(readFeedCache(id(3), "latest")).toBeNull();
  });

  test("clearing forgets every feed", () => {
    writeFeedCache(ADA.id, "latest", snapshot([5]));
    clearFeedCache();
    expect(readFeedCache(ADA.id, "latest")).toBeNull();
  });

  test("lives in memory only, and never holds Explore", () => {
    const source = readFileSync(path.join(SRC, "lib", "feed-cache.ts"), "utf8");
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|AsyncStorage/);
    expect(source).not.toMatch(/social\s*\.\s*explore|"explore"/);
  });
});

import { describe, expect, test } from "vitest";
import type { PostView, TimelineItem } from "@korbat/contracts";
import { feedRows, markerWhen, MAX_ROWS, SKELETON_ROWS, timelineTime, trimOlder, type FeedRow, type FeedRowsInput } from "../src/lib/feed-rows";
import { dayTime, fullDate } from "../src/lib/time";

/**
 * The typed rows of a list (UI design, sections 8.2 and 11.1; Task 5): feedRows() turns what a list holds (its items,
 * whether its first page is in, its cursor, the reader's marker, a gap of new posts) into the rows it draws, so the
 * header and the tabs never move between loading, empty, error and posts. Every row kind, the marker's place, the gap,
 * the end, and automatic loading stopping at the marker are checked here as the pure function gives them.
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AUTHOR = { id: id(900), handle: "ada", displayName: "Ada", verified: false };

/** Post n, n minutes after nine: a higher number is newer. */
function post(n: number): PostView {
  return {
    id: id(n),
    author: AUTHOR,
    body: `post ${n}`,
    createdAt: new Date(Date.UTC(2026, 9, 21, 9, n)).toISOString(),
    state: "visible",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
  };
}
const item = (n: number): TimelineItem => ({ kind: "post", post: post(n) });
/** A feed's items, newest first: 10, 9, ... down to `last`. */
const items = (last = 1): TimelineItem[] => Array.from({ length: 11 - last }, (_, i) => item(10 - i));
const keyOf = (entry: TimelineItem) => entry.post.id;

const input = (extra: Partial<FeedRowsInput<TimelineItem>> = {}): FeedRowsInput<TimelineItem> => ({
  items: items(),
  keyOf,
  timeOf: timelineTime,
  status: "ready",
  cursor: null,
  ...extra,
});
const kinds = (rows: FeedRow<TimelineItem>[]) => rows.map((row) => (row.kind === "post" ? `post:${Number.parseInt(row.key.slice(-12), 10)}` : row.kind));

describe("the rows of a list", () => {
  test("loading: five skeleton rows and nothing else, so the header and tabs stay where they are", () => {
    const { rows } = feedRows(input({ items: [], status: "loading" }));
    expect(SKELETON_ROWS).toBe(5);
    expect(rows.map((row) => row.kind)).toEqual(["skeleton", "skeleton", "skeleton", "skeleton", "skeleton"]);
    // Each has a key of its own, and its place, for the shapes' rhythm.
    expect(new Set(rows.map((row) => row.key)).size).toBe(5);
    expect(rows.map((row) => (row.kind === "skeleton" ? row.index : -1))).toEqual([0, 1, 2, 3, 4]);
    expect(feedRows(input({ items: [], status: "loading", skeletons: 3 })).rows).toHaveLength(3);
  });

  test("a first page that failed is one error row with its sentence; an empty one is one empty row", () => {
    expect(feedRows(input({ items: [], status: "error", error: "Something went wrong on our side. Try again." })).rows).toEqual([
      { kind: "error", key: "error", message: "Something went wrong on our side. Try again." },
    ]);
    expect(feedRows(input({ items: [] })).rows).toEqual([{ kind: "empty", key: "empty" }]);
  });

  test("posts in order, each with its place in the feed; Load more while the cursor lasts, busy while a page loads", () => {
    const { rows, setSize } = feedRows(input({ cursor: "c2" }));
    expect(kinds(rows)).toEqual(["post:10", "post:9", "post:8", "post:7", "post:6", "post:5", "post:4", "post:3", "post:2", "post:1", "loadMore"]);
    expect(rows.flatMap((row) => (row.kind === "post" ? [row.position] : []))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // More can load, so the feed's size is not known (aria-setsize -1).
    expect(setSize).toBe(-1);
    expect(rows.at(-1)).toEqual({ kind: "loadMore", key: "loadMore", busy: false });
    expect(feedRows(input({ cursor: "c2", loadingMore: true })).rows.at(-1)).toEqual({ kind: "loadMore", key: "loadMore", busy: true });
    expect(rows[0]).toMatchObject({ kind: "post", key: id(10), item: item(10) });
  });

  test("a page that failed after others is a row of its own in Load more's place", () => {
    const { rows } = feedRows(input({ cursor: "c2", moreError: "korbat is busy. Try again in a moment." }));
    expect(kinds(rows).slice(-2)).toEqual(["post:1", "loadMoreError"]);
    expect(rows.at(-1)).toEqual({ kind: "loadMoreError", key: "loadMoreError", message: "korbat is busy. Try again in a moment." });
  });

  test("when the cursor runs out a feed says it has shown everything, and the feed's size is its posts", () => {
    const following = feedRows(input({ feed: "following" }));
    expect(following.rows.at(-1)).toEqual({ kind: "end", key: "end", feed: "following" });
    expect(following.setSize).toBe(10);
    expect(feedRows(input({ feed: "latest" })).rows.at(-1)).toEqual({ kind: "end", key: "end", feed: "latest" });
    // A list that is not a feed (bookmarks, a profile's tab) just ends.
    expect(kinds(feedRows(input()).rows).at(-1)).toBe("post:1");
  });

  test("the marker sits above the first post that is not newer than the newest the reader had seen", () => {
    // The reader had seen post 6; 10 to 7 are newer.
    const marker = { time: post(6).createdAt, caughtUp: false };
    const { rows } = feedRows(input({ marker, cursor: "c2" }));
    expect(kinds(rows).slice(0, 6)).toEqual(["post:10", "post:9", "post:8", "post:7", "marker", "post:6"]);
    expect(rows[4]).toEqual({ kind: "marker", key: "marker", time: post(6).createdAt, caughtUp: false });
    // A post the reader saw that is gone: the marker still goes above the first older one.
    const between = { time: new Date(Date.parse(post(6).createdAt) + 30_000).toISOString(), caughtUp: true };
    expect(kinds(feedRows(input({ marker: between })).rows).slice(4, 6)).toEqual(["marker", "post:6"]);
    expect(feedRows(input({ marker: between })).rows[4]).toMatchObject({ caughtUp: true });
    // Positions count posts only.
    expect(rows.flatMap((row) => (row.kind === "post" ? [row.position] : [])).slice(3, 5)).toEqual([4, 5]);
  });

  test("no marker over nothing newer, and none while every post shown is newer than it", () => {
    // Nothing above it would make "Newer posts are above" untrue.
    expect(kinds(feedRows(input({ marker: { time: post(10).createdAt, caughtUp: false } })).rows)).not.toContain("marker");
    expect(kinds(feedRows(input({ marker: { time: post(0).createdAt, caughtUp: false } })).rows)).not.toContain("marker");
    // A reposted post is placed by the repost's time.
    const repost: TimelineItem = { kind: "repost", post: post(1), repostedBy: AUTHOR, repostedAt: new Date(Date.UTC(2026, 9, 21, 9, 30)).toISOString() };
    expect(timelineTime(repost)).toBe(repost.repostedAt);
    expect(timelineTime(item(4))).toBe(post(4).createdAt);
  });

  test("a gap of new posts not yet loaded follows the last new post it was read with", () => {
    const { rows } = feedRows(input({ gap: { after: id(8), busy: false } }));
    expect(kinds(rows).slice(0, 4)).toEqual(["post:10", "post:9", "post:8", "gap"]);
    expect(rows[3]).toEqual({ kind: "gap", key: "gap", busy: false });
    expect(feedRows(input({ gap: { after: id(8), busy: true } })).rows[3]).toMatchObject({ kind: "gap", busy: true });
    // A gap after a post no longer listed is dropped.
    expect(kinds(feedRows(input({ gap: { after: id(99), busy: false } })).rows)).not.toContain("gap");
  });

  test("automatic loading needs the setting and a cursor, and stops at the marker: below it only the button loads", () => {
    expect(feedRows(input({ cursor: "c2", autoLoad: true })).autoLoad).toBe(true);
    expect(feedRows(input({ cursor: "c2", autoLoad: false })).autoLoad).toBe(false);
    expect(feedRows(input({ cursor: null, autoLoad: true })).autoLoad).toBe(false);
    const marked = feedRows(input({ cursor: "c2", autoLoad: true, marker: { time: post(6).createdAt, caughtUp: false } }));
    expect(kinds(marked.rows)).toContain("marker");
    expect(marked.autoLoad).toBe(false);
    // The button is still there.
    expect(kinds(marked.rows).at(-1)).toBe("loadMore");
    // A page that failed waits for the reader's Try again.
    expect(feedRows(input({ cursor: "c2", autoLoad: true, moreError: "busy" })).autoLoad).toBe(false);
    // A marker older than every post shown is not reached yet: loading goes on until it is.
    expect(feedRows(input({ cursor: "c2", autoLoad: true, marker: { time: post(0).createdAt, caughtUp: false } })).autoLoad).toBe(true);
  });

  test("the marker's time: the day and time within six days, the full date after", () => {
    const now = Date.parse("2026-10-21T12:00:00.000Z");
    const recent = "2026-10-18T08:40:00.000Z";
    const old = "2026-10-10T08:40:00.000Z";
    expect(markerWhen(recent, now)).toBe(dayTime(recent));
    expect(markerWhen(old, now)).toBe(fullDate(old));
    expect(markerWhen("2026-10-15T12:00:01.000Z", now)).toBe(dayTime("2026-10-15T12:00:01.000Z"));
  });
});

describe("at most 300 rows", () => {
  test("past 300, the oldest pages go, cut where a page ended, and Load more reads them again from that page's cursor", () => {
    expect(MAX_ROWS).toBe(300);
    const many = Array.from({ length: 320 }, (_, i) => ({ key: `r${i}` }));
    const keyOfRow = (row: { key: string }) => row.key;
    // Pages of 50 ended at rows 49, 99 ... 299, and the last page at 319 has no cursor after it.
    const ends = new Map<string, string | null>();
    for (let end = 49; end < 320; end += 50) ends.set(`r${end}`, `after-${end}`);
    ends.set("r319", null);
    const trimmed = trimOlder(many, keyOfRow, ends);
    expect(trimmed?.items).toHaveLength(300);
    expect(trimmed?.items.at(-1)).toEqual({ key: "r299" });
    expect(trimmed?.cursor).toBe("after-299");
    // Within the limit nothing changes.
    expect(trimOlder(many.slice(0, 300), keyOfRow, ends)).toBeNull();
    // Without a page's end at or before the 300th row there is nowhere to cut.
    expect(trimOlder(many, keyOfRow, new Map([["r319", null]]))).toBeNull();
  });
});

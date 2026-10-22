# korbat interface and experience (UI) — Task 5 of 10: Feeds, threads and profiles: section 8.2's feed that keeps the reader's place (typed rows, the reading place, new posts and their pill, the session's feed cache) on section 7.5's List and anchor, section 8.3's thread, section 8.4's profile with its menu and account lists, section 8.5's Bookmarks, and section 6.10's Tabs.

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-10-21 to 2026-10-22 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Task 5 of ten in korbat's UI sub-project (interface and experience), the second of the batch of Tasks 4 to 6, built from docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md on Tasks 1 to 4 (the tokens, the kit, the shell and its browser check, the post card and its menus). It follows sections 7.5, 8.2 to 8.5, 6.10, 6.11, 10, 11.1 and 11.2 with decisions 6 to 9, 15 and 19's lists; Task 6 puts the composer's card and drafts into these lists, and Task 8 builds the Appearance page that sets autoLoad, openNewest and hideCounts.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(app): the post, its media and the lightbox: PostCard is an article named by its author line, with the time as its one link to the post (postedWhen's words in its name), the name and a hidden 44 px avatar as links to the profile, and the card body as a pointer's open target with an 80 ms press wash; Reply, Repost, Like and Save act at once in per-kind request lanes, Like popping on its spring with the accent ring, Repost and Save firmer, counts rolling, Repost's reposted disc, and a refusal rolled back with a nudge, the error haptic and a toast; kit/Sheet and kit/Menu (a bottom sheet or a centred dialog, a sheet or an anchored popover, focus in and back, arrow keys) carry More's Who sees this (reach() in lib/reach.ts), Copy link, Delete with its question and Report, and Repost's menu; MediaGrid, the lightbox on a forced Dark stage that grows from its thumbnail, drags to close and pages, the hidden-image placeholders, RichText and an optimistic FollowButton move onto the tokens; drags on the web run on pointer events, so gesture-handler stays out of the bundle; the browser check gains steps 18 to 22`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/interface-experience-ui/write_blocks.py docs/superpowers/prompts/interface-experience-ui/05-feeds-threads-profiles.md 1
```

Expected: 14 lines starting with `wrote`, one for each file below.

### Create `apps/app/test/anchor.test.ts`

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { anchoredScroll, rowAtTop, scrollToShow, viewAnchor, type RowBox } from "../src/components/list/anchor.web";

/**
 * Prepending without a jump (UI design, section 7.5; Task 5). The list records the row at the top of its view and where
 * that row is in the list's content; when rows are put above it, or rows above it are drawn at their real height, the
 * scroll position moves by exactly the change, so the row stays where the reader sees it. On the web this is
 * anchor.web.ts on the scroll node, with the browser's own anchoring turned off; on native FlatList's
 * maintainVisibleContentPosition does it. The arithmetic is checked here as the pure functions do it.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");

/** Rows of the given heights, laid out from `start` in the list's content. */
function rows(heights: number[], start = 0): RowBox[] {
  let top = start;
  return heights.map((height, i) => {
    const box = { key: `r${i}`, top, height };
    top += height;
    return box;
  });
}

describe("the row at the top", () => {
  test("is the first row whose bottom is below the view's top line, which starts under a floating header", () => {
    const list = rows([100, 200, 150, 300]);
    expect(rowAtTop(list, 0)?.key).toBe("r0");
    expect(rowAtTop(list, 99)?.key).toBe("r0");
    // A row with less than a pixel left in view does not count as the top any more.
    expect(rowAtTop(list, 99.5)?.key).toBe("r1");
    expect(rowAtTop(list, 250)?.key).toBe("r1");
    expect(rowAtTop(list, 300)?.key).toBe("r2");
    expect(rowAtTop(list, 1000)).toBeNull();
    expect(rowAtTop([], 0)).toBeNull();
  });

  test("its place in the view: how far its top is below the view's top line", () => {
    const [, second] = rows([100, 200]);
    // Scrolled 140 px, with a 60 px header floating over the list: the line is at 200, the row's top at 100.
    expect(viewAnchor(second!, 140, 60)).toEqual({ key: "r1", offset: -100 });
    expect(viewAnchor(second!, 40, 60)).toEqual({ key: "r1", offset: 0 });
  });
});

describe("keeping it there", () => {
  test("rows put above it move the scroll by their height, so it does not move on screen", () => {
    // The reader is 30 px into row r2, whose top is at 300 in the content; three new rows of 120 px go above.
    expect(anchoredScroll(330, 300, 300 + 360)).toBe(690);
    // A row above drawn at its real height, 40 px shorter than guessed.
    expect(anchoredScroll(690, 660, 620)).toBe(650);
    // Nothing moved: nothing changes.
    expect(anchoredScroll(500, 300, 300)).toBe(500);
    // Never above the top of the list.
    expect(anchoredScroll(10, 300, 200)).toBe(0);
  });

  test("a row is shown at the top by scrolling to its top less the header's room and its offset", () => {
    expect(scrollToShow(900, 60)).toBe(840);
    expect(scrollToShow(900, 60, -100)).toBe(940);
    // Clamped to what the list can scroll.
    expect(scrollToShow(30, 60)).toBe(0);
    expect(scrollToShow(5000, 0, 0, 3200)).toBe(3200);
  });

  test("the web keeper corrects the scroll node itself, with the browser's own anchoring off, and native leaves it to FlatList", () => {
    const web = readFileSync(path.join(SRC, "components", "list", "anchor.web.ts"), "utf8");
    expect(web).toContain('overflowAnchor = "none"');
    expect(web).toContain("new MutationObserver(");
    expect(web).toContain("new ResizeObserver(");
    const native = readFileSync(path.join(SRC, "components", "list", "anchor.ts"), "utf8");
    expect(native).toContain("maintainVisibleContentPosition: { minIndexForVisible: 1 }");
  });
});
```

### Create `apps/app/test/feed-cache.test.ts`

```ts
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
  return { id: id(100 + n), author: ADA, body: `post ${n}`, createdAt: new Date(Date.UTC(2026, 9, 21, 9, n)).toISOString(), state: "visible", replyTo: null, counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 }, media: [], quoteOf: null };
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
```

### Create `apps/app/test/feed-rows.test.ts`

```ts
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
```

### Create `apps/app/test/new-posts.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ASK_EVERY_MS, createNewPosts, FIRST_ASK_MS, gapRows, NEW_LIMIT, newRows, pollActive } from "../src/lib/new-posts";

/**
 * New posts above the feed (UI design, decision 7, sections 8.2 and 5.2; Task 5): Following and Latest ask for their first
 * page of 50 thirty seconds after they open and every sixty seconds after, only while Home is focused, the feed is the
 * tab chosen and the page is visible; the posts newer than the list's first are put above it, and when all fifty are
 * new a gap row follows them, which reads on until it meets the posts already listed. The schedule runs on fake timers.
 */
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the schedule", () => {
  test("the first ask 30 seconds after the feed opens, then every 60 seconds", async () => {
    expect([FIRST_ASK_MS, ASK_EVERY_MS, NEW_LIMIT]).toEqual([30_000, 60_000, 50]);
    const ask = vi.fn(async () => undefined);
    const poll = createNewPosts(ask);
    poll.setActive(true);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(ask).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ask).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(ask).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(ask).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(ask).toHaveBeenCalledTimes(4);
    poll.dispose();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(ask).toHaveBeenCalledTimes(4);
  });

  test("nothing while inactive: the clock stops and goes on from where it was", async () => {
    const ask = vi.fn(async () => undefined);
    const poll = createNewPosts(ask);
    // Not active yet (the page hidden from the start): nothing at all.
    await vi.advanceTimersByTimeAsync(90_000);
    expect(ask).not.toHaveBeenCalled();
    poll.setActive(true);
    await vi.advanceTimersByTimeAsync(20_000);
    poll.setActive(false);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(ask).not.toHaveBeenCalled();
    poll.setActive(true);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(ask).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ask).toHaveBeenCalledTimes(1);
    poll.dispose();
  });

  test("an ask still out is never doubled: the next one is counted from its answer", async () => {
    let answer: () => void = () => undefined;
    const ask = vi.fn(() => new Promise<void>((resolve) => (answer = resolve)));
    const poll = createNewPosts(ask);
    poll.setActive(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ask).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(ask).toHaveBeenCalledTimes(1);
    answer();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ask).toHaveBeenCalledTimes(2);
    poll.dispose();
  });

  test("a failed ask is quiet and the schedule goes on", async () => {
    const ask = vi.fn(async () => Promise.reject(new Error("offline")));
    const poll = createNewPosts(ask);
    poll.setActive(true);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(ask).toHaveBeenCalledTimes(2);
    poll.dispose();
  });

  test("active only on Home in focus, with an account, the feed chosen and the page visible", () => {
    const all = { focused: true, signedIn: true, selected: true, visible: true };
    expect(pollActive(all)).toBe(true);
    for (const key of Object.keys(all) as (keyof typeof all)[]) expect(pollActive({ ...all, [key]: false }), key).toBe(false);
  });
});

describe("what an ask adds", () => {
  const page = (keys: string[], nextCursor: string | null = null) => ({ items: keys.map((key) => ({ key })), nextCursor });
  const keyOf = (item: { key: string }) => item.key;
  const known = new Set(["a", "b", "c"]);

  test("the posts newer than the first one listed, in order; nothing when nothing is new", () => {
    expect(newRows(page(["x", "y", "a", "b"]), keyOf, known)).toEqual({ added: [{ key: "x" }, { key: "y" }], gapCursor: null });
    expect(newRows(page(["a", "b", "c"]), keyOf, known)).toEqual({ added: [], gapCursor: null });
    // The first listed post was deleted meanwhile: what follows the new ones is still known, and stops them.
    expect(newRows(page(["x", "b", "c"]), keyOf, known).added).toEqual([{ key: "x" }]);
  });

  test("fifty new posts and none known: a gap follows them, which reads on from the page's cursor", () => {
    const fifty = Array.from({ length: NEW_LIMIT }, (_, i) => `n${i}`);
    expect(newRows(page(fifty, "after-n49"), keyOf, known)).toEqual({ added: fifty.map((key) => ({ key })), gapCursor: "after-n49" });
    // Fewer than fifty and none known: the feed was shorter than a page, nothing is missing.
    expect(newRows(page(["x", "y"], "more"), keyOf, known)).toEqual({ added: [{ key: "x" }, { key: "y" }], gapCursor: null });
  });

  test("the gap reads until it meets a post already listed", () => {
    expect(gapRows(page(["p", "q", "a", "b"], "next"), keyOf, known)).toEqual({ added: [{ key: "p" }, { key: "q" }], gapCursor: null });
    expect(gapRows(page(["p", "q"], "next"), keyOf, known)).toEqual({ added: [{ key: "p" }, { key: "q" }], gapCursor: "next" });
    expect(gapRows(page(["p"], null), keyOf, known)).toEqual({ added: [{ key: "p" }], gapCursor: null });
  });
});
```

### Create `apps/app/test/reading-place.test.ts`

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { APPEARANCE_KEY, readAppearance, setAppearance } from "../src/lib/appearance";
import {
  clearPlaces,
  createPlaceKeeper,
  newer,
  openingRow,
  PLACE_PREFIX,
  PLACE_SAVE_MS,
  PLACE_WINDOW,
  placeKey,
  placesStored,
  readPlace,
  writePlace,
  type Place,
  type PlaceRow,
} from "../src/lib/reading-place";
import { clearSessionTraces, sessionEnded } from "../src/lib/session-end";

/**
 * Where the reader stopped in Following and Latest (UI design, decisions 8 and 9, sections 8.2 and 8.8; Task 5): kept in
 * this browser under korbat.place.<accountId>, per feed, as the newest post the reader has seen and the post at the top
 * of the list, written one second after scrolling stops and when the page is hidden; a feed opens there when that post
 * is among its newest 100, unless the reader chose to open at the newest; nothing is kept for a reader who is signed
 * out; and the session's end clears every place with the appearance.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");

/** localStorage as far as the stores use it, keys in the order they were set. */
function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    get length() {
      return items.size;
    },
    key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const globals = globalThis as { localStorage?: unknown };
let storage = fakeStorage();

beforeEach(() => {
  storage = fakeStorage();
  globals.localStorage = storage;
});

afterEach(() => {
  vi.useRealTimers();
  delete globals.localStorage;
});

const ADA = "00000000-0000-4000-8000-000000000001";
const GRACE = "00000000-0000-4000-8000-000000000002";
/** Row n of a feed, n minutes after nine: a higher number is newer. */
const row = (n: number): PlaceRow => ({ key: `post-${n}`, time: new Date(Date.UTC(2026, 9, 21, 9, n)).toISOString() });
const place = (top: number, newest: number, savedAt = 1000): Place => ({ top: row(top), newest: row(newest), savedAt });

describe("the stored place", () => {
  test("is kept per account under korbat.place.<accountId>, per feed, and read back", () => {
    expect(PLACE_PREFIX).toBe("korbat.place.");
    expect(placeKey(ADA)).toBe(`korbat.place.${ADA}`);
    writePlace(ADA, "latest", place(40, 12));
    writePlace(ADA, "following", place(3, 3));
    expect(readPlace(ADA, "latest")).toEqual(place(40, 12));
    expect(readPlace(ADA, "following")).toEqual(place(3, 3));
    expect(JSON.parse(storage.items.get(`korbat.place.${ADA}`)!)).toEqual({ latest: place(40, 12), following: place(3, 3) });
    // Another account on the same browser has none of Ada's.
    expect(readPlace(GRACE, "latest")).toBeNull();
  });

  test("a damaged record, or one of the wrong shape, is no place at all", () => {
    storage.items.set(`korbat.place.${ADA}`, "{not json");
    expect(readPlace(ADA, "latest")).toBeNull();
    storage.items.set(`korbat.place.${ADA}`, JSON.stringify({ latest: { top: { key: 4 }, newest: row(2), savedAt: 1 } }));
    expect(readPlace(ADA, "latest")).toBeNull();
    // Writing again replaces it.
    writePlace(ADA, "latest", place(5, 2));
    expect(readPlace(ADA, "latest")).toEqual(place(5, 2));
  });

  test("a browser that refuses storage keeps nothing and breaks nothing", () => {
    globals.localStorage = {
      getItem: () => {
        throw new Error("The operation is insecure.");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => writePlace(ADA, "latest", place(5, 2))).not.toThrow();
    expect(readPlace(ADA, "latest")).toBeNull();
    expect(placesStored()).toBe(false);
  });

  test("the newer of two rows is the later one, and nothing is newer than something", () => {
    expect(newer(row(3), row(5))).toEqual(row(5));
    expect(newer(row(7), row(5))).toEqual(row(7));
    expect(newer(null, row(5))).toEqual(row(5));
    expect(newer(row(5), null)).toEqual(row(5));
  });
});

describe("where a feed opens (decision 9)", () => {
  // The first page and the second, newest first: post 199 down to post 0.
  const rows = Array.from({ length: 200 }, (_, i) => row(199 - i));

  test("at the stored top when it is among the newest 100, two pages of 50", () => {
    expect(PLACE_WINDOW).toBe(100);
    expect(openingRow(rows, place(150, 160), false)).toBe("post-150");
    // The 100th row is the last one in the window.
    expect(openingRow(rows, place(100, 120), false)).toBe("post-100");
  });

  test("else at the newest post: further down, gone, nothing stored, or the reader asks for the newest", () => {
    expect(openingRow(rows, place(99, 120), false)).toBeNull();
    expect(openingRow(rows, place(500, 520), false)).toBeNull();
    expect(openingRow(rows, null, false)).toBeNull();
    expect(openingRow(rows, place(150, 160), true)).toBeNull();
    // The newest post itself is the newest: nothing to move to.
    expect(openingRow(rows, place(199, 199), false)).toBeNull();
  });
});

describe("keeping the place while the reader reads", () => {
  test("the newest seen only ever moves to newer posts; the top follows the list", () => {
    const keeper = createPlaceKeeper(ADA, "latest", place(30, 40));
    expect(keeper.newest()).toEqual(row(40));
    keeper.seen([row(35), row(38)]);
    expect(keeper.newest()).toEqual(row(40));
    keeper.seen([row(44), row(41)]);
    expect(keeper.newest()).toEqual(row(44));
    keeper.top(row(36));
    keeper.hidden();
    expect(readPlace(ADA, "latest")).toMatchObject({ top: row(36), newest: row(44) });
    keeper.dispose();
  });

  test("written one second after scrolling stops, not on every scroll", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 21, 12));
    const keeper = createPlaceKeeper(ADA, "following", null);
    keeper.seen([row(9)]);
    keeper.top(row(7));
    keeper.scrolled();
    vi.advanceTimersByTime(PLACE_SAVE_MS - 100);
    keeper.top(row(6));
    keeper.scrolled();
    vi.advanceTimersByTime(PLACE_SAVE_MS - 100);
    expect(readPlace(ADA, "following")).toBeNull();
    vi.advanceTimersByTime(100);
    expect(readPlace(ADA, "following")).toEqual({ top: row(6), newest: row(9), savedAt: Date.UTC(2026, 9, 21, 12) + 2 * PLACE_SAVE_MS - 100 });
    expect(PLACE_SAVE_MS).toBe(1000);
    keeper.dispose();
  });

  test("written at once when the page is hidden, and not before both rows are known", () => {
    const keeper = createPlaceKeeper(ADA, "latest", null);
    keeper.hidden();
    expect(readPlace(ADA, "latest")).toBeNull();
    keeper.top(row(4));
    keeper.hidden();
    // The top row has been seen: it is the newest when nothing newer was.
    expect(readPlace(ADA, "latest")).toMatchObject({ top: row(4), newest: row(4) });
    keeper.dispose();
  });

  test("nothing is kept for a reader who is signed out", () => {
    vi.useFakeTimers();
    const keeper = createPlaceKeeper(null, "latest", null);
    keeper.seen([row(9)]);
    keeper.top(row(8));
    keeper.scrolled();
    keeper.hidden();
    vi.advanceTimersByTime(5000);
    expect(storage.items.size).toBe(0);
    expect(keeper.newest()).toBeNull();
    keeper.dispose();
  });
});

describe("cleared when the session ends (section 8.8)", () => {
  test("clearPlaces removes every account's place, and only places", () => {
    writePlace(ADA, "latest", place(5, 2));
    writePlace(GRACE, "following", place(5, 2));
    storage.items.set("korbat.device", "kept");
    expect(placesStored()).toBe(true);
    clearPlaces();
    expect([...storage.items.keys()]).toEqual(["korbat.device"]);
    expect(placesStored()).toBe(false);
  });

  test("a move from signed in to signed out ends it; so does a first answer of signed out while a place is stored", () => {
    expect(sessionEnded("signed-in", "signed-out", false)).toBe(true);
    expect(sessionEnded("loading", "signed-out", true)).toBe(true);
    // A visitor who never signed in on this browser keeps their appearance.
    expect(sessionEnded("loading", "signed-out", false)).toBe(false);
    expect(sessionEnded("loading", "signed-in", true)).toBe(false);
    expect(sessionEnded("signed-in", "signed-in", true)).toBe(false);
    expect(sessionEnded("signed-out", "signed-out", true)).toBe(false);
  });

  test("its end clears the appearance and every place, and leaves the device's own keys", () => {
    setAppearance({ theme: "dim" });
    writePlace(ADA, "latest", place(5, 2));
    storage.items.set("korbat.device", "kept");
    clearSessionTraces();
    expect(storage.items.has(APPEARANCE_KEY)).toBe(false);
    expect(readAppearance().theme).toBe("system");
    expect([...storage.items.keys()]).toEqual(["korbat.device"]);
  });

  test("the provider decides with sessionEnded on every change of its state, and clears through the stores' own functions", () => {
    const session = readFileSync(path.join(SRC, "lib", "session.tsx"), "utf8");
    expect(session).toContain("if (sessionEnded(previous.current, state.status, placesStored())) clearSessionTraces();");
    const end = readFileSync(path.join(SRC, "lib", "session-end.ts"), "utf8");
    expect(end).toContain("clearAppearance();");
    expect(end).toContain("clearPlaces();");
    // reading-place.ts is the only module that touches the places' keys.
    expect(session + end).not.toContain("korbat.place");
  });
});
```

### Replace `apps/app/test/browser/app.browser.ts` (whole file)

```ts
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { THEMES, type ThemeName } from "../../src/theme/tokens";
import { TITLE_WORDS, UI_WORDS } from "../../src/lib/ui-words";
import { appSiteHeadersFromCaddyfile } from "./caddyfile";
import { ADA, createFixtureApi, DECISION_ID, MISSING_POST_ID, newPostIdOf, NOTICE_REF, NOTICE_TOKEN, POST_ID, postIdOf, RELEASE_ID, UPLOAD_ID, type FixtureApi } from "./fixture-api";
import { HOLD_MS, startAppSite, type AppSiteServer } from "./server";
import { clippedLabels, phoneProblems, TURNSTILE_ORIGIN, watch, type Watcher } from "./watch";

/**
 * The app's browser check (UI design, section 12.3, decision 20; Task 3): the web export, built once per run with the
 * check's own environment (no apps/app/.env, an empty API base so every call goes to this server's origin, Cloudflare's
 * published Turnstile test key), served as Caddy's app site serves it by test/browser/server.ts, with the fixture API
 * of fixture-api.ts beside it, and walked in Chromium through playwright-core. Turnstile's script is answered by a stub
 * that hands its widget a test token, so the walk needs no network and no stack. Each step opens its own browser context
 * (its width, theme, motion and session) and fails on any policy report, console error or warning, page error, dialog,
 * failed request or request the fixtures do not answer (watch.ts).
 *
 * The steps, one test each: the budgets of section 11.3; the Caddyfile's headers; the first paint in the stored theme
 * with the bundle held back; the layout at 360, 768 and 1280 px on Home, a post, a profile, /rules and a missing page;
 * the keyboard; contrast as drawn in Light, Dim and Dark; text at Largest with the root at 200 percent at 320 px; every
 * route signed out and signed in; the requests and the time before the first content; the offline banner; the header
 * that hides on a phone, and stays under reduced motion; the soft reset; and from Task 4 the lightbox, Like with its
 * rollback, Follow with its rollback, the menus, and Who sees this; from Task 5 the new-posts pill, the reading place, the
 * feeds kept across tabs, the keyboard on Home, and the focus after a delete with the thread held at its post. Later
 * tasks add their screens' steps.
 *
 * It never downloads a browser. By default it drives the Chromium build playwright-core 1.63.0 names (chromium-1243 under
 * ms-playwright), which must already be installed; KORBAT_BROWSER_CHANNEL=chrome drives the machine's own Chrome. The
 * screenshots of the layout steps go to KORBAT_SHOTS, or to a new folder in the system's temporary folder, and are
 * never compared pixel by pixel.
 */
const CHANNEL = process.env.KORBAT_BROWSER_CHANNEL || "chromium";
const APP = path.resolve(import.meta.dirname, "..", "..");
const REPO = path.resolve(APP, "..", "..");

/** The export's environment (section 12.3): set in the child, so the developer's apps/app/.env is never read. */
const EXPORT_ENV: Record<string, string> = {
  EXPO_NO_DOTENV: "1",
  EXPO_NO_TELEMETRY: "1",
  CI: "1",
  EXPO_PUBLIC_API_URL: "",
  EXPO_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  EXPO_PUBLIC_BADGE: "off",
  EXPO_PUBLIC_CONTACT_EMAIL: "contact@korbat.local",
  EXPO_PUBLIC_CONTACT_POINT: "",
  EXPO_PUBLIC_HOME_STATE: "",
};

/** The test token Turnstile's stub gives every widget, as Cloudflare's test keys do. */
const TURNSTILE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

/**
 * Turnstile's script as the walk answers it: window.turnstile with the calls @marsidev/react-turnstile makes, a widget
 * that hands its callback the test token at once, and the load callback the script's address names.
 */
const TURNSTILE_STUB = `
(function () {
  var source = document.currentScript && document.currentScript.src ? new URL(document.currentScript.src) : null;
  var count = 0;
  window.turnstile = {
    render: function (container, options) {
      count += 1;
      var id = "stub-" + count;
      setTimeout(function () { if (options && typeof options.callback === "function") options.callback(${JSON.stringify(TURNSTILE_TOKEN)}); }, 0);
      return id;
    },
    reset: function () {},
    remove: function () {},
    execute: function () {},
    getResponse: function () { return ${JSON.stringify(TURNSTILE_TOKEN)}; },
    isExpired: function () { return false; },
    ready: function (callback) { callback(); }
  };
  var onload = source ? source.searchParams.get("onload") : null;
  if (onload && typeof window[onload] === "function") window[onload]();
})();
`;

let out = "";
let shots = "";
let site: AppSiteServer | undefined;
let browser: Browser | undefined;
let fixtures: FixtureApi;
let origin = "";

/** Runs the export into `dir`, failing with the end of its output. */
function exportWeb(dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(REPO, "node_modules", "expo", "bin", "cli"), "export", "--platform", "web", "--output-dir", dir, "--clear"], {
      cwd: APP,
      env: { ...process.env, ...EXPORT_ENV },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout.on("data", (chunk: Buffer) => (log += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (log += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`expo export exited with ${code}: ${log.slice(-3000)}`))));
  });
}

interface Visit {
  context: BrowserContext;
  page: Page;
  watcher: Watcher;
}

interface VisitOptions {
  width: number;
  height: number;
  signedIn?: boolean;
  /** The reader's stored appearance (korbat.appearance), set before any of the page's scripts runs. */
  appearance?: Record<string, unknown>;
  reducedMotion?: "reduce" | "no-preference";
  colorScheme?: "light" | "dark";
}

/** A fresh browser context at a width, with its session, appearance and motion, watched, and Turnstile stubbed. */
async function open(options: VisitOptions): Promise<Visit> {
  fixtures.state.signedIn = options.signedIn ?? true;
  const context = await browser!.newContext({
    viewport: { width: options.width, height: options.height },
    timezoneId: "UTC",
    locale: "en-GB",
    reducedMotion: options.reducedMotion ?? "no-preference",
    colorScheme: options.colorScheme ?? "light",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const watcher = await watch(context, page, origin);
  // Registered after the watcher's catch-all, so it runs first: Turnstile's address is answered by the stub.
  await context.route(`${TURNSTILE_ORIGIN}/**`, (route) => route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: TURNSTILE_STUB }));
  if (options.appearance) {
    const stored = JSON.stringify(JSON.stringify(options.appearance));
    await context.addInitScript({ content: `try { window.localStorage.setItem("korbat.appearance", ${stored}); } catch (error) {}` });
  }
  return { context, page, watcher };
}

/** Opens a path and waits until the page has asked for and drawn what it needs, and its fonts are in. */
async function visit(page: Page, route: string): Promise<void> {
  await page.goto(`${origin}${route}`);
  await page.waitForLoadState("networkidle");
  await page.evaluate("document.fonts.ready.then(() => true)");
}

/** The end of every step: no report, error, warning or dialog on any channel, and nothing the fixtures did not answer. */
async function clean(visit: Visit): Promise<void> {
  expect(visit.watcher.take()).toEqual([]);
  expect(fixtures.state.problems.splice(0)).toEqual([]);
}

/** Waits until an expression is true in the page. The expression is plain text, evaluated as the page's own code is not. */
async function until(page: Page, expression: string, what: string, timeout = 15_000): Promise<void> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await page.evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`not within ${timeout} ms: ${what}`);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A token colour as getComputedStyle writes it. */
function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

/**
 * KORBAT_APP_EXPORT names an export already built with EXPORT_ENV, which a developer re-running the walk while working on
 * it may reuse; it is read and never deleted. Without it, as the gates run the check, the walk builds its own.
 */
const PREBUILT = process.env.KORBAT_APP_EXPORT ? path.resolve(process.env.KORBAT_APP_EXPORT) : null;

beforeAll(async () => {
  shots = process.env.KORBAT_SHOTS ? path.resolve(process.env.KORBAT_SHOTS) : mkdtempSync(path.join(tmpdir(), "korbat-app-shots-"));
  mkdirSync(shots, { recursive: true });
  console.log(`screenshots: ${shots}`);
  if (PREBUILT) {
    out = PREBUILT;
  } else {
    out = mkdtempSync(path.join(tmpdir(), "korbat-app-browser-"));
    await exportWeb(out);
  }
  fixtures = createFixtureApi();
  site = await startAppSite({ dist: out, api: fixtures.handle, postStatus: fixtures.postStatus });
  origin = site.origin;
  browser = await chromium.launch({ channel: CHANNEL, headless: true });
});

afterAll(async () => {
  await browser?.close();
  await site?.close();
  if (out && !PREBUILT) rmSync(out, { recursive: true, force: true });
});

/** The files of the export under a folder, with their sizes raw and gzip at level 9 (Task 1's method, baseline.json). */
function sizes(folder: string): { name: string; bytes: number; gzip: number }[] {
  const dir = path.join(out, folder);
  return readdirSync(dir).map((name) => {
    const bytes = readFileSync(path.join(dir, name));
    return { name, bytes: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
  });
}

/** The routes of the app (section 3.1) with the fixtures' ids, for the walk through every one. */
const TOKEN = "B".repeat(43);
const ROUTES = [
  "/",
  "/?tab=latest",
  "/?tab=explore",
  "/bookmarks",
  "/explore/about",
  `/post/${POST_ID}`,
  "/u/grace",
  "/u/ada",
  "/u/grace/followers",
  "/u/grace/following",
  "/report",
  `/notice/${NOTICE_REF}#t=${NOTICE_TOKEN}`,
  "/rules",
  "/transparency",
  "/terms",
  "/settings/security",
  "/settings/privacy",
  "/settings/profile",
  "/settings/account",
  "/settings/cases",
  `/settings/cases/${DECISION_ID}`,
  `/settings/cases/${DECISION_ID}/reply`,
  `/settings/cases/releases/${RELEASE_ID}`,
  `/settings/cases/uploads/${UPLOAD_ID}`,
  "/signin",
  "/code",
  "/password",
  "/mfa",
  "/age",
  "/handle",
  `/email-revert/${TOKEN}`,
  `/not-me/${TOKEN}`,
  `/passkey-remove/${TOKEN}`,
  "/no-such-page",
];

/**
 * The parts of a page this sub-project has drawn so far, which the walk holds to the phone's target rule, the labels'
 * fit and contrast as drawn: the skip link, the nav, the context column, the screen header, the offline banner, and a
 * screen that is the kit's alone (the missing page); from Task 4 every post card (an article), every sheet and dialog,
 * a menu's popover, the follow button and the toaster; from Task 5 every row of a feed (its posts, the marker, Load more,
 * the end), the tab lists, the new-posts pill, the profile's header and the thread's posts. A feed's header is not held
 * yet: it holds the composer, which Task 6 moves onto the tokens. The screens' own content still paints with Tailwind's
 * palette and sizes until its task moves it onto the tokens (test/legacy-files.ts), and joins this list then: the
 * composer with Task 6, the moderation and public pages with Task 7, settings and sign-in with Task 8.
 */
const DRAWN = [
  'a[href="#main"]',
  'nav[aria-label="Main"]',
  'aside[aria-label="About korbat"]',
  "#screen-header",
  'main > [role="status"]',
  '[role="article"]',
  '[role="dialog"]',
  "[data-menu]",
  "[data-follow]",
  "[data-sonner-toaster]",
  '[role="feed"] [data-row]',
  '[role="tablist"]',
  "[data-pill]",
  "[data-profile-header]",
  "[data-thread]",
].join(", ");
/** A page drawn wholly on the kit: everything on it is held to the rules. */
const ALL = "body";

/**
 * The pages of the layout steps: Home, a post, a profile, the rules and a missing page, with the item current on each;
 * from Task 5 Bookmarks and a followers list too, drawn wholly on the kit.
 */
const LAYOUT_PAGES: { name: string; route: string; current: string | null; scope: string }[] = [
  { name: "home", route: "/", current: "/", scope: DRAWN },
  { name: "post", route: `/post/${POST_ID}`, current: null, scope: DRAWN },
  { name: "profile", route: "/u/grace", current: null, scope: DRAWN },
  { name: "rules", route: "/rules", current: null, scope: DRAWN },
  { name: "missing", route: "/no-such-page", current: null, scope: ALL },
  { name: "bookmarks", route: "/bookmarks", current: "/bookmarks", scope: ALL },
  { name: "followers", route: "/u/grace/followers", current: null, scope: ALL },
];


/** What the layout of a page says of itself: its kind, the nav's current links, the context column, and the current item's marks. */
const LAYOUT_SCRIPT = `
(() => {
  const root = document.querySelector("[data-layout]");
  const nav = document.querySelector('nav[aria-label="Main"]');
  const current = nav ? [...nav.querySelectorAll('a[aria-current="page"]')] : [];
  const marks = current.length === 1 ? [current[0], ...current[0].querySelectorAll("*")].map((element) => {
    const rect = element.getBoundingClientRect();
    return { bg: getComputedStyle(element).backgroundColor, width: Math.round(rect.width), height: Math.round(rect.height) };
  }) : [];
  return {
    kind: root ? root.getAttribute("data-layout") : null,
    current: current.map((link) => link.getAttribute("href")),
    context: !!document.querySelector('aside[aria-label="About korbat"]'),
    marks,
    scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    title: document.title,
  };
})()
`;

interface Layout {
  kind: string | null;
  current: string[];
  context: boolean;
  marks: { bg: string; width: number; height: number }[];
  scroll: number;
  title: string;
}

/** The layout steps at one size: each page in Light and Dark, the shell's kind and marks, the phone's rules, screenshots. */
async function layoutStep(width: number, height: number, kind: string): Promise<void> {
  for (const theme of ["light", "dark"] as const) {
    const visit_ = await open({ width, height, appearance: { theme } });
    try {
      for (const page of LAYOUT_PAGES) {
        await visit(visit_.page, page.route);
        const layout = (await visit_.page.evaluate(LAYOUT_SCRIPT)) as Layout;
        expect(layout.kind, page.name).toBe(kind);
        expect(layout.current, page.name).toEqual(page.current === null ? [] : [page.current]);
        // The context column from 1024 px only.
        expect(layout.context, page.name).toBe(width >= 1024);
        expect(layout.scroll, `${page.name}: no horizontal scroll`).toBeLessThanOrEqual(0);
        expect(await clippedLabels(visit_.page, page.scope), page.name).toEqual([]);
        if (width < 768) expect(await phoneProblems(visit_.page, page.scope), page.name).toEqual([]);
        if (page.current !== null) {
          // The current item: the accent-wash pill and a 3 px accent bar, so it is marked by shape as well as colour.
          const colours = THEMES[theme as ThemeName];
          expect(layout.marks.some((mark) => mark.bg === rgb(colours["accent-wash"])), `${page.name}: the pill`).toBe(true);
          expect(layout.marks.some((mark) => mark.bg === rgb(colours.accent) && (mark.width === 3 || mark.height === 3)), `${page.name}: the bar`).toBe(true);
        }
        if (page.name === "missing") {
          expect(layout.title).toBe(TITLE_WORDS["title.notFound"]);
          expect(await visit_.page.locator("h1").innerText()).toBe(UI_WORDS["notFound.title"]);
        }
        await screenshot(visit_.page, `layout-${width}-${theme}-${page.name}`);
        await clean(visit_);
      }
    } finally {
      await visit_.context.close();
    }
  }
}

/**
 * Every text of the nav, the main column and the context column, sampled as drawn against its nearest opaque background
 * (with any see-through layers between blended in): 4.5:1, or 3:1 from 24 px, or 18.66 px in bold (WCAG 1.4.3). Text
 * hidden from assistive technology as decoration (aria-hidden, the skeletons), or clipped to 1 px, is passed over.
 */
const CONTRAST_SCRIPT = `
((scope) => {
  const parse = (value) => {
    const match = /rgba?[(]([^)]+)[)]/.exec(value);
    if (!match) return null;
    const parts = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const channel = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const luminance = (c) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const background = (element) => {
    const layers = [];
    for (let node = element; node; node = node.parentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0) { layers.push(bg); if (bg.a >= 1) break; }
    }
    let colour = parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    if (colour.a < 1) colour = over(colour, { r: 255, g: 255, b: 255, a: 1 });
    for (let i = layers.length - 1; i >= 0; i--) colour = over(layers[i], colour);
    return colour;
  };
  const out = [];
  const regions = document.querySelectorAll(scope);
  for (const region of regions) {
    for (const element of region.querySelectorAll("*")) {
      const own = [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim().length > 0);
      if (!own) continue;
      if (element.closest("[aria-hidden=true]")) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden") continue;
      let opacity = 1;
      for (let node = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      if (opacity === 0) continue;
      const fg = parse(style.color);
      if (!fg) continue;
      const bg = background(element);
      const drawn = over({ ...fg, a: fg.a * opacity }, bg);
      const size = parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      const least = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      const found = ratio(drawn, bg);
      if (found < least) out.push(element.textContent.trim().slice(0, 40) + ": " + found.toFixed(2) + " < " + least + " (" + style.color + " on rgb(" + Math.round(bg.r) + ", " + Math.round(bg.g) + ", " + Math.round(bg.b) + "))");
    }
  }
  return out;
})
`;

/** The contrast failures of the text inside `scope`. */
const contrast = (page: Page, scope: string) => page.evaluate(`${CONTRAST_SCRIPT}(${JSON.stringify(scope)})`) as Promise<string[]>;

/** The scroll box of the main column's list: the element in main that scrolls vertically and has more to scroll. */
const LIST = `(() => [...document.querySelectorAll("main *")].find((e) => { const s = getComputedStyle(e); return (s.overflowY === "auto" || s.overflowY === "scroll") && e.scrollHeight > e.clientHeight + 10; }) || null)()`;

/** The phone header's translateY, from its computed transform; null without one. */
const HEADER_Y = `(() => { const h = document.getElementById("screen-header"); if (!h) return null; const t = getComputedStyle(h).transform; if (t === "none") return 0; const m = /matrix[(]([^)]+)[)]/.exec(t); return m ? Number(m[1].split(",")[5]) : null; })()`;
const HEADER_HEIGHT = `(() => { const h = document.getElementById("screen-header"); return h ? h.getBoundingClientRect().height : null; })()`;

/** Scrolls the main column's list to `y`, in a few steps, as a reader's wheel would. */
async function scrollList(page: Page, y: number): Promise<void> {
  const from = (await page.evaluate(`(${LIST})?.scrollTop ?? 0`)) as number;
  for (let step = 1; step <= 4; step++) {
    await page.evaluate(`(() => { const list = ${LIST}; if (list) list.scrollTop = ${Math.round(from + ((y - from) * step) / 4)}; })()`);
    await pause(60);
  }
}

/**
 * The motion steps' three runs (section 12.3): no reduction, the system's reduced motion, and korbat's own "Reduce motion:
 * Always" with the system's off, as step 16 runs them.
 */
const MOTION_RUNS = [
  ["moves", {}],
  ["system-reduced", { reducedMotion: "reduce" as const }],
  ["korbat-reduced", { appearance: { theme: "light", reduceMotion: "always" } }],
] as const;

/**
 * An element's computed transform or opacity on every frame for `ms`, from now: the element is found anew each frame by
 * `find`, a page expression, and a frame without it gives null. Started before a click, it sees the motion the click
 * starts from its first frame.
 */
function sampleFrames(page: Page, find: string, property: "transform" | "opacity", ms: number): Promise<(string | null)[]> {
  return page.evaluate(
    `new Promise((resolve) => { const out = []; const start = performance.now(); const tick = () => { const e = ${find}; out.push(e ? getComputedStyle(e)[${JSON.stringify(property)}] : null); if (performance.now() - start < ${ms}) requestAnimationFrame(tick); else resolve(out); }; tick(); })`,
  ) as Promise<(string | null)[]>;
}

/** Whether any frame drew a transform other than none or the identity: something moved. */
const transformed = (frames: (string | null)[]) => frames.some((frame) => frame !== null && frame !== "none" && frame !== "matrix(1, 0, 0, 1, 0, 0)");
/** Whether any frame drew the element less than opaque: something faded. */
const faded = (frames: (string | null)[]) => frames.some((frame) => frame !== null && Number(frame) < 0.98);

/** The accessible name of the open dialog, from the ids its aria-labelledby names. */
const DIALOG_NAME = `(() => { const d = document.querySelector('[role="dialog"]'); if (!d) return null; return (d.getAttribute("aria-labelledby") || "").split(" ").filter(Boolean).map((id) => { const e = document.getElementById(id); return e ? e.textContent : ""; }).join(" "); })()`;

/** What holds the focus: its name, or else its words. */
const FOCUSED = `(() => { const e = document.activeElement; if (!e || e === document.body) return null; return (e.getAttribute("aria-label") || e.textContent || "").trim(); })()`;

/** The end of a step that had the fixtures refuse on purpose: the browser's report of each 503 is expected, nothing else. */
async function cleanAfterRefusals(visit: Visit): Promise<void> {
  expect(visit.watcher.take().filter((line) => !/status of 503/.test(line))).toEqual([]);
  expect(fixtures.state.problems.splice(0)).toEqual([]);
}

/** The n-th article of the list on screen (0 for the first). */
const article = (page: Page, n: number) => page.locator('[role="article"]').nth(n);
/** The article of fixture post `n`, found by its one link to the post. */
const postArticle = (page: Page, n: number) => page.locator('[role="article"]').filter({ has: page.locator(`a[href="/post/${postIdOf(n)}"]`) });

/**
 * How much of a greyscale screenshot differs from its own background: the pixels whose luminance is more than 0.08 away
 * from the corner's, counted in the page from the PNG through a canvas (the policy allows data: images).
 */
const INK_SCRIPT = `
(async (url) => {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, image.width, image.height).data;
  const grey = (i) => (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
  const ground = grey(0);
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) if (Math.abs(grey(i) - ground) > 0.08) ink += 1;
  return ink;
})
`;

/** The inked pixels of the left 36 px of a counted icon button: its 28 px glyph box after the 8 px padding. */
async function glyphInk(page: Page, button: ReturnType<Page["locator"]>): Promise<number> {
  const box = (await button.boundingBox())!;
  const shot = await page.screenshot({ clip: { x: box.x, y: box.y, width: 36, height: box.height } });
  return (await page.evaluate(`${INK_SCRIPT}(${JSON.stringify(`data:image/png;base64,${shot.toString("base64")}`)})`)) as number;
}

describe("the app in Chromium, under the app site's policy", () => {
  test("1. the budgets of section 11.3: the bundle, the stylesheet and the latin fonts", () => {
    const baseline = JSON.parse(readFileSync(path.join(import.meta.dirname, "baseline.json"), "utf8")) as { js: { gzipBytes: number } };
    const js = sizes(path.join("_expo", "static", "js", "web"));
    const css = sizes(path.join("_expo", "static", "css"));
    const jsGzip = js.reduce((sum, file) => sum + file.gzip, 0);
    const cssGzip = css.reduce((sum, file) => sum + file.gzip, 0);
    console.log(`budgets: JS ${jsGzip} bytes gzip in ${js.length} file(s), CSS ${cssGzip}`);
    // The baseline (1222b87) is above 400 KB, so the cap is the baseline plus 80 KB.
    expect(jsGzip).toBeLessThanOrEqual(baseline.js.gzipBytes + 80 * 1024);
    expect(baseline.js.gzipBytes + 80 * 1024).toBe(791_297);
    expect(cssGzip).toBeLessThanOrEqual(40 * 1024);
    const fonts: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(path.join(dir, entry.name));
        else if (/-latin-(?!ext)[a-z-]*\.[0-9a-f]+\.woff2$/.test(entry.name)) fonts.push(path.join(dir, entry.name));
      }
    };
    walk(path.join(out, "assets"));
    expect(fonts.length).toBeGreaterThanOrEqual(3);
    const latin = fonts.reduce((sum, file) => sum + readFileSync(file).length, 0);
    console.log(`budgets: latin fonts ${latin} bytes in ${fonts.length} files`);
    expect(latin).toBeLessThanOrEqual(320 * 1024);
  });

  test("2. the page, theme-boot.js, a font and the bundle come with the Caddyfile's app headers and caching; a post's page takes the post's status", async () => {
    const headersFor = appSiteHeadersFromCaddyfile();
    const index = readFileSync(path.join(out, "index.html"), "utf8");
    const bundle = /src="(\/_expo\/static\/js\/web\/[^"]+\.js)"/.exec(index)?.[1] ?? "";
    expect(bundle).not.toBe("");
    const font = /\/assets\/[^"'`]+?\.woff2/.exec(readFileSync(path.join(out, bundle), "utf8"))?.[0] ?? "";
    expect(font).toMatch(/^\/assets\/__node_modules\/@fontsource-variable\/[a-z-]+\/files\/[a-z0-9-]+\.[0-9a-f]+\.woff2$/);
    const expected: Record<string, string> = { "/": "no-cache", "/theme-boot.js": "no-cache", [font]: "public, max-age=31536000, immutable", [bundle]: "public, max-age=31536000, immutable" };
    for (const [pathname, cache] of Object.entries(expected)) {
      const answer = await fetch(`${origin}${pathname}`);
      expect(answer.status, pathname).toBe(200);
      expect(answer.headers.get("cache-control"), pathname).toBe(cache);
      for (const [name, value] of Object.entries(headersFor(pathname, pathname !== "/"))) expect(answer.headers.get(name), `${pathname} ${name}`).toBe(value);
      expect(answer.headers.get("content-security-policy"), pathname).toContain("script-src 'self' https://challenges.cloudflare.com");
      await answer.arrayBuffer();
    }
    expect((await fetch(`${origin}/post/${POST_ID}`)).status).toBe(200);
    expect((await fetch(`${origin}/post/${MISSING_POST_ID}`)).status).toBe(404);
    expect(fixtures.state.problems.splice(0)).toEqual([]);
  });

  test("3. the first paint is already in the stored theme, with the bundle held back", async () => {
    for (const theme of ["light", "dark"] as const) {
      // The system says the other scheme, so the stored choice is what decides.
      const visit_ = await open({ width: 1280, height: 900, signedIn: false, appearance: { theme }, colorScheme: theme === "light" ? "dark" : "light" });
      try {
        site!.state.holdBundle = true;
        const started = Date.now();
        await visit_.page.goto(`${origin}/`, { waitUntil: "commit" });
        await until(visit_.page, `document.documentElement.classList.contains(${JSON.stringify(theme)}) && !!document.body`, `the html element in ${theme}`);
        const first = (await visit_.page.evaluate(`({ background: getComputedStyle(document.documentElement).backgroundColor, drawn: document.getElementById("root") ? document.getElementById("root").childElementCount : -1 })`)) as { background: string; drawn: number };
        // Still within the hold: the bundle has not run, and theme-boot.js has painted the theme's surface.
        expect(Date.now() - started).toBeLessThan(HOLD_MS);
        expect(first.drawn).toBe(0);
        expect(first.background).toBe(rgb(THEMES[theme].surface));
        site!.state.holdBundle = false;
        await until(visit_.page, `document.querySelector("[data-layout]") !== null`, "the app drawn");
        await visit_.page.waitForLoadState("networkidle");
        expect(await visit_.page.evaluate(`getComputedStyle(document.documentElement).backgroundColor`)).toBe(rgb(THEMES[theme].surface));
        await clean(visit_);
      } finally {
        site!.state.holdBundle = false;
        await visit_.context.close();
      }
    }
  });

  test("4. the layout at 360 by 740: the tab bar, no context column, no sideways scroll, nothing clipped, every control 44 px", async () => {
    await layoutStep(360, 740, "phone");
  });

  test("5. the layout at 768 by 1024: the rail, no context column", async () => {
    await layoutStep(768, 1024, "tablet");
  });

  test("6. the layout at 1280 by 900: the full nav and the context column", async () => {
    await layoutStep(1280, 900, "wide");
  });

  test("7. the keyboard: the skip link first, then the nav in order, then the main column, every focus drawn at 2 px or more", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "dark" } });
    try {
      await visit(visit_.page, "/");
      const focused = `(() => { const e = document.activeElement; const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return { tag: e.tagName.toLowerCase(), href: e.getAttribute("href"), role: e.getAttribute("role"), inMain: !!e.closest("main"), isMain: e.tagName === "MAIN", inNav: !!e.closest('nav[aria-label="Main"]'), outline: s.outlineStyle, width: parseFloat(s.outlineWidth), w: r.width, h: r.height }; })()`;
      type Focus = { tag: string; href: string | null; role: string | null; inMain: boolean; isMain: boolean; inNav: boolean; outline: string; width: number; w: number; h: number };
      const stops: Focus[] = [];
      for (let i = 0; i < 6; i++) {
        await visit_.page.keyboard.press("Tab");
        stops.push((await visit_.page.evaluate(focused)) as Focus);
        if (i === 0) await screenshot(visit_.page, "keyboard-1280-dark-skip");
        if (i === 1) await screenshot(visit_.page, "keyboard-1280-dark-nav");
      }
      expect(stops[0]!.href).toBe("#main");
      // The skip link shows itself while it holds the focus, at a control's size.
      expect(stops[0]!.w).toBeGreaterThanOrEqual(44);
      expect(stops[0]!.h).toBeGreaterThanOrEqual(44);
      expect(stops.slice(1, 5).map((stop) => (stop.inNav ? stop.href : null))).toEqual(["/", "/bookmarks", "/u/ada", "/settings/security"]);
      expect(stops[5]!.inMain).toBe(true);
      // Every stop draws korbat's ring, 2 px: the shell's, and the first stop inside Home's column, Home's own tab (Task 5).
      expect(stops[5]!.role).toBe("tab");
      for (const stop of stops.slice(0, 6)) {
        expect(stop.outline, JSON.stringify(stop)).not.toBe("none");
        expect(stop.width, JSON.stringify(stop)).toBeGreaterThanOrEqual(2);
      }
      await screenshot(visit_.page, "keyboard-1280-dark-main");
      // The skip link moves the focus into the main column without changing the address.
      await visit(visit_.page, "/");
      await visit_.page.keyboard.press("Tab");
      await visit_.page.keyboard.press("Enter");
      const after = (await visit_.page.evaluate(focused)) as Focus;
      expect(after.isMain || after.inMain).toBe(true);
      expect(after.width).toBeGreaterThanOrEqual(2);
      expect(new URL(visit_.page.url()).hash).toBe("");
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
  });

  for (const [step, theme] of [
    [8, "light"],
    [9, "dim"],
    [10, "dark"],
  ] as const) {
    test(`${step}. contrast as drawn in ${theme}: the shell on Home, a post and the rules, and the whole missing page`, async () => {
      const visit_ = await open({ width: 1280, height: 900, appearance: { theme } });
      try {
        for (const [route, scope] of [
          ["/", DRAWN],
          [`/post/${POST_ID}`, DRAWN],
          ["/rules", DRAWN],
          ["/no-such-page", ALL],
        ] as const) {
          await visit(visit_.page, route);
          expect(await contrast(visit_.page, scope), `${theme} ${route}`).toEqual([]);
          await clean(visit_);
        }
      } finally {
        await visit_.context.close();
      }
    });
  }

  test("11. at 320 by 640 with Largest text and the root at 200 percent, nothing scrolls sideways and no label is cut", async () => {
    const visit_ = await open({ width: 320, height: 640, appearance: { theme: "light", textStep: "largest" } });
    try {
      // The screens drawn on the kit: a missing page, Bookmarks under its header, and from Task 5 Home with its tabs and
      // rows. A post joins with Task 6, which moves its reply composer onto the kit.
      for (const [name, route] of [
        ["missing", "/no-such-page"],
        ["bookmarks", "/bookmarks"],
        ["home", "/"],
      ] as const) {
        await visit(visit_.page, route);
        await visit_.page.evaluate(`document.documentElement.style.fontSize = "200%"`);
        await pause(300);
        await screenshot(visit_.page, `largest-320-${name}`);
        // What sticks out past the window's right edge, should anything.
        const wide = (await visit_.page.evaluate(
          `[...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && getComputedStyle(e).position !== "fixed").slice(0, 8).map((e) => e.tagName.toLowerCase() + " " + (e.getAttribute("role") || "") + " " + (e.textContent || "").trim().slice(0, 30) + " " + Math.round(e.getBoundingClientRect().right))`,
        )) as string[];
        const scroll = (await visit_.page.evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) as number;
        expect(scroll, `${name}: ${wide.join("; ")}`).toBeLessThanOrEqual(0);
        expect(await clippedLabels(visit_.page, DRAWN), name).toEqual([]);
        await clean(visit_);
      }
    } finally {
      await visit_.context.close();
    }
  });

  for (const [step, signedIn] of [
    [12, false],
    [13, true],
  ] as const) {
    test(`${step}. every route at 1280 in Dark, ${signedIn ? "signed in" : "signed out"}, with nothing reported`, async () => {
      const visit_ = await open({ width: 1280, height: 900, signedIn, appearance: { theme: "dark" } });
      try {
        for (const route of ROUTES) {
          await visit(visit_.page, route);
          const name = route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";
          await screenshot(visit_.page, `route-${signedIn ? "in" : "out"}-${name.slice(0, 60)}`);
          const problems = visit_.watcher.take();
          expect(problems, route).toEqual([]);
          expect(fixtures.state.problems.splice(0), route).toEqual([]);
        }
      } finally {
        await visit_.context.close();
      }
    });
  }

  test("14. before its first content a route asks the API at most three times, and Home's first post is drawn within 2.5 s", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "dark" } });
    try {
      const firsts: { route: string; shown: string }[] = [
        { route: "/", shown: "Morning light over the harbour" },
        { route: `/post/${POST_ID}`, shown: "Morning light over the harbour" },
        { route: "/u/grace", shown: "Grace Hopper" },
        { route: "/rules", shown: "R1" },
      ];
      for (const { route, shown } of firsts) {
        // From a blank page, so nothing of the previous route is in flight.
        await visit_.page.goto("about:blank");
        const from = fixtures.state.requests.length;
        const started = Date.now();
        await visit_.page.goto(`${origin}${route}`, { waitUntil: "commit" });
        await visit_.page.getByText(shown).first().waitFor({ state: "visible" });
        const took = Date.now() - started;
        // Images are the posts' own and come after them; the count is of the API's answers the content waits for.
        const asked = fixtures.state.requests.slice(from).filter((request) => !request.path.startsWith("/api/media/"));
        console.log(`first content of ${route}: ${took} ms after ${asked.length} requests (${asked.map((request) => request.path).join(", ")})`);
        expect(asked.length, route).toBeLessThanOrEqual(3);
        if (route === "/") expect(took).toBeLessThan(2500);
        await visit_.page.waitForLoadState("networkidle");
        await clean(visit_);
      }
    } finally {
      await visit_.context.close();
    }
  });

  test("15. offline: a polite status at the top of the main column says so, and leaves when the connection is back", async () => {
    const visit_ = await open({ width: 360, height: 740, appearance: { theme: "light" } });
    try {
      await visit(visit_.page, "/");
      const banner = visit_.page.locator('main [role="status"]', { hasText: UI_WORDS["offline.title"] });
      expect(await banner.count()).toBe(0);
      await visit_.context.setOffline(true);
      await banner.first().waitFor({ state: "visible" });
      expect(await visit_.page.locator('main [role="status"][aria-live="polite"]').first().innerText()).toBe(UI_WORDS["offline.title"]);
      await screenshot(visit_.page, "offline-360-light");
      await visit_.context.setOffline(false);
      await banner.first().waitFor({ state: "detached" });
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
  });

  test("16. on a phone the header slides away as Bookmarks scrolls down and returns on a scroll up; under reduced motion it stays", async () => {
    for (const [name, options] of [
      ["moves", {}],
      ["system-reduced", { reducedMotion: "reduce" as const }],
      ["korbat-reduced", { appearance: { theme: "light", reduceMotion: "always" } }],
    ] as const) {
      const visit_ = await open({ width: 360, height: 740, appearance: { theme: "light" }, ...options });
      try {
        await visit(visit_.page, "/bookmarks");
        const height = (await visit_.page.evaluate(HEADER_HEIGHT)) as number;
        expect(height, name).toBeGreaterThan(40);
        expect(await visit_.page.evaluate(HEADER_Y), name).toBe(0);
        // The list starts below the floating header: its first row is not under it.
        const firstRow = (await visit_.page.evaluate(`(() => { const list = ${LIST}; const row = list && list.querySelector("[role=article], a[href^='/post/']"); return row ? row.getBoundingClientRect().top : null; })()`)) as number | null;
        expect(firstRow, name).not.toBeNull();
        expect(firstRow!, name).toBeGreaterThanOrEqual(height - 1);
        await scrollList(visit_.page, height * 4);
        await pause(450);
        const down = (await visit_.page.evaluate(HEADER_Y)) as number;
        if (name === "moves") expect(Math.round(down), name).toBe(-Math.round(height));
        else expect(down, name).toBe(0);
        await screenshot(visit_.page, `header-360-${name}-down`);
        await scrollList(visit_.page, height * 3);
        await pause(450);
        expect(await visit_.page.evaluate(HEADER_Y), name).toBe(0);
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    }
  });

  test("17. pressing the current Home item brings the feed back to its newest post without leaving the page, at once under reduced motion", async () => {
    for (const [name, options] of [
      ["smooth", { width: 1280, height: 900 }],
      ["reduced", { width: 360, height: 740, reducedMotion: "reduce" as const }],
    ] as const) {
      const visit_ = await open({ appearance: { theme: "dark" }, ...options });
      try {
        await visit(visit_.page, "/?tab=latest");
        await scrollList(visit_.page, 1500);
        await pause(200);
        const scrolled = (await visit_.page.evaluate(`${LIST}.scrollTop`)) as number;
        expect(scrolled, name).toBeGreaterThan(1000);
        await visit_.page.locator('nav[aria-label="Main"] a[aria-current="page"]').click();
        if (name === "reduced") {
          await pause(50);
          expect(await visit_.page.evaluate(`${LIST}.scrollTop`), name).toBe(0);
        } else {
          // Smooth: still on its way a moment after the press, at the top soon after.
          await until(visit_.page, `${LIST}.scrollTop === 0`, "the feed at its top", 3000);
        }
        // The press did not navigate: the tab in the address is the reader's still.
        expect(new URL(visit_.page.url()).search, name).toBe("?tab=latest");
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    }
  });

  test("18. the lightbox: named, Close, Previous and Next, the arrows, Escape and the focus back on the image; it grows from the image, and at once under reduced motion", async () => {
    // Post 8 holds two images; the first one's cell opens the viewer.
    const cellOf = (page: Page) => page.locator('[role="button"][aria-label^="Open image: A photograph, number 8,"]').first();
    const counter = (page: Page, n: number) => until(page, `!!document.querySelector('[role="dialog"]') && document.querySelector('[role="dialog"]').textContent.includes(${JSON.stringify(`${n} of 2`)})`, `${n} of 2`);
    for (const [name, options] of MOTION_RUNS) {
      const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" }, ...options });
      try {
        await visit(visit_.page, "/?tab=latest");
        const cell = cellOf(visit_.page);
        await cell.scrollIntoViewIfNeeded();
        const frames = sampleFrames(visit_.page, `document.querySelector("[data-lightbox-image]") && document.querySelector("[data-lightbox-image]").parentElement`, "transform", 700);
        await cell.click();
        const dialog = visit_.page.locator('[role="dialog"]');
        await dialog.waitFor({ state: "visible" });
        // Growing from the thumbnail moves the image between frames; under either reduced motion it only fades.
        expect(transformed(await frames), name).toBe(name === "moves");
        const named = (await visit_.page.evaluate(DIALOG_NAME)) as string;
        expect(named, name).toContain("1 of 2");
        expect(named, name).toContain("A photograph, number 8, of the harbour at dawn");
        expect(await dialog.locator('[role="button"]').evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))).toEqual([UI_WORDS["media.close"], UI_WORDS["media.previous"], UI_WORDS["media.next"]]);
        // The arrow keys switch at once; Next does too.
        await visit_.page.keyboard.press("ArrowRight");
        await counter(visit_.page, 2);
        await visit_.page.keyboard.press("ArrowLeft");
        await counter(visit_.page, 1);
        await dialog.locator(`[aria-label="${UI_WORDS["media.next"]}"]`).click();
        await counter(visit_.page, 2);
        await dialog.locator(`[aria-label="${UI_WORDS["media.previous"]}"]`).click();
        await counter(visit_.page, 1);
        // Escape closes it, and the image that opened it holds the focus again.
        await visit_.page.keyboard.press("Escape");
        await dialog.waitFor({ state: "detached" });
        expect(await visit_.page.evaluate(FOCUSED), name).toMatch(/^Open image: A photograph, number 8,/);
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    }
    for (const [width, height] of [
      [360, 740],
      [1280, 900],
    ] as const) {
      for (const theme of ["light", "dark"] as const) {
        const visit_ = await open({ width, height, appearance: { theme } });
        try {
          await visit(visit_.page, "/?tab=latest");
          await cellOf(visit_.page).scrollIntoViewIfNeeded();
          await cellOf(visit_.page).click();
          await visit_.page.locator('[role="dialog"]').waitFor({ state: "visible" });
          await pause(600);
          await screenshot(visit_.page, `lightbox-${width}-${theme}`);
          // The stage is a forced Dark scope: its words read on the near-black in every theme.
          expect(await contrast(visit_.page, '[role="dialog"]'), `${width} ${theme}`).toEqual([]);
          if (width < 768) expect(await phoneProblems(visit_.page, '[role="dialog"]')).toEqual([]);
          await visit_.page.keyboard.press("Escape");
          await visit_.page.locator('[role="dialog"]').waitFor({ state: "detached" });
          await clean(visit_);
        } finally {
          await visit_.context.close();
        }
      }
    }
  });

  test("19. Like: pressed and counted at once, the answer's counts after; a refusal rolls back with its toast; it pops, and changes at once under reduced motion; a reposted Repost differs from an idle one in greyscale", async () => {
    const LIKE = '[role="button"][aria-label^="Like"]';
    for (const [name, options] of MOTION_RUNS) {
      const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" }, ...options });
      try {
        await visit(visit_.page, "/?tab=latest");
        // Post 1 (Grace's) has 3 likes, none of them the reader's.
        const like = article(visit_.page, 0).locator(LIKE);
        expect(await like.getAttribute("aria-label")).toBe("Like, 3 likes");
        expect(await like.getAttribute("aria-pressed")).toBe("false");
        fixtures.state.delayMs = 1500;
        const frames = sampleFrames(visit_.page, `document.querySelector('[role="article"] ${LIKE}') && document.querySelector('[role="article"] ${LIKE}').parentElement`, "transform", 1200);
        await like.click();
        // Before the answer: pressed, and one more like.
        await until(visit_.page, `document.querySelector('[role="article"] ${LIKE}').getAttribute("aria-pressed") === "true"`, "pressed at once", 1000);
        expect(await like.getAttribute("aria-label")).toBe("Like, 4 likes");
        const drawn = await frames;
        expect(transformed(drawn), `${name}: ${[...new Set(drawn)].slice(0, 6).join(" | ")}`).toBe(name === "moves");
        if (name === "moves") await screenshot(visit_.page, "like-1280-light");
        // The answer's counts replace the card's guess: two others liked it meanwhile.
        await until(visit_.page, `document.querySelector('[role="article"] ${LIKE}').getAttribute("aria-label") === "Like, 6 likes"`, "the answer's count");
        expect(await like.getAttribute("aria-pressed")).toBe("true");
        fixtures.state.delayMs = 0;
        // A refusal: post 2 (Linus's, 6 likes) is liked, then put back as it was, and the toast says so.
        fixtures.state.refuse.add("like");
        const other = article(visit_.page, 1).locator(LIKE);
        expect(await other.getAttribute("aria-label")).toBe("Like, 6 likes");
        await other.click();
        await visit_.page.locator("[data-sonner-toaster]").getByText(UI_WORDS["toast.failed.like"]).waitFor({ state: "visible" });
        expect(await other.getAttribute("aria-pressed")).toBe("false");
        expect(await other.getAttribute("aria-label")).toBe("Like, 6 likes");
        fixtures.state.refuse.delete("like");
        if (name === "moves") {
          // 4.7: a reposted Repost is told from an idle one by its shape, which a greyscale screenshot keeps.
          const repost = article(visit_.page, 0).locator('[role="button"][aria-label^="Repost"]');
          await repost.click();
          await visit_.page.locator("[data-menu]").getByRole("button", { name: UI_WORDS["post.repost"] }).click();
          await until(visit_.page, `document.querySelector('[role="article"] [role="button"][aria-label^="Repost"]').getAttribute("aria-pressed") === "true"`, "reposted");
          await visit_.page.locator("[data-menu]").waitFor({ state: "detached" });
          await visit_.page.mouse.move(2, 2);
          await pause(400);
          const reposted = await glyphInk(visit_.page, repost);
          const idle = await glyphInk(visit_.page, article(visit_.page, 1).locator('[role="button"][aria-label^="Repost"]'));
          console.log(`greyscale ink of a reposted Repost ${reposted}, of an idle one ${idle}`);
          expect(reposted).toBeGreaterThan(idle * 1.5);
          await screenshot(visit_.page, "reposted-1280-light");
        }
        await cleanAfterRefusals(visit_);
      } finally {
        fixtures.state.delayMs = 0;
        fixtures.state.refuse.clear();
        await visit_.context.close();
      }
    }
  });

  test("20. Follow on a profile: Following at once, kept after the answer; a refusal rolls back with its toast; the label cross-fades, at once under reduced motion", async () => {
    const BUTTON = '[data-follow] [role="button"]';
    for (const [name, options] of MOTION_RUNS) {
      const visit_ = await open({ width: 360, height: 740, appearance: { theme: "light" }, ...options });
      try {
        await visit(visit_.page, "/u/grace");
        const button = visit_.page.locator(BUTTON);
        expect(await button.innerText()).toBe(UI_WORDS["follow.follow"]);
        // Refused: Following at once, then Follow again, and the toast.
        fixtures.state.delayMs = 800;
        fixtures.state.refuse.add("follow");
        const frames = sampleFrames(visit_.page, `document.querySelector('${BUTTON}') && document.querySelector('${BUTTON}').firstElementChild`, "opacity", 400);
        await button.click();
        await until(visit_.page, `document.querySelector('${BUTTON}').innerText === ${JSON.stringify(UI_WORDS["follow.following"])}`, "Following at once", 700);
        expect(faded(await frames), name).toBe(name === "moves");
        await visit_.page.locator("[data-sonner-toaster]").getByText("Couldn't follow @grace. Try again.").waitFor({ state: "visible" });
        expect(await button.innerText()).toBe(UI_WORDS["follow.follow"]);
        if (name === "moves") await screenshot(visit_.page, "follow-refused-360-light");
        fixtures.state.refuse.delete("follow");
        // Answered: Following, and still Following once the answer has landed.
        await button.click();
        await until(visit_.page, `document.querySelector('${BUTTON}').innerText === ${JSON.stringify(UI_WORDS["follow.following"])}`, "Following at once", 700);
        await pause(1200);
        expect(await button.innerText()).toBe(UI_WORDS["follow.following"]);
        expect(await phoneProblems(visit_.page, "[data-follow], [data-sonner-toaster]")).toEqual([]);
        await cleanAfterRefusals(visit_);
      } finally {
        fixtures.state.delayMs = 0;
        fixtures.state.refuse.clear();
        await visit_.context.close();
      }
    }
  });

  test("21. the menus: a popover at 1280 and a sheet at 360; Report on Grace's post, Delete on Ada's with Keep's focus and its return; Repost's menu; the arrows; Escape back to More; Copy link and its toast", async () => {
    const MORE = `[role="button"][aria-label="${UI_WORDS["post.more"]}"]`;
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    try {
      await visit_.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
      await visit(visit_.page, "/?tab=latest");
      const page = visit_.page;
      // Grace's post 1: Who sees this, Copy link, and Report as a link to the form.
      const more = postArticle(page, 1).locator(MORE);
      await more.click();
      const menu = page.locator("[data-menu]");
      await menu.waitFor({ state: "visible" });
      expect(await more.getAttribute("aria-expanded")).toBe("true");
      expect(await menu.locator('[role="button"]').allInnerTexts()).toEqual([expect.stringContaining(UI_WORDS["post.whoSees"]), UI_WORDS["post.copyLink"]]);
      expect(await menu.locator("a").getAttribute("href")).toBe(`/report?post=${postIdOf(1)}`);
      // The first item holds the focus; the arrows move it, and wrap.
      await until(page, `${FOCUSED} !== null && ${FOCUSED}.startsWith(${JSON.stringify(UI_WORDS["post.whoSees"])})`, "the first item focused", 2000);
      const steps: [string, string][] = [
        ["ArrowDown", UI_WORDS["post.copyLink"]],
        ["ArrowDown", "Report"],
        ["ArrowDown", UI_WORDS["post.whoSees"]],
        ["ArrowUp", "Report"],
        ["Home", UI_WORDS["post.whoSees"]],
        ["End", "Report"],
      ];
      for (const [key, words] of steps) {
        await page.keyboard.press(key);
        expect(((await page.evaluate(FOCUSED)) as string).startsWith(words), key).toBe(true);
      }
      await screenshot(page, "menu-1280-light");
      expect(await contrast(page, "[data-menu]")).toEqual([]);
      // Escape closes it and gives the focus back to More.
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
      expect(await page.evaluate(FOCUSED)).toBe(UI_WORDS["post.more"]);
      expect(await more.getAttribute("aria-expanded")).toBe("false");
      // Copy link: the post's address on the clipboard, and the toast.
      await more.click();
      await menu.getByRole("button", { name: UI_WORDS["post.copyLink"] }).click();
      await page.locator("[data-sonner-toaster]").getByText(UI_WORDS["toast.linkCopied"]).waitFor({ state: "visible" });
      expect(await page.evaluate("navigator.clipboard.readText()")).toBe(`${origin}/post/${postIdOf(1)}`);
      // Ada's own post 3: Delete instead of Report. The question takes More's place, Keep takes the focus and gives it back.
      const ada = postArticle(page, 3);
      await ada.locator(MORE).click();
      await menu.waitFor({ state: "visible" });
      expect(await menu.locator('[role="button"]').allInnerTexts()).toEqual([expect.stringContaining(UI_WORDS["post.whoSees"]), UI_WORDS["post.copyLink"], UI_WORDS["post.delete"]]);
      expect(await menu.locator("a").count()).toBe(0);
      await menu.getByRole("button", { name: UI_WORDS["post.delete"] }).click();
      const question = ada.locator('[role="dialog"]');
      await question.waitFor({ state: "visible" });
      await until(page, `${FOCUSED} === "Keep"`, "Keep focused");
      expect(await ada.locator(MORE).count()).toBe(0);
      await screenshot(page, "delete-question-1280-light");
      await page.keyboard.press("Enter");
      await question.waitFor({ state: "detached" });
      await until(page, `${FOCUSED} === ${JSON.stringify(UI_WORDS["post.more"])}`, "More focused again");
      // Delete, answered: the card fades out of the list.
      await ada.locator(MORE).click();
      await menu.getByRole("button", { name: UI_WORDS["post.delete"] }).click();
      await ada.locator('[role="dialog"]').getByRole("button", { name: UI_WORDS["post.delete"] }).click();
      await postArticle(page, 3).waitFor({ state: "detached" });
      expect(fixtures.state.requests.some((request) => request.method === "DELETE" && request.path === `/api/posts/${postIdOf(3)}`)).toBe(true);
      // Repost's menu on Linus's post 2: Repost, and Quote as a link to the quote composer; Escape back to its trigger.
      const repost = postArticle(page, 2).locator('[role="button"][aria-label^="Repost"]');
      await repost.click();
      await menu.waitFor({ state: "visible" });
      expect(await menu.locator('[role="button"]').allInnerTexts()).toEqual([UI_WORDS["post.repost"]]);
      expect(await menu.locator("a").getAttribute("href")).toBe(`/post/${postIdOf(2)}?quote=1`);
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
      expect(await page.evaluate(FOCUSED)).toMatch(/^Repost/);
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
    // Below 768 px the same menu is a sheet titled by its trigger's label, with a grab handle.
    for (const theme of ["light", "dark"] as const) {
      const phone = await open({ width: 360, height: 740, appearance: { theme } });
      try {
        await visit(phone.page, "/?tab=latest");
        const more = article(phone.page, 0).locator(MORE);
        await more.click();
        const sheet = phone.page.locator('[role="dialog"]');
        await sheet.waitFor({ state: "visible" });
        expect(await phone.page.evaluate(DIALOG_NAME)).toBe(UI_WORDS["post.more"]);
        expect(await sheet.locator("[data-handle]").count()).toBe(1);
        await until(phone.page, `${FOCUSED} !== null && ${FOCUSED}.startsWith(${JSON.stringify(UI_WORDS["post.whoSees"])})`, "the first item focused", 2000);
        await pause(500);
        await screenshot(phone.page, `menu-sheet-360-${theme}`);
        expect(await phoneProblems(phone.page, '[role="dialog"]')).toEqual([]);
        expect(await clippedLabels(phone.page, '[role="dialog"]')).toEqual([]);
        expect(await contrast(phone.page, '[role="dialog"]')).toEqual([]);
        await phone.page.keyboard.press("Escape");
        await sheet.waitFor({ state: "detached" });
        expect(await phone.page.evaluate(FOCUSED)).toBe(UI_WORDS["post.more"]);
        await clean(phone);
      } finally {
        await phone.context.close();
      }
    }
    const dark = await open({ width: 1280, height: 900, appearance: { theme: "dark" } });
    try {
      await visit(dark.page, "/?tab=latest");
      await article(dark.page, 0).locator(MORE).click();
      await dark.page.locator("[data-menu]").waitFor({ state: "visible" });
      await pause(300);
      await screenshot(dark.page, "menu-1280-dark");
      expect(await contrast(dark.page, "[data-menu]")).toEqual([]);
      await clean(dark);
    } finally {
      await dark.context.close();
    }
  });

  test("22. Who sees this: public on Grace's post, with how korbat treats reach; on Ada's own post 3 also what a block does, the feeds and its Explore status, asked as the sheet opens", async () => {
    const MORE = `[role="button"][aria-label="${UI_WORDS["post.more"]}"]`;
    for (const [width, height] of [
      [1280, 900],
      [360, 740],
    ] as const) {
      for (const theme of ["light", "dark"] as const) {
        const visit_ = await open({ width, height, appearance: { theme } });
        try {
          const page = visit_.page;
          await visit(page, "/?tab=latest");
          const openWho = async (n: number) => {
            await postArticle(page, n).locator(MORE).click();
            await page.getByRole("button", { name: UI_WORDS["post.whoSees"] }).click();
            await until(page, `${DIALOG_NAME} === ${JSON.stringify(UI_WORDS["post.whoSees"])}`, "Who sees this open");
          };
          const sheet = page.locator('[role="dialog"]');
          await openWho(1);
          expect(await sheet.innerText()).toContain(UI_WORDS["reach.public"]);
          expect(await sheet.innerText()).toContain(UI_WORDS["reach.never"]);
          expect(await sheet.innerText()).not.toContain(UI_WORDS["reach.blocked"]);
          expect(await sheet.locator('a[href="/explore/about"]').innerText()).toBe(UI_WORDS["reach.how"]);
          await until(page, `${FOCUSED} === ${JSON.stringify(UI_WORDS["post.whoSees"])}`, "the title focused", 2000);
          await pause(400);
          await screenshot(page, `who-sees-other-${width}-${theme}`);
          expect(await contrast(page, '[role="dialog"]')).toEqual([]);
          if (width < 768) expect(await phoneProblems(page, '[role="dialog"]')).toEqual([]);
          await page.keyboard.press("Escape");
          await sheet.waitFor({ state: "detached" });
          expect(await page.evaluate(FOCUSED)).toBe(UI_WORDS["post.more"]);
          // Ada's own post 3: its Explore status is asked when the sheet opens, and said in the status line's words.
          const asked = fixtures.state.requests.length;
          await openWho(3);
          await sheet.getByText("In Explore", { exact: true }).waitFor({ state: "visible" });
          expect(fixtures.state.requests.slice(asked).map((request) => request.path)).toContain(`/api/posts/${postIdOf(3)}/explore`);
          for (const words of [UI_WORDS["reach.public"], UI_WORDS["reach.blocked"], UI_WORDS["reach.feeds"], UI_WORDS["reach.never"]]) expect(await sheet.innerText()).toContain(words);
          await pause(300);
          await screenshot(page, `who-sees-own-${width}-${theme}`);
          await page.keyboard.press("Escape");
          await sheet.waitFor({ state: "detached" });
          await clean(visit_);
        } finally {
          await visit_.context.close();
        }
      }
    }
  });

  // UI Task 5: the feeds that keep the reader's place (UI design, sections 7.5, 8.2, 8.3 and 10).

  /** The post at the top of the main column's list: its open link and how far its top is below the list's top line. */
  const TOP_ARTICLE = `(() => { const list = ${LIST}; if (!list) return null; const line = list.getBoundingClientRect().top + (parseFloat(getComputedStyle(list.firstElementChild).paddingTop) || 0); const article = [...list.querySelectorAll('[role="article"]')].find((a) => a.querySelector("[data-open]") && a.getBoundingClientRect().bottom > line + 1); if (!article) return null; return { href: article.querySelector("[data-open]").getAttribute("href"), top: Math.round((article.getBoundingClientRect().top - line) * 10) / 10 }; })()`;
  type Top = { href: string; top: number } | null;
  /** Whether the post at the top is the one at `href`, its top within 2 px of the list's top line. */
  const onTop = (href: string) => `(() => { const top = ${TOP_ARTICLE}; return !!top && top.href === ${JSON.stringify(href)} && Math.abs(top.top) <= 2; })()`;

  /** Scrolls the list until fixture post `href` is at its top line, as a reader would, a screen at a time. */
  async function scrollToPost(page: Page, href: string): Promise<void> {
    for (let tries = 0; tries < 40; tries++) {
      const there = await page.evaluate(
        `(() => { const list = ${LIST}; if (!list) return false; const link = list.querySelector('[role="article"] [data-open][href="${href}"]'); if (!link) { list.scrollTop += 500; return false; } const line = list.getBoundingClientRect().top + (parseFloat(getComputedStyle(list.firstElementChild).paddingTop) || 0); const delta = link.closest('[role="article"]').getBoundingClientRect().top - line; list.scrollTop += delta; return Math.abs(delta) < 1; })()`,
      );
      if (there) return;
      await pause(120);
    }
    throw new Error(`${href} never came to the top`);
  }

  /** Waits until a condition on the walk's side is true. */
  async function waitFor(check: () => boolean, what: string, timeout = 10_000): Promise<void> {
    const end = Date.now() + timeout;
    while (!check()) {
      if (Date.now() > end) throw new Error(`not within ${timeout} ms: ${what}`);
      await pause(50);
    }
  }

  /** How many API requests have begun with `path` so far. */
  const asked = (path: string) => fixtures.state.requests.filter((request) => request.path.startsWith(path)).length;

  /** The keys of every reading place in the page's storage. */
  const PLACES = `Object.keys(localStorage).filter((key) => key.startsWith("korbat.place."))`;

  test("23. new posts: after the poll the pill says how many are above while the post on top stays still; pressing it brings the oldest new post to the top; at zero it says You're all caught up; it slides in, and only fades under reduced motion", async () => {
    for (const [name, options] of MOTION_RUNS) {
      const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" }, ...options });
      const page = visit_.page;
      try {
        // The page's own clock, so the walk need not wait the poll's 30 seconds: it flows as time does, and jumps on asking.
        await page.clock.install();
        await visit(page, "/?tab=latest");
        await scrollToPost(page, `/post/${postIdOf(6)}`);
        await pause(400);
        const before = (await page.evaluate(TOP_ARTICLE)) as Top;
        expect(before?.href).toBe(`/post/${postIdOf(6)}`);
        // Three posts arrive; the timeline's answer waits a moment, so the pill's entrance is sampled from its first frame.
        fixtures.state.newPosts = 3;
        fixtures.state.timelineDelayMs = 600;
        await page.clock.fastForward(31_000);
        const frames = sampleFrames(page, `document.querySelector("[data-pill]") && document.querySelector("[data-pill]").parentElement`, "transform", 1400);
        const pill = page.locator("[data-pill]");
        await pill.waitFor({ state: "visible" });
        expect(transformed(await frames), name).toBe(name === "moves");
        fixtures.state.timelineDelayMs = 0;
        expect(await pill.innerText()).toBe("3 new posts");
        expect(await pill.getAttribute("aria-label")).toBe("3 new posts above, go to the first one");
        // Nothing the reader reads moved.
        const after = (await page.evaluate(TOP_ARTICLE)) as Top;
        expect(after?.href, name).toBe(before?.href);
        expect(Math.abs(after!.top - before!.top), name).toBeLessThanOrEqual(1);
        if (name === "moves") await screenshot(page, "pill-1280-light");
        // The pill takes the reader to the oldest of the new posts, right above where they were, to read on upwards.
        await pill.click();
        await until(page, onTop(`/post/${newPostIdOf(1)}`), "the oldest new post on top", 5000);
        await until(page, `document.querySelector("[data-pill]") && document.querySelector("[data-pill]").innerText === "2 new posts"`, "two left", 3000);
        // Up to the newest: none left, and the pill says so for two seconds before it leaves.
        await scrollList(page, 0);
        await until(page, `!!document.querySelector("[data-pill]") && document.querySelector("[data-pill]").innerText === ${JSON.stringify(UI_WORDS["feed.caughtUp"])}`, "caught up", 3000);
        if (name === "moves") await screenshot(page, "pill-caught-up-1280-light");
        await pill.waitFor({ state: "detached", timeout: 6000 });
        await clean(visit_);
      } finally {
        fixtures.state.newPosts = 0;
        fixtures.state.timelineDelayMs = 0;
        await visit_.context.close();
      }
    }
    // The pill at a phone's width, in both themes, under the floating header.
    for (const theme of ["light", "dark"] as const) {
      const visit_ = await open({ width: 360, height: 740, appearance: { theme } });
      const page = visit_.page;
      try {
        await page.clock.install();
        await visit(page, "/?tab=latest");
        await scrollToPost(page, `/post/${postIdOf(4)}`);
        fixtures.state.newPosts = 2;
        await page.clock.fastForward(31_000);
        await page.locator("[data-pill]").waitFor({ state: "visible" });
        await pause(400);
        await screenshot(page, `pill-360-${theme}`);
        expect(await contrast(page, "[data-pill]")).toEqual([]);
        expect(await phoneProblems(page, "[data-pill]")).toEqual([]);
        await clean(visit_);
      } finally {
        fixtures.state.newPosts = 0;
        await visit_.context.close();
      }
    }
  });

  test("24. the reading place: Latest opens again at the post the reader stopped at, You were here above it and the new posts counted; at the newest when the reader asks; nothing kept signed out; signing out clears it with the appearance", async () => {
    const visit_ = await open({ width: 1280, height: 900 });
    const page = visit_.page;
    try {
      await visit(page, "/?tab=latest");
      // The first posts are seen (half in view for half a second), then the reader stops at post 12.
      await pause(800);
      await scrollToPost(page, `/post/${postIdOf(12)}`);
      await pause(1600);
      expect(await page.evaluate(PLACES)).toEqual([`korbat.place.${ADA.id}`]);
      // Two posts arrive while the reader is away; the feed opens at post 12 again.
      fixtures.state.newPosts = 2;
      await visit(page, "/?tab=latest");
      await until(page, onTop(`/post/${postIdOf(12)}`), "post 12 on top again");
      // The marker sits above the posts already seen, under the two new ones, which the pill counts.
      const marker = page.locator("[data-marker]");
      expect(await marker.innerText()).toContain(UI_WORDS["feed.marker.title"]);
      expect(await marker.innerText()).toContain(UI_WORDS["feed.marker.body"]);
      expect(await page.locator("[data-pill]").innerText()).toBe("2 new posts");
      expect(
        await page.evaluate(`(() => { const marker = document.querySelector("[data-marker]"); const post = document.querySelector('[data-open][href="/post/${postIdOf(12)}"]'); return !!(marker.compareDocumentPosition(post) & Node.DOCUMENT_POSITION_FOLLOWING); })()`),
      ).toBe(true);
      await screenshot(page, "place-1280-light");
      // "Open feeds at the newest post": the newest, whatever was kept.
      await page.evaluate(`localStorage.setItem("korbat.appearance", JSON.stringify({ openNewest: true }))`);
      await visit(page, "/?tab=latest");
      // At the top of the list, under the composer: the first post is the newest.
      await until(page, `!!${LIST} && ${LIST}.scrollTop === 0 && document.querySelector('[role="feed"] [role="article"] [data-open]').getAttribute("href") === "/post/${newPostIdOf(2)}"`, "the newest post first, at the top");
      // Signing out ends the session: every place and the appearance go.
      await visit(page, "/settings/security");
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await until(page, `location.pathname === "/" && !document.querySelector('nav[aria-label="Main"] a[href="/bookmarks"]')`, "signed out, on Home");
      expect(await page.evaluate(PLACES)).toEqual([]);
      expect(await page.evaluate(`localStorage.getItem("korbat.appearance")`)).toBeNull();
      await clean(visit_);
    } finally {
      fixtures.state.newPosts = 0;
      await visit_.context.close();
    }
    // A reader who is signed out keeps no place.
    const out = await open({ width: 1280, height: 900, signedIn: false });
    try {
      await visit(out.page, "/?tab=latest");
      await pause(800);
      await scrollToPost(out.page, `/post/${postIdOf(12)}`);
      await pause(1600);
      expect(await out.page.evaluate(PLACES)).toEqual([]);
      expect(await out.page.locator("[data-marker], [data-pill]").count()).toBe(0);
      await clean(out);
    } finally {
      await out.context.close();
    }
  });

  test("25. Following, Latest and Following again: the same post on top and page one not asked again; Explore is read again each time it is chosen", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "dark" } });
    const page = visit_.page;
    try {
      await visit(page, "/");
      await scrollToPost(page, `/post/${postIdOf(9)}`);
      await pause(300);
      const before = (await page.evaluate(TOP_ARTICLE)) as Top;
      const following = asked("/api/timeline/following");
      const tab = (label: string) => page.locator('[role="tablist"] [role="tab"]', { hasText: label });
      await tab(UI_WORDS["home.latest"]).click();
      await until(page, `new URL(location.href).searchParams.get("tab") === "latest" && !!document.querySelector('[role="feed"] [role="article"]')`, "Latest shown");
      await tab(UI_WORDS["home.following"]).click();
      await until(page, onTop(before!.href), "the same post on top");
      const after = (await page.evaluate(TOP_ARTICLE)) as Top;
      expect(Math.abs(after!.top - before!.top)).toBeLessThanOrEqual(2);
      expect(asked("/api/timeline/following")).toBe(following);
      // Explore is never kept: each time it is chosen, it is read again.
      const explore = asked("/api/timeline/explore");
      await tab(UI_WORDS["home.explore"]).click();
      await waitFor(() => asked("/api/timeline/explore") === explore + 1, "Explore read");
      await tab(UI_WORDS["home.latest"]).click();
      await until(page, `new URL(location.href).searchParams.get("tab") === "latest"`, "Latest again");
      await tab(UI_WORDS["home.explore"]).click();
      await waitFor(() => asked("/api/timeline/explore") === explore + 2, "Explore read again");
      await page.waitForLoadState("networkidle");
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
  });

  test("26. the keyboard on Home: Tab reaches the skip link, the nav, Home's tab and the first post's open link in that order; Page Down and Page Up move between posts; the arrows choose the tabs; the list is a feed", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    try {
      await visit(page, "/");
      const feed = page.locator('[role="feed"]');
      expect(await feed.count()).toBe(1);
      expect(await feed.getAttribute("aria-busy")).toBe("false");
      expect(await feed.locator('[role="article"]').first().getAttribute("aria-posinset")).toBe("1");
      expect(await feed.locator('[role="article"]').first().getAttribute("aria-setsize")).toBe("-1");
      const first = (await page.evaluate(`document.querySelector('[role="feed"] [role="article"] [data-open]').getAttribute("href")`)) as string;
      const WHERE = `(() => { const e = document.activeElement; return { href: e.getAttribute("href"), role: e.getAttribute("role"), nav: !!e.closest('nav[aria-label="Main"]'), open: e.hasAttribute("data-open"), outline: parseFloat(getComputedStyle(e).outlineWidth) }; })()`;
      type Where = { href: string | null; role: string | null; nav: boolean; open: boolean; outline: number };
      const kinds: string[] = [];
      for (let i = 0; i < 40 && !kinds.includes("post"); i++) {
        await page.keyboard.press("Tab");
        const at = (await page.evaluate(WHERE)) as Where;
        const kind = at.href === "#main" ? "skip" : at.nav ? "nav" : at.role === "tab" ? "tab" : at.open && at.href === first ? "post" : "other";
        kinds.push(kind);
        if (kind === "tab" || kind === "post") expect(at.outline, kind).toBeGreaterThanOrEqual(2);
      }
      expect(kinds.indexOf("skip")).toBe(0);
      expect(kinds.indexOf("nav")).toBe(1);
      expect(kinds.indexOf("tab")).toBeGreaterThan(kinds.lastIndexOf("nav"));
      expect(kinds.indexOf("post")).toBeGreaterThan(kinds.indexOf("tab"));
      // One tab stop for the whole tab list.
      expect(kinds.filter((kind) => kind === "tab")).toHaveLength(1);
      // Page Down and Page Up: from article to article, by their open links.
      const hrefs = (await feed.locator('[role="article"] [data-open]').evaluateAll((links) => links.slice(0, 3).map((link) => link.getAttribute("href")))) as string[];
      await page.keyboard.press("PageDown");
      expect(((await page.evaluate(WHERE)) as Where).href).toBe(hrefs[1]);
      await page.keyboard.press("PageDown");
      expect(((await page.evaluate(WHERE)) as Where).href).toBe(hrefs[2]);
      await page.keyboard.press("PageUp");
      expect(((await page.evaluate(WHERE)) as Where).href).toBe(hrefs[1]);
      await screenshot(page, "keyboard-1280-light-post");
      // The tabs' arrows choose at once and move the focus with the choice.
      await page.locator('[role="tab"][aria-selected="true"]').focus();
      await page.keyboard.press("ArrowRight");
      await until(page, `new URL(location.href).searchParams.get("tab") === "latest" && document.activeElement.getAttribute("aria-selected") === "true"`, "Latest chosen by the arrow");
      await page.keyboard.press("ArrowLeft");
      await until(page, `new URL(location.href).searchParams.get("tab") === "following" && document.activeElement.getAttribute("aria-selected") === "true"`, "Following chosen by the arrow");
      await page.waitForLoadState("networkidle");
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
  });

  test("27. a deleted post hands the focus to the next post's open link; a reply's thread opens with its post at the top and its chain above it", async () => {
    const MORE = `[role="button"][aria-label="${UI_WORDS["post.more"]}"]`;
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    try {
      await visit(page, "/?tab=latest");
      const ada = postArticle(page, 3);
      await ada.locator(MORE).click();
      await page.locator("[data-menu]").getByRole("button", { name: UI_WORDS["post.delete"] }).click();
      const question = ada.locator('[role="dialog"]');
      await question.waitFor({ state: "visible" });
      await question.getByRole("button", { name: UI_WORDS["post.delete"] }).focus();
      await page.keyboard.press("Enter");
      await postArticle(page, 3).waitFor({ state: "detached" });
      await until(page, `!!document.activeElement && document.activeElement.hasAttribute("data-open") && document.activeElement.getAttribute("href") === "/post/${postIdOf(4)}"`, "post 4's open link focused");
      // Ada's post 3 replies to a chain of three: the page opens with it at the top, the chain above, out of view.
      const FOCUSED_ROW = `(() => { const list = ${LIST}; const row = document.querySelector('[data-row="focused"]'); if (!list || !row) return null; return { top: row.getBoundingClientRect().top - list.getBoundingClientRect().top - (parseFloat(getComputedStyle(list.firstElementChild).paddingTop) || 0), scroll: list.scrollTop }; })()`;
      await visit(page, `/post/${postIdOf(3)}`);
      await until(page, `(() => { const at = ${FOCUSED_ROW}; return !!at && Math.abs(at.top) <= 2 && at.scroll > 0; })()`, "the post on top, its chain above");
      expect(await page.locator('[data-thread] [role="article"]').count()).toBe(4);
      expect(await page.title()).toBe(TITLE_WORDS["title.post"]);
      await screenshot(page, "thread-1280-light");
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
  });
});
```

### Replace `apps/app/test/browser/fixture-api.ts` (whole file)

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AuthorCasesPage,
  AuthorNoticesPage,
  DecisionView,
  EngagementResponse,
  ExplorePage,
  ExploreStatus,
  FollowResponse,
  MeResponse,
  NoticeStatus,
  PasskeyListResponse,
  PasskeyOptionsResponse,
  PostPage,
  ProfilePage,
  ProfileView,
  PublicFacts,
  PublicHead,
  PublicTransparency,
  ReleaseNoticeView,
  ReportsPage,
  SessionsResponse,
  ThreadResponse,
  TimelinePage,
  UploadRefusalView,
  type Author,
  type MediaView,
  type PostView,
  type ProfileListItem,
  type TimelineItem,
} from "@korbat/contracts";
import type { z } from "zod";

/**
 * The API answers the app's browser check needs (UI design, section 12.3): /api/me signed in and out (a 401), the three
 * timelines with cursors, a post with its thread and its status for the post page's handle, profiles with their tabs and
 * lists, bookmarks, the public facts, the settings and cases screens' reads, a report's status, and one 2 by 2 WebP for
 * every image. Every answer is checked against @korbat/contracts' schema when it is built, so the app parses exactly
 * what the API would send. A request no fixture answers is a problem of the walk, answered 404. The reader's actions on a
 * post (like, repost, save, delete) and a follow are answered from UI Task 4 on, with switches that refuse a kind or
 * hold every action's answer back; nothing else that changes something is. From UI Task 5 the timelines honour `limit`
 * and page through 120 posts (enough for the reading place's 100 rows), a switch puts new posts above them, a thread has
 * ancestors, and sign-out is answered. Nothing here needs a database or the network.
 */

/** A WebP of 2 by 2 pixels (lossless, 38 bytes) in the accent violet: a real image, which the browser decodes under the policy. */
export const FIXTURE_WEBP = Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAfQmWrVuv+BiOh/AAA=", "base64");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const ADA: Author = { id: id(1), handle: "ada", displayName: "Ada Lovelace", verified: false };
export const GRACE: Author = { id: id(2), handle: "grace", displayName: "Grace Hopper", verified: true };
export const LINUS: Author = { id: id(3), handle: "linus", displayName: "Linus", verified: false };

/** Post number n's id, for a step that acts on one post of the timelines: Grace writes 1, 4, 7..., Linus 2, 5, 8..., Ada 3, 6, 9.... */
export const postIdOf = (n: number): string => id(100 + n);

/** The post the walk opens (by Grace), and a post id the API does not know, whose page answers 404. */
export const POST_ID = id(101);
export const MISSING_POST_ID = id(999);
/** A decision, a release and a refused upload of Ada's, for the cases screens. */
export const DECISION_ID = id(501);
export const RELEASE_ID = id(502);
export const UPLOAD_ID = id(503);
/** A report's status page: its reference and the token its link carries in the fragment. */
export const NOTICE_REF = "N-ABCDEFGH23";
export const NOTICE_TOKEN = "A".repeat(43);

/** The fixtures' own clock: every time is this many minutes before the walk started, so "3m" stays "3m". */
const START = Date.now();
const ago = (minutes: number) => new Date(START - minutes * 60_000).toISOString();
const daysAhead = (days: number) => new Date(START + days * 86_400_000).toISOString();

const BODIES = [
  "Morning light over the harbour. The ferries are running late again, and nobody seems to mind.",
  "Finished the first draft of the essay on Babbage's engines. It is long, and it needs a walk before it needs an edit.",
  "Reminder that the library's reading room opens at nine on Saturdays now.",
  "Small thing that made my day: the baker remembered my order.",
  "Notes from the meetup: three talks on compilers, one on gardening, all of them about patience.",
  "If you are near the old market today, the second-hand book stall has a box of maps from the sixties.",
  "Tried the new route home along the canal. Two herons, one very confident duck.",
  "Rain all afternoon, so I sorted the photo archive by year instead of by mood.",
];

/** One image, sized as 2b serves it: a 4 by 3 frame whose two sizes are the fixture WebP. */
function image(n: number): MediaView {
  const media = id(700 + n);
  return { id: media, width: 1200, height: 900, blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj", alt: `A photograph, number ${n}, of the harbour at dawn`, small: `/api/media/${media}/small.webp`, large: `/api/media/${media}/large.webp` };
}

const AUTHORS = [GRACE, LINUS, ADA];

/** Post number `n`: its author goes round the three accounts; every fourth carries an image, and post 8 two of them (the lightbox's steps page between them); newer posts have lower numbers. */
function post(n: number, signedIn: boolean, extra: Partial<PostView> = {}): PostView {
  const view: PostView = {
    id: id(100 + n),
    author: AUTHORS[(n - 1) % AUTHORS.length]!,
    body: BODIES[(n - 1) % BODIES.length]!,
    createdAt: ago(n * 7),
    state: "visible",
    replyTo: null,
    counts: { likes: (n * 3) % 17, reposts: n % 4, replies: n % 3, quotes: n % 2 },
    media: n === 8 ? [image(8), image(80)] : n % 4 === 0 ? [image(n)] : [],
    quoteOf: null,
    ...extra,
  };
  if (signedIn) view.viewer = { liked: n % 5 === 0, reposted: false, bookmarked: false };
  return view;
}

function parse<S extends z.ZodType>(schema: S, value: z.input<S>, what: string): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`the fixture ${what} does not match its schema: ${result.error.message}`);
  return result.data;
}

/** How many posts the timelines hold: more than the reading place's window of 100 rows (UI design, section 8.2). */
export const TIMELINE_POSTS = 120;

/** New post `j` of the new-posts switch (1 is the oldest of them): newer than every other post, with ids of their own. */
export const newPostIdOf = (j: number): string => id(900 + j);

function freshPost(j: number, count: number, signedIn: boolean): PostView {
  // Each a second apart and newer than post 1, so the newest of them comes first.
  return post(j, signedIn, { id: newPostIdOf(j), body: `A new post, number ${j}, written while the reader was reading.`, createdAt: new Date(Date.now() - (count - j + 1) * 1000).toISOString(), media: [] });
}

/**
 * A timeline from its start: the new posts the switch holds, newest first, then posts 1 to TIMELINE_POSTS, with a repost
 * of Grace's by Linus before post 3 and every twentieth post after it, as a page of twenty had one at its third row.
 */
function timelineItems(signedIn: boolean, fresh: number): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (let j = fresh; j >= 1; j--) items.push({ kind: "post", post: freshPost(j, fresh, signedIn) });
  for (let n = 1; n <= TIMELINE_POSTS; n++) {
    if (n % 20 === 3) items.push({ kind: "repost", post: post(n + 40, signedIn, { author: GRACE }), repostedBy: LINUS, repostedAt: ago(n * 7 - 1) });
    items.push({ kind: "post", post: post(n, signedIn) });
  }
  return items;
}

/** A page of a timeline: `limit` items (20 by default, at most 50, as Pagination has it) from the cursor's place. */
function timeline(cursor: string | null, limit: string | null, signedIn: boolean, fresh: number) {
  const items = timelineItems(signedIn, fresh);
  const from = cursor === null ? 0 : Number.parseInt(cursor.replace(/^at-/, ""), 10);
  const size = Math.min(50, Math.max(1, Number.parseInt(limit ?? "20", 10) || 20));
  const to = Math.min(items.length, from + size);
  return parse(TimelinePage, { items: items.slice(from, to), nextCursor: to < items.length ? `at-${to}` : null }, "timeline");
}

const listItem = (author: Author, bio: string, signedIn: boolean): ProfileListItem => ({ ...author, bio, ...(signedIn ? { viewerFollows: author.handle === "grace" } : {}) });

function profile(author: Author, signedIn: boolean) {
  const self = signedIn && author.id === ADA.id;
  return parse(
    ProfileView,
    {
      id: author.id,
      handle: author.handle,
      displayName: author.displayName,
      bio: author.handle === "ada" ? "Writing about engines, looms and the people who built them." : "Compilers, ships and the occasional heron.",
      verified: author.verified,
      createdAt: ago(60 * 24 * 90),
      counts: { posts: 42, followers: 128, following: 64 },
      // The reader follows nobody yet, so the follow step starts from Follow.
      ...(signedIn && !self ? { viewer: { following: false, followedBy: false, blocked: false, muted: false } } : {}),
    },
    "profile",
  );
}

function me() {
  return parse(
    MeResponse,
    {
      user: { id: ADA.id, email: "ada@korbat.local", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 1 },
      profile: { id: ADA.id, handle: ADA.handle, displayName: ADA.displayName, handleChangedAt: null, verified: false, showInExplore: true },
      standing: { activeStrikes: 0, measure: null, reporting: null, handleRetired: false },
    },
    "me",
  );
}

const FACTS = parse(
  PublicFacts,
  {
    r1: { state: "off", test: false, model: null, digest: null, threshold: null, thresholdVersion: null, publisherClaim: null, dpia: null, dpiaActs: null },
    match: { state: "off", test: false, source: null, dpia: null, dpiaActs: null },
    edge: { on: false, test: false },
    witness: { on: false, test: false },
    recipientsSignedOut: false,
    keeper: false,
  },
  "facts",
);

function decision() {
  return parse(
    DecisionView,
    {
      id: DECISION_ID,
      kind: "final",
      outcome: "restricted",
      ground: "incompatible",
      ruleId: "R3",
      rulesVersion: 3,
      redressVersion: 2,
      legalReference: null,
      facts: "The post offered followers for sale.",
      reason: "Selling followers breaks rule R3.",
      source: "own_initiative",
      decidedAt: ago(60 * 24 * 3),
      post: null,
      measures: [],
      reversals: [],
      endedMeasures: [],
      reviewed: null,
      appealUntil: daysAhead(10),
      reversedOn: null,
      content: { kind: "account", handle: "ada", displayName: "Ada Lovelace", bio: "" },
      appeal: null,
      strike: null,
      standing: null,
    } as z.input<typeof DecisionView>,
    "decision",
  );
}

export interface FixtureState {
  /** Whether /api/me answers the account or 401. */
  signedIn: boolean;
  /** Everything the page asked that no fixture answers, or that the walk should never cause. */
  problems: string[];
  /** Every API request, in order: method, path and query, and when it arrived (ms since the walk's clock started). */
  requests: { method: string; path: string; at: number }[];
  /**
   * The actions the API refuses for now (like, repost, bookmark, follow, delete), with a 503 as a busy server would, so
   * a step sees the card roll back; and how long every action's answer waits, so a step sees the change before it.
   */
  refuse: Set<string>;
  delayMs: number;
  /** New posts above the timelines' first (UI Task 5): the poll finds them, and a reload reads them. */
  newPosts: number;
  /** How long each timeline answer waits, so a step can watch what the answer brings. */
  timelineDelayMs: number;
}

export interface FixtureApi {
  state: FixtureState;
  handle(req: IncomingMessage, res: ServerResponse, url: URL, body: Buffer): Promise<void>;
  /** What GET /api/posts/<id>/status answers, for the post page's handle: 204 for a post the API shows, 404 otherwise. */
  postStatus(id: string): number;
}

type Answer = { status: number; json?: unknown; raw?: Buffer; type?: string };

/** A fixture post's number from its id: post n has the id id(100 + n). */
const numberOf = (postId: string): number => Number.parseInt(postId.slice(-12), 10) - 100;

/** Others who liked the post while the reader's like was on its way: the answer's count is the server's, not the card's guess. */
const OTHERS = 2;

const FLAGS = { like: "liked", repost: "reposted", bookmark: "bookmarked" } as const;

export function createFixtureApi(): FixtureApi {
  const state: FixtureState = { signedIn: false, problems: [], requests: [], refuse: new Set(), delayMs: 0, newPosts: 0, timelineDelayMs: 0 };
  const ok = (json: unknown): Answer => ({ status: 200, json });
  const posts = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => post(from + i, state.signedIn));

  /** The answer to one GET, or null when no fixture knows the path. */
  function get(path: string, query: URLSearchParams): Answer | null {
    const cursor = query.get("cursor");
    if (path === "/api/me") return state.signedIn ? ok(me()) : { status: 401, json: { error: { code: "unauthenticated", message: "Sign in to continue." } } };
    if (path === "/api/timeline/following" || path === "/api/timeline/latest") return ok(timeline(cursor, query.get("limit"), state.signedIn, state.newPosts));
    if (path === "/api/timeline/explore") {
      const items = posts(1, 10).map((view) => ({ kind: "post" as const, post: view }));
      return ok(parse(ExplorePage, { items, nextCursor: null, computedAt: ago(5), signInForMore: !state.signedIn }, "explore"));
    }
    if (path === `/api/posts/${POST_ID}/thread`) {
      const replies = [2, 3, 5].map((n) => post(n, state.signedIn, { id: id(300 + n), replyTo: { id: POST_ID, authorHandle: GRACE.handle } }));
      return ok(parse(ThreadResponse, { ancestors: [], post: post(1, state.signedIn), replies: { items: replies, nextCursor: null } }, "thread"));
    }
    // Ada's post 3 replies to a chain of three, and has replies of its own: the page must scroll to hold it at the top (UI Task 5).
    if (path === `/api/posts/${id(103)}/thread`) {
      const ancestors = [9, 8, 6].map((n) => post(n, state.signedIn));
      const replies = [2, 5, 7, 10, 11].map((n) => post(n, state.signedIn, { id: id(320 + n), replyTo: { id: id(103), authorHandle: ADA.handle } }));
      return ok(parse(ThreadResponse, { ancestors, post: post(3, state.signedIn, { replyTo: { id: id(106), authorHandle: ADA.handle } }), replies: { items: replies, nextCursor: null } }, "thread"));
    }
    // Ada's own posts (3, 6, 9 and every third) have an Explore status for her: post 3 is listed, the others wait.
    const exploring = /^\/api\/posts\/([0-9a-f-]{36})\/explore$/.exec(path);
    if (exploring && numberOf(exploring[1]!) % 3 === 0) {
      return ok(parse(ExploreStatus, { status: exploring[1] === id(103) ? "listed" : "pending", computedAt: ago(5) }, "explore status"));
    }
    const profilePath = /^\/api\/profiles\/([a-z0-9_]+)(?:\/(posts|replies|followers|following))?$/.exec(path);
    if (profilePath) {
      const author = AUTHORS.find((a) => a.handle === profilePath[1]);
      if (!author) return null;
      const tab = profilePath[2];
      if (tab === undefined) return ok(profile(author, state.signedIn));
      if (tab === "posts") return ok(parse(TimelinePage, { items: posts(1, 12).map((view) => ({ kind: "post" as const, post: { ...view, author } })), nextCursor: null }, "profile posts"));
      if (tab === "replies") return ok(parse(PostPage, { items: [], nextCursor: null }, "replies"));
      const people = [listItem(GRACE, "Compilers, ships and the occasional heron.", state.signedIn), listItem(LINUS, "Kernels and coffee.", state.signedIn)].filter((p) => p.handle !== author.handle);
      return ok(parse(ProfilePage, { items: people, nextCursor: null }, "profile list"));
    }
    if (path === "/api/me/bookmarks") return ok(parse(PostPage, { items: posts(1, 20).map((view) => ({ ...view, viewer: { liked: false, reposted: false, bookmarked: true } })), nextCursor: null }, "bookmarks"));
    if (path === "/api/me/likes") return ok(parse(PostPage, { items: posts(5, 8), nextCursor: null }, "likes"));
    if (path === "/api/me/blocks" || path === "/api/me/mutes") return ok(parse(ProfilePage, { items: [], nextCursor: null }, "blocks"));
    const media = /^\/api\/media\/[0-9a-f-]{36}\/(small|large)\.webp$/.exec(path);
    if (media) return { status: 200, raw: FIXTURE_WEBP, type: "image/webp" };
    if (path === "/api/public/facts") return ok(FACTS);
    if (path === "/api/public/transparency") return ok(parse(PublicTransparency, { editions: [] }, "transparency"));
    if (path === "/api/public/head") return ok(parse(PublicHead, { days: [] }, "head"));
    if (path === "/api/auth/sessions") {
      return ok(parse(SessionsResponse, { sessions: [{ id: id(601), deviceLabel: "Chromium on Windows", platform: "web", createdAt: ago(600), lastUsedAt: ago(1), current: true }] }, "sessions"));
    }
    if (path === "/api/auth/passkeys") {
      return ok(parse(PasskeyListResponse, { passkeys: [{ id: id(602), name: "Laptop", createdAt: ago(60 * 24 * 20), lastUsedAt: ago(30), synced: false, createdOn: "Chromium on Windows", current: true, isNew: false, suspended: false }] }, "passkeys"));
    }
    if (path === "/api/moderation/cases") return ok(parse(AuthorCasesPage, { decisions: [], nextCursor: null, activeStrikes: 0 }, "cases"));
    if (path === "/api/moderation/reports") return ok(parse(ReportsPage, { reports: [], nextCursor: null, reportMailStopped: false }, "reports"));
    if (path === "/api/moderation/notices") return ok(parse(AuthorNoticesPage, { notices: [], nextCursor: null }, "notices"));
    if (path === `/api/moderation/decisions/${DECISION_ID}`) return ok(decision());
    if (path === `/api/moderation/releases/${RELEASE_ID}`) {
      return ok(parse(ReleaseNoticeView, { id: RELEASE_ID, basis: "period", releasedAt: ago(60), backupsClearAt: daysAhead(35), upload: false, posts: [{ id: id(103), createdAt: ago(60 * 24 * 40) }], postCount: 1, images: 1, sealDecisionId: null, appeal: "none" }, "release"));
    }
    if (path === `/api/moderation/uploads/${UPLOAD_ID}`) {
      return ok(parse(UploadRefusalView, { id: UPLOAD_ID, refusedAt: ago(120), source: "a hash list", matchKind: "exact", listedAs: "csam", objection: null, mayObject: true, endedAt: null, endAs: null, endReason: null, released: null, reportKept: false }, "upload"));
    }
    return null;
  }

  /**
   * The answer to one of the reader's actions (UI Task 4): a like, a repost or a save turned on (POST) or off (DELETE),
   * answered with the post's counts and the reader's state; a follow, with the follower count; a post deleted, with 204.
   * A kind in `refuse` is answered 503; null for any other path, which is a problem.
   */
  function action(method: string, path: string): Answer | null {
    const refused: Answer = { status: 503, json: { error: { code: "unavailable", message: "korbat is busy. Try again in a moment." } } };
    const engaged = /^\/api\/posts\/([0-9a-f-]{36})\/(like|repost|bookmark)$/.exec(path);
    if (engaged) {
      const kind = engaged[2] as keyof typeof FLAGS;
      if (state.refuse.has(kind)) return refused;
      const on = method === "POST";
      const base = post(numberOf(engaged[1]!), true);
      const counts = { ...base.counts };
      if (kind === "like") counts.likes = base.counts.likes + (on ? 1 + OTHERS : 0);
      if (kind === "repost") counts.reposts = base.counts.reposts + (on ? 1 : 0);
      return ok(parse(EngagementResponse, { counts, viewer: { ...base.viewer!, [FLAGS[kind]]: on } }, "engagement"));
    }
    const follow = /^\/api\/profiles\/([a-z0-9_]+)\/follow$/.exec(path);
    if (follow && AUTHORS.some((author) => author.handle === follow[1])) {
      if (state.refuse.has("follow")) return refused;
      const on = method === "POST";
      return ok(parse(FollowResponse, { following: on, followerCount: on ? 129 : 128 }, "follow"));
    }
    const removed = /^\/api\/posts\/([0-9a-f-]{36})$/.exec(path);
    if (removed && method === "DELETE") return state.refuse.has("delete") ? refused : { status: 204 };
    return null;
  }

  /** The answer to one POST the walk causes by reading: a report's status, and the passkey autofill's options on sign-in. */
  function post_(path: string, body: Buffer): Answer | null {
    // Signing out ends the session: /api/me answers 401 from here on (UI Task 5, the session's end).
    if (path === "/api/auth/signout") {
      state.signedIn = false;
      return { status: 204 };
    }
    if (path === "/api/notices/status") {
      const asked = JSON.parse(body.toString("utf8") || "{}") as { ref?: string; token?: string };
      if (asked.ref !== NOTICE_REF || asked.token !== NOTICE_TOKEN) return null;
      return ok(parse(NoticeStatus, { ref: NOTICE_REF, receivedAt: ago(60 * 24 * 2), items: [], contact: null }, "notice status"));
    }
    if (path === "/api/auth/passkey/signin/options") return ok(parse(PasskeyOptionsResponse, { options: { challenge: "Y2hhbGxlbmdlLW9mLXRoZS13YWxr", rpId: "localhost", userVerification: "required", allowCredentials: [], timeout: 300000 } }, "passkey options"));
    return null;
  }

  return {
    state,
    postStatus: (asked) => (asked === POST_ID || asked === id(103) ? 204 : 404),
    async handle(req, res, url, body) {
      const method = req.method ?? "GET";
      state.requests.push({ method, path: `${url.pathname}${url.search}`, at: Date.now() });
      let answer: Answer | null = null;
      try {
        if (method === "GET") answer = get(url.pathname, url.searchParams);
        else if (method === "POST") answer = post_(url.pathname, body) ?? action(method, url.pathname);
        else if (method === "DELETE") answer = action(method, url.pathname);
        // An action's answer waits as long as the step asks, so the step sees the card change before it lands.
        if (method !== "GET" && answer !== null && state.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
        if (url.pathname.startsWith("/api/timeline/") && state.timelineDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.timelineDelayMs));
      } catch (err) {
        state.problems.push(`a fixture threw for ${method} ${url.pathname}: ${String(err)}`);
      }
      if (answer === null) {
        state.problems.push(`an unanswered request: ${method} ${url.pathname}${url.search}`);
        res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ error: { code: "not_found", message: "No such route" } }));
        return;
      }
      if (answer.status === 204) {
        res.writeHead(204, { "cache-control": "no-store" }).end();
        return;
      }
      if (answer.raw) {
        res.writeHead(answer.status, { "content-type": answer.type ?? "application/octet-stream", "content-length": answer.raw.length, "cache-control": "private, no-store", "x-content-type-options": "nosniff" }).end(answer.raw);
        return;
      }
      // The API's own date header: Explore ages its ranking by it.
      res.writeHead(answer.status, { "content-type": "application/json", "cache-control": "no-store", date: new Date().toUTCString() }).end(JSON.stringify(answer.json));
    },
  };
}
```

### Replace `apps/app/test/explore.test.tsx` (whole file)

```tsx
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { EXPLORE_V2, ExploreStatusKind, type ExploreFormula, type ExplorePage, type MeResponse, type PostView, type TimelineItem } from "@korbat/contracts";
import ExploreAbout, { ExploreRules } from "../src/app/explore/about";
import Home, { homeListKey, homeTab, homeTabs } from "../src/app/index";
import { ExploreSwitch, useExploreSwitch } from "../src/app/settings/privacy";
// UI Task 3: PopularNow.tsx left the shell (UI design, decision 14); its case is on Explore's rows below.
import { ExploreEmpty, ExploreFooter, ExploreHeader } from "../src/components/social/ExploreList";
import { PostCard } from "../src/components/social/PostCard";
import { ApiError } from "../src/lib/api";
import {
  appendUnseen,
  EXPLORE_REFRESHED_NOTICE,
  exploreEmptyText,
  exploreReader,
  exploreRules,
  exploreStatusText,
  exploreSwitchText,
  rankingAge,
  readPages,
  STALE_AFTER_MS,
  type RankingRead,
} from "../src/lib/explore";
import type { ExploreAnswer } from "../src/lib/social";
import { TERMS_SECTIONS, TERMS_VERSION } from "../src/lib/terms";

/**
 * Explore in the web app (2c design, section 11): the tabs, the list, the formula page, the switch, the status line, the
 * chip, the context column and the terms. The helpers that decide (the tab an address names, the lists' keys, the
 * ranking's age, what a page of a new ranking adds, the list's reads, every sentence and its numbers) are called, the
 * reads with fake answers; the screens and components are server-rendered as lifecycle.test.tsx renders its pages; what a
 * static render cannot show (requests, focus, the order of a save) is read from the source, as a11y.test.tsx does.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");

/** The route parameters and the session the component under test reads; each test sets what it needs. */
const route = vi.hoisted(() => ({ params: {} as Record<string, string> }));
const session = vi.hoisted(() => ({ state: { status: "signed-out" } as unknown }));

// expo-router cannot load in Node (it reaches React Native's own modules): Link with `asChild` hands the child its href,
// which react-native-web renders as a real anchor, a screen reads its parameters and the path, and nothing navigates.
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined, setParams: () => undefined },
  useLocalSearchParams: () => route.params, useIsFocused: () => true,
  usePathname: () => "/",
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: session.state, refresh: async () => session.state }) }));
// A post card's images and the compose sheet's slide reach native modules that do not load in Node; neither is under test.
vi.mock("expo-image", () => ({ Image: () => null }));
// react-native-reanimated is mocked once for every test file in test/setup.ts.

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

/** Every source file of the app, with its path from src in forward slashes. */
function sourceFiles(): { name: string; text: string }[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .map((file) => ({ name: file.split(path.sep).join("/"), text: readFileSync(path.join(SRC, file), "utf8") }));
}

/** The body of the function `name` declares at the top of a file, up to its closing brace at the start of a line. */
function block(source: string, name: string): string {
  const from = source.indexOf(`function ${name}(`);
  expect(from, name).toBeGreaterThanOrEqual(0);
  return source.slice(from, source.indexOf("\n}\n", from));
}

/** Every anchor's opening tag in the markup. */
const anchors = (markup: string): string[] => markup.match(/<a\b[^>]*>/g) ?? [];

/** The text of every link to `href`, in order. */
function linkTexts(markup: string, href: string): string[] {
  const texts: string[] = [];
  for (let at = markup.indexOf(`href="${href}"`); at !== -1; at = markup.indexOf(`href="${href}"`, at + 1)) {
    const start = markup.lastIndexOf("<a ", at);
    const end = markup.indexOf("</a>", at);
    if (start !== -1 && end !== -1) texts.push(markup.slice(start, end).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  }
  return texts;
}

/** The opening tag of the button whose text is `label`, or "" when there is none. */
function buttonTag(markup: string, label: string): string {
  const at = markup.indexOf(label);
  const role = at === -1 ? -1 : markup.lastIndexOf('role="button"', at);
  return role === -1 ? "" : markup.slice(markup.lastIndexOf("<", role), markup.indexOf(">", role) + 1);
}

/** The tabs of the markup's tab list, in order: each one's text and whether it is selected. */
function tabsOf(markup: string): { label: string; selected: boolean }[] {
  return [...markup.matchAll(/<[a-z]+\b([^>]*\brole="tab"[^>]*)>(?:<[^>]+>)*([^<]*)/g)].map((match) => ({
    label: match[2] ?? "",
    selected: (match[1] ?? "").includes('aria-selected="true"'),
  }));
}

/** The markup's text as a reader sees it: tags dropped, the entities React writes decoded, spaces collapsed. */
function textOf(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

const AUTHOR = "0f7b3c2e-4a1d-4c6b-9e8f-1a2b3c4d5e6f";
const OTHER = "1e2d3c4b-5a69-4786-9a5b-4c3d2e1f0a9b";
const AT = "2026-09-28T12:05:00.000Z";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function post(n: number, extra: Partial<PostView> = {}): PostView {
  return {
    id: id(n),
    author: { id: AUTHOR, handle: "ada", displayName: "Ada", verified: false },
    body: `post number ${n}`,
    createdAt: "2026-09-28T10:00:00.000Z",
    state: "visible",
    replyTo: null,
    counts: { likes: 3, reposts: 1, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
    ...extra,
  };
}
// ExplorePage's items are post items only: the contract's refinement narrows the timeline item.
const item = (n: number): ExplorePage["items"][number] => ({ kind: "post", post: post(n) });
const explorePage = (posts: number[], nextCursor: string | null): ExplorePage => ({ items: posts.map(item), nextCursor, computedAt: AT, signInForMore: false });
const ids = (items: TimelineItem[]): string[] => items.map((entry) => entry.post.id);
/** The Date header of an answer carrying the ranking of AT: two and a half minutes after it, by the server's clock. */
const DATE = new Date(Date.parse(AT) + 150_000).toUTCString();
/** When that answer arrived, by the device's clock. */
const RECEIVED = Date.parse(AT) + 151_000;
/** A page of Explore as the app's client answers it: with the answer's Date header and the time it arrived. */
const answer = (posts: number[], nextCursor: string | null, extra: Partial<ExploreAnswer> = {}): ExploreAnswer => ({
  ...explorePage(posts, nextCursor),
  date: DATE,
  receivedAt: RECEIVED,
  ...extra,
});

const ME: MeResponse = {
  user: { id: AUTHOR, email: "ada@example.org", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 1 },
  profile: { id: AUTHOR, handle: "ada", displayName: "Ada", handleChangedAt: null, verified: false, showInExplore: true },
  standing: null,
};
const signedIn = (showInExplore = true) => ({ status: "signed-in", me: { ...ME, profile: { ...ME.profile!, showInExplore } } });

describe("Home's tabs and their addresses", () => {
  test("an account has Following, Latest and Explore; everyone else Latest and Explore, Latest first as before", () => {
    expect(homeTabs(true)).toEqual(["following", "latest", "explore"]);
    expect(homeTabs(false)).toEqual(["latest", "explore"]);
  });

  test("the tab is the one /?tab= names, and a missing, unknown or unavailable name means the first tab", () => {
    expect(homeTab(undefined, true)).toBe("following");
    expect(homeTab("latest", true)).toBe("latest");
    expect(homeTab("explore", true)).toBe("explore");
    expect(homeTab(undefined, false)).toBe("latest");
    expect(homeTab("explore", false)).toBe("explore");
    // Following needs an account.
    expect(homeTab("following", false)).toBe("latest");
    expect(homeTab("trending", true)).toBe("following");
    expect(homeTab("Explore", true)).toBe("following");
    // A parameter given twice counts once, by its first value.
    expect(homeTab(["explore", "latest"], true)).toBe("explore");
  });

  test("signed in, Home shows the three tabs with the one the address names selected, and Explore's list under them", () => {
    session.state = signedIn();
    route.params = { tab: "explore" };
    const out = html(<Home />);
    expect(out).toContain('role="tablist"');
    expect(tabsOf(out)).toEqual([
      { label: "Following", selected: false },
      { label: "Latest", selected: false },
      { label: "Explore", selected: true },
    ]);
    // The list's header, with its link to the rules.
    expect(linkTexts(out, "/explore/about")).toEqual(["How Explore works"]);
    route.params = {};
    const following = html(<Home />);
    expect(tabsOf(following).filter((tab) => tab.selected).map((tab) => tab.label)).toEqual(["Following"]);
    expect(linkTexts(following, "/explore/about")).toEqual([]);
  });

  test("signed out, Home shows Latest and Explore, and the prompt under them fits the tab", () => {
    session.state = { status: "signed-out" };
    route.params = {};
    const latest = html(<Home />);
    expect(tabsOf(latest)).toEqual([
      { label: "Latest", selected: true },
      { label: "Explore", selected: false },
    ]);
    expect(latest).toContain("You are reading the latest public posts. Sign in to follow people and post.");
    route.params = { tab: "explore" };
    const explore = html(<Home />);
    expect(tabsOf(explore)).toEqual([
      { label: "Latest", selected: false },
      { label: "Explore", selected: true },
    ]);
    expect(explore).toContain("Explore lists recent posts that other accounts like and repost. Sign in to follow people and post.");
    // True whatever the list holds: it neither promises more of Explore, which may not exist, nor says posts are being read
    // over a list that may be empty. Only the list's own footer, shown when more posts exist, offers more of it.
    expect(explore).not.toContain("see more of Explore");
    expect(explore).not.toContain("You are reading");
    route.params = { tab: "following" };
    expect(tabsOf(html(<Home />)).filter((tab) => tab.selected).map((tab) => tab.label)).toEqual(["Latest"]);
    route.params = {};
  });

  test("each list is keyed by its reader only, so a tab change or a new post keeps its rows and place, and signing in or out, or another account, reads it again", () => {
    // A list read signed out has no cursor and a sign-in link and was read without any block or mute, and the web keeps a
    // Home mounted under the sign-in screen, which Back shows again once signed in. UI Task 5: the tab and a new post left
    // the key (UI design, section 7.5); a tab's rows and place come back from lib/feed-cache.ts.
    const readers = [homeListKey(null), homeListKey(AUTHOR), homeListKey(OTHER)];
    expect(new Set(readers).size).toBe(3);
    expect(homeListKey(AUTHOR)).toBe(homeListKey(AUTHOR));
    // Both lists take their key from it, with the session's account as the reader; the feeds' list is a FeedList.
    const home = block(read("app", "index.tsx"), "Home");
    expect(home).toContain('const viewer = state.status === "signed-in" ? state.me.user.id : null;');
    expect(home.match(/key=\{homeListKey\(viewer\)\}/g)).toHaveLength(2);
    expect(home).toContain("<FeedList");
  });

  test("a tab is chosen through the address, every link to a tab names one Home has, and Following's empty text points to Latest and Explore", () => {
    const home = read("app", "index.tsx");
    expect(home).toContain("useLocalSearchParams<{ tab?: string }>()");
    expect(home).toContain("const select = (tab: Tab) => router.setParams({ tab });");
    expect(read("lib", "ui-words.ts")).toContain('"feed.empty.following.body": "Nothing here yet. Follow someone, or switch to Latest or Explore.",');
    const links = sourceFiles().flatMap((file) => [...file.text.matchAll(/"\/\?tab=([a-z]+)"/g)].map((match) => ({ file: file.name, tab: match[1] ?? "" })));
    // How Explore works leads back to the Explore tab; Popular now, which did too, left the shell (UI design, decision 14).
    expect(links.map((link) => link.file).sort()).toEqual(["app/explore/about.tsx"]);
    for (const link of links) expect(homeTab(link.tab, false), link.file).toBe(link.tab);
  });
});

describe("the Explore list", () => {
  test("its header says how long ago the ranking was computed, or since when it had not been when read, offers Refresh once a newer one is due, and links to How Explore works", () => {
    /** A ranking of the given age, read just now: the answer's Date header and the device's clock agree. */
    const readNow = (age: number): RankingRead => {
      const now = Date.now();
      return { computedAt: new Date(now - age).toISOString(), date: new Date(now).toUTCString(), receivedAt: now };
    };
    // Five seconds past the minute: the Date header counts whole seconds.
    const fresh = html(<ExploreHeader ranking={readNow(3 * 60_000 + 5_000)} onRefresh={() => undefined} />);
    expect(fresh).toContain("Updated 3 minutes ago");
    expect(buttonTag(fresh, "Refresh")).toBe("");
    expect(linkTexts(fresh, "/explore/about")).toEqual(["How Explore works"]);
    const due = html(<ExploreHeader ranking={readNow(6 * 60_000 + 5_000)} onRefresh={() => undefined} />);
    expect(due).toContain("Updated 6 minutes ago");
    expect(buttonTag(due, "Refresh")).not.toBe("");
    const stale = html(<ExploreHeader ranking={readNow(20 * 60_000)} onRefresh={() => undefined} />);
    expect(stale).toContain("Explore has not been updated since ");
    expect(stale).not.toContain("Updated ");
    expect(buttonTag(stale, "Refresh")).not.toBe("");
    // Before the first round there is no ranking, no time to show and nothing to read again.
    const none = html(<ExploreHeader ranking={null} onRefresh={() => undefined} />);
    expect(none).not.toMatch(/Updated|updated since|Refresh/);
    expect(linkTexts(none, "/explore/about")).toEqual(["How Explore works"]);
  });

  test("the ranking's age is its age when read, by the answer's Date header, plus the time on screen; only its age when read makes it stale", () => {
    const computedAt = "2026-09-28T12:00:00.000Z";
    const t0 = Date.parse(computedAt);
    /** The ranking in an answer the server sent `served` ms after computing it, which arrived at the device's `receivedAt`. */
    const ranking = (served: number, receivedAt: number): RankingRead => ({ computedAt, date: new Date(t0 + served).toUTCString(), receivedAt });
    expect(STALE_AFTER_MS).toBe(15 * 60_000);
    // A device clock that agrees with the server's.
    const right = t0 + 190_000;
    expect(rankingAge(ranking(30_000, t0 + 30_000), t0 + 30_000)).toMatchObject({ stale: false, text: "Updated just now" });
    expect(rankingAge(ranking(60_000, t0 + 60_000), t0 + 60_000)).toMatchObject({ stale: false, text: "Updated 1 minute ago" });
    expect(rankingAge(ranking(190_000, right), right)).toMatchObject({ stale: false, text: "Updated 3 minutes ago" });
    // A device clock 20 minutes fast, then one 20 minutes slow: the age at the read is the server's and the time on screen
    // the device's alone, so neither error counts, and neither warns nor calls the ranking new.
    const fast = right + 20 * 60_000;
    expect(rankingAge(ranking(190_000, fast), fast)).toMatchObject({ stale: false, text: "Updated 3 minutes ago" });
    expect(rankingAge(ranking(190_000, fast), fast + 60_000)).toMatchObject({ stale: false, text: "Updated 4 minutes ago" });
    const slow = right - 20 * 60_000;
    expect(rankingAge(ranking(190_000, slow), slow)).toMatchObject({ stale: false, text: "Updated 3 minutes ago" });
    // A page left open counts on, and never turns into the warning: the job has written newer rankings meanwhile.
    expect(rankingAge(ranking(190_000, right), right + 20 * 60_000)).toMatchObject({ stale: false, text: "Updated 23 minutes ago" });
    // Over 15 minutes old when the server answered: by then several rounds have failed or been skipped.
    expect(rankingAge(ranking(15 * 60_000, right), right)).toMatchObject({ stale: false, text: "Updated 15 minutes ago" });
    const stale = rankingAge(ranking(15 * 60_000 + 1000, fast), fast);
    expect(stale.stale).toBe(true);
    expect(stale.text).toMatch(/^Explore has not been updated since .+\.$/);
    expect(stale.text).toContain(new Date(t0).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    // Without a Date header the device's clock is all there is.
    expect(rankingAge({ computedAt, date: null, receivedAt: t0 + 60_000 }, t0 + 60_000)).toMatchObject({ stale: false, text: "Updated 1 minute ago" });
    expect(rankingAge({ computedAt, date: null, receivedAt: t0 + 20 * 60_000 }, t0 + 20 * 60_000)).toMatchObject({ stale: true });
    // The header counts whole seconds, so a ranking of the same second is not in the future; and a minute clock that last
    // ticked before the answer arrived adds no time on screen.
    expect(rankingAge({ computedAt: "2026-09-28T12:00:00.800Z", date: new Date(t0).toUTCString(), receivedAt: right }, right - 30_000)).toMatchObject({
      stale: false,
      text: "Updated just now",
    });
    // Days later the date is named too, so the time cannot be read as today's.
    const old = new Date(t0 - 3 * 24 * 3600_000);
    const days = rankingAge({ computedAt: old.toISOString(), date: new Date(t0).toUTCString(), receivedAt: t0 }, t0);
    expect(days.stale).toBe(true);
    expect(days.text).toContain(old.toLocaleDateString());
  });

  test("Refresh is offered once the ranking on screen is as old as EXPLORE_V2's refresh interval, when a newer one should exist", () => {
    const computedAt = "2026-09-28T12:00:00.000Z";
    const t0 = Date.parse(computedAt);
    // Read a minute after it was computed, then left on screen.
    const read: RankingRead = { computedAt, date: new Date(t0 + 60_000).toUTCString(), receivedAt: t0 + 60_000 };
    expect(EXPLORE_V2.refreshMinutes).toBe(5);
    expect(rankingAge(read, read.receivedAt + 4 * 60_000 - 1000).offerRefresh).toBe(false);
    expect(rankingAge(read, read.receivedAt + 4 * 60_000).offerRefresh).toBe(true);
    // A ranking that was stale when read is offered at once.
    expect(rankingAge({ ...read, date: new Date(t0 + 16 * 60_000).toUTCString() }, read.receivedAt)).toMatchObject({ stale: true, offerRefresh: true });
    // The interval is the formula's.
    const slower: ExploreFormula = { ...EXPLORE_V2, refreshMinutes: 10 };
    expect(rankingAge(read, read.receivedAt + 9 * 60_000 - 1000, slower).offerRefresh).toBe(false);
    expect(rankingAge(read, read.receivedAt + 9 * 60_000, slower).offerRefresh).toBe(true);
  });

  test("a page adds only the posts not on screen; another page is read only while one adds nothing and more follow", () => {
    const shown = new Set([id(1), id(2), id(3)]);
    const some = appendUnseen(shown, explorePage([2, 4, 1, 5], "c1"));
    expect(ids(some.added)).toEqual([id(4), id(5)]);
    expect(some).toMatchObject({ nextCursor: "c1", fetchNext: false });
    expect(appendUnseen(shown, explorePage([3, 1], "c2"))).toEqual({ added: [], nextCursor: "c2", fetchNext: true });
    // The ranking ends.
    expect(appendUnseen(shown, explorePage([2], null))).toEqual({ added: [], nextCursor: null, fetchNext: false });
    // A page whose posts the reader's blocks and mutes all took out is not the end while a cursor follows it.
    expect(appendUnseen(shown, explorePage([], "c3"))).toEqual({ added: [], nextCursor: "c3", fetchNext: true });
    // A post is added once, and the set on screen is left as it was.
    expect(ids(appendUnseen(shown, explorePage([6, 6], null)).added)).toEqual([id(6)]);
    expect([...shown]).toEqual([id(1), id(2), id(3)]);
  });

  /** A fake Explore: each cursor (the first page's is "first") answers a page or an error, and every request is recorded. */
  function fakeExplore(answers: Record<string, ExplorePage | Error>) {
    const calls: (string | undefined)[] = [];
    const fetchPage = async (cursor?: string): Promise<ExplorePage> => {
      calls.push(cursor);
      const answer = answers[cursor ?? "first"];
      if (!answer) throw new Error(`no page for ${cursor ?? "first"}`);
      if (answer instanceof Error) throw answer;
      return answer;
    };
    return { fetchPage, calls };
  }
  const refreshed = () => new ApiError(409, "explore_refreshed", "Explore was refreshed.");

  test("Load more reads the next page of the ranking being paged", async () => {
    const fake = fakeExplore({ c1: explorePage([3, 4], "c2") });
    const result = await readPages(fake.fetchPage, "c1", new Set([id(1), id(2)]));
    expect(fake.calls).toEqual(["c1"]);
    expect(ids(result.added)).toEqual([id(3), id(4)]);
    expect(result).toMatchObject({ nextCursor: "c2", refreshed: false });
  });

  test("when the ranking being paged is gone, the new one is read from its first page, keeping only unseen posts, until a page adds some", async () => {
    const fake = fakeExplore({ c2: refreshed(), first: explorePage([2, 1], "n1"), n1: explorePage([1, 5, 2, 6], "n2") });
    const result = await readPages(fake.fetchPage, "c2", new Set([id(1), id(2), id(3)]));
    expect(fake.calls).toEqual(["c2", undefined, "n1"]);
    expect(ids(result.added)).toEqual([id(5), id(6)]);
    expect(result).toMatchObject({ nextCursor: "n2", refreshed: true });
    expect(result.last?.computedAt).toBe(AT);
  });

  test("... or until the new ranking ends", async () => {
    const fake = fakeExplore({ c2: refreshed(), first: explorePage([2, 1], "n1"), n1: explorePage([3], null) });
    const result = await readPages(fake.fetchPage, "c2", new Set([id(1), id(2), id(3)]));
    expect(fake.calls).toEqual(["c2", undefined, "n1"]);
    expect(result).toMatchObject({ added: [], nextCursor: null, refreshed: true });
  });

  test("any other failure is the list's to show, a first page is never a refresh, and one read is bounded", async () => {
    const failing = fakeExplore({ c1: new ApiError(500, "internal", "Something went wrong on our side. Try again.") });
    await expect(readPages(failing.fetchPage, "c1", new Set())).rejects.toMatchObject({ code: "internal" });
    // Only a cursor names a ranking: the first page is always the current one.
    const first = fakeExplore({ first: refreshed() });
    await expect(readPages(first.fetchPage, undefined, new Set())).rejects.toMatchObject({ code: "explore_refreshed" });
    expect(first.calls).toEqual([undefined]);
    const empty = fakeExplore({ first: explorePage([], "x"), x: explorePage([], "x") });
    const result = await readPages(empty.fetchPage, undefined, new Set(), 3);
    expect(empty.calls).toHaveLength(3);
    expect(result).toMatchObject({ added: [], nextCursor: "x" });
  });

  test("the footer: a polite status line always in the tree, Load more while the ranking has more, and signed out the sign-in link when more exist", () => {
    expect(EXPLORE_REFRESHED_NOTICE).toBe("Explore was refreshed; the posts below come from the new ranking.");
    const quiet = html(<ExploreFooter cursor={null} signInForMore={false} notice={null} error={null} onLoadMore={() => undefined} />);
    const status = /<div[^>]*role="status"[^>]*>/.exec(quiet)?.[0] ?? "";
    expect(status).toContain('aria-live="polite"');
    // It can take the focus when Load more, which had it, leaves the tree.
    expect(status).toContain('tabindex="-1"');
    expect(quiet).not.toContain("Load more");
    expect(linkTexts(quiet, "/signin")).toEqual([]);
    const after = html(<ExploreFooter cursor="n2" signInForMore={false} notice={EXPLORE_REFRESHED_NOTICE} error={null} onLoadMore={() => undefined} />);
    expect(after).toMatch(/role="status"[^>]*><div[^>]*>Explore was refreshed; the posts below come from the new ranking\.<\/div>/);
    expect(buttonTag(after, "Load more")).not.toBe("");
    const signedOut = html(<ExploreFooter cursor={null} signInForMore notice={null} error={null} onLoadMore={() => undefined} />);
    expect(linkTexts(signedOut, "/signin")).toEqual(["Sign in to see more of Explore"]);
  });

  /** A fake Explore answering its requests in order from `script`, each a page or a failure, and recording each cursor. */
  function scripted(script: (ExploreAnswer | Error)[]) {
    const calls: (string | undefined)[] = [];
    const fetchPage = async (cursor?: string): Promise<ExploreAnswer> => {
      calls.push(cursor);
      const next = script.shift();
      if (!next) throw new Error(`no answer left for ${cursor ?? "first"}`);
      if (next instanceof Error) throw next;
      return next;
    };
    return { fetchPage, calls };
  }

  test("the list's reader lets one read run at a time: a load meanwhile fetches nothing and answers null, and each read answers what the list shows", async () => {
    const calls: (string | undefined)[] = [];
    const held: ((page: ExploreAnswer) => void)[] = [];
    const reader = exploreReader((cursor) => {
      calls.push(cursor);
      return new Promise<ExploreAnswer>((resolve) => held.push(resolve));
    });
    const first = reader.load();
    // Pull to refresh, Refresh or Load more while the first read runs: nothing is fetched and nothing changes on screen.
    expect(await reader.load()).toBeNull();
    expect(await reader.load("c0")).toBeNull();
    expect(calls).toEqual([undefined]);
    held[0]!(answer([1, 2], "c1"));
    const shown = await first;
    expect(ids(shown!.items)).toEqual([id(1), id(2)]);
    expect(shown).toMatchObject({ cursor: "c1", signInForMore: false, refreshed: false });
    // The ranking's time with the Date header and the arrival of the answer that carried it, which the header ages it by.
    expect(shown!.ranking).toEqual({ computedAt: AT, date: DATE, receivedAt: RECEIVED });
    // Once it has answered the next read runs, and a double press of Load more appends its page once.
    const more = reader.load("c1");
    expect(await reader.load("c1")).toBeNull();
    expect(calls).toEqual([undefined, "c1"]);
    held[1]!(answer([3], null));
    expect(await more).toMatchObject({ cursor: null, refreshed: false });
    expect(ids((await more)!.items)).toEqual([id(1), id(2), id(3)]);
  });

  test("after explore_refreshed the reader appends from the current ranking only the posts not already on screen, and goes on from there", async () => {
    const fake = scripted([answer([1, 2], "c1"), refreshed(), answer([2, 1, 5], "n1"), answer([5, 6], null)]);
    const reader = exploreReader(fake.fetchPage);
    await reader.load();
    const after = await reader.load("c1");
    expect(fake.calls).toEqual([undefined, "c1", undefined]);
    // The posts read stay where they are, once each; the new ranking adds what was not on screen, and the list says so.
    expect(ids(after!.items)).toEqual([id(1), id(2), id(5)]);
    expect(after).toMatchObject({ cursor: "n1", refreshed: true });
    // What it added is on screen now as well: a page holding it again adds only the rest.
    const next = await reader.load("n1");
    expect(ids(next!.items)).toEqual([id(1), id(2), id(5), id(6)]);
    expect(next).toMatchObject({ cursor: null, refreshed: false });
  });

  test("a failed read throws, leaves what the list shows as it was and lets the next load run", async () => {
    const offline = () => new ApiError(0, "network", "Cannot reach korbat. Check your connection.");
    const fake = scripted([offline(), answer([1, 2], "c1"), offline(), answer([3], null)]);
    const reader = exploreReader(fake.fetchPage);
    await expect(reader.load()).rejects.toMatchObject({ code: "network" });
    expect(ids((await reader.load())!.items)).toEqual([id(1), id(2)]);
    await expect(reader.load("c1")).rejects.toMatchObject({ code: "network" });
    // Load more again: its page comes below the posts that stayed.
    expect(ids((await reader.load("c1"))!.items)).toEqual([id(1), id(2), id(3)]);
    expect(fake.calls).toEqual([undefined, undefined, "c1", "c1"]);
  });

  test("a load without a cursor starts over: the first page in place of everything on screen, from which Load more goes on", async () => {
    const later = "2026-09-28T12:10:00.000Z";
    const fake = scripted([answer([1, 2], "c1"), answer([3, 4], "c2"), answer([5, 1], "d1", { computedAt: later }), answer([2, 3], null)]);
    const reader = exploreReader(fake.fetchPage);
    await reader.load();
    expect(ids((await reader.load("c1"))!.items)).toEqual([id(1), id(2), id(3), id(4)]);
    const again = await reader.load();
    expect(ids(again!.items)).toEqual([id(5), id(1)]);
    expect(again).toMatchObject({ cursor: "d1", refreshed: false });
    expect(again!.ranking?.computedAt).toBe(later);
    // The posts shown before it are no longer on screen, so a page holding them adds them like any other.
    expect(ids((await reader.load("d1"))!.items)).toEqual([id(5), id(1), id(2), id(3)]);
  });

  test("a post deleted from the list leaves the reader's list too, even while a read is in flight", async () => {
    let release: ((page: ExploreAnswer) => void) | undefined;
    const reader = exploreReader((cursor) => (cursor === undefined ? Promise.resolve(answer([1, 2], "c1")) : new Promise<ExploreAnswer>((resolve) => (release = resolve))));
    await reader.load();
    const more = reader.load("c1");
    expect(ids(reader.remove(id(2)).items)).toEqual([id(1)]);
    release!(answer([3], null));
    expect(ids((await more)!.items)).toEqual([id(1), id(3)]);
  });

  test("the sign-in flag comes from the last page read, and before the first round there is no ranking to age", async () => {
    const fake = scripted([answer([], null, { computedAt: null }), answer([1], null, { signInForMore: true })]);
    const reader = exploreReader(fake.fetchPage);
    expect(await reader.load()).toMatchObject({ items: [], cursor: null, ranking: null, signInForMore: false });
    expect(await reader.load()).toMatchObject({ cursor: null, ranking: { computedAt: AT }, signInForMore: true });
  });

  test("the list shows what one reader of its own answers, reads the first page again from pull to refresh and Refresh, announces a refresh and keeps the focus", () => {
    const list = block(read("components", "social", "ExploreList.tsx"), "ExploreList");
    const at = (code: string): number => {
      const index = list.indexOf(code);
      expect(index, code).toBeGreaterThan(0);
      return index;
    };
    // Made once with the list, so its state lives and ends with it.
    expect(list).toContain("const [reader] = useState(() => exploreReader(social.explore));");
    // An answer is what the list shows; null, while another read runs, changes nothing.
    expect(at("const answer = await reader.load(after);")).toBeLessThan(at("if (!answer) return;"));
    expect(at("if (!answer) return;")).toBeLessThan(at("setShown(answer);"));
    expect(at("setShown(answer);")).toBeLessThan(at("if (answer.refreshed) {"));
    expect(at("if (answer.refreshed) {")).toBeLessThan(at("setNotice(EXPLORE_REFRESHED_NOTICE);"));
    expect(list).toContain("const remove = (id: string) => setShown(reader.remove(id));");
    // Its posts, Load more's cursor, the ranking's time and the sign-in link all come from the answer.
    for (const wire of [
      "items: shown.items,",
      "<ExploreHeader ranking={shown.ranking} onRefresh={() => refresh(true)} lineRef={line} />",
      "onRefresh={() => refresh(false)}",
      "cursor={shown.cursor}",
      "signInForMore={shown.signInForMore}",
      "if (shown.cursor) void load(shown.cursor);",
      "statusRef={footer}",
      // The empty state is an element, with its own links, not a line of text.
      "<ExploreEmpty onShowLatest={onShowLatest} />",
    ]) {
      expect(list, wire).toContain(wire);
    }
    // After a refresh the focus stays at the footer; after the header's Refresh it goes to the line saying how old the
    // ranking now is, since the button leaves the tree once the ranking is fresh.
    expect(list).toContain("if (refreshes > 0 && shown.cursor === null) (footer.current as unknown as { focus?: () => void } | null)?.focus?.();");
    expect(list).toContain("if (lineFocus > 0) (line.current as unknown as { focus?: () => void } | null)?.focus?.();");
  });

  test("the empty state is worded from EXPLORE_V2, links to How Explore works and offers Show Latest", () => {
    expect(exploreEmptyText()).toBe(
      "Nothing to show in Explore right now. A post appears here when at least 3 other accounts, each at least 2 days old, like or repost it in its first 48 hours. Explore is refreshed every 5 minutes.",
    );
    // Every number comes from the formula: another formula words another sentence.
    const other: ExploreFormula = { ...EXPLORE_V2, threshold: 5, engagerMinAgeHours: 72, windowHours: 24, refreshMinutes: 10 };
    expect(exploreEmptyText(other)).toBe(
      "Nothing to show in Explore right now. A post appears here when at least 5 other accounts, each at least 3 days old, like or repost it in its first 24 hours. Explore is refreshed every 10 minutes.",
    );
    expect(exploreEmptyText({ ...EXPLORE_V2, engagerMinAgeHours: 36 })).toContain("each at least 36 hours old");
    expect(exploreEmptyText({ ...EXPLORE_V2, engagerMinAgeHours: 24 })).toContain("each at least 1 day old");
    const out = html(<ExploreEmpty onShowLatest={() => undefined} />);
    expect(out).toContain(exploreEmptyText());
    expect(linkTexts(out, "/explore/about")).toEqual(["How Explore works"]);
    expect(buttonTag(out, "Show Latest")).not.toBe("");
    expect(textOf(html(<ExploreEmpty onShowLatest={() => undefined} formula={other} />))).toContain("at least 5 other accounts");
  });
});

describe("How Explore works", () => {
  test("states every number of the formula from EXPLORE_V2, with the version and the change log", () => {
    const out = textOf(html(<ExploreRules />));
    for (const phrase of [
      "Original posts from the last 48 hours",
      "was at least 2 days old when it liked or reposted",
      "has stood for at least 10 minutes",
      "A post needs at least 3 approving accounts.",
      "divided by (the hours it has been shown since it was posted + 2) to the power 1.8",
      "Explore holds the 300 posts with the highest scores, with at most 2 posts of one account",
      "A new ranking is computed every 5 minutes, never sooner than 4.5 minutes after the last one.",
      "The newest 2 rankings are kept",
      "Signed out, you see the first 20 posts.",
      "Explore stays empty for about 2 days after it opens",
      "This is version 2 of the formula.",
      "Version 1, 2026-09-28: First version.",
      // The second entry of the change log, word for word (3e design, section 9.7).
      "Version 2, 2026-10-12: Posts of suspended accounts are not ranked, and a suspended account's likes and reposts do not count. A post that moderation hid and then restored gets back the time it was hidden.",
    ]) {
      expect(out, phrase).toContain(phrase);
    }
  });

  test("version 2's rules in the design's words: what is ranked, what counts and the score name suspension and the time given back (3e)", () => {
    const body = (title: string) => exploreRules().find((section) => section.title === title)?.body;
    expect(body("What is ranked")).toBe(
      "Original posts from the last 48 hours: posts that are not replies or quotes, by accounts that have not switched Explore off and are not suspended when the ranking is computed. Replies belong to their threads. Quotes do not enter, because a quote that mocks another post would put that post under the mockery on a public page.",
    );
    expect(body("What counts")).toBe(
      "One thing: the post's approving accounts, meaning the accounts other than its author that liked or reposted it. An account that both liked and reposted a post counts once. A like or repost counts when its account still exists, is not suspended when the ranking is computed, was at least 2 days old when it liked or reposted, and the like or repost has stood for at least 10 minutes. Replies and quotes do not count, so a pile-on of replies cannot lift a post. Followers, the verified badge and reports are never used.",
    );
    expect(body("The score")).toBe(
      "A post needs at least 3 approving accounts. Its score is the number of approving accounts divided by (the hours it has been shown since it was posted + 2) to the power 1.8, so a newer post needs fewer approving accounts to rank as high as an older one. A post that korbat's moderation hid and then restored gets that time back: its window and its age stand still while it is not shown.",
    );
    // Server-rendered on How Explore works, each whole.
    const out = textOf(html(<ExploreRules />));
    for (const title of ["What is ranked", "What counts", "The score"]) expect(out, title).toContain(body(title)!);
  });

  test("follows the formula it is given: another formula's numbers, version and change log", () => {
    const other: ExploreFormula = {
      ...EXPLORE_V2,
      version: 3,
      windowHours: 72,
      engagerMinAgeHours: 96,
      standingMinutes: 15,
      threshold: 7,
      gravity: 1.5,
      offsetHours: 3,
      perAuthor: 4,
      listLength: 100,
      refreshMinutes: 10,
      minGapMinutes: 9,
      kept: 3,
      signedOutPage: 10,
      changes: [...EXPLORE_V2.changes, { version: 3, date: "2026-12-01", summary: "A later version." }],
    };
    const out = textOf(html(<ExploreRules formula={other} />));
    for (const phrase of [
      "Original posts from the last 72 hours",
      "was at least 4 days old when it liked or reposted",
      "has stood for at least 15 minutes",
      "A post needs at least 7 approving accounts.",
      "(the hours it has been shown since it was posted + 3) to the power 1.5",
      "Explore holds the 100 posts with the highest scores, with at most 4 posts of one account",
      "every 10 minutes, never sooner than 9 minutes after the last one",
      "The newest 3 rankings are kept",
      "Signed out, you see the first 10 posts.",
      "Explore stays empty for about 4 days after it opens",
      "This is version 3 of the formula.",
      "Version 1, 2026-09-28: First version.",
      "Version 2, 2026-10-12: Posts of suspended accounts are not ranked",
      "Version 3, 2026-12-01: A later version.",
    ]) {
      expect(out, phrase).toContain(phrase);
    }
    for (const phrase of ["48 hours", "2 days", "at least 3 approving", "300 posts", "power 1.8", "version 2 of"]) expect(out, phrase).not.toContain(phrase);
  });

  test("says what takes a post out besides the formula, in the design's words: a suspension, never Explore alone, and no longer the automatic checks", () => {
    const rule = exploreRules().find((section) => section.title === "What else takes a post out");
    expect(rule?.body).toBe(
      "Besides the formula, only these take a post out of Explore: its moderation state, set by a moderator for every list at once; a suspension of its author, which a moderator decides with a statement of reasons and which stops everything the account writes, never Explore alone; its author's switch or deletion; a block between you and the author in either direction; your mute. No moderator or automatic lever acts on Explore alone.",
    );
    // Rulebook version 2 has no automatic R1 and R2 checks, so the page names none.
    expect(rule?.body).not.toContain("automatic R1 and R2 checks");
    expect(textOf(html(<ExploreRules />))).toContain(rule!.body);
  });

  test("is a public page with the rules under its title", () => {
    session.state = { status: "signed-out" };
    const out = html(<ExploreAbout />);
    expect(out).toMatch(/<h1[^>]*>How Explore works<\/h1>/);
    expect(textOf(out)).toContain("A post needs at least 3 approving accounts.");
    // Nothing on the page asks who is reading: the rules are the same for everyone, signed in or not.
    expect(read("app", "explore", "about.tsx")).not.toMatch(/Redirect|useSession/);
  });
});

describe("Settings > Privacy: Show my posts in Explore", () => {
  const switchTag = (markup: string): string => /<input[^>]*role="switch"[^>]*>/.exec(markup)?.[0] ?? "";
  /** The switch as Privacy shows it: its state from the hook, which reads the session. */
  function SessionSwitch() {
    return <ExploreSwitch {...useExploreSwitch()} />;
  }

  test("is a switch named Show my posts in Explore, whose state is /api/me's", () => {
    session.state = signedIn(true);
    const on = switchTag(html(<SessionSwitch />));
    expect(on).toContain('type="checkbox"');
    expect(on).toContain('aria-label="Show my posts in Explore"');
    expect(on).toContain('checked=""');
    expect(on).not.toContain("disabled");
    session.state = signedIn(false);
    const off = switchTag(html(<SessionSwitch />));
    expect(off).toContain('aria-label="Show my posts in Explore"');
    expect(off).not.toContain("checked");
  });

  test("shows what it is given: the value being saved, disabled while the save runs, and a failed save's error", () => {
    const saving = switchTag(html(<ExploreSwitch on={false} busy error={null} change={async () => undefined} />));
    expect(saving).not.toContain("checked");
    expect(saving).toContain('disabled=""');
    const failed = html(<ExploreSwitch on busy={false} error="Cannot reach korbat. Check your connection." change={async () => undefined} />);
    expect(switchTag(failed)).toContain('checked=""');
    expect(switchTag(failed)).not.toContain("disabled");
    expect(textOf(failed)).toContain("Cannot reach korbat. Check your connection.");
  });

  test("its one sentence says turning it off takes effect at once and turning it back on at the next refresh", () => {
    expect(exploreSwitchText()).toBe(
      "Your public posts can appear in Explore when other accounts like or repost them: turning this off takes them out at once, and turning it back on takes effect at the next refresh, which comes every 5 minutes.",
    );
    expect(exploreSwitchText({ ...EXPLORE_V2, refreshMinutes: 10 })).toContain("at the next refresh, which comes every 10 minutes.");
    session.state = signedIn(true);
    const out = html(<SessionSwitch />);
    expect(out).toContain(exploreSwitchText());
    expect(linkTexts(out, "/explore/about")).toEqual(["How Explore works"]);
  });

  test("its state and its save live in Privacy, above the list that the Blocked and Muted tabs remount, so a tab change during a save loses neither", () => {
    const privacy = read("app", "settings", "privacy.tsx");
    const screen = block(privacy, "Privacy");
    expect(screen).toContain("const explore = useExploreSwitch();");
    expect(screen).toContain("<ExploreSwitch {...explore} />");
    // The list stays keyed by the tab, so the old tab's rows never show with the new tab's Unblock or Unmute.
    expect(screen).toContain("key={tab}");
    // The switch in the list's header only shows what it is given: it has no state a remount could reset.
    expect(block(privacy, "ExploreSwitch")).not.toMatch(/useState|useEffect|useSession/);
  });

  test("saves with POST or DELETE /api/me/explore while disabled, puts the switch back with the error on failure, and then refreshes the session", () => {
    expect(read("lib", "social.ts")).toContain('setShowInExplore: (on: boolean) => api("/api/me/explore", { method: on ? "POST" : "DELETE", schema: ExploreSettingResponse }),');
    const privacy = read("app", "settings", "privacy.tsx");
    expect(privacy).toContain('<Switch accessibilityLabel="Show my posts in Explore" value={on} disabled={busy} onValueChange={(next) => void change(next)}');
    const change = block(privacy, "useExploreSwitch");
    const at = (code: string): number => {
      const index = change.indexOf(code);
      expect(index, code).toBeGreaterThan(0);
      return index;
    };
    expect(at("if (busy) return;")).toBeLessThan(at("setBusy(true);"));
    expect(at("setOn(next);")).toBeLessThan(at("await social.setShowInExplore(next);"));
    expect(at("await social.setShowInExplore(next);")).toBeLessThan(at("await refresh();"));
    expect(at("} catch (err) {")).toBeLessThan(at("setOn(before);"));
    expect(at("setOn(before);")).toBeLessThan(at("setError(errorMessage(err));"));
    expect(at("} finally {")).toBeLessThan(at("setBusy(false);"));
  });
});

describe("the author's status line", () => {
  test("words every status in the formula's words, with EXPLORE_V2's numbers, and nothing for a reply or a quote", () => {
    const expected: Record<ExploreStatusKind, string | null> = {
      reply: null,
      quote: null,
      not_visible: "Not in Explore: posts under review or removed never appear there.",
      // 3e design, section 9.7, word for word.
      suspended:
        "Not in Explore: your account is suspended, and posts of suspended accounts do not appear there. A post still in its window when the suspension ends can appear from the next refresh.",
      hidden_by_author: "Not in Explore: you turned off Show my posts in Explore.",
      listed: "In Explore",
      outside_window: "Not in Explore: posts can appear only in their first 48 hours, not counting time in which korbat's moderation kept them from being shown.",
      no_ranking: "Not in Explore yet: the first ranking has not been computed.",
      new_since_ranking: "Not in Explore yet: it is newer than the current ranking, so the next refresh will consider it.",
      below_threshold:
        "Not in Explore: fewer than 3 approving accounts. Your own likes, accounts under 2 days old and likes from the last 10 minutes do not count.",
      pending: "Not in Explore yet: the next refresh will consider it.",
      author_cap: "Not in Explore: two of your posts rank above it.",
      below_cutoff: "Not in Explore: it ranks below the 300 posts Explore holds.",
    };
    for (const status of ExploreStatusKind.options) expect(exploreStatusText(status), status).toBe(expected[status]);
  });

  test("takes its numbers from the formula", () => {
    const other: ExploreFormula = { ...EXPLORE_V2, threshold: 5, engagerMinAgeHours: 72, standingMinutes: 15, windowHours: 24, perAuthor: 3, listLength: 100 };
    expect(exploreStatusText("below_threshold", other)).toBe(
      "Not in Explore: fewer than 5 approving accounts. Your own likes, accounts under 3 days old and likes from the last 15 minutes do not count.",
    );
    expect(exploreStatusText("author_cap", other)).toBe("Not in Explore: three of your posts rank above it.");
    expect(exploreStatusText("author_cap", { ...EXPLORE_V2, perAuthor: 1 })).toBe("Not in Explore: one of your posts ranks above it.");
    expect(exploreStatusText("below_cutoff", other)).toBe("Not in Explore: it ranks below the 100 posts Explore holds.");
    expect(exploreStatusText("outside_window", other)).toBe(
      "Not in Explore: posts can appear only in their first 24 hours, not counting time in which korbat's moderation kept them from being shown.",
    );
  });

  test("shows under the author's own top-level post only, never a reply's or a quote's, with links to How Explore works and to the switch", () => {
    const thread = read("app", "post", "[id].tsx");
    expect(thread).toContain("{mine && thread.post.replyTo === null && thread.post.quoteOf === null ? <ExploreStatusLine id={thread.post.id} /> : null}");
    expect(thread).toContain(".exploreStatus(id)");
    expect(thread).toContain("exploreStatusText(answer.status)");
    const line = block(thread, "ExploreStatusLine");
    expect(line).toContain('<Link href="/explore/about" asChild>');
    expect(line).toContain('<Link href="/settings/privacy" asChild>');
    expect(read("lib", "social.ts")).toContain("exploreStatus: (id: string) => api(`${postPath(id)}/explore`, { schema: ExploreStatus }),");
  });

  test("the line and the post are read again whenever the screen gains focus, so both follow a change of the switch made through the line's own link", () => {
    // The web keeps the post's screen mounted under Settings > Privacy, and Back shows that same screen again.
    const thread = read("app", "post", "[id].tsx");
    expect(thread).toContain('import { Link, router, useFocusEffect, useLocalSearchParams } from "expo-router";');
    // The line asks on every focus, as the sign-in screen's autofill starts on every focus, not once per post.
    const line = block(thread, "ExploreStatusLine");
    expect(line).toMatch(/useFocusEffect\(\s+useCallback\(\(\) => \{[\s\S]*?\.exploreStatus\(id\)[\s\S]*?\}, \[id\]\),\s+\);/);
    expect(line).not.toContain("useEffect(");
    // Another post's line never shows under this one while this one's is read.
    expect(line).toContain("const text = line?.id === id ? line.text : null;");
    // The screen reads its post again on every focus after the first, into the thread on screen and without clearing it,
    // so the card's In Explore chip follows; the first focus is the mount, whose read is the thread's own.
    const screen = block(thread, "Thread");
    const focus = screen.slice(screen.indexOf("useFocusEffect("), screen.indexOf("}, [id]),", screen.indexOf("useFocusEffect(")));
    const at = (code: string): number => {
      const index = focus.indexOf(code);
      expect(index, code).toBeGreaterThan(0);
      return index;
    };
    expect(at("if (focusedFor.current !== id) {")).toBeLessThan(at("focusedFor.current = id;"));
    expect(at("focusedFor.current = id;")).toBeLessThan(at(".getPost(id)"));
    expect(at(".getPost(id)")).toBeLessThan(at("setThread((current) => (current && current.post.id === post.id ? { ...current, post } : current));"));
    expect(focus).not.toContain("setThread(null)");
    expect(focus).not.toContain("setError(");
  });
});

describe("the In Explore chip", () => {
  test("shows on the author's own card while the post is in Explore, as a link to the post", () => {
    session.state = signedIn();
    const listed = html(<PostCard post={post(7, { inExplore: true })} />);
    expect(linkTexts(listed, `/post/${id(7)}`)).toContain("In Explore");
    expect(html(<PostCard post={post(7)} />)).not.toContain("In Explore");
    // Nobody else's view carries the flag, and a card never shows it on someone else's post.
    const bob = { id: OTHER, handle: "bob", displayName: "Bob", verified: false };
    expect(html(<PostCard post={post(8, { author: bob, inExplore: true })} />)).not.toContain("In Explore");
    session.state = { status: "signed-out" };
    expect(html(<PostCard post={post(7, { inExplore: true })} />)).not.toContain("In Explore");
  });
});

describe("Explore's rows", () => {
  // UI Task 3: Popular now left the context column (UI design, decision 14), and with it its own line for an image-only
  // post. The case it shared with hidden-media.test.tsx lives on where those posts are listed now: Explore's rows, whose
  // first posts are the ones Popular now listed.
  test("each row is a post card, which names an image-only post by its image's description and skips a hidden image", () => {
    // The row ExploreList draws for every item of a page.
    expect(read("components", "social", "ExploreList.tsx")).toContain("renderPost={(item, place) => <PostCard post={item.post} onDeleted={remove} {...place} />}");
    const image = { id: id(90), width: 800, height: 600, blurhash: "LEHV6nWB2yk8", alt: "A green square", small: "/media/x/small.webp", large: "/media/x/large.webp" };
    // An image-only post whose first image is hidden: the shown one names it.
    const out = html(<PostCard post={post(2, { body: "", media: [{ id: id(91), hidden: true }, image] })} />);
    expect(out).toContain('aria-label="Open image: A green square"');
    expect(out.match(/aria-label="Open image:/g)).toHaveLength(1);
    expect(out).not.toContain("undefined");
    // A post of hidden images alone offers no image to open: the placeholder says why in the image's place, and the card's
    // author line and time name the post, as they do every post, so no line of its own is needed.
    const hiddenOnly = html(<PostCard post={post(3, { body: "", media: [{ id: id(92), hidden: true }] })} />);
    expect(hiddenOnly).not.toContain('aria-label="Open image:');
  });
});

describe("the terms", () => {
  test("say that public posts can appear in Explore, where its rules are and how to keep one's posts out, without a new version", () => {
    const sentence =
      "Public posts can appear in Explore, ranked by how many other accounts like or repost them; How Explore works gives the rules, and Settings > Privacy keeps your posts out.";
    expect(TERMS_SECTIONS.filter((section) => section.body.includes(sentence))).toHaveLength(1);
    expect(TERMS_VERSION).toBe("draft-2026-09");
  });
});

describe("no screen caches or stores Explore's answers", () => {
  test("the files that ask for Explore keep its answers in component state only: no browser storage, no cache, no module-level variable", () => {
    const callers = sourceFiles().filter((file) => /social\s*\.(explore|popular|exploreStatus)\b/.test(file.text));
    expect(callers.map((file) => file.name).sort()).toEqual(["app/post/[id].tsx", "components/social/ExploreList.tsx", "components/social/WhoSeesThis.tsx"]);
    const explore = sourceFiles().filter((file) => [...callers.map((caller) => caller.name), "lib/explore.ts", "app/explore/about.tsx"].includes(file.name));
    expect(explore).toHaveLength(5);
    for (const file of explore) {
      expect(file.text, file.name).not.toMatch(/localStorage|sessionStorage|indexedDB|AsyncStorage|caches\./);
      expect(file.text, file.name).not.toMatch(/^(export )?(let|var) /m);
      expect(file.text, file.name).not.toMatch(/^(export )?const \w+ = new (Map|Set|WeakMap)\b/m);
    }
    // What the app keeps in the browser is the device id, the passkey card's Not now, the reader's appearance and reading places, nothing else.
    const stores = sourceFiles().filter((file) => /localStorage|sessionStorage|indexedDB|AsyncStorage/.test(file.text));
    expect(stores.map((file) => file.name).sort()).toEqual(["lib/api.ts", "lib/appearance.ts", "lib/passkeys.ts", "lib/reading-place.ts"]);
    // Explore's requests are the client's plain calls, which the API answers no-store.
    const social = read("lib", "social.ts");
    for (const line of social.split("\n").filter((text) => text.includes("/api/timeline/explore") || text.includes("/explore`"))) expect(line).not.toMatch(/cache/i);
  });
});
```

### Replace `apps/app/test/hidden-media.test.tsx` (whole file)

```tsx
import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { HiddenMedia, MediaView, PostView } from "@korbat/contracts";
// UI Task 3: PopularNow.tsx left the shell (UI design, decision 14); its case is on Explore's rows at the end.
import { HIDDEN_IMAGE, SEALED_IMAGE, hiddenImageWords } from "../src/components/social/HiddenImage";
import { MediaGrid } from "../src/components/social/MediaGrid";
import { MediaViewerContent } from "../src/components/social/MediaViewer";
import { PostCard } from "../src/components/social/PostCard";

/**
 * The placeholder of a hidden image in the web app (3c design, section 9). A post's media list holds, in an image's
 * place, a hidden image when the reader is not shown it: anyone but the author for an image moderation withheld or
 * removed, and everyone, the author included, for a sealed one. The components are server-rendered, as explore.test.tsx
 * renders its screens; what a static render cannot show (that pressing a placeholder opens nothing) is read from the
 * markup's roles and from the source.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");

// expo-router cannot load in Node: Link with `asChild` hands the child its href, and nothing navigates.
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  router: { push: () => undefined },
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: { status: "signed-out" }, refresh: async () => ({ status: "signed-out" }) }) }));
// expo-image reaches native modules; here an image is the address it would load and its description, so a test can see
// exactly which files a render asks for.
vi.mock("expo-image", async () => {
  const { createElement } = await import("react");
  return { Image: ({ source, accessibilityLabel }: { source: { uri: string }; accessibilityLabel: string }) => createElement("img", { "data-uri": source.uri, alt: accessibilityLabel }) };
});
// react-native-reanimated is mocked once for every test file in test/setup.ts.

const html = (element: ReactElement): string => renderToStaticMarkup(element);
/** The markup's text as a reader sees it: tags dropped, spaces collapsed. */
const textOf = (markup: string): string => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
/** The address of every image the markup would load. */
const loaded = (markup: string): string[] => [...markup.matchAll(/data-uri="([^"]+)"/g)].map((match) => match[1]!);
/** How often `part` occurs in `whole`. */
const count = (whole: string, part: string): number => whole.split(part).length - 1;
/** The accessible name of every button in the markup. */
const buttons = (markup: string): string[] => [...markup.matchAll(/<[a-z]+\b[^>]*\brole="button"[^>]*>/g)].map((match) => /aria-label="([^"]*)"/.exec(match[0])?.[1] ?? "");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const image = (n: number, alt = `picture ${n}`): MediaView => ({ id: id(n), width: 800, height: 600, blurhash: "LEHV6nWB2yk8", alt, small: `/api/media/${id(n)}/small.webp`, large: `/api/media/${id(n)}/large.webp` });
const hidden = (n: number): HiddenMedia => ({ id: id(n), hidden: true });
const sealed = (n: number): HiddenMedia => ({ id: id(n), hidden: true, sealed: true });

function post(n: number, extra: Partial<PostView> = {}): PostView {
  return {
    id: id(n),
    author: { id: id(900), handle: "ada", displayName: "Ada", verified: false },
    body: `post number ${n}`,
    createdAt: "2026-10-04T10:00:00.000Z",
    state: "visible",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
    ...extra,
  };
}

describe("the words", () => {
  test("a hidden image reads as the design gives it, and the reader's own sealed image says that nobody is shown it", () => {
    expect(HIDDEN_IMAGE).toBe("Image hidden by korbat moderation");
    expect(SEALED_IMAGE).toBe("Sealed: not shown to anyone, you included");
    expect(hiddenImageWords(hidden(1))).toBe(HIDDEN_IMAGE);
    expect(hiddenImageWords(sealed(1))).toBe(SEALED_IMAGE);
  });
});

describe("a post's images", () => {
  test("a hidden image is drawn as the placeholder in its place: nothing is loaded for it and nothing opens it, while the others are shown as before", () => {
    const out = html(<MediaGrid media={[image(1), hidden(2), image(3)]} />);
    expect(textOf(out)).toContain(HIDDEN_IMAGE);
    expect(loaded(out)).toEqual([expect.stringContaining(`/api/media/${id(1)}/small.webp`), expect.stringContaining(`/api/media/${id(3)}/small.webp`)]);
    expect(out).not.toContain(id(2));
    // Two images open the viewer; the placeholder is no button. The third control shows the descriptions.
    expect(buttons(out)).toEqual(["Open image: picture 1", "Open image: picture 3", "Show image descriptions"]);
  });

  test("the reader's own sealed image is drawn with the sealed words, and not with the others'", () => {
    const out = html(<MediaGrid media={[sealed(1), image(2)]} />);
    expect(textOf(out)).toContain(SEALED_IMAGE);
    expect(textOf(out)).not.toContain(HIDDEN_IMAGE);
    expect(loaded(out)).toHaveLength(1);
    expect(buttons(out)).toEqual(["Open image: picture 2", "Show image descriptions"]);
  });

  test("a post whose every image is hidden shows the placeholders alone: no image, no viewer, no description control", () => {
    for (const media of [[hidden(1)], [sealed(1), sealed(2)], [hidden(1), hidden(2), hidden(3), hidden(4)]]) {
      const out = html(<MediaGrid media={media} />);
      expect(loaded(out)).toEqual([]);
      expect(buttons(out)).toEqual([]);
      expect(textOf(out).split(media[0]!.sealed ? SEALED_IMAGE : HIDDEN_IMAGE).length - 1).toBe(media.length);
    }
    expect(html(<MediaGrid media={[]} />)).toBe("");
  });

  test("a quoted post's row of small squares keeps a square in a hidden image's place and says the sentence once, as text, under the row", () => {
    const out = html(<MediaGrid compact media={[image(1), hidden(2), hidden(3)]} />);
    const text = textOf(out);
    expect(loaded(out)).toHaveLength(1);
    expect(out).not.toContain(id(2));
    expect(buttons(out)).toEqual([]);
    // Each square keeps its short word; the sentence is text, said once however many images are hidden, and it is not
    // repeated anywhere in the markup as a name of each square.
    expect(count(text, "Hidden")).toBe(2);
    expect(count(text, HIDDEN_IMAGE)).toBe(1);
    expect(count(out, HIDDEN_IMAGE)).toBe(1);
    expect(text).not.toContain(SEALED_IMAGE);
    // It comes after the squares: under the row.
    expect(text.indexOf(HIDDEN_IMAGE)).toBeGreaterThan(text.lastIndexOf("Hidden"));
  });

  test("the author of a sealed image in a quoted post reads the sealed sentence there, once, and not the other one", () => {
    const out = html(<MediaGrid compact media={[sealed(1), image(2), sealed(3)]} />);
    const text = textOf(out);
    expect(count(text, SEALED_IMAGE)).toBe(1);
    expect(count(out, SEALED_IMAGE)).toBe(1);
    expect(text).not.toContain(HIDDEN_IMAGE);
    expect(count(text, "Hidden")).toBe(2);
    expect(loaded(out)).toHaveLength(1);
  });

  test("a quoted post's row with no hidden image says neither sentence", () => {
    const text = textOf(html(<MediaGrid compact media={[image(1), image(2)]} />));
    for (const words of [HIDDEN_IMAGE, SEALED_IMAGE, "Hidden"]) expect(text).not.toContain(words);
  });

  test("a card renders a post that holds hidden images, on the post and in the post it quotes", () => {
    const quoted = { ...post(2, { media: [hidden(21), image(22)] }), quoteOf: null };
    const out = html(<PostCard post={post(1, { media: [image(11), sealed(12)], quoteOf: quoted })} />);
    const text = textOf(out);
    // The post's own sealed image says so in its place in the frame.
    expect(count(text, SEALED_IMAGE)).toBe(1);
    // The quoted post's hidden image: the sentence once, as text, inside the quote, which comes after the quoted post's
    // own words and before the card's actions.
    expect(count(out, HIDDEN_IMAGE)).toBe(1);
    expect(text.indexOf(HIDDEN_IMAGE)).toBeGreaterThan(text.indexOf("post number 2"));
    expect(out.indexOf(HIDDEN_IMAGE)).toBeLessThan(out.indexOf('aria-label="Reply'));
    expect(loaded(out)).toHaveLength(2);
  });
});

describe("the viewer", () => {
  const media = [image(1), hidden(2), sealed(3)];
  const noop = () => undefined;

  test("shows an image in its large size with its description and its place among the post's images", () => {
    const out = html(<MediaViewerContent media={media} index={0} onIndex={noop} onClose={noop} />);
    expect(loaded(out)).toEqual([expect.stringContaining(`/api/media/${id(1)}/large.webp`)]);
    expect(textOf(out)).toContain("1 of 3");
    expect(textOf(out)).toContain("picture 1");
  });

  test("never opens a hidden image: stepped onto, it shows the placeholder's words in the image's place and loads nothing", () => {
    const second = html(<MediaViewerContent media={media} index={1} onIndex={noop} onClose={noop} />);
    expect(loaded(second)).toEqual([]);
    expect(textOf(second)).toContain("2 of 3");
    expect(textOf(second)).toContain(HIDDEN_IMAGE);
    const third = html(<MediaViewerContent media={media} index={2} onIndex={noop} onClose={noop} />);
    expect(loaded(third)).toEqual([]);
    expect(textOf(third)).toContain(SEALED_IMAGE);
    // The viewer's own controls stay.
    expect(buttons(third)).toEqual(["Close the image viewer", "Previous image", "Next image"]);
  });

  test("is opened only from an image's own cell: the placeholder has no press handler", () => {
    const grid = readFileSync(path.join(SRC, "components", "social", "MediaGrid.tsx"), "utf8");
    const placeholder = readFileSync(path.join(SRC, "components", "social", "HiddenImage.tsx"), "utf8");
    expect(grid).toMatch(/isHiddenMedia\(item\) \? <HiddenImage/);
    expect(placeholder).not.toMatch(/onPress|Pressable|accessibilityRole="button"/);
  });
});

describe("Explore's rows", () => {
  // UI Task 3: Popular now left the context column (UI design, decision 14). Its case moves to the row Explore lists
  // these posts with, ExploreList's PostCard: an image-only post is named by the images the reader is shown.
  test("an image-only post is named by the first image the reader is shown; hidden images are skipped, and a post of hidden images alone has no image line", () => {
    const explore = readFileSync(path.join(SRC, "components", "social", "ExploreList.tsx"), "utf8");
    expect(explore).toContain("renderPost={(item, place) => <PostCard post={item.post} onDeleted={remove} {...place} />}");
    const names = (markup: string) => buttons(markup).filter((name) => name.startsWith("Open image: "));
    const first = html(<PostCard post={post(1, { body: "", media: [hidden(11), image(12, "A green square")] })} />);
    expect(names(first)).toEqual(["Open image: A green square"]);
    expect(loaded(first)).toEqual([expect.stringContaining(`/api/media/${id(12)}/small.webp`)]);
    const none = html(<PostCard post={post(2, { body: "", media: [sealed(21), hidden(22)] })} />);
    expect(names(none)).toEqual([]);
    expect(loaded(none)).toEqual([]);
    const third = html(<PostCard post={post(3, { body: "", media: [image(31, "A red circle"), hidden(32)] })} />);
    expect(names(third)).toEqual(["Open image: A red circle"]);
    for (const out of [first, none, third]) expect(out).not.toContain("undefined");
  });
});
```

### Replace `apps/app/test/kit.test.tsx` (whole file)

```tsx
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { PostModeration } from "@korbat/contracts";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ICONS } from "../src/components/icons";
import { Avatar, monogram } from "../src/components/kit/Avatar";
import { EmptyState } from "../src/components/kit/EmptyState";
import { ErrorState, isOffline, retryWhenOnline } from "../src/components/kit/ErrorState";
import { IconButton } from "../src/components/kit/IconButton";
import { ListRow, RadioGroup } from "../src/components/kit/ListRow";
import { PublicFrame } from "../src/components/kit/PublicFrame";
import { Skeleton } from "../src/components/kit/Skeleton";
import { STATUS_ICON, STATUS_TONES, StatusChip } from "../src/components/kit/StatusChip";
import { VisuallyHidden } from "../src/components/kit/VisuallyHidden";
import { Body, Button, ErrorText, Field, Loading, Notice, Screen, Section, TextButton, TextLink, Title, VerifiedChip } from "../src/components/ui";
import { ApiError } from "../src/lib/api";
import { DEFAULT_APPEARANCE, setAppearance } from "../src/lib/appearance";
import { chipText } from "../src/lib/moderation";
import { UI_WORDS } from "../src/lib/ui-words";

/**
 * The kit of owned components (UI design, sections 6.1 to 6.5, 6.11 to 6.13 and 6.16, Task 2) and ui.tsx rebuilt on
 * it, rendered through react-dom/server and react-native-web and read as HTML: roles, names and states, which is what
 * assistive technology gets. Classes do not reach this markup (NativeWind turns them into styles only in the app's own
 * build), so the look is checked in the browser check from Task 3; what is checked here is what a screen reader hears.
 */

// expo-router cannot load in Node; Link with asChild hands its child the href, which react-native-web draws as an anchor.
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
}));

const SRC = path.resolve(import.meta.dirname, "..", "src");
const html = (element: ReactElement): string => renderToStaticMarkup(element);
const noop = () => undefined;
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
/** The text of every button, read up to the first closing div as appeals.test.tsx, automated.test.tsx and cases.test.tsx read it. */
const buttons = (markup: string): string[] => [...markup.matchAll(/<(?:div|button)\b[^>]*\brole="button"[^>]*>(.*?)<\/(?:div|button)>/g)].map((match) => textOf(match[1]!));
const hrefs = (markup: string): string[] => [...markup.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((match) => match[1]!);
/** The first opening tag that carries `attribute`. */
const tagWith = (markup: string, attribute: string): string => (markup.match(/<[a-z]+\b[^>]*>/g) ?? []).find((tag) => tag.includes(attribute)) ?? "";
/** Lucide's class for an icon's export name, as lucide-react writes it on the svg: BadgeCheck is lucide-badge-check. */
const lucideClass = (exportName: string): string => `lucide-${exportName.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;

afterEach(() => setAppearance(DEFAULT_APPEARANCE));

describe("IconButton (6.3)", () => {
  test("is a button named by its label, with its icon hidden", () => {
    const out = html(<IconButton icon="more" label="More options for this post" onPress={noop} />);
    const tag = tagWith(out, 'role="button"');
    expect(tag).toContain('aria-label="More options for this post"');
    expect(out).toContain(lucideClass(ICONS.more));
    expect(/<svg[^>]*>/.exec(out)?.[0]).toContain('aria-hidden="true"');
    // The 500 ms tooltip repeats the name for pointers only, and only while hovered: a static render shows none.
    expect(out.split("More options for this post").length - 1).toBe(1);
  });

  test("says whether a toggle is pressed, and whether its request is still out", () => {
    expect(tagWith(html(<IconButton icon="like" label="Like" pressed onPress={noop} />), 'role="button"')).toContain('aria-pressed="true"');
    expect(tagWith(html(<IconButton icon="like" label="Like" pressed={false} onPress={noop} />), 'role="button"')).toContain('aria-pressed="false"');
    expect(tagWith(html(<IconButton icon="like" label="Like" onPress={noop} />), 'role="button"')).not.toContain("aria-pressed");
    expect(tagWith(html(<IconButton icon="like" label="Like" busy onPress={noop} />), 'role="button"')).toContain('aria-busy="true"');
  });

  test("a trigger says what it opens and whether it is open", () => {
    const closed = tagWith(html(<IconButton icon="more" label="More" hasPopup="menu" onPress={noop} />), 'role="button"');
    expect(closed).toContain('aria-haspopup="menu"');
    expect(closed).toContain('aria-expanded="false"');
    const open = tagWith(html(<IconButton icon="more" label="More" hasPopup="dialog" expanded onPress={noop} />), 'role="button"');
    expect(open).toContain('aria-haspopup="dialog"');
    expect(open).toContain('aria-expanded="true"');
  });

  test("the count is shown compact and kept out of the name, which already says it", () => {
    const out = html(<IconButton icon="like" label="Like, 1234 likes" count={1234} onPress={noop} />);
    expect(tagWith(out, 'role="button"')).toContain('aria-label="Like, 1234 likes"');
    expect(out).toMatch(/aria-hidden="true"[^>]*>1\.2K</);
    expect(textOf(out)).toBe("1.2K");
    // The caller leaves the count out when it is zero or the reader hides counts (decision 15); then nothing shows.
    expect(textOf(html(<IconButton icon="like" label="Like" onPress={noop} />))).toBe("");
    expect(textOf(html(<IconButton icon="like" label="Like" count={0} onPress={noop} />))).toBe("");
  });
});

describe("Avatar (6.5)", () => {
  test("is a monogram of the display name's first grapheme, hidden from assistive technology", () => {
    const out = html(<Avatar account={{ id: "a", displayName: "ada lovelace" }} />);
    expect(/^<div[^>]*>/.exec(out)?.[0]).toContain('aria-hidden="true"');
    expect(textOf(out)).toBe("A");
  });

  test("keeps a letter and its combining mark together, and an empty name draws an empty disc", () => {
    const accented = `e${String.fromCharCode(0x301)}lise`;
    expect(monogram(accented)).toBe(`E${String.fromCharCode(0x301)}`);
    expect(monogram("  bea")).toBe("B");
    expect(monogram("")).toBe("");
  });

  test("draws the size it is given", () => {
    expect(html(<Avatar account={{ id: "a", displayName: "Ada" }} size={96} />)).toContain("width:96px;height:96px");
    expect(html(<Avatar account={{ id: "a", displayName: "Ada" }} />)).toContain("width:40px;height:40px");
  });
});

describe("ListRow (6.11)", () => {
  test("as a link it is an anchor with its label and description", () => {
    const out = html(<ListRow label="Appearance" description="Theme, text size and motion" href="/settings/appearance" />);
    expect(hrefs(out)).toEqual(["/settings/appearance"]);
    expect(textOf(out)).toBe("Appearance Theme, text size and motion");
    expect(out).toContain(lucideClass(ICONS.next));
  });

  test("as a button it is a button, with its value after the label", () => {
    const out = html(<ListRow label="Theme" value="Dark" onPress={noop} />);
    expect(buttons(out)).toEqual(["Theme"]);
    expect(textOf(out)).toBe("Theme Dark");
  });

  test("with a switch, the switch names itself by the row's label and says whether it is on", () => {
    const out = html(<ListRow label="Haptics" control={{ kind: "switch", value: true, onValueChange: noop }} />);
    const input = /<input[^>]*>/.exec(out)?.[0] ?? "";
    expect(input).toContain('role="switch"');
    expect(input).toContain('aria-label="Haptics"');
    expect(input).toContain('checked=""');
    // The row toggles it for a pointer, but is no second tab stop and no second control.
    expect(out).not.toContain('role="button"');
    expect(out.match(/tabindex="0"/g) ?? []).toEqual([]);
  });

  test("in a radio group each row is a radio that says whether it is chosen", () => {
    const out = html(
      <RadioGroup labelledBy="theme-heading">
        <ListRow label="Light" control={{ kind: "radio", checked: false, onSelect: noop }} />
        <ListRow label="Dark" control={{ kind: "radio", checked: true, onSelect: noop }} />
      </RadioGroup>,
    );
    expect(tagWith(out, 'role="radiogroup"')).toContain('aria-labelledby="theme-heading"');
    const radios = out.match(/<[a-z]+\b[^>]*role="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(2);
    expect(radios[0]).toContain('aria-checked="false"');
    expect(radios[1]).toContain('aria-checked="true"');
    expect(textOf(out)).toBe("Light Dark");
  });

  test("a switch row names its Switch on the <Switch line, which a11y.test.tsx's scan reads one line at a time", () => {
    const source = readFileSync(path.join(SRC, "components", "kit", "ListRow.tsx"), "utf8");
    expect(source).toMatch(/<Switch accessibilityLabel=\{label\}/);
  });
});

describe("Skeleton (6.12)", () => {
  test("every part is hidden from assistive technology", () => {
    for (const part of [<Skeleton.Text width={120} />, <Skeleton.Circle size={40} />, <Skeleton.Block height={120} />, <Skeleton.Post />, <Skeleton.Row />]) {
      expect(/^<div[^>]*>/.exec(html(part))?.[0]).toContain('aria-hidden="true"');
      expect(textOf(html(part))).toBe("");
    }
  });

  test("a post row carries a media block on every third row", () => {
    const blocks = (index: number) => (html(<Skeleton.Post index={index} />).match(/<div/g) ?? []).length;
    expect(blocks(2)).toBeGreaterThan(blocks(0));
    expect(blocks(5)).toBe(blocks(2));
    expect(blocks(1)).toBe(blocks(0));
  });

  test("a list of them carries one polite status with its words", () => {
    const posts = html(<Skeleton.List kind="posts" count={3} />);
    expect(tagWith(posts, 'role="status"')).toContain('aria-live="polite"');
    expect(textOf(posts)).toBe(UI_WORDS["feed.loading"]);
    expect(posts.match(/role="status"/g)).toHaveLength(1);
    expect(textOf(html(<Skeleton.List kind="accounts" />))).toBe(UI_WORDS["accounts.loading"]);
  });

  test("pulses, and stands still at 0.8 under reduced motion", () => {
    expect(html(<Skeleton.Row />)).toContain("opacity:1");
    setAppearance({ reduceMotion: "always" });
    expect(html(<Skeleton.Row />)).toContain("opacity:0.8");
  });
});

describe("EmptyState and ErrorState (6.12)", () => {
  test("an empty state has its title as a heading, its body, and one action", () => {
    const out = html(<EmptyState icon="bookmarks" title="No saved posts" body="Nothing saved yet. Use Save on a post to keep it here." action={{ label: "Go to Home", href: "/" }} />);
    expect(out).toMatch(/<h2[^>]*>No saved posts<\/h2>/);
    expect(textOf(out)).toContain("Nothing saved yet. Use Save on a post to keep it here.");
    expect(hrefs(out)).toEqual(["/"]);
    const pressed = html(<EmptyState title="Nothing posted yet" action={{ label: "Refresh", onPress: noop }} />);
    expect(buttons(pressed)).toEqual(["Refresh"]);
    expect(hrefs(pressed)).toEqual([]);
  });

  test("an error state says what went wrong as an alert, with Try again", () => {
    const out = html(<ErrorState message="Something went wrong. Try again." onRetry={noop} />);
    expect(out).toMatch(/role="alert"/);
    expect(textOf(/<[a-z]+\b[^>]*role="alert"[^>]*>.*$/.exec(out)?.[0] ?? "")).toContain("Something went wrong. Try again.");
    expect(buttons(out)).toEqual([UI_WORDS["error.retry"]]);
    expect(out).not.toContain(UI_WORDS["offline.title"].replace("'", "&#x27;"));
  });

  test("offline, it says so in its own words, with the same Try again", () => {
    const out = html(<ErrorState message="Check your connection and try again." offline onRetry={noop} />);
    const read = textOf(out);
    expect(read).toContain(UI_WORDS["offline.title"]);
    expect(read).toContain(UI_WORDS["offline.body"]);
    expect(out).toContain(lucideClass(ICONS.offline));
    expect(buttons(out)).toEqual([UI_WORDS["error.retry"]]);
  });

  test("offline is a request that got no answer, or a browser that says it is offline", () => {
    expect(isOffline(new ApiError(0, "network", "Check your connection and try again."))).toBe(true);
    expect(isOffline(new ApiError(500, "internal", "Something went wrong."))).toBe(false);
    expect(isOffline(new Error("boom"))).toBe(false);
    vi.stubGlobal("navigator", { onLine: false });
    try {
      expect(isOffline(new ApiError(500, "internal", "Something went wrong."))).toBe(true);
      expect(isOffline()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("retries once by itself when the browser is online again, and does nothing where there is no such event", () => {
    const target = new EventTarget();
    const retry = vi.fn();
    const stop = retryWhenOnline(retry, target);
    target.dispatchEvent(new Event("online"));
    target.dispatchEvent(new Event("online"));
    expect(retry).toHaveBeenCalledTimes(1);
    stop();
    const later = vi.fn();
    retryWhenOnline(later, target)();
    target.dispatchEvent(new Event("online"));
    expect(later).not.toHaveBeenCalled();
    expect(() => retryWhenOnline(noop, {})()).not.toThrow();
  });
});

describe("StatusChip (6.13) and never colour alone (4.8)", () => {
  test("the four tones draw four different icons", () => {
    expect([...STATUS_TONES]).toEqual(["review", "restricted", "verified", "explore"]);
    const names = STATUS_TONES.map((tone) => STATUS_ICON[tone]);
    expect(new Set(names).size).toBe(4);
    expect(new Set(names.map((name) => ICONS[name])).size).toBe(4);
  });

  test("every chip draws its icon and a label that is not empty", () => {
    for (const tone of STATUS_TONES) {
      const out = html(<StatusChip tone={tone} label="Under review: R4" />);
      expect(out, tone).toContain(lucideClass(ICONS[STATUS_ICON[tone]]));
      expect(textOf(out), tone).toBe("Under review: R4");
    }
  });

  test("information only: an image named by its label, or by a name of its own", () => {
    const out = html(<StatusChip tone="verified" label="Verified" name="verified account" />);
    const tag = tagWith(out, 'role="img"');
    expect(tag).toContain('aria-label="verified account"');
    expect(textOf(out)).toBe("Verified");
    expect(tagWith(html(<StatusChip tone="explore" label="In Explore" />), 'role="img"')).toContain('aria-label="In Explore"');
  });

  test("a link: an anchor whose name is its words", () => {
    const out = html(<StatusChip tone="explore" label="In Explore" href="/post/p1" />);
    expect(hrefs(out)).toEqual(["/post/p1"]);
    expect(out).not.toContain('role="img"');
    expect(textOf(out)).toBe("In Explore");
  });

  test("a button that opens a sheet: named by chipText(), it says it opens a dialog and ends in a chevron", () => {
    const decision: PostModeration = { decisionId: "00000000-0000-4000-8000-000000000001", ruleId: "R3", legal: false, interim: false, strikeUntil: "2026-12-04T10:00:00.000Z" };
    const words = chipText(decision);
    const out = html(<StatusChip tone="restricted" label={words} onPress={noop} />);
    expect(tagWith(out, 'role="button"')).toContain('aria-haspopup="dialog"');
    expect(buttons(out)).toEqual([words]);
    expect(out).toContain(lucideClass(ICONS.next));
    expect(out).not.toContain('role="img"');
  });

  test("chipText() is never empty, over interim, removed, legal, strike and order shapes", () => {
    const base: PostModeration = { decisionId: "00000000-0000-4000-8000-000000000001", ruleId: null, legal: false, interim: false, strikeUntil: null };
    const shapes: PostModeration[] = [
      { ...base, interim: true, ruleId: "R4" },
      { ...base, ruleId: "R3" },
      base,
      { ...base, legal: true },
      { ...base, interim: true, legal: true },
      { ...base, ruleId: "R2", strikeUntil: "2026-12-04T10:00:00.000Z" },
      { ...base, order: true },
    ];
    for (const shape of shapes) {
      const words = chipText(shape);
      expect(words.trim().length, JSON.stringify(shape)).toBeGreaterThan(0);
      expect(textOf(html(<StatusChip tone={shape.interim ? "review" : "restricted"} label={words} onPress={noop} />))).toBe(words);
    }
  });

  test("a chip keeps its shape in forced colours and never truncates its words", () => {
    const source = readFileSync(path.join(SRC, "components", "kit", "StatusChip.tsx"), "utf8");
    expect(source).toContain("forced-colors:border-[color:CanvasText]");
    expect(source).not.toMatch(/numberOfLines|truncate|ellipsizeMode/);
  });
});

describe("VisuallyHidden (6.16)", () => {
  test("keeps its text for assistive technology in a 1 px clipped box off the layout", () => {
    const out = html(<VisuallyHidden nativeID="count">12 of 1000 characters</VisuallyHidden>);
    expect(textOf(out)).toBe("12 of 1000 characters");
    expect(out).toContain('id="count"');
    expect(out).toContain("position:absolute;width:1px;height:1px;overflow-x:hidden;overflow-y:hidden");
  });

  test("can be a polite status", () => {
    expect(tagWith(html(<VisuallyHidden role="status">Loading posts</VisuallyHidden>), 'role="status"')).toContain('aria-live="polite"');
  });
});

describe("PublicFrame (7.3)", () => {
  test("the wordmark leads home, the content is the main landmark, and the footer links the public pages", () => {
    const out = html(
      <PublicFrame>
        <Title>Sign in</Title>
      </PublicFrame>,
    );
    expect(hrefs(out)).toEqual(["/", "/rules", "/transparency", "/terms"]);
    expect(out).toMatch(/<a\b[^>]*href="\/"[^>]*>.*?korbat/);
    expect(out).toMatch(/<main\b[^>]*>.*<h1/);
    expect(out).toContain("<footer");
    expect(textOf(/<footer.*<\/footer>/.exec(out)?.[0] ?? "")).toBe(`${UI_WORDS["frame.rules"]} ${UI_WORDS["frame.transparency"]} ${UI_WORDS["frame.terms"]}`);
    expect(out).toContain("max-width:440px");
    expect(html(<PublicFrame wide>{null}</PublicFrame>)).toContain("max-width:640px");
  });
});

describe("ui.tsx on the kit (6.1, 6.4)", () => {
  test("a busy button says Please wait, is busy and disabled, and its label comes before any closing div", () => {
    const out = html(<Button label="Send code" busy onPress={noop} />);
    const tag = tagWith(out, 'role="button"');
    expect(tag).toContain('aria-busy="true"');
    expect(tag).toContain('aria-disabled="true"');
    expect(buttons(out)).toEqual([`Please wait${String.fromCharCode(0x2026)}`]);
  });

  test("a disabled button keeps its label, which may carry its reason", () => {
    const out = html(<Button label="Describe every image" disabled onPress={noop} />);
    expect(tagWith(out, 'role="button"')).toContain('aria-disabled="true"');
    expect(buttons(out)).toEqual(["Describe every image"]);
  });

  test("every tone, size and icon keeps the label first in the button's text", () => {
    for (const tone of ["primary", "secondary", "danger"] as const) {
      expect(buttons(html(<Button label="Add image" tone={tone} icon="add-image" size="lg" full={false} onPress={noop} />)), tone).toEqual(["Add image"]);
    }
    expect(html(<Button label="Add image" icon="add-image" onPress={noop} />)).toContain(lucideClass(ICONS["add-image"]));
  });

  test("the verified chip: one image named verified account, showing Verified and its icon", () => {
    const out = html(<VerifiedChip />);
    expect(out.match(/<div[^>]*aria-label="verified account"[^>]*>/g)).toHaveLength(1);
    expect(tagWith(out, 'aria-label="verified account"')).toContain('role="img"');
    expect(textOf(out)).toBe("Verified");
    expect(out).toContain(lucideClass(ICONS.verified));
  });

  test("Title is the level-1 heading, Section's title a level-2 heading", () => {
    expect(html(<Title>Security</Title>)).toMatch(/^<h1\b[^>]*>Security<\/h1>$/);
    expect(html(<Section title="Password">{null}</Section>)).toMatch(/<h2\b[^>]*aria-level="2"[^>]*>Password<\/h2>/);
  });

  test("TextLink is an anchor, TextButton a button, both named by their words", () => {
    const link = html(<TextLink label="Read the terms" href="/terms" />);
    expect(hrefs(link)).toEqual(["/terms"]);
    expect(textOf(link)).toBe("Read the terms");
    expect(buttons(html(<TextButton label="Use a recovery code" onPress={noop} />))).toEqual(["Use a recovery code"]);
  });

  test("the rest keep their contracts: a labelled field, an alert for errors, a notice, the screen and the spinner", () => {
    const field = html(<Field label="Email" />);
    expect(textOf(field)).toBe("Email");
    expect(/<input[^>]*>/.exec(field)?.[0]).toContain('aria-label="Email"');
    expect(html(<ErrorText message={null} />)).toBe("");
    const error = html(<ErrorText message="That code is not valid." />);
    expect(tagWith(error, 'role="alert"')).not.toBe("");
    expect(textOf(error)).toBe("That code is not valid.");
    expect(error).toContain(lucideClass(ICONS.error));
    expect(html(<Notice message={null} />)).toBe("");
    expect(textOf(html(<Notice message="Saved." />))).toBe("Saved.");
    expect(textOf(html(<Screen><Body>Hello</Body></Screen>))).toBe("Hello");
    const spinner = tagWith(html(<Loading />), 'role="progressbar"');
    expect(spinner).toContain(`aria-label="${UI_WORDS["spinner.label"]}"`);
  });

  test("the spinner turns, and under reduced motion pulses instead of turning", () => {
    const turning = html(<Loading />);
    expect(turning).toContain('style="transform:rotate(0deg)"');
    expect(turning).not.toContain("opacity:");
    setAppearance({ reduceMotion: "always" });
    const pulsing = html(<Loading />);
    expect(pulsing).not.toContain("rotate(");
    expect(pulsing).toContain('style="opacity:1"');
  });
});

describe("controls must be named (section 10)", () => {
  test("tsc refuses a Button, IconButton or ListRow without a label", () => {
    const nameless = [
      // @ts-expect-error label is required: it is the control's accessible name.
      <Button onPress={noop} />,
      // @ts-expect-error label is required: it is the icon-only control's only name.
      <IconButton icon="like" onPress={noop} />,
      // @ts-expect-error label is required: it is the row's title and its name.
      <ListRow onPress={noop} />,
    ];
    expect(nameless).toHaveLength(3);
  });
});

describe("only the icons korbat draws are bundled (4.7)", () => {
  test("each Icon file takes its icons one module at a time, never values from the package's main entry, which re-exports the whole set", () => {
    for (const [file, deep] of [
      ["Icon.web.tsx", /^import [A-Z]\w* from "lucide-react\/dist\/esm\/icons\/[a-z0-9-]+\.mjs";$/],
      ["Icon.tsx", /^import [A-Z]\w* from "lucide-react-native\/icons\/[a-z0-9-]+";$/],
    ] as const) {
      const imports = readFileSync(path.join(SRC, "components", "kit", file), "utf8")
        .split(String.fromCharCode(10))
        .filter((line) => line.includes('from "lucide-react'));
      expect(imports.filter((line) => !line.startsWith("import type ") && !deep.test(line)), file).toEqual([]);
      expect(imports.filter((line) => deep.test(line)).length, file).toBe(new Set(Object.values(ICONS)).size);
    }
  });
});

describe("hover is for fine pointers only (5.2)", () => {
  test("tailwind.config.js gives hover styles only where the pointer can hover", () => {
    const config = createRequire(path.resolve(import.meta.dirname, "..", "package.json"))("./tailwind.config.js") as { future?: Record<string, boolean> };
    expect(config.future).toEqual({ hoverOnlyWhenSupported: true });
  });
});

describe("test/setup.ts", () => {
  /** Every name src imports from `module`, "default" for a default import; type-only imports are left out. */
  function importedNames(module: string): string[] {
    const names = new Set<string>();
    const pattern = /import\s+(?!type\b)(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*"([^"]+)"/g;
    for (const file of readdirSync(SRC, { recursive: true, encoding: "utf8" })) {
      if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
      for (const match of readFileSync(path.join(SRC, file), "utf8").matchAll(pattern)) {
        if (match[3] !== module) continue;
        if (match[1]) names.add("default");
        for (const part of (match[2] ?? "").split(",")) {
          const name = part.trim();
          if (name === "" || name.startsWith("type ")) continue;
          names.add(name.split(/\s+as\s+/)[0]!.trim());
        }
      }
    }
    return [...names].sort();
  }

  test("each native module's mock gives every name src imports from it", async () => {
    for (const module of ["react-native-reanimated", "react-native-gesture-handler", "react-native-safe-area-context", "expo-haptics", "expo-router/head", "lucide-react-native"]) {
      const mocked = Object.keys(await import(/* @vite-ignore */ module));
      expect(importedNames(module).filter((name) => !mocked.includes(name)), module).toEqual([]);
    }
    expect(importedNames("react-native-reanimated")).toContain("useReducedMotion");
    expect(importedNames("expo-haptics").length).toBeGreaterThan(0);
  });
});

// UI Task 4 appends below, so the lines above keep the numbers other tasks cite.
import { Text as KitText } from "../src/components/kit/Text";
import { Menu, MenuPanel, menuIndex, placeMenu, type MenuItem } from "../src/components/kit/Menu";
import { SheetFrame } from "../src/components/kit/Sheet";

/** The source of a kit file, for what a static render cannot show (a press, a key, a Modal's props). */
const kitSource = (file: string): string => readFileSync(path.join(SRC, "components", "kit", file), "utf8");

describe("Sheet (6.8)", () => {
  const frame = (layout: "phone" | "wide") =>
    html(
      <SheetFrame titleId="sheet-title" title="Who sees this" description="Who can read this post" layout={layout} onClose={noop}>
        <KitText>What the sheet holds</KitText>
      </SheetFrame>,
    );

  test("drawn open, its title is the heading the dialog is named by, with the description and the content under it", () => {
    const out = frame("phone");
    expect(out).toMatch(/<h2 [^>]*id="sheet-title"/);
    expect(textOf(out)).toBe("Who sees this Who can read this post What the sheet holds");
    // react-native-web's Modal is the dialog (role="dialog", aria-modal) and renders nothing on a server: the Sheet hands
    // it the title's id, and the frame is what it holds.
    const sheet = kitSource("Sheet.tsx");
    expect(sheet).toMatch(/<Modal visible=\{shown\} transparent animationType="none" onRequestClose=\{[^}]+\} onDismiss=\{[^}]+\} aria-labelledby=\{titleId\}>/);
    expect(sheet).toContain("titleId={titleId}");
  });

  test("the scrim closes the sheet but is no tab stop and hidden from assistive technology, and comes after the panel", () => {
    const out = frame("phone");
    const scrim = tagWith(out, "data-scrim");
    expect(scrim).toContain('aria-hidden="true"');
    expect(scrim).not.toContain("tabindex");
    expect(scrim).not.toContain('role="button"');
    // react-native-web's focus trap gives the focus to the first focusable element it meets: the panel's, never the scrim.
    expect(out.indexOf("data-scrim")).toBeGreaterThan(out.indexOf('id="sheet-title"'));
  });

  test("below 768 px a bottom sheet with a grab handle; wider a centred dialog without one", () => {
    expect(frame("phone")).toContain("data-handle");
    expect(frame("wide")).not.toContain("data-handle");
    expect(tagWith(frame("phone"), "data-handle")).toContain('aria-hidden="true"');
  });

  test("Escape, the scrim and a release past the threshold close it; focus goes in on opening and back to the opener", () => {
    const sheet = kitSource("Sheet.tsx");
    // Escape reaches the Modal's onRequestClose; the scrim's press and the drag's release call the same close.
    expect(sheet).toContain("onRequestClose={dismiss}");
    expect(sheet).toContain('haptic("threshold")');
    expect(sheet).toContain("focusTitle");
  });
});

describe("Menu (6.9)", () => {
  const items: MenuItem[] = [
    { label: "Who sees this", icon: "who-sees", description: "Public", onSelect: noop },
    { label: "Delete", icon: "delete", tone: "danger", onSelect: noop },
    { label: "Report", icon: "report", href: "/report?post=1" },
  ];

  test("the trigger is a disclosure: an icon button named by its label that says it opens a menu, and whether it is open", () => {
    const out = html(<Menu label="More options for this post" icon="more" items={items} />);
    const tag = tagWith(out, 'role="button"');
    expect(tag).toContain('aria-label="More options for this post"');
    expect(tag).toContain('aria-haspopup="menu"');
    expect(tag).toContain('aria-expanded="false"');
  });

  test("open on a phone it is a sheet titled by the trigger's label; its items are buttons and real links", () => {
    const out = html(<MenuPanel label="More options for this post" items={items} layout="phone" onPick={noop} />);
    expect(/<h2[^>]*>(.*?)<\/h2>/.exec(out)?.[1]).toBe("More options for this post");
    expect(buttons(out)).toEqual(["Who sees this", "Delete"]);
    // Who sees this carries its one line under its label.
    expect(textOf(out)).toContain("Who sees this Public");
    expect(hrefs(out)).toEqual(["/report?post=1"]);
    expect(textOf(out)).toContain("Report");
  });

  test("open wider it is a popover of the same items, named by the trigger's label", () => {
    const out = html(<MenuPanel label="More options for this post" items={items} layout="wide" onPick={noop} />);
    expect(out).not.toContain("<h2");
    expect(tagWith(out, "data-menu")).toContain('aria-label="More options for this post"');
    expect(buttons(out)).toEqual(["Who sees this", "Delete"]);
    expect(hrefs(out)).toEqual(["/report?post=1"]);
  });

  test("arrow keys move between the items and wrap; Home and End jump; other keys do nothing", () => {
    expect(menuIndex(0, "ArrowDown", 3)).toBe(1);
    expect(menuIndex(2, "ArrowDown", 3)).toBe(0);
    expect(menuIndex(0, "ArrowUp", 3)).toBe(2);
    expect(menuIndex(-1, "ArrowDown", 3)).toBe(0);
    expect(menuIndex(1, "Home", 3)).toBe(0);
    expect(menuIndex(1, "End", 3)).toBe(2);
    expect(menuIndex(1, "Enter", 3)).toBeNull();
  });

  test("the popover sits under its trigger at its end, and flips to stay inside the window", () => {
    const window_ = { width: 1280, height: 900 };
    const panel = { width: 280, height: 200 };
    // Under the trigger, its right edge at the trigger's: growing from the trigger's bottom-right corner.
    expect(placeMenu({ x: 900, y: 100, width: 44, height: 44 }, panel, window_)).toEqual({ left: 664, top: 148, origin: "top right" });
    // No room under it: above it, growing from its top.
    expect(placeMenu({ x: 900, y: 800, width: 44, height: 44 }, panel, window_)).toEqual({ left: 664, top: 596, origin: "bottom right" });
    // No room at its start: from its left edge instead.
    expect(placeMenu({ x: 20, y: 100, width: 44, height: 44 }, panel, window_)).toEqual({ left: 20, top: 148, origin: "top left" });
    // Never past the window's edges, with 8 px to spare.
    const tight = placeMenu({ x: 100, y: 300, width: 44, height: 44 }, { width: 280, height: 880 }, { width: 300, height: 900 });
    expect(tight.left).toBeGreaterThanOrEqual(8);
    expect(tight.top).toBeGreaterThanOrEqual(8);
  });

  test("Escape and a press outside close it and give the focus back to the trigger", () => {
    const menu = kitSource("Menu.tsx");
    expect(menu).toContain("onRequestClose={close}");
    expect(menu).toContain("trigger.current?.focus()");
  });

  test("tsc refuses a Menu item without a label", () => {
    // @ts-expect-error label is required: it is the item's name.
    const nameless: MenuItem = { icon: "delete", onSelect: noop };
    expect(nameless.icon).toBe("delete");
  });
});

// UI Task 5 appends below, after Menu's cases, so the lines above keep the numbers other tasks cite.
import { tabId, TabPanel, Tabs, tabMove, type TabsProps } from "../src/components/kit/Tabs";

describe("Tabs (6.10)", () => {
  const tabs = [
    { key: "posts", label: "Posts" },
    { key: "replies", label: "Replies" },
    { key: "likes", label: "Likes" },
  ];
  /** Each tab's opening tag and its first text, as explore.test.tsx's tabsOf reads a tab list. */
  const tabsOf = (markup: string) => [...markup.matchAll(/<[a-z]+\b([^>]*\brole="tab"[^>]*)>(?:<[^>]+>)*([^<]*)/g)].map((match) => ({ tag: match[1]!, label: match[2]! }));

  test("a tab list named by its label, a tab per entry with its label as its first text, the chosen one selected", () => {
    const out = html(<Tabs label="Profile tabs" tabs={tabs} selected="replies" onSelect={noop} panelId="profile-panel" />);
    expect(tagWith(out, 'role="tablist"')).toContain('aria-label="Profile tabs"');
    const found = tabsOf(out);
    expect(found.map((tab) => tab.label)).toEqual(["Posts", "Replies", "Likes"]);
    expect(found.map((tab) => tab.tag.includes('aria-selected="true"'))).toEqual([false, true, false]);
    // Each tab controls the panel and has the id the panel is named by.
    for (const tab of found) expect(tab.tag).toContain('aria-controls="profile-panel"');
    expect(found[1]!.tag).toContain(`id="${tabId("profile-panel", "replies")}"`);
  });

  test("one tab stop: the selected tab, the others reached with the arrows", () => {
    const found = tabsOf(html(<Tabs label="Profile tabs" tabs={tabs} selected="posts" onSelect={noop} panelId="p" />));
    expect(found.map((tab) => /tabindex="(-?\d)"/.exec(tab.tag)?.[1])).toEqual(["0", "-1", "-1"]);
  });

  test("Left and Right move and select at once and wrap; Home and End jump; other keys do nothing", () => {
    expect(tabMove(0, "ArrowRight", 3)).toBe(1);
    expect(tabMove(2, "ArrowRight", 3)).toBe(0);
    expect(tabMove(0, "ArrowLeft", 3)).toBe(2);
    expect(tabMove(1, "Home", 3)).toBe(0);
    expect(tabMove(1, "End", 3)).toBe(2);
    expect(tabMove(1, "ArrowDown", 3)).toBeNull();
    expect(tabMove(1, "Enter", 3)).toBeNull();
  });

  test("the panel is a tabpanel named by the selected tab", () => {
    const panel = tagWith(html(<TabPanel panelId="profile-panel" selected="likes"><KitText>Likes</KitText></TabPanel>), 'role="tabpanel"');
    expect(panel).toContain('id="profile-panel"');
    expect(panel).toContain(`aria-labelledby="${tabId("profile-panel", "likes")}"`);
  });

  test("the underline moves on spring-snap for a pointer and jumps for keys and reduced motion; the row scrolls sideways; the ring and the selection haptic", () => {
    const source = kitSource("Tabs.tsx");
    expect(source).toContain('motion.spring("springSnap")');
    expect(source).toContain("lastInputWasKeyboard()");
    expect(source).toContain('haptic("selection")');
    expect(source).toContain("FOCUS_RING");
    expect(source).toContain("horizontal");
    expect(source).not.toContain("flex-wrap");
  });

  test("tsc refuses a tab list without a name", () => {
    // @ts-expect-error label is required: it names the tab list.
    const nameless: TabsProps<"posts"> = { tabs: [{ key: "posts", label: "Posts" }], selected: "posts", onSelect: noop, panelId: "p" };
    expect(nameless.panelId).toBe("p");
  });
});

describe("ListRow for an account (6.11, 8.4)", () => {
  const account = { id: "00000000-0000-4000-8000-000000000002", displayName: "Grace Hopper" };

  test("the link holds the avatar, the name with its chip and the handle; the control sits beside the link, outside it", () => {
    const out = html(
      <ListRow
        label="Grace Hopper"
        href="/u/grace"
        leading={<Avatar account={account} size={40} />}
        badge={<VerifiedChip />}
        detail={<KitText variant="mono">@grace</KitText>}
        control={{ kind: "button", element: <Button label="Follow" onPress={noop} full={false} /> }}
      />,
    );
    const link = /<a\b[^>]*href="\/u\/grace"[^>]*>([\s\S]*?)<\/a>/.exec(out)?.[1] ?? "";
    // The monogram's letter is decoration, hidden from assistive technology; the name, the chip and the handle follow it.
    expect(textOf(link)).toBe("G Grace Hopper Verified @grace");
    expect(link).not.toContain('role="button"');
    expect(buttons(out)).toEqual(["Follow"]);
    // No chevron beside a control: the row's one trailing thing is the control.
    expect(out).not.toContain(lucideClass(ICONS.next));
  });
});
```

### Replace `apps/app/test/legacy-files.ts` (whole file)

```ts
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * The source files that still paint with Tailwind's own palette (`text-zinc-400`, `bg-sky-500`) and size the text
 * with size and weight classes instead of korbat's tokens and the Text component (UI design, sections 4.2 and 6.2).
 * contrast.test.ts lets these files, and only these, keep palette classes and hex colours; theme.test.ts lets them
 * keep size and weight classes. A listed file that no longer holds a palette class fails contrast.test.ts, so the
 * task that moves a file onto the tokens takes it off this list in the same commit; Task 8 empties it. Paths are
 * from apps/app/src, in forward slashes, sorted.
 */
export const LEGACY_COLOUR_FILES: readonly string[] = [
  "app/(auth)/age.tsx",
  "app/explore/about.tsx",
  "app/rules.tsx",
  "app/settings/account.tsx",
  "app/settings/cases/[id].tsx",
  "app/settings/cases/[id]/reply.tsx",
  "app/settings/cases/index.tsx",
  "app/settings/cases/releases/[id].tsx",
  "app/settings/cases/uploads/[id].tsx",
  "app/settings/privacy.tsx",
  "app/settings/profile.tsx",
  "app/settings/security.tsx",
  "app/terms.tsx",
  "app/transparency.tsx",
  "components/moderation/CasesLists.tsx",
  "components/moderation/DecisionDetail.tsx",
  "components/moderation/ItemLines.tsx",
  "components/moderation/NoticeStatusView.tsx",
  "components/moderation/RefusedNotice.tsx",
  "components/moderation/ReleaseNotice.tsx",
  "components/moderation/ReportForm.tsx",
  "components/moderation/UploadNotice.tsx",
  "components/security/MfaSection.tsx",
  "components/security/PasskeysSection.tsx",
  "components/security/ReauthPanel.tsx",
  "components/security/SessionsSection.tsx",
  "components/social/ComposeSheet.tsx",
  "components/social/Composer.tsx",
  "components/social/ComposerImages.tsx",
];

/**
 * The files of src/app and src/components that still hold a bare sentence as a JSX child, a text or a string literal
 * written straight into the markup instead of a words module (UI design, section 1.5). a11y.test.tsx lets these files,
 * and only these, keep them; a listed file that no longer holds one fails, so the task that moves a file's sentences
 * into its area's words module takes it off this list in the same commit. Task 10 records what is left. Paths are from
 * apps/app/src, in forward slashes, sorted.
 */
export const LEGACY_TEXT_FILES: readonly string[] = [
  "app/(auth)/age.tsx",
  "app/(auth)/code.tsx",
  "app/(auth)/handle.tsx",
  "app/(auth)/mfa.tsx",
  "app/(auth)/password.tsx",
  "app/(auth)/signin.tsx",
  "app/email-revert/[token].tsx",
  "app/explore/about.tsx",
  "app/not-me/[token].tsx",
  "app/passkey-remove/[token].tsx",
  "app/settings/account.tsx",
  "app/settings/privacy.tsx",
  "app/settings/profile.tsx",
  "app/settings/security.tsx",
  "app/terms.tsx",
  "components/moderation/ReportForm.tsx",
  "components/security/MfaSection.tsx",
  "components/security/PasskeysSection.tsx",
  "components/security/ReauthPanel.tsx",
  "components/security/SessionsSection.tsx",
  "components/social/ComposeSheet.tsx",
  "components/social/Composer.tsx",
  "components/social/ComposerImages.tsx",
];

export const SRC = path.resolve(import.meta.dirname, "..", "src");

/** Every source file of the app, with its path from src in forward slashes, as explore.test.tsx reads them. */
export function sourceFiles(): { name: string; text: string }[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .map((file) => ({ name: file.split(path.sep).join("/"), text: readFileSync(path.join(SRC, file), "utf8") }));
}
```

### Replace `apps/app/test/post-card.test.tsx` (whole file)

```tsx
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { EngagementResponse, FollowResponse, MeResponse, PostView } from "@korbat/contracts";
import { MenuPanel } from "../src/components/kit/Menu";
import { DeleteQuestion, PostCard, QuoteEmbed, repostMenuItems } from "../src/components/social/PostCard";
import { PostMenuPanel } from "../src/components/social/PostMenu";
import { FollowButton } from "../src/components/social/ProfileList";
import { WhoSeesThisBody } from "../src/components/social/WhoSeesThis";
import { DEFAULT_APPEARANCE, setAppearance } from "../src/lib/appearance";
import { REPORT_WORDS } from "../src/lib/moderation-words";
import { countLabel, deleteWithLeave, failedWords, flipped, followFailedWords, restored, settled, threadStats, toggleEngagement, toggleFollow, type ToggleKind } from "../src/lib/post-actions";
import { reach } from "../src/lib/reach";
import { createLanes, laneKey } from "../src/lib/social";
import { fullDate, postedWhen, timeAgo } from "../src/lib/time";
import { UI_WORDS, fill } from "../src/lib/ui-words";

/**
 * The post card (UI design, sections 6.6, 6.9, 6.14 and 10; Task 4): an article named by its author line, one explicit
 * link to the post in its time, icon actions named with their counts, the More and Repost menus, the delete question, and
 * the optimistic actions with their rollback, for the card's toggles and for FollowButton. A static render cannot press,
 * so the menus are drawn open through their panels, and the actions' transitions and request lanes are the pure
 * functions the components call, driven here through a fake social client that answers or refuses.
 */
const session = vi.hoisted(() => ({ state: { status: "signed-out" } as unknown }));

vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  router: { push: () => undefined, replace: () => undefined },
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: session.state, refresh: async () => session.state }) }));
vi.mock("expo-image", async () => {
  const { createElement } = await import("react");
  return { Image: ({ source, accessibilityLabel, priority }: { source: { uri: string }; accessibilityLabel: string; priority?: string }) => createElement("img", { "data-uri": source.uri, alt: accessibilityLabel, "data-priority": priority }) };
});
// A toast is sonner's, which a static render has no use for; the words it would show are tested as the functions give them.
vi.mock("@/components/toast", () => ({ toast: { show: vi.fn() }, Toaster: () => null }));

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
/** Every opening tag of the markup. */
const tags = (markup: string): string[] => markup.match(/<[a-z0-9]+\b[^>]*>/g) ?? [];
/** The first opening tag that carries `attribute`. */
const tagWith = (markup: string, attribute: string): string => tags(markup).find((tag) => tag.includes(attribute)) ?? "";
/** An attribute's value in an opening tag, or null. */
function attr(tag: string, name: string): string | null {
  const at = tag.indexOf(` ${name}="`);
  if (at < 0) return null;
  const from = at + name.length + 3;
  return tag.slice(from, tag.indexOf('"', from));
}
/** The text of every button, read up to the first closing div, as kit.test.tsx reads it: a menu item is named by its words. */
const buttonTexts = (markup: string): string[] => [...markup.matchAll(/<(?:div|button)\b[^>]*\brole="button"[^>]*>(.*?)<\/(?:div|button)>/g)].map((match) => textOf(match[1]!));
/** The accessible name of every button, from its aria-label. */
const buttonNames = (markup: string): string[] => tags(markup).filter((tag) => tag.includes('role="button"')).map((tag) => (attr(tag, "aria-label") ?? "").replace(/&#x27;/g, "'"));
/** Each anchor with its href and its inner markup. */
const anchors = (markup: string): { href: string; open: string; inner: string }[] =>
  [...markup.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/g)].map((match) => ({ href: attr(match[1]!, "href") ?? "", open: match[1]!, inner: match[2]! }));
/** The inner markup of the element whose id is `id`. */
function byId(markup: string, id: string): string {
  const at = markup.indexOf(` id="${id}"`);
  if (at < 0) return "";
  const start = markup.lastIndexOf("<", at);
  const name = /^<([a-z0-9]+)/.exec(markup.slice(start))![1]!;
  const from = markup.indexOf(">", at) + 1;
  return markup.slice(from, markup.indexOf(`</${name}>`, from));
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADA = { id: id(900), handle: "ada", displayName: "Ada Lovelace", verified: false };
const BEN = { id: id(901), handle: "ben", displayName: "Ben", verified: false };
const NOW = new Date("2026-10-04T13:00:00.000Z");

function post(extra: Partial<PostView> = {}): PostView {
  return {
    id: id(1),
    author: ADA,
    body: "The ferries are running late again.",
    createdAt: "2026-10-04T10:00:00.000Z",
    state: "visible",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
    ...extra,
  };
}

function me(userId: string): { status: "signed-in"; me: MeResponse } {
  return {
    status: "signed-in",
    me: {
      user: { id: userId, email: "x@korbat.local", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 0 },
      profile: { id: userId, handle: "reader", displayName: "Reader", handleChangedAt: null, verified: false, showInExplore: true },
      standing: { activeStrikes: 0, measure: null, reporting: null, handleRetired: false },
    } as MeResponse,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  session.state = { status: "signed-out" };
});
afterEach(() => {
  vi.useRealTimers();
  setAppearance(DEFAULT_APPEARANCE);
});

describe("the post is an article with one link to it (6.6)", () => {
  test("an article named by its author line: the name, the handle and when it was posted", () => {
    const out = html(<PostCard post={post()} />);
    const article = tagWith(out, 'role="article"');
    const label = attr(article, "aria-labelledby");
    expect(label).not.toBeNull();
    expect(textOf(byId(out, label!))).toBe("Ada Lovelace, @ada, 3h ago");
  });

  test("the time is the post's only link: it shows the short time, and its name adds postedWhen's words around it", () => {
    for (const [createdAt, short] of [
      ["2026-10-04T12:59:40.000Z", "just now"],
      ["2026-10-04T10:00:00.000Z", "3h"],
      ["2026-09-20T10:00:00.000Z", timeAgo("2026-09-20T10:00:00.000Z", NOW.getTime())],
    ] as const) {
      const out = html(<PostCard post={post({ createdAt })} />);
      const links = anchors(out).filter((link) => link.href === `/post/${id(1)}`);
      expect(links, short).toHaveLength(1);
      const link = links[0]!;
      const when = postedWhen(createdAt, NOW.getTime());
      // The visible short time is hidden from the name, which says it inside the hidden words: the name contains the label.
      const visible = tags(link.inner).find((tag) => link.inner.includes(`${tag}${short}<`)) ?? "";
      expect(visible, short).toContain('aria-hidden="true"');
      expect(textOf(link.inner)).toContain(fill(UI_WORDS["post.open"], { when }));
      expect(when).toContain(short === "just now" ? "just now" : short);
    }
  });

  test("the name is the profile link; the avatar sits in a second one, out of the tab order and hidden", () => {
    const out = html(<PostCard post={post()} />);
    const profile = anchors(out).filter((link) => link.href === "/u/ada");
    expect(profile).toHaveLength(2);
    const [avatar, name] = profile;
    expect(avatar!.open).toContain('tabindex="-1"');
    expect(avatar!.open).toContain('aria-hidden="true"');
    expect(textOf(name!.inner)).toBe("Ada Lovelace");
    expect(name!.open).not.toContain('tabindex="-1"');
  });

  test("the body is text, no longer a link", () => {
    const out = html(<PostCard post={post()} />);
    expect(textOf(out)).toContain("The ferries are running late again.");
    for (const link of anchors(out)) expect(textOf(link.inner)).not.toContain("ferries");
  });

  test("the repost line names who reposted, as a link to their profile, and the reply context links its author", () => {
    const out = html(<PostCard post={post({ replyTo: { id: id(2), authorHandle: "ben" } })} repostedBy={BEN} />);
    expect(textOf(out)).toContain(fill(UI_WORDS["post.reposted"], { displayName: "Ben" }));
    expect(anchors(out).filter((link) => link.href === "/u/ben").map((link) => textOf(link.inner))).toEqual(["Ben", "@ben"]);
    expect(textOf(out)).toContain(`${UI_WORDS["post.replyingTo"].trim()} @ben`);
    expect(textOf(html(<PostCard post={post({ replyTo: { id: id(2), authorHandle: null } })} />))).toContain(UI_WORDS["post.replyingHidden"]);
  });

  test("a quoted post has its own author line: the name to the profile, the time to the quoted post; a tombstone keeps its words", () => {
    const quoted = { ...post({ id: id(2), author: BEN, body: "quoted words" }), quoteOf: null };
    const out = html(<QuoteEmbed quote={quoted} />);
    expect(anchors(out).map((link) => link.href)).toEqual(["/u/ben", `/post/${id(2)}`]);
    expect(textOf(out)).toContain("quoted words");
    expect(textOf(html(<QuoteEmbed quote={{ id: id(3), deleted: true }} />))).toBe(UI_WORDS["post.deleted"]);
    expect(textOf(html(<QuoteEmbed quote={{ id: id(3), unavailable: true }} />))).toBe(UI_WORDS["post.unavailable"]);
    expect(UI_WORDS["post.deleted"]).toBe("This post was deleted by its author.");
    expect(UI_WORDS["post.unavailable"]).toBe("This post is unavailable.");
  });
});

describe("the actions' names (6.6, section 10, decision 15)", () => {
  const named = (counts: PostView["counts"]) => buttonNames(html(<PostCard post={post({ counts })} />));

  test("Reply, Repost and Like say their count, in the singular for one and with no number at zero", () => {
    expect(named({ likes: 0, reposts: 0, replies: 0, quotes: 0 }).slice(0, 3)).toEqual(["Reply", "Repost", "Like"]);
    expect(named({ likes: 1, reposts: 1, replies: 1, quotes: 0 }).slice(0, 3)).toEqual(["Reply, 1 reply", "Repost, 1 repost", "Like, 1 like"]);
    expect(named({ likes: 30, reposts: 12, replies: 4, quotes: 2 }).slice(0, 3)).toEqual(["Reply, 4 replies", "Repost, 12 reposts", "Like, 30 likes"]);
    expect(countLabel("like", 1234, false)).toBe("Like, 1234 likes");
  });

  test("hiding counts drops the like and repost numbers, in the name and on screen; replies keep theirs", () => {
    setAppearance({ hideCounts: true });
    const out = html(<PostCard post={post({ counts: { likes: 30, reposts: 12, replies: 4, quotes: 2 } })} />);
    expect(buttonNames(out).slice(0, 3)).toEqual(["Reply, 4 replies", "Repost", "Like"]);
    expect(textOf(out)).not.toMatch(/\b30\b|\b12\b/);
    expect(textOf(out)).toMatch(/\b4\b/);
  });

  test("Like and Repost say whether they are on; Save changes its name instead; Repost and More open menus", () => {
    session.state = me(id(950));
    const on = html(<PostCard post={post({ viewer: { liked: true, reposted: true, bookmarked: true } })} />);
    const off = html(<PostCard post={post({ viewer: { liked: false, reposted: false, bookmarked: false } })} />);
    const button = (markup: string, name: string) => tags(markup).find((tag) => tag.includes('role="button"') && attr(tag, "aria-label") === name) ?? "";
    expect(button(on, "Like")).toContain('aria-pressed="true"');
    expect(button(off, "Like")).toContain('aria-pressed="false"');
    expect(button(on, "Repost")).toContain('aria-pressed="true"');
    expect(button(on, "Repost")).toContain('aria-haspopup="menu"');
    expect(button(on, "Repost")).toContain('aria-expanded="false"');
    expect(button(on, "Saved")).not.toContain("aria-pressed");
    expect(button(off, "Save")).not.toContain("aria-pressed");
    const more = button(off, UI_WORDS["post.more"]);
    expect(more).toContain('aria-haspopup="menu"');
    expect(UI_WORDS["post.more"]).toBe("More options for this post");
    expect(buttonNames(off)).toEqual(["Reply", "Repost", "Like", "Save", "More options for this post"]);
  });

  test("the thread's stats line: each part in the singular for one, left out at zero, likes and reposts left out when hidden", () => {
    expect(threadStats({ reposts: 12, quotes: 4, likes: 30, replies: 9 }, false)).toBe("12 reposts, 4 quotes, 30 likes");
    expect(threadStats({ reposts: 1, quotes: 1, likes: 1, replies: 0 }, false)).toBe("1 repost, 1 quote, 1 like");
    expect(threadStats({ reposts: 0, quotes: 2, likes: 0, replies: 0 }, false)).toBe("2 quotes");
    expect(threadStats({ reposts: 12, quotes: 4, likes: 30, replies: 0 }, true)).toBe("4 quotes");
    expect(threadStats({ reposts: 0, quotes: 0, likes: 0, replies: 3 }, false)).toBe("");
  });

  test("the large variant shows the full date and the stats line above the actions", () => {
    const out = textOf(html(<PostCard post={post({ counts: { likes: 30, reposts: 12, replies: 4, quotes: 2 } })} large />));
    expect(out).toContain("12 reposts, 2 quotes, 30 likes");
    // The full date in the reader's own time zone, which is the machine's here.
    expect(out).toContain(fullDate("2026-10-04T10:00:00.000Z"));
  });
});

describe("the menus, drawn open (6.9, decision 12)", () => {
  const items = (markup: string) => ({ buttons: buttonTexts(markup), links: anchors(markup).map((link) => [textOf(link.inner), link.href]) });

  test("More holds Who sees this, Copy link, and Report for anyone's post but the reader's own, signed in or out", () => {
    for (const state of [{ status: "signed-out" }, me(id(950))]) {
      session.state = state;
      const out = html(<PostMenuPanel post={post()} onDelete={() => undefined} onWhoSees={() => undefined} />);
      expect(items(out).buttons).toEqual([UI_WORDS["post.whoSees"], UI_WORDS["post.copyLink"]]);
      expect(items(out).links).toEqual([[REPORT_WORDS.control, `/report?post=${id(1)}`]]);
    }
    session.state = me(ADA.id);
    const own = html(<PostMenuPanel post={post()} onDelete={() => undefined} onWhoSees={() => undefined} />);
    expect(items(own).buttons).toEqual([UI_WORDS["post.whoSees"], UI_WORDS["post.copyLink"], UI_WORDS["post.delete"]]);
    expect(items(own).links).toEqual([]);
    // Who sees this carries its one-line summary under its label.
    expect(textOf(own)).toContain(reach(post(), me(ADA.id).me).summary);
  });

  test("the Repost menu offers Repost or Undo repost, and Quote as a link: to the quote composer, or to sign in", () => {
    const panel = (view: PostView, signedIn: boolean) => html(<MenuPanel label={UI_WORDS["post.repost"]} items={repostMenuItems(view, signedIn, () => undefined)} layout="wide" onPick={() => undefined} />);
    const signedIn = panel(post({ viewer: { liked: false, reposted: false, bookmarked: false } }), true);
    expect(items(signedIn).buttons).toEqual([UI_WORDS["post.repost"]]);
    expect(items(signedIn).links).toEqual([[UI_WORDS["post.quote"], `/post/${id(1)}?quote=1`]]);
    expect(items(panel(post({ viewer: { liked: false, reposted: true, bookmarked: false } }), true)).buttons).toEqual([UI_WORDS["post.unrepost"]]);
    expect(items(panel(post(), false)).links).toEqual([[UI_WORDS["post.quote"], "/signin"]]);
    expect([UI_WORDS["post.repost"], UI_WORDS["post.unrepost"], UI_WORDS["post.quote"]]).toEqual(["Repost", "Undo repost", "Quote"]);
  });

  test("Who sees this lists reach()'s sentences with their links", () => {
    const decision = { decisionId: id(7), ruleId: "R3" as const, legal: false, interim: false, strikeUntil: null };
    const view = post({ state: "removed", moderation: decision });
    const out = html(<WhoSeesThisBody post={view} me={me(ADA.id).me} explore={null} />);
    for (const line of reach(view, me(ADA.id).me).lines) expect(textOf(out)).toContain(line.text);
    expect(anchors(out).map((link) => [textOf(link.inner), link.href])).toEqual([
      [UI_WORDS["reach.decision"], `/settings/cases/${id(7)}`],
      [UI_WORDS["reach.how"], "/explore/about"],
    ]);
  });
});

describe("delete (6.6)", () => {
  test("the question replaces the action row: a dialog named by its question, with Delete and Keep", () => {
    const out = html(<DeleteQuestion postId={id(1)} busy={false} onDelete={() => undefined} onKeep={() => undefined} />);
    const dialog = tagWith(out, 'role="dialog"');
    expect(textOf(byId(out, attr(dialog, "aria-labelledby")!))).toBe(UI_WORDS["post.deleteQuestion"]);
    expect(UI_WORDS["post.deleteQuestion"]).toBe("Delete this post?");
    expect(textOf(out)).toContain("Delete");
    expect(textOf(out)).toContain("Keep");
  });

  test("a deleted post leaves the list after it has faded, never before the answer; a refusal leaves it in place", async () => {
    const lanes = createLanes();
    const order: string[] = [];
    const client = { deletePost: vi.fn(async () => void order.push("answered")) };
    const result = await deleteWithLeave(client, lanes, id(1), async () => void order.push("faded"));
    expect(result).toEqual({ status: "deleted" });
    expect(order).toEqual(["answered", "faded"]);
    const refusing = { deletePost: vi.fn(async () => Promise.reject(new Error("refused"))) };
    const refused = await deleteWithLeave(refusing, lanes, id(1), async () => void order.push("faded again"));
    expect(refused.status).toBe("refused");
    expect(order).toEqual(["answered", "faded"]);
  });
});

describe("optimistic actions with rollback (6.6, section 5.2)", () => {
  const counts = { likes: 5, reposts: 2, replies: 1, quotes: 0 };
  const viewer = { liked: false, reposted: false, bookmarked: false };
  const base = post({ counts, viewer });

  test("each toggle changes the state and its count at once, both ways; Save has no count", () => {
    expect(flipped(base, "like")).toMatchObject({ viewer: { liked: true }, counts: { likes: 6 } });
    expect(flipped(base, "repost")).toMatchObject({ viewer: { reposted: true }, counts: { reposts: 3 } });
    expect(flipped(base, "bookmark")).toMatchObject({ viewer: { bookmarked: true }, counts });
    const on = post({ counts, viewer: { liked: true, reposted: true, bookmarked: true } });
    expect(flipped(on, "like")).toMatchObject({ viewer: { liked: false }, counts: { likes: 4 } });
    expect(flipped(on, "repost")).toMatchObject({ viewer: { reposted: false }, counts: { reposts: 1 } });
    // Never below zero, whatever a stale count says.
    expect(flipped(post({ counts: { ...counts, likes: 0 }, viewer: { ...viewer, liked: true } }), "like").counts.likes).toBe(0);
  });

  /** A fake social client whose answers the test releases one at a time. */
  function fakeClient() {
    const pending: { kind: string; on: boolean; resolve: (answer: EngagementResponse) => void; reject: (error: unknown) => void }[] = [];
    const engage = vi.fn((_id: string, kind: string, on: boolean) => new Promise<EngagementResponse>((resolve, reject) => pending.push({ kind, on, resolve, reject })));
    return { client: { engage }, pending };
  }

  for (const kind of ["like", "repost", "bookmark"] as ToggleKind[]) {
    test(`${kind}: the card changes before the answer, the answer's counts replace its own, and a refusal restores it`, async () => {
      let view = base;
      const apply = (update: (current: PostView) => PostView) => void (view = update(view));
      const { client, pending } = fakeClient();
      const lanes = createLanes();
      const started: boolean[] = [];
      const running = toggleEngagement(client, lanes, view, kind, apply, (on) => started.push(on));
      expect(started).toEqual([true]);
      expect(view).toEqual(flipped(base, kind));
      const answer = { counts: { likes: 9, reposts: 7, replies: 1, quotes: 3 }, viewer: { ...viewer, [kind === "bookmark" ? "bookmarked" : kind === "like" ? "liked" : "reposted"]: true } };
      pending[0]!.resolve(answer);
      expect(await running).toEqual({ status: "answered", on: true });
      expect(view.counts).toEqual(answer.counts);
      expect(view).toEqual(settled(flipped(base, kind), kind, answer));
      // A refusal of the same turn puts back the reader's state and count of that kind only.
      view = base;
      const refusing = toggleEngagement(client, lanes, view, kind, apply);
      pending[1]!.reject(new Error("refused"));
      const result = await refusing;
      expect(result.status).toBe("refused");
      expect(view).toEqual(base);
      expect(failedWords(kind, true)).toMatch(/^Couldn't .*Try again\.$/);
    });
  }

  test("a rollback restores only its own kind, so a like refused while a save landed keeps the save", () => {
    const liked = flipped(flipped(base, "bookmark"), "like");
    expect(restored(liked, base, "like")).toEqual(flipped(base, "bookmark"));
  });

  test("each kind has its own lane: a second tap of a busy kind is not sent, while another kind runs beside it", async () => {
    let view = base;
    const apply = (update: (current: PostView) => PostView) => void (view = update(view));
    const { client, pending } = fakeClient();
    const lanes = createLanes();
    const first = toggleEngagement(client, lanes, view, "like", apply);
    const second = await toggleEngagement(client, lanes, view, "like", apply);
    expect(second).toEqual({ status: "busy" });
    // The double tap did not undo the like on screen either.
    expect(view.viewer?.liked).toBe(true);
    const save = toggleEngagement(client, lanes, view, "bookmark", apply);
    expect(client.engage.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      ["like", true],
      ["bookmark", true],
    ]);
    expect(lanes.busy(laneKey.post(id(1), "like"))).toBe(true);
    pending[0]!.resolve({ counts: { ...counts, likes: 6 }, viewer: { ...viewer, liked: true } });
    pending[1]!.resolve({ counts: { ...counts, likes: 6 }, viewer: { ...viewer, liked: true, bookmarked: true } });
    await Promise.all([first, save]);
    expect(view.viewer).toEqual({ liked: true, reposted: false, bookmarked: true });
    expect(lanes.busy(laneKey.post(id(1), "like"))).toBe(false);
  });

  test("the rollback toasts' words, one per action and direction", () => {
    expect([true, false].flatMap((on) => (["like", "repost", "bookmark"] as ToggleKind[]).map((kind) => failedWords(kind, on)))).toEqual([
      "Couldn't like this post. Try again.",
      "Couldn't repost this post. Try again.",
      "Couldn't save this post. Try again.",
      "Couldn't remove your like. Try again.",
      "Couldn't undo the repost. Try again.",
      "Couldn't remove this post from Bookmarks. Try again.",
    ]);
    expect(followFailedWords("grace", true)).toBe("Couldn't follow @grace. Try again.");
    expect(followFailedWords("grace", false)).toBe("Couldn't unfollow @grace. Try again.");
    expect([UI_WORDS["toast.saved"], UI_WORDS["toast.view"], UI_WORDS["toast.linkCopied"]]).toEqual(["Saved to Bookmarks", "View", "Link copied"]);
  });
});

describe("FollowButton (8.4)", () => {
  test("says Follow or Following, as a button named by its words", () => {
    session.state = me(id(950));
    expect(buttonNames(html(<FollowButton handle="grace" initial={false} />))).toEqual([""]);
    expect(textOf(html(<FollowButton handle="grace" initial={false} />))).toBe("Follow");
    expect(textOf(html(<FollowButton handle="grace" initial />))).toBe("Following");
  });

  test("changes at once, takes the answer's count, and a refusal puts it back", async () => {
    const lanes = createLanes();
    const shown: boolean[] = [];
    let release: (answer: FollowResponse) => void = () => undefined;
    const client = { setFollow: vi.fn(() => new Promise<FollowResponse>((resolve) => (release = resolve))) };
    const running = toggleFollow(client, lanes, "grace", false, (following) => shown.push(following));
    expect(shown).toEqual([true]);
    expect(await toggleFollow(client, lanes, "grace", true, (following) => shown.push(following))).toEqual({ status: "busy" });
    release({ following: true, followerCount: 129 });
    expect(await running).toEqual({ status: "answered", answer: { following: true, followerCount: 129 } });
    expect(shown).toEqual([true, true]);
    const refusing = { setFollow: vi.fn(async () => Promise.reject(new Error("refused"))) };
    const refused = await toggleFollow(refusing, lanes, "grace", true, (following) => shown.push(following));
    expect(refused.status).toBe("refused");
    expect(shown).toEqual([true, true, false, true]);
  });
});

// UI Task 5 appends below: the card's part in the feed pattern (section 10) and the first rows' images (section 11.2).
describe("PostCard in a feed (10, 11.2)", () => {
  test("the article says its place in the feed, and -1 for the size while more can load", () => {
    const out = html(<PostCard post={post()} position={3} setSize={-1} />);
    const article = tagWith(out, 'role="article"');
    expect(attr(article, "aria-posinset")).toBe("3");
    expect(attr(article, "aria-setsize")).toBe("-1");
    // Outside a feed it says nothing of a place.
    expect(tagWith(html(<PostCard post={post()} />), 'role="article"')).not.toContain("aria-posinset");
  });

  test("its one link to the post is marked as the article's open link, the one Page Down and Page Up move to; a quote's is not", () => {
    const quoted = { ...post({ id: id(2) }), quoteOf: null };
    const out = html(<PostCard post={post({ quoteOf: quoted })} />);
    const marked = anchors(out).filter((anchor) => anchor.open.includes("data-open"));
    expect(marked.map((anchor) => anchor.href)).toEqual([`/post/${id(1)}`]);
  });

  test("the first rows' images load first: high priority when the list asks, normal otherwise", () => {
    const image = { id: id(70), width: 800, height: 600, blurhash: "LEHV6nWB2yk8", alt: "A green square", small: "/media/x/small.webp", large: "/media/x/large.webp" };
    const priorities = (markup: string) => tags(markup).filter((tag) => tag.startsWith("<img")).map((tag) => attr(tag, "data-priority"));
    expect(priorities(html(<PostCard post={post({ media: [image] })} priority />))).toEqual(["high"]);
    expect(priorities(html(<PostCard post={post({ media: [image] })} />))).toEqual(["normal"]);
  });
});
```

### Replace `apps/app/test/report.test.tsx` (whole file)

```tsx
import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { CSAM_KEYWORDS, CSAM_NOTICE_MAX_ACCOUNTS, NOTICE_LIMITS, REPORT_RULE_IDS, TDB_FORM_CATEGORIES, type HiddenMedia, type MediaView, type PostView } from "@korbat/contracts";
import { RULES } from "@korbat/rules";

// The build's contact address, which Expo inlines at export time; set before the app's modules read it.
const CONTACT = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_CONTACT_EMAIL = "contact@korbat.local";
  return "contact@korbat.local";
});

import Report from "../src/app/report";
import Terms from "../src/app/terms";
import { ReportForm, ReportSent } from "../src/components/moderation/ReportForm";
import { MediaGrid } from "../src/components/social/MediaGrid";
import { MediaViewerContent } from "../src/components/social/MediaViewer";
import { PostCard, QuoteEmbed } from "../src/components/social/PostCard";
import { ApiError, messageFor } from "../src/lib/api";
import {
  CONTACT_EMAIL,
  EMPTY_DRAFT,
  OTHER_LINKS_MAX,
  draftTargets,
  givenTarget,
  noticeFrom,
  profileOnly,
  profilesNamed,
  reportFailure,
  reportHref,
  ruleLine,
  statusLink,
  tooManyProfiles,
  waitWords,
  type GivenTarget,
  type ReportDraft,
} from "../src/lib/moderation";
import { CATEGORY_LABELS, CONTACT_WORDS, REPORT_WORDS, numberWord } from "../src/lib/moderation-words";
import { TERMS_SECTIONS } from "../src/lib/terms";

/**
 * The report form and what leads to it in the web app (3c design, section 9): "Report" on posts, images and profiles, the
 * form's three grounds with every word of it, what it sends, its success screen, the three failures it words itself, and
 * the terms page's Contact section. The helpers that decide are called; the form and the screens are server-rendered in
 * each state, as explore.test.tsx renders its screens; what a static render cannot show (a request, a press) is read from
 * the source.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");
const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

/** The route parameters and the session the component under test reads; each test sets what it needs. */
const route = vi.hoisted(() => ({ params: {} as Record<string, string> }));
const session = vi.hoisted(() => ({ state: { status: "signed-out" } as unknown }));

vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined },
  useLocalSearchParams: () => route.params,
  usePathname: () => "/report",
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: session.state, refresh: async () => session.state }) }));
vi.mock("expo-image", async () => {
  const { createElement } = await import("react");
  return { Image: ({ source, accessibilityLabel }: { source: { uri: string }; accessibilityLabel: string }) => createElement("img", { "data-uri": source.uri, alt: accessibilityLabel }) };
});
// react-native-reanimated is mocked once for every test file in test/setup.ts.
// The human check's widget loads a script from Cloudflare; here it is a mark a test can find.
vi.mock("@marsidev/react-turnstile", async () => {
  const { createElement } = await import("react");
  return { Turnstile: () => createElement("div", { "data-turnstile": "widget" }) };
});

const html = (element: ReactElement): string => renderToStaticMarkup(element);
/** The markup's text as a reader sees it: tags dropped, entities read, spaces collapsed. */
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
/** The address of every link in the markup, in order. */
const hrefs = (markup: string): string[] => [...markup.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((match) => match[1]!.replace(/&amp;/g, "&"));
/** The accessible name of every field in the markup. */
const fields = (markup: string): string[] => [...markup.matchAll(/<(?:input|textarea)\b[^>]*\baria-label="([^"]*)"/g)].map((match) => match[1]!.replace(/&#x27;/g, "'"));
/** Every element with this role, as its opening tag. */
const withRole = (markup: string, role: string): string[] => (markup.match(/<[a-z]+\b[^>]*>/g) ?? []).filter((tag) => tag.includes(`role="${role}"`));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POST: GivenTarget = { kind: "post", id: id(1) };
const PROFILE: GivenTarget = { kind: "account", handle: "ada" };
const draft = (extra: Partial<ReportDraft> = {}): ReportDraft => ({ ...EMPTY_DRAFT, ...extra });
const form = (options: { signedIn?: boolean; given?: GivenTarget | null; initial?: Partial<ReportDraft> } = {}) =>
  html(<ReportForm signedIn={options.signedIn ?? true} given={options.given === undefined ? POST : options.given} initial={options.initial} />);

describe("3d (design, section 9.1): the rules page", () => {
  test("the form links The rules beside its list of rules", () => {
    const out = form({ initial: { ground: "rule" } });
    expect(out).toContain('href="/rules"');
    expect(textOf(out)).toContain("The rules");
    expect(form({ initial: { ground: "illegal" } })).not.toContain('href="/rules"');
  });
});

describe("the words", () => {
  test("the form's sentences are the design's, with their numbers printed from the contracts", () => {
    expect(REPORT_WORDS.question).toBe("What is wrong with it?");
    expect(REPORT_WORDS.grounds).toEqual({
      rule: "It breaks a korbat rule",
      illegal: "It is illegal",
      csam: "It is sexual abuse or exploitation of a child, child sexual abuse material, or grooming of a child",
    });
    expect(REPORT_WORDS.r2Instead).toBe("Child sexual abuse material: choose the third answer, which is anonymous.");
    expect(REPORT_WORDS.csamInstead).toBe("For the sexual abuse or exploitation of a child, child sexual abuse material or grooming, choose the third answer, which is anonymous.");
    expect(Object.keys(REPORT_WORDS.keywords)).toEqual(Object.keys(CSAM_KEYWORDS));
    expect(REPORT_WORDS.keywords).toEqual({
      csam: "Sexual images or videos of a child",
      deepfake: "Such images made or altered by software",
      grooming: "An adult seeking sexual contact with a child",
      abuse: "Other sexual abuse or exploitation of a child, such as offering a child for sex",
    });
    expect(REPORT_WORDS.anonymous).toBe("This report is anonymous: korbat does not record who sent it, not even your account. Keep the link we show you to follow it.");
    expect(REPORT_WORDS.profileOnly).toBe(
      "If you can, report the post or the image itself: open it and choose Report. From a profile alone korbat cannot tell which image you mean, and its answer covers the images on all the profile's posts.",
    );
    expect(CSAM_NOTICE_MAX_ACCOUNTS).toBe(1);
    expect(REPORT_WORDS.oneProfile).toBe("On this path a report can name one profile. Send another report for the next one.");
    expect(REPORT_WORDS.bonaFide).toBe("I believe in good faith that the information in this report is accurate and complete.");
    expect(REPORT_WORDS.contactHint).toBe("Without an email we cannot send you a receipt or our decision. korbat never shows your name or email to the person you report.");
    expect(`${REPORT_WORDS.privacy.use} ${REPORT_WORDS.privacy.sender} ${REPORT_WORDS.privacy.access}`).toBe(
      "korbat uses what you send only to handle this report; how long it keeps it is in the terms. Moderators see who sent a report only when a case needs it, for example when you report an account impersonating you; each time is recorded and shown to every staff member. If the person you report asks korbat for their data, the law may require korbat to give them what you wrote, never your name, email or account.",
    );
    expect(REPORT_WORDS.turnstile).toBe("Cloudflare Turnstile checks that you are not a bot; it sees your IP address and browser details for that check.");
    expect(REPORT_WORDS.keepLink).toBe("Keep this link to follow your report or ask for a decision to be re-examined. It is shown only now.");
    expect(REPORT_WORDS.followInSettings).toBe("You can follow it under Settings, Cases, Your reports.");
    expect([REPORT_WORDS.control, REPORT_WORDS.imageControl, REPORT_WORDS.link, REPORT_WORDS.otherItems, REPORT_WORDS.explanation, REPORT_WORDS.citedLaw, REPORT_WORDS.whyIllegal, REPORT_WORDS.name, REPORT_WORDS.email]).toEqual([
      "Report",
      "Report this image",
      "Link to the post or profile on korbat",
      "Other items",
      "Anything the moderator should know",
      "Which law or country (optional)",
      "Why is it illegal?",
      "Your name (optional)",
      "Your email (optional)",
    ]);
    expect(numberWord(9)).toBe("nine");
    expect(REPORT_WORDS.otherItemsHint).toBe("You can add up to nine more korbat links.");
    expect(OTHER_LINKS_MAX).toBe(NOTICE_LIMITS.maxTargets - 1);
  });

  test("the three failures the form words itself name the contact address, the limits and the wait", () => {
    const mail = "email your report to contact@korbat.local with the korbat links of what you report and why. Do not attach images or files: korbat does not open them.";
    expect(REPORT_WORDS.humanCheckFailed(CONTACT)).toBe(`The check that you are not a bot failed. Try again, or ${mail}`);
    expect(REPORT_WORDS.rateLimited("20 minutes", CONTACT)).toBe(
      `korbat cannot take another report from this network or account right now: it takes at most 5 reports an hour and 20 a day without an account, and 10 an hour and 50 a day with one. Try again in about 20 minutes, or ${mail}`,
    );
    expect([NOTICE_LIMITS.signedOut, NOTICE_LIMITS.signedIn]).toEqual([{ perHour: 5, perDay: 20 }, { perHour: 10, perDay: 50 }]);
    expect(REPORT_WORDS.unavailable(CONTACT)).toBe(`korbat cannot take reports right now. Try again in a few minutes, or ${mail}`);
    expect(REPORT_WORDS.mailShowsAddress).toBe("An email shows korbat your address. korbat deletes your email, and its reply to you, once your report is entered.");
  });

  test("every category the illegal ground offers has a name, and the app's table words the codes the form can meet", () => {
    expect(Object.keys(CATEGORY_LABELS).sort()).toEqual([...TDB_FORM_CATEGORIES].sort());
    expect(new Set(Object.values(CATEGORY_LABELS)).size).toBe(TDB_FORM_CATEGORIES.length);
    expect(messageFor("notice_link_invalid")).toBe("That link does not name a post or a profile on korbat.");
    expect(messageFor("notice_link_offsite")).toBe("Only links to this korbat can be reported.");
    expect(messageFor("already_reported")).toBe("You already reported this; it is being looked at.");
    expect(messageFor("staff_cannot_report")).toBe("A staff account does not send reports. Open a finding in the staff console instead.");
    expect(messageFor("notice_not_found")).toBe("We could not find a report with this link.");
    expect(messageFor("human_check_failed")).toBe("We could not verify that you are human. Try again.");
  });
});

describe("what leads to the form", () => {
  test("the form's address names the post, the image of a post, or the profile it is opened on, and reads it back", () => {
    expect(reportHref()).toBe("/report");
    expect(reportHref({ post: id(1) })).toBe(`/report?post=${id(1)}`);
    expect(reportHref({ post: id(1), media: id(2) })).toBe(`/report?post=${id(1)}&media=${id(2)}`);
    expect(reportHref({ account: "ada" })).toBe("/report?account=ada");
    expect(givenTarget({ post: id(1) })).toEqual({ kind: "post", id: id(1) });
    expect(givenTarget({ post: id(1), media: id(2) })).toEqual({ kind: "post", id: id(1), mediaId: id(2) });
    expect(givenTarget({ account: "@Ada" })).toEqual({ kind: "account", handle: "ada" });
    // Anything the API would refuse names nothing: the form then asks for a link.
    for (const params of [{}, { post: "nope" }, { account: "a b" }, { media: id(2) }, { post: ["x"] }]) expect(givenTarget(params), JSON.stringify(params)).toBeNull();
  });

  const image = (n: number): MediaView => ({ id: id(n), width: 800, height: 600, blurhash: "LEHV6nWB2yk8", alt: `picture ${n}`, small: `/api/media/${id(n)}/small.webp`, large: `/api/media/${id(n)}/large.webp` });
  const hidden = (n: number): HiddenMedia => ({ id: id(n), hidden: true });
  const post = (n: number, extra: Partial<PostView> = {}): PostView => ({
    id: id(n),
    author: { id: id(900), handle: "ada", displayName: "Ada", verified: false },
    body: `post number ${n}`,
    createdAt: "2026-10-04T10:00:00.000Z",
    state: "visible",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
    ...extra,
  });
  const me = (userId: string) => ({ status: "signed-in", me: { user: { id: userId, onboarded: true }, profile: { handle: "me" } } });

  test("a post that is not the reader's own has Report in its More menu, drawn open, signed in or out; the reader's own has none", () => {
    for (const state of [{ status: "signed-out" }, me(id(901))]) {
      session.state = state;
      const out = html(<PostMenuPanel post={post(1)} onDelete={() => undefined} onWhoSees={() => undefined} />);
      expect(hrefs(out)).toContain(`/report?post=${id(1)}`);
      expect(textOf(out)).toContain("Report");
    }
    session.state = me(id(900));
    const own = html(<PostMenuPanel post={post(1)} onDelete={() => undefined} onWhoSees={() => undefined} />) + html(<PostCard post={post(1)} />);
    expect(hrefs(own).filter((href) => href.startsWith("/report"))).toEqual([]);
    session.state = { status: "signed-out" };
  });

  test("the viewer reports an image on the post that holds it: opened from a post it names that post, and nothing for a hidden image or the reader's own post", () => {
    const noop = () => undefined;
    const media = [image(11), hidden(12)];
    const shown = html(<MediaViewerContent media={media} index={0} onIndex={noop} onClose={noop} postId={id(2)} />);
    expect(hrefs(shown)).toEqual([`/report?post=${id(2)}&media=${id(11)}`]);
    expect(textOf(shown)).toContain("Report this image");
    // A hidden image has nothing to report by; the post's own Report still names the post.
    expect(hrefs(html(<MediaViewerContent media={media} index={1} onIndex={noop} onClose={noop} postId={id(2)} />))).toEqual([]);
    // Without a post to report on (the reader's own post), the viewer offers nothing.
    expect(hrefs(html(<MediaViewerContent media={media} index={0} onIndex={noop} onClose={noop} />))).toEqual([]);
  });

  test("the grid hands the viewer its post, and a quoted post's images belong to the quoted post", () => {
    const grid = read("components", "social", "MediaGrid.tsx");
    // 3d Task 1: the viewer is also told whether the reader wrote the post, for an image that fails to load.
    expect(grid).toContain("<MediaViewer media={media} index={open} onIndex={setOpen} onClose={() => setOpen(null)} postId={own ? undefined : postId} own={own === true} />");
    const card = read("components", "social", "PostCard.tsx");
    expect(card).toContain("<MediaGrid media={post.media} postId={post.id} own={post.author.id === me} />");
    expect(card).toContain("<MediaGrid media={quote.media} compact postId={quote.id} />");
    // The quote's author line: its name to the profile, then its time to the quoted post; its squares open nothing themselves.
    const quoted = { ...post(2, { media: [image(21)] }), quoteOf: null };
    const out = html(<QuoteEmbed quote={quoted} />);
    expect(hrefs(out)).toEqual(["/u/ada", `/post/${id(2)}`]);
    expect(html(<MediaGrid media={[image(1)]} postId={id(5)} />)).not.toContain("/report");
  });

  test("UI Task 5: a profile has Report in its More menu, drawn open, after Mute and Block, and signed out too; never on the reader's own", () => {
    const grace = { id: id(902), handle: "grace", displayName: "Grace", bio: "", verified: false, createdAt: "2026-10-01T10:00:00.000Z", counts: { posts: 1, followers: 0, following: 0 } };
    session.state = { status: "signed-out" };
    expect(hrefs(html(<ProfileMenuPanel profile={grace} />))).toEqual(["/report?account=grace"]);
    session.state = me(id(901));
    const menu = textOf(html(<ProfileMenuPanel profile={{ ...grace, viewer: { following: false, followedBy: false, blocked: false, muted: false } }} />));
    expect(menu.indexOf("Block")).toBeGreaterThan(menu.indexOf("Mute"));
    expect(menu.indexOf("Report")).toBeGreaterThan(menu.indexOf("Block"));
    session.state = me(id(902));
    expect(html(<ProfileMenuPanel profile={grace} />)).toBe("");
  });

  test("the terms page ends with a Contact section built from the build's address, and a link to the form, which needs no account", () => {
    expect(CONTACT_EMAIL).toBe(CONTACT);
    const out = html(<Terms />);
    const text = textOf(out);
    expect(CONTACT_WORDS.body(CONTACT)).toBe(
      "Write to korbat at contact@korbat.local when the report form does not work for you, to ask for your data, or about a decision. A person reads every email. Do not attach images or files: korbat does not open them.",
    );
    expect(text).toContain(`Contact ${CONTACT_WORDS.body(CONTACT)}`);
    expect(text).toContain("Report something on korbat");
    expect(hrefs(out)).toContain("/report");
    // After the terms' own sections, of which it is no part, and before the link to the form.
    expect(TERMS_SECTIONS.map((section) => section.title)).not.toContain("Contact");
    const last = TERMS_SECTIONS.at(-1)!.title;
    expect(text.indexOf(last)).toBeLessThan(text.indexOf("Contact Write to korbat"));
    expect(text.indexOf("Contact Write to korbat")).toBeLessThan(text.indexOf("Report something on korbat"));
    // The form is no settings screen: the settings layout would send a signed-out reader to sign in.
    expect(read("app", "report.tsx")).not.toContain("SettingsNav");
  });
});

describe("the form", () => {
  test("asks what is wrong with three choices of equal weight, each a radio of one group, none chosen at first", () => {
    const out = form();
    const text = textOf(out);
    expect(text).toContain("What is wrong with it?");
    const at = Object.values(REPORT_WORDS.grounds).map((label) => text.indexOf(label));
    expect(at.every((index) => index > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(withRole(out, "radiogroup")).toHaveLength(1);
    const radios = withRole(out, "radio");
    expect(radios).toHaveLength(3);
    for (const radio of radios) expect(radio).toContain('aria-checked="false"');
    // Nothing of a ground shows before one is chosen, and nothing can be sent.
    for (const words of [REPORT_WORDS.whichRule, REPORT_WORDS.whyIllegal, REPORT_WORDS.which, REPORT_WORDS.anonymous]) expect(text).not.toContain(words);
    expect(text).toContain(REPORT_WORDS.missing.ground);
  });

  test("the rule ground lists the rules that can be reported, each with its title and one line, R2 replaced by the pointer to the third answer, and an optional note", () => {
    const out = form({ initial: { ground: "rule" } });
    const text = textOf(out);
    for (const ruleId of REPORT_RULE_IDS) {
      const rule = RULES.find((entry) => entry.id === ruleId)!;
      expect(text, ruleId).toContain(`${rule.id}: ${rule.title}`);
      expect(text, ruleId).toContain(ruleLine(rule));
    }
    const r2 = RULES.find((entry) => entry.id === "R2")!;
    expect(text).not.toContain(r2.title);
    expect(text).toContain(REPORT_WORDS.r2Instead);
    // In R2's place: after R1 and before R3.
    expect(text.indexOf(REPORT_WORDS.r2Instead)).toBeGreaterThan(text.indexOf("R1: "));
    expect(text.indexOf(REPORT_WORDS.r2Instead)).toBeLessThan(text.indexOf("R3: "));
    expect(fields(out)).toEqual([REPORT_WORDS.explanation]);
    expect(out.toLowerCase()).toContain(`maxlength="${NOTICE_LIMITS.explanationMax}"`);
    expect(ruleLine({ text: "One sentence. And another." })).toBe("One sentence.");
    expect(ruleLine({ text: "Only one" })).toBe("Only one");
  });

  test("the illegal ground asks for the category, not sure by default, points to the third answer directly below it, and asks why, the law, a rule and good faith", () => {
    const out = form({ initial: { ground: "illegal" } });
    const text = textOf(out);
    const categories = [REPORT_WORDS.categoryNotSure, ...TDB_FORM_CATEGORIES.map((category) => CATEGORY_LABELS[category])];
    for (const label of categories) expect(text, label).toContain(label);
    const checked = withRole(out, "radio").filter((tag) => tag.includes('aria-checked="true"'));
    // The ground itself, "I am not sure", and no rule beside the law.
    expect(checked).toHaveLength(3);
    // The pointer stands directly below the categories: after the last of them and before the next field.
    const pointer = text.indexOf(REPORT_WORDS.csamInstead);
    expect(pointer).toBeGreaterThan(Math.max(...categories.map((label) => text.indexOf(label))));
    expect(pointer).toBeLessThan(text.indexOf(REPORT_WORDS.citedLaw));
    expect(fields(out)).toEqual([REPORT_WORDS.citedLaw, REPORT_WORDS.whyIllegal]);
    // A rule it also breaks: every rule but R2, and none.
    expect(text).toContain(REPORT_WORDS.alsoRule);
    for (const ruleId of REPORT_RULE_IDS) expect(text).toContain(`${ruleId}: `);
    expect(text).not.toContain("R2: ");
    const box = withRole(out, "checkbox");
    expect(box).toHaveLength(1);
    expect(box[0]).toContain('aria-checked="false"');
    expect(text).toContain(REPORT_WORDS.bonaFide);
  });

  test("the anonymous path asks which it is, says that nobody is recorded, and asks for neither a name nor an email, signed in or out", () => {
    for (const signedIn of [true, false]) {
      const out = form({ signedIn, initial: { ground: "csam" } });
      const text = textOf(out);
      for (const label of Object.values(REPORT_WORDS.keywords)) expect(text).toContain(label);
      expect(text).toContain(REPORT_WORDS.anonymous);
      expect(fields(out)).toEqual([REPORT_WORDS.csamExplanation]);
      expect(text).not.toContain(REPORT_WORDS.contactHint);
      // Good faith may be stated, and is not asked for.
      expect(withRole(out, "checkbox")).toHaveLength(1);
      // The privacy line leaves out who sees the sender: this path records none.
      expect(text).toContain(REPORT_WORDS.privacy.use);
      expect(text).toContain(REPORT_WORDS.privacy.access);
      expect(text).not.toContain(REPORT_WORDS.privacy.sender);
    }
    // On the other grounds the line is whole.
    expect(textOf(form({ initial: { ground: "rule" } }))).toContain(`${REPORT_WORDS.privacy.use} ${REPORT_WORDS.privacy.sender} ${REPORT_WORDS.privacy.access}`);
  });

  test("on the anonymous path, for images, a report that names only a profile is asked for the post or the image, and never refused", () => {
    const images = (keyword: ReportDraft["keyword"], extra: Partial<ReportDraft> = {}) => draft({ ground: "csam", keyword, ...extra });
    expect(profileOnly(images("csam"), PROFILE)).toBe(true);
    expect(profileOnly(images("deepfake"), PROFILE)).toBe(true);
    // Not for grooming or other abuse, which are not about an image; not on another ground; not with a post beside it.
    expect(profileOnly(images("grooming"), PROFILE)).toBe(false);
    expect(profileOnly(images("abuse"), PROFILE)).toBe(false);
    expect(profileOnly(draft({ ground: "illegal", keyword: "csam" }), PROFILE)).toBe(false);
    expect(profileOnly(images("csam"), POST)).toBe(false);
    expect(profileOnly(images("csam", { others: ["http://localhost:8081/post/" + id(2)] }), PROFILE)).toBe(false);
    // A typed link to a profile is a profile too.
    expect(profileOnly(images("csam", { link: "http://localhost:8081/u/ada" }), null)).toBe(true);
    expect(profileOnly(images("csam", { link: "http://localhost:8081/post/" + id(2) }), null)).toBe(false);

    const out = form({ given: PROFILE, initial: { ground: "csam", keyword: "csam" } });
    expect(textOf(out)).toContain(REPORT_WORDS.profileOnly);
    // It can still be sent: the sentence asks, it does not refuse.
    const sent = noticeFrom(draft({ ground: "csam", keyword: "csam" }), PROFILE, { signedIn: true, turnstileToken: null });
    expect(sent).toEqual({ request: { ground: "csam", targets: [PROFILE], keyword: "csam" } });
    expect(textOf(form({ given: PROFILE, initial: { ground: "csam", keyword: "grooming" } }))).not.toContain(REPORT_WORDS.profileOnly);
    expect(textOf(form({ given: PROFILE, initial: { ground: "rule" } }))).not.toContain(REPORT_WORDS.profileOnly);
  });

  test("on the anonymous path a report names one profile at most: with a second the form says so before anything is sent", () => {
    const second = draft({ ground: "csam", keyword: "grooming", others: ["http://localhost:8081/u/bob"] });
    expect(profilesNamed(draftTargets(second, PROFILE))).toBe(2);
    expect(tooManyProfiles(second, PROFILE)).toBe(true);
    expect(noticeFrom(second, PROFILE, { signedIn: true, turnstileToken: null })).toEqual({ problem: REPORT_WORDS.oneProfile });
    expect(textOf(form({ given: PROFILE, initial: second }))).toContain(REPORT_WORDS.oneProfile);
    // The same profile named twice is one profile, a post beside it is no profile, and other grounds have no such limit.
    expect(tooManyProfiles(draft({ ground: "csam", keyword: "csam", others: ["http://localhost:8081/u/ADA", "http://localhost:8081/post/" + id(2)] }), PROFILE)).toBe(false);
    expect(tooManyProfiles({ ...second, ground: "rule" }, PROFILE)).toBe(false);
    expect(textOf(form({ given: PROFILE, initial: { ...second, ground: "rule", ruleId: "R6" } }))).not.toContain(REPORT_WORDS.oneProfile);
  });

  test("signed out, the illegal ground asks for an optional name and email, and every ground shows the human check with its sentence; signed in, none of it", () => {
    for (const ground of ["rule", "illegal", "csam"] as const) {
      const out = form({ signedIn: false, initial: { ground } });
      expect(out, ground).toContain('data-turnstile="widget"');
      expect(textOf(out), ground).toContain(REPORT_WORDS.turnstile);
      const signedIn = form({ signedIn: true, initial: { ground } });
      expect(signedIn, ground).not.toContain("data-turnstile");
      expect(textOf(signedIn), ground).not.toContain(REPORT_WORDS.turnstile);
      expect(fields(signedIn), ground).not.toContain(REPORT_WORDS.email);
    }
    const illegal = form({ signedIn: false, initial: { ground: "illegal" } });
    expect(fields(illegal)).toEqual([REPORT_WORDS.citedLaw, REPORT_WORDS.whyIllegal, REPORT_WORDS.name, REPORT_WORDS.email]);
    expect(textOf(illegal)).toContain(REPORT_WORDS.contactHint);
    expect(fields(form({ signedIn: false, initial: { ground: "rule" } }))).toEqual([REPORT_WORDS.explanation]);
    // Before a ground is chosen the check is there already: it takes a moment to pass.
    expect(form({ signedIn: false })).toContain('data-turnstile="widget"');
  });

  test("opened without an item, the form starts with one required field for the link; opened on one, it shows what is reported; other items take up to nine more links", () => {
    const bare = form({ given: null });
    expect(fields(bare)[0]).toBe(REPORT_WORDS.link);
    expect(textOf(bare)).toContain(REPORT_WORDS.otherItems);
    expect(textOf(bare)).toContain(REPORT_WORDS.otherItemsHint);
    const onPost = form({ given: { kind: "post", id: id(1), mediaId: id(2) } });
    expect(fields(onPost)).not.toContain(REPORT_WORDS.link);
    expect(hrefs(onPost)).toContain(`/post/${id(1)}`);
    expect(hrefs(form({ given: PROFILE }))).toContain("/u/ada");
    // Each added link is a field of its own; at nine there is no way to add a tenth.
    const nine = form({ initial: { others: Array.from({ length: OTHER_LINKS_MAX }, () => "") } });
    expect(fields(nine).filter((label) => label.startsWith("Link "))).toHaveLength(9);
    expect(textOf(nine)).not.toContain(REPORT_WORDS.addLink);
    expect(textOf(form({ initial: { others: [""] } }))).toContain(REPORT_WORDS.addLink);
  });

  test("the screen opens the form on what its address names, signed in or out, and without an item when it names none", () => {
    session.state = { status: "signed-out" };
    route.params = { post: id(1), media: id(2) };
    const onImage = html(<Report />);
    expect(hrefs(onImage)).toContain(`/post/${id(1)}`);
    expect(onImage).toContain('data-turnstile="widget"');
    route.params = { account: "ada" };
    expect(hrefs(html(<Report />))).toContain("/u/ada");
    route.params = {};
    expect(fields(html(<Report />))[0]).toBe(REPORT_WORDS.link);
    session.state = { status: "signed-in", me: { user: { id: id(901), onboarded: true }, profile: { handle: "me" } } };
    expect(html(<Report />)).not.toContain("data-turnstile");
    session.state = { status: "signed-out" };
  });
});

describe("what the form sends", () => {
  const signedIn = { signedIn: true, turnstileToken: null };
  const signedOut = { signedIn: false, turnstileToken: "token" };

  test("says what is missing, one thing at a time, and sends nothing until it is all there", () => {
    const missing = REPORT_WORDS.missing;
    expect(noticeFrom(draft(), POST, signedIn)).toEqual({ problem: missing.ground });
    expect(noticeFrom(draft({ ground: "rule" }), null, signedIn)).toEqual({ problem: missing.link });
    expect(noticeFrom(draft({ ground: "rule", link: "korbat.example/post/1" }), null, signedIn)).toEqual({ problem: missing.linkInvalid });
    expect(noticeFrom(draft({ ground: "rule" }), POST, signedIn)).toEqual({ problem: missing.rule });
    expect(noticeFrom(draft({ ground: "illegal" }), POST, signedIn)).toEqual({ problem: missing.whyIllegal });
    expect(noticeFrom(draft({ ground: "illegal", explanation: "It is a threat." }), POST, signedIn)).toEqual({ problem: missing.bonaFide });
    expect(noticeFrom(draft({ ground: "csam" }), POST, signedIn)).toEqual({ problem: missing.keyword });
    expect(noticeFrom(draft({ ground: "rule", ruleId: "R3" }), POST, { signedIn: false, turnstileToken: null })).toEqual({ problem: missing.human });
    expect(noticeFrom(draft({ ground: "illegal", explanation: "x", bonaFide: true, email: "not an address" }), POST, signedOut)).toEqual({ problem: missing.details });
  });

  test("a rule report, a notice of illegality and an anonymous report, each in the contracts' shape for its sender", () => {
    expect(noticeFrom(draft({ ground: "rule", ruleId: "R3", explanation: "  look at the second line  " }), POST, signedIn)).toEqual({
      request: { ground: "rule", ruleId: "R3", targets: [POST], explanation: "look at the second line" },
    });
    expect(noticeFrom(draft({ ground: "rule", ruleId: "R1", link: " http://localhost:8081/post/x ", others: ["", "http://localhost:8081/u/bob"] }), null, signedOut)).toEqual({
      request: { ground: "rule", ruleId: "R1", targets: [{ kind: "link", url: "http://localhost:8081/post/x" }, { kind: "link", url: "http://localhost:8081/u/bob" }], turnstileToken: "token" },
    });
    const illegal = draft({ ground: "illegal", explanation: "It is a threat.", bonaFide: true, citedLaw: "Section 241", ruleId: "R5", name: "Ada", email: "ada@korbat.local", category: "STATEMENT_CATEGORY_VIOLENCE" });
    expect(noticeFrom(illegal, PROFILE, signedOut)).toEqual({
      request: { ground: "illegal", targets: [PROFILE], category: "STATEMENT_CATEGORY_VIOLENCE", citedLaw: "Section 241", explanation: "It is a threat.", bonaFide: true, ruleId: "R5", name: "Ada", email: "ada@korbat.local", turnstileToken: "token" },
    });
    // Signed in, the contact is the account: a name or an address typed earlier is never sent.
    expect(noticeFrom(illegal, PROFILE, signedIn)).toEqual({
      request: { ground: "illegal", targets: [PROFILE], category: "STATEMENT_CATEGORY_VIOLENCE", citedLaw: "Section 241", explanation: "It is a threat.", bonaFide: true, ruleId: "R5" },
    });
    // The anonymous path sends neither, whatever the draft holds, and good faith only when it was stated.
    expect(noticeFrom(draft({ ground: "csam", keyword: "deepfake", name: "Ada", email: "ada@korbat.local", ruleId: "R1" }), POST, signedOut)).toEqual({
      request: { ground: "csam", targets: [POST], keyword: "deepfake", turnstileToken: "token" },
    });
    expect(noticeFrom(draft({ ground: "csam", keyword: "abuse", bonaFide: true, explanation: "seen today" }), POST, signedIn)).toEqual({
      request: { ground: "csam", targets: [POST], keyword: "abuse", explanation: "seen today", bonaFide: true },
    });
  });

  test("the form posts the request once, resets the human check after a failure, and shows the answer's screen", () => {
    const source = read("components", "moderation", "ReportForm.tsx");
    expect(source).toContain("const answer = await moderation.send(built.request);");
    expect(source).toContain("turnstile.current?.reset();");
    expect(source).toContain('setError(reportFailure(err, draft.ground === "csam"));');
    expect(read("lib", "moderation.ts")).toContain('send: (request: NoticeRequest) => api("/api/notices", { json: request, schema: NoticeResponse })');
  });
});

describe("after sending", () => {
  const TOKEN = "t".repeat(43);

  test("signed out, the screen shows the reference and the link to keep, its token in the fragment, with a Copy button", () => {
    const out = html(<ReportSent answer={{ ref: "N-ABCDEFGH23", token: TOKEN }} signedIn={false} origin="http://localhost:8081" />);
    const text = textOf(out);
    expect(text).toContain("N-ABCDEFGH23");
    expect(text).toContain(REPORT_WORDS.keepLink);
    expect(statusLink("http://localhost:8081", "N-ABCDEFGH23", TOKEN)).toBe(`http://localhost:8081/notice/N-ABCDEFGH23#t=${TOKEN}`);
    expect(text).toContain(`http://localhost:8081/notice/N-ABCDEFGH23#t=${TOKEN}`);
    // The token is never part of a query, which a server would be sent and would log.
    expect(out).not.toContain(`?t=${TOKEN}`);
    expect(withRole(out, "button").some((tag) => tag.includes(REPORT_WORDS.copy)) || text.includes(REPORT_WORDS.copy)).toBe(true);
    expect(text).not.toContain(REPORT_WORDS.followInSettings);
  });

  test("signed in, a report on a rule or on the law is followed under Settings, Cases, Your reports, and no link is shown", () => {
    const out = html(<ReportSent answer={{ ref: "N-ABCDEFGH23" }} signedIn origin="http://localhost:8081" />);
    const text = textOf(out);
    expect(text).toContain(REPORT_WORDS.followInSettings);
    expect(hrefs(out)).toContain("/settings/cases?tab=reports");
    expect(text).not.toContain(REPORT_WORDS.keepLink);
    expect(text).not.toContain("/notice/");
  });

  test("signed in, an anonymous report shows the link and not the Settings sentence: korbat recorded no account for it", () => {
    const out = html(<ReportSent answer={{ ref: "N-ABCDEFGH23", token: TOKEN }} signedIn origin="http://localhost:8081" />);
    const text = textOf(out);
    expect(text).toContain(REPORT_WORDS.keepLink);
    expect(text).toContain(`/notice/N-ABCDEFGH23#t=${TOKEN}`);
    expect(text).not.toContain(REPORT_WORDS.followInSettings);
    expect(hrefs(out).filter((href) => href.startsWith("/settings"))).toEqual([]);
  });
});

describe("a send that fails", () => {
  const failed = (code: string, retryAfter?: number) => new ApiError(code === "rate_limited" ? 429 : 403, code, "the server's own words", retryAfter);

  test("the human check, the limits and an API that cannot take reports each get the form's own sentence, naming the build's contact address", () => {
    expect(reportFailure(failed("human_check_failed"), false)).toBe(REPORT_WORDS.humanCheckFailed(CONTACT));
    expect(reportFailure(failed("rate_limited", 1200), false)).toBe(REPORT_WORDS.rateLimited("20 minutes", CONTACT));
    expect(reportFailure(failed("service_unavailable"), false)).toBe(REPORT_WORDS.unavailable(CONTACT));
    for (const code of ["human_check_failed", "rate_limited", "service_unavailable"]) expect(reportFailure(failed(code, 60), false), code).toContain("contact@korbat.local");
  });

  test("the wait is worded in minutes under an hour and in hours otherwise", () => {
    expect([waitWords(1), waitWords(60), waitWords(61), waitWords(3599), waitWords(3600), waitWords(3601), waitWords(20 * 3600), waitWords(undefined)]).toEqual([
      "1 minute",
      "1 minute",
      "2 minutes",
      "60 minutes",
      "1 hour",
      "2 hours",
      "20 hours",
      "1 hour",
    ]);
  });

  test("on the anonymous path each is followed by what an email gives away", () => {
    for (const code of ["human_check_failed", "rate_limited", "service_unavailable"]) {
      const words = reportFailure(failed(code, 60), true);
      expect(words.endsWith(` ${REPORT_WORDS.mailShowsAddress}`), code).toBe(true);
      expect(reportFailure(failed(code, 60), false), code).not.toContain(REPORT_WORDS.mailShowsAddress);
    }
  });

  test("any other failure shows the server's message, as everywhere in the app", () => {
    expect(reportFailure(failed("already_reported"), false)).toBe("the server's own words");
    expect(reportFailure(failed("already_reported"), true)).toBe("the server's own words");
    expect(reportFailure(new Error("boom"), false)).toBe("Something went wrong. Try again.");
  });
});

describe("the build's contact address", () => {
  const repo = (...parts: string[]) => readFileSync(path.join(REPO, ...parts), "utf8");

  test("the app reads it from the build, and both example files carry the development value", () => {
    expect(read("lib", "moderation.ts")).toContain('export const CONTACT_EMAIL = process.env.EXPO_PUBLIC_CONTACT_EMAIL ?? "";');
    expect(repo("infra", ".env.example")).toMatch(/^WEB_CONTACT_EMAIL=contact@korbat\.local$/m);
    expect(repo("apps", "app", ".env.example")).toMatch(/^EXPO_PUBLIC_CONTACT_EMAIL=contact@korbat\.local$/m);
  });

  test("the compose service requires it, and the web image takes it as a build argument, refuses what is no address, refuses a placeholder domain in production, and passes it to the export", () => {
    expect(repo("infra", "compose.yml")).toContain("EXPO_PUBLIC_CONTACT_EMAIL: ${WEB_CONTACT_EMAIL:?set WEB_CONTACT_EMAIL in infra/.env}");
    const dockerfile = repo("infra", "caddy", "Dockerfile");
    expect(dockerfile).toContain("ARG EXPO_PUBLIC_CONTACT_EMAIL");
    expect(dockerfile).toContain('RUN case "$EXPO_PUBLIC_CONTACT_EMAIL" in *?@?*.?*) ;; *) echo "the EXPO_PUBLIC_CONTACT_EMAIL build argument must be an email address" >&2; exit 1;; esac');
    expect(dockerfile).toContain(
      'RUN if [ "$KORBAT_ENV" = "production" ]; then case "$(printf %s "${EXPO_PUBLIC_CONTACT_EMAIL##*@}" | tr A-Z a-z)" in *.local|*.localhost|*.test|*.invalid|*.example|example.com|example.org|example.net) echo "EXPO_PUBLIC_CONTACT_EMAIL is a placeholder address; a production build needs the address people can write to" >&2; exit 1;; esac; fi',
    );
    expect(dockerfile).toContain(
      'RUN cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY="$EXPO_PUBLIC_TURNSTILE_SITE_KEY" EXPO_PUBLIC_BADGE="$EXPO_PUBLIC_BADGE" EXPO_PUBLIC_CONTACT_EMAIL="$EXPO_PUBLIC_CONTACT_EMAIL" EXPO_PUBLIC_CONTACT_POINT="$EXPO_PUBLIC_CONTACT_POINT" EXPO_PUBLIC_HOME_STATE="$EXPO_PUBLIC_HOME_STATE" npx expo export --platform web',
    );
    // The refusals come before the export, and the production one after KORBAT_ENV is declared.
    expect(dockerfile.indexOf("ARG KORBAT_ENV")).toBeLessThan(dockerfile.indexOf("is a placeholder address"));
    expect(dockerfile.indexOf("is a placeholder address")).toBeLessThan(dockerfile.indexOf("npx expo export"));
  });
});

// UI Task 4: Report moved into the post card's More menu (UI design, decision 12); imported here, below, so the lines above keep their numbers.
import { PostMenuPanel } from "../src/components/social/PostMenu";
// UI Task 5: the profile's More menu, imported here for the same reason.
import { ProfileMenuPanel } from "../src/components/social/ProfileMenu";
```

### Replace `apps/app/test/shell.test.tsx` (whole file)

```tsx
import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Text } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { MeResponse } from "@korbat/contracts";
import { ErrorBoundary } from "../src/app/_layout";
import NotFound from "../src/app/+not-found";
import Bookmarks from "../src/app/bookmarks";
import Followers from "../src/app/u/[handle]/followers";
import Following from "../src/app/u/[handle]/following";
import { AboutCard } from "../src/components/AboutCard";
import { AppShell } from "../src/components/AppShell";
import { ToastCard } from "../src/components/ToastCard";
import { toast, Toaster } from "../src/components/toast";
import { pageTitle } from "../src/lib/page-title";
import { createShellScroll, headerOffset, softReset } from "../src/lib/shell-scroll";
import { setComposeButtonShown, toastDuration, toastOffset, TOAST_LIMIT } from "../src/lib/toast-rules";
import { TITLE_WORDS, UI_WORDS } from "../src/lib/ui-words";
import type { LayoutKind } from "../src/theme/layout";

/**
 * The shell, the navigation and what every screen gets from them (UI design, sections 7 and 8.1, Task 3): the nav at each
 * of the four layouts with one current item, the context column, the skip link and the offline banner, the not-found
 * screen and the error boundary, document titles, the toast API over a fake toaster, the header that hides on a phone
 * and the soft reset. Screens are server-rendered as the other test files render theirs; what a static render cannot do
 * (scroll, press) is driven through the pure functions the components use.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");
const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

/** What the component under test reads: the path, the session, the layout and the route's parameters; each test sets them. */
const shell = vi.hoisted(() => ({
  pathname: "/",
  state: { status: "signed-out" } as unknown,
  kind: "phone" as string,
  params: {} as Record<string, string>,
}));

// expo-router cannot load in Node: Link with `asChild` hands its child the href, and its onPress too, as expo-router does,
// so a test can find the handler the shell gives the current Home item. Nothing navigates.
vi.mock("expo-router", () => ({
  Link: ({ href, children, onPress }: { href: string; children: ReactElement; onPress?: unknown }) => cloneElement(children, { href, onPress } as object),
  Redirect: () => null,
  Stack: () => null,
  router: { push: () => undefined, replace: () => undefined, back: () => undefined, canGoBack: () => false },
  useLocalSearchParams: () => shell.params,
  usePathname: () => shell.pathname,
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: shell.state, refresh: async () => shell.state }) }));
// A post card's images reach native modules that do not load in Node; no image is drawn here.
vi.mock("expo-image", () => ({ Image: () => null }));
// The layout comes from the window's width, which a static render does not have: the test names the kind.
vi.mock("@/theme/layout", async (importOriginal) => ({ ...(await importOriginal<object>()), useLayout: () => shell.kind }));
// The title goes into the document's head through expo-router/head; here it is drawn in place, so a test can read it.
vi.mock("expo-router/head", () => ({ default: ({ children }: { children: ReactNode }) => createElement("template", { "data-head": "" }, children) }));

/** The fake toaster: sonner's custom toasts and dismissals are recorded, and its Toaster keeps the props it was given. */
const sonner = vi.hoisted(() => ({ custom: vi.fn(), dismiss: vi.fn(), props: [] as Record<string, unknown>[] }));
vi.mock("sonner", async () => {
  const { createElement: element } = await import("react");
  return {
    toast: Object.assign(vi.fn(), { custom: sonner.custom, dismiss: sonner.dismiss }),
    Toaster: (props: Record<string, unknown>) => {
      sonner.props.push(props);
      return element("section", { "data-fake-toaster": "" });
    },
  };
});

const html = (element: ReactElement): string => renderToStaticMarkup(element);
/** The markup's text as a reader sees it: tags dropped, spaces collapsed. */
const textOf = (markup: string): string => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
/** The part of the markup inside the first element whose opening tag matches `open`, up to its closing tag of the same name. */
function inside(markup: string, open: RegExp): string {
  const found = open.exec(markup);
  if (!found) return "";
  const tag = /^<([a-z0-9]+)/.exec(found[0])![1]!;
  let depth = 0;
  const pattern = new RegExp(`<(/?)${tag}(?=[ >])[^>]*>`, "g");
  pattern.lastIndex = found.index;
  for (let match = pattern.exec(markup); match; match = pattern.exec(markup)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return markup.slice(found.index, match.index + match[0].length);
  }
  return markup.slice(found.index);
}
/** Every anchor's opening tag. */
const anchors = (markup: string): string[] => markup.match(/<a\b[^>]*>/g) ?? [];
const hrefOf = (tag: string): string => /href="([^"]*)"/.exec(tag)?.[1] ?? "";

const ME = { user: { id: "00000000-0000-4000-8000-000000000001", onboarded: true }, profile: { handle: "ada" }, standing: null } as unknown as MeResponse;
const signedIn = () => ({ status: "signed-in", me: ME });

afterEach(() => {
  shell.pathname = "/";
  shell.state = { status: "signed-out" };
  shell.kind = "phone";
  shell.params = {};
  vi.mocked(useReducedMotion).mockReturnValue(false);
  vi.unstubAllGlobals();
  setComposeButtonShown(false);
});

const KINDS: LayoutKind[] = ["phone", "tablet", "desktop", "wide"];

describe("the navigation (sections 7.1 to 7.3)", () => {
  test("at every layout the nav is a landmark named Main whose items are real anchors, in today's order and hrefs, with one current item", () => {
    for (const kind of KINDS) {
      shell.kind = kind;
      shell.state = signedIn();
      shell.pathname = "/bookmarks";
      const out = html(<AppShell>{null}</AppShell>);
      expect(out, kind).toContain(`data-layout="${kind}"`);
      const nav = inside(out, /<nav\b[^>]*aria-label="Main"[^>]*>/);
      expect(nav, kind).not.toBe("");
      expect(anchors(nav).map(hrefOf), kind).toEqual(["/", "/bookmarks", "/u/ada", "/settings/security"]);
      const current = anchors(nav).filter((tag) => tag.includes('aria-current="page"'));
      expect(current, kind).toHaveLength(1);
      expect(current[0], kind).toContain('href="/bookmarks"');
      // The current item's icon is drawn at the strong stroke, a shape cue beside its colour; the others at the usual one.
      // (Its pill and bar are classes, which a static render does not draw: the browser check measures them.)
      const items = nav.split(/(?=<a\b)/).slice(1);
      expect(items.filter((item) => item.includes('stroke-width="2.25"')).map((item) => hrefOf(item)), kind).toEqual(["/bookmarks"]);
      expect(items.filter((item) => item.includes('stroke-width="1.75"')).map((item) => hrefOf(item)), kind).toEqual(["/", "/u/ada", "/settings/security"]);
      expect(textOf(nav), kind).toContain(UI_WORDS["nav.bookmarks"]);
    }
  });

  test("signed out the nav holds Home and Sign in; while the session loads it holds Home alone, so Sign in never flashes", () => {
    for (const kind of KINDS) {
      shell.kind = kind;
      shell.state = { status: "signed-out" };
      expect(anchors(inside(html(<AppShell>{null}</AppShell>), /<nav\b[^>]*>/)).map(hrefOf), kind).toEqual(["/", "/signin"]);
      shell.state = { status: "loading" };
      const loading = inside(html(<AppShell>{null}</AppShell>), /<nav\b[^>]*>/);
      expect(anchors(loading).map(hrefOf), kind).toEqual(["/"]);
      expect(textOf(loading), kind).not.toContain(UI_WORDS["nav.signin"]);
    }
  });

  test("Home is current on / only, Settings on every settings page, and the wordmark is the rail's k and the full nav's korbat", () => {
    shell.state = signedIn();
    shell.kind = "wide";
    shell.pathname = "/settings/cases";
    const current = (out: string) => anchors(inside(out, /<nav\b[^>]*>/)).filter((tag) => tag.includes('aria-current="page"')).map(hrefOf);
    expect(current(html(<AppShell>{null}</AppShell>))).toEqual(["/settings/security"]);
    shell.pathname = "/";
    expect(current(html(<AppShell>{null}</AppShell>))).toEqual(["/"]);
    shell.pathname = "/u/ada/followers";
    expect(current(html(<AppShell>{null}</AppShell>))).toEqual(["/u/ada"]);
    expect(textOf(inside(html(<AppShell>{null}</AppShell>), /<nav\b[^>]*>/)).startsWith(UI_WORDS["frame.wordmark"])).toBe(true);
    shell.kind = "tablet";
    expect(textOf(inside(html(<AppShell>{null}</AppShell>), /<nav\b[^>]*>/)).startsWith("k ")).toBe(true);
  });

  test("the skip link comes first, says where it goes, and the main column it moves to takes the focus", () => {
    for (const kind of KINDS) {
      shell.kind = kind;
      const out = html(<AppShell>{null}</AppShell>);
      const first = anchors(out)[0] ?? "";
      expect(hrefOf(first), kind).toBe("#main");
      expect(textOf(inside(out, /<a\b[^>]*href="#main"[^>]*>/)), kind).toBe(UI_WORDS["shell.skip"]);
      const main = /<main\b[^>]*>/.exec(out)?.[0] ?? "";
      expect(main, kind).toContain('id="main"');
      expect(main, kind).toContain('tabindex="-1"');
      // The skip link, then the nav, then the main column, in that order in the page.
      expect(out.indexOf('href="#main"'), kind).toBeLessThan(out.indexOf("<nav"));
      expect(out.indexOf("<nav"), kind).toBeLessThan(out.indexOf("<main"));
    }
  });

  test("the shell keeps the standing banner and the floating compose button it is given", () => {
    const source = read("components", "AppShell.tsx");
    expect(source).toContain("<StandingBanner standing={state.me.standing} />");
    shell.kind = "phone";
    expect(html(<AppShell floating={<Text>floating control</Text>}>{null}</AppShell>)).toContain("floating control");
  });
});

describe("the context column (section 7.3, decision 14)", () => {
  test("at desktop and wide a complementary landmark, About korbat, holds the handle box and then How korbat works; narrower there is none", () => {
    for (const kind of KINDS) {
      shell.kind = kind;
      const out = html(<AppShell>{null}</AppShell>);
      const column = inside(out, /<aside\b[^>]*>|<[a-z]+\b[^>]*role="complementary"[^>]*>/);
      if (kind === "phone" || kind === "tablet") {
        expect(column, kind).toBe("");
        continue;
      }
      expect(column, kind).toContain(`aria-label="${UI_WORDS["shell.about"]}"`);
      const text = textOf(column);
      expect(text.indexOf(UI_WORDS["handle.title"]), kind).toBeGreaterThanOrEqual(0);
      expect(text.indexOf(UI_WORDS["handle.title"]), kind).toBeLessThan(text.indexOf(UI_WORDS["shell.howTitle"]));
      expect(column, kind).toContain(`aria-label="${UI_WORDS["handle.field"]}"`);
      expect(text, kind).not.toContain("Popular now");
    }
  });

  test("How korbat works says the three lines and links the rules, transparency and how Explore works", () => {
    const out = html(<AboutCard />);
    expect(out).toMatch(new RegExp(`<h2[^>]*>${UI_WORDS["shell.howTitle"]}</h2>`));
    const text = textOf(out).replace(/&#x27;/g, "'");
    for (const line of [UI_WORDS["shell.how1"], UI_WORDS["shell.how2"], UI_WORDS["shell.how3"]]) expect(text).toContain(line);
    expect(anchors(out).map(hrefOf)).toEqual(["/rules", "/transparency", "/explore/about"]);
  });

  test("Popular now has left the shell, and nothing calls Explore for it", () => {
    expect(read("components", "AppShell.tsx")).not.toContain("PopularNow");
    expect(read("lib", "social.ts")).not.toContain("popular");
  });
});

describe("offline (section 8.11)", () => {
  test("while the browser says it is offline a polite status at the top of the main column says so; online it says nothing", () => {
    shell.kind = "wide";
    vi.stubGlobal("navigator", { onLine: false });
    const offline = html(<AppShell>{null}</AppShell>);
    const status = inside(offline, /<[a-z]+\b[^>]*role="status"[^>]*>/);
    expect(status).toContain('aria-live="polite"');
    expect(textOf(status)).toBe(UI_WORDS["offline.title"]);
    expect(offline.indexOf("<main")).toBeLessThan(offline.indexOf('role="status"'));
    vi.stubGlobal("navigator", { onLine: true });
    expect(textOf(html(<AppShell>{null}</AppShell>))).not.toContain(UI_WORDS["offline.title"]);
  });
});

describe("the not-found screen and the error boundary (section 8.11)", () => {
  test("a mistyped address shows, inside the shell, that the page does not exist, with Go to Home, under its own title", () => {
    shell.kind = "wide";
    shell.pathname = "/nowhere";
    const out = html(<NotFound />);
    expect(out).toContain("<nav");
    expect(out).toMatch(/<h1[^>]*>This page doesn&#x27;t exist<\/h1>/);
    expect(anchors(inside(out, /<main\b[^>]*>/)).map(hrefOf)).toContain("/");
    expect(textOf(out)).toContain(UI_WORDS["notFound.action"]);
    expect(out).toContain(`<title>${TITLE_WORDS["title.notFound"]}</title>`);
  });

  test("the boundary draws the public frame with its words, Try again and Go to Home, and nothing of the error", () => {
    const retry = vi.fn(async () => undefined);
    const out = html(<ErrorBoundary error={new Error("secret detail of a broken screen")} retry={retry} />);
    expect(out).toContain("<header");
    expect(out).toContain("<main");
    expect(out).toMatch(new RegExp(`<h1[^>]*>${UI_WORDS["crash.title"]}</h1>`));
    expect(textOf(out)).toContain(UI_WORDS["crash.body"]);
    expect(textOf(out)).toContain(UI_WORDS["crash.retry"]);
    expect(textOf(out)).toContain(UI_WORDS["notFound.action"]);
    expect(out).not.toContain("secret detail");
    // Nothing about the error leaves the device: the layout sends nothing anywhere.
    expect(read("app", "_layout.tsx")).not.toMatch(/fetch\(|api\(|sendBeacon|console\./);
  });

  test("the root layout puts the gesture root and the safe areas outside, and the one Toaster inside the theme", () => {
    const layout = read("app", "_layout.tsx");
    expect(layout.indexOf("<GestureHandlerRootView")).toBeLessThan(layout.indexOf("<SafeAreaProvider"));
    expect(layout.indexOf("<SafeAreaProvider")).toBeLessThan(layout.indexOf("<ThemeProvider"));
    expect(layout.match(/<Toaster \/>/g)).toHaveLength(1);
    expect(layout.indexOf("<ThemeProvider")).toBeLessThan(layout.indexOf("<Toaster />"));
    expect(layout.indexOf("<Toaster />")).toBeLessThan(layout.indexOf("</ThemeProvider>"));
    expect(layout).toContain("export function ErrorBoundary({ error, retry }: ErrorBoundaryProps)");
  });
});

describe("titles (section 8.1, decision 16)", () => {
  test("every title names a kind of screen, ends with korbat and holds no account", () => {
    for (const [key, title] of Object.entries(TITLE_WORDS)) {
      expect(title, key).toMatch(/ - korbat$/);
      expect(title, key).not.toMatch(/@|\{/);
    }
    expect(pageTitle("title.followers")).toBe("Followers - korbat");
  });

  test("the screens this task draws set their titles, and a profile's lists never name the account in theirs", () => {
    shell.kind = "phone";
    shell.state = signedIn();
    shell.params = { handle: "grace" };
    const title = (out: string) => /<title>([^<]*)<\/title>/.exec(out)?.[1];
    expect(title(html(<Bookmarks />))).toBe(TITLE_WORDS["title.bookmarks"]);
    const followers = html(<Followers />);
    expect(title(followers)).toBe(TITLE_WORDS["title.followers"]);
    expect(title(html(<Following />))).toBe(TITLE_WORDS["title.following"]);
    // The account is named in the page, as its h1's neighbour, and not in the tab's title.
    expect(followers).toMatch(new RegExp(`<h1[^>]*>${UI_WORDS["followers.title"]}</h1>`));
    expect(textOf(followers)).toContain("@grace");
  });

  test("the screens that waited outside the shell for the session load inside it, with skeleton rows", () => {
    shell.kind = "phone";
    shell.state = { status: "loading" };
    shell.params = { handle: "grace" };
    for (const [name, out] of [
      ["bookmarks", html(<Bookmarks />)],
      ["followers", html(<Followers />)],
    ] as const) {
      expect(out, name).toContain("<nav");
      expect(textOf(out), name).toContain(name === "bookmarks" ? UI_WORDS["feed.loading"] : UI_WORDS["accounts.loading"]);
      expect(out, name).not.toContain('role="progressbar"');
    }
    for (const file of [["app", "bookmarks.tsx"], ["app", "report.tsx"], ["app", "notice", "[ref].tsx"], ["app", "u", "[handle]", "followers.tsx"], ["app", "u", "[handle]", "following.tsx"]]) {
      expect(read(...file), file.join("/")).not.toContain("<Loading />");
    }
  });
});

describe("toasts (sections 5.4 and 6.16)", () => {
  test("show() hands sonner one custom toast for four seconds, eight with an action and six for a rollback", () => {
    expect(toastDuration({ message: "Link copied" })).toBe(4000);
    expect(toastDuration({ message: "Your reply was sent", action: { label: "View", onPress: () => undefined } })).toBe(8000);
    expect(toastDuration({ message: "Couldn't like this post. Try again.", tone: "rollback" })).toBe(6000);
    sonner.custom.mockClear();
    toast.show({ message: "Link copied" });
    expect(sonner.custom).toHaveBeenCalledTimes(1);
    const [draw, options] = sonner.custom.mock.calls[0] as [(id: string | number) => ReactElement, { duration: number }];
    expect(options.duration).toBe(4000);
    const out = html(draw("t1"));
    expect(textOf(out)).toBe("Link copied");
    expect(out).toContain("lucide-circle-check");
    expect(out).not.toContain('role="button"');
  });

  test("an action is a button that runs and puts the toast away; a rollback carries the error icon", () => {
    sonner.custom.mockClear();
    sonner.dismiss.mockClear();
    const view = vi.fn();
    toast.show({ message: "Your reply was sent", action: { label: "View", onPress: view } });
    const [draw, options] = sonner.custom.mock.calls[0] as [(id: string | number) => ReactElement<{ onAction?: () => void }>, { duration: number }];
    expect(options.duration).toBe(8000);
    const card = draw("t2");
    expect(html(card)).toMatch(/role="button"[^>]*>|<button\b/);
    expect(textOf(html(card))).toBe("Your reply was sent View");
    card.props.onAction?.();
    expect(view).toHaveBeenCalledTimes(1);
    expect(sonner.dismiss).toHaveBeenCalledWith("t2");
    expect(html(<ToastCard message="Couldn't save this post. Try again." tone="rollback" />)).toContain("lucide-circle-alert");
  });

  test("the Toaster keeps three at most at the bottom centre, above the tab bar and the compose button on phones", () => {
    expect(TOAST_LIMIT).toBe(3);
    expect(toastOffset({ layout: "phone", bottomInset: 0, composeButton: false })).toBe(72);
    expect(toastOffset({ layout: "phone", bottomInset: 20, composeButton: true })).toBe(160);
    expect(toastOffset({ layout: "wide", bottomInset: 20, composeButton: true })).toBe(24);
    sonner.props.length = 0;
    shell.kind = "phone";
    html(<Toaster />);
    setComposeButtonShown(true);
    html(<Toaster />);
    shell.kind = "wide";
    html(<Toaster />);
    const [phone, compose, wide] = sonner.props;
    expect(phone).toMatchObject({ position: "bottom-center", visibleToasts: 3, offset: { bottom: 72 }, mobileOffset: { bottom: 72 } });
    expect(compose).toMatchObject({ offset: { bottom: 140 }, mobileOffset: { bottom: 140 } });
    expect(wide).toMatchObject({ offset: { bottom: 24 } });
    expect((phone!.toastOptions as { className?: string }).className ?? "").not.toContain("k-still");
  });

  test("under reduced motion every toast takes k-still, whose rule in the fonts' style element keeps it from moving", () => {
    vi.mocked(useReducedMotion).mockReturnValue(true);
    sonner.props.length = 0;
    html(<Toaster />);
    expect((sonner.props[0]!.toastOptions as { className?: string }).className).toBe("k-still");
    expect(read("theme", "fonts.web.ts")).toContain(".k-still { transform: none !important; transition: opacity 150ms ease !important; }");
  });

  test("on native the same API announces the sentence, with the action's word, to the screen reader", () => {
    const native = read("components", "toast.tsx");
    expect(native).toContain('from "sonner-native"');
    expect(native).toContain("AccessibilityInfo.announceForAccessibility(");
  });
});

describe("the header that hides, and the soft reset (sections 5.2 and 7.1, review ruling 8)", () => {
  test("headerOffset(): down past the header's height hides it, any scroll up shows it, the top always shows it", () => {
    const at = (previousY: number, y: number, offset = 0) => headerOffset({ previousY, y, height: 60, offset });
    expect(at(0, 30)).toBe(0);
    expect(at(30, 90)).toBe(-60);
    expect(at(90, 120, -60)).toBe(-60);
    expect(at(120, 110, -60)).toBe(0);
    expect(at(110, 140, 0)).toBe(-60);
    expect(at(40, 50, 0)).toBe(0);
    expect(at(10, -5, -60)).toBe(0);
    expect(headerOffset({ previousY: 0, y: 500, height: 0, offset: 0 })).toBe(0);
  });

  test("the shell's scroll moves the header only when it changes, only on phones, and never under reduced motion", () => {
    const moves: number[] = [];
    const scrolled: boolean[] = [];
    const store = createShellScroll({ moveHeader: (offset) => moves.push(offset), markScrolled: (value) => scrolled.push(value) });
    store.settings = { hides: true, reduced: false };
    store.setHeight(60);
    for (const y of [20, 80, 120, 100, 160, 0]) store.onScroll(y);
    expect(moves).toEqual([-60, 0, -60, 0]);
    expect(scrolled).toEqual([true, false]);
    // Focus inside the header shows it.
    store.onScroll(200);
    store.show();
    expect(moves.slice(-2)).toEqual([-60, 0]);
    moves.length = 0;
    store.settings = { hides: false, reduced: true };
    for (const y of [20, 300, 600]) store.onScroll(y);
    expect(moves).toEqual([]);
  });

  test("pressing the current Home item again brings the registered list to its newest post, smooth, or at once under reduced motion", () => {
    const store = createShellScroll({ moveHeader: () => undefined, markScrolled: () => undefined });
    const toTop = vi.fn();
    const unregister = store.register({ toTop });
    const event = { preventDefault: vi.fn() };
    softReset(event, store);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(toTop).toHaveBeenLastCalledWith(true);
    store.settings = { hides: false, reduced: true };
    softReset(event, store);
    expect(toTop).toHaveBeenLastCalledWith(false);
    unregister();
    expect(store.toTop()).toBe(false);
    // The shell gives this handler to the current Home item's link, and to no other item.
    const source = read("components", "AppShell.tsx");
    expect(source).toContain("onHomeAgain: (event) => softReset(event, scroll)");
    expect(source).toContain('const again = current && item.href === "/" ? onHomeAgain : undefined;');
  });

  test("the lists hand the shell their scroll and their way to the top, and the three screens title themselves through ScreenHeader", () => {
    const list = read("components", "list", "List.tsx");
    expect(list).toContain("scroll.onScroll(event);");
    expect(list).toContain("scroll.register(");
    for (const file of [["app", "bookmarks.tsx"], ["app", "u", "[handle]", "followers.tsx"], ["app", "u", "[handle]", "following.tsx"]]) {
      expect(read(...file), file.join("/")).toContain("<ScreenHeader");
    }
    const header = read("components", "ScreenHeader.tsx");
    expect(header).toContain('as="h1"');
    expect(header).toContain('variant="display-2"');
    expect(header).toContain('UI_WORDS["shell.back"]');
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
packages/db test:       Tests  102 passed (102)
packages/contracts test:       Tests  459 passed (459)
packages/media-protocol test:       Tests  26 passed (26)
packages/rules test:       Tests  134 passed (134)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/interface-experience-ui/write_blocks.py docs/superpowers/prompts/interface-experience-ui/05-feeds-threads-profiles.md 3
```

Expected: 28 lines starting with `wrote`, one for each file below.

### Create `apps/app/src/components/kit/Tabs.tsx`

```tsx
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useHaptics } from "@/lib/haptics";
import { useMotion } from "@/lib/motion";
import { cn } from "@/theme/cn";
import { useTheme } from "@/theme/ThemeProvider";
import { FOCUS_RING, HOVER_WASH, lastInputWasKeyboard, pressDelay } from "./interaction";
import { Text } from "./Text";

/**
 * Tabs (UI design, section 6.10): Home's Following, Latest and Explore, a profile's Posts, Replies and Likes, and later
 * Settings' and Cases' lists. A tab list named by `label` (required, so tsc refuses a nameless one), a tab per entry with
 * aria-selected and its label as its first text, and one tab stop: the selected tab; on the web Left and Right move and
 * select at once, wrapping, and Home and End jump. The content below is a TabPanel named by the selected tab.
 *
 * The look: each label in body-strong, ink-low, and ink-high when selected, over a 2 px accent underline that moves and
 * resizes to the chosen tab on the spring-snap for a pointer, and jumps for a key and under reduced motion (5.1: keyboard
 * actions do not animate). The underline is a border, which forced colours keep. The row scrolls sideways when the
 * labels are wider than the column and never wraps into two rows. Choosing a tab plays the selection haptic.
 */

export interface TabItem<K extends string> {
  key: K;
  label: string;
}

export interface TabsProps<K extends string> {
  /** The tab list's name. */
  label: string;
  tabs: readonly TabItem<K>[];
  selected: K;
  onSelect: (key: K) => void;
  /** The id of the TabPanel the tabs control. */
  panelId: string;
}

/** A tab's id, which its panel is named by. */
export const tabId = (panelId: string, key: string): string => `${panelId}-tab-${key}`;

/** Where a key moves the selection among `count` tabs from `current`: Left and Right wrap, Home and End jump; null for any other key. */
export function tabMove(current: number, key: string, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** The underline is a bar this wide, scaled to the tab's width, so only its transform moves (5.1). */
const BAR = 100;

export function Tabs<K extends string>({ label, tabs, selected, onSelect, panelId }: TabsProps<K>) {
  const motion = useMotion();
  const haptic = useHaptics();
  const { colors } = useTheme();
  // Each tab's measured width. Its place is the sum of the widths before it (the tabs sit side by side with no gap),
  // since react-native-web reports a layout when a size changes and not when a tab only moves (a tab added before it).
  const widths = useRef(new Map<string, number>());
  const [measured, setMeasured] = useState(0);
  const x = useSharedValue(0);
  const width = useSharedValue(0);
  const shown = useRef(false);

  // The underline goes to the selected tab once both are measured: on a spring for a pointer, at once for a key, under
  // reduced motion and the first time. A value already at its target is left alone (Reanimated would not start it).
  const order = tabs.map((tab) => tab.key).join(" ");
  useEffect(() => {
    const at = tabs.findIndex((tab) => tab.key === selected);
    const before = tabs.slice(0, at + 1).map((tab) => widths.current.get(tab.key));
    if (at < 0 || before.some((wide) => wide === undefined)) return;
    const frame = { x: before.slice(0, at).reduce<number>((sum, wide) => sum + wide!, 0), width: before[at]! };
    const still = !shown.current || motion.reduced || lastInputWasKeyboard();
    shown.current = true;
    for (const [value, target] of [
      [x, frame.x],
      [width, frame.width],
    ] as const) {
      if (value.value === target) continue;
      value.value = still ? target : withSpring(target, motion.spring("springSnap"));
    }
  }, [selected, measured, motion.reduced, order]);

  const bar = useAnimatedStyle(() => ({
    opacity: width.value > 0 ? 1 : 0,
    transform: [{ translateX: x.value + (width.value - BAR) / 2 }, { scaleX: width.value / BAR }],
  }));

  const choose = (key: K) => {
    if (key === selected) return;
    haptic("selection");
    onSelect(key);
  };

  // Left and Right select at once and move the focus with the selection; the underline jumps (a key never animates).
  const keys = (event: KeyboardEvent) => {
    const next = tabMove(
      tabs.findIndex((tab) => tab.key === selected),
      event.key,
      tabs.length,
    );
    if (next === null) return;
    event.preventDefault();
    const key = tabs[next]!.key;
    choose(key);
    (document.getElementById(tabId(panelId, key)) as HTMLElement | null)?.focus();
  };

  const measure = (key: K) => (event: LayoutChangeEvent) => {
    const wide = event.nativeEvent.layout.width;
    if (widths.current.get(key) === wide) return;
    widths.current.set(key, wide);
    setMeasured((count) => count + 1);
  };

  return (
    // The room around the row keeps each tab's focus ring inside the scroll view, which clips what overflows it.
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 4, paddingHorizontal: 4 }} className="-mx-1">
      <View role="tablist" aria-label={label} {...(Platform.OS === "web" ? ({ onKeyDown: keys } as object) : {})} className="flex-row">
        {tabs.map((tab) => {
          const on = tab.key === selected;
          return (
            <Pressable
              key={tab.key}
              nativeID={tabId(panelId, tab.key)}
              accessibilityRole="tab"
              aria-selected={on}
              aria-controls={panelId}
              tabIndex={on ? 0 : -1}
              onPress={() => choose(tab.key)}
              onLayout={measure(tab.key)}
              {...pressDelay(0)}
              className={cn("min-h-[44px] justify-center rounded-control px-3 pb-2.5 pt-2 active:bg-surface-2", HOVER_WASH, FOCUS_RING)}
            >
              <Text variant="body-strong" tone={on ? "high" : "low"} maxFontSizeMultiplier={1.5}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
        <Animated.View
          pointerEvents="none"
          aria-hidden
          style={[{ position: "absolute", left: 0, bottom: 0, width: BAR, height: 0, borderTopWidth: 2, borderColor: colors.accent }, bar]}
        />
      </View>
    </ScrollView>
  );
}

/** The content under Tabs: a tab panel named by the selected tab. */
export function TabPanel({ panelId, selected, children }: { panelId: string; selected: string; children: ReactNode }) {
  return (
    <View role="tabpanel" nativeID={panelId} aria-labelledby={tabId(panelId, selected)} className="flex-1">
      {children}
    </View>
  );
}
```

### Create `apps/app/src/components/list/List.tsx`

```tsx
import { memo, useEffect, useImperativeHandle, useMemo, useRef, type ReactElement, type Ref } from "react";
import { FlatList, Platform, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ViewToken } from "react-native";
import { dataAttribute } from "@/components/kit/interaction";
import { useShellScroll } from "@/lib/shell-scroll";
import { ANCHOR_PROPS, keepAnchor, type AnchorKeeper, type ViewAnchor } from "./anchor";

/**
 * Every list of the app scrolls through this one wrapper (UI design, sections 7.5, 10 and 11.1), which owns FlatList's
 * props and their tuning in one place, after Bluesky's PostFeed: about a screen of rows drawn first, a window of 7
 * screens on the web and 9 on native, five rows a batch every 40 ms, clipped views on Android only, and the next page
 * asked two screens before the end when the reader loads older posts automatically. FlatList stays on every platform:
 * react-native-web windows its rows too, so a long session keeps a bounded page.
 *
 * - Rows are drawn again only when their key or what `versionOf` says they show changes, so a like redraws one card.
 * - The shell (lib/shell-scroll.tsx) hears the list's scroll, which hides and shows a phone's header, and can bring the
 *   list to its top (the soft reset, which keeps the marker and the pill); on a phone the first row starts below the
 *   floating header.
 * - The anchor (anchor.web.ts, anchor.ts) keeps the row at the top where it is when rows are put above it, shows a row
 *   at the top on request (the reading place, a tab coming back, the thread's focused post), and scrolls to a row (the
 *   new-posts pill).
 * - As a feed (section 10) it is role="feed", busy while a page loads, and Page Down and Page Up move between its
 *   articles' open links; after a row is removed with the focus in it, the focus goes to the next row's open link, or
 *   to the screen's title when none is left.
 */

export interface ListHandle {
  /** The soft reset's scroll to the first row. */
  toTop(animated: boolean): void;
  hold(key: string, offset?: number): void;
  keepNext(): void;
  releaseNext(): void;
  jumpTo(key: string, animated: boolean): void;
  view(): ViewAnchor | null;
}

export interface ListProps<R> {
  rows: readonly R[];
  keyOf: (row: R) => string;
  /** What a row shows beyond its key; the row is drawn again only when one of these values changes. */
  versionOf?: (row: R) => readonly unknown[];
  renderRow: (row: R, index: number) => ReactElement | null;
  header?: ReactElement;
  footer?: ReactElement;
  /** A feed of articles (section 10). */
  feed?: boolean;
  /** The feed's name, when it has one. */
  label?: string;
  /** A page is loading (aria-busy). */
  busy?: boolean;
  /** The next page loads by itself two screens before the end. */
  autoLoad?: boolean;
  onEndReached?: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Rows at least half in view for half a second (the reading place's newest). */
  onViewed?: (keys: string[]) => void;
  /** The row now at the top of the view. */
  onTop?: (key: string | null) => void;
  onScrolled?: () => void;
  handle?: Ref<ListHandle>;
}

/**
 * A function that keeps its identity across renders and always calls the latest `fn`: a row drawn earlier is not drawn
 * again for a new callback (rows redraw by key and version only), so what it was given must reach the current state.
 */
export function useStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn);
  latest.current = fn;
  return useRef((...args: A) => latest.current(...args)).current;
}

/** Half in view for half a second (section 8.2): FlatList's viewability, which react-native-web implements too. */
const VIEWABILITY = { itemVisiblePercentThreshold: 50, minimumViewTime: 500 };

const sameVersion = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

interface CellProps {
  rowKey: string;
  index: number;
  version: readonly unknown[];
  draw: () => ReactElement | null;
}

/** One row, with the key the anchor finds it by; drawn again only when its key, place or version changes. */
const Cell = memo(
  function Cell({ rowKey, draw }: CellProps) {
    return <View {...dataAttribute("row", rowKey)}>{draw()}</View>;
  },
  (before, after) => before.rowKey === after.rowKey && before.index === after.index && sameVersion(before.version, after.version),
);

export function List<R>(props: ListProps<R>) {
  const { rows, keyOf, header, footer, feed = false, autoLoad = false } = props;
  const scroll = useShellScroll();
  const { height } = useWindowDimensions();
  const list = useRef<FlatList<R>>(null);
  // The latest props, read by the callbacks FlatList keeps from its first render and by rows drawn earlier.
  const latest = useRef(props);
  latest.current = props;
  const inset = useRef(scroll.headerSpace);
  inset.current = scroll.headerSpace;

  const [keeper] = useMemo<[AnchorKeeper]>(
    () => [
      keepAnchor({
        node: () => (list.current as unknown as { getScrollableNode?: () => unknown } | null)?.getScrollableNode?.() ?? null,
        inset: () => inset.current,
        indexOf: (key) => latest.current.rows.findIndex((row) => latest.current.keyOf(row) === key),
        scrollToIndex: (index, viewOffset, animated) => list.current?.scrollToIndex({ index, viewOffset, animated }),
        onTop: (key) => latest.current.onTop?.(key),
        feed,
      }),
    ],
    [],
  );
  // The scroll node exists once FlatList has mounted: the keeper starts watching it then.
  useEffect(() => {
    keeper.attach();
    return () => keeper.dispose();
  }, [keeper]);

  // The soft reset and a newly opened feed go to the first row; on the web through the keeper, so a smooth scroll is not
  // stopped halfway by a correction.
  const toTop = (animated: boolean) => {
    if (!keeper.toTop(animated)) list.current?.scrollToOffset({ offset: 0, animated });
  };
  useEffect(() => scroll.register({ toTop }), [scroll.register]);

  useImperativeHandle(
    props.handle,
    () => ({
      toTop,
      hold: (key, offset) => keeper.hold(key, offset),
      keepNext: () => keeper.keepNext(),
      releaseNext: () => keeper.releaseNext(),
      jumpTo: (key, animated) => keeper.jumpTo(key, animated),
      view: () => keeper.view(),
    }),
    [keeper],
  );

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    // The keeper's own scrolls (a place shown, rows kept in place) leave the phone's header where it is.
    if (!keeper.ownScroll(event.nativeEvent.contentOffset.y)) scroll.onScroll(event);
    keeper.record();
    latest.current.onScrolled?.();
  };

  // FlatList refuses a new onViewableItemsChanged after its first render: this one reads the latest props. Native has no
  // scroll node to measure, so its top row is the first one in view.
  const viewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const keys = viewableItems.filter((token) => token.isViewable).map((token) => token.key);
    latest.current.onViewed?.(keys);
    if (Platform.OS !== "web") latest.current.onTop?.(keys[0] ?? null);
  }).current;

  return (
    <FlatList
      ref={list}
      {...ANCHOR_PROPS}
      role={feed ? "feed" : undefined}
      aria-label={feed ? props.label : undefined}
      aria-busy={feed ? props.busy === true : undefined}
      data={rows}
      keyExtractor={keyOf}
      renderItem={({ item, index }) => <Cell rowKey={keyOf(item)} index={index} version={props.versionOf ? props.versionOf(item) : [item]} draw={() => latest.current.renderRow(item, index)} />}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      onScroll={onScroll}
      scrollEventThrottle={16}
      // On a phone the header floats over the list: its first row starts below it.
      contentContainerStyle={scroll.headerSpace > 0 ? { paddingTop: scroll.headerSpace } : undefined}
      initialNumToRender={Math.ceil(height / 120) + 1}
      windowSize={Platform.OS === "web" ? 7 : 9}
      maxToRenderPerBatch={5}
      updateCellsBatchingPeriod={40}
      removeClippedSubviews={Platform.OS === "android"}
      onEndReachedThreshold={autoLoad ? 2 : undefined}
      onEndReached={autoLoad ? () => latest.current.onEndReached?.() : undefined}
      viewabilityConfig={VIEWABILITY}
      onViewableItemsChanged={viewable}
      // A row not measured yet (the reading place further down): to FlatList's estimate of where it is, and the anchor
      // puts it exactly in place once it is drawn.
      onScrollToIndexFailed={(info) => list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false })}
      refreshing={props.onRefresh ? props.refreshing === true : undefined}
      onRefresh={props.onRefresh}
    />
  );
}
```

### Create `apps/app/src/components/list/anchor.ts`

```ts
/**
 * Prepending without a jump, on iOS and Android (UI design, section 7.5): FlatList's maintainVisibleContentPosition keeps
 * the first row in view where it is when rows are put above it, from the second row on (minIndexForVisible 1), so at the
 * very top the reader's own new post still pushes the rows down. The web does this itself in anchor.web.ts, whose pure
 * arithmetic the tests check; this file gives the same keeper with what native needs: a held row is shown with
 * scrollToIndex, and the focus moves (Page Down, a removed row's) are the web's alone, since native has no such keys.
 */

export interface RowBox {
  key: string;
  top: number;
  height: number;
}

export interface ViewAnchor {
  key: string;
  offset: number;
}

export interface AnchorTarget {
  node(): unknown;
  inset(): number;
  indexOf(key: string): number;
  scrollToIndex(index: number, viewOffset: number, animated: boolean): void;
  onTop?(key: string | null): void;
  feed?: boolean;
}

export interface AnchorKeeper {
  attach(): void;
  record(): void;
  hold(key: string, offset?: number): void;
  keepNext(): void;
  releaseNext(): void;
  jumpTo(key: string, animated: boolean): void;
  toTop(animated: boolean): boolean;
  view(): ViewAnchor | null;
  ownScroll(y: number): boolean;
  dispose(): void;
}

export const ANCHOR_PROPS = { maintainVisibleContentPosition: { minIndexForVisible: 1 } };

export function keepAnchor(target: AnchorTarget): AnchorKeeper {
  const show = (key: string, offset: number, animated: boolean) => {
    const index = target.indexOf(key);
    if (index >= 0) target.scrollToIndex(index, target.inset() + offset, animated);
  };
  return {
    attach: () => undefined,
    record: () => undefined,
    hold: (key, offset = 0) => show(key, offset, false),
    keepNext: () => undefined,
    releaseNext: () => undefined,
    jumpTo: (key, animated) => show(key, 0, animated),
    // FlatList scrolls itself to its top on native.
    toTop: () => false,
    view: () => null,
    ownScroll: () => false,
    dispose: () => undefined,
  };
}
```

### Create `apps/app/src/components/list/anchor.web.ts`

```ts
/**
 * Prepending without a jump, on the web (UI design, section 7.5). The page's body does not scroll: each list scrolls in
 * its own node, so the browser's scroll restoration does not apply and korbat keeps the place itself. The list records
 * the row at the top of its view and where that row's top is in the list's content. When the content changes above it
 * (new posts put above, rows above drawn at their real height instead of FlatList's estimate, a header growing), the
 * keeper moves the scroll position by exactly the change before the frame is painted, so the row stays where the reader
 * sees it. It watches the scroll node's children with a MutationObserver (rows added or removed, a spacer resized) and
 * the content's size with a ResizeObserver (an image or a font arriving), and turns off the browser's own anchoring
 * (overflow-anchor), so the two never correct twice. At the very top of the list nothing is corrected, as the browser
 * does too, so a header or the reader's own new post can push the rows down, unless the caller asks to keep the row for
 * the next change (new posts from a poll, which never move what the reader reads). The arithmetic is pure and tested
 * (test/anchor.test.ts); native leaves all of it to FlatList (anchor.ts).
 *
 * The keeper also does the feed pattern's keys (section 10): Page Down and Page Up move the focus to the next or the
 * previous article's open link; and when a row that held the focus is removed (a deleted post), the focus goes to the
 * next row's open link, or to the screen's title when none is left, instead of falling to the page.
 */

/** A row of the list in the list's content: its key, its top and its height, in px. */
export interface RowBox {
  key: string;
  top: number;
  height: number;
}

/** A row and how far its top is below the view's top line (negative once it has started to scroll out). */
export interface ViewAnchor {
  key: string;
  offset: number;
}

/** The first row with at least one pixel below the view's top line `line` (the scroll position plus a floating header's room). */
export function rowAtTop(rows: readonly RowBox[], line: number): RowBox | null {
  return rows.find((row) => row.top + row.height - line >= 1) ?? null;
}

/** Where a row sits in the view, for keeping it when the list comes back. */
export function viewAnchor(row: RowBox, scrollTop: number, inset: number): ViewAnchor {
  return { key: row.key, offset: row.top - (scrollTop + inset) };
}

/** The scroll position that keeps a row on screen after its top in the content moved from `before` to `after`. */
export function anchoredScroll(scrollTop: number, before: number, after: number): number {
  return Math.max(0, scrollTop + after - before);
}

/** The scroll position that shows a row `offset` below the view's top line, within what the list can scroll. */
export function scrollToShow(rowTop: number, inset: number, offset = 0, max = Number.POSITIVE_INFINITY): number {
  return Math.min(Math.max(0, rowTop - inset - offset), Math.max(0, max));
}

/** What the keeper needs from the list. */
export interface AnchorTarget {
  /** The list's scroll node (FlatList's getScrollableNode() on the web), or null before it mounts. */
  node(): unknown;
  /** The room at the top of the view under a floating header (the list's paddingTop on a phone). */
  inset(): number;
  /** A row's index in the list's data, or -1. */
  indexOf(key: string): number;
  /** FlatList's scrollToIndex, which draws a row that is not drawn yet. */
  scrollToIndex(index: number, viewOffset: number, animated: boolean): void;
  /** The row at the top changed (the reading place's top, the pill's count). */
  onTop?(key: string | null): void;
  /** Page Down and Page Up move between articles (a feed). */
  feed?: boolean;
}

export interface AnchorKeeper {
  /** Finds the list's scroll node and starts watching it, once it is mounted. */
  attach(): void;
  /** After a scroll: the row now at the top is the anchor. */
  record(): void;
  /** Shows a row at the top, `offset` below the view's top line, and keeps it there as rows around it are drawn. */
  hold(key: string, offset?: number): void;
  /** The next change keeps the row at the top where it is, even at the very top of the list. */
  keepNext(): void;
  /** The next change is not corrected: the reader's own new post pushes the rows down. */
  releaseNext(): void;
  /** Scrolls until a row's top is at the view's top line: smooth, or at once. */
  jumpTo(key: string, animated: boolean): void;
  /** Scrolls to the first row (the soft reset); false where the keeper has no node to scroll (native). */
  toTop(animated: boolean): boolean;
  /**
   * Whether a scroll event at `y` is the keeper's own (a held row placed, a correction): the shell then neither hides nor
   * shows the phone's header, which follows the reader's scrolling only.
   */
  ownScroll(y: number): boolean;
  /**
   * The row at the top and its offset when the reader last scrolled (or a held row was placed), for the feed cache. It is
   * kept rather than measured, so it still holds while the list draws what replaces its rows (a tab change).
   */
  view(): ViewAnchor | null;
  dispose(): void;
}

/** Native's FlatList prop; the web needs none, the keeper does it. */
export const ANCHOR_PROPS = {};

/** How many times a held row that is not drawn yet is asked for before the hold gives up. */
const HOLD_TRIES = 30;

/** A row key inside an attribute selector: CSS.escape, or, without it, the key with anything but word characters, : and - left out (row keys are ids). */
const escape = (key: string): string => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(key) : key.replace(/[^\w:-]/g, ""));

/** The screen's level-1 heading, made focusable for this once (section 10: focus after a delete with nothing left). */
function focusTitle(): void {
  const title = document.querySelector<HTMLElement>("main h1");
  if (!title) return;
  if (!title.hasAttribute("tabindex")) title.setAttribute("tabindex", "-1");
  title.focus();
}

export function keepAnchor(target: AnchorTarget): AnchorKeeper {
  let node: HTMLElement | null = null;
  /** The anchor row and its top in the content when last seen. */
  let anchor: { key: string; top: number } | null = null;
  let hold: { key: string; offset: number; tries: number } | null = null;
  let next: "normal" | "keep" | "release" = "normal";
  let nextUntil = 0;
  let jumping: ReturnType<typeof setTimeout> | null = null;
  let topKey: string | null = null;
  let last: ViewAnchor | null = null;
  /** Where the keeper last set the scroll position itself, until the scroll event that reports it. */
  let ownAt: number | null = null;
  /** The element that last took the focus inside the list, to see that a removed row held it. */
  let focused: Element | null = null;
  let observers: { disconnect(): void }[] = [];
  const stopHold = () => {
    hold = null;
  };

  const rowTop = (element: Element): number => element.getBoundingClientRect().top - node!.getBoundingClientRect().top + node!.scrollTop;
  const find = (key: string): HTMLElement | null => node!.querySelector<HTMLElement>(`[data-row="${escape(key)}"]`);
  const maxScroll = () => node!.scrollHeight - node!.clientHeight;

  function rows(): RowBox[] {
    const base = node!.getBoundingClientRect().top - node!.scrollTop;
    return [...node!.querySelectorAll<HTMLElement>("[data-row]")].map((element) => {
      const box = element.getBoundingClientRect();
      return { key: element.getAttribute("data-row") ?? "", top: box.top - base, height: box.height };
    });
  }

  function attach(): HTMLElement | null {
    const found = (target.node() as HTMLElement | null) ?? null;
    if (found === node) return node;
    detach();
    node = found;
    if (!node) return null;
    node.style.overflowAnchor = "none";
    const content = (node.firstElementChild as HTMLElement | null) ?? node;
    const mutations = new MutationObserver((records) => {
      refocus(records);
      settle();
    });
    mutations.observe(content, { childList: true, attributes: true, attributeFilter: ["style"] });
    const sizes = new ResizeObserver(settle);
    sizes.observe(content);
    sizes.observe(node);
    observers = [mutations, sizes];
    // The reader's own scroll ends a hold or a jump: what they do wins.
    for (const name of ["wheel", "touchstart", "pointerdown", "keydown"]) node.addEventListener(name, stopHold, { passive: true });
    if (target.feed) node.addEventListener("keydown", pageKeys);
    node.addEventListener("focusin", noteFocus);
    return node;
  }

  function noteFocus(event: FocusEvent): void {
    focused = event.target as Element | null;
  }

  /**
   * A removed row that held the focus (a deleted post, removed after its fade): the focus goes to the open link of the
   * next row that has one, else to the screen's title, rather than falling to the page's body.
   */
  function refocus(records: MutationRecord[]): void {
    const active = document.activeElement;
    if (!focused || (active !== null && active !== document.body)) return;
    for (const record of records) {
      if (![...record.removedNodes].some((removed) => removed === focused || removed.contains(focused))) continue;
      focused = null;
      for (let sibling = record.nextSibling; sibling; sibling = sibling.nextSibling) {
        const link = sibling instanceof HTMLElement ? sibling.querySelector<HTMLElement>("[data-open]") : null;
        if (link) {
          link.focus();
          return;
        }
      }
      focusTitle();
      return;
    }
  }

  function detach(): void {
    for (const observer of observers) observer.disconnect();
    observers = [];
    if (!node) return;
    for (const name of ["wheel", "touchstart", "pointerdown", "keydown"]) node.removeEventListener(name, stopHold);
    node.removeEventListener("keydown", pageKeys);
    node.removeEventListener("focusin", noteFocus);
  }

  function record(): void {
    // While a row is held, the hold says where the anchor is; the top is reported once it is in place.
    if (!attach() || hold) return;
    const row = rowAtTop(rows(), node!.scrollTop + target.inset());
    anchor = row ? { key: row.key, top: row.top } : null;
    last = row ? viewAnchor(row, node!.scrollTop, target.inset()) : null;
    const key = row?.key ?? null;
    if (key !== topKey) {
      topKey = key;
      target.onTop?.(key);
    }
  }

  /** Sets the scroll position, marking the scroll event it causes as the keeper's own. */
  function setScroll(y: number): void {
    node!.scrollTop = y;
    ownAt = node!.scrollTop;
  }

  function endHold(): void {
    hold = null;
    record();
  }

  function settle(): void {
    if (!node) return;
    if (hold) {
      const element = find(hold.key);
      if (!element) {
        // Not drawn yet: FlatList draws it when asked to scroll to it, from its estimate; the next change measures it.
        const index = target.indexOf(hold.key);
        if (index < 0 || hold.tries++ >= HOLD_TRIES) endHold();
        else target.scrollToIndex(index, target.inset() + hold.offset, false);
        return;
      }
      const wanted = scrollToShow(rowTop(element), target.inset(), hold.offset, maxScroll());
      if (Math.abs(node.scrollTop - wanted) >= 0.5) setScroll(wanted);
      anchor = { key: hold.key, top: rowTop(element) };
      // Held until it sits where it should, or it cannot (the list is too short to scroll that far yet, a few tries).
      const exact = Math.abs(rowTop(element) - target.inset() - hold.offset - node.scrollTop) < 1;
      if (exact || hold.tries++ >= HOLD_TRIES) endHold();
      return;
    }
    if (jumping) return;
    if (!anchor) {
      record();
      return;
    }
    const element = find(anchor.key);
    if (!element) {
      // Its row was removed, or scrolled out of what FlatList draws: the row now at the top is the anchor.
      record();
      return;
    }
    const top = rowTop(element);
    const moved = Math.abs(top - anchor.top) >= 0.5;
    // A keep or a release lasts until the change it was asked for moves the row (another change may come first, such as
    // FlatList drawing a batch), or a second has gone by.
    const mode = next !== "normal" && Date.now() < nextUntil ? next : "normal";
    if (moved && mode !== "normal") next = "normal";
    // At the very top nothing is corrected, so what is put above shows, unless the caller keeps the row for this change.
    const correct = mode === "keep" || (mode === "normal" && node.scrollTop > 0);
    if (correct && moved) setScroll(anchoredScroll(node.scrollTop, anchor.top, top));
    anchor = { key: anchor.key, top: rowTop(element) };
  }

  /** Scrolls to `y`: at once, or smoothly, and while a smooth scroll runs nothing is corrected, which would stop it halfway. */
  function scrollTo(y: number, animated: boolean): void {
    if (!animated) {
      node!.scrollTop = y;
      return;
    }
    const done = () => {
      if (jumping) clearTimeout(jumping);
      jumping = null;
      record();
    };
    if (jumping) clearTimeout(jumping);
    // It ends with scrollend, or a second goes by.
    jumping = setTimeout(done, 1000);
    node!.addEventListener("scrollend", done, { once: true });
    // The element's own scroll(): react-native-web gives a list's node a scrollTo() of its own, which reads { x, y }.
    node!.scroll({ top: y, behavior: "smooth" });
  }

  /** Page Down and Page Up: the next or previous article's open link takes the focus; elsewhere the keys scroll. */
  function pageKeys(event: KeyboardEvent): void {
    if (event.key !== "PageDown" && event.key !== "PageUp") return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const articles = [...node!.querySelectorAll<HTMLElement>('[role="article"]')].filter((article) => article.querySelector("[data-open]"));
    if (articles.length === 0) return;
    const current = (document.activeElement as HTMLElement | null)?.closest?.('[role="article"]') ?? null;
    let at = current ? articles.indexOf(current as HTMLElement) : -1;
    if (at < 0) {
      // From outside an article: the first one whose bottom is in view.
      const line = node!.getBoundingClientRect().top + target.inset();
      at = articles.findIndex((article) => article.getBoundingClientRect().bottom > line + 1);
      if (at < 0) return;
      if (event.key === "PageDown") at -= 1;
      else at += 1;
    }
    const goal = articles[event.key === "PageDown" ? at + 1 : at - 1];
    if (!goal) return;
    event.preventDefault();
    goal.querySelector<HTMLElement>("[data-open]")?.focus();
  }

  return {
    attach: () => void attach(),
    record,
    hold(key, offset = 0) {
      hold = { key, offset, tries: 0 };
      if (attach()) settle();
    },
    keepNext() {
      next = "keep";
      nextUntil = Date.now() + 1000;
      record();
    },
    releaseNext() {
      next = "release";
      nextUntil = Date.now() + 1000;
      record();
    },
    jumpTo(key, animated) {
      if (!attach()) return;
      hold = null;
      const element = find(key);
      if (!element) {
        const index = target.indexOf(key);
        if (index >= 0) target.scrollToIndex(index, target.inset(), animated);
        return;
      }
      scrollTo(scrollToShow(rowTop(element), target.inset(), 0, maxScroll()), animated);
    },
    toTop(animated) {
      if (!attach()) return false;
      hold = null;
      scrollTo(0, animated);
      return true;
    },
    view: () => last,
    ownScroll(y) {
      const own = ownAt !== null && Math.abs(y - ownAt) < 1;
      ownAt = null;
      return own;
    },
    dispose() {
      if (jumping) clearTimeout(jumping);
      detach();
      node = null;
    },
  };
}
```

### Create `apps/app/src/components/social/FeedList.tsx`

```tsx
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactElement, type Ref } from "react";
import { AppState, Platform, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import type { PostView, TimelineItem } from "@korbat/contracts";
import { List, useStable, type ListHandle } from "@/components/list/List";
import { errorMessage } from "@/lib/api";
import { useAppearance } from "@/lib/appearance";
import { readFeedCache, writeFeedCache, type FeedSnapshot } from "@/lib/feed-cache";
import { feedRows, timelineTime, trimOlder, type FeedName, type FeedRow } from "@/lib/feed-rows";
import { useMotion } from "@/lib/motion";
import { createNewPosts, gapRows, NEW_LIMIT, newRows, pageVisible, pollActive, type NewPostsClock } from "@/lib/new-posts";
import { createPlaceKeeper, openingRow, readPlace, type Place, type PlaceKeeper, type PlaceRow } from "@/lib/reading-place";
import { useShellScroll } from "@/lib/shell-scroll";
import { social, type Page } from "@/lib/social";
import { UI_WORDS } from "@/lib/ui-words";
import { FeedRowView, feedRowVersion, type PostPlace } from "./FeedRows";
import { NewPostsPill } from "./NewPostsPill";
import { timelineKey } from "./PagedList";
import { PostCard } from "./PostCard";

/**
 * Home's Following and Latest (UI design, sections 7.5 and 8.2; decisions 6 to 9): a feed that keeps the reader's place.
 *
 * - It opens where the reader stopped (lib/reading-place.ts) when that post is among the newest 100: page one is read
 *   with limit=50, and a second page of 50 when the place is not in the first, before anything shows; otherwise, or with
 *   "Open feeds at the newest post", it opens at the newest. The marker sits above the first post the reader had already
 *   seen, and the pill counts the posts above the place that are newer than that.
 * - A tab change keeps it mounted (Home keys it by the reader only): the feed it leaves is kept for the session with its
 *   rows, cursor and place (lib/feed-cache.ts), and the feed it opens comes back from there without asking page one again.
 * - New posts are asked for 30 s after it opens and every 60 s, only while Home is focused and the page visible
 *   (lib/new-posts.ts); they are put above the reader's row, which does not move, and the pill counts them until they
 *   have come into view. All 50 new gives the gap row, which reads the rest on demand.
 * - The reader's own new post goes on top; at the top of the feed it fades in and pushes the rows down (new-own-post).
 * - Load more stays at the end of each page; with "Load older posts automatically" the next page loads two screens
 *   before the end, but not below the marker. Past 300 rows the oldest pages go and come back through Load more.
 *
 * A signed-out reader gets none of the place, the marker, the pill or the asking: Latest as it is, with Load more.
 */

export interface FeedListHandle {
  /** The reader's own new post, on top of this feed. */
  posted(post: PostView): void;
}

/** Home's feeds read 50 posts a page, the most Pagination allows, so the place is found in two pages (decision 9). */
const FEED_LIMIT = 50;

const fetchFeed = (feed: FeedName, cursor?: string, limit = FEED_LIMIT): Promise<Page<TimelineItem>> => (feed === "following" ? social.following(cursor, limit) : social.latest(cursor, limit));

const placeRow = (item: TimelineItem): PlaceRow => ({ key: timelineKey(item), time: timelineTime(item) });

interface FeedState {
  feed: FeedName;
  items: TimelineItem[];
  cursor: string | null;
  ends: [string, string | null][];
  status: "loading" | "ready" | "error";
  error: string | null;
  loadingMore: boolean;
  moreError: string | null;
  gap: { after: string; cursor: string } | null;
  gapBusy: boolean;
  /** The newest post the reader had seen when the feed opened: the marker's place. */
  marker: PlaceRow | null;
  caughtUp: boolean;
  /** New posts above the reader that have not come into view yet: the pill's count. */
  unread: string[];
}

const loading = (feed: FeedName): FeedState => ({
  feed,
  items: [],
  cursor: null,
  ends: [],
  status: "loading",
  error: null,
  loadingMore: false,
  moreError: null,
  gap: null,
  gapBusy: false,
  marker: null,
  caughtUp: false,
  unread: [],
});

/** The last row of a page, with the cursor its page gave: where the oldest rows can be cut and read again. */
const pageEnd = (page: Page<TimelineItem>): [string, string | null][] => (page.items.length > 0 ? [[timelineKey(page.items.at(-1)!), page.nextCursor]] : []);

/** The index of the first post at or below a row of the list: the post the reader sees at the top. */
function postAt(rows: readonly FeedRow<TimelineItem>[], items: readonly TimelineItem[], key: string | null): number {
  const at = key === null ? -1 : rows.findIndex((row) => row.key === key);
  if (at < 0) return -1;
  const post = rows.slice(at).find((row) => row.kind === "post");
  return post ? items.findIndex((item) => timelineKey(item) === post.key) : items.length;
}

export function FeedList({
  feed,
  reader,
  active,
  header,
  onShowLatest,
  handle,
}: {
  feed: FeedName;
  /** The signed-in account's id, or null signed out. */
  reader: string | null;
  /** Home has the focus (a screen above it does not cover it). */
  active: boolean;
  header?: ReactElement;
  onShowLatest: () => void;
  handle?: Ref<FeedListHandle>;
}) {
  const appearance = useAppearance();
  const motion = useMotion();
  const scroll = useShellScroll();
  const [state, setState] = useState<FeedState>(() => loading(feed));
  const [visible, setVisible] = useState(pageVisible);
  const list = useRef<ListHandle>(null);
  const sequence = useRef(0);
  const keeper = useRef<PlaceKeeper | null>(null);
  const clock = useRef<NewPostsClock | null>(null);
  const pendingHold = useRef<{ key: string; offset: number } | null>(null);
  /** The reader's own new post, which fades in where it lands. */
  const own = useRef<string | null>(null);
  // The latest state and settings, for the callbacks that rows and timers keep.
  const latest = useRef({ state, openNewest: appearance.openNewest, rows: [] as FeedRow<TimelineItem>[], top: null as string | null });
  latest.current.state = state;
  latest.current.openNewest = appearance.openNewest;

  /** Page one, and page two when the place is not in page one, then the feed as it opens. */
  const open = useStable(async (place: Place | null, mine: number) => {
    try {
      const first = await fetchFeed(feed);
      if (mine !== sequence.current) return;
      let items = first.items;
      let cursor = first.nextCursor;
      const ends = pageEnd(first);
      const openNewest = latest.current.openNewest;
      let at = openingRow(items.map(placeRow), place, openNewest);
      if (!at && place && !openNewest && cursor !== null && !items.some((item) => timelineKey(item) === place.top.key)) {
        const second = await fetchFeed(feed, cursor);
        if (mine !== sequence.current) return;
        const known = new Set(items.map(timelineKey));
        const both = [...items, ...second.items.filter((item) => !known.has(timelineKey(item)))];
        at = openingRow(both.map(placeRow), place, false);
        if (at) {
          items = both;
          cursor = second.nextCursor;
          ends.push(...pageEnd(second));
        }
      }
      const marker = reader && place ? place.newest : null;
      const top = at ? items.findIndex((item) => timelineKey(item) === at) : 0;
      // The posts above the place that are newer than the newest the reader had seen: the pill counts them.
      const unread = marker ? items.slice(0, top).filter((item) => Date.parse(timelineTime(item)) > Date.parse(marker.time)).map(timelineKey) : [];
      pendingHold.current = at ? { key: at, offset: 0 } : null;
      setState({ ...loading(feed), items, cursor, ends, status: "ready", marker, unread });
    } catch (err) {
      if (mine === sequence.current) setState({ ...loading(feed), status: "error", error: errorMessage(err) });
    }
  });

  // Opening a feed, at mount and on a tab change: from the session's cache, else from the API. Leaving it keeps it in
  // the cache and writes the place. A layout effect, so the old feed's rows are never painted under the new tab.
  useLayoutEffect(() => {
    const mine = ++sequence.current;
    const place = reader ? readPlace(reader, feed) : null;
    keeper.current = createPlaceKeeper(reader, feed, place);
    // The list stays mounted across tabs: the feed it opens starts at its own top, or at the row it was left at.
    list.current?.toTop(false);
    const kept = readFeedCache(reader, feed);
    if (kept) {
      pendingHold.current = kept.view;
      setState({ ...loading(feed), items: kept.items, cursor: kept.cursor, ends: kept.ends, gap: kept.gap, marker: kept.marker, unread: kept.unread, status: "ready" });
    } else {
      setState(loading(feed));
      void open(place, mine);
    }
    return () => {
      sequence.current++;
      const left = latest.current.state;
      if (left.feed === feed && left.status === "ready") {
        const snapshot: FeedSnapshot = { items: left.items, cursor: left.cursor, ends: left.ends, gap: left.gap, marker: left.marker, unread: left.unread, view: list.current?.view() ?? null };
        writeFeedCache(reader, feed, snapshot);
      }
      keeper.current?.hidden();
      keeper.current?.dispose();
      keeper.current = null;
    };
  }, [feed, reader]);

  const result = feedRows({
    items: state.items,
    keyOf: timelineKey,
    timeOf: timelineTime,
    status: state.feed === feed ? state.status : "loading",
    error: state.error,
    cursor: state.cursor,
    loadingMore: state.loadingMore,
    moreError: state.moreError,
    marker: state.marker ? { time: state.marker.time, caughtUp: state.caughtUp } : null,
    gap: state.gap ? { after: state.gap.after, busy: state.gapBusy } : null,
    feed,
    autoLoad: appearance.autoLoad,
  });
  latest.current.rows = result.rows;

  // Once the rows are drawn, the list shows the place (or the row a tab left at); with the marker right above the place,
  // the marker, so "You were here" is the first thing the reader sees.
  useLayoutEffect(() => {
    const hold = pendingHold.current;
    if (!hold || state.status !== "ready") return;
    pendingHold.current = null;
    const at = result.rows.findIndex((row) => row.key === hold.key);
    const key = hold.offset === 0 && at > 0 && result.rows[at - 1]!.kind === "marker" ? "marker" : hold.key;
    list.current?.hold(key, hold.offset);
  }, [state]);

  // The page hidden: the place is written now, and nothing is asked until it is visible again.
  useEffect(() => {
    const change = (shown: boolean) => {
      setVisible(shown);
      if (!shown) keeper.current?.hidden();
    };
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const onVisibility = () => change(pageVisible());
      const onHide = () => keeper.current?.hidden();
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("pagehide", onHide);
      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("pagehide", onHide);
      };
    }
    const subscription = AppState.addEventListener("change", (next) => change(next === "active"));
    return () => subscription.remove();
  }, []);

  /** Rows put above the reader's: from a poll they are unread and keep the reader's row in place. */
  const insertAbove = (added: TimelineItem[], gapCursor: string | null, unread: boolean) => {
    setState((current) => {
      const keys = added.map(timelineKey);
      let items = [...added, ...current.items];
      let cursor = current.cursor;
      let ends = current.ends;
      const trimmed = trimOlder(items, timelineKey, new Map(ends));
      if (trimmed) {
        items = trimmed.items;
        cursor = trimmed.cursor;
        const kept = new Set(items.map(timelineKey));
        ends = ends.filter(([key]) => kept.has(key));
      }
      return {
        ...current,
        items,
        cursor,
        ends,
        unread: unread ? [...keys, ...current.unread] : current.unread,
        caughtUp: unread ? false : current.caughtUp,
        gap: gapCursor && keys.length > 0 ? { after: keys.at(-1)!, cursor: gapCursor } : current.gap,
      };
    });
  };

  /** The poll: page one of 50, and the posts above the first one listed. */
  const ask = useStable(async () => {
    const asked = latest.current.state;
    if (asked.status !== "ready" || asked.feed !== feed) return;
    const page = await fetchFeed(feed, undefined, NEW_LIMIT);
    const now = latest.current.state;
    if (now.status !== "ready" || now.feed !== feed) return;
    const { added, gapCursor } = newRows(page, timelineKey, new Set(now.items.map(timelineKey)));
    if (added.length === 0) return;
    // Nothing the reader reads moves: the row at the top stays where it is, even at the very top.
    list.current?.keepNext();
    insertAbove(added, gapCursor, true);
  });

  // The clock runs per feed for an account, and only while Home is focused, the page visible and the feed in.
  useEffect(() => {
    if (!reader) return undefined;
    const made = createNewPosts(ask);
    clock.current = made;
    return () => {
      made.dispose();
      clock.current = null;
    };
  }, [feed, reader]);
  useEffect(() => {
    clock.current?.setActive(pollActive({ focused: active, signedIn: reader !== null, selected: true, visible }) && state.status === "ready");
  }, [active, visible, state.status, feed, reader]);

  const more = useStable(async () => {
    const current = latest.current.state;
    if (current.loadingMore || current.cursor === null) return;
    const mine = sequence.current;
    setState((now) => ({ ...now, loadingMore: true, moreError: null }));
    try {
      const page = await fetchFeed(feed, current.cursor);
      if (mine !== sequence.current) return;
      setState((now) => {
        const known = new Set(now.items.map(timelineKey));
        return { ...now, items: [...now.items, ...page.items.filter((item) => !known.has(timelineKey(item)))], cursor: page.nextCursor, ends: [...now.ends, ...pageEnd(page)], loadingMore: false };
      });
    } catch (err) {
      if (mine === sequence.current) setState((now) => ({ ...now, loadingMore: false, moreError: errorMessage(err) }));
    }
  });

  const fillGap = useStable(async () => {
    const current = latest.current.state;
    if (!current.gap || current.gapBusy) return;
    const mine = sequence.current;
    setState((now) => ({ ...now, gapBusy: true }));
    try {
      const page = await fetchFeed(feed, current.gap.cursor, NEW_LIMIT);
      if (mine !== sequence.current) return;
      setState((now) => {
        if (!now.gap) return { ...now, gapBusy: false };
        const { added, gapCursor } = gapRows(page, timelineKey, new Set(now.items.map(timelineKey)));
        const at = now.items.findIndex((item) => timelineKey(item) === now.gap!.after) + 1;
        const items = [...now.items.slice(0, at), ...added, ...now.items.slice(at)];
        return { ...now, items, gapBusy: false, gap: gapCursor && added.length > 0 ? { after: timelineKey(added.at(-1)!), cursor: gapCursor } : null };
      });
    } catch {
      // The gap stays, to be pressed again.
      if (mine === sequence.current) setState((now) => ({ ...now, gapBusy: false }));
    }
  });

  const retry = useStable(() => {
    const mine = ++sequence.current;
    setState(loading(feed));
    void open(reader ? readPlace(reader, feed) : null, mine);
  });

  const remove = useStable((key: string) => setState((now) => ({ ...now, items: now.items.filter((item) => timelineKey(item) !== key), unread: now.unread.filter((unread) => unread !== key) })));

  // The row at the top: the place's top, and the unread posts that have come into view leave the pill's count.
  const onTop = useStable((key: string | null) => {
    latest.current.top = key;
    const now = latest.current.state;
    const index = postAt(latest.current.rows, now.items, key);
    if (index >= 0 && index < now.items.length) keeper.current?.top(placeRow(now.items[index]!));
    if (index < 0 || now.unread.length === 0) return;
    const above = new Set(now.items.slice(0, index).map(timelineKey));
    const unread = now.unread.filter((unreadKey) => above.has(unreadKey));
    if (unread.length === now.unread.length) return;
    setState((current) => ({ ...current, unread, caughtUp: current.caughtUp || unread.length === 0 }));
  });

  // Rows half in view for half a second: the place's newest. The marker reached from above, with nothing unread above it,
  // says the reader is caught up.
  const onViewed = useStable((keys: string[]) => {
    const now = latest.current.state;
    const byKey = new Map(now.items.map((item) => [timelineKey(item), item]));
    keeper.current?.seen(keys.flatMap((key) => (byKey.has(key) ? [placeRow(byKey.get(key)!)] : [])));
    if (!keys.includes("marker") || now.caughtUp || now.unread.length > 0) return;
    const rows = latest.current.rows;
    const top = rows.findIndex((row) => row.key === latest.current.top);
    if (top >= 0 && top < rows.findIndex((row) => row.key === "marker")) setState((current) => ({ ...current, caughtUp: true }));
  });

  const scrolled = useStable(() => keeper.current?.scrolled());

  // The pill: to the oldest unread new post, the first one above the reader's place, so they read on upwards in order.
  const jump = useStable(() => {
    const now = latest.current.state;
    const unread = new Set(now.unread);
    const oldest = [...now.items].reverse().find((item) => unread.has(timelineKey(item)));
    if (oldest) list.current?.jumpTo(timelineKey(oldest), !motion.reduced);
  });

  useImperativeHandle(
    handle,
    () => ({
      posted(post) {
        const now = latest.current.state;
        if (now.status !== "ready" || now.items.some((item) => timelineKey(item) === post.id)) return;
        own.current = post.id;
        insertAbove([{ kind: "post", post }], null, false);
      },
    }),
    [],
  );

  const renderPost = (item: TimelineItem, place: PostPlace, key: string) => {
    const card = <PostCard post={item.post} repostedBy={item.kind === "repost" ? item.repostedBy : undefined} onDeleted={() => remove(key)} {...place} />;
    // The reader's own new post fades in where it lands (new-own-post, 220 ms; at once under reduced motion).
    return key === own.current && !motion.reduced ? <Animated.View entering={FadeIn.duration(220)}>{card}</Animated.View> : card;
  };
  const empty =
    feed === "following"
      ? { title: UI_WORDS["feed.empty.following.title"], body: UI_WORDS["feed.empty.following.body"], action: { label: UI_WORDS["feed.empty.following.action"], onPress: onShowLatest } }
      : { title: UI_WORDS["feed.empty.latest.title"], body: UI_WORDS["feed.empty.latest.body"] };

  return (
    <View className="flex-1">
      <List
        handle={list}
        rows={result.rows}
        keyOf={(row) => row.key}
        versionOf={(row) => feedRowVersion(row, result.setSize)}
        renderRow={(row, index) => <FeedRowView row={row} index={index} setSize={result.setSize} renderPost={renderPost} empty={empty} onRetry={retry} onLoadMore={more} onGap={fillGap} />}
        header={header}
        feed
        label={feed === "following" ? UI_WORDS["home.following"] : UI_WORDS["home.latest"]}
        busy={state.status === "loading" || state.loadingMore || state.gapBusy}
        autoLoad={result.autoLoad}
        onEndReached={more}
        onViewed={onViewed}
        onTop={onTop}
        onScrolled={scrolled}
        // Pull to refresh on a phone asks for new posts now; they push the rows down, since the reader is at the top.
        refreshing={false}
        onRefresh={Platform.OS === "web" ? undefined : () => void ask()}
      />
      {reader ? <NewPostsPill count={state.unread.length} more={state.gap !== null} top={scroll.headerSpace} headerY={scroll.headerY} onPress={jump} /> : null}
    </View>
  );
}
```

### Create `apps/app/src/components/social/FeedRows.tsx`

```tsx
import { useEffect, useRef, type ReactElement } from "react";
import { Pressable, View } from "react-native";
import { EmptyState, type EmptyAction } from "@/components/kit/EmptyState";
import { ErrorState } from "@/components/kit/ErrorState";
import { Icon } from "@/components/kit/Icon";
import { FOCUS_RING_INSET, HOVER_WASH, dataAttribute, pressDelay } from "@/components/kit/interaction";
import { Skeleton } from "@/components/kit/Skeleton";
import { Text } from "@/components/kit/Text";
import { VisuallyHidden } from "@/components/kit/VisuallyHidden";
import { Button, ErrorText } from "@/components/ui";
import { markerWhen, type FeedRow } from "@/lib/feed-rows";
import { useMotion } from "@/lib/motion";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";

/**
 * The rows of a list other than its posts (UI design, sections 6.12 and 8.2), drawn the same in every list: skeletons
 * while the first page loads, with one polite status; the empty state with its title over the list's own sentence and
 * one action; the error state with Try again; Load more, and in its place a failed page's sentence with Try again; the
 * end of a feed; the gap of new posts not yet read; and the reader's marker, "You were here", which says "You're all
 * caught up" once that is true.
 */

/** What a post row gets besides its item: its place in the feed and whether its images load first (11.2). */
export interface PostPlace {
  position: number;
  setSize: number;
  priority: boolean;
}

export interface FeedRowOptions<T> {
  renderPost: (item: T, place: PostPlace, key: string) => ReactElement | null;
  setSize: number;
  /** The list's index of the row: the first two rows' images load first. */
  index: number;
  kind?: "posts" | "accounts";
  empty: { title?: string; body: string; action?: EmptyAction } | ReactElement;
  onRetry: () => void;
  onLoadMore: () => void;
  onGap?: () => void;
}

/** Whether "You're all caught up" has drawn its check in this session: it draws once, then shows at once (5.2). */
const caughtUp = { drawn: false };

/** The done icon of "You're all caught up", whose check draws itself the first time in a session (450 ms, ease-out). */
export function CaughtUpCheck({ tone = "high" }: { tone?: "high" | "on-accent" }) {
  const { reduced } = useMotion();
  const draw = useRef(!caughtUp.drawn && !reduced);
  useEffect(() => {
    caughtUp.drawn = true;
  }, []);
  // On the web the drawing is a CSS rule of the style element korbat writes (theme/fonts.web.ts, DRAW_RULE).
  return (
    <View {...(draw.current ? dataAttribute("draw") : {})}>
      <Icon name="done" size={20} tone={tone} />
    </View>
  );
}

function Marker({ time, done }: { time: string; done: boolean }) {
  return (
    <View {...dataAttribute("marker")} className="gap-1 border-b border-line-low bg-surface-1 px-4 py-4">
      <View className="flex-row items-center gap-2">
        {done ? <CaughtUpCheck /> : null}
        <Text as="h2" variant="display-3">
          {done ? UI_WORDS["feed.caughtUp"] : UI_WORDS["feed.marker.title"]}
        </Text>
      </View>
      <Text variant="meta" tone="low">
        {markerWhen(time)}
      </Text>
      <Text tone="medium">{UI_WORDS["feed.marker.body"]}</Text>
    </View>
  );
}

/** The gap of new posts not yet loaded: a full-width row that reads them into its place. */
function Gap({ busy, onPress }: { busy: boolean; onPress?: () => void }) {
  return (
    <Pressable accessibilityRole="button" aria-busy={busy} disabled={busy} onPress={onPress} {...pressDelay(80)} className={cn("border-b border-line-low", FOCUS_RING_INSET)}>
      {({ pressed }) => (
        <View className={cn("min-h-[52px] flex-row items-center justify-center gap-2 px-4 py-3", HOVER_WASH, pressed ? "bg-surface-2" : "bg-surface-1")}>
          <Icon name="newer" size={20} tone="accent" />
          <Text variant="body-strong" tone="accent">
            {busy ? UI_WORDS["button.busy"] : UI_WORDS["feed.gap"]}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export function renderFeedRow<T>(row: FeedRow<T>, options: FeedRowOptions<T>): ReactElement | null {
  switch (row.kind) {
    case "post":
      return options.renderPost(row.item, { position: row.position, setSize: options.setSize, priority: options.index < 2 }, row.key);
    case "skeleton":
      return (
        <View>
          {/* One polite status for the whole list, with the first row, which a screen reader hears instead of the shapes. */}
          {row.index === 0 ? <VisuallyHidden role="status">{options.kind === "accounts" ? UI_WORDS["accounts.loading"] : UI_WORDS["feed.loading"]}</VisuallyHidden> : null}
          {options.kind === "accounts" ? <Skeleton.Row /> : <Skeleton.Post index={row.index} />}
        </View>
      );
    case "empty": {
      const empty = options.empty;
      if ("body" in empty) {
        if (empty.title === undefined) {
          return (
            <View className="items-center px-6 py-12">
              <Text tone="medium" className="max-w-[440px] text-center">
                {empty.body}
              </Text>
            </View>
          );
        }
        return <EmptyState title={empty.title} body={empty.body} action={empty.action} />;
      }
      return empty;
    }
    case "error":
      return <ErrorState message={row.message} onRetry={options.onRetry} />;
    case "loadMore":
      return (
        <View className="items-center px-4 pb-8">
          <Button label={UI_WORDS["feed.loadMore"]} tone="secondary" full={false} busy={row.busy} onPress={options.onLoadMore} />
        </View>
      );
    case "loadMoreError":
      return (
        <View className="items-center px-4 pb-8">
          <ErrorText message={row.message} />
          <Button label={UI_WORDS["error.retry"]} tone="secondary" full={false} onPress={options.onLoadMore} />
        </View>
      );
    case "end":
      return (
        <View className="items-center px-4 py-8">
          <Text variant="meta" tone="low" className="text-center">
            {row.feed === "following" ? UI_WORDS["feed.end.following"] : UI_WORDS["feed.end.latest"]}
          </Text>
        </View>
      );
    case "gap":
      return <Gap busy={row.busy} onPress={options.onGap} />;
    case "marker":
      return <Marker time={row.time} done={row.caughtUp} />;
  }
}

/** A row as an element, for a list that writes its rows in JSX (ExploreList). */
export function FeedRowView<T>({ row, ...options }: { row: FeedRow<T> } & FeedRowOptions<T>) {
  return renderFeedRow(row, options);
}

/** What a row shows beyond its key, for List's versionOf: a row is drawn again only when one of these changes. */
export function feedRowVersion<T>(row: FeedRow<T>, setSize: number, extra: readonly unknown[] = []): readonly unknown[] {
  switch (row.kind) {
    case "post":
      return [row.item, row.position, setSize, ...extra];
    case "marker":
      return [row.time, row.caughtUp];
    case "gap":
    case "loadMore":
      return [row.busy, ...extra];
    case "loadMoreError":
    case "error":
      return [row.message, ...extra];
    default:
      return [row.kind, ...extra];
  }
}
```

### Create `apps/app/src/components/social/NewPostsPill.tsx`

```tsx
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { Icon } from "@/components/kit/Icon";
import { FOCUS_RING, dataAttribute, pressDelay } from "@/components/kit/interaction";
import { Text } from "@/components/kit/Text";
import { VisuallyHidden } from "@/components/kit/VisuallyHidden";
import { useMotion } from "@/lib/motion";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { CaughtUpCheck } from "./FeedRows";

/**
 * "N new posts above" (UI design, decision 7, sections 5.2, 8.2 and 10): the one sign that new posts arrived, floating
 * 12 px under the header, centred, in the accent fill with the newer icon. Its name adds "above, go to the first one";
 * pressing it scrolls to the oldest unread new post, the first one above the reader's place, so the reader reads on
 * upwards in time order. The count falls as rows come into view; at zero it says "You're all caught up" for two seconds
 * (opacity only) and leaves. It comes in from 8 px above and leaves by fading (pill-show: 200 ms in, 150 ms out; reduced,
 * opacity only), and a screen reader hears "N new posts above" once, when it first shows, never on later counts. Like
 * every floating layer it keeps a border in forced colours (section 4.6).
 */

/** How long "You're all caught up" stays once the count reaches zero. */
export const CAUGHT_UP_MS = 2000;

/** The pill's words for a count: "1 new post", "N new posts", or "50+ new posts" when a gap holds more not yet read. */
export function pillWords(count: number, more = false): string {
  if (more || count > 50) return UI_WORDS["feed.pill.many"];
  if (count === 1) return UI_WORDS["feed.pill.one"];
  return fill(UI_WORDS["feed.pill"], { n: count });
}

export function NewPostsPill({
  count,
  more = false,
  top,
  headerY,
  onPress,
}: {
  count: number;
  more?: boolean;
  /** The room the phone's floating header takes; the pill sits 12 px under it. */
  top: number;
  /** The header's slide on a phone: the pill moves up with it when it hides. */
  headerY?: SharedValue<number>;
  onPress: () => void;
}) {
  const motion = useMotion();
  // What shows: the count, "You're all caught up" for two seconds after it reached zero, or nothing.
  const [phase, setPhase] = useState<"hidden" | "count" | "caughtUp">(count > 0 ? "count" : "hidden");
  const [mounted, setMounted] = useState(count > 0);
  const [announced, setAnnounced] = useState<string | null>(null);
  const had = useRef(count > 0);
  useEffect(() => {
    if (count > 0) {
      if (!had.current) setAnnounced(fill(UI_WORDS["feed.pill.announce"], { visible: pillWords(count, more) }));
      had.current = true;
      setPhase("count");
      setMounted(true);
      return undefined;
    }
    if (!had.current) return undefined;
    had.current = false;
    setPhase("caughtUp");
    const timer = setTimeout(() => setPhase("hidden"), CAUGHT_UP_MS);
    return () => clearTimeout(timer);
  }, [count > 0, count]);

  const shown = useSharedValue(0);
  useEffect(() => {
    const target = phase === "hidden" ? 0 : 1;
    if (shown.value === target) {
      if (target === 0) setMounted(false);
      return;
    }
    shown.value = withTiming(target, motion.timing("easeOut", target === 1 ? 200 : 150), (finished) => {
      "worklet";
      if (finished && target === 0) runOnJS(setMounted)(false);
    });
  }, [phase, mounted]);
  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: (headerY ? headerY.value : 0) + (motion.reduced ? 0 : (1 - shown.value) * -8) }],
  }));

  // While it fades out the pill keeps the words it last showed.
  const shownWords = useRef("");
  if (phase === "caughtUp") shownWords.current = UI_WORDS["feed.caughtUp"];
  else if (phase === "count" && count > 0) shownWords.current = pillWords(count, more);
  const words = shownWords.current;
  return (
    <>
      {/* Heard once, when the pill first shows. */}
      <VisuallyHidden role="status">{announced ?? ""}</VisuallyHidden>
      {mounted ? (
        <View pointerEvents="box-none" className="absolute left-0 right-0 z-20 items-center" style={{ top: top + 12 }}>
          <Animated.View style={style}>
            <Pressable
              {...dataAttribute("pill")}
              accessibilityRole="button"
              aria-label={phase === "caughtUp" ? words : fill(UI_WORDS["feed.pill.label"], { visible: words })}
              disabled={phase !== "count"}
              onPress={onPress}
              {...pressDelay(0)}
              className={cn(
                "min-h-[44px] flex-row items-center gap-2 rounded-full border border-accent bg-accent px-4 active:opacity-90 web:forced-colors:border-[color:CanvasText]",
                FOCUS_RING,
              )}
            >
              {phase === "caughtUp" ? <CaughtUpCheck tone="on-accent" /> : <Icon name="newer" size={20} tone="on-accent" />}
              <Text variant="body-strong" tone="on-accent">
                {words}
              </Text>
            </Pressable>
          </Animated.View>
        </View>
      ) : null}
    </>
  );
}
```

### Create `apps/app/src/components/social/ProfileMenu.tsx`

```tsx
import type { MeResponse, ProfileView } from "@korbat/contracts";
import { Menu, MenuPanel, type MenuItem } from "@/components/kit/Menu";
import { reportHref } from "@/lib/moderation";
import { REPORT_WORDS } from "@/lib/moderation-words";
import { useSession } from "@/lib/session";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { useLayout } from "@/theme/layout";

/**
 * A profile's More menu (UI design, section 8.4, decision 12), for anyone but the profile's owner: Mute or Unmute and
 * Block or Unblock for a signed-in reader, then Report, signed in or out, as a link to the report form (3c design,
 * section 9). Report left the profile's row of controls for this menu, as it left the post's. Null for the owner, who
 * gets no menu at all.
 */
export function profileMenuItems(profile: ProfileView, me: MeResponse | null, handlers: { onMute: () => void; onBlock: () => void }): MenuItem[] | null {
  if (me !== null && profile.id === me.user.id) return null;
  const items: MenuItem[] = [];
  const viewer = profile.viewer;
  if (me && viewer) {
    items.push({ label: viewer.muted ? UI_WORDS["profile.unmute"] : UI_WORDS["profile.mute"], icon: "hidden", onSelect: handlers.onMute });
    items.push({ label: viewer.blocked ? UI_WORDS["profile.unblock"] : UI_WORDS["profile.block"], icon: "privacy", onSelect: handlers.onBlock });
  }
  items.push({ label: REPORT_WORDS.control, icon: "report", href: reportHref({ account: profile.handle }) });
  return items;
}

/** The menu drawn open, for the render tests: the items a reader gets on this profile, or nothing on their own. */
export function ProfileMenuPanel({ profile }: { profile: ProfileView }) {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me : null;
  const layout = useLayout() === "phone" ? "phone" : "wide";
  const items = profileMenuItems(profile, me, { onMute: () => undefined, onBlock: () => undefined });
  if (!items) return null;
  return <MenuPanel label={fill(UI_WORDS["profile.more"], { handle: profile.handle })} items={items} layout={layout} onPick={() => undefined} />;
}

/** The More button and its menu, beside Follow. */
export function ProfileMenu({ profile, onMute, onBlock }: { profile: ProfileView; onMute: () => void; onBlock: () => void }) {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me : null;
  const items = profileMenuItems(profile, me, { onMute, onBlock });
  if (!items) return null;
  return <Menu label={fill(UI_WORDS["profile.more"], { handle: profile.handle })} icon="more" items={items} />;
}
```

### Create `apps/app/src/lib/feed-cache.ts`

```ts
import type { PostView, TimelineItem } from "@korbat/contracts";
import type { FeedName } from "./feed-rows";
import type { PlaceRow } from "./reading-place";

/**
 * Home's two feeds as the reader left them, for the session (UI design, section 7.5): each feed's rows, its cursor, the
 * page ends that let the oldest rows go and come back, a gap of new posts, its marker and unread new posts, and the row
 * at the top with its offset, in memory and per reader, so switching Home's tabs, opening a post and coming Back return
 * to the same row without asking for page one again. Nothing here is written to the browser, it ends with the page, and
 * another reader (another account, or the signed-out reader) never gets what one read. Only Following and Latest are
 * kept: Explore's answers stay in ExploreList's own state and are read again when it returns (2c's rule).
 */

export interface FeedSnapshot {
  items: TimelineItem[];
  cursor: string | null;
  /** Each loaded page's last row and the cursor its page gave (feed-rows.ts, trimOlder). */
  ends: [string, string | null][];
  gap: { after: string; cursor: string } | null;
  /** The newest post the reader had seen when the feed opened: the marker's place. */
  marker: PlaceRow | null;
  /** New posts above the reader not yet in view: the pill's count. */
  unread: string[];
  /** The row at the top of the view and how far its top is below the view's top line. */
  view: { key: string; offset: number } | null;
}

const kept = new Map<string, FeedSnapshot>();

export function feedCacheKey(reader: string | null, feed: FeedName): string {
  return `${reader ?? "signed-out"}:${feed}`;
}

export function readFeedCache(reader: string | null, feed: FeedName): FeedSnapshot | null {
  return kept.get(feedCacheKey(reader, feed)) ?? null;
}

export function writeFeedCache(reader: string | null, feed: FeedName, snapshot: FeedSnapshot): void {
  kept.set(feedCacheKey(reader, feed), snapshot);
}

/** The reader's own new post on top of both their feeds kept here (section 8.2); a feed not kept reads it with page one. */
export function insertPosted(reader: string | null, post: PostView): void {
  for (const feed of ["following", "latest"] as const) {
    const snapshot = readFeedCache(reader, feed);
    if (!snapshot || snapshot.items.some((item) => item.kind === "post" && item.post.id === post.id)) continue;
    kept.set(feedCacheKey(reader, feed), { ...snapshot, items: [{ kind: "post", post }, ...snapshot.items] });
  }
}

export function clearFeedCache(): void {
  kept.clear();
}
```

### Create `apps/app/src/lib/feed-rows.ts`

```ts
import type { TimelineItem } from "@korbat/contracts";
import { dayTime, fullDate } from "./time";

/**
 * The typed rows of a list (UI design, sections 8.2 and 11.1, after Bluesky's feed rows): what a list holds, its items,
 * whether its first page is in, its cursor, the reader's marker and a gap of new posts, turned by one pure function into
 * the rows it draws. Loading, empty and error are rows of the same list, so the screen's header and tabs never move.
 * The feeds of Home (Following and Latest) use every kind; the other lists (a thread's replies, a profile's tabs,
 * bookmarks, followers, Explore) use the post rows, Load more, its error, the skeletons and the empty and error rows.
 */

/** Home's two feeds in time order; Explore is ranked and has no place, marker or pill. */
export type FeedName = "following" | "latest";

/** One row. A `post` is one item of the list (a TimelineItem in a feed), with its place among the posts from 1. */
export type FeedRow<T> =
  | { kind: "post"; key: string; item: T; position: number }
  | { kind: "marker"; key: "marker"; time: string; caughtUp: boolean }
  | { kind: "gap"; key: "gap"; busy: boolean }
  | { kind: "loadMore"; key: "loadMore"; busy: boolean }
  | { kind: "loadMoreError"; key: "loadMoreError"; message: string }
  | { kind: "end"; key: "end"; feed: FeedName }
  | { kind: "skeleton"; key: string; index: number }
  | { kind: "empty"; key: "empty" }
  | { kind: "error"; key: "error"; message: string };

export interface FeedRowsInput<T> {
  items: readonly T[];
  keyOf: (item: T) => string;
  /** When an item entered the list, for the marker: a post's time, or a repost's. */
  timeOf?: (item: T) => string;
  /** The first page: still loading, in, or failed. */
  status: "loading" | "ready" | "error";
  error?: string | null;
  /** The next page's cursor; null when there is none. */
  cursor: string | null;
  loadingMore?: boolean;
  /** A later page that failed, shown in Load more's place with its own Try again. */
  moreError?: string | null;
  /** The newest post the reader had seen when the feed opened: the marker goes above the first post not newer. */
  marker?: { time: string; caughtUp: boolean } | null;
  /** New posts not yet loaded, after the last new post read with them. */
  gap?: { after: string; busy: boolean } | null;
  /** A feed of Home: it says so when it has shown everything. */
  feed?: FeedName | null;
  /** The reader's "Load older posts automatically" (section 8.8). */
  autoLoad?: boolean;
  skeletons?: number;
}

export interface FeedRowsResult<T> {
  rows: FeedRow<T>[];
  /** aria-setsize for each article: the number of posts, or -1 while more can load (section 10). */
  setSize: number;
  /** Whether the next page loads by itself as the reader nears the end: never below the marker (decision 6). */
  autoLoad: boolean;
}

/** The skeleton rows of a list's first page (section 8.2: five Skeleton.Post). */
export const SKELETON_ROWS = 5;

/** A feed keeps at most this many rows (section 11.1); past that the oldest pages go and come back through Load more. */
export const MAX_ROWS = 300;

/** When a timeline item entered the feed: a repost by its repost's time, a post by its own. */
export function timelineTime(item: TimelineItem): string {
  return item.kind === "repost" ? item.repostedAt : item.post.createdAt;
}

export function feedRows<T>(input: FeedRowsInput<T>): FeedRowsResult<T> {
  if (input.status === "loading") {
    const count = input.skeletons ?? SKELETON_ROWS;
    return { rows: Array.from({ length: count }, (_, index) => ({ kind: "skeleton" as const, key: `skeleton-${index}`, index })), setSize: -1, autoLoad: false };
  }
  if (input.status === "error") return { rows: [{ kind: "error", key: "error", message: input.error ?? "" }], setSize: -1, autoLoad: false };
  if (input.items.length === 0) return { rows: [{ kind: "empty", key: "empty" }], setSize: 0, autoLoad: false };

  // The marker goes above the first post that is not newer than the newest the reader had seen, and only where at least
  // one post is above it: over nothing, "Newer posts are above" would not be true.
  const markerAt = markerIndex(input);
  const rows: FeedRow<T>[] = [];
  input.items.forEach((item, index) => {
    if (index === markerAt && input.marker) rows.push({ kind: "marker", key: "marker", time: input.marker.time, caughtUp: input.marker.caughtUp });
    const key = input.keyOf(item);
    rows.push({ kind: "post", key, item, position: index + 1 });
    if (input.gap && input.gap.after === key) rows.push({ kind: "gap", key: "gap", busy: input.gap.busy });
  });
  if (input.moreError) rows.push({ kind: "loadMoreError", key: "loadMoreError", message: input.moreError });
  else if (input.cursor !== null) rows.push({ kind: "loadMore", key: "loadMore", busy: input.loadingMore === true });
  else if (input.feed) rows.push({ kind: "end", key: "end", feed: input.feed });

  const more = input.cursor !== null;
  return {
    rows,
    setSize: more ? -1 : input.items.length,
    autoLoad: input.autoLoad === true && more && !input.moreError && markerAt < 0,
  };
}

/** The index of the post the marker goes above, or -1 when it has no place among these posts. */
function markerIndex<T>(input: FeedRowsInput<T>): number {
  const { marker, timeOf } = input;
  if (!marker || !timeOf) return -1;
  const seen = Date.parse(marker.time);
  const at = input.items.findIndex((item) => Date.parse(timeOf(item)) <= seen);
  return at > 0 ? at : -1;
}

/** Six days: within them the marker says the day and the time ("Tue 18:40"), after them the full date. */
const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;

/** The marker's time (section 8.2): dayTime within six days, fullDate after. */
export function markerWhen(iso: string, now: number = Date.now()): string {
  return now - Date.parse(iso) <= SIX_DAYS_MS ? dayTime(iso) : fullDate(iso);
}

/**
 * The rows a feed keeps when it has more than `max` (section 11.1): the newest ones, cut right after the last row at or
 * before the limit that ended a page, so the cursor that page answered reads the dropped rows again through Load more.
 * `ends` maps each page's last row to the cursor its page gave. Null when nothing needs to go, or nowhere can be cut.
 */
export function trimOlder<T>(items: readonly T[], keyOf: (item: T) => string, ends: ReadonlyMap<string, string | null>, max = MAX_ROWS): { items: T[]; cursor: string | null } | null {
  if (items.length <= max) return null;
  for (let index = max - 1; index >= 0; index--) {
    const key = keyOf(items[index]!);
    if (ends.has(key)) return { items: items.slice(0, index + 1), cursor: ends.get(key) ?? null };
  }
  return null;
}
```

### Create `apps/app/src/lib/new-posts.ts`

```ts
import { Platform } from "react-native";
import type { Page } from "./social";

/**
 * New posts above a feed (UI design, decision 7, section 8.2). Following and Latest ask for their first page of 50
 * thirty seconds after they open and every sixty seconds after, only while Home is focused, an account is signed in, the
 * feed is the tab chosen and the page is visible; nothing is asked while korbat is in the background, and the only sign
 * of what arrives is the pill inside the feed (no dot on the tab, no count in the title). What an answer adds is the
 * posts above the first one already listed; when all fifty are new, a gap row follows them and reads on from the page's
 * cursor until it meets the posts already listed. The schedule is a clock that stops while the feed is not active and
 * goes on from where it was.
 */

export const FIRST_ASK_MS = 30_000;
export const ASK_EVERY_MS = 60_000;
/** The page a poll reads: the most Pagination allows (packages/contracts, 1 to 50). */
export const NEW_LIMIT = 50;

/** Whether the feed may ask now: Home in focus, an account, its tab chosen, the page visible. */
export function pollActive(state: { focused: boolean; signedIn: boolean; selected: boolean; visible: boolean }): boolean {
  return state.focused && state.signedIn && state.selected && state.visible;
}

/** Whether the page is visible: document.visibilityState on the web; native asks AppState, which the feed follows. */
export function pageVisible(): boolean {
  if (Platform.OS !== "web" || typeof document === "undefined") return true;
  return document.visibilityState !== "hidden";
}

/** The items of `page` before the first one already listed; with none listed and a full page, the gap's cursor too. */
export function newRows<T>(page: Page<T>, keyOf: (item: T) => string, known: ReadonlySet<string>): { added: T[]; gapCursor: string | null } {
  const at = page.items.findIndex((item) => known.has(keyOf(item)));
  if (at >= 0) return { added: page.items.slice(0, at), gapCursor: null };
  // All new. A full page may be followed by more new posts, not yet read: the gap row reads them on demand.
  return { added: [...page.items], gapCursor: page.items.length >= NEW_LIMIT ? page.nextCursor : null };
}

/** A gap's next page: its items until the first one already listed, and the cursor to read on when none was met. */
export function gapRows<T>(page: Page<T>, keyOf: (item: T) => string, known: ReadonlySet<string>): { added: T[]; gapCursor: string | null } {
  const at = page.items.findIndex((item) => known.has(keyOf(item)));
  if (at >= 0) return { added: page.items.slice(0, at), gapCursor: null };
  return { added: [...page.items], gapCursor: page.nextCursor };
}

export interface NewPostsClock {
  setActive(active: boolean): void;
  dispose(): void;
}

/**
 * The schedule: `ask` 30 s of active time after the feed opens and 60 s after each answer. An ask still out is never
 * doubled, a failed one is quiet (the next ask tries again), and inactive time does not count.
 */
export function createNewPosts(ask: () => Promise<unknown>): NewPostsClock {
  let active = false;
  let disposed = false;
  let asking = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dueIn = FIRST_ASK_MS;
  let armedAt = 0;

  const arm = () => {
    if (disposed || !active || asking || timer !== null) return;
    armedAt = Date.now();
    timer = setTimeout(fire, dueIn);
  };
  const fire = () => {
    timer = null;
    asking = true;
    dueIn = ASK_EVERY_MS;
    let answer: Promise<unknown>;
    try {
      answer = ask();
    } catch {
      answer = Promise.resolve();
    }
    void answer
      .catch(() => undefined)
      .finally(() => {
        asking = false;
        arm();
      });
  };

  return {
    setActive(next) {
      if (next === active) return;
      active = next;
      if (active) {
        arm();
        return;
      }
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
        dueIn = Math.max(0, dueIn - (Date.now() - armedAt));
      }
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
```

### Create `apps/app/src/lib/reading-place.ts`

```ts
import type { FeedName } from "./feed-rows";

/**
 * Where the reader stopped in Following and Latest (UI design, decisions 8 and 9, section 8.2), kept on this device only:
 * in this browser's storage under korbat.place.<accountId>, one record per account holding each feed's place, and in
 * memory nowhere else. A place is the newest post the reader has seen (at least half in view for half a second; the
 * list's viewability reports it) and the post at the top of the list, each as its row key and time, written one second
 * after scrolling stops and at once when the page is hidden. This is the only module in src that touches those keys
 * (explore.test.tsx holds the app's stores to a list); the session's end clears every one of them through clearPlaces()
 * (lib/session.tsx), and so will the Appearance page's "Clear what this device keeps" (Task 8). A reader who is signed
 * out has no place: nothing is read or written for them.
 */

export const PLACE_PREFIX = "korbat.place.";

/** A feed opens at its stored top when that post is among its newest 100 rows: two pages of 50 (decision 9). */
export const PLACE_WINDOW = 100;

/** How long after the last scroll the place is written. */
export const PLACE_SAVE_MS = 1000;

/** One row of a feed as the place keeps it: its key and when it entered the feed. */
export interface PlaceRow {
  key: string;
  time: string;
}

export interface Place {
  newest: PlaceRow;
  top: PlaceRow;
  savedAt: number;
}

type Places = Partial<Record<FeedName, Place>>;

/** Browser storage, typed locally as lib/appearance.ts types it; every access is guarded, since a private window or blocked storage throws. */
interface Store {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The browser's storage, or null where there is none (native) or the browser refuses it. */
function store(): Store | null {
  try {
    return (globalThis as unknown as { localStorage?: Store }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function placeKey(accountId: string): string {
  return `${PLACE_PREFIX}${accountId}`;
}

const isRow = (value: unknown): value is PlaceRow =>
  typeof value === "object" && value !== null && typeof (value as PlaceRow).key === "string" && typeof (value as PlaceRow).time === "string" && !Number.isNaN(Date.parse((value as PlaceRow).time));

const isPlace = (value: unknown): value is Place =>
  typeof value === "object" && value !== null && isRow((value as Place).newest) && isRow((value as Place).top) && typeof (value as Place).savedAt === "number";

/** Every feed's place an account has here; a damaged record is none. */
function readPlaces(accountId: string): Places {
  try {
    const raw = store()?.getItem(placeKey(accountId));
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Places) : {};
  } catch {
    return {};
  }
}

export function readPlace(accountId: string, feed: FeedName): Place | null {
  const place = readPlaces(accountId)[feed];
  return isPlace(place) ? place : null;
}

export function writePlace(accountId: string, feed: FeedName, place: Place): void {
  try {
    store()?.setItem(placeKey(accountId), JSON.stringify({ ...readPlaces(accountId), [feed]: place }));
  } catch {
    // A browser that refuses storage keeps no place: the feed opens at its newest post next time.
  }
}

/** The keys of every place kept in this browser, whatever the account. */
function placeKeys(): string[] {
  const kept: string[] = [];
  try {
    const browser = store();
    if (!browser) return kept;
    for (let index = 0; index < browser.length; index++) {
      const key = browser.key(index);
      if (key?.startsWith(PLACE_PREFIX)) kept.push(key);
    }
  } catch {
    // Storage that cannot be read holds nothing this app can see.
  }
  return kept;
}

/** Whether any account's place is kept here: the session's first 401 then means a session that ended while away. */
export function placesStored(): boolean {
  return placeKeys().length > 0;
}

/** Forgets every account's place in this browser (the session's end; Task 8's "Clear what this device keeps"). */
export function clearPlaces(): void {
  for (const key of placeKeys()) {
    try {
      store()?.removeItem(key);
    } catch {
      // What cannot be removed cannot be read back either.
    }
  }
}

/** The later of two rows by the time they entered the feed. */
export function newer(a: PlaceRow | null, b: PlaceRow | null): PlaceRow | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b.time) > Date.parse(a.time) ? b : a;
}

/**
 * Where a feed opens (decision 9): the key of the stored top row when it is among the first PLACE_WINDOW rows and is not
 * the newest itself, or null for the newest post: nothing stored, the row further down or gone, or "Open feeds at the
 * newest post" on.
 */
export function openingRow(rows: readonly PlaceRow[], place: Place | null, openNewest: boolean): string | null {
  if (!place || openNewest) return null;
  const at = rows.slice(0, PLACE_WINDOW).findIndex((row) => row.key === place.top.key);
  return at > 0 ? place.top.key : null;
}

export interface PlaceKeeper {
  /** The newest post seen so far, the stored one included: the pill counts what is newer. */
  newest(): PlaceRow | null;
  /** Rows that have been half in view for half a second. */
  seen(rows: readonly PlaceRow[]): void;
  /** The row now at the top of the list. */
  top(row: PlaceRow | null): void;
  /** The list scrolled: the place is written a second after the last scroll. */
  scrolled(): void;
  /** The page is hidden or the list goes away: the place is written now. */
  hidden(): void;
  dispose(): void;
}

/**
 * Keeps one feed's place for an account while the reader reads, starting from what was stored. A newest post only ever
 * moves to a newer one; the top row seen is seen. With no account (signed out) it keeps and writes nothing.
 */
export function createPlaceKeeper(accountId: string | null, feed: FeedName, start: Place | null, now: () => number = Date.now): PlaceKeeper {
  let newest: PlaceRow | null = accountId ? (start?.newest ?? null) : null;
  let top: PlaceRow | null = accountId ? (start?.top ?? null) : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (accountId && newest && top) writePlace(accountId, feed, { newest, top, savedAt: now() });
  };
  return {
    newest: () => newest,
    seen(rows) {
      if (!accountId) return;
      for (const row of rows) newest = newer(newest, row);
    },
    top(row) {
      if (!accountId || !row) return;
      top = row;
      newest = newer(newest, row);
    },
    scrolled() {
      if (!accountId) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(save, PLACE_SAVE_MS);
    },
    hidden: save,
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
```

### Create `apps/app/src/lib/session-end.ts`

```ts
import { clearAppearance } from "./appearance";
import { clearFeedCache } from "./feed-cache";
import { clearPlaces } from "./reading-place";

/**
 * The session's end (UI design, section 8.8), apart from SessionProvider (lib/session.tsx), which calls these on every
 * change of its state, so the decision is a pure function the tests call without rendering anything.
 */

/** The session's states, as SessionProvider's state names them. */
export type SessionStatus = "loading" | "signed-out" | "signed-in";

/**
 * Whether the session has ended (UI design, section 8.8): the state moved from signed in to signed out (a sign-out here
 * or everywhere, a lockdown page, any 401 the API answered), or the first answer of /api/me is signed out while a reading
 * place is still stored, which means a session revoked, expired or signed out elsewhere while the app was closed.
 */
export function sessionEnded(previous: SessionStatus, next: SessionStatus, stored: boolean): boolean {
  if (next !== "signed-out") return false;
  if (previous === "signed-in") return true;
  return previous === "loading" && stored;
}

/**
 * What the device kept for the session, cleared when it ends, through each store's own function: the appearance (the
 * theme returns to System), every reading place, whatever the account, and the feeds kept in memory. Task 6 adds the
 * drafts. The device id and the passkey card's Not now stay: they belong to the browser, not to an account.
 */
export function clearSessionTraces(): void {
  clearAppearance();
  clearPlaces();
  clearFeedCache();
}
```

### Replace `apps/app/src/app/bookmarks.tsx` (whole file)

```tsx
import { useCallback } from "react";
import { View } from "react-native";
import { Redirect } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/kit/Icon";
import { Skeleton } from "@/components/kit/Skeleton";
import { Text } from "@/components/kit/Text";
import { HeaderSpace, ScreenHeader } from "@/components/ScreenHeader";
import { PostList } from "@/components/social/PagedList";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";
import { UI_WORDS } from "@/lib/ui-words";

/** The header (UI design, section 8.5): "Bookmarks", and beside the privacy icon, "Private to you." */
function BookmarksHeader() {
  return (
    <ScreenHeader title={UI_WORDS["bookmarks.title"]}>
      <View className="flex-row items-center gap-1.5">
        <Icon name="privacy" size={16} tone="low" />
        <Text variant="meta" tone="low">
          {UI_WORDS["bookmarks.private"]}
        </Text>
      </View>
    </ScreenHeader>
  );
}

/** Your bookmarks, newest first. Nobody else can see them. */
export default function Bookmarks() {
  const { state } = useSession();
  const title = usePageTitle("title.bookmarks");
  const fetchPage = useCallback((cursor?: string) => social.myBookmarks(cursor), []);

  // While the session loads the screen stays in the shell, with skeleton rows under its header (section 6.12).
  if (state.status === "loading") {
    return (
      <AppShell>
        {title}
        <BookmarksHeader />
        <HeaderSpace />
        <Skeleton.List kind="posts" count={5} />
      </AppShell>
    );
  }
  if (state.status === "signed-out") return <Redirect href="/signin" />;
  if (!state.me.user.onboarded) return <Redirect href="/handle" />;

  return (
    <AppShell>
      {title}
      <BookmarksHeader />
      <PostList fetchPage={fetchPage} empty={{ title: UI_WORDS["bookmarks.empty.title"], body: UI_WORDS["bookmarks.empty"] }} />
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/index.tsx` (whole file)

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { Redirect, router, useIsFocused, useLocalSearchParams } from "expo-router";
import type { MeResponse, PostView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/kit/Skeleton";
import { TabPanel, Tabs } from "@/components/kit/Tabs";
import { Text } from "@/components/kit/Text";
import { HeaderSpace, ScreenHeader } from "@/components/ScreenHeader";
import { ComposeButton, ComposeSheet } from "@/components/social/ComposeSheet";
import { Composer } from "@/components/social/Composer";
import { ExploreList } from "@/components/social/ExploreList";
import { FeedList, type FeedListHandle } from "@/components/social/FeedList";
import { Button } from "@/components/ui";
import { insertPosted } from "@/lib/feed-cache";
import { usePageTitle } from "@/lib/page-title";
import { dismissSuggestion, platformPasskeyAvailable, suggestionDismissedAt, suggestPasskey } from "@/lib/passkeys";
import { useSession } from "@/lib/session";
import { UI_WORDS } from "@/lib/ui-words";

export type Tab = "following" | "latest" | "explore";

const LABELS: Record<Tab, string> = { following: UI_WORDS["home.following"], latest: UI_WORDS["home.latest"], explore: UI_WORDS["home.explore"] };

/**
 * What a signed-out reader is told under the tabs: both lists are public, and an account adds the rest. Explore's prompt
 * must be true whatever the list turns out to hold, nothing or all there is, so it promises no more of Explore: the
 * list's own footer offers that, and only when the page says more posts exist.
 */
const SIGNED_OUT_PROMPTS: Record<Exclude<Tab, "following">, string> = {
  latest: "You are reading the latest public posts. Sign in to follow people and post.",
  explore: "Explore lists recent posts that other accounts like and repost. Sign in to follow people and post.",
};

/** Home's tabs in their order (2c design, section 11): Following first for an account, and Latest first for everyone else, who has no Following. */
export function homeTabs(signedIn: boolean): Tab[] {
  return signedIn ? ["following", "latest", "explore"] : ["latest", "explore"];
}

/**
 * The tab the address names (`/?tab=explore`), so another page can link to one; a missing or unknown name, or one the
 * reader does not have (Following, signed out), means the first tab. A parameter given twice counts by its first value.
 */
export function homeTab(param: string | string[] | undefined, signedIn: boolean): Tab {
  const tabs = homeTabs(signedIn);
  const named = Array.isArray(param) ? param[0] : param;
  return tabs.find((tab) => tab === named) ?? tabs[0]!;
}

/**
 * The key of Home's list: only another reader (an account's id, or none signed out) mounts a new list, which reads its
 * first page again (UI design, section 7.5). The reader is in it because a list read signed out has no cursor, offers a
 * sign-in and was read without any block or mute, and the web keeps a Home mounted under the sign-in screen, which Back
 * shows again once signed in. A tab change or a new post keeps the list: a tab's rows and place come back from
 * lib/feed-cache.ts, and the reader's own post is put on top.
 */
export function homeListKey(viewer: string | null): string {
  return viewer ?? "signed-out";
}

/** Home's panel, which its tabs control. */
const PANEL = "home-panel";

/**
 * The nudge towards a passkey (1c design, section 9): for an account without one, on a device with a built-in
 * authenticator to add one with, until Not now, which holds for 30 days on this device. A card of its own (UI design,
 * section 8.2), its words as they were.
 */
function PasskeySuggestion({ me }: { me: MeResponse }) {
  const [platform, setPlatform] = useState(false);
  const [dismissedAt, setDismissedAt] = useState(suggestionDismissedAt);
  useEffect(() => {
    let cancelled = false;
    void platformPasskeyAvailable().then((available) => {
      if (!cancelled) setPlatform(available);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!suggestPasskey({ passkeys: me.user.passkeys, platformAuthenticator: platform, dismissedAt, now: Date.now() })) return null;
  return (
    <View className="mx-4 mt-3 gap-1 rounded-card border border-line-low bg-surface-1 px-4 pb-4 pt-3">
      <Text as="h2" variant="title">
        {UI_WORDS["passkey.title"]}
      </Text>
      <Text tone="medium">{UI_WORDS["passkey.body"]}</Text>
      <View className="flex-row flex-wrap gap-x-2">
        <Button label={UI_WORDS["passkey.add"]} full={false} onPress={() => router.push("/settings/security?add=1")} />
        <Button
          label={UI_WORDS["passkey.notNow"]}
          tone="secondary"
          full={false}
          onPress={() => {
            const now = Date.now();
            dismissSuggestion(now);
            setDismissedAt(now);
          }}
        />
      </View>
    </View>
  );
}

/** What a signed-out reader reads above the list: what the tab holds, and the way to an account. */
function SignedOutPrompt({ tab }: { tab: Tab }) {
  return (
    <View className="mx-4 mt-3 rounded-card border border-line-low bg-surface-1 px-4 pb-4 pt-3">
      <Text tone="medium">{SIGNED_OUT_PROMPTS[tab === "explore" ? "explore" : "latest"]}</Text>
      <View className="flex-row">
        <Button label={UI_WORDS["nav.signin"]} onPress={() => router.push("/signin")} tone="secondary" full={false} />
      </View>
    </View>
  );
}

/**
 * Home (UI design, section 8.2): the header "Home" with the tabs under it, Following, Latest and Explore for a
 * signed-in account and Latest and Explore with a sign-in prompt for everyone else; then the tab's list, which keeps the
 * reader's place in Following and Latest. At 768 px and wider the composer is inline above the list; below, the compose
 * button opens the sheet. The reader's own new post goes on top of Following and Latest.
 */
export default function Home() {
  const { state } = useSession();
  const { width } = useWindowDimensions();
  const title = usePageTitle("title.home");
  const focused = useIsFocused();
  const { tab: param } = useLocalSearchParams<{ tab?: string }>();
  const [composing, setComposing] = useState(false);
  const feed = useRef<FeedListHandle>(null);

  const signedIn = state.status === "signed-in";
  const current = homeTab(param, signedIn);
  const header = (
    <ScreenHeader title={UI_WORDS["home.title"]}>
      <Tabs
        label={UI_WORDS["home.tabs"]}
        tabs={homeTabs(signedIn).map((key) => ({ key, label: LABELS[key] }))}
        selected={current}
        // The tab lives in the address, so a reload keeps it and other pages can link to one; setParams changes it in place.
        onSelect={(tab) => router.setParams({ tab })}
        panelId={PANEL}
      />
    </ScreenHeader>
  );
  const viewerId = state.status === "signed-in" ? state.me.user.id : null;
  const posted = useCallback(
    (post: PostView) => {
      // On top of both feeds: the one on screen now, and the other one as the session keeps it.
      insertPosted(viewerId, post);
      feed.current?.posted(post);
    },
    [viewerId],
  );

  if (state.status === "loading") {
    return (
      <AppShell>
        {title}
        {header}
        <HeaderSpace />
        <Skeleton.List kind="posts" count={5} />
      </AppShell>
    );
  }
  if (state.status === "signed-in" && !state.me.user.onboarded) return <Redirect href="/handle" />;

  const viewer = state.status === "signed-in" ? state.me.user.id : null;
  const select = (tab: Tab) => router.setParams({ tab });
  const inlineComposer = signedIn && width >= 768;
  // What scrolls above the posts: the sign-in prompt, the passkey card and, wider, the composer.
  const above = (
    <View>
      {signedIn ? null : <SignedOutPrompt tab={current} />}
      {state.status === "signed-in" ? <PasskeySuggestion me={state.me} /> : null}
      {inlineComposer ? (
        <View className="border-b border-line-low">
          <Composer onPosted={posted} />
        </View>
      ) : null}
    </View>
  );

  return (
    <AppShell floating={signedIn && !inlineComposer ? <ComposeButton onPress={() => setComposing(true)} /> : undefined}>
      {title}
      {header}
      <TabPanel panelId={PANEL} selected={current}>
        {current === "explore" ? (
          <ExploreList key={homeListKey(viewer)} onShowLatest={() => select("latest")} header={above} />
        ) : (
          <FeedList key={homeListKey(viewer)} handle={feed} feed={current} reader={viewer} active={focused} header={above} onShowLatest={() => select("latest")} />
        )}
      </TabPanel>
      <ComposeSheet open={composing} onClose={() => setComposing(false)} onPosted={posted} />
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/post/[id].tsx` (whole file)

```tsx
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Link, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { PostId, type PostView, type ThreadResponse, type Tombstone } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { FOCUS_RING, dataAttribute } from "@/components/kit/interaction";
import { Skeleton } from "@/components/kit/Skeleton";
import { Text } from "@/components/kit/Text";
import type { ListHandle } from "@/components/list/List";
import { HeaderSpace, ScreenHeader } from "@/components/ScreenHeader";
import { ComposeSheet } from "@/components/social/ComposeSheet";
import { Composer } from "@/components/social/Composer";
import { PostList } from "@/components/social/PagedList";
import { PostCard } from "@/components/social/PostCard";
import { Button, TextLink } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { EXPLORE_WORDS, exploreStatusText } from "@/lib/explore";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";

/** A link of the status line: a 44 px target, as TextLink draws one. */
const LINE_LINK = cn("min-h-[44px] justify-center rounded-control active:opacity-70", FOCUS_RING);

/**
 * A post above the focused one, in the chain it replies to (UI design, section 8.3): a compact card joined to the next
 * by the 2 px thread line through the avatars; a post that is gone keeps its sentence, in the italic text face on a
 * surface-2 block, on the same line.
 */
function AncestorRow({ item }: { item: PostView | Tombstone }) {
  if (!("author" in item)) {
    return (
      <View className="px-4 pb-1 pt-3">
        <View className="rounded-media bg-surface-2 px-3 py-2.5">
          <Text tone="medium" italic>
            {item.deleted ? UI_WORDS["post.deleted"] : UI_WORDS["post.unavailable"]}
          </Text>
        </View>
      </View>
    );
  }
  return <PostCard post={item} joined />;
}

/**
 * The author's line under their own post (2c design, section 11): whether it is in Explore and, if not, which rule keeps
 * it out, in the formula's words and without any count, with the way to the rules and to the switch. Until the answer
 * comes, and if it fails, there is no line: the post is the screen, and the line only explains. It is asked again every
 * time the screen gains focus: the web keeps this screen mounted under the ones it links to, and Back shows it again as
 * it was, so after the switch is turned through the line's own link the line would otherwise still give the old reason.
 */
function ExploreStatusLine({ id }: { id: string }) {
  // The line with the post it was read for: the same post's line stays while it is asked again, and another post's never shows.
  const [line, setLine] = useState<{ id: string; text: string | null } | null>(null);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      social
        .exploreStatus(id)
        .then((answer) => {
          if (!cancelled) setLine({ id, text: exploreStatusText(answer.status) });
        })
        .catch(() => {
          if (!cancelled) setLine(null);
        });
      return () => {
        cancelled = true;
      };
    }, [id]),
  );

  const text = line?.id === id ? line.text : null;
  if (!text) return null;
  return (
    <View className="px-4 pb-2">
      <Text variant="meta" tone="medium">
        {text}
      </Text>
      <View className="flex-row flex-wrap gap-x-4">
        <Link href="/explore/about" asChild>
          <Pressable className={LINE_LINK}>
            <Text tone="accent" className="underline web:underline-offset-2">
              {EXPLORE_WORDS.about}
            </Text>
          </Pressable>
        </Link>
        <Link href="/settings/privacy" asChild>
          <Pressable className={LINE_LINK}>
            <Text tone="accent" className="underline web:underline-offset-2">
              {UI_WORDS["thread.exploreSetting"]}
            </Text>
          </Pressable>
        </Link>
      </View>
    </View>
  );
}

/** A post with the chain it replies to above it and its direct replies below, oldest first. */
export default function Thread() {
  const { id, quote } = useLocalSearchParams<{ id: string; quote?: string }>();
  const { state } = useSession();
  const viewer = state.status === "signed-in" && state.me.user.onboarded ? state.me.user.id : null;
  const signedIn = viewer !== null;
  const [thread, setThread] = useState<ThreadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [quoting, setQuoting] = useState(quote === "1");
  const title = usePageTitle("title.post");
  const missingTitle = usePageTitle("title.postMissing");

  useEffect(() => {
    let cancelled = false;
    setThread(null);
    setError(null);
    // The id comes from the address bar; anything but a post id is refused before a request is built from it.
    if (!PostId.safeParse(id).success) {
      setError("That address is not a post.");
      return;
    }
    social
      .thread(id)
      .then((t) => {
        if (!cancelled) setThread(t);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id, version]);

  // The screen stays mounted under the ones it links to, and Back shows it again as it was: on every focus after the
  // first, the post is read again into the thread on screen, without clearing it, so its card (the In Explore chip
  // included) follows a change made there. An id's first focus comes with the read above.
  const focusedFor = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (focusedFor.current !== id) {
        focusedFor.current = id;
        return undefined;
      }
      // An address that is not a post has its error on screen already, and no request may be built from it.
      if (!PostId.safeParse(id).success) return undefined;
      let cancelled = false;
      social
        .getPost(id)
        .then((post) => {
          if (!cancelled) setThread((current) => (current && current.post.id === post.id ? { ...current, post } : current));
        })
        // What is on screen stays: the next focus asks again.
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [id]),
  );

  const fetchReplies = useCallback((cursor?: string) => social.thread(id, cursor).then((t) => t.replies), [id]);

  // The page opens with the focused post at the top of the view and its ancestors above it, kept there by the list's
  // anchor while they and the replies are drawn (section 7.5); a reply written here reads the replies again, not the post.
  const list = useRef<ListHandle>(null);
  const opened = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!thread || opened.current === thread.post.id || thread.ancestors.length === 0) return;
    opened.current = thread.post.id;
    list.current?.hold("focused");
  }, [thread]);

  if (error) {
    return (
      <AppShell>
        {missingTitle}
        <ScreenHeader title={UI_WORDS["thread.missing"]} back="/" />
        <HeaderSpace />
        <View className="items-start gap-2 px-4 py-6">
          <Text tone="medium">{error}</Text>
          <TextLink label={UI_WORDS["thread.back"]} href="/" replace />
        </View>
      </AppShell>
    );
  }
  if (!thread) {
    return (
      <AppShell>
        {title}
        <ScreenHeader title={UI_WORDS["thread.title"]} back="/" />
        <HeaderSpace />
        <Skeleton.List kind="posts" count={1} />
      </AppShell>
    );
  }

  const mine = viewer !== null && thread.post.author.id === viewer;
  const header = (
    <View>
      <View {...dataAttribute("thread")}>
        {thread.ancestors.map((item) => (
          <AncestorRow key={item.id} item={item} />
        ))}
        {/* The focused post, which the list holds at the top when the page opens. */}
        <View {...dataAttribute("row", "focused")} className="border-b border-line-low">
          <PostCard post={thread.post} large onDeleted={() => router.replace("/")} />
          {/* Replies and quotes never enter Explore, so they get no line and no request. */}
          {mine && thread.post.replyTo === null && thread.post.quoteOf === null ? <ExploreStatusLine id={thread.post.id} /> : null}
          {signedIn ? (
            <View className="flex-row justify-end px-4 pb-3">
              <View className="-mt-6">
                <Button label={UI_WORDS["thread.quote"]} tone="secondary" full={false} onPress={() => setQuoting(true)} />
              </View>
            </View>
          ) : null}
        </View>
      </View>
      {signedIn ? (
        <Composer replyTo={thread.post} onPosted={() => setVersion((v) => v + 1)} />
      ) : (
        <View className="border-b border-line-low px-4 py-1">
          <TextLink label={UI_WORDS["thread.signIn"]} href="/signin" />
        </View>
      )}
    </View>
  );

  return (
    <AppShell>
      {title}
      <ScreenHeader title={UI_WORDS["thread.title"]} back="/" />
      <PostList key={version} handle={list} fetchPage={fetchReplies} empty={UI_WORDS["thread.empty"]} header={header} />
      <ComposeSheet open={quoting} quoteOf={thread.post} onClose={() => setQuoting(false)} onPosted={(post) => router.push(`/post/${post.id}`)} />
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/u/[handle]/index.tsx` (whole file)

```tsx
import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Link, router, useLocalSearchParams, type Href } from "expo-router";
import type { ProfileView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { Avatar } from "@/components/kit/Avatar";
import { FOCUS_RING, dataAttribute } from "@/components/kit/interaction";
import { Sheet } from "@/components/kit/Sheet";
import { Skeleton } from "@/components/kit/Skeleton";
import { TabPanel, Tabs } from "@/components/kit/Tabs";
import { Text } from "@/components/kit/Text";
import { HeaderSpace } from "@/components/ScreenHeader";
import { PostList, TimelineList } from "@/components/social/PagedList";
import { ProfileMenu } from "@/components/social/ProfileMenu";
import { FollowButton } from "@/components/social/ProfileList";
import { Button, ErrorText, VerifiedChip } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useAppearance } from "@/lib/appearance";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { isSuspendedRefusal } from "@/lib/standing";
import { RefusedNotice } from "@/components/moderation/RefusedNotice";
import { social } from "@/lib/social";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { useLayout } from "@/theme/layout";

type Tab = "posts" | "replies" | "likes";

const TAB_LABELS: Record<Tab, string> = { posts: UI_WORDS["profile.tab.posts"], replies: UI_WORDS["profile.tab.replies"], likes: UI_WORDS["profile.tab.likes"] };

/** The profile's panel, which its tabs control. */
const PANEL = "profile-panel";

/**
 * A count under the profile (section 8.4): the number in body-strong and its word, a link to the list where there is
 * one (signed in). With "Hide like, repost and follower counts" on, a link reads its word alone, "Followers" or
 * "Following" (decision 15), and a count without a link is not shown.
 */
function Stat({ value, label, hidden, href }: { value: number; label: string; hidden?: string; href?: Href }) {
  const { hideCounts } = useAppearance();
  if (hideCounts && hidden !== undefined && !href) return null;
  const inner =
    hideCounts && hidden !== undefined ? (
      <Text tone="medium">{hidden}</Text>
    ) : (
      <Text tone="low">
        <Text variant="body-strong">{String(value)}</Text> {label}
      </Text>
    );
  return href ? (
    <Link href={href} asChild>
      <Pressable className={cn("min-h-[44px] justify-center rounded-control web:hover:underline", FOCUS_RING)}>{inner}</Pressable>
    </Link>
  ) : (
    <View className="min-h-[44px] justify-center">{inner}</View>
  );
}

/** "Follows you": a neutral chip, no status colour (section 8.4). */
function FollowsYou() {
  return (
    <View className="self-start rounded-full border border-line-low bg-surface-2 px-2.5 py-0.5">
      <Text variant="chip" tone="medium">
        {UI_WORDS["profile.followsYou"]}
      </Text>
    </View>
  );
}

/** While the profile loads: the header's shapes and three posts' (section 8.4). */
function ProfileSkeleton() {
  return (
    <View>
      <View className="gap-3 px-4 pb-4 pt-6">
        <Skeleton.Circle size={64} />
        <Skeleton.Text width="45%" variant="post" />
        <Skeleton.Text width="30%" />
        <Skeleton.Text width="80%" />
      </View>
      <Skeleton.List kind="posts" count={3} />
    </View>
  );
}

/**
 * A profile (UI design, section 8.4): the header with the monogram, the display name as the screen's one h1 (decision
 * 16: the tab's title names the kind of screen only), the verified chip, the handle in the mono face, the bio, the
 * counts as links and "Follows you"; Follow and the More menu (Mute, Block, Report) for anyone but the owner, whose
 * place holds the way to their settings; then Posts and Replies, and Likes on the reader's own profile.
 */
export default function ProfileScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { state } = useSession();
  const title = usePageTitle("title.profile");
  const wide = useLayout() !== "phone";
  const me = state.status === "signed-in" && state.me.user.onboarded ? state.me : null;
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("posts");
  // The block question's sheet, mounted while it is open or closing, as the kit's sheets are.
  const [blocking, setBlocking] = useState({ mounted: false, open: false });
  const [actionError, setActionError] = useState<string | null>(null);
  // 3e (design, section 9.4): a follow refused account_suspended shows the refusal's sentence from /me, read again after it.
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // UI Task 3: the profile is read once the session is known, since what it holds depends on the reader; read while
    // the session loads, it was read twice, and its posts with it (UI design, section 11.3: three requests at most).
    if (state.status === "loading") return;
    let cancelled = false;
    setProfile(null);
    setError(null);
    setTab("posts");
    social
      .profile(handle)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [handle, state.status]);

  const fetchPosts = useCallback((cursor?: string) => social.profilePosts(handle, cursor), [handle]);
  const fetchReplies = useCallback((cursor?: string) => social.profileReplies(handle, cursor), [handle]);
  const fetchLikes = useCallback((cursor?: string) => social.myLikes(cursor), []);

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    setRefused(false);
    try {
      await action();
    } catch (err) {
      if (isSuspendedRefusal(err)) setRefused(true);
      else setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <AppShell>
        {title}
        <HeaderSpace />
        <View className="gap-2 px-4 py-6">
          <Text as="h1" variant="display-2">
            {UI_WORDS["profile.missing"]}
          </Text>
          <Text tone="medium">{error}</Text>
        </View>
      </AppShell>
    );
  }
  if (!profile) {
    return (
      <AppShell>
        {title}
        <HeaderSpace />
        <ProfileSkeleton />
      </AppShell>
    );
  }

  const own = me !== null && profile.id === me.user.id;
  const viewer = profile.viewer;
  const tabs: Tab[] = own ? ["posts", "replies", "likes"] : ["posts", "replies"];
  const mute = () =>
    void act(async () => {
      const { muted } = await social.setMute(profile.handle, !viewer!.muted);
      setProfile((current) => (current ? { ...current, viewer: { ...current.viewer!, muted } } : current));
    });
  // Unblocking needs no question; blocking asks first, in a sheet, with its words as they were.
  const block = () => {
    if (viewer?.blocked) {
      void act(async () => {
        const { blocked } = await social.setBlock(profile.handle, false);
        setProfile((current) => (current ? { ...current, viewer: { ...current.viewer!, blocked } } : current));
      });
      return;
    }
    setBlocking({ mounted: true, open: true });
  };

  const header = (
    <View>
      <View {...dataAttribute("profile-header")} className="gap-3 px-4 pb-2 pt-6">
        <Avatar account={profile} size={wide ? 96 : 64} />
        <View className="gap-0.5">
          <View className="flex-row flex-wrap items-center gap-x-2">
            {/* The display name is the screen's h1; it wraps rather than pushing the page sideways. */}
            <Text as="h1" variant={wide ? "display-1" : "display-2"} className="shrink web:break-words">
              {profile.displayName}
            </Text>
            {profile.verified ? <VerifiedChip /> : null}
          </View>
          <Text variant="mono" tone="low" style={{ fontWeight: "700" }}>
            @{profile.handle}
          </Text>
        </View>
        {profile.bio ? <Text variant="post">{profile.bio}</Text> : null}
        <View className="flex-row flex-wrap items-center gap-x-4">
          <Stat value={profile.counts.posts} label={UI_WORDS["profile.posts"]} />
          <Stat value={profile.counts.followers} label={UI_WORDS["profile.followers"]} hidden={UI_WORDS["profile.followers.hidden"]} href={me ? `/u/${profile.handle}/followers` : undefined} />
          <Stat value={profile.counts.following} label={UI_WORDS["profile.following"]} hidden={UI_WORDS["profile.following.hidden"]} href={me ? `/u/${profile.handle}/following` : undefined} />
        </View>
        {viewer?.followedBy ? <FollowsYou /> : null}
        <View className="flex-row flex-wrap items-center gap-2">
          {me && !own && viewer ? (
            <FollowButton
              handle={profile.handle}
              initial={viewer.following}
              onChange={(following, followerCount) =>
                setProfile((current) => (current ? { ...current, counts: { ...current.counts, followers: followerCount }, viewer: { ...current.viewer!, following } } : current))
              }
            />
          ) : null}
          {own ? (
            <View className="-mt-6">
              <Button label={UI_WORDS["profile.settings"]} onPress={() => router.push("/settings/security")} tone="secondary" full={false} />
            </View>
          ) : (
            <ProfileMenu profile={profile} onMute={mute} onBlock={block} />
          )}
        </View>
        {!me ? (
          <Text variant="meta" tone="low">
            {UI_WORDS["profile.signIn"]}
          </Text>
        ) : null}
        <ErrorText message={actionError} />
        {refused ? <RefusedNotice standing={me?.standing ?? null} /> : null}
      </View>
      <View className="border-b border-line-low px-3">
        <Tabs label={UI_WORDS["profile.tabs"]} tabs={tabs.map((key) => ({ key, label: TAB_LABELS[key] }))} selected={tab} onSelect={setTab} panelId={PANEL} />
      </View>
    </View>
  );

  return (
    <AppShell>
      {title}
      <TabPanel panelId={PANEL} selected={tab}>
        {tab === "posts" ? (
          <TimelineList key="posts" fetchPage={fetchPosts} empty={UI_WORDS["profile.empty.posts"]} header={header} />
        ) : tab === "replies" ? (
          <PostList key="replies" fetchPage={fetchReplies} empty={UI_WORDS["profile.empty.replies"]} header={header} />
        ) : (
          <PostList key="likes" fetchPage={fetchLikes} empty={UI_WORDS["profile.empty.likes"]} header={header} />
        )}
      </TabPanel>
      {blocking.mounted ? (
        <Sheet
          open={blocking.open}
          onClose={() => setBlocking({ mounted: true, open: false })}
          onClosed={() => setBlocking({ mounted: false, open: false })}
          title={fill(UI_WORDS["profile.blockQuestion"], { handle: profile.handle })}
          description={UI_WORDS["profile.blockBody"]}
        >
          <View className="flex-row flex-wrap gap-x-2">
            <Button
              label={UI_WORDS["profile.block"]}
              tone="danger"
              full={false}
              busy={busy}
              onPress={() =>
                void act(async () => {
                  await social.setBlock(profile.handle, true);
                  router.replace("/settings/privacy");
                })
              }
            />
            <Button label={UI_WORDS["profile.cancel"]} tone="secondary" full={false} onPress={() => setBlocking({ mounted: true, open: false })} />
          </View>
        </Sheet>
      ) : null}
    </AppShell>
  );
}
```

### Replace `apps/app/src/components/kit/ListRow.tsx` (whole file)

```tsx
import type { ReactElement, ReactNode } from "react";
import { Pressable, Switch, View } from "react-native";
import { Link, type Href } from "expo-router";
import type { IconName } from "@/components/icons";
import { cn } from "@/theme/cn";
import { useTheme } from "@/theme/ThemeProvider";
import { Icon } from "./Icon";
import { FOCUS_RING_INSET, HOVER_WASH, pressDelay } from "./interaction";
import { Text } from "./Text";

/**
 * One row for settings, lists of accounts, menus on phones and the details sheet (UI design, section 6.11), in four
 * forms by what it does: a link (`href`, an anchor with a chevron), a button (`onPress`), a switch, and a radio in a
 * RadioGroup. `label` is required: it is the row's title and its accessible name (section 6.1). The row is 52 px tall at
 * least (a 44 px target and its padding), divided by line-low, surface-2 under a fine pointer, and surface-2 when
 * pressed, after 80 ms, since a scroll starts on rows. Rows never scale. Their focus ring is drawn inside, where the
 * column's edges cannot clip it.
 *
 * UI Task 5 extends it for a list of accounts (8.4): `leading` puts an element (the account's Avatar) in the icon's
 * place, `badge` follows the label (the VerifiedChip), `detail` replaces the meta line (the handle in the mono face and
 * the bio), and a link row may carry a control of the kind "button" (FollowButton), drawn beside the link and outside
 * it, since a button inside an anchor is a control no assistive technology can reach; such a row has no chevron.
 */
export type ListRowControl =
  | { kind: "switch"; value: boolean; onValueChange: (next: boolean) => void; disabled?: boolean }
  | { kind: "radio"; checked: boolean; onSelect: () => void };

/** A control of its own beside a link row: an element with its own name and press (FollowButton). */
export type ListRowButton = { kind: "button"; element: ReactElement };

interface RowContent {
  label: string;
  /** One line under the label, in meta. */
  description?: string;
  icon?: IconName;
  /** A short trailing text, such as the chosen theme. */
  value?: string;
  tone?: "default" | "danger";
  /** In the icon's place: an account's Avatar. */
  leading?: ReactNode;
  /** After the label: the VerifiedChip. */
  badge?: ReactNode;
  /** Under the label in place of the description: an account's handle and bio. */
  detail?: ReactNode;
}

export type ListRowProps = RowContent & ({ href: Href; control?: ListRowButton } | { onPress: () => void } | { control: ListRowControl });

const ROW = cn("min-h-[52px] flex-row items-center gap-3 border-b border-line-low px-4 py-3", HOVER_WASH);

/**
 * The switch row's ring. react-native-web draws a switch's focus as a faint shadow on its thumb, which forced colours
 * remove, so the row draws korbat's ring, inside, while the switch in it has keyboard focus.
 */
const SWITCH_RING = "web:has-[:focus-visible]:outline web:has-[:focus-visible]:outline-2 web:has-[:focus-visible]:-outline-offset-2 web:has-[:focus-visible]:outline-focus";

/** The pressed wash, after the 80 ms delay; an inline colour, so it shows over the hover's class. */
function usePressedWash() {
  const { colors } = useTheme();
  return (pressed: boolean) => (pressed ? { backgroundColor: colors["surface-2"] } : undefined);
}

/** The label, its description, and what trails it. */
function Content({ label, description, icon, value, tone = "default", leading, badge, detail, trailing }: RowContent & { trailing?: ReactNode }) {
  const danger = tone === "danger";
  const title = (
    <Text variant="body-strong" tone={danger ? "danger" : "high"} className={badge === undefined ? undefined : "shrink"}>
      {label}
    </Text>
  );
  return (
    <>
      {leading ?? (icon !== undefined ? <Icon name={icon} size={20} tone={danger ? "danger" : "medium"} /> : null)}
      <View className="min-w-0 flex-1 gap-0.5">
        {badge === undefined ? (
          title
        ) : (
          <View className="flex-row flex-wrap items-center gap-x-1.5">
            {title}
            {badge}
          </View>
        )}
        {detail}
        {description !== undefined ? (
          <Text variant="meta" tone="low">
            {description}
          </Text>
        ) : null}
      </View>
      {value !== undefined ? <Text tone="low">{value}</Text> : null}
      {trailing}
    </>
  );
}

/** The circle of a radio row: a ring, filled with the accent when chosen; the row's aria-checked says the same in words. */
function RadioMark({ checked }: { checked: boolean }) {
  return (
    <View className={cn("h-5 w-5 items-center justify-center rounded-full border-2", checked ? "border-accent" : "border-line-high")}>
      {checked ? <View className="h-2.5 w-2.5 rounded-full bg-accent" /> : null}
    </View>
  );
}

export function ListRow(props: ListRowProps) {
  const wash = usePressedWash();
  const { colors } = useTheme();
  const { label, description, icon, value, tone, leading, badge, detail } = props;
  const content = { label, description, icon, value, tone, leading, badge, detail };

  if ("href" in props) {
    const link = (
      <Link href={props.href} asChild>
        <Pressable {...pressDelay(80)} className={cn(FOCUS_RING_INSET, props.control ? "min-w-0 flex-1" : undefined)}>
          {({ pressed }) => (
            <View className={props.control ? cn(ROW, "border-b-0 pr-2") : ROW} style={wash(pressed)}>
              <Content {...content} trailing={props.control ? undefined : <Icon name="next" size={20} tone="low" />} />
            </View>
          )}
        </Pressable>
      </Link>
    );
    if (!props.control) return link;
    // The control beside the link, in the same row and under the same divider, but no part of the anchor.
    return (
      <View className="flex-row items-center border-b border-line-low pr-4">
        {link}
        {props.control.element}
      </View>
    );
  }

  if ("onPress" in props) {
    return (
      <Pressable accessibilityRole="button" onPress={props.onPress} {...pressDelay(80)} className={FOCUS_RING_INSET}>
        {({ pressed }) => (
          <View className={ROW} style={wash(pressed)}>
            <Content {...content} />
          </View>
        )}
      </Pressable>
    );
  }

  const control = props.control;
  if (control.kind === "radio") {
    return (
      <Pressable role="radio" aria-checked={control.checked} onPress={control.onSelect} {...pressDelay(80)} className={FOCUS_RING_INSET}>
        {({ pressed }) => (
          <View className={ROW} style={wash(pressed)}>
            <Content {...content} trailing={<RadioMark checked={control.checked} />} />
          </View>
        )}
      </Pressable>
    );
  }

  // The switch is the one control, with its own name and state: Tab reaches it and Space flips it. The row around it
  // flips it too for a pointer, as a convenience: it is no tab stop and no second control, and the switch takes no
  // pointer of its own, so one click never flips it twice.
  const flip = () => {
    if (!control.disabled) control.onValueChange(!control.value);
  };
  return (
    <Pressable onPress={flip} tabIndex={-1} {...pressDelay(80)}>
      {({ pressed }) => (
        <View className={cn(ROW, SWITCH_RING)} style={wash(pressed)}>
          <Content
            {...content}
            trailing={
              <View pointerEvents="none">
                <Switch accessibilityLabel={label} value={control.value} onValueChange={control.onValueChange} disabled={control.disabled} trackColor={{ false: colors["line-high"], true: colors.accent }} thumbColor={colors["surface-1"]} />
              </View>
            }
          />
        </View>
      )}
    </Pressable>
  );
}

/** A group of radio rows, named by its heading's nativeID (section 6.11). */
export function RadioGroup({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  return (
    <View role="radiogroup" aria-labelledby={labelledBy}>
      {children}
    </View>
  );
}
```

### Replace `apps/app/src/components/social/ExploreList.tsx` (whole file)

```tsx
import { useCallback, useEffect, useRef, useState, type ReactElement, type Ref } from "react";
import { View } from "react-native";
import { EXPLORE_V2, type ExploreFormula } from "@korbat/contracts";
import { List, useStable } from "@/components/list/List";
import { Text } from "@/components/kit/Text";
import { Button, ErrorText, TextLink } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { EXPLORE_REFRESHED_NOTICE, EXPLORE_WORDS, exploreEmptyText, exploreReader, NOTHING_SHOWN, rankingAge, type ExploreShown, type RankingRead } from "@/lib/explore";
import { feedRows } from "@/lib/feed-rows";
import { social } from "@/lib/social";
import { UI_WORDS } from "@/lib/ui-words";
import { FeedRowView, feedRowVersion } from "./FeedRows";
import { PostCard } from "./PostCard";

/** Reads the clock again every minute, so "Updated N minutes ago" stays true while the screen is open. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function AboutLink() {
  return <TextLink label={EXPLORE_WORDS.about} href="/explore/about" />;
}

/**
 * Under the tabs: how long ago the ranking on screen was computed, or since when it had not been when it was read; once it
 * is as old as the refresh interval, Refresh, which reads the first page again (pull to refresh does so on a phone, but
 * nothing does on the web); and the link to its rules. The line can take the focus, which the list gives it after Refresh.
 * A stale ranking's line is in the review ink, its words saying the same (UI design, section 4.8).
 */
export function ExploreHeader({ ranking, onRefresh, lineRef }: { ranking: RankingRead | null; onRefresh: () => void; lineRef?: Ref<View> }) {
  const now = useMinuteClock();
  // Before the first round there is no ranking, no time to show and nothing to read again.
  const age = ranking ? rankingAge(ranking, now) : null;
  return (
    <View className="flex-row flex-wrap items-center justify-between gap-x-4 border-b border-line-low px-4 py-1">
      <View ref={lineRef} tabIndex={-1} className="rounded-control">
        {age ? (
          <Text variant="meta" tone={age.stale ? "review-ink" : "low"}>
            {age.text}
          </Text>
        ) : null}
      </View>
      <View className="flex-row items-center gap-x-4">
        {age?.offerRefresh ? (
          <View className="-mt-6">
            <Button label={EXPLORE_WORDS.refresh} tone="secondary" full={false} onPress={onRefresh} />
          </View>
        ) : null}
        <AboutLink />
      </View>
    </View>
  );
}

/** An empty Explore (2c design, section 11): when a post appears there, in the formula's numbers, with the rules and a way on. */
export function ExploreEmpty({ onShowLatest, formula = EXPLORE_V2 }: { onShowLatest: () => void; formula?: ExploreFormula }) {
  return (
    <View className="items-center gap-2 px-6 py-12">
      <Text tone="medium" className="max-w-[440px] text-center">
        {exploreEmptyText(formula)}
      </Text>
      <AboutLink />
      <Button label={EXPLORE_WORDS.showLatest} tone="secondary" full={false} onPress={onShowLatest} />
    </View>
  );
}

/**
 * The end of the list. The status line is always in the tree, so a screen reader hears the refresh notice when it
 * appears, and it can take the focus when Load more, which had it, leaves; then an error beside posts already shown, Load
 * more while the ranking has more, and, for a signed-out reader, who never gets a cursor, the way to see more.
 */
export function ExploreFooter({
  cursor,
  signInForMore,
  notice,
  error,
  onLoadMore,
  statusRef,
}: {
  cursor: string | null;
  signInForMore: boolean;
  notice: string | null;
  error: string | null;
  onLoadMore: () => void;
  statusRef?: Ref<View>;
}) {
  return (
    <View className="items-center px-4 pb-8 pt-2">
      <View ref={statusRef} role="status" aria-live="polite" tabIndex={-1}>
        {notice ? <Text tone="medium" className="mb-2 text-center">{notice}</Text> : null}
      </View>
      <ErrorText message={error} />
      {cursor ? <Button label={UI_WORDS["feed.loadMore"]} tone="secondary" full={false} onPress={onLoadMore} /> : null}
      {signInForMore ? <TextLink label={EXPLORE_WORDS.signInForMore} href="/signin" /> : null}
    </View>
  );
}
/**
 * Explore under Home's tabs (2c design, section 11; UI design, section 8.2), on List and its typed rows. Its reads go
 * through one exploreReader made with the list, which lets one read run at a time and answers what the list shows; the
 * component only puts that on screen. A cursor names the ranking it came from; when a refresh has pruned that ranking,
 * the reader reads the current one from its first page and adds only the posts not on screen, so the posts already read
 * stay where they are, the focus stays at the footer and the status line says what happened. Explore is ranked, so it
 * has no marker, no pill and no stored place, and it is never kept in lib/feed-cache.ts: its answers live in this
 * component and its reader alone, nothing keeps them once it unmounts, and returning to the tab reads it again.
 */
export function ExploreList({ onShowLatest, header }: { onShowLatest: () => void; header?: ReactElement }) {
  const [reader] = useState(() => exploreReader(social.explore));
  const [shown, setShown] = useState<ExploreShown>(NOTHING_SHOWN);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshes, setRefreshes] = useState(0);
  const [lineFocus, setLineFocus] = useState(0);
  const footer = useRef<View>(null);
  const line = useRef<View>(null);

  const load = useCallback(
    async (after?: string, focusLine = false) => {
      setNotice(null);
      try {
        const answer = await reader.load(after);
        // Another read is in flight: its answer, still to come, is what the list shows, and it ends the refresh.
        if (!answer) return;
        setShown(answer);
        setError(null);
        if (answer.refreshed) {
          setNotice(EXPLORE_REFRESHED_NOTICE);
          setRefreshes((count) => count + 1);
        }
        if (focusLine) setLineFocus((count) => count + 1);
      } catch (err) {
        setError(errorMessage(err));
      }
      setLoading(false);
      setRefreshing(false);
    },
    [reader],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Pull to refresh and the header's Refresh read the first page again, in place of the posts on screen.
  const refresh = (focusLine: boolean) => {
    setRefreshing(true);
    void load(undefined, focusLine);
  };

  // After a refresh the focus stays at the footer: Load more keeps it while the new ranking has more, and when the ranking
  // ended, Load more has left the tree with the focus, so the status line takes it.
  useEffect(() => {
    if (refreshes > 0 && shown.cursor === null) (footer.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [refreshes]);

  // After the header's Refresh the line saying how old the ranking now is takes the focus: the button leaves the tree
  // once the ranking it read is fresh.
  useEffect(() => {
    if (lineFocus > 0) (line.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [lineFocus]);

  const remove = (id: string) => setShown(reader.remove(id));
  // Rows drawn earlier keep what they were drawn with (List): these reach the latest state.
  const retry = useStable(() => void load());

  // The posts as typed rows: skeletons, the error and the empty state are rows of the list, so the tabs above never move.
  // Load more and the sign-in link stay in the footer, with the status line the refresh notice needs.
  const result = feedRows({
    items: shown.items,
    keyOf: (item) => item.post.id,
    status: loading ? "loading" : error && shown.items.length === 0 ? "error" : "ready",
    error,
    cursor: null,
  });
  // The ranking says whether more exists: the feed's size is unknown while it has a cursor.
  const setSize = shown.cursor === null ? result.setSize : -1;

  return (
    <List
      rows={result.rows}
      keyOf={(row) => row.key}
      versionOf={(row) => feedRowVersion(row, setSize)}
      renderRow={(row, index) => (
        <FeedRowView
          row={row}
          index={index}
          setSize={setSize}
          renderPost={(item, place) => <PostCard post={item.post} onDeleted={remove} {...place} />}
          empty={<ExploreEmpty onShowLatest={onShowLatest} />}
          onRetry={retry}
          onLoadMore={retry}
        />
      )}
      header={
        <>
          {header}
          <ExploreHeader ranking={shown.ranking} onRefresh={() => refresh(true)} lineRef={line} />
        </>
      }
      feed
      busy={loading}
      refreshing={refreshing}
      onRefresh={() => refresh(false)}
      footer={
        <ExploreFooter
          cursor={shown.cursor}
          signInForMore={shown.signInForMore}
          notice={notice}
          error={shown.items.length > 0 ? error : null}
          onLoadMore={() => {
            if (shown.cursor) void load(shown.cursor);
          }}
          statusRef={footer}
        />
      }
    />
  );
}
```

### Replace `apps/app/src/components/social/MediaGrid.tsx` (whole file)

```tsx
import { createContext, useContext, useRef, useState } from "react";
import { Image } from "expo-image";
import { Pressable, View } from "react-native";
import { isHiddenMedia, type HiddenMedia, type MediaView } from "@korbat/contracts";
import { FOCUS_RING_INSET } from "@/components/kit/interaction";
import { StatusChip } from "@/components/kit/StatusChip";
import { Text } from "@/components/kit/Text";
import { API_BASE } from "@/lib/api";
import { useMotion } from "@/lib/motion";
import { CHIP_WORDS } from "@/lib/moderation-words";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { HiddenImage, HiddenRowWords, HiddenThumbnail, hiddenImageWords } from "./HiddenImage";
import { ImageFaultView, useImageFault } from "./ImageFault";
import { MediaViewer, Thumbnails } from "./MediaViewer";

/** A single image keeps its own shape, within limits, so a very tall or very wide one cannot take over the timeline. */
const MIN_RATIO = 3 / 4;
const MAX_RATIO = 2;
const FRAME_RATIO = 16 / 9;
const GAP = 2;
const THUMBNAIL = 64;

export const clampRatio = (width: number, height: number): number => Math.min(MAX_RATIO, Math.max(MIN_RATIO, width / height));

/**
 * Whether the images below load first (section 11.2): a list sets it for its first two rows, through PostCard, so the
 * images a reader sees on opening are asked before those further down.
 */
export const ImagePriority = createContext(false);

/**
 * The small size of an image with its blurhash (UI design, section 11.2). expo-image loads it lazily on the web and keeps
 * its view for the next image of a recycled row by the media id; the blurhash cross-fades into the image in 150 ms
 * unless motion is reduced, by the system or the reader, which swaps it at once.
 */
function Picture({ item, style, onError }: { item: MediaView; style: { width: number | "100%"; height: number | "100%" }; onError?: () => void }) {
  const { reduced } = useMotion();
  const first = useContext(ImagePriority);
  return (
    // On the web expo-image takes the <img alt> from accessibilityLabel, not from alt.
    <Image source={{ uri: `${API_BASE}${item.small}` }} placeholder={{ blurhash: item.blurhash }} recyclingKey={item.id} contentFit="cover" transition={reduced ? 0 : 150} priority={first ? "high" : "normal"} accessibilityLabel={item.alt} style={style} onError={onError} />
  );
}

/**
 * The label on the author's own image that moderation withheld or removed (3c design, section 9): the author keeps seeing
 * such an image, and reads on the image itself that others do not. The API marks an image so only for its author. It is
 * the information-only StatusChip in the image's corner (UI design, section 6.7), and takes no press: the image under it
 * still opens.
 */
export function OwnImageLabel({ state }: { state: NonNullable<MediaView["moderation"]> }) {
  const withheld = state === "withheld";
  return (
    <View pointerEvents="none" className="absolute left-2 top-2 right-2">
      <StatusChip tone={withheld ? "review" : "restricted"} label={withheld ? CHIP_WORDS.underReview : CHIP_WORDS.removed} />
    </View>
  );
}

/**
 * One image of the frame: the control that opens it and, beside that control, the label of the author's own restricted
 * image, as text of its own. 3d: when an image of the reader's own post fails to load, its status is asked once, and an
 * image being restored or lost shows why in its place, with nothing to open. `cell` keeps the control's element, which
 * the lightbox grows from and returns into.
 */
function Cell({ item, onPress, own, cell }: { item: MediaView; onPress: () => void; own: boolean; cell: (node: View | null) => void }) {
  const { fault, onError } = useImageFault(item.id, own);
  return (
    <View style={{ flex: 1 }}>
      {fault !== null ? (
        <ImageFaultView fault={fault} />
      ) : (
        <Pressable ref={cell} accessibilityRole="button" accessibilityLabel={fill(UI_WORDS["media.open"], { alt: item.alt })} onPress={onPress} style={{ flex: 1 }} className={FOCUS_RING_INSET}>
          <Picture item={item} style={{ width: "100%", height: "100%" }} onError={onError} />
        </Pressable>
      )}
      {item.moderation ? <OwnImageLabel state={item.moderation} /> : null}
    </View>
  );
}

/**
 * The images of a post (UI design, section 6.7). One image is shown in its own ratio; two to four share a 16:9 frame and
 * are cropped to their cell. The frame is clipped to radius media with a 1 px line-low hairline drawn inside it, so a
 * white image keeps its edge on the Light theme. Pressing one opens the viewer, which grows from it; ALT shows the
 * descriptions in place. An image moderation hid from this reader keeps its place as a placeholder: it has no size of its
 * own, so alone it takes the frame's ratio, it is no control, and it has no description to show. The viewer is told the
 * post that holds the images, so that an image can be reported on it, unless the post is the reader's own.
 */
function Grid({ media, postId, own }: { media: (MediaView | HiddenMedia)[]; postId?: string; own?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const [described, setDescribed] = useState(false);
  // Each cell's control, by its place, for the viewer to measure.
  const cells = useRef<(View | null)[]>([]);
  const cell = (index: number) => {
    const item = media[index]!;
    return isHiddenMedia(item) ? <HiddenImage key={item.id} item={item} /> : <Cell key={item.id} item={item} onPress={() => setOpen(index)} own={own === true} cell={(node) => void (cells.current[index] = node)} />;
  };
  const first = media[0]!;
  // Descriptions exist only for the images this reader is shown.
  const anyShown = media.some((item) => !isHiddenMedia(item));

  let frame;
  if (media.length === 1) {
    frame = <View style={{ aspectRatio: isHiddenMedia(first) ? FRAME_RATIO : clampRatio(first.width, first.height) }}>{cell(0)}</View>;
  } else if (media.length === 2) {
    frame = <View style={{ aspectRatio: FRAME_RATIO, flexDirection: "row", gap: GAP }}>{[cell(0), cell(1)]}</View>;
  } else if (media.length === 3) {
    frame = (
      <View style={{ aspectRatio: FRAME_RATIO, flexDirection: "row", gap: GAP }}>
        {cell(0)}
        <View style={{ flex: 1, gap: GAP }}>{[cell(1), cell(2)]}</View>
      </View>
    );
  } else {
    frame = (
      <View style={{ aspectRatio: FRAME_RATIO, gap: GAP }}>
        <View style={{ flex: 1, flexDirection: "row", gap: GAP }}>{[cell(0), cell(1)]}</View>
        <View style={{ flex: 1, flexDirection: "row", gap: GAP }}>{[cell(2), cell(3)]}</View>
      </View>
    );
  }

  return (
    <View className="mt-2">
      <View className="overflow-hidden rounded-media bg-surface-2">
        {frame}
        <View pointerEvents="none" aria-hidden className="absolute inset-0 rounded-media border border-line-low" />
      </View>
      {anyShown ? (
        // The one ALT toggle (a per-image badge would say nothing: every korbat image has a description), a 44 px target.
        <Pressable
          accessibilityRole="button"
          aria-expanded={described}
          accessibilityLabel={described ? UI_WORDS["media.hideAlt"] : UI_WORDS["media.showAlt"]}
          onPress={() => setDescribed(!described)}
          className={cn("group min-h-[44px] min-w-[44px] items-start justify-center self-start rounded-control", FOCUS_RING_INSET)}
        >
          <View className={cn("rounded-[6px] border px-1.5 py-0.5", described ? "border-accent bg-accent-wash" : "border-line-high bg-surface-1 web:group-hover:bg-surface-2")}>
            <Text variant="chip" tone={described ? "accent" : "medium"}>
              {UI_WORDS["media.alt"]}
            </Text>
          </View>
        </Pressable>
      ) : null}
      {described
        ? media.map((item, index) => (
            <Text key={item.id} tone="medium" className="mt-1">
              {media.length > 1 ? `${index + 1}. ` : ""}
              {/* A hidden image keeps its number, so the others' numbers match their places in the frame. */}
              {isHiddenMedia(item) ? hiddenImageWords(item) : item.alt}
            </Text>
          ))
        : null}
      <Thumbnails.Provider value={cells}>
        {open === null ? null : <MediaViewer media={media} index={open} onIndex={setOpen} onClose={() => setOpen(null)} postId={own ? undefined : postId} own={own === true} />}
      </Thumbnails.Provider>
    </View>
  );
}

/**
 * A post's images (`Grid`), or a quoted post's as one row of small squares (`compact`). The squares
 * are pictures, not buttons: the whole quote is a link to the quoted post, where the grid and the
 * viewer are, and a control inside another control is one that assistive technology cannot reach.
 * A hidden image keeps its square in the row, and the row says the placeholder's sentence once, as
 * text, under the squares. `postId` is the post that holds the images and `own` says that the reader
 * wrote it: the viewer reports an image on that post, and offers no report of the reader's own.
 */
export function MediaGrid({ media, compact = false, postId, own = false }: { media: (MediaView | HiddenMedia)[]; compact?: boolean; postId?: string; own?: boolean }) {
  if (media.length === 0) return null;
  if (!compact) return <Grid media={media} postId={postId} own={own} />;
  return (
    <View className="mt-2">
      <View className="flex-row" style={{ gap: GAP }}>
        {media.map((item) =>
          isHiddenMedia(item) ? (
            <HiddenThumbnail key={item.id} size={THUMBNAIL} />
          ) : (
            <View key={item.id} className="overflow-hidden rounded-media border border-line-low" style={{ width: THUMBNAIL, height: THUMBNAIL }}>
              <Picture item={item} style={{ width: "100%", height: "100%" }} />
            </View>
          ),
        )}
      </View>
      <HiddenRowWords media={media} />
    </View>
  );
}
```

### Replace `apps/app/src/components/social/PagedList.tsx` (whole file)

```tsx
import { useCallback, useEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import type { PostView, TimelineItem } from "@korbat/contracts";
import { List, useStable, type ListHandle } from "@/components/list/List";
import { errorMessage } from "@/lib/api";
import { feedRows } from "@/lib/feed-rows";
import type { Page } from "@/lib/social";
import { feedRowVersion, renderFeedRow, type FeedRowOptions, type PostPlace } from "./FeedRows";
import { PostCard } from "./PostCard";

interface PagedListProps<T> {
  /** Must be stable (useCallback) or the list reloads on every render. */
  fetchPage: (cursor?: string) => Promise<Page<T>>;
  keyOf: (item: T) => string;
  render: (item: T, remove: (key: string) => void, place: PostPlace) => ReactElement;
  /** The list's empty sentence, word for word, with a title over it where the screen has one (6.12). */
  empty: string | { title?: string; body: string };
  header?: ReactElement;
  /** Posts are a feed of articles (section 10); accounts are rows. */
  kind?: "posts" | "accounts";
  /** The list's handle, for a screen that shows a row at the top (the thread's focused post). */
  handle?: RefObject<ListHandle | null>;
}

/**
 * Cursor pagination on List and its typed rows (UI design, sections 7.5, 8.1 and 11.1): skeleton rows while the first
 * page loads, the empty and error states as rows, "Load more" at the end of each page and a failed page's sentence in its
 * place, pull to refresh on native. One request is in flight at a time, and a response only lands if no newer request
 * started meanwhile, so a double tap on Load more cannot append a page twice and a refresh cannot be overwritten by an
 * older page. A removed row hands the focus it held to the next row (List).
 */
export function PagedList<T>({ fetchPage, keyOf, render, empty, header, kind = "posts", handle }: PagedListProps<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);
  const sequence = useRef(0);
  const own = useRef<ListHandle>(null);
  const list = handle ?? own;
  const shown = useRef(items);
  shown.current = items;

  const load = useCallback(
    async (after?: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      const mine = ++sequence.current;
      if (after) setLoadingMore(true);
      try {
        const page = await fetchPage(after);
        if (mine !== sequence.current) return;
        setItems((current) => (after ? [...current, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setStatus("ready");
        setError(null);
        setMoreError(null);
      } catch (err) {
        if (mine !== sequence.current) return;
        // A first page that failed is the list's error state; a later one, or a refresh over rows, is a row of its own.
        if (after || shown.current.length > 0) setMoreError(errorMessage(err));
        else {
          setError(errorMessage(err));
          setStatus("error");
        }
      } finally {
        if (mine === sequence.current) {
          inFlight.current = false;
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    [fetchPage],
  );

  useEffect(() => {
    // A new source (another tab, another profile) supersedes whatever the old one still has in flight.
    sequence.current++;
    inFlight.current = false;
    setStatus("loading");
    void load();
  }, [load]);

  // Rows drawn earlier keep the functions they were drawn with (List), so these read the latest state when called.
  const remove = useStable((key: string) => {
    setItems((current) => current.filter((item) => keyOf(item) !== key));
  });
  // Load more, or Try again on a failed page: the next page, or page one again after a refresh that failed.
  const more = useStable(() => {
    setMoreError(null);
    void load(cursor ?? undefined);
  });
  const retry = useStable(() => {
    setStatus("loading");
    void load();
  });

  const result = feedRows({ items, keyOf, status, error, cursor, loadingMore, moreError, skeletons: kind === "accounts" ? 6 : undefined });
  const options = (index: number): FeedRowOptions<T> => ({
    renderPost: (item, place) => render(item, remove, place),
    setSize: result.setSize,
    index,
    kind,
    empty: typeof empty === "string" ? { body: empty } : empty,
    onRetry: retry,
    onLoadMore: more,
  });

  return (
    <List
      handle={list}
      rows={result.rows}
      keyOf={(row) => row.key}
      versionOf={(row) => feedRowVersion(row, result.setSize)}
      renderRow={(row, index) => renderFeedRow(row, options(index))}
      header={header}
      feed={kind === "posts"}
      busy={status === "loading" || loadingMore}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
    />
  );
}

/** A timeline row's key: a post by its id, a repost by the post and who reposted it, so both can be listed. */
export const timelineKey = (item: TimelineItem) => (item.kind === "repost" ? `${item.post.id}:${item.repostedBy.id}` : item.post.id);

export function TimelineList({ fetchPage, empty, header }: { fetchPage: (cursor?: string) => Promise<Page<TimelineItem>>; empty: string | { title?: string; body: string }; header?: ReactElement }) {
  return (
    <PagedList
      fetchPage={fetchPage}
      keyOf={timelineKey}
      empty={empty}
      header={header}
      render={(item, remove, place) => (
        <PostCard post={item.post} repostedBy={item.kind === "repost" ? item.repostedBy : undefined} onDeleted={() => remove(timelineKey(item))} {...place} />
      )}
    />
  );
}

export function PostList({
  fetchPage,
  empty,
  header,
  handle,
}: {
  fetchPage: (cursor?: string) => Promise<Page<PostView>>;
  empty: string | { title?: string; body: string };
  header?: ReactElement;
  handle?: RefObject<ListHandle | null>;
}) {
  return <PagedList fetchPage={fetchPage} keyOf={(post) => post.id} empty={empty} header={header} handle={handle} render={(post, remove, place) => <PostCard post={post} onDeleted={remove} {...place} />} />;
}
```

### Replace `apps/app/src/components/social/PostCard.tsx` (whole file)

```tsx
import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { Platform, Pressable, Text as Inline, View } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Link, router } from "expo-router";
import type { Author, PostView, QuotedPost, Tombstone } from "@korbat/contracts";
import { RefusedNotice } from "@/components/moderation/RefusedNotice";
import { toast } from "@/components/toast";
import { ErrorText, VerifiedChip } from "@/components/ui";
import { Avatar } from "@/components/kit/Avatar";
import { Icon } from "@/components/kit/Icon";
import { IconButton, type IconButtonFeedback } from "@/components/kit/IconButton";
import { FOCUS_RING, dataAttribute, pressDelay } from "@/components/kit/interaction";
import { Menu, type MenuItem } from "@/components/kit/Menu";
import { StatusChip, type StatusTone } from "@/components/kit/StatusChip";
import { Text } from "@/components/kit/Text";
import { VISUALLY_HIDDEN, VisuallyHidden } from "@/components/kit/VisuallyHidden";
import { errorMessage } from "@/lib/api";
import { useAppearance } from "@/lib/appearance";
import { useHaptics } from "@/lib/haptics";
import { chipText } from "@/lib/moderation";
import { CHIP_WORDS } from "@/lib/moderation-words";
import { useMotion } from "@/lib/motion";
import { countLabel, deleteWithLeave, failedWords, shownCount, threadStats, toggleEngagement, type ToggleKind } from "@/lib/post-actions";
import { useSession } from "@/lib/session";
import { isSuspendedRefusal } from "@/lib/standing";
import { lanes, laneKey, social } from "@/lib/social";
import { fullDate, postedWhen, timeAgo } from "@/lib/time";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { useLayout } from "@/theme/layout";
import { ImagePriority, MediaGrid } from "./MediaGrid";
import { PostMenu } from "./PostMenu";
import { RichText } from "./RichText";

/**
 * A link inside a line of text (the author line, the repost line, the reply context): inline, so a phone holds it to
 * WCAG 2.5.8's 24 px rather than a control's 44, and padded to reach it, which does not move the line.
 */
const INLINE_LINK = cn("rounded-sm py-1.5 web:hover:underline", FOCUS_RING);

/**
 * Who wrote the post and when (UI design, section 6.6): the display name in body-strong as the link to the profile, the
 * verified chip, the handle in the mono face, and the time as the post's one link. The time shows its short form ("3h"),
 * hidden from the link's name, which says it inside postedWhen's words ("3h ago, open the post"), so the name contains
 * the visible label. The thread's focused post shows the full date instead. The card's own line marks its time link as
 * the article's open link (`open`), which a feed's Page Down and Page Up move the focus to; a quote's line does not.
 */
function AuthorLine({ author, createdAt, postId, large = false, open = false }: { author: Author; createdAt: string; postId: string; large?: boolean; open?: boolean }) {
  const shown = large ? fullDate(createdAt) : timeAgo(createdAt);
  const when = large ? fill(UI_WORDS["time.posted.on"], { date: shown }) : postedWhen(createdAt);
  return (
    <View className="flex-row flex-wrap items-center gap-x-1.5">
      <Text variant="body-strong">
        <Link href={`/u/${author.handle}`} asChild>
          <Inline className={INLINE_LINK}>{author.displayName}</Inline>
        </Link>
      </Text>
      {author.verified ? <VerifiedChip /> : null}
      <Text variant="mono" tone="low">
        @{author.handle}
      </Text>
      <Text variant="meta" tone="low">
        <Link href={`/post/${postId}`} asChild>
          <Inline {...(open ? dataAttribute("open") : {})} className={cn(INLINE_LINK, "px-1.5")}>
            <Inline aria-hidden>{shown}</Inline>
            <VisuallyHidden>{fill(UI_WORDS["post.open"], { when })}</VisuallyHidden>
          </Inline>
        </Link>
      </Text>
    </View>
  );
}

/** The repost line above a reposted post: the repost icon, and "Ben reposted" with Ben's name a link to his profile. */
function RepostLine({ by }: { by: Author }) {
  const [before, after] = UI_WORDS["post.reposted"].split("{displayName}");
  return (
    <View className="mb-1 flex-row items-center gap-2 pl-6">
      <Icon name="repost" size={16} tone="low" />
      <Text variant="meta" tone="low" className="shrink">
        {before}
        <Link href={`/u/${by.handle}`} asChild>
          <Inline className={cn(INLINE_LINK, "text-ink-medium")}>{by.displayName}</Inline>
        </Link>
        {after}
      </Text>
    </View>
  );
}

/** A quoted post that is gone: its sentence in the text face's italic, on surface-2 (section 8.3). */
function TombstoneBox({ tombstone }: { tombstone: Tombstone }) {
  return (
    <View className="mt-2 rounded-media bg-surface-2 px-3 py-2.5">
      <Text tone="medium" italic>
        {tombstone.deleted ? UI_WORDS["post.deleted"] : UI_WORDS["post.unavailable"]}
      </Text>
    </View>
  );
}

/** What a press on a card's empty space must leave alone: its links and controls, which act for themselves. */
const CONTROL = "a, button, input, textarea, select, [role=button], [role=link], [role=dialog], [role=switch]";

/**
 * The open target of a card's body for pointers on the web (section 6.6): a click on the card that is not on one of its
 * links or controls, and that does not end a text selection, opens `href`. A click from a menu or sheet the card opened
 * reaches this handler through React's portal, but is not inside the card's own element, so it is left alone.
 */
function opensOnClick(open: () => void) {
  return (event: MouseEvent & { currentTarget: Element; target: Element }) => {
    const root = event.currentTarget;
    if (!root.contains(event.target)) return;
    const control = event.target.closest?.(CONTROL);
    if (control && root.contains(control)) return;
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    if (selection && !selection.isCollapsed && selection.anchorNode && root.contains(selection.anchorNode)) return;
    event.stopPropagation();
    open();
  };
}

/**
 * A quoted post (section 6.6): a bordered region with its own author line, whose time is the link to the quoted post,
 * so the quote has one open target too; its words are plain text, and its images open nothing, since they belong to the
 * quoted post, where the grid and the viewer are. A press on its empty space opens the quoted post.
 */
export function QuoteEmbed({ quote }: { quote: QuotedPost | Tombstone }) {
  if (!("author" in quote)) return <TombstoneBox tombstone={quote} />;
  const open = () => router.push(`/post/${quote.id}`);
  const content = (
    <>
      <AuthorLine author={quote.author} createdAt={quote.createdAt} postId={quote.id} />
      {quote.body ? <Text className="mt-0.5">{quote.body}</Text> : null}
      <MediaGrid media={quote.media} compact postId={quote.id} />
    </>
  );
  if (Platform.OS !== "web") {
    return (
      <Pressable accessible={false} {...pressDelay(80)} onPress={open} className="mt-2 rounded-media border border-line-low px-3 py-2.5 active:bg-surface-2">
        {content}
      </Pressable>
    );
  }
  return (
    <View {...({ onClick: opensOnClick(open) } as object)} className="mt-2 rounded-media border border-line-low px-3 py-2.5 web:cursor-pointer web:hover:bg-surface-2 web:transition-colors web:duration-[120ms]">
      {content}
    </View>
  );
}

/**
 * The chip on the author's own withheld or removed post (3c design, section 9; UI design, section 4.8). With the decision
 * behind the state it names the rule or says "illegal content", in the review tone while korbat decides and the
 * restricted tone once removed, and links to the decision's statement under Settings, Cases; Task 7 turns the link into
 * the button that opens the details sheet. A view without the decision's facts still says the state, and links nowhere.
 */
function StateChip({ post }: { post: PostView }) {
  if (post.state === "visible") return null;
  const decision = post.moderation;
  const tone: StatusTone = (decision ? decision.interim : post.state === "withheld") ? "review" : "restricted";
  const words = decision ? chipText(decision) : tone === "review" ? CHIP_WORDS.underReview : CHIP_WORDS.removed;
  return <StatusChip tone={tone} label={words} href={decision ? `/settings/cases/${decision.decisionId}` : undefined} />;
}

/**
 * The delete question's two controls, as the card's actions were before the icons: a word in a 44 px target, Delete in
 * the danger fill, Keep plain. While the request is out both are busy.
 */
function Action({ label, tone = "plain", busy, onPress, ref }: { label: string; tone?: "danger" | "plain"; busy?: boolean; onPress: () => void; ref?: Ref<View> }) {
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      aria-busy={busy}
      disabled={busy}
      onPress={onPress}
      {...pressDelay(0)}
      className={cn(
        "min-h-[44px] items-center justify-center rounded-control border px-4",
        tone === "danger" ? "border-danger bg-danger web:hover:bg-danger/90" : "border-line-high bg-surface-1 web:hover:bg-surface-2",
        FOCUS_RING,
      )}
    >
      <Text variant="body-strong" tone={tone === "danger" ? "on-danger" : "high"}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * "Delete this post?" in place of the action row (section 6.6), with Delete and Keep. Keep, the safe answer, takes the
 * focus when the question shows; the card gives it back to More when the question is withdrawn.
 */
export function DeleteQuestion({ postId, busy, onDelete, onKeep, keepRef }: { postId: string; busy: boolean; onDelete: () => void; onKeep: () => void; keepRef?: Ref<View> }) {
  return (
    <View role="dialog" aria-labelledby={`delete-${postId}`} className="mt-2 flex-row flex-wrap items-center gap-2 rounded-card border border-line-high bg-surface-1 px-3 py-2 web:forced-colors:border-[color:CanvasText]">
      <Text nativeID={`delete-${postId}`} variant="body-strong" className="mr-auto">
        {UI_WORDS["post.deleteQuestion"]}
      </Text>
      <Action label={UI_WORDS["post.delete"]} tone="danger" busy={busy} onPress={onDelete} />
      <Action ref={keepRef} label="Keep" busy={busy} onPress={onKeep} />
    </View>
  );
}

/**
 * The Repost menu's items (decision 12): Repost, or Undo repost once reposted, and Quote, a real link to the post's
 * quote composer as today (`?quote=1`), or to sign in for a reader who is signed out.
 */
export function repostMenuItems(post: PostView, signedIn: boolean, onRepost: () => void): MenuItem[] {
  return [
    { label: post.viewer?.reposted ? UI_WORDS["post.unrepost"] : UI_WORDS["post.repost"], icon: "repost", onSelect: onRepost },
    { label: UI_WORDS["post.quote"], icon: "quote", href: signedIn ? `/post/${post.id}?quote=1` : "/signin" },
  ];
}

const NO_VIEWER = { liked: false, reposted: false, bookmarked: false };

/** How long an action's request may be out before its control says it is busy (section 5.2, pending). */
const PENDING_MS = 400;

/**
 * One post in any list (UI design, section 6.6): an article named by its author line, with one explicit link to the post
 * in its time, and for pointers the whole card body as the open target. Reply, Repost (a menu: Repost or Undo repost, and
 * Quote), Like and Save act at once: the state, the icon and the count change on the press, with its haptic and its
 * motion, the request goes out in its kind's lane, and the server's answer replaces the counts, so they never drift; a
 * refusal puts the old state back, nudges the control and says so in a toast, and a write refused for a suspension shows
 * the standing's sentence under the card (3e, 9.4). A signed-out reader is sent to sign in on the first action. More
 * holds Who sees this, Copy link, Delete for the author and Report for everyone else.
 *
 * Below 768 px the images and the quoted post span the card's inner width, from the avatar's edge to the gutter; wider
 * they keep the content column's indent. `large` is the thread's focused post: its words at 19 / 28, the full date and
 * time, and the stats line above the actions (post/[id].tsx passes it in Task 5).
 *
 * In a feed (section 10) the article says its place, `position` from 1 and `setSize` (-1 while more can load); a list's
 * first two rows pass `priority`, so their images load first (11.2); and a thread's ancestors are `joined`: compact,
 * without a divider, and linked to the post below by a 2 px line-low thread line through their avatars (8.3).
 */
export function PostCard({
  post: initial,
  repostedBy,
  onDeleted,
  large = false,
  position,
  setSize,
  priority = false,
  joined = false,
}: {
  post: PostView;
  repostedBy?: Author;
  onDeleted?: (id: string) => void;
  large?: boolean;
  position?: number;
  setSize?: number;
  priority?: boolean;
  joined?: boolean;
}) {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me.user.id : null;
  const { hideCounts } = useAppearance();
  const phone = useLayout() === "phone";
  const motion = useMotion();
  const haptic = useHaptics();
  const labelId = useId();
  const [post, setPost] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  // 3e (design, section 9.4): an action refused account_suspended shows the refusal's sentence from /me, read again after it.
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState<Partial<Record<ToggleKind | "delete", boolean>>>({});
  const [feedback, setFeedback] = useState<Partial<Record<ToggleKind, IconButtonFeedback>>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [washed, setWashed] = useState(false);
  useEffect(() => setPost(initial), [initial]);
  const moreRef = useRef<View>(null);
  const keepRef = useRef<View>(null);
  const wasConfirming = useRef(false);
  // The action row, More with it, leaves the tree while the question shows, so a keyboard user would drop to the page
  // body: the safe answer takes the focus, and More takes it back when the question is withdrawn.
  useEffect(() => {
    if (confirmingDelete) keepRef.current?.focus();
    else if (wasConfirming.current) moreRef.current?.focus();
    wasConfirming.current = confirmingDelete;
  }, [confirmingDelete]);

  const own = post.author.id === me;
  const viewer = post.viewer ?? NO_VIEWER;
  const openPost = () => router.push(`/post/${post.id}`);

  /** Marks a kind busy if its request is still out after 400 ms, and returns the function that ends it. */
  const pending = (kind: ToggleKind | "delete") => {
    const timer = setTimeout(() => setBusy((current) => ({ ...current, [kind]: true })), PENDING_MS);
    return () => {
      clearTimeout(timer);
      setBusy((current) => ({ ...current, [kind]: false }));
    };
  };
  const play = (kind: ToggleKind, next: Omit<IconButtonFeedback, "at">) => setFeedback((current) => ({ ...current, [kind]: { ...next, at: (current[kind]?.at ?? 0) + 1 } }));

  function toggle(kind: ToggleKind) {
    if (!me) {
      router.push("/signin");
      return;
    }
    // A second tap while this kind's request is out is not sent (lib/social.ts, lanes), and changes nothing on screen.
    if (lanes.busy(laneKey.post(post.id, kind))) return;
    const moves = kind !== "bookmark";
    const done = pending(kind);
    void toggleEngagement(social, lanes, post, kind, setPost, (on) => {
      // Touch and sight on the same frame: the haptic before the state changes, the motion with it.
      haptic(on ? "toggleOn" : "toggleOff");
      play(kind, { turn: on ? "on" : "off", pop: kind === "like" ? "springLike" : "springToggle", count: moves ? (on ? 1 : -1) : 0 });
    }).then((result) => {
      done();
      if (result.status === "busy") return;
      if (result.status === "answered") {
        setRefused(false);
        // Saved: a polite toast says it worked, with the way to the saved posts; unsaving says nothing.
        if (kind === "bookmark" && result.on) toast.show({ message: UI_WORDS["toast.saved"], action: { label: UI_WORDS["toast.view"], onPress: () => router.push("/bookmarks") } });
        return;
      }
      const err = result.error;
      haptic("error");
      play(kind, { turn: "back", count: moves ? (result.on ? -1 : 1) : 0 });
      // A suspension is said under the card in the standing's words; trying again would not help, so no toast says to.
      if (isSuspendedRefusal(err)) setRefused(true);
      else toast.show({ message: failedWords(kind, result.on), tone: "rollback" });
    });
  }

  // The card fades (post-removed, 150 ms; at once under reduced motion) before its list lets it go.
  const opacity = useSharedValue(1);
  const leave = () =>
    new Promise<void>((resolve) => {
      if (motion.reduced) {
        resolve();
        return;
      }
      opacity.value = withTiming(0, motion.timing("easeOut", 150), (finished) => {
        "worklet";
        if (finished) runOnJS(resolve)();
      });
    });
  const removedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  function remove() {
    const done = pending("delete");
    void deleteWithLeave(social, lanes, post.id, leave).then((result) => {
      done();
      if (result.status === "deleted") {
        onDeleted?.(post.id);
        return;
      }
      if (result.status === "refused") {
        const err = result.error;
        setRefused(isSuspendedRefusal(err));
        setError(isSuspendedRefusal(err) ? null : errorMessage(err));
      }
    });
  }

  // The press wash of the card's body (section 5.1): after 80 ms, gone again on 10 px of movement, so a scroll never flashes it.
  const wash = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const unwash = () => {
    if (wash.current) clearTimeout(wash.current.timer);
    wash.current = null;
    setWashed(false);
  };
  const webPress =
    Platform.OS === "web"
      ? {
          onClick: opensOnClick(openPost),
          onPointerDown: (event: PointerEvent & { target: Element; currentTarget: Element }) => {
            const control = event.target.closest?.(CONTROL);
            if (control && event.currentTarget.contains(control)) return;
            unwash();
            wash.current = { timer: setTimeout(() => setWashed(true), 80), x: event.clientX, y: event.clientY };
          },
          onPointerMove: (event: PointerEvent) => {
            if (wash.current && Math.hypot(event.clientX - wash.current.x, event.clientY - wash.current.y) > 10) unwash();
          },
          onPointerUp: unwash,
          onPointerCancel: unwash,
          onPointerLeave: unwash,
        }
      : {};

  const media = <MediaGrid media={post.media} postId={post.id} own={post.author.id === me} />;
  const quote = post.quoteOf ? <QuoteEmbed quote={post.quoteOf} /> : null;
  const stats = large ? threadStats(post.counts, hideCounts) : "";
  const when = postedWhen(post.createdAt);

  const actions = (
    // It wraps rather than cutting More off at the largest text on the narrowest phone.
    <View className="-ml-2.5 mt-1 flex-row flex-wrap items-center">
      <IconButton icon="reply" label={countLabel("reply", post.counts.replies, hideCounts)} count={shownCount("reply", post.counts.replies, hideCounts)} onPress={openPost} />
      <Menu
        label={countLabel("repost", post.counts.reposts, hideCounts)}
        title={UI_WORDS["post.repost"]}
        icon="repost"
        items={repostMenuItems(post, me !== null, () => toggle("repost"))}
        trigger={{ pressed: viewer.reposted, disc: viewer.reposted, tone: viewer.reposted ? "accent" : "low", count: shownCount("repost", post.counts.reposts, hideCounts), busy: busy.repost === true, feedback: feedback.repost }}
      />
      <IconButton
        icon="like"
        label={countLabel("like", post.counts.likes, hideCounts)}
        count={shownCount("like", post.counts.likes, hideCounts)}
        pressed={viewer.liked}
        filled={viewer.liked}
        busy={busy.like === true}
        feedback={feedback.like}
        onPress={() => toggle("like")}
      />
      <IconButton
        icon="bookmarks"
        label={viewer.bookmarked ? UI_WORDS["post.saved"] : UI_WORDS["post.save"]}
        tone={viewer.bookmarked ? "accent" : "low"}
        filled={viewer.bookmarked}
        busy={busy.bookmark === true}
        feedback={feedback.bookmark}
        onPress={() => toggle("bookmark")}
      />
      <View className="flex-1" />
      <PostMenu post={post} onDelete={() => setConfirmingDelete(true)} triggerRef={moreRef} />
    </View>
  );

  const content: ReactNode = (
    <>
      {repostedBy ? <RepostLine by={repostedBy} /> : null}
      <View className="flex-row gap-2">
        {/* The avatar opens the profile too, but the name is the one keyboard and screen-reader target. */}
        <Link href={`/u/${post.author.handle}`} asChild>
          <Pressable tabIndex={-1} aria-hidden className="h-11 w-11 items-center justify-center rounded-full">
            <Avatar account={post.author} size={40} />
          </Pressable>
        </Link>
        <View className="min-w-0 flex-1">
          <AuthorLine author={post.author} createdAt={post.createdAt} postId={post.id} large={large} open />
          {own && (post.state !== "visible" || post.inExplore) ? (
            <View className="flex-row flex-wrap gap-x-2">
              <StateChip post={post} />
              {/* The API sets inExplore only on the viewer's own posts; the check keeps the chip on them whatever a view carries. */}
              {post.inExplore ? <StatusChip tone="explore" label={UI_WORDS["post.inExplore"]} href={`/post/${post.id}`} /> : null}
            </View>
          ) : null}
          {post.replyTo ? (
            <Text variant="meta" tone="low">
              {post.replyTo.authorHandle ? UI_WORDS["post.replyingTo"] : UI_WORDS["post.replyingHidden"]}
              {post.replyTo.authorHandle ? (
                <Link href={`/u/${post.replyTo.authorHandle}`} asChild>
                  <Inline className={cn(INLINE_LINK, "text-accent-ink")}>@{post.replyTo.authorHandle}</Inline>
                </Link>
              ) : null}
            </Text>
          ) : null}
          {/* A post may consist of images only, and then there is no text. */}
          {post.body ? (
            <View className="mt-1.5">
              <RichText body={post.body} variant={large ? "post-large" : "post"} />
            </View>
          ) : null}
          {phone ? null : media}
          {phone ? null : quote}
        </View>
      </View>
      {phone ? media : null}
      {phone ? quote : null}
      {/* The stats, the actions and what they answer keep the content column's indent at every width. */}
      <View className="pl-[52px]">
        {stats ? (
          <Text variant="meta" tone="medium" className="mt-3">
            {stats}
          </Text>
        ) : null}
        {confirmingDelete ? (
          <DeleteQuestion postId={post.id} busy={busy.delete === true} onDelete={remove} onKeep={() => setConfirmingDelete(false)} keepRef={keepRef} />
        ) : (
          actions
        )}
        <ErrorText message={error} />
        {refused ? <RefusedNotice standing={state.status === "signed-in" ? state.me.standing : null} /> : null}
      </View>
    </>
  );

  return (
    <Animated.View style={removedStyle}>
      <View
        role="article"
        aria-labelledby={labelId}
        aria-posinset={position}
        aria-setsize={position === undefined ? undefined : setSize}
        {...(webPress as object)}
        // A thread's focused post draws no divider of its own: the thread's block under it does, after Quote this post.
        className={cn(joined ? "px-4 pb-1 pt-3" : large ? "px-4 py-3" : "border-b border-line-low px-4 py-3", "web:transition-colors web:duration-[120ms]", washed ? "bg-surface-2" : "")}
      >
        {/* The thread line, from under the avatar to the next post's avatar: 2 px, line-low, through the avatars' centre. */}
        {joined ? <View pointerEvents="none" aria-hidden className="absolute bottom-0 left-[37px] top-[60px] w-0.5 bg-line-low" /> : null}
        {/* The article's name, the author line as a screen reader should hear it; hidden, and named only through aria-labelledby. */}
        <Text nativeID={labelId} aria-hidden style={VISUALLY_HIDDEN}>
          {fill(UI_WORDS["post.label"], { name: post.author.displayName, handle: post.author.handle, when })}
        </Text>
        {/* The first rows of a list load their images first (11.2): the grid reads it, through the quote's too. */}
        <ImagePriority.Provider value={priority}>
          {Platform.OS === "web" ? (
            content
          ) : (
            // On native the body is one Pressable that the accessibility tree does not see: the time's link does its job there.
            <Pressable accessible={false} {...pressDelay(80)} onPress={openPost} className="-mx-4 -my-3 px-4 py-3 active:bg-surface-2">
              {content}
            </Pressable>
          )}
        </ImagePriority.Provider>
      </View>
    </Animated.View>
  );
}
```

### Replace `apps/app/src/components/social/ProfileList.tsx` (whole file)

```tsx
import { useEffect, useRef, useState, type ReactElement } from "react";
import { Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import type { ProfileListItem } from "@korbat/contracts";
import { RefusedNotice } from "@/components/moderation/RefusedNotice";
import { toast } from "@/components/toast";
import { LABEL_TONE, VerifiedChip, buttonFace } from "@/components/ui";
import { Avatar } from "@/components/kit/Avatar";
import { dataAttribute, pressDelay } from "@/components/kit/interaction";
import { ListRow } from "@/components/kit/ListRow";
import { Text } from "@/components/kit/Text";
import { useHaptics } from "@/lib/haptics";
import { useMotion, usePressScale } from "@/lib/motion";
import { followFailedWords, toggleFollow } from "@/lib/post-actions";
import { useSession } from "@/lib/session";
import { isSuspendedRefusal } from "@/lib/standing";
import { lanes, laneKey, social, type Page } from "@/lib/social";
import { UI_WORDS } from "@/lib/ui-words";
import { PagedList } from "./PagedList";

/**
 * One account in a list of followers or followings (UI design, sections 6.5, 6.11 and 8.4), as a ListRow: the monogram
 * in the icon's place, the display name with the verified chip, the handle in the mono face and the bio, together one
 * link to the profile, and FollowButton as the row's control, beside the link and outside it.
 */
export function ProfileRow({ item, action }: { item: ProfileListItem; action?: ReactElement }) {
  return (
    <ListRow
      label={item.displayName}
      href={`/u/${item.handle}`}
      leading={<Avatar account={item} size={40} />}
      badge={item.verified ? <VerifiedChip /> : undefined}
      detail={
        <>
          <Text variant="mono" tone="low">
            @{item.handle}
          </Text>
          {item.bio ? (
            <Text tone="medium" numberOfLines={2} className="mt-0.5">
              {item.bio}
            </Text>
          ) : null}
        </>
      }
      control={action ? { kind: "button", element: action } : undefined}
    />
  );
}

/**
 * Follow or unfollow one account (section 8.4), with its words and states as they were: "Follow" as a primary button
 * while the reader does not follow, "Following" as a secondary one while they do. It is optimistic as the post's actions
 * are: the label changes at once with its haptic, the new label fading in over 160 ms (reduced, at once), and the
 * request goes out in the account's own lane, so a second tap meanwhile is not sent; the answer's state and follower
 * count are handed to `onChange`, and a refusal puts the old label back with the error haptic and a toast, or, for a
 * suspension, the standing's sentence under the button (3e, 9.4).
 */
export function FollowButton({ handle, initial, onChange }: { handle: string; initial: boolean; onChange?: (following: boolean, followerCount: number) => void }) {
  const { state } = useSession();
  const motion = useMotion();
  const haptic = useHaptics();
  const press = usePressScale(0.97);
  const [following, setFollowing] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  const label = useSharedValue(1);
  const shownAt = useRef(following);
  useEffect(() => {
    if (shownAt.current === following) return;
    shownAt.current = following;
    if (motion.reduced) return;
    label.value = 0;
    label.value = withTiming(1, motion.timing("easeOut", 160));
  }, [following]);
  const labelStyle = useAnimatedStyle(() => ({ opacity: label.value }));

  function toggle() {
    if (lanes.busy(laneKey.follow(handle))) return;
    haptic(following ? "toggleOff" : "toggleOn");
    const timer = setTimeout(() => setBusy(true), 400);
    void toggleFollow(social, lanes, handle, following, setFollowing).then((result) => {
      clearTimeout(timer);
      setBusy(false);
      if (result.status === "busy") return;
      if (result.status === "answered") {
        setRefused(false);
        onChange?.(result.answer.following, result.answer.followerCount);
        return;
      }
      const err = result.error;
      haptic("error");
      if (isSuspendedRefusal(err)) setRefused(true);
      else toast.show({ message: followFailedWords(handle, result.on), tone: "rollback" });
    });
  }

  const face = following ? "secondary" : "primary";
  return (
    <View {...dataAttribute("follow")} className="items-end">
      <Animated.View style={press.style}>
        <Pressable accessibilityRole="button" aria-busy={busy} onPress={toggle} {...press.handlers} {...pressDelay(0)} className={buttonFace({ face, size: "md" })}>
          <Animated.View style={labelStyle}>
            <Text variant="body-strong" tone={LABEL_TONE[face]}>
              {following ? UI_WORDS["follow.following"] : UI_WORDS["follow.follow"]}
            </Text>
          </Animated.View>
        </Pressable>
      </Animated.View>
      {refused ? <RefusedNotice standing={state.status === "signed-in" ? state.me.standing : null} /> : null}
    </View>
  );
}

export function ProfileList({
  fetchPage,
  empty,
  header,
  action,
}: {
  fetchPage: (cursor?: string) => Promise<Page<ProfileListItem>>;
  empty: string;
  header?: ReactElement;
  action?: (item: ProfileListItem, remove: () => void) => ReactElement | undefined;
}) {
  return (
    <PagedList
      fetchPage={fetchPage}
      keyOf={(item) => item.id}
      empty={empty}
      header={header}
      kind="accounts"
      render={(item, remove) => <ProfileRow item={item} action={action?.(item, () => remove(item.id))} />}
    />
  );
}
```

### Replace `apps/app/src/lib/explore.ts` (whole file)

```ts
import { EXPLORE_V2, type ExploreFormula, type ExplorePage, type ExploreStatusKind, type TimelineItem } from "@korbat/contracts";
import { ApiError } from "./api";
import type { ExploreAnswer } from "./social";

/**
 * Explore's texts and the list's decisions (2c design, section 11). Every number in a sentence comes from the formula it
 * is given, EXPLORE_V2 unless a test passes another, so the app says what the refresh does.
 */

/** A ranking older than this when it is read is stale: rounds run every 5 minutes, so by then several have failed or been skipped. */
export const STALE_AFTER_MS = 15 * 60 * 1000;

/** What the list's status line says once the ranking being paged is gone and the posts below it come from the current one. */
export const EXPLORE_REFRESHED_NOTICE = "Explore was refreshed; the posts below come from the new ranking.";

/** The words of Explore's list (2c design, section 11), word for word as ExploreList.tsx had them before UI Task 5 moved them here. */
export const EXPLORE_WORDS = {
  about: "How Explore works",
  refresh: "Refresh",
  showLatest: "Show Latest",
  signInForMore: "Sign in to see more of Explore",
} as const;

/** A page of Explore is the API's default of 20 posts, and a ranking holds at most listLength: one read never needs more pages than this. */
export const MAX_PAGES = Math.ceil(EXPLORE_V2.listLength / 20) + 1;

/** "1 minute", "5 minutes". */
function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** Hours as the texts say them: whole days in days ("2 days"), anything else in hours. */
function duration(hours: number): string {
  return hours > 0 && hours % 24 === 0 ? plural(hours / 24, "day") : plural(hours, "hour");
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** A small count as a sentence says it ("two of your posts"); anything larger stays in digits. */
function numberWord(count: number): string {
  return WORDS[count] ?? String(count);
}

/** When a stale ranking was computed: the time alone on the same day, the date and the time on any other. */
function since(at: Date, now: Date): string {
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return at.toDateString() === now.toDateString() ? time : `${at.toLocaleDateString()} ${time}`;
}

/**
 * The ranking on screen as the list read it: when it was computed, the Date header of the answer that carried it (the
 * server's clock then, or null when the answer had none) and the device's clock when that answer arrived.
 */
export interface RankingRead {
  computedAt: string;
  date: string | null;
  receivedAt: number;
}

/**
 * How old the ranking was when it was read: by the answer's Date header, the server's own clock, as the smoke test
 * measures it, so a device clock that is fast or slow changes nothing; by the device's clock only when the header is
 * missing. Never below zero: the header counts whole seconds, so a ranking of the same second would seem to be from the future.
 */
function ageAtRead(ranking: RankingRead): number {
  const served = ranking.date === null ? Number.NaN : Date.parse(ranking.date);
  return Math.max(0, (Number.isNaN(served) ? ranking.receivedAt : served) - Date.parse(ranking.computedAt));
}

/**
 * The line under the tabs, and whether to offer Refresh. Whether the ranking is stale is decided by its age when it was
 * read: past 15 minutes the line says since when Explore has not been updated, which the header shows as a warning. A page
 * left open never turns stale, since the job has written newer rankings meanwhile; its minutes go on from the age when
 * read by the time on screen, which the device's clock measures alone. Refresh is offered once the ranking on screen is
 * as old as the refresh interval, when a newer one should exist.
 */
export function rankingAge(ranking: RankingRead, now: number, formula: ExploreFormula = EXPLORE_V2): { stale: boolean; text: string; offerRefresh: boolean } {
  const atRead = ageAtRead(ranking);
  // The minute clock may last have ticked before the answer arrived: then there has been no time on screen yet.
  const age = atRead + Math.max(0, now - ranking.receivedAt);
  const offerRefresh = age >= formula.refreshMinutes * 60_000;
  if (atRead > STALE_AFTER_MS) return { stale: true, text: `Explore has not been updated since ${since(new Date(ranking.computedAt), new Date(now))}.`, offerRefresh };
  const minutes = Math.floor(age / 60_000);
  return { stale: false, text: minutes === 0 ? "Updated just now" : `Updated ${plural(minutes, "minute")} ago`, offerRefresh };
}

/**
 * What one page adds below the posts on screen: its posts not shown yet, in the ranking's order. Within one ranking the
 * pages never overlap, but after a refresh the new ranking holds posts already shown, and a page can also come back empty
 * when the reader's blocks and mutes took out every post on it. So the next page is read only while a page adds nothing
 * and a cursor follows it: the read stops at the first page that adds some, or at the ranking's end.
 */
export function appendUnseen(shown: ReadonlySet<string>, page: Pick<ExplorePage, "items" | "nextCursor">): { added: TimelineItem[]; nextCursor: string | null; fetchNext: boolean } {
  const seen = new Set(shown);
  const added = page.items.filter((item) => {
    if (seen.has(item.post.id)) return false;
    seen.add(item.post.id);
    return true;
  });
  return { added, nextCursor: page.nextCursor, fetchNext: added.length === 0 && page.nextCursor !== null };
}

export interface PagesRead<P extends ExplorePage = ExplorePage> {
  /** The posts to show below those on screen (or in their place, for a read from the first page), in the ranking's order. */
  added: TimelineItem[];
  /** Load more's cursor, null once the ranking has ended. */
  nextCursor: string | null;
  /** The last page read, whose computedAt and signInForMore the list shows; null only when no page came back. */
  last: P | null;
  /** The ranking being paged was gone (explore_refreshed), and what was added comes from the current one. */
  refreshed: boolean;
}

/**
 * One load of the list: pages from `after` on (the first page when it is undefined), as appendUnseen decides. A cursor
 * names the ranking it came from; when that ranking is no longer kept, the API refuses it with explore_refreshed and the
 * read starts again at the current ranking's first page, still skipping every post on screen, as section 11 of the design
 * says. Any other failure is the caller's to show, and one read never goes through more than `maxPages` pages. The pages
 * come back as `fetchPage` answers them, so the last one keeps whatever the client read with it.
 */
export async function readPages<P extends ExplorePage>(
  fetchPage: (cursor?: string) => Promise<P>,
  after: string | undefined,
  shown: ReadonlySet<string>,
  maxPages: number = MAX_PAGES,
): Promise<PagesRead<P>> {
  const seen = new Set(shown);
  const added: TimelineItem[] = [];
  let cursor = after;
  let last: P | null = null;
  let refreshed = false;
  for (let pages = 0; pages < maxPages; pages++) {
    let page: P;
    try {
      page = await fetchPage(cursor);
    } catch (err) {
      // Only a cursor names a ranking: the first page is always the current one, so a refusal of it is an ordinary failure.
      if (cursor === undefined || !(err instanceof ApiError && err.code === "explore_refreshed")) throw err;
      refreshed = true;
      cursor = undefined;
      continue;
    }
    const step = appendUnseen(seen, page);
    for (const item of step.added) {
      seen.add(item.post.id);
      added.push(item);
    }
    last = page;
    if (!step.fetchNext) return { added, nextCursor: step.nextCursor, last, refreshed };
    cursor = step.nextCursor ?? undefined;
  }
  // The bound was reached with more to read: Load more carries on from here.
  return { added, nextCursor: cursor ?? null, last, refreshed };
}

/** What the Explore list shows: its posts in order, Load more's cursor, the ranking on screen and, signed out, whether more exist. */
export interface ExploreShown {
  items: TimelineItem[];
  /** Load more's cursor: null once the ranking has ended, and always for a signed-out reader. */
  cursor: string | null;
  /** The ranking on screen as it was read, which the header ages; null before the first round. */
  ranking: RankingRead | null;
  /** Signed out, whether posts follow the page shown, which the list's footer then offers after a sign-in. */
  signInForMore: boolean;
}

/** A list that has read nothing yet. */
export const NOTHING_SHOWN: ExploreShown = { items: [], cursor: null, ranking: null, signInForMore: false };

/**
 * The Explore list's reads (2c design, section 11), made once per list and gone with it: it holds what the list shows and
 * lets one read run at a time, so a double press on Load more cannot append a page twice and a refresh cannot land between
 * the pages of a read. `load()` reads from the first page, in place of everything on screen (the first read, pull to
 * refresh, Refresh); `load(cursor)` reads after that cursor, below the posts on screen, which a page of a new ranking
 * cannot add again (readPages). Either answers what the list shows then, with whether the ranking being paged was gone,
 * or null, having fetched nothing, while another read runs; a failed read throws and leaves what the list shows as it was.
 */
export function exploreReader(fetchPage: (cursor?: string) => Promise<ExploreAnswer>, maxPages: number = MAX_PAGES) {
  let shown = NOTHING_SHOWN;
  let inFlight = false;
  return {
    async load(after?: string): Promise<(ExploreShown & { refreshed: boolean }) | null> {
      if (inFlight) return null;
      inFlight = true;
      try {
        const fromStart = after === undefined;
        const result = await readPages(fetchPage, after, new Set(fromStart ? [] : shown.items.map((item) => item.post.id)), maxPages);
        const last = result.last;
        // From the posts on screen now, not when the read began: one may have been deleted from the list meanwhile.
        shown = {
          items: fromStart ? result.added : [...shown.items, ...result.added],
          cursor: result.nextCursor,
          ranking: last === null ? shown.ranking : last.computedAt === null ? null : { computedAt: last.computedAt, date: last.date, receivedAt: last.receivedAt },
          signInForMore: last === null ? shown.signInForMore : last.signInForMore,
        };
        return { ...shown, refreshed: result.refreshed };
      } finally {
        inFlight = false;
      }
    },
    /** Takes a post its author deleted off the list; a read in flight answers without it too. */
    remove(id: string): ExploreShown {
      shown = { ...shown, items: shown.items.filter((item) => item.post.id !== id) };
      return shown;
    },
  };
}

/** The empty list's sentence (2c design, section 11): when a post appears in Explore, and how often it is refreshed. */
export function exploreEmptyText(formula: ExploreFormula = EXPLORE_V2): string {
  return (
    `Nothing to show in Explore right now. A post appears here when at least ${formula.threshold} other accounts, ` +
    `each at least ${duration(formula.engagerMinAgeHours)} old, like or repost it in its first ${plural(formula.windowHours, "hour")}. ` +
    `Explore is refreshed every ${plural(formula.refreshMinutes, "minute")}.`
  );
}

/**
 * The one sentence beside "Show my posts in Explore". Off takes the posts out at the next read. On lets them back at the
 * next refresh (a post still in the current ranking may show again sooner), so the sentence promises no earlier than that.
 */
export function exploreSwitchText(formula: ExploreFormula = EXPLORE_V2): string {
  return (
    "Your public posts can appear in Explore when other accounts like or repost them: turning this off takes them out at " +
    `once, and turning it back on takes effect at the next refresh, which comes every ${plural(formula.refreshMinutes, "minute")}.`
  );
}

/**
 * The author's status line under their own post, in the formula's words and without any count (2c design, sections 8 and
 * 11). Replies and quotes never enter Explore, and their line is left out: null.
 */
export function exploreStatusText(status: ExploreStatusKind, formula: ExploreFormula = EXPLORE_V2): string | null {
  switch (status) {
    case "reply":
    case "quote":
      return null;
    case "not_visible":
      return "Not in Explore: posts under review or removed never appear there.";
    case "suspended":
      // 3e design, section 9.7: what a suspension does to Explore, by its published rule, and when the post may come back.
      return "Not in Explore: your account is suspended, and posts of suspended accounts do not appear there. A post still in its window when the suspension ends can appear from the next refresh.";
    case "hidden_by_author":
      return "Not in Explore: you turned off Show my posts in Explore.";
    case "listed":
      return "In Explore";
    case "outside_window":
      // Version 2 gives a restored post back the time moderation kept it hidden, so the window says so.
      return `Not in Explore: posts can appear only in their first ${plural(formula.windowHours, "hour")}, not counting time in which korbat's moderation kept them from being shown.`;
    case "no_ranking":
      return "Not in Explore yet: the first ranking has not been computed.";
    case "new_since_ranking":
      return "Not in Explore yet: it is newer than the current ranking, so the next refresh will consider it.";
    case "below_threshold":
      return (
        `Not in Explore: fewer than ${formula.threshold} approving accounts. Your own likes, accounts under ` +
        `${duration(formula.engagerMinAgeHours)} old and likes from the last ${plural(formula.standingMinutes, "minute")} do not count.`
      );
    case "pending":
      return "Not in Explore yet: the next refresh will consider it.";
    case "author_cap":
      // The cap keeps an author's highest-scoring posts, so with the author's places full, those posts ranked above this one.
      return formula.perAuthor === 1 ? "Not in Explore: one of your posts ranks above it." : `Not in Explore: ${numberWord(formula.perAuthor)} of your posts rank above it.`;
    case "below_cutoff":
      return `Not in Explore: it ranks below the ${formula.listLength} posts Explore holds.`;
  }
}

/**
 * How Explore works (2c design, section 11): what is ranked, what counts, the score, the list, the refresh, the cold start,
 * what else takes a post out, and the author's controls, with every number from the formula. The page adds the formula's
 * version and change log.
 */
export function exploreRules(formula: ExploreFormula = EXPLORE_V2): { title: string; body: string }[] {
  const engagerAge = duration(formula.engagerMinAgeHours);
  return [
    {
      title: "What is ranked",
      body:
        `Original posts from the last ${plural(formula.windowHours, "hour")}: posts that are not replies or quotes, by accounts that ` +
        "have not switched Explore off and are not suspended when the ranking is computed. Replies belong to their threads. " +
        "Quotes do not enter, because a quote that mocks another post would put that post under the mockery on a public page.",
    },
    {
      title: "What counts",
      body:
        "One thing: the post's approving accounts, meaning the accounts other than its author that liked or reposted it. An " +
        "account that both liked and reposted a post counts once. A like or repost counts when its account still exists, " +
        `is not suspended when the ranking is computed, was at least ${engagerAge} old when it liked or reposted, and the ` +
        `like or repost has stood for at least ${plural(formula.standingMinutes, "minute")}. Replies and quotes do not count, ` +
        "so a pile-on of replies cannot lift a post. Followers, the verified badge and reports are never used.",
    },
    {
      title: "The score",
      body:
        `A post needs at least ${formula.threshold} approving accounts. Its score is the number of approving accounts divided ` +
        `by (the hours it has been shown since it was posted + ${formula.offsetHours}) to the power ${formula.gravity}, so a ` +
        "newer post needs fewer approving accounts to rank as high as an older one. A post that korbat's moderation hid and " +
        "then restored gets that time back: its window and its age stand still while it is not shown.",
    },
    {
      title: "The list",
      body:
        `Explore holds the ${formula.listLength} posts with the highest scores, with at most ${formula.perAuthor} posts of one ` +
        "account: that account's highest-scoring ones. Posts with equal scores are ordered by their ids. Only the order is " +
        "shown: no score, rank or count.",
    },
    {
      title: "The refresh",
      body:
        `A new ranking is computed every ${plural(formula.refreshMinutes, "minute")}, never sooner than ` +
        `${plural(formula.minGapMinutes, "minute")} after the last one. The newest ${formula.kept} rankings are kept, so you ` +
        "can finish paging through the one you started; once it is gone, the list says so and goes on with the newest one. " +
        `Signed out, you see the first ${formula.signedOutPage} posts.`,
    },
    {
      title: "A new korbat",
      body:
        `Only accounts at least ${engagerAge} old count, so on a new korbat Explore stays empty for about ${engagerAge} after ` +
        `it opens. A like or repost made in an account's first ${engagerAge} never counts, even after the account is older.`,
    },
    {
      title: "What else takes a post out",
      body:
        // 3e design, section 9.7: a suspension takes the author's posts out by a published rule, never as a lever on
        // Explore alone; the automatic R1 and R2 checks are gone, since rulebook version 2 has none.
        "Besides the formula, only these take a post out of Explore: its moderation state, set by a moderator for every " +
        "list at once; a suspension of its author, which a moderator decides with a statement of reasons and which stops " +
        "everything the account writes, never Explore alone; its author's switch or deletion; a block between you and the " +
        "author in either direction; your mute. No moderator or automatic lever acts on Explore alone.",
    },
    {
      title: "Your posts",
      body:
        "Show my posts in Explore, in Settings > Privacy, keeps your posts out: turning it off takes them out at once, and " +
        "turning it back on takes effect at the next refresh. The page of each of your posts says whether it is in Explore " +
        "and, if not, which rule keeps it out, without counting who liked it.",
    },
  ];
}
```

### Replace `apps/app/src/lib/session.tsx` (whole file)

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, View } from "react-native";
import { MeResponse } from "@korbat/contracts";
import { ErrorState, isOffline } from "@/components/kit/ErrorState";
import { api, ApiError, errorMessage, setSuspendedHandler, setUnauthenticatedHandler } from "./api";
import { placesStored } from "./reading-place";
import { clearSessionTraces, sessionEnded } from "./session-end";

type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; me: MeResponse };

interface SessionValue {
  state: SessionState;
  /** Reloads /api/me, for example after sign-in, onboarding or sign-out. */
  refresh(): Promise<SessionState>;
}

const SessionContext = createContext<SessionValue | null>(null);

async function loadSession(): Promise<SessionState> {
  try {
    return { status: "signed-in", me: await api("/api/me", { schema: MeResponse }) };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return { status: "signed-out" };
    throw err;
  }
}

/** Why /me could not be read: its sentence, and whether no answer came at all (offline, or no connection to korbat). */
interface Failure {
  message: string;
  offline: boolean;
}

/**
 * Only a 401 means signed out. Any other failure to load the session (no network, a 5xx, a limit)
 * is shown as such with a retry, instead of sending someone with a valid cookie back through sign-in.
 * It is the kit's ErrorState (UI design, section 6.12): the sentence as an alert and "Try again", or, when the request
 * got no answer (ApiError status 0), "You're offline", which tries again by itself once the browser is back online.
 */
function SessionFailure({ failure, onRetry }: { failure: Failure; onRetry: () => void }) {
  return (
    <View className="flex-1 justify-center bg-surface">
      <ErrorState message={failure.message} offline={failure.offline} onRetry={onRetry} />
    </View>
  );
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const [failure, setFailure] = useState<Failure | null>(null);

  const refresh = useCallback(async () => {
    setFailure(null);
    try {
      const next = await loadSession();
      setState(next);
      return next;
    } catch (err) {
      setFailure({ message: errorMessage(err), offline: isOffline(err) });
      return { status: "loading" } as const;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Every end of a session arrives here as a change of state, whatever caused it (section 8.8).
  const previous = useRef<SessionState["status"]>("loading");
  useEffect(() => {
    if (sessionEnded(previous.current, state.status, placesStored())) clearSessionTraces();
    previous.current = state.status;
  }, [state.status]);

  useEffect(() => {
    setUnauthenticatedHandler(() => setState((current) => (current.status === "signed-in" ? { status: "signed-out" } : current)));
    return () => setUnauthenticatedHandler(null);
  }, []);

  // 3e (design, section 9.1): /me again when the app gains focus and after a refusal account_suspended, so the banner and
  // a refusal's sentence are true of the row. Quietly: a read that fails keeps what is shown, and never the failure screen.
  useEffect(() => {
    const quiet = () => {
      loadSession()
        .then(setState)
        .catch(() => undefined);
    };
    setSuspendedHandler(quiet);
    const focus = AppState.addEventListener("change", (next) => {
      if (next === "active") quiet();
    });
    return () => {
      setSuspendedHandler(null);
      focus.remove();
    };
  }, []);

  const value = useMemo(() => ({ state, refresh }), [state, refresh]);
  // Stable, since ErrorState waits for the browser to come back online through an effect that depends on it.
  const retry = useCallback(() => void refresh(), [refresh]);
  return <SessionContext.Provider value={value}>{failure ? <SessionFailure failure={failure} onRetry={retry} /> : children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
```

### Replace `apps/app/src/lib/social.ts` (whole file)

```ts
import {
  BlockResponse,
  EngagementResponse,
  ExplorePage,
  ExploreSettingResponse,
  ExploreStatus,
  FollowResponse,
  MediaStatusResponse,
  MuteResponse,
  PostId,
  PostPage,
  PostView,
  type ProfileEditRequest,
  ProfilePage,
  ProfileView,
  ThreadResponse,
  TimelinePage,
  UploadResponse,
} from "@korbat/contracts";
import { z } from "zod";
import { api, apiResponse } from "./api";

export type EngagementKind = "like" | "repost" | "bookmark";
export type Page<T> = { items: T[]; nextCursor: string | null };

/**
 * A page of Explore as it arrived: with the answer's Date header, the server's clock when it answered (null when the
 * answer has none), and the device's clock on arrival. The list ages the ranking by the first and counts the time on
 * screen from the second, so the device's clock is never compared with the server's.
 */
export type ExploreAnswer = ExplorePage & { date: string | null; receivedAt: number };

/** A list's query: its cursor and, where the caller asks for a page size (Home's feeds read 50, UI design 8.2), its limit. */
const query = (cursor?: string, limit?: number) => {
  const parts = [cursor ? `cursor=${encodeURIComponent(cursor)}` : "", limit === undefined ? "" : `limit=${limit}`].filter((part) => part !== "");
  return parts.length > 0 ? `?${parts.join("&")}` : "";
};
/** Ids come from route params; only a UUID may become part of a path. */
const postPath = (id: string) => `/api/posts/${encodeURIComponent(PostId.parse(id))}`;
const handlePath = (handle: string) => `/api/profiles/${encodeURIComponent(handle.replace(/^@/, "").toLowerCase())}`;

/** The signed-in account's own profile as the editing routes answer it: the public view, since /api/me carries no bio. */
const OwnProfileResponse = z.object({ profile: ProfileView });

/** Every social endpoint, typed by the shared contracts. Cookies and CSRF are handled by `api`. */
export const social = {
  createPost: (input: { body: string; replyToId?: string; quoteOfId?: string; media?: { id: string; alt: string }[] }) => api("/api/posts", { json: input, schema: PostView }),
  getPost: (id: string) => api(postPath(id), { schema: PostView }),
  deletePost: (id: string) => api(postPath(id), { method: "DELETE" }),
  thread: (id: string, cursor?: string) => api(`${postPath(id)}/thread${query(cursor)}`, { schema: ThreadResponse }),
  engage: (id: string, kind: EngagementKind, on: boolean) => api(`${postPath(id)}/${kind}`, { method: on ? "POST" : "DELETE", schema: EngagementResponse }),
  /** Why the author's own post is in Explore or not, with no count (2c design, section 8); anyone else gets not_found. */
  exploreStatus: (id: string) => api(`${postPath(id)}/explore`, { schema: ExploreStatus }),

  /** Sends one image file as the request body. The answer is an id to ask about, not a finished image. */
  uploadMedia: (file: Blob) => api("/api/media", { raw: { type: file.type, body: file }, schema: UploadResponse }),
  mediaStatus: (id: string) => api(`/api/media/${id}`, { schema: MediaStatusResponse }),
  removeMedia: (id: string) => api(`/api/media/${id}`, { method: "DELETE" }),

  following: (cursor?: string, limit?: number) => api(`/api/timeline/following${query(cursor, limit)}`, { schema: TimelinePage }),
  latest: (cursor?: string, limit?: number) => api(`/api/timeline/latest${query(cursor, limit)}`, { schema: TimelinePage }),
  /**
   * A page of Explore (2c design, section 8). Its cursor names the ranking it came from, which a refresh can prune
   * (explore_refreshed); signed out, the first page is all there is, and signInForMore says whether more exist. The web
   * app is served from the API's origin, so the answer's Date header can be read, and it is kept with the page; an API on
   * another origin would hide it from the browser, and the list then ages the ranking by the device's clock.
   */
  explore: async (cursor?: string): Promise<ExploreAnswer> => {
    const res = await apiResponse(`/api/timeline/explore${query(cursor)}`);
    const page = ExplorePage.parse(await res.json());
    return { ...page, date: res.headers.get("date"), receivedAt: Date.now() };
  },

  profile: (handle: string) => api(handlePath(handle), { schema: ProfileView }),
  profilePosts: (handle: string, cursor?: string) => api(`${handlePath(handle)}/posts${query(cursor)}`, { schema: TimelinePage }),
  profileReplies: (handle: string, cursor?: string) => api(`${handlePath(handle)}/replies${query(cursor)}`, { schema: PostPage }),
  followers: (handle: string, cursor?: string) => api(`${handlePath(handle)}/followers${query(cursor)}`, { schema: ProfilePage }),
  followingOf: (handle: string, cursor?: string) => api(`${handlePath(handle)}/following${query(cursor)}`, { schema: ProfilePage }),
  setFollow: (handle: string, on: boolean) => api(`${handlePath(handle)}/follow`, { method: on ? "POST" : "DELETE", schema: FollowResponse }),
  setBlock: (handle: string, on: boolean) => api(`${handlePath(handle)}/block`, { method: on ? "POST" : "DELETE", schema: BlockResponse }),
  setMute: (handle: string, on: boolean) => api(`${handlePath(handle)}/mute`, { method: on ? "POST" : "DELETE", schema: MuteResponse }),

  myLikes: (cursor?: string) => api(`/api/me/likes${query(cursor)}`, { schema: PostPage }),
  myBookmarks: (cursor?: string) => api(`/api/me/bookmarks${query(cursor)}`, { schema: PostPage }),
  myBlocks: (cursor?: string) => api(`/api/me/blocks${query(cursor)}`, { schema: ProfilePage }),
  myMutes: (cursor?: string) => api(`/api/me/mutes${query(cursor)}`, { schema: ProfilePage }),

  /** Either field or both; the caller refreshes the session afterwards, so the shell's Profile link follows a new name. */
  editProfile: (edit: ProfileEditRequest) => api("/api/me/profile", { method: "PATCH", json: edit, schema: OwnProfileResponse }),
  /** Needs fresh authentication: the caller runs it through useReauth. */
  changeHandle: (handle: string) => api("/api/me/handle", { json: { handle }, schema: OwnProfileResponse }),
  /** "Show my posts in Explore", on or off, with no body as the other switches; the caller refreshes the session, whose /api/me carries it. */
  setShowInExplore: (on: boolean) => api("/api/me/explore", { method: on ? "POST" : "DELETE", schema: ExploreSettingResponse }),
};

/**
 * Request lanes (UI design, section 6.6): each toggle of each post, and each account's follow, has a lane of its own,
 * keyed by the post or the handle and the kind. Kinds run side by side, so a like and a save can be in flight together;
 * a second tap of a kind whose request is still out is not sent at all, so a double tap cannot undo itself, and the card
 * leaves its state as the first tap set it. A lane answers what became of its request instead of throwing, so the caller
 * decides how to roll back.
 */
export type LaneOutcome<T> = { status: "busy" } | { status: "answered"; answer: T } | { status: "refused"; error: unknown };

export interface Lanes {
  busy(key: string): boolean;
  run<T>(key: string, request: () => Promise<T>): Promise<LaneOutcome<T>>;
}

export function createLanes(): Lanes {
  const out = new Set<string>();
  return {
    busy: (key) => out.has(key),
    async run<T>(key: string, request: () => Promise<T>): Promise<LaneOutcome<T>> {
      if (out.has(key)) return { status: "busy" };
      out.add(key);
      try {
        return { status: "answered", answer: await request() };
      } catch (error) {
        return { status: "refused", error };
      } finally {
        out.delete(key);
      }
    },
  };
}

/** The app's one set of lanes, which every card and follow button shares: a post shown twice still has one like lane. */
export const lanes = createLanes();

export const laneKey = {
  post: (id: string, kind: EngagementKind | "delete") => `post:${id}:${kind}`,
  follow: (handle: string) => `follow:${handle.replace(/^@/, "").toLowerCase()}`,
};

/** timeAgo lives in lib/time.ts with korbat's other times (UI design, section 8.1); its callers keep importing it from here. */
export { timeAgo } from "./time";
```

### Replace `apps/app/src/lib/ui-words.ts` (whole file)

```ts
/**
 * The words of korbat's own components and of this sub-project's screens (UI design, sections 1.5 and 8.1), kept out
 * of the markup so a later translation is mechanical: a test of a11y.test.tsx refuses a bare sentence in src/app and
 * src/components. Keys are written as the design's word tables write them (`offline.title`, `feed.loading`); words no
 * table keys take a key of the same shape. A template holds `{name}` where fill() puts a value. Words of an area that
 * has a words module of its own (moderation, standing, orders, Explore, the public pages, the terms) stay there.
 */

/** U+2026, built in code so this file stays plain ASCII. */
const ELLIPSIS = String.fromCharCode(0x2026);

export const UI_WORDS = {
  /** Button's label while its action runs (6.4), word for word what ui.tsx showed before the kit. */
  "button.busy": `Please wait${ELLIPSIS}`,
  /** The centred spinner's name (Loading in ui.tsx). */
  "spinner.label": "Loading",
  /** VerifiedChip (6.13): the visible word and the name a screen reader hears, as ui.tsx had them. */
  "verified.label": "Verified",
  "verified.name": "verified account",
  /** The polite status of a list that shows skeleton rows (6.12). */
  "feed.loading": "Loading posts",
  "accounts.loading": "Loading accounts",
  /** ErrorState (6.12) and its offline form (8.11). */
  "error.retry": "Try again",
  "offline.title": "You're offline",
  "offline.body": "korbat will load this when your connection is back.",
  /** PublicFrame (7.3): the wordmark and the footer's links to the public pages. */
  "frame.wordmark": "korbat",
  "frame.rules": "The rules",
  "frame.transparency": "Transparency",
  "frame.terms": "Terms",
  /** postedWhen() (8.1), the spoken form of timeAgo's short time, which it always contains. */
  "time.posted.now": "posted just now",
  "time.posted.ago": "{short} ago",
  "time.posted.on": "on {date}",
  /** The shell (7.1 to 7.5, 8.1): the skip link, the context column and its card, the header's back button. */
  "shell.skip": "Skip to the main content",
  "shell.about": "About korbat",
  "shell.howTitle": "How korbat works",
  "shell.how1": "Following and Latest are in time order.",
  "shell.how2": "korbat never lowers a post's reach in secret.",
  "shell.how3": "The rules are public, and so is how they are enforced.",
  "shell.rulesLink": "The rules",
  "shell.transparencyLink": "Transparency",
  "shell.exploreLink": "How Explore works",
  "shell.back": "Back",
  /** The navigation landmark's name and its items, the same words at every width (7.1). */
  "nav.label": "Main",
  "nav.home": "Home",
  "nav.bookmarks": "Bookmarks",
  "nav.profile": "Profile",
  "nav.settings": "Settings",
  "nav.signin": "Sign in",
  /** The rail's mark (7.1), the wordmark's first letter, as the favicon draws it. */
  "nav.monogram": "k",
  /** HandleBox, in the context column (7.3), word for word as it had them. */
  "handle.title": "Go to a profile",
  "handle.field": "Handle",
  "handle.placeholder": "@handle",
  "handle.open": "Open",
  "handle.invalid": "Handles are 3 to 20 letters, numbers or underscores.",
  /** A mistyped address and the error boundary (8.11). */
  "notFound.title": "This page doesn't exist",
  "notFound.action": "Go to Home",
  "crash.title": "Something went wrong on this screen",
  "crash.body": "Try again, or go back to Home.",
  "crash.retry": "Try again",
  /** Bookmarks, followers and following (8.4, 8.5): their titles and empty sentences, word for word as the screens had them. */
  "bookmarks.title": "Bookmarks",
  "bookmarks.private": "Private to you.",
  "bookmarks.empty": "Nothing saved yet. Use Save on a post to keep it here.",
  "followers.title": "Followers",
  "followers.empty": "No followers yet.",
  "following.title": "Following",
  "following.empty": "Not following anyone yet.",
  /**
   * The post card (6.6, 8.1, section 10). post.label is the article's name, "Ada, @ada, 3h ago"; post.open is the time
   * link's, whose `when` comes from postedWhen() and always contains the visible short time. The action names leave the
   * number out at zero and when the reader hides counts (decision 15): then they are the `.none` words.
   */
  "post.label": "{name}, @{handle}, {when}",
  "post.open": "{when}, open the post",
  "post.reposted": "{displayName} reposted",
  "post.more": "More options for this post",
  "post.repost": "Repost",
  "post.unrepost": "Undo repost",
  "post.quote": "Quote",
  "post.whoSees": "Who sees this",
  "post.copyLink": "Copy link",
  "post.delete": "Delete",
  "post.reply": "Reply, {n} replies",
  "post.reply.one": "Reply, 1 reply",
  "post.reply.none": "Reply",
  "post.like": "Like, {n} likes",
  "post.like.one": "Like, 1 like",
  "post.like.none": "Like",
  "post.reposts": "Repost, {n} reposts",
  "post.reposts.one": "Repost, 1 repost",
  "post.reposts.none": "Repost",
  "post.save": "Save",
  "post.saved": "Saved",
  /** The delete question (6.6), word for word as PostCard.tsx had it. */
  "post.deleteQuestion": "Delete this post?",
  /** The reply context and the quoted post's tombstones, word for word as PostCard.tsx had them. */
  "post.replyingTo": "Replying to ",
  "post.replyingHidden": "Replying to a post you can't see",
  "post.deleted": "This post was deleted by its author.",
  "post.unavailable": "This post is unavailable.",
  "post.inExplore": "In Explore",
  /** The thread's focused post (8.3): each part left out when zero or hidden, joined by a comma. */
  "thread.stats.reposts": "{n} reposts",
  "thread.stats.reposts.one": "1 repost",
  "thread.stats.quotes": "{n} quotes",
  "thread.stats.quotes.one": "1 quote",
  "thread.stats.likes": "{n} likes",
  "thread.stats.likes.one": "1 like",
  /**
   * Who sees this (6.14), the sentences reach() in lib/reach.ts puts together, word for word as the design reviewed them;
   * the summary is the one line under the menu item.
   */
  "reach.public": "Public. Anyone can read it, including people who are not signed in.",
  "reach.blocked": "Accounts you blocked do not see it in their feeds, but anyone signed out can still read it.",
  "reach.feeds": "It shows in Latest and in your followers' Following, in time order.",
  "reach.inExplore": "Also in Explore.",
  "reach.exploreOff": "Not in Explore: you turned Explore off.",
  "reach.suspended": "Not in Explore while your account is suspended.",
  "reach.reply": "Public. Shown in the thread and on your Replies tab.",
  "reach.replyExplore": "Replies never enter Explore.",
  "reach.quoteExplore": "Quotes never enter Explore.",
  "reach.private": "Only you and korbat's moderators can see it.",
  "reach.order": "Removed for everyone else by an authority's order.",
  "reach.decision": "Read the decision",
  "reach.never": "korbat never lowers a post's reach in secret. Following and Latest are in time order.",
  "reach.how": "How Explore works",
  "reach.summary.public": "Public, signed in or not",
  "reach.summary.private": "Only you and korbat's moderators",
  /** A post's images and the lightbox (6.7), word for word as MediaGrid.tsx, HiddenImage.tsx and MediaViewer.tsx had them. */
  "media.open": "Open image: {alt}",
  "media.showAlt": "Show image descriptions",
  "media.hideAlt": "Hide image descriptions",
  "media.alt": "ALT",
  "media.hidden": "Hidden",
  "media.close": "Close the image viewer",
  "media.previous": "Previous image",
  "media.next": "Next image",
  "media.count": "{n} of {total}",
  /** Toasts (5.4, 8.6); toast.sent.* comes with the composer in Task 6. */
  "toast.view": "View",
  "toast.linkCopied": "Link copied",
  "toast.saved": "Saved to Bookmarks",
  "toast.failed.like": "Couldn't like this post. Try again.",
  "toast.failed.unlike": "Couldn't remove your like. Try again.",
  "toast.failed.repost": "Couldn't repost this post. Try again.",
  "toast.failed.unrepost": "Couldn't undo the repost. Try again.",
  "toast.failed.save": "Couldn't save this post. Try again.",
  "toast.failed.unsave": "Couldn't remove this post from Bookmarks. Try again.",
  "toast.failed.follow": "Couldn't follow @{handle}. Try again.",
  "toast.failed.unfollow": "Couldn't unfollow @{handle}. Try again.",
  /** FollowButton (8.4), word for word as ProfileList.tsx had them. */
  "follow.follow": "Follow",
  "follow.following": "Following",
  /**
   * Home's feeds (8.2): the marker, the new-posts pill, the gap, the end, the empty states and Load more. The empty
   * sentences and Load more are word for word what index.tsx and PagedList.tsx had; feed.pill.label is the pill's name
   * and feed.pill.announce what a screen reader hears once when it first shows.
   */
  "feed.marker.title": "You were here",
  "feed.marker.body": "Newer posts are above. Below are posts you have already seen.",
  "feed.caughtUp": "You're all caught up",
  "feed.pill": "{n} new posts",
  "feed.pill.one": "1 new post",
  "feed.pill.many": "50+ new posts",
  "feed.pill.label": "{visible} above, go to the first one",
  "feed.pill.announce": "{visible} above",
  "feed.gap": "Show more new posts",
  "feed.end.following": "That's everything in Following.",
  "feed.end.latest": "That's everything in Latest.",
  "feed.empty.following.title": "Your Following feed is empty",
  "feed.empty.following.body": "Nothing here yet. Follow someone, or switch to Latest or Explore.",
  "feed.empty.following.action": "Open Latest",
  "feed.empty.latest.title": "Nothing posted yet",
  "feed.empty.latest.body": "No posts yet.",
  "feed.loadMore": "Load more",
  /** Home (8.2): its title, its tab list's name and its tabs, and the passkey card's words as index.tsx had them. */
  "home.title": "Home",
  "home.tabs": "Feeds",
  "home.following": "Following",
  "home.latest": "Latest",
  "home.explore": "Explore",
  "passkey.title": "Sign in faster with a passkey",
  "passkey.body": "A passkey signs you in with your fingerprint, face or PIN, and cannot be phished. Adding one takes a moment.",
  "passkey.add": "Add a passkey",
  "passkey.notNow": "Not now",
  /** A post and its thread (8.3), word for word as post/[id].tsx had them; thread.signIn is new. */
  "thread.title": "Post",
  "thread.missing": "This post is not available",
  "thread.back": "Back to the timeline",
  "thread.quote": "Quote this post",
  "thread.empty": "No replies yet.",
  "thread.signIn": "Sign in to reply.",
  "thread.exploreSetting": "Your Explore setting",
  /** A profile (8.4), word for word as u/[handle]/index.tsx had them; the hidden counts' words and More's name are new. */
  "profile.more": "More options for @{handle}",
  "profile.posts": "posts",
  "profile.followers": "followers",
  "profile.following": "following",
  "profile.followers.hidden": "Followers",
  "profile.following.hidden": "Following",
  "profile.followsYou": "Follows you",
  "profile.mute": "Mute",
  "profile.unmute": "Unmute",
  "profile.block": "Block",
  "profile.unblock": "Unblock",
  "profile.blockQuestion": "Block @{handle}?",
  "profile.blockBody":
    "Neither of you will see the other's posts or profile while signed in, and you will unfollow each other. Posts on korbat are public, so a block does not hide them from someone who signs out. You can undo this in your privacy settings.",
  "profile.cancel": "Cancel",
  "profile.signIn": "Sign in to follow this account.",
  "profile.settings": "Security and privacy settings",
  "profile.missing": "This account is not available",
  "profile.tabs": "Profile",
  "profile.tab.posts": "Posts",
  "profile.tab.replies": "Replies",
  "profile.tab.likes": "Likes",
  "profile.empty.posts": "No posts yet.",
  "profile.empty.replies": "No replies yet.",
  "profile.empty.likes": "You have not liked anything yet. Only you can see this tab.",
  "bookmarks.empty.title": "No saved posts",
} as const;

export type UiWord = keyof typeof UI_WORDS;

/**
 * Each screen's browser tab title (8.1, decision 16), read by lib/page-title.tsx: "<what> - korbat", naming the kind of
 * screen and never an account, so a synced browser history holds no handles (the h1 inside the page names the account).
 * A title joins this table with the first screen that sets it.
 */
export const TITLE_WORDS = {
  "title.notFound": "Page not found - korbat",
  "title.bookmarks": "Bookmarks - korbat",
  "title.followers": "Followers - korbat",
  "title.following": "Following - korbat",
  "title.home": "Home - korbat",
  "title.post": "Post - korbat",
  "title.postMissing": "Post not available - korbat",
  "title.profile": "Profile - korbat",
} as const;

export type TitleWord = keyof typeof TITLE_WORDS;

/** A template with each `{name}` replaced by its value; a name with no value stays as it is written. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}
```

### Replace `apps/app/src/theme/fonts.web.ts` (whole file)

```ts
/**
 * The faces on web (UI design, section 4.3): korbat's own @font-face rules over the woff2 files of the three
 * @fontsource-variable packages, bundled by Metro into /assets/ (immutable in Caddy, allowed by the policy's font-src
 * 'self'), so no font comes from anyone else's server. Fraunces takes the package's `full` files, which carry the
 * opsz, SOFT and WONK axes; the text face its roman and italic `wght` files; the mono face its roman. Each family has a
 * latin and a latin-ext rule whose unicode-range is copied from the package's own CSS (test/theme.test.ts holds them
 * equal), so latin-ext downloads only when a post needs it. `font-display: swap` with the system stack as the
 * fallback, so text never waits for a font.
 */
export const FONT_FAMILY: { display: string | undefined; text: string | undefined; mono: string | undefined } = {
  display: "Fraunces Variable",
  text: "Atkinson Hyperlegible Next Variable",
  mono: "Atkinson Hyperlegible Mono Variable",
};

const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

export interface FontFaceRule {
  family: string;
  style: "normal" | "italic";
  /** The weight range the variable file covers, as the package declares it. */
  weight: string;
  unicodeRange: string;
  /** The file as the package exports it. */
  file: string;
  /**
   * The file's URL in the build. Each require names its file literally, so Metro bundles it; it runs only when the
   * style element is written, so loading this module (as the unit tests do, which have no Metro) reads no font file.
   */
  url: () => unknown;
}

/** The rules, latin-ext before latin within each family and style, in the packages' own order. */
export const FONT_FACES: readonly FontFaceRule[] = [
  {
    family: "Fraunces Variable",
    style: "normal",
    weight: "100 900",
    unicodeRange: LATIN_EXT,
    file: "@fontsource-variable/fraunces/files/fraunces-latin-ext-full-normal.woff2",
    url: () => require("@fontsource-variable/fraunces/files/fraunces-latin-ext-full-normal.woff2"),
  },
  {
    family: "Fraunces Variable",
    style: "normal",
    weight: "100 900",
    unicodeRange: LATIN,
    file: "@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2",
    url: () => require("@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2"),
  },
  {
    family: "Atkinson Hyperlegible Next Variable",
    style: "normal",
    weight: "200 800",
    unicodeRange: LATIN_EXT,
    file: "@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-ext-wght-normal.woff2",
    url: () => require("@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-ext-wght-normal.woff2"),
  },
  {
    family: "Atkinson Hyperlegible Next Variable",
    style: "normal",
    weight: "200 800",
    unicodeRange: LATIN,
    file: "@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2",
    url: () => require("@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2"),
  },
  {
    family: "Atkinson Hyperlegible Next Variable",
    style: "italic",
    weight: "200 800",
    unicodeRange: LATIN_EXT,
    file: "@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-ext-wght-italic.woff2",
    url: () => require("@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-ext-wght-italic.woff2"),
  },
  {
    family: "Atkinson Hyperlegible Next Variable",
    style: "italic",
    weight: "200 800",
    unicodeRange: LATIN,
    file: "@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-italic.woff2",
    url: () => require("@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-italic.woff2"),
  },
  {
    family: "Atkinson Hyperlegible Mono Variable",
    style: "normal",
    weight: "200 800",
    unicodeRange: LATIN_EXT,
    file: "@fontsource-variable/atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-ext-wght-normal.woff2",
    url: () => require("@fontsource-variable/atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-ext-wght-normal.woff2"),
  },
  {
    family: "Atkinson Hyperlegible Mono Variable",
    style: "normal",
    weight: "200 800",
    unicodeRange: LATIN,
    file: "@fontsource-variable/atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-wght-normal.woff2",
    url: () => require("@fontsource-variable/atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-wght-normal.woff2"),
  },
];

/** On web Metro's require of a font yields its URL as a string; an object carrying `uri` is read too, should that change. */
function urlOf(asset: unknown): string {
  if (typeof asset === "string") return asset;
  const uri = (asset as { uri?: unknown } | null)?.uri;
  return typeof uri === "string" ? uri : String(asset);
}

/** The @font-face rules, each file named by the URL `urlFor` gives it. */
export function fontFaceCss(urlFor: (face: FontFaceRule) => string = (face) => urlOf(face.url())): string {
  return FONT_FACES.map((face) =>
    [
      "@font-face {",
      `font-family: "${face.family}";`,
      `font-style: ${face.style};`,
      "font-display: swap;",
      `font-weight: ${face.weight};`,
      `src: url("${urlFor(face)}") format("woff2-variations");`,
      `unicode-range: ${face.unicodeRange};`,
      "}",
    ].join(" "),
  ).join(" ");
}

const STYLE_ID = "korbat-fonts";

/**
 * The rule a toast takes under korbat's own "Reduce motion: Always" (UI design, section 5.4): toast.web.tsx gives each
 * toast the class, and the toast fades instead of moving. It rides in this style element, the one korbat writes.
 */
export const STILL_RULE = ".k-still { transform: none !important; transition: opacity 150ms ease !important; }";

/**
 * "You're all caught up" draws its check once a session (UI design, section 5.2, caught-up): the done icon's check, a
 * path about 8.5 units long, goes from a dash offset of its length to 0 in 450 ms on ease-out. FeedRows.tsx sets
 * data-draw on the icon only the first time and never under reduced motion, so the icon is otherwise drawn at once.
 */
export const DRAW_RULE = "@keyframes k-draw { to { stroke-dashoffset: 0; } } [data-draw] svg path { stroke-dasharray: 9; stroke-dashoffset: 9; animation: k-draw 450ms cubic-bezier(0.23, 1, 0.32, 1) forwards; }";

/** Adds the one style element with the rules, once; the browser downloads a file only when text needs it. */
export function installFonts(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `${fontFaceCss()} ${STILL_RULE} ${DRAW_RULE}`;
  document.head.appendChild(style);
}
```

## Step 4: verify: typecheck

```bash
pnpm typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`
- `ERR_PNPM`

Observed on the dry run:

```text
(no output)
```

## Step 5: verify: test

```bash
pnpm -r --if-present run test --testTimeout=20000
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
packages/db test:       Tests  102 passed (102)
packages/contracts test:       Tests  459 passed (459)
packages/media-protocol test:       Tests  26 passed (26)
packages/rules test:       Tests  134 passed (134)
apps/worker test:       Tests  52 passed (52)
apps/app test:       Tests  564 passed (564)
apps/admin test:       Tests  584 passed (584)
apps/api test:       Tests  943 passed | 1772 skipped (2715)
```

## Step 6: verify: export

```bash
(cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA EXPO_PUBLIC_CONTACT_EMAIL=contact@korbat.local npx expo export --platform web 2>&1 | tail -8)
```

Expected output contains:

- `Exported`

Must not contain:

- `Error`
- `error:`

Observed on the dry run:

```text
Exported: dist
```

## Step 7: verify: app-browser

```bash
pnpm --filter @korbat/app test:browser
```

Expected output contains:

- `Tests  27 passed (27)`

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  27 passed (27)
```

## Step 8: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/app/src/app/bookmarks.tsx`
- `apps/app/src/app/index.tsx`
- `apps/app/src/app/post/[id].tsx`
- `apps/app/src/app/u/[handle]/index.tsx`
- `apps/app/src/components/kit/ListRow.tsx`
- `apps/app/src/components/kit/Tabs.tsx`
- `apps/app/src/components/list/List.tsx`
- `apps/app/src/components/list/anchor.ts`
- `apps/app/src/components/list/anchor.web.ts`
- `apps/app/src/components/social/ExploreList.tsx`
- `apps/app/src/components/social/FeedList.tsx`
- `apps/app/src/components/social/FeedRows.tsx`
- `apps/app/src/components/social/MediaGrid.tsx`
- `apps/app/src/components/social/NewPostsPill.tsx`
- `apps/app/src/components/social/PagedList.tsx`
- `apps/app/src/components/social/PostCard.tsx`
- `apps/app/src/components/social/ProfileList.tsx`
- `apps/app/src/components/social/ProfileMenu.tsx`
- `apps/app/src/lib/explore.ts`
- `apps/app/src/lib/feed-cache.ts`
- `apps/app/src/lib/feed-rows.ts`
- `apps/app/src/lib/new-posts.ts`
- `apps/app/src/lib/reading-place.ts`
- `apps/app/src/lib/session-end.ts`
- `apps/app/src/lib/session.tsx`
- `apps/app/src/lib/social.ts`
- `apps/app/src/lib/ui-words.ts`
- `apps/app/src/theme/fonts.web.ts`
- `apps/app/test/anchor.test.ts`
- `apps/app/test/browser/app.browser.ts`
- `apps/app/test/browser/fixture-api.ts`
- `apps/app/test/explore.test.tsx`
- `apps/app/test/feed-cache.test.ts`
- `apps/app/test/feed-rows.test.ts`
- `apps/app/test/hidden-media.test.tsx`
- `apps/app/test/kit.test.tsx`
- `apps/app/test/legacy-files.ts`
- `apps/app/test/new-posts.test.ts`
- `apps/app/test/post-card.test.tsx`
- `apps/app/test/reading-place.test.ts`
- `apps/app/test/report.test.tsx`
- `apps/app/test/shell.test.tsx`

## Step 9: commit

```bash
git add -A
git commit -q -m "feat(app): feeds, threads and profiles: every list scrolls through list/List.tsx, which owns FlatList's tuning, redraws a row only when its key or version changes and keeps the row on screen when rows are put above it (anchor.web.ts on the scroll node, maintainVisibleContentPosition on native), with the feed pattern (role feed, aria-posinset and aria-setsize, Page Down and Page Up) and the focus handed on after a delete; Home's Following and Latest are typed rows (lib/feed-rows.ts) that keep the reader's place on the device (lib/reading-place.ts), open there within the newest 100 under You were here, ask for new posts every 60 s while in view (lib/new-posts.ts) and count them in a pill that takes the reader to the oldest one, say You're all caught up, and come back across tabs without asking again (lib/feed-cache.ts); kit/Tabs; the thread opens on its large focused post with its chain above; the profile's header gains a More menu with Mute, Block and Report; account rows move onto ListRow and Explore onto List; the session's end clears the appearance and the places; the browser check gains steps 23 to 27" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(app): feeds, threads and profiles: every list scrolls through list/List.tsx, which owns FlatList's tuning, redraws a row only when its key or version changes and keeps the row on screen when rows are put above it (anchor.web.ts on the scroll node, maintainVisibleContentPosition on native), with the feed pattern (role feed, aria-posinset and aria-setsize, Page Down and Page Up) and the focus handed on after a delete; Home's Following and Latest are typed rows (lib/feed-rows.ts) that keep the reader's place on the device (lib/reading-place.ts), open there within the newest 100 under You were here, ask for new posts every 60 s while in view (lib/new-posts.ts) and count them in a pill that takes the reader to the oldest one, say You're all caught up, and come back across tabs without asking again (lib/feed-cache.ts); kit/Tabs; the thread opens on its large focused post with its chain above; the profile's header gains a More menu with Mute, Block and Report; account rows move onto ListRow and Explore onto List; the session's end clears the appearance and the places; the browser check gains steps 23 to 27`.

## Report format (mandatory)

```text
TASK 5 REPORT
Files written: <count, expected 42>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "app-browser": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```

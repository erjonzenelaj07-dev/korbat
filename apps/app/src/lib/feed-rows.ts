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

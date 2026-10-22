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

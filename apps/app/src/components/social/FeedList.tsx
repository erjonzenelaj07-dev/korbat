import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactElement, type Ref } from "react";
import { AppState, Platform, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import type { PostView, TimelineItem } from "@korbat/contracts";
import { List, useStable, type ListHandle } from "@/components/list/List";
import { errorMessage } from "@/lib/api";
import { useAppearance } from "@/lib/appearance";
import { onPosted, readFeedCache, writeFeedCache, type FeedSnapshot } from "@/lib/feed-cache";
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

  // The reader's own new post on top. Home tells it, and so does lib/feed-cache.ts for a post sent from any screen; the
  // second word of the same post is passed over (own.current is set at once, before the state that holds it renders).
  const posted = useStable((post: PostView) => {
    const now = latest.current.state;
    if (own.current === post.id || now.status !== "ready" || now.items.some((item) => timelineKey(item) === post.id)) return;
    own.current = post.id;
    insertAbove([{ kind: "post", post }], null, false);
  });
  useImperativeHandle(handle, () => ({ posted }), [posted]);
  useEffect(() => onPosted((who, post) => (who === reader ? posted(post) : undefined)), [reader, posted]);

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

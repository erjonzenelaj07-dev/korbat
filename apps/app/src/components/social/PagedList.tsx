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

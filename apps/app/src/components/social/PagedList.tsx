import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import type { PostView, TimelineItem } from "@korbat/contracts";
import { errorMessage } from "@/lib/api";
import type { Page } from "@/lib/social";
import { PostCard } from "./PostCard";

interface PagedListProps<T> {
  /** Must be stable (useCallback) or the list reloads on every render. */
  fetchPage: (cursor?: string) => Promise<Page<T>>;
  keyOf: (item: T) => string;
  render: (item: T, remove: (key: string) => void) => ReactElement;
  empty: string;
  header?: ReactElement;
}

/**
 * Cursor pagination with a load-more control, pull to refresh, and the same error text as the rest
 * of the app. One request is in flight at a time, and a response only lands if no newer request
 * started meanwhile, so a double tap on Load more cannot append a page twice and a refresh cannot be
 * overwritten by an older page.
 */
export function PagedList<T>({ fetchPage, keyOf, render, empty, header }: PagedListProps<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const sequence = useRef(0);

  const load = useCallback(
    async (after?: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      const mine = ++sequence.current;
      try {
        const page = await fetchPage(after);
        if (mine !== sequence.current) return;
        setItems((current) => (after ? [...current, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setError(null);
      } catch (err) {
        if (mine === sequence.current) setError(errorMessage(err));
      } finally {
        if (mine === sequence.current) {
          inFlight.current = false;
          setLoading(false);
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
    setLoading(true);
    void load();
  }, [load]);

  const remove = (key: string) => setItems((current) => current.filter((item) => keyOf(item) !== key));

  return (
    <FlatList
      data={items}
      keyExtractor={keyOf}
      renderItem={({ item }) => render(item, remove)}
      ListHeaderComponent={header}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
      ListEmptyComponent={
        loading ? null : (
          <View className="items-center px-4 py-10">
            <Text accessibilityRole={error ? "alert" : undefined} className="text-center text-base text-zinc-400">
              {error ?? empty}
            </Text>
            {error ? (
              <Pressable accessibilityRole="button" onPress={() => void load()} className="mt-4 rounded-lg border border-zinc-700 px-4 py-2">
                <Text className="text-sm text-zinc-200">Try again</Text>
              </Pressable>
            ) : null}
          </View>
        )
      }
      ListFooterComponent={
        <View className="items-center py-4">
          {error && items.length > 0 ? (
            <Text accessibilityRole="alert" className="mb-2 text-sm text-red-400">
              {error}
            </Text>
          ) : null}
          {cursor ? (
            <Pressable accessibilityRole="button" onPress={() => void load(cursor)} className="rounded-lg border border-zinc-700 px-4 py-2">
              <Text className="text-sm text-zinc-200">Load more</Text>
            </Pressable>
          ) : null}
        </View>
      }
    />
  );
}

const timelineKey = (item: TimelineItem) => (item.kind === "repost" ? `${item.post.id}:${item.repostedBy.id}` : item.post.id);

export function TimelineList({ fetchPage, empty, header }: { fetchPage: (cursor?: string) => Promise<Page<TimelineItem>>; empty: string; header?: ReactElement }) {
  return (
    <PagedList
      fetchPage={fetchPage}
      keyOf={timelineKey}
      empty={empty}
      header={header}
      render={(item, remove) => (
        <PostCard post={item.post} repostedBy={item.kind === "repost" ? item.repostedBy : undefined} onDeleted={() => remove(timelineKey(item))} />
      )}
    />
  );
}

export function PostList({ fetchPage, empty, header }: { fetchPage: (cursor?: string) => Promise<Page<PostView>>; empty: string; header?: ReactElement }) {
  return <PagedList fetchPage={fetchPage} keyOf={(post) => post.id} empty={empty} header={header} render={(post, remove) => <PostCard post={post} onDeleted={remove} />} />;
}

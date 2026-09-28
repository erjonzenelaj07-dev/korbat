import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import { EXPLORE_V1, type ExploreFormula, type TimelineItem } from "@korbat/contracts";
import { errorMessage } from "@/lib/api";
import { EXPLORE_REFRESHED_NOTICE, exploreEmptyText, rankingAge, readPages } from "@/lib/explore";
import { social } from "@/lib/social";
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
  return (
    <Link href="/explore/about" asChild>
      <Pressable className="py-1">
        <Text className="text-sm text-zinc-400 underline">How Explore works</Text>
      </Pressable>
    </Link>
  );
}

/** Under the tabs: how long ago the ranking was computed, or since when it has not been, and the link to its rules. */
export function ExploreHeader({ computedAt }: { computedAt: string | null }) {
  const now = useMinuteClock();
  // Before the first round there is no ranking, and no time to show.
  const age = computedAt ? rankingAge(computedAt, now) : null;
  return (
    <View className="flex-row flex-wrap items-center justify-between gap-x-4 border-b border-zinc-800 px-4 py-2">
      {age ? <Text className={`text-sm ${age.stale ? "text-amber-300" : "text-zinc-400"}`}>{age.text}</Text> : <View />}
      <AboutLink />
    </View>
  );
}

/** An empty Explore (2c design, section 11): when a post appears there, in the formula's numbers, with the rules and a way on. */
export function ExploreEmpty({ onShowLatest, formula = EXPLORE_V1 }: { onShowLatest: () => void; formula?: ExploreFormula }) {
  return (
    <View className="items-center px-4 py-10">
      <Text className="mb-3 text-center text-base leading-6 text-zinc-400">{exploreEmptyText(formula)}</Text>
      <AboutLink />
      <Pressable accessibilityRole="button" onPress={onShowLatest} className="mt-4 rounded-lg border border-zinc-700 px-4 py-2">
        <Text className="text-sm text-zinc-200">Show Latest</Text>
      </Pressable>
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
    <View className="items-center py-4">
      <View ref={statusRef} role="status" aria-live="polite" tabIndex={-1}>
        {notice ? <Text className="mb-2 px-4 text-center text-sm text-zinc-300">{notice}</Text> : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" className="mb-2 text-sm text-red-400">
          {error}
        </Text>
      ) : null}
      {cursor ? (
        <Pressable accessibilityRole="button" onPress={onLoadMore} className="rounded-lg border border-zinc-700 px-4 py-2">
          <Text className="text-sm text-zinc-200">Load more</Text>
        </Pressable>
      ) : null}
      {signInForMore ? (
        <Link href="/signin" asChild>
          <Pressable className="rounded-lg border border-zinc-700 px-4 py-2">
            <Text className="text-sm text-zinc-200">Sign in to see more of Explore</Text>
          </Pressable>
        </Link>
      ) : null}
    </View>
  );
}

/**
 * Explore under Home's tabs (2c design, section 11), on PagedList's pattern: one read in flight at a time, so a double
 * press on Load more cannot append a page twice and a pull to refresh cannot land between the pages of a read. A cursor
 * names the ranking it came from; when a refresh has pruned that ranking, readPages reads the current one from its first
 * page and adds only the posts not on screen, so the posts already read stay where they are, the focus stays at the
 * footer and the status line says what happened. Home remounts the list for another tab or a new post. The answers live
 * in this component's state alone: nothing keeps them once it unmounts.
 */
export function ExploreList({ onShowLatest }: { onShowLatest: () => void }) {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [computedAt, setComputedAt] = useState<string | null>(null);
  const [signInForMore, setSignInForMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshes, setRefreshes] = useState(0);
  const inFlight = useRef(false);
  // The ids of the posts on screen, which a page of a new ranking must not add again.
  const shown = useRef(new Set<string>());
  const footer = useRef<View>(null);

  const load = useCallback(
    async (after?: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setNotice(null);
      try {
        // Without a cursor the list starts over (first load, pull to refresh), so nothing on screen is kept.
        const result = await readPages(social.explore, after, after === undefined ? new Set<string>() : shown.current);
        const added = result.added.map((item) => item.post.id);
        shown.current = new Set(after === undefined ? added : [...shown.current, ...added]);
        setItems((current) => (after === undefined ? result.added : [...current, ...result.added]));
        setCursor(result.nextCursor);
        if (result.last) {
          setComputedAt(result.last.computedAt);
          setSignInForMore(result.last.signInForMore);
        }
        setError(null);
        if (result.refreshed) {
          setNotice(EXPLORE_REFRESHED_NOTICE);
          setRefreshes((count) => count + 1);
        }
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        inFlight.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // After a refresh the focus stays at the footer: Load more keeps it while the new ranking has more, and when the ranking
  // ended, Load more has left the tree with the focus, so the status line takes it.
  useEffect(() => {
    if (refreshes > 0 && cursor === null) (footer.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [refreshes]);

  const remove = (id: string) => setItems((current) => current.filter((item) => item.post.id !== id));

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.post.id}
      renderItem={({ item }) => <PostCard post={item.post} onDeleted={remove} />}
      ListHeaderComponent={<ExploreHeader computedAt={computedAt} />}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
      ListEmptyComponent={
        loading ? null : error ? (
          <View className="items-center px-4 py-10">
            <Text accessibilityRole="alert" className="text-center text-base text-zinc-400">
              {error}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => void load()} className="mt-4 rounded-lg border border-zinc-700 px-4 py-2">
              <Text className="text-sm text-zinc-200">Try again</Text>
            </Pressable>
          </View>
        ) : (
          <ExploreEmpty onShowLatest={onShowLatest} />
        )
      }
      ListFooterComponent={
        <ExploreFooter
          cursor={cursor}
          signInForMore={signInForMore}
          notice={notice}
          error={items.length > 0 ? error : null}
          onLoadMore={() => {
            if (cursor) void load(cursor);
          }}
          statusRef={footer}
        />
      }
    />
  );
}

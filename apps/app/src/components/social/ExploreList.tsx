import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import { EXPLORE_V2, type ExploreFormula } from "@korbat/contracts";
import { errorMessage } from "@/lib/api";
import { EXPLORE_REFRESHED_NOTICE, exploreEmptyText, exploreReader, NOTHING_SHOWN, rankingAge, type ExploreShown, type RankingRead } from "@/lib/explore";
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

/**
 * Under the tabs: how long ago the ranking on screen was computed, or since when it had not been when it was read; once it
 * is as old as the refresh interval, Refresh, which reads the first page again (pull to refresh does so on a phone, but
 * nothing does on the web); and the link to its rules. The line can take the focus, which the list gives it after Refresh.
 */
export function ExploreHeader({ ranking, onRefresh, lineRef }: { ranking: RankingRead | null; onRefresh: () => void; lineRef?: Ref<View> }) {
  const now = useMinuteClock();
  // Before the first round there is no ranking, no time to show and nothing to read again.
  const age = ranking ? rankingAge(ranking, now) : null;
  return (
    <View className="flex-row flex-wrap items-center justify-between gap-x-4 border-b border-zinc-800 px-4 py-2">
      <View ref={lineRef} tabIndex={-1}>
        {age ? <Text className={`text-sm ${age.stale ? "text-amber-300" : "text-zinc-400"}`}>{age.text}</Text> : null}
      </View>
      <View className="flex-row items-center gap-x-4">
        {age?.offerRefresh ? (
          <Pressable accessibilityRole="button" onPress={onRefresh} className="rounded-lg border border-zinc-700 px-3 py-1">
            <Text className="text-sm text-zinc-200">Refresh</Text>
          </Pressable>
        ) : null}
        <AboutLink />
      </View>
    </View>
  );
}

/** An empty Explore (2c design, section 11): when a post appears there, in the formula's numbers, with the rules and a way on. */
export function ExploreEmpty({ onShowLatest, formula = EXPLORE_V2 }: { onShowLatest: () => void; formula?: ExploreFormula }) {
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
 * Explore under Home's tabs (2c design, section 11), on PagedList's pattern. Its reads go through one exploreReader made
 * with the list, which lets one read run at a time and answers what the list shows; the component only puts that on
 * screen. A cursor names the ranking it came from; when a refresh has pruned that ranking, the reader reads the current
 * one from its first page and adds only the posts not on screen, so the posts already read stay where they are, the focus
 * stays at the footer and the status line says what happened. Home remounts the list for another tab, a new post or
 * another reader. The answers live in this component and its reader alone: nothing keeps them once it unmounts.
 */
export function ExploreList({ onShowLatest }: { onShowLatest: () => void }) {
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

  return (
    <FlatList
      data={shown.items}
      keyExtractor={(item) => item.post.id}
      renderItem={({ item }) => <PostCard post={item.post} onDeleted={remove} />}
      ListHeaderComponent={<ExploreHeader ranking={shown.ranking} onRefresh={() => refresh(true)} lineRef={line} />}
      refreshing={refreshing}
      onRefresh={() => refresh(false)}
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

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

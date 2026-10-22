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

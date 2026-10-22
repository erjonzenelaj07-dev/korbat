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

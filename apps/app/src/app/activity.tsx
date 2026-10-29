import { useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, View } from "react-native";
import { Link, Redirect, router, useIsFocused, useLocalSearchParams } from "expo-router";
import type { ActivityEntry, ActivityTab } from "@korbat/contracts";
import { FollowsEntry } from "@/components/activity/FollowsEntry";
import { ModerationEntry } from "@/components/activity/ModerationEntry";
import { PostEntry } from "@/components/activity/PostEntry";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/kit/EmptyState";
import { ErrorState } from "@/components/kit/ErrorState";
import { Icon } from "@/components/kit/Icon";
import { FOCUS_RING } from "@/components/kit/interaction";
import { Skeleton } from "@/components/kit/Skeleton";
import { TabPanel, Tabs } from "@/components/kit/Tabs";
import { Text } from "@/components/kit/Text";
import { List, useStable, type ListHandle } from "@/components/list/List";
import { HeaderSpace, ScreenHeader } from "@/components/ScreenHeader";
import { renderFeedRow } from "@/components/social/FeedRows";
import { NewPostsPill } from "@/components/social/NewPostsPill";
import {
  activityApi,
  activityEnd,
  activityPill,
  activityPollActive,
  activityRows,
  activityTab,
  createActivityPoll,
  firstEntryKey,
  firstLoadedKey,
  markForVisit,
  retryFocus,
  seenToSend,
  type ActivityRow,
} from "@/lib/activity";
import { ACTIVITY_WORDS } from "@/lib/activity-words";
import { errorMessage } from "@/lib/api";
import { pageVisible } from "@/lib/new-posts";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { useShellScroll } from "@/lib/shell-scroll";
import { cn } from "@/theme/cn";

const W = ACTIVITY_WORDS;
/** The panel the tabs control. */
const PANEL = "activity-panel";

/**
 * "New since you last looked" and "Earlier" (10.2): h2s, so headings navigation reaches both, drawn as the feed's "You
 * were here" is, a label and a line in ink-medium, never a colour alone.
 */
function Heading({ heading }: { heading: "new" | "earlier" }) {
  return (
    <View className="flex-row items-center gap-3 px-4 pb-2 pt-4">
      <Text as="h2" variant="body-strong" tone="medium">
        {heading === "new" ? W["activity.divider"] : W["activity.earlier"]}
      </Text>
      <View className="h-px flex-1 bg-line-high" />
    </View>
  );
}

/** What a list row needs besides itself; the feed's rows are reused for the skeletons and Load more. */
export interface ActivityRowProps {
  row: ActivityRow;
  tab: ActivityTab;
  /** The reader's handle: a follow group's "See your followers" opens their own list. */
  handle: string;
  onRetry: () => void;
  onLoadMore: () => void;
}

const noop = () => undefined;

/** One row of the list: an entry by its type, a heading, or the list's own states (10.2). */
export function ActivityRowView({ row, tab, handle, onRetry, onLoadMore }: ActivityRowProps) {
  switch (row.kind) {
    case "entry":
      return row.entry.type === "post" ? <PostEntry entry={row.entry} /> : row.entry.type === "follows" ? <FollowsEntry entry={row.entry} handle={handle} /> : <ModerationEntry entry={row.entry} />;
    case "heading":
      return <Heading heading={row.heading} />;
    case "empty":
      return tab === "all" ? <EmptyState title={W["activity.empty.all.title"]} body={W["activity.empty.all.body"]} /> : <EmptyState title={W["activity.empty.conversations.title"]} body={W["activity.empty.conversations.body"]} />;
    case "error":
      return <ErrorState message={W["activity.error"]} onRetry={onRetry} />;
    case "end":
      return (
        <View className="items-center px-4 py-8">
          <Text variant="meta" tone="low" className="text-center">
            {activityEnd()}
          </Text>
        </View>
      );
    default:
      return renderFeedRow(row, { renderPost: () => null, setSize: -1, index: 0, empty: { body: "" }, onRetry, onLoadMore });
  }
}

/** The header's quiet link to Settings, Activity (10.1): the settings icon and its words in ink-medium, 44 px tall. */
function SettingsLink() {
  return (
    <Link href="/settings/activity" asChild>
      <Pressable className={cn("min-h-[44px] flex-row items-center gap-1.5 self-start rounded-control active:opacity-70", FOCUS_RING)}>
        <Icon name="settings" size={16} tone="medium" />
        <Text variant="meta" tone="medium" className="underline web:underline-offset-2">
          {W["activity.settingsLink"]}
        </Text>
      </Pressable>
    </Link>
  );
}

function Header({ tab }: { tab: ActivityTab }) {
  return (
    <ScreenHeader title={W["activity.title"]}>
      <SettingsLink />
      <Tabs
        label={W["activity.tabs"]}
        tabs={[
          { key: "all", label: W["activity.tab.all"] },
          { key: "conversations", label: W["activity.tab.conversations"] },
        ]}
        selected={tab}
        // The tab lives in the address, so a reload keeps it; nothing is stored.
        onSelect={(next) => router.setParams({ tab: next })}
        panelId={PANEL}
      />
    </ScreenHeader>
  );
}

interface ListState {
  items: ActivityEntry[];
  cursor: string | null;
  status: "loading" | "ready" | "error";
  error: string | null;
  loadingMore: boolean;
  moreError: string | null;
}

const LOADING: ListState = { items: [], cursor: null, status: "loading", error: null, loadingMore: false, moreError: null };

/**
 * On the web, moves the focus to the entry whose row has this key, its article, which takes the focus by script; true once
 * it holds the focus, false while the row is not drawn yet. Native has no such element, so there is nothing to wait for.
 */
function focusEntry(key: string): boolean {
  if (Platform.OS !== "web" || typeof document === "undefined") return true;
  const article = document.querySelector(`[data-row="${key}"] [role="article"]`) as HTMLElement | null;
  article?.focus();
  return article !== null && document.activeElement === article;
}

/**
 * One tab's list (2d design, sections 5.7, 5.8 and 10.2): the first page, then the seen marker with its newest time when
 * something on it was new; later pages marked new against the first page's marker; the newer count asked 30 s after the
 * list opened and every 60 s, only while the screen is focused and the page visible, shown in the feed's pill; the pill,
 * and pull to refresh on phones, read the first page again at the top, and the focus goes to the first entry; after Load
 * more, to the first entry it brought. Nothing here outlives the screen, and nothing else in the app asks for Activity.
 */
function ActivityList({ tab, handle }: { tab: ActivityTab; handle: string }) {
  const focused = useIsFocused();
  const scroll = useShellScroll();
  const [state, setState] = useState<ListState>(LOADING);
  const [newer, setNewer] = useState(0);
  const [visible, setVisible] = useState(pageVisible);
  const [refreshing, setRefreshing] = useState(false);
  // The first page's marker, kept for the visit: later pages are new against it, not against the marker this visit sent.
  const visit = useRef<string | null>(null);
  const focusNext = useRef<string | null>(null);
  // The focus request still waiting for its row to be drawn; a newer request, or the list's end, cancels it.
  const pendingFocus = useRef<(() => void) | null>(null);
  const cancelFocus = () => {
    pendingFocus.current?.();
    pendingFocus.current = null;
  };
  const list = useRef<ListHandle>(null);
  const latest = useRef(state);
  latest.current = state;

  const first = useStable(async (focus: boolean) => {
    try {
      const page = await activityApi.page(tab);
      visit.current = page.seenAt;
      setNewer(0);
      setState({ ...LOADING, items: page.items, cursor: page.nextCursor, status: "ready" });
      if (focus) {
        // The pill and a refresh show the first page at the top, where the focus goes.
        list.current?.toTop(false);
        focusNext.current = page.items[0]?.key ?? null;
      }
      const seen = seenToSend(page);
      if (seen !== null) void activityApi.seen(seen).catch(noop);
    } catch (err) {
      setState({ ...LOADING, status: "error", error: errorMessage(err) });
    }
  });
  useEffect(() => {
    void first(false);
  }, [tab]);

  const more = useStable(async () => {
    const now = latest.current;
    if (now.cursor === null || now.loadingMore) return;
    cancelFocus();
    setState({ ...now, loadingMore: true, moreError: null });
    try {
      const page = await activityApi.page(tab, now.cursor);
      focusNext.current = firstLoadedKey(now.items.length, [...now.items, ...page.items]);
      setState({ ...now, items: [...now.items, ...markForVisit(page.items, visit.current)], cursor: page.nextCursor, loadingMore: false, moreError: null });
    } catch (err) {
      setState({ ...now, loadingMore: false, moreError: errorMessage(err) });
    }
  });
  const reload = useStable(async () => {
    cancelFocus();
    setRefreshing(true);
    await first(true);
    setRefreshing(false);
  });

  // The focus moves to the entry the pill, a refresh or Load more names once its row is drawn. The list draws only a window
  // of rows, in batches, and on a slow device the window can still be elsewhere when the page lands (the removed Load more
  // row takes the scroll with it): so it is tried until the row's article is there and holds the focus, for a few seconds
  // at most, and while the row is not drawn the list is asked to draw the rows around it.
  useEffect(() => {
    const key = focusNext.current;
    focusNext.current = null;
    if (key === null) return;
    cancelFocus();
    pendingFocus.current = retryFocus(() => {
      if (focusEntry(key)) return true;
      list.current?.jumpTo(key, false);
      return false;
    });
  }, [state]);
  useEffect(() => cancelFocus, []);

  // The page's visibility, as the feed follows it: the poll stops while korbat is in the background.
  useEffect(() => {
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const change = () => setVisible(pageVisible());
      document.addEventListener("visibilitychange", change);
      return () => document.removeEventListener("visibilitychange", change);
    }
    const subscription = AppState.addEventListener("change", (next) => setVisible(next === "active"));
    return () => subscription.remove();
  }, []);

  const ask = useStable(async () => {
    const answer = await activityApi.newer(tab, latest.current.items[0]?.at);
    setNewer(answer.count);
  });
  const clock = useRef<ReturnType<typeof createActivityPoll> | null>(null);
  useEffect(() => {
    const made = createActivityPoll(ask);
    clock.current = made;
    return () => made.dispose();
  }, [tab]);
  useEffect(() => {
    clock.current?.setActive(activityPollActive({ focused, visible, ready: state.status === "ready" }));
  }, [focused, visible, state.status]);

  const rows = activityRows(state);
  const retry = useStable(() => {
    setState(LOADING);
    void first(false);
  });
  return (
    <View className="flex-1">
      <List
        handle={list}
        rows={rows}
        keyOf={(row) => row.key}
        versionOf={(row) => (row.kind === "entry" ? [row.entry] : row.kind === "loadMore" ? [row.busy] : row.kind === "loadMoreError" || row.kind === "error" ? [row.message] : [row.kind])}
        renderRow={(row) => <ActivityRowView row={row} tab={tab} handle={handle} onRetry={retry} onLoadMore={() => void more()} />}
        feed
        label={W["activity.title"]}
        busy={state.status === "loading" || state.loadingMore}
        refreshing={refreshing}
        onRefresh={Platform.OS === "web" ? undefined : () => void reload()}
      />
      <NewPostsPill count={newer} top={scroll.headerSpace} headerY={scroll.headerY} onPress={() => void reload()} wordsFor={activityPill} label={W["activity.pill.label"]} />
    </View>
  );
}

/**
 * Activity (2d design, section 10.2; decisions 4 to 6): for an account only, signed out it goes to Sign in, as Bookmarks
 * does. The header "Activity" with the quiet link to its settings and the tabs All and Conversations, the tab in the
 * address (`?tab=conversations`); then the tab's list. The screen is the only place that asks for or shows what is new.
 */
export default function Activity() {
  const { state } = useSession();
  const title = usePageTitle("title.activity");
  const { tab: param } = useLocalSearchParams<{ tab?: string }>();
  const tab = activityTab(param);
  if (state.status === "signed-out") return <Redirect href="/signin" />;
  if (state.status === "signed-in" && !state.me.user.onboarded) return <Redirect href="/handle" />;
  return (
    <AppShell>
      {title}
      <Header tab={tab} />
      <TabPanel panelId={PANEL} selected={tab}>
        {state.status === "signed-in" ? (
          <ActivityList key={tab} tab={tab} handle={state.me.profile?.handle ?? ""} />
        ) : (
          <>
            <HeaderSpace />
            <Skeleton.List kind="posts" count={5} />
          </>
        )}
      </TabPanel>
    </AppShell>
  );
}

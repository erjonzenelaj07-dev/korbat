import { useCallback, useEffect, useRef, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { Redirect, router, useIsFocused, useLocalSearchParams } from "expo-router";
import type { MeResponse, PostView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/kit/Skeleton";
import { TabPanel, Tabs } from "@/components/kit/Tabs";
import { Text } from "@/components/kit/Text";
import { HeaderSpace, ScreenHeader } from "@/components/ScreenHeader";
import { ComposeButton, ComposeSheet } from "@/components/social/ComposeSheet";
import { Composer } from "@/components/social/Composer";
import { ExploreList } from "@/components/social/ExploreList";
import { FeedList, type FeedListHandle } from "@/components/social/FeedList";
import { Button } from "@/components/ui";
import { insertPosted } from "@/lib/feed-cache";
import { usePageTitle } from "@/lib/page-title";
import { dismissSuggestion, platformPasskeyAvailable, suggestionDismissedAt, suggestPasskey } from "@/lib/passkeys";
import { useSession } from "@/lib/session";
import { UI_WORDS } from "@/lib/ui-words";

export type Tab = "following" | "latest" | "explore";

const LABELS: Record<Tab, string> = { following: UI_WORDS["home.following"], latest: UI_WORDS["home.latest"], explore: UI_WORDS["home.explore"] };

/**
 * What a signed-out reader is told under the tabs: both lists are public, and an account adds the rest. Explore's prompt
 * must be true whatever the list turns out to hold, nothing or all there is, so it promises no more of Explore: the
 * list's own footer offers that, and only when the page says more posts exist.
 */
const SIGNED_OUT_PROMPTS: Record<Exclude<Tab, "following">, string> = {
  latest: "You are reading the latest public posts. Sign in to follow people and post.",
  explore: "Explore lists recent posts that other accounts like and repost. Sign in to follow people and post.",
};

/** Home's tabs in their order (2c design, section 11): Following first for an account, and Latest first for everyone else, who has no Following. */
export function homeTabs(signedIn: boolean): Tab[] {
  return signedIn ? ["following", "latest", "explore"] : ["latest", "explore"];
}

/**
 * The tab the address names (`/?tab=explore`), so another page can link to one; a missing or unknown name, or one the
 * reader does not have (Following, signed out), means the first tab. A parameter given twice counts by its first value.
 */
export function homeTab(param: string | string[] | undefined, signedIn: boolean): Tab {
  const tabs = homeTabs(signedIn);
  const named = Array.isArray(param) ? param[0] : param;
  return tabs.find((tab) => tab === named) ?? tabs[0]!;
}

/**
 * The key of Home's list: only another reader (an account's id, or none signed out) mounts a new list, which reads its
 * first page again (UI design, section 7.5). The reader is in it because a list read signed out has no cursor, offers a
 * sign-in and was read without any block or mute, and the web keeps a Home mounted under the sign-in screen, which Back
 * shows again once signed in. A tab change or a new post keeps the list: a tab's rows and place come back from
 * lib/feed-cache.ts, and the reader's own post is put on top.
 */
export function homeListKey(viewer: string | null): string {
  return viewer ?? "signed-out";
}

/** Home's panel, which its tabs control. */
const PANEL = "home-panel";

/**
 * The nudge towards a passkey (1c design, section 9): for an account without one, on a device with a built-in
 * authenticator to add one with, until Not now, which holds for 30 days on this device. A card of its own (UI design,
 * section 8.2), its words as they were.
 */
function PasskeySuggestion({ me }: { me: MeResponse }) {
  const [platform, setPlatform] = useState(false);
  const [dismissedAt, setDismissedAt] = useState(suggestionDismissedAt);
  useEffect(() => {
    let cancelled = false;
    void platformPasskeyAvailable().then((available) => {
      if (!cancelled) setPlatform(available);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!suggestPasskey({ passkeys: me.user.passkeys, platformAuthenticator: platform, dismissedAt, now: Date.now() })) return null;
  return (
    <View className="mx-4 mt-3 gap-1 rounded-card border border-line-low bg-surface-1 px-4 pb-4 pt-3">
      <Text as="h2" variant="title">
        {UI_WORDS["passkey.title"]}
      </Text>
      <Text tone="medium">{UI_WORDS["passkey.body"]}</Text>
      <View className="flex-row flex-wrap gap-x-2">
        <Button label={UI_WORDS["passkey.add"]} full={false} onPress={() => router.push("/settings/security?add=1")} />
        <Button
          label={UI_WORDS["passkey.notNow"]}
          tone="secondary"
          full={false}
          onPress={() => {
            const now = Date.now();
            dismissSuggestion(now);
            setDismissedAt(now);
          }}
        />
      </View>
    </View>
  );
}

/** What a signed-out reader reads above the list: what the tab holds, and the way to an account. */
function SignedOutPrompt({ tab }: { tab: Tab }) {
  return (
    <View className="mx-4 mt-3 rounded-card border border-line-low bg-surface-1 px-4 pb-4 pt-3">
      <Text tone="medium">{SIGNED_OUT_PROMPTS[tab === "explore" ? "explore" : "latest"]}</Text>
      <View className="flex-row">
        <Button label={UI_WORDS["nav.signin"]} onPress={() => router.push("/signin")} tone="secondary" full={false} />
      </View>
    </View>
  );
}

/**
 * Home (UI design, section 8.2): the header "Home" with the tabs under it, Following, Latest and Explore for a
 * signed-in account and Latest and Explore with a sign-in prompt for everyone else; then the tab's list, which keeps the
 * reader's place in Following and Latest. At 768 px and wider the composer is inline above the list; below, the compose
 * button opens the sheet. The reader's own new post goes on top of Following and Latest.
 */
export default function Home() {
  const { state } = useSession();
  const { width } = useWindowDimensions();
  const title = usePageTitle("title.home");
  const focused = useIsFocused();
  const { tab: param } = useLocalSearchParams<{ tab?: string }>();
  const [composing, setComposing] = useState(false);
  const feed = useRef<FeedListHandle>(null);

  const signedIn = state.status === "signed-in";
  const current = homeTab(param, signedIn);
  const header = (
    <ScreenHeader title={UI_WORDS["home.title"]}>
      <Tabs
        label={UI_WORDS["home.tabs"]}
        tabs={homeTabs(signedIn).map((key) => ({ key, label: LABELS[key] }))}
        selected={current}
        // The tab lives in the address, so a reload keeps it and other pages can link to one; setParams changes it in place.
        onSelect={(tab) => router.setParams({ tab })}
        panelId={PANEL}
      />
    </ScreenHeader>
  );
  const viewerId = state.status === "signed-in" ? state.me.user.id : null;
  const posted = useCallback(
    (post: PostView) => {
      // On top of both feeds: the one on screen now, and the other one as the session keeps it.
      insertPosted(viewerId, post);
      feed.current?.posted(post);
    },
    [viewerId],
  );

  if (state.status === "loading") {
    return (
      <AppShell>
        {title}
        {header}
        <HeaderSpace />
        <Skeleton.List kind="posts" count={5} />
      </AppShell>
    );
  }
  if (state.status === "signed-in" && !state.me.user.onboarded) return <Redirect href="/handle" />;

  const viewer = state.status === "signed-in" ? state.me.user.id : null;
  const select = (tab: Tab) => router.setParams({ tab });
  const inlineComposer = signedIn && width >= 768;
  // What scrolls above the posts: the sign-in prompt, the passkey card and, wider, the composer.
  const above = (
    <View>
      {signedIn ? null : <SignedOutPrompt tab={current} />}
      {state.status === "signed-in" ? <PasskeySuggestion me={state.me} /> : null}
      {inlineComposer ? (
        <View className="border-b border-line-low">
          <Composer onPosted={posted} />
        </View>
      ) : null}
    </View>
  );

  return (
    <AppShell floating={signedIn && !inlineComposer ? <ComposeButton onPress={() => setComposing(true)} /> : undefined}>
      {title}
      {header}
      <TabPanel panelId={PANEL} selected={current}>
        {current === "explore" ? (
          <ExploreList key={homeListKey(viewer)} onShowLatest={() => select("latest")} header={above} />
        ) : (
          <FeedList key={homeListKey(viewer)} handle={feed} feed={current} reader={viewer} active={focused} header={above} onShowLatest={() => select("latest")} />
        )}
      </TabPanel>
      <ComposeSheet open={composing} onClose={() => setComposing(false)} onPosted={posted} />
    </AppShell>
  );
}

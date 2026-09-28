import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import type { MeResponse } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { ComposeButton, ComposeSheet } from "@/components/social/ComposeSheet";
import { Composer } from "@/components/social/Composer";
import { ExploreList } from "@/components/social/ExploreList";
import { TimelineList } from "@/components/social/PagedList";
import { Button, Loading } from "@/components/ui";
import { dismissSuggestion, platformPasskeyAvailable, suggestionDismissedAt, suggestPasskey } from "@/lib/passkeys";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";

export type Tab = "following" | "latest" | "explore";

const LABELS: Record<Tab, string> = { following: "Following", latest: "Latest", explore: "Explore" };

/** What a signed-out reader is told under the tabs: both lists are public, and an account adds the rest. */
const SIGNED_OUT_PROMPTS: Record<Exclude<Tab, "following">, string> = {
  latest: "You are reading the latest public posts. Sign in to follow people and post.",
  explore: "You are reading recent posts that other accounts like and repost. Sign in to see more of Explore, follow people and post.",
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
 * The nudge towards a passkey (1c design, section 9): for an account without one, on a device with a built-in
 * authenticator to add one with, until Not now, which holds for 30 days on this device.
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
    <View className="mx-4 mt-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
      <Text accessibilityRole="header" aria-level={2} className="text-base font-semibold text-zinc-50">
        Sign in faster with a passkey
      </Text>
      <Text className="mt-1 text-sm text-zinc-300">A passkey signs you in with your fingerprint, face or PIN, and cannot be phished. Adding one takes a moment.</Text>
      <View className="mt-3 flex-row gap-2">
        <Pressable accessibilityRole="button" onPress={() => router.push("/settings/security?add=1")} className="rounded-lg bg-zinc-50 px-4 py-2">
          <Text className="text-sm font-semibold text-zinc-950">Add a passkey</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            const now = Date.now();
            dismissSuggestion(now);
            setDismissedAt(now);
          }}
          className="rounded-lg border border-zinc-700 px-4 py-2"
        >
          <Text className="text-sm text-zinc-200">Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Home: Following, Latest and Explore for a signed-in account; Latest and Explore with a sign-in prompt for everyone else. */
export default function Home() {
  const { state } = useSession();
  const { width } = useWindowDimensions();
  const { tab: param } = useLocalSearchParams<{ tab?: string }>();
  const [version, setVersion] = useState(0);
  const [composing, setComposing] = useState(false);
  const fetchFollowing = useCallback((cursor?: string) => social.following(cursor), []);
  const fetchLatest = useCallback((cursor?: string) => social.latest(cursor), []);

  if (state.status === "loading") {
    return (
      <AppShell>
        <Loading />
      </AppShell>
    );
  }
  if (state.status === "signed-in" && !state.me.user.onboarded) return <Redirect href="/handle" />;

  const signedIn = state.status === "signed-in";
  const current = homeTab(param, signedIn);
  // The tab lives in the address, so a reload keeps it and other pages can link to one; setParams changes it in place.
  const select = (tab: Tab) => router.setParams({ tab });
  const inlineComposer = signedIn && width >= 768;
  const posted = () => setVersion((v) => v + 1);

  return (
    <AppShell floating={signedIn && !inlineComposer ? <ComposeButton onPress={() => setComposing(true)} /> : undefined}>
      <View className="border-b border-zinc-800 px-4 pt-4">
        <Text accessibilityRole="header" className="text-xl font-bold text-zinc-50">
          Home
        </Text>
        <View accessibilityRole="tablist" className="mt-3 flex-row">
          {homeTabs(signedIn).map((t) => (
            <Pressable key={t} accessibilityRole="tab" aria-selected={current === t} onPress={() => select(t)} className={`mr-6 border-b-2 pb-2 ${current === t ? "border-zinc-50" : "border-transparent"}`}>
              <Text className={`text-base ${current === t ? "font-semibold text-zinc-50" : "text-zinc-400"}`}>{LABELS[t]}</Text>
            </Pressable>
          ))}
        </View>
        {signedIn ? null : (
          <View className="my-3 rounded-lg bg-zinc-900 px-4 py-3">
            <Text className="text-sm text-zinc-300">{SIGNED_OUT_PROMPTS[current === "explore" ? "explore" : "latest"]}</Text>
            <Button label="Sign in" onPress={() => router.push("/signin")} tone="secondary" />
          </View>
        )}
      </View>
      {state.status === "signed-in" ? <PasskeySuggestion me={state.me} /> : null}
      {inlineComposer ? (
        <View className="border-b border-zinc-800">
          <Composer onPosted={posted} />
        </View>
      ) : null}
      {current === "explore" ? (
        <ExploreList key={`${current}:${version}`} onShowLatest={() => select("latest")} />
      ) : (
        <TimelineList
          key={`${current}:${version}`}
          fetchPage={current === "following" ? fetchFollowing : fetchLatest}
          empty={current === "following" ? "Nothing here yet. Follow someone, or switch to Latest or Explore." : "No posts yet."}
        />
      )}
      <ComposeSheet open={composing} onClose={() => setComposing(false)} onPosted={posted} />
    </AppShell>
  );
}

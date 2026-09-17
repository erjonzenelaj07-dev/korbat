import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Redirect, router } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { TimelineList } from "@/components/social/PagedList";
import { Button, Loading } from "@/components/ui";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";

type Tab = "following" | "latest";

/** Home: Following and Latest for a signed-in account, Latest with a sign-in prompt for everyone else. */
export default function Home() {
  const { state } = useSession();
  const [tab, setTab] = useState<Tab>("following");
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
  const current: Tab = signedIn ? tab : "latest";

  return (
    <AppShell>
      <View className="border-b border-zinc-800 px-4 pt-4">
        <Text accessibilityRole="header" className="text-xl font-bold text-zinc-50">
          Home
        </Text>
        {signedIn ? (
          <View className="mt-3 flex-row">
            {(["following", "latest"] as Tab[]).map((t) => (
              <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: current === t }} onPress={() => setTab(t)} className={`mr-6 border-b-2 pb-2 ${current === t ? "border-zinc-50" : "border-transparent"}`}>
                <Text className={`text-base ${current === t ? "font-semibold text-zinc-50" : "text-zinc-400"}`}>{t === "following" ? "Following" : "Latest"}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <View className="my-3 rounded-lg bg-zinc-900 px-4 py-3">
            <Text className="text-sm text-zinc-300">You are reading the latest public posts. Sign in to follow people and post.</Text>
            <Button label="Sign in" onPress={() => router.push("/signin")} tone="secondary" />
          </View>
        )}
      </View>
      <TimelineList
        key={current}
        fetchPage={current === "following" ? fetchFollowing : fetchLatest}
        empty={current === "following" ? "Nothing here yet. Follow someone, or switch to Latest." : "No posts yet."}
      />
    </AppShell>
  );
}

import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { Link, Redirect, useLocalSearchParams } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { FollowButton, ProfileList } from "@/components/social/ProfileList";
import { Loading } from "@/components/ui";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";

/** Who an account follows. Signed-in viewers only. */
export default function Following() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { state } = useSession();
  const fetchPage = useCallback((cursor?: string) => social.followingOf(handle, cursor), [handle]);

  if (state.status === "loading") return <Loading />;
  if (state.status === "signed-out") return <Redirect href="/signin" />;
  const myId = state.me.user.id;

  return (
    <AppShell>
      <ProfileList
        fetchPage={fetchPage}
        empty="Not following anyone yet."
        header={
          <View className="border-b border-zinc-800 px-4 py-4">
            <Link href={`/u/${handle}`} asChild>
              <Pressable>
                <Text className="text-sm text-zinc-400 underline">@{handle}</Text>
              </Pressable>
            </Link>
            <Text accessibilityRole="header" className="mt-1 text-xl font-bold text-zinc-50">
              Following
            </Text>
          </View>
        }
        action={(item) => (item.id === myId ? undefined : <FollowButton handle={item.handle} initial={item.viewerFollows ?? false} />)}
      />
    </AppShell>
  );
}

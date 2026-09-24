import { useCallback } from "react";
import { Text, View } from "react-native";
import { Redirect } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { PostList } from "@/components/social/PagedList";
import { Loading } from "@/components/ui";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";

/** Your bookmarks, newest first. Nobody else can see them. */
export default function Bookmarks() {
  const { state } = useSession();
  const fetchPage = useCallback((cursor?: string) => social.myBookmarks(cursor), []);

  if (state.status === "loading") return <Loading />;
  if (state.status === "signed-out") return <Redirect href="/signin" />;
  if (!state.me.user.onboarded) return <Redirect href="/handle" />;

  return (
    <AppShell>
      <PostList
        fetchPage={fetchPage}
        empty="Nothing saved yet. Use Save on a post to keep it here."
        header={
          <View className="border-b border-zinc-800 px-4 py-4">
            <Text accessibilityRole="header" className="text-xl font-bold text-zinc-50">
              Bookmarks
            </Text>
            <Text className="mt-1 text-sm text-zinc-400">Private to you.</Text>
          </View>
        }
      />
    </AppShell>
  );
}

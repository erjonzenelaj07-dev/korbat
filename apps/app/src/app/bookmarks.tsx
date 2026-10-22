import { useCallback } from "react";
import { View } from "react-native";
import { Redirect } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/kit/Icon";
import { Skeleton } from "@/components/kit/Skeleton";
import { Text } from "@/components/kit/Text";
import { HeaderSpace, ScreenHeader } from "@/components/ScreenHeader";
import { PostList } from "@/components/social/PagedList";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";
import { UI_WORDS } from "@/lib/ui-words";

/** The header (UI design, section 8.5): "Bookmarks", and beside the privacy icon, "Private to you." */
function BookmarksHeader() {
  return (
    <ScreenHeader title={UI_WORDS["bookmarks.title"]}>
      <View className="flex-row items-center gap-1.5">
        <Icon name="privacy" size={16} tone="low" />
        <Text variant="meta" tone="low">
          {UI_WORDS["bookmarks.private"]}
        </Text>
      </View>
    </ScreenHeader>
  );
}

/** Your bookmarks, newest first. Nobody else can see them. */
export default function Bookmarks() {
  const { state } = useSession();
  const title = usePageTitle("title.bookmarks");
  const fetchPage = useCallback((cursor?: string) => social.myBookmarks(cursor), []);

  // While the session loads the screen stays in the shell, with skeleton rows under its header (section 6.12).
  if (state.status === "loading") {
    return (
      <AppShell>
        {title}
        <BookmarksHeader />
        <HeaderSpace />
        <Skeleton.List kind="posts" count={5} />
      </AppShell>
    );
  }
  if (state.status === "signed-out") return <Redirect href="/signin" />;
  if (!state.me.user.onboarded) return <Redirect href="/handle" />;

  // The phone's compose button shows here (section 7.2).
  return (
    <AppShell compose>
      {title}
      <BookmarksHeader />
      <PostList fetchPage={fetchPage} empty={{ title: UI_WORDS["bookmarks.empty.title"], body: UI_WORDS["bookmarks.empty"] }} />
    </AppShell>
  );
}

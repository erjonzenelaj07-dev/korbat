import { useCallback } from "react";
import { Pressable } from "react-native";
import { Link, Redirect, useLocalSearchParams } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { FOCUS_RING } from "@/components/kit/interaction";
import { Skeleton } from "@/components/kit/Skeleton";
import { Text } from "@/components/kit/Text";
import { HeaderSpace, ScreenHeader } from "@/components/ScreenHeader";
import { FollowButton, ProfileList } from "@/components/social/ProfileList";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";

/**
 * The header (UI design, sections 7.2 and 8.4): Back to the profile, "Followers" as the h1, and the account's handle in the
 * mono face, a link to its profile. The tab's title names the kind of screen only, never the account.
 */
function FollowersHeader({ handle }: { handle: string }) {
  return (
    <ScreenHeader title={UI_WORDS["followers.title"]} back={`/u/${handle}`}>
      <Link href={`/u/${handle}`} asChild>
        <Pressable className={cn("min-h-[44px] justify-center self-start rounded-control active:opacity-70", FOCUS_RING)}>
          <Text variant="mono" tone="accent" className="underline web:underline-offset-2">
            @{handle}
          </Text>
        </Pressable>
      </Link>
    </ScreenHeader>
  );
}

/** Who follows an account. Signed-in viewers only, so scraping needs an account we can limit. */
export default function Followers() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { state } = useSession();
  const title = usePageTitle("title.followers");
  const fetchPage = useCallback((cursor?: string) => social.followers(handle, cursor), [handle]);

  // While the session loads the screen stays in the shell, with skeleton rows under its header (section 6.12).
  if (state.status === "loading") {
    return (
      <AppShell>
        {title}
        <FollowersHeader handle={handle} />
        <HeaderSpace />
        <Skeleton.List kind="accounts" count={6} />
      </AppShell>
    );
  }
  if (state.status === "signed-out") return <Redirect href="/signin" />;
  const myId = state.me.user.id;

  return (
    <AppShell>
      {title}
      <FollowersHeader handle={handle} />
      <ProfileList
        fetchPage={fetchPage}
        empty={UI_WORDS["followers.empty"]}
        action={(item) => (item.id === myId ? undefined : <FollowButton handle={item.handle} initial={item.viewerFollows ?? false} />)}
      />
    </AppShell>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Link, router, useLocalSearchParams, type Href } from "expo-router";
import type { ProfileView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { Avatar } from "@/components/kit/Avatar";
import { FOCUS_RING, dataAttribute } from "@/components/kit/interaction";
import { Sheet } from "@/components/kit/Sheet";
import { Skeleton } from "@/components/kit/Skeleton";
import { TabPanel, Tabs } from "@/components/kit/Tabs";
import { Text } from "@/components/kit/Text";
import { HeaderSpace } from "@/components/ScreenHeader";
import { PostList, TimelineList } from "@/components/social/PagedList";
import { ProfileMenu } from "@/components/social/ProfileMenu";
import { FollowButton } from "@/components/social/ProfileList";
import { Button, ErrorText, VerifiedChip } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useAppearance } from "@/lib/appearance";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { isSuspendedRefusal } from "@/lib/standing";
import { RefusedNotice } from "@/components/moderation/RefusedNotice";
import { social } from "@/lib/social";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { useLayout } from "@/theme/layout";

type Tab = "posts" | "replies" | "likes";

const TAB_LABELS: Record<Tab, string> = { posts: UI_WORDS["profile.tab.posts"], replies: UI_WORDS["profile.tab.replies"], likes: UI_WORDS["profile.tab.likes"] };

/** The profile's panel, which its tabs control. */
const PANEL = "profile-panel";

/**
 * A count under the profile (section 8.4): the number in body-strong and its word, a link to the list where there is
 * one (signed in). With "Hide like, repost and follower counts" on, a link reads its word alone, "Followers" or
 * "Following" (decision 15), and a count without a link is not shown.
 */
function Stat({ value, label, hidden, href }: { value: number; label: string; hidden?: string; href?: Href }) {
  const { hideCounts } = useAppearance();
  if (hideCounts && hidden !== undefined && !href) return null;
  const inner =
    hideCounts && hidden !== undefined ? (
      <Text tone="medium">{hidden}</Text>
    ) : (
      <Text tone="low">
        <Text variant="body-strong">{String(value)}</Text> {label}
      </Text>
    );
  return href ? (
    <Link href={href} asChild>
      <Pressable className={cn("min-h-[44px] justify-center rounded-control web:hover:underline", FOCUS_RING)}>{inner}</Pressable>
    </Link>
  ) : (
    <View className="min-h-[44px] justify-center">{inner}</View>
  );
}

/** "Follows you": a neutral chip, no status colour (section 8.4). */
function FollowsYou() {
  return (
    <View className="self-start rounded-full border border-line-low bg-surface-2 px-2.5 py-0.5">
      <Text variant="chip" tone="medium">
        {UI_WORDS["profile.followsYou"]}
      </Text>
    </View>
  );
}

/** While the profile loads: the header's shapes and three posts' (section 8.4). */
function ProfileSkeleton() {
  return (
    <View>
      <View className="gap-3 px-4 pb-4 pt-6">
        <Skeleton.Circle size={64} />
        <Skeleton.Text width="45%" variant="post" />
        <Skeleton.Text width="30%" />
        <Skeleton.Text width="80%" />
      </View>
      <Skeleton.List kind="posts" count={3} />
    </View>
  );
}

/**
 * A profile (UI design, section 8.4): the header with the monogram, the display name as the screen's one h1 (decision
 * 16: the tab's title names the kind of screen only), the verified chip, the handle in the mono face, the bio, the
 * counts as links and "Follows you"; Follow and the More menu (Mute, Block, Report) for anyone but the owner, whose
 * place holds the way to their settings; then Posts and Replies, and Likes on the reader's own profile.
 */
export default function ProfileScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { state } = useSession();
  const title = usePageTitle("title.profile");
  const wide = useLayout() !== "phone";
  const me = state.status === "signed-in" && state.me.user.onboarded ? state.me : null;
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("posts");
  // The block question's sheet, mounted while it is open or closing, as the kit's sheets are.
  const [blocking, setBlocking] = useState({ mounted: false, open: false });
  const [actionError, setActionError] = useState<string | null>(null);
  // 3e (design, section 9.4): a follow refused account_suspended shows the refusal's sentence from /me, read again after it.
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // UI Task 3: the profile is read once the session is known, since what it holds depends on the reader; read while
    // the session loads, it was read twice, and its posts with it (UI design, section 11.3: three requests at most).
    if (state.status === "loading") return;
    let cancelled = false;
    setProfile(null);
    setError(null);
    setTab("posts");
    social
      .profile(handle)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [handle, state.status]);

  const fetchPosts = useCallback((cursor?: string) => social.profilePosts(handle, cursor), [handle]);
  const fetchReplies = useCallback((cursor?: string) => social.profileReplies(handle, cursor), [handle]);
  const fetchLikes = useCallback((cursor?: string) => social.myLikes(cursor), []);

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    setRefused(false);
    try {
      await action();
    } catch (err) {
      if (isSuspendedRefusal(err)) setRefused(true);
      else setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <AppShell>
        {title}
        <HeaderSpace />
        <View className="gap-2 px-4 py-6">
          <Text as="h1" variant="display-2">
            {UI_WORDS["profile.missing"]}
          </Text>
          <Text tone="medium">{error}</Text>
        </View>
      </AppShell>
    );
  }
  if (!profile) {
    return (
      <AppShell>
        {title}
        <HeaderSpace />
        <ProfileSkeleton />
      </AppShell>
    );
  }

  const own = me !== null && profile.id === me.user.id;
  const viewer = profile.viewer;
  const tabs: Tab[] = own ? ["posts", "replies", "likes"] : ["posts", "replies"];
  const mute = () =>
    void act(async () => {
      const { muted } = await social.setMute(profile.handle, !viewer!.muted);
      setProfile((current) => (current ? { ...current, viewer: { ...current.viewer!, muted } } : current));
    });
  // Unblocking needs no question; blocking asks first, in a sheet, with its words as they were.
  const block = () => {
    if (viewer?.blocked) {
      void act(async () => {
        const { blocked } = await social.setBlock(profile.handle, false);
        setProfile((current) => (current ? { ...current, viewer: { ...current.viewer!, blocked } } : current));
      });
      return;
    }
    setBlocking({ mounted: true, open: true });
  };

  const header = (
    <View>
      <View {...dataAttribute("profile-header")} className="gap-3 px-4 pb-2 pt-6">
        <Avatar account={profile} size={wide ? 96 : 64} />
        <View className="gap-0.5">
          <View className="flex-row flex-wrap items-center gap-x-2">
            {/* The display name is the screen's h1; it wraps rather than pushing the page sideways. */}
            <Text as="h1" variant={wide ? "display-1" : "display-2"} className="shrink web:break-words">
              {profile.displayName}
            </Text>
            {profile.verified ? <VerifiedChip /> : null}
          </View>
          <Text variant="mono" tone="low" style={{ fontWeight: "700" }}>
            @{profile.handle}
          </Text>
        </View>
        {profile.bio ? <Text variant="post">{profile.bio}</Text> : null}
        <View className="flex-row flex-wrap items-center gap-x-4">
          <Stat value={profile.counts.posts} label={UI_WORDS["profile.posts"]} />
          <Stat value={profile.counts.followers} label={UI_WORDS["profile.followers"]} hidden={UI_WORDS["profile.followers.hidden"]} href={me ? `/u/${profile.handle}/followers` : undefined} />
          <Stat value={profile.counts.following} label={UI_WORDS["profile.following"]} hidden={UI_WORDS["profile.following.hidden"]} href={me ? `/u/${profile.handle}/following` : undefined} />
        </View>
        {viewer?.followedBy ? <FollowsYou /> : null}
        <View className="flex-row flex-wrap items-center gap-2">
          {me && !own && viewer ? (
            <FollowButton
              handle={profile.handle}
              initial={viewer.following}
              onChange={(following, followerCount) =>
                setProfile((current) => (current ? { ...current, counts: { ...current.counts, followers: followerCount }, viewer: { ...current.viewer!, following } } : current))
              }
            />
          ) : null}
          {own ? (
            <View className="-mt-6">
              {/* UI Task 8: the Settings index, as the nav's Settings item opens it. */}
              <Button label={UI_WORDS["profile.settings"]} onPress={() => router.push("/settings")} tone="secondary" full={false} />
            </View>
          ) : (
            <ProfileMenu profile={profile} onMute={mute} onBlock={block} />
          )}
        </View>
        {!me ? (
          <Text variant="meta" tone="low">
            {UI_WORDS["profile.signIn"]}
          </Text>
        ) : null}
        <ErrorText message={actionError} />
        {refused ? <RefusedNotice standing={me?.standing ?? null} /> : null}
      </View>
      <View className="border-b border-line-low px-3">
        <Tabs label={UI_WORDS["profile.tabs"]} tabs={tabs.map((key) => ({ key, label: TAB_LABELS[key] }))} selected={tab} onSelect={setTab} panelId={PANEL} />
      </View>
    </View>
  );

  // The phone's compose button shows on a profile (section 7.2).
  return (
    <AppShell compose>
      {title}
      <TabPanel panelId={PANEL} selected={tab}>
        {tab === "posts" ? (
          <TimelineList key="posts" fetchPage={fetchPosts} empty={UI_WORDS["profile.empty.posts"]} header={header} />
        ) : tab === "replies" ? (
          <PostList key="replies" fetchPage={fetchReplies} empty={UI_WORDS["profile.empty.replies"]} header={header} />
        ) : (
          <PostList key="likes" fetchPage={fetchLikes} empty={UI_WORDS["profile.empty.likes"]} header={header} />
        )}
      </TabPanel>
      {blocking.mounted ? (
        <Sheet
          open={blocking.open}
          onClose={() => setBlocking({ mounted: true, open: false })}
          onClosed={() => setBlocking({ mounted: false, open: false })}
          title={fill(UI_WORDS["profile.blockQuestion"], { handle: profile.handle })}
          description={UI_WORDS["profile.blockBody"]}
        >
          <View className="flex-row flex-wrap gap-x-2">
            <Button
              label={UI_WORDS["profile.block"]}
              tone="danger"
              full={false}
              busy={busy}
              onPress={() =>
                void act(async () => {
                  await social.setBlock(profile.handle, true);
                  router.replace("/settings/privacy");
                })
              }
            />
            <Button label={UI_WORDS["profile.cancel"]} tone="secondary" full={false} onPress={() => setBlocking({ mounted: true, open: false })} />
          </View>
        </Sheet>
      ) : null}
    </AppShell>
  );
}

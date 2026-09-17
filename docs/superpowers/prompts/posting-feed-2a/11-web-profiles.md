# korbat 2a — Task 11 of 13: Web: profile page with follow, mute and block, and the follower and following lists

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-17 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

The profile page with Posts and Replies tabs and a private Likes tab on your own, follow, mute and block actions with a confirmation that states plainly that public posts stay readable to anyone signed out, and the follower and following lists for signed-in viewers.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This sub-project adds no dependencies; do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(app): composer with the server's length rule, compose sheet on phones, thread page with ancestors and replies, quote action`.
3. The previous task's last API unit run ended with `Tests  106 passed | 96 skipped (202)`.

## Rules (read twice)

1. Copy every file below byte for byte. Each block is the complete file: create it, or replace the existing file entirely. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the files

### Create `apps/app/src/components/social/ProfileList.tsx`

```tsx
import { useState, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import type { ProfileListItem } from "@korbat/contracts";
import { errorMessage } from "@/lib/api";
import { social, type Page } from "@/lib/social";
import { PagedList } from "./PagedList";

export function ProfileRow({ item, action }: { item: ProfileListItem; action?: ReactElement }) {
  return (
    <View className="flex-row items-center border-b border-zinc-800 px-4 py-3">
      <Pressable accessibilityRole="link" onPress={() => router.push(`/u/${item.handle}`)} className="flex-1 pr-3">
        <Text className="text-base font-semibold text-zinc-50">
          {item.displayName}
          {item.verified ? <Text className="text-sky-400"> ✓</Text> : null}
        </Text>
        <Text className="text-sm text-zinc-500">@{item.handle}</Text>
        {item.bio ? (
          <Text className="mt-1 text-sm text-zinc-300" numberOfLines={2}>
            {item.bio}
          </Text>
        ) : null}
      </Pressable>
      {action}
    </View>
  );
}

/** Follow or unfollow one account; the label follows the server's answer. */
export function FollowButton({ handle, initial, onChange }: { handle: string; initial: boolean; onChange?: (following: boolean, followerCount: number) => void }) {
  const [following, setFollowing] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const result = await social.setFollow(handle, !following);
      setFollowing(result.following);
      onChange?.(result.following, result.followerCount);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="items-end">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: following, busy }}
        disabled={busy}
        onPress={() => void toggle()}
        className={`rounded-full px-4 py-1.5 ${following ? "border border-zinc-600" : "bg-zinc-50"}`}
      >
        <Text className={`text-sm font-semibold ${following ? "text-zinc-200" : "text-zinc-950"}`}>{following ? "Following" : "Follow"}</Text>
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" className="mt-1 text-xs text-red-400">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function ProfileList({
  fetchPage,
  empty,
  header,
  action,
}: {
  fetchPage: (cursor?: string) => Promise<Page<ProfileListItem>>;
  empty: string;
  header?: ReactElement;
  action?: (item: ProfileListItem, remove: () => void) => ReactElement | undefined;
}) {
  return (
    <PagedList
      fetchPage={fetchPage}
      keyOf={(item) => item.id}
      empty={empty}
      header={header}
      render={(item, remove) => <ProfileRow item={item} action={action?.(item, () => remove(item.id))} />}
    />
  );
}
```

### Create `apps/app/src/app/u/[handle]/index.tsx`

```tsx
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { ProfileView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { PostList, TimelineList } from "@/components/social/PagedList";
import { FollowButton } from "@/components/social/ProfileList";
import { Button, Loading } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";

type Tab = "posts" | "replies" | "likes";

function Stat({ label, value, onPress }: { label: string; value: number; onPress?: () => void }) {
  const inner = (
    <Text className="text-sm text-zinc-400">
      <Text className="font-semibold text-zinc-50">{value}</Text> {label}
    </Text>
  );
  return onPress ? (
    <Pressable accessibilityRole="link" onPress={onPress} className="mr-4">
      {inner}
    </Pressable>
  ) : (
    <View className="mr-4">{inner}</View>
  );
}

/** A profile: header with counts and actions, then Posts and Replies tabs, plus a private Likes tab on your own. */
export default function ProfileScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { state } = useSession();
  const me = state.status === "signed-in" && state.me.user.onboarded ? state.me : null;
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("posts");
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
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
    try {
      await action();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <AppShell>
        <View className="px-4 py-10">
          <Text accessibilityRole="header" className="text-xl font-bold text-zinc-50">
            This account is not available
          </Text>
          <Text className="mt-2 text-base text-zinc-400">{error}</Text>
        </View>
      </AppShell>
    );
  }
  if (!profile) {
    return (
      <AppShell>
        <Loading />
      </AppShell>
    );
  }

  const own = me !== null && profile.id === me.user.id;
  const viewer = profile.viewer;
  const tabs: Tab[] = own ? ["posts", "replies", "likes"] : ["posts", "replies"];

  const header = (
    <View className="border-b border-zinc-800 px-4 pt-4">
      <Text accessibilityRole="header" className="text-2xl font-bold text-zinc-50">
        {profile.displayName}
        {profile.verified ? <Text className="text-sky-400"> ✓</Text> : null}
      </Text>
      <Text className="text-base text-zinc-500">@{profile.handle}</Text>
      {profile.bio ? <Text className="mt-2 text-base leading-6 text-zinc-200">{profile.bio}</Text> : null}
      <View className="mt-3 flex-row">
        <Stat label="posts" value={profile.counts.posts} />
        <Stat label="followers" value={profile.counts.followers} onPress={me ? () => router.push(`/u/${profile.handle}/followers`) : undefined} />
        <Stat label="following" value={profile.counts.following} onPress={me ? () => router.push(`/u/${profile.handle}/following`) : undefined} />
      </View>
      {viewer?.followedBy ? <Text className="mt-1 text-xs text-zinc-500">Follows you</Text> : null}

      {me && !own && viewer ? (
        <View className="mt-3 flex-row flex-wrap items-center gap-2">
          <FollowButton
            handle={profile.handle}
            initial={viewer.following}
            onChange={(following, followerCount) => setProfile({ ...profile, counts: { ...profile.counts, followers: followerCount }, viewer: { ...viewer, following } })}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void act(async () => setProfile({ ...profile, viewer: { ...viewer, muted: (await social.setMute(profile.handle, !viewer.muted)).muted } }))}
            className="rounded-full border border-zinc-600 px-4 py-1.5"
          >
            <Text className="text-sm text-zinc-200">{viewer.muted ? "Unmute" : "Mute"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => setConfirmBlock(true)} className="rounded-full border border-red-900 px-4 py-1.5">
            <Text className="text-sm text-red-300">Block</Text>
          </Pressable>
        </View>
      ) : null}
      {own ? <Button label="Security and privacy settings" onPress={() => router.push("/settings/security")} tone="secondary" /> : null}
      {!me ? <Text className="mt-3 text-xs text-zinc-500">Sign in to follow this account.</Text> : null}
      {actionError ? (
        <Text accessibilityRole="alert" className="mt-2 text-sm text-red-400">
          {actionError}
        </Text>
      ) : null}

      {confirmBlock ? (
        <View accessibilityRole="alert" className="mt-3 rounded-lg border border-red-900 bg-zinc-900 p-4">
          <Text className="text-base font-semibold text-zinc-50">Block @{profile.handle}?</Text>
          <Text className="mt-1 text-sm text-zinc-300">
            Neither of you will see the other's posts or profile while signed in, and you will unfollow each other. Posts on korbat are public, so a block does not hide them from
            someone who signs out. You can undo this in your privacy settings.
          </Text>
          <View className="mt-3 flex-row gap-2">
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() =>
                void act(async () => {
                  await social.setBlock(profile.handle, true);
                  router.replace("/settings/privacy");
                })
              }
              className="rounded-lg bg-red-600 px-4 py-2"
            >
              <Text className="text-sm font-semibold text-zinc-50">Block</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setConfirmBlock(false)} className="rounded-lg border border-zinc-700 px-4 py-2">
              <Text className="text-sm text-zinc-200">Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View className="mt-4 flex-row">
        {tabs.map((t) => (
          <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} onPress={() => setTab(t)} className={`mr-6 border-b-2 pb-2 ${tab === t ? "border-zinc-50" : "border-transparent"}`}>
            <Text className={`text-base ${tab === t ? "font-semibold text-zinc-50" : "text-zinc-400"}`}>{t === "posts" ? "Posts" : t === "replies" ? "Replies" : "Likes"}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <AppShell>
      {tab === "posts" ? (
        <TimelineList key="posts" fetchPage={fetchPosts} empty="No posts yet." header={header} />
      ) : tab === "replies" ? (
        <PostList key="replies" fetchPage={fetchReplies} empty="No replies yet." header={header} />
      ) : (
        <PostList key="likes" fetchPage={fetchLikes} empty="You have not liked anything yet. Only you can see this tab." header={header} />
      )}
    </AppShell>
  );
}
```

### Create `apps/app/src/app/u/[handle]/followers.tsx`

```tsx
import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { FollowButton, ProfileList } from "@/components/social/ProfileList";
import { Loading } from "@/components/ui";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";

/** Who follows an account. Signed-in viewers only, so scraping needs an account we can limit. */
export default function Followers() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { state } = useSession();
  const fetchPage = useCallback((cursor?: string) => social.followers(handle, cursor), [handle]);

  if (state.status === "loading") return <Loading />;
  if (state.status === "signed-out") return <Redirect href="/signin" />;
  const myId = state.me.user.id;

  return (
    <AppShell>
      <ProfileList
        fetchPage={fetchPage}
        empty="No followers yet."
        header={
          <View className="border-b border-zinc-800 px-4 py-4">
            <Pressable accessibilityRole="link" onPress={() => router.push(`/u/${handle}`)}>
              <Text className="text-sm text-zinc-400 underline">@{handle}</Text>
            </Pressable>
            <Text accessibilityRole="header" className="mt-1 text-xl font-bold text-zinc-50">
              Followers
            </Text>
          </View>
        }
        action={(item) => (item.id === myId ? undefined : <FollowButton handle={item.handle} initial={item.viewerFollows ?? false} />)}
      />
    </AppShell>
  );
}
```

### Create `apps/app/src/app/u/[handle]/following.tsx`

```tsx
import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
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
            <Pressable accessibilityRole="link" onPress={() => router.push(`/u/${handle}`)}>
              <Text className="text-sm text-zinc-400 underline">@{handle}</Text>
            </Pressable>
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
```

## Step 2: verify: typecheck

```bash
pnpm --filter @korbat/app typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`

Observed on the dry run:

```text
(no output)
```

## Step 3: verify: export

```bash
cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx expo export --platform web 2>&1 | tail -8
```

Expected output contains:

- `Exported`

Must not contain:

- `Error`
- `error:`

Allowed difference: The web export runs a full Metro bundle and can take a few minutes.

Observed on the dry run:

```text
Exported: dist
```

## Step 4: verify: api-unchanged

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  106 passed | 96 skipped (202)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  106 passed | 96 skipped (202)
```

## Step 5: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/app/src/app/u/[handle]/followers.tsx`
- `apps/app/src/app/u/[handle]/following.tsx`
- `apps/app/src/app/u/[handle]/index.tsx`
- `apps/app/src/components/social/ProfileList.tsx`

## Step 6: commit

```bash
git add -A
git commit -q -m "feat(app): profile page with Posts, Replies and private Likes tabs, follow, mute and block with an honest confirmation; follower and following lists" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(app): profile page with Posts, Replies and private Likes tabs, follow, mute and block with an honest confirmation; follower and following lists`.

## Report format (mandatory)

```text
TASK 11 REPORT
Files written: <count, expected 4>
Verify "typecheck": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "api-unchanged": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```

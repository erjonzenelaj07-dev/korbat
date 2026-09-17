# korbat 2a — Task 9 of 13: Web: social API client, post card, paged lists, app shell, home timelines, and sign-in moved to /signin

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-17 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

The web app gains the social API client, the post card with its actions, cursor-paged lists, the app shell from the design brief (navigation, timeline and context columns on wide screens, a bottom tab bar on phones), and the home timelines. The feed becomes the home page: the sign-in screen moves to `/signin` and every redirect that meant 'go sign in' or 'go home' is corrected.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This sub-project adds no dependencies; do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `test(social): HTTP tests for posting, timelines, profiles, engagement, blocks, mutes, tiers, deletion and cursors`.
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

### Create `apps/app/src/lib/social.ts`

```ts
import {
  BlockResponse,
  EngagementResponse,
  FollowResponse,
  MuteResponse,
  PostPage,
  PostView,
  ProfilePage,
  ProfileView,
  ThreadResponse,
  TimelinePage,
} from "@korbat/contracts";
import { api } from "./api";

export type EngagementKind = "like" | "repost" | "bookmark";
export type Page<T> = { items: T[]; nextCursor: string | null };

const query = (cursor?: string) => (cursor ? `?cursor=${encodeURIComponent(cursor)}` : "");
const handlePath = (handle: string) => `/api/profiles/${encodeURIComponent(handle.replace(/^@/, "").toLowerCase())}`;

/** Every social endpoint, typed by the shared contracts. Cookies and CSRF are handled by `api`. */
export const social = {
  createPost: (input: { body: string; replyToId?: string; quoteOfId?: string }) => api("/api/posts", { json: input, schema: PostView }),
  getPost: (id: string) => api(`/api/posts/${id}`, { schema: PostView }),
  deletePost: (id: string) => api(`/api/posts/${id}`, { method: "DELETE" }),
  thread: (id: string, cursor?: string) => api(`/api/posts/${id}/thread${query(cursor)}`, { schema: ThreadResponse }),
  engage: (id: string, kind: EngagementKind, on: boolean) => api(`/api/posts/${id}/${kind}`, { method: on ? "POST" : "DELETE", schema: EngagementResponse }),

  following: (cursor?: string) => api(`/api/timeline/following${query(cursor)}`, { schema: TimelinePage }),
  latest: (cursor?: string) => api(`/api/timeline/latest${query(cursor)}`, { schema: TimelinePage }),

  profile: (handle: string) => api(handlePath(handle), { schema: ProfileView }),
  profilePosts: (handle: string, cursor?: string) => api(`${handlePath(handle)}/posts${query(cursor)}`, { schema: TimelinePage }),
  profileReplies: (handle: string, cursor?: string) => api(`${handlePath(handle)}/replies${query(cursor)}`, { schema: PostPage }),
  followers: (handle: string, cursor?: string) => api(`${handlePath(handle)}/followers${query(cursor)}`, { schema: ProfilePage }),
  followingOf: (handle: string, cursor?: string) => api(`${handlePath(handle)}/following${query(cursor)}`, { schema: ProfilePage }),
  setFollow: (handle: string, on: boolean) => api(`${handlePath(handle)}/follow`, { method: on ? "POST" : "DELETE", schema: FollowResponse }),
  setBlock: (handle: string, on: boolean) => api(`${handlePath(handle)}/block`, { method: on ? "POST" : "DELETE", schema: BlockResponse }),
  setMute: (handle: string, on: boolean) => api(`${handlePath(handle)}/mute`, { method: on ? "POST" : "DELETE", schema: MuteResponse }),

  myLikes: (cursor?: string) => api(`/api/me/likes${query(cursor)}`, { schema: PostPage }),
  myBookmarks: (cursor?: string) => api(`/api/me/bookmarks${query(cursor)}`, { schema: PostPage }),
  myBlocks: (cursor?: string) => api(`/api/me/blocks${query(cursor)}`, { schema: ProfilePage }),
  myMutes: (cursor?: string) => api(`/api/me/mutes${query(cursor)}`, { schema: ProfilePage }),
};

/** "just now", "5m", "3h", "2d", or a date for anything older than a week. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d`;
  return new Date(iso).toLocaleDateString();
}
```

### Create `apps/app/src/components/social/RichText.tsx`

```tsx
import { Linking, Text } from "react-native";
import { router } from "expo-router";

/** Links and @handles become tappable; everything else is plain text. Bodies are never rendered as markup. */
const TOKEN = /(https?:\/\/[^\s<>"']+|(?<![A-Za-z0-9_])@[A-Za-z0-9_]{3,20})/g;

export function RichText({ body, className = "text-base leading-6 text-zinc-100" }: { body: string; className?: string }) {
  const parts = body.split(TOKEN);
  return (
    <Text className={className}>
      {parts.map((part, index) => {
        if (/^https?:\/\//.test(part)) {
          return (
            <Text key={index} accessibilityRole="link" className="text-sky-400 underline" onPress={() => void Linking.openURL(part)}>
              {part}
            </Text>
          );
        }
        if (/^@[A-Za-z0-9_]{3,20}$/.test(part)) {
          return (
            <Text key={index} accessibilityRole="link" className="text-sky-400" onPress={() => router.push(`/u/${part.slice(1).toLowerCase()}`)}>
              {part}
            </Text>
          );
        }
        return <Text key={index}>{part}</Text>;
      })}
    </Text>
  );
}
```

### Create `apps/app/src/components/social/PostCard.tsx`

```tsx
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import type { Author, PostView, QuotedPost, Tombstone } from "@korbat/contracts";
import { errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { social, timeAgo, type EngagementKind } from "@/lib/social";
import { RichText } from "./RichText";

function AuthorLine({ author, createdAt }: { author: Author; createdAt: string }) {
  return (
    <View className="flex-row flex-wrap items-baseline gap-x-2">
      <Pressable accessibilityRole="link" onPress={() => router.push(`/u/${author.handle}`)}>
        <Text className="text-base font-semibold text-zinc-50">
          {author.displayName}
          {author.verified ? <Text className="text-sky-400"> ✓</Text> : null}
        </Text>
      </Pressable>
      <Text className="text-sm text-zinc-500">
        @{author.handle} · {timeAgo(createdAt)}
      </Text>
    </View>
  );
}

function TombstoneBox({ tombstone }: { tombstone: Tombstone }) {
  return (
    <View className="mt-2 rounded-lg border border-zinc-800 px-3 py-2">
      <Text className="text-sm italic text-zinc-500">{tombstone.deleted ? "This post was deleted by its author." : "This post is unavailable."}</Text>
    </View>
  );
}

export function QuoteEmbed({ quote }: { quote: QuotedPost | Tombstone }) {
  if (!("author" in quote)) return <TombstoneBox tombstone={quote} />;
  return (
    <Pressable accessibilityRole="link" onPress={() => router.push(`/post/${quote.id}`)} className="mt-2 rounded-lg border border-zinc-800 px-3 py-2">
      <AuthorLine author={quote.author} createdAt={quote.createdAt} />
      <RichText body={quote.body} className="mt-1 text-sm leading-5 text-zinc-300" />
    </Pressable>
  );
}

function StateChip({ state }: { state: PostView["state"] }) {
  if (state === "visible") return null;
  const amber = state === "withheld";
  return (
    <View className={`self-start rounded-full px-2 py-0.5 ${amber ? "bg-amber-500/15" : "bg-red-500/15"}`}>
      <Text className={`text-xs font-medium ${amber ? "text-amber-300" : "text-red-300"}`}>{amber ? "Under review" : "Removed"}</Text>
    </View>
  );
}

function Action({ label, count, active, activeClass, onPress }: { label: string; count?: number; active?: boolean; activeClass?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} className="flex-row items-center gap-1 py-1 pr-4">
      <Text className={`text-sm ${active ? activeClass : "text-zinc-400"}`}>{label}</Text>
      {count !== undefined && count > 0 ? <Text className={`text-sm ${active ? activeClass : "text-zinc-400"}`}>{count}</Text> : null}
    </Pressable>
  );
}

/**
 * One post in any list. Actions update the card from the server's answer, so counts never drift
 * from the truth. A signed-out reader is sent to sign in on the first action.
 */
export function PostCard({ post: initial, repostedBy, onDeleted }: { post: PostView; repostedBy?: Author; onDeleted?: (id: string) => void }) {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me.user.id : null;
  const [post, setPost] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setPost(initial), [initial]);

  async function toggle(kind: EngagementKind) {
    if (!me) {
      router.push("/signin");
      return;
    }
    const current = post.viewer ?? { liked: false, reposted: false, bookmarked: false };
    const on = kind === "like" ? !current.liked : kind === "repost" ? !current.reposted : !current.bookmarked;
    try {
      const result = await social.engage(post.id, kind, on);
      setPost({ ...post, counts: result.counts, viewer: result.viewer });
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove() {
    try {
      await social.deletePost(post.id);
      onDeleted?.(post.id);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <View className="border-b border-zinc-800 px-4 py-3">
      {repostedBy ? <Text className="mb-1 text-xs text-zinc-500">↻ {repostedBy.displayName} reposted</Text> : null}
      <AuthorLine author={post.author} createdAt={post.createdAt} />
      {post.author.id === me ? <StateChip state={post.state} /> : null}
      {post.replyTo ? (
        <Text className="text-xs text-zinc-500">
          Replying to <Text className="text-sky-400" onPress={() => router.push(`/u/${post.replyTo!.authorHandle}`)}>@{post.replyTo.authorHandle}</Text>
        </Text>
      ) : null}
      <Pressable accessibilityRole="link" onPress={() => router.push(`/post/${post.id}`)} className="mt-1">
        <RichText body={post.body} />
      </Pressable>
      {post.quoteOf ? <QuoteEmbed quote={post.quoteOf} /> : null}
      <View className="mt-2 flex-row flex-wrap items-center">
        <Action label="Reply" count={post.counts.replies} onPress={() => router.push(`/post/${post.id}`)} />
        <Action label="Repost" count={post.counts.reposts} active={post.viewer?.reposted} activeClass="text-emerald-400" onPress={() => void toggle("repost")} />
        <Action label="Like" count={post.counts.likes} active={post.viewer?.liked} activeClass="text-rose-400" onPress={() => void toggle("like")} />
        <Action label={post.viewer?.bookmarked ? "Saved" : "Save"} active={post.viewer?.bookmarked} activeClass="text-sky-400" onPress={() => void toggle("bookmark")} />
        {post.author.id === me ? <Action label="Delete" onPress={() => void remove()} /> : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" className="mt-1 text-xs text-red-400">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
```

### Create `apps/app/src/components/social/PagedList.tsx`

```tsx
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import type { PostView, TimelineItem } from "@korbat/contracts";
import { errorMessage } from "@/lib/api";
import type { Page } from "@/lib/social";
import { PostCard } from "./PostCard";

interface PagedListProps<T> {
  /** Must be stable (useCallback) or the list reloads on every render. */
  fetchPage: (cursor?: string) => Promise<Page<T>>;
  keyOf: (item: T) => string;
  render: (item: T, remove: (key: string) => void) => ReactElement;
  empty: string;
  header?: ReactElement;
}

/** Cursor pagination with a load-more control, pull to refresh, and the same error text as the rest of the app. */
export function PagedList<T>({ fetchPage, keyOf, render, empty, header }: PagedListProps<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (after?: string) => {
      try {
        const page = await fetchPage(after);
        setItems((current) => (after ? [...current, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setError(null);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [fetchPage],
  );

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const remove = (key: string) => setItems((current) => current.filter((item) => keyOf(item) !== key));

  return (
    <FlatList
      data={items}
      keyExtractor={keyOf}
      renderItem={({ item }) => render(item, remove)}
      ListHeaderComponent={header}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
      ListEmptyComponent={loading ? null : <Text className="px-4 py-10 text-center text-base text-zinc-500">{error ?? empty}</Text>}
      ListFooterComponent={
        <View className="items-center py-4">
          {error && items.length > 0 ? (
            <Text accessibilityRole="alert" className="mb-2 text-sm text-red-400">
              {error}
            </Text>
          ) : null}
          {cursor ? (
            <Pressable accessibilityRole="button" onPress={() => void load(cursor)} className="rounded-lg border border-zinc-700 px-4 py-2">
              <Text className="text-sm text-zinc-200">Load more</Text>
            </Pressable>
          ) : null}
        </View>
      }
    />
  );
}

const timelineKey = (item: TimelineItem) => (item.kind === "repost" ? `${item.post.id}:${item.repostedBy.id}` : item.post.id);

export function TimelineList({ fetchPage, empty, header }: { fetchPage: (cursor?: string) => Promise<Page<TimelineItem>>; empty: string; header?: ReactElement }) {
  return (
    <PagedList
      fetchPage={fetchPage}
      keyOf={timelineKey}
      empty={empty}
      header={header}
      render={(item, remove) => (
        <PostCard post={item.post} repostedBy={item.kind === "repost" ? item.repostedBy : undefined} onDeleted={() => remove(timelineKey(item))} />
      )}
    />
  );
}

export function PostList({ fetchPage, empty, header }: { fetchPage: (cursor?: string) => Promise<Page<PostView>>; empty: string; header?: ReactElement }) {
  return <PagedList fetchPage={fetchPage} keyOf={(post) => post.id} empty={empty} header={header} render={(post, remove) => <PostCard post={post} onDeleted={remove} />} />;
}
```

### Create `apps/app/src/components/AppShell.tsx`

```tsx
import type { ReactNode } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { router, usePathname } from "expo-router";
import { useSession } from "@/lib/session";
import { HandleBox } from "./HandleBox";

interface NavItem {
  label: string;
  href: string;
}

const WIDE = 1024;
const MEDIUM = 768;

/**
 * The layout from the design brief: navigation, timeline and context columns on wide screens, the
 * context column dropped on tablets, and a single column with a bottom tab bar on phones. Screens
 * render their own scrolling content inside it.
 */
export function AppShell({ children, floating }: { children: ReactNode; floating?: ReactNode }) {
  const { width } = useWindowDimensions();
  const { state } = useSession();
  const pathname = usePathname();
  const signedIn = state.status === "signed-in";
  const handle = signedIn ? state.me.profile?.handle : undefined;

  const items: NavItem[] = signedIn
    ? [
        { label: "Home", href: "/" },
        { label: "Bookmarks", href: "/bookmarks" },
        { label: "Profile", href: handle ? `/u/${handle}` : "/handle" },
        { label: "Settings", href: "/settings/security" },
      ]
    : [
        { label: "Home", href: "/" },
        { label: "Sign in", href: "/signin" },
      ];
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  if (width >= MEDIUM) {
    return (
      <View className="flex-1 flex-row justify-center bg-zinc-950">
        <View className="w-56 border-r border-zinc-800 px-4 py-6">
          <Text className="mb-6 text-2xl font-bold tracking-tight text-zinc-50">korbat</Text>
          {items.map((item) => (
            <Pressable key={item.href} accessibilityRole="link" accessibilityState={{ selected: active(item.href) }} onPress={() => router.push(item.href)} className="rounded-lg px-3 py-2">
              <Text className={`text-base ${active(item.href) ? "font-semibold text-zinc-50" : "text-zinc-300"}`}>{item.label}</Text>
            </Pressable>
          ))}
          {floating ? <View className="mt-6">{floating}</View> : null}
        </View>
        <View className="w-full max-w-2xl border-r border-zinc-800">{children}</View>
        {width >= WIDE ? (
          <View className="w-72 px-4 py-6">
            <HandleBox />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-zinc-950">
      <View className="flex-1">{children}</View>
      {floating ? <View className="absolute bottom-16 right-4">{floating}</View> : null}
      <View className="flex-row border-t border-zinc-800 bg-zinc-950">
        {items.map((item) => (
          <Pressable key={item.href} accessibilityRole="link" accessibilityState={{ selected: active(item.href) }} onPress={() => router.push(item.href)} className="flex-1 items-center py-3">
            <Text className={`text-sm ${active(item.href) ? "font-semibold text-zinc-50" : "text-zinc-400"}`}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
```

### Create `apps/app/src/components/HandleBox.tsx`

```tsx
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { router } from "expo-router";

/** Opens a profile by handle. The only discovery tool until explore (2c) arrives. */
export function HandleBox() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function go() {
    const handle = value.trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(handle)) {
      setError("Handles are 3 to 20 letters, numbers or underscores.");
      return;
    }
    setError(null);
    setValue("");
    router.push(`/u/${handle}`);
  }

  return (
    <View>
      <Text className="text-sm font-medium text-zinc-300">Go to a profile</Text>
      <View className="mt-2 flex-row gap-2">
        <TextInput
          accessibilityLabel="Handle"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="@handle"
          placeholderTextColor="#71717a"
          returnKeyType="go"
          value={value}
          onChangeText={setValue}
          onSubmitEditing={go}
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-base text-zinc-50"
        />
        <Pressable accessibilityRole="button" onPress={go} className="justify-center rounded-lg bg-zinc-50 px-3">
          <Text className="text-sm font-semibold text-zinc-950">Open</Text>
        </Pressable>
      </View>
      {error ? (
        <Text accessibilityRole="alert" className="mt-2 text-xs text-red-400">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
```

### Create `apps/app/src/app/index.tsx`

```tsx
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
```

### Create `apps/app/src/app/(auth)/signin.tsx`

```tsx
import { useRef, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { FlowResponse } from "@korbat/contracts";
import { Body, Button, ErrorText, Field, Screen, TextLink, Title } from "@/components/ui";
import { api, deviceId, errorMessage, platform } from "@/lib/api";
import { flow } from "@/lib/flow";

const SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/** The single entry point: one email field for both sign-up and sign-in. */
export default function EmailEntry() {
  const turnstile = useRef<TurnstileInstance | null>(null);
  const [email, setEmail] = useState(flow.get().email ?? "");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const address = email.trim();
      const { flowId } = await api("/api/auth/email/start", {
        json: { email: address, turnstileToken: token, deviceId: deviceId(), platform },
        schema: FlowResponse,
      });
      flow.set({ email: address, flowId, mfaTicket: undefined });
      router.push("/code");
    } catch (err) {
      setError(errorMessage(err));
      turnstile.current?.reset();
      setToken(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>korbat</Title>
      <Body>Enter your email. We'll send a code that signs you in, or creates your account if you don't have one yet.</Body>
      <Field label="Email" autoComplete="email" autoCapitalize="none" inputMode="email" value={email} onChangeText={setEmail} onSubmitEditing={submit} />
      <View className="mt-6">
        <Turnstile
          ref={turnstile}
          siteKey={SITE_KEY}
          options={{ theme: "dark", refreshExpired: "manual" }}
          onSuccess={setToken}
          onExpire={() => {
            setToken(null);
            turnstile.current?.reset();
          }}
          onError={() => setError("We could not verify that you are human. Reload the page and try again.")}
        />
      </View>
      <ErrorText message={error} />
      <Button label="Continue" onPress={submit} busy={busy} disabled={!email.includes("@") || token === null} />
      <TextLink label="Sign in with a password instead" onPress={() => router.push("/password")} />
      <TextLink label="Read the terms" onPress={() => router.push("/terms")} />
      <TextLink label="Back to the latest posts" onPress={() => router.replace("/")} />
    </Screen>
  );
}
```

### Replace `apps/app/src/app/(auth)/_layout.tsx` (whole file)

```tsx
import { Redirect, Stack, usePathname } from "expo-router";
import { Loading } from "@/components/ui";
import { useSession } from "@/lib/session";

/**
 * Screens for people who are not fully signed in. A signed-in account that still needs a handle is
 * sent to /handle; a finished account goes to its feed.
 */
export default function AuthLayout() {
  const { state } = useSession();
  const pathname = usePathname();

  if (state.status === "loading") return <Loading />;
  if (state.status === "signed-in") {
    if (state.me.user.onboarded) return <Redirect href="/" />;
    if (pathname !== "/handle") return <Redirect href="/handle" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

### Replace `apps/app/src/app/(auth)/code.tsx` (whole file)

```tsx
import { useEffect, useState } from "react";
import { Redirect, router } from "expo-router";
import { EmailVerifyResponse } from "@korbat/contracts";
import { Body, Button, ErrorText, Field, Screen, TextLink, Title } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { flow } from "@/lib/flow";
import { useSession } from "@/lib/session";

const RESEND_AFTER_SECONDS = 60;

export default function CodeEntry() {
  const { refresh } = useSession();
  const { email, flowId } = flow.get();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(RESEND_AFTER_SECONDS);

  useEffect(() => {
    const timer = setInterval(() => setWait((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!flowId || !email) return <Redirect href="/signin" />;

  async function submit() {
    if (busy || !flowId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api("/api/auth/email/verify", { json: { flowId, code: code.trim() }, schema: EmailVerifyResponse });
      if (result.result === "signup_required") {
        router.replace("/age");
      } else if (result.result === "mfa_required") {
        flow.set({ mfaTicket: result.mfaTicket });
        router.replace("/mfa");
      } else {
        flow.clear();
        const session = await refresh();
        router.replace(session.status === "signed-in" && session.me.user.onboarded ? "/" : "/handle");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>Check your email</Title>
      <Body>We sent a 6-digit code to {email}. It expires in 10 minutes.</Body>
      <Field label="Code" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} onSubmitEditing={submit} />
      <ErrorText message={error} />
      <Button label="Continue" onPress={submit} busy={busy} disabled={!/^\d{6}$/.test(code.trim())} />
      {wait > 0 ? (
        <Body>You can ask for a new code in {wait} s.</Body>
      ) : (
        <TextLink label="Send a new code" onPress={() => router.replace("/signin")} />
      )}
      <TextLink label="Use a different email" onPress={() => { flow.clear(); router.replace("/signin"); }} />
    </Screen>
  );
}
```

### Replace `apps/app/src/app/(auth)/age.tsx` (whole file)

```tsx
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Redirect, router } from "expo-router";
import { SessionResult } from "@korbat/contracts";
import { Body, Button, ErrorText, Field, Screen, TextLink, Title } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { flow } from "@/lib/flow";
import { useSession } from "@/lib/session";
import { TERMS_VERSION } from "@/lib/terms";

const pad = (value: string, length: number) => value.trim().padStart(length, "0");

/** Date of birth (checked once, never stored) and acceptance of the current terms. */
export default function AgeAndTerms() {
  const { refresh } = useSession();
  const { flowId } = flow.get();
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);

  if (!flowId && !refused) return <Redirect href="/signin" />;

  const dateOfBirth = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
  const complete = /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) && year.trim().length === 4 && accepted;

  async function submit() {
    if (busy || !flowId) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/signup/complete", { json: { flowId, dateOfBirth, termsVersion: TERMS_VERSION }, schema: SessionResult });
      flow.clear();
      await refresh();
      router.replace("/handle");
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.code === "age_requirement") {
        flow.clear();
        setRefused(true);
      }
    } finally {
      setBusy(false);
    }
  }

  if (refused) {
    return (
      <Screen>
        <Title>Sorry</Title>
        <Body>You must be at least 16 to use korbat. No account was created.</Body>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Almost there</Title>
      <Body>Your date of birth is checked once and never stored.</Body>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Field label="Day" inputMode="numeric" maxLength={2} value={day} onChangeText={setDay} />
        </View>
        <View className="flex-1">
          <Field label="Month" inputMode="numeric" maxLength={2} value={month} onChangeText={setMonth} />
        </View>
        <View className="flex-[1.4]">
          <Field label="Year" inputMode="numeric" maxLength={4} value={year} onChangeText={setYear} />
        </View>
      </View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        onPress={() => setAccepted((a) => !a)}
        className="mt-6 flex-row items-center gap-3"
      >
        <View className={`h-5 w-5 items-center justify-center rounded border ${accepted ? "border-zinc-50 bg-zinc-50" : "border-zinc-600"}`}>
          {accepted ? <Text className="text-xs font-bold text-zinc-950">✓</Text> : null}
        </View>
        <Text className="flex-1 text-sm text-zinc-300">I accept the korbat terms ({TERMS_VERSION}).</Text>
      </Pressable>
      <TextLink label="Read the terms" onPress={() => router.push("/terms")} />
      <ErrorText message={error} />
      <Button label="Create account" onPress={submit} busy={busy} disabled={!complete} />
    </Screen>
  );
}
```

### Replace `apps/app/src/app/(auth)/handle.tsx` (whole file)

```tsx
import { useState } from "react";
import { Redirect, router } from "expo-router";
import { OnboardingHandleResponse } from "@korbat/contracts";
import { Body, Button, ErrorText, Field, Loading, Screen, Title } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

const HANDLE = /^[a-z0-9_]{3,20}$/;

export default function ChooseHandle() {
  const { state, refresh } = useSession();
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status === "loading") return <Loading />;
  if (state.status === "signed-out") return <Redirect href="/signin" />;

  const normalized = handle.trim().replace(/^@/, "").toLowerCase();
  const valid = HANDLE.test(normalized) && displayName.trim().length > 0;

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/onboarding/handle", { json: { handle: normalized, displayName: displayName.trim() }, schema: OnboardingHandleResponse });
      await refresh();
      router.replace("/");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>Choose your handle</Title>
      <Body>Your handle is how people find you: 3 to 20 lowercase letters, numbers or underscores. You can use a pseudonym.</Body>
      <Field label="Handle" autoCapitalize="none" autoComplete="username" placeholder="@yourname" value={handle} onChangeText={setHandle} />
      <Field label="Display name" maxLength={50} value={displayName} onChangeText={setDisplayName} onSubmitEditing={submit} />
      <ErrorText message={error} />
      <Button label="Finish" onPress={submit} busy={busy} disabled={!valid} />
    </Screen>
  );
}
```

### Replace `apps/app/src/app/(auth)/mfa.tsx` (whole file)

```tsx
import { useState } from "react";
import { Redirect, router } from "expo-router";
import { SessionResult } from "@korbat/contracts";
import { Body, Button, ErrorText, Field, Screen, TextLink, Title } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { flow } from "@/lib/flow";
import { useSession } from "@/lib/session";

/** The second factor at sign-in: an authenticator code, or one of the saved recovery codes. */
export default function MfaChallenge() {
  const { refresh } = useSession();
  const { mfaTicket } = flow.get();
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!mfaTicket) return <Redirect href="/signin" />;

  const valid = useRecovery ? /^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/i.test(value.trim()) : /^\d{6}$/.test(value.trim());

  async function submit() {
    if (busy || !mfaTicket) return;
    setBusy(true);
    setError(null);
    try {
      const second = useRecovery ? { recoveryCode: value.trim().toLowerCase() } : { code: value.trim() };
      const result = await api("/api/auth/mfa/verify", { json: { mfaTicket, ...second }, schema: SessionResult });
      flow.clear();
      const session = await refresh();
      if (session.status === "signed-in" && !session.me.user.onboarded) router.replace("/handle");
      else router.replace(result.mustReenrollMfa ? "/settings/security?reenroll=1" : "/");
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.code === "too_many_attempts") {
        flow.set({ mfaTicket: undefined });
        router.replace("/signin");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>Two-factor authentication</Title>
      {useRecovery ? (
        <Body>Enter one of your recovery codes. Each code works once; afterwards you'll be asked to set up two-factor again.</Body>
      ) : (
        <Body>Enter the 6-digit code from your authenticator app.</Body>
      )}
      <Field
        label={useRecovery ? "Recovery code" : "Authentication code"}
        autoCapitalize="none"
        autoComplete="one-time-code"
        inputMode={useRecovery ? "text" : "numeric"}
        maxLength={useRecovery ? 14 : 6}
        placeholder={useRecovery ? "abcd-efgh-ijkl" : undefined}
        value={value}
        onChangeText={setValue}
        onSubmitEditing={submit}
      />
      <ErrorText message={error} />
      <Button label="Verify" onPress={submit} busy={busy} disabled={!valid} />
      <TextLink
        label={useRecovery ? "Use my authenticator app" : "Use a recovery code"}
        onPress={() => {
          setUseRecovery((r) => !r);
          setValue("");
          setError(null);
        }}
      />
    </Screen>
  );
}
```

### Replace `apps/app/src/app/(auth)/password.tsx` (whole file)

```tsx
import { useRef, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { SignInResponse } from "@korbat/contracts";
import { Body, Button, ErrorText, Field, Screen, TextLink, Title } from "@/components/ui";
import { api, deviceId, errorMessage, platform } from "@/lib/api";
import { flow } from "@/lib/flow";
import { useSession } from "@/lib/session";

const SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? "";

export default function PasswordSignIn() {
  const { refresh } = useSession();
  const turnstile = useRef<TurnstileInstance | null>(null);
  const [email, setEmail] = useState(flow.get().email ?? "");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api("/api/auth/password/signin", {
        json: { email: email.trim(), password, turnstileToken: token, deviceId: deviceId(), platform },
        schema: SignInResponse,
      });
      setPassword("");
      if (result.result === "mfa_required") {
        flow.set({ email: email.trim(), mfaTicket: result.mfaTicket });
        router.replace("/mfa");
        return;
      }
      flow.clear();
      const session = await refresh();
      router.replace(session.status === "signed-in" && session.me.user.onboarded ? "/" : "/handle");
    } catch (err) {
      setError(errorMessage(err));
      turnstile.current?.reset();
      setToken(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>Sign in</Title>
      <Body>Use the password you set in your security settings.</Body>
      <Field label="Email" autoComplete="email" autoCapitalize="none" inputMode="email" value={email} onChangeText={setEmail} />
      <Field label="Password" autoComplete="current-password" secureTextEntry value={password} onChangeText={setPassword} onSubmitEditing={submit} />
      <View className="mt-6">
        <Turnstile
          ref={turnstile}
          siteKey={SITE_KEY}
          options={{ theme: "dark", refreshExpired: "manual" }}
          onSuccess={setToken}
          onExpire={() => {
            setToken(null);
            turnstile.current?.reset();
          }}
          onError={() => setError("We could not verify that you are human. Reload the page and try again.")}
        />
      </View>
      <ErrorText message={error} />
      <Button label="Sign in" onPress={submit} busy={busy} disabled={!email.includes("@") || password.length === 0 || token === null} />
      <TextLink label="Email me a code instead" onPress={() => router.replace("/signin")} />
    </Screen>
  );
}
```

### Replace `apps/app/src/app/not-me/[token].tsx` (whole file)

```tsx
import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Body, Button, ErrorText, Screen, TextLink, Title } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

/** Opened from the new-device email. Nothing happens until the person confirms. */
export default function NotMe() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const valid = typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);

  async function confirm() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/not-me", { json: { token } });
      setDone(true);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <Title>Your account is locked down</Title>
        <Body>Every session is signed out and your password is removed. Sign in again with a code sent to your email, then set a new password and turn on two-factor authentication.</Body>
        <Button label="Sign in" onPress={() => router.replace("/signin")} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>This wasn't me</Title>
      <Body>If you didn't just sign in to korbat on a new device, confirm below. We'll sign out every session, including this browser, and remove your password so only someone with your email can get back in.</Body>
      <ErrorText message={valid ? error : "This link is incomplete. Open it again from the email."} />
      <Button label="Sign out everywhere and remove my password" onPress={() => void confirm()} busy={busy} disabled={!valid} tone="danger" />
      <TextLink label="It was me, go back" onPress={() => router.replace("/")} />
    </Screen>
  );
}
```

### Replace `apps/app/src/app/settings/_layout.tsx` (whole file)

```tsx
import { Redirect, Stack } from "expo-router";
import { Loading } from "@/components/ui";
import { useSession } from "@/lib/session";

/** Settings need a finished account: signed out goes to sign-in, no handle yet goes to onboarding. */
export default function SettingsLayout() {
  const { state } = useSession();
  if (state.status === "loading") return <Loading />;
  if (state.status === "signed-out") return <Redirect href="/signin" />;
  if (!state.me.user.onboarded) return <Redirect href="/handle" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

## Step 2: delete `apps/app/src/app/(auth)/index.tsx`

```bash
git rm -q "apps/app/src/app/(auth)/index.tsx"
```

Expected: no output.

## Step 3: verify: typecheck

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

## Step 4: verify: export

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

## Step 5: verify: routes

```bash
echo "old sign-in index present: $(ls 'apps/app/src/app/(auth)/index.tsx' 2>/dev/null | wc -l)"; echo "sign-in screens pointing at the feed root: $(cat 'apps/app/src/app/(auth)/age.tsx' 'apps/app/src/app/(auth)/code.tsx' 'apps/app/src/app/(auth)/handle.tsx' 'apps/app/src/app/(auth)/mfa.tsx' 'apps/app/src/app/(auth)/password.tsx' 'apps/app/src/app/(auth)/signin.tsx' apps/app/src/app/settings/_layout.tsx | grep -c 'href="/"')"; echo "layout sends finished accounts home: $(grep -c 'href="/"' 'apps/app/src/app/(auth)/_layout.tsx')"
```

Expected output contains:

- `old sign-in index present: 0`
- `sign-in screens pointing at the feed root: 0`
- `layout sends finished accounts home: 1`

Observed on the dry run:

```text
old sign-in index present: 0
sign-in screens pointing at the feed root: 0
layout sends finished accounts home: 1
```

## Step 6: verify: api-unchanged

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

## Step 7: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/app/src/app/(auth)/_layout.tsx`
- `apps/app/src/app/(auth)/age.tsx`
- `apps/app/src/app/(auth)/code.tsx`
- `apps/app/src/app/(auth)/handle.tsx`
- `apps/app/src/app/(auth)/mfa.tsx`
- `apps/app/src/app/(auth)/password.tsx`
- `apps/app/src/app/(auth)/signin.tsx`
- `apps/app/src/app/index.tsx`
- `apps/app/src/app/not-me/[token].tsx`
- `apps/app/src/app/settings/_layout.tsx`
- `apps/app/src/components/AppShell.tsx`
- `apps/app/src/components/HandleBox.tsx`
- `apps/app/src/components/social/PagedList.tsx`
- `apps/app/src/components/social/PostCard.tsx`
- `apps/app/src/components/social/RichText.tsx`
- `apps/app/src/lib/social.ts`

## Step 8: commit

```bash
git add -A
git commit -q -m "feat(app): social API client, post card and paged lists, app shell with phone and desktop layouts, home timelines; sign-in moves to /signin" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(app): social API client, post card and paged lists, app shell with phone and desktop layouts, home timelines; sign-in moves to /signin`.

## Report format (mandatory)

```text
TASK 9 REPORT
Files written: <count, expected 16>
Verify "typecheck": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "routes": <paste the expected lines as printed>
Verify "api-unchanged": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```

# korbat 2a — Task 10 of 13: Web: composer, compose sheet, thread page, and quoting

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-17 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

The composer, using the same normalization and length rule the server applies so its counter is exact; the compose sheet that opens from the floating button on phones; the thread page with the ancestor chain (tombstones included), the post, a reply composer and paged replies; and quoting from any post card.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This sub-project adds no dependencies; do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(app): social API client, post card and paged lists, app shell with phone and desktop layouts, home timelines; sign-in moves to /signin`.
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

### Create `apps/app/src/components/social/Composer.tsx`

```tsx
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { POST_MAX_LENGTH, normalizePostBody, postLength, type PostView } from "@korbat/contracts";
import { errorMessage } from "@/lib/api";
import { social } from "@/lib/social";
import { QuoteEmbed } from "./PostCard";

interface ComposerProps {
  replyTo?: PostView;
  quoteOf?: PostView;
  onPosted?: (post: PostView) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}

/**
 * One composer for posts, replies and quotes. The counter uses the same normalization the server
 * applies, so what it allows is exactly what the API accepts.
 */
export function Composer({ replyTo, quoteOf, onPosted, onCancel, autoFocus }: ComposerProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const length = postLength(normalizePostBody(text));
  const ready = length >= 1 && length <= POST_MAX_LENGTH && !busy;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const post = await social.createPost({ body: text, ...(replyTo ? { replyToId: replyTo.id } : {}), ...(quoteOf ? { quoteOfId: quoteOf.id } : {}) });
      setText("");
      onPosted?.(post);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="px-4 py-3">
      {replyTo ? <Text className="mb-2 text-xs text-zinc-500">Replying to @{replyTo.author.handle}</Text> : null}
      <TextInput
        accessibilityLabel={replyTo ? "Your reply" : quoteOf ? "Your comment on the quoted post" : "What's on your mind?"}
        placeholder={replyTo ? "Write your reply" : quoteOf ? "Add your comment" : "What's on your mind?"}
        placeholderTextColor="#71717a"
        multiline
        autoFocus={autoFocus}
        value={text}
        onChangeText={setText}
        className="min-h-[88px] rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-base leading-6 text-zinc-50"
      />
      {quoteOf ? <QuoteEmbed quote={{ ...quoteOf, quoteOf: null }} /> : null}
      {error ? (
        <Text accessibilityRole="alert" className="mt-2 text-sm text-red-400">
          {error}
        </Text>
      ) : null}
      <View className="mt-2 flex-row items-center justify-end gap-3">
        <Text className={`text-xs ${length > POST_MAX_LENGTH ? "text-red-400" : "text-zinc-500"}`}>
          {length}/{POST_MAX_LENGTH}
        </Text>
        {onCancel ? (
          <Pressable accessibilityRole="button" onPress={onCancel} className="rounded-lg border border-zinc-700 px-4 py-2">
            <Text className="text-sm text-zinc-200">Cancel</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ready, busy }} disabled={!ready} onPress={() => void submit()} className={`rounded-lg px-4 py-2 ${ready ? "bg-zinc-50" : "bg-zinc-800"}`}>
          <Text className={`text-sm font-semibold ${ready ? "text-zinc-950" : "text-zinc-500"}`}>{busy ? "Posting…" : replyTo ? "Reply" : quoteOf ? "Quote" : "Post"}</Text>
        </Pressable>
      </View>
    </View>
  );
}
```

### Create `apps/app/src/components/social/ComposeSheet.tsx`

```tsx
import { Modal, Pressable, Text, View } from "react-native";
import type { PostView } from "@korbat/contracts";
import { Composer } from "./Composer";

interface ComposeSheetProps {
  open: boolean;
  onClose: () => void;
  onPosted: (post: PostView) => void;
  replyTo?: PostView;
  quoteOf?: PostView;
}

/** The composer as a sheet over the current screen, for narrow layouts and for quoting from a thread. */
export function ComposeSheet({ open, onClose, onPosted, replyTo, quoteOf }: ComposeSheetProps) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close the composer" onPress={onClose} className="flex-1 justify-end bg-black/60">
        <Pressable onPress={() => undefined} className="rounded-t-2xl border-t border-zinc-800 bg-zinc-950 pb-6 pt-2">
          <View className="mb-1 items-center">
            <View className="h-1 w-10 rounded-full bg-zinc-700" />
          </View>
          <Text accessibilityRole="header" className="px-4 text-base font-semibold text-zinc-50">
            {replyTo ? "Reply" : quoteOf ? "Quote" : "New post"}
          </Text>
          <Composer
            replyTo={replyTo}
            quoteOf={quoteOf}
            autoFocus
            onCancel={onClose}
            onPosted={(post) => {
              onPosted(post);
              onClose();
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** The floating action button that opens the sheet on phones. */
export function ComposeButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="New post" onPress={onPress} className="h-14 w-14 items-center justify-center rounded-full bg-zinc-50 shadow-lg">
      <Text className="text-3xl leading-8 text-zinc-950">+</Text>
    </Pressable>
  );
}
```

### Create `apps/app/src/app/post/[id].tsx`

```tsx
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { PostView, ThreadResponse, Tombstone } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { ComposeSheet } from "@/components/social/ComposeSheet";
import { Composer } from "@/components/social/Composer";
import { PostList } from "@/components/social/PagedList";
import { PostCard } from "@/components/social/PostCard";
import { Loading } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";

function AncestorRow({ item }: { item: PostView | Tombstone }) {
  if (!("author" in item)) {
    return (
      <View className="border-b border-zinc-800 px-4 py-3">
        <Text className="text-sm italic text-zinc-500">{item.deleted ? "This post was deleted by its author." : "This post is unavailable."}</Text>
      </View>
    );
  }
  return <PostCard post={item} />;
}

/** A post with the chain it replies to above it and its direct replies below, oldest first. */
export default function Thread() {
  const { id, quote } = useLocalSearchParams<{ id: string; quote?: string }>();
  const { state } = useSession();
  const signedIn = state.status === "signed-in" && state.me.user.onboarded;
  const [thread, setThread] = useState<ThreadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [quoting, setQuoting] = useState(quote === "1");

  useEffect(() => {
    let cancelled = false;
    setThread(null);
    setError(null);
    social
      .thread(id)
      .then((t) => {
        if (!cancelled) setThread(t);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id, version]);

  const fetchReplies = useCallback((cursor?: string) => social.thread(id, cursor).then((t) => t.replies), [id]);

  if (error) {
    return (
      <AppShell>
        <View className="px-4 py-10">
          <Text accessibilityRole="header" className="text-xl font-bold text-zinc-50">
            This post is not available
          </Text>
          <Text className="mt-2 text-base text-zinc-400">{error}</Text>
          <Pressable accessibilityRole="link" onPress={() => router.replace("/")} className="mt-6">
            <Text className="text-sm text-zinc-400 underline">Back to the timeline</Text>
          </Pressable>
        </View>
      </AppShell>
    );
  }
  if (!thread) {
    return (
      <AppShell>
        <Loading />
      </AppShell>
    );
  }

  const header = (
    <View>
      {thread.ancestors.map((item) => (
        <AncestorRow key={item.id} item={item} />
      ))}
      <View className="border-b-2 border-zinc-700">
        <PostCard post={thread.post} onDeleted={() => router.replace("/")} />
        {signedIn ? (
          <View className="flex-row justify-end px-4 pb-2">
            <Pressable accessibilityRole="button" onPress={() => setQuoting(true)}>
              <Text className="text-sm text-zinc-400 underline">Quote this post</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      {signedIn ? <Composer replyTo={thread.post} onPosted={() => setVersion((v) => v + 1)} /> : null}
    </View>
  );

  return (
    <AppShell>
      <PostList key={version} fetchPage={fetchReplies} empty="No replies yet." header={header} />
      <ComposeSheet open={quoting} quoteOf={thread.post} onClose={() => setQuoting(false)} onPosted={(post) => router.push(`/post/${post.id}`)} />
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/index.tsx` (whole file)

```tsx
import { useCallback, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { Redirect, router } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { ComposeButton, ComposeSheet } from "@/components/social/ComposeSheet";
import { Composer } from "@/components/social/Composer";
import { TimelineList } from "@/components/social/PagedList";
import { Button, Loading } from "@/components/ui";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";

type Tab = "following" | "latest";

/** Home: Following and Latest for a signed-in account, Latest with a sign-in prompt for everyone else. */
export default function Home() {
  const { state } = useSession();
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<Tab>("following");
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
  const current: Tab = signedIn ? tab : "latest";
  const inlineComposer = signedIn && width >= 768;
  const posted = () => setVersion((v) => v + 1);

  return (
    <AppShell floating={signedIn && !inlineComposer ? <ComposeButton onPress={() => setComposing(true)} /> : undefined}>
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
      {inlineComposer ? (
        <View className="border-b border-zinc-800">
          <Composer onPosted={posted} />
        </View>
      ) : null}
      <TimelineList
        key={`${current}:${version}`}
        fetchPage={current === "following" ? fetchFollowing : fetchLatest}
        empty={current === "following" ? "Nothing here yet. Follow someone, or switch to Latest." : "No posts yet."}
      />
      <ComposeSheet open={composing} onClose={() => setComposing(false)} onPosted={posted} />
    </AppShell>
  );
}
```

### Replace `apps/app/src/components/social/PostCard.tsx` (whole file)

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
        <Action label="Quote" count={post.counts.quotes} onPress={() => (me ? router.push(`/post/${post.id}?quote=1`) : router.push("/signin"))} />
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

- `apps/app/src/app/index.tsx`
- `apps/app/src/app/post/[id].tsx`
- `apps/app/src/components/social/ComposeSheet.tsx`
- `apps/app/src/components/social/Composer.tsx`
- `apps/app/src/components/social/PostCard.tsx`

## Step 6: commit

```bash
git add -A
git commit -q -m "feat(app): composer with the server's length rule, compose sheet on phones, thread page with ancestors and replies, quote action" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(app): composer with the server's length rule, compose sheet on phones, thread page with ancestors and replies, quote action`.

## Report format (mandatory)

```text
TASK 10 REPORT
Files written: <count, expected 5>
Verify "typecheck": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "api-unchanged": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```

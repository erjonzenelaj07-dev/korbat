# korbat screen-reader states — Task 1 of 1: Tabs, navigation, toggles, the terms checkbox and busy buttons expose their state to screen readers through aria props, and the web app's first test keeps accessibilityState out

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-21 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend. The web app is built with Expo, and react-native-web 0.21.2 turns its React Native props into HTML. That library drops React Native's `accessibilityState` prop entirely, so eleven controls written in sub-projects 1a and 2a never told a screen reader their state: which tab or page is current, whether Like or Repost is on, whether the terms box is ticked, whether a button is busy. This task gives each control the `aria-*` prop its role defines and wraps the three tab rows in a tab list. It also adds the web app's first test: it fails while any `accessibilityState=` is left in `apps/app/src`, and it server-renders react-native-web to prove that each state the app now uses reaches the HTML. The design is `docs/superpowers/specs/2026-09-21-screen-reader-states-design.md`.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. The `install` step runs with `--config.minimum-release-age=0` for that one command, and the `lockfile-age` step then proves that every newly locked version is at least 7 days old. `pnpm-lock.yaml` is written by the install, never by hand. Never edit `pnpm-workspace.yaml` or `.npmrc`, and never add a package this task does not name.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `docs: screen-reader states plan and verified execution prompt`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/screen-reader-states/write_blocks.py docs/superpowers/prompts/screen-reader-states/01-screen-reader-states.md 1
```

Expected: 4 lines starting with `wrote`, one for each file below.

### Create `apps/app/test/a11y.test.tsx`

```tsx
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Pressable, Text, View } from "react-native";
import { describe, expect, test } from "vitest";

/**
 * A screen reader learns a control's state from the HTML. react-native-web 0.21 drops React
 * Native's `accessibilityState` prop without a trace, so the app passes `aria-*` props instead. The
 * first test keeps the dropped prop out of the app; the others pin the library behaviour the app
 * relies on, so an upgrade that changes it fails here instead of silently in a screen reader.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");

const html = (element: ReactElement): string => renderToStaticMarkup(element);

describe("screen-reader states", () => {
  test("no component passes accessibilityState, which react-native-web drops", () => {
    const found: string[] = [];
    for (const file of readdirSync(SRC, { recursive: true, encoding: "utf8" })) {
      if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
      const lines = readFileSync(path.join(SRC, file), "utf8").split("\n");
      lines.forEach((line, index) => {
        if (/accessibilityState[ ]*=/.test(line)) found.push(`${file.split(path.sep).join("/")}:${index + 1}`);
      });
    }
    expect(found.sort()).toEqual([]);
  });

  test("a tab list and its selected tab", () => {
    const out = html(
      <View accessibilityRole="tablist">
        <Pressable accessibilityRole="tab" aria-selected />
      </View>,
    );
    expect(out).toContain('role="tablist"');
    expect(out).toContain('aria-selected="true"');
  });

  test("toggle buttons say whether they are pressed", () => {
    expect(html(<Pressable accessibilityRole="button" aria-pressed />)).toContain('aria-pressed="true"');
    expect(html(<Pressable accessibilityRole="button" aria-pressed={false} />)).toContain('aria-pressed="false"');
  });

  test("a pressable text is a native button that says whether it is pressed", () => {
    const out = html(
      <Text accessibilityRole="button" aria-pressed onPress={() => undefined}>
        Email code
      </Text>,
    );
    expect(out).toContain("<button");
    expect(out).toContain('aria-pressed="true"');
  });

  test("the link to the current page", () => {
    expect(html(<Pressable accessibilityRole="link" aria-current="page" />)).toContain('aria-current="page"');
  });

  test("a checkbox that is not ticked", () => {
    expect(html(<Pressable accessibilityRole="checkbox" aria-checked={false} />)).toContain('aria-checked="false"');
  });

  test("a busy button, which disabled also marks", () => {
    const out = html(<Pressable accessibilityRole="button" aria-busy disabled />);
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('aria-disabled="true"');
  });
});
```

### Create `apps/app/test/react-dom-server.d.ts`

```ts
/** react-dom ships no types and @types/react-dom is not installed; the tests use only this function. */
declare module "react-dom/server" {
  import type { ReactNode } from "react";
  export function renderToStaticMarkup(node: ReactNode): string;
}
```

### Create `apps/app/vitest.config.mts`

```text
import { defineConfig } from "vitest/config";

/**
 * The tests run in Node against react-native-web, which is what `react-native` means in the web
 * build, so they see the HTML a browser gets.
 */
export default defineConfig({
  resolve: { alias: [{ find: /^react-native$/, replacement: "react-native-web" }] },
  test: { environment: "node", include: ["test/**/*.test.tsx"] },
});
```

### Replace `apps/app/package.json` (whole file)

```json
{
  "name": "@korbat/app",
  "version": "0.0.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start",
    "web": "expo start --web",
    "export:web": "expo export --platform web",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@korbat/contracts": "workspace:*",
    "@marsidev/react-turnstile": "1.6.1",
    "expo": "57.0.22",
    "expo-constants": "57.0.18",
    "expo-image": "57.0.5",
    "expo-linking": "57.0.10",
    "expo-router": "57.0.21",
    "expo-status-bar": "57.0.1",
    "nativewind": "4.2.6",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "react-native": "0.86.3",
    "react-native-gesture-handler": "2.32.0",
    "react-native-reanimated": "4.5.1",
    "react-native-safe-area-context": "5.7.0",
    "react-native-screens": "4.26.2",
    "react-native-web": "0.21.2",
    "react-native-worklets": "0.10.1",
    "zod": "4.5.4"
  },
  "devDependencies": {
    "@types/react": "19.2.18",
    "tailwindcss": "3.4.19",
    "typescript": "5.9.3",
    "vitest": "4.1.11"
  }
}
```

## Step 2: run the tests and watch them fail

```bash
pnpm install --config.minimum-release-age=0 >/dev/null 2>&1; pnpm --filter @korbat/app test
```

Expected: the command exits with an error, and the output contains:

- `Tests  1 failed | 6 passed (7)`
- `app/(auth)/age.tsx:76`
- `components/ui.tsx:56`

Observed on the dry run:

```text
Tests  1 failed | 6 passed (7)
AssertionError: expected [ 'app/(auth)/age.tsx:76', …(10) ] to deeply equal []
+   "app/(auth)/age.tsx:76",
+   "components/ui.tsx:56",
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/screen-reader-states/write_blocks.py docs/superpowers/prompts/screen-reader-states/01-screen-reader-states.md 3
```

Expected: 9 lines starting with `wrote`, one for each file below.

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
        aria-checked={accepted}
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
          <View accessibilityRole="tablist" className="mt-3 flex-row">
            {(["following", "latest"] as Tab[]).map((t) => (
              <Pressable key={t} accessibilityRole="tab" aria-selected={current === t} onPress={() => setTab(t)} className={`mr-6 border-b-2 pb-2 ${current === t ? "border-zinc-50" : "border-transparent"}`}>
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

### Replace `apps/app/src/app/settings/privacy.tsx` (whole file)

```tsx
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { ProfileList } from "@/components/social/ProfileList";
import { errorMessage } from "@/lib/api";
import { social } from "@/lib/social";

type Tab = "blocked" | "muted";

function UndoButton({ label, onPress }: { label: string; onPress: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View className="items-end">
      <Pressable
        accessibilityRole="button"
        aria-busy={busy}
        disabled={busy}
        onPress={() => {
          setBusy(true);
          setError(null);
          onPress()
            .catch((err: unknown) => setError(errorMessage(err)))
            .finally(() => setBusy(false));
        }}
        className="rounded-full border border-zinc-600 px-4 py-1.5"
      >
        <Text className="text-sm text-zinc-200">{label}</Text>
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" className="mt-1 text-xs text-red-400">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Blocked and muted accounts, with one-tap undo. This is the only place a block can be lifted. */
export default function Privacy() {
  const [tab, setTab] = useState<Tab>("blocked");
  const fetchBlocks = useCallback((cursor?: string) => social.myBlocks(cursor), []);
  const fetchMutes = useCallback((cursor?: string) => social.myMutes(cursor), []);

  return (
    <AppShell>
      <ProfileList
        key={tab}
        fetchPage={tab === "blocked" ? fetchBlocks : fetchMutes}
        empty={tab === "blocked" ? "You have not blocked anyone." : "You have not muted anyone."}
        header={
          <View className="border-b border-zinc-800 px-4 pt-4">
            <Pressable accessibilityRole="link" onPress={() => router.push("/settings/security")}>
              <Text className="text-sm text-zinc-400 underline">Security settings</Text>
            </Pressable>
            <Text accessibilityRole="header" className="mt-1 text-xl font-bold text-zinc-50">
              Privacy
            </Text>
            <Text className="mt-2 text-sm leading-5 text-zinc-400">
              A block hides you and the other account from each other while signed in and refuses their interactions. Posts on korbat are public, so anyone who signs out can
              still read them. A mute only hides an account from your timelines, and they are never told.
            </Text>
            <View accessibilityRole="tablist" className="mt-4 flex-row">
              {(["blocked", "muted"] as Tab[]).map((t) => (
                <Pressable key={t} accessibilityRole="tab" aria-selected={tab === t} onPress={() => setTab(t)} className={`mr-6 border-b-2 pb-2 ${tab === t ? "border-zinc-50" : "border-transparent"}`}>
                  <Text className={`text-base ${tab === t ? "font-semibold text-zinc-50" : "text-zinc-400"}`}>{t === "blocked" ? "Blocked" : "Muted"}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
        action={(item, remove) => (
          <UndoButton
            label={tab === "blocked" ? "Unblock" : "Unmute"}
            onPress={async () => {
              if (tab === "blocked") await social.setBlock(item.handle, false);
              else await social.setMute(item.handle, false);
              remove();
            }}
          />
        )}
      />
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/u/[handle]/index.tsx` (whole file)

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

      <View accessibilityRole="tablist" className="mt-4 flex-row">
        {tabs.map((t) => (
          <Pressable key={t} accessibilityRole="tab" aria-selected={tab === t} onPress={() => setTab(t)} className={`mr-6 border-b-2 pb-2 ${tab === t ? "border-zinc-50" : "border-transparent"}`}>
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

### Replace `apps/app/src/components/AppShell.tsx` (whole file)

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
            <Pressable key={item.href} accessibilityRole="link" aria-current={active(item.href) ? "page" : undefined} onPress={() => router.push(item.href)} className="rounded-lg px-3 py-2">
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
          <Pressable key={item.href} accessibilityRole="link" aria-current={active(item.href) ? "page" : undefined} onPress={() => router.push(item.href)} className="flex-1 items-center py-3">
            <Text className={`text-sm ${active(item.href) ? "font-semibold text-zinc-50" : "text-zinc-400"}`}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
```

### Replace `apps/app/src/components/security/ReauthPanel.tsx` (whole file)

```tsx
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { FlowResponse, type MeResponse } from "@korbat/contracts";
import { Button, ErrorText, Field } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";

type Action = () => Promise<void>;

/**
 * Runs a sensitive action. When the server answers `reauth_required`, the action is kept so the
 * re-authentication panel can run it again once the person has confirmed it's them.
 */
export function useReauth() {
  const [pending, setPending] = useState<Action | null>(null);
  const run = useCallback(async (action: Action) => {
    try {
      await action();
    } catch (err) {
      if (err instanceof ApiError && err.code === "reauth_required") {
        setPending(() => action);
        return;
      }
      throw err;
    }
  }, []);
  const clear = useCallback(() => setPending(null), []);
  return { pending, run, clear };
}

type Method = "password" | "totp" | "email";

export function ReauthPanel({ me, pending, onClose }: { me: MeResponse; pending: Action; onClose: () => void }) {
  const methods: Method[] = [...(me.user.hasPassword ? ["password" as const] : []), ...(me.user.mfaEnabled ? ["totp" as const] : []), "email"];
  const [method, setMethod] = useState<Method>(methods[0]!);
  const [value, setValue] = useState("");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendEmailCode() {
    setBusy(true);
    setError(null);
    try {
      setFlowId((await api("/api/auth/reauth/email/start", { method: "POST", schema: FlowResponse })).flowId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const body = method === "password" ? { method, password: value } : method === "totp" ? { method, code: value.trim() } : { method, flowId, code: value.trim() };
      await api("/api/auth/reauth", { json: body });
      setValue("");
      await pending();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const labels: Record<Method, string> = { password: "Password", totp: "Authenticator code", email: "Email code" };

  return (
    <View accessibilityRole="alert" className="mt-6 rounded-xl border border-amber-500/40 bg-zinc-900 p-5">
      <Text className="text-lg font-semibold text-zinc-50">Confirm it's you</Text>
      <Text className="mt-1 text-sm text-zinc-400">This change needs a fresh confirmation. It stays valid for 5 minutes.</Text>
      <View className="mt-4 flex-row flex-wrap gap-2">
        {methods.map((m) => (
          <Text
            key={m}
            accessibilityRole="button"
            aria-pressed={m === method}
            onPress={() => {
              setMethod(m);
              setValue("");
              setError(null);
            }}
            className={`rounded-full px-3 py-1 text-sm ${m === method ? "bg-zinc-50 text-zinc-950" : "border border-zinc-600 text-zinc-300"}`}
          >
            {labels[m]}
          </Text>
        ))}
      </View>
      {method === "email" && !flowId ? (
        <Button label="Email me a code" onPress={sendEmailCode} busy={busy} tone="secondary" />
      ) : (
        <>
          <Field
            label={labels[method]}
            secureTextEntry={method === "password"}
            autoComplete={method === "password" ? "current-password" : "one-time-code"}
            inputMode={method === "password" ? "text" : "numeric"}
            value={value}
            onChangeText={setValue}
            onSubmitEditing={confirm}
          />
          <Button label="Confirm" onPress={confirm} busy={busy} disabled={value.length === 0} />
        </>
      )}
      <ErrorText message={error} />
      <Button label="Cancel" onPress={onClose} tone="secondary" />
    </View>
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
import { MediaGrid } from "./MediaGrid";
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
      {quote.body ? <RichText body={quote.body} className="mt-1 text-sm leading-5 text-zinc-300" /> : null}
      <MediaGrid media={quote.media} compact />
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

/**
 * `active` colours the action. `pressed` tells a screen reader that a toggle is on, and is for
 * toggles whose label stays the same (Like, Repost); Save changes its label instead, which
 * already says so.
 */
function Action({ label, count, active, pressed, activeClass, onPress }: { label: string; count?: number; active?: boolean; pressed?: boolean; activeClass?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" aria-pressed={pressed} onPress={onPress} className="flex-row items-center gap-1 py-1 pr-4">
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
      {/* A post may consist of images only, and then there is no text to link. */}
      {post.body ? (
        <Pressable accessibilityRole="link" onPress={() => router.push(`/post/${post.id}`)} className="mt-1">
          <RichText body={post.body} />
        </Pressable>
      ) : null}
      <MediaGrid media={post.media} />
      {post.quoteOf ? <QuoteEmbed quote={post.quoteOf} /> : null}
      <View className="mt-2 flex-row flex-wrap items-center">
        <Action label="Reply" count={post.counts.replies} onPress={() => router.push(`/post/${post.id}`)} />
        <Action label="Repost" count={post.counts.reposts} active={post.viewer?.reposted} pressed={post.viewer?.reposted} activeClass="text-emerald-400" onPress={() => void toggle("repost")} />
        <Action label="Quote" count={post.counts.quotes} onPress={() => (me ? router.push(`/post/${post.id}?quote=1`) : router.push("/signin"))} />
        <Action label="Like" count={post.counts.likes} active={post.viewer?.liked} pressed={post.viewer?.liked} activeClass="text-rose-400" onPress={() => void toggle("like")} />
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

### Replace `apps/app/src/components/social/ProfileList.tsx` (whole file)

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
        aria-busy={busy}
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

### Replace `apps/app/src/components/ui.tsx` (whole file)

```tsx
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View, type TextInputProps } from "react-native";

/** A centred column on the dark background, used by every auth screen. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <View className="flex-1 items-center justify-center bg-zinc-950 px-6 py-10">
      <View className="w-full max-w-sm">{children}</View>
    </View>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" className="text-3xl font-bold tracking-tight text-zinc-50">
      {children}
    </Text>
  );
}

export function Body({ children }: { children: ReactNode }) {
  return <Text className="mt-2 text-base leading-6 text-zinc-400">{children}</Text>;
}

export function Field({ label, ...input }: { label: string } & TextInputProps) {
  return (
    <View className="mt-6">
      <Text className="text-sm font-medium text-zinc-300">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#71717a"
        className="mt-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-base text-zinc-50"
        {...input}
      />
    </View>
  );
}

export function Button({
  label,
  onPress,
  busy = false,
  disabled = false,
  tone = "primary",
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: "primary" | "secondary" | "danger";
}) {
  const inactive = disabled || busy;
  const surface = inactive ? "bg-zinc-800" : tone === "primary" ? "bg-zinc-50" : tone === "danger" ? "bg-red-600" : "border border-zinc-600";
  const text = inactive ? "text-zinc-500" : tone === "primary" ? "text-zinc-950" : "text-zinc-50";
  return (
    <Pressable accessibilityRole="button" aria-busy={busy} disabled={inactive} onPress={onPress} className={`mt-6 rounded-lg px-4 py-3 ${surface}`}>
      <Text className={`text-center text-base font-semibold ${text}`}>{busy ? "Please wait…" : label}</Text>
    </Pressable>
  );
}

export function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress} className="mt-6">
      <Text className="text-center text-sm text-zinc-400 underline">{label}</Text>
    </Pressable>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Text accessibilityRole="alert" className="mt-4 text-sm text-red-400">
      {message}
    </Text>
  );
}

export function Notice({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text className="mt-4 rounded-lg bg-zinc-900 px-4 py-3 text-sm text-zinc-300">{message}</Text>;
}

export function Loading() {
  return (
    <View className="flex-1 items-center justify-center bg-zinc-950">
      <ActivityIndicator color="#fafafa" accessibilityLabel="Loading" />
    </View>
  );
}
```

## Step 4: verify: install

```bash
pnpm install --config.minimum-release-age=0
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 2.1s using pnpm v10.30.0
```

## Step 5: verify: lockfile-age

```bash
node scripts/check-lockfile-age.mjs --base HEAD
```

Expected output contains:

- `0 new package versions since HEAD; all at least 7 days old`

Observed on the dry run:

```text
0 new package versions since HEAD; all at least 7 days old
```

## Step 6: verify: test

```bash
pnpm --filter @korbat/app test
```

Expected output contains:

- `Tests  7 passed (7)`

Must not contain:

- `failed`
- `configLoader`

Observed on the dry run:

```text
Tests  7 passed (7)
```

## Step 7: verify: typecheck

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

## Step 8: verify: states

```bash
for p in 'aria-selected=' 'accessibilityRole="tablist"' 'aria-current=' 'aria-pressed=' 'aria-checked=' 'aria-busy=' 'accessibilityState='; do echo "$p $(grep -rF "$p" apps/app/src | wc -l)"; done
```

Expected output contains:

- `aria-selected= 3`
- `accessibilityRole="tablist" 3`
- `aria-current= 2`
- `aria-pressed= 2`
- `aria-checked= 1`
- `aria-busy= 4`
- `accessibilityState= 0`

Observed on the dry run:

```text
aria-selected= 3
accessibilityRole="tablist" 3
aria-current= 2
aria-pressed= 2
aria-checked= 1
aria-busy= 4
accessibilityState= 0
```

## Step 9: verify: export

```bash
(cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx expo export --platform web 2>&1 | tail -8)
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

## Step 10: verify: api-unchanged

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  142 passed | 139 skipped (281)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  142 passed | 139 skipped (281)
```

## Step 11: verify: frozen-install

```bash
pnpm install --frozen-lockfile
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 2.4s using pnpm v10.30.0
```

## Step 12: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/app/package.json`
- `apps/app/src/app/(auth)/age.tsx`
- `apps/app/src/app/index.tsx`
- `apps/app/src/app/settings/privacy.tsx`
- `apps/app/src/app/u/[handle]/index.tsx`
- `apps/app/src/components/AppShell.tsx`
- `apps/app/src/components/security/ReauthPanel.tsx`
- `apps/app/src/components/social/PostCard.tsx`
- `apps/app/src/components/social/ProfileList.tsx`
- `apps/app/src/components/ui.tsx`
- `apps/app/test/a11y.test.tsx`
- `apps/app/test/react-dom-server.d.ts`
- `apps/app/vitest.config.mts`
- `pnpm-lock.yaml`

## Step 13: commit

```bash
git add -A
git commit -q -m "fix(app): tabs, navigation, toggles, the terms checkbox and busy buttons expose their state to screen readers through aria props; the web app's first test keeps accessibilityState out" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `fix(app): tabs, navigation, toggles, the terms checkbox and busy buttons expose their state to screen readers through aria props; the web app's first test keeps accessibilityState out`.

## Report format (mandatory)

```text
TASK 1 REPORT
Files written: <count, expected 13>
Failing-test step (the error line): <paste>
Verify "install": <paste the expected lines as printed>
Verify "lockfile-age": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "states": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "api-unchanged": <paste the expected lines as printed>
Verify "frozen-install": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```

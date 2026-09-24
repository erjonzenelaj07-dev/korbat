# korbat audit fixes — Task 7 of 11: Every navigation control is a real anchor the keyboard can follow; deletion asks first and actions wait for each other; lists never double-load; a failed session load is not a sign-out and a 401 anywhere is; ids are validated; dim text meets the contrast floor; dialogs, headings and image buttons carry the right roles; the page is dark and has an icon before the bundle loads; the terms name Turnstile and the device id

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-23 and 2026-09-24 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform whose web app is built with Expo and react-native-web. The audit found that every navigation control rendered as a div with a link role, which react-native-web deliberately does not activate from the keyboard, so a keyboard user could reach a link and never follow it. This task makes every navigation control a real anchor (expo-router's Link, or a Text with an href for outside pages), asks before deleting a post, stops a double tap from undoing itself, keeps paged lists from loading a page twice, shows a retry instead of a sign-out when the session cannot be loaded and signs out when a 401 arrives elsewhere, validates post ids from the address bar, lifts dim text to the contrast floor, gives dialogs, headings and image cells the right roles, makes the page dark with an icon before the bundle loads, and names Turnstile and the device id in the terms. The design is `docs/superpowers/specs/2026-09-23-audit-fixes-design.md`, section 7.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `fix(social): a reply names its parent's author only to viewers who could open the parent; blocking retracts the pair's reposts and likes both ways; a pair lock keeps a follow, like, repost, reply or quote from landing across a concurrent block; hidden posts and blocking accounts reveal nothing; bidi overrides and zero-width characters are refused; follower pages filter blocks before the limit; a failing limit store is 503; cursors and ids are bounded and canonical; uploads get a daily cap; thread, list and Latest indexes`.

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
python docs/superpowers/prompts/audit-fixes/write_blocks.py docs/superpowers/prompts/audit-fixes/07-web-client.md 1
```

Expected: 1 line starting with `wrote`, one for each file below.

### Replace `apps/app/test/a11y.test.tsx` (whole file)

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

/** Every source line matching `pattern`, as `file:line`. */
function findInSource(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of readdirSync(SRC, { recursive: true, encoding: "utf8" })) {
    if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
    const lines = readFileSync(path.join(SRC, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      if (pattern.test(line)) found.push(`${file.split(path.sep).join("/")}:${index + 1}`);
    });
  }
  return found.sort();
}

describe("screen-reader states", () => {
  test("no component passes accessibilityState, which react-native-web drops", () => {
    expect(findInSource(/accessibilityState[ ]*=/)).toEqual([]);
  });

  test("no component gives a control the link role by hand: a link is a Link or a Text with an href, so it is a real anchor", () => {
    // react-native-web deliberately does not fire onPress from the keyboard on role="link" without an href,
    // so Tab reaches such a control and Enter does nothing.
    expect(findInSource(/accessibilityRole=["']link["']|role=["']link["']/)).toEqual([]);
  });

  test("no component uses imagebutton, which react-native-web maps to no role", () => {
    expect(findInSource(/imagebutton/)).toEqual([]);
  });

  test("no component uses accessibilityViewIsModal, which react-native-web drops", () => {
    expect(findInSource(/accessibilityViewIsModal/)).toEqual([]);
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

  test("a text with an href is a real anchor that opens elsewhere without a reference back", () => {
    const out = html(<Text {...({ href: "https://example.org/x", hrefAttrs: { target: "_blank", rel: "noopener noreferrer" } } as object)}>x</Text>);
    expect(out).toContain("<a ");
    expect(out).toContain('href="https://example.org/x"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  test("a pressable with an href is an anchor with the link role", () => {
    const out = html(<Pressable {...({ href: "/bookmarks" } as object)} />);
    expect(out).toContain("<a ");
    expect(out).toContain('href="/bookmarks"');
  });

  test("a dialog names itself through its heading", () => {
    const out = html(
      <View role="dialog" aria-labelledby="t">
        <Text nativeID="t">Delete this post?</Text>
      </View>,
    );
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-labelledby="t"');
    expect(out).toContain('id="t"');
  });

  test("a heading can be a level below the page title", () => {
    expect(html(<Text accessibilityRole="header" aria-level={2}>Password</Text>)).toContain("<h2");
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

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/app test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
❯ test/a11y.test.tsx (14 tests | 3 failed) 123ms
Test Files  1 failed | 1 passed (2)
Tests  3 failed | 13 passed (16)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/audit-fixes/write_blocks.py docs/superpowers/prompts/audit-fixes/07-web-client.md 3
```

Expected: 34 lines starting with `wrote`, one for each file below.

### Create `apps/app/src/lib/links.ts`

```ts
import { Platform } from "react-native";

/**
 * Props that make a Text an anchor to an outside page on the web: react-native-web renders `href`
 * as a real link, and `hrefAttrs` opens it in a new tab without handing that tab a reference to
 * this one. Native has no anchors, so the caller keeps its `onPress` there.
 */
export function externalLink(url: string): object {
  return Platform.OS === "web" ? { href: url, hrefAttrs: { target: "_blank", rel: "noopener noreferrer" } } : {};
}
```

### Create `apps/app/public/index.html`

```text
<!DOCTYPE html>
<!-- The shell around the single-page web export: `expo export` reads public/index.html, fills in the
     language and title, and appends the bundle and stylesheet links. It says the page is dark before
     the bundle loads, so there is no white flash, and carries the icon as inline SVG so no request for
     it falls through to the app. Everything else is the Expo template. -->
<html lang="%LANG_ISO_CODE%">
  <head>
    <meta charset="utf-8" />
    <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
    <meta name="color-scheme" content="dark" />
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%2309090b'/%3E%3Ctext x='16' y='23' font-size='20' font-family='system-ui,sans-serif' font-weight='700' text-anchor='middle' fill='%23fafafa'%3Ek%3C/text%3E%3C/svg%3E" />
    <title>%WEB_TITLE%</title>
    <!-- The `react-native-web` recommended style reset: https://necolas.github.io/react-native-web/docs/setup/#root-element -->
    <style id="expo-reset">
      /* These styles make the body full-height */
      html,
      body {
        height: 100%;
      }
      /* These styles disable body scrolling if you are using <ScrollView> */
      body {
        overflow: hidden;
      }
      /* These styles make the root element full-height */
      #root {
        display: flex;
        height: 100%;
        flex: 1;
      }
      /* Dark before the bundle loads. */
      html,
      body {
        background: #09090b;
        color: #fafafa;
      }
    </style>
  </head>

  <body>
    <!-- Use static rendering with Expo Router to support running without JavaScript. -->
    <noscript>
      You need to enable JavaScript to run this app.
    </noscript>
    <!-- The root element for your Expo app. -->
    <div id="root"></div>
  </body>
</html>
```

### Replace `apps/app/src/components/ui.tsx` (whole file)

```tsx
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View, type TextInputProps } from "react-native";
import { Link, type Href } from "expo-router";

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
        placeholderTextColor="#a1a1aa"
        className="mt-2 rounded-lg border border-zinc-500 bg-zinc-900 px-4 py-3 text-base text-zinc-50"
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
  const text = inactive ? "text-zinc-400" : tone === "primary" ? "text-zinc-950" : "text-zinc-50";
  return (
    <Pressable accessibilityRole="button" aria-busy={busy} disabled={inactive} onPress={onPress} className={`mt-6 rounded-lg px-4 py-3 ${surface}`}>
      <Text className={`text-center text-base font-semibold ${text}`}>{busy ? "Please wait…" : label}</Text>
    </Pressable>
  );
}

/**
 * A small link under a form. It is a real anchor (expo-router's Link), so it opens with Enter, in a
 * new tab with a modifier key, and by every other means a link works. `onPress` runs before the
 * navigation, for a flow that has to forget its state first.
 */
export function TextLink({ label, href, replace = false, onPress }: { label: string; href: Href; replace?: boolean; onPress?: () => void }) {
  return (
    <Link href={href} replace={replace} onPress={onPress} asChild>
      <Pressable className="mt-6">
        <Text className="text-center text-sm text-zinc-400 underline">{label}</Text>
      </Pressable>
    </Link>
  );
}

/** The same look for an action that is not a destination, such as switching a form's mode. */
export function TextButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className="mt-6">
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

### Replace `apps/app/src/components/AppShell.tsx` (whole file)

```tsx
import type { ReactNode } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { Link, usePathname } from "expo-router";
import { useSession } from "@/lib/session";
import { HandleBox } from "./HandleBox";

interface NavItem {
  label: string;
  href: string;
  /** Marks the item current on every page under this prefix, when that is wider than the href. */
  match?: string;
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
        { label: "Settings", href: "/settings/security", match: "/settings" },
      ]
    : [
        { label: "Home", href: "/" },
        { label: "Sign in", href: "/signin" },
      ];
  const active = (item: NavItem) => (item.href === "/" ? pathname === "/" : pathname.startsWith(item.match ?? item.href));

  if (width >= MEDIUM) {
    return (
      <View className="flex-1 flex-row justify-center bg-zinc-950">
        <View className="w-56 border-r border-zinc-800 px-4 py-6">
          <Text className="mb-6 text-2xl font-bold tracking-tight text-zinc-50">korbat</Text>
          {items.map((item) => (
            <Link key={item.href} href={item.href} asChild>
              <Pressable aria-current={active(item) ? "page" : undefined} className="rounded-lg px-3 py-2">
                <Text className={`text-base ${active(item) ? "font-semibold text-zinc-50" : "text-zinc-300"}`}>{item.label}</Text>
              </Pressable>
            </Link>
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
          <Link key={item.href} href={item.href} asChild>
            <Pressable aria-current={active(item) ? "page" : undefined} className="flex-1 items-center py-3">
              <Text className={`text-sm ${active(item) ? "font-semibold text-zinc-50" : "text-zinc-400"}`}>{item.label}</Text>
            </Pressable>
          </Link>
        ))}
      </View>
    </View>
  );
}
```

### Replace `apps/app/src/components/HandleBox.tsx` (whole file)

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
          placeholderTextColor="#a1a1aa"
          returnKeyType="go"
          value={value}
          onChangeText={setValue}
          onSubmitEditing={go}
          className="flex-1 rounded-lg border border-zinc-500 bg-zinc-900 px-3 py-2 text-base text-zinc-50"
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

### Replace `apps/app/src/components/social/RichText.tsx` (whole file)

```tsx
import { Linking, Platform, Text } from "react-native";
import { Link } from "expo-router";
import { externalLink } from "@/lib/links";

/** Links and @handles become real links; everything else is plain text. Bodies are never rendered as markup. */
const TOKEN = /(https?:\/\/[^\s<>"']+|(?<![A-Za-z0-9_])@[A-Za-z0-9_]{3,20})/g;

export function RichText({ body, className = "text-base leading-6 text-zinc-100" }: { body: string; className?: string }) {
  const parts = body.split(TOKEN);
  return (
    <Text className={className}>
      {parts.map((part, index) => {
        if (/^https?:\/\//.test(part)) {
          return (
            <Text key={index} className="text-sky-400 underline" {...externalLink(part)} onPress={Platform.OS === "web" ? undefined : () => void Linking.openURL(part)}>
              {part}
            </Text>
          );
        }
        if (/^@[A-Za-z0-9_]{3,20}$/.test(part)) {
          return (
            <Link key={index} href={`/u/${part.slice(1).toLowerCase()}`} asChild>
              <Text className="text-sky-400">{part}</Text>
            </Link>
          );
        }
        return <Text key={index}>{part}</Text>;
      })}
    </Text>
  );
}
```

### Replace `apps/app/src/components/social/ProfileList.tsx` (whole file)

```tsx
import { useState, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import type { ProfileListItem } from "@korbat/contracts";
import { errorMessage } from "@/lib/api";
import { social, type Page } from "@/lib/social";
import { PagedList } from "./PagedList";

export function ProfileRow({ item, action }: { item: ProfileListItem; action?: ReactElement }) {
  return (
    <View className="flex-row items-center border-b border-zinc-800 px-4 py-3">
      <Link href={`/u/${item.handle}`} asChild>
        <Pressable className="flex-1 pr-3">
          <Text className="text-base font-semibold text-zinc-50">
            {item.displayName}
            {item.verified ? <Text className="text-sky-400"> ✓</Text> : null}
          </Text>
          <Text className="text-sm text-zinc-400">@{item.handle}</Text>
          {item.bio ? (
            <Text className="mt-1 text-sm text-zinc-300" numberOfLines={2}>
              {item.bio}
            </Text>
          ) : null}
        </Pressable>
      </Link>
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

### Replace `apps/app/src/components/social/PostCard.tsx` (whole file)

```tsx
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Link, router } from "expo-router";
import type { Author, PostView, QuotedPost, Tombstone } from "@korbat/contracts";
import { errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { social, timeAgo, type EngagementKind } from "@/lib/social";
import { MediaGrid } from "./MediaGrid";
import { RichText } from "./RichText";

function AuthorLine({ author, createdAt }: { author: Author; createdAt: string }) {
  return (
    <View className="flex-row flex-wrap items-baseline gap-x-2">
      <Link href={`/u/${author.handle}`} asChild>
        <Pressable>
          <Text className="text-base font-semibold text-zinc-50">
            {author.displayName}
            {author.verified ? <Text className="text-sky-400"> ✓</Text> : null}
          </Text>
        </Pressable>
      </Link>
      <Text className="text-sm text-zinc-400">
        @{author.handle} · {timeAgo(createdAt)}
      </Text>
    </View>
  );
}

function TombstoneBox({ tombstone }: { tombstone: Tombstone }) {
  return (
    <View className="mt-2 rounded-lg border border-zinc-800 px-3 py-2">
      <Text className="text-sm italic text-zinc-400">{tombstone.deleted ? "This post was deleted by its author." : "This post is unavailable."}</Text>
    </View>
  );
}

export function QuoteEmbed({ quote }: { quote: QuotedPost | Tombstone }) {
  if (!("author" in quote)) return <TombstoneBox tombstone={quote} />;
  return (
    <Link href={`/post/${quote.id}`} asChild>
      <Pressable className="mt-2 rounded-lg border border-zinc-800 px-3 py-2">
        <AuthorLine author={quote.author} createdAt={quote.createdAt} />
        {quote.body ? <RichText body={quote.body} className="mt-1 text-sm leading-5 text-zinc-300" /> : null}
        <MediaGrid media={quote.media} compact />
      </Pressable>
    </Link>
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
 * already says so. While one action's request is in flight, every action waits.
 */
function Action({
  label,
  count,
  active,
  pressed,
  busy,
  activeClass,
  onPress,
}: {
  label: string;
  count?: number;
  active?: boolean;
  pressed?: boolean;
  busy?: boolean;
  activeClass?: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" aria-pressed={pressed} aria-busy={busy} disabled={busy} onPress={onPress} className="flex-row items-center gap-1 py-1 pr-4">
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
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  useEffect(() => setPost(initial), [initial]);

  /** Runs one request at a time: a second tap while one is in flight does nothing, so a double tap cannot undo itself. */
  async function request(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function toggle(kind: EngagementKind) {
    if (!me) {
      router.push("/signin");
      return;
    }
    const current = post.viewer ?? { liked: false, reposted: false, bookmarked: false };
    const on = kind === "like" ? !current.liked : kind === "repost" ? !current.reposted : !current.bookmarked;
    void request(async () => {
      const result = await social.engage(post.id, kind, on);
      setPost((current) => ({ ...current, counts: result.counts, viewer: result.viewer }));
    });
  }

  function remove() {
    void request(async () => {
      await social.deletePost(post.id);
      setConfirmingDelete(false);
      onDeleted?.(post.id);
    });
  }

  return (
    <View className="border-b border-zinc-800 px-4 py-3">
      {repostedBy ? <Text className="mb-1 text-xs text-zinc-400">↻ {repostedBy.displayName} reposted</Text> : null}
      <AuthorLine author={post.author} createdAt={post.createdAt} />
      {post.author.id === me ? <StateChip state={post.state} /> : null}
      {post.replyTo ? (
        <Text className="text-xs text-zinc-400">
          {post.replyTo.authorHandle ? "Replying to " : "Replying to a post you can't see"}
          {post.replyTo.authorHandle ? (
            <Link href={`/u/${post.replyTo.authorHandle}`} asChild>
              <Text className="text-sky-400">@{post.replyTo.authorHandle}</Text>
            </Link>
          ) : null}
        </Text>
      ) : null}
      {/* A post may consist of images only, and then there is no text to link. */}
      {post.body ? (
        <Link href={`/post/${post.id}`} asChild>
          <Pressable className="mt-1">
            <RichText body={post.body} />
          </Pressable>
        </Link>
      ) : null}
      <MediaGrid media={post.media} />
      {post.quoteOf ? <QuoteEmbed quote={post.quoteOf} /> : null}
      <View className="mt-2 flex-row flex-wrap items-center">
        <Action label="Reply" count={post.counts.replies} onPress={() => router.push(`/post/${post.id}`)} />
        <Action label="Repost" count={post.counts.reposts} active={post.viewer?.reposted} pressed={post.viewer?.reposted} busy={busy} activeClass="text-emerald-400" onPress={() => toggle("repost")} />
        <Action label="Quote" count={post.counts.quotes} onPress={() => (me ? router.push(`/post/${post.id}?quote=1`) : router.push("/signin"))} />
        <Action label="Like" count={post.counts.likes} active={post.viewer?.liked} pressed={post.viewer?.liked} busy={busy} activeClass="text-rose-400" onPress={() => toggle("like")} />
        <Action label={post.viewer?.bookmarked ? "Saved" : "Save"} active={post.viewer?.bookmarked} busy={busy} activeClass="text-sky-400" onPress={() => toggle("bookmark")} />
        {post.author.id === me && !confirmingDelete ? <Action label="Delete" busy={busy} onPress={() => setConfirmingDelete(true)} /> : null}
      </View>
      {confirmingDelete ? (
        <View role="dialog" aria-labelledby={`delete-${post.id}`} className="mt-2 flex-row flex-wrap items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2">
          <Text nativeID={`delete-${post.id}`} className="text-sm text-zinc-200">
            Delete this post?
          </Text>
          <Action label="Delete" busy={busy} activeClass="text-red-400" active onPress={remove} />
          <Action label="Keep" busy={busy} onPress={() => setConfirmingDelete(false)} />
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" className="mt-1 text-xs text-red-400">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
```

### Replace `apps/app/src/components/social/PagedList.tsx` (whole file)

```tsx
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
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

/**
 * Cursor pagination with a load-more control, pull to refresh, and the same error text as the rest
 * of the app. One request is in flight at a time, and a response only lands if no newer request
 * started meanwhile, so a double tap on Load more cannot append a page twice and a refresh cannot be
 * overwritten by an older page.
 */
export function PagedList<T>({ fetchPage, keyOf, render, empty, header }: PagedListProps<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const sequence = useRef(0);

  const load = useCallback(
    async (after?: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      const mine = ++sequence.current;
      try {
        const page = await fetchPage(after);
        if (mine !== sequence.current) return;
        setItems((current) => (after ? [...current, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setError(null);
      } catch (err) {
        if (mine === sequence.current) setError(errorMessage(err));
      } finally {
        if (mine === sequence.current) {
          inFlight.current = false;
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [fetchPage],
  );

  useEffect(() => {
    // A new source (another tab, another profile) supersedes whatever the old one still has in flight.
    sequence.current++;
    inFlight.current = false;
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
      ListEmptyComponent={
        loading ? null : (
          <View className="items-center px-4 py-10">
            <Text accessibilityRole={error ? "alert" : undefined} className="text-center text-base text-zinc-400">
              {error ?? empty}
            </Text>
            {error ? (
              <Pressable accessibilityRole="button" onPress={() => void load()} className="mt-4 rounded-lg border border-zinc-700 px-4 py-2">
                <Text className="text-sm text-zinc-200">Try again</Text>
              </Pressable>
            ) : null}
          </View>
        )
      }
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

### Replace `apps/app/src/components/social/MediaGrid.tsx` (whole file)

```tsx
import { useState } from "react";
import { Image } from "expo-image";
import { Pressable, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import type { MediaView } from "@korbat/contracts";
import { API_BASE } from "@/lib/api";
import { MediaViewer } from "./MediaViewer";

/** A single image keeps its own shape, within limits, so a very tall or very wide one cannot take over the timeline. */
const MIN_RATIO = 3 / 4;
const MAX_RATIO = 2;
const FRAME_RATIO = 16 / 9;
const GAP = 2;
const THUMBNAIL = 64;

export const clampRatio = (width: number, height: number): number => Math.min(MAX_RATIO, Math.max(MIN_RATIO, width / height));

/**
 * The small size of an image with its blurhash; expo-image loads it lazily on the web. The blurhash
 * fades into the image unless the system asks for reduced motion, which swaps it at once.
 */
function Picture({ item, style }: { item: MediaView; style: { width: number | "100%"; height: number | "100%"; borderRadius?: number } }) {
  const still = useReducedMotion();
  return (
    // On the web expo-image takes the <img alt> from accessibilityLabel, not from alt.
    <Image source={{ uri: `${API_BASE}${item.small}` }} placeholder={{ blurhash: item.blurhash }} contentFit="cover" transition={still ? 0 : 150} accessibilityLabel={item.alt} style={style} />
  );
}

function Cell({ item, onPress }: { item: MediaView; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open image: ${item.alt}`} onPress={onPress} style={{ flex: 1 }}>
      <Picture item={item} style={{ width: "100%", height: "100%" }} />
    </Pressable>
  );
}

/**
 * The images of a post. One image is shown in its own ratio; two to four share a 16:9 frame and are
 * cropped to their cell. Pressing one opens the viewer; ALT shows the descriptions in place.
 */
function Grid({ media }: { media: MediaView[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [described, setDescribed] = useState(false);
  const cell = (index: number) => <Cell key={media[index]!.id} item={media[index]!} onPress={() => setOpen(index)} />;

  let frame;
  if (media.length === 1) {
    frame = <View style={{ aspectRatio: clampRatio(media[0]!.width, media[0]!.height) }}>{cell(0)}</View>;
  } else if (media.length === 2) {
    frame = <View style={{ aspectRatio: FRAME_RATIO, flexDirection: "row", gap: GAP }}>{[cell(0), cell(1)]}</View>;
  } else if (media.length === 3) {
    frame = (
      <View style={{ aspectRatio: FRAME_RATIO, flexDirection: "row", gap: GAP }}>
        {cell(0)}
        <View style={{ flex: 1, gap: GAP }}>{[cell(1), cell(2)]}</View>
      </View>
    );
  } else {
    frame = (
      <View style={{ aspectRatio: FRAME_RATIO, gap: GAP }}>
        <View style={{ flex: 1, flexDirection: "row", gap: GAP }}>{[cell(0), cell(1)]}</View>
        <View style={{ flex: 1, flexDirection: "row", gap: GAP }}>{[cell(2), cell(3)]}</View>
      </View>
    );
  }

  return (
    <View className="mt-2">
      <View className="overflow-hidden rounded-xl border border-zinc-800">{frame}</View>
      <Pressable accessibilityRole="button" aria-expanded={described} accessibilityLabel={described ? "Hide image descriptions" : "Show image descriptions"} onPress={() => setDescribed(!described)} className="mt-1 self-start rounded border border-zinc-700 px-1.5 py-0.5">
        <Text className="text-xs font-semibold text-zinc-300">ALT</Text>
      </Pressable>
      {described
        ? media.map((item, index) => (
            <Text key={item.id} className="mt-1 text-sm leading-5 text-zinc-300">
              {media.length > 1 ? `${index + 1}. ` : ""}
              {item.alt}
            </Text>
          ))
        : null}
      {open === null ? null : <MediaViewer media={media} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </View>
  );
}

/**
 * A post's images (`Grid`), or a quoted post's as one row of small squares (`compact`). The squares
 * are pictures, not buttons: the whole quote is a link to the quoted post, where the grid and the
 * viewer are, and a control inside another control is one that assistive technology cannot reach.
 */
export function MediaGrid({ media, compact = false }: { media: MediaView[]; compact?: boolean }) {
  if (media.length === 0) return null;
  if (!compact) return <Grid media={media} />;
  return (
    <View className="mt-2 flex-row" style={{ gap: GAP }}>
      {media.map((item) => (
        <Picture key={item.id} item={item} style={{ width: THUMBNAIL, height: THUMBNAIL, borderRadius: 6 }} />
      ))}
    </View>
  );
}
```

### Replace `apps/app/src/components/social/MediaViewer.tsx` (whole file)

```tsx
import { useEffect } from "react";
import { Image } from "expo-image";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import type { MediaView } from "@korbat/contracts";
import { API_BASE } from "@/lib/api";

interface MediaViewerProps {
  media: MediaView[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}

/**
 * One image on the whole screen, in its large size and fitted inside it, with its description
 * underneath. Arrow keys move between the images of the post; react-native-web's Modal closes it on
 * Escape and returns focus to the image that opened it. It appears at once: nothing about it needs
 * motion, and the image fades in from its blurhash only when reduced motion is not asked for.
 */
export function MediaViewer({ media, index, onIndex, onClose }: MediaViewerProps) {
  const still = useReducedMotion();
  const item = media[index]!;
  const many = media.length > 1;
  const step = (by: number) => onIndex((index + by + media.length) % media.length);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" && many) onIndex((index + 1) % media.length);
      if (event.key === "ArrowLeft" && many) onIndex((index - 1 + media.length) % media.length);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, many, media.length, onIndex]);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View className="flex-1 bg-black/95">
        <View className="flex-row items-center justify-between px-4 py-3">
          <Text className="text-sm text-zinc-300">{many ? `${index + 1} of ${media.length}` : ""}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close the image viewer" onPress={onClose} className="rounded-lg border border-zinc-700 px-3 py-1.5">
            <Text className="text-sm text-zinc-200">Close</Text>
          </Pressable>
        </View>
        <View className="flex-1 px-2">
          <Image
            source={{ uri: `${API_BASE}${item.large}` }}
            placeholder={{ blurhash: item.blurhash }}
            contentFit="contain"
            transition={still ? 0 : 150}
            accessibilityLabel={item.alt}
            style={{ flex: 1 }}
          />
        </View>
        <Text className="px-4 py-3 text-center text-sm leading-5 text-zinc-200">{item.alt}</Text>
        {many ? (
          <View className="flex-row justify-center gap-3 pb-4">
            <Pressable accessibilityRole="button" accessibilityLabel="Previous image" onPress={() => step(-1)} className="rounded-lg border border-zinc-700 px-4 py-2">
              <Text className="text-sm text-zinc-200">Previous</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Next image" onPress={() => step(1)} className="rounded-lg border border-zinc-700 px-4 py-2">
              <Text className="text-sm text-zinc-200">Next</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
```

### Replace `apps/app/src/components/social/ComposeSheet.tsx` (whole file)

```tsx
import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import type { PostView } from "@korbat/contracts";
import { Composer } from "./Composer";

interface ComposeSheetProps {
  open: boolean;
  onClose: () => void;
  onPosted: (post: PostView) => void;
  replyTo?: PostView;
  quoteOf?: PostView;
}

/**
 * The composer as a sheet over the current screen, for narrow layouts and for quoting from a thread.
 * The backdrop closes it but is no tab stop, so the keyboard lands on the text; a draft with content
 * is not thrown away by a stray tap: closing then asks first. The slide is skipped under reduced motion.
 */
export function ComposeSheet({ open, onClose, onPosted, replyTo, quoteOf }: ComposeSheetProps) {
  const still = useReducedMotion();
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const close = () => {
    if (dirty) setConfirming(true);
    else onClose();
  };
  const discard = () => {
    setConfirming(false);
    setDirty(false);
    onClose();
  };
  return (
    <Modal visible={open} transparent animationType={still ? "none" : "slide"} onRequestClose={close}>
      <Pressable accessibilityLabel="Close the composer" tabIndex={-1} onPress={close} className="flex-1 justify-end bg-black/60">
        <View onStartShouldSetResponder={() => true} className="rounded-t-2xl border-t border-zinc-800 bg-zinc-950 pb-6 pt-2">
          <View className="mb-1 items-center">
            <View className="h-1 w-10 rounded-full bg-zinc-700" />
          </View>
          <Text accessibilityRole="header" aria-level={2} className="px-4 text-base font-semibold text-zinc-50">
            {replyTo ? "Reply" : quoteOf ? "Quote" : "New post"}
          </Text>
          {confirming ? (
            <View role="dialog" aria-labelledby="discard-title" className="mx-4 mt-2 flex-row flex-wrap items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2">
              <Text nativeID="discard-title" className="text-sm text-zinc-200">
                Discard this draft?
              </Text>
              <Pressable accessibilityRole="button" onPress={discard} className="rounded-lg bg-red-600 px-3 py-1.5">
                <Text className="text-sm font-semibold text-zinc-50">Discard</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setConfirming(false)} className="rounded-lg border border-zinc-600 px-3 py-1.5">
                <Text className="text-sm text-zinc-200">Keep writing</Text>
              </Pressable>
            </View>
          ) : null}
          <Composer
            replyTo={replyTo}
            quoteOf={quoteOf}
            autoFocus
            onDirtyChange={setDirty}
            onCancel={close}
            onPosted={(post) => {
              setDirty(false);
              onPosted(post);
              onClose();
            }}
          />
        </View>
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

### Replace `apps/app/src/components/social/Composer.tsx` (whole file)

```tsx
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { MEDIA_MAX_PER_POST, POST_MAX_LENGTH, normalizePostBody, postLength, type PostView } from "@korbat/contracts";
import { errorMessage } from "@/lib/api";
import { canPickImages, pickImages } from "@/lib/pick-images";
import { social } from "@/lib/social";
import { ComposerImages } from "./ComposerImages";
import { QuoteEmbed } from "./PostCard";
import { describeState, useImageUploads } from "./useImageUploads";

interface ComposerProps {
  replyTo?: PostView;
  quoteOf?: PostView;
  onPosted?: (post: PostView) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  /** Told whenever the draft gains or loses content, so a sheet can ask before discarding it. */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * One composer for posts, replies and quotes, with up to four images. The counters use the same
 * normalization the server applies, so what they allow is exactly what the API accepts. A post
 * needs text or an image, and every image needs to be processed and described before it can go.
 * States reach assistive technology through `aria-*` props: react-native-web 0.21 ignores
 * `accessibilityState`, and `disabled` already sets `aria-disabled`.
 */
export function Composer({ replyTo, quoteOf, onPosted, onCancel, autoFocus, onDirtyChange }: ComposerProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploads = useImageUploads();

  const length = postLength(normalizePostBody(text));
  const { waiting, failed, undescribed } = describeState(uploads.images);
  const hasContent = length >= 1 || uploads.images.length >= 1;
  useEffect(() => onDirtyChange?.(hasContent), [hasContent, onDirtyChange]);
  const ready = hasContent && length <= POST_MAX_LENGTH && !waiting && !failed && !undescribed && !busy;
  // While images hold the post back, the button itself says what is missing, what the user can act
  // on first. Its accessible name is then that sentence, so a screen reader hears the reason too.
  const missing = failed ? "Remove the failed image" : undescribed ? "Describe every image" : waiting ? "Waiting for images…" : null;
  const action = replyTo ? "Reply" : quoteOf ? "Quote" : "Post";

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const post = await social.createPost({
        body: text,
        media: uploads.images.map((image) => ({ id: image.id!, alt: image.alt })),
        ...(replyTo ? { replyToId: replyTo.id } : {}),
        ...(quoteOf ? { quoteOfId: quoteOf.id } : {}),
      });
      setText("");
      uploads.clear();
      onPosted?.(post);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function addImages() {
    uploads.add(await pickImages());
  }

  return (
    <View className="px-4 py-3">
      {replyTo ? <Text className="mb-2 text-xs text-zinc-400">Replying to @{replyTo.author.handle}</Text> : null}
      <TextInput
        accessibilityLabel={replyTo ? "Your reply" : quoteOf ? "Your comment on the quoted post" : "What's on your mind?"}
        placeholder={replyTo ? "Write your reply" : quoteOf ? "Add your comment" : "What's on your mind?"}
        placeholderTextColor="#a1a1aa"
        multiline
        autoFocus={autoFocus}
        value={text}
        onChangeText={setText}
        className="min-h-[88px] rounded-lg border border-zinc-500 bg-zinc-900 px-4 py-3 text-base leading-6 text-zinc-50"
      />
      <ComposerImages images={uploads.images} onAlt={uploads.setAlt} onRemove={uploads.remove} />
      {quoteOf ? <QuoteEmbed quote={{ ...quoteOf, quoteOf: null }} /> : null}
      {uploads.notice ? (
        <Text accessibilityRole="alert" className="mt-2 text-sm text-amber-300">
          {uploads.notice}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" className="mt-2 text-sm text-red-400">
          {error}
        </Text>
      ) : null}
      <View className="mt-2 flex-row items-center gap-3">
        {canPickImages && uploads.images.length < MEDIA_MAX_PER_POST ? (
          <Pressable accessibilityRole="button" onPress={() => void addImages()} className="rounded-lg border border-zinc-700 px-3 py-2">
            <Text className="text-sm text-zinc-200">Add image</Text>
          </Pressable>
        ) : null}
        <View className="flex-1" />
        <Text className={`text-xs ${length > POST_MAX_LENGTH ? "text-red-400" : "text-zinc-400"}`}>
          {length}/{POST_MAX_LENGTH}
        </Text>
        {onCancel ? (
          <Pressable accessibilityRole="button" onPress={onCancel} className="rounded-lg border border-zinc-700 px-4 py-2">
            <Text className="text-sm text-zinc-200">Cancel</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" aria-busy={busy} disabled={!ready} onPress={() => void submit()} className={`rounded-lg px-4 py-2 ${ready ? "bg-zinc-50" : "bg-zinc-800"}`}>
          <Text className={`text-sm font-semibold ${ready ? "text-zinc-950" : "text-zinc-500"}`}>{busy ? "Posting…" : (missing ?? action)}</Text>
        </Pressable>
      </View>
    </View>
  );
}
```

### Replace `apps/app/src/components/social/ComposerImages.tsx` (whole file)

```tsx
import { Image } from "expo-image";
import { Pressable, Text, TextInput, View } from "react-native";
import { ALT_MAX_LENGTH, altLength, normalizeAltText } from "@korbat/contracts";
import type { ComposerImage } from "./useImageUploads";

const STATUS: Record<ComposerImage["status"], string> = {
  uploading: "Uploading…",
  processing: "Processing…",
  ready: "Ready",
  failed: "Failed",
};

/**
 * The images of a post being written: a preview from the chosen file, where the upload stands, and
 * the description every image needs. The counter uses the server's rule, so what it allows is what
 * the API accepts.
 */
export function ComposerImages({ images, onAlt, onRemove }: { images: ComposerImage[]; onAlt: (key: string, alt: string) => void; onRemove: (key: string) => void }) {
  if (images.length === 0) return null;
  return (
    <View className="mt-3 gap-3">
      {images.map((image, index) => {
        const length = altLength(normalizeAltText(image.alt));
        const label = `image ${index + 1}`;
        return (
          <View key={image.key} className="flex-row gap-3 rounded-lg border border-zinc-800 p-2">
            <Image source={{ uri: image.previewUrl }} contentFit="cover" accessibilityLabel={`Preview of ${label}`} style={{ width: 72, height: 72, borderRadius: 6 }} />
            <View className="flex-1">
              <Text accessibilityLiveRegion="polite" className={`text-xs ${image.status === "failed" ? "text-red-400" : image.status === "ready" ? "text-emerald-400" : "text-zinc-400"}`}>
                {image.status === "failed" && image.error ? image.error : STATUS[image.status]}
              </Text>
              <TextInput
                accessibilityLabel={`Description of ${label}`}
                placeholder="Describe this image for people who cannot see it"
                placeholderTextColor="#71717a"
                multiline
                value={image.alt}
                onChangeText={(alt) => onAlt(image.key, alt)}
                className="mt-1 min-h-[44px] rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm leading-5 text-zinc-50"
              />
              <View className="mt-1 flex-row items-center justify-between">
                <Text className={`text-xs ${length > ALT_MAX_LENGTH ? "text-red-400" : "text-zinc-400"}`}>
                  {length}/{ALT_MAX_LENGTH}
                </Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${label}`} onPress={() => onRemove(image.key)}>
                  <Text className="text-xs text-zinc-400 underline">Remove</Text>
                </Pressable>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}
```

### Replace `apps/app/src/components/security/ReauthPanel.tsx` (whole file)

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
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
  const panel = useRef<View>(null);
  // The panel appears in reply to an action elsewhere on the page; focus moves to it so the keyboard and a screen reader find it.
  useEffect(() => {
    (panel.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, []);

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
    <View ref={panel} role="dialog" aria-labelledby="reauth-title" tabIndex={-1} className="mt-6 rounded-xl border border-amber-500/40 bg-zinc-900 p-5">
      <Text nativeID="reauth-title" accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-50">
        Confirm it's you
      </Text>
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

### Replace `apps/app/src/components/security/MfaSection.tsx` (whole file)

```tsx
import { useState } from "react";
import { Text, View } from "react-native";
import { RecoveryCodesResponse, TotpConfirmResponse, TotpSetupResponse, type MeResponse } from "@korbat/contracts";
import { QrCode } from "@/components/security/QrCode";
import { Body, Button, ErrorText, Field } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

type Stage = { kind: "idle" } | { kind: "setup"; otpauthUri: string; qrSvg: string } | { kind: "codes"; recoveryCodes: string[] } | { kind: "disable" };

const clipboard = (globalThis as unknown as { navigator?: { clipboard?: { writeText(text: string): Promise<void> } } }).navigator?.clipboard;

export function MfaSection({
  me,
  run,
  refresh,
  reenroll,
}: {
  me: MeResponse;
  run: (action: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<unknown>;
  reenroll: boolean;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await run(action);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const startSetup = () =>
    act(async () => {
      const setup = await api("/api/auth/mfa/totp/setup", { method: "POST", schema: TotpSetupResponse });
      setCode("");
      setStage({ kind: "setup", ...setup });
    });

  const confirmSetup = () =>
    act(async () => {
      const { recoveryCodes } = await api("/api/auth/mfa/totp/confirm", { json: { code: code.trim() }, schema: TotpConfirmResponse });
      setCode("");
      setStage({ kind: "codes", recoveryCodes });
      await refresh();
    });

  const regenerate = () =>
    act(async () => {
      const { recoveryCodes } = await api("/api/auth/mfa/recovery-codes/regenerate", { method: "POST", schema: RecoveryCodesResponse });
      setStage({ kind: "codes", recoveryCodes });
    });

  const disable = () =>
    act(async () => {
      await api("/api/auth/mfa/totp/disable", { json: { code: code.trim() } });
      setCode("");
      setStage({ kind: "idle" });
      await refresh();
    });

  if (stage.kind === "setup") {
    const secret = new URL(stage.otpauthUri).searchParams.get("secret") ?? "";
    return (
      <View>
        <Body>Scan this QR code with an authenticator app, then enter the 6-digit code it shows.</Body>
        <View className="mt-4 items-center rounded-lg bg-white p-3">
          <QrCode svg={stage.qrSvg} size={200} />
        </View>
        <Text className="mt-3 text-xs text-zinc-400">Can't scan it? Enter this key: </Text>
        <Text selectable className="mt-1 font-mono text-sm text-zinc-200">
          {secret.replace(/(.{4})/g, "$1 ").trim()}
        </Text>
        <Field label="Code from the app" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} onSubmitEditing={confirmSetup} />
        <ErrorText message={error} />
        <Button label="Turn on two-factor" onPress={confirmSetup} busy={busy} disabled={!/^\d{6}$/.test(code.trim())} />
        <Button label="Cancel" onPress={() => setStage({ kind: "idle" })} tone="secondary" />
      </View>
    );
  }

  if (stage.kind === "codes") {
    return (
      <View>
        <Body>Save these recovery codes somewhere safe. Each works once, and they are the only way back into your account if you lose your authenticator. They won't be shown again.</Body>
        <View className="mt-4 flex-row flex-wrap gap-2 rounded-lg bg-zinc-900 p-4">
          {stage.recoveryCodes.map((c) => (
            <Text key={c} selectable className="w-[46%] font-mono text-base text-zinc-100">
              {c}
            </Text>
          ))}
        </View>
        {clipboard ? (
          <Button
            label={copied ? "Copied" : "Copy codes"}
            tone="secondary"
            onPress={() => {
              clipboard
                .writeText(stage.recoveryCodes.join("\n"))
                .then(() => setCopied(true))
                .catch(() => setError("Copying is not allowed here. Select the codes and copy them by hand."));
            }}
          />
        ) : null}
        <Button label="I saved my recovery codes" onPress={() => setStage({ kind: "idle" })} />
      </View>
    );
  }

  if (stage.kind === "disable") {
    return (
      <View>
        <Body>Enter a code from your authenticator app to turn two-factor off.</Body>
        <Field label="Authentication code" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} onSubmitEditing={disable} />
        <ErrorText message={error} />
        <Button label="Turn off two-factor" onPress={disable} busy={busy} disabled={!/^\d{6}$/.test(code.trim())} tone="danger" />
        <Button label="Cancel" onPress={() => setStage({ kind: "idle" })} tone="secondary" />
      </View>
    );
  }

  return (
    <View>
      {reenroll && me.user.mfaEnabled ? (
        <Text className="mt-3 rounded-lg bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          You signed in with a recovery code. Set up two-factor again to get a fresh set of codes.
        </Text>
      ) : null}
      <Body>
        {me.user.mfaEnabled
          ? "Two-factor authentication is on. Signing in needs a code from your authenticator app."
          : me.user.role === "user"
            ? "Two-factor authentication is off. Turn it on so a leaked password or email alone can't open your account."
            : "Staff accounts must turn on two-factor authentication before using staff tools."}
      </Body>
      <ErrorText message={error} />
      {me.user.mfaEnabled ? (
        <>
          <Button label="Set up a new authenticator" onPress={() => void startSetup()} busy={busy} tone={reenroll ? "primary" : "secondary"} />
          <Button label="New recovery codes" onPress={() => void regenerate()} busy={busy} tone="secondary" />
          {me.user.role === "user" ? <Button label="Turn off two-factor" onPress={() => setStage({ kind: "disable" })} tone="danger" /> : null}
        </>
      ) : (
        <Button label="Turn on two-factor" onPress={() => void startSetup()} busy={busy} />
      )}
    </View>
  );
}
```

### Replace `apps/app/src/lib/api.ts` (whole file)

```ts
import { Platform } from "react-native";
import { ErrorEnvelope, HealthResponse, type AuthErrorCode } from "@korbat/contracts";
import type { z } from "zod";

/** Same origin on web (Caddy proxies /api). Native needs an absolute URL. */
export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === "web" ? "" : "http://localhost:3000");

const CSRF_COOKIE = "__Host-korbat_csrf";
const DEVICE_KEY = "korbat.deviceId";

/** Browser globals, typed locally so this file does not depend on the DOM type library. */
const web = globalThis as unknown as {
  document?: { cookie: string };
  localStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  crypto: { getRandomValues<T extends Uint8Array>(array: T): T };
};

let onUnauthenticated: (() => void) | null = null;

/**
 * Called when a request outside the sign-in flow answers 401: the session ended elsewhere (signed
 * out everywhere, revoked, expired). The session provider registers it to drop the signed-in state.
 */
export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

/** A failed API call with the server's error code and a message fit to show the user. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const MESSAGES: Partial<Record<AuthErrorCode | "unauthenticated" | "invalid_request" | "not_found" | "internal" | "network", string>> = {
  invalid_code: "That code is not valid. Check the latest email or request a new code.",
  code_expired: "That code has expired. Request a new one.",
  too_many_attempts: "Too many attempts. Start again.",
  invalid_credentials: "Email or password is incorrect.",
  mfa_required: "Turn on two-factor authentication first.",
  invalid_mfa_code: "That authentication code is not valid.",
  reauth_required: "Confirm it's you to continue.",
  csrf_failed: "This request could not be verified. Reload the page and try again.",
  turnstile_failed: "We could not verify that you are human. Try again.",
  disposable_email: "Disposable email addresses cannot be used.",
  age_requirement: "You must be at least 16 to use korbat.",
  terms_required: "Accept the current terms to continue.",
  handle_taken: "That handle is taken.",
  handle_invalid: "Handles are 3 to 20 characters: lowercase letters, numbers and underscores.",
  handle_reserved: "That handle is reserved.",
  password_too_short: "Passwords need at least 12 characters.",
  password_too_long: "Passwords can have at most 128 characters.",
  password_breached: "That password appears in known data breaches. Choose a different one.",
  password_check_unavailable: "We could not check that password right now. Try again in a moment.",
  staff_mfa_required: "Staff accounts must keep two-factor authentication on.",
  onboarding_required: "Choose a handle to finish setting up your account.",
  mail_unavailable: "We could not send the email. Try again in a moment.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  unauthenticated: "Sign in to continue.",
  invalid_request: "Some details are missing or invalid.",
  not_found: "That no longer exists.",
  internal: "Something went wrong on our side. Try again.",
  network: "Cannot reach korbat. Check your connection.",
};

export function messageFor(code: string, fallback?: string): string {
  return MESSAGES[code as keyof typeof MESSAGES] ?? fallback ?? "Something went wrong. Try again.";
}

/** The message to show for any thrown value. */
export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

function readCookie(name: string): string | undefined {
  const cookies = web.document?.cookie;
  if (!cookies) return undefined;
  for (const part of cookies.split("; ")) {
    const separator = part.indexOf("=");
    if (part.slice(0, separator) === name) return decodeURIComponent(part.slice(separator + 1));
  }
  return undefined;
}

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** 32 random bytes as unpadded base64url (43 characters). */
function randomDeviceId(): string {
  const bytes = web.crypto.getRandomValues(new Uint8Array(33));
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += BASE64URL[(n >> 18) & 63]! + BASE64URL[(n >> 12) & 63]! + BASE64URL[(n >> 6) & 63]! + BASE64URL[n & 63]!;
  }
  return out.slice(0, 43);
}

/** A random id created once per browser. The server stores only a keyed hash of it. */
export function deviceId(): string {
  try {
    const existing = web.localStorage?.getItem(DEVICE_KEY);
    if (existing && /^[A-Za-z0-9_-]{22,64}$/.test(existing)) return existing;
    const created = randomDeviceId();
    web.localStorage?.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return randomDeviceId();
  }
}

export const platform: "web" | "ios" | "android" = Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web";

interface RequestOptions<T> {
  method?: "GET" | "POST" | "DELETE";
  json?: unknown;
  /** A raw body sent as it is, with its declared type: how an image is uploaded. */
  raw?: { type: string; body: Blob };
  /** Schema for a JSON response body. Omit for 204 responses. */
  schema?: z.ZodType<T>;
}

/**
 * Calls the API with the session cookie. State-changing requests echo the CSRF cookie in
 * X-CSRF-Token; the session cookie itself is HttpOnly and never readable here.
 */
export async function api<T = void>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const method = options.method ?? (options.json === undefined && options.raw === undefined ? "GET" : "POST");
  const headers: Record<string, string> = {};
  if (options.json !== undefined) headers["content-type"] = "application/json";
  if (options.raw) headers["content-type"] = options.raw.type;
  if (method !== "GET") {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers["x-csrf-token"] = csrf;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: "include",
      body: options.raw ? options.raw.body : options.json === undefined ? undefined : JSON.stringify(options.json),
    });
  } catch {
    throw new ApiError(0, "network", messageFor("network"));
  }

  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/auth/") && path !== "/api/me") onUnauthenticated?.();
    const parsed = ErrorEnvelope.safeParse(await res.json().catch(() => null));
    const code = parsed.success ? parsed.data.error.code : "internal";
    // The server's message is written for people and can be more specific than the generic text for
    // its code ("Two-factor setup expired. Start again."). Only validation and internal errors use
    // the local wording, because their server messages are technical.
    const generic = code === "invalid_request" || code === "internal" || !parsed.success;
    throw new ApiError(res.status, code, generic ? messageFor(code) : parsed.data.error.message);
  }
  if (!options.schema) return undefined as T;
  return options.schema.parse(await res.json());
}

export async function fetchHealth(): Promise<HealthResponse> {
  return api("/api/health", { schema: HealthResponse });
}
```

### Replace `apps/app/src/lib/session.tsx` (whole file)

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { MeResponse } from "@korbat/contracts";
import { api, ApiError, errorMessage, setUnauthenticatedHandler } from "./api";

type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; me: MeResponse };

interface SessionValue {
  state: SessionState;
  /** Reloads /api/me, for example after sign-in, onboarding or sign-out. */
  refresh(): Promise<SessionState>;
}

const SessionContext = createContext<SessionValue | null>(null);

async function loadSession(): Promise<SessionState> {
  try {
    return { status: "signed-in", me: await api("/api/me", { schema: MeResponse }) };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return { status: "signed-out" };
    throw err;
  }
}

/**
 * Only a 401 means signed out. Any other failure to load the session (no network, a 5xx, a limit)
 * is shown as such with a retry, instead of sending someone with a valid cookie back through sign-in.
 */
function SessionFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View className="flex-1 items-center justify-center bg-zinc-950 px-6">
      <Text accessibilityRole="alert" className="text-center text-base text-zinc-200">
        {message}
      </Text>
      <Pressable accessibilityRole="button" onPress={onRetry} className="mt-6 rounded-lg bg-zinc-50 px-4 py-3">
        <Text className="text-base font-semibold text-zinc-950">Try again</Text>
      </Pressable>
    </View>
  );
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const [failure, setFailure] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setFailure(null);
    try {
      const next = await loadSession();
      setState(next);
      return next;
    } catch (err) {
      setFailure(errorMessage(err));
      return { status: "loading" } as const;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setUnauthenticatedHandler(() => setState((current) => (current.status === "signed-in" ? { status: "signed-out" } : current)));
    return () => setUnauthenticatedHandler(null);
  }, []);

  const value = useMemo(() => ({ state, refresh }), [state, refresh]);
  return <SessionContext.Provider value={value}>{failure ? <SessionFailure message={failure} onRetry={() => void refresh()} /> : children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
```

### Replace `apps/app/src/lib/social.ts` (whole file)

```ts
import {
  BlockResponse,
  EngagementResponse,
  FollowResponse,
  MediaStatusResponse,
  MuteResponse,
  PostId,
  PostPage,
  PostView,
  ProfilePage,
  ProfileView,
  ThreadResponse,
  TimelinePage,
  UploadResponse,
} from "@korbat/contracts";
import { api } from "./api";

export type EngagementKind = "like" | "repost" | "bookmark";
export type Page<T> = { items: T[]; nextCursor: string | null };

const query = (cursor?: string) => (cursor ? `?cursor=${encodeURIComponent(cursor)}` : "");
/** Ids come from route params; only a UUID may become part of a path. */
const postPath = (id: string) => `/api/posts/${encodeURIComponent(PostId.parse(id))}`;
const handlePath = (handle: string) => `/api/profiles/${encodeURIComponent(handle.replace(/^@/, "").toLowerCase())}`;

/** Every social endpoint, typed by the shared contracts. Cookies and CSRF are handled by `api`. */
export const social = {
  createPost: (input: { body: string; replyToId?: string; quoteOfId?: string; media?: { id: string; alt: string }[] }) => api("/api/posts", { json: input, schema: PostView }),
  getPost: (id: string) => api(postPath(id), { schema: PostView }),
  deletePost: (id: string) => api(postPath(id), { method: "DELETE" }),
  thread: (id: string, cursor?: string) => api(`${postPath(id)}/thread${query(cursor)}`, { schema: ThreadResponse }),
  engage: (id: string, kind: EngagementKind, on: boolean) => api(`${postPath(id)}/${kind}`, { method: on ? "POST" : "DELETE", schema: EngagementResponse }),

  /** Sends one image file as the request body. The answer is an id to ask about, not a finished image. */
  uploadMedia: (file: Blob) => api("/api/media", { raw: { type: file.type, body: file }, schema: UploadResponse }),
  mediaStatus: (id: string) => api(`/api/media/${id}`, { schema: MediaStatusResponse }),
  removeMedia: (id: string) => api(`/api/media/${id}`, { method: "DELETE" }),

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

### Replace `apps/app/src/lib/terms.ts` (whole file)

```ts
/**
 * The terms shown at sign-up. TERMS_VERSION must equal the API's TERMS_VERSION setting; change both
 * together whenever the text changes, so every account records which version it accepted.
 */
export const TERMS_VERSION = "draft-2026-09";

export const TERMS_SECTIONS: { title: string; body: string }[] = [
  {
    title: "Draft",
    body: "These terms are a draft for testing korbat before launch. They will be replaced by reviewed terms and a privacy policy before korbat opens to the public.",
  },
  {
    title: "Who can use korbat",
    body: "You must be at least 16 years old. You can use a pseudonym. One person may hold more than one account, but not to evade a suspension.",
  },
  {
    title: "What you can post",
    body: "You can post opinions, including unpopular ones. Content is removed only when it breaks a published rule: sexual content, child sexual abuse material, targeted hatred or harassment based on protected traits, doxxing, direct threats of violence, or spam, scams and impersonation. Every removal names the rule, and you can appeal it.",
  },
  {
    title: "Your account",
    body: "You are responsible for keeping access to your email address. Turn on two-factor authentication and store your recovery codes; korbat cannot restore an account without them.",
  },
  {
    title: "Your data",
    body: "korbat stores your email address for sign-in and security messages, and never shows it to other people. IP addresses are stored only as keyed hashes, and a device keeps its hash for 30 days after it was last seen. Your date of birth is checked once and never stored. Your browser keeps a random device id so korbat can tell a new device from a known one; it is shared by every account used in that browser and is stored on the server only as a keyed hash. At sign-in, Cloudflare Turnstile checks that you are not a bot; it sees your IP address and browser details for that check, under Cloudflare's privacy policy.",
  },
];
```

### Replace `apps/app/src/app/post/[id].tsx` (whole file)

```tsx
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Link, router, useLocalSearchParams } from "expo-router";
import { PostId, type PostView, type ThreadResponse, type Tombstone } from "@korbat/contracts";
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
        <Text className="text-sm italic text-zinc-400">{item.deleted ? "This post was deleted by its author." : "This post is unavailable."}</Text>
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
    // The id comes from the address bar; anything but a post id is refused before a request is built from it.
    if (!PostId.safeParse(id).success) {
      setError("That address is not a post.");
      return;
    }
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
          <Link href="/" replace asChild>
            <Pressable className="mt-6">
              <Text className="text-sm text-zinc-400 underline">Back to the timeline</Text>
            </Pressable>
          </Link>
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

### Replace `apps/app/src/app/u/[handle]/index.tsx` (whole file)

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Link, router, useLocalSearchParams, type Href } from "expo-router";
import type { ProfileView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { PostList, TimelineList } from "@/components/social/PagedList";
import { FollowButton } from "@/components/social/ProfileList";
import { Button, Loading } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";

type Tab = "posts" | "replies" | "likes";

function Stat({ label, value, href }: { label: string; value: number; href?: Href }) {
  const inner = (
    <Text className="text-sm text-zinc-400">
      <Text className="font-semibold text-zinc-50">{value}</Text> {label}
    </Text>
  );
  return href ? (
    <Link href={href} asChild>
      <Pressable className="mr-4">{inner}</Pressable>
    </Link>
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
  const blockDialog = useRef<View>(null);
  useEffect(() => {
    if (confirmBlock) (blockDialog.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [confirmBlock]);

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
      <Text className="text-base text-zinc-400">@{profile.handle}</Text>
      {profile.bio ? <Text className="mt-2 text-base leading-6 text-zinc-200">{profile.bio}</Text> : null}
      <View className="mt-3 flex-row">
        <Stat label="posts" value={profile.counts.posts} />
        <Stat label="followers" value={profile.counts.followers} href={me ? `/u/${profile.handle}/followers` : undefined} />
        <Stat label="following" value={profile.counts.following} href={me ? `/u/${profile.handle}/following` : undefined} />
      </View>
      {viewer?.followedBy ? <Text className="mt-1 text-xs text-zinc-400">Follows you</Text> : null}

      {me && !own && viewer ? (
        <View className="mt-3 flex-row flex-wrap items-center gap-2">
          <FollowButton
            handle={profile.handle}
            initial={viewer.following}
            onChange={(following, followerCount) =>
              setProfile((current) => (current ? { ...current, counts: { ...current.counts, followers: followerCount }, viewer: { ...current.viewer!, following } } : current))
            }
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() =>
              void act(async () => {
                const { muted } = await social.setMute(profile.handle, !viewer.muted);
                setProfile((current) => (current ? { ...current, viewer: { ...current.viewer!, muted } } : current));
              })
            }
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
      {!me ? <Text className="mt-3 text-xs text-zinc-400">Sign in to follow this account.</Text> : null}
      {actionError ? (
        <Text accessibilityRole="alert" className="mt-2 text-sm text-red-400">
          {actionError}
        </Text>
      ) : null}

      {confirmBlock ? (
        <View ref={blockDialog} role="dialog" aria-labelledby="block-title" tabIndex={-1} className="mt-3 rounded-lg border border-red-900 bg-zinc-900 p-4">
          <Text nativeID="block-title" className="text-base font-semibold text-zinc-50">
            Block @{profile.handle}?
          </Text>
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

### Replace `apps/app/src/app/u/[handle]/followers.tsx` (whole file)

```tsx
import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { Link, Redirect, useLocalSearchParams } from "expo-router";
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
            <Link href={`/u/${handle}`} asChild>
              <Pressable>
                <Text className="text-sm text-zinc-400 underline">@{handle}</Text>
              </Pressable>
            </Link>
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

### Replace `apps/app/src/app/u/[handle]/following.tsx` (whole file)

```tsx
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
```

### Replace `apps/app/src/app/settings/privacy.tsx` (whole file)

```tsx
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
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
            <Link href="/settings/security" asChild>
              <Pressable>
                <Text className="text-sm text-zinc-400 underline">Security settings</Text>
              </Pressable>
            </Link>
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

### Replace `apps/app/src/app/settings/security.tsx` (whole file)

```tsx
import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { MfaSection } from "@/components/security/MfaSection";
import { PasswordSection } from "@/components/security/PasswordSection";
import { ReauthPanel, useReauth } from "@/components/security/ReauthPanel";
import { SessionsSection } from "@/components/security/SessionsSection";
import { Button, Loading, TextLink } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="mt-8 rounded-xl border border-zinc-800 p-5">
      <Text accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-50">
        {title}
      </Text>
      {children}
    </View>
  );
}

export default function SecuritySettings() {
  const { state, refresh } = useSession();
  const { reenroll } = useLocalSearchParams<{ reenroll?: string }>();
  const reauth = useReauth();

  if (state.status !== "signed-in") return <Loading />;
  const { me } = state;

  async function signOut() {
    await api("/api/auth/signout", { method: "POST" }).catch(() => undefined);
    await refresh();
    router.replace("/");
  }

  return (
    <AppShell>
      <ScrollView className="flex-1 bg-zinc-950" contentContainerClassName="px-4 py-6">
        <Text accessibilityRole="header" className="text-3xl font-bold tracking-tight text-zinc-50">
          Security
        </Text>
        <Text className="mt-2 text-base text-zinc-400">
          @{me.profile?.handle} · {me.user.email}
        </Text>
        <TextLink label="Privacy: blocked and muted accounts" href="/settings/privacy" />

        {reauth.pending ? <ReauthPanel me={me} pending={reauth.pending} onClose={reauth.clear} /> : null}

        <Section title="Two-factor authentication">
          <MfaSection me={me} run={reauth.run} refresh={refresh} reenroll={reenroll === "1"} />
        </Section>
        <Section title="Password">
          <PasswordSection me={me} run={reauth.run} refresh={refresh} />
        </Section>
        <Section title="Where you're signed in">
          <SessionsSection run={reauth.run} refresh={refresh} />
        </Section>

        <Button label="Sign out" onPress={() => void signOut()} tone="secondary" />
      </ScrollView>
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/bookmarks.tsx` (whole file)

```tsx
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
```

### Replace `apps/app/src/app/terms.tsx` (whole file)

```tsx
import { ScrollView, Text, View } from "react-native";

import { TextLink } from "@/components/ui";
import { TERMS_SECTIONS, TERMS_VERSION } from "@/lib/terms";

export default function Terms() {
  return (
    <ScrollView className="flex-1 bg-zinc-950" contentContainerClassName="items-center px-6 py-10">
      <View className="w-full max-w-xl">
        <Text accessibilityRole="header" className="text-3xl font-bold tracking-tight text-zinc-50">
          korbat terms
        </Text>
        <Text className="mt-2 text-sm text-zinc-400">Version {TERMS_VERSION}</Text>
        {TERMS_SECTIONS.map((section) => (
          <View key={section.title} className="mt-8">
            <Text accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-100">
              {section.title}
            </Text>
            <Text className="mt-2 text-base leading-7 text-zinc-300">{section.body}</Text>
          </View>
        ))}
        <TextLink label="Back to korbat" href="/" replace />
      </View>
    </ScrollView>
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
        aria-checked={accepted}
        onPress={() => setAccepted((a) => !a)}
        className="mt-6 flex-row items-center gap-3"
      >
        <View className={`h-5 w-5 items-center justify-center rounded border ${accepted ? "border-zinc-50 bg-zinc-50" : "border-zinc-600"}`}>
          {accepted ? <Text className="text-xs font-bold text-zinc-950">✓</Text> : null}
        </View>
        <Text className="flex-1 text-sm text-zinc-300">I accept the korbat terms ({TERMS_VERSION}).</Text>
      </Pressable>
      <TextLink label="Read the terms" href="/terms" />
      <ErrorText message={error} />
      <Button label="Create account" onPress={submit} busy={busy} disabled={!complete} />
    </Screen>
  );
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
        <TextLink label="Send a new code" href="/signin" replace />
      )}
      <TextLink label="Use a different email" href="/signin" replace onPress={() => flow.clear()} />
    </Screen>
  );
}
```

### Replace `apps/app/src/app/(auth)/mfa.tsx` (whole file)

```tsx
import { useState } from "react";
import { Redirect, router } from "expo-router";
import { SessionResult } from "@korbat/contracts";
import { Body, Button, ErrorText, Field, Screen, TextButton, Title } from "@/components/ui";
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
      <TextButton
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
      <TextLink label="Email me a code instead" href="/signin" replace />
    </Screen>
  );
}
```

### Replace `apps/app/src/app/(auth)/signin.tsx` (whole file)

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
      <TextLink label="Sign in with a password instead" href="/password" />
      <TextLink label="Read the terms" href="/terms" />
      <TextLink label="Back to the latest posts" href="/" replace />
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
      <TextLink label="It was me, go back" href="/" replace />
    </Screen>
  );
}
```

## Step 4: verify: typecheck

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

## Step 5: verify: test

```bash
pnpm --filter @korbat/app test
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  16 passed (16)
```

## Step 6: verify: export

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

## Step 7: verify: html-shell

```bash
node -e "const h=require('fs').readFileSync('apps/app/dist/index.html','utf8');console.log('color-scheme', h.includes('name=\"color-scheme\" content=\"dark\"'), 'icon', h.includes('rel=\"icon\"'), 'background', h.includes('#09090b'))"
```

Expected output contains:

- `color-scheme true icon true background true`

Observed on the dry run:

```text
color-scheme true icon true background true
```

## Step 8: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/app/public/index.html`
- `apps/app/src/app/(auth)/age.tsx`
- `apps/app/src/app/(auth)/code.tsx`
- `apps/app/src/app/(auth)/mfa.tsx`
- `apps/app/src/app/(auth)/password.tsx`
- `apps/app/src/app/(auth)/signin.tsx`
- `apps/app/src/app/bookmarks.tsx`
- `apps/app/src/app/not-me/[token].tsx`
- `apps/app/src/app/post/[id].tsx`
- `apps/app/src/app/settings/privacy.tsx`
- `apps/app/src/app/settings/security.tsx`
- `apps/app/src/app/terms.tsx`
- `apps/app/src/app/u/[handle]/followers.tsx`
- `apps/app/src/app/u/[handle]/following.tsx`
- `apps/app/src/app/u/[handle]/index.tsx`
- `apps/app/src/components/AppShell.tsx`
- `apps/app/src/components/HandleBox.tsx`
- `apps/app/src/components/security/MfaSection.tsx`
- `apps/app/src/components/security/ReauthPanel.tsx`
- `apps/app/src/components/social/ComposeSheet.tsx`
- `apps/app/src/components/social/Composer.tsx`
- `apps/app/src/components/social/ComposerImages.tsx`
- `apps/app/src/components/social/MediaGrid.tsx`
- `apps/app/src/components/social/MediaViewer.tsx`
- `apps/app/src/components/social/PagedList.tsx`
- `apps/app/src/components/social/PostCard.tsx`
- `apps/app/src/components/social/ProfileList.tsx`
- `apps/app/src/components/social/RichText.tsx`
- `apps/app/src/components/ui.tsx`
- `apps/app/src/lib/api.ts`
- `apps/app/src/lib/links.ts`
- `apps/app/src/lib/session.tsx`
- `apps/app/src/lib/social.ts`
- `apps/app/src/lib/terms.ts`
- `apps/app/test/a11y.test.tsx`

## Step 9: commit

```bash
git add -A
git commit -q -m "fix(app): navigation links are anchors (expo-router Link, Text href) so the keyboard can follow them; Delete asks first and actions wait for each other; paged lists run one request at a time and only the latest commits; a failed session load shows a retry and a 401 anywhere signs out; post ids are validated; metadata text and input borders meet WCAG contrast; dialogs are dialogs with initial focus, section headings are level 2, image cells are buttons; the HTML shell is dark with an inline icon; the terms name Turnstile and the device id; the Settings link is current on every settings page" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `fix(app): navigation links are anchors (expo-router Link, Text href) so the keyboard can follow them; Delete asks first and actions wait for each other; paged lists run one request at a time and only the latest commits; a failed session load shows a retry and a 401 anywhere signs out; post ids are validated; metadata text and input borders meet WCAG contrast; dialogs are dialogs with initial focus, section headings are level 2, image cells are buttons; the HTML shell is dark with an inline icon; the terms name Turnstile and the device id; the Settings link is current on every settings page`.

## Report format (mandatory)

```text
TASK 7 REPORT
Files written: <count, expected 35>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "html-shell": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```

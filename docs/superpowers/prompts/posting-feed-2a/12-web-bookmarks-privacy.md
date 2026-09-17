# korbat 2a — Task 12 of 13: Web: bookmarks page, privacy settings with unblock and unmute, security page inside the shell

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-17 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

The bookmarks page, the privacy settings page listing blocked and muted accounts with one-tap undo (the only place a block is lifted), and the security settings page moved inside the app shell with a link to privacy.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This sub-project adds no dependencies; do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(app): profile page with Posts, Replies and private Likes tabs, follow, mute and block with an honest confirmation; follower and following lists`.
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

### Create `apps/app/src/app/bookmarks.tsx`

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
            <Text className="mt-1 text-sm text-zinc-500">Private to you.</Text>
          </View>
        }
      />
    </AppShell>
  );
}
```

### Create `apps/app/src/app/settings/privacy.tsx`

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
        accessibilityState={{ busy }}
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
            <View className="mt-4 flex-row">
              {(["blocked", "muted"] as Tab[]).map((t) => (
                <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} onPress={() => setTab(t)} className={`mr-6 border-b-2 pb-2 ${tab === t ? "border-zinc-50" : "border-transparent"}`}>
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
      <Text accessibilityRole="header" className="text-lg font-semibold text-zinc-50">
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
        <TextLink label="Privacy: blocked and muted accounts" onPress={() => router.push("/settings/privacy")} />

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

- `apps/app/src/app/bookmarks.tsx`
- `apps/app/src/app/settings/privacy.tsx`
- `apps/app/src/app/settings/security.tsx`

## Step 6: commit

```bash
git add -A
git commit -q -m "feat(app): bookmarks page, privacy settings listing blocked and muted accounts with undo, security settings inside the app shell" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(app): bookmarks page, privacy settings listing blocked and muted accounts with undo, security settings inside the app shell`.

## Report format (mandatory)

```text
TASK 12 REPORT
Files written: <count, expected 3>
Verify "typecheck": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "api-unchanged": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```

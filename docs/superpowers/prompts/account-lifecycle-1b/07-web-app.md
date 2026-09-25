# korbat account lifecycle (1b) — Task 7 of 9: The web app: a settings navigation row, the Profile screen (display name, bio, handle change with its cooldown date), the Account screen (email change, verified badge with its explanation, data export as a download, guarded deletion), the Verified chip on posts and profiles, the terms text, and the WEB_BADGE build switch; the whole stack rebuilt and the smoke test walking the account lifecycle

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-24 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend and an Expo web app (react-native-web, expo-router, NativeWind) that talks to the API through the client in `apps/app/src/lib/api.ts` and re-authenticates through the `ReauthPanel` when the API answers `reauth_required`. Every API route of the sub-project exists; this task gives them screens: a navigation row between the settings screens, Profile (display name, bio, a handle change with the date the next one is allowed), Account (email change, the verified badge with what it means and where the number goes, the data export saved as a download, deletion behind a code and the typed handle), the Verified chip on posts and profiles, the terms text, and the `WEB_BADGE` build switch that lets a build without a provider leave the badge section out. The task ends by rebuilding the whole Docker stack and running the smoke test, which now walks the account lifecycle. The design is `docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md`, sections 7, 8, 9 and 12.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Ports 3000 and 8080 on localhost must be free. Stop any korbat API, worker or web process started from this repository first; never stop other Node processes on the machine, and never touch Docker containers, volumes or images that do not belong to the `korbat` compose project.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(account): an account deletes itself with fresh authentication, an emailed code and its typed handle; the auth module takes it down at once (sessions revoked with tombstones, devices and codes gone, the row marked), the purge tombstones its posts with their images deleted, removes its likes, reposts, bookmarks, follows, blocks and mutes with every counter, anonymises the profile and the auth row and keeps the handle reserved; the account-purge job finishes any deletion left half done and the smoke test walks the lifecycle`.

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
python docs/superpowers/prompts/account-lifecycle-1b/write_blocks.py docs/superpowers/prompts/account-lifecycle-1b/07-web-app.md 1
```

Expected: 1 line starting with `wrote`, one for each file below.

### Create `apps/app/test/lifecycle.test.tsx`

```tsx
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { SettingsNav, type SettingsPage } from "../src/components/SettingsNav";
import { VerifiedChip } from "../src/components/ui";
import { exportFilename } from "../src/lib/download";

/**
 * The account-lifecycle screens (1b design, section 9): the row of settings links, the verified badge
 * chip and the export download. The screens themselves need the router and a session, so what can be
 * checked without a browser is rendered on its own or read from the source, as a11y.test.tsx does.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");

// expo-router cannot load in Node (it reaches React Native's own modules), and the row needs only what
// Link does with `asChild`: hand the child its href, which react-native-web renders as a real anchor.
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
}));

const html = (element: ReactElement): string => renderToStaticMarkup(element);

/** Every anchor's opening tag in the markup. */
const anchors = (markup: string): string[] => markup.match(/<a\b[^>]*>/g) ?? [];

const PAGES: SettingsPage[] = ["security", "privacy", "profile", "account"];

describe("the settings row", () => {
  test("links every settings screen as a real anchor inside a navigation landmark", () => {
    const out = html(<SettingsNav current="security" />);
    expect(out).toMatch(/<nav\b|role="navigation"/);
    expect(anchors(out).map((tag) => /href="([^"]+)"/.exec(tag)?.[1])).toEqual(PAGES.map((page) => `/settings/${page}`));
  });

  test("marks the current page and only it", () => {
    for (const page of PAGES) {
      const current = anchors(html(<SettingsNav current={page} />)).filter((tag) => tag.includes('aria-current="page"'));
      expect(current, page).toHaveLength(1);
      expect(current[0], page).toContain(`href="/settings/${page}"`);
    }
  });

  test("every settings screen shows the row and names itself as the current page", () => {
    const dir = path.join(SRC, "app", "settings");
    const screens = readdirSync(dir).filter((file) => file.endsWith(".tsx") && !file.startsWith("_"));
    expect(screens.sort()).toEqual(PAGES.map((page) => `${page}.tsx`).sort());
    for (const file of screens) {
      expect(readFileSync(path.join(dir, file), "utf8"), file).toContain(`<SettingsNav current="${file.replace(/\.tsx$/, "")}"`);
    }
  });
});

describe("the verified badge chip", () => {
  test("renders its label and names itself for a screen reader", () => {
    const out = html(<VerifiedChip />);
    expect(out).toContain("Verified");
    expect(out).toContain('aria-label="verified account"');
  });

  test("is what post cards and the profile header show for a verified account", () => {
    for (const file of [path.join("components", "social", "PostCard.tsx"), path.join("app", "u", "[handle]", "index.tsx")]) {
      const source = readFileSync(path.join(SRC, file), "utf8");
      expect(source, file).toMatch(/verified \? <VerifiedChip \/> : null/);
    }
  });
});

describe("the export download", () => {
  test("takes its file name from Content-Disposition and falls back to a plain one", () => {
    expect(exportFilename('attachment; filename="korbat-export-alice-2026-09-24.zip"')).toBe("korbat-export-alice-2026-09-24.zip");
    expect(exportFilename(null)).toBe("korbat-export.zip");
    expect(exportFilename("attachment")).toBe("korbat-export.zip");
    // Only the API's own shape of name reaches the browser's download prompt.
    expect(exportFilename('attachment; filename="../evil.zip"')).toBe("korbat-export.zip");
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
Test Files  1 failed | 2 passed (3)
Tests  17 passed (17)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/account-lifecycle-1b/write_blocks.py docs/superpowers/prompts/account-lifecycle-1b/07-web-app.md 3
```

Expected: 15 lines starting with `wrote`, one for each file below.

### Create `apps/app/src/app/settings/account.tsx`

```tsx
import { useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { BadgeVerifyResponse, DeleteStartResponse, EmailChangeResponse, FlowResponse, type MeResponse } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { ReauthPanel, useReauth } from "@/components/security/ReauthPanel";
import { SettingsNav } from "@/components/SettingsNav";
import { Body, Button, ErrorText, Field, Loading, Notice, Section } from "@/components/ui";
import { api, ApiError, apiResponse, errorMessage } from "@/lib/api";
import { exportFilename, saveBlob } from "@/lib/download";
import { useSession } from "@/lib/session";

type Run = (action: () => Promise<void>) => Promise<void>;
type Refresh = () => Promise<unknown>;

/**
 * Expo inlines this public value into the web bundle at export time (WEB_BADGE in infra/.env). The
 * badge routes answer badge_unavailable when the API's verification provider is off, and there is no
 * harmless read to probe that with, so the build leaves the section out instead.
 */
const BADGE_SHOWN = process.env.EXPO_PUBLIC_BADGE !== "off";

const CODE = /^\d{6}$/;

/** One request at a time for a section, through the re-authentication hook, with its busy, error and done texts. */
function useAction(run: Run, describe: (err: unknown) => string = errorMessage) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await run(action);
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, done, setDone, act };
}

/** A new address gets a code; the account moves to it once the code is entered, and every session stays signed in. */
function EmailSection({ me, run, refresh }: { me: MeResponse; run: Run; refresh: Refresh }) {
  const [email, setEmail] = useState("");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const { busy, error, done, setDone, act } = useAction(run);

  const start = () =>
    act(async () => {
      const flow = await api("/api/auth/email/change/start", { json: { email: email.trim() }, schema: FlowResponse });
      setCode("");
      setFlowId(flow.flowId);
    });

  const verify = () =>
    act(async () => {
      const changed = await api("/api/auth/email/change/verify", { json: { flowId, code: code.trim() }, schema: EmailChangeResponse });
      setFlowId(null);
      setEmail("");
      setCode("");
      setDone(`Your email address is now ${changed.email}.`);
      // The address shown here and on the security screen reads the session.
      await refresh();
    });

  return (
    <View>
      <Body>Your address is {me.user.email}. Sign-in codes and security messages go there, and nobody else sees it.</Body>
      {flowId ? (
        <>
          <Body>We sent a code to {email.trim()}. Enter it to move your account to that address. Every session stays signed in.</Body>
          <Field label="Code from the email" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} onSubmitEditing={() => void verify()} />
          <ErrorText message={error} />
          <Button label="Change" onPress={() => void verify()} busy={busy} disabled={!CODE.test(code.trim())} />
          <Button
            label="Start over"
            onPress={() => {
              setFlowId(null);
              setCode("");
            }}
            tone="secondary"
          />
        </>
      ) : (
        <>
          <Field label="New email address" autoComplete="email" autoCapitalize="none" inputMode="email" value={email} onChangeText={setEmail} onSubmitEditing={() => void start()} />
          <ErrorText message={error} />
          <Notice message={done} />
          <Button label="Send code" onPress={() => void start()} busy={busy} disabled={email.trim().length === 0} />
        </>
      )}
    </View>
  );
}

/** The API reuses the email flows' code errors, whose wording points at an email; the badge's code came by text message. */
function badgeMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === "invalid_code") return "That code is not right. Check the text message.";
  if (err instanceof ApiError && err.code === "code_expired") return "That code has expired. Send a new one.";
  return errorMessage(err);
}

/** Holding the badge, verifying a number, or removing it; each needs fresh authentication. */
function BadgeSection({ me, run, refresh }: { me: MeResponse; run: Run; refresh: Refresh }) {
  const [phone, setPhone] = useState("");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const { busy, error, done, setDone, act } = useAction(run, badgeMessage);

  const start = () =>
    act(async () => {
      const flow = await api("/api/auth/badge/start", { json: { phone: phone.trim() }, schema: FlowResponse });
      setCode("");
      setFlowId(flow.flowId);
    });

  const verify = () =>
    act(async () => {
      await api("/api/auth/badge/verify", { json: { flowId, code: code.trim() }, schema: BadgeVerifyResponse });
      setFlowId(null);
      setPhone("");
      setCode("");
      setDone("Your account is now verified.");
      // The chip on posts and the profile, and this section, read the session.
      await refresh();
    });

  const remove = () =>
    act(async () => {
      await api("/api/auth/badge", { method: "DELETE" });
      setDone("The badge was removed.");
      await refresh();
    });

  return (
    <View>
      <Body>
        The Verified badge means you hold a phone number that no other account uses. To check it, the number is handed to the verification provider for one text message; korbat
        keeps it only as a keyed hash, never the number itself.
      </Body>
      {me.profile?.verified ? (
        <>
          <Body>Your account holds the badge.</Body>
          <ErrorText message={error} />
          <Notice message={done} />
          <Button label="Remove badge" onPress={() => void remove()} busy={busy} tone="danger" />
        </>
      ) : flowId ? (
        <>
          <Body>We texted a code to {phone.trim()}.</Body>
          <Field label="Code from the text message" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} onSubmitEditing={() => void verify()} />
          <ErrorText message={error} />
          <Button label="Verify" onPress={() => void verify()} busy={busy} disabled={!CODE.test(code.trim())} />
          <Button
            label="Start over"
            onPress={() => {
              setFlowId(null);
              setCode("");
            }}
            tone="secondary"
          />
        </>
      ) : (
        <>
          <Field label="Phone number" autoComplete="tel" inputMode="tel" placeholder="+447911123456" value={phone} onChangeText={setPhone} onSubmitEditing={() => void start()} />
          <Text className="mt-1 text-xs text-zinc-400">International format: a plus sign, the country code and the number, without the leading zero.</Text>
          <ErrorText message={error} />
          <Notice message={done} />
          <Button label="Send code" onPress={() => void start()} busy={busy} disabled={phone.trim().length === 0} />
        </>
      )}
    </View>
  );
}

/** The ZIP comes back as the response body, so the raw response is turned into a file the browser saves; native has no downloads folder to offer. */
function ExportSection({ run }: { run: Run }) {
  const { busy, error, done, setDone, act } = useAction(run);

  const download = () =>
    act(async () => {
      const res = await apiResponse("/api/account/export", { method: "POST" });
      saveBlob(await res.blob(), exportFilename(res.headers.get("content-disposition")));
      setDone("Your export was downloaded.");
    });

  return (
    <View>
      <Body>
        The archive is a ZIP with export.json (your account, profile, posts, likes, reposts, bookmarks, follows, blocks, mutes, sessions, devices and security events) and every
        image you uploaded. It holds your email address, so keep it somewhere private. You can export once a day.
      </Body>
      {Platform.OS === "web" ? (
        <>
          <ErrorText message={error} />
          <Notice message={done} />
          <Button label="Download my data" onPress={() => void download()} busy={busy} />
        </>
      ) : (
        <Body>Export your data from the web app.</Body>
      )}
    </View>
  );
}

/** Deletion needs an emailed code and the handle typed back; the API takes the account down at once and this session with it. */
function DeleteSection({ me, run, refresh }: { me: MeResponse; run: Run; refresh: Refresh }) {
  const [flowId, setFlowId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [typed, setTyped] = useState("");
  const { busy, error, act } = useAction(run);
  const handle = me.profile?.handle ?? "";
  const typedHandle = typed.trim().replace(/^@/, "").toLowerCase();
  // The API compares the typed handle case-insensitively and answers a mismatch as a generic invalid request; the same rule here keeps the button off until it matches.
  const matches = typedHandle.length > 0 && typedHandle === handle.toLowerCase();

  const start = () =>
    act(async () => {
      const flow = await api("/api/account/delete/start", { method: "POST", schema: DeleteStartResponse });
      setCode("");
      setTyped("");
      setFlowId(flow.flowId);
    });

  const confirm = () =>
    act(async () => {
      await api("/api/account/delete/confirm", { json: { flowId, code: code.trim(), handle: typedHandle } });
      // The API cleared the cookies: the session reloads as signed out, and the home page is public.
      await refresh();
      router.replace("/");
    });

  return (
    <View>
      <Body>
        Deleting your account removes your posts and images, and your likes, reposts, bookmarks, follows, blocks and mutes. Your handle stays reserved, so nobody can take it.
        This cannot be undone.
      </Body>
      {flowId ? (
        <>
          <Body>We emailed a code to {me.user.email}.</Body>
          <Field label="Code from the email" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} />
          <Field label="Type your handle to confirm" autoCapitalize="none" autoComplete="off" placeholder={`@${handle}`} value={typed} onChangeText={setTyped} />
          <ErrorText message={error} />
          <Button label="Delete my account" onPress={() => void confirm()} busy={busy} disabled={!CODE.test(code.trim()) || !matches} tone="danger" />
          <Button
            label="Cancel"
            onPress={() => {
              setFlowId(null);
              setCode("");
              setTyped("");
            }}
            tone="secondary"
          />
        </>
      ) : (
        <>
          <ErrorText message={error} />
          <Button label="Send me a code" onPress={() => void start()} busy={busy} tone="secondary" />
        </>
      )}
    </View>
  );
}

export default function AccountSettings() {
  const { state, refresh } = useSession();
  const reauth = useReauth();

  if (state.status !== "signed-in") return <Loading />;
  const { me } = state;

  return (
    <AppShell>
      <ScrollView className="flex-1 bg-zinc-950" contentContainerClassName="px-4 py-6">
        <Text accessibilityRole="header" className="text-3xl font-bold tracking-tight text-zinc-50">
          Account
        </Text>
        <Text className="mt-2 text-base text-zinc-400">@{me.profile?.handle}</Text>
        <SettingsNav current="account" />

        {reauth.pending ? <ReauthPanel me={me} pending={reauth.pending} onClose={reauth.clear} /> : null}

        <Section title="Email address">
          <EmailSection me={me} run={reauth.run} refresh={refresh} />
        </Section>
        {BADGE_SHOWN ? (
          <Section title="Verified badge">
            <BadgeSection me={me} run={reauth.run} refresh={refresh} />
          </Section>
        ) : null}
        <Section title="Data export">
          <ExportSection run={reauth.run} />
        </Section>
        <Section title="Delete account">
          <DeleteSection me={me} run={reauth.run} refresh={refresh} />
        </Section>
      </ScrollView>
    </AppShell>
  );
}
```

### Create `apps/app/src/app/settings/profile.tsx`

```tsx
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { BIO_MAX_LENGTH, postLength, type MeResponse, type ProfileView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { ReauthPanel, useReauth } from "@/components/security/ReauthPanel";
import { SettingsNav } from "@/components/SettingsNav";
import { Body, Button, ErrorText, Field, Loading, Notice, Section } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";

/** The DisplayName contract's limit, in the code points the counter shows. */
const DISPLAY_NAME_MAX = 50;
/** The API lets a handle change again this long after the last change (1b design, section 7.2); mirrored so the date shows before a refused attempt. */
const HANDLE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

type Run = (action: () => Promise<void>) => Promise<void>;
type Refresh = () => Promise<unknown>;

function Counter({ length, max }: { length: number; max: number }) {
  return (
    <Text className={`mt-1 text-right text-xs ${length > max ? "text-red-400" : "text-zinc-400"}`}>
      {length}/{max}
    </Text>
  );
}

/** Display name and bio. /api/me carries no bio, so the form starts from the public profile, which has both. */
function ProfileForm({ handle, refresh }: { handle: string; refresh: Refresh }) {
  const [saved, setSaved] = useState<ProfileView | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    social
      .profile(handle)
      .then((profile) => {
        if (cancelled) return;
        setSaved(profile);
        setDisplayName(profile.displayName);
        setBio(profile.bio);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  const name = displayName.trim();
  const text = bio.trim();
  const nameLength = postLength(name);
  const bioLength = postLength(text);
  const changed = saved !== null && (name !== saved.displayName || text !== saved.bio);
  const ready = changed && nameLength >= 1 && nameLength <= DISPLAY_NAME_MAX && bioLength <= BIO_MAX_LENGTH;

  async function save() {
    if (!saved) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      // Only what changed is sent: the contract refuses an empty edit, and the server records an event per call.
      const { profile } = await social.editProfile({ ...(name !== saved.displayName ? { displayName: name } : {}), ...(text !== saved.bio ? { bio: text } : {}) });
      setSaved(profile);
      setDisplayName(profile.displayName);
      setBio(profile.bio);
      setDone("Profile saved.");
      // The shell's Profile link and the profile page read the session, so it follows the new name.
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!saved) {
    return error ? <ErrorText message={error} /> : <Text className="mt-3 text-sm text-zinc-400">Loading your profile...</Text>;
  }
  return (
    <View>
      <Body>Your display name is shown next to your posts. The bio is one line on your profile.</Body>
      <Field label="Display name" autoComplete="name" value={displayName} onChangeText={setDisplayName} />
      <Counter length={nameLength} max={DISPLAY_NAME_MAX} />
      {/* The Bio contract refuses control characters, which a line break is, so the field stays single-line. */}
      <Field label="Bio" value={bio} onChangeText={setBio} onSubmitEditing={() => void save()} />
      <Counter length={bioLength} max={BIO_MAX_LENGTH} />
      <ErrorText message={error} />
      <Notice message={done} />
      <Button label="Save" onPress={() => void save()} busy={busy} disabled={!ready} />
    </View>
  );
}

/** The handle and its 30-day rule. The change needs fresh authentication, so it runs through useReauth. */
function HandleSection({ me, run, refresh }: { me: MeResponse; run: Run; refresh: Refresh }) {
  const current = me.profile?.handle ?? "";
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // The moment a handle_cooldown answer named through Retry-After; until one comes, the last change plus 30 days says it.
  const [refusedUntil, setRefusedUntil] = useState<number | null>(null);
  const fromLastChange = me.profile?.handleChangedAt ? new Date(me.profile.handleChangedAt).getTime() + HANDLE_COOLDOWN_MS : null;
  const until = refusedUntil ?? fromLastChange;
  const allowedAt = until !== null && until > Date.now() ? new Date(until) : null;
  const normalized = handle.trim().replace(/^@/, "").toLowerCase();
  const ready = normalized.length > 0 && normalized !== current.toLowerCase();

  async function change() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await run(async () => {
        const { profile } = await social.changeHandle(normalized);
        setHandle("");
        setRefusedUntil(null);
        setDone(`Your handle is now @${profile.handle}. The old one stays reserved for you.`);
        // The shell's Profile link and this screen's heading read the session.
        await refresh();
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "handle_cooldown") setRefusedUntil(err.retryAfter ? Date.now() + err.retryAfter * 1000 : fromLastChange);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Body>Your handle is @{current}. You can change it once every 30 days. Handles you used before stay yours.</Body>
      {allowedAt ? <Text className="mt-2 text-sm text-amber-300">Your next change is allowed on {allowedAt.toLocaleDateString()}.</Text> : null}
      <Field label="New handle" autoCapitalize="none" autoComplete="username" placeholder="@yourname" value={handle} onChangeText={setHandle} onSubmitEditing={() => void change()} />
      <ErrorText message={error} />
      <Notice message={done} />
      <Button label="Change handle" onPress={() => void change()} busy={busy} disabled={!ready} />
    </View>
  );
}

export default function ProfileSettings() {
  const { state, refresh } = useSession();
  const reauth = useReauth();

  if (state.status !== "signed-in") return <Loading />;
  const { me } = state;
  // The settings layout sends an account without a handle to onboarding, so the profile is there; the type still allows null.
  if (!me.profile) return <Loading />;

  return (
    <AppShell>
      <ScrollView className="flex-1 bg-zinc-950" contentContainerClassName="px-4 py-6">
        <Text accessibilityRole="header" className="text-3xl font-bold tracking-tight text-zinc-50">
          Profile
        </Text>
        <Text className="mt-2 text-base text-zinc-400">@{me.profile.handle}</Text>
        <SettingsNav current="profile" />

        {reauth.pending ? <ReauthPanel me={me} pending={reauth.pending} onClose={reauth.clear} /> : null}

        <Section title="Name and bio">
          <ProfileForm handle={me.profile.handle} refresh={refresh} />
        </Section>
        <Section title="Handle">
          <HandleSection me={me} run={reauth.run} refresh={refresh} />
        </Section>
      </ScrollView>
    </AppShell>
  );
}
```

### Create `apps/app/src/components/SettingsNav.tsx`

```tsx
import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";

export type SettingsPage = "security" | "privacy" | "profile" | "account";

const PAGES: { page: SettingsPage; label: string }[] = [
  { page: "security", label: "Security" },
  { page: "privacy", label: "Privacy" },
  { page: "profile", label: "Profile" },
  { page: "account", label: "Account" },
];

/**
 * The row of links between the settings screens, shown by every one of them under its title. Each
 * link is a real anchor (expo-router's Link), so the keyboard can follow it. The screen names itself
 * through `current` instead of the row asking the router for the path, which also lets a test render
 * the row on its own.
 */
export function SettingsNav({ current }: { current: SettingsPage }) {
  return (
    <View role="navigation" aria-label="Settings" className="mt-3 flex-row flex-wrap">
      {PAGES.map(({ page, label }) => (
        <Link key={page} href={`/settings/${page}`} asChild>
          <Pressable aria-current={page === current ? "page" : undefined} className="mr-5 py-1">
            <Text className={`text-sm underline ${page === current ? "font-semibold text-zinc-50" : "text-zinc-400"}`}>{label}</Text>
          </Pressable>
        </Link>
      ))}
    </View>
  );
}
```

### Create `apps/app/src/lib/download.ts`

```ts
/**
 * Saving a response body as a file, for the account export (1b design, section 7.5). Browser globals
 * are typed locally, as lib/api.ts does, so this file does not depend on the DOM type library.
 */
const web = globalThis as unknown as {
  document?: {
    createElement(tag: string): { href: string; download: string; click(): void; remove(): void };
    body: { appendChild(node: unknown): unknown };
  };
};

const DEFAULT_FILENAME = "korbat-export.zip";

/**
 * The file name the API put in Content-Disposition (`attachment; filename="..."`). Only a name of the
 * API's own shape (letters, digits, dots, dashes; nothing that looks like a path) reaches the browser's
 * download prompt; anything else, or no header at all, gets the plain default.
 */
export function exportFilename(disposition: string | null): string {
  const name = /filename="([^"]*)"/.exec(disposition ?? "")?.[1] ?? "";
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) ? name : DEFAULT_FILENAME;
}

/** Hands a blob to the browser as a download, through a temporary anchor with the `download` attribute. */
export function saveBlob(blob: Blob, filename: string): void {
  const doc = web.document;
  if (!doc) throw new Error("downloads need a browser");
  const url = URL.createObjectURL(blob);
  const anchor = doc.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  // Firefox counts the click only for an anchor in the document; it leaves again at once.
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
```

### Replace `apps/app/src/app/settings/privacy.tsx` (whole file)

```tsx
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { AppShell } from "@/components/AppShell";
import { SettingsNav } from "@/components/SettingsNav";
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
            <Text accessibilityRole="header" className="text-xl font-bold text-zinc-50">
              Privacy
            </Text>
            <SettingsNav current="privacy" />
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
import { ScrollView, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { MfaSection } from "@/components/security/MfaSection";
import { PasswordSection } from "@/components/security/PasswordSection";
import { ReauthPanel, useReauth } from "@/components/security/ReauthPanel";
import { SessionsSection } from "@/components/security/SessionsSection";
import { SettingsNav } from "@/components/SettingsNav";
import { Button, Loading, Section } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

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
        <SettingsNav current="security" />

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

### Replace `apps/app/src/app/u/[handle]/index.tsx` (whole file)

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Link, router, useLocalSearchParams, type Href } from "expo-router";
import type { ProfileView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { PostList, TimelineList } from "@/components/social/PagedList";
import { FollowButton } from "@/components/social/ProfileList";
import { Button, Loading, VerifiedChip } from "@/components/ui";
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
      <View className="flex-row flex-wrap items-center gap-x-2">
        <Text accessibilityRole="header" className="text-2xl font-bold text-zinc-50">
          {profile.displayName}
        </Text>
        {profile.verified ? <VerifiedChip /> : null}
      </View>
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

### Replace `apps/app/src/components/social/PostCard.tsx` (whole file)

```tsx
import { useEffect, useRef, useState, type Ref } from "react";
import { Pressable, Text, View } from "react-native";
import { Link, router } from "expo-router";
import type { Author, PostView, QuotedPost, Tombstone } from "@korbat/contracts";
import { VerifiedChip } from "@/components/ui";
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
          <Text className="text-base font-semibold text-zinc-50">{author.displayName}</Text>
        </Pressable>
      </Link>
      {author.verified ? <VerifiedChip /> : null}
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
  ref,
}: {
  label: string;
  count?: number;
  active?: boolean;
  pressed?: boolean;
  busy?: boolean;
  activeClass?: string;
  onPress: () => void;
  ref?: Ref<View>;
}) {
  return (
    <Pressable ref={ref} accessibilityRole="button" aria-pressed={pressed} aria-busy={busy} disabled={busy} onPress={onPress} className="flex-row items-center gap-1 py-1 pr-4">
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
  const deleteRef = useRef<View>(null);
  const keepRef = useRef<View>(null);
  const wasConfirming = useRef(false);
  // The Delete control leaves the tree while the question shows, so a keyboard user would drop to the page
  // body: the safe answer takes the focus, and Delete takes it back when the question is withdrawn.
  useEffect(() => {
    if (confirmingDelete) keepRef.current?.focus();
    else if (wasConfirming.current) deleteRef.current?.focus();
    wasConfirming.current = confirmingDelete;
  }, [confirmingDelete]);

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
        {post.author.id === me && !confirmingDelete ? <Action ref={deleteRef} label="Delete" busy={busy} onPress={() => setConfirmingDelete(true)} /> : null}
      </View>
      {confirmingDelete ? (
        <View role="dialog" aria-labelledby={`delete-${post.id}`} className="mt-2 flex-row flex-wrap items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2">
          <Text nativeID={`delete-${post.id}`} className="text-sm text-zinc-200">
            Delete this post?
          </Text>
          <Action label="Delete" busy={busy} activeClass="text-red-400" active onPress={remove} />
          <Action ref={keepRef} label="Keep" busy={busy} onPress={() => setConfirmingDelete(false)} />
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

/** A titled box on a settings screen; the title is a heading one level under the screen's own. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="mt-8 rounded-xl border border-zinc-800 p-5">
      <Text accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-50">
        {title}
      </Text>
      {children}
    </View>
  );
}

/**
 * The verified badge after a display name: the account proved it holds a phone number that no other
 * account uses. The label says what the one word means to a screen reader.
 */
export function VerifiedChip() {
  return (
    <View accessibilityLabel="verified account" className="self-center rounded-full bg-sky-950 px-2 py-0.5">
      <Text className="text-xs font-medium text-sky-300">Verified</Text>
    </View>
  );
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
    /** Seconds until the request may be repeated, from Retry-After: a rate limit or the handle cooldown. */
    readonly retryAfter?: number,
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
  handle_cooldown: "Handles can change once every 30 days.",
  email_in_use: "That email address already belongs to an account.",
  phone_in_use: "That phone number is already verified on another account.",
  badge_unavailable: "Verification is not available on this korbat.",
  verify_unavailable: "We could not reach the verification service. Try again in a moment.",
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
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  json?: unknown;
  /** A raw body sent as it is, with its declared type: how an image is uploaded. */
  raw?: { type: string; body: Blob };
  /** Schema for a JSON response body. Omit for 204 responses. */
  schema?: z.ZodType<T>;
}

/**
 * Calls the API with the session cookie and answers with the raw response, for a body that is not
 * JSON (the account export's ZIP). State-changing requests echo the CSRF cookie in X-CSRF-Token; the
 * session cookie itself is HttpOnly and never readable here. A failed call throws an ApiError.
 */
export async function apiResponse(path: string, options: Omit<RequestOptions<unknown>, "schema"> = {}): Promise<Response> {
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
    // Retry-After is whole seconds: on a rate limit, and on the handle cooldown, where it says when the next change is allowed.
    const retryAfter = Number(res.headers.get("retry-after"));
    throw new ApiError(res.status, code, generic ? messageFor(code) : parsed.data.error.message, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
  }
  return res;
}

/** Calls the API as `apiResponse` does and parses the JSON answer with `schema`; omit it for a 204 response. */
export async function api<T = void>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const res = await apiResponse(path, options);
  if (!options.schema) return undefined as T;
  return options.schema.parse(await res.json());
}

export async function fetchHealth(): Promise<HealthResponse> {
  return api("/api/health", { schema: HealthResponse });
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
  type ProfileEditRequest,
  ProfilePage,
  ProfileView,
  ThreadResponse,
  TimelinePage,
  UploadResponse,
} from "@korbat/contracts";
import { z } from "zod";
import { api } from "./api";

export type EngagementKind = "like" | "repost" | "bookmark";
export type Page<T> = { items: T[]; nextCursor: string | null };

const query = (cursor?: string) => (cursor ? `?cursor=${encodeURIComponent(cursor)}` : "");
/** Ids come from route params; only a UUID may become part of a path. */
const postPath = (id: string) => `/api/posts/${encodeURIComponent(PostId.parse(id))}`;
const handlePath = (handle: string) => `/api/profiles/${encodeURIComponent(handle.replace(/^@/, "").toLowerCase())}`;

/** The signed-in account's own profile as the editing routes answer it: the public view, since /api/me carries no bio. */
const OwnProfileResponse = z.object({ profile: ProfileView });

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

  /** Either field or both; the caller refreshes the session afterwards, so the shell's Profile link follows a new name. */
  editProfile: (edit: ProfileEditRequest) => api("/api/me/profile", { method: "PATCH", json: edit, schema: OwnProfileResponse }),
  /** Needs fresh authentication: the caller runs it through useReauth. */
  changeHandle: (handle: string) => api("/api/me/handle", { json: { handle }, schema: OwnProfileResponse }),
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
    body: "korbat stores your email address for sign-in and security messages, and never shows it to other people. IP addresses are stored only as keyed hashes, and a device keeps its hash for 30 days after it was last seen. Your date of birth is checked once and never stored. Your browser keeps a random device id so korbat can tell a new device from a known one; it is shared by every account used in that browser and is stored on the server only as a keyed hash. At sign-in, Cloudflare Turnstile checks that you are not a bot; it sees your IP address and browser details for that check, under Cloudflare's privacy policy. If you ask for the Verified badge, your phone number is handed to the verification provider for one text message, and korbat keeps only a keyed hash of it. From the Account settings you can export your account's data as a ZIP archive and delete your account; deletion removes your posts, keeps your handle reserved and cannot be undone.",
  },
];
```

### Replace `infra/.env.example` (whole file)

```text
# Copy to infra/.env and change every password. Never commit infra/.env.
POSTGRES_USER=postgres
POSTGRES_PASSWORD=change-me-superuser
POSTGRES_DB=korbat
KORBAT_MIGRATE_DB_PASSWORD=change-me-migrate
KORBAT_API_DB_PASSWORD=change-me-api
KORBAT_AUTH_DB_PASSWORD=change-me-auth
# Valkey (the session cache and rate-limit counters) refuses every command without it.
REDIS_PASSWORD=change-me-redis

# Images. The formats korbat accepts: remove one to refuse it and keep its decoder blocked, for
# example after a security advisory against that decoder, then restart api and worker.
MEDIA_FORMATS=jpeg,png,webp,gif,avif
# Uploads are refused while a media volume has less free space than this many bytes (2 GiB). The
# volumes share a disk with Postgres, and a full disk stops the database.
MEDIA_MIN_FREE_BYTES=2147483648
# The sweeper's pass that deletes images without a database row: on refuses when there are many of
# them (a database restored from an older snapshot looks like that), off skips it during a restore,
# force deletes them once you have checked.
MEDIA_RECONCILE=on

API_LOG_LEVEL=info
# Comma-separated browser origins allowed to call the API cross-origin. Empty in prod (same origin via Caddy).
API_TRUSTED_ORIGINS=http://localhost:8081

# Auth. `node scripts/gen-dev-env.mjs` fills the keys with random values and shares them with apps/api/.env.
# Origin the web app is served from (Caddy). Production: https://<your domain>.
API_APP_ORIGIN=http://localhost:8080
# Which header names the client: cloudflare when the tunnel is the only way in (the API then trusts
# cf-connecting-ip), caddy when Caddy's port is reachable directly. Never none behind a proxy.
API_TRUST_PROXY=caddy
API_AUTH_HMAC_KEY=change-me-key-auth-hmac
API_IP_HASH_KEY=change-me-key-ip-hash
API_TOTP_ENC_KEY=v1:change-me-key-totp
# Earlier TOTP keys, comma-separated, kept only while secrets they encrypted are still stored; a secret
# read with one is re-encrypted with API_TOTP_ENC_KEY.
API_TOTP_ENC_KEYS_PREVIOUS=
# Cloudflare's documented always-pass test secret. Production uses the secret of your Turnstile widget.
API_TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
# Mailpit from compose.dev.yml. Production: the EU relay, e.g. smtps://user:pass@smtp-relay.example:465
API_SMTP_URL=smtp://mailpit:1025
API_MAIL_FROM="korbat <no-reply@korbat.local>"
API_TERMS_VERSION=draft-2026-09
# Who checks the phone number behind the verified badge: off hides the badge section, dev accepts the code
# 000000 (development only; production refuses it), vonage texts a real code through Vonage Verify with the
# key and secret from the Vonage dashboard (the runbook in the 1b design says how).
API_VERIFY_PROVIDER=off
API_VONAGE_API_KEY=
API_VONAGE_API_SECRET=
# The sender name of the verification text: 1 to 18 characters, none of / { } : $.
API_VERIFY_BRAND=korbat

# Public Turnstile site key baked into the web image. Cloudflare's always-pass test key for development;
# production uses the site key of the same widget as API_TURNSTILE_SECRET_KEY.
WEB_TURNSTILE_SITE_KEY=1x00000000000000000000AA
# Whether the web app's account settings show the verified badge section. Set it to off when
# API_VERIFY_PROVIDER is off, so the web build leaves the section out; the web app reads it as
# EXPO_PUBLIC_BADGE, which Expo inlines at export time.
WEB_BADGE=on

# development or production. It is the API's NODE_ENV (production refuses Turnstile test keys, plain-http
# origins and a relay without TLS) and a build argument of the web image (production refuses the
# Turnstile test site key). Set it to production before building the images for the public.
KORBAT_ENV=development
# on when cloudflared is the only way in: Caddy then keeps CF-Connecting-IP for the API (and
# API_TRUST_PROXY is cloudflare). off drops the header, so nobody on the network can claim an address.
TUNNEL=off
# Cloudflare Tunnel token (Zero Trust > Networks > Tunnels). Only needed with --profile tunnel. The
# tunnel's public hostname must point at http://caddy:8080.
TUNNEL_TOKEN=

# The development stack's host ports, read only by infra/compose.dev.yml. Set one when another container
# on this machine holds the default, and give apps/api/.env the same port. Defaults: 55432, 56379, 3000,
# 8080, 51025, 58025.
# DEV_PG_PORT=55432
# DEV_REDIS_PORT=56379
# DEV_API_PORT=3000
# DEV_CADDY_PORT=8080
# DEV_SMTP_PORT=51025
# DEV_MAILPIT_PORT=58025
```

### Replace `infra/caddy/Dockerfile` (whole file)

```dockerfile
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS web
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
# pnpm verifies the repository patches named in package.json at every install, hashed into the lockfile.
COPY patches ./patches
# pnpm at the version and hash the root package.json names; corepack verifies the download against the hash.
RUN corepack enable && corepack install
COPY packages ./packages
COPY apps/app ./apps/app
RUN pnpm install --frozen-lockfile --filter @korbat/app...
# The public Turnstile site key is inlined into the web bundle at export time. It is not a secret.
ARG EXPO_PUBLIC_TURNSTILE_SITE_KEY
ARG KORBAT_ENV=development
RUN test -n "$EXPO_PUBLIC_TURNSTILE_SITE_KEY" || { echo "the EXPO_PUBLIC_TURNSTILE_SITE_KEY build argument is required" >&2; exit 1; }
# Cloudflare's test keys pass every check, so a production build refuses them.
RUN if [ "$KORBAT_ENV" = "production" ]; then case "$EXPO_PUBLIC_TURNSTILE_SITE_KEY" in [123]x0*AA) echo "EXPO_PUBLIC_TURNSTILE_SITE_KEY is a Turnstile test key; a production build needs the site key of your own widget" >&2; exit 1;; esac; fi
# Whether the account settings show the verified badge section: off (WEB_BADGE in infra/.env) when the API's verification provider is off.
ARG EXPO_PUBLIC_BADGE=on
RUN cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY="$EXPO_PUBLIC_TURNSTILE_SITE_KEY" EXPO_PUBLIC_BADGE="$EXPO_PUBLIC_BADGE" npx expo export --platform web

FROM caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b
ARG TUNNEL=off
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
# Behind the tunnel cloudflared sets CF-Connecting-IP and the API needs it; anywhere else a client could set it.
RUN if [ "$TUNNEL" = "on" ]; then : > /etc/caddy/cf-header.caddy; else echo "header_up -CF-Connecting-IP" > /etc/caddy/cf-header.caddy; fi
COPY --from=web /repo/apps/app/dist /srv
# The image's binary carries cap_net_bind_service as a file capability; with every capability dropped, the
# kernel refuses to run it ("operation not permitted"). Port 8080 needs no capability, so it is removed.
RUN setcap -r /usr/bin/caddy
# Caddy runs as its own user on a port it may bind without privileges; its state directories are its own.
RUN adduser -D -u 10001 caddy && mkdir -p /data /config && chown -R caddy:caddy /data /config
USER caddy
EXPOSE 8080
```

### Replace `infra/compose.yml` (whole file)

```yaml
name: korbat

x-logging: &logging
  driver: json-file
  options: { max-size: "20m", max-file: "5" }

x-node-common: &node-common
  restart: unless-stopped
  read_only: true
  tmpfs: ["/tmp"]
  security_opt: ["no-new-privileges:true"]
  logging: *logging

services:
  postgres:
    # PostgreSQL 18. From 18 on the image keeps the cluster under /var/lib/postgresql/<major>/docker, so
    # the volume is mounted one level up and a later major can pg_upgrade inside it. A cluster from the
    # earlier pgdata volume (PostgreSQL 16) is moved over by scripts/pg-major-upgrade.mjs.
    image: postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
    restart: unless-stopped
    logging: *logging
    mem_limit: 1g
    memswap_limit: 1g
    pids_limit: 256
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
      KORBAT_MIGRATE_DB_PASSWORD: ${KORBAT_MIGRATE_DB_PASSWORD}
      KORBAT_API_DB_PASSWORD: ${KORBAT_API_DB_PASSWORD}
      KORBAT_AUTH_DB_PASSWORD: ${KORBAT_AUTH_DB_PASSWORD}
    volumes:
      - pgdata18:/var/lib/postgresql
      - ./postgres/init:/docker-entrypoint-initdb.d:ro
    networks: [data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    # Valkey, the BSD-licensed fork of Redis, under the service name the URLs already use. A password
    # is required: nothing on the data network may read the session cache without it.
    image: valkey/valkey:9.1.2-alpine@sha256:48332870af354a799964c0012ae1194a0bf2bf894eb508f945810596dc2d8d11
    restart: unless-stopped
    logging: *logging
    mem_limit: 384m
    memswap_limit: 384m
    pids_limit: 64
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD:?set REDIS_PASSWORD in infra/.env}
    command: ["sh", "-c", "exec valkey-server --appendonly yes --maxmemory 256mb --maxmemory-policy noeviction --requirepass $$REDIS_PASSWORD"]
    volumes:
    # A fresh volume: Valkey 9 cannot read the RDB format 12 that Redis 7.4 wrote into `redisdata`, and that
    # volume held only transient state (limits, codes in flight, cached sessions, queued image jobs).
      - valkeydata:/data
    networks: [data]
    healthcheck:
      test: ["CMD-SHELL", "VALKEYCLI_AUTH=$$REDIS_PASSWORD valkey-cli ping | grep -q PONG"]
      interval: 5s
      timeout: 3s
      retries: 20

  migrate:
    <<: *node-common
    restart: "no"
    build:
      context: ..
      dockerfile: apps/api/Dockerfile
    command: ["node", "dist/migrate.js"]
    environment:
      DATABASE_URL_MIGRATE: postgres://korbat_migrate:${KORBAT_MIGRATE_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      MIGRATIONS_DIR: /app/migrations
    networks: [data]
    depends_on:
      postgres: { condition: service_healthy }

  api:
    <<: *node-common
    build:
      context: ..
      dockerfile: apps/api/Dockerfile
      args:
        KORBAT_VERSION: ${KORBAT_VERSION:-0.0.0}
    mem_limit: 512m
    memswap_limit: 512m
    pids_limit: 256
    environment:
      # development or production, from infra/.env; production turns on the guards against test keys, plain-http
      # origins and a relay without TLS. The worker below always runs as production.
      NODE_ENV: ${KORBAT_ENV:?set KORBAT_ENV to development or production in infra/.env}
      PORT: "3000"
      LOG_LEVEL: ${API_LOG_LEVEL:-info}
      DATABASE_URL_API: postgres://korbat_api:${KORBAT_API_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      DATABASE_URL_AUTH: postgres://korbat_auth:${KORBAT_AUTH_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      TRUSTED_ORIGINS: ${API_TRUSTED_ORIGINS:-}
      # Which header names the client: the stack refuses to start without a choice.
      TRUST_PROXY: ${API_TRUST_PROXY:?set API_TRUST_PROXY in infra/.env}
      # Auth settings. The stack refuses to start while any of these is missing from infra/.env.
      APP_ORIGIN: ${API_APP_ORIGIN:?set API_APP_ORIGIN in infra/.env}
      AUTH_HMAC_KEY: ${API_AUTH_HMAC_KEY:?set API_AUTH_HMAC_KEY in infra/.env}
      IP_HASH_KEY: ${API_IP_HASH_KEY:?set API_IP_HASH_KEY in infra/.env}
      TOTP_ENC_KEY: ${API_TOTP_ENC_KEY:?set API_TOTP_ENC_KEY in infra/.env}
      TOTP_ENC_KEYS_PREVIOUS: ${API_TOTP_ENC_KEYS_PREVIOUS:-}
      TURNSTILE_SECRET_KEY: ${API_TURNSTILE_SECRET_KEY:?set API_TURNSTILE_SECRET_KEY in infra/.env}
      SMTP_URL: ${API_SMTP_URL:?set API_SMTP_URL in infra/.env}
      MAIL_FROM: ${API_MAIL_FROM:?set API_MAIL_FROM in infra/.env}
      TERMS_VERSION: ${API_TERMS_VERSION:?set API_TERMS_VERSION in infra/.env}
      # The verified badge's phone check. off (the default) hides the badge; vonage needs the two credentials.
      VERIFY_PROVIDER: ${API_VERIFY_PROVIDER:-off}
      VONAGE_API_KEY: ${API_VONAGE_API_KEY:-}
      VONAGE_API_SECRET: ${API_VONAGE_API_SECRET:-}
      VERIFY_BRAND: ${API_VERIFY_BRAND:-korbat}
      # Images. The API writes uploads and only reads what the worker stored.
      MEDIA_UPLOADS_DIR: /media/uploads
      MEDIA_STORE_DIR: /media/store
      MEDIA_FORMATS: ${MEDIA_FORMATS:-jpeg,png,webp,gif,avif}
      MEDIA_MIN_FREE_BYTES: ${MEDIA_MIN_FREE_BYTES:-2147483648}
      MEDIA_RECONCILE: ${MEDIA_RECONCILE:-on}
    volumes:
      - media-uploads:/media/uploads
      - media-store:/media/store:ro
    networks: [app, data]
    depends_on:
      migrate: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]
      interval: 10s
      timeout: 3s
      retries: 10

  # The image worker runs the decoder, the most exploitable code in the stack. It has no network at
  # all, no credentials and no capabilities: it reads uploads and writes the store, and that is
  # everything it can reach. The memory limit was sized on worst-case images (2b design, Research).
  worker:
    <<: *node-common
    build:
      context: ..
      dockerfile: apps/worker/Dockerfile
    network_mode: none
    cap_drop: [ALL]
    mem_limit: 768m
    memswap_limit: 768m
    cpus: 1.0
    pids_limit: 64
    tmpfs: ["/tmp:size=64m"]
    environment:
      NODE_ENV: production
      LOG_LEVEL: ${API_LOG_LEVEL:-info}
      MEDIA_UPLOADS_DIR: /media/uploads
      MEDIA_STORE_DIR: /media/store
      MEDIA_FORMATS: ${MEDIA_FORMATS:-jpeg,png,webp,gif,avif}
    volumes:
      - media-uploads:/media/uploads:ro
      - media-store:/media/store
    healthcheck:
      test: ["CMD", "node", "-e", "process.exit(Date.now() - JSON.parse(require('fs').readFileSync('/media/store/heartbeat', 'utf8')).at < 60000 ? 0 : 1)"]
      interval: 15s
      timeout: 5s
      retries: 4

  # Caddy serves the web app and proxies /api. It runs as its own user on port 8080, sees only the
  # API, and is the only thing cloudflared can reach.
  caddy:
    restart: unless-stopped
    read_only: true
    tmpfs: ["/tmp"]
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    logging: *logging
    mem_limit: 128m
    memswap_limit: 128m
    pids_limit: 64
    build:
      context: ..
      dockerfile: infra/caddy/Dockerfile
      args:
        EXPO_PUBLIC_TURNSTILE_SITE_KEY: ${WEB_TURNSTILE_SITE_KEY:?set WEB_TURNSTILE_SITE_KEY in infra/.env}
        KORBAT_ENV: ${KORBAT_ENV:?set KORBAT_ENV to development or production in infra/.env}
        TUNNEL: ${TUNNEL:-off}
        EXPO_PUBLIC_BADGE: ${WEB_BADGE:-on}
    depends_on:
      api: { condition: service_healthy }
    volumes:
      - caddy-data:/data
      - caddy-config:/config
    networks: [edge, app]

  cloudflared:
    image: cloudflare/cloudflared:2026.9.1@sha256:b269e8abd07a5bf6f3f4be65d5050b2174eca89c56a0241a8ff32a16aec454e4
    restart: unless-stopped
    read_only: true
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    logging: *logging
    profiles: ["tunnel"]
    command: ["tunnel", "--no-autoupdate", "run"]
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN}
    networks: [edge]
    depends_on:
      - caddy

# cloudflared reaches only Caddy, Caddy reaches only the API, and the API alone reaches the data services.
networks:
  edge:
  app:
  data:

volumes:
  # PostgreSQL 18. The earlier pgdata volume (PostgreSQL 16) stays until scripts/pg-major-upgrade.mjs has
  # moved it and you remove it by hand.
  pgdata18:
  valkeydata:
  # Uploads wait here for the worker and are deleted once processed. Nothing in it needs a backup.
  media-uploads:
  # The images korbat serves. Back it up together with the database.
  media-store:
  # Caddy's state, owned by its own user; the earlier root-owned caddydata and caddyconfig volumes can go.
  caddy-data:
  caddy-config:
```

## Step 4: verify: typecheck

```bash
pnpm typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`
- `ERR_PNPM`

Observed on the dry run:

```text
(no output)
```

## Step 5: verify: test

```bash
pnpm test
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
packages/rules test:       Tests  4 passed (4)
packages/contracts test:       Tests  63 passed (63)
packages/db test:       Tests  22 passed (22)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  23 passed (23)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  246 passed | 183 skipped (429)
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

Observed on the dry run:

```text
Exported: dist
```

## Step 7: verify: compose-config

```bash
docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo config-ok
```

Expected output contains:

- `config-ok`

Observed on the dry run:

```text
config-ok
```

## Step 8: verify: stack-down

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok
```

Expected output contains:

- `down-ok`

Observed on the dry run:

```text
down-ok
```

## Step 9: verify: build

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml build > .data/stack-build.log 2>&1; echo build-exit=$?; tail -3 .data/stack-build.log
```

Expected output contains:

- `build-exit=0`

Observed on the dry run:

```text
build-exit=0
```

## Step 10: verify: stack-up

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok
```

Expected output contains:

- `up-ok`

Observed on the dry run:

```text
up-ok
```

## Step 11: verify: test-database

```bash
node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `migrations applied`
- `test database ready: korbat_test`

Observed on the dry run:

```text
migrations applied
test database ready: korbat_test
```

## Step 12: verify: smoke

```bash
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --mailpit http://localhost:58025 --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `smoke test passed`

Observed on the dry run:

```text
smoke test passed
```

## Step 13: verify: stack-stop

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml stop caddy api worker cloudflared 2>/dev/null; docker compose -f infra/compose.yml -f infra/compose.dev.yml ps --format '{{.Name}} {{.Status}}'
```

Expected output contains:

- `postgres-1 Up`

Observed on the dry run:

```text
korbat-postgres-1 Up 50 seconds (healthy)
```

## Step 14: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/app/src/app/settings/account.tsx`
- `apps/app/src/app/settings/privacy.tsx`
- `apps/app/src/app/settings/profile.tsx`
- `apps/app/src/app/settings/security.tsx`
- `apps/app/src/app/u/[handle]/index.tsx`
- `apps/app/src/components/SettingsNav.tsx`
- `apps/app/src/components/social/PostCard.tsx`
- `apps/app/src/components/ui.tsx`
- `apps/app/src/lib/api.ts`
- `apps/app/src/lib/download.ts`
- `apps/app/src/lib/social.ts`
- `apps/app/src/lib/terms.ts`
- `apps/app/test/lifecycle.test.tsx`
- `infra/.env.example`
- `infra/caddy/Dockerfile`
- `infra/compose.yml`

## Step 15: commit

```bash
git add -A
git commit -q -m "feat(app): Settings gains a navigation row and two screens: Profile (display name, bio, a handle change with the date the next one is allowed) and Account (email change, the verified badge with what it means and where the number goes, the data export saved as a download, deletion behind a code and the typed handle); posts and profiles show a Verified chip; the terms name the verification provider, the export and the deletion; WEB_BADGE lets a build without a provider leave the badge section out" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(app): Settings gains a navigation row and two screens: Profile (display name, bio, a handle change with the date the next one is allowed) and Account (email change, the verified badge with what it means and where the number goes, the data export saved as a download, deletion behind a code and the typed handle); posts and profiles show a Verified chip; the terms name the verification provider, the export and the deletion; WEB_BADGE lets a build without a provider leave the badge section out`.

## Report format (mandatory)

```text
TASK 7 REPORT
Files written: <count, expected 16>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "compose-config": <paste the expected lines as printed>
Verify "stack-down": <paste the expected lines as printed>
Verify "build": <paste the expected lines as printed>
Verify "stack-up": <paste the expected lines as printed>
Verify "test-database": <paste the expected lines as printed>
Verify "smoke": <paste the expected lines as printed>
Verify "stack-stop": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```

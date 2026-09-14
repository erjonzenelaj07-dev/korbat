# korbat 1a — Task 20 of 21: Web auth screens: email entry with Turnstile, code, age and terms, handle, password, MFA, security settings, terms, 'this wasn't me'

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-14 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

The web app gains the 1a screens: email entry with Turnstile, code entry with a resend cooldown, age and terms, handle choice, password sign-in, the MFA challenge, security settings (sessions, two-factor with QR and recovery codes, password, sign out everywhere, re-authentication), draft terms, and the 'this wasn't me' confirmation. The web client never reads the session token and keeps flow state out of URLs.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. Only the exact `pnpm add` commands printed below may change dependencies. Never edit `pnpm-workspace.yaml` or `.npmrc`.
- Pinned by this task: @marsidev/react-turnstile 1.6.1, zod 4.5.4 (already locked for @korbat/contracts).

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(infra): ship argon2 and the grant-role CLI in the API image; auth settings in compose; Turnstile in the CSP; auth smoke test`.
3. The previous task's last API unit run ended with `Tests  88 passed | 67 skipped (155)`.

## Rules (read twice)

1. Copy every file below byte for byte. Each block is the complete file: create it, or replace the existing file entirely.
2. Run every command exactly as written, in order, from the repo root.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the files

### Create `apps/app/src/app/(auth)/_layout.tsx`

```tsx
import { Redirect, Stack, usePathname } from "expo-router";
import { Loading } from "@/components/ui";
import { useSession } from "@/lib/session";

/**
 * Screens for people who are not fully signed in. A signed-in account that still needs a handle is
 * sent to /handle; a finished account goes to its security settings.
 */
export default function AuthLayout() {
  const { state } = useSession();
  const pathname = usePathname();

  if (state.status === "loading") return <Loading />;
  if (state.status === "signed-in") {
    if (state.me.user.onboarded) return <Redirect href="/settings/security" />;
    if (pathname !== "/handle") return <Redirect href="/handle" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

### Create `apps/app/src/app/(auth)/age.tsx`

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

  if (!flowId && !refused) return <Redirect href="/" />;

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

### Create `apps/app/src/app/(auth)/code.tsx`

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

  if (!flowId || !email) return <Redirect href="/" />;

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
        router.replace(session.status === "signed-in" && session.me.user.onboarded ? "/settings/security" : "/handle");
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
        <TextLink label="Send a new code" onPress={() => router.replace("/")} />
      )}
      <TextLink label="Use a different email" onPress={() => { flow.clear(); router.replace("/"); }} />
    </Screen>
  );
}
```

### Create `apps/app/src/app/(auth)/handle.tsx`

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
  if (state.status === "signed-out") return <Redirect href="/" />;

  const normalized = handle.trim().replace(/^@/, "").toLowerCase();
  const valid = HANDLE.test(normalized) && displayName.trim().length > 0;

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/onboarding/handle", { json: { handle: normalized, displayName: displayName.trim() }, schema: OnboardingHandleResponse });
      await refresh();
      router.replace("/settings/security");
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

### Create `apps/app/src/app/(auth)/index.tsx`

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
    </Screen>
  );
}
```

### Create `apps/app/src/app/(auth)/mfa.tsx`

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

  if (!mfaTicket) return <Redirect href="/" />;

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
      else router.replace(result.mustReenrollMfa ? "/settings/security?reenroll=1" : "/settings/security");
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.code === "too_many_attempts") {
        flow.set({ mfaTicket: undefined });
        router.replace("/");
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

### Create `apps/app/src/app/(auth)/password.tsx`

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
      router.replace(session.status === "signed-in" && session.me.user.onboarded ? "/settings/security" : "/handle");
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
      <TextLink label="Email me a code instead" onPress={() => router.replace("/")} />
    </Screen>
  );
}
```

### Create `apps/app/src/app/not-me/[token].tsx`

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
        <Button label="Sign in" onPress={() => router.replace("/")} />
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

### Create `apps/app/src/app/settings/_layout.tsx`

```tsx
import { Redirect, Stack } from "expo-router";
import { Loading } from "@/components/ui";
import { useSession } from "@/lib/session";

/** Settings need a finished account: signed out goes to sign-in, no handle yet goes to onboarding. */
export default function SettingsLayout() {
  const { state } = useSession();
  if (state.status === "loading") return <Loading />;
  if (state.status === "signed-out") return <Redirect href="/" />;
  if (!state.me.user.onboarded) return <Redirect href="/handle" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

### Create `apps/app/src/app/settings/security.tsx`

```tsx
import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { MfaSection } from "@/components/security/MfaSection";
import { PasswordSection } from "@/components/security/PasswordSection";
import { ReauthPanel, useReauth } from "@/components/security/ReauthPanel";
import { SessionsSection } from "@/components/security/SessionsSection";
import { Button, Loading } from "@/components/ui";
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
    <ScrollView className="flex-1 bg-zinc-950" contentContainerClassName="items-center px-6 py-10">
      <View className="w-full max-w-xl">
        <Text accessibilityRole="header" className="text-3xl font-bold tracking-tight text-zinc-50">
          Security
        </Text>
        <Text className="mt-2 text-base text-zinc-400">
          @{me.profile?.handle} · {me.user.email}
        </Text>

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
      </View>
    </ScrollView>
  );
}
```

### Create `apps/app/src/app/terms.tsx`

```tsx
import { ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { TextLink } from "@/components/ui";
import { TERMS_SECTIONS, TERMS_VERSION } from "@/lib/terms";

export default function Terms() {
  return (
    <ScrollView className="flex-1 bg-zinc-950" contentContainerClassName="items-center px-6 py-10">
      <View className="w-full max-w-xl">
        <Text accessibilityRole="header" className="text-3xl font-bold tracking-tight text-zinc-50">
          korbat terms
        </Text>
        <Text className="mt-2 text-sm text-zinc-500">Version {TERMS_VERSION}</Text>
        {TERMS_SECTIONS.map((section) => (
          <View key={section.title} className="mt-8">
            <Text accessibilityRole="header" className="text-lg font-semibold text-zinc-100">
              {section.title}
            </Text>
            <Text className="mt-2 text-base leading-7 text-zinc-300">{section.body}</Text>
          </View>
        ))}
        <TextLink label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
      </View>
    </ScrollView>
  );
}
```

### Create `apps/app/src/components/security/MfaSection.tsx`

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
              void clipboard.writeText(stage.recoveryCodes.join("\n")).then(() => setCopied(true));
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

### Create `apps/app/src/components/security/PasswordSection.tsx`

```tsx
import { useState } from "react";
import { View } from "react-native";
import { PasswordSetResponse, type MeResponse } from "@korbat/contracts";
import { Body, Button, ErrorText, Field, Notice } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

export function PasswordSection({
  me,
  run,
  refresh,
}: {
  me: MeResponse;
  run: (action: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<unknown>;
}) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const length = [...password].length;
  const mismatch = repeat.length > 0 && repeat !== password;
  const ready = length >= 12 && length <= 128 && password === repeat;

  async function save() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await run(async () => {
        await api("/api/auth/password/set", { json: { password }, schema: PasswordSetResponse });
        setPassword("");
        setRepeat("");
        setDone(me.user.hasPassword ? "Password changed." : "Password set. You can now sign in with it.");
        await refresh();
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Body>
        {me.user.hasPassword
          ? "You can sign in with your password or an emailed code."
          : "You sign in with emailed codes. A password is optional: 12 to 128 characters, checked against known breaches."}
      </Body>
      <Field label={me.user.hasPassword ? "New password" : "Password"} autoComplete="new-password" secureTextEntry value={password} onChangeText={setPassword} />
      <Field label="Repeat password" autoComplete="new-password" secureTextEntry value={repeat} onChangeText={setRepeat} onSubmitEditing={save} />
      <ErrorText message={mismatch ? "The passwords don't match." : error} />
      <Notice message={done} />
      <Button label={me.user.hasPassword ? "Change password" : "Set password"} onPress={() => void save()} busy={busy} disabled={!ready} />
    </View>
  );
}
```

### Create `apps/app/src/components/security/QrCode.tsx`

```tsx
import { Image } from "react-native";

/** The authenticator QR code, drawn from the server's SVG. Native apps use React Native's Image. */
export function QrCode({ svg, size }: { svg: string; size: number }) {
  return (
    <Image
      accessibilityLabel="QR code for your authenticator app"
      source={{ uri: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` }}
      style={{ width: size, height: size }}
    />
  );
}
```

### Create `apps/app/src/components/security/QrCode.web.tsx`

```tsx
/**
 * Web: a plain <img>. React Native Web's Image never drew the roughly 25 KB SVG data address a TOTP
 * QR code needs, while the browser loads the same address directly. The CSP allows data: images.
 */
export function QrCode({ svg, size }: { svg: string; size: number }) {
  return <img alt="QR code for your authenticator app" src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} width={size} height={size} />;
}
```

### Create `apps/app/src/components/security/ReauthPanel.tsx`

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
            accessibilityState={{ selected: m === method }}
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

### Create `apps/app/src/components/security/SessionsSection.tsx`

```tsx
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { SessionsResponse, type SessionInfo } from "@korbat/contracts";
import { Button, ErrorText } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

const PLATFORM: Record<SessionInfo["platform"], string> = { web: "Web", ios: "iPhone or iPad", android: "Android" };

export function SessionsSection({ run, refresh }: { run: (action: () => Promise<void>) => Promise<void>; refresh: () => Promise<unknown> }) {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSessions((await api("/api/auth/sessions", { schema: SessionsResponse })).sessions);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    setError(null);
    try {
      await api(`/api/auth/sessions/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function signOutEverywhere() {
    setBusy(true);
    setError(null);
    try {
      await run(async () => {
        await api("/api/auth/sessions/revoke-all", { method: "POST" });
        await refresh();
        router.replace("/");
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      {sessions === null ? <Text className="mt-3 text-sm text-zinc-400">Loading sessions…</Text> : null}
      {sessions?.map((s) => (
        <View key={s.id} className="mt-3 flex-row items-center justify-between rounded-lg border border-zinc-800 px-4 py-3">
          <View className="flex-1 pr-3">
            <Text className="text-base text-zinc-50">
              {s.deviceLabel}
              {s.current ? <Text className="text-sm text-emerald-400">  · this device</Text> : null}
            </Text>
            <Text className="mt-1 text-xs text-zinc-400">
              {PLATFORM[s.platform]} · signed in {new Date(s.createdAt).toLocaleDateString()} · last active {new Date(s.lastUsedAt).toLocaleString()}
            </Text>
          </View>
          {s.current ? null : (
            <Text accessibilityRole="button" onPress={() => void revoke(s.id)} className="text-sm text-red-400 underline">
              Sign out
            </Text>
          )}
        </View>
      ))}
      <ErrorText message={error} />
      <Button label="Sign out everywhere" onPress={() => void signOutEverywhere()} busy={busy} tone="danger" />
    </View>
  );
}
```

### Create `apps/app/src/components/ui.tsx`

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
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: inactive, busy }} disabled={inactive} onPress={onPress} className={`mt-6 rounded-lg px-4 py-3 ${surface}`}>
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

### Create `apps/app/src/lib/flow.ts`

```ts
/**
 * State of the sign-in flow between screens. Kept in memory, never in the URL, so email addresses,
 * flow ids and MFA tickets do not end up in browser history. A page reload starts the flow over.
 */
export interface FlowState {
  email?: string;
  flowId?: string;
  mfaTicket?: string;
}

let state: FlowState = {};

export const flow = {
  get(): FlowState {
    return state;
  },
  set(patch: FlowState): void {
    state = { ...state, ...patch };
  },
  clear(): void {
    state = {};
  },
};
```

### Create `apps/app/src/lib/session.tsx`

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MeResponse } from "@korbat/contracts";
import { api, ApiError } from "./api";

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

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  const refresh = useCallback(async () => {
    const next = await loadSession().catch((): SessionState => ({ status: "signed-out" }));
    setState(next);
    return next;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ state, refresh }), [state, refresh]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
```

### Create `apps/app/src/lib/terms.ts`

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
    body: "korbat stores your email address for sign-in and security messages, and never shows it to other people. IP addresses are stored only as keyed hashes. Your date of birth is checked once and never stored.",
  },
];
```

### Replace `apps/app/src/app/_layout.tsx` (whole file)

```tsx
import "../../global.css";
import { Stack } from "expo-router";
import { SessionProvider } from "@/lib/session";

export default function RootLayout() {
  return (
    <SessionProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </SessionProvider>
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
  /** Schema for a JSON response body. Omit for 204 responses. */
  schema?: z.ZodType<T>;
}

/**
 * Calls the API with the session cookie. State-changing requests echo the CSRF cookie in
 * X-CSRF-Token; the session cookie itself is HttpOnly and never readable here.
 */
export async function api<T = void>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const method = options.method ?? (options.json === undefined ? "GET" : "POST");
  const headers: Record<string, string> = {};
  if (options.json !== undefined) headers["content-type"] = "application/json";
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
      body: options.json === undefined ? undefined : JSON.stringify(options.json),
    });
  } catch {
    throw new ApiError(0, "network", messageFor("network"));
  }

  if (!res.ok) {
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

## Step 2: delete `apps/app/src/app/index.tsx`

```bash
git rm -q apps/app/src/app/index.tsx
```

Expected: no output.

## Step 3: verify: deps

```bash
pnpm --filter @korbat/app add -E --config.minimum-release-age=0 @marsidev/react-turnstile@1.6.1 zod@4.5.4 2>&1 | tail -3; grep -E '"(@marsidev/react-turnstile|zod)"' apps/app/package.json; node scripts/check-lockfile-age.mjs --base HEAD
```

Expected output contains:

- `"@marsidev/react-turnstile": "1.6.1"`
- `"zod": "4.5.4"`
- `all at least 7 days old`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
"@marsidev/react-turnstile": "1.6.1",
"zod": "4.5.4"
1 new package versions since HEAD; all at least 7 days old
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

## Step 5: verify: export

```bash
cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx expo export --platform web 2>&1 | tail -8
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

## Step 6: verify: api-unchanged

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  88 passed | 67 skipped (155)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  88 passed | 67 skipped (155)
```

## Step 7: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/app/package.json`
- `apps/app/src/app/(auth)/_layout.tsx`
- `apps/app/src/app/(auth)/age.tsx`
- `apps/app/src/app/(auth)/code.tsx`
- `apps/app/src/app/(auth)/handle.tsx`
- `apps/app/src/app/(auth)/index.tsx`
- `apps/app/src/app/(auth)/mfa.tsx`
- `apps/app/src/app/(auth)/password.tsx`
- `apps/app/src/app/_layout.tsx`
- `apps/app/src/app/index.tsx`
- `apps/app/src/app/not-me/[token].tsx`
- `apps/app/src/app/settings/_layout.tsx`
- `apps/app/src/app/settings/security.tsx`
- `apps/app/src/app/terms.tsx`
- `apps/app/src/components/security/MfaSection.tsx`
- `apps/app/src/components/security/PasswordSection.tsx`
- `apps/app/src/components/security/QrCode.tsx`
- `apps/app/src/components/security/QrCode.web.tsx`
- `apps/app/src/components/security/ReauthPanel.tsx`
- `apps/app/src/components/security/SessionsSection.tsx`
- `apps/app/src/components/ui.tsx`
- `apps/app/src/lib/api.ts`
- `apps/app/src/lib/flow.ts`
- `apps/app/src/lib/session.tsx`
- `apps/app/src/lib/terms.ts`
- `pnpm-lock.yaml`

## Step 8: commit

```bash
git add -A
git commit -q -m "feat(app): web sign-up and sign-in with Turnstile, onboarding, MFA challenge, security settings, terms and 'this wasn't me'" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(app): web sign-up and sign-in with Turnstile, onboarding, MFA challenge, security settings, terms and 'this wasn't me'`.

## Report format (mandatory)

```text
TASK 20 REPORT
Files written: <count, expected 23>
Verify "deps": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "api-unchanged": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```

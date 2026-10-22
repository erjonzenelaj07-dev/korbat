import { useCallback, useEffect, useRef, useState } from "react";
import { View, type TextInputProps } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { FlowResponse, PasskeyOptionsResponse, SignInResponse, type AuthenticationResponseJSON } from "@korbat/contracts";
import { Body, Button, ErrorText, Field, Screen, TextLink, Title } from "@/components/ui";
import { api, ApiError, deviceId, errorMessage, platform } from "@/lib/api";
import { flow } from "@/lib/flow";
import { abortPasskeyRequest, autofillPasskey, autofillSupported, confirmWithPasskey, createAutofillScheduler, passkeysSupported } from "@/lib/passkeys";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";

const SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/** The browser offers the passkeys it holds in the email field's autofill when the field's autocomplete ends with "webauthn"; React Native's type does not list the pair. */
const EMAIL_AUTOFILL = "email webauthn" as unknown as TextInputProps["autoComplete"];

type Outcome = "done" | "expired" | "failed";

/** The single entry point: one email field for both sign-up and sign-in, and a passkey where the browser has them. */
export default function EmailEntry() {
  const { refresh } = useSession();
  const turnstile = useRef<TurnstileInstance | null>(null);
  // The human check is drawn light in Light and dark in Dim and Dark, like the page around it.
  const theme = useTheme();
  const [email, setEmail] = useState(flow.get().email ?? "");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Decided once: the button and the autofill exist only in a browser with WebAuthn.
  const [passkeys] = useState(passkeysSupported);

  /**
   * Verifies a passkey's response as the password sign-in handles its answer: a session, or the TOTP step with its
   * ticket. Answers how it ended, for the autofill's schedule.
   */
  const signIn = useCallback(
    async (response: AuthenticationResponseJSON): Promise<Outcome> => {
      try {
        const result = await api("/api/auth/passkey/signin/verify", { json: { response, deviceId: deviceId(), platform }, schema: SignInResponse });
        if (result.result === "mfa_required") {
          flow.set({ mfaTicket: result.mfaTicket });
          router.replace("/mfa");
          return "done";
        }
        flow.clear();
        const session = await refresh();
        router.replace(session.status === "signed-in" && session.me.user.onboarded ? "/" : "/handle");
        return "done";
      } catch (err) {
        setError(errorMessage(err));
        return err instanceof ApiError && err.code === "challenge_expired" ? "expired" : "failed";
      }
    },
    [refresh],
  );

  // One controller owns the conditional request (1c design, section 9); it is created once, and everything its runs touch is stable across renders.
  const [scheduler] = useState(() =>
    createAutofillScheduler({
      start: (run) => void runAutofill(run),
      abort: abortPasskeyRequest,
      after: (callback, ms) => {
        const timer = setTimeout(callback, ms);
        return () => clearTimeout(timer);
      },
    }),
  );

  /** One conditional request: the options, the browser's autofill until a passkey is picked or the request is aborted, then the verification. */
  async function runAutofill(run: number): Promise<void> {
    let options;
    try {
      options = (await api("/api/auth/passkey/signin/options", { method: "POST", schema: PasskeyOptionsResponse })).options;
    } catch {
      // The person did nothing yet, so nothing is said; the schedule rests until the screen is focused again.
      scheduler.ended(run, "failed");
      return;
    }
    // The screen went away, or the button took over, while the options were fetched: no ceremony now.
    if (!scheduler.isCurrent(run)) return;
    let response: AuthenticationResponseJSON | null;
    try {
      response = await autofillPasskey(options);
    } catch {
      scheduler.ended(run, "failed");
      return;
    }
    // Aborted, in which case the schedule has moved on already, or closed without a choice: nothing to verify.
    if (response === null) {
      scheduler.ended(run, "failed");
      return;
    }
    scheduler.ended(run, await signIn(response));
  }

  // The conditional request lives while the screen is focused and the browser can show one; a screen that goes away aborts it, and unmounting ends it for good.
  useFocusEffect(
    useCallback(() => {
      if (!passkeys) return undefined;
      let away = false;
      void autofillSupported().then((supported) => {
        if (supported && !away) scheduler.focus();
      });
      return () => {
        away = true;
        scheduler.blur();
      };
    }, [passkeys, scheduler]),
  );
  useEffect(() => () => scheduler.dispose(), [scheduler]);

  /** The button's own request: the browser's prompt with every passkey it holds for korbat, then the same verification as the autofill's. */
  async function passkeyButton() {
    if (busy) return;
    setBusy(true);
    setError(null);
    // The conditional request steps aside for the prompt, which the library would otherwise abort itself.
    scheduler.hold();
    let outcome: Outcome = "failed";
    try {
      const { options } = await api("/api/auth/passkey/signin/options", { method: "POST", schema: PasskeyOptionsResponse });
      const response = await confirmWithPasskey(options);
      if (response !== null) outcome = await signIn(response);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      // A signed-in screen is on its way out; anything else lets the autofill come back.
      if (outcome !== "done") scheduler.release();
    }
  }

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
      <Field label="Email" autoComplete={EMAIL_AUTOFILL} autoCapitalize="none" inputMode="email" value={email} onChangeText={setEmail} onSubmitEditing={submit} />
      {passkeys ? <Button label="Sign in with a passkey" onPress={() => void passkeyButton()} busy={busy} tone="secondary" /> : null}
      <View className="mt-6">
        <Turnstile
          ref={turnstile}
          siteKey={SITE_KEY}
          options={{ theme: theme.turnstile, refreshExpired: "manual" }}
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

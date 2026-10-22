import { useState } from "react";
import { Redirect, router } from "expo-router";
import { SessionResult } from "@korbat/contracts";
import { PublicFrame } from "@/components/kit/PublicFrame";
import { Body, Button, ErrorText, Field, TextButton, Title } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { AUTH_WORDS } from "@/lib/auth-words";
import { flow } from "@/lib/flow";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";

/**
 * The second factor at sign-in: an authenticator code, or one of the saved recovery codes. UI Task 8 (8.10): in
 * PublicFrame, the field in the mono face with one-time-code autofill.
 */
export default function MfaChallenge() {
  const { refresh } = useSession();
  const title = usePageTitle("title.mfa");
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
    <PublicFrame>
      {title}
      <Title>{AUTH_WORDS.mfaTitle}</Title>
      <Body>{useRecovery ? AUTH_WORDS.mfaRecovery : AUTH_WORDS.mfaCode}</Body>
      <Field
        label={useRecovery ? "Recovery code" : "Authentication code"}
        mono
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
    </PublicFrame>
  );
}

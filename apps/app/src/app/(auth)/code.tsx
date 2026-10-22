import { useEffect, useState } from "react";
import { Redirect, router } from "expo-router";
import { EmailVerifyResponse } from "@korbat/contracts";
import { PublicFrame } from "@/components/kit/PublicFrame";
import { Body, Button, ErrorText, Field, TextLink, Title } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { AUTH_WORDS } from "@/lib/auth-words";
import { flow } from "@/lib/flow";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";

const RESEND_AFTER_SECONDS = 60;

/** The emailed code (UI Task 8, 8.10: in PublicFrame, the field in the mono face with one-time-code autofill). */
export default function CodeEntry() {
  const { refresh } = useSession();
  const title = usePageTitle("title.code");
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
    <PublicFrame>
      {title}
      <Title>{AUTH_WORDS.codeTitle}</Title>
      <Body>{AUTH_WORDS.codeBody(email)}</Body>
      <Field label="Code" mono autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} onSubmitEditing={submit} />
      <ErrorText message={error} />
      <Button label="Continue" onPress={submit} busy={busy} disabled={!/^\d{6}$/.test(code.trim())} />
      {wait > 0 ? (
        <Body>{AUTH_WORDS.codeWait(wait)}</Body>
      ) : (
        <TextLink label="Send a new code" href="/signin" replace />
      )}
      <TextLink label="Use a different email" href="/signin" replace onPress={() => flow.clear()} />
    </PublicFrame>
  );
}

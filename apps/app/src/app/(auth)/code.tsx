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

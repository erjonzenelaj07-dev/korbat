import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Body, Button, ErrorText, Screen, TextLink, Title } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

/**
 * Opened from the link in the "email address changed" notice, which goes to the address the account
 * had. The link is the only credential needed, because an account without a password can no longer
 * sign in at that address. Nothing happens until the person confirms.
 */
export default function EmailRevert() {
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
      await api("/api/auth/email/revert", { json: { token } });
      setDone(true);
      // This browser's own session, if it had one, was signed out with the others.
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
        <Title>Your account is back at this address</Title>
        <Body>
          Every session is signed out, including any in this browser. Sign in again with a code sent to this address. Your password was removed, and so were any passkeys and
          two-factor authentication set up since the day before the change; set them up again from Security.
        </Body>
        <Button label="Sign in" onPress={() => router.replace("/signin")} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Undo the email change</Title>
      <Body>
        If you did not move your korbat account to a new email address, confirm below. We will move it back to the address this link was sent to, sign out every session,
        including this browser, remove your password, and remove any passkeys and two-factor authentication set up since the day before the change.
      </Body>
      <ErrorText message={valid ? error : "This link is incomplete. Open it again from the email."} />
      <Button label="Move my account back to this address" onPress={() => void confirm()} busy={busy} disabled={!valid} tone="danger" />
      <TextLink label="It was me, go back" href="/" replace />
    </Screen>
  );
}

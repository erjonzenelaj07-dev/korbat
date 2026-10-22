import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { PublicFrame } from "@/components/kit/PublicFrame";
import { Body, Button, ErrorText, TextLink, Title } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { LINK_WORDS, PASSKEY_REMOVE_WORDS } from "@/lib/lockdown-words";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";

/**
 * Opened from the link in the "passkey added" notice (1c design, section 7.6). The link is the only credential
 * needed; it works for 7 days, and still once the passkey is gone. Nothing happens until the person confirms. In
 * PublicFrame since UI Task 8 (8.10), titled korbat alone, so the tab says nothing of what the link does.
 */
export default function PasskeyRemove() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { refresh } = useSession();
  const title = usePageTitle("title.token");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const valid = typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);

  async function confirm() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/passkeys/remove-link", { json: { token } });
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
      <PublicFrame>
        {title}
        <Title>{PASSKEY_REMOVE_WORDS.doneTitle}</Title>
        <Body>{PASSKEY_REMOVE_WORDS.doneBody}</Body>
        <Button label={LINK_WORDS.signIn} onPress={() => router.replace("/signin")} />
      </PublicFrame>
    );
  }

  return (
    <PublicFrame>
      {title}
      <Title>{PASSKEY_REMOVE_WORDS.title}</Title>
      <Body>{PASSKEY_REMOVE_WORDS.body}</Body>
      <ErrorText message={valid ? error : LINK_WORDS.incomplete} />
      <Button label={PASSKEY_REMOVE_WORDS.confirm} onPress={() => void confirm()} busy={busy} disabled={!valid} tone="danger" />
      <TextLink label={LINK_WORDS.itWasMe} href="/" replace />
    </PublicFrame>
  );
}

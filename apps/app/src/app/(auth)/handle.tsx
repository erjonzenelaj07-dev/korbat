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

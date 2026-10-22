import { useState } from "react";
import { View } from "react-native";
import { Redirect, router } from "expo-router";
import { OnboardingHandleResponse } from "@korbat/contracts";
import { PublicFrame } from "@/components/kit/PublicFrame";
import { Text } from "@/components/kit/Text";
import { Body, Button, ErrorText, Field, Loading, Title } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { AUTH_WORDS } from "@/lib/auth-words";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";

const HANDLE = /^[a-z0-9_]{3,20}$/;

/**
 * The handle step of sign-up, one step as before (UI Task 8, 8.10): in PublicFrame, with a live preview of the handle in
 * the mono face as it will be sent (the @ dropped, lower case), so the reader sees how it will look; handles are set in
 * that face everywhere, so look-alike handles differ at a glance.
 */
export default function ChooseHandle() {
  const { state, refresh } = useSession();
  const title = usePageTitle("title.handle");
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status === "loading") return <Loading />;
  if (state.status === "signed-out") return <Redirect href="/signin" />;

  const normalized = handle.trim().replace(/^@/, "").toLowerCase();
  const valid = HANDLE.test(normalized) && displayName.trim().length > 0;

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/onboarding/handle", { json: { handle: normalized, displayName: displayName.trim() }, schema: OnboardingHandleResponse });
      await refresh();
      router.replace("/");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicFrame>
      {title}
      <Title>{AUTH_WORDS.handleTitle}</Title>
      <Body>{AUTH_WORDS.handleBody}</Body>
      <Field label="Handle" mono autoCapitalize="none" autoComplete="username" placeholder="@yourname" value={handle} onChangeText={setHandle} />
      {normalized.length > 0 ? (
        <View className="mt-3 gap-1 rounded-control border border-line-low bg-surface-1 px-4 py-3">
          <Text variant="meta" tone="low">
            {AUTH_WORDS.handlePreview}
          </Text>
          <Text variant="mono" className="web:break-all">{`@${normalized}`}</Text>
        </View>
      ) : null}
      <Field label="Display name" maxLength={50} value={displayName} onChangeText={setDisplayName} onSubmitEditing={submit} />
      <ErrorText message={error} />
      <Button label="Finish" onPress={submit} busy={busy} disabled={!valid} />
    </PublicFrame>
  );
}

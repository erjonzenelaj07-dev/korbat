import { useCallback, useEffect, useState } from "react";
import { Pressable } from "react-native";
import { router } from "expo-router";
import { SessionsResponse, type SessionInfo } from "@korbat/contracts";
import { ListRow } from "@/components/kit/ListRow";
import { NeutralChip } from "@/components/kit/StatusChip";
import { Text } from "@/components/kit/Text";
import { Button, buttonFace, ErrorText, LABEL_TONE, SectionRows } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { SECURITY_WORDS } from "@/lib/settings-words";

/** A session's Sign out, a secondary button beside its row's words, with no margin of its own (Button has one). */
function SignOut({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className={buttonFace({ face: "secondary", size: "md" })}>
      <Text variant="body-strong" tone={LABEL_TONE.secondary}>
        {SECURITY_WORDS.sessionSignOut}
      </Text>
    </Pressable>
  );
}

/**
 * Where the account is signed in (1b design), on the Security screen: each session a row of its own (UI Task 8, 8.8),
 * its device and its platform, when it signed in and was last active, "this device" as a neutral chip on the session in
 * use, and Sign out on every other; then Sign out everywhere, which runs through the re-authentication hook.
 */
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
    <>
      {sessions === null ? (
        <Text tone="low" className="mt-3">
          {SECURITY_WORDS.sessionsLoading}
        </Text>
      ) : (
        <SectionRows>
          {sessions.map((s) => (
            <ListRow
              key={s.id}
              info
              label={s.deviceLabel}
              description={SECURITY_WORDS.sessionFacts(SECURITY_WORDS.platform[s.platform], new Date(s.createdAt).toLocaleDateString(), new Date(s.lastUsedAt).toLocaleString())}
              badge={s.current ? <NeutralChip label={SECURITY_WORDS.thisDevice} /> : undefined}
              control={s.current ? undefined : { kind: "button", element: <SignOut onPress={() => void revoke(s.id)} /> }}
            />
          ))}
        </SectionRows>
      )}
      <ErrorText message={error} />
      <Button label="Sign out everywhere" onPress={() => void signOutEverywhere()} busy={busy} tone="danger" />
    </>
  );
}

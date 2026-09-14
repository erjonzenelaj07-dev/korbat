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

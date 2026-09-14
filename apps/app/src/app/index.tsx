import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { HealthResponse } from "@korbat/contracts";
import { fetchHealth } from "@/lib/api";

export default function Home() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const status = error ? `api unreachable: ${error}` : health ? `api ${health.status} \u00b7 v${health.version}` : "checking api\u2026";

  return (
    <View className="flex-1 items-center justify-center bg-zinc-950 px-6">
      <Text className="text-4xl font-bold tracking-tight text-zinc-50">korbat</Text>
      <Text className="mt-3 text-base text-zinc-400">{status}</Text>
    </View>
  );
}

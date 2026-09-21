import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Redirect, router } from "expo-router";
import { SessionResult } from "@korbat/contracts";
import { Body, Button, ErrorText, Field, Screen, TextLink, Title } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { flow } from "@/lib/flow";
import { useSession } from "@/lib/session";
import { TERMS_VERSION } from "@/lib/terms";

const pad = (value: string, length: number) => value.trim().padStart(length, "0");

/** Date of birth (checked once, never stored) and acceptance of the current terms. */
export default function AgeAndTerms() {
  const { refresh } = useSession();
  const { flowId } = flow.get();
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);

  if (!flowId && !refused) return <Redirect href="/signin" />;

  const dateOfBirth = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
  const complete = /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) && year.trim().length === 4 && accepted;

  async function submit() {
    if (busy || !flowId) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/signup/complete", { json: { flowId, dateOfBirth, termsVersion: TERMS_VERSION }, schema: SessionResult });
      flow.clear();
      await refresh();
      router.replace("/handle");
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.code === "age_requirement") {
        flow.clear();
        setRefused(true);
      }
    } finally {
      setBusy(false);
    }
  }

  if (refused) {
    return (
      <Screen>
        <Title>Sorry</Title>
        <Body>You must be at least 16 to use korbat. No account was created.</Body>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Almost there</Title>
      <Body>Your date of birth is checked once and never stored.</Body>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Field label="Day" inputMode="numeric" maxLength={2} value={day} onChangeText={setDay} />
        </View>
        <View className="flex-1">
          <Field label="Month" inputMode="numeric" maxLength={2} value={month} onChangeText={setMonth} />
        </View>
        <View className="flex-[1.4]">
          <Field label="Year" inputMode="numeric" maxLength={4} value={year} onChangeText={setYear} />
        </View>
      </View>
      <Pressable
        accessibilityRole="checkbox"
        aria-checked={accepted}
        onPress={() => setAccepted((a) => !a)}
        className="mt-6 flex-row items-center gap-3"
      >
        <View className={`h-5 w-5 items-center justify-center rounded border ${accepted ? "border-zinc-50 bg-zinc-50" : "border-zinc-600"}`}>
          {accepted ? <Text className="text-xs font-bold text-zinc-950">✓</Text> : null}
        </View>
        <Text className="flex-1 text-sm text-zinc-300">I accept the korbat terms ({TERMS_VERSION}).</Text>
      </Pressable>
      <TextLink label="Read the terms" onPress={() => router.push("/terms")} />
      <ErrorText message={error} />
      <Button label="Create account" onPress={submit} busy={busy} disabled={!complete} />
    </Screen>
  );
}

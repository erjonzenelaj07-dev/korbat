import { useState } from "react";
import { Pressable, View } from "react-native";
import { Redirect, router } from "expo-router";
import { SessionResult } from "@korbat/contracts";
import { FOCUS_RING } from "@/components/kit/interaction";
import { PublicFrame } from "@/components/kit/PublicFrame";
import { Text } from "@/components/kit/Text";
import { Body, Button, ErrorText, Field, TextLink, Title } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { AUTH_WORDS } from "@/lib/auth-words";
import { flow } from "@/lib/flow";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { TERMS_VERSION } from "@/lib/terms";
import { cn } from "@/theme/cn";

const pad = (value: string, length: number) => value.trim().padStart(length, "0");

/**
 * Date of birth (checked once, never stored) and acceptance of the current terms. UI Task 8 (8.10): in PublicFrame, the
 * terms' checkbox on the tokens with its tick drawn, as the report form's.
 */
export default function AgeAndTerms() {
  const { refresh } = useSession();
  const title = usePageTitle("title.age");
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
      <PublicFrame>
        {title}
        <Title>{AUTH_WORDS.refusedTitle}</Title>
        <Body>{AUTH_WORDS.refusedBody}</Body>
      </PublicFrame>
    );
  }

  return (
    <PublicFrame>
      {title}
      <Title>{AUTH_WORDS.ageTitle}</Title>
      <Body>{AUTH_WORDS.ageBody}</Body>
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
        className={cn("mt-6 min-h-[44px] flex-row items-center gap-3 rounded-control py-1", FOCUS_RING)}
      >
        <View className={cn("h-5 w-5 items-center justify-center rounded-[5px] border-2", accepted ? "border-accent bg-accent" : "border-line-high bg-surface-1")}>
          {/* The tick: two sides of a box turned 45 degrees, in the colour that reads on the accent. */}
          {accepted ? <View className="-mt-0.5 h-2.5 w-1.5 border-b-2 border-r-2 border-on-accent" style={{ transform: [{ rotate: "45deg" }] }} /> : null}
        </View>
        <Text className="flex-1">{AUTH_WORDS.ageAccept(TERMS_VERSION)}</Text>
      </Pressable>
      <TextLink label="Read the terms" href="/terms" />
      <ErrorText message={error} />
      <Button label="Create account" onPress={submit} busy={busy} disabled={!complete} />
    </PublicFrame>
  );
}

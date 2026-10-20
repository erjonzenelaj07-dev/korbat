import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { UploadRefusalView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { UploadNoticeDetail } from "@/components/moderation/UploadNotice";
import { SettingsNav } from "@/components/SettingsNav";
import { ErrorText, Loading, TextLink } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { moderation } from "@/lib/moderation";
import { CASES_WORDS, DECISION_WORDS, UPLOAD_TEXTS } from "@/lib/moderation-words";

type Shown = { kind: "loading" } | { kind: "missing" } | { kind: "failed"; message: string } | { kind: "upload"; view: UploadRefusalView };

/**
 * 3d Task 7 (design, section 9.5): a refused upload's notice, under Settings, Cases; its entry in "About you" and the
 * composer's "Why" lead here. The API answers only for the uploader; anything else reads as one sentence, whatever the id
 * named. "Object" sends the one message and shows the notice as the answer reads it.
 */
export default function Upload() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [shown, setShown] = useState<Shown>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setShown({ kind: "loading" });
    void (async () => {
      try {
        const view = await moderation.upload(id);
        if (!cancelled) setShown({ kind: "upload", view });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.code === "invalid_request")) setShown({ kind: "missing" });
        else setShown({ kind: "failed", message: errorMessage(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const object = async (text: string) => {
    const view = await moderation.objectToUpload(id, text);
    setShown({ kind: "upload", view });
  };

  return (
    <AppShell>
      <ScrollView contentContainerClassName="px-4 pb-16 pt-4">
        <Text accessibilityRole="header" className="text-xl font-bold text-zinc-50">
          {CASES_WORDS.title}
        </Text>
        <SettingsNav current="cases" />
        <View className="mt-6 w-full max-w-xl">
          {shown.kind === "loading" ? <Loading /> : null}
          {shown.kind === "missing" ? <ErrorText message={UPLOAD_TEXTS.notFound} /> : null}
          {shown.kind === "failed" ? <ErrorText message={shown.message} /> : null}
          {shown.kind === "upload" ? <UploadNoticeDetail view={shown.view} onObject={object} /> : null}
          <TextLink label={DECISION_WORDS.back} href="/settings/cases" />
        </View>
      </ScrollView>
    </AppShell>
  );
}

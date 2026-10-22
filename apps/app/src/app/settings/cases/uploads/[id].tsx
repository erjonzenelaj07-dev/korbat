import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import type { UploadRefusalView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/kit/Skeleton";
import { UploadNoticeDetail } from "@/components/moderation/UploadNotice";
import { HeaderSpace, ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { SettingsNav } from "@/components/SettingsNav";
import { ErrorText, TextLink } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { moderation } from "@/lib/moderation";
import { usePageTitle } from "@/lib/page-title";
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
  const title = usePageTitle("title.cases");

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

  const header = (
    <ScreenHeader title={CASES_WORDS.title} back="/settings/cases">
      <SettingsNav current="cases" />
    </ScreenHeader>
  );
  // While the notice loads the screen stays in the shell, under its header, as skeleton lines (UI design, section 6.12).
  if (shown.kind === "loading") {
    return (
      <AppShell>
        {title}
        {header}
        <HeaderSpace />
        <Skeleton.Page />
      </AppShell>
    );
  }
  return (
    <AppShell>
      {title}
      {header}
      <ScreenScroll screen="upload">
        {shown.kind === "missing" ? <ErrorText message={UPLOAD_TEXTS.notFound} /> : null}
        {shown.kind === "failed" ? <ErrorText message={shown.message} /> : null}
        {shown.kind === "upload" ? <UploadNoticeDetail view={shown.view} onObject={object} /> : null}
        <TextLink label={DECISION_WORDS.back} href="/settings/cases" />
      </ScreenScroll>
    </AppShell>
  );
}

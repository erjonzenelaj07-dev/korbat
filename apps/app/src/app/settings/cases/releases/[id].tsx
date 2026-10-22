import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import type { ReleaseNoticeView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/kit/Skeleton";
import { ReleaseNoticeDetail } from "@/components/moderation/ReleaseNotice";
import { HeaderSpace, ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { SettingsNav } from "@/components/SettingsNav";
import { ErrorText, TextLink } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { moderation } from "@/lib/moderation";
import { usePageTitle } from "@/lib/page-title";
import { CASES_WORDS, DECISION_WORDS, RELEASE_TEXTS } from "@/lib/moderation-words";

type Shown = { kind: "loading" } | { kind: "missing" } | { kind: "failed"; message: string } | { kind: "release"; view: ReleaseNoticeView };

/**
 * 3d Task 2 (design, section 9.6): a release's notice, under Settings, Cases; its entry in "About you" leads here. The
 * API answers only for the author of the released posts, and not at all while the author may not be told yet; anything
 * else reads as one sentence, whatever the id named. Where an appeal of the sealing decision stands comes with the view
 * (3d review L11), so the screen reads nothing else.
 */
export default function Release() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [shown, setShown] = useState<Shown>({ kind: "loading" });
  const title = usePageTitle("title.cases");

  useEffect(() => {
    let cancelled = false;
    setShown({ kind: "loading" });
    void (async () => {
      try {
        const view = await moderation.release(id);
        if (!cancelled) setShown({ kind: "release", view });
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
      <ScreenScroll screen="release">
        {shown.kind === "missing" ? <ErrorText message={RELEASE_TEXTS.notFound} /> : null}
        {shown.kind === "failed" ? <ErrorText message={shown.message} /> : null}
        {shown.kind === "release" ? <ReleaseNoticeDetail view={shown.view} /> : null}
        <TextLink label={DECISION_WORDS.back} href="/settings/cases" />
      </ScreenScroll>
    </AppShell>
  );
}

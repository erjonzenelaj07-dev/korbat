import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import type { DecisionView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/kit/Skeleton";
import { DecisionDetail } from "@/components/moderation/DecisionDetail";
import { HeaderSpace, ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { SettingsNav } from "@/components/SettingsNav";
import { ErrorText, TextLink } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { moderation } from "@/lib/moderation";
import { CASES_WORDS, DECISION_WORDS } from "@/lib/moderation-words";
import { usePageTitle } from "@/lib/page-title";

type Shown = { kind: "loading" } | { kind: "missing" } | { kind: "failed"; message: string } | { kind: "decision"; view: DecisionView };

/** The screen's header: "Cases", its one level-1 heading, Back to the list, and the settings row under it. */
function CasesHeader() {
  return (
    <ScreenHeader title={CASES_WORDS.title} back="/settings/cases">
      <SettingsNav current="cases" />
    </ScreenHeader>
  );
}

/**
 * One decision (3c design, section 9), under Settings, Cases: the chip's details sheet, its "Read the full decision" and
 * each row of "About you" lead here. The API answers only for the account the decision is about and only for a decision
 * that account was told of; anything else reads as one sentence, whatever the id named. UI Task 7 (section 8.7): the
 * title in ScreenHeader, skeleton lines in the shell while it loads, and ?appeal=1 (the sheet's "Appeal") focuses the
 * appeal's field once the decision shows.
 */
export default function Decision() {
  const { id, appeal } = useLocalSearchParams<{ id: string; appeal?: string }>();
  const [shown, setShown] = useState<Shown>({ kind: "loading" });
  const title = usePageTitle("title.cases");

  useEffect(() => {
    let cancelled = false;
    setShown({ kind: "loading" });
    void (async () => {
      try {
        const view = await moderation.decision(id);
        if (!cancelled) setShown({ kind: "decision", view });
      } catch (err) {
        if (cancelled) return;
        // No decision of this account has the id, or the address held no id at all.
        if (err instanceof ApiError && (err.status === 404 || err.code === "invalid_request")) setShown({ kind: "missing" });
        else setShown({ kind: "failed", message: errorMessage(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  /**
   * "Appeal": a POST for the decision in the address, with what its author wrote, if anything. The answer is the
   * decision as it now reads, with the appeal waiting, and the screen shows that. A refusal is thrown to the form, which
   * words it in place and keeps what was written.
   */
  async function sendAppeal(statement: string) {
    setShown({ kind: "decision", view: await moderation.appeal(id, statement) });
  }

  /** 3d Task 6: "Ask for a person", as the appeal: the answer is the decision as it now reads, with the request sent. */
  async function ask(text: string) {
    setShown({ kind: "decision", view: await moderation.objection(id, text) });
  }

  // While the decision loads the screen stays in the shell, under its header, as skeleton lines (section 6.12).
  if (shown.kind === "loading") {
    return (
      <AppShell>
        {title}
        <CasesHeader />
        <HeaderSpace />
        <Skeleton.Page />
      </AppShell>
    );
  }
  return (
    <AppShell>
      {title}
      <CasesHeader />
      <ScreenScroll screen="decision">
        {shown.kind === "missing" ? <ErrorText message={DECISION_WORDS.notFound} /> : null}
        {shown.kind === "failed" ? <ErrorText message={shown.message} /> : null}
        {shown.kind === "decision" ? <DecisionDetail view={shown.view} onAppeal={sendAppeal} onAsk={ask} focusAppeal={appeal === "1"} /> : null}
        <TextLink label={DECISION_WORDS.back} href="/settings/cases" />
      </ScreenScroll>
    </AppShell>
  );
}

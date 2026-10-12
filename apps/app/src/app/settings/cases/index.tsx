import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { AuthorCaseRow, ReportRow } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { DecisionsList, ReportsList } from "@/components/moderation/CasesLists";
import { SettingsNav } from "@/components/SettingsNav";
import { ErrorText, TextButton } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { moderation } from "@/lib/moderation";
import { CASES_WORDS, STATUS_WORDS } from "@/lib/moderation-words";

type Tab = "about" | "reports";

/** A list read a page at a time: its rows so far, the cursor of the next page, and whether a read is out or failed. */
interface Pages<T> {
  rows: T[];
  next: string | null;
  loaded: boolean;
  busy: boolean;
  error: string | null;
}

const EMPTY = { rows: [], next: null, loaded: false, busy: false, error: null };

/**
 * Cases (3c design, section 9), inside the settings layout, which lets in only a signed-in account with a handle: two
 * tabs. "About you" lists the decisions about the account; "Your reports" lists the reports it sent, with their outcomes
 * once released and, when the account's address stopped korbat's report mails, the notice and the button that resumes
 * them. A link from the report form opens the second tab (`?tab=reports`).
 */
export default function Cases() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === "reports" ? "reports" : "about");
  const [decisions, setDecisions] = useState<Pages<AuthorCaseRow>>(EMPTY);
  const [reports, setReports] = useState<Pages<ReportRow>>(EMPTY);
  const [mailStopped, setMailStopped] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  /** Reads the first page of the decisions, or the page after `cursor`. */
  const loadDecisions = useCallback(async (cursor?: string) => {
    setDecisions((current) => ({ ...current, busy: true, error: null }));
    try {
      const page = await moderation.cases(cursor);
      setDecisions((current) => ({ rows: cursor ? [...current.rows, ...page.decisions] : page.decisions, next: page.nextCursor, loaded: true, busy: false, error: null }));
    } catch (err) {
      setDecisions((current) => ({ ...current, busy: false, error: errorMessage(err) }));
    }
  }, []);

  /** The same for the reports; every page says whether korbat's report mails to the account are stopped. */
  const loadReports = useCallback(async (cursor?: string) => {
    setReports((current) => ({ ...current, busy: true, error: null }));
    try {
      const page = await moderation.reports(cursor);
      setMailStopped(page.reportMailStopped);
      setReports((current) => ({ rows: cursor ? [...current.rows, ...page.reports] : page.reports, next: page.nextCursor, loaded: true, busy: false, error: null }));
    } catch (err) {
      setReports((current) => ({ ...current, busy: false, error: errorMessage(err) }));
    }
  }, []);

  // Each tab reads its list the first time it is shown.
  useEffect(() => {
    if (tab === "about" && !decisions.loaded && !decisions.busy && decisions.error === null) void loadDecisions();
    if (tab === "reports" && !reports.loaded && !reports.busy && reports.error === null) void loadReports();
  }, [tab, decisions, reports, loadDecisions, loadReports]);

  async function resume() {
    if (resuming) return;
    setResuming(true);
    setResumeError(null);
    try {
      await moderation.resumeReportMail();
      setMailStopped(false);
    } catch (err) {
      setResumeError(errorMessage(err));
    } finally {
      setResuming(false);
    }
  }

  const shown = tab === "about" ? decisions : reports;
  return (
    <AppShell>
      <ScrollView>
        <View className="border-b border-zinc-800 px-4 pt-4">
          <Text accessibilityRole="header" className="text-xl font-bold text-zinc-50">
            {CASES_WORDS.title}
          </Text>
          <SettingsNav current="cases" />
          <View accessibilityRole="tablist" className="mt-4 flex-row">
            {(["about", "reports"] as Tab[]).map((t) => (
              <Pressable key={t} accessibilityRole="tab" aria-selected={tab === t} onPress={() => setTab(t)} className={`mr-6 border-b-2 pb-2 ${tab === t ? "border-zinc-50" : "border-transparent"}`}>
                <Text className={`text-base ${tab === t ? "font-semibold text-zinc-50" : "text-zinc-400"}`}>{CASES_WORDS.tabs[t]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        {tab === "about" && decisions.loaded ? <DecisionsList decisions={decisions.rows} /> : null}
        {tab === "reports" && reports.loaded ? <ReportsList page={{ reports: reports.rows, reportMailStopped: mailStopped }} onResume={() => void resume()} busy={resuming} error={resumeError} /> : null}
        <View className="px-4 pb-10">
          <ErrorText message={shown.error} />
          {/* A first read that failed is asked again by hand; the tab does not ask in a loop. */}
          {shown.error && !shown.loaded ? <TextButton label={STATUS_WORDS.retry} onPress={() => void (tab === "about" ? loadDecisions() : loadReports())} /> : null}
          {shown.next ? <TextButton label={CASES_WORDS.more} onPress={() => void (tab === "about" ? loadDecisions(shown.next!) : loadReports(shown.next!))} /> : null}
        </View>
      </ScrollView>
    </AppShell>
  );
}

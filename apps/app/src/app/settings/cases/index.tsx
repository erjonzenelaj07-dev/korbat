import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { AuthorCaseRow, AuthorNoticesPage, ReportItem, ReportRow } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/kit/Skeleton";
import { VisuallyHidden } from "@/components/kit/VisuallyHidden";
import { TabPanel, Tabs } from "@/components/kit/Tabs";
import { DecisionsList, NoticesList, ReportsList, StandingBlock } from "@/components/moderation/CasesLists";
import { ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { SettingsNav } from "@/components/SettingsNav";
import { ErrorText, TextButton } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { moderation } from "@/lib/moderation";
import { CASES_WORDS, STATUS_WORDS } from "@/lib/moderation-words";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { UI_WORDS } from "@/lib/ui-words";

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

/** The panel the two tabs control (section 6.10). */
const PANEL = "cases-panel";

/** A tab's first page on its way (6.12): rows of the list's shape, hidden from assistive technology, and one polite status. */
function RowsLoading() {
  return (
    <View>
      <VisuallyHidden role="status">{UI_WORDS["spinner.label"]}</VisuallyHidden>
      {(["46%", "38%", "52%", "41%"] as const).map((width, index) => (
        <View key={index} aria-hidden className="min-h-[52px] gap-2 border-b border-line-low px-4 py-3">
          <Skeleton.Text width={width} />
          <Skeleton.Text width="64%" variant="meta" />
        </View>
      ))}
    </View>
  );
}

/**
 * Cases (3c design, section 9), inside the settings layout, which lets in only a signed-in account with a handle: two
 * tabs. "About you" lists the decisions about the account; "Your reports" lists the reports it sent, with their outcomes
 * once released and, when the account's address stopped korbat's report mails, the notice and the button that resumes
 * them. A link from the report form opens the second tab (`?tab=reports`). UI Task 7 (sections 6.10 and 8.7): the title,
 * the settings row and the tabs in ScreenHeader, the tabs the kit's Tabs (one tab stop, the arrows choose), the list
 * under them a TabPanel, and skeleton rows while a tab's first page loads.
 */
export default function Cases() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === "reports" ? "reports" : "about");
  const title = usePageTitle("title.cases");
  // 3e: the block "Your standing" reads the account's measure from /me, which the session holds fresh.
  const { state } = useSession();
  const [decisions, setDecisions] = useState<Pages<AuthorCaseRow>>(EMPTY);
  const [reports, setReports] = useState<Pages<ReportRow>>(EMPTY);
  const [mailStopped, setMailStopped] = useState(false);
  // 3e: how many of the account's strikes count now, as every page of "About you" says.
  const [activeStrikes, setActiveStrikes] = useState(0);
  // 3d Task 2: the notices that are not decisions (the releases of the account's sealed images), their first page.
  const [notices, setNotices] = useState<AuthorNoticesPage["notices"]>([]);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  /** Reads the first page of the decisions, or the page after `cursor`. */
  const loadDecisions = useCallback(async (cursor?: string) => {
    setDecisions((current) => ({ ...current, busy: true, error: null }));
    try {
      const page = await moderation.cases(cursor);
      setActiveStrikes(page.activeStrikes);
      // 3d Task 2: the notices, read with the decisions' first page; a failure to read them leaves the list out.
      if (!cursor) setNotices(await moderation.notices().then((found) => found.notices, () => []));
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

  /**
   * "Ask for a re-examination" of one item of the account's own reports, by its id; the list is then read again from
   * its start. A refusal is thrown to the control that asked, which words it in place.
   */
  async function reexamine(item: ReportItem, statement: string) {
    await moderation.reexamineOwn(item.id, statement);
    await loadReports();
  }

  const shown = tab === "about" ? decisions : reports;
  return (
    <AppShell>
      {title}
      <ScreenHeader title={CASES_WORDS.title}>
        <SettingsNav current="cases" />
        <View className="mt-1">
          <Tabs
            label={CASES_WORDS.title}
            tabs={[
              { key: "about", label: CASES_WORDS.tabs.about },
              { key: "reports", label: CASES_WORDS.tabs.reports },
            ]}
            selected={tab}
            onSelect={setTab}
            panelId={PANEL}
          />
        </View>
      </ScreenHeader>
      <TabPanel panelId={PANEL} selected={tab}>
        <ScreenScroll screen="cases" flush>
          {!shown.loaded && shown.error === null ? <RowsLoading /> : null}
          {tab === "about" && decisions.loaded ? <StandingBlock activeStrikes={activeStrikes} standing={state.status === "signed-in" ? state.me.standing : null} /> : null}
          {tab === "about" && decisions.loaded ? <NoticesList notices={notices} /> : null}
          {tab === "about" && decisions.loaded ? <DecisionsList decisions={decisions.rows} /> : null}
          {tab === "reports" && reports.loaded ? <ReportsList page={{ reports: reports.rows, reportMailStopped: mailStopped }} onResume={() => void resume()} onReexamine={reexamine} busy={resuming} error={resumeError} /> : null}
          <View className="px-4 pb-4">
            <ErrorText message={shown.error} />
            {/* A first read that failed is asked again by hand; the tab does not ask in a loop. */}
            {shown.error && !shown.loaded ? <TextButton label={STATUS_WORDS.retry} onPress={() => void (tab === "about" ? loadDecisions() : loadReports())} /> : null}
            {shown.next ? <TextButton label={CASES_WORDS.more} onPress={() => void (tab === "about" ? loadDecisions(shown.next!) : loadReports(shown.next!))} /> : null}
          </View>
        </ScreenScroll>
      </TabPanel>
    </AppShell>
  );
}

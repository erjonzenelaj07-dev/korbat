import { Redirect, useLocalSearchParams } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/kit/Skeleton";
import { ReportForm } from "@/components/moderation/ReportForm";
import { HeaderSpace, ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { givenTarget } from "@/lib/moderation";
import { REPORT_WORDS } from "@/lib/moderation-words";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";

/**
 * The report form's page (3c design, section 9): opened from "Report" on a post, an image or a profile, whose address
 * names the item, or on its own, from the terms page, where it asks for a link. It stands outside the settings, whose
 * layout sends a signed-out reader to sign in: anyone may report, signed in or not. An account that has not chosen a
 * handle yet finishes that first, as the API asks of every signed-in request. UI Task 7 (section 8.7): "Report to
 * korbat" is the screen's title in ScreenHeader, its one level-1 heading, and the tab's title names the kind of screen.
 */
export default function Report() {
  const params = useLocalSearchParams<{ post?: string; media?: string; account?: string }>();
  const { state } = useSession();
  const title = usePageTitle("title.report");
  const header = <ScreenHeader title={REPORT_WORDS.title} />;
  // While the session loads the form's place stays in the shell, as skeleton lines (UI design, section 6.12).
  if (state.status === "loading") {
    return (
      <AppShell>
        {title}
        {header}
        <HeaderSpace />
        <Skeleton.Page />
      </AppShell>
    );
  }
  if (state.status === "signed-in" && !state.me.user.onboarded) return <Redirect href="/handle" />;
  const given = givenTarget(params);
  return (
    <AppShell>
      {title}
      {header}
      <ScreenScroll screen="report">
        {/* A form opened on another item starts empty: its key is the item. */}
        <ReportForm key={given ? JSON.stringify(given) : "link"} signedIn={state.status === "signed-in"} given={given} standing={state.status === "signed-in" ? state.me.standing : null} />
      </ScreenScroll>
    </AppShell>
  );
}

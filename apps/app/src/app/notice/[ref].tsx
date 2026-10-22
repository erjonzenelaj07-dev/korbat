import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { NoticeRef, type NoticeItemStatus, type NoticeStatus } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { NoticeNotFound, NoticeStatusView } from "@/components/moderation/NoticeStatusView";
import { Skeleton } from "@/components/kit/Skeleton";
import { HeaderSpace, ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { Button, ErrorText } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { fragmentToken, moderation } from "@/lib/moderation";
import { STATUS_WORDS } from "@/lib/moderation-words";
import { usePageTitle } from "@/lib/page-title";

type Shown = { kind: "loading" } | { kind: "missing" } | { kind: "failed"; message: string } | { kind: "status"; status: NoticeStatus };

/**
 * The notice status page (3c design, section 9), outside the settings: whoever holds the link reads it, signed in or
 * not. The link carries the reference in its path and the token in its fragment, which a browser sends to no server; the
 * page reads the token there and sends it only in the body of a POST. A wrong reference and a wrong token read the same.
 * UI Task 7 (section 8.7): "Your report" is the screen's title in ScreenHeader; the tab's title names the kind of screen
 * and never the reference.
 */
export default function NoticePage() {
  const { ref } = useLocalSearchParams<{ ref: string }>();
  const [token, setToken] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = usePageTitle("title.notice");

  const load = useCallback(async (ref: string, token: string) => {
    try {
      setShown({ kind: "status", status: await moderation.status(ref, token) });
    } catch (err) {
      // No report has this reference with this token, or the address was not a status page's at all.
      if (err instanceof ApiError && (err.code === "notice_not_found" || err.code === "invalid_request")) setShown({ kind: "missing" });
      else setShown({ kind: "failed", message: errorMessage(err) });
    }
  }, []);

  useEffect(() => {
    const location = (globalThis as { location?: { hash: string } }).location;
    const found = location ? fragmentToken(location.hash) : null;
    setToken(found);
    if (found === null || !NoticeRef.safeParse(ref).success) {
      setShown({ kind: "missing" });
      return;
    }
    setShown({ kind: "loading" });
    void load(ref, found);
  }, [ref, load]);

  /** One of the page's buttons: a POST with the page's own token, then the page again as the API now gives it. */
  async function contact(choice: "confirm" | "stop") {
    if (busy || token === null) return;
    setBusy(true);
    setError(null);
    try {
      await moderation.contact(ref, token, choice);
      await load(ref, token);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * "Ask for a re-examination" of one item: a POST with the page's own token and the item's position, then the page again
   * as the API now gives it. A refusal is thrown to the control that asked, which words it in place.
   */
  async function reexamine(item: NoticeItemStatus, statement: string) {
    if (token === null) return;
    await moderation.reexamineNotice(ref, token, item.position, statement);
    await load(ref, token);
  }

  // While the status loads the page stays in the shell, as skeleton lines (UI design, section 6.12).
  const header = <ScreenHeader title={STATUS_WORDS.title} />;
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
      <ScreenScroll screen="notice">
        {shown.kind === "missing" ? <NoticeNotFound /> : null}
        {shown.kind === "failed" ? (
          <>
            <ErrorText message={shown.message} />
            <Button
              label={STATUS_WORDS.retry}
              onPress={() => {
                if (token !== null) void load(ref, token);
              }}
              tone="secondary"
            />
          </>
        ) : null}
        {shown.kind === "status" ? <NoticeStatusView status={shown.status} onContact={(choice) => void contact(choice)} onReexamine={reexamine} busy={busy} error={error} /> : null}
      </ScreenScroll>
    </AppShell>
  );
}

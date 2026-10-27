import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import type { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { ImportStatus, ImportView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { ImportProgress } from "@/components/import/ImportProgress";
import { ImportResult } from "@/components/import/ImportResult";
import { Preview } from "@/components/import/Preview";
import type { CardAuthor } from "@/components/import/PostList";
import { UploadProgress } from "@/components/import/UploadProgress";
import { ErrorState } from "@/components/kit/ErrorState";
import { Skeleton } from "@/components/kit/Skeleton";
import { VisuallyHidden } from "@/components/kit/VisuallyHidden";
import { ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { SettingsNav } from "@/components/SettingsNav";
import { useHaptics } from "@/lib/haptics";
import { IMPORT_WORDS } from "@/lib/import-words";
import { announcement, forgetUpload, IMPORT_POLL_MS, importErrorMessage, imports, useUploadRun, type UploadRunState } from "@/lib/imports";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";

/**
 * One import, drawn by its state (3b design, sections 10.1 and 10.3 to 10.5): uploading and reading, the preview and the
 * choice, the progress, and the ends. While the import moves by itself (uploading elsewhere, reading, preparing,
 * publishing, removing) the screen reads it every 3 seconds while the page is visible; while this tab uploads it, the
 * upload's own answers move it. When its state changes while the screen is open, one polite sentence says so
 * (import.now.*), and the focus goes to the new view's level-2 heading, but only when the element that held it is gone
 * (WCAG 2.2 4.1.3 and 2.4.3). Nothing about an import is kept on the device.
 */

/** The states that change without the person: the screen reads the import again while one of them lasts. */
const MOVING: readonly ImportStatus[] = ["uploading", "scanning", "preparing", "publishing", "undoing"];

/** One import's view by its state, which the screen draws under its header and the render tests draw on their own. */
export function ImportStateView({
  view,
  author,
  onView,
  run = null,
  headingRef,
}: {
  view: ImportView;
  author: CardAuthor | null;
  onView: (next: ImportView) => void;
  run?: UploadRunState | null;
  headingRef?: Ref<View>;
}) {
  switch (view.status) {
    case "uploading":
    case "scanning":
      return <UploadProgress view={view} run={run} headingRef={headingRef} onView={onView} />;
    case "ready":
      return <Preview view={view} author={author} headingRef={headingRef} onView={onView} />;
    case "preparing":
    case "publishing":
    case "undoing":
      return <ImportProgress view={view} headingRef={headingRef} onView={onView} />;
    default:
      return <ImportResult view={view} author={author} headingRef={headingRef} onView={onView} />;
  }
}

/** The browser's document, typed locally, for the page's visibility and the element that has the focus. */
const page = () => (globalThis as unknown as { document?: { visibilityState?: string; activeElement?: { isConnected?: boolean } | null; body?: unknown; addEventListener?: (type: string, listener: () => void) => void; removeEventListener?: (type: string, listener: () => void) => void } }).document;

export default function ImportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const title = usePageTitle("title.import");
  const { state } = useSession();
  const haptic = useHaptics();
  const profile = state.status === "signed-in" ? state.me.profile : null;
  const author: CardAuthor | null = profile ? { displayName: profile.displayName, handle: profile.handle } : null;
  const [view, setView] = useState<ImportView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [said, setSaid] = useState("");
  const run = useUploadRun(id);
  const heading = useRef<View>(null);
  /** The element that held the focus when a change of state arrived, to know after the render whether it is gone. */
  const focused = useRef<{ isConnected?: boolean } | null>(null);
  const shown = useRef<ImportStatus | null>(null);

  /** Every new view of the import goes through here: a change of state is said, and the focus kept or moved after it. */
  const apply = useCallback(
    (next: ImportView) => {
      const before = shown.current;
      if (before !== null && before !== next.status) {
        focused.current = page()?.activeElement ?? null;
        const words = announcement(before, next.status);
        if (words !== null) setSaid(words);
        // The removal's end is felt as well as heard (10.5).
        if (before === "undoing" && next.status === "undone") haptic("success");
      }
      shown.current = next.status;
      setView(next);
    },
    [haptic],
  );

  const load = useCallback(() => {
    setError(null);
    imports.get(id).then(apply, setError);
  }, [id, apply]);
  useEffect(load, [load]);

  // The focus goes to the new view's heading when the element that held it left with the old view, or none holds it.
  useEffect(() => {
    const held = focused.current;
    if (held === null) return;
    focused.current = null;
    const doc = page();
    if (held.isConnected === false || doc?.activeElement === doc?.body || doc?.activeElement === null) (heading.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [view?.status]);

  // Read it again every 3 s while it moves by itself and the page is visible, and at once when the page shows again.
  const status = view?.status;
  const uploadingHere = run?.running === true;
  useEffect(() => {
    if (status === undefined || !MOVING.includes(status) || (status === "uploading" && uploadingHere)) return;
    const doc = page();
    const read = () => {
      if (doc?.visibilityState === "hidden") return;
      imports.get(id).then(apply, () => undefined);
    };
    const timer = setInterval(read, IMPORT_POLL_MS);
    const onVisible = () => {
      if (doc?.visibilityState === "visible") read();
    };
    doc?.addEventListener?.("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      doc?.removeEventListener?.("visibilitychange", onVisible);
    };
  }, [id, status, uploadingHere, apply]);

  // When this tab's upload ends (the last chunk, a refusal, a cancel), the import is read again for its new state.
  const runEnded = run !== null && !run.running;
  useEffect(() => {
    if (!runEnded) return;
    imports.get(id).then((next) => {
      if (next.status !== "uploading") forgetUpload(id);
      apply(next);
    }, () => undefined);
  }, [id, runEnded, apply]);

  return (
    <AppShell>
      {title}
      <ScreenHeader title={IMPORT_WORDS["import.title"]} back="/settings/import">
        <SettingsNav current="import" />
      </ScreenHeader>
      <ScreenScroll screen="import">
        <VisuallyHidden role="status">{said}</VisuallyHidden>
        {error !== null ? (
          <ErrorState message={importErrorMessage(error)} onRetry={load} />
        ) : view === null ? (
          <Skeleton.Page />
        ) : (
          <ImportStateView view={view} author={author} onView={apply} run={run} headingRef={heading} />
        )}
      </ScreenScroll>
    </AppShell>
  );
}

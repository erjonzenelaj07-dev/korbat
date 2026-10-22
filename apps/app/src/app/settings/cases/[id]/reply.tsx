import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { REPLY_TEXT_MAX, type DecisionView, type ReplyResponse } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/kit/Skeleton";
import { Text } from "@/components/kit/Text";
import { HeaderSpace, ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { SettingsNav } from "@/components/SettingsNav";
import { Body, Button, ErrorText, Field, TextLink } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { moderation } from "@/lib/moderation";
import { CASES_WORDS, DECISION_WORDS } from "@/lib/moderation-words";
import { usePageTitle } from "@/lib/page-title";
import { STANDING_TEXTS, standingMeasureOf } from "@/lib/standing";

type Shown = { kind: "loading" } | { kind: "missing" } | { kind: "failed"; message: string } | { kind: "decision"; view: DecisionView };

/**
 * The opening of the reply screen (3e design, section 9.3), from the decision's standing read fresh: before a start that
 * is fixed ([reply.before]), before one that is not ([reply.unfixed]), or while the measure runs ([reply.running]); null
 * when the decision takes no reply now.
 */
export function replyOpening(view: DecisionView): string | null {
  const standing = view.standing;
  const measure = standingMeasureOf(view);
  if (standing === null || measure === null || !standing.replyOpen) return null;
  if (standing.state === "unfixed" || (standing.state === "announced" && standing.startsAt === null)) return STANDING_TEXTS.reply.unfixed(measure.kind, standing.earliestStart);
  if (standing.state === "announced" && standing.startsAt !== null) return STANDING_TEXTS.reply.before(measure.kind, standing.startsAt);
  if (standing.state === "running") return STANDING_TEXTS.reply.running(measure.kind, standing.endsAt);
  return null;
}

/**
 * The reply's form, once: the opening, the optional field with its count, [reply.hint], [reply.once], [reply.kept] and
 * "Send reply". After the answer the form gives way to [reply.sent.onTime] or [reply.sent.late], which takes the focus.
 * A refusal is worded under the button, and what was written stays.
 */
export function ReplyPanel({ view, onSend }: { view: DecisionView; onSend: (statement: string) => Promise<ReplyResponse> }) {
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<ReplyResponse | null>(null);
  const sentRef = useRef<View>(null);
  const measure = standingMeasureOf(view);
  const opening = replyOpening(view);

  useEffect(() => {
    if (sent !== null) (sentRef.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [sent]);

  async function send() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setSent(await onSend(statement));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (sent !== null && measure !== null) {
    return (
      <View>
        {/* The Notice of the answer, which takes the focus (9.8). */}
        <View ref={sentRef} accessibilityRole="alert" focusable className="mt-4 rounded-card border border-line-low bg-surface-1 px-4 py-3">
          <Text>{sent.onTime ? STANDING_TEXTS.reply.sentOnTime(measure.kind, sent.filedAt) : STANDING_TEXTS.reply.sentLate(measure.kind, sent.filedAt)}</Text>
        </View>
        <TextLink label={STANDING_TEXTS.reply.back} href={`/settings/cases/${view.id}`} />
      </View>
    );
  }
  if (opening === null || measure === null) {
    return (
      <View>
        <Body>{STANDING_TEXTS.reply.closed}</Body>
        <TextLink label={STANDING_TEXTS.reply.back} href={`/settings/cases/${view.id}`} />
      </View>
    );
  }
  return (
    <View>
      <Body>{opening}</Body>
      <Field label={STANDING_TEXTS.reply.field} value={statement} onChangeText={setStatement} multiline maxLength={REPLY_TEXT_MAX} />
      <Text aria-live="polite" variant="meta" tone="low" className="mt-1">
        {STANDING_TEXTS.reply.count(statement.length)}
      </Text>
      <Text tone="medium" className="mt-3">
        {STANDING_TEXTS.reply.hint}
      </Text>
      <Text tone="medium" className="mt-3">
        {STANDING_TEXTS.reply.once}
      </Text>
      <Text tone="medium" className="mt-3">
        {STANDING_TEXTS.reply.kept}
      </Text>
      <Button label={STANDING_TEXTS.reply.send} onPress={() => void send()} busy={busy} />
      <ErrorText message={error} />
    </View>
  );
}

/**
 * The reply screen (3e design, section 9.3), under Settings, Cases, beside the decision's screen: "Reply" on the banner
 * and on the decision's screen lead here while the reply is open. The decision is read fresh; an id that names no
 * decision of this account reads as the decision's screen says it. UI Task 7: "Cases" in ScreenHeader with Back to the
 * decision, the reply's title a level-2 heading under it, skeleton lines in the shell while it loads.
 */
export default function Reply() {
  const { id } = useLocalSearchParams<{ id: string }>();
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
        if (err instanceof ApiError && (err.status === 404 || err.code === "invalid_request")) setShown({ kind: "missing" });
        else setShown({ kind: "failed", message: errorMessage(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const header = (
    <ScreenHeader title={CASES_WORDS.title} back={`/settings/cases/${id}`}>
      <SettingsNav current="cases" />
    </ScreenHeader>
  );
  // While the decision loads the screen stays in the shell, under its header, as skeleton lines (section 6.12).
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
      <ScreenScroll screen="reply">
        <Text as="h2" variant="display-3">
          {STANDING_TEXTS.reply.title}
        </Text>
        {shown.kind === "missing" ? <ErrorText message={DECISION_WORDS.notFound} /> : null}
        {shown.kind === "failed" ? <ErrorText message={shown.message} /> : null}
        {shown.kind === "decision" ? <ReplyPanel view={shown.view} onSend={(statement) => moderation.reply(id, statement)} /> : null}
      </ScreenScroll>
    </AppShell>
  );
}

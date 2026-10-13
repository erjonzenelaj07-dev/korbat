import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { REPLY_TEXT_MAX, type DecisionView, type ReplyResponse } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { SettingsNav } from "@/components/SettingsNav";
import { Body, Button, ErrorText, Field, Loading, TextLink } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { moderation } from "@/lib/moderation";
import { CASES_WORDS, DECISION_WORDS } from "@/lib/moderation-words";
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
        <View ref={sentRef} accessibilityRole="alert" focusable className="mt-4 rounded-lg bg-zinc-900 px-4 py-3">
          <Text className="text-sm text-zinc-300">{sent.onTime ? STANDING_TEXTS.reply.sentOnTime(measure.kind, sent.filedAt) : STANDING_TEXTS.reply.sentLate(measure.kind, sent.filedAt)}</Text>
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
      <Text aria-live="polite" className="mt-1 text-sm text-zinc-400">
        {STANDING_TEXTS.reply.count(statement.length)}
      </Text>
      <Text className="mt-3 text-sm leading-5 text-zinc-400">{STANDING_TEXTS.reply.hint}</Text>
      <Text className="mt-3 text-sm leading-5 text-zinc-400">{STANDING_TEXTS.reply.once}</Text>
      <Text className="mt-3 text-sm leading-5 text-zinc-400">{STANDING_TEXTS.reply.kept}</Text>
      <Button label={STANDING_TEXTS.reply.send} onPress={() => void send()} busy={busy} />
      <ErrorText message={error} />
    </View>
  );
}

/**
 * The reply screen (3e design, section 9.3), under Settings, Cases, beside the decision's screen: "Reply" on the banner
 * and on the decision's screen lead here while the reply is open. The decision is read fresh; an id that names no
 * decision of this account reads as the decision's screen says it.
 */
export default function Reply() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [shown, setShown] = useState<Shown>({ kind: "loading" });

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

  return (
    <AppShell>
      <ScrollView contentContainerClassName="px-4 pb-16 pt-4">
        <Text accessibilityRole="header" className="text-xl font-bold text-zinc-50">
          {CASES_WORDS.title}
        </Text>
        <SettingsNav current="cases" />
        <View className="mt-6 w-full max-w-xl">
          <Text accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-50">
            {STANDING_TEXTS.reply.title}
          </Text>
          {shown.kind === "loading" ? <Loading /> : null}
          {shown.kind === "missing" ? <ErrorText message={DECISION_WORDS.notFound} /> : null}
          {shown.kind === "failed" ? <ErrorText message={shown.message} /> : null}
          {shown.kind === "decision" ? <ReplyPanel view={shown.view} onSend={(statement) => moderation.reply(id, statement)} /> : null}
        </View>
      </ScrollView>
    </AppShell>
  );
}

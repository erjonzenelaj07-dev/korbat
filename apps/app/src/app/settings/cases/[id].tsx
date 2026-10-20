import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { DecisionView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { DecisionDetail } from "@/components/moderation/DecisionDetail";
import { SettingsNav } from "@/components/SettingsNav";
import { ErrorText, Loading, TextLink } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { moderation } from "@/lib/moderation";
import { CASES_WORDS, DECISION_WORDS } from "@/lib/moderation-words";

type Shown = { kind: "loading" } | { kind: "missing" } | { kind: "failed"; message: string } | { kind: "decision"; view: DecisionView };

/**
 * One decision (3c design, section 9), under Settings, Cases: the chip on a post and each row of "About you" lead here.
 * The API answers only for the account the decision is about and only for a decision that account was told of; anything
 * else reads as one sentence, whatever the id named.
 */
export default function Decision() {
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
  async function appeal(statement: string) {
    setShown({ kind: "decision", view: await moderation.appeal(id, statement) });
  }

  /** 3d Task 6: "Ask for a person", as the appeal: the answer is the decision as it now reads, with the request sent. */
  async function ask(text: string) {
    setShown({ kind: "decision", view: await moderation.objection(id, text) });
  }

  return (
    <AppShell>
      <ScrollView contentContainerClassName="px-4 pb-16 pt-4">
        <Text accessibilityRole="header" className="text-xl font-bold text-zinc-50">
          {CASES_WORDS.title}
        </Text>
        <SettingsNav current="cases" />
        <View className="mt-6 w-full max-w-xl">
          {shown.kind === "loading" ? <Loading /> : null}
          {shown.kind === "missing" ? <ErrorText message={DECISION_WORDS.notFound} /> : null}
          {shown.kind === "failed" ? <ErrorText message={shown.message} /> : null}
          {shown.kind === "decision" ? <DecisionDetail view={shown.view} onAppeal={appeal} onAsk={ask} /> : null}
          <TextLink label={DECISION_WORDS.back} href="/settings/cases" />
        </View>
      </ScrollView>
    </AppShell>
  );
}

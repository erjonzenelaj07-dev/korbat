import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import type { AccountStanding } from "@korbat/contracts";
import { refusalSentence, runningMeasure, STANDING_TEXTS } from "@/lib/standing";

/**
 * A write refused account_suspended where it was attempted (3e design, section 9.4): a card's like, repost or bookmark,
 * and a follow. It reads /me's standing as the session holds it, which the app reads again after such a refusal, so the
 * sentence names the end of the suspension, the termination, or that the suspension has just ended; and while a measure
 * runs, the link to its decision.
 */
export function RefusedNotice({ standing }: { standing: AccountStanding | null | undefined }) {
  const running = runningMeasure(standing);
  return (
    <View className="mt-1">
      <Text accessibilityRole="alert" className="text-xs text-red-400">
        {refusalSentence(standing)}
      </Text>
      {running !== null ? (
        <Link href={`/settings/cases/${running.decisionId}`} asChild>
          <Pressable>
            <Text className="text-xs text-sky-400 underline">{STANDING_TEXTS.refused.read}</Text>
          </Pressable>
        </Link>
      ) : null}
    </View>
  );
}

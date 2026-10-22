import { View } from "react-native";
import type { AccountStanding } from "@korbat/contracts";
import { Icon } from "@/components/kit/Icon";
import { Text } from "@/components/kit/Text";
import { refusalSentence, runningMeasure, STANDING_TEXTS } from "@/lib/standing";
import { CaseLink } from "./parts";

/**
 * A write refused account_suspended where it was attempted (3e design, section 9.4): a card's like, repost or bookmark,
 * and a follow. It reads /me's standing as the session holds it, which the app reads again after such a refusal, so the
 * sentence names the end of the suspension, the termination, or that the suspension has just ended; and while a measure
 * runs, the link to its decision. UI Task 7: the error's sentence in danger-ink beside its icon, never by colour alone
 * (section 4.8), and the link a 44 px target of its own.
 */
export function RefusedNotice({ standing }: { standing: AccountStanding | null | undefined }) {
  const running = runningMeasure(standing);
  return (
    <View className="mt-1">
      <View className="flex-row items-start gap-1.5">
        <View className="pt-[2px]">
          <Icon name="error" size={16} tone="danger" />
        </View>
        <Text accessibilityRole="alert" variant="meta" tone="danger" className="shrink">
          {refusalSentence(standing)}
        </Text>
      </View>
      {running !== null ? <CaseLink href={`/settings/cases/${running.decisionId}`} label={STANDING_TEXTS.refused.read} /> : null}
    </View>
  );
}

import { Text, View } from "react-native";
import type { ReleaseNoticeView } from "@korbat/contracts";
import { releaseNoticeParagraphs } from "@korbat/rules";
import { TextLink } from "@/components/ui";
import { RELEASE_TEXTS } from "@/lib/moderation-words";

/**
 * 3d Task 2 (design, sections 7.2 and 9.6; W.6): the notice of a release of sealed images of the reader's posts, on its
 * screen under Settings, Cases. Its paragraphs are RELEASE_NOTICE's, rendered by the one function the mail uses, and no
 * control: a release cannot be undone. It links the decision that sealed, and while an appeal of that decision waits
 * it says so ([release.appeal]): the release closed nothing. It names no authority, no reference and no assessment, and
 * draws no image.
 */
export function ReleaseNoticeDetail({ view, appealOpen }: { view: ReleaseNoticeView; appealOpen: boolean }) {
  return (
    <View>
      <Text accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-50">
        {RELEASE_TEXTS.title}
      </Text>
      {releaseNoticeParagraphs(view).map((paragraph, index) => (
        <Text key={index} className="mt-3 text-base leading-6 text-zinc-200">
          {paragraph}
        </Text>
      ))}
      {appealOpen ? <Text className="mt-3 text-base leading-6 text-zinc-100">{RELEASE_TEXTS.appeal}</Text> : null}
      {view.sealDecisionId === null ? null : <TextLink label={RELEASE_TEXTS.decision} href={`/settings/cases/${view.sealDecisionId}`} />}
    </View>
  );
}

import { View } from "react-native";
import { EXPLORE_V2, type ExploreFormula } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { DatedList, Heading, Paragraph } from "@/components/Prose";
import { ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { TextLink } from "@/components/ui";
import { EXPLORE_WORDS, exploreRules } from "@/lib/explore";
import { usePageTitle } from "@/lib/page-title";

/**
 * Every rule of a formula with its numbers, then its version and dated change log. The page shows EXPLORE_V2, the
 * constant the refresh ranks with, so the published rules are the ones in force; tests pass other formulas. UI Task 7
 * (section 8.9): each rule a section under a level-2 heading in the reading layout, the change log a dated list.
 */
export function ExploreRules({ formula = EXPLORE_V2 }: { formula?: ExploreFormula }) {
  return (
    <View>
      {exploreRules(formula).map((section) => (
        <View key={section.title}>
          <Heading level={2}>{section.title}</Heading>
          <Paragraph>{section.body}</Paragraph>
        </View>
      ))}
      <Heading level={2}>{EXPLORE_WORDS.versionHeading}</Heading>
      <Paragraph>{EXPLORE_WORDS.version(formula.version)}</Paragraph>
      <DatedList label={EXPLORE_WORDS.versionHeading} entries={formula.changes.map((change) => ({ key: String(change.version), text: EXPLORE_WORDS.change(change) }))} />
    </View>
  );
}

/**
 * How Explore works (2c design, section 11): public, so anyone can hold the order Explore shows to its published rules.
 * UI Task 7: its title is the screen's ScreenHeader, and Back to Explore leads to Home's Explore tab.
 */
export default function ExploreAbout() {
  const title = usePageTitle("title.exploreAbout");
  return (
    <AppShell>
      {title}
      <ScreenHeader title={EXPLORE_WORDS.about} />
      <ScreenScroll screen="explore-about">
        <Paragraph tone="high">{EXPLORE_WORDS.aboutLead}</Paragraph>
        <ExploreRules />
        <TextLink label={EXPLORE_WORDS.backToExplore} href="/?tab=explore" />
      </ScreenScroll>
    </AppShell>
  );
}

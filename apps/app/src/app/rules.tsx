import { useEffect, useState } from "react";
import { View } from "react-native";
import { AUTOMATION_RULES, PublicFacts } from "@korbat/contracts";
import { RULES, RULES_CHANGES, RULES_VERSION } from "@korbat/rules";
import { AppShell } from "@/components/AppShell";
import { DatedList, Heading, Paragraph, ProseList } from "@/components/Prose";
import { ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { TextLink } from "@/components/ui";
import { api } from "@/lib/api";
import { usePageTitle } from "@/lib/page-title";
import { PAGE_DOWN, RULES_PAGE, toolBlocks, type AutomationLimits } from "@/lib/public-pages";
import { MEASURES_PARAGRAPH, REPORTING_IN_BAD_FAITH, STRIKES, SUSPENSION, TERRORIST_CONTENT, termsParagraphs } from "@/lib/terms";

/** The sections the terms build from STANDING_RULES and ORDER_RULES, which this page prints with the same builders. */
const NUMBERED_SECTIONS: { title: string; body: string }[] = [
  { title: "Strikes", body: STRIKES },
  { title: "Suspension and termination", body: SUSPENSION },
  { title: "Reporting in bad faith", body: REPORTING_IN_BAD_FAITH },
  { title: "Terrorist content", body: TERRORIST_CONTENT },
];

/**
 * The rules page as it reads with the facts it was given (3d design, section 9.2; W.1): the rules in force, what korbat
 * can do and when, what each automated tool does in the state the running server reports, and the change log. While the
 * facts are on their way the automation section holds its lead alone; when the route did not answer (`"down"`) the fixed
 * texts stand and it reads [page.down]: the page never prints a tool as off or on without the route's answer. `limits` are the program's caps, printed once a tool that rates or
 * compares images is on (their constant comes with the automated decision, Task 6). UI Task 7 (section 8.9): the
 * page's title is the screen's ScreenHeader; here the lead, the sections in the reading layout of components/Prose.tsx,
 * each tool a card, and the change log a dated list.
 */
export function RulesView({ facts, limits = null }: { facts: PublicFacts | "loading" | "down"; limits?: AutomationLimits | null }) {
  const blocks = typeof facts === "string" ? [] : toolBlocks(facts);
  const anyImageTool = blocks.some((block) => (block.tool === "r1" || block.tool === "match") && block.on);
  return (
    <View>
      <Paragraph tone="high">{RULES_PAGE.lead}</Paragraph>

      <Heading level={2}>{RULES_PAGE.rulesHeading}</Heading>
      {RULES.map((rule) => (
        <View key={rule.id}>
          <Heading level={3}>{`${rule.id}: ${rule.title}`}</Heading>
          <Paragraph>{rule.text}</Paragraph>
          <Paragraph>{RULES_PAGE.allowed}</Paragraph>
          <ProseList label={`${rule.id}: ${RULES_PAGE.allowed}`} items={rule.allowed} />
          <Paragraph>{RULES_PAGE.notAllowed}</Paragraph>
          <ProseList label={`${rule.id}: ${RULES_PAGE.notAllowed}`} items={rule.notAllowed} />
        </View>
      ))}
      <Paragraph>{RULES_PAGE.law}</Paragraph>

      <Heading level={2}>{RULES_PAGE.measuresHeading}</Heading>
      <Paragraph>{MEASURES_PARAGRAPH}</Paragraph>
      {NUMBERED_SECTIONS.map((section) => (
        <View key={section.title}>
          <Heading level={3}>{section.title}</Heading>
          {termsParagraphs(section.body).map((paragraph, index) => (
            <Paragraph key={index}>{paragraph}</Paragraph>
          ))}
        </View>
      ))}

      <Heading level={2}>{RULES_PAGE.automationHeading}</Heading>
      <Paragraph>{RULES_PAGE.autoLead}</Paragraph>
      <Paragraph>{RULES_PAGE.autoImports}</Paragraph>
      {facts === "loading" ? null : facts === "down" ? (
        <Paragraph>{PAGE_DOWN}</Paragraph>
      ) : (
        <View>
          {blocks.map((block) => (
            <View key={block.tool} role="group" className="mt-4 rounded-card border border-line-low bg-surface-1 px-4 pb-4">
              {block.paragraphs.map((paragraph, index) => (
                <Paragraph key={index}>{paragraph}</Paragraph>
              ))}
            </View>
          ))}
          {anyImageTool ? (
            limits === null ? null : (
              <>
                <Paragraph>{RULES_PAGE.autoCap(limits)}</Paragraph>
                <Paragraph>{RULES_PAGE.autoTarget(limits.objectionTargetHours)}</Paragraph>
              </>
            )
          ) : (
            <Paragraph>{RULES_PAGE.autoNone}</Paragraph>
          )}
        </View>
      )}

      <Heading level={2}>{RULES_PAGE.versionHeading}</Heading>
      <Paragraph>{RULES_PAGE.version(RULES_VERSION)}</Paragraph>
      <DatedList label={RULES_PAGE.versionHeading} entries={[...RULES_CHANGES].reverse().map((change) => ({ key: String(change.version), text: RULES_PAGE.change(change) }))} />

      <TextLink label={RULES_PAGE.transparencyLink} href="/transparency" />
      <TextLink label={RULES_PAGE.exploreLink} href="/explore/about" />
    </View>
  );
}

/**
 * /rules (3d design, sections 9.1 and 9.2), public, signed in or out: it reads no session for its content and sends one
 * GET, /api/public/facts, which the API answers no-cache, so the page prints what is switched on now.
 */
export default function RulesPage() {
  const [facts, setFacts] = useState<PublicFacts | "loading" | "down">("loading");
  const title = usePageTitle("title.rules");
  useEffect(() => {
    let live = true;
    api("/api/public/facts", { schema: PublicFacts })
      .then((answer) => {
        if (live) setFacts(answer);
      })
      .catch(() => {
        if (live) setFacts("down");
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <AppShell>
      {title}
      <ScreenHeader title={RULES_PAGE.title} />
      <ScreenScroll screen="rules">
        {/* 3d Task 6: the program's caps and the target of an answer are the contracts' constants, which the database mirrors. */}
        <RulesView facts={facts} limits={AUTOMATION_RULES} />
      </ScreenScroll>
    </AppShell>
  );
}

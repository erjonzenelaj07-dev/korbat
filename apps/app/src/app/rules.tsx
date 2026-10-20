import { useEffect, useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { PublicFacts } from "@korbat/contracts";
import { RULES, RULES_CHANGES, RULES_VERSION } from "@korbat/rules";
import { AppShell } from "@/components/AppShell";
import { TextLink } from "@/components/ui";
import { api } from "@/lib/api";
import { PAGE_DOWN, RULES_PAGE, toolBlocks, type AutomationLimits } from "@/lib/public-pages";
import { MEASURES_PARAGRAPH, REPORTING_IN_BAD_FAITH, STRIKES, SUSPENSION, TERRORIST_CONTENT, termsParagraphs } from "@/lib/terms";

/** A heading of the page: level 2 under the page's title, level 3 under a section. */
function Heading({ level, children }: { level: 2 | 3; children: string }) {
  return (
    <Text accessibilityRole="header" aria-level={level} className={level === 2 ? "mt-8 text-lg font-semibold text-zinc-100" : "mt-5 text-base font-semibold text-zinc-100"}>
      {children}
    </Text>
  );
}
const Paragraph = ({ children }: { children: ReactNode }) => <Text className="mt-2 text-base leading-7 text-zinc-300">{children}</Text>;

/** One list of the page, its items read one by one. */
function List({ label, items }: { label: string; items: readonly string[] }) {
  return (
    <View role="list" aria-label={label} className="mt-1">
      {items.map((item) => (
        <Text key={item} role="listitem" className="mt-1 text-base leading-6 text-zinc-300">
          {`- ${item}`}
        </Text>
      ))}
    </View>
  );
}

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
 * compares images is on (their constant comes with the automated decision, Task 6).
 */
export function RulesView({ facts, limits = null }: { facts: PublicFacts | "loading" | "down"; limits?: AutomationLimits | null }) {
  const blocks = typeof facts === "string" ? [] : toolBlocks(facts);
  const anyImageTool = blocks.some((block) => (block.tool === "r1" || block.tool === "match") && block.on);
  return (
    <View>
      <Text accessibilityRole="header" className="text-3xl font-bold tracking-tight text-zinc-50">
        {RULES_PAGE.title}
      </Text>
      <Paragraph>{RULES_PAGE.lead}</Paragraph>

      <Heading level={2}>{RULES_PAGE.rulesHeading}</Heading>
      {RULES.map((rule) => (
        <View key={rule.id}>
          <Heading level={3}>{`${rule.id}: ${rule.title}`}</Heading>
          <Paragraph>{rule.text}</Paragraph>
          <Paragraph>{RULES_PAGE.allowed}</Paragraph>
          <List label={`${rule.id}: ${RULES_PAGE.allowed}`} items={rule.allowed} />
          <Paragraph>{RULES_PAGE.notAllowed}</Paragraph>
          <List label={`${rule.id}: ${RULES_PAGE.notAllowed}`} items={rule.notAllowed} />
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
      {facts === "loading" ? null : facts === "down" ? (
        <Paragraph>{PAGE_DOWN}</Paragraph>
      ) : (
        <View>
          {blocks.map((block) => (
            <View key={block.tool} role="group" className="mt-3 rounded-lg border border-zinc-800 px-3 pb-3">
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
      {[...RULES_CHANGES].reverse().map((change) => (
        <Paragraph key={change.version}>{RULES_PAGE.change(change)}</Paragraph>
      ))}

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
      <ScrollView className="flex-1 bg-zinc-950" contentContainerClassName="px-4 pb-16 pt-6">
        <View className="w-full max-w-xl">
          <RulesView facts={facts} />
        </View>
      </ScrollView>
    </AppShell>
  );
}

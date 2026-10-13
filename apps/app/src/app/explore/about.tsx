import { ScrollView, Text, View } from "react-native";
import { EXPLORE_V2, type ExploreFormula } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { TextLink } from "@/components/ui";
import { exploreRules } from "@/lib/explore";

/**
 * Every rule of a formula with its numbers, then its version and dated change log. The page shows EXPLORE_V2, the
 * constant the refresh ranks with, so the published rules are the ones in force; tests pass other formulas.
 */
export function ExploreRules({ formula = EXPLORE_V2 }: { formula?: ExploreFormula }) {
  return (
    <View>
      {exploreRules(formula).map((section) => (
        <View key={section.title} className="mt-8">
          <Text accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-100">
            {section.title}
          </Text>
          <Text className="mt-2 text-base leading-7 text-zinc-300">{section.body}</Text>
        </View>
      ))}
      <View className="mt-8">
        <Text accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-100">
          Version and changes
        </Text>
        <Text className="mt-2 text-base leading-7 text-zinc-300">{`This is version ${formula.version} of the formula.`}</Text>
        {formula.changes.map((change) => (
          <Text key={change.version} className="mt-2 text-base leading-7 text-zinc-300">
            {`Version ${change.version}, ${change.date}: ${change.summary}`}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** How Explore works (2c design, section 11): public, so anyone can hold the order Explore shows to its published rules. */
export default function ExploreAbout() {
  return (
    <AppShell>
      <ScrollView className="flex-1 bg-zinc-950" contentContainerClassName="px-4 py-6">
        <Text accessibilityRole="header" className="text-3xl font-bold tracking-tight text-zinc-50">
          How Explore works
        </Text>
        <Text className="mt-2 text-base leading-6 text-zinc-400">
          Explore lists recent posts that other accounts approve of, in an order anyone can check: these are all of its rules and numbers.
        </Text>
        <ExploreRules />
        <TextLink label="Back to Explore" href="/?tab=explore" />
      </ScrollView>
    </AppShell>
  );
}

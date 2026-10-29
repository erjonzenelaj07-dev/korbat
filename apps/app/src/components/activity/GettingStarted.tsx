import { Pressable, View } from "react-native";
import { Link } from "expo-router";
import { AboutCard } from "@/components/AboutCard";
import { HandleBox } from "@/components/HandleBox";
import { FOCUS_RING } from "@/components/kit/interaction";
import { Text } from "@/components/kit/Text";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { useLayout } from "@/theme/layout";

/** One row's target: its words in accent ink, underlined, 44 px tall, as every link of a card is. */
const TARGET = cn("min-h-[44px] justify-center self-start rounded-control active:opacity-70", FOCUS_RING);

function Words({ children }: { children: string }) {
  return (
    <Text tone="accent" className="underline web:underline-offset-2">
      {children}
    </Text>
  );
}

function Row({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} asChild>
      <Pressable className={TARGET}>
        <Words>{label}</Words>
      </Pressable>
    </Link>
  );
}

/**
 * Getting started (2d design, decision 25, section 10.7): what an account's empty Following shows instead of the empty
 * state, until the first followed account posts. Its heading and one sentence, then one line and one link each: Latest
 * (which switches Home's tab), Explore and how it picks, the handle box itself (which phones see nowhere else), the
 * profile's settings (with where Settings is on a phone, 10.1) and the rules; below 1024 px, where the context column is
 * not drawn, How korbat works. Nothing is suggested by name, nothing is stored, and nothing is dismissed.
 */
export function GettingStarted({ onShowLatest }: { onShowLatest: () => void }) {
  const layout = useLayout();
  return (
    <View className="gap-4 px-4 py-6">
      <View className="gap-1 rounded-card border border-line-low bg-surface-1 px-4 pb-3 pt-4">
        <Text as="h2" variant="title">
          {UI_WORDS["feed.start.title"]}
        </Text>
        <Text tone="medium">{UI_WORDS["feed.start.body"]}</Text>
        <Pressable accessibilityRole="button" onPress={onShowLatest} className={cn(TARGET, "mt-2")}>
          <Words>{UI_WORDS["feed.start.latest"]}</Words>
        </Pressable>
        <Row href="/explore/about" label={UI_WORDS["feed.start.explore"]} />
        <View className="gap-2 py-2">
          <Text tone="medium">{UI_WORDS["feed.start.handle"]}</Text>
          <HandleBox />
        </View>
        <Row href="/settings/profile" label={UI_WORDS["feed.start.profile"]} />
        {layout === "phone" ? (
          <Text variant="meta" tone="low">
            {UI_WORDS["feed.start.settings"]}
          </Text>
        ) : null}
        <Row href="/rules" label={UI_WORDS["feed.start.rules"]} />
      </View>
      {layout === "phone" || layout === "tablet" ? <AboutCard /> : null}
    </View>
  );
}

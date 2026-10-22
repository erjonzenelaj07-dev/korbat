import { Pressable, View } from "react-native";
import { Link, type Href } from "expo-router";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { FOCUS_RING } from "./kit/interaction";
import { Text } from "./kit/Text";

/**
 * "How korbat works" (UI design, section 7.3, decision 14), the card under the handle box in the context column, where
 * Popular now was: three short lines on what korbat promises a reader, and the pages that show it. It suggests no posts,
 * since suggestions appear only where the reader goes looking.
 */
const LINES = [UI_WORDS["shell.how1"], UI_WORDS["shell.how2"], UI_WORDS["shell.how3"]];

const LINKS: { label: string; href: Href }[] = [
  { label: UI_WORDS["shell.rulesLink"], href: "/rules" },
  { label: UI_WORDS["shell.transparencyLink"], href: "/transparency" },
  { label: UI_WORDS["shell.exploreLink"], href: "/explore/about" },
];

export function AboutCard() {
  return (
    <View className="gap-3 rounded-card border border-line-low bg-surface-1 px-4 pb-2 pt-4">
      <Text as="h2" variant="title">
        {UI_WORDS["shell.howTitle"]}
      </Text>
      <View className="gap-2">
        {LINES.map((line) => (
          <Text key={line} tone="medium">
            {line}
          </Text>
        ))}
      </View>
      <View className="flex-row flex-wrap gap-x-4">
        {LINKS.map((link) => (
          <Link key={String(link.href)} href={link.href} asChild>
            <Pressable className={cn("group min-h-[44px] justify-center rounded-control active:opacity-70", FOCUS_RING)}>
              <Text tone="accent" className="underline web:underline-offset-2 web:group-hover:decoration-2">
                {link.label}
              </Text>
            </Pressable>
          </Link>
        ))}
      </View>
    </View>
  );
}

import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Link, type Href } from "expo-router";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { FOCUS_RING } from "./interaction";
import { Text } from "./Text";

/**
 * The frame of the pages outside the app's shell (UI design, section 7.3): the sign-in flow, the three token pages and
 * the terms, so they no longer look like another app. The wordmark at the top leads to /, the content is the page's
 * main landmark in a column 440 px wide (640 px with `wide`, for the terms), and the footer links the public pages. The
 * page's body does not scroll on the web (public/index.html), so the frame scrolls itself. The terms are its first
 * screen (UI Task 7); Task 8 moves the sign-in flow and the token pages in.
 */
const FOOTER: { label: string; href: Href }[] = [
  { label: UI_WORDS["frame.rules"], href: "/rules" },
  { label: UI_WORDS["frame.transparency"], href: "/transparency" },
  { label: UI_WORDS["frame.terms"], href: "/terms" },
];

/**
 * A link of the frame: a 44 by 44 px target at least around its words (a short word such as "Terms" is narrower than
 * that at the default size, UI Task 7), dimmed while pressed, underlined under a fine pointer.
 */
const LINK = cn("group min-h-[44px] min-w-[44px] items-center justify-center rounded-control px-1 active:opacity-70", FOCUS_RING);

export function PublicFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  // The column's width is a style, not a class, so a test can read it from the markup.
  const column = { width: "100%", maxWidth: wide ? 640 : 440 } as const;
  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="min-h-full items-center px-4">
      <View role="banner" className="items-center py-6" style={column}>
        <Link href="/" asChild>
          <Pressable className={LINK}>
            <Text variant="display-1">{UI_WORDS["frame.wordmark"]}</Text>
          </Pressable>
        </Link>
      </View>
      <View role="main" className="flex-1" style={column}>
        {children}
      </View>
      <View role="contentinfo" className="flex-row flex-wrap justify-center gap-x-4 border-t border-line-low py-6" style={column}>
        {FOOTER.map((link) => (
          <Link key={String(link.href)} href={link.href} asChild>
            <Pressable className={LINK}>
              <Text variant="meta" tone="medium" className="web:group-hover:underline">
                {link.label}
              </Text>
            </Pressable>
          </Link>
        ))}
      </View>
    </ScrollView>
  );
}

import { Pressable, View } from "react-native";
import { Link } from "expo-router";
import { CASES_WORDS } from "@/lib/moderation-words";
import { cn } from "@/theme/cn";
import { FOCUS_RING, HOVER_WASH } from "./kit/interaction";
import { Text } from "./kit/Text";

export type SettingsPage = "security" | "privacy" | "profile" | "account" | "cases";

const PAGES: { page: SettingsPage; label: string }[] = [
  { page: "security", label: "Security" },
  { page: "privacy", label: "Privacy" },
  { page: "profile", label: "Profile" },
  { page: "account", label: "Account" },
  // The decisions about the account and the reports it sent (3c design, section 9); its screens are the folder settings/cases.
  { page: "cases", label: CASES_WORDS.nav },
];

/**
 * The row of links between the settings screens, shown by every one of them under its title. Each
 * link is a real anchor (expo-router's Link), so the keyboard can follow it. The screen names itself
 * through `current` instead of the row asking the router for the path, which also lets a test render
 * the row on its own.
 *
 * On the tokens (UI design, sections 4.8 and 7.1): each link a 44 px pill that wraps rather than clipping its word, the
 * current one in the accent wash with its label in body-strong and an accent underline beneath it, a shape mark that
 * does not rely on the colour; the others ink-medium, with the hover wash under a fine pointer.
 */
export function SettingsNav({ current }: { current: SettingsPage }) {
  return (
    <View role="navigation" aria-label="Settings" className="mt-3 flex-row flex-wrap gap-1">
      {PAGES.map(({ page, label }) => (
        <Link key={page} href={`/settings/${page}`} asChild>
          <Pressable
            aria-current={page === current ? "page" : undefined}
            className={cn("min-h-[44px] justify-center rounded-full px-3 active:bg-surface-2", page === current ? "bg-accent-wash" : HOVER_WASH, FOCUS_RING)}
          >
            <Text variant={page === current ? "body-strong" : "body"} tone={page === current ? "high" : "medium"} className={page === current ? "underline decoration-accent web:decoration-2 web:underline-offset-4" : undefined}>
              {label}
            </Text>
          </Pressable>
        </Link>
      ))}
    </View>
  );
}

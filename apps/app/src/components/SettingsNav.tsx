import { Pressable, View } from "react-native";
import { Link } from "expo-router";
import { IMPORT_WORDS } from "@/lib/import-words";
import { CASES_WORDS } from "@/lib/moderation-words";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import type { IconName } from "./icons";
import { FOCUS_RING, HOVER_WASH } from "./kit/interaction";
import { Text } from "./kit/Text";

export type SettingsPage = "appearance" | "security" | "privacy" | "profile" | "account" | "import" | "cases";

/**
 * The settings pages in their order, with their names and icons (UI design, sections 4.7 and 8.8): Appearance first
 * (UI Task 8, the owner's ruling 10), so the page a newcomer looks for comes first, in this row and in the Settings
 * index (app/settings/index.tsx), which lists the same pages as rows.
 */
export const SETTINGS_PAGES: { page: SettingsPage; label: string; icon: IconName; row?: string }[] = [
  { page: "appearance", label: UI_WORDS["appearance.nav"], icon: "appearance" },
  { page: "security", label: UI_WORDS["settings.security"], icon: "security" },
  { page: "privacy", label: UI_WORDS["settings.privacy"], icon: "privacy" },
  { page: "profile", label: UI_WORDS["settings.profile"], icon: "edit-profile" },
  { page: "account", label: UI_WORDS["settings.account"], icon: "account" },
  // 3b (design, section 10.1): Import after Account in this row, and "Import posts" as the Settings index's row (`row`).
  { page: "import", label: IMPORT_WORDS["import.nav"], icon: "import", row: IMPORT_WORDS["import.title"] },
  // The decisions about the account and the reports it sent (3c design, section 9); its screens are the folder settings/cases.
  { page: "cases", label: CASES_WORDS.nav, icon: "cases" },
];

/**
 * The row of links between the settings screens, shown by every one of them under its title but the index, which is the
 * list itself. Each link is a real anchor (expo-router's Link), so the keyboard can follow it. The screen names itself
 * through `current` instead of the row asking the router for the path, which also lets a test render the row on its own.
 * Appearance shows the row only to a signed-in reader, since the others need an account.
 *
 * On the tokens (UI design, sections 4.8 and 7.1): each link a 44 px pill that wraps rather than clipping its word, the
 * current one in the accent wash with its label in body-strong and an accent underline beneath it, a shape mark that
 * does not rely on the colour; the others ink-medium, with the hover wash under a fine pointer.
 */
export function SettingsNav({ current }: { current: SettingsPage }) {
  return (
    <View role="navigation" aria-label={UI_WORDS["settings.nav"]} className="mt-3 flex-row flex-wrap gap-1">
      {SETTINGS_PAGES.map(({ page, label }) => (
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

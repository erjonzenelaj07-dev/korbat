import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import { CASES_WORDS } from "@/lib/moderation-words";

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
 */
export function SettingsNav({ current }: { current: SettingsPage }) {
  return (
    <View role="navigation" aria-label="Settings" className="mt-3 flex-row flex-wrap">
      {PAGES.map(({ page, label }) => (
        <Link key={page} href={`/settings/${page}`} asChild>
          <Pressable aria-current={page === current ? "page" : undefined} className="mr-5 py-1">
            <Text className={`text-sm underline ${page === current ? "font-semibold text-zinc-50" : "text-zinc-400"}`}>{label}</Text>
          </Pressable>
        </Link>
      ))}
    </View>
  );
}

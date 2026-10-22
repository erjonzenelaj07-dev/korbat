import { View } from "react-native";
import { AppShell } from "@/components/AppShell";
import { ListRow } from "@/components/kit/ListRow";
import { ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { SETTINGS_PAGES } from "@/components/SettingsNav";
import { usePageTitle } from "@/lib/page-title";
import { UI_WORDS } from "@/lib/ui-words";

/**
 * The Settings index (UI design, section 8.8; the owner's ruling 10), which the nav's Settings item and a profile's
 * settings button open: one card of link rows, Appearance first, then Security, Privacy, Profile, Account and Cases,
 * each with its icon and a chevron, so the page a newcomer looks for is the first thing Settings shows. It is the one
 * settings screen without the settings row, since it is the list; signed out the settings layout sends it to sign-in.
 */
export default function SettingsIndex() {
  const title = usePageTitle("title.settingsIndex");
  return (
    <AppShell>
      {title}
      <ScreenHeader title={UI_WORDS["settings.title"]} />
      <ScreenScroll screen="settings">
        {/* The card clips its rows to its corners, and the last row's divider goes under its border: one line closes it. */}
        <View className="mt-4 overflow-hidden rounded-card border border-line-low bg-surface-1">
          <View className="-mb-px">
            {SETTINGS_PAGES.map(({ page, label, icon }) => (
              <ListRow key={page} label={label} icon={icon} href={`/settings/${page}`} />
            ))}
          </View>
        </View>
      </ScreenScroll>
    </AppShell>
  );
}

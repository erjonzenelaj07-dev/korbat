import { useCallback, useEffect, useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { AppShell } from "@/components/AppShell";
import { ListRow, switchColours } from "@/components/kit/ListRow";
import { TabPanel, Tabs } from "@/components/kit/Tabs";
import { Text } from "@/components/kit/Text";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SettingsNav } from "@/components/SettingsNav";
import { ProfileList } from "@/components/social/ProfileList";
import { buttonFace, ErrorText, LABEL_TONE, Section, SectionRows } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { exploreSwitchText } from "@/lib/explore";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { PRIVACY_WORDS } from "@/lib/settings-words";
import { social } from "@/lib/social";
import { UI_WORDS } from "@/lib/ui-words";
import { useTheme } from "@/theme/ThemeProvider";

type Tab = "blocked" | "muted";

/** The panel the Blocked and Muted tabs control (section 6.10). */
const PANEL = "privacy-panel";

/** "Show my posts in Explore" as useExploreSwitch holds it and ExploreSwitch shows it. */
export interface ExploreSwitchState {
  on: boolean;
  busy: boolean;
  error: string | null;
  change: (next: boolean) => Promise<void>;
}

/**
 * "Show my posts in Explore" (2c design, section 11), on by default: its state and its save. Its state is /api/me's. A
 * change shows at once while it is saved (POST turns it on, DELETE off, as the app's other switches), the switch is
 * disabled until the save and the session's refresh are done, and a failed save puts it back with the error. Privacy
 * calls it, above the list whose header shows the switch: the Blocked and Muted tabs remount that list, and a remount
 * must not lose a save in progress or its error.
 */
export function useExploreSwitch(): ExploreSwitchState {
  const { state, refresh } = useSession();
  // The settings layout lets in only an account with a profile; the type still allows none.
  const stored = state.status === "signed-in" ? (state.me.profile?.showInExplore ?? true) : true;
  const [on, setOn] = useState(stored);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Follows the session when it changes: after a save here, or a refresh from elsewhere.
  useEffect(() => setOn(stored), [stored]);

  async function change(next: boolean) {
    if (busy) return;
    const before = on;
    setBusy(true);
    setError(null);
    setOn(next);
    try {
      const answer = await social.setShowInExplore(next);
      setOn(answer.showInExplore);
      // /api/me carries the switch, so the session follows the saved state. A failed refresh shows its own screen, so what
      // the catch below sees is a failed save.
      await refresh();
    } catch (err) {
      setOn(before);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return { on, busy, error, change };
}

/**
 * The switch, its sentence, the way to the rules and a failed save's error, showing what useExploreSwitch holds. UI Task 8
 * (8.8): a card of two rows, the switch row (its own Switch, whose line explore.test.tsx reads, with the theme's track,
 * the row's flip for a pointer and its focus ring) with the sentence under its label, and a link row to How Explore works.
 */
export function ExploreSwitch({ on, busy, error, change }: ExploreSwitchState) {
  const { colors } = useTheme();
  return (
    <Section title={PRIVACY_WORDS.explore}>
      <SectionRows end={error === null}>
        <ListRow
          label="Show my posts in Explore"
          description={exploreSwitchText()}
          control={{
            kind: "switch",
            value: on,
            disabled: busy,
            onValueChange: (next) => void change(next),
            element: (
              // react-native-web renders a checkbox with the switch role, named by this label and checked while it is on.
              <Switch accessibilityLabel="Show my posts in Explore" value={on} disabled={busy} onValueChange={(next) => void change(next)} {...switchColours(colors)} />
            ),
          }}
        />
        <ListRow label={UI_WORDS["shell.exploreLink"]} icon="explore" href="/explore/about" />
      </SectionRows>
      <ErrorText message={error} />
    </Section>
  );
}

/**
 * 2d (decision 21, 10.8): Link previews, off until the person turns them on: a card with its switch (POST turns previews
 * on, DELETE off, as Explore's switch), the sentence on what a preview shows and where, and the note on search engines.
 * The switch shows a change at once and puts it back with the error when the save fails; /api/me carries the stored
 * value, so the session is read again after a save. Nothing elsewhere in the app asks the person to turn it on.
 */
function PreviewsCard() {
  const { colors } = useTheme();
  const { state, refresh } = useSession();
  const stored = state.status === "signed-in" ? (state.me.profile?.sharePreviews ?? false) : false;
  const [on, setOn] = useState(stored);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setOn(stored), [stored]);
  const change = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setOn(next);
    try {
      setOn((await social.setSharePreviews(next)).sharePreviews);
      await refresh();
    } catch (err) {
      setOn(!next);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={PRIVACY_WORDS.previews}>
      <SectionRows>
        <ListRow
          label={PRIVACY_WORDS.previewsSwitch}
          description={PRIVACY_WORDS.previewsExplain}
          control={{
            kind: "switch",
            value: on,
            disabled: busy,
            onValueChange: (next) => void change(next),
            element: <Switch accessibilityLabel={PRIVACY_WORDS.previewsSwitch} value={on} disabled={busy} onValueChange={(next) => void change(next)} {...switchColours(colors)} />,
          }}
        />
      </SectionRows>
      <Text variant="meta" tone="medium" className="mt-3">
        {PRIVACY_WORDS.search}
      </Text>
      <ErrorText message={error} />
    </Section>
  );
}

/** Unblock or Unmute beside an account: a secondary button with its own busy state and, below it, a failed undo's error. */
function UndoButton({ label, onPress }: { label: string; onPress: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View className="items-end">
      <Pressable
        accessibilityRole="button"
        aria-busy={busy}
        disabled={busy}
        onPress={() => {
          setBusy(true);
          setError(null);
          onPress()
            .catch((err: unknown) => setError(errorMessage(err)))
            .finally(() => setBusy(false));
        }}
        className={buttonFace({ face: busy ? "inactive" : "secondary", size: "md" })}
      >
        <Text variant="body-strong" tone={LABEL_TONE[busy ? "inactive" : "secondary"]}>
          {label}
        </Text>
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" variant="meta" tone="danger" className="mt-1">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Whether your posts show in Explore, then blocked and muted accounts with one-tap undo. This is the only place a block
 * can be lifted. UI Task 8 (8.8): the title and the settings row in ScreenHeader; the Explore card, the sentence on what
 * a block and a mute do, and the Blocked and Muted tabs (the kit's Tabs: one tab stop, the arrows choose) head the list,
 * which is their tab panel, as a profile's tabs head its posts.
 */
export default function Privacy() {
  const [tab, setTab] = useState<Tab>("blocked");
  const title = usePageTitle("title.settingsPrivacy");
  // Here, not in the list's header, which the tab's key remounts: a save in progress and its error outlive a tab change.
  const explore = useExploreSwitch();
  const fetchBlocks = useCallback((cursor?: string) => social.myBlocks(cursor), []);
  const fetchMutes = useCallback((cursor?: string) => social.myMutes(cursor), []);

  return (
    <AppShell>
      {title}
      <ScreenHeader title={UI_WORDS["settings.privacy"]}>
        <SettingsNav current="privacy" />
      </ScreenHeader>
      <TabPanel panelId={PANEL} selected={tab}>
        <ProfileList
          key={tab}
          fetchPage={tab === "blocked" ? fetchBlocks : fetchMutes}
          empty={tab === "blocked" ? PRIVACY_WORDS.emptyBlocked : PRIVACY_WORDS.emptyMuted}
          header={
            <View className="border-b border-line-low px-4 pb-1">
              <ExploreSwitch {...explore} />
              <PreviewsCard />
              <Text tone="medium" className="mt-6">
                {PRIVACY_WORDS.explain}
              </Text>
              <View className="mt-3">
                <Tabs
                  label={PRIVACY_WORDS.tabs}
                  tabs={[
                    { key: "blocked", label: PRIVACY_WORDS.blocked },
                    { key: "muted", label: PRIVACY_WORDS.muted },
                  ]}
                  selected={tab}
                  onSelect={setTab}
                  panelId={PANEL}
                />
              </View>
            </View>
          }
          action={(item, remove) => (
            <UndoButton
              label={tab === "blocked" ? PRIVACY_WORDS.unblock : PRIVACY_WORDS.unmute}
              onPress={async () => {
                if (tab === "blocked") await social.setBlock(item.handle, false);
                else await social.setMute(item.handle, false);
                remove();
              }}
            />
          )}
        />
      </TabPanel>
    </AppShell>
  );
}

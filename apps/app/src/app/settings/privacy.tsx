import { useCallback, useEffect, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { Link } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { SettingsNav } from "@/components/SettingsNav";
import { ProfileList } from "@/components/social/ProfileList";
import { ErrorText, Section } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { exploreSwitchText } from "@/lib/explore";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";

type Tab = "blocked" | "muted";

/**
 * react-native-web paints the thumb of a switch that is on in its own teal unless `activeThumbColor` names another colour,
 * a prop React Native's types do not know; the light thumb keeps its contrast on the dark track in both states.
 */
const ACTIVE_THUMB = { activeThumbColor: "#fafafa" } as object;

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

/** The switch, its sentence, a failed save's error and the way to the rules, showing what useExploreSwitch holds. */
export function ExploreSwitch({ on, busy, error, change }: ExploreSwitchState) {
  return (
    <Section title="Explore">
      <View className="mt-3 flex-row items-center justify-between gap-4">
        <Text className="flex-1 text-base text-zinc-50">Show my posts in Explore</Text>
        {/* react-native-web renders a checkbox with the switch role, named by this label and checked while it is on. */}
        <Switch accessibilityLabel="Show my posts in Explore" value={on} disabled={busy} onValueChange={(next) => void change(next)} trackColor={{ false: "#71717a", true: "#059669" }} thumbColor="#fafafa" {...ACTIVE_THUMB} />
      </View>
      <Text className="mt-2 text-sm leading-5 text-zinc-400">{exploreSwitchText()}</Text>
      <ErrorText message={error} />
      <Link href="/explore/about" asChild>
        <Pressable className="mt-3 self-start">
          <Text className="text-sm text-zinc-400 underline">How Explore works</Text>
        </Pressable>
      </Link>
    </Section>
  );
}

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
        className="rounded-full border border-zinc-600 px-4 py-1.5"
      >
        <Text className="text-sm text-zinc-200">{label}</Text>
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" className="mt-1 text-xs text-red-400">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Whether your posts show in Explore, then blocked and muted accounts with one-tap undo. This is the only place a block can be lifted. */
export default function Privacy() {
  const [tab, setTab] = useState<Tab>("blocked");
  // Here, not in the list's header, which the tab's key remounts: a save in progress and its error outlive a tab change.
  const explore = useExploreSwitch();
  const fetchBlocks = useCallback((cursor?: string) => social.myBlocks(cursor), []);
  const fetchMutes = useCallback((cursor?: string) => social.myMutes(cursor), []);

  return (
    <AppShell>
      <ProfileList
        key={tab}
        fetchPage={tab === "blocked" ? fetchBlocks : fetchMutes}
        empty={tab === "blocked" ? "You have not blocked anyone." : "You have not muted anyone."}
        header={
          <View className="border-b border-zinc-800 px-4 pt-4">
            <Text accessibilityRole="header" className="text-xl font-bold text-zinc-50">
              Privacy
            </Text>
            <SettingsNav current="privacy" />
            <ExploreSwitch {...explore} />
            <Text className="mt-6 text-sm leading-5 text-zinc-400">
              A block hides you and the other account from each other while signed in and refuses their interactions. Posts on korbat are public, so anyone who signs out can
              still read them. A mute only hides an account from your timelines, and they are never told.
            </Text>
            <View accessibilityRole="tablist" className="mt-4 flex-row">
              {(["blocked", "muted"] as Tab[]).map((t) => (
                <Pressable key={t} accessibilityRole="tab" aria-selected={tab === t} onPress={() => setTab(t)} className={`mr-6 border-b-2 pb-2 ${tab === t ? "border-zinc-50" : "border-transparent"}`}>
                  <Text className={`text-base ${tab === t ? "font-semibold text-zinc-50" : "text-zinc-400"}`}>{t === "blocked" ? "Blocked" : "Muted"}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
        action={(item, remove) => (
          <UndoButton
            label={tab === "blocked" ? "Unblock" : "Unmute"}
            onPress={async () => {
              if (tab === "blocked") await social.setBlock(item.handle, false);
              else await social.setMute(item.handle, false);
              remove();
            }}
          />
        )}
      />
    </AppShell>
  );
}

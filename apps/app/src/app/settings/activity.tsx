import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, View } from "react-native";
import type { ActivityReach, ActivitySettings } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { ListRow, RadioGroup } from "@/components/kit/ListRow";
import { Text } from "@/components/kit/Text";
import { ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { SettingsNav } from "@/components/SettingsNav";
import { toast } from "@/components/toast";
import { Body, ErrorText, Section, SectionRows } from "@/components/ui";
import { activityApi, createSettingsSaver } from "@/lib/activity";
import { errorMessage } from "@/lib/api";
import { usePageTitle } from "@/lib/page-title";
import { ACTIVITY_SETTINGS_WORDS as S } from "@/lib/settings-words";

/** The three reaches in their order, by their words (decision 7). */
const REACHES: [ActivityReach, string][] = [
  ["everyone", S.everyone],
  ["older", S.older],
  ["following", S.following],
  ["off", S.off],
];

const GROUPS = [
  ["replies", S.replies],
  ["mentions", S.mentions],
  ["quotes", S.quotes],
] as const;

/**
 * A radio group's card, which says when the focus has left it (10.8): on the web, focus moving outside the group (or
 * out of the page) saves its choice at once instead of after the 800 ms.
 */
function Group({ id, title, onLeave, children }: { id: string; title: string; onLeave: () => void; children: ReactNode }) {
  const leave = {
    onBlur: (event: { currentTarget: Element; relatedTarget: Element | null }) => {
      if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) onLeave();
    },
  };
  return (
    <Section title={title} id={id}>
      <SectionRows end>
        <View {...(Platform.OS === "web" ? (leave as object) : {})}>
          <RadioGroup labelledBy={id}>{children}</RadioGroup>
        </View>
      </SectionRows>
    </Section>
  );
}

/**
 * The four groups (10.8): Replies to your posts, Mentions of you and Quotes of your posts (Everyone, Accounts older than 2
 * days, Accounts you follow, Off) and New followers (On, Off), each one tab stop whose arrows move the choice, as
 * Appearance's are. `onChoose` takes the whole settings with one value changed; `onLeave` is the focus leaving a group.
 */
export function ActivitySettingsForm({ value, onChoose, onLeave }: { value: ActivitySettings; onChoose: (next: ActivitySettings) => void; onLeave: () => void }) {
  return (
    <View>
      <Body>{S.intro}</Body>
      {GROUPS.map(([field, title]) => (
        <Group key={field} id={`activity-${field}`} title={title} onLeave={onLeave}>
          {REACHES.map(([reach, label]) => (
            <ListRow key={reach} label={label} control={{ kind: "radio", checked: value[field] === reach, onSelect: () => onChoose({ ...value, [field]: reach }) }} />
          ))}
        </Group>
      ))}
      <Group id="activity-follows" title={S.follows} onLeave={onLeave}>
        {([true, false] as const).map((on) => (
          <ListRow key={String(on)} label={on ? S.on : S.off} control={{ kind: "radio", checked: value.follows === on, onSelect: () => onChoose({ ...value, follows: on }) }} />
        ))}
      </Group>
      <Text tone="medium" className="mt-6">
        {S.muted}
      </Text>
      <Text tone="medium" className="mt-2">
        {S.fromNow}
      </Text>
    </View>
  );
}

/**
 * Settings, Activity (2d design, decisions 7 and 8, section 10.8): who may reach the person in Activity. Unlike
 * Appearance's, the choices are the server's: the screen reads them, shows a choice at once, and saves it once it has
 * settled (lib/activity.ts's createSettingsSaver): one request and one toast, "Saved", per settled change; a refused save
 * puts the saved choice back and says so.
 */
export default function ActivitySettingsScreen() {
  const title = usePageTitle("title.settingsActivity");
  const [value, setValue] = useState<ActivitySettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saver = useRef<ReturnType<typeof createSettingsSaver> | null>(null);
  useEffect(() => {
    let current = true;
    activityApi.settings().then(
      (settings) => {
        if (!current) return;
        setValue(settings);
        saver.current = createSettingsSaver({
          initial: settings,
          save: activityApi.saveSettings,
          onSaved: () => toast.show({ message: S.saved }),
          onFailed: (saved) => {
            setValue(saved);
            toast.show({ message: S.failed, tone: "rollback" });
          },
        });
      },
      (err: unknown) => {
        if (current) setError(errorMessage(err));
      },
    );
    return () => {
      current = false;
      // A choice still waiting is saved as the screen goes, as leaving its group would save it.
      saver.current?.leave();
      saver.current?.dispose();
    };
  }, []);
  return (
    <AppShell>
      {title}
      <ScreenHeader title={S.nav}>
        <SettingsNav current="activity" />
      </ScreenHeader>
      <ScreenScroll screen="settings-activity">
        <ErrorText message={error} />
        {value ? (
          <ActivitySettingsForm
            value={value}
            onChoose={(next) => {
              setValue(next);
              saver.current?.choose(next);
            }}
            onLeave={() => saver.current?.leave()}
          />
        ) : null}
      </ScreenScroll>
    </AppShell>
  );
}

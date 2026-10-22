import { Fragment } from "react";
import { Platform, View } from "react-native";
import { AppShell } from "@/components/AppShell";
import { Avatar } from "@/components/kit/Avatar";
import { dataAttribute } from "@/components/kit/interaction";
import { ListRow, RadioGroup } from "@/components/kit/ListRow";
import { Text, textStyle } from "@/components/kit/Text";
import { ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { SettingsNav } from "@/components/SettingsNav";
import { toast } from "@/components/toast";
import { Body, Button, Section, SectionRows } from "@/components/ui";
import { setAppearance, useAppearance, type Appearance } from "@/lib/appearance";
import { useHaptics, type HapticIntent } from "@/lib/haptics";
import { usePageTitle } from "@/lib/page-title";
import { clearSessionTraces } from "@/lib/session-end";
import { useSession } from "@/lib/session";
import { UI_WORDS, type UiWord } from "@/lib/ui-words";
import { THEMES, type ThemeName } from "@/theme/tokens";

/**
 * Appearance and accessibility (UI design, section 8.8; UI Task 8): the one settings page a signed-out reader can open,
 * since its choices belong to this device and not to an account. Every choice is applied at once, with no Save button,
 * through lib/appearance.ts, which keeps it in this browser for theme-boot.js to paint before the next first frame, and
 * in memory on native until sub-project 5. A radio choice (a theme or a segment) plays the selection haptic first (5.3);
 * the switches play none, as ordinary taps play none. The page ends with what korbat keeps on this device and the button
 * that clears it.
 */

type RadioField = "theme" | "darkStyle" | "textStep" | "font" | "reduceMotion";
type SwitchField = "autoLoad" | "openNewest" | "hideCounts";

interface RadioGroupSpec<K extends RadioField> {
  field: K;
  heading: UiWord;
  choices: readonly { value: Appearance[K]; label: UiWord }[];
}

const group = <K extends RadioField>(spec: RadioGroupSpec<K>) => spec;

/** The page's radio groups, in its order; Dark style shows only under System. */
export const APPEARANCE_RADIOS = [
  group({
    field: "theme",
    heading: "appearance.theme",
    choices: [
      { value: "system", label: "appearance.system" },
      { value: "light", label: "appearance.light" },
      { value: "dim", label: "appearance.dim" },
      { value: "dark", label: "appearance.dark" },
    ],
  }),
  group({
    field: "darkStyle",
    heading: "appearance.darkStyle",
    choices: [
      { value: "dim", label: "appearance.dim" },
      { value: "dark", label: "appearance.dark" },
    ],
  }),
  group({
    field: "textStep",
    heading: "appearance.textSize",
    choices: [
      { value: "smaller", label: "appearance.smaller" },
      { value: "default", label: "appearance.default" },
      { value: "larger", label: "appearance.larger" },
      { value: "largest", label: "appearance.largest" },
    ],
  }),
  group({
    field: "font",
    heading: "appearance.font",
    choices: [
      { value: "korbat", label: "appearance.korbatFonts" },
      { value: "system", label: "appearance.systemFont" },
    ],
  }),
  group({
    field: "reduceMotion",
    heading: "appearance.motion",
    choices: [
      { value: "system", label: "appearance.followSystem" },
      { value: "always", label: "appearance.always" },
    ],
  }),
] as const;

/** The Reading switches, off by default (decisions 6, 9 and 15; the owner's ruling 12). */
export const APPEARANCE_SWITCHES: readonly { field: SwitchField; label: UiWord }[] = [
  { field: "autoLoad", label: "appearance.autoLoad" },
  { field: "openNewest", label: "appearance.openNewest" },
  { field: "hideCounts", label: "appearance.hideCounts" },
];

/** Haptics is a switch on iOS and Android only: the web has none to turn off (5.3). */
export function hapticsShown(os: string): boolean {
  return os === "ios" || os === "android";
}

/**
 * One choice of the page, applied at once. `haptic`, given for a radio choice, plays the selection intent first, so the
 * touch lands with the change it answers (5.3).
 */
export function chooseAppearance<K extends keyof Appearance>(field: K, value: Appearance[K], haptic?: (intent: HapticIntent) => void): void {
  haptic?.("selection");
  setAppearance({ [field]: value } as Partial<Appearance>);
}

/**
 * "Clear what this device keeps": the appearance (the theme returns to System), every reading place and every draft, as
 * the session's end clears them (lib/session-end.ts), then the toast that says it is done. The device id and the passkey
 * card's Not now stay: they belong to the browser, not to an account.
 */
export function clearThisDevice(): void {
  clearSessionTraces();
  toast.show({ message: UI_WORDS["toast.cleared"] });
}

/** A theme's swatch: its page with its accent on it; System's is Light's page beside the dark style's. Decoration. */
function Swatch({ theme, darkStyle }: { theme: Appearance["theme"]; darkStyle: ThemeName }) {
  const halves: ThemeName[] = theme === "system" ? ["light", darkStyle] : [theme];
  return (
    <View aria-hidden className="h-7 w-7 flex-row overflow-hidden rounded-full border border-line-high">
      {halves.map((name) => (
        <View key={name} className="flex-1 items-center justify-center" style={{ backgroundColor: THEMES[name].surface }}>
          {theme === "system" ? null : <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: THEMES[name].accent }} />}
        </View>
      ))}
    </View>
  );
}

/** "Aa" in a text size row's own size, or a font row's own face: what the choice looks like, beside its name. Decoration. */
function Glyphs({ step, font }: { step: Appearance["textStep"]; font: Appearance["font"] }) {
  return (
    <View aria-hidden className="w-12 items-center">
      <Text tone="medium" style={textStyle("display-3", { step, font })}>
        {UI_WORDS["appearance.glyphs"]}
      </Text>
    </View>
  );
}

/** The sample post that follows the text size and the font (8.8): a monogram, a name and a body in the post variant. */
function Sample() {
  return (
    <View {...dataAttribute("sample")} className="mt-3 flex-row gap-3 rounded-card border border-line-low bg-surface p-4">
      <Avatar account={{ id: "sample", displayName: UI_WORDS["frame.wordmark"] }} size={40} />
      <View className="min-w-0 flex-1 gap-1">
        <Text variant="body-strong">{UI_WORDS["frame.wordmark"]}</Text>
        <Text variant="post">{UI_WORDS["appearance.sample"]}</Text>
      </View>
    </View>
  );
}

export default function AppearanceSettings() {
  const title = usePageTitle("title.settingsAppearance");
  const appearance = useAppearance();
  const haptic = useHaptics();
  const { state } = useSession();

  /** A group's radio rows: each chooses its value at once, with the selection haptic, and nothing when already chosen. */
  const radios = <K extends RadioField>(spec: RadioGroupSpec<K>, id: string) => (
    <RadioGroup labelledBy={id}>
      {spec.choices.map((choice) => (
        <ListRow
          key={String(choice.value)}
          label={UI_WORDS[choice.label]}
          leading={
            spec.field === "theme" ? (
              <Swatch theme={choice.value as Appearance["theme"]} darkStyle={appearance.darkStyle} />
            ) : spec.field === "textStep" ? (
              <Glyphs step={choice.value as Appearance["textStep"]} font={appearance.font} />
            ) : spec.field === "font" ? (
              <Glyphs step="default" font={choice.value as Appearance["font"]} />
            ) : undefined
          }
          control={{
            kind: "radio",
            checked: appearance[spec.field] === choice.value,
            onSelect: () => {
              if (appearance[spec.field] !== choice.value) chooseAppearance(spec.field, choice.value, haptic);
            },
          }}
        />
      ))}
    </RadioGroup>
  );

  const [theme, darkStyle, textStep, font, motion] = APPEARANCE_RADIOS;
  return (
    <AppShell>
      {title}
      <ScreenHeader title={UI_WORDS["appearance.title"]}>{state.status === "signed-in" ? <SettingsNav current="appearance" /> : null}</ScreenHeader>
      <ScreenScroll screen="appearance">
        <Section title={UI_WORDS[theme.heading]} id="appearance-theme">
          <SectionRows end={appearance.theme !== "system"}>{radios(theme, "appearance-theme")}</SectionRows>
          {appearance.theme === "system" ? (
            <Fragment>
              <Text as="h3" variant="body-strong" tone="medium" nativeID="appearance-dark-style" className="mt-4">
                {UI_WORDS[darkStyle.heading]}
              </Text>
              <SectionRows end>{radios(darkStyle, "appearance-dark-style")}</SectionRows>
            </Fragment>
          ) : null}
        </Section>
        <Section title={UI_WORDS[textStep.heading]} id="appearance-text-size">
          <Sample />
          <SectionRows end>{radios(textStep, "appearance-text-size")}</SectionRows>
        </Section>
        <Section title={UI_WORDS[font.heading]} id="appearance-font">
          <SectionRows end>{radios(font, "appearance-font")}</SectionRows>
        </Section>
        <Section title={UI_WORDS[motion.heading]} id="appearance-motion">
          <SectionRows end={!hapticsShown(Platform.OS)}>{radios(motion, "appearance-motion")}</SectionRows>
          {/* Haptics sits with motion, the other feedback the body feels; reduced motion does not turn it off (5.3). */}
          {hapticsShown(Platform.OS) ? (
            <SectionRows end>
              <ListRow label={UI_WORDS["appearance.haptics"]} control={{ kind: "switch", value: appearance.haptics, onValueChange: (next) => chooseAppearance("haptics", next) }} />
            </SectionRows>
          ) : null}
        </Section>
        <Section title={UI_WORDS["appearance.reading"]}>
          <SectionRows end>
            {APPEARANCE_SWITCHES.map(({ field, label }) => (
              <ListRow key={field} label={UI_WORDS[label]} control={{ kind: "switch", value: appearance[field], onValueChange: (next) => chooseAppearance(field, next) }} />
            ))}
          </SectionRows>
        </Section>
        <Section title={UI_WORDS["device.title"]}>
          <Body>{UI_WORDS["device.body"]}</Body>
          <Button label={UI_WORDS["device.clear"]} onPress={clearThisDevice} tone="secondary" />
        </Section>
      </ScreenScroll>
    </AppShell>
  );
}

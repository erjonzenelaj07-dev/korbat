import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, Switch, View } from "react-native";
import { Link, type Href } from "expo-router";
import type { IconName } from "@/components/icons";
import { cn } from "@/theme/cn";
import { useTheme } from "@/theme/ThemeProvider";
import { Icon } from "./Icon";
import { FOCUS_RING_INSET, HOVER_WASH, pressDelay } from "./interaction";
import { radioMove } from "./Tabs";
import { Text } from "./Text";

/**
 * One row for settings, lists of accounts, menus on phones and the details sheet (UI design, section 6.11), in four
 * forms by what it does: a link (`href`, an anchor with a chevron), a button (`onPress`), a switch, and a radio in a
 * RadioGroup. `label` is required: it is the row's title and its accessible name (section 6.1). The row is 52 px tall at
 * least (a 44 px target and its padding), divided by line-low, surface-2 under a fine pointer, and surface-2 when
 * pressed, after 80 ms, since a scroll starts on rows. Rows never scale. Their focus ring is drawn inside, where the
 * column's edges cannot clip it.
 *
 * UI Task 5 extends it for a list of accounts (8.4): `leading` puts an element (the account's Avatar) in the icon's
 * place, `badge` follows the label (the VerifiedChip), `detail` replaces the meta line (the handle in the mono face and
 * the bio), and a link row may carry a control of the kind "button" (FollowButton), drawn beside the link and outside
 * it, since a button inside an anchor is a control no assistive technology can reach; such a row has no chevron.
 *
 * UI Task 8 (8.8): a radio row is the group's one tab stop while it is chosen, and RadioGroup's arrows move the choice; a
 * switch row may carry a Switch element of its own (`element`, Privacy's "Show my posts in Explore", whose line a test
 * reads) in place of the row's, with the row's flip and ring; and a row that only informs (`info`, a device of Security's
 * sessions) is neither a link nor a button, with an optional control of its own beside its words.
 */
export type ListRowControl =
  | { kind: "switch"; value: boolean; onValueChange: (next: boolean) => void; disabled?: boolean; element?: ReactElement }
  | { kind: "radio"; checked: boolean; onSelect: () => void };

/** A control of its own beside a link row: an element with its own name and press (FollowButton). */
export type ListRowButton = { kind: "button"; element: ReactElement };

interface RowContent {
  label: string;
  /** One line under the label, in meta. */
  description?: string;
  icon?: IconName;
  /** A short trailing text, such as the chosen theme. */
  value?: string;
  tone?: "default" | "danger";
  /** In the icon's place: an account's Avatar. */
  leading?: ReactNode;
  /** After the label: the VerifiedChip. */
  badge?: ReactNode;
  /** Under the label in place of the description: an account's handle and bio. */
  detail?: ReactNode;
}

export type ListRowProps = RowContent & ({ href: Href; control?: ListRowButton } | { onPress: () => void } | { control: ListRowControl } | { info: true; control?: ListRowButton });

/**
 * A switch's colours from the theme: the accent track with an on-accent thumb when on, line-high with a surface-1 thumb
 * when off. react-native-web paints the thumb of a switch that is on in its own teal unless `activeThumbColor` names
 * another colour, a prop React Native's types do not know, so it goes through one cast here.
 */
export function switchColours(colors: Record<"line-high" | "accent" | "on-accent" | "surface-1", string>): object {
  return { trackColor: { false: colors["line-high"], true: colors.accent }, thumbColor: colors["surface-1"], activeThumbColor: colors["on-accent"] };
}

const ROW = cn("min-h-[52px] flex-row items-center gap-3 border-b border-line-low px-4 py-3", HOVER_WASH);

/**
 * The switch row's ring. react-native-web draws a switch's focus as a faint shadow on its thumb, which forced colours
 * remove, so the row draws korbat's ring, inside, while the switch in it has keyboard focus.
 */
const SWITCH_RING = "web:has-[:focus-visible]:outline web:has-[:focus-visible]:outline-2 web:has-[:focus-visible]:-outline-offset-2 web:has-[:focus-visible]:outline-focus";

/**
 * One ring, not two (UI Task 8): the browser's own ring on the switch's hidden checkbox gives way to the row's, which
 * SWITCH_RING draws as korbat's focus-visible:outline; outline-none is a transparent outline, which forced colours still show.
 */
const ONE_RING = "web:[&_input]:outline-none"; // The row's focus-visible:outline above is the ring a keyboard sees.

/** The pressed wash, after the 80 ms delay; an inline colour, so it shows over the hover's class. */
function usePressedWash() {
  const { colors } = useTheme();
  return (pressed: boolean) => (pressed ? { backgroundColor: colors["surface-2"] } : undefined);
}

/** The label, its description, and what trails it. */
function Content({ label, description, icon, value, tone = "default", leading, badge, detail, trailing }: RowContent & { trailing?: ReactNode }) {
  const danger = tone === "danger";
  const title = (
    <Text variant="body-strong" tone={danger ? "danger" : "high"} className={badge === undefined ? undefined : "shrink"}>
      {label}
    </Text>
  );
  return (
    <>
      {leading ?? (icon !== undefined ? <Icon name={icon} size={20} tone={danger ? "danger" : "medium"} /> : null)}
      <View className="min-w-0 flex-1 gap-0.5">
        {badge === undefined ? (
          title
        ) : (
          <View className="flex-row flex-wrap items-center gap-x-1.5">
            {title}
            {badge}
          </View>
        )}
        {detail}
        {description !== undefined ? (
          <Text variant="meta" tone="low">
            {description}
          </Text>
        ) : null}
      </View>
      {value !== undefined ? <Text tone="low">{value}</Text> : null}
      {trailing}
    </>
  );
}

/** The circle of a radio row: a ring, filled with the accent when chosen; the row's aria-checked says the same in words. */
function RadioMark({ checked }: { checked: boolean }) {
  return (
    <View className={cn("h-5 w-5 items-center justify-center rounded-full border-2", checked ? "border-accent" : "border-line-high")}>
      {checked ? <View className="h-2.5 w-2.5 rounded-full bg-accent" /> : null}
    </View>
  );
}

export function ListRow(props: ListRowProps) {
  const wash = usePressedWash();
  const { colors } = useTheme();
  const { label, description, icon, value, tone, leading, badge, detail } = props;
  const content = { label, description, icon, value, tone, leading, badge, detail };

  if ("href" in props) {
    const link = (
      <Link href={props.href} asChild>
        <Pressable {...pressDelay(80)} className={cn(FOCUS_RING_INSET, props.control ? "min-w-0 flex-1" : undefined)}>
          {({ pressed }) => (
            <View className={props.control ? cn(ROW, "border-b-0 pr-2") : ROW} style={wash(pressed)}>
              <Content {...content} trailing={props.control ? undefined : <Icon name="next" size={20} tone="low" />} />
            </View>
          )}
        </Pressable>
      </Link>
    );
    if (!props.control) return link;
    // The control beside the link, in the same row and under the same divider, but no part of the anchor.
    return (
      <View className="flex-row items-center border-b border-line-low pr-4">
        {link}
        {props.control.element}
      </View>
    );
  }

  if ("info" in props) {
    return (
      <View className="min-h-[52px] flex-row items-center gap-3 border-b border-line-low px-4 py-3">
        <Content {...content} trailing={props.control?.element} />
      </View>
    );
  }

  if ("onPress" in props) {
    return (
      <Pressable accessibilityRole="button" onPress={props.onPress} {...pressDelay(80)} className={FOCUS_RING_INSET}>
        {({ pressed }) => (
          <View className={ROW} style={wash(pressed)}>
            <Content {...content} />
          </View>
        )}
      </Pressable>
    );
  }

  const control = props.control;
  if (control.kind === "radio") {
    return (
      // The group's one tab stop is its chosen radio; the arrows reach the others (RadioGroup), so a group always has one chosen.
      <Pressable role="radio" aria-checked={control.checked} tabIndex={control.checked ? 0 : -1} onPress={control.onSelect} {...pressDelay(80)} className={FOCUS_RING_INSET}>
        {({ pressed }) => (
          <View className={ROW} style={wash(pressed)}>
            <Content {...content} trailing={<RadioMark checked={control.checked} />} />
          </View>
        )}
      </Pressable>
    );
  }

  // The switch is the one control, with its own name and state: Tab reaches it and Space flips it. The row around it
  // flips it too for a pointer, as a convenience: it is no tab stop and no second control, and the switch takes no
  // pointer of its own, so one click never flips it twice.
  const flip = () => {
    if (!control.disabled) control.onValueChange(!control.value);
  };
  return (
    <Pressable onPress={flip} tabIndex={-1} {...pressDelay(80)}>
      {({ pressed }) => (
        <View className={cn(ROW, SWITCH_RING, ONE_RING)} style={wash(pressed)}>
          <Content
            {...content}
            trailing={
              <View pointerEvents="none">
                {control.element ?? <Switch accessibilityLabel={label} value={control.value} onValueChange={control.onValueChange} disabled={control.disabled} {...switchColours(colors)} />}
              </View>
            }
          />
        </View>
      )}
    </Pressable>
  );
}

/**
 * On the web, what a key does in a radio group (UI Task 8, WAI-ARIA's radio group pattern): the arrows move the focus to
 * the next or the previous radio and choose it at once, through the row's own press, with no motion of their own (5.1);
 * Space chooses the radio that has the focus. Native assistive technology has its own gestures for a radio group.
 */
function radioKeys(event: { key: string; currentTarget: unknown; preventDefault(): void }): void {
  const radios = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="radio"]')];
  const focused = radios.findIndex((radio) => radio === document.activeElement);
  if (event.key === " ") {
    if (focused !== -1 && radios[focused]!.getAttribute("aria-checked") !== "true") {
      event.preventDefault();
      radios[focused]!.click();
    }
    return;
  }
  const from = focused !== -1 ? focused : radios.findIndex((radio) => radio.getAttribute("aria-checked") === "true");
  const next = radioMove(Math.max(from, 0), event.key, radios.length);
  if (next === null) return;
  event.preventDefault();
  radios[next]!.focus();
  radios[next]!.click();
}

/** A group of radio rows, named by its heading's nativeID (section 6.11). */
export function RadioGroup({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  return (
    <View role="radiogroup" aria-labelledby={labelledBy} {...(Platform.OS === "web" ? ({ onKeyDown: radioKeys } as object) : {})}>
      {children}
    </View>
  );
}

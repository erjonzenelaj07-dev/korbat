import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useHaptics } from "@/lib/haptics";
import { useMotion } from "@/lib/motion";
import { cn } from "@/theme/cn";
import { useTheme } from "@/theme/ThemeProvider";
import { FOCUS_RING, HOVER_WASH, lastInputWasKeyboard, pressDelay } from "./interaction";
import { Text } from "./Text";

/**
 * Tabs (UI design, section 6.10): Home's Following, Latest and Explore, a profile's Posts, Replies and Likes, and later
 * Settings' and Cases' lists. A tab list named by `label` (required, so tsc refuses a nameless one), a tab per entry with
 * aria-selected and its label as its first text, and one tab stop: the selected tab; on the web Left and Right move and
 * select at once, wrapping, and Home and End jump. The content below is a TabPanel named by the selected tab.
 *
 * The look: each label in body-strong, ink-low, and ink-high when selected, over a 2 px accent underline that moves and
 * resizes to the chosen tab on the spring-snap for a pointer, and jumps for a key and under reduced motion (5.1: keyboard
 * actions do not animate). The underline is a border, which forced colours keep. The row scrolls sideways when the
 * labels are wider than the column and never wraps into two rows. Choosing a tab plays the selection haptic.
 */

export interface TabItem<K extends string> {
  key: K;
  label: string;
}

export interface TabsProps<K extends string> {
  /** The tab list's name. */
  label: string;
  tabs: readonly TabItem<K>[];
  selected: K;
  onSelect: (key: K) => void;
  /** The id of the TabPanel the tabs control. */
  panelId: string;
}

/** A tab's id, which its panel is named by. */
export const tabId = (panelId: string, key: string): string => `${panelId}-tab-${key}`;

/** Where a key moves the selection among `count` tabs from `current`: Left and Right wrap, Home and End jump; null for any other key. */
export function tabMove(current: number, key: string, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/**
 * Where a key moves the choice in a radio group of `count` radios from `current` (UI Task 8, section 6.11, after
 * WAI-ARIA's radio group pattern): Down and Right to the next, Up and Left to the one before, wrapping; null for any other
 * key, Home and End included, which the pattern does not give a radio group. kit/ListRow.tsx's RadioGroup moves the focus
 * and the choice together, at once, as Tabs does for its arrows.
 */
export function radioMove(current: number, key: string, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowDown" || key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowUp" || key === "ArrowLeft") return (current - 1 + count) % count;
  return null;
}

/** The underline is a bar this wide, scaled to the tab's width, so only its transform moves (5.1). */
const BAR = 100;

export function Tabs<K extends string>({ label, tabs, selected, onSelect, panelId }: TabsProps<K>) {
  const motion = useMotion();
  const haptic = useHaptics();
  const { colors } = useTheme();
  // Each tab's measured width. Its place is the sum of the widths before it (the tabs sit side by side with no gap),
  // since react-native-web reports a layout when a size changes and not when a tab only moves (a tab added before it).
  const widths = useRef(new Map<string, number>());
  const [measured, setMeasured] = useState(0);
  const x = useSharedValue(0);
  const width = useSharedValue(0);
  const shown = useRef(false);

  // The underline goes to the selected tab once both are measured: on a spring for a pointer, at once for a key, under
  // reduced motion and the first time. A value already at its target is left alone (Reanimated would not start it).
  const order = tabs.map((tab) => tab.key).join(" ");
  useEffect(() => {
    const at = tabs.findIndex((tab) => tab.key === selected);
    const before = tabs.slice(0, at + 1).map((tab) => widths.current.get(tab.key));
    if (at < 0 || before.some((wide) => wide === undefined)) return;
    const frame = { x: before.slice(0, at).reduce<number>((sum, wide) => sum + wide!, 0), width: before[at]! };
    const still = !shown.current || motion.reduced || lastInputWasKeyboard();
    shown.current = true;
    for (const [value, target] of [
      [x, frame.x],
      [width, frame.width],
    ] as const) {
      if (value.value === target) continue;
      value.value = still ? target : withSpring(target, motion.spring("springSnap"));
    }
  }, [selected, measured, motion.reduced, order]);

  const bar = useAnimatedStyle(() => ({
    opacity: width.value > 0 ? 1 : 0,
    transform: [{ translateX: x.value + (width.value - BAR) / 2 }, { scaleX: width.value / BAR }],
  }));

  const choose = (key: K) => {
    if (key === selected) return;
    haptic("selection");
    onSelect(key);
  };

  // Left and Right select at once and move the focus with the selection; the underline jumps (a key never animates).
  const keys = (event: KeyboardEvent) => {
    const next = tabMove(
      tabs.findIndex((tab) => tab.key === selected),
      event.key,
      tabs.length,
    );
    if (next === null) return;
    event.preventDefault();
    const key = tabs[next]!.key;
    choose(key);
    (document.getElementById(tabId(panelId, key)) as HTMLElement | null)?.focus();
  };

  const measure = (key: K) => (event: LayoutChangeEvent) => {
    const wide = event.nativeEvent.layout.width;
    if (widths.current.get(key) === wide) return;
    widths.current.set(key, wide);
    setMeasured((count) => count + 1);
  };

  return (
    // The room around the row keeps each tab's focus ring inside the scroll view, which clips what overflows it.
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 4, paddingHorizontal: 4 }} className="-mx-1">
      <View role="tablist" aria-label={label} {...(Platform.OS === "web" ? ({ onKeyDown: keys } as object) : {})} className="flex-row">
        {tabs.map((tab) => {
          const on = tab.key === selected;
          return (
            <Pressable
              key={tab.key}
              nativeID={tabId(panelId, tab.key)}
              accessibilityRole="tab"
              aria-selected={on}
              aria-controls={panelId}
              tabIndex={on ? 0 : -1}
              onPress={() => choose(tab.key)}
              onLayout={measure(tab.key)}
              {...pressDelay(0)}
              className={cn("min-h-[44px] justify-center rounded-control px-3 pb-2.5 pt-2 active:bg-surface-2", HOVER_WASH, FOCUS_RING)}
            >
              <Text variant="body-strong" tone={on ? "high" : "low"} maxFontSizeMultiplier={1.5}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
        <Animated.View
          pointerEvents="none"
          aria-hidden
          style={[{ position: "absolute", left: 0, bottom: 0, width: BAR, height: 0, borderTopWidth: 2, borderColor: colors.accent }, bar]}
        />
      </View>
    </ScrollView>
  );
}

/** The content under Tabs: a tab panel named by the selected tab. */
export function TabPanel({ panelId, selected, children }: { panelId: string; selected: string; children: ReactNode }) {
  return (
    <View role="tabpanel" nativeID={panelId} aria-labelledby={tabId(panelId, selected)} className="flex-1">
      {children}
    </View>
  );
}

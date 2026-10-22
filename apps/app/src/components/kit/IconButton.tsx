import { cva } from "class-variance-authority";
import { useEffect, useRef, useState, type Ref } from "react";
import { Platform, Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import type { IconName } from "@/components/icons";
import { compactCount } from "@/lib/format";
import { useMotion, usePressScale } from "@/lib/motion";
import { cn } from "@/theme/cn";
import { Icon } from "./Icon";
import { FOCUS_RING, HOVER_WASH, pressDelay } from "./interaction";
import { Text, type Tone } from "./Text";

/**
 * A control drawn as an icon (UI design, section 6.3): the post's actions, More, Back, Close. `label` is required and is
 * its accessible name, since the icon itself is hidden from assistive technology; a toggle whose name stays the same
 * says whether it is on through `pressed`, and a trigger says what it opens and whether it is open through `hasPopup`
 * and `expanded`. It answers at once on pointer-down with section 5.2's press (scale 0.92; reduced, none), takes
 * surface-2 under a fine pointer, and shows the focus ring. Its target is at least 44 by 44 px.
 *
 * `count` is a visible number beside the icon, inside the button, formatted by compactCount() and hidden from the name,
 * because the label already says it ("Like, 12 likes"). The caller decides when a count shows: it leaves `count` out,
 * and drops the number from the label too, when the count is zero or the reader hides counts (decision 15, which hides
 * like and repost counts and keeps reply and quote counts). IconButton never reads that setting itself.
 */
export type IconButtonTone = "low" | "high" | "accent" | "danger";

const ICON_TONE: Record<IconButtonTone, Tone> = { low: "low", high: "high", accent: "accent", danger: "danger" };

/** The target: round, 44 px at least, the hover wash and the ring. A counted button grows to fit its number. */
const target = cva(cn("min-h-[44px] min-w-[44px] flex-row items-center justify-center gap-1 rounded-full", HOVER_WASH, FOCUS_RING), {
  variants: { counted: { true: "px-2", false: "" } },
});

export interface IconButtonProps {
  icon: IconName;
  /** The accessible name, and the tooltip's words on the web. */
  label: string;
  onPress: () => void;
  /** aria-pressed, for a toggle whose name stays the same (Like, Repost); leave it out for any other button. */
  pressed?: boolean;
  /** The action's request is still out: aria-busy, and the icon at 60 percent (section 5.2, pending). */
  busy?: boolean;
  count?: number;
  /** The icon's colour: ink-low at rest, the accent for what the reader has turned on (decision 13). */
  tone?: IconButtonTone;
  /** A filled icon: a Heart or a Bookmark that is on. */
  filled?: boolean;
  disabled?: boolean;
  hasPopup?: "menu" | "dialog";
  /** Whether the menu or dialog the button opens is open now. */
  expanded?: boolean;
  ref?: Ref<View>;
}

/**
 * The tooltip's delay, and how long after one closes its neighbours still show theirs at once: moving along a row of
 * icon buttons reads each name without waiting again (section 6.3).
 */
const TOOLTIP_DELAY = 500;
const TOOLTIP_WARM = 300;
let tooltipsOpen = 0;
let warmUntil = 0;

/** Whether this pointer can hover, which a touch screen cannot; hover events from a tap never show a tooltip. */
function finePointer(): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

/**
 * The label above an icon-only button on the web, after 500 ms of hover, at once while a neighbour's is open. It grows
 * from the button (opacity, and scale 0.97 to 1 over 125 ms; reduced, opacity only; at once, neither), adds no aria,
 * since it repeats the name, and takes no pointer, so it never covers what is under it.
 */
function useTooltip() {
  const motion = useMotion();
  const [shown, setShown] = useState(false);
  // Whether this button's tooltip counts among the open ones; a ref, so the count never depends on a render.
  const open = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.97);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));

  const show = (instant: boolean) => {
    if (!open.current) {
      open.current = true;
      tooltipsOpen += 1;
    }
    setShown(true);
    if (instant) {
      opacity.value = 1;
      scale.value = 1;
      return;
    }
    opacity.value = 0;
    scale.value = motion.reduced ? 1 : 0.97;
    opacity.value = withTiming(1, motion.timing("easeOut", 125));
    if (!motion.reduced) scale.value = withTiming(1, motion.timing("easeOut", 125));
  };
  const hide = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (open.current) {
      open.current = false;
      tooltipsOpen -= 1;
      warmUntil = Date.now() + TOOLTIP_WARM;
    }
    setShown(false);
  };
  const onHoverIn = () => {
    if (!finePointer()) return;
    if (tooltipsOpen > 0 || Date.now() < warmUntil) show(true);
    else timer.current = setTimeout(() => show(false), TOOLTIP_DELAY);
  };
  // A button that leaves the screen while its tooltip shows still closes it, so the count of open ones stays true.
  useEffect(() => hide, []);
  return { shown, style, onHoverIn, hide };
}

export function IconButton({ icon, label, onPress, pressed, busy = false, count, tone, filled = false, disabled = false, hasPopup, expanded, ref }: IconButtonProps) {
  const press = usePressScale(0.92);
  const tooltip = useTooltip();
  const shown = count !== undefined && count > 0 ? compactCount(count) : null;
  const iconTone = ICON_TONE[tone ?? (pressed ? "accent" : "low")];
  // A press answers at once and puts the tooltip away: the reader is acting, no longer asking what the button is.
  const onPressIn = () => {
    tooltip.hide();
    press.handlers.onPressIn();
  };
  return (
    <Animated.View style={press.style}>
      <Pressable
        ref={ref}
        accessibilityRole="button"
        aria-label={label}
        aria-pressed={pressed}
        aria-busy={busy || undefined}
        aria-haspopup={hasPopup}
        aria-expanded={hasPopup === undefined ? undefined : (expanded ?? false)}
        disabled={disabled}
        onPress={onPress}
        onHoverIn={tooltip.onHoverIn}
        onHoverOut={tooltip.hide}
        onPressIn={onPressIn}
        onPressOut={press.handlers.onPressOut}
        {...pressDelay(0)}
        className={target({ counted: shown !== null })}
      >
        <View className={cn("flex-row items-center gap-1 web:transition-opacity web:duration-150", busy ? "opacity-60" : "opacity-100")}>
          <Icon name={icon} size={20} tone={iconTone} filled={filled} />
          {shown !== null ? (
            <Text variant="meta" tone={iconTone} aria-hidden>
              {shown}
            </Text>
          ) : null}
        </View>
        {tooltip.shown ? (
          <View aria-hidden pointerEvents="none" className="absolute bottom-full left-[-120px] right-[-120px] mb-1 items-center">
            <Animated.View style={tooltip.style}>
              <View className="rounded-control border border-line-high bg-surface-1 px-2 py-1 web:forced-colors:border-[color:CanvasText]">
                <Text variant="meta">{label}</Text>
              </View>
            </Animated.View>
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

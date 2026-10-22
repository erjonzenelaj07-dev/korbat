import { cva } from "class-variance-authority";
import { useEffect, useRef, useState, type Ref } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import type { IconName } from "@/components/icons";
import { compactCount } from "@/lib/format";
import { useMotion, usePressScale, type PopName } from "@/lib/motion";
import { cn } from "@/theme/cn";
import { Icon } from "./Icon";
import { FOCUS_RING, HOVER_WASH, lastInputWasKeyboard, pressDelay } from "./interaction";
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
 *
 * The post's toggles (Like, Repost, Save) also take `feedback`, the motion of the reader's last press, and Repost takes
 * `disc`, its "on" look (UI Task 4 extends IconButton with both rather than building a second button on it).
 */
export type IconButtonTone = "low" | "high" | "accent" | "danger";

const ICON_TONE: Record<IconButtonTone, Tone> = { low: "low", high: "high", accent: "accent", danger: "danger" };

/** The target: round, 44 px at least, the hover wash and the ring. A counted button grows to fit its number. */
const target = cva(cn("min-h-[44px] min-w-[44px] flex-row items-center justify-center gap-1 rounded-full", HOVER_WASH, FOCUS_RING), {
  variants: { counted: { true: "px-2", false: "" } },
});

/**
 * A toggle's motion (section 5.2), played once for each new `at`. "on" pops: one spring released from the pressed scale
 * (Like's underdamped to about 1.15, with an accent ring at 40 percent growing from 0.6 to 1.4 as it fades, in 300 ms;
 * Repost's and Save's firmer, no ring). "off" never pops: the old look fades out over the new in 120 ms. "back" is the
 * rollback of a refused action: the old state returns with one 4 px nudge sideways over 200 ms. A count that moved rolls
 * 6 px, the old number out and the new one in from the other side, in 180 ms. Under reduced motion, and for a press made
 * with the keyboard, nothing moves: the look and the number cross-fade in 120 ms.
 */
export interface IconButtonFeedback {
  at: number;
  turn: "on" | "off" | "back";
  pop?: PopName;
  /** Which way the count moved: up, down, or not at all. */
  count?: 1 | -1 | 0;
}

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
  /**
   * The reposted look (section 4.7): Repeat2 has no closed shape to fill, so "on" draws it at stroke 2.25 inside a 28 px
   * accent-wash disc with a 1.5 px accent ring, and its count turns body-strong, a shape cue as the fill is.
   */
  disc?: boolean;
  /** What the reader's last press of a toggle did, for its motion; a new `at` plays it once. */
  feedback?: IconButtonFeedback;
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

/** What a button looks like at one moment, kept so the next look can cross-fade over it. */
interface Look {
  tone: Tone;
  filled: boolean;
  disc: boolean;
  shown: string | null;
}

/** The icon in its 28 px box, which draws the reposted disc when asked. */
function Glyph({ icon, look }: { icon: IconName; look: Look }) {
  return (
    <View className={cn("h-7 w-7 items-center justify-center rounded-full", look.disc ? "border-[1.5px] border-accent bg-accent-wash" : "")}>
      <Icon name={icon} size={20} tone={look.tone} filled={look.filled} strong={look.disc} />
    </View>
  );
}

/** The visible number, hidden from the name, which says it already. */
function Count({ look }: { look: Look }) {
  return (
    <Text variant={look.disc ? "body-strong" : "meta"} tone={look.tone} aria-hidden>
      {look.shown}
    </Text>
  );
}

/** An icon button's pressed scale (section 5.2), which a toggle's pop is released from. */
const PRESSED = 0.92;

export function IconButton({ icon, label, onPress, pressed, busy = false, count, tone, filled = false, disabled = false, hasPopup, expanded, disc = false, feedback, ref }: IconButtonProps) {
  const motion = useMotion();
  const press = usePressScale(PRESSED);
  const tooltip = useTooltip();
  const shown = count !== undefined && count > 0 ? compactCount(count) : null;
  const iconTone = ICON_TONE[tone ?? (pressed ? "accent" : "low")];
  const look: Look = { tone: iconTone, filled, disc, shown };

  // The look before the last change, drawn over the new one while it fades out; the count's old number likewise.
  const [leaving, setLeaving] = useState<Look | null>(null);
  const [rolling, setRolling] = useState<string | null>(null);
  const before = useRef(look);
  const played = useRef(feedback?.at ?? 0);
  const ringScale = useSharedValue(0.6);
  const ringOpacity = useSharedValue(0);
  const nudge = useSharedValue(0);
  const fadeIn = useSharedValue(1);
  const fadeOut = useSharedValue(0);
  const numberIn = useSharedValue(0);
  const numberOut = useSharedValue(0);

  useEffect(() => {
    if (feedback === undefined || feedback.at === played.current) return;
    played.current = feedback.at;
    const previous = before.current;
    const plain = motion.reduced || lastInputWasKeyboard();
    if (plain || feedback.turn !== "on") {
      setLeaving(previous);
      fadeIn.value = 0;
      fadeOut.value = 1;
      fadeIn.value = withTiming(1, motion.timing("easeOut", 120));
      fadeOut.value = withTiming(0, motion.timing("easeOut", 120), (finished) => {
        "worklet";
        if (finished) runOnJS(setLeaving)(null);
      });
    }
    if (plain) return;
    if (feedback.turn === "on") {
      // Released from the pressed scale, 0.92, with the pop's own velocity. The scale is set there first, which also stops
      // the press's own timing: Reanimated 4.5 skips an animation whose value already sits at its target (a quick tap is
      // back at 1 before its first frame), and it adds a new spring's velocity to the running animation's, which for a
      // timing is no number, so the pop would start still.
      press.value.value = Math.min(press.value.value, PRESSED);
      press.value.value = withSpring(1, motion.pop(feedback.pop ?? "springToggle"));
      if (feedback.pop === "springLike") {
        ringScale.value = 0.6;
        ringOpacity.value = 0.4;
        ringScale.value = withTiming(1.4, motion.timing("easeOut", 300));
        ringOpacity.value = withTiming(0, motion.timing("easeOut", 300));
      }
    }
    if (feedback.turn === "back") nudge.value = withSequence(withTiming(4, motion.timing("easeOut", 70)), withTiming(0, motion.timing("easeOut", 130)));
    const dir = feedback.count ?? 0;
    if (dir !== 0 && previous.shown !== null && previous.shown !== shown) {
      setRolling(previous.shown);
      numberIn.value = dir * 6;
      numberOut.value = 0;
      numberIn.value = withTiming(0, motion.timing("easeOut", 180));
      numberOut.value = withTiming(-dir * 6, motion.timing("easeOut", 180), (finished) => {
        "worklet";
        if (finished) runOnJS(setRolling)(null);
      });
    }
  }, [feedback?.at]);
  // After the feedback has read it: the look this render committed is the one the next change leaves from.
  useEffect(() => {
    before.current = look;
  });

  const nudgeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: nudge.value }] }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: ringOpacity.value, transform: [{ scale: ringScale.value }] }));
  const inStyle = useAnimatedStyle(() => ({ opacity: fadeIn.value }));
  const outStyle = useAnimatedStyle(() => ({ opacity: fadeOut.value }));
  const numberInStyle = useAnimatedStyle(() => ({ transform: [{ translateY: numberIn.value }], opacity: 1 - Math.abs(numberIn.value) / 6 }));
  const numberOutStyle = useAnimatedStyle(() => ({ transform: [{ translateY: numberOut.value }], opacity: 1 - Math.abs(numberOut.value) / 6 }));

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
        <Animated.View style={nudgeStyle}>
          <View className={cn("flex-row items-center gap-1 web:transition-opacity web:duration-150", busy ? "opacity-60" : "opacity-100")}>
            <View>
              {/* Like's ring, behind the heart: nothing to see until it pops. */}
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, ringStyle]}>
                <View aria-hidden className="h-7 w-7 rounded-full border-2 border-accent" />
              </Animated.View>
              <Animated.View style={inStyle}>
                <Glyph icon={icon} look={look} />
              </Animated.View>
              {leaving ? (
                <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, outStyle]}>
                  <Glyph icon={icon} look={leaving} />
                </Animated.View>
              ) : null}
            </View>
            {shown !== null ? (
              <View>
                <Animated.View style={rolling !== null ? numberInStyle : inStyle}>
                  <Count look={look} />
                </Animated.View>
                {rolling !== null ? (
                  <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, numberOutStyle]}>
                    <Count look={{ ...look, shown: rolling }} />
                  </Animated.View>
                ) : null}
              </View>
            ) : null}
          </View>
        </Animated.View>
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

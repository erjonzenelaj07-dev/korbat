import { useCallback, useEffect, useMemo } from "react";
import {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type WithSpringConfig,
  type WithTimingConfig,
} from "react-native-reanimated";
import { MOTION } from "@/theme/motion";
import { useAppearance } from "./appearance";

/**
 * Motion for every component (UI design, sections 5.1 and 5.2). useMotion() is the one place that decides whether to
 * reduce motion, from either source: the operating system (Reanimated's useReducedMotion(), which reads
 * prefers-reduced-motion on the web) and the reader's own "Reduce motion: Always". No component reads either on its own,
 * so the browser check can flip both. Reduced means no movement, not no feedback: colour and opacity still change, at
 * 150 ms or less. The values are theme/motion.ts's.
 */
export type SpringName = "springSnap" | "springRelease";

/** easeOut and easeInOut take the duration the animation's row of section 5.2 gives; the others have their own. */
export type TimingName = "easeOut" | "easeInOut" | "pressIn" | "pressOut" | "fade";

export interface Motion {
  reduced: boolean;
  spring(name: SpringName): WithSpringConfig;
  timing(name: TimingName, duration?: number): WithTimingConfig;
}

const bezier = (points: readonly [number, number, number, number]) => Easing.bezier(points[0], points[1], points[2], points[3]);

/** The curve and the default duration of each timing, in ms; easeOut and easeInOut default to the fade's 150. */
const TIMINGS: Record<TimingName, { easing: readonly [number, number, number, number]; duration: number }> = {
  easeOut: { easing: MOTION.easeOut.easing, duration: MOTION.fade.duration },
  easeInOut: { easing: MOTION.easeInOut.easing, duration: MOTION.fade.duration },
  pressIn: { easing: MOTION.press.easing, duration: MOTION.press.in },
  pressOut: { easing: MOTION.press.easing, duration: MOTION.press.out },
  fade: { easing: MOTION.fade.easing, duration: MOTION.fade.duration },
};

export function useMotion(): Motion {
  const system = useReducedMotion();
  const { reduceMotion } = useAppearance();
  const reduced = system || reduceMotion === "always";
  return useMemo<Motion>(
    () => ({
      reduced,
      // korbat chooses each reduced form itself, so Reanimated never skips a timing on its own; a spring is movement,
      // so under reduced motion one that a component starts anyway lands at once.
      spring: (name) => ({ dampingRatio: MOTION[name].dampingRatio, duration: MOTION[name].duration, reduceMotion: reduced ? ReduceMotion.Always : ReduceMotion.Never }),
      timing: (name, duration) => ({ duration: duration ?? TIMINGS[name].duration, easing: bezier(TIMINGS[name].easing), reduceMotion: ReduceMotion.Never }),
    }),
    [reduced],
  );
}

/**
 * The pressed scale of section 5.2 (buttons 0.97, icon buttons 0.92): in on pointer-down over press-in, back on release
 * over press-out, each retargeting from the current scale, so a second press mid-way never jumps. Under reduced motion
 * nothing scales; the control's own colour change is its feedback. Spread `handlers` on the Pressable and give `style`
 * to the Animated.View around it.
 */
export function usePressScale(scale: number) {
  const motion = useMotion();
  const value = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: value.value }] }));
  const onPressIn = useCallback(() => {
    if (!motion.reduced) value.value = withTiming(scale, motion.timing("pressIn"));
  }, [motion, scale, value]);
  const onPressOut = useCallback(() => {
    value.value = withTiming(1, motion.timing("pressOut"));
  }, [motion, value]);
  return { style, handlers: { onPressIn, onPressOut } };
}

/**
 * Section 5.2's pulse: opacity between 1 and 0.6, 1.6 s a cycle, ease-in-out, until it unmounts. It is the skeleton's
 * motion, which under reduced motion stands still at 0.8; and it is the spinner's reduced form, which keeps pulsing,
 * since an opacity change is not movement (`still: false`). `on` false leaves it at 1 without animating.
 */
export function usePulse({ on = true, still = true }: { on?: boolean; still?: boolean } = {}) {
  const motion = useMotion();
  const stands = on && still && motion.reduced;
  const opacity = useSharedValue(stands ? 0.8 : 1);
  useEffect(() => {
    if (!on) return;
    if (stands) {
      cancelAnimation(opacity);
      opacity.value = 0.8;
      return;
    }
    // Half a cycle each way: 800 ms down to 0.6, 800 ms back up, repeated for as long as the work goes on.
    opacity.value = withRepeat(withTiming(0.6, motion.timing("easeInOut", 800)), -1, true);
    return () => cancelAnimation(opacity);
  }, [motion, on, stands, opacity]);
  return useAnimatedStyle(() => ({ opacity: opacity.value }));
}

/** Section 5.2's spinner: one turn every 800 ms, linear. Under reduced motion it does not turn; the caller pulses instead. */
export function useSpin() {
  const motion = useMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (motion.reduced) {
      cancelAnimation(turn);
      turn.value = 0;
      return;
    }
    turn.value = withRepeat(withTiming(360, { duration: 800, easing: Easing.linear, reduceMotion: ReduceMotion.Never }), -1, false);
    return () => cancelAnimation(turn);
  }, [motion, turn]);
  return useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
}

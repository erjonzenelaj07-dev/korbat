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

/**
 * The pops of a toggle the reader turns on (section 5.2's like, repost and save rows), released from the pressed scale
 * 0.92 with an initial velocity in scale units per second: Like underdamped to a peak near 1.15, Repost and Save a little
 * firmer, near 1.12. `response` is the undamped period in seconds, as Apple's springs give it. They sit here rather than
 * in theme/motion.ts, whose table is section 5.1's six values.
 */
export const POPS = {
  springLike: { dampingRatio: 0.5, response: 0.22, velocity: 10 },
  springToggle: { dampingRatio: 0.6, response: 0.25, velocity: 8 },
} as const;

export type PopName = keyof typeof POPS;

export interface Motion {
  reduced: boolean;
  /** `velocity` is a released gesture's, in the animated value's units per second (sheets, the lightbox). */
  spring(name: SpringName, velocity?: number): WithSpringConfig;
  timing(name: TimingName, duration?: number): WithTimingConfig;
  pop(name: PopName): WithSpringConfig;
}

/**
 * A pop as a physical spring: Apple's damping ratio and response (the undamped period) turned into Reanimated's stiffness
 * and damping for a mass of 1, with the pop's initial velocity, so Like peaks near 1.15 from 0.92 and settles in about
 * 370 ms. Under reduced motion no component starts one (the toggle cross-fades instead); one started anyway lands at once.
 */
export function popSpring(name: PopName, reduced: boolean): WithSpringConfig {
  const { dampingRatio, response, velocity } = POPS[name];
  const omega = (2 * Math.PI) / response;
  return { mass: 1, stiffness: omega * omega, damping: 2 * dampingRatio * omega, velocity, reduceMotion: reduced ? ReduceMotion.Always : ReduceMotion.Never };
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
      spring: (name, velocity) => ({
        dampingRatio: MOTION[name].dampingRatio,
        duration: MOTION[name].duration,
        ...(velocity === undefined ? {} : { velocity }),
        reduceMotion: reduced ? ReduceMotion.Always : ReduceMotion.Never,
      }),
      timing: (name, duration) => ({ duration: duration ?? TIMINGS[name].duration, easing: bezier(TIMINGS[name].easing), reduceMotion: ReduceMotion.Never }),
      pop: (name) => popSpring(name, reduced),
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
  // `value` is the scale itself, for a control whose release turns into a pop from where the press left it (section 5.2).
  return { style, handlers: { onPressIn, onPressOut }, value };
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

/**
 * The maths of a released drag (section 5.2, after Apple's fluid interfaces). Past its edge an element resists more the
 * further it is pulled (rubber-banding: overshoot x size x 0.55 / (size + 0.55 x overshoot)); a release is judged by
 * where its momentum would carry it, as a scroll decelerates (current + v/1000 x 0.998/0.002), not by where the finger
 * let go, so a flick closes what a slow drag of the same length does not.
 */
export function rubberBand(overshoot: number, size: number, constant = 0.55): number {
  if (size <= 0) return 0;
  return (overshoot * size * constant) / (size + constant * Math.abs(overshoot));
}

export function projectedEnd(position: number, velocity: number, deceleration = 0.998): number {
  return position + (velocity / 1000) * (deceleration / (1 - deceleration));
}

/** A sheet's release closes it when its projected end passes half its height, or it moves down faster than 200 px/s. */
export function releaseCloses(position: number, velocity: number, height: number): boolean {
  return projectedEnd(position, velocity) > height / 2 || velocity > 200;
}

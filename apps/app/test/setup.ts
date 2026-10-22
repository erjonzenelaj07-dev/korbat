import { createElement, Fragment, type ReactNode } from "react";
import { vi } from "vitest";

/**
 * The native modules that never load in Node, mocked once for every test file (UI design, sections 12.1 and 13, Task 2).
 * vitest.config.mts names this file in `test.setupFiles`, so a test file mocks only what is its own (expo-router, the
 * session, expo-image, Turnstile). Each mock gives every name that src imports from its module, which kit.test.tsx
 * checks: a later task that imports a new name from one of these modules adds it here. The file is .ts, so elements
 * are built with createElement.
 */

/** A builder that answers every chained call with itself: `FadeIn.duration(220).easing(...)`, `Gesture.Pan().onEnd(...)`. */
function chainable(): unknown {
  const target = () => proxy;
  const proxy: unknown = new Proxy(target, { get: (_target, key) => (key === "then" ? undefined : () => proxy) });
  return proxy;
}

/** A component that renders its children and nothing of its own. */
const passThrough = ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children);

vi.mock("react-native-reanimated", async () => {
  const { ScrollView, Text, View } = await import("react-native");
  // Animated components draw the plain react-native-web ones, so a test sees the markup a browser gets.
  const animated = <P extends object>(component: (props: P) => ReactNode) => component;
  const Animated = {
    View: (props: object) => createElement(View, props),
    Text: (props: object) => createElement(Text, props),
    ScrollView: (props: object) => createElement(ScrollView, props),
    createAnimatedComponent: animated,
  };
  // An animation lands on its target at once: a static render shows where a motion ends.
  const identity = (t: number) => t;
  return {
    default: Animated,
    createAnimatedComponent: animated,
    // A vi.fn, so motion.test.ts can say the operating system asks for reduced motion.
    useReducedMotion: vi.fn(() => false),
    useSharedValue: <T>(initial: T) => ({ value: initial }),
    useAnimatedStyle: <T>(updater: () => T) => updater(),
    useDerivedValue: <T>(updater: () => T) => ({ value: updater() }),
    withSpring: <T>(to: T) => to,
    withTiming: <T>(to: T) => to,
    withRepeat: <T>(animation: T) => animation,
    withSequence: <T>(...animations: T[]) => animations[animations.length - 1],
    withDelay: <T>(_ms: number, animation: T) => animation,
    cancelAnimation: () => undefined,
    runOnJS:
      <A extends unknown[], R>(fn: (...args: A) => R) =>
      (...args: A) =>
        fn(...args),
    Easing: {
      linear: identity,
      ease: identity,
      bezier: () => identity,
      in: () => identity,
      out: () => identity,
      inOut: () => identity,
    },
    ReduceMotion: { System: "system", Always: "always", Never: "never" },
    FadeIn: chainable(),
    FadeOut: chainable(),
    LinearTransition: chainable(),
  };
});

vi.mock("react-native-gesture-handler", () => ({
  GestureDetector: passThrough,
  GestureHandlerRootView: passThrough,
  Gesture: { Pan: () => chainable(), Tap: () => chainable() },
}));

vi.mock("react-native-safe-area-context", () => {
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    SafeAreaProvider: passThrough,
    SafeAreaView: passThrough,
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 1280, height: 900 }),
    initialWindowMetrics: null,
  };
});

vi.mock("expo-haptics", () => ({
  // The enums carry expo-haptics 57.0.3's own values, so a test compares what the app would send.
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy", Soft: "soft", Rigid: "rigid" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
  AndroidHaptics: {
    Confirm: "confirm",
    Reject: "reject",
    Gesture_Start: "gesture-start",
    Gesture_End: "gesture-end",
    Toggle_On: "toggle-on",
    Toggle_Off: "toggle-off",
    Long_Press: "long-press",
    Segment_Tick: "segment-tick",
  },
  impactAsync: vi.fn(async () => undefined),
  notificationAsync: vi.fn(async () => undefined),
  selectionAsync: vi.fn(async () => undefined),
  performAndroidHapticsAsync: vi.fn(async () => undefined),
}));

// A document title is the browser's, which a static render has no use for.
vi.mock("expo-router/head", () => ({ default: () => null }));

vi.mock("lucide-react-native", async () => {
  // vitest finds kit/Icon.web.tsx before kit/Icon.tsx, so the native set is never drawn here; kit/Icon.tsx takes each
  // icon from its own module (lucide-react-native/icons/<name>). The package's main entry, which src imports only a
  // type from, is a stub of every icon icons.ts names, for a test that reaches for it.
  const { ICONS } = await import("../src/components/icons");
  const stub = () => null;
  return Object.fromEntries(Object.values(ICONS).map((name) => [name, stub]));
});

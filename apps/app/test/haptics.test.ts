import * as Haptics from "expo-haptics";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_APPEARANCE, setAppearance } from "../src/lib/appearance";
import { HAPTIC_INTENTS, hapticFor, playHaptic, useHaptics, type HapticIntent } from "../src/lib/haptics";

/**
 * Haptics by intent (UI design, section 5.3). The mapping is a pure function of the intent and the platform, so the
 * table's iOS and Android columns are checked here although react-native-web says "web"; expo-haptics is mocked in
 * test/setup.ts with its 57.0.3 enum values.
 */
const calls = () => ({
  impact: vi.mocked(Haptics.impactAsync).mock.calls,
  notification: vi.mocked(Haptics.notificationAsync).mock.calls,
  selection: vi.mocked(Haptics.selectionAsync).mock.calls,
  android: vi.mocked(Haptics.performAndroidHapticsAsync).mock.calls,
});
const none = { impact: [], notification: [], selection: [], android: [] };

beforeEach(() => {
  vi.clearAllMocks();
  setAppearance(DEFAULT_APPEARANCE);
});
afterEach(() => setAppearance(DEFAULT_APPEARANCE));

describe("the mapping", () => {
  test("names section 5.3's seven intents", () => {
    expect([...HAPTIC_INTENTS]).toEqual(["toggleOn", "toggleOff", "selection", "threshold", "success", "warning", "error"]);
  });

  test("iOS: impacts, the selection tick and notifications; turning off is silent", () => {
    expect(hapticFor("toggleOn", "ios")).toEqual({ kind: "impact", style: Haptics.ImpactFeedbackStyle.Light });
    expect(hapticFor("toggleOff", "ios")).toBeNull();
    expect(hapticFor("selection", "ios")).toEqual({ kind: "selection" });
    expect(hapticFor("threshold", "ios")).toEqual({ kind: "impact", style: Haptics.ImpactFeedbackStyle.Medium });
    expect(hapticFor("success", "ios")).toEqual({ kind: "notification", type: Haptics.NotificationFeedbackType.Success });
    expect(hapticFor("warning", "ios")).toEqual({ kind: "notification", type: Haptics.NotificationFeedbackType.Warning });
    expect(hapticFor("error", "ios")).toEqual({ kind: "notification", type: Haptics.NotificationFeedbackType.Error });
  });

  test("Android: the system's own constants through performAndroidHapticsAsync", () => {
    const android = (intent: HapticIntent) => hapticFor(intent, "android");
    expect(android("toggleOn")).toEqual({ kind: "android", type: Haptics.AndroidHaptics.Toggle_On });
    expect(android("toggleOff")).toEqual({ kind: "android", type: Haptics.AndroidHaptics.Toggle_Off });
    expect(android("selection")).toEqual({ kind: "android", type: Haptics.AndroidHaptics.Segment_Tick });
    // expo-haptics 57.0.3 has no Gesture_Threshold_Activate; Long_Press is the firm tick Android plays when a press arms.
    expect(android("threshold")).toEqual({ kind: "android", type: Haptics.AndroidHaptics.Long_Press });
    expect(android("success")).toEqual({ kind: "android", type: Haptics.AndroidHaptics.Confirm });
    expect(android("warning")).toEqual({ kind: "android", type: Haptics.AndroidHaptics.Reject });
    expect(android("error")).toEqual({ kind: "android", type: Haptics.AndroidHaptics.Reject });
  });

  test("the web has none, nor does any other platform", () => {
    for (const intent of HAPTIC_INTENTS) {
      expect(hapticFor(intent, "web"), intent).toBeNull();
      expect(hapticFor(intent, "windows"), intent).toBeNull();
    }
  });
});

describe("playing", () => {
  test("plays the mapped call when haptics are on", () => {
    playHaptic("toggleOn", "ios", true);
    playHaptic("success", "ios", true);
    playHaptic("selection", "ios", true);
    playHaptic("error", "android", true);
    expect(calls()).toEqual({
      impact: [[Haptics.ImpactFeedbackStyle.Light]],
      notification: [[Haptics.NotificationFeedbackType.Success]],
      selection: [[]],
      android: [[Haptics.AndroidHaptics.Reject]],
    });
  });

  test("the off switch silences every intent on every platform", () => {
    for (const intent of HAPTIC_INTENTS) for (const platform of ["ios", "android"] as const) playHaptic(intent, platform, false);
    expect(calls()).toEqual(none);
  });

  test("on the web every intent is a no-op", () => {
    for (const intent of HAPTIC_INTENTS) playHaptic(intent, "web", true);
    expect(calls()).toEqual(none);
  });

  test("a refused call is swallowed, since a device without haptics is not an error", async () => {
    vi.mocked(Haptics.impactAsync).mockRejectedValueOnce(new Error("unavailable"));
    expect(() => playHaptic("toggleOn", "ios", true)).not.toThrow();
    await Promise.resolve();
  });
});

describe("useHaptics()", () => {
  /** The function useHaptics() gives a component, taken out of a static render. */
  function hook(): (intent: HapticIntent) => void {
    let haptic: ((intent: HapticIntent) => void) | undefined;
    const Probe = () => {
      haptic = useHaptics();
      return null;
    };
    renderToStaticMarkup(createElement(Probe));
    if (!haptic) throw new Error("useHaptics() gave nothing");
    return haptic;
  }

  test("is a no-op here, where react-native-web says web, with haptics on or off", () => {
    hook()("toggleOn");
    setAppearance({ haptics: false });
    hook()("success");
    expect(calls()).toEqual(none);
  });
});

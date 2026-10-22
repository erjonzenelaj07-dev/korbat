import { useCallback } from "react";
import { Platform } from "react-native";
import {
  AndroidHaptics,
  ImpactFeedbackStyle,
  NotificationFeedbackType,
  impactAsync,
  notificationAsync,
  performAndroidHapticsAsync,
  selectionAsync,
} from "expo-haptics";
import { useAppearance } from "./appearance";

/**
 * Haptics by intent (UI design, section 5.3, after Bluesky's intent API) over expo-haptics 57.0.3. A component names
 * what happened, never a vibration: useHaptics() gives it one function that takes the intent, and the caller fires it
 * in the same handler as the visual change, before the state update, so sight and touch land on the same frame.
 * Ordinary taps, scrolling and navigation have none. The web has none (its Vibration API is coarse and Safari lacks
 * it). The reader's switch, Settings, Appearance and accessibility, "Haptics", turns them all off; reduced motion does not.
 */
export const HAPTIC_INTENTS = ["toggleOn", "toggleOff", "selection", "threshold", "success", "warning", "error"] as const;

export type HapticIntent = (typeof HAPTIC_INTENTS)[number];

/** One call to expo-haptics, as data, so the mapping can be checked without a device. */
export type HapticCall =
  | { kind: "impact"; style: ImpactFeedbackStyle }
  | { kind: "selection" }
  | { kind: "notification"; type: NotificationFeedbackType }
  | { kind: "android"; type: AndroidHaptics };

/** iOS: Light for a toggle turned on, nothing for one turned off, Medium once per crossing of a close threshold. */
const IOS: Record<HapticIntent, HapticCall | null> = {
  toggleOn: { kind: "impact", style: ImpactFeedbackStyle.Light },
  toggleOff: null,
  selection: { kind: "selection" },
  threshold: { kind: "impact", style: ImpactFeedbackStyle.Medium },
  success: { kind: "notification", type: NotificationFeedbackType.Success },
  warning: { kind: "notification", type: NotificationFeedbackType.Warning },
  error: { kind: "notification", type: NotificationFeedbackType.Error },
};

/**
 * Android: the system's own constants, which tsc checks against expo-haptics 57.0.3's AndroidHaptics. That version has
 * no Gesture_Threshold_Activate, which the design names for a threshold; Long_Press is the firm tick Android plays when
 * a press arms an action, the nearest in kind. Devices check these in sub-project 5.
 */
const ANDROID: Record<HapticIntent, HapticCall> = {
  toggleOn: { kind: "android", type: AndroidHaptics.Toggle_On },
  toggleOff: { kind: "android", type: AndroidHaptics.Toggle_Off },
  selection: { kind: "android", type: AndroidHaptics.Segment_Tick },
  threshold: { kind: "android", type: AndroidHaptics.Long_Press },
  success: { kind: "android", type: AndroidHaptics.Confirm },
  warning: { kind: "android", type: AndroidHaptics.Reject },
  error: { kind: "android", type: AndroidHaptics.Reject },
};

/** What an intent plays on a platform, or null where it plays nothing: on the web, and anywhere but iOS and Android. */
export function hapticFor(intent: HapticIntent, platform: string): HapticCall | null {
  if (platform === "ios") return IOS[intent];
  if (platform === "android") return ANDROID[intent];
  return null;
}

/** expo-haptics answers with a promise; a device or simulator without a haptic engine refuses it, which is not an error. */
function run(call: HapticCall): Promise<void> {
  switch (call.kind) {
    case "impact":
      return impactAsync(call.style);
    case "selection":
      return selectionAsync();
    case "notification":
      return notificationAsync(call.type);
    case "android":
      return performAndroidHapticsAsync(call.type);
  }
}

/** Plays an intent on a platform when the reader's switch is on. */
export function playHaptic(intent: HapticIntent, platform: string, enabled: boolean): void {
  if (!enabled) return;
  const call = hapticFor(intent, platform);
  if (call === null) return;
  try {
    void run(call).catch(() => undefined);
  } catch {
    // A module missing on this device throws before it answers; the visual change already said what happened.
  }
}

/** The function a component fires intents with, following the reader's Haptics switch as it changes. */
export function useHaptics(): (intent: HapticIntent) => void {
  const { haptics } = useAppearance();
  return useCallback((intent: HapticIntent) => playHaptic(intent, Platform.OS, haptics), [haptics]);
}

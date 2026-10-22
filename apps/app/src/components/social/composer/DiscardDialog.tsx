import { useEffect, useId, useRef, type Ref } from "react";
import { Platform, Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import { pressDelay } from "@/components/kit/interaction";
import { Text } from "@/components/kit/Text";
import { LABEL_TONE, buttonFace, type ButtonFace } from "@/components/ui";
import { useHaptics } from "@/lib/haptics";
import { usePressScale } from "@/lib/motion";
import { UI_WORDS } from "@/lib/ui-words";

function Answer({ label, face, onPress, ref }: { label: string; face: ButtonFace; onPress: () => void; ref?: Ref<View> }) {
  const press = usePressScale(0.97);
  return (
    <Animated.View style={press.style}>
      <Pressable ref={ref} accessibilityRole="button" onPress={onPress} {...press.handlers} {...pressDelay(0)} className={buttonFace({ face, size: "md" })}>
        <Text variant="body-strong" tone={LABEL_TONE[face]} className="text-center">
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * The discard question (UI design, sections 6.15 and 8.6): "Discard this draft?" with "Discard" (the danger fill) and
 * "Keep writing", asked in place of the send bar when a composer with content is closed (Cancel, Escape, the scrim, a
 * drag), never when it is empty. It is an alertdialog named by its question; the safe answer, Keep writing, takes the
 * focus as it appears, and the warning haptic fires with it. Keep writing goes back to the field, Discard closes.
 */
export function DiscardDialog({ onDiscard, onKeep }: { onDiscard: () => void; onKeep: () => void }) {
  const haptic = useHaptics();
  const questionId = useId();
  const keep = useRef<View>(null);
  useEffect(() => {
    haptic("warning");
    if (Platform.OS === "web") keep.current?.focus();
    // Once, as the question appears.
  }, []);
  return (
    <View role="alertdialog" aria-labelledby={questionId} className="mt-3 gap-2 rounded-card border border-line-high bg-surface-1 p-3 web:forced-colors:border-[color:CanvasText]">
      <Text variant="body-strong" nativeID={questionId}>
        {UI_WORDS["composer.discard.question"]}
      </Text>
      <View className="flex-row flex-wrap justify-end gap-2">
        <Answer label={UI_WORDS["composer.discard.confirm"]} face="danger" onPress={onDiscard} />
        <Answer ref={keep} label={UI_WORDS["composer.discard.keep"]} face="secondary" onPress={onKeep} />
      </View>
    </View>
  );
}

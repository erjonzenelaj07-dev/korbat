import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import { IconButton } from "@/components/kit/IconButton";
import { pressDelay } from "@/components/kit/interaction";
import { Text } from "@/components/kit/Text";
import { LABEL_TONE, buttonFace, type ButtonFace } from "@/components/ui";
import { usePressScale } from "@/lib/motion";
import { UI_WORDS } from "@/lib/ui-words";
import { ProgressRing } from "./ProgressRing";

export interface SendBarProps {
  /** Opens the image picker; left out where images cannot be chosen yet (native) or the post has four. */
  onAddImage?: () => void;
  /** The text's length by the server's rule, which the ring shows. */
  length: number;
  /** Cancel, in a sheet only: the card closes by losing the focus. */
  onCancel?: () => void;
  /** The Post button's words (composer/state.ts): Post, Reply or Quote, what is missing, or Posting... */
  label: string;
  ready: boolean;
  busy: boolean;
  onPost: () => void;
}

/** A button of the bar: Button's own faces (ui.tsx), inline in the row and scaled to 0.97 from pointer-down. */
function BarButton({ label, face, busy = false, disabled = false, onPress }: { label: string; face: ButtonFace; busy?: boolean; disabled?: boolean; onPress: () => void }) {
  const press = usePressScale(0.97);
  return (
    <Animated.View style={press.style}>
      <Pressable accessibilityRole="button" aria-busy={busy} disabled={disabled} onPress={onPress} {...press.handlers} {...pressDelay(0)} className={buttonFace({ face, size: "md" })}>
        <Text variant="body-strong" tone={LABEL_TONE[face]} className="shrink text-center">
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * The composer's send bar (UI design, section 6.15): Add image (an icon button), then at the end the count's ring,
 * Cancel when the composer is a sheet, and the Post button, which says what is missing while images hold the post back
 * ("Remove the failed image", "Describe every image", "Waiting for images...") and "Posting..." while it sends, busy for
 * assistive technology. Under Add image, one line in ink-low says that korbat removes location and camera details from
 * images (2b's EXIF strip). The row wraps rather than cutting a long label at the largest text on a phone.
 */
export function SendBar({ onAddImage, length, onCancel, label, ready, busy, onPost }: SendBarProps) {
  return (
    <View className="mt-3 gap-1">
      <View className="flex-row flex-wrap items-center gap-2">
        {onAddImage ? <IconButton icon="add-image" label={UI_WORDS["composer.addImage"]} tone="accent" onPress={onAddImage} /> : null}
        <View className="min-w-0 flex-1 flex-row flex-wrap items-center justify-end gap-2">
          <ProgressRing length={length} />
          {onCancel ? <BarButton label={UI_WORDS["composer.cancel"]} face="secondary" onPress={onCancel} /> : null}
          <BarButton label={label} face={ready ? "primary" : "inactive"} busy={busy} disabled={!ready} onPress={onPost} />
        </View>
      </View>
      {onAddImage ? (
        <Text variant="meta" tone="low">
          {UI_WORDS["composer.exif"]}
        </Text>
      ) : null}
    </View>
  );
}

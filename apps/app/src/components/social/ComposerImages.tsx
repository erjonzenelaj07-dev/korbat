import { Image } from "expo-image";
import { Link } from "expo-router";
import { Pressable, TextInput, View } from "react-native";
import { ALT_MAX_LENGTH, altLength, normalizeAltText } from "@korbat/contracts";
import { Icon } from "@/components/kit/Icon";
import { FOCUS_RING } from "@/components/kit/interaction";
import { Text, textStyle, type Tone } from "@/components/kit/Text";
import { useAppearance } from "@/lib/appearance";
import { UPLOAD_TEXTS } from "@/lib/moderation-words";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { useTheme } from "@/theme/ThemeProvider";
import type { IconName } from "../icons";
import type { ComposerImage } from "./useImageUploads";

/** Where each upload stands, in words, with an icon and a tone, so the status is never colour alone (section 4.8). */
const STATUS: Record<ComposerImage["status"], { words: string; icon: IconName | null; tone: Tone }> = {
  uploading: { words: UI_WORDS["composer.image.uploading"], icon: null, tone: "low" },
  processing: { words: UI_WORDS["composer.image.processing"], icon: null, tone: "low" },
  // A done upload shows the done icon in ink (green is In Explore's alone, section 4.8).
  ready: { words: UI_WORDS["composer.image.ready"], icon: "done", tone: "medium" },
  failed: { words: UI_WORDS["composer.image.failed"], icon: "error", tone: "danger" },
  refused: { words: UPLOAD_TEXTS.refused, icon: "error", tone: "danger" },
};

/** The preview's side (6.15): 88 px, in the media radius. */
const PREVIEW = 88;

/**
 * The image tray (UI design, section 6.15): the images of a post being written, each with an 88 px preview from the
 * chosen file, where its upload stands, and the description every image needs, with its counter and Remove. The counter
 * uses the server's rule, so what it allows is what the API accepts.
 */
export function ComposerImages({ images, onAlt, onRemove }: { images: ComposerImage[]; onAlt: (key: string, alt: string) => void; onRemove: (key: string) => void }) {
  const { colors } = useTheme();
  const appearance = useAppearance();
  if (images.length === 0) return null;
  return (
    <View className="mt-3 gap-3">
      {images.map((image, index) => {
        const length = altLength(normalizeAltText(image.alt));
        const name = fill(UI_WORDS["composer.image.name"], { n: index + 1 });
        const status = STATUS[image.status];
        return (
          <View key={image.key} className="flex-row gap-3 rounded-card border border-line-low p-2">
            {/* 3d Task 7 (9.5): a refused upload is shown to nobody, its uploader included: no preview stands for it. */}
            {image.status === "refused" ? (
              <View accessibilityLabel={fill(UI_WORDS["composer.image.refused"], { name })} style={{ width: PREVIEW, height: PREVIEW }} className="items-center justify-center rounded-media bg-surface-2">
                <Icon name="hidden" size={20} tone="medium" />
              </View>
            ) : (
              <View className="overflow-hidden rounded-media border border-line-low" style={{ width: PREVIEW, height: PREVIEW }}>
                <Image source={{ uri: image.previewUrl }} contentFit="cover" accessibilityLabel={fill(UI_WORDS["composer.image.preview"], { name })} style={{ width: "100%", height: "100%" }} />
              </View>
            )}
            <View className="min-w-0 flex-1 gap-1">
              <View accessibilityLiveRegion="polite" className="min-h-[20px] flex-row items-center gap-1.5">
                {status.icon ? <Icon name={status.icon} size={16} tone={status.tone} /> : null}
                <Text variant="meta" tone={status.tone} className="shrink">
                  {image.status === "failed" && image.error ? image.error : status.words}
                </Text>
              </View>
              {image.status === "refused" && image.refusalId ? (
                <Link href={`/settings/cases/uploads/${image.refusalId}`} asChild>
                  <Pressable className={cn("min-h-[44px] justify-center self-start rounded-control", FOCUS_RING)}>
                    <Text variant="meta" tone="accent" className="underline web:underline-offset-2">
                      {UPLOAD_TEXTS.why}
                    </Text>
                  </Pressable>
                </Link>
              ) : null}
              <TextInput
                accessibilityLabel={fill(UI_WORDS["composer.image.description"], { name })}
                placeholder={UI_WORDS["composer.image.placeholder"]}
                placeholderTextColor={colors["ink-low"]}
                multiline
                value={image.alt}
                onChangeText={(alt) => onAlt(image.key, alt)}
                className={cn("min-h-[44px] rounded-control border border-line-high bg-surface-1 px-3 py-2 text-ink-high", FOCUS_RING)}
                style={textStyle("body", { step: appearance.textStep, font: appearance.font })}
              />
              <View className="flex-row items-center justify-between">
                <Text variant="meta" tone={length > ALT_MAX_LENGTH ? "danger" : "low"}>
                  {length}/{ALT_MAX_LENGTH}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={fill(UI_WORDS["composer.image.remove"], { name })}
                  onPress={() => onRemove(image.key)}
                  className={cn("min-h-[44px] min-w-[44px] items-center justify-center rounded-control px-2 active:bg-surface-2 web:hover:bg-surface-2", FOCUS_RING)}
                >
                  <Text variant="meta" tone="medium" className="underline web:underline-offset-2">
                    {UI_WORDS["composer.image.removeWord"]}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

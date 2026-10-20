import { Image } from "expo-image";
import { Link } from "expo-router";
import { Pressable, Text, TextInput, View } from "react-native";
import { ALT_MAX_LENGTH, altLength, normalizeAltText } from "@korbat/contracts";
import { UPLOAD_TEXTS } from "@/lib/moderation-words";
import type { ComposerImage } from "./useImageUploads";

const STATUS: Record<ComposerImage["status"], string> = {
  uploading: "Uploading…",
  processing: "Processing…",
  ready: "Ready",
  failed: "Failed",
  refused: UPLOAD_TEXTS.refused,
};

/**
 * The images of a post being written: a preview from the chosen file, where the upload stands, and
 * the description every image needs. The counter uses the server's rule, so what it allows is what
 * the API accepts.
 */
export function ComposerImages({ images, onAlt, onRemove }: { images: ComposerImage[]; onAlt: (key: string, alt: string) => void; onRemove: (key: string) => void }) {
  if (images.length === 0) return null;
  return (
    <View className="mt-3 gap-3">
      {images.map((image, index) => {
        const length = altLength(normalizeAltText(image.alt));
        const label = `image ${index + 1}`;
        return (
          <View key={image.key} className="flex-row gap-3 rounded-lg border border-zinc-800 p-2">
            {/* 3d Task 7 (9.5): a refused upload is shown to nobody, its uploader included: no preview stands for it. */}
            {image.status === "refused" ? (
              <View accessibilityLabel={`${label}, not accepted`} style={{ width: 72, height: 72, borderRadius: 6 }} className="bg-zinc-800" />
            ) : (
              <Image source={{ uri: image.previewUrl }} contentFit="cover" accessibilityLabel={`Preview of ${label}`} style={{ width: 72, height: 72, borderRadius: 6 }} />
            )}
            <View className="flex-1">
              <Text accessibilityLiveRegion="polite" className={`text-xs ${image.status === "failed" || image.status === "refused" ? "text-red-400" : image.status === "ready" ? "text-emerald-400" : "text-zinc-400"}`}>
                {image.status === "failed" && image.error ? image.error : STATUS[image.status]}
              </Text>
              {image.status === "refused" && image.refusalId ? (
                <Link href={`/settings/cases/uploads/${image.refusalId}`} asChild>
                  <Pressable className="self-start">
                    <Text className="text-xs text-sky-400 underline">{UPLOAD_TEXTS.why}</Text>
                  </Pressable>
                </Link>
              ) : null}
              <TextInput
                accessibilityLabel={`Description of ${label}`}
                placeholder="Describe this image for people who cannot see it"
                placeholderTextColor="#71717a"
                multiline
                value={image.alt}
                onChangeText={(alt) => onAlt(image.key, alt)}
                className="mt-1 min-h-[44px] rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm leading-5 text-zinc-50"
              />
              <View className="mt-1 flex-row items-center justify-between">
                <Text className={`text-xs ${length > ALT_MAX_LENGTH ? "text-red-400" : "text-zinc-400"}`}>
                  {length}/{ALT_MAX_LENGTH}
                </Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${label}`} onPress={() => onRemove(image.key)}>
                  <Text className="text-xs text-zinc-400 underline">Remove</Text>
                </Pressable>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

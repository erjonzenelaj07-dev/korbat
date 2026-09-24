import { useEffect } from "react";
import { Image } from "expo-image";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import type { MediaView } from "@korbat/contracts";
import { API_BASE } from "@/lib/api";

interface MediaViewerProps {
  media: MediaView[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}

/**
 * One image on the whole screen, in its large size and fitted inside it, with its description
 * underneath. Arrow keys move between the images of the post; react-native-web's Modal closes it on
 * Escape and returns focus to the image that opened it. It appears at once: nothing about it needs
 * motion, and the image fades in from its blurhash only when reduced motion is not asked for.
 */
export function MediaViewer({ media, index, onIndex, onClose }: MediaViewerProps) {
  const still = useReducedMotion();
  const item = media[index]!;
  const many = media.length > 1;
  const step = (by: number) => onIndex((index + by + media.length) % media.length);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" && many) onIndex((index + 1) % media.length);
      if (event.key === "ArrowLeft" && many) onIndex((index - 1 + media.length) % media.length);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, many, media.length, onIndex]);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View className="flex-1 bg-black/95">
        <View className="flex-row items-center justify-between px-4 py-3">
          <Text className="text-sm text-zinc-300">{many ? `${index + 1} of ${media.length}` : ""}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close the image viewer" onPress={onClose} className="rounded-lg border border-zinc-700 px-3 py-1.5">
            <Text className="text-sm text-zinc-200">Close</Text>
          </Pressable>
        </View>
        <View className="flex-1 px-2">
          <Image
            source={{ uri: `${API_BASE}${item.large}` }}
            placeholder={{ blurhash: item.blurhash }}
            contentFit="contain"
            transition={still ? 0 : 150}
            accessibilityLabel={item.alt}
            style={{ flex: 1 }}
          />
        </View>
        <Text className="px-4 py-3 text-center text-sm leading-5 text-zinc-200">{item.alt}</Text>
        {many ? (
          <View className="flex-row justify-center gap-3 pb-4">
            <Pressable accessibilityRole="button" accessibilityLabel="Previous image" onPress={() => step(-1)} className="rounded-lg border border-zinc-700 px-4 py-2">
              <Text className="text-sm text-zinc-200">Previous</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Next image" onPress={() => step(1)} className="rounded-lg border border-zinc-700 px-4 py-2">
              <Text className="text-sm text-zinc-200">Next</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

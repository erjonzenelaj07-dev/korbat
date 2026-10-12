import { useEffect } from "react";
import { Image } from "expo-image";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import { useReducedMotion } from "react-native-reanimated";
import { isHiddenMedia, type HiddenMedia, type MediaView } from "@korbat/contracts";
import { API_BASE } from "@/lib/api";
import { reportHref } from "@/lib/moderation";
import { CHIP_WORDS, REPORT_WORDS } from "@/lib/moderation-words";
import { HiddenImage } from "./HiddenImage";

interface MediaViewerProps {
  media: (MediaView | HiddenMedia)[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** The post that holds the images: an image is reported on it. Absent for the reader's own post, which they do not report. */
  postId?: string;
}

/**
 * What the viewer shows: one image in its large size, fitted inside the screen, with its description
 * underneath, its place among the post's images and the controls. The viewer is opened from an image's
 * own cell only; stepping through the post's images can still come to one moderation hid from this
 * reader, which is never loaded: its placeholder stands in the image's place. An image that is shown can
 * be reported from here, on the post that holds it; the author's own withheld or removed image says so.
 */
export function MediaViewerContent({ media, index, onIndex, onClose, postId }: MediaViewerProps) {
  const still = useReducedMotion();
  const item = media[index]!;
  const many = media.length > 1;
  const step = (by: number) => onIndex((index + by + media.length) % media.length);

  return (
    <View className="flex-1 bg-black/95">
      <View className="flex-row items-center justify-between px-4 py-3">
        <Text className="text-sm text-zinc-300">{many ? `${index + 1} of ${media.length}` : ""}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close the image viewer" onPress={onClose} className="rounded-lg border border-zinc-700 px-3 py-1.5">
          <Text className="text-sm text-zinc-200">Close</Text>
        </Pressable>
      </View>
      <View className="flex-1 px-2">
        {isHiddenMedia(item) ? (
          <HiddenImage item={item} />
        ) : (
          <Image source={{ uri: `${API_BASE}${item.large}` }} placeholder={{ blurhash: item.blurhash }} contentFit="contain" transition={still ? 0 : 150} accessibilityLabel={item.alt} style={{ flex: 1 }} />
        )}
      </View>
      {isHiddenMedia(item) ? null : <Text className="px-4 py-3 text-center text-sm leading-5 text-zinc-200">{item.alt}</Text>}
      {!isHiddenMedia(item) && item.moderation ? (
        <Text className={`pb-3 text-center text-sm font-medium ${item.moderation === "withheld" ? "text-amber-300" : "text-red-300"}`}>
          {item.moderation === "withheld" ? CHIP_WORDS.underReview : CHIP_WORDS.removed}
        </Text>
      ) : null}
      {!isHiddenMedia(item) && postId ? (
        // A real anchor, as every link of the app; the viewer closes as the form opens.
        <Link href={reportHref({ post: postId, media: item.id })} onPress={onClose} asChild>
          <Pressable className="self-center pb-3">
            <Text className="text-sm text-zinc-400 underline">{REPORT_WORDS.imageControl}</Text>
          </Pressable>
        </Link>
      ) : null}
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
  );
}

/**
 * One image on the whole screen. Arrow keys move between the images of the post; react-native-web's
 * Modal closes it on Escape and returns focus to the image that opened it. It appears at once: nothing
 * about it needs motion, and the image fades in from its blurhash only when reduced motion is not asked for.
 */
export function MediaViewer({ media, index, onIndex, onClose, postId }: MediaViewerProps) {
  const many = media.length > 1;

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
      <MediaViewerContent media={media} index={index} onIndex={onIndex} onClose={onClose} postId={postId} />
    </Modal>
  );
}

import { useState } from "react";
import { Image } from "expo-image";
import { Pressable, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import type { MediaView } from "@korbat/contracts";
import { API_BASE } from "@/lib/api";
import { MediaViewer } from "./MediaViewer";

/** A single image keeps its own shape, within limits, so a very tall or very wide one cannot take over the timeline. */
const MIN_RATIO = 3 / 4;
const MAX_RATIO = 2;
const FRAME_RATIO = 16 / 9;
const GAP = 2;
const THUMBNAIL = 64;

export const clampRatio = (width: number, height: number): number => Math.min(MAX_RATIO, Math.max(MIN_RATIO, width / height));

/**
 * The small size of an image with its blurhash; expo-image loads it lazily on the web. The blurhash
 * fades into the image unless the system asks for reduced motion, which swaps it at once.
 */
function Picture({ item, style }: { item: MediaView; style: { width: number | "100%"; height: number | "100%"; borderRadius?: number } }) {
  const still = useReducedMotion();
  return (
    // On the web expo-image takes the <img alt> from accessibilityLabel, not from alt.
    <Image source={{ uri: `${API_BASE}${item.small}` }} placeholder={{ blurhash: item.blurhash }} contentFit="cover" transition={still ? 0 : 150} accessibilityLabel={item.alt} style={style} />
  );
}

function Cell({ item, onPress }: { item: MediaView; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open image: ${item.alt}`} onPress={onPress} style={{ flex: 1 }}>
      <Picture item={item} style={{ width: "100%", height: "100%" }} />
    </Pressable>
  );
}

/**
 * The images of a post. One image is shown in its own ratio; two to four share a 16:9 frame and are
 * cropped to their cell. Pressing one opens the viewer; ALT shows the descriptions in place.
 */
function Grid({ media }: { media: MediaView[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [described, setDescribed] = useState(false);
  const cell = (index: number) => <Cell key={media[index]!.id} item={media[index]!} onPress={() => setOpen(index)} />;

  let frame;
  if (media.length === 1) {
    frame = <View style={{ aspectRatio: clampRatio(media[0]!.width, media[0]!.height) }}>{cell(0)}</View>;
  } else if (media.length === 2) {
    frame = <View style={{ aspectRatio: FRAME_RATIO, flexDirection: "row", gap: GAP }}>{[cell(0), cell(1)]}</View>;
  } else if (media.length === 3) {
    frame = (
      <View style={{ aspectRatio: FRAME_RATIO, flexDirection: "row", gap: GAP }}>
        {cell(0)}
        <View style={{ flex: 1, gap: GAP }}>{[cell(1), cell(2)]}</View>
      </View>
    );
  } else {
    frame = (
      <View style={{ aspectRatio: FRAME_RATIO, gap: GAP }}>
        <View style={{ flex: 1, flexDirection: "row", gap: GAP }}>{[cell(0), cell(1)]}</View>
        <View style={{ flex: 1, flexDirection: "row", gap: GAP }}>{[cell(2), cell(3)]}</View>
      </View>
    );
  }

  return (
    <View className="mt-2">
      <View className="overflow-hidden rounded-xl border border-zinc-800">{frame}</View>
      <Pressable accessibilityRole="button" aria-expanded={described} accessibilityLabel={described ? "Hide image descriptions" : "Show image descriptions"} onPress={() => setDescribed(!described)} className="mt-1 self-start rounded border border-zinc-700 px-1.5 py-0.5">
        <Text className="text-xs font-semibold text-zinc-300">ALT</Text>
      </Pressable>
      {described
        ? media.map((item, index) => (
            <Text key={item.id} className="mt-1 text-sm leading-5 text-zinc-300">
              {media.length > 1 ? `${index + 1}. ` : ""}
              {item.alt}
            </Text>
          ))
        : null}
      {open === null ? null : <MediaViewer media={media} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </View>
  );
}

/**
 * A post's images (`Grid`), or a quoted post's as one row of small squares (`compact`). The squares
 * are pictures, not buttons: the whole quote is a link to the quoted post, where the grid and the
 * viewer are, and a control inside another control is one that assistive technology cannot reach.
 */
export function MediaGrid({ media, compact = false }: { media: MediaView[]; compact?: boolean }) {
  if (media.length === 0) return null;
  if (!compact) return <Grid media={media} />;
  return (
    <View className="mt-2 flex-row" style={{ gap: GAP }}>
      {media.map((item) => (
        <Picture key={item.id} item={item} style={{ width: THUMBNAIL, height: THUMBNAIL, borderRadius: 6 }} />
      ))}
    </View>
  );
}

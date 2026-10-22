import { createContext, useContext, useRef, useState } from "react";
import { Image } from "expo-image";
import { Pressable, View } from "react-native";
import { isHiddenMedia, type HiddenMedia, type MediaView } from "@korbat/contracts";
import { FOCUS_RING_INSET } from "@/components/kit/interaction";
import { StatusChip } from "@/components/kit/StatusChip";
import { Text } from "@/components/kit/Text";
import { API_BASE } from "@/lib/api";
import { useMotion } from "@/lib/motion";
import { CHIP_WORDS } from "@/lib/moderation-words";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { HiddenImage, HiddenRowWords, HiddenThumbnail, hiddenImageWords } from "./HiddenImage";
import { ImageFaultView, useImageFault } from "./ImageFault";
import { MediaViewer, Thumbnails } from "./MediaViewer";

/** A single image keeps its own shape, within limits, so a very tall or very wide one cannot take over the timeline. */
const MIN_RATIO = 3 / 4;
const MAX_RATIO = 2;
const FRAME_RATIO = 16 / 9;
const GAP = 2;
const THUMBNAIL = 64;

export const clampRatio = (width: number, height: number): number => Math.min(MAX_RATIO, Math.max(MIN_RATIO, width / height));

/**
 * Whether the images below load first (section 11.2): a list sets it for its first two rows, through PostCard, so the
 * images a reader sees on opening are asked before those further down.
 */
export const ImagePriority = createContext(false);

/**
 * The small size of an image with its blurhash (UI design, section 11.2). expo-image loads it lazily on the web and keeps
 * its view for the next image of a recycled row by the media id; the blurhash cross-fades into the image in 150 ms
 * unless motion is reduced, by the system or the reader, which swaps it at once.
 */
function Picture({ item, style, onError }: { item: MediaView; style: { width: number | "100%"; height: number | "100%" }; onError?: () => void }) {
  const { reduced } = useMotion();
  const first = useContext(ImagePriority);
  return (
    // On the web expo-image takes the <img alt> from accessibilityLabel, not from alt.
    <Image source={{ uri: `${API_BASE}${item.small}` }} placeholder={{ blurhash: item.blurhash }} recyclingKey={item.id} contentFit="cover" transition={reduced ? 0 : 150} priority={first ? "high" : "normal"} accessibilityLabel={item.alt} style={style} onError={onError} />
  );
}

/**
 * The label on the author's own image that moderation withheld or removed (3c design, section 9): the author keeps seeing
 * such an image, and reads on the image itself that others do not. The API marks an image so only for its author. It is
 * the information-only StatusChip in the image's corner (UI design, section 6.7), and takes no press: the image under it
 * still opens.
 */
export function OwnImageLabel({ state }: { state: NonNullable<MediaView["moderation"]> }) {
  const withheld = state === "withheld";
  return (
    <View pointerEvents="none" className="absolute left-2 top-2 right-2">
      <StatusChip tone={withheld ? "review" : "restricted"} label={withheld ? CHIP_WORDS.underReview : CHIP_WORDS.removed} />
    </View>
  );
}

/**
 * One image of the frame: the control that opens it and, beside that control, the label of the author's own restricted
 * image, as text of its own. 3d: when an image of the reader's own post fails to load, its status is asked once, and an
 * image being restored or lost shows why in its place, with nothing to open. `cell` keeps the control's element, which
 * the lightbox grows from and returns into.
 */
function Cell({ item, onPress, own, cell }: { item: MediaView; onPress: () => void; own: boolean; cell: (node: View | null) => void }) {
  const { fault, onError } = useImageFault(item.id, own);
  return (
    <View style={{ flex: 1 }}>
      {fault !== null ? (
        <ImageFaultView fault={fault} />
      ) : (
        <Pressable ref={cell} accessibilityRole="button" accessibilityLabel={fill(UI_WORDS["media.open"], { alt: item.alt })} onPress={onPress} style={{ flex: 1 }} className={FOCUS_RING_INSET}>
          <Picture item={item} style={{ width: "100%", height: "100%" }} onError={onError} />
        </Pressable>
      )}
      {item.moderation ? <OwnImageLabel state={item.moderation} /> : null}
    </View>
  );
}

/**
 * The images of a post (UI design, section 6.7). One image is shown in its own ratio; two to four share a 16:9 frame and
 * are cropped to their cell. The frame is clipped to radius media with a 1 px line-low hairline drawn inside it, so a
 * white image keeps its edge on the Light theme. Pressing one opens the viewer, which grows from it; ALT shows the
 * descriptions in place. An image moderation hid from this reader keeps its place as a placeholder: it has no size of its
 * own, so alone it takes the frame's ratio, it is no control, and it has no description to show. The viewer is told the
 * post that holds the images, so that an image can be reported on it, unless the post is the reader's own.
 */
function Grid({ media, postId, own }: { media: (MediaView | HiddenMedia)[]; postId?: string; own?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const [described, setDescribed] = useState(false);
  // Each cell's control, by its place, for the viewer to measure.
  const cells = useRef<(View | null)[]>([]);
  const cell = (index: number) => {
    const item = media[index]!;
    return isHiddenMedia(item) ? <HiddenImage key={item.id} item={item} /> : <Cell key={item.id} item={item} onPress={() => setOpen(index)} own={own === true} cell={(node) => void (cells.current[index] = node)} />;
  };
  const first = media[0]!;
  // Descriptions exist only for the images this reader is shown.
  const anyShown = media.some((item) => !isHiddenMedia(item));

  let frame;
  if (media.length === 1) {
    frame = <View style={{ aspectRatio: isHiddenMedia(first) ? FRAME_RATIO : clampRatio(first.width, first.height) }}>{cell(0)}</View>;
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
      <View className="overflow-hidden rounded-media bg-surface-2">
        {frame}
        <View pointerEvents="none" aria-hidden className="absolute inset-0 rounded-media border border-line-low" />
      </View>
      {anyShown ? (
        // The one ALT toggle (a per-image badge would say nothing: every korbat image has a description), a 44 px target.
        <Pressable
          accessibilityRole="button"
          aria-expanded={described}
          accessibilityLabel={described ? UI_WORDS["media.hideAlt"] : UI_WORDS["media.showAlt"]}
          onPress={() => setDescribed(!described)}
          className={cn("group min-h-[44px] min-w-[44px] items-start justify-center self-start rounded-control", FOCUS_RING_INSET)}
        >
          <View className={cn("rounded-[6px] border px-1.5 py-0.5", described ? "border-accent bg-accent-wash" : "border-line-high bg-surface-1 web:group-hover:bg-surface-2")}>
            <Text variant="chip" tone={described ? "accent" : "medium"}>
              {UI_WORDS["media.alt"]}
            </Text>
          </View>
        </Pressable>
      ) : null}
      {described
        ? media.map((item, index) => (
            <Text key={item.id} tone="medium" className="mt-1">
              {media.length > 1 ? `${index + 1}. ` : ""}
              {/* A hidden image keeps its number, so the others' numbers match their places in the frame. */}
              {isHiddenMedia(item) ? hiddenImageWords(item) : item.alt}
            </Text>
          ))
        : null}
      <Thumbnails.Provider value={cells}>
        {open === null ? null : <MediaViewer media={media} index={open} onIndex={setOpen} onClose={() => setOpen(null)} postId={own ? undefined : postId} own={own === true} />}
      </Thumbnails.Provider>
    </View>
  );
}

/**
 * A post's images (`Grid`), or a quoted post's as one row of small squares (`compact`). The squares
 * are pictures, not buttons: the whole quote is a link to the quoted post, where the grid and the
 * viewer are, and a control inside another control is one that assistive technology cannot reach.
 * A hidden image keeps its square in the row, and the row says the placeholder's sentence once, as
 * text, under the squares. `postId` is the post that holds the images and `own` says that the reader
 * wrote it: the viewer reports an image on that post, and offers no report of the reader's own.
 */
export function MediaGrid({ media, compact = false, postId, own = false }: { media: (MediaView | HiddenMedia)[]; compact?: boolean; postId?: string; own?: boolean }) {
  if (media.length === 0) return null;
  if (!compact) return <Grid media={media} postId={postId} own={own} />;
  return (
    <View className="mt-2">
      <View className="flex-row" style={{ gap: GAP }}>
        {media.map((item) =>
          isHiddenMedia(item) ? (
            <HiddenThumbnail key={item.id} size={THUMBNAIL} />
          ) : (
            <View key={item.id} className="overflow-hidden rounded-media border border-line-low" style={{ width: THUMBNAIL, height: THUMBNAIL }}>
              <Picture item={item} style={{ width: "100%", height: "100%" }} />
            </View>
          ),
        )}
      </View>
      <HiddenRowWords media={media} />
    </View>
  );
}

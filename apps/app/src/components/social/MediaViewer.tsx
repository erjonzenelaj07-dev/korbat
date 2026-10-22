import { createContext, useContext, useEffect, useId, useRef, useState, type RefObject } from "react";
import { Image } from "expo-image";
import { Modal, Platform, Pressable, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import Animated, { cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { Link } from "expo-router";
import { isHiddenMedia, type HiddenMedia, type MediaView } from "@korbat/contracts";
import { GestureHandlerRootView } from "@/components/GestureRoot";
import { DragArea, type DragHandlers } from "@/components/kit/DragArea";
import { IconButton } from "@/components/kit/IconButton";
import { FOCUS_RING, dataAttribute, lastInputWasKeyboard } from "@/components/kit/interaction";
import { measureNode, type Rect } from "@/components/kit/measure";
import { StatusChip } from "@/components/kit/StatusChip";
import { Text } from "@/components/kit/Text";
import { API_BASE } from "@/lib/api";
import { useHaptics } from "@/lib/haptics";
import { reportHref } from "@/lib/moderation";
import { CHIP_WORDS, REPORT_WORDS } from "@/lib/moderation-words";
import { projectedEnd, useMotion } from "@/lib/motion";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { ThemeScope } from "@/theme/ThemeProvider";
import { FIXED_COLOURS } from "@/theme/tokens";
import { HiddenImage } from "./HiddenImage";
import { ImageFaultView, useImageFault } from "./ImageFault";

interface MediaViewerProps {
  media: (MediaView | HiddenMedia)[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** The post that holds the images: an image is reported on it. Absent for the reader's own post, which they do not report. */
  postId?: string;
  /** 3d: the reader wrote the post, so an image that fails to load asks its status once and says why it is missing. */
  own?: boolean;
}

/**
 * The grid's image cells by their place, which the lightbox grows from and returns into (UI design, section 5.2): the
 * grid provides them around its viewer, so the viewer's props stay as they were.
 */
export const Thumbnails = createContext<RefObject<(View | null)[]> | null>(null);

/** The stage's near-black, 0.94 at full; the drag thins it towards 0.4 at half a screen. */
const STAGE_ALPHA = FIXED_COLOURS.stage[3];
const DRAGGED_ALPHA = 0.4;
/** A vertical release closes when its projected end passes this far, or it moves down faster than 200 px/s. */
const CLOSE_DISTANCE = 100;

/** What the motion hands the content; a render test draws the content without it, open and still. */
interface Staging {
  stageStyle?: object;
  chromeStyle?: object;
  imageStyle?: object;
  drag?: DragHandlers;
  onArea?: (event: LayoutChangeEvent) => void;
  /** The ids that name the dialog: its place among the images and the description. */
  countId?: string;
  altId?: string;
}

/**
 * What the viewer shows: one image in its large size, fitted inside the screen, with its description underneath, its
 * place among the post's images and the controls, on a near-black stage (rgba(0, 0, 0, 0.94)) that is a forced Dark
 * scope in every theme, so images are seen as they are and the ink, buttons and focus ring keep the Dark values (section
 * 6.7). The viewer is opened from an image's own cell only; stepping through the post's images can still come to one
 * moderation hid from this reader, which is never loaded: its placeholder stands in the image's place. An image that is
 * shown can be reported from here, on the post that holds it; the author's own withheld or removed image says so.
 */
export function MediaViewerContent({ media, index, onIndex, onClose, postId, own = false, stageStyle, chromeStyle, imageStyle, drag, onArea, countId, altId }: MediaViewerProps & Staging) {
  const { reduced } = useMotion();
  const item = media[index]!;
  const { fault, onError } = useImageFault(item.id, own && !isHiddenMedia(item));
  const many = media.length > 1;
  const step = (by: number) => onIndex((index + by + media.length) % media.length);

  const picture = isHiddenMedia(item) ? (
    <HiddenImage item={item} />
  ) : fault !== null ? (
    <ImageFaultView fault={fault} />
  ) : (
    <Image source={{ uri: `${API_BASE}${item.large}` }} placeholder={{ blurhash: item.blurhash }} recyclingKey={item.id} contentFit="contain" transition={reduced ? 0 : 150} accessibilityLabel={item.alt} style={{ flex: 1 }} onError={onError} />
  );
  return (
    <ThemeScope theme="dark" style={{ flex: 1 }}>
      <Animated.View style={[{ flex: 1, backgroundColor: `rgba(0, 0, 0, ${STAGE_ALPHA})` }, stageStyle]}>
        <Animated.View style={chromeStyle}>
          <View className="flex-row items-center justify-between gap-3 px-4 py-2">
            <Text nativeID={countId} tone="medium">
              {many ? fill(UI_WORDS["media.count"], { n: index + 1, total: media.length }) : ""}
            </Text>
            <IconButton icon="close" label={UI_WORDS["media.close"]} tone="high" onPress={onClose} />
          </View>
        </Animated.View>
        <View className="flex-1 px-2" onLayout={onArea}>
          <Animated.View style={[{ flex: 1 }, imageStyle]}>
            {/* The browser check finds the image by this mark and reads the motion off the element around it. */}
            <View {...dataAttribute("lightbox-image")} style={{ flex: 1 }}>
              {drag ? (
                <DragArea {...drag} style={{ flex: 1 }}>
                  {picture}
                </DragArea>
              ) : (
                picture
              )}
            </View>
          </Animated.View>
        </View>
        <Animated.View style={chromeStyle}>
          <View className="items-center gap-2 px-4 pb-4 pt-3">
            {isHiddenMedia(item) ? null : (
              <Text nativeID={altId} className="text-center">
                {item.alt}
              </Text>
            )}
            {!isHiddenMedia(item) && item.moderation ? (
              <StatusChip tone={item.moderation === "withheld" ? "review" : "restricted"} label={item.moderation === "withheld" ? CHIP_WORDS.underReview : CHIP_WORDS.removed} className="self-center" />
            ) : null}
            {!isHiddenMedia(item) && postId ? (
              // A real anchor, as every link of the app; the viewer closes as the form opens.
              <Link href={reportHref({ post: postId, media: item.id })} onPress={onClose} asChild>
                <Pressable className={cn("min-h-[44px] justify-center self-center rounded-control px-2", FOCUS_RING)}>
                  <Text tone="accent" className="underline decoration-1 underline-offset-2">
                    {REPORT_WORDS.imageControl}
                  </Text>
                </Pressable>
              </Link>
            ) : null}
            {many ? (
              <View className="flex-row justify-center gap-6">
                <IconButton icon="previous" label={UI_WORDS["media.previous"]} tone="high" onPress={() => step(-1)} />
                <IconButton icon="next" label={UI_WORDS["media.next"]} tone="high" onPress={() => step(1)} />
              </View>
            ) : null}
          </View>
        </Animated.View>
      </Animated.View>
    </ThemeScope>
  );
}

/** The fitted box of an image of this ratio inside the image area (contentFit "contain"), centred. */
function fitted(area: Rect, ratio: number): Rect {
  const width = Math.min(area.width, area.height * ratio);
  const height = width / ratio;
  return { x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2, width, height };
}

/**
 * The transform that lays the fitted image over a thumbnail: the centres together, the image scaled until it fits inside
 * the thumbnail's box. The image area's own centre is the fitted image's, which is where the scale is taken from.
 */
function towards(thumbnail: Rect, area: Rect, ratio: number): { x: number; y: number; scale: number } {
  const image = fitted(area, ratio);
  const scale = Math.min(thumbnail.width / image.width, thumbnail.height / image.height);
  return { x: thumbnail.x + thumbnail.width / 2 - (area.x + area.width / 2), y: thumbnail.y + thumbnail.height / 2 - (area.y + area.height / 2), scale };
}

/**
 * One image on the whole screen (UI design, sections 5.2 and 6.7). It grows from the thumbnail that was pressed (translate
 * and scale, spring-snap) while the stage fades in over 200 ms; a vertical drag of the image takes it along 1:1, shrinking
 * it to 0.85 and thinning the stage to 0.4 at half a screen while the chrome fades, and a release whose momentum carries
 * it 100 px, or a downward flick over 200 px/s, closes it; on touch a horizontal swipe pages to the next image. Closing
 * returns it into its thumbnail when that is on screen, else it fades. Under reduced motion, or opened from the keyboard,
 * it fades in and out in 150 ms and a drag moves the image only. Arrow keys switch at once; react-native-web's Modal
 * closes it on Escape and gives the focus back to the image that opened it.
 */
export function MediaViewer({ media, index, onIndex, onClose, postId, own }: MediaViewerProps) {
  const many = media.length > 1;
  const motion = useMotion();
  const haptic = useHaptics();
  const cells = useContext(Thumbnails);
  const screen = useWindowDimensions();
  const countId = useId();
  const altId = useId();
  const area = useRef<Rect | null>(null);
  const closing = useRef(false);
  const still = useRef(motion.reduced || lastInputWasKeyboard());
  const [opened, setOpened] = useState(false);

  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const scale = useSharedValue(1);
  // 0 to 1: the stage's share of its full near-black, the chrome's opacity, and the whole viewer's under a fade.
  const stage = useSharedValue(0);
  const chrome = useSharedValue(0);
  const whole = useSharedValue(still.current ? 0 : 1);
  // The image waits unseen until it is laid over its thumbnail, so its first frame is never at full size.
  const ready = useSharedValue(still.current ? 1 : 0);

  const item = media[index]!;
  const ratio = isHiddenMedia(item) ? 16 / 9 : item.width / item.height;

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" && many) onIndex((index + 1) % media.length);
      if (event.key === "ArrowLeft" && many) onIndex((index - 1 + media.length) % media.length);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, many, media.length, onIndex]);

  /** Opens once the image area has its size: from the thumbnail, or as a fade. */
  const onArea = (event: LayoutChangeEvent) => {
    const { x: left, y: top, width, height } = event.nativeEvent.layout;
    area.current = { x: left, y: top, width, height };
    if (opened) return;
    setOpened(true);
    if (still.current) {
      stage.value = 1;
      chrome.value = 1;
      whole.value = withTiming(1, motion.timing("fade"));
      return;
    }
    stage.value = withTiming(1, motion.timing("easeOut", 200));
    chrome.value = withTiming(1, motion.timing("easeOut", 200));
    const node = cells?.current[index];
    if (!node) {
      ready.value = withTiming(1, motion.timing("fade"));
      return;
    }
    measureNode(node, (thumbnail) => {
      if (!area.current || closing.current) return;
      const from = towards(thumbnail, area.current, ratio);
      x.value = from.x;
      y.value = from.y;
      scale.value = from.scale;
      ready.value = 1;
      x.value = withSpring(0, motion.spring("springSnap"));
      y.value = withSpring(0, motion.spring("springSnap"));
      scale.value = withSpring(1, motion.spring("springSnap"));
    });
  };

  /** Closes: back into the thumbnail of the image on screen when it is in view, else a fade; then the viewer leaves. */
  const close = (velocity = 0) => {
    if (closing.current) return;
    closing.current = true;
    const leave = (finished?: boolean) => {
      "worklet";
      if (finished) runOnJS(onClose)();
    };
    const fade = () => {
      whole.value = withTiming(0, motion.timing("fade"), leave);
    };
    if (still.current || motion.reduced || !area.current) {
      fade();
      return;
    }
    const node = cells?.current[index];
    if (!node) {
      fade();
      return;
    }
    measureNode(node, (thumbnail) => {
      const inView = thumbnail.y + thumbnail.height > 0 && thumbnail.y < screen.height && thumbnail.width > 0;
      if (!inView || !area.current) {
        fade();
        return;
      }
      const to = towards(thumbnail, area.current, ratio);
      stage.value = withTiming(0, motion.timing("easeOut", 150));
      chrome.value = withTiming(0, motion.timing("easeOut", 150));
      x.value = withSpring(to.x, motion.spring("springRelease"));
      scale.value = withSpring(to.scale, motion.spring("springRelease"));
      y.value = withSpring(to.y, motion.spring("springRelease", velocity), leave);
    });
  };

  // The drag: vertical to dismiss; on touch, horizontal to page.
  const axis = useRef<"x" | "y" | null>(null);
  const past = useRef(false);
  const settle = (vx: number, vy: number) => {
    if (still.current || motion.reduced) {
      x.value = withTiming(0, motion.timing("fade"));
      y.value = withTiming(0, motion.timing("fade"));
      return;
    }
    x.value = withSpring(0, motion.spring("springRelease", vx));
    y.value = withSpring(0, motion.spring("springRelease", vy));
    scale.value = withSpring(1, motion.spring("springRelease"));
    stage.value = withTiming(1, motion.timing("easeOut", 150));
    chrome.value = withTiming(1, motion.timing("easeOut", 150));
  };
  const page = (by: number, vx: number) => {
    const width = area.current?.width ?? screen.width;
    const next = (index + by + media.length) % media.length;
    if (still.current || motion.reduced) {
      x.value = 0;
      onIndex(next);
      return;
    }
    // Out along the swipe, then the neighbour in from the other side.
    const arrive = () => {
      onIndex(next);
      x.value = by * width;
      x.value = withSpring(0, motion.spring("springRelease"));
    };
    x.value = withSpring(-by * width, motion.spring("springRelease", vx), (finished) => {
      "worklet";
      if (finished) runOnJS(arrive)();
    });
  };
  const drag: DragHandlers = {
    onStart: (along, touch) => {
      if (closing.current) return false;
      if (along === "x" && !(touch && many)) return false;
      axis.current = along;
      past.current = false;
      cancelAnimation(x);
      cancelAnimation(y);
      return true;
    },
    onMove: (dx, dy) => {
      if (axis.current === "x") {
        x.value = dx;
        return;
      }
      x.value = dx;
      y.value = dy;
      if (!(still.current || motion.reduced)) {
        const half = Math.max(1, screen.height / 2);
        const share = Math.min(1, Math.abs(dy) / half);
        scale.value = 1 - 0.15 * share;
        stage.value = 1 - (1 - DRAGGED_ALPHA / STAGE_ALPHA) * share;
        chrome.value = 1 - Math.min(1, share * 2);
      }
      const over = Math.abs(dy) > CLOSE_DISTANCE;
      if (over !== past.current) {
        past.current = over;
        if (over) haptic("threshold");
      }
    },
    onEnd: (dx, dy, vx, vy) => {
      if (axis.current === "x") {
        const width = area.current?.width ?? screen.width;
        const end = projectedEnd(dx, vx);
        if (Math.abs(end) > width / 3) page(end < 0 ? 1 : -1, vx);
        else settle(vx, 0);
        return;
      }
      if (Math.abs(projectedEnd(dy, vy)) > CLOSE_DISTANCE || vy > 200) close(vy);
      else settle(vx, vy);
    },
  };

  const stageStyle = useAnimatedStyle(() => ({ backgroundColor: `rgba(0, 0, 0, ${STAGE_ALPHA * stage.value})`, opacity: whole.value }));
  const chromeStyle = useAnimatedStyle(() => ({ opacity: chrome.value }));
  const imageStyle = useAnimatedStyle(() => ({ opacity: ready.value, transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }] }));
  const named = [many ? countId : null, isHiddenMedia(item) ? null : altId].filter((part) => part !== null).join(" ");

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => close()} aria-labelledby={named}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <MediaViewerContent
          media={media}
          index={index}
          onIndex={onIndex}
          onClose={() => close()}
          postId={postId}
          own={own}
          stageStyle={stageStyle}
          chromeStyle={chromeStyle}
          imageStyle={imageStyle}
          drag={drag}
          onArea={onArea}
          countId={countId}
          altId={altId}
        />
      </GestureHandlerRootView>
    </Modal>
  );
}
